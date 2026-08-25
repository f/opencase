import type { ShellPublicCaseManifest } from './shell/manifest-workspace'
import { browserCaseLibrary } from './browser-host/case-library'
import { BrowserCaseImportError } from './browser-host/import-errors'

export type CaseLibraryImportKind = 'github' | 'yaml'

export interface CaseLibraryDiagnostic {
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly line?: number
  readonly column?: number
}

export type CaseLibrarySource =
  | { readonly kind: 'built-in'; readonly label?: string }
  | {
      readonly kind: CaseLibraryImportKind
      readonly url: string
      readonly revision?: string
    }

export interface CaseCatalogEntry {
  readonly id: string
  readonly version: string
  readonly caseDigest: string
  readonly packageDigest: string
  readonly title: string
  readonly synopsis: string
  readonly durationMinutes: number
  readonly locale: string
  readonly defaultLocale: string
  readonly locales: readonly string[]
  readonly source: CaseLibrarySource
  readonly verification: {
    readonly level: 'built-in' | 'conformance-passed' | 'compiler-and-smoke'
    readonly authoredTests: number
  }
  readonly manifest: ShellPublicCaseManifest
}

export interface CaseCatalogResponse {
  readonly schema: 'detective-case-catalog/v1'
  readonly cases: readonly CaseCatalogEntry[]
}

export interface CaseImportResponse {
  readonly schema: 'detective-case-import/v1'
  readonly entry: CaseCatalogEntry
}

export class CaseLibraryClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly diagnostics: readonly CaseLibraryDiagnostic[] = [],
  ) {
    super(message)
    this.name = 'CaseLibraryClientError'
  }
}

function safeDiagnostics(value: unknown): readonly CaseLibraryDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const item = candidate as Record<string, unknown>
    if (typeof item.code !== 'string' || typeof item.message !== 'string') return []
    return [{
      code: item.code,
      message: item.message,
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      ...(typeof item.line === 'number' ? { line: item.line } : {}),
      ...(typeof item.column === 'number' ? { column: item.column } : {}),
    }]
  })
}

function clientError(error: unknown): CaseLibraryClientError {
  if (error instanceof CaseLibraryClientError) return error
  if (error instanceof BrowserCaseImportError) {
    return new CaseLibraryClientError(
      error.code,
      error.message,
      error.status,
      safeDiagnostics(error.diagnostics),
    )
  }
  if (error instanceof Error) {
    return new CaseLibraryClientError('case-library-request-failed', error.message, 500)
  }
  return new CaseLibraryClientError(
    'case-library-request-failed',
    'The browser case library could not complete the request.',
    500,
  )
}

export const caseLibraryClient = Object.freeze({
  async list(locale: string, signal?: AbortSignal): Promise<CaseCatalogResponse> {
    try {
      return await browserCaseLibrary.list(locale, signal)
    } catch (error) {
      throw clientError(error)
    }
  },

  async importCase(
    request: { readonly kind: CaseLibraryImportKind; readonly url: string },
    locale: string,
    signal?: AbortSignal,
  ): Promise<CaseImportResponse> {
    try {
      return await browserCaseLibrary.importCase(request, locale, signal)
    } catch (error) {
      throw clientError(error)
    }
  },
})
