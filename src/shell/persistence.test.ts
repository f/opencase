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

  it('copies a legacy brand key forward and clears both namespaces', () => {
    const values = new Map<string, string>([['dedektif:layout', JSON.stringify(layout)]])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const persistence = createLocalStorageLayoutPersistence('opencase:layout', {
      storage,
      legacyKey: 'dedektif:layout',
    })

    expect(persistence.load?.()).toEqual(layout)
    expect(values.get('opencase:layout')).toBe(JSON.stringify(layout))
    persistence.clear?.()
    expect(values.has('opencase:layout')).toBe(false)
    expect(values.has('dedektif:layout')).toBe(false)
  })

  it('keeps readable legacy layout data when its rewrite is blocked', () => {
    const onError = vi.fn()
    const storage = {
      getItem: (key: string) => key === 'dedektif:layout' ? JSON.stringify(layout) : null,
      setItem: () => { throw new Error('blocked') },
      removeItem: vi.fn(),
    }
    const persistence = createLocalStorageLayoutPersistence('opencase:layout', {
      storage,
      legacyKey: 'dedektif:layout',
      onError,
    })

    expect(persistence.load?.()).toEqual(layout)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('does not delete the current layout when deleting its legacy fallback fails', () => {
    const removed: string[] = []
    const storage = {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: (key: string) => {
        if (key === 'dedektif:layout') throw new Error('blocked')
        removed.push(key)
      },
    }
    const persistence = createLocalStorageLayoutPersistence('opencase:layout', {
      storage,
      legacyKey: 'dedektif:layout',
    })

    persistence.clear?.()
    expect(removed).toEqual([])
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
