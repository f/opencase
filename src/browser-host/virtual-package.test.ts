import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compileCasePackage } from '../case-package/package'
import { hashCanonical } from '../compiler'
import { sha256Bytes } from '../compiler/digests'
import type { BrowserPackageFile } from './import-types'
import { compileBrowserCasePackage } from './virtual-package'

const temporaryRoots: string[] = []

const literalCaseSource = `schema: case-source/v0.1
case:
  id: test.browser-literal
  version: 0.1.0
  title: Browser Literal
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "09:00"}
  synopsis: A tiny browser import.
use: [investigation@1, artifacts@1]
cast:
  client: {name: Client, role: client, client: true}
places: {room: Quiet room}
things: {envelope: {type: object, name: Envelope}}
truth:
  events: {arrival: {at: "08:58", type: object.arrived, actor: client, object: envelope, place: room}}
  facts: {}
perspectives:
  client: {knows: [], believes: [], says: {initial: []}}
opening:
  call: {from: client, text: Please inspect the envelope.}
  grants: [envelope_record]
  starts: []
evidence:
  envelope_record: {tool: document, at: start, reports: {object: envelope, place: room}}
deductions:
  envelope_in_room: {conclude: {object: envelope, location: room}, prove: {any: [[envelope_record.place]]}}
flags: []
reactions: []
deadlines: {}
objectives: {locate: {supported: envelope_in_room}}
outcomes: {located: {title: Located, priority: 100, require: [locate]}}
`

function assetCaseSource(digest: string): string {
  return literalCaseSource
    .replace('id: test.browser-literal', 'id: test.browser-package')
    .replace('title: Browser Literal', 'title: Browser Package')
    .replace('A tiny browser import.', 'A package import with one image.')
    .replace(
      'cast:',
      `assets:
  envelope-photo:
    kind: image
    source: {local: assets/envelope.png}
    mime_type: image/png
    visibility: public
    integrity: {sha256: ${digest}}
cast:`,
    )
    .replace(
      'envelope_record: {tool: document, at: start, reports:',
      'envelope_record: {tool: image, at: start, assets: [envelope-photo], reports:',
    )
}

const authoredTest = `schema: case-test/v0.1
case: {id: test.browser-package, version: 0.1.0}
scenario:
  id: inspect_envelope
  perspective: detective
  steps:
    - detective.observe: envelope_record
      expect:
        result: {status: accepted}
        state:
          evidence:
            envelope_record: {status: observed, assets: [envelope-photo]}
          observations: {envelope_record.place: room}
    - detective.deduce: envelope_in_room
      expect:
        result: {status: accepted}
        state: {deductions: {envelope_in_room: supported}, outcome: located}
`

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('browser case package compiler', () => {
  it('compiles a literal, asset-free YAML file into a self-contained runtime', async () => {
    const compiled = await compileBrowserCasePackage({
      files: [{ path: 'case.yml', bytes: new TextEncoder().encode(literalCaseSource) }],
      directories: ['assets', 'i18n', 'tests'],
      provenance: { kind: 'yaml', url: 'https://cases.example/browser-literal.yml' },
    })

    expect(compiled.bundle.case).toMatchObject({
      id: 'test.browser-literal', version: '0.1.0', defaultLocale: 'en',
    })
    expect(compiled.bundle.kernelIr.digest).toBe(compiled.bundle.case.kernelDigest)
    expect(compiled.bundle.assets).toEqual([])
    expect(compiled.verification).toEqual({ level: 'compiler-and-smoke', authoredTests: 0 })
    const { integrity, ...unsigned } = compiled.bundle
    expect(integrity.bundle).toBe(hashCanonical(unsigned))
  })

  it('matches Node package identity while validating assets, i18n, and authored tests', async () => {
    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const source = assetCaseSource(sha256Bytes(image))
    const catalog = `schema: case-i18n/v0.1\ncase: {id: test.browser-package, version: 0.1.0}\nlocale: en\nmessages: {}\n`
    const files: readonly BrowserPackageFile[] = [
      { path: 'case.yml', bytes: new TextEncoder().encode(source) },
      { path: 'assets/envelope.png', bytes: image },
      { path: 'i18n/en.yml', bytes: new TextEncoder().encode(catalog) },
      { path: 'tests/inspect_envelope.yml', bytes: new TextEncoder().encode(authoredTest) },
    ]
    const browser = await compileBrowserCasePackage({
      files,
      directories: ['assets', 'i18n', 'tests'],
      provenance: {
        kind: 'github', url: 'https://github.com/example/cases/tree/main/browser-package',
        revision: '0123456789abcdef0123456789abcdef01234567', packagePath: 'browser-package',
      },
    })

    const root = await mkdtemp(join(tmpdir(), 'opencase-browser-import-'))
    temporaryRoots.push(root)
    const packageRoot = join(root, 'browser-package')
    await Promise.all(['assets', 'i18n', 'tests'].map((directory) =>
      mkdir(join(packageRoot, directory), { recursive: true }),
    ))
    await Promise.all(files.map((file) => writeFile(join(packageRoot, file.path), file.bytes)))
    const node = await compileCasePackage(packageRoot)

    expect(browser.bundle.case.kernelDigest).toBe(node.kernelDigest)
    expect(browser.bundle.case.packageDigest).toBe(node.packageDigest)
    expect(browser.bundle.assets).toEqual([{
      id: 'envelope-photo', kind: 'image', mimeType: 'image/png',
      sha256: sha256Bytes(image), url: 'assets/envelope-photo',
    }])
    expect(browser.verification).toMatchObject({ level: 'conformance-passed', authoredTests: 1 })
  })

  it('rejects asset declarations in direct YAML imports before compilation', async () => {
    const source = `schema: case-source/v0.1\nassets:\n  photo: {}\n`
    await expect(compileBrowserCasePackage({
      files: [{ path: 'case.yml', bytes: new TextEncoder().encode(source) }],
      directories: ['assets', 'i18n', 'tests'],
      provenance: { kind: 'yaml', url: 'https://cases.example/unsafe.yml' },
    })).rejects.toMatchObject({ code: 'direct-yaml-assets-unsupported' })
  })
})
