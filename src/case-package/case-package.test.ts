import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compileCaseSource } from '../compiler'
import {
  buildPublicCasePackage,
  compileCasePackage,
  createCaseAssetGateway,
  createCasePresentationCatalog,
  materializeAssetPayload,
  negotiateCaseLocale,
} from './index'

const roots: string[] = []
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0h2v2H0z"/></svg>\n'
const privateNotes = 'host-only investigator note\n'

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function source(options: {
  audioDigest?: string
  imageDigest?: string
  imagePath?: string
} = {}): string {
  return `schema: case-source/v0.1
case:
  id: demo.assets
  version: 0.1.0
  title: Asset package
  locale: tr
  duration: 30m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: 2026-10-17, timezone: Europe/Istanbul, starts_at: "21:35"}
  synopsis: Asset boundary fixture.
use: [investigation@1, artifacts@1]
assets:
  scene_image:
    kind: image
    source: {local: ${options.imagePath ?? 'assets/scene.svg'}}
    mime_type: image/svg+xml
    visibility: public
    integrity: {sha256: ${options.imageDigest ?? digest(svg)}}
  private_notes:
    kind: document
    source: {local: assets/private.txt}
    mime_type: text/plain
    visibility: private
    integrity: {sha256: ${digest(privateNotes)}}
  locked_image:
    kind: image
    source: {local: assets/locked.svg}
    mime_type: image/svg+xml
    visibility: public
    integrity: {sha256: ${digest(svg)}}
  direct_audio:
    kind: audio
    source: {https: "https://cdn.example.test/audio.mp3?version=7"}
    mime_type: audio/mpeg
    visibility: public
    integrity: {sha256: ${options.audioDigest ?? 'a'.repeat(64)}}
  private_remote:
    kind: audio
    source: {https: "https://private.example.test/audio.mp3?token=secret-token"}
    mime_type: audio/mpeg
    visibility: private
    integrity: {sha256: ${'b'.repeat(64)}}
  provider_clip:
    kind: video
    source: {provider: signed-media, ref: "vault/tenant/key-opaque"}
    mime_type: video/mp4
    visibility: public
    integrity: {sha256: ${'c'.repeat(64)}}
cast:
  client: {name: Client, role: witness, client: true}
  suspect: {name: Suspect, role: suspect}
places: {room: Room}
things: {device: {type: device, name: Device}}
truth:
  events:
    incident: {at: "21:40", type: device.used, actor: suspect, device: device, place: room}
  facts: {}
perspectives:
  suspect: {knows: [incident], believes: [], says: {initial: []}}
opening:
  call: {from: client, text: Please investigate.}
  grants: [clue]
  starts: [timer]
evidence:
  clue:
    tool: document
    at: start
    assets: [scene_image, private_notes, direct_audio, private_remote, provider_clip]
    reports: {operator: suspect}
  locked_clue:
    tool: image
    unlock: {after: observe, ref: clue.operator}
    assets: [locked_image]
    reports: {detail: later}
deductions:
  culprit:
    conclude: {incident: incident, perpetrator: suspect}
    prove: {any: [[clue.operator]]}
flags: [done]
reactions:
  - on: {supported: culprit}
    once: true
    do: [{mark: done}]
deadlines:
  timer: {clock: wall, after: 10m, offline: pause, do: [{mark: done}]}
objectives: {solve: {supported: culprit}}
outcomes: {solved: {title: Solved, priority: 10, require: [solve]}}
`
}

function localizedSource(): string {
  return source()
    .replace('title: Asset package', 'title: {$text: case.title}')
    .replace('synopsis: Asset boundary fixture.', 'synopsis: {$text: case.synopsis}')
    .replace('text: Please investigate.', 'text: {$text: opening.call}')
    .replace('title: Solved', 'title: {$text: outcomes.solved.title}')
}

function catalog(
  locale: string,
  messages: Readonly<Record<string, string>>,
): string {
  const body = Object.entries(messages)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join('\n')
  return `schema: case-i18n/v0.1
case: {id: demo.assets, version: 0.1.0}
locale: ${locale}
messages:${body ? `\n${body}` : ' {}'}
`
}

async function fixture(sourceText = source()): Promise<string> {
  const container = await mkdtemp(join(tmpdir(), 'asset-case-'))
  roots.push(container)
  const root = join(container, 'fixture-case')
  await mkdir(join(root, 'assets'), { recursive: true })
  await mkdir(join(root, 'tests'), { recursive: true })
  await mkdir(join(root, 'i18n'), { recursive: true })
  await writeFile(join(root, 'case.yml'), sourceText, 'utf8')
  await writeFile(
    join(root, 'i18n', 'tr.yml'),
    catalog('tr', {}),
    'utf8',
  )
  await writeFile(
    join(root, 'tests', 'generic_scenario.yml'),
    `schema: case-test/v0.1
case: {id: demo.assets, version: 0.1.0}
scenario:
  id: generic_scenario
  perspective: detective
  steps:
    - expect: {state: {outcome: null}}
`,
    'utf8',
  )
  await writeFile(join(root, 'assets', 'scene.svg'), svg, 'utf8')
  await writeFile(join(root, 'assets', 'locked.svg'), svg, 'utf8')
  await writeFile(join(root, 'assets', 'private.txt'), privateNotes, 'utf8')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('portable case packages', () => {
  it('localizes only bootstrap-safe public copy and keeps opaque keys in private IR', async () => {
    const root = await fixture(localizedSource())
    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', {
      'case.title': 'Varsayılan başlık',
      'case.synopsis': 'Varsayılan özet',
      'opening.call': 'Varsayılan çağrı',
      'outcomes.solved.title': 'Gizli sonuç başlığı',
    }), 'utf8')
    await writeFile(join(root, 'i18n', 'en.yml'), catalog('en', {
      'case.title': 'Localized title',
      'opening.call': 'Localized call',
      'outcomes.solved.title': 'Private localized outcome',
    }), 'utf8')

    const output = await mkdtemp(join(tmpdir(), 'localized-output-'))
    roots.push(output)
    const built = await buildPublicCasePackage(root, output)
    const compiled = built.compiled

    expect(compiled.result.ir.case.title).toEqual({ $text: 'case.title' })
    expect(compiled.result.ir.private.outcomes[0]?.title).toEqual({
      $text: 'outcomes.solved.title',
    })
    expect(compiled.result.canonicalIrJson).not.toContain('Varsayılan başlık')
    expect(compiled.result.canonicalIrJson).not.toContain('Gizli sonuç başlığı')
    expect(JSON.stringify(compiled.localization)).toContain('Gizli sonuç başlığı')
    expect(compiled.result.publicManifest.case).toMatchObject({
      locale: 'tr',
      title: 'Varsayılan başlık',
      synopsis: 'Varsayılan özet',
    })
    expect(compiled.localizedPublicManifests.en?.case).toMatchObject({
      locale: 'en',
      title: 'Localized title',
      synopsis: 'Varsayılan özet',
    })
    const english = await readFile(built.localizedManifestPaths.en!, 'utf8')
    expect(english).toContain('Localized call')
    expect(english).not.toContain('$text')
    expect(english).not.toContain('outcomes.solved.title')
    expect(english).not.toContain('Private localized outcome')
    expect(english).not.toContain('messages')
  })

  it('resolves player-safe place names per locale while retaining stable place IDs', async () => {
    const root = await fixture(
      localizedSource().replace(
        'places: {room: Room}',
        'places: {room: {$text: places.room.name}}',
      ),
    )
    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', {
      'case.title': 'Varsayılan başlık',
      'case.synopsis': 'Varsayılan özet',
      'opening.call': 'Varsayılan çağrı',
      'outcomes.solved.title': 'Gizli sonuç başlığı',
      'places.room.name': 'Kayıt odası',
    }), 'utf8')
    await writeFile(join(root, 'i18n', 'en.yml'), catalog('en', {
      'places.room.name': 'Records room',
    }), 'utf8')

    const compiled = await compileCasePackage(root)

    expect(compiled.result.ir.entities.places.room).toEqual({
      $text: 'places.room.name',
    })
    expect(compiled.localizedPublicManifests.tr?.places).toEqual({
      room: 'Kayıt odası',
    })
    expect(compiled.localizedPublicManifests.en?.places).toEqual({
      room: 'Records room',
    })
    expect(compiled.canonicalLocalizedPublicManifestJson.en).not.toContain('$text')

    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', {
      'case.title': 'Varsayılan başlık',
      'case.synopsis': 'Varsayılan özet',
      'opening.call': 'Varsayılan çağrı',
      'outcomes.solved.title': 'Gizli sonuç başlığı',
      'places.room.name': 'Arşiv odası',
    }), 'utf8')
    const renamed = await compileCasePackage(root)
    expect(renamed.kernelDigest).toBe(compiled.kernelDigest)
    expect(renamed.packageDigest).not.toBe(compiled.packageDigest)
    expect(renamed.localizedPublicManifests.tr?.places).toEqual({
      room: 'Arşiv odası',
    })
  })

  it('keeps every translation edit outside the kernel/save digest', async () => {
    const root = await fixture(localizedSource())
    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', {
      'case.title': 'First title',
      'case.synopsis': 'First synopsis',
      'opening.call': 'First call',
      'outcomes.solved.title': 'First outcome',
    }), 'utf8')
    await writeFile(join(root, 'i18n', 'en.yml'), catalog('en', {
      'case.title': 'English first',
    }), 'utf8')
    const first = await compileCasePackage(root)

    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', {
      'case.title': 'Second title',
      'case.synopsis': 'Second synopsis',
      'opening.call': 'Second call',
      'outcomes.solved.title': 'Second outcome',
    }), 'utf8')
    await writeFile(join(root, 'i18n', 'en.yml'), catalog('en', {
      'case.title': 'English second',
    }), 'utf8')
    const second = await compileCasePackage(root)

    expect(second.kernelDigest).toBe(first.kernelDigest)
    expect(second.result.canonicalIrJson).toBe(first.result.canonicalIrJson)
    expect(second.packageDigest).not.toBe(first.packageDigest)
    expect(second.result.publicManifest.integrity.manifest).not.toBe(
      first.result.publicManifest.integrity.manifest,
    )
  })

  it('keeps private outcome copy out of bootstrap manifest digests', async () => {
    const root = await fixture(localizedSource())
    const messages = {
      'case.title': 'Title',
      'case.synopsis': 'Synopsis',
      'opening.call': 'Call',
      'outcomes.solved.title': 'First private outcome',
    }
    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', messages), 'utf8')
    const first = await compileCasePackage(root)

    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', {
      ...messages,
      'outcomes.solved.title': 'Second private outcome',
    }), 'utf8')
    const second = await compileCasePackage(root)

    expect(second.kernelDigest).toBe(first.kernelDigest)
    expect(second.packageDigest).not.toBe(first.packageDigest)
    expect(second.result.canonicalPublicManifestJson).toBe(
      first.result.canonicalPublicManifestJson,
    )
    expect(createCasePresentationCatalog(second.localization, 'tr').messages).toMatchObject({
      'outcomes.solved.title': 'Second private outcome',
    })
  })

  it('requires a real bound default catalog and complete default references', async () => {
    const missingDirectory = await fixture()
    await rm(join(missingDirectory, 'i18n'), { recursive: true, force: true })
    await expect(compileCasePackage(missingDirectory)).rejects.toMatchObject({
      code: 'E_CASE_PACKAGE_I18N',
    })

    const missingMessage = await fixture(localizedSource())
    await expect(compileCasePackage(missingMessage)).rejects.toMatchObject({
      code: 'E_I18N_MISSING_MESSAGE',
    })

    const wrongIdentity = await fixture()
    await writeFile(
      join(wrongIdentity, 'i18n', 'tr.yml'),
      catalog('tr', {}).replace('demo.assets', 'demo.somewhere-else'),
      'utf8',
    )
    await expect(compileCasePackage(wrongIdentity)).rejects.toMatchObject({
      code: 'E_I18N_IDENTITY',
    })
  })

  it('negotiates exact, base-language and default locale fallback deterministically', async () => {
    const root = await fixture(localizedSource())
    await writeFile(join(root, 'i18n', 'tr.yml'), catalog('tr', {
      'case.title': 'Başlık',
      'case.synopsis': 'Özet',
      'opening.call': 'Çağrı',
      'outcomes.solved.title': 'Sonuç',
    }), 'utf8')
    await writeFile(join(root, 'i18n', 'en.yml'), catalog('en', {
      'case.title': 'Title',
    }), 'utf8')
    const compiled = await compileCasePackage(root)

    expect(negotiateCaseLocale(compiled.localization, 'en')).toBe('en')
    expect(negotiateCaseLocale(compiled.localization, 'en-GB')).toBe('en')
    expect(negotiateCaseLocale(compiled.localization, 'de-DE')).toBe('tr')
    expect(createCasePresentationCatalog(compiled.localization, 'en-GB')).toMatchObject({
      defaultLocale: 'tr',
      locale: 'en',
      messages: {
        'case.title': 'Title',
        'case.synopsis': 'Özet',
        'outcomes.solved.title': 'Sonuç',
      },
    })
  })

  it('rejects catalog symlinks and unsafe YAML features', async () => {
    const linked = await fixture()
    const outside = join(linked, '..', 'outside-catalog.yml')
    await writeFile(outside, catalog('tr', {}), 'utf8')
    await rm(join(linked, 'i18n', 'tr.yml'))
    await symlink(outside, join(linked, 'i18n', 'tr.yml'))
    await expect(compileCasePackage(linked)).rejects.toMatchObject({ code: 'E_I18N_FILE' })

    const aliased = await fixture()
    await writeFile(
      join(aliased, 'i18n', 'tr.yml'),
      catalog('tr', {}).replace('messages: {}', 'messages: {copy: &copy value, other: *copy}'),
      'utf8',
    )
    await expect(compileCasePackage(aliased)).rejects.toMatchObject({ code: 'E_I18N_YAML' })

    const tagged = await fixture()
    await writeFile(
      join(tagged, 'i18n', 'tr.yml'),
      catalog('tr', {}).replace('messages: {}', 'messages: {case.title: !!str value}'),
      'utf8',
    )
    await expect(compileCasePackage(tagged)).rejects.toMatchObject({ code: 'E_I18N_YAML' })

    const multiDocument = await fixture()
    await writeFile(
      join(multiDocument, 'i18n', 'tr.yml'),
      `${catalog('tr', {})}---\n${catalog('tr', {})}`,
      'utf8',
    )
    await expect(compileCasePackage(multiDocument)).rejects.toMatchObject({
      code: 'E_I18N_YAML',
    })
  })

  it('verifies local assets and builds only public content-addressed delivery', async () => {
    const root = await fixture()
    const output = await mkdtemp(join(tmpdir(), 'asset-output-'))
    roots.push(output)
    const built = await buildPublicCasePackage(root, output, { publicBaseUrl: '/case-data' })

    expect(built.compiled.assets).toHaveLength(6)
    expect(built.copiedAssetPaths).toHaveLength(1)
    expect(built.copiedAssetPaths[0]).toContain(`${digest(svg)}.svg`)
    expect(await readFile(built.copiedAssetPaths[0]!, 'utf8')).toBe(svg)
    expect(await readdir(join(output, 'assets', built.compiled.packageSlug))).toEqual([
      `${digest(svg)}.svg`,
    ])

    const publicJson = await readFile(built.caseManifestPath, 'utf8')
    const deliveryJson = await readFile(built.assetManifestPath, 'utf8')
    expect(publicJson).not.toContain('assets/private.txt')
    expect(publicJson).not.toContain('secret-token')
    expect(publicJson).not.toContain('vault/tenant/key-opaque')
    expect(publicJson).not.toContain('locked_image')
    expect(publicJson).not.toContain('generic_scenario')
    expect(deliveryJson).not.toContain('private_notes')
    expect(deliveryJson).not.toContain('secret-token')
    expect(deliveryJson).not.toContain('cdn.example.test')
    expect(deliveryJson).not.toContain('signed-media')
    expect(deliveryJson).not.toContain('vault/tenant/key-opaque')
    expect(deliveryJson).not.toContain('locked_image')
    expect(deliveryJson).not.toContain('generic_scenario')
    expect(built.assetManifest.assets.map(({ id }) => id)).toEqual([
      'direct_audio',
      'provider_clip',
      'scene_image',
    ])
    expect(built.assetManifest.assets.find(({ id }) => id === 'direct_audio')?.delivery.kind).toBe(
      'resolver',
    )
    expect(built.assetManifest.assets.find(({ id }) => id === 'provider_clip')?.delivery.kind).toBe(
      'resolver',
    )
  })

  it('keeps test-suite changes outside playable package and kernel digests', async () => {
    const root = await fixture()
    const first = await compileCasePackage(root)
    await writeFile(
      join(root, 'tests', 'generic_scenario.yml'),
      `schema: case-test/v0.1
case: {id: demo.assets, version: 0.1.0}
scenario:
  id: generic_scenario
  perspective: detective
  description: This expectation changed without changing the playable case.
  steps:
    - expect: {state: {status: active}}
`,
      'utf8',
    )
    const second = await compileCasePackage(root)

    expect(second.packageDigest).toBe(first.packageDigest)
    expect(second.kernelDigest).toBe(first.kernelDigest)
    expect(second.result.canonicalIrJson).toBe(first.result.canonicalIrJson)
    expect(second.result.canonicalPublicManifestJson).toBe(
      first.result.canonicalPublicManifestJson,
    )
  })

  it('keeps raw delivery host-side and requires an authorized exact handle', async () => {
    const remoteBytes = new TextEncoder().encode('ID3\u0004\u0000\u0000verified remote audio bytes')
    const compiled = await compileCasePackage(
      await fixture(source({ audioDigest: digest(remoteBytes) })),
    )
    const granted = new Set(['direct_audio'])
    const cache = await mkdtemp(join(tmpdir(), 'asset-cache-'))
    roots.push(cache)
    let adapterLoads = 0
    const gateway = createCaseAssetGateway(compiled, {
      cacheDirectory: cache,
      authorize: (context) => granted.has(context.handle.id),
      httpsAdapter: {
        async load(source) {
          adapterLoads += 1
          expect(source).toMatchObject({
            kind: 'https',
            url: 'https://cdn.example.test/audio.mp3?version=7',
          })
          return remoteBytes
        },
      },
    })
    const direct = compiled.result.ir.assets.find(({ id }) => id === 'direct_audio')!
    const provider = compiled.result.ir.assets.find(({ id }) => id === 'provider_clip')!
    const context = (handle: typeof direct.handle) => ({
      caseId: compiled.result.ir.case.id,
      caseVersion: compiled.result.ir.case.version,
      caseDigest: compiled.kernelDigest,
      handle,
    })

    const delivered = await gateway.deliver(context(direct.handle))
    expect(delivered).toMatchObject({
      kind: 'verified-file',
      assetKind: 'audio',
      digest: digest(remoteBytes),
      contentDisposition: 'inline',
    })
    await expect(readFile(delivered.absolutePath)).resolves.toEqual(Buffer.from(remoteBytes))
    const deliveredAgain = await gateway.deliver(context(direct.handle))
    const deliveredThird = await gateway.deliver(context(direct.handle))
    expect(deliveredAgain).toEqual(delivered)
    expect(deliveredThird).toEqual(delivered)
    expect(adapterLoads).toBe(1)
    granted.delete('direct_audio')
    await expect(gateway.deliver(context(direct.handle))).rejects.toMatchObject({
      code: 'E_ASSET_UNAUTHORIZED',
    })
    expect(adapterLoads).toBe(1)
    await expect(gateway.deliver(context(provider.handle))).rejects.toMatchObject(
      { code: 'E_ASSET_UNAUTHORIZED' },
    )
    const deniedPrivate = await gateway.deliver(context(provider.handle)).catch((error: unknown) => error)
    const deniedGuess = await gateway.deliver(context({
      id: 'guessed_private_asset',
      kind: provider.handle.kind,
      mimeType: provider.handle.mimeType,
    })).catch((error: unknown) => error)
    expect(deniedGuess).toMatchObject({
      code: 'E_ASSET_UNAUTHORIZED',
      message: (deniedPrivate as Error).message,
    })
    await expect(
      gateway.deliver(context({ ...direct.handle, mimeType: 'audio/ogg' })),
    ).rejects.toMatchObject(
      { code: 'E_ASSET_UNAUTHORIZED' },
    )
    await expect(
      gateway.deliver({ ...context(direct.handle), caseDigest: 'stale-build' }),
    ).rejects.toMatchObject(
      { code: 'E_ASSET_UNAUTHORIZED' },
    )
    expect(() => createCaseAssetGateway(compiled, {
      cacheDirectory: cache,
      authorize: () => true,
    })).not.toThrow()
    await expect(
      createCaseAssetGateway(compiled, {
        cacheDirectory: cache,
        authorize: () => true,
      }).deliver(context(direct.handle)),
    ).rejects.toMatchObject(
      { code: 'E_ASSET_ADAPTER' },
    )
  })

  it('sanitizes adapter load and iterator failures that contain private locators', async () => {
    const compiled = await compileCasePackage(await fixture())
    const direct = compiled.result.ir.assets.find(({ id }) => id === 'direct_audio')!
    const cache = await mkdtemp(join(tmpdir(), 'asset-adapter-error-'))
    roots.push(cache)
    const context = {
      caseId: compiled.result.ir.case.id,
      caseVersion: compiled.result.ir.case.version,
      caseDigest: compiled.kernelDigest,
      handle: direct.handle,
    }
    const secret = 'https://private.example.test/audio.mp3?token=do-not-expose'
    const rejectingStream: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            throw new Error(secret)
          },
        }
      },
    }
    const gateway = createCaseAssetGateway(compiled, {
      cacheDirectory: cache,
      authorize: ({ handle }) => handle.id === direct.id,
      httpsAdapter: { async load() { return rejectingStream } },
    })

    const error = await gateway.deliver(context).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'E_ASSET_ADAPTER' })
    expect((error as Error).message).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it('rejects missing and tampered local files', async () => {
    const missing = await fixture(source({ imagePath: 'assets/missing.svg' }))
    await expect(compileCasePackage(missing)).rejects.toMatchObject({ code: 'E_ASSET_MISSING' })

    const tampered = await fixture()
    await writeFile(join(tampered, 'assets', 'scene.svg'), `${svg}<!-- changed -->`, 'utf8')
    await expect(compileCasePackage(tampered)).rejects.toMatchObject({ code: 'E_ASSET_DIGEST' })
  })

  it('requires every portable case package to include a real tests directory', async () => {
    const root = await fixture()
    await rm(join(root, 'tests'), { recursive: true, force: true })

    await expect(compileCasePackage(root)).rejects.toMatchObject({
      code: 'E_CASE_PACKAGE_TESTS',
    })
  })

  it('rejects path traversal and extension/MIME mismatches during source compilation', () => {
    const traversal = compileCaseSource(source({ imagePath: 'assets/../scene.svg' }))
    expect(traversal.diagnostics.some(({ code }) => code === 'E_ASSET_LOCAL_PATH')).toBe(true)

    const mismatch = compileCaseSource(source().replace('assets/scene.svg', 'assets/scene.png'))
    expect(mismatch.diagnostics.some(({ code }) => code === 'E_ASSET_EXTENSION_MIME')).toBe(true)

    const activeFile = compileCaseSource(
      source()
        .replace('kind: image\n    source: {local: assets/scene.svg}\n    mime_type: image/svg+xml',
          'kind: file\n    source: {local: assets/payload.xhtml}\n    mime_type: application/xhtml+xml'),
    )
    expect(
      activeFile.diagnostics.some(({ code }) =>
        code === 'E_ASSET_MIME_KIND' || code === 'E_ASSET_EXTENSION'),
    ).toBe(true)
  })

  it('rejects loopback, literal-IP and link-local HTTPS locators', () => {
    for (const url of [
      'https://localhost/audio.mp3',
      'https://127.0.0.1/audio.mp3',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/audio.mp3',
    ]) {
      const result = compileCaseSource(
        source().replace('https://cdn.example.test/audio.mp3?version=7', url),
      )
      expect(result.diagnostics.some(({ code }) => code === 'E_ASSET_HTTPS_URL')).toBe(true)
    }
  })

  it('rejects symlinks, including links that escape the package', async () => {
    const root = await fixture(source({ imagePath: 'assets/linked.svg' }))
    const outside = await mkdtemp(join(tmpdir(), 'outside-asset-'))
    roots.push(outside)
    await writeFile(join(outside, 'scene.svg'), svg, 'utf8')
    await symlink(join(outside, 'scene.svg'), join(root, 'assets', 'linked.svg'))

    await expect(compileCasePackage(root)).rejects.toMatchObject({ code: 'E_ASSET_SYMLINK' })
  })

  it('turns invalid UTF-8 and active SVG into stable package errors', async () => {
    const invalidRoot = await fixture(source({ imageDigest: digest(Uint8Array.from([0xff, 0xfe])) }))
    await writeFile(join(invalidRoot, 'assets', 'scene.svg'), Uint8Array.from([0xff, 0xfe]))
    await expect(compileCasePackage(invalidRoot)).rejects.toMatchObject({
      code: 'E_ASSET_UNSAFE_SVG',
    })

    const active = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    const activeRoot = await fixture(source({ imageDigest: digest(active) }))
    await writeFile(join(activeRoot, 'assets', 'scene.svg'), active, 'utf8')
    await expect(compileCasePackage(activeRoot)).rejects.toMatchObject({
      code: 'E_ASSET_UNSAFE_SVG',
    })

    const namespaced = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="urn:x"><s:script>alert(1)</s:script></svg>'
    const namespacedRoot = await fixture(source({ imageDigest: digest(namespaced) }))
    await writeFile(join(namespacedRoot, 'assets', 'scene.svg'), namespaced, 'utf8')
    await expect(compileCasePackage(namespacedRoot)).rejects.toMatchObject({
      code: 'E_ASSET_UNSAFE_SVG',
    })
  })

  it('streams local verification with explicit per-asset quotas', async () => {
    const root = await fixture()
    await expect(compileCasePackage(root, { maxAssetBytes: 4 })).rejects.toMatchObject({
      code: 'E_ASSET_TOO_LARGE',
    })
  })

  it('verifies injected remote/provider bytes before host promotion', async () => {
    const bytes = new TextEncoder().encode('ID3\u0004\u0000\u0000verified remote bytes')
    const cache = await mkdtemp(join(tmpdir(), 'asset-materialized-'))
    roots.push(cache)
    const delivery = {
      kind: 'https' as const,
      assetKind: 'audio' as const,
      url: 'https://cdn.example.test/audio.mp3',
      mimeType: 'audio/mpeg',
      digest: digest(bytes),
    }
    const materialized = await materializeAssetPayload(delivery, bytes, cache)
    expect(materialized).toMatchObject({ digest: digest(bytes), sizeBytes: bytes.byteLength })
    await expect(readFile(materialized.absolutePath)).resolves.toEqual(Buffer.from(bytes))
    await expect(
      materializeAssetPayload({ ...delivery, digest: '0'.repeat(64) }, bytes, cache),
    ).rejects.toMatchObject({ code: 'E_ASSET_DIGEST' })

    const disguisedPng = new TextEncoder().encode('not a png')
    await expect(
      materializeAssetPayload(
        {
          ...delivery,
          assetKind: 'image',
          mimeType: 'image/png',
          digest: digest(disguisedPng),
        },
        disguisedPng,
        cache,
      ),
    ).rejects.toMatchObject({ code: 'E_ASSET_CONTENT' })

    const activeSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="urn:x"><s:script/></svg>',
    )
    await expect(
      materializeAssetPayload(
        {
          ...delivery,
          assetKind: 'image',
          mimeType: 'image/svg+xml',
          digest: digest(activeSvg),
        },
        activeSvg,
        cache,
      ),
    ).rejects.toMatchObject({ code: 'E_ASSET_UNSAFE_SVG' })
  })

  it('cancels a stalled adapter stream and removes its partial cache file', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'asset-aborted-'))
    roots.push(cache)
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    let returnCalled = false
    const stalled: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            markStarted()
            return new Promise<IteratorResult<Uint8Array>>(() => undefined)
          },
          async return() {
            returnCalled = true
            return { done: true as const, value: undefined }
          },
        }
      },
    }
    const delivery = {
      kind: 'https' as const,
      assetKind: 'audio' as const,
      url: 'https://cdn.example.test/stalled.mp3',
      mimeType: 'audio/mpeg',
      digest: 'd'.repeat(64),
    }

    const pending = materializeAssetPayload(delivery, stalled, cache, 1024, controller.signal)
    await started
    controller.abort(new Error('adapter deadline expired'))

    await expect(pending).rejects.toThrow('adapter deadline expired')
    expect(returnCalled).toBe(true)
    expect(await readdir(cache)).toEqual([])
  })

  it('rehashes a mutable local source into the immutable gateway cache', async () => {
    const root = await fixture()
    const compiled = await compileCasePackage(root)
    const cache = await mkdtemp(join(tmpdir(), 'asset-local-cache-'))
    roots.push(cache)
    const scene = compiled.result.ir.assets.find(({ id }) => id === 'scene_image')!
    const context = {
      caseId: compiled.result.ir.case.id,
      caseVersion: compiled.result.ir.case.version,
      caseDigest: compiled.kernelDigest,
      handle: scene.handle,
    }
    const gateway = createCaseAssetGateway(compiled, {
      cacheDirectory: cache,
      authorize: ({ handle }) => handle.id === scene.id,
    })

    await writeFile(join(root, 'assets', 'scene.svg'), svg.replace('M0', 'M1'), 'utf8')
    await expect(gateway.deliver(context)).rejects.toMatchObject({
      code: 'E_ASSET_DIGEST',
    })
  })

  it('does not expose a private local path when a verified source disappears', async () => {
    const root = await fixture()
    const compiled = await compileCasePackage(root)
    const cache = await mkdtemp(join(tmpdir(), 'asset-local-missing-cache-'))
    roots.push(cache)
    const scene = compiled.result.ir.assets.find(({ id }) => id === 'scene_image')!
    const gateway = createCaseAssetGateway(compiled, {
      cacheDirectory: cache,
      authorize: ({ handle }) => handle.id === scene.id,
    })
    await rm(join(root, 'assets', 'scene.svg'))

    const error = await gateway.deliver({
      caseId: compiled.result.ir.case.id,
      caseVersion: compiled.result.ir.case.version,
      caseDigest: compiled.kernelDigest,
      handle: scene.handle,
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'E_ASSET_CONTENT' })
    expect((error as Error).message).not.toContain(root)
    expect(JSON.stringify(error)).not.toContain(root)
  })

  it('refuses generated output trees that route through a symlink', async () => {
    const root = await fixture()
    const output = await mkdtemp(join(tmpdir(), 'asset-output-link-'))
    const victim = await mkdtemp(join(tmpdir(), 'asset-output-victim-'))
    roots.push(output, victim)
    await mkdir(join(victim, 'fixture-case'), { recursive: true })
    const sentinel = join(victim, 'fixture-case', 'sentinel.txt')
    await writeFile(sentinel, 'keep me', 'utf8')
    await symlink(victim, join(output, 'assets'))

    await expect(buildPublicCasePackage(root, output)).rejects.toMatchObject({
      code: 'E_CASE_OUTPUT_PATH',
    })
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('keep me')
  })

  it('does not follow a pre-planted predictable manifest temp symlink', async () => {
    const root = await fixture()
    const output = await mkdtemp(join(tmpdir(), 'asset-output-temp-link-'))
    const victim = join(output, 'victim.txt')
    roots.push(output)
    await writeFile(victim, 'keep me', 'utf8')
    await symlink(
      victim,
      join(output, `fixture-case.public.json.${process.pid}.tmp`),
    )

    await expect(buildPublicCasePackage(root, output)).resolves.toBeDefined()
    await expect(readFile(victim, 'utf8')).resolves.toBe('keep me')
  })

  it('rejects unknown provider adapters before package loading', () => {
    const result = compileCaseSource(source().replace('provider: signed-media', 'provider: untrusted-cdn'))
    expect(result.diagnostics.some(({ code }) => code === 'E_UNKNOWN_ASSET_PROVIDER')).toBe(true)
  })
})
