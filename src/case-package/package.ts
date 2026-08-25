import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  compileCaseSource,
  hashCanonical,
  inspectCaseSourceLocalization,
  type CompiledAsset,
} from '../compiler'
import { compileToKernelIR } from '../case-runtime'
import {
  CasePackageError,
  type AssetAuthorizationContext,
  type AssetAuthorizer,
  type AssetPayload,
  type CaseAssetGateway,
  type CaseAssetGatewayOptions,
  type CompileCasePackageOptions,
  type CompiledCasePackage,
  type HostAssetDelivery,
  type LoadedCasePackage,
  type VerifiedAssetFile,
  type VerifiedPackageAsset,
} from './types'
import {
  canonicalLocalizedManifest,
  loadCaseLocalization,
  localizePublicCaseManifest,
} from './localization'

const PACKAGE_SLUG = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_MAX_ASSET_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_TOTAL_ASSET_BYTES = 2 * 1024 * 1024 * 1024
const MAX_SVG_BYTES = 5 * 1024 * 1024
const MAX_CASE_SOURCE_BYTES = 2 * 1024 * 1024

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function requireDirectory(
  path: string,
  code:
    | 'E_CASE_PACKAGE_PATH'
    | 'E_CASE_PACKAGE_ASSETS'
    | 'E_CASE_PACKAGE_TESTS'
    | 'E_CASE_PACKAGE_I18N',
): Promise<void> {
  let stats
  try {
    stats = await lstat(path)
  } catch {
    throw new CasePackageError(code, `Required case package directory is missing: ${path}`, path)
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new CasePackageError(code, `Case package directory must be a real directory, not a symlink: ${path}`, path)
  }
}

export async function loadCasePackage(packageDirectory: string): Promise<LoadedCasePackage> {
  const requestedRoot = resolve(packageDirectory)
  await requireDirectory(requestedRoot, 'E_CASE_PACKAGE_PATH')
  const packageRoot = await realpath(requestedRoot)
  const packageSlug = basename(packageRoot)
  if (!PACKAGE_SLUG.test(packageSlug)) {
    throw new CasePackageError(
      'E_CASE_PACKAGE_PATH',
      `Case package folder '${packageSlug}' must be a lowercase kebab-case slug.`,
      packageRoot,
    )
  }

  const sourcePath = join(packageRoot, 'case.yml')
  let sourceHandle: FileHandle
  try {
    sourceHandle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new CasePackageError(
      'E_CASE_SOURCE_MISSING',
      `Case package '${packageSlug}' must contain case.yml.`,
      sourcePath,
    )
  }
  let sourceText: string
  try {
    const sourceStats = await sourceHandle.stat()
    if (!sourceStats.isFile()) {
      throw new CasePackageError(
        'E_CASE_SOURCE_MISSING',
        'case.yml must be a regular file, not a symlink.',
        sourcePath,
      )
    }
    if (sourceStats.size > MAX_CASE_SOURCE_BYTES) {
      throw new CasePackageError(
        'E_CASE_SOURCE_INVALID',
        `case.yml exceeds the ${MAX_CASE_SOURCE_BYTES}-byte source limit.`,
        sourcePath,
      )
    }
    const bytes = await sourceHandle.readFile()
    if (bytes.byteLength !== sourceStats.size || bytes.byteLength > MAX_CASE_SOURCE_BYTES) {
      throw new CasePackageError(
        'E_CASE_SOURCE_INVALID',
        'case.yml changed while it was being read.',
        sourcePath,
      )
    }
    try {
      sourceText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new CasePackageError(
        'E_CASE_SOURCE_INVALID',
        'case.yml must be valid UTF-8.',
        sourcePath,
      )
    }
  } finally {
    await sourceHandle.close()
  }

  const assetsRoot = join(packageRoot, 'assets')
  await requireDirectory(assetsRoot, 'E_CASE_PACKAGE_ASSETS')
  const resolvedAssetsRoot = await realpath(assetsRoot)
  if (!isWithin(packageRoot, resolvedAssetsRoot)) {
    throw new CasePackageError(
      'E_ASSET_ESCAPE',
      'The assets directory resolves outside the case package.',
      assetsRoot,
    )
  }

  const testsRoot = join(packageRoot, 'tests')
  await requireDirectory(testsRoot, 'E_CASE_PACKAGE_TESTS')
  const resolvedTestsRoot = await realpath(testsRoot)
  if (!isWithin(packageRoot, resolvedTestsRoot)) {
    throw new CasePackageError(
      'E_CASE_PACKAGE_TESTS',
      'The tests directory resolves outside the case package.',
      testsRoot,
    )
  }

  const i18nRoot = join(packageRoot, 'i18n')
  await requireDirectory(i18nRoot, 'E_CASE_PACKAGE_I18N')
  const resolvedI18nRoot = await realpath(i18nRoot)
  if (!isWithin(packageRoot, resolvedI18nRoot)) {
    throw new CasePackageError(
      'E_CASE_PACKAGE_I18N',
      'The i18n directory resolves outside the case package.',
      i18nRoot,
    )
  }

  return {
    packageRoot,
    packageSlug,
    sourcePath,
    assetsRoot: resolvedAssetsRoot,
    testsRoot: resolvedTestsRoot,
    i18nRoot: resolvedI18nRoot,
    sourceText,
  }
}

async function rejectSymlinkComponents(
  packageRoot: string,
  authoredPath: string,
): Promise<string> {
  const components = authoredPath.split('/')
  let current = packageRoot
  for (const component of components) {
    current = join(current, component)
    let stats
    try {
      stats = await lstat(current)
    } catch {
      throw new CasePackageError(
        'E_ASSET_MISSING',
        `Local asset is missing: ${authoredPath}`,
        current,
      )
    }
    if (stats.isSymbolicLink()) {
      throw new CasePackageError(
        'E_ASSET_SYMLINK',
        `Local assets may not traverse symbolic links: ${authoredPath}`,
        current,
      )
    }
  }
  return current
}

function assertSafeSvg(bytes: Uint8Array, path: string): void {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CasePackageError(
      'E_ASSET_UNSAFE_SVG',
      `SVG is not valid UTF-8 and cannot be served: ${path}`,
      path,
    )
  }
  const withoutDeclaration = text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/i, '')
  if (!/^\s*<svg(?:\s|>)/i.test(withoutDeclaration)) {
    throw new CasePackageError(
      'E_ASSET_UNSAFE_SVG',
      `SVG must contain one static svg root: ${path}`,
      path,
    )
  }
  // SVG is served as image content, but browsers have repeatedly gained new
  // active SVG features. Accept a conservative, static subset instead of
  // attempting to sanitize arbitrary XML/CSS with a permissive regex.
  const unsafe = [
    /<\s*\/?\s*[a-z_][\w.-]*:/i,
    /\s(?:xmlns:[\w.-]+|[a-z_][\w.-]*:[a-z_][\w.-]*)\s*=/i,
    /<!\s*(?:doctype|entity|\[cdata)/i,
    /<\?(?!xml\b)/i,
    /<\s*\/?\s*(?:script|foreignObject|iframe|object|embed|audio|video|image|use|a|style|link|meta|base|set|animate(?:Motion|Transform)?|discard|mpath|feImage)\b/i,
    /\son[a-z]+\s*=/i,
    /\s(?:href|src|style)\s*=/i,
    /(?:javascript\s*:|data\s*:|@import\b|url\s*\()/i,
  ]
  if (unsafe.some((pattern) => pattern.test(text))) {
    throw new CasePackageError(
      'E_ASSET_UNSAFE_SVG',
      `SVG contains active or external content and cannot be served: ${path}`,
      path,
    )
  }
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`)
  }
  return limit
}

async function hashOpenFile(
  handle: FileHandle,
  path: string,
  mimeType: string,
  maxBytes: number,
): Promise<{ digest: string; sizeBytes: number; device: number; inode: number; modifiedAtMs: number }> {
  const stats = await handle.stat()
  if (!stats.isFile()) {
    throw new CasePackageError('E_ASSET_NOT_FILE', `Local asset must be a regular file: ${path}`, path)
  }
  if (stats.size > maxBytes) {
    throw new CasePackageError(
      'E_ASSET_TOO_LARGE',
      `Local asset is ${stats.size} bytes; the configured limit is ${maxBytes}: ${path}`,
      path,
    )
  }
  if (mimeType === 'image/svg+xml' && stats.size > MAX_SVG_BYTES) {
    throw new CasePackageError(
      'E_ASSET_TOO_LARGE',
      `SVG exceeds the ${MAX_SVG_BYTES}-byte static SVG limit: ${path}`,
      path,
    )
  }

  const hash = createHash('sha256')
  const svgChunks: Uint8Array[] = []
  let streamedBytes = 0
  for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
    const bytes = chunk as Uint8Array
    streamedBytes += bytes.byteLength
    if (streamedBytes > maxBytes || streamedBytes > stats.size) {
      throw new CasePackageError('E_ASSET_TOO_LARGE', `Asset grew while being verified: ${path}`, path)
    }
    hash.update(bytes)
    if (mimeType === 'image/svg+xml') svgChunks.push(bytes)
  }
  if (streamedBytes !== stats.size) {
    throw new CasePackageError('E_ASSET_CONTENT', `Asset changed while being verified: ${path}`, path)
  }
  if (mimeType === 'image/svg+xml') assertSafeSvg(Buffer.concat(svgChunks), path)
  return {
    digest: hash.digest('hex'),
    sizeBytes: stats.size,
    device: stats.dev,
    inode: stats.ino,
    modifiedAtMs: stats.mtimeMs,
  }
}

async function verifyLocalAsset(
  loaded: LoadedCasePackage,
  asset: CompiledAsset,
  maxBytes: number,
): Promise<VerifiedPackageAsset> {
  if (asset.source.kind !== 'local') return { descriptor: asset }
  const candidate = await rejectSymlinkComponents(loaded.packageRoot, asset.source.path)
  const initiallyResolvedPath = await realpath(candidate)
  if (!isWithin(loaded.assetsRoot, initiallyResolvedPath)) {
    throw new CasePackageError(
      'E_ASSET_ESCAPE',
      `Local asset resolves outside assets/: ${asset.source.path}`,
      candidate,
    )
  }
  let handle: FileHandle
  try {
    // Open the authored path itself. O_NOFOLLOW protects the final component;
    // the identity/containment check below also catches an intermediate
    // directory being swapped to a symlink between validation and open.
    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    throw new CasePackageError(
      'E_ASSET_SYMLINK',
      `Local asset could not be opened without following links: ${asset.source.path}`,
      error instanceof Error ? initiallyResolvedPath : candidate,
    )
  }
  try {
    const openedStats = await handle.stat()
    const resolvedPath = await realpath(candidate)
    if (!isWithin(loaded.assetsRoot, resolvedPath)) {
      throw new CasePackageError(
        'E_ASSET_ESCAPE',
        `Local asset escaped assets/ while it was being opened: ${asset.source.path}`,
        candidate,
      )
    }
    const currentStats = await lstat(resolvedPath)
    if (
      currentStats.isSymbolicLink() ||
      !currentStats.isFile() ||
      !openedStats.isFile() ||
      currentStats.dev !== openedStats.dev ||
      currentStats.ino !== openedStats.ino
    ) {
      throw new CasePackageError(
        'E_ASSET_SYMLINK',
        `Local asset path changed while it was being opened: ${asset.source.path}`,
        candidate,
      )
    }
    const verified = await hashOpenFile(handle, resolvedPath, asset.mimeType, maxBytes)
    if (verified.digest !== asset.integrity.digest) {
      throw new CasePackageError(
        'E_ASSET_DIGEST',
        `Asset '${asset.id}' digest mismatch: expected ${asset.integrity.digest}, got ${verified.digest}.`,
        resolvedPath,
      )
    }
    return {
      descriptor: asset,
      absolutePath: resolvedPath,
      sizeBytes: verified.sizeBytes,
      device: verified.device,
      inode: verified.inode,
      modifiedAtMs: verified.modifiedAtMs,
    }
  } finally {
    await handle.close()
  }
}

export async function compileCasePackage(
  packageDirectory: string,
  options: CompileCasePackageOptions = {},
): Promise<CompiledCasePackage> {
  const loaded = await loadCasePackage(packageDirectory)
  let inspection
  try {
    inspection = inspectCaseSourceLocalization(loaded.sourceText)
  } catch (error) {
    throw new CasePackageError(
      'E_CASE_SOURCE_INVALID',
      error instanceof Error ? error.message : 'Case source is not valid YAML.',
      loaded.sourcePath,
    )
  }
  if (!inspection.caseId || !inspection.caseVersion || !inspection.defaultLocale) {
    const preflight = compileCaseSource(loaded.sourceText, { fileName: loaded.sourcePath })
    const detail = preflight.diagnostics
      .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
      .join('\n')
    throw new CasePackageError(
      'E_CASE_SOURCE_INVALID',
      `Case source identity is invalid:\n${detail}`,
      loaded.sourcePath,
    )
  }
  const localization = await loadCaseLocalization({
    i18nRoot: loaded.i18nRoot,
    caseId: inspection.caseId,
    caseVersion: inspection.caseVersion,
    defaultLocale: inspection.defaultLocale,
    referenceKeys: inspection.referenceKeys,
  })
  const defaultCatalog = localization.catalogs[localization.defaultLocale]!
  const result = compileCaseSource(loaded.sourceText, {
    fileName: loaded.sourcePath,
    localization: {
      defaultLocale: localization.defaultLocale,
      availableKeys: new Set(Object.keys(defaultCatalog.messages)),
    },
  })
  if (
    !result.ok ||
    !result.ir ||
    !result.publicManifest ||
    !result.canonicalIrJson ||
    !result.canonicalPublicManifestJson
  ) {
    const detail = result.diagnostics
      .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
      .join('\n')
    throw new CasePackageError(
      'E_CASE_PACKAGE_PATH',
      `Case source did not compile:\n${detail}`,
      loaded.sourcePath,
    )
  }

  const maxAssetBytes = positiveLimit(options.maxAssetBytes, DEFAULT_MAX_ASSET_BYTES, 'maxAssetBytes')
  const maxTotalAssetBytes = positiveLimit(
    options.maxTotalAssetBytes,
    DEFAULT_MAX_TOTAL_ASSET_BYTES,
    'maxTotalAssetBytes',
  )
  const assets: VerifiedPackageAsset[] = []
  let totalLocalBytes = 0
  for (const asset of result.ir.assets) {
    const verified = await verifyLocalAsset(loaded, asset, maxAssetBytes)
    totalLocalBytes += verified.sizeBytes ?? 0
    if (totalLocalBytes > maxTotalAssetBytes) {
      throw new CasePackageError(
        'E_ASSET_TOO_LARGE',
        `Case package local assets exceed the ${maxTotalAssetBytes}-byte total limit.`,
        loaded.assetsRoot,
      )
    }
    assets.push(verified)
  }
  const packageDigest = hashCanonical({
    privateIr: result.ir.integrity.privateIr,
    localization: localization.digest,
    localAssets: assets
      .filter((asset) => asset.descriptor.source.kind === 'local')
      .map((asset) => ({
        id: asset.descriptor.id,
        digest: asset.descriptor.integrity.digest,
        sizeBytes: asset.sizeBytes,
      })),
  })
  const kernelDigest = compileToKernelIR(result.ir).digest

  const localizedPublicManifests = Object.fromEntries(
    localization.locales.map((locale) => [
      locale,
      localizePublicCaseManifest(result.publicManifest!, localization, locale).manifest,
    ]),
  )
  const canonicalLocalizedPublicManifestJson = Object.fromEntries(
    Object.entries(localizedPublicManifests).map(([locale, manifest]) => [
      locale,
      canonicalLocalizedManifest(manifest),
    ]),
  )
  const defaultPublicManifest = localizedPublicManifests[localization.defaultLocale]!

  return {
    ...loaded,
    result: {
      ok: true,
      diagnostics: result.diagnostics,
      ir: result.ir,
      publicManifest: defaultPublicManifest,
      canonicalIrJson: result.canonicalIrJson,
      canonicalPublicManifestJson:
        canonicalLocalizedPublicManifestJson[localization.defaultLocale]!,
    },
    assets,
    localization,
    localizedPublicManifests,
    canonicalLocalizedPublicManifestJson,
    kernelDigest,
    packageDigest,
  }
}

/**
 * Creates the host-only delivery resolver. The caller must derive `handle`
 * from the current session projection and provide an authorization predicate;
 * an arbitrary asset id is intentionally insufficient.
 */
function createAssetSourceResolver(
  compiled: CompiledCasePackage,
  authorize: AssetAuthorizer,
): { resolve(context: AssetAuthorizationContext): HostAssetDelivery } {
  const assets = new Map(compiled.assets.map((asset) => [asset.descriptor.id, asset]))
  const unauthorized = (): CasePackageError => new CasePackageError(
    'E_ASSET_UNAUTHORIZED',
    'The requested asset is not available to this session.',
  )
  return Object.freeze({
    resolve(context: AssetAuthorizationContext): HostAssetDelivery {
      const { handle } = context
      if (
        context.caseId !== compiled.result.ir.case.id ||
        context.caseVersion !== compiled.result.ir.case.version ||
        context.caseDigest !== compiled.kernelDigest
      ) {
        throw unauthorized()
      }
      // Ask the session/projection boundary before consulting private package
      // metadata. Unknown and locked IDs must be indistinguishable to callers.
      if (!authorize(context)) throw unauthorized()
      const asset = assets.get(handle.id)
      if (!asset) throw unauthorized()
      const { descriptor } = asset
      if (
        descriptor.handle.kind !== handle.kind ||
        descriptor.handle.mimeType !== handle.mimeType
      ) {
        throw unauthorized()
      }
      if (descriptor.source.kind === 'local') {
        if (!asset.absolutePath || asset.sizeBytes === undefined) {
          throw new CasePackageError('E_ASSET_MISSING', `Local asset '${handle.id}' was not verified.`)
        }
        return {
          kind: 'local-file',
          assetKind: descriptor.kind,
          absolutePath: asset.absolutePath,
          mimeType: descriptor.mimeType,
          digest: descriptor.integrity.digest,
          sizeBytes: asset.sizeBytes,
        }
      }
      if (descriptor.source.kind === 'https') {
        return {
          kind: 'https',
          assetKind: descriptor.kind,
          url: descriptor.source.url,
          mimeType: descriptor.mimeType,
          digest: descriptor.integrity.digest,
        }
      }
      return {
        kind: 'provider',
        assetKind: descriptor.kind,
        provider: descriptor.source.provider,
        ref: descriptor.source.ref,
        mimeType: descriptor.mimeType,
        digest: descriptor.integrity.digest,
      }
    },
  })
}

function bytesStartWith(value: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((byte, index) => value[index] === byte)
}

function ascii(value: Uint8Array, start: number, length: number): string {
  return new TextDecoder('ascii').decode(value.slice(start, start + length))
}

function assertAssetContentPolicy(
  delivery: HostAssetDelivery,
  preview: Uint8Array,
  svgBytes: Uint8Array | undefined,
): void {
  if (delivery.mimeType === 'image/svg+xml') {
    if (!svgBytes) throw new CasePackageError('E_ASSET_CONTENT', 'SVG payload was not retained.')
    assertSafeSvg(svgBytes, 'external/provider SVG payload')
    return
  }
  const invalid = (() => {
    switch (delivery.mimeType) {
      case 'image/png': return !bytesStartWith(preview, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      case 'image/jpeg': return !bytesStartWith(preview, [0xff, 0xd8, 0xff])
      case 'image/gif': return !['GIF87a', 'GIF89a'].includes(ascii(preview, 0, 6))
      case 'image/webp': return ascii(preview, 0, 4) !== 'RIFF' || ascii(preview, 8, 4) !== 'WEBP'
      case 'audio/wav':
      case 'audio/wave':
      case 'audio/x-wav': return ascii(preview, 0, 4) !== 'RIFF' || ascii(preview, 8, 4) !== 'WAVE'
      case 'audio/flac': return ascii(preview, 0, 4) !== 'fLaC'
      case 'audio/mpeg':
        return ascii(preview, 0, 3) !== 'ID3' &&
          !(preview[0] === 0xff && preview[1] !== undefined && (preview[1] & 0xe0) === 0xe0)
      case 'application/pdf': return ascii(preview, 0, 5) !== '%PDF-'
      case 'application/zip':
      case 'application/epub+zip':
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return !bytesStartWith(preview, [0x50, 0x4b])
      case 'video/webm':
      case 'audio/webm': return !bytesStartWith(preview, [0x1a, 0x45, 0xdf, 0xa3])
      case 'video/mp4':
      case 'audio/mp4':
      case 'video/quicktime': return ascii(preview, 4, 4) !== 'ftyp'
      case 'image/avif':
        return ascii(preview, 4, 4) !== 'ftyp' || !['avif', 'avis'].includes(ascii(preview, 8, 4))
      default: return false
    }
  })()
  if (invalid) {
    throw new CasePackageError(
      'E_ASSET_CONTENT',
      `Delivered bytes do not match declared MIME type '${delivery.mimeType}'.`,
    )
  }
}

async function writePayloadChunk(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null)
    if (bytesWritten <= 0) throw new Error('Failed to make progress while caching an asset.')
    offset += bytesWritten
  }
}

async function nextPayloadChunk(
  iterator: AsyncIterator<Uint8Array>,
  signal?: AbortSignal,
): Promise<IteratorResult<Uint8Array>> {
  if (!signal) return iterator.next()
  if (signal.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')

  return new Promise<IteratorResult<Uint8Array>>((resolveNext, rejectNext) => {
    let settled = false
    const onAbort = (): void => {
      if (settled) return
      settled = true
      // Do not await a potentially buggy adapter's cleanup hook. The caller
      // must be released immediately when its deadline/cancellation fires.
      void iterator.return?.().catch(() => undefined)
      rejectNext(signal.reason ?? new Error('Asset delivery aborted.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void iterator.next().then(
      (result) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolveNext(result)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        rejectNext(error)
      },
    )
  })
}

/**
 * Consumes an adapter stream exactly once, validates it, and atomically
 * promotes those same bytes into an engine-owned content-addressed cache.
 */
export async function materializeAssetPayload(
  delivery: HostAssetDelivery,
  payload: AssetPayload,
  cacheDirectory: string,
  maxBytes = DEFAULT_MAX_ASSET_BYTES,
  signal?: AbortSignal,
): Promise<VerifiedAssetFile> {
  const limit = positiveLimit(maxBytes, DEFAULT_MAX_ASSET_BYTES, 'maxBytes')
  const cacheRoot = resolve(cacheDirectory)
  await mkdir(cacheRoot, { recursive: true })
  const cacheStats = await lstat(cacheRoot)
  if (cacheStats.isSymbolicLink() || !cacheStats.isDirectory()) {
    throw new CasePackageError(
      'E_CASE_OUTPUT_PATH',
      `Asset cache must be a real directory, not a symlink: ${cacheRoot}`,
      cacheRoot,
    )
  }
  const finalPath = join(cacheRoot, `${delivery.digest}.asset`)
  const temporaryPath = join(cacheRoot, `.${delivery.digest}.${process.pid}.${randomUUID()}.tmp`)
  const hash = createHash('sha256')
  let sizeBytes = 0
  const previewChunks: Uint8Array[] = []
  let previewBytes = 0
  const svgChunks: Uint8Array[] = []
  const chunks: AsyncIterable<Uint8Array> = payload instanceof Uint8Array
    ? (async function* () { yield payload })()
    : payload
  const iterator = chunks[Symbol.asyncIterator]()
  let iteratorFinished = false
  let output: FileHandle | undefined
  try {
    output = await open(temporaryPath, 'wx', 0o600)
    while (true) {
      const result = await nextPayloadChunk(iterator, signal)
      if (result.done) {
        iteratorFinished = true
        break
      }
      const chunk = result.value
      if (!(chunk instanceof Uint8Array)) {
        throw new CasePackageError('E_ASSET_CONTENT', 'Asset adapter yielded a non-binary chunk.')
      }
      sizeBytes += chunk.byteLength
      if (sizeBytes > limit) {
        throw new CasePackageError('E_ASSET_TOO_LARGE', `Asset payload exceeds ${limit} bytes.`)
      }
      if (delivery.mimeType === 'image/svg+xml') {
        if (sizeBytes > MAX_SVG_BYTES) {
          throw new CasePackageError(
            'E_ASSET_TOO_LARGE',
            `SVG payload exceeds ${MAX_SVG_BYTES} bytes.`,
          )
        }
        svgChunks.push(chunk)
      }
      if (previewBytes < 512) {
        const retained = chunk.slice(0, Math.min(chunk.byteLength, 512 - previewBytes))
        previewChunks.push(retained)
        previewBytes += retained.byteLength
      }
      hash.update(chunk)
      if (signal?.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')
      await writePayloadChunk(output, chunk)
    }
    const digest = hash.digest('hex')
    if (digest !== delivery.digest) {
      throw new CasePackageError(
        'E_ASSET_DIGEST',
        `Delivered asset digest mismatch: expected ${delivery.digest}, got ${digest}.`,
      )
    }
    assertAssetContentPolicy(
      delivery,
      Buffer.concat(previewChunks),
      delivery.mimeType === 'image/svg+xml' ? Buffer.concat(svgChunks) : undefined,
    )
    await output.sync()
    await output.chmod(0o444)
    await output.close()
    output = undefined
    await rename(temporaryPath, finalPath)
    return {
      kind: 'verified-file',
      assetKind: delivery.assetKind,
      absolutePath: finalPath,
      mimeType: delivery.mimeType,
      digest,
      sizeBytes,
      contentDisposition:
        delivery.assetKind === 'document' || delivery.assetKind === 'file' ? 'attachment' : 'inline',
      acceptRanges: true,
    }
  } finally {
    if (!iteratorFinished) void iterator.return?.().catch(() => undefined)
    await output?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
  }
}

async function* localAssetPayload(
  delivery: Extract<HostAssetDelivery, { kind: 'local-file' }>,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  const handle = await open(delivery.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size !== delivery.sizeBytes) {
      throw new CasePackageError('E_ASSET_CONTENT', 'Local asset changed before delivery.')
    }
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      if (signal?.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')
      yield chunk as Uint8Array
    }
  } finally {
    await handle.close()
  }
}

async function* sanitizedExternalPayload(
  payload: AssetPayload,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  try {
    if (payload instanceof Uint8Array) {
      yield payload
      return
    }
    for await (const chunk of payload) {
      if (signal?.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')
      yield chunk
    }
  } catch (cause) {
    if (signal?.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')
    throw new CasePackageError(
      'E_ASSET_ADAPTER',
      'The trusted asset adapter stream failed while loading content.',
      undefined,
      cause,
    )
  }
}

function safeGatewayFailure(
  source: HostAssetDelivery,
  cause: unknown,
): CasePackageError {
  if (cause instanceof CasePackageError) {
    const safe = (() => {
      switch (cause.code) {
        case 'E_ASSET_TOO_LARGE':
          return { code: cause.code, message: 'Asset content exceeds the configured size limit.' }
        case 'E_ASSET_DIGEST':
          return { code: cause.code, message: 'Asset content failed its pinned integrity check.' }
        case 'E_ASSET_UNSAFE_SVG':
          return { code: cause.code, message: 'SVG content failed the static-content policy.' }
        case 'E_ASSET_ADAPTER':
          return { code: cause.code, message: 'The trusted asset adapter could not deliver content.' }
        case 'E_ASSET_CONTENT':
          return { code: cause.code, message: 'Asset content failed validation.' }
        default:
          return undefined
      }
    })()
    if (safe) return new CasePackageError(safe.code, safe.message, undefined, cause)
  }
  return new CasePackageError(
    source.kind === 'local-file' ? 'E_ASSET_CONTENT' : 'E_ASSET_ADAPTER',
    source.kind === 'local-file'
      ? 'The requested local asset could not be read safely.'
      : 'The trusted asset adapter could not deliver content.',
    undefined,
    cause,
  )
}

/**
 * Authoritative delivery boundary. It accepts only a handle present in the
 * current runtime projection, resolves a capability-locked source through an
 * injected adapter, and returns one immutable verified cache file.
 */
export function createCaseAssetGateway(
  compiled: CompiledCasePackage,
  options: CaseAssetGatewayOptions,
): CaseAssetGateway {
  const resolver = createAssetSourceResolver(compiled, options.authorize)
  const maxBytes = positiveLimit(options.maxAssetBytes, DEFAULT_MAX_ASSET_BYTES, 'maxAssetBytes')
  const verified = new Map<string, VerifiedAssetFile>()
  const inFlight = new Map<string, Promise<VerifiedAssetFile>>()
  return Object.freeze({
    async deliver(
      context: AssetAuthorizationContext,
      signal?: AbortSignal,
    ): Promise<VerifiedAssetFile> {
      if (signal?.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')
      // Resolve on every request so a cached asset never bypasses the current
      // host authorization decision.
      const source = resolver.resolve(context)
      const cacheKey = [
        context.caseDigest,
        context.handle.id,
        context.handle.kind,
        context.handle.mimeType,
        source.digest,
      ].join('\u0000')
      const cached = verified.get(cacheKey)
      if (cached) return cached
      const existing = inFlight.get(cacheKey)
      if (existing) return existing

      const materialization = (async (): Promise<VerifiedAssetFile> => {
        let payload: AssetPayload
        if (source.kind === 'local-file') {
          payload = localAssetPayload(source, signal)
        } else {
          const adapter = source.kind === 'https'
            ? options.httpsAdapter
            : options.providerAdapters?.[source.provider]
          if (!adapter) {
            throw new CasePackageError(
              'E_ASSET_ADAPTER',
              'No trusted asset adapter is installed for the requested content.',
            )
          }
          try {
            payload = sanitizedExternalPayload(await adapter.load(source, context, signal), signal)
          } catch (cause) {
            if (signal?.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')
            throw new CasePackageError(
              'E_ASSET_ADAPTER',
              'The trusted asset adapter could not load the requested content.',
              undefined,
              cause,
            )
          }
        }
        try {
          return await materializeAssetPayload(
            source,
            payload,
            options.cacheDirectory,
            maxBytes,
            signal,
          )
        } catch (cause) {
          if (signal?.aborted) throw signal.reason ?? new Error('Asset delivery aborted.')
          throw safeGatewayFailure(source, cause)
        }
      })()
      inFlight.set(cacheKey, materialization)
      try {
        const result = await materialization
        verified.set(cacheKey, result)
        return result
      } finally {
        if (inFlight.get(cacheKey) === materialization) inFlight.delete(cacheKey)
      }
    },
  })
}
