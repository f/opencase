import { afterEach, describe, expect, it, vi } from 'vitest'

const libraryMocks = vi.hoisted(() => ({
  list: vi.fn(),
  importCase: vi.fn(),
}))

vi.mock('./browser-host/case-library', () => ({
  browserCaseLibrary: libraryMocks,
}))

import { BrowserCaseImportError } from './browser-host/import-errors'
import {
  CaseLibraryClientError,
  caseLibraryClient,
  type CaseCatalogEntry,
  type CaseCatalogResponse,
} from './case-library-client'

function catalogEntry(): CaseCatalogEntry {
  return {
    id: 'case.seven-minutes',
    version: '1.0.0',
    caseDigest: 'sha256:case',
    packageDigest: 'sha256:package',
    title: 'Seven Minutes',
    synopsis: 'A compact investigation.',
    durationMinutes: 7,
    locale: 'en',
    defaultLocale: 'tr',
    locales: ['tr', 'en'],
    source: { kind: 'built-in' },
    verification: { level: 'built-in', authoredTests: 3 },
    manifest: {} as CaseCatalogEntry['manifest'],
  }
}

describe('case library client', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('delegates catalog loading with the selected locale and caller signal', async () => {
    const payload: CaseCatalogResponse = {
      schema: 'detective-case-catalog/v1',
      cases: [catalogEntry()],
    }
    libraryMocks.list.mockResolvedValueOnce(payload)
    const abortController = new AbortController()

    await expect(caseLibraryClient.list('tr-TR', abortController.signal)).resolves.toEqual(payload)
    expect(libraryMocks.list).toHaveBeenCalledWith('tr-TR', abortController.signal)
  })

  it('delegates an import kind, URL, locale, and caller signal', async () => {
    const entry = {
      ...catalogEntry(),
      source: {
        kind: 'github' as const,
        url: 'https://github.com/example/detective-case',
        revision: 'main',
      },
      verification: { level: 'conformance-passed' as const, authoredTests: 4 },
    }
    const payload = { schema: 'detective-case-import/v1' as const, entry }
    libraryMocks.importCase.mockResolvedValueOnce(payload)
    const request = { kind: 'github' as const, url: 'https://github.com/example/detective-case' }
    const abortController = new AbortController()

    await expect(caseLibraryClient.importCase(
      request,
      'en',
      abortController.signal,
    )).resolves.toEqual(payload)
    expect(libraryMocks.importCase).toHaveBeenCalledWith(request, 'en', abortController.signal)
  })

  it('maps browser import errors to the stable, player-safe client error', async () => {
    libraryMocks.importCase.mockRejectedValueOnce(new BrowserCaseImportError(
      'case-import-invalid',
      'The case could not be installed.',
      [{
        code: 'E_SCHEMA',
        message: 'case.id is required',
        path: 'case.yml',
        line: 4,
        column: 3,
        sourceExcerpt: 'private authoring source',
      } as never],
      422,
    ))

    let caught: unknown
    try {
      await caseLibraryClient.importCase(
        { kind: 'yaml', url: 'https://example.test/case.yml' },
        'tr',
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CaseLibraryClientError)
    expect(caught).toMatchObject({
      name: 'CaseLibraryClientError',
      code: 'case-import-invalid',
      message: 'The case could not be installed.',
      status: 422,
      diagnostics: [{
        code: 'E_SCHEMA',
        message: 'case.id is required',
        path: 'case.yml',
        line: 4,
        column: 3,
      }],
    })
    expect(JSON.stringify(caught)).not.toContain('private authoring source')
  })

  it('maps unexpected failures to one stable client error', async () => {
    libraryMocks.list.mockRejectedValueOnce(new Error('Static case index is unavailable.'))

    await expect(caseLibraryClient.list('en')).rejects.toMatchObject({
      name: 'CaseLibraryClientError',
      code: 'case-library-request-failed',
      message: 'Static case index is unavailable.',
      status: 500,
      diagnostics: [],
    })
  })
})
