import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { StaticCaseRuntimeBundle } from './static-bundle'
import {
  BROWSER_CASE_DATABASE,
  LEGACY_BROWSER_CASE_DATABASE,
  browserCaseAssetKey,
  browserCaseIdentity,
  openBrowserCaseDatabase,
  type BrowserCaseDatabase,
  type BrowserCaseInstallation,
  type StoredBrowserCasePackage,
} from './case-database'

const openDatabases: BrowserCaseDatabase[] = []
let databaseSequence = 0

function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(name)
    request.addEventListener('success', () => resolve(), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
    request.addEventListener('blocked', () => reject(new Error(`Database ${name} is still open.`)), { once: true })
  })
}

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
    name: `opencase-case-database-test-${databaseSequence}`,
  })
  openDatabases.push(database)
  return database
}

async function openNamedDatabase(name: string): Promise<BrowserCaseDatabase> {
  const database = await openBrowserCaseDatabase({
    indexedDB: globalThis.indexedDB,
    name,
  })
  openDatabases.push(database)
  return database
}

beforeEach(async () => {
  await Promise.all([
    deleteDatabase(BROWSER_CASE_DATABASE),
    deleteDatabase(LEGACY_BROWSER_CASE_DATABASE),
  ])
})

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close()
  await Promise.all([
    deleteDatabase(BROWSER_CASE_DATABASE),
    deleteDatabase(LEGACY_BROWSER_CASE_DATABASE),
  ])
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

  it('copies legacy packages and Blob-backed assets into the new default database', async () => {
    const legacy = await openNamedDatabase(LEGACY_BROWSER_CASE_DATABASE)
    const installation = installationFixture()
    await legacy.install(installation)
    legacy.close()

    const database = await openBrowserCaseDatabase({ indexedDB: globalThis.indexedDB })
    openDatabases.push(database)

    await expect(database.getPackage('tiny-case', '1.0.0')).resolves.toEqual(
      installation.package,
    )
    const assets = await database.getAssets(
      installation.package.identity,
      installation.package.caseDigest,
    )
    expect(assets).toHaveLength(1)
    expect(assets[0]?.blob).toBeInstanceOf(Blob)
    await expect(assets[0]?.blob.arrayBuffer()).resolves.toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    )
  })

  it('is idempotent and gives records already in the new database precedence', async () => {
    const legacy = await openNamedDatabase(LEGACY_BROWSER_CASE_DATABASE)
    const conflictingLegacy = installationFixture({
      caseDigest: 'legacy-case-digest',
      packageDigest: 'legacy-package-digest',
      bundleDigest: 'legacy-bundle-digest',
      title: 'Legacy title',
    })
    const legacyOnly = installationFixture({
      caseId: 'legacy-only',
      caseDigest: 'legacy-only-case-digest',
      packageDigest: 'legacy-only-package-digest',
      bundleDigest: 'legacy-only-bundle-digest',
    })
    await legacy.install(conflictingLegacy)
    await legacy.install(legacyOnly)
    legacy.close()

    const seededNewDatabase = await openNamedDatabase(BROWSER_CASE_DATABASE)
    const current = installationFixture({ title: 'Current title' })
    await seededNewDatabase.install(current)
    seededNewDatabase.close()

    const firstOpen = await openBrowserCaseDatabase({ indexedDB: globalThis.indexedDB })
    openDatabases.push(firstOpen)
    await expect(firstOpen.getPackage('tiny-case', '1.0.0')).resolves.toEqual(current.package)
    await expect(firstOpen.getPackage('legacy-only', '1.0.0')).resolves.toEqual(legacyOnly.package)
    firstOpen.close()

    const secondOpen = await openBrowserCaseDatabase({ indexedDB: globalThis.indexedDB })
    openDatabases.push(secondOpen)
    await expect(secondOpen.listPackages()).resolves.toHaveLength(2)
    await expect(secondOpen.getPackage('tiny-case', '1.0.0')).resolves.toEqual(current.package)
    await expect(secondOpen.getAssets(
      legacyOnly.package.identity,
      legacyOnly.package.caseDigest,
    )).resolves.toHaveLength(1)
  })

  it('deletes migrated package and asset records from both database names', async () => {
    const legacy = await openNamedDatabase(LEGACY_BROWSER_CASE_DATABASE)
    const installation = installationFixture()
    await legacy.install(installation)
    legacy.close()

    const database = await openBrowserCaseDatabase({ indexedDB: globalThis.indexedDB })
    openDatabases.push(database)
    await expect(database.getPackage('tiny-case', '1.0.0')).resolves.toBeDefined()

    await database.delete('tiny-case', '1.0.0')
    database.close()

    const legacyAfterDelete = await openNamedDatabase(LEGACY_BROWSER_CASE_DATABASE)
    await expect(legacyAfterDelete.getPackage('tiny-case', '1.0.0')).resolves.toBeUndefined()
    await expect(legacyAfterDelete.getAssets(
      installation.package.identity,
      installation.package.caseDigest,
    )).resolves.toEqual([])

    const reopened = await openBrowserCaseDatabase({ indexedDB: globalThis.indexedDB })
    openDatabases.push(reopened)
    await expect(reopened.getPackage('tiny-case', '1.0.0')).resolves.toBeUndefined()
  })

  it('does not import the global legacy database when a custom name is supplied', async () => {
    const legacy = await openNamedDatabase(LEGACY_BROWSER_CASE_DATABASE)
    await legacy.install(installationFixture())
    legacy.close()

    const custom = await openNamedDatabase(`opencase-custom-test-${databaseSequence += 1}`)
    await expect(custom.listPackages()).resolves.toEqual([])
  })

  it('keeps the new default database usable when opening the legacy database fails', async () => {
    const legacy = await openNamedDatabase(LEGACY_BROWSER_CASE_DATABASE)
    await legacy.install(installationFixture())
    legacy.close()

    const failingFactory = new Proxy(globalThis.indexedDB, {
      get(target, property) {
        if (property === 'open') {
          return (name: string, version?: number): IDBOpenDBRequest => {
            if (name === LEGACY_BROWSER_CASE_DATABASE) {
              throw new Error('Simulated legacy database failure.')
            }
            return version === undefined
              ? target.open(name)
              : target.open(name, version)
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as IDBFactory

    const database = await openBrowserCaseDatabase({ indexedDB: failingFactory })
    openDatabases.push(database)
    await expect(database.listPackages()).resolves.toEqual([])
    await expect(database.install(installationFixture({ caseId: 'fresh-case' }))).resolves.toBe('installed')
  })
})
