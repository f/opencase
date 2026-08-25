import { sha256Text } from '../compiler/digests'

export type CapabilityKind = 'profile' | 'capability'

/**
 * Trusted, versioned vocabulary exposed to case authors. The manifest itself
 * is what is locked into a compiled case: changing any owned token changes
 * the digest even when the human-readable specifier stays the same.
 */
export interface CapabilityManifestDefinition {
  specifier: `${string}@${number}`
  kind: CapabilityKind
  tools: readonly string[]
  verbs: readonly string[]
  templates: readonly string[]
  rerouteProviders: readonly string[]
  /** Trusted host adapters allowed in authored opaque asset references. */
  assetProviders: readonly string[]
}

export interface CapabilityManifest extends CapabilityManifestDefinition {
  id: string
  version: number
  digest: string
}

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort(compareRaw)) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined) output[key] = canonicalize(child)
    }
    return output
  }
  return value
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

function sha256(value: string): string {
  return sha256Text(value)
}

function define(
  definition: CapabilityManifestDefinition,
): CapabilityManifest {
  const separator = definition.specifier.lastIndexOf('@')
  const normalized: CapabilityManifestDefinition = {
    ...definition,
    tools: [...new Set(definition.tools)].sort(compareRaw),
    verbs: [...new Set(definition.verbs)].sort(compareRaw),
    templates: [...new Set(definition.templates)].sort(compareRaw),
    rerouteProviders: [...new Set(definition.rerouteProviders)].sort(compareRaw),
    assetProviders: [...new Set(definition.assetProviders)].sort(compareRaw),
  }
  return Object.freeze({
    ...normalized,
    id: definition.specifier.slice(0, separator),
    version: Number(definition.specifier.slice(separator + 1)),
    digest: sha256(`case-capability-manifest/v1\0${canonicalJson(normalized)}`),
  })
}

const definitions: CapabilityManifestDefinition[] = [
  {
    specifier: 'investigation@1',
    kind: 'profile',
    tools: [],
    verbs: ['observe', 'preserve', 'report-suspect', 'submit-conclusion'],
    templates: [
      'investigation.composite-culprit',
      'investigation.composite-explanation',
    ],
    // `granted` is the explicit route used by headless source tests when a
    // reaction directly grants a source instead of delegating to a service.
    rerouteProviders: ['granted'],
    assetProviders: [],
  },
  {
    specifier: 'comms@1',
    kind: 'capability',
    tools: ['email', 'message', 'phone-export'],
    verbs: ['request'],
    templates: [],
    rerouteProviders: [],
    assetProviders: [],
  },
  {
    specifier: 'contact-directory@1',
    kind: 'capability',
    tools: [],
    verbs: ['locate-contact'],
    templates: [],
    rerouteProviders: [],
    assetProviders: [],
  },
  {
    specifier: 'artifacts@1',
    kind: 'capability',
    tools: ['document', 'image', 'log'],
    verbs: ['observe', 'open', 'preserve'],
    templates: [],
    rerouteProviders: [],
    assetProviders: ['signed-media'],
  },
  {
    specifier: 'virtual-web@1',
    kind: 'capability',
    tools: ['browser'],
    verbs: ['open', 'search'],
    templates: [],
    rerouteProviders: [],
    assetProviders: [],
  },
  {
    specifier: 'casebook@1',
    kind: 'capability',
    tools: [],
    verbs: ['report-suspect', 'submit-conclusion'],
    templates: [],
    rerouteProviders: [],
    assetProviders: [],
  },
  {
    specifier: 'interview@1',
    kind: 'capability',
    tools: ['interview'],
    verbs: ['apologize', 'interview', 'present'],
    templates: [],
    rerouteProviders: [],
    assetProviders: [],
  },
  {
    specifier: 'media-forensics@1',
    kind: 'capability',
    tools: ['metadata', 'video'],
    verbs: ['observe', 'open'],
    templates: ['media.prerecorded-alibi', 'media.timestamp-offset'],
    rerouteProviders: [],
    assetProviders: [],
  },
  {
    specifier: 'stage-automation@1',
    kind: 'capability',
    tools: ['log'],
    verbs: ['request'],
    templates: ['safety.intentional-disable-and-command'],
    rerouteProviders: ['security-export'],
    assetProviders: [],
  },
  {
    specifier: 'finance@1',
    kind: 'capability',
    tools: ['account-history'],
    verbs: ['search'],
    templates: [],
    rerouteProviders: ['archive-search'],
    assetProviders: [],
  },
  {
    specifier: 'access-control@1',
    kind: 'capability',
    tools: ['log'],
    verbs: ['request'],
    templates: [],
    rerouteProviders: ['security-export'],
    assetProviders: [],
  },
  {
    specifier: 'facility-logistics@1',
    kind: 'capability',
    tools: ['physical-evidence'],
    verbs: ['request', 'search'],
    templates: [],
    rerouteProviders: ['confidential-blue-route'],
    assetProviders: [],
  },
  {
    specifier: 'generic-actions@1',
    kind: 'capability',
    tools: [],
    verbs: [
      'apologize',
      'interview',
      'observe',
      'open',
      'present',
      'preserve',
      'report-suspect',
      'request',
      'search',
      'submit-conclusion',
    ],
    templates: [],
    rerouteProviders: [],
    assetProviders: [],
  },
]

export const CAPABILITY_CATALOG: ReadonlyMap<string, CapabilityManifest> = new Map(
  definitions
    .map(define)
    .sort((left, right) => compareRaw(left.specifier, right.specifier))
    .map((manifest) => [manifest.specifier, manifest]),
)

export function getCapabilityManifest(specifier: string): CapabilityManifest | undefined {
  return CAPABILITY_CATALOG.get(specifier)
}

export interface CapabilityVocabulary {
  tools: ReadonlySet<string>
  verbs: ReadonlySet<string>
  templates: ReadonlySet<string>
  rerouteProviders: ReadonlySet<string>
  assetProviders: ReadonlySet<string>
}

export function capabilityVocabulary(
  manifests: readonly CapabilityManifest[],
): CapabilityVocabulary {
  return {
    tools: new Set(manifests.flatMap((manifest) => manifest.tools)),
    verbs: new Set(manifests.flatMap((manifest) => manifest.verbs)),
    templates: new Set(manifests.flatMap((manifest) => manifest.templates)),
    rerouteProviders: new Set(
      manifests.flatMap((manifest) => manifest.rerouteProviders),
    ),
    assetProviders: new Set(
      manifests.flatMap((manifest) => manifest.assetProviders),
    ),
  }
}
