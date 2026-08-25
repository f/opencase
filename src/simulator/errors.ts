export type CaseTestDocumentErrorCode =
  | 'E_CASE_TEST_DIRECTORY'
  | 'E_CASE_TEST_ENTRY'
  | 'E_CASE_TEST_LIMIT'
  | 'E_CASE_TEST_READ'
  | 'E_CASE_TEST_UTF8'
  | 'E_CASE_TEST_YAML'
  | 'E_CASE_TEST_SCHEMA'
  | 'E_CASE_TEST_IDENTITY'
  | 'E_CASE_TEST_REFERENCE'

export class CaseTestDocumentError extends Error {
  constructor(
    readonly code: CaseTestDocumentErrorCode,
    message: string,
    readonly sourceFile?: string,
    readonly path?: string,
  ) {
    super(message)
    this.name = 'CaseTestDocumentError'
  }
}
