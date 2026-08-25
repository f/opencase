export const CASE_BOARD_STATE_SCHEMA = 'detective-case-board/v1' as const

const MAX_PIN_ID_LENGTH = 240
const MAX_POSITIONS = 128
const MAX_CONNECTIONS = 256

export interface CaseBoardPosition {
  /** Normalized horizontal position within the board, from 0 to 1. */
  readonly x: number
  /** Normalized vertical position within the board, from 0 to 1. */
  readonly y: number
}

export interface CaseBoardConnection {
  readonly from: string
  readonly to: string
}

/**
 * Detective-authored presentation state. It is deliberately separate from
 * the case runtime save: moving a card or tying a string never changes facts.
 */
export interface CaseBoardState {
  readonly schema: typeof CASE_BOARD_STATE_SCHEMA
  readonly positions: Readonly<Record<string, CaseBoardPosition>>
  readonly connections: readonly CaseBoardConnection[]
}

export interface CaseBoardStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface CaseBoardPersistence {
  load: () => CaseBoardState
  save: (state: CaseBoardState) => void
  clear: () => void
}

export interface CaseBoardPersistenceOptions {
  readonly storage?: CaseBoardStorage
  readonly onError?: (error: unknown) => void
}

export function emptyCaseBoardState(): CaseBoardState {
  return {
    schema: CASE_BOARD_STATE_SCHEMA,
    positions: {},
    connections: [],
  }
}

function browserStorage(): CaseBoardStorage | undefined {
  if (typeof window === 'undefined') return undefined
  return window.localStorage
}

function validPinId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PIN_ID_LENGTH
}

function normalizedNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

function canonicalConnection(from: string, to: string): CaseBoardConnection {
  return from < to ? { from, to } : { from: to, to: from }
}

/** Drops malformed or oversized browser data before it reaches the UI. */
export function sanitizeCaseBoardState(value: unknown): CaseBoardState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyCaseBoardState()
  }

  const candidate = value as {
    readonly schema?: unknown
    readonly positions?: unknown
    readonly connections?: unknown
  }
  if (candidate.schema !== CASE_BOARD_STATE_SCHEMA) return emptyCaseBoardState()

  const positions: Record<string, CaseBoardPosition> = {}
  if (candidate.positions && typeof candidate.positions === 'object' && !Array.isArray(candidate.positions)) {
    for (const [pinId, rawPosition] of Object.entries(candidate.positions).slice(0, MAX_POSITIONS)) {
      if (!validPinId(pinId) || !rawPosition || typeof rawPosition !== 'object' || Array.isArray(rawPosition)) {
        continue
      }
      const position = rawPosition as { readonly x?: unknown; readonly y?: unknown }
      const x = normalizedNumber(position.x)
      const y = normalizedNumber(position.y)
      if (x === undefined || y === undefined) continue
      positions[pinId] = { x, y }
    }
  }

  const connections: CaseBoardConnection[] = []
  const seen = new Set<string>()
  if (Array.isArray(candidate.connections)) {
    for (const rawConnection of candidate.connections) {
      if (connections.length >= MAX_CONNECTIONS) break
      if (!rawConnection || typeof rawConnection !== 'object' || Array.isArray(rawConnection)) continue
      const connection = rawConnection as { readonly from?: unknown; readonly to?: unknown }
      if (!validPinId(connection.from) || !validPinId(connection.to) || connection.from === connection.to) continue
      const canonical = canonicalConnection(connection.from, connection.to)
      const key = `${canonical.from}\u0000${canonical.to}`
      if (seen.has(key)) continue
      seen.add(key)
      connections.push(canonical)
    }
  }

  return {
    schema: CASE_BOARD_STATE_SCHEMA,
    positions,
    connections,
  }
}

export function createCaseBoardPersistence(
  key: string,
  options: CaseBoardPersistenceOptions = {},
): CaseBoardPersistence {
  if (key.trim().length === 0) throw new Error('Case board storage key must not be empty')
  const report = (error: unknown) => options.onError?.(error)
  const storage = () => options.storage ?? browserStorage()

  return {
    load: () => {
      try {
        const serialized = storage()?.getItem(key)
        return serialized ? sanitizeCaseBoardState(JSON.parse(serialized)) : emptyCaseBoardState()
      } catch (error) {
        report(error)
        return emptyCaseBoardState()
      }
    },
    save: (state) => {
      try {
        storage()?.setItem(key, JSON.stringify(sanitizeCaseBoardState(state)))
      } catch (error) {
        report(error)
      }
    },
    clear: () => {
      try {
        storage()?.removeItem(key)
      } catch (error) {
        report(error)
      }
    },
  }
}

/** Removes browser-side references that are no longer present in public UI data. */
export function reconcileCaseBoardState(
  state: CaseBoardState,
  visiblePinIds: ReadonlySet<string>,
): CaseBoardState {
  const positions = Object.fromEntries(Object.entries(state.positions).filter(([pinId]) => (
    visiblePinIds.has(pinId)
  )))
  const connections = state.connections.filter(({ from, to }) => (
    visiblePinIds.has(from) && visiblePinIds.has(to)
  ))
  if (
    Object.keys(positions).length === Object.keys(state.positions).length
    && connections.length === state.connections.length
  ) return state
  return {
    schema: CASE_BOARD_STATE_SCHEMA,
    positions,
    connections,
  }
}

export function toggleCaseBoardConnection(
  connections: readonly CaseBoardConnection[],
  from: string,
  to: string,
): readonly CaseBoardConnection[] {
  if (!validPinId(from) || !validPinId(to) || from === to) return connections
  const candidate = canonicalConnection(from, to)
  const existingIndex = connections.findIndex((connection) => (
    connection.from === candidate.from && connection.to === candidate.to
  ))
  if (existingIndex >= 0) return connections.filter((_, index) => index !== existingIndex)
  return [...connections, candidate]
}
