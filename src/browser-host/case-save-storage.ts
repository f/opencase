import type {
  CaseSaveStorage,
  CaseSaveStorageKey,
} from '../case-runtime/controller'

export const BROWSER_CASE_SAVE_PREFIX = 'dedektif:case-save:v1' as const

export interface BrowserCaseSaveKeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class BrowserCaseSaveStorageError extends Error {
  constructor(
    readonly operation: 'read' | 'write' | 'delete',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BrowserCaseSaveStorageError'
  }
}

function defaultStorage(
  operation: BrowserCaseSaveStorageError['operation'],
): BrowserCaseSaveKeyValueStorage {
  let storage: Storage | undefined
  try {
    storage = typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    storage = undefined
  }
  if (!storage) {
    throw new BrowserCaseSaveStorageError(
      operation,
      'This browser does not provide local case storage.',
    )
  }
  return storage
}

function segment(value: string): string {
  return encodeURIComponent(value)
}

export function browserCaseSaveKey(
  key: CaseSaveStorageKey,
  prefix: string = BROWSER_CASE_SAVE_PREFIX,
): string {
  return [
    prefix,
    segment(key.saveId),
    segment(key.caseId),
    segment(key.caseVersion),
    segment(key.kernelIrDigest),
  ].join(':')
}

export interface CreateBrowserCaseSaveStorageOptions {
  readonly storage?: BrowserCaseSaveKeyValueStorage
  readonly prefix?: string
}

/**
 * Browser implementation of the engine's opaque save port.
 *
 * The adapter deliberately never parses or patches `kernel-save@1`; it only
 * namespaces the exact serialized bytes by profile, case, version, and build.
 */
export function createBrowserCaseSaveStorage(
  options: CreateBrowserCaseSaveStorageOptions = {},
): CaseSaveStorage {
  const storage = options.storage
  const prefix = options.prefix ?? BROWSER_CASE_SAVE_PREFIX
  return Object.freeze({
    async read(key: CaseSaveStorageKey): Promise<string | undefined> {
      try {
        return (storage ?? defaultStorage('read'))
          .getItem(browserCaseSaveKey(key, prefix)) ?? undefined
      } catch (cause) {
        throw new BrowserCaseSaveStorageError(
          'read',
          'The saved investigation could not be read from this browser.',
          { cause },
        )
      }
    },

    async write(key: CaseSaveStorageKey, serializedSave: string): Promise<void> {
      try {
        ;(storage ?? defaultStorage('write'))
          .setItem(browserCaseSaveKey(key, prefix), serializedSave)
      } catch (cause) {
        throw new BrowserCaseSaveStorageError(
          'write',
          'The investigation could not be saved in this browser.',
          { cause },
        )
      }
    },

    async delete(key: CaseSaveStorageKey): Promise<void> {
      try {
        ;(storage ?? defaultStorage('delete'))
          .removeItem(browserCaseSaveKey(key, prefix))
      } catch (cause) {
        throw new BrowserCaseSaveStorageError(
          'delete',
          'The saved investigation could not be removed from this browser.',
          { cause },
        )
      }
    },
  })
}
