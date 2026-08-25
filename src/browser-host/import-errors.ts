export interface BrowserImportDiagnostic {
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly line?: number
  readonly column?: number
}

export class BrowserCaseImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: readonly BrowserImportDiagnostic[] = [],
    readonly status = 400,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BrowserCaseImportError'
  }
}

export function importError(
  code: string,
  message: string,
  status = 400,
  cause?: unknown,
): BrowserCaseImportError {
  return new BrowserCaseImportError(
    code,
    message,
    [],
    status,
    cause === undefined ? undefined : { cause },
  )
}
