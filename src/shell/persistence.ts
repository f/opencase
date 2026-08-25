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

  return {
    load: () => {
      try {
        const serialized = (options.storage ?? browserStorage())?.getItem(key)
        if (!serialized) return null
        const candidate = JSON.parse(serialized) as Partial<DesktopLayoutSnapshot>
        if (candidate.schema !== 'detective-desktop-layout/v1') return null
        return candidate as DesktopLayoutSnapshot
      } catch (error) {
        report(error)
        return null
      }
    },
    save: (layout) => {
      try {
        ;(options.storage ?? browserStorage())?.setItem(key, JSON.stringify(layout))
      } catch (error) {
        report(error)
      }
    },
    clear: () => {
      try {
        ;(options.storage ?? browserStorage())?.removeItem(key)
      } catch (error) {
        report(error)
      }
    },
  }
}
