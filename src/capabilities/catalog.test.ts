import { describe, expect, it } from 'vitest'

import {
  CAPABILITY_CATALOG,
  capabilityVocabulary,
  getCapabilityManifest,
} from './catalog'

describe('trusted capability catalog', () => {
  it('pins semantic manifest content rather than hashing only the specifier', () => {
    const investigation = getCapabilityManifest('investigation@1')
    const artifacts = getCapabilityManifest('artifacts@1')

    expect(investigation?.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(artifacts?.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(investigation?.digest).not.toBe(artifacts?.digest)
    expect(investigation?.templates).toContain('investigation.composite-culprit')
  })

  it('contains every built-in v1 profile and capability', () => {
    expect([...CAPABILITY_CATALOG.keys()]).toEqual([
      'access-control@1',
      'artifacts@1',
      'casebook@1',
      'comms@1',
      'facility-logistics@1',
      'finance@1',
      'generic-actions@1',
      'interview@1',
      'investigation@1',
      'media-forensics@1',
      'stage-automation@1',
      'virtual-web@1',
    ])
  })

  it('builds a vocabulary only from selected manifests', () => {
    const artifacts = getCapabilityManifest('artifacts@1')
    const selected = capabilityVocabulary(artifacts ? [artifacts] : [])

    expect(selected.tools.has('document')).toBe(true)
    expect(selected.tools.has('video')).toBe(false)
    expect(selected.verbs.has('open')).toBe(true)
  })
})
