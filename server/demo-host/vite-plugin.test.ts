import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'

import { createDemoAssetUrl, PRIMARY_DEMO_SAVE_ID } from '../../src/demo-host-client'
import { createDemoHostVitePlugin } from './vite-plugin'

const temporaryDirectories: string[] = []
const runningServers: ViteDevServer[] = []

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('demo asset HTTP endpoint', () => {
  it('keeps real case images locked until their authored action, then streams them safely', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'detective-demo-http-'))
    temporaryDirectories.push(dataDirectory)
    const server = await createServer({
      configFile: false,
      logLevel: 'silent',
      plugins: [createDemoHostVitePlugin({
        casesDirectory: resolve(import.meta.dirname, '..', '..', 'cases'),
        dataDirectory,
      })],
      server: { host: '127.0.0.1', port: 0 },
    })
    runningServers.push(server)
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP dev server.')
    const origin = `http://127.0.0.1:${address.port}`
    const cases = [
      {
        ref: {
          caseId: 'community.fka.yedi-dakika',
          caseVersion: '0.4.1',
          locale: 'tr',
          saveId: PRIMARY_DEMO_SAVE_ID,
        },
        assetId: 'lobby-cctv-still',
        intent: { kind: 'action', action: 'request', from: 'leyla', topic: 'lobby-video' },
      },
      {
        ref: {
          caseId: 'official.son-prova',
          caseVersion: '0.4.2',
          locale: 'tr',
          saveId: PRIMARY_DEMO_SAVE_ID,
        },
        assetId: 'safety-pin-photo',
        intent: { kind: 'action', action: 'request', from: 'ekin', topic: 'scene-report' },
      },
    ] as const
    let testedCacheBoundary = false

    for (const fixture of cases) {
      const startResponse = await fetch(`${origin}/api/demo/session/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fixture.ref),
      })
      expect(startResponse.status).toBe(200)
      const started = await startResponse.json() as {
        assetSessionId?: string
        snapshot?: {
          case: { digest: string }
          evidence: { assets: { id: string; kind: string; mimeType: string }[] }[]
        }
      }
      if (!started.assetSessionId || !started.snapshot) {
        throw new Error('Expected an asset-enabled runtime snapshot.')
      }
      expect(started.snapshot.evidence.flatMap(({ assets }) => assets)).not.toContainEqual(
        expect.objectContaining({ id: fixture.assetId }),
      )
      const relativeUrl = createDemoAssetUrl({
        ...fixture.ref,
        assetSessionId: started.assetSessionId,
        caseDigest: started.snapshot.case.digest,
      }, fixture.assetId)

      const lockedResponse = await fetch(`${origin}${relativeUrl}`)
      expect(lockedResponse.status).toBe(404)
      expect(await lockedResponse.json()).toEqual({
        error: {
          code: 'asset-unavailable',
          message: 'The requested asset is not available to this session.',
        },
      })

      const commandResponse = await fetch(`${origin}/api/demo/session/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fixture.ref, intent: fixture.intent }),
      })
      expect(commandResponse.status).toBe(200)
      const command = await commandResponse.json() as {
        ok: boolean
        snapshot: { evidence: { assets: { id: string; kind: string; mimeType: string }[] }[] }
      }
      expect(command.ok).toBe(true)
      expect(command.snapshot.evidence.flatMap(({ assets }) => assets)).toContainEqual({
        id: fixture.assetId,
        kind: 'image',
        mimeType: 'image/png',
      })

      if (!testedCacheBoundary) {
        const headResponse = await fetch(`${origin}${relativeUrl}`, { method: 'HEAD' })
        expect(headResponse.status).toBe(200)
        expect(headResponse.headers.get('content-type')).toBe('image/png')
        expect(headResponse.headers.get('x-content-type-options')).toBe('nosniff')
        expect(headResponse.headers.get('cache-control')).toBe('private, no-store')
        expect(headResponse.headers.get('content-disposition')).toBe(
          'inline; filename="case-asset.png"',
        )
        expect(headResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin')
        expect((await headResponse.arrayBuffer()).byteLength).toBe(0)

        const cacheDirectory = join(dataDirectory, 'asset-cache')
        const cacheFiles = (await readdir(cacheDirectory)).filter((name) => name.endsWith('.asset'))
        expect(cacheFiles).toHaveLength(1)
        const cachePath = join(cacheDirectory, cacheFiles[0]!)
        const materializedIdentity = await stat(cachePath)

        const firstRange = await fetch(`${origin}${relativeUrl}`, {
          headers: { range: 'bytes=0-7' },
        })
        expect(firstRange.status).toBe(206)
        expect(firstRange.headers.get('content-range')).toMatch(/^bytes 0-7\/\d+$/)
        expect(firstRange.headers.get('content-length')).toBe('8')
        expect(Buffer.from(await firstRange.arrayBuffer())).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
        const secondRange = await fetch(`${origin}${relativeUrl}`, {
          headers: { range: 'bytes=8-15' },
        })
        expect(secondRange.status).toBe(206)
        expect(secondRange.headers.get('content-range')).toMatch(/^bytes 8-15\/\d+$/)
        expect((await secondRange.arrayBuffer()).byteLength).toBe(8)

        const afterRanges = await stat(cachePath)
        expect(afterRanges.ino).toBe(materializedIdentity.ino)
        expect(afterRanges.mtimeMs).toBe(materializedIdentity.mtimeMs)

        const original = await readFile(cachePath)
        const replacementPath = join(cacheDirectory, '.same-length-replacement')
        await writeFile(replacementPath, Buffer.alloc(original.byteLength, 0x41), { mode: 0o444 })
        await rename(replacementPath, cachePath)
        const tamperedResponse = await fetch(`${origin}${relativeUrl}`, {
          headers: { range: 'bytes=0-7' },
        })
        expect(tamperedResponse.status).toBe(502)
        expect(await tamperedResponse.json()).toEqual({
          error: {
            code: 'asset-delivery-failed',
            message: 'The trusted local host could not deliver this asset safely.',
          },
        })
        testedCacheBoundary = true
      } else {
        const assetResponse = await fetch(`${origin}${relativeUrl}`)
        expect(assetResponse.status).toBe(200)
        expect(assetResponse.headers.get('content-type')).toBe('image/png')
        expect(Buffer.from(await assetResponse.arrayBuffer()).subarray(0, 8)).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
      }
    }
    expect(testedCacheBoundary).toBe(true)
  }, 60_000)
})
