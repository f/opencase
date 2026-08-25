import type { CapabilityDefinition, CapabilityRef } from '../kernel'
import { CAPABILITY_CATALOG } from '../capabilities'

import { caseCommandDeciders } from './deciders'

/**
 * Engine-owned allow-list. Digests are pinned independently from case input;
 * a case cannot bless an unknown implementation by supplying its own digest.
 */
export type TrustedCapabilitySpecifier = `${string}@${number}`

export const TRUSTED_CAPABILITY_REFS = Object.freeze(
  Object.fromEntries(
    [...CAPABILITY_CATALOG.values()].map((manifest) => [
      manifest.specifier,
      Object.freeze({
        id: manifest.id,
        version: String(manifest.version),
        digest: manifest.digest,
      }),
    ]),
  ),
) as Readonly<Record<TrustedCapabilitySpecifier, CapabilityRef>>

export const INVESTIGATION_CAPABILITY = TRUSTED_CAPABILITY_REFS['investigation@1']

export function assertTrustedCapabilityLocks(locks: readonly CapabilityRef[]): void {
  for (const lock of locks) {
    const specifier = `${lock.id}@${lock.version}` as TrustedCapabilitySpecifier
    const trusted = TRUSTED_CAPABILITY_REFS[specifier]
    if (!trusted) throw new Error(`Unsupported capability lock ${specifier}`)
    if (trusted.digest !== lock.digest) {
      throw new Error(`Capability digest mismatch for ${specifier}`)
    }
  }
  if (!locks.some(({ id, version }) => id === 'investigation' && version === '1')) {
    throw new Error('Case runtime requires investigation@1')
  }
}

export function trustedCapabilityDefinitions(): readonly CapabilityDefinition[] {
  return (Object.keys(TRUSTED_CAPABILITY_REFS) as TrustedCapabilitySpecifier[]).map(
    (specifier): CapabilityDefinition => {
      const ref = TRUSTED_CAPABILITY_REFS[specifier]
      return {
        ...ref,
        commands: specifier === 'investigation@1' ? caseCommandDeciders : {},
      }
    },
  )
}
