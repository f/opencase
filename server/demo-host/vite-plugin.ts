import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { Plugin, PreviewServer, ViteDevServer } from 'vite'

import type { DemoCaseSessionRef } from '../../src/demo-host-client'
import type { VerifiedAssetFile } from '../../src/case-package'
import {
  CaseImportError,
  createCaseLibrary,
  type CaseImportRemoteLoader,
  type CaseLibrary,
  type PublicCaseLibraryEntry,
} from '../case-library'
import { createFileCaseSaveStorage } from './file-save-storage'
import {
  loadDemoCaseRegistry,
  type DemoCaseRegistry,
  type TrustedDemoCase,
} from './registry'
import {
  DemoHostRequestError,
  createDemoSessionService,
  parseDemoAssetRequest,
  parseDemoBrowserIntent,
  parseDemoSessionRef,
  type DemoSessionService,
} from './service'

const API_ROOT = '/api/demo/session'
const CASE_LIBRARY_API_ROOT = '/api/case-library'
const LOCAL_CASE_LIBRARY_OWNER = 'local-library'
const MAX_REQUEST_BYTES = 64 * 1024

type UnknownRecord = Record<string, unknown>

export interface DemoHostVitePluginOptions {
  readonly casesDirectory: string
  readonly dataDirectory: string
  /** Optional host dependency injection, primarily for deterministic import tests. */
  readonly caseImportRemoteLoader?: CaseImportRemoteLoader
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.end(body)
}

function requestError(code: string, message: string, status = 400): never {
  throw new DemoHostRequestError(code, message, status)
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return requestError('invalid-request', `${label} must be an object.`)
  }
  return value as UnknownRecord
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';')[0]?.trim()
  if (contentType !== 'application/json') {
    return requestError('invalid-content-type', 'Requests must use application/json.', 415)
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > MAX_REQUEST_BYTES) {
      return requestError('request-too-large', 'Request body is too large.', 413)
    }
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return requestError('invalid-json', 'Request body must be valid JSON.')
  }
}

function queryRef(
  url: URL,
  additionalAllowed: readonly string[] = [],
): Required<DemoCaseSessionRef> {
  const allowed = new Set(['caseId', 'caseVersion', 'locale', 'saveId', ...additionalAllowed])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) requestError('invalid-request', `Unsupported query parameter '${key}'.`)
    if (url.searchParams.getAll(key).length !== 1) {
      requestError('invalid-request', `Query parameter '${key}' must appear exactly once.`)
    }
  }
  return parseDemoSessionRef({
    caseId: url.searchParams.get('caseId') ?? undefined,
    caseVersion: url.searchParams.get('caseVersion') ?? undefined,
    locale: url.searchParams.get('locale') ?? undefined,
    ...(url.searchParams.has('saveId')
      ? { saveId: url.searchParams.get('saveId') ?? undefined }
      : {}),
  })
}

function requiredQueryParameter(url: URL, name: string): string {
  const values = url.searchParams.getAll(name)
  if (values.length !== 1) requestError('invalid-request', `Query parameter '${name}' is required once.`)
  return values[0]!
}

interface DemoAssetByteRange {
  readonly start: number
  readonly end: number
}

function safeDecimal(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function assetRange(value: string | undefined, sizeBytes: number): DemoAssetByteRange | undefined {
  if (value === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (match[1] === '' && match[2] === '') || sizeBytes <= 0) {
    return requestError('invalid-range', 'Requested byte range is not satisfiable.', 416)
  }
  if (match[1] === '') {
    const suffix = safeDecimal(match[2]!)
    if (suffix === undefined || suffix <= 0) {
      return requestError('invalid-range', 'Requested byte range is not satisfiable.', 416)
    }
    return { start: Math.max(0, sizeBytes - suffix), end: sizeBytes - 1 }
  }
  const start = safeDecimal(match[1]!)
  const requestedEnd = match[2] === '' ? sizeBytes - 1 : safeDecimal(match[2]!)
  if (
    start === undefined ||
    requestedEnd === undefined ||
    start >= sizeBytes ||
    requestedEnd < start
  ) {
    return requestError('invalid-range', 'Requested byte range is not satisfiable.', 416)
  }
  return { start, end: Math.min(requestedEnd, sizeBytes - 1) }
}

function extensionForMimeType(mimeType: string): string {
  const extensions: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'text/plain': 'txt',
  }
  return extensions[mimeType] ?? 'bin'
}

/** Player-safe headers for a gateway-verified file; never derives names from paths. */
export function demoAssetHeaders(
  file: VerifiedAssetFile,
  range?: DemoAssetByteRange,
): Readonly<Record<string, string>> {
  const length = range ? range.end - range.start + 1 : file.sizeBytes
  return {
    'content-type': file.mimeType,
    'content-length': String(length),
    'content-disposition': `${file.contentDisposition}; filename="case-asset.${extensionForMimeType(file.mimeType)}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "sandbox; default-src 'none'",
    ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${file.sizeBytes}` } : {}),
  }
}

async function verifyOpenedAsset(
  handle: FileHandle,
  file: VerifiedAssetFile,
): Promise<void> {
  const stats = await handle.stat()
  if (!stats.isFile() || stats.size !== file.sizeBytes) {
    throw new DemoHostRequestError(
      'asset-delivery-failed',
      'The trusted local host could not deliver this asset safely.',
      502,
    )
  }
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, file.sizeBytes)))
  let position = 0
  while (position < file.sizeBytes) {
    const length = Math.min(buffer.byteLength, file.sizeBytes - position)
    const { bytesRead } = await handle.read(buffer, 0, length, position)
    if (bytesRead <= 0) {
      throw new DemoHostRequestError(
        'asset-delivery-failed',
        'The trusted local host could not deliver this asset safely.',
        502,
      )
    }
    digest.update(buffer.subarray(0, bytesRead))
    position += bytesRead
  }
  if (digest.digest('hex') !== file.digest.replace(/^sha256:/, '')) {
    throw new DemoHostRequestError(
      'asset-delivery-failed',
      'The trusted local host could not deliver this asset safely.',
      502,
    )
  }
}

async function sendAsset(
  request: IncomingMessage,
  response: ServerResponse,
  file: VerifiedAssetFile,
): Promise<void> {
  let range: DemoAssetByteRange | undefined
  try {
    range = assetRange(request.headers.range, file.sizeBytes)
  } catch (error) {
    if (error instanceof DemoHostRequestError && error.status === 416) {
      response.statusCode = 416
      response.setHeader('content-range', `bytes */${file.sizeBytes}`)
      response.setHeader('cache-control', 'private, no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      response.end()
      return
    }
    throw error
  }

  let handle
  try {
    handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    // Hash the exact open descriptor that will be streamed. If the cache path
    // was atomically replaced after gateway verification, this fails before
    // any headers or attacker-controlled bytes are sent.
    await verifyOpenedAsset(handle, file)
    response.statusCode = range ? 206 : 200
    for (const [name, value] of Object.entries(demoAssetHeaders(file, range))) {
      response.setHeader(name, value)
    }
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    await pipeline(handle.createReadStream({
      autoClose: false,
      ...(range ? { start: range.start, end: range.end } : {}),
    }), response)
  } catch (error) {
    if (error instanceof DemoHostRequestError) throw error
    throw new DemoHostRequestError(
      'asset-delivery-failed',
      'The trusted local host could not deliver this asset safely.',
      502,
    )
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function bodyRef(body: UnknownRecord): Required<DemoCaseSessionRef> {
  return parseDemoSessionRef({
    caseId: body.caseId,
    caseVersion: body.caseVersion,
    locale: body.locale,
    ...(body.saveId !== undefined ? { saveId: body.saveId } : {}),
  })
}

function exactBodyKeys(
  body: UnknownRecord,
  allowed: readonly string[],
): void {
  const accepted = new Set(allowed)
  for (const key of Object.keys(body)) {
    if (!accepted.has(key)) requestError('invalid-request', `Unsupported body field '${key}'.`)
  }
}

function requestedLocale(url: URL): string {
  for (const key of url.searchParams.keys()) {
    if (key !== 'locale') requestError('invalid-request', `Unsupported query parameter '${key}'.`)
  }
  const values = url.searchParams.getAll('locale')
  if (values.length !== 1) requestError('invalid-request', "Query parameter 'locale' is required once.")
  const locale = values[0]!
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || locale.length > 32) {
    requestError('invalid-request', 'Requested locale is invalid.')
  }
  return locale
}

interface DemoHostState {
  readonly registry: DemoCaseRegistry
  readonly library: CaseLibrary
  readonly service: DemoSessionService
}

async function catalogEntry(
  trustedCase: TrustedDemoCase,
  locale: string,
  installedEntries: readonly PublicCaseLibraryEntry[],
) {
  const installed = installedEntries.find((entry) => (
    entry.caseId === trustedCase.caseId
    && entry.caseVersion === trustedCase.caseVersion
    && entry.packageDigest === trustedCase.compiled.packageDigest
  ))
  const selectedLocale = trustedCase.locale(locale)
  const manifest = trustedCase.compiled.localizedPublicManifests[selectedLocale]
    ?? trustedCase.compiled.result.publicManifest
  return Object.freeze({
    id: trustedCase.caseId,
    version: trustedCase.caseVersion,
    caseDigest: trustedCase.compiled.kernelDigest,
    packageDigest: trustedCase.compiled.packageDigest,
    title: manifest.case.title,
    synopsis: manifest.case.synopsis,
    durationMinutes: manifest.case.durationMinutes,
    locale: selectedLocale,
    defaultLocale: trustedCase.compiled.localization.defaultLocale,
    locales: trustedCase.compiled.localization.locales,
    source: installed?.source ?? { kind: 'built-in', label: 'opencase' },
    verification: installed?.verification ?? {
      level: 'built-in',
      authoredTests: 0,
    },
    manifest,
  })
}

async function caseCatalog(state: DemoHostState, locale: string) {
  const installedEntries = await state.library.list(LOCAL_CASE_LIBRARY_OWNER)
  const cases = await Promise.all(
    state.registry.list().map((trustedCase) => (
      catalogEntry(trustedCase, locale, installedEntries)
    )),
  )
  return Object.freeze({
    schema: 'detective-case-catalog/v1',
    cases,
  })
}

async function handleCaseLibraryApi(
  state: DemoHostState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === CASE_LIBRARY_API_ROOT) {
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return requestError('method-not-allowed', 'This endpoint accepts GET only.', 405)
    }
    json(response, 200, await caseCatalog(state, requestedLocale(url)))
    return
  }
  if (url.pathname !== `${CASE_LIBRARY_API_ROOT}/import` || url.search.length > 0) {
    return requestError('not-found', 'Unknown case library endpoint.', 404)
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST')
    return requestError('method-not-allowed', 'This endpoint accepts POST only.', 405)
  }
  const body = record(await readJson(request), 'request body')
  exactBodyKeys(body, ['kind', 'url', 'locale'])
  const locale = typeof body.locale === 'string' ? body.locale : ''
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || locale.length > 32) {
    return requestError('invalid-request', 'Requested locale is invalid.')
  }
  if ((body.kind !== 'github' && body.kind !== 'yaml') || typeof body.url !== 'string') {
    return requestError('invalid-request', 'Import requires a GitHub or YAML URL.')
  }
  const abortController = new AbortController()
  request.once('aborted', () => abortController.abort())
  const imported = await state.library.importCase(
    LOCAL_CASE_LIBRARY_OWNER,
    { kind: body.kind, url: body.url },
    abortController.signal,
  )
  const trustedCase = state.registry.get(imported.entry.caseId, imported.entry.caseVersion)
  const installedEntries = await state.library.list(LOCAL_CASE_LIBRARY_OWNER)
  json(response, 201, {
    schema: 'detective-case-import/v1',
    entry: await catalogEntry(trustedCase, locale, installedEntries),
  })
}

async function handleApi(
  service: DemoSessionService,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === `${API_ROOT}/asset`) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD')
      return requestError('method-not-allowed', 'This endpoint accepts GET and HEAD only.', 405)
    }
    const assetFields = ['assetSessionId', 'caseDigest', 'assetId'] as const
    const ref = queryRef(url, assetFields)
    const abortController = new AbortController()
    request.once('aborted', () => abortController.abort())
    const file = await service.asset(ref, parseDemoAssetRequest({
      assetSessionId: requiredQueryParameter(url, 'assetSessionId'),
      caseDigest: requiredQueryParameter(url, 'caseDigest'),
      assetId: requiredQueryParameter(url, 'assetId'),
    }), abortController.signal)
    await sendAsset(request, response, file)
    return
  }
  if (url.pathname === API_ROOT) {
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET')
      return requestError('method-not-allowed', 'This endpoint accepts GET only.', 405)
    }
    json(response, 200, await service.status(queryRef(url)))
    return
  }

  const operation = url.pathname.slice(`${API_ROOT}/`.length)
  if (!['start', 'command', 'restart'].includes(operation) || url.search.length > 0) {
    return requestError('not-found', 'Unknown local demo endpoint.', 404)
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST')
    return requestError('method-not-allowed', 'This endpoint accepts POST only.', 405)
  }
  const body = record(await readJson(request), 'request body')
  if (operation === 'command') {
    exactBodyKeys(body, ['caseId', 'caseVersion', 'locale', 'saveId', 'intent'])
    const result = await service.command(
      bodyRef(body),
      parseDemoBrowserIntent(body.intent),
    )
    json(response, 200, result)
    return
  }
  exactBodyKeys(body, ['caseId', 'caseVersion', 'locale', 'saveId'])
  const ref = bodyRef(body)
  json(
    response,
    200,
    operation === 'start'
      ? await service.start(ref)
      : await service.restart(ref),
  )
}

export function createDemoHostVitePlugin(
  options: DemoHostVitePluginOptions,
): Plugin {
  let statePromise: Promise<DemoHostState> | undefined
  const state = (): Promise<DemoHostState> => {
    statePromise ??= loadDemoCaseRegistry({ casesDirectory: options.casesDirectory })
      .then(async (registry) => {
        const library = createCaseLibrary({
          rootDirectory: join(options.dataDirectory, 'case-library'),
          registry,
          ...(options.caseImportRemoteLoader
            ? { remoteLoader: options.caseImportRemoteLoader }
            : {}),
        })
        await library.registerInstalled(LOCAL_CASE_LIBRARY_OWNER)
        return Object.freeze({
          registry,
          library,
          service: createDemoSessionService({
            registry,
            storage: createFileCaseSaveStorage(options.dataDirectory),
            assetCacheDirectory: join(options.dataDirectory, 'asset-cache'),
          }),
        })
      })
    return statePromise
  }

  const configure = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const isSessionApi = pathname === API_ROOT || pathname.startsWith(`${API_ROOT}/`)
      const isCaseLibraryApi = pathname === CASE_LIBRARY_API_ROOT
        || pathname.startsWith(`${CASE_LIBRARY_API_ROOT}/`)
      if (!isSessionApi && !isCaseLibraryApi) {
        next()
        return
      }
      void state()
        .then((instance) => isCaseLibraryApi
          ? handleCaseLibraryApi(instance, request, response)
          : handleApi(instance.service, request, response))
        .catch((error: unknown) => {
          if (response.headersSent) {
            response.end()
            return
          }
          if (error instanceof DemoHostRequestError) {
            json(response, error.status, {
              error: { code: error.code, message: error.message },
            })
            return
          }
          if (error instanceof CaseImportError) {
            const status = error.code === 'case-version-conflict'
              ? 409
              : error.code === 'remote-import-failed'
                ? 502
                : error.code === 'case-library-storage'
                  ? 500
                  : error.code === 'case-validation-failed' || error.code === 'case-tests-failed'
                    ? 422
                    : 400
            json(response, status, {
              error: {
                code: error.code,
                message: error.message,
                ...(error.diagnostics.length > 0 ? { diagnostics: error.diagnostics } : {}),
              },
            })
            return
          }
          server.config.logger.error(
            error instanceof Error ? error.stack ?? error.message : String(error),
          )
          json(response, 500, {
            error: {
              code: 'demo-host-failure',
              message: 'The trusted local detective host could not complete the request.',
            },
          })
        })
    })
  }

  return {
    name: 'detective-demo-host',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      configure(server)
    },
    configurePreviewServer(server) {
      configure(server)
    },
  }
}
