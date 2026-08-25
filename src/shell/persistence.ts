import type {
  DesktopLayoutPersistence,
  DesktopLayoutSnapshot,
} from './types'

export interface DesktopLayoutStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface LocalStorageLayoutOptions {
  storage?: DesktopLayoutStorage
  /** Previous brand-scoped key read once and copied forward when the new key is empty. */
  legacyKey?: string
  onError?: (error: unknown) => void
}

function browserStorage(): DesktopLayoutStorage | undefined {
  if (typeof window === 'undefined') return undefined
  return window.localStorage
}

/**
 * Creates opt-in persistence for desktop geometry only. The caller should use
 * a case-scoped key when it wants each case to remember its own workspace.
 */
export function createLocalStorageLayoutPersistence(
  key: string,
  options: LocalStorageLayoutOptions = {},
): DesktopLayoutPersistence {
  if (key.trim().length === 0) {
    throw new Error('Desktop layout storage key must not be empty')
  }

  const report = (error: unknown) => options.onError?.(error)
  const storage = () => options.storage ?? browserStorage()

  const parse = (serialized: string | null): DesktopLayoutSnapshot | null => {
    if (!serialized) return null
    const candidate = JSON.parse(serialized) as Partial<DesktopLayoutSnapshot>
    if (candidate.schema !== 'detective-desktop-layout/v1') return null
    return candidate as DesktopLayoutSnapshot
  }

  return {
    load: () => {
      try {
        const activeStorage = storage()
        const currentSerialized = activeStorage?.getItem(key) ?? null
        if (currentSerialized !== null) return parse(currentSerialized)
        if (!options.legacyKey || options.legacyKey === key) return null
        const legacy = parse(activeStorage?.getItem(options.legacyKey) ?? null)
        if (legacy) {
          try {
            activeStorage?.setItem(key, JSON.stringify(legacy))
          } catch (error) {
            report(error)
          }
        }
        return legacy
      } catch (error) {
        report(error)
        return null
      }
    },
    save: (layout) => {
      try {
        storage()?.setItem(key, JSON.stringify(layout))
      } catch (error) {
        report(error)
      }
    },
    clear: () => {
      try {
        const activeStorage = storage()
        if (options.legacyKey && options.legacyKey !== key) {
          activeStorage?.removeItem(options.legacyKey)
        }
        activeStorage?.removeItem(key)
      } catch (error) {
        report(error)
      }
    },
  }
}
