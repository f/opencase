import type { ShellPublicCaseManifest } from '../shell/manifest-workspace'

import type { BrowserPackageProvenance } from './import-types'
import type { StaticCaseRuntimeBundle } from './static-bundle'

export const BROWSER_CASE_DATABASE = 'opencase-case-library-v1' as const
export const LEGACY_BROWSER_CASE_DATABASE = 'dedektif-case-library-v1' as const

export interface StoredBrowserCasePackage {
  readonly schema: 'detective-browser-case/v1'
  readonly identity: string
  readonly caseId: string
  readonly caseVersion: string
  readonly caseDigest: string
  readonly packageDigest: string
  readonly bundleDigest: string
  readonly title: string
  readonly synopsis: string
  readonly durationMinutes: number
  readonly defaultLocale: string
  readonly locales: readonly string[]
  readonly manifests: Readonly<Record<string, ShellPublicCaseManifest>>
  readonly bundle: StaticCaseRuntimeBundle
  readonly provenance: BrowserPackageProvenance
  readonly verification: {
    readonly level: 'conformance-passed' | 'compiler-and-smoke'
    readonly authoredTests: number
    readonly testSuiteDigest?: string
  }
  readonly installedAt: string
}

export interface StoredBrowserCaseAsset {
  readonly key: string
  readonly identity: string
  readonly caseDigest: string
  readonly assetId: string
  readonly kind: string
  readonly mimeType: string
  readonly sha256: string
  readonly blob: Blob
}

export interface BrowserCaseInstallation {
  readonly package: StoredBrowserCasePackage
  readonly assets: readonly StoredBrowserCaseAsset[]
}

export function browserCaseIdentity(caseId: string, caseVersion: string): string {
  return `${caseId}\u0000${caseVersion}`
}

export function browserCaseAssetKey(
  identity: string,
  caseDigest: string,
  assetId: string,
): string {
  return `${identity}\u0000${caseDigest}\u0000${assetId}`
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), { once: true })
  })
}

export interface BrowserCaseDatabase {
  listPackages(): Promise<readonly StoredBrowserCasePackage[]>
  getPackage(caseId: string, caseVersion: string): Promise<StoredBrowserCasePackage | undefined>
  getAssets(identity: string, caseDigest: string): Promise<readonly StoredBrowserCaseAsset[]>
  install(value: BrowserCaseInstallation): Promise<'installed' | 'existing'>
  delete(caseId: string, caseVersion: string): Promise<void>
  close(): void
}

export interface OpenBrowserCaseDatabaseOptions {
  readonly indexedDB?: IDBFactory
  readonly name?: string
}

async function openExistingDatabase(
  factory: IDBFactory,
  name: string,
): Promise<IDBDatabase | undefined> {
  try {
    const databases = await factory.databases()
    if (!databases.some((database) => database.name === name)) return undefined
  } catch {
    // Older browsers may not implement database enumeration. The guarded open
    // below aborts creation if the legacy database does not exist.
  }

  return new Promise<IDBDatabase | undefined>((resolve, reject) => {
    const open = factory.open(name)
    let missing = false

    open.addEventListener('upgradeneeded', () => {
      missing = true
      open.transaction?.abort()
    }, { once: true })
    open.addEventListener('success', () => resolve(open.result), { once: true })
    open.addEventListener('error', () => {
      if (missing) {
        resolve(undefined)
        return
      }
      reject(open.error ?? new Error(`Could not open legacy case database ${name}.`))
    }, { once: true })
  })
}

async function readLegacyInstallationRecords(
  database: IDBDatabase,
): Promise<{
  readonly packages: readonly StoredBrowserCasePackage[]
  readonly assets: readonly StoredBrowserCaseAsset[]
}> {
  if (
    !database.objectStoreNames.contains('packages') ||
    !database.objectStoreNames.contains('assets')
  ) return { packages: [], assets: [] }

  const transaction = database.transaction(['packages', 'assets'], 'readonly')
  const packagesRequest = transaction.objectStore('packages').getAll() as IDBRequest<StoredBrowserCasePackage[]>
  const assetsRequest = transaction.objectStore('assets').getAll() as IDBRequest<StoredBrowserCaseAsset[]>
  const [packages, assets] = await Promise.all([
    requestValue(packagesRequest),
    requestValue(assetsRequest),
  ])
  await transactionDone(transaction)
  return { packages, assets }
}

async function copyLegacyPackage(
  database: IDBDatabase,
  casePackage: StoredBrowserCasePackage,
  assets: readonly StoredBrowserCaseAsset[],
): Promise<void> {
  const transaction = database.transaction(['packages', 'assets'], 'readwrite')
  const completed = transactionDone(transaction)
  const packagesStore = transaction.objectStore('packages')
  const assetsStore = transaction.objectStore('assets')
  try {
    const existingPackage = await requestValue(
      packagesStore.get(casePackage.identity) as IDBRequest<StoredBrowserCasePackage | undefined>,
    )

    if (!existingPackage) {
      for (const asset of assets) {
        const existingAsset = await requestValue(
          assetsStore.get(asset.key) as IDBRequest<StoredBrowserCaseAsset | undefined>,
        )
        if (!existingAsset) assetsStore.add(asset)
      }
      packagesStore.add(casePackage)
    }

    await completed
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // The transaction may already have aborted because of a failed request.
    }
    try {
      await completed
    } catch {
      // Preserve the original request or structured-clone error below.
    }
    throw error
  }
}

async function migrateLegacyDatabase(
  factory: IDBFactory,
  database: IDBDatabase,
): Promise<void> {
  const legacy = await openExistingDatabase(factory, LEGACY_BROWSER_CASE_DATABASE)
  if (!legacy) return

  try {
    const records = await readLegacyInstallationRecords(legacy)
    for (const casePackage of records.packages) {
      const assets = records.assets.filter((asset) => (
        asset.identity === casePackage.identity &&
        asset.caseDigest === casePackage.caseDigest
      ))
      try {
        await copyLegacyPackage(database, casePackage, assets)
      } catch {
        // A corrupt or conflicting legacy record must not block other records.
      }
    }
  } finally {
    legacy.close()
  }
}

async function deletePackageRecords(
  database: IDBDatabase,
  caseId: string,
  caseVersion: string,
): Promise<void> {
  if (!database.objectStoreNames.contains('packages')) return

  const identity = browserCaseIdentity(caseId, caseVersion)
  const read = database.transaction('packages', 'readonly')
  const existing = await requestValue(
    read.objectStore('packages').get(identity) as IDBRequest<StoredBrowserCasePackage | undefined>,
  )
  await transactionDone(read)

  const stores = database.objectStoreNames.contains('assets')
    ? ['packages', 'assets']
    : ['packages']
  const transaction = database.transaction(stores, 'readwrite')
  transaction.objectStore('packages').delete(identity)
  if (existing && stores.includes('assets')) {
    const index = transaction.objectStore('assets').index('by-case')
    const keys = await requestValue(
      index.getAllKeys(IDBKeyRange.only([identity, existing.caseDigest])),
    )
    for (const key of keys) transaction.objectStore('assets').delete(key)
  }
  await transactionDone(transaction)
}

async function deleteLegacyPackage(
  factory: IDBFactory,
  caseId: string,
  caseVersion: string,
): Promise<void> {
  const legacy = await openExistingDatabase(factory, LEGACY_BROWSER_CASE_DATABASE)
  if (!legacy) return
  try {
    await deletePackageRecords(legacy, caseId, caseVersion)
  } finally {
    legacy.close()
  }
}

export async function openBrowserCaseDatabase(
  options: OpenBrowserCaseDatabaseOptions = {},
): Promise<BrowserCaseDatabase> {
  const factory = options.indexedDB ?? globalThis.indexedDB
  if (!factory) throw new Error('This browser does not provide IndexedDB case storage.')
  const usesDefaultDatabase = options.name === undefined
  const open = factory.open(options.name ?? BROWSER_CASE_DATABASE, 1)
  open.addEventListener('upgradeneeded', () => {
    const database = open.result
    if (!database.objectStoreNames.contains('packages')) {
      database.createObjectStore('packages', { keyPath: 'identity' })
    }
    if (!database.objectStoreNames.contains('assets')) {
      const assets = database.createObjectStore('assets', { keyPath: 'key' })
      assets.createIndex('by-case', ['identity', 'caseDigest'], { unique: false })
    }
  })
  const database = await requestValue(open)
  database.addEventListener('versionchange', () => database.close())
  if (usesDefaultDatabase) {
    try {
      await migrateLegacyDatabase(factory, database)
    } catch {
      // Legacy migration is best-effort. The new database remains usable even
      // when the old database cannot be opened or read.
    }
  }

  return Object.freeze({
    async listPackages(): Promise<readonly StoredBrowserCasePackage[]> {
      const transaction = database.transaction('packages', 'readonly')
      const values = await requestValue(
        transaction.objectStore('packages').getAll() as IDBRequest<StoredBrowserCasePackage[]>,
      )
      await transactionDone(transaction)
      return values
    },

    async getPackage(caseId: string, caseVersion: string): Promise<StoredBrowserCasePackage | undefined> {
      const transaction = database.transaction('packages', 'readonly')
      const value = await requestValue(
        transaction.objectStore('packages').get(browserCaseIdentity(caseId, caseVersion)) as IDBRequest<StoredBrowserCasePackage | undefined>,
      )
      await transactionDone(transaction)
      return value
    },

    async getAssets(identity: string, caseDigest: string): Promise<readonly StoredBrowserCaseAsset[]> {
      const transaction = database.transaction('assets', 'readonly')
      const index = transaction.objectStore('assets').index('by-case')
      const values = await requestValue(
        index.getAll(IDBKeyRange.only([identity, caseDigest])) as IDBRequest<StoredBrowserCaseAsset[]>,
      )
      await transactionDone(transaction)
      return values
    },

    async install(value: BrowserCaseInstallation): Promise<'installed' | 'existing'> {
      const transaction = database.transaction(['packages', 'assets'], 'readwrite')
      const packages = transaction.objectStore('packages')
      const existing = await requestValue(
        packages.get(value.package.identity) as IDBRequest<StoredBrowserCasePackage | undefined>,
      )
      if (existing) {
        transaction.abort()
        try {
          await transactionDone(transaction)
        } catch {
          // Expected: abort ensures an idempotent read never mutates asset records.
        }
        if (
          existing.caseDigest === value.package.caseDigest &&
          existing.packageDigest === value.package.packageDigest &&
          existing.bundleDigest === value.package.bundleDigest
        ) return 'existing'
        throw new Error(`Case ${value.package.caseId}@${value.package.caseVersion} is already installed with different content.`)
      }
      packages.add(value.package)
      const assets = transaction.objectStore('assets')
      for (const asset of value.assets) assets.add(asset)
      await transactionDone(transaction)
      return 'installed'
    },

    async delete(caseId: string, caseVersion: string): Promise<void> {
      // Remove the fallback first. If that fails, leave the current record in
      // place and reject so a later launch cannot silently restore the case.
      if (usesDefaultDatabase) {
        await deleteLegacyPackage(factory, caseId, caseVersion)
      }
      await deletePackageRecords(database, caseId, caseVersion)
    },

    close(): void {
      database.close()
    },
  })
}
