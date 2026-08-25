import { afterEach, describe, expect, it, vi } from 'vitest'

import { hashCanonical } from '../compiler'
import type { CaseKernelIR } from '../kernel'
import type { ShellPublicCaseManifest } from '../shell/manifest-workspace'
import {
  browserCaseIdentity,
  type BrowserCaseDatabase,
  type StoredBrowserCasePackage,
} from './case-database'
import { createBrowserCaseLibrary } from './case-library'
import type { StaticCaseRuntimeBundle, StaticCaseRuntimeBundleUnsigned } from './static-bundle'

const indexUrl = 'https://game.example/dedektif/generated/cases.json'
const caseId = 'test.browser-static'
const caseVersion = '1.0.0'
const kernelDigest = 'kernel-browser-static'
const packageDigest = 'package-browser-static'

function manifest(): ShellPublicCaseManifest {
  return {
    schema: 'case-public/v0.2',
    case: {
      id: caseId,
      version: caseVersion,
      title: 'Static Browser Case',
      durationMinutes: 8,
      synopsis: 'A Pages-relative fixture.',
      locale: 'en',
    },
    cast: {},
    assets: [],
    opening: { evidence: [] },
    integrity: { manifest: 'manifest-browser-static' },
  }
}

function runtimeBundle(): StaticCaseRuntimeBundle {
  const kernelIr = {
    schemaVersion: 'kernel/v1',
    id: caseId,
    version: caseVersion,
    digest: kernelDigest,
    capabilities: [],
  } satisfies CaseKernelIR
  const unsigned: StaticCaseRuntimeBundleUnsigned = {
    schema: 'case-static-runtime/v1',
    case: {
      id: caseId,
      version: caseVersion,
      kernelDigest,
      packageDigest,
      defaultLocale: 'en',
    },
    kernelIr,
    presentations: { en: {} as StaticCaseRuntimeBundle['presentations'][string] },
    assets: [{
      id: 'photo',
      kind: 'image',
      mimeType: 'image/png',
      sha256: 'asset-browser-static',
      url: './assets/photo.png',
    }],
  }
  return {
    ...unsigned,
    integrity: { algorithm: 'sha256', bundle: hashCanonical(unsigned) },
  }
}

function staticIndex(bundle: StaticCaseRuntimeBundle): unknown {
  return {
    schema: 'case-public-index/v0.3',
    packages: [{
      slug: 'browser-static',
      caseId,
      caseVersion,
      caseDigest: kernelDigest,
      packageDigest,
      manifestUrl: './browser-static.en.json',
      defaultLocale: 'en',
      locales: [{ locale: 'en', manifestUrl: './browser-static.en.json' }],
      runtimeUrl: './browser-static.runtime.json',
      runtimeDigest: bundle.integrity.bundle,
    }],
  }
}

function remoteJson(url: string, value: unknown): Response {
  const response = new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function remoteText(url: string, value: string, contentType = 'text/yaml'): Response {
  const response = new Response(value, {
    status: 200,
    headers: { 'content-type': contentType },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function emptyDatabase(overrides: Partial<BrowserCaseDatabase> = {}): BrowserCaseDatabase {
  return {
    listPackages: async () => [],
    getPackage: async () => undefined,
    getAssets: async () => [],
    install: async () => 'installed',
    delete: async () => undefined,
    close: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser case library', () => {
  it('loads Pages-relative index, manifest, runtime, and asset URLs', async () => {
    const bundle = runtimeBundle()
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = String(request)
      if (url === indexUrl) return remoteJson(url, staticIndex(bundle))
      if (url === 'https://game.example/dedektif/generated/browser-static.en.json') {
        return remoteJson(url, manifest())
      }
      if (url === 'https://game.example/dedektif/generated/browser-static.runtime.json') {
        return remoteJson(url, bundle)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const library = createBrowserCaseLibrary({
      database: emptyDatabase({
        listPackages: async () => { throw new Error('IndexedDB is blocked.') },
        getPackage: async () => { throw new Error('IndexedDB is blocked.') },
      }),
      indexUrl,
    })

    await expect(library.list('en')).resolves.toMatchObject({
      schema: 'detective-case-catalog/v1',
      cases: [{ id: caseId, title: 'Static Browser Case', source: { kind: 'built-in' } }],
    })
    const loaded = await library.loadRuntime(caseId, caseVersion)
    expect(loaded.bundle).toEqual(bundle)
    expect(loaded.assetUrls).toEqual({
      photo: 'https://game.example/dedektif/generated/assets/photo.png',
    })
  })

  it('rejects a built-in runtime whose canonical integrity does not match the index', async () => {
    const bundle = runtimeBundle()
    const tampered = {
      ...bundle,
      case: { ...bundle.case, packageDigest: 'tampered-package' },
    }
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = String(request)
      if (url === indexUrl) return remoteJson(url, staticIndex(bundle))
      if (url.endsWith('/browser-static.runtime.json')) return remoteJson(url, tampered)
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const library = createBrowserCaseLibrary({ database: emptyDatabase(), indexUrl })

    await expect(library.loadRuntime(caseId, caseVersion)).rejects.toThrow(
      'Static case runtime identity does not match the catalog.',
    )
  })

  it('prefers an installed package and returns revocable object URLs for its assets', async () => {
    const bundle = runtimeBundle()
    const identity = browserCaseIdentity(caseId, caseVersion)
    const stored = {
      schema: 'detective-browser-case/v1',
      identity,
      caseId,
      caseVersion,
      caseDigest: kernelDigest,
      packageDigest,
      bundleDigest: 'source-package-files',
      title: 'Installed Browser Case',
      synopsis: 'Stored locally.',
      durationMinutes: 8,
      defaultLocale: 'en',
      locales: ['en'],
      manifests: { en: manifest() },
      bundle,
      provenance: { kind: 'yaml', url: 'https://cases.example/installed.yml' },
      verification: { level: 'compiler-and-smoke', authoredTests: 0 },
      installedAt: '2026-08-25T00:00:00.000Z',
    } satisfies StoredBrowserCasePackage
    const database = emptyDatabase({
      getPackage: async () => stored,
      getAssets: async () => [{
        key: `${identity}\u0000${kernelDigest}\u0000photo`,
        identity,
        caseDigest: kernelDigest,
        assetId: 'photo',
        kind: 'image',
        mimeType: 'image/png',
        sha256: 'asset-browser-static',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      }],
    })
    const createObjectURL = vi.fn(() => 'blob:https://game.example/imported-photo')
    const revokeObjectURL = vi.fn()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const library = createBrowserCaseLibrary({
      database,
      indexUrl,
      createObjectURL,
      revokeObjectURL,
    })

    await expect(library.loadRuntime(caseId, caseVersion)).resolves.toEqual({
      bundle,
      assetUrls: { photo: 'blob:https://game.example/imported-photo' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledOnce()

    library.close()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:https://game.example/imported-photo')
  })

  it('loads the browser compiler on demand and installs a direct YAML case', async () => {
    const yamlUrl = 'https://cases.example/browser-import.yml'
    const source = `schema: case-source/v0.1
case:
  id: test.browser-import-flow
  version: 0.1.0
  title: Browser Import Flow
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "09:00"}
  synopsis: A tiny import integration fixture.
use: [investigation@1, artifacts@1]
cast: {client: {name: Client, role: client, client: true}}
places: {room: Quiet room}
things: {note: {type: document, name: Note}}
truth:
  events: {arrival: {at: "08:58", type: note.arrived, actor: client, object: note, place: room}}
  facts: {}
perspectives: {}
opening:
  call: {from: client, text: Please inspect the note.}
  grants: [note_record]
  starts: []
evidence:
  note_record: {tool: document, at: start, reports: {place: room}}
deductions:
  locate_note: {conclude: {object: note, location: room}, prove: {any: [[note_record.place]]}}
flags: []
reactions: []
deadlines: {}
objectives: {locate: {supported: locate_note}}
outcomes: {located: {title: Located, priority: 100, require: [locate]}}
`
    const install = vi.fn(async (): Promise<'installed'> => 'installed')
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = String(request)
      if (url === yamlUrl) return remoteText(url, source)
      if (url === indexUrl) {
        return remoteJson(url, { schema: 'case-public-index/v0.3', packages: [] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const library = createBrowserCaseLibrary({
      database: emptyDatabase({ install }),
      indexUrl,
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    })

    await expect(library.importCase({ kind: 'yaml', url: yamlUrl }, 'en')).resolves.toMatchObject({
      schema: 'detective-case-import/v1',
      entry: {
        id: 'test.browser-import-flow',
        version: '0.1.0',
        source: { kind: 'yaml', url: yamlUrl },
        verification: { level: 'compiler-and-smoke', authoredTests: 0 },
      },
    })
    expect(install).toHaveBeenCalledOnce()
  })
})
