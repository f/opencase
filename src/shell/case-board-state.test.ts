import { describe, expect, it, vi } from 'vitest'

import {
  CASE_BOARD_STATE_SCHEMA,
  createCaseBoardPersistence,
  reconcileCaseBoardState,
  sanitizeCaseBoardState,
  toggleCaseBoardConnection,
  type CaseBoardStorage,
} from './case-board-state'

function memoryStorage(): CaseBoardStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

describe('case board shell state', () => {
  it('sanitizes positions and canonicalizes unique, non-self connections', () => {
    const state = sanitizeCaseBoardState({
      schema: CASE_BOARD_STATE_SCHEMA,
      positions: {
        'person:deniz': { x: -4, y: 1.4 },
        'evidence:photo': { x: 0.42, y: 0.3 },
        invalid: { x: Number.NaN, y: 0.2 },
      },
      connections: [
        { from: 'person:deniz', to: 'evidence:photo' },
        { from: 'evidence:photo', to: 'person:deniz' },
        { from: 'person:deniz', to: 'person:deniz' },
        { from: '', to: 'evidence:photo' },
      ],
    })

    expect(state.positions).toEqual({
      'person:deniz': { x: 0, y: 1 },
      'evidence:photo': { x: 0.42, y: 0.3 },
    })
    expect(state.connections).toEqual([{
      from: 'evidence:photo',
      to: 'person:deniz',
    }])
  })

  it('never restores stale pins or links outside the current public palette', () => {
    const state = sanitizeCaseBoardState({
      schema: CASE_BOARD_STATE_SCHEMA,
      positions: {
        'person:visible': { x: 0.2, y: 0.2 },
        'person:hidden': { x: 0.8, y: 0.8 },
      },
      connections: [{ from: 'person:visible', to: 'person:hidden' }],
    })

    expect(reconcileCaseBoardState(state, new Set(['person:visible']))).toEqual({
      schema: CASE_BOARD_STATE_SCHEMA,
      positions: { 'person:visible': { x: 0.2, y: 0.2 } },
      connections: [],
    })
  })

  it('persists only sanitized UI state and survives blocked storage', () => {
    const storage = memoryStorage()
    const persistence = createCaseBoardPersistence('board:one', { storage })
    persistence.save({
      schema: CASE_BOARD_STATE_SCHEMA,
      positions: { pin: { x: 0.3, y: 0.4 } },
      connections: [],
    })

    expect(persistence.load().positions.pin).toEqual({ x: 0.3, y: 0.4 })
    expect(storage.values.get('board:one')).not.toContain('deliveryUrl')
    persistence.clear()
    expect(storage.values.has('board:one')).toBe(false)

    const onError = vi.fn()
    const blocked = createCaseBoardPersistence('board:blocked', {
      storage: {
        getItem: () => { throw new Error('blocked') },
        setItem: () => { throw new Error('blocked') },
        removeItem: () => { throw new Error('blocked') },
      },
      onError,
    })
    expect(blocked.load().positions).toEqual({})
    blocked.save({ schema: CASE_BOARD_STATE_SCHEMA, positions: {}, connections: [] })
    blocked.clear()
    expect(onError).toHaveBeenCalledTimes(3)
  })

  it('toggles unordered pairs without allowing a self-link', () => {
    const connected = toggleCaseBoardConnection([], 'person:one', 'evidence:two')
    expect(connected).toEqual([{ from: 'evidence:two', to: 'person:one' }])
    expect(toggleCaseBoardConnection(connected, 'evidence:two', 'person:one')).toEqual([])
    expect(toggleCaseBoardConnection(connected, 'person:one', 'person:one')).toBe(connected)
  })
})
