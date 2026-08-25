import type {
  AssetHandle,
  AssetKind,
  CompiledAsset,
  CompileResult,
  PublicCaseManifest,
} from '../compiler'

export interface LoadedCasePackage {
  packageRoot: string
  packageSlug: string
  sourcePath: string
  assetsRoot: string
  testsRoot: string
  i18nRoot: string
  sourceText: string
}

export interface VerifiedPackageAsset {
  descriptor: CompiledAsset
  /** Host-only. Never put this object in a player projection. */
  absolutePath?: string
  sizeBytes?: number
  device?: number
  inode?: number
  modifiedAtMs?: number
}

export interface CompileCasePackageOptions {
  /** Maximum bytes for one local asset. Defaults to 512 MiB. */
  maxAssetBytes?: number
  /** Maximum bytes across all local assets. Defaults to 2 GiB. */
  maxTotalAssetBytes?: number
}

export interface CompiledCasePackage extends LoadedCasePackage {
  result: CompileResult & {
    ok: true
    ir: NonNullable<CompileResult['ir']>
    publicManifest: PublicCaseManifest
    canonicalIrJson: string
    canonicalPublicManifestJson: string
  }
  assets: VerifiedPackageAsset[]
  localization: CaseLocalizationBundle
  localizedPublicManifests: Readonly<Record<string, PublicCaseManifest>>
  canonicalLocalizedPublicManifestJson: Readonly<Record<string, string>>
  /** Exact digest exposed by the authoritative kernel session and save lock. */
  kernelDigest: string
  packageDigest: string
}

export interface CaseTranslationCatalog {
  schema: 'case-i18n/v0.1'
  case: { id: string; version: string }
  locale: string
  messages: Readonly<Record<string, string>>
  sourcePath: string
  digest: string
}

export interface CaseLocalizationBundle {
  defaultLocale: string
  locales: readonly string[]
  catalogs: Readonly<Record<string, CaseTranslationCatalog>>
  referenceKeys: readonly string[]
  digest: string
}

export interface LocalizedManifestSelection {
  requestedLocale: string
  locale: string
  manifest: PublicCaseManifest
}

export type HostAssetDelivery =
  | {
      kind: 'local-file'
      assetKind: AssetKind
      absolutePath: string
      mimeType: string
      digest: string
      sizeBytes: number
    }
  | { kind: 'https'; assetKind: AssetKind; url: string; mimeType: string; digest: string }
  | {
      kind: 'provider'
      assetKind: AssetKind
      provider: string
      ref: string
      mimeType: string
      digest: string
    }

export interface AssetAuthorizationContext {
  caseId: string
  caseVersion: string
  /** Final kernel IR digest stored with the authoritative session/save. */
  caseDigest: string
  handle: AssetHandle
  /**
   * Optional host-only, single-delivery authorization capture. It is never
   * part of a player projection or public asset URL.
   */
  authorizationGrant?: string
}

export type AssetAuthorizer = (context: AssetAuthorizationContext) => boolean

export type AssetPayload = Uint8Array | AsyncIterable<Uint8Array>

export interface VerifiedAssetFile {
  kind: 'verified-file'
  assetKind: AssetKind
  absolutePath: string
  mimeType: string
  digest: string
  sizeBytes: number
  contentDisposition: 'inline' | 'attachment'
  acceptRanges: true
}

export type ExternalHostAssetDelivery = Extract<HostAssetDelivery, { kind: 'https' | 'provider' }>

export interface AssetSourceAdapter {
  load(
    source: ExternalHostAssetDelivery,
    context: AssetAuthorizationContext,
    signal?: AbortSignal,
  ): Promise<AssetPayload>
}

export interface CaseAssetGatewayOptions {
  cacheDirectory: string
  authorize: AssetAuthorizer
  /** Trusted fetcher that must pin public DNS on every redirect and enforce timeouts. */
  httpsAdapter?: AssetSourceAdapter
  /** Trusted adapters named by capability-locked provider IDs. */
  providerAdapters?: Readonly<Record<string, AssetSourceAdapter>>
  maxAssetBytes?: number
}

export interface CaseAssetGateway {
  deliver(context: AssetAuthorizationContext, signal?: AbortSignal): Promise<VerifiedAssetFile>
}

export type PublicAssetDelivery =
  | { kind: 'hosted'; url: string }
  | { kind: 'resolver'; url: string }

export interface PublicAssetDeliveryEntry {
  id: string
  kind: AssetKind
  mimeType: string
  sha256: string
  delivery: PublicAssetDelivery
}

export interface PublicAssetDeliveryManifest {
  schema: 'case-asset-delivery/v0.1'
  caseId: string
  caseVersion: string
  caseDigest: string
  publicManifestDigest: string
  assets: PublicAssetDeliveryEntry[]
  integrity: {
    algorithm: 'sha256'
    manifest: string
  }
}

export interface PublicCasePackageBuild {
  compiled: CompiledCasePackage
  caseManifestPath: string
  assetManifestPath: string
  assetManifest: PublicAssetDeliveryManifest
  copiedAssetPaths: string[]
  localizedManifestPaths: Readonly<Record<string, string>>
}

export type CasePackageErrorCode =
  | 'E_CASE_PACKAGE_PATH'
  | 'E_CASE_SOURCE_MISSING'
  | 'E_CASE_SOURCE_INVALID'
  | 'E_CASE_PACKAGE_ASSETS'
  | 'E_CASE_PACKAGE_TESTS'
  | 'E_CASE_PACKAGE_I18N'
  | 'E_CASE_OUTPUT_PATH'
  | 'E_ASSET_MISSING'
  | 'E_ASSET_NOT_FILE'
  | 'E_ASSET_SYMLINK'
  | 'E_ASSET_ESCAPE'
  | 'E_ASSET_DIGEST'
  | 'E_ASSET_TOO_LARGE'
  | 'E_ASSET_CONTENT'
  | 'E_ASSET_ADAPTER'
  | 'E_ASSET_UNSAFE_SVG'
  | 'E_ASSET_UNAUTHORIZED'
  | 'E_I18N_FILE'
  | 'E_I18N_YAML'
  | 'E_I18N_SCHEMA'
  | 'E_I18N_IDENTITY'
  | 'E_I18N_MISSING_MESSAGE'

export class CasePackageError extends Error {
  constructor(
    readonly code: CasePackageErrorCode,
    message: string,
    readonly path?: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'CasePackageError'
  }
}
