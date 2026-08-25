import { afterEach, describe, expect, it, vi } from 'vitest'

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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('case library client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('requests the catalog with the selected locale and caller signal', async () => {
    const payload: CaseCatalogResponse = {
      schema: 'detective-case-catalog/v1',
      cases: [catalogEntry()],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)
    const abortController = new AbortController()

    await expect(caseLibraryClient.list('tr-TR', abortController.signal)).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/api/case-library?locale=tr-TR', {
      headers: { accept: 'application/json' },
      signal: abortController.signal,
    })
  })

  it('posts an import kind, URL, and locale as JSON', async () => {
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload, 201))
    vi.stubGlobal('fetch', fetchMock)
    const abortController = new AbortController()

    await expect(caseLibraryClient.importCase(
      { kind: 'github', url: 'https://github.com/example/detective-case' },
      'en',
      abortController.signal,
    )).resolves.toEqual(payload)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/api/case-library/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        kind: 'github',
        url: 'https://github.com/example/detective-case',
        locale: 'en',
      }),
      signal: abortController.signal,
    })
  })

  it('keeps only player-safe diagnostic fields from rejected imports', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: {
        code: 'case-import-invalid',
        message: 'The case could not be installed.',
        stack: '/private/server/path/importer.ts:42',
        diagnostics: [{
          code: 'E_SCHEMA',
          message: 'case.id is required',
          path: 'case.yml',
          line: 4,
          column: 3,
          sourceExcerpt: 'private authoring source',
          internalCause: { token: 'do-not-leak' },
        }, null, { code: 'E_IGNORED' }],
      },
    }, 422))
    vi.stubGlobal('fetch', fetchMock)

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
    expect(JSON.stringify(caught)).not.toContain('do-not-leak')
    expect(JSON.stringify(caught)).not.toContain('/private/server/path')
  })

  it('turns invalid JSON into a stable host-response error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('<!doctype html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(caseLibraryClient.list('en')).rejects.toMatchObject({
      name: 'CaseLibraryClientError',
      code: 'invalid-host-response',
      message: 'The local detective host returned invalid JSON.',
      status: 502,
      diagnostics: [],
    })
  })
})
