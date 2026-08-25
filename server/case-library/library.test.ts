import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadDemoCaseRegistry } from '../demo-host/registry'
import { createCaseLibrary } from './library'
import type {
  CaseImportRemoteLoader,
  RemoteLoadOptions,
  RemoteLoadResponse,
} from './types'

const roots: string[] = []
const githubCommit = 'a'.repeat(40)

function response(url: string, value: unknown, status = 200): RemoteLoadResponse {
  const body = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : new TextEncoder().encode(JSON.stringify(value))
  return {
    url,
    status,
    headers: { 'content-type': 'application/json' },
    body,
  }
}

class MapRemoteLoader implements CaseImportRemoteLoader {
  readonly requests: string[] = []

  constructor(readonly values: ReadonlyMap<string, RemoteLoadResponse>) {}

  async load(url: string, options: RemoteLoadOptions): Promise<RemoteLoadResponse> {
    this.requests.push(url)
    const value = this.values.get(url)
    if (!value && url.includes('/commits/')) return response(url, {}, 404)
    if (!value) throw new Error(`Unexpected remote request: ${url}`)
    if (value.body.byteLength > options.maxBytes) throw new Error('Fake response exceeded requested cap.')
    return value
  }
}

function blobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}

async function githubLoader(options: {
  symlinkAsset?: boolean
  failingAuthoredTest?: boolean
} = {}): Promise<MapRemoteLoader> {
  const exampleRoot = resolve(import.meta.dirname, '..', '..', 'examples', 'cases', 'first-clue')
  const authoredTest = await readFile(join(exampleRoot, 'tests', 'observe_and_deduce.yml'))
  const sourceFiles = new Map<string, Uint8Array>([
    ['case.yml', await readFile(join(exampleRoot, 'case.yml'))],
    ['assets/README.md', await readFile(join(exampleRoot, 'assets', 'README.md'))],
    ['i18n/en.yml', await readFile(join(exampleRoot, 'i18n', 'en.yml'))],
    ['tests/observe_and_deduce.yml', options.failingAuthoredTest
      ? Buffer.from(
          authoredTest.toString('utf8').replace('mug_photo: observed', 'mug_photo: available'),
        )
      : authoredTest],
  ])
  const base = 'https://api.github.com/repos/acme/cases'
  const values = new Map<string, RemoteLoadResponse>()
  values.set(`${base}/`, response(`${base}/`, { default_branch: 'main' }))
  values.set(`${base}/commits/main%2Ffirst-clue`, response(`${base}/commits/main%2Ffirst-clue`, {}, 404))
  values.set(`${base}/commits/main`, response(`${base}/commits/main`, { sha: githubCommit }))

  const fileEntry = (relativePath: string) => {
    const bytes = sourceFiles.get(relativePath)!
    const sha = blobSha(bytes)
    const repositoryPath = `first-clue/${relativePath}`
    values.set(`${base}/git/blobs/${sha}`, response(`${base}/git/blobs/${sha}`, {
      encoding: 'base64',
      content: Buffer.from(bytes).toString('base64'),
    }))
    return {
      name: relativePath.split('/').at(-1),
      path: repositoryPath,
      type: 'file',
      sha,
      size: bytes.byteLength,
      git_url: `${base}/git/blobs/${sha}`,
    }
  }
  const directoryEntry = (name: string) => ({
    name,
    path: `first-clue/${name}`,
    type: 'dir',
    sha: createHash('sha1').update(name).digest('hex'),
    size: 0,
  })
  values.set(`${base}/contents?ref=${githubCommit}`, response(
    `${base}/contents?ref=${githubCommit}`,
    [{
      name: 'first-clue',
      path: 'first-clue',
      type: 'dir',
      sha: createHash('sha1').update('first-clue-root').digest('hex'),
      size: 0,
    }],
  ))
  values.set(`${base}/contents/first-clue?ref=${githubCommit}`, response(
    `${base}/contents/first-clue?ref=${githubCommit}`,
    [fileEntry('case.yml'), directoryEntry('assets'), directoryEntry('i18n'), directoryEntry('tests')],
  ))
  values.set(`${base}/contents/first-clue/assets?ref=${githubCommit}`, response(
    `${base}/contents/first-clue/assets?ref=${githubCommit}`,
    options.symlinkAsset
      ? [{
          name: 'escape.png',
          path: 'first-clue/assets/escape.png',
          type: 'symlink',
          sha: 'b'.repeat(40),
          size: 0,
        }]
      : [fileEntry('assets/README.md')],
  ))
  values.set(`${base}/contents/first-clue/i18n?ref=${githubCommit}`, response(
    `${base}/contents/first-clue/i18n?ref=${githubCommit}`,
    [fileEntry('i18n/en.yml')],
  ))
  values.set(`${base}/contents/first-clue/tests?ref=${githubCommit}`, response(
    `${base}/contents/first-clue/tests?ref=${githubCommit}`,
    [fileEntry('tests/observe_and_deduce.yml')],
  ))
  return new MapRemoteLoader(values)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('host case library imports', () => {
  it('imports a direct no-asset YAML into an immutable user library and live registry', async () => {
    const sourcePath = resolve(import.meta.dirname, '..', '..', 'examples', 'cases', 'first-clue', 'case.yml')
    const sourceText = await readFile(sourcePath, 'utf8')
    const directUrl = 'https://cases.example/first-clue.yml'
    const loader = new MapRemoteLoader(new Map([
      [directUrl, {
        ...response(directUrl, sourceText),
        headers: { 'content-type': 'application/yaml' },
      }],
    ]))
    const root = await mkdtemp(join(tmpdir(), 'case-library-'))
    roots.push(root)
    const registry = await loadDemoCaseRegistry({
      casesDirectory: resolve(import.meta.dirname, '..', '..', 'cases'),
    })
    const library = createCaseLibrary({ rootDirectory: root, remoteLoader: loader, registry })

    const imported = await library.importCase('user-one', { kind: 'yaml', url: directUrl })

    expect(imported.entry).toMatchObject({
      caseId: 'examples.first-clue',
      caseVersion: '0.1.0',
      defaultLocale: 'en',
      locales: ['en'],
      source: { kind: 'yaml', url: directUrl },
      verification: { level: 'compiler-and-smoke', authoredTests: 0 },
    })
    expect(imported.entry).not.toHaveProperty('packagePath')
    expect(imported.entry).not.toHaveProperty('bundleDigest')
    expect(registry.get('examples.first-clue', '0.1.0').compiled.kernelDigest)
      .toBe(imported.compiled.kernelDigest)
    await expect(library.list('user-one')).resolves.toHaveLength(1)
    await expect(library.list('another-user')).resolves.toEqual([])
    await expect(library.resolve('user-one', imported.entry.installationId)).resolves.toMatchObject({
      entry: { caseId: 'examples.first-clue' },
    })

    const repeated = await library.importCase('user-one', { kind: 'yaml', url: directUrl })
    expect(repeated.entry.installationId).toBe(imported.entry.installationId)

    const restartedRegistry = await loadDemoCaseRegistry({
      casesDirectory: resolve(import.meta.dirname, '..', '..', 'cases'),
    })
    const restartedLibrary = createCaseLibrary({ rootDirectory: root, registry: restartedRegistry })
    await expect(restartedLibrary.registerInstalled('user-one')).resolves.toMatchObject([
      { installationId: imported.entry.installationId, caseId: 'examples.first-clue' },
    ])
    expect(restartedRegistry.get('examples.first-clue', '0.1.0').compiled.kernelDigest)
      .toBe(imported.compiled.kernelDigest)
  }, 30_000)

  it('imports a GitHub folder through the Contents API, pins its commit and runs authored tests', async () => {
    const loader = await githubLoader()
    const root = await mkdtemp(join(tmpdir(), 'case-library-github-'))
    roots.push(root)
    const library = createCaseLibrary({ rootDirectory: root, remoteLoader: loader })

    const imported = await library.importCase('github-user', {
      kind: 'github',
      url: 'https://github.com/acme/cases/tree/main/first-clue',
    })

    expect(imported.entry).toMatchObject({
      caseId: 'examples.first-clue',
      source: {
        kind: 'github',
        revision: githubCommit,
      },
      verification: {
        level: 'conformance-passed',
        authoredTests: 1,
      },
    })
    expect(imported.entry.verification.testSuiteDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(loader.requests).toContain(`https://api.github.com/repos/acme/cases/commits/main`)
    expect(loader.requests.every((url) => !url.includes('raw.githubusercontent.com'))).toBe(true)
  }, 30_000)

  it.each([
    'https://github.com/acme/cases',
    'https://github.com/acme/cases/blob/main/first-clue/case.yml',
  ])('resolves GitHub repository and case.yml URLs (%s)', async (url) => {
    const root = await mkdtemp(join(tmpdir(), 'case-library-github-shape-'))
    roots.push(root)
    const library = createCaseLibrary({ rootDirectory: root, remoteLoader: await githubLoader() })

    const imported = await library.importCase('github-user', { kind: 'github', url })

    expect(imported.entry).toMatchObject({
      caseId: 'examples.first-clue',
      source: { revision: githubCommit },
      verification: { level: 'conformance-passed' },
    })
  }, 30_000)

  it('rejects direct YAML assets and translation references before installation', async () => {
    const sourcePath = resolve(import.meta.dirname, '..', '..', 'examples', 'cases', 'first-clue', 'case.yml')
    const sourceText = await readFile(sourcePath, 'utf8')
    const assetSource = sourceText.replace(
      'cast:',
      `assets:\n  clue_image:\n    kind: image\n    source: {local: assets/clue.png}\n    mime_type: image/png\n    visibility: public\n    integrity: {sha256: ${'a'.repeat(64)}}\n\ncast:`,
    )
    const localizedSource = sourceText.replace('title: The First Clue', 'title: {$text: case.title}')
    const root = await mkdtemp(join(tmpdir(), 'case-library-reject-'))
    roots.push(root)
    const library = createCaseLibrary({
      rootDirectory: root,
      remoteLoader: new MapRemoteLoader(new Map([
        ['https://cases.example/assets.yml', {
          ...response('https://cases.example/assets.yml', assetSource),
          headers: { 'content-type': 'text/yaml' },
        }],
        ['https://cases.example/i18n.yml', {
          ...response('https://cases.example/i18n.yml', localizedSource),
          headers: { 'content-type': 'text/yaml' },
        }],
      ])),
    })

    await expect(library.importCase('user', {
      kind: 'yaml',
      url: 'https://cases.example/assets.yml',
    })).rejects.toMatchObject({ code: 'direct-yaml-assets-unsupported' })
    await expect(library.importCase('user', {
      kind: 'yaml',
      url: 'https://cases.example/i18n.yml',
    })).rejects.toMatchObject({ code: 'direct-yaml-i18n-unsupported' })
    await expect(library.list('user')).resolves.toEqual([])
  })

  it('enforces the direct YAML byte cap even when an injected loader misbehaves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'case-library-oversized-yaml-'))
    roots.push(root)
    const library = createCaseLibrary({
      rootDirectory: root,
      remoteLoader: {
        async load(url) {
          return {
            url,
            status: 200,
            headers: { 'content-type': 'application/yaml' },
            body: new Uint8Array(2 * 1024 * 1024 + 1),
          }
        },
      },
    })

    await expect(library.importCase('user', {
      kind: 'yaml',
      url: 'https://cases.example/oversized.yml',
    })).rejects.toMatchObject({ code: 'remote-import-too-large' })
    await expect(library.list('user')).resolves.toEqual([])
  })

  it('rejects GitHub symlinks and leaves no installed record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'case-library-symlink-'))
    roots.push(root)
    const library = createCaseLibrary({ rootDirectory: root, remoteLoader: await githubLoader({ symlinkAsset: true }) })

    await expect(library.importCase('user', {
      kind: 'github',
      url: 'https://github.com/acme/cases/tree/main/first-clue',
    })).rejects.toMatchObject({ code: 'github-package-invalid' })
    await expect(library.list('user')).resolves.toEqual([])
  })

  it('rejects a GitHub package whose authored conformance test fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'case-library-failing-test-'))
    roots.push(root)
    const library = createCaseLibrary({
      rootDirectory: root,
      remoteLoader: await githubLoader({ failingAuthoredTest: true }),
    })

    await expect(library.importCase('user', {
      kind: 'github',
      url: 'https://github.com/acme/cases/tree/main/first-clue',
    })).rejects.toMatchObject({
      code: 'case-tests-failed',
      diagnostics: [expect.objectContaining({ code: 'E_CASE_TEST_FAILED' })],
    })
    await expect(library.list('user')).resolves.toEqual([])
  })
})
