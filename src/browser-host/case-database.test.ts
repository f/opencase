import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import type { StaticCaseRuntimeBundle } from './static-bundle'
import {
  browserCaseAssetKey,
  browserCaseIdentity,
  openBrowserCaseDatabase,
  type BrowserCaseDatabase,
  type BrowserCaseInstallation,
  type StoredBrowserCasePackage,
} from './case-database'

const openDatabases: BrowserCaseDatabase[] = []
let databaseSequence = 0

function packageFixture(
  overrides: Partial<StoredBrowserCasePackage> = {},
): StoredBrowserCasePackage {
  const caseId = overrides.caseId ?? 'tiny-case'
  const caseVersion = overrides.caseVersion ?? '1.0.0'
  return {
    schema: 'detective-browser-case/v1',
    identity: browserCaseIdentity(caseId, caseVersion),
    caseId,
    caseVersion,
    caseDigest: 'case-digest-a',
    packageDigest: 'package-digest-a',
    bundleDigest: 'bundle-digest-a',
    title: 'Tiny Case',
    synopsis: 'A tiny storage fixture.',
    durationMinutes: 5,
    defaultLocale: 'en',
    locales: ['en'],
    manifests: {},
    bundle: {
      schema: 'case-static-runtime/v1',
      case: {
        id: caseId,
        version: caseVersion,
        kernelDigest: 'case-digest-a',
        packageDigest: 'package-digest-a',
        defaultLocale: 'en',
      },
      kernelIr: {},
      presentations: {},
      assets: [],
      integrity: { algorithm: 'sha256', bundle: 'bundle-digest-a' },
    } as unknown as StaticCaseRuntimeBundle,
    provenance: { kind: 'yaml', url: 'https://cases.example/tiny.yml' },
    verification: { level: 'compiler-and-smoke', authoredTests: 0 },
    installedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  }
}

function installationFixture(
  packageOverrides: Partial<StoredBrowserCasePackage> = {},
): BrowserCaseInstallation {
  const casePackage = packageFixture(packageOverrides)
  return {
    package: casePackage,
    assets: [{
      key: browserCaseAssetKey(casePackage.identity, casePackage.caseDigest, 'photo'),
      identity: casePackage.identity,
      caseDigest: casePackage.caseDigest,
      assetId: 'photo',
      kind: 'image',
      mimeType: 'image/png',
      sha256: 'asset-digest-a',
      blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    }],
  }
}

async function openDatabase(): Promise<BrowserCaseDatabase> {
  databaseSequence += 1
  const database = await openBrowserCaseDatabase({
    indexedDB: globalThis.indexedDB,
    name: `dedektif-case-database-test-${databaseSequence}`,
  })
  openDatabases.push(database)
  return database
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close()
})

describe('browser case database', () => {
  it('installs a package and retrieves its content-addressed assets', async () => {
    const database = await openDatabase()
    const installation = installationFixture()

    await expect(database.install(installation)).resolves.toBe('installed')
    await expect(database.listPackages()).resolves.toEqual([installation.package])
    await expect(database.getPackage('tiny-case', '1.0.0')).resolves.toEqual(installation.package)

    const assets = await database.getAssets(
      installation.package.identity,
      installation.package.caseDigest,
    )
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: 'photo',
      sha256: 'asset-digest-a',
      mimeType: 'image/png',
    })
    await expect(assets[0]?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    )
  })

  it('treats an identical reinstall as idempotent without duplicating assets', async () => {
    const database = await openDatabase()
    const installation = installationFixture()

    await expect(database.install(installation)).resolves.toBe('installed')
    await expect(database.install(installation)).resolves.toBe('existing')
    await expect(database.getAssets(
      installation.package.identity,
      installation.package.caseDigest,
    )).resolves.toHaveLength(1)
  })

  it('rejects different content at an already installed case identity', async () => {
    const database = await openDatabase()
    await database.install(installationFixture())

    await expect(database.install(installationFixture({
      caseDigest: 'case-digest-b',
      packageDigest: 'package-digest-b',
      bundleDigest: 'bundle-digest-b',
    }))).rejects.toThrow(
      'Case tiny-case@1.0.0 is already installed with different content.',
    )

    await expect(database.getPackage('tiny-case', '1.0.0')).resolves.toMatchObject({
      caseDigest: 'case-digest-a',
      packageDigest: 'package-digest-a',
    })
  })

  it('deletes the package and only the assets belonging to its case digest', async () => {
    const database = await openDatabase()
    const installation = installationFixture()
    await database.install(installation)

    await database.delete('tiny-case', '1.0.0')

    await expect(database.getPackage('tiny-case', '1.0.0')).resolves.toBeUndefined()
    await expect(database.getAssets(
      installation.package.identity,
      installation.package.caseDigest,
    )).resolves.toEqual([])
  })
})
