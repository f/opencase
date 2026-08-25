import { afterEach, describe, expect, it, vi } from 'vitest'

import { gitBlobSha1 } from '../compiler/digests'
import { loadGithubCasePackage } from './github-loader'

const commit = 'a'.repeat(40)
const rootTree = 'b'.repeat(40)
const assetTree = 'c'.repeat(40)
const i18nTree = 'd'.repeat(40)
const testsTree = 'e'.repeat(40)

function remoteResponse(url: string, body: BodyInit, init: ResponseInit = {}): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(url: string, value: unknown, status = 200): Response {
  return remoteResponse(url, JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function rootEntries(source: Uint8Array, sourceSize = source.byteLength): unknown[] {
  return [
    {
      name: 'case.yml', path: 'case-folder/case.yml', type: 'file',
      sha: gitBlobSha1(source), size: sourceSize,
    },
    { name: 'assets', path: 'case-folder/assets', type: 'dir', sha: assetTree, size: 0 },
    { name: 'i18n', path: 'case-folder/i18n', type: 'dir', sha: i18nTree, size: 0 },
    { name: 'tests', path: 'case-folder/tests', type: 'dir', sha: testsTree, size: 0 },
  ]
}

describe('GitHub case package loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('pins a folder URL to a commit and verifies every downloaded Git blob', async () => {
    const source = new TextEncoder().encode('schema: case-source/v0.1\n')
    const tinyImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = String(request)
      if (url.includes(`/commits/${commit}`)) {
        return jsonResponse(url, { sha: commit, commit: { tree: { sha: rootTree } } })
      }
      if (url.includes(`/contents/case-folder?ref=${commit}`)) {
        return jsonResponse(url, rootEntries(source))
      }
      if (url.includes(`/git/trees/${assetTree}`)) {
        return jsonResponse(url, {
          truncated: false,
          tree: [{
            path: 'tiny.png', type: 'blob', mode: '100644',
            sha: gitBlobSha1(tinyImage), size: tinyImage.byteLength,
          }],
        })
      }
      if (url.includes('/git/trees/')) {
        return jsonResponse(url, { truncated: false, tree: [] })
      }
      if (url.includes(`raw.githubusercontent.com/acme/cases/${commit}/case-folder/case.yml`)) {
        return remoteResponse(url, source.slice().buffer)
      }
      if (url.includes(`raw.githubusercontent.com/acme/cases/${commit}/case-folder/assets/tiny.png`)) {
        return remoteResponse(url, tinyImage.slice().buffer)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await loadGithubCasePackage(
      `https://github.com/acme/cases/tree/${commit}/case-folder`,
    )

    expect(loaded.files).toEqual([
      { path: 'case.yml', bytes: source },
      { path: 'assets/tiny.png', bytes: tinyImage },
    ])
    expect(loaded.directories).toEqual(['assets', 'i18n', 'tests'])
    expect(loaded.provenance).toMatchObject({
      kind: 'github',
      revision: commit,
      packagePath: 'case-folder',
    })
    expect(fetchMock.mock.calls.some(([request]) =>
      String(request).includes(`/${commit}/case-folder/case.yml`),
    )).toBe(true)
  })

  it('rejects an oversized case.yml before downloading package bytes', async () => {
    const source = new TextEncoder().encode('small placeholder')
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = String(request)
      if (url.includes(`/commits/${commit}`)) {
        return jsonResponse(url, { sha: commit, commit: { tree: { sha: rootTree } } })
      }
      if (url.includes(`/contents/case-folder?ref=${commit}`)) {
        return jsonResponse(url, rootEntries(source, 2 * 1024 * 1024 + 1))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadGithubCasePackage(
      `https://github.com/acme/cases/tree/${commit}/case-folder`,
    )).rejects.toMatchObject({ code: 'remote-import-too-large', status: 413 })
    expect(fetchMock.mock.calls.some(([request]) =>
      String(request).includes('raw.githubusercontent.com'),
    )).toBe(false)
  })
})
