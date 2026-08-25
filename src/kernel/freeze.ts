import type { JsonValue } from './types'

export function deepFreeze<T>(value: T): Readonly<T> {
  const seen = new WeakSet<object>()

  const freeze = (candidate: unknown): void => {
    if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) return
    if (seen.has(candidate)) return
    seen.add(candidate)
    for (const child of Reflect.ownKeys(candidate)) {
      freeze((candidate as Record<PropertyKey, unknown>)[child])
    }
    Object.freeze(candidate)
  }

  freeze(value)
  return value as Readonly<T>
}

export function cloneFrozen<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value))
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.entries(value).every(([key, child]) => key !== '__proto__' && isJsonValue(child))
}

export function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (!isJsonValue(value)) throw new Error(`${label} must be JSON-safe`)
}

export function stableStringify(value: unknown): string {
  const canonical = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonical)
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([key, child]) => [key, canonical(child)]),
      )
    }
    return candidate
  }
  return JSON.stringify(canonical(value))
}

/** Locale-independent ordering used by every canonical kernel sort. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
