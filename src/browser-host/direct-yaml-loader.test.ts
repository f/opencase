import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrowserCaseImportError } from './import-errors'
import { loadDirectYamlCase } from './direct-yaml-loader'

const TWO_MEBIBYTES = 2 * 1024 * 1024

function responseWithUrl(
  body: BodyInit | null,
  init: ResponseInit = {},
  url = 'https://cases.example/tiny.yml',
): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'url', { configurable: true, value: url })
  return response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('direct YAML case loading', () => {
  it('downloads one case.yml, strips query parameters from provenance, and declares no remote assets', async () => {
    const source = 'schema: detective-case/v0.3\ncase:\n  id: tiny\n'
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(responseWithUrl(source, {
      headers: { 'content-type': 'application/yaml; charset=utf-8' },
    }, 'https://cases.example/tiny.yml?download=1'))
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await loadDirectYamlCase('https://cases.example/tiny.yml?download=1')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cases.example/tiny.yml?download=1',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        headers: { accept: 'application/yaml, text/yaml, text/plain; q=0.9' },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(loaded.directories).toEqual(['assets', 'i18n', 'tests'])
    expect(loaded.provenance).toEqual({
      kind: 'yaml',
      url: 'https://cases.example/tiny.yml',
    })
    expect(loaded.files).toHaveLength(1)
    expect(loaded.files[0]?.path).toBe('case.yml')
    expect(new TextDecoder().decode(loaded.files[0]?.bytes)).toBe(source)
  })

  it('rejects a response with an unsupported media type', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(responseWithUrl('{}', {
      headers: { 'content-type': 'application/json' },
    })))

    await expect(loadDirectYamlCase('https://cases.example/tiny.yml')).rejects.toMatchObject({
      name: 'BrowserCaseImportError',
      code: 'direct-yaml-invalid',
      status: 400,
    })
  })

  it('rejects an oversized response from its declared content length', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(responseWithUrl('small', {
      headers: {
        'content-length': String(TWO_MEBIBYTES + 1),
        'content-type': 'text/yaml',
      },
    })))

    await expect(loadDirectYamlCase('https://cases.example/tiny.yml')).rejects.toMatchObject({
      name: 'BrowserCaseImportError',
      code: 'remote-import-too-large',
      status: 413,
    })
  })

  it('enforces the size limit while streaming when content length is absent', async () => {
    const oversized = new Uint8Array(TWO_MEBIBYTES + 1)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(responseWithUrl(oversized, {
      headers: { 'content-type': 'text/plain' },
    })))

    await expect(loadDirectYamlCase('https://cases.example/tiny.yml')).rejects.toMatchObject({
      name: 'BrowserCaseImportError',
      code: 'remote-import-too-large',
      status: 413,
    })
  })

  it('reports browser CORS or network failures without hiding the category', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))

    const failure = await loadDirectYamlCase('https://cases.example/tiny.yml').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(BrowserCaseImportError)
    expect(failure).toMatchObject({
      code: 'remote-import-cors-or-network',
      status: 502,
      message: expect.stringContaining('CORS'),
    })
  })

  it('rejects private or non-HTTPS URLs before making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadDirectYamlCase('http://127.0.0.1/case.yml')).rejects.toMatchObject({
      code: 'unsafe-import-url',
      status: 400,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
