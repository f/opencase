import type { JsonObject, JsonValue } from '../kernel'
import type { LocalizedText } from '../compiler'

export const CASE_RUNTIME_SCHEMA = 'case-runtime/catalog-v1' as const

export const CASE_COMMANDS = {
  observeEvidence: 'case.evidence.observe',
  performAction: 'case.action.perform',
  attemptDeduction: 'case.deduction.attempt',
} as const

export const CASE_EVENTS = {
  evidenceObserved: 'case.evidence.observed',
  actionPerformed: 'case.action.performed',
  deductionSupported: 'case.deduction.supported',
  deadlineReached: 'case.deadline.reached',
  contactChanged: 'case.contact.changed',
  routeProgressed: 'case.route.progressed',
} as const

export const CASE_SLOT = 'caseRuntime' as const

export interface RuntimeProofTerm {
  readonly type: 'observation' | 'deduction'
  readonly id: string
}

export type RuntimeProofCheck =
  | { readonly type: 'equals'; readonly ref: string; readonly value: JsonValue }
  | { readonly type: 'notEquals'; readonly ref: string; readonly value: JsonValue }
  | { readonly type: 'numberLessThan'; readonly ref: string; readonly value: number }
  | { readonly type: 'numberGreaterThan'; readonly ref: string; readonly value: number }
  | { readonly type: 'arrayContains'; readonly ref: string; readonly value: JsonValue }
  | { readonly type: 'arrayCountEquals'; readonly ref: string; readonly count: number }
  | {
      readonly type: 'timeOffsetEquals'
      readonly shownRef: string
      readonly offsetRef: string
      readonly expected: string
    }
  | {
      readonly type: 'beforeValue'
      readonly leftRef: string
      readonly rightValue: string
    }
  | { readonly type: 'beforeRef'; readonly leftRef: string; readonly rightRef: string }
  | { readonly type: 'afterValue'; readonly leftRef: string; readonly rightValue: string }
  | { readonly type: 'afterRef'; readonly leftRef: string; readonly rightRef: string }

export interface RuntimeProofAlternative {
  readonly terms: readonly RuntimeProofTerm[]
  readonly checks: readonly RuntimeProofCheck[]
}

export interface RuntimeObservationDefinition {
  readonly evidenceId: string
  readonly field: string
  readonly value: JsonValue
  readonly sourceAssertionId: string
}

export type CaseAssetKind = 'image' | 'audio' | 'video' | 'document' | 'file'

/** Opaque player handle. It intentionally cannot carry a path, URI or provider reference. */
export interface PublicAssetHandle {
  readonly id: string
  readonly kind: CaseAssetKind
  readonly mimeType: string
}

export interface RuntimeEvidenceDefinition {
  readonly tool: string
  readonly assets: readonly PublicAssetHandle[]
  readonly presentation?: {
    readonly title: LocalizedText
    readonly description?: LocalizedText
    readonly findings: Readonly<Record<string, LocalizedText>>
  }
}

export interface RuntimeActorConversationDefinition {
  readonly public: boolean
  readonly contactInitial: 'hidden' | 'listed'
  readonly presentation: {
    readonly name?: LocalizedText
    readonly displayName?: LocalizedText
    readonly role?: LocalizedText
    readonly status?: LocalizedText
    readonly phone?: string
    readonly operator?: string
    readonly contactSource?: LocalizedText
    readonly pronouns?: LocalizedText
    readonly client?: boolean
  }
  readonly initialState: string
  readonly states: Readonly<Record<string, {
    readonly canTalk: boolean
    readonly reason?: LocalizedText
  }>>
  readonly channels: Readonly<Record<string, 'actor' | 'target' | 'from'>>
  readonly allowWhileUnavailable: readonly string[]
}

export interface RuntimeAffordanceDefinition {
  readonly label: LocalizedText
  readonly result?: LocalizedText
  readonly risk: 'normal' | 'consequential' | 'terminal'
  readonly confirmation?: LocalizedText
  readonly surface: 'phone' | 'web' | 'files' | 'casebook' | 'inbox'
  readonly intent:
    | { readonly kind: 'action'; readonly action: CaseAction }
    | { readonly kind: 'deduce'; readonly deductionId: string }
  readonly exclusive: boolean
  readonly interaction?: {
    readonly kind: 'async-message'
    readonly channel: string
    readonly request: LocalizedText
    readonly context?:
      | { readonly kind: 'opening-call' }
      | { readonly kind: 'evidence'; readonly ref: string }
      | { readonly kind: 'completed-affordance'; readonly ref: string }
  }
  readonly cost?: {
    readonly clock: 'case-time'
    readonly milliseconds: number
  }
  readonly once: boolean
}

export interface RuntimeDeductionDefinition {
  readonly conclusion: JsonObject
  readonly proofAlternatives: readonly RuntimeProofAlternative[]
  readonly requiredDeductions: readonly string[]
}

export type RuntimeObjectiveCondition =
  | { readonly type: 'all'; readonly conditions: readonly RuntimeObjectiveCondition[] }
  | { readonly type: 'any'; readonly conditions: readonly RuntimeObjectiveCondition[] }
  | { readonly type: 'not'; readonly condition: RuntimeObjectiveCondition }
  | { readonly type: 'observed'; readonly observationId: string }
  | { readonly type: 'supported'; readonly deductionId: string }
  | { readonly type: 'flag'; readonly flagId: string; readonly marked: boolean }
  | { readonly type: 'schedule'; readonly scheduleId: string; readonly active: boolean }

export interface RuntimeOutcomeDefinition {
  readonly id: string
  readonly title: LocalizedText
  readonly body?: LocalizedText
  readonly priority: number
  readonly requiredObjectives: readonly string[]
  readonly excludedObjectives: readonly string[]
  readonly finalTargets: readonly string[]
  readonly whenMarked?: string
  readonly whenAnyMarked: readonly string[]
}

export interface RuntimeAssessmentDefinition {
  readonly maxScore: number
  readonly bands: readonly {
    readonly minScore: number
    readonly label: LocalizedText
  }[]
  readonly categories: readonly {
    readonly id: string
    readonly label: LocalizedText
    readonly criteria: readonly {
      readonly id: string
      readonly points: number
      readonly when: RuntimeObjectiveCondition
      readonly met: LocalizedText
      readonly missed: LocalizedText
    }[]
  }[]
}

export interface RuntimeDeadlineDefinition {
  readonly label?: LocalizedText
}

/**
 * Private, compiler-produced data interpreted by the fixed investigation@1
 * capability. It is stored in capabilityState and never projected wholesale.
 */
export interface CaseRuntimeCatalog {
  readonly schema: typeof CASE_RUNTIME_SCHEMA
  readonly evidence: Readonly<Record<string, RuntimeEvidenceDefinition>>
  readonly actors: Readonly<Record<string, RuntimeActorConversationDefinition>>
  readonly affordances: Readonly<Record<string, RuntimeAffordanceDefinition>>
  readonly observations: Readonly<Record<string, RuntimeObservationDefinition>>
  readonly deductions: Readonly<Record<string, RuntimeDeductionDefinition>>
  readonly allowedActions: readonly string[]
  readonly allowedFinalTargets: readonly string[]
  readonly finalConclusion: 'first-write-wins' | 'replaceable'
  readonly objectives: Readonly<Record<string, RuntimeObjectiveCondition>>
  readonly outcomes: readonly RuntimeOutcomeDefinition[]
  readonly assessment?: RuntimeAssessmentDefinition
  readonly deadlines: Readonly<Record<string, RuntimeDeadlineDefinition>>
}

export interface CaseAction {
  readonly action: string
  readonly target?: string
  readonly actor?: string
  readonly from?: string
  readonly topic?: string
  readonly evidence?: string
  readonly tone?: string
  readonly query?: string
  readonly ref?: string
}

export interface PublicAsyncMessageInteraction {
  readonly kind: 'async-message'
  readonly channel: string
  readonly request?: string
  readonly requestKey?: string
  readonly context?:
    | { readonly kind: 'opening-call' }
    | { readonly kind: 'evidence'; readonly ref: string }
    | { readonly kind: 'completed-affordance'; readonly ref: string }
}

export interface PublicCaseRuntimeState {
  readonly schema: 'case-runtime/public-v1'
  readonly status: 'active' | 'ended'
  readonly revision: number
  readonly case: {
    readonly id: string
    readonly version: string
    readonly digest: string
  }
  readonly clocks: {
    readonly caseTimeMs: number
    readonly activeTimeMs: number
    readonly wallTimeMs: number
  }
  /** Explicitly authored public commands that are currently offered. */
  readonly affordances: readonly {
    readonly id: string
    readonly surface: RuntimeAffordanceDefinition['surface']
    readonly intent: RuntimeAffordanceDefinition['intent']
    readonly cost?: RuntimeAffordanceDefinition['cost']
    readonly label?: string
    readonly labelKey?: string
    readonly risk: RuntimeAffordanceDefinition['risk']
    readonly confirmation?: string
    readonly confirmationKey?: string
    readonly interaction?: PublicAsyncMessageInteraction
  }[]
  readonly completedAffordances: readonly {
    readonly id: string
    readonly surface: RuntimeAffordanceDefinition['surface']
    readonly intent: RuntimeAffordanceDefinition['intent']
    readonly cost?: RuntimeAffordanceDefinition['cost']
    readonly label?: string
    readonly labelKey?: string
    readonly result?: string
    readonly resultKey?: string
    readonly risk: RuntimeAffordanceDefinition['risk']
    readonly completedAtMs: number
    readonly interaction?: PublicAsyncMessageInteraction
    /** Public contact ids listed by this exact accepted command. */
    readonly contactsListed?: readonly string[]
  }[]
  /** Supported deductions with copy retained from an explicit public affordance. */
  readonly supportedDeductions: readonly {
    readonly id: string
    readonly label?: string
    readonly labelKey?: string
  }[]
  readonly actors: readonly {
    readonly id: string
    readonly name?: string
    readonly nameKey?: string
    readonly displayName?: string
    readonly displayNameKey?: string
    readonly role?: string
    readonly roleKey?: string
    readonly status?: string
    readonly statusKey?: string
    readonly phone?: string
    readonly operator?: string
    readonly contactSource?: string
    readonly contactSourceKey?: string
    readonly pronouns?: string
    readonly pronounsKey?: string
    readonly client?: boolean
    readonly conversation: {
      readonly state: string
      readonly canTalk: boolean
      readonly channels: readonly {
        readonly action: string
        readonly actorField: 'actor' | 'target' | 'from'
        readonly available: boolean
      }[]
      readonly reason?: string
      readonly reasonKey?: string
    }
  }[]
  readonly evidence: readonly {
    readonly id: string
    readonly tool: string
    readonly observed: boolean
    readonly assets: readonly PublicAssetHandle[]
    readonly title?: string
    readonly titleKey?: string
    readonly description?: string
    readonly descriptionKey?: string
    readonly findings: readonly {
      readonly field: string
      readonly text?: string
      readonly textKey?: string
    }[]
  }[]
  readonly deadlines: readonly {
    readonly id: string
    readonly title?: string
    readonly titleKey?: string
    readonly clock: 'case' | 'active' | 'wall'
    readonly dueAtMs: number
    readonly remainingMs: number
    readonly status: 'scheduled' | 'fired' | 'cancelled' | 'missed'
  }[]
  readonly observations: readonly JsonObject[]
  readonly hypotheses: readonly JsonObject[]
  readonly finalConclusion?: { readonly target: string }
  readonly outcome?: {
    readonly id: string
    /** Present when the caller supplied copy or the source used a direct string. */
    readonly title?: string
    /** Present only after this outcome is revealed and no presentation catalog was supplied. */
    readonly textKey?: string
    readonly body?: string
    readonly bodyKey?: string
    readonly assessment?: {
      readonly score: number
      readonly maxScore: number
      readonly bandLabel?: string
      readonly bandLabelKey?: string
      readonly categories: readonly {
        readonly label?: string
        readonly labelKey?: string
        readonly score: number
        readonly maxScore: number
        readonly details: readonly {
          readonly status: 'met' | 'missed'
          readonly score: number
          readonly maxScore: number
          readonly text?: string
          readonly textKey?: string
        }[]
      }[]
    }
  }
}

/** Host-owned copy. It is never stored in the kernel or event log. */
export interface CasePresentationCatalog {
  readonly defaultLocale: string
  readonly locale: string
  readonly messages: Readonly<Record<string, string>>
}
