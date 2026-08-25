import { appUrl } from '../app-url'
import type {
  CaseCatalogEntry,
  CaseCatalogResponse,
  CaseImportResponse,
  CaseLibraryImportKind,
} from '../case-library-client'
import { hashCanonical } from '../compiler/canonical'
import type { ShellPublicCaseManifest } from '../shell/manifest-workspace'

import {
  browserCaseAssetKey,
  browserCaseIdentity,
  openBrowserCaseDatabase,
  type BrowserCaseDatabase,
  type OpenBrowserCaseDatabaseOptions,
  type StoredBrowserCasePackage,
} from './case-database'
import { BrowserCaseImportError, importError } from './import-errors'
import type { BrowserCaseRuntimeRepository, LoadedBrowserCaseRuntime } from './runtime-repository'
import type { StaticCaseRuntimeBundle } from './static-bundle'

interface StaticCaseIndexPackage {
  readonly slug: string
  readonly caseId: string
  readonly caseVersion: string
  readonly caseDigest: string
  readonly packageDigest: string
  readonly manifestUrl: string
  readonly defaultLocale: string
  readonly locales: readonly {
    readonly locale: string
    readonly manifestUrl: string
  }[]
  readonly runtimeUrl: string
  readonly runtimeDigest: string
}

interface StaticCaseIndex {
  readonly schema: 'case-public-index/v0.3'
  readonly packages: readonly StaticCaseIndexPackage[]
}

interface LoadedStaticIndex {
  readonly index: StaticCaseIndex
  readonly url: string
}

function callerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

export interface BrowserCaseLibrary extends BrowserCaseRuntimeRepository {
  list(locale: string, signal?: AbortSignal): Promise<CaseCatalogResponse>
  importCase(
    request: { readonly kind: CaseLibraryImportKind; readonly url: string },
    locale: string,
    signal?: AbortSignal,
  ): Promise<CaseImportResponse>
  close(): void
}

export interface CreateBrowserCaseLibraryOptions {
  readonly database?: Promise<BrowserCaseDatabase> | BrowserCaseDatabase
  readonly databaseOptions?: OpenBrowserCaseDatabaseOptions
  readonly indexUrl?: string
  readonly now?: () => Date
  readonly createObjectURL?: (blob: Blob) => string
  readonly revokeObjectURL?: (url: string) => void
}

function selectedLocale(
  requested: string,
  available: readonly string[],
  fallback: string,
): string {
  if (available.includes(requested)) return requested
  const base = requested.split('-')[0] ?? ''
  if (available.includes(base)) return base
  return fallback
}

function selectedManifestUrl(entry: StaticCaseIndexPackage, locale: string): string {
  const selected = selectedLocale(
    locale,
    entry.locales.map(({ locale: candidate }) => candidate),
    entry.defaultLocale,
  )
  return entry.locales.find(({ locale: candidate }) => candidate === selected)?.manifestUrl
    ?? entry.manifestUrl
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label}: ${response.status}`)
  try {
    return await response.json() as unknown
  } catch (cause) {
    throw new Error(`${label} returned invalid JSON.`, { cause })
  }
}

function assertIndex(value: unknown): StaticCaseIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Static case index is invalid.')
  }
  const input = value as Partial<StaticCaseIndex>
  if (input.schema !== 'case-public-index/v0.3' || !Array.isArray(input.packages)) {
    throw new Error('Static case index is incompatible.')
  }
  return input as StaticCaseIndex
}

function verifyRuntimeBundle(value: unknown, expected: StaticCaseIndexPackage): StaticCaseRuntimeBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Static case runtime is invalid.')
  }
  const bundle = value as StaticCaseRuntimeBundle
  if (
    bundle.schema !== 'case-static-runtime/v1' ||
    bundle.case?.id !== expected.caseId ||
    bundle.case?.version !== expected.caseVersion ||
    bundle.case?.kernelDigest !== expected.caseDigest ||
    bundle.case?.packageDigest !== expected.packageDigest ||
    bundle.case?.defaultLocale !== expected.defaultLocale ||
    bundle.kernelIr?.id !== expected.caseId ||
    bundle.kernelIr?.version !== expected.caseVersion ||
    bundle.kernelIr?.digest !== expected.caseDigest ||
    bundle.integrity?.algorithm !== 'sha256' ||
    !Array.isArray(bundle.assets) ||
    !bundle.presentations || typeof bundle.presentations !== 'object'
  ) throw new Error('Static case runtime identity does not match the catalog.')
  const { integrity: _integrity, ...unsigned } = bundle
  const actual = hashCanonical(unsigned)
  if (actual !== bundle.integrity.bundle || actual !== expected.runtimeDigest) {
    throw new Error('Static case runtime integrity check failed.')
  }
  return bundle
}

function installedManifest(entry: StoredBrowserCasePackage, requestedLocale: string): ShellPublicCaseManifest {
  const locale = selectedLocale(requestedLocale, entry.locales, entry.defaultLocale)
  return entry.manifests[locale] ?? entry.manifests[entry.defaultLocale]!
}

function installedCatalogEntry(entry: StoredBrowserCasePackage, locale: string): CaseCatalogEntry {
  const manifest = installedManifest(entry, locale)
  return {
    id: entry.caseId,
    version: entry.caseVersion,
    caseDigest: entry.caseDigest,
    packageDigest: entry.packageDigest,
    title: manifest.case.title,
    synopsis: manifest.case.synopsis,
    durationMinutes: manifest.case.durationMinutes,
    locale: manifest.case.locale ?? entry.defaultLocale,
    defaultLocale: entry.defaultLocale,
    locales: entry.locales,
    source: {
      kind: entry.provenance.kind,
      url: entry.provenance.url,
      ...(entry.provenance.revision ? { revision: entry.provenance.revision } : {}),
    },
    verification: entry.verification,
    manifest,
  }
}

function importFailure(error: unknown): BrowserCaseImportError {
  if (error instanceof BrowserCaseImportError) return error
  const candidate = error as { code?: unknown; message?: unknown; path?: unknown }
  return new BrowserCaseImportError(
    'case-validation-failed',
    typeof candidate.message === 'string' ? candidate.message : 'The imported case could not be validated.',
    typeof candidate.code === 'string'
      ? [{
          code: candidate.code,
          message: typeof candidate.message === 'string' ? candidate.message : 'Case validation failed.',
          ...(typeof candidate.path === 'string' ? { path: candidate.path } : {}),
        }]
      : [],
    400,
    error === undefined ? undefined : { cause: error },
  )
}

export function createBrowserCaseLibrary(
  options: CreateBrowserCaseLibraryOptions = {},
): BrowserCaseLibrary {
  let databasePromise: Promise<BrowserCaseDatabase> | undefined
  const database = (): Promise<BrowserCaseDatabase> => {
    databasePromise ??= options.database
      ? Promise.resolve(options.database)
      : openBrowserCaseDatabase(options.databaseOptions)
    return databasePromise
  }
  const now = options.now ?? (() => new Date())
  const objectUrl = options.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob))
  const revokeObjectUrl = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url))
  let staticIndexPromise: Promise<LoadedStaticIndex> | undefined
  const runtimeCache = new Map<string, Promise<LoadedBrowserCaseRuntime>>()
  const importedObjectUrls = new Set<string>()

  const loadStaticIndex = (signal?: AbortSignal): Promise<LoadedStaticIndex> => {
    if (!staticIndexPromise) {
      const url = options.indexUrl ?? appUrl('/generated/cases.json')
      // This request is shared across callers. A React StrictMode cleanup may
      // cancel one caller, but must not poison the cached catalog for the next.
      staticIndexPromise = fetch(url, { headers: { accept: 'application/json' } })
        .then(async (response) => ({
          index: assertIndex(await responseJson(response, 'Static case index')),
          url: response.url || url,
        }))
        .catch((error) => {
          staticIndexPromise = undefined
          throw error
        })
    }
    return callerAbort(staticIndexPromise, signal)
  }

  const builtInCatalog = async (locale: string, signal?: AbortSignal): Promise<CaseCatalogEntry[]> => {
    const loaded = await loadStaticIndex(signal)
    return Promise.all(loaded.index.packages.map(async (entry) => {
      const response = await fetch(new URL(selectedManifestUrl(entry, locale), loaded.url), { signal })
      const manifest = await responseJson(response, 'Localized case manifest') as ShellPublicCaseManifest
      return {
        id: entry.caseId,
        version: entry.caseVersion,
        caseDigest: entry.caseDigest,
        packageDigest: entry.packageDigest,
        title: manifest.case.title,
        synopsis: manifest.case.synopsis,
        durationMinutes: manifest.case.durationMinutes,
        locale: manifest.case.locale ?? entry.defaultLocale,
        defaultLocale: entry.defaultLocale,
        locales: entry.locales.map(({ locale: candidate }) => candidate),
        source: { kind: 'built-in' as const, label: 'opencase' },
        verification: { level: 'built-in' as const, authoredTests: 0 },
        manifest,
      }
    }))
  }

  const library: BrowserCaseLibrary = {
    async list(locale: string, signal?: AbortSignal): Promise<CaseCatalogResponse> {
      const builtIns = await builtInCatalog(locale, signal)
      let installed: readonly StoredBrowserCasePackage[] = []
      try {
        installed = await (await database()).listPackages()
      } catch {
        // Built-in play remains available if persistent browser storage is unavailable.
      }
      const byIdentity = new Map<string, CaseCatalogEntry>()
      for (const entry of builtIns) byIdentity.set(browserCaseIdentity(entry.id, entry.version), entry)
      for (const entry of installed) {
        const key = browserCaseIdentity(entry.caseId, entry.caseVersion)
        const builtIn = byIdentity.get(key)
        if (!builtIn || (
          builtIn.caseDigest === entry.caseDigest && builtIn.packageDigest === entry.packageDigest
        )) byIdentity.set(key, installedCatalogEntry(entry, locale))
      }
      return {
        schema: 'detective-case-catalog/v1',
        cases: [...byIdentity.values()].sort((left, right) =>
          left.title.localeCompare(right.title, locale) || left.version.localeCompare(right.version),
        ),
      }
    },

    async importCase(request, locale, signal): Promise<CaseImportResponse> {
      try {
        if (!request || (request.kind !== 'github' && request.kind !== 'yaml') || typeof request.url !== 'string') {
          throw importError('invalid-import-request', 'Import requires a GitHub or YAML URL.')
        }
        const compiler = import('./virtual-package')
        const source = request.kind === 'github'
          ? import('./github-loader').then(({ loadGithubCasePackage }) => (
              loadGithubCasePackage(request.url, signal)
            ))
          : import('./direct-yaml-loader').then(({ loadDirectYamlCase }) => (
              loadDirectYamlCase(request.url, signal)
            ))
        const [{ compileBrowserCasePackage }, files] = await Promise.all([compiler, source])
        const compiled = await compileBrowserCasePackage(files, signal)
        const identity = browserCaseIdentity(compiled.bundle.case.id, compiled.bundle.case.version)
        const defaultManifest = compiled.manifests[compiled.defaultLocale]!
        const staticIndex = await loadStaticIndex(signal)
        const builtIn = staticIndex.index.packages.find((entry) => (
          entry.caseId === compiled.bundle.case.id && entry.caseVersion === compiled.bundle.case.version
        ))
        if (builtIn && (
          builtIn.caseDigest !== compiled.bundle.case.kernelDigest ||
          builtIn.packageDigest !== compiled.bundle.case.packageDigest
        )) {
          throw importError(
            'case-version-conflict',
            `Case ${compiled.bundle.case.id}@${compiled.bundle.case.version} conflicts with a built-in case.`,
            409,
          )
        }
        const stored: StoredBrowserCasePackage = {
          schema: 'detective-browser-case/v1',
          identity,
          caseId: compiled.bundle.case.id,
          caseVersion: compiled.bundle.case.version,
          caseDigest: compiled.bundle.case.kernelDigest,
          packageDigest: compiled.bundle.case.packageDigest,
          bundleDigest: compiled.bundleDigest,
          title: defaultManifest.case.title,
          synopsis: defaultManifest.case.synopsis,
          durationMinutes: defaultManifest.case.durationMinutes,
          defaultLocale: compiled.defaultLocale,
          locales: compiled.locales,
          manifests: compiled.manifests,
          bundle: compiled.bundle,
          provenance: compiled.provenance,
          verification: compiled.verification,
          installedAt: now().toISOString(),
        }
        const caseDatabase = await database()
        try {
          await caseDatabase.install({
            package: stored,
            assets: compiled.assets.map((asset) => ({
              key: browserCaseAssetKey(identity, compiled.bundle.case.kernelDigest, asset.id),
              identity,
              caseDigest: compiled.bundle.case.kernelDigest,
              assetId: asset.id,
              kind: asset.kind,
              mimeType: asset.mimeType,
              sha256: asset.sha256,
              blob: new Blob([asset.bytes as BlobPart], { type: asset.mimeType }),
            })),
          })
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
            throw importError('case-library-storage', 'This browser does not have enough storage for the case assets.', 507, cause)
          }
          if (cause instanceof Error && cause.message.includes('already installed with different content')) {
            throw importError('case-version-conflict', cause.message, 409, cause)
          }
          throw cause
        }
        runtimeCache.delete(identity)
        return {
          schema: 'detective-case-import/v1',
          entry: installedCatalogEntry(stored, locale),
        }
      } catch (error) {
        throw importFailure(error)
      }
    },

    loadRuntime(caseId: string, caseVersion: string): Promise<LoadedBrowserCaseRuntime> {
      const identity = browserCaseIdentity(caseId, caseVersion)
      const cached = runtimeCache.get(identity)
      if (cached) return cached
      const loading = (async (): Promise<LoadedBrowserCaseRuntime> => {
        try {
          const caseDatabase = await database()
          const installed = await caseDatabase.getPackage(caseId, caseVersion)
          if (installed) {
            const assets = await caseDatabase.getAssets(installed.identity, installed.caseDigest)
            const assetUrls = Object.fromEntries(assets.map((asset) => {
              const url = objectUrl(asset.blob)
              importedObjectUrls.add(url)
              return [asset.assetId, url]
            }))
            return { bundle: installed.bundle, assetUrls }
          }
        } catch {
          // Built-in play remains available if persistent browser storage is blocked.
        }
        const loaded = await loadStaticIndex()
        const entry = loaded.index.packages.find((candidate) => (
          candidate.caseId === caseId && candidate.caseVersion === caseVersion
        ))
        if (!entry) throw new Error(`Case ${caseId}@${caseVersion} is not installed.`)
        const runtimeUrl = new URL(entry.runtimeUrl, loaded.url).toString()
        const response = await fetch(runtimeUrl, { headers: { accept: 'application/json' } })
        const bundle = verifyRuntimeBundle(await responseJson(response, 'Static case runtime'), entry)
        const assetUrls = Object.fromEntries(bundle.assets.map((asset) => [
          asset.id,
          new URL(asset.url, response.url || runtimeUrl).toString(),
        ]))
        return { bundle, assetUrls }
      })().catch((error) => {
        runtimeCache.delete(identity)
        throw error
      })
      runtimeCache.set(identity, loading)
      return loading
    },

    close(): void {
      for (const url of importedObjectUrls) revokeObjectUrl(url)
      importedObjectUrls.clear()
      runtimeCache.clear()
      if (databasePromise) {
        void databasePromise.then((caseDatabase) => caseDatabase.close()).catch(() => undefined)
      }
    },
  }
  return Object.freeze(library)
}

export const browserCaseLibrary = createBrowserCaseLibrary()
