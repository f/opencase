import type { CompiledCasePackage } from '../../src/case-package'

export type CaseImportRequest =
  | { readonly kind: 'github'; readonly url: string }
  | { readonly kind: 'yaml'; readonly url: string }

export interface RemoteLoadOptions {
  readonly maxBytes: number
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

export interface RemoteLoadResponse {
  readonly url: string
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
}

/** Injectable so imports can be tested without reaching the public network. */
export interface CaseImportRemoteLoader {
  load(url: string, options: RemoteLoadOptions): Promise<RemoteLoadResponse>
}

export interface CaseImportDiagnostic {
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly line?: number
  readonly column?: number
}

export interface CaseImportProvenance {
  readonly kind: CaseImportRequest['kind']
  /** Display-safe URL. Query credentials and fragments are never persisted. */
  readonly url: string
  /** Exact Git commit for GitHub imports. */
  readonly revision?: string
  /** Package-relative repository folder, when applicable. */
  readonly packagePath?: string
}

export type CaseVerificationLevel = 'conformance-passed' | 'compiler-and-smoke'

export interface PublicCaseLibraryEntry {
  readonly schema: 'detective-case-library-entry/v1'
  readonly installationId: string
  readonly caseId: string
  readonly caseVersion: string
  readonly caseDigest: string
  readonly packageDigest: string
  readonly title: string
  readonly synopsis: string
  readonly durationMinutes: number
  readonly defaultLocale: string
  readonly locales: readonly string[]
  readonly source: {
    readonly kind: CaseImportRequest['kind']
    readonly url: string
    readonly revision?: string
  }
  readonly verification: {
    readonly level: CaseVerificationLevel
    readonly authoredTests: number
    readonly testSuiteDigest?: string
  }
  readonly installedAt: string
}

export interface InstalledCaseLibraryRecord extends PublicCaseLibraryEntry {
  readonly bundleDigest: string
  readonly packagePath: string
  readonly provenance: CaseImportProvenance
}

export interface ImportedCase {
  readonly entry: PublicCaseLibraryEntry
  readonly compiled: CompiledCasePackage
}

export type CaseImportErrorCode =
  | 'invalid-import-request'
  | 'unsafe-import-url'
  | 'remote-import-failed'
  | 'remote-import-too-large'
  | 'github-url-unsupported'
  | 'github-ref-not-found'
  | 'github-case-not-found'
  | 'github-package-invalid'
  | 'direct-yaml-invalid'
  | 'direct-yaml-assets-unsupported'
  | 'direct-yaml-i18n-unsupported'
  | 'case-validation-failed'
  | 'case-tests-failed'
  | 'case-version-conflict'
  | 'case-library-storage'

export class CaseImportError extends Error {
  constructor(
    readonly code: CaseImportErrorCode,
    message: string,
    readonly diagnostics: readonly CaseImportDiagnostic[] = [],
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'CaseImportError'
  }
}
