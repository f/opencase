import type { JsonValue } from './types'
import { sha256Text } from './digests'

/** Locale-independent UTF-16/code-unit ordering, matching JSON's string model. */
export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item)) as T
  }

  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(compareCanonicalStrings)) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined) sorted[key] = canonicalize(child)
    }
    return sorted as T
  }

  return value
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256(value: string): string {
  return sha256Text(value)
}

export function hashCanonical(value: JsonValue | object): string {
  return sha256(canonicalJson(value))
}
