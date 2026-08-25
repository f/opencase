import { describe, expect, it } from 'vitest'

import type { CaseSaveStorageKey } from '../case-runtime/controller'
import {
  BrowserCaseSaveStorageError,
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
