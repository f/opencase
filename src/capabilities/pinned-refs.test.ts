import { describe, expect, it } from 'vitest'

import { CAPABILITY_CATALOG } from './catalog'
import { PINNED_CAPABILITY_REFS } from './pinned-refs'

describe('browser-safe pinned capability refs', () => {
  it('exactly matches the semantic authoring catalog', () => {
    const derived = Object.fromEntries(
      [...CAPABILITY_CATALOG.entries()].map(([specifier, manifest]) => [
        specifier,
        {
          id: manifest.id,
          version: String(manifest.version),
          digest: manifest.digest,
        },
      ]),
    )

    expect(PINNED_CAPABILITY_REFS).toEqual(derived)
    expect(Object.isFrozen(PINNED_CAPABILITY_REFS)).toBe(true)
    expect(Object.values(PINNED_CAPABILITY_REFS).every(Object.isFrozen)).toBe(true)
  })
})
