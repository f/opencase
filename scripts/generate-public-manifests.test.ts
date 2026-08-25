import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { VerifiedPackageAsset } from '../src/case-package'
import { hashCanonical } from '../src/compiler'
import {
  generatePublicManifests,
  requireStaticLocalAssetSource,
} from './generate-public-manifests'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an object.')
  }
  return value as UnknownRecord
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string.')
  return value
}

async function json(path: string): Promise<UnknownRecord> {
  return record(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

function fixtureAsset(source: VerifiedPackageAsset['descriptor']['source']): VerifiedPackageAsset {
  return {
    descriptor: {
      id: 'fixture-asset',
      kind: 'image',
      mimeType: 'image/png',
      visibility: 'private',
      source,
      integrity: { algorithm: 'sha256', digest: '0'.repeat(64) },
      handle: { id: 'fixture-asset', kind: 'image', mimeType: 'image/png' },
    },
  }
}

describe('static runtime manifest generation', () => {
  const projectRoot = resolve(import.meta.dirname, '..')
  let temporaryPublicDirectory = ''
  let generatedDirectory = ''
  let index: UnknownRecord

  beforeAll(async () => {
    temporaryPublicDirectory = await mkdtemp(join(tmpdir(), 'detective-static-runtime-'))
    const result = await generatePublicManifests({
      casesDirectory: join(projectRoot, 'cases'),
      publicDirectory: temporaryPublicDirectory,
    })
    generatedDirectory = result.outputDirectory
    index = await json(join(generatedDirectory, 'cases.json'))
  }, 30_000)

  afterAll(async () => {
    await rm(temporaryPublicDirectory, { recursive: true, force: true })
  })

  it('emits an integrity-locked runtime and effective presentation catalogs per case', async () => {
    const packages = index.packages
    expect(Array.isArray(packages)).toBe(true)
    expect(packages).not.toHaveLength(0)

    for (const rawPackage of packages as unknown[]) {
      const packageEntry = record(rawPackage)
      expect(string(packageEntry.manifestUrl).startsWith('./')).toBe(true)
      expect(string(packageEntry.assetManifestUrl).startsWith('./')).toBe(true)
      for (const rawLocale of packageEntry.locales as unknown[]) {
        expect(string(record(rawLocale).manifestUrl).startsWith('./')).toBe(true)
      }
      const runtimeUrl = string(packageEntry.runtimeUrl)
      expect(runtimeUrl.startsWith('./')).toBe(true)
      const runtimePath = resolve(generatedDirectory, runtimeUrl)
      const bundle = await json(runtimePath)
      const integrity = record(bundle.integrity)
      const bundleDigest = string(integrity.bundle)
      const { integrity: _integrity, ...unsigned } = bundle

      expect(bundle.schema).toBe('case-static-runtime/v1')
      expect(hashCanonical(unsigned)).toBe(bundleDigest)
      expect(packageEntry.runtimeDigest).toBe(bundleDigest)

      const identity = record(bundle.case)
      const kernel = record(bundle.kernelIr)
      expect(kernel.id).toBe(identity.id)
      expect(kernel.version).toBe(identity.version)
      expect(kernel.digest).toBe(identity.kernelDigest)
      expect(packageEntry.caseDigest).toBe(identity.kernelDigest)
      expect(packageEntry.packageDigest).toBe(identity.packageDigest)
      expect(identity.packageDigest).toMatch(/^[a-f0-9]{64}$/)

      const presentations = record(bundle.presentations)
      const locales = packageEntry.locales
      expect(Array.isArray(locales)).toBe(true)
      expect(Object.keys(presentations).sort()).toEqual(
        (locales as unknown[]).map((locale) => string(record(locale).locale)).sort(),
      )
      for (const catalog of Object.values(presentations)) {
        expect(Object.keys(record(record(catalog).messages))).not.toHaveLength(0)
      }
    }
  })

  it('keeps public asset delivery URLs relative to the asset manifest', async () => {
    for (const rawPackage of index.packages as unknown[]) {
      const packageEntry = record(rawPackage)
      const manifestPath = resolve(generatedDirectory, string(packageEntry.assetManifestUrl))
      const manifest = await json(manifestPath)
      expect(manifest.integrity).toEqual(expect.objectContaining({ algorithm: 'sha256' }))
      expect(Array.isArray(manifest.assets)).toBe(true)
      for (const rawAsset of manifest.assets as unknown[]) {
        const delivery = record(record(rawAsset).delivery)
        if (delivery.kind === 'hosted') {
          expect(string(delivery.url).startsWith('./assets/')).toBe(true)
        }
      }
    }
  })

  it('copies every package-local asset under a content-addressed relative URL', async () => {
    const packages = index.packages as unknown[]
    let deliveredAssets = 0
    for (const rawPackage of packages) {
      const packageEntry = record(rawPackage)
      const runtimePath = resolve(generatedDirectory, string(packageEntry.runtimeUrl))
      const bundle = await json(runtimePath)
      const assets = bundle.assets
      expect(Array.isArray(assets)).toBe(true)

      const authoredAssetEntries = await readdir(
        join(projectRoot, 'cases', string(packageEntry.slug), 'assets'),
        { withFileTypes: true },
      )
      const authoredAssetCount = authoredAssetEntries.filter((entry) => (
        entry.isFile() && entry.name !== 'README.md'
      )).length
      expect(assets).toHaveLength(authoredAssetCount)

      for (const rawAsset of assets as unknown[]) {
        deliveredAssets += 1
        const asset = record(rawAsset)
        const url = string(asset.url)
        const digest = string(asset.sha256)
        expect(url.startsWith('./assets/')).toBe(true)
        expect(url).toContain(digest)
        const path = resolve(dirname(runtimePath), url)
        expect((await stat(path)).isFile()).toBe(true)
        const bytes = await readFile(path)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest)
      }
    }
    expect(deliveredAssets).toBeGreaterThan(0)
  })

  it('rejects remote and provider delivery with a clear static-build error', () => {
    expect(() => requireStaticLocalAssetSource(fixtureAsset({
      kind: 'https',
      url: 'https://media.example.test/evidence.png',
    }))).toThrow(/unsupported https delivery.*package-local assets/i)
    expect(() => requireStaticLocalAssetSource(fixtureAsset({
      kind: 'provider',
      provider: 'fixture-provider',
      ref: 'opaque-ref',
    }))).toThrow(/unsupported provider delivery.*package-local assets/i)
  })
})
