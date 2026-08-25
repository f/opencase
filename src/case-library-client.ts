import type { ShellPublicCaseManifest } from './shell/manifest-workspace'

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

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: unknown
    readonly message?: unknown
    readonly diagnostics?: unknown
  }
}

function diagnostics(value: unknown): readonly CaseLibraryDiagnostic[] {
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

async function responseJson<T>(response: Response): Promise<T> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new CaseLibraryClientError(
      'invalid-host-response',
      'The local detective host returned invalid JSON.',
      response.status,
    )
  }
  if (!response.ok) {
    const envelope = value as ErrorEnvelope
    throw new CaseLibraryClientError(
      typeof envelope.error?.code === 'string' ? envelope.error.code : 'case-library-request-failed',
      typeof envelope.error?.message === 'string'
        ? envelope.error.message
        : `The local detective host rejected the request (${response.status}).`,
      response.status,
      diagnostics(envelope.error?.diagnostics),
    )
  }
  return value as T
}

export const caseLibraryClient = Object.freeze({
  async list(locale: string, signal?: AbortSignal): Promise<CaseCatalogResponse> {
    const query = new URLSearchParams({ locale })
    const response = await fetch(`/api/case-library?${query.toString()}`, {
      headers: { accept: 'application/json' },
      signal,
    })
    return responseJson<CaseCatalogResponse>(response)
  },

  async importCase(
    request: { readonly kind: CaseLibraryImportKind; readonly url: string },
    locale: string,
    signal?: AbortSignal,
  ): Promise<CaseImportResponse> {
    const response = await fetch('/api/case-library/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...request, locale }),
      signal,
    })
    return responseJson<CaseImportResponse>(response)
  },
})
