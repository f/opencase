import { describe, expect, it, vi } from 'vitest'
import { createLocalStorageLayoutPersistence } from './persistence'
import type { DesktopLayoutSnapshot } from './types'

const layout: DesktopLayoutSnapshot = {
  schema: 'detective-desktop-layout/v1',
  activeWindowId: 'notes',
  windows: {
    notes: {
      bounds: { x: 40, y: 30, width: 520, height: 360 },
      mode: 'normal',
      resumeMode: 'normal',
      open: true,
      zIndex: 24,
    },
  },
}

describe('desktop layout persistence', () => {
  it('round-trips the versioned layout under an injected key', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const persistence = createLocalStorageLayoutPersistence('case-a:layout', { storage })

    persistence.save?.(layout)

    expect(values.has('case-a:layout')).toBe(true)
    expect(persistence.load?.()).toEqual(layout)
    values.set('other-case:layout', 'untouched')
    persistence.clear?.()
    expect(persistence.load?.()).toBeNull()
    expect(values.get('other-case:layout')).toBe('untouched')
  })

  it('rejects unknown schemas without trying to migrate case data', () => {
    const storage = {
      getItem: () => JSON.stringify({ schema: 'kernel-save@1', events: [] }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    const persistence = createLocalStorageLayoutPersistence('layout', { storage })
    expect(persistence.load?.()).toBeNull()
  })

  it('reports malformed storage without breaking the shell', () => {
    const onError = vi.fn()
    const storage = {
      getItem: () => '{',
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    const persistence = createLocalStorageLayoutPersistence('layout', { storage, onError })
    expect(persistence.load?.()).toBeNull()
    expect(onError).toHaveBeenCalledOnce()
  })
})
