import { describe, expect, it } from 'vitest'

import type { CaseSaveStorageKey } from '../case-runtime/controller'
import {
  BROWSER_CASE_SAVE_PREFIX,
  BrowserCaseSaveStorageError,
  LEGACY_BROWSER_CASE_SAVE_PREFIX,
  browserCaseSaveKey,
  createBrowserCaseSaveStorage,
  type BrowserCaseSaveKeyValueStorage,
} from './case-save-storage'

const SAVE_KEY: CaseSaveStorageKey = {
  saveId: 'profile:one',
  caseId: 'community.example/case',
  caseVersion: '1.0.0',
  kernelIrDigest: 'sha256:abc',
}

function memoryStorage(): BrowserCaseSaveKeyValueStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

describe('browser case save storage', () => {
  it('writes new saves only under the opencase namespace', async () => {
    const storage = memoryStorage()
    const saves = createBrowserCaseSaveStorage({ storage })

    await saves.write(SAVE_KEY, 'current-save')

    expect(storage.values.get(browserCaseSaveKey(SAVE_KEY, BROWSER_CASE_SAVE_PREFIX)))
      .toBe('current-save')
    expect(storage.values.has(browserCaseSaveKey(SAVE_KEY, LEGACY_BROWSER_CASE_SAVE_PREFIX)))
      .toBe(false)
  })

  it('reads and safely copies an exact legacy save without deleting the fallback', async () => {
    const storage = memoryStorage()
    const legacyKey = browserCaseSaveKey(SAVE_KEY, LEGACY_BROWSER_CASE_SAVE_PREFIX)
    const currentKey = browserCaseSaveKey(SAVE_KEY, BROWSER_CASE_SAVE_PREFIX)
    const serialized = '{"schemaVersion":"kernel-save@1","private":"opaque"}'
    storage.values.set(legacyKey, serialized)
    const saves = createBrowserCaseSaveStorage({ storage })

    await expect(saves.read(SAVE_KEY)).resolves.toBe(serialized)
    expect(storage.values.get(currentKey)).toBe(serialized)
    expect(storage.values.get(legacyKey)).toBe(serialized)
  })

  it('keeps the current opencase save authoritative over a stale legacy value', async () => {
    const storage = memoryStorage()
    storage.values.set(
      browserCaseSaveKey(SAVE_KEY, BROWSER_CASE_SAVE_PREFIX),
      'current-save',
    )
    storage.values.set(
      browserCaseSaveKey(SAVE_KEY, LEGACY_BROWSER_CASE_SAVE_PREFIX),
      'stale-legacy-save',
    )

    await expect(createBrowserCaseSaveStorage({ storage }).read(SAVE_KEY))
      .resolves.toBe('current-save')
  })

  it('returns a readable legacy save even when its best-effort copy is blocked', async () => {
    const legacyKey = browserCaseSaveKey(SAVE_KEY, LEGACY_BROWSER_CASE_SAVE_PREFIX)
    const storage: BrowserCaseSaveKeyValueStorage = {
      getItem: (key) => key === legacyKey ? 'legacy-save' : null,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError') },
      removeItem: () => undefined,
    }

    await expect(createBrowserCaseSaveStorage({ storage }).read(SAVE_KEY))
      .resolves.toBe('legacy-save')
  })

  it('deletes both namespaces so a legacy save cannot reappear', async () => {
    const storage = memoryStorage()
    const legacyKey = browserCaseSaveKey(SAVE_KEY, LEGACY_BROWSER_CASE_SAVE_PREFIX)
    const currentKey = browserCaseSaveKey(SAVE_KEY, BROWSER_CASE_SAVE_PREFIX)
    storage.values.set(legacyKey, 'legacy-save')
    storage.values.set(currentKey, 'current-save')
    const saves = createBrowserCaseSaveStorage({ storage })

    await saves.delete(SAVE_KEY)

    expect(storage.values.has(legacyKey)).toBe(false)
    expect(storage.values.has(currentKey)).toBe(false)
    await expect(saves.read(SAVE_KEY)).resolves.toBeUndefined()
  })

  it('keeps the serialized save opaque and namespaces the exact build slot', async () => {
    const storage = memoryStorage()
    const saves = createBrowserCaseSaveStorage({ storage, prefix: 'test' })
    const serialized = '{"schemaVersion":"kernel-save@1"}'

    await saves.write(SAVE_KEY, serialized)

    expect(storage.values.get(browserCaseSaveKey(SAVE_KEY, 'test'))).toBe(serialized)
    await expect(saves.read(SAVE_KEY)).resolves.toBe(serialized)
    await saves.delete(SAVE_KEY)
    await expect(saves.read(SAVE_KEY)).resolves.toBeUndefined()
  })

  it('does not collide when a key component contains separators', () => {
    expect(browserCaseSaveKey(SAVE_KEY, 'test')).not.toBe(
      browserCaseSaveKey({ ...SAVE_KEY, saveId: 'profile', caseId: 'one:community.example/case' }, 'test'),
    )
  })

  it('wraps browser quota and privacy failures without exposing save bytes', async () => {
    const saves = createBrowserCaseSaveStorage({
      storage: {
        getItem: () => null,
        setItem: () => { throw new DOMException('quota', 'QuotaExceededError') },
        removeItem: () => undefined,
      },
    })

    await expect(saves.write(SAVE_KEY, 'private-event-log')).rejects.toMatchObject({
      name: 'BrowserCaseSaveStorageError',
      operation: 'write',
    } satisfies Partial<BrowserCaseSaveStorageError>)
  })
})
