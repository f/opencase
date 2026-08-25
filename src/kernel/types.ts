export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export const KERNEL_CAPABILITY = {
  id: 'kernel',
  version: '1',
  digest: 'builtin:kernel-v1',
} as const

export interface CapabilityRef {
  readonly id: string
  readonly version: string
  readonly digest: string
}

export function capabilityKey(ref: CapabilityRef): string {
  return `${ref.id}@${ref.version}`
}

export type AssertionPolarity = 'affirm' | 'deny'
export type AssertionVisibility = 'public' | 'hidden'

/** Reserved context IDs. Case packs may additionally declare arbitrary source:* and perspective:* contexts. */
export const ASSERTION_CONTEXTS = {
  WORLD: 'world',
  PLAYER_OBSERVED: 'player:observed',
  PLAYER_HYPOTHESIZED: 'player:hypothesized',
} as const

export type AssertionContextId = string

/** Minimal declarative ontology primitives consumed by a compiler-produced IR. */
export interface TypeDefinition {
  readonly id: string
  readonly parentId?: string
}

export interface EntityDefinition {
  readonly id: string
  readonly typeId: string
  readonly data?: JsonObject
}

export type RelationCardinality = 'one_per_context' | 'many_per_context'

export interface RelationDefinition {
  readonly id: string
  readonly cardinality: RelationCardinality
}

export interface ContextDefinition {
  readonly id: AssertionContextId
  readonly kind?: 'world' | 'observed' | 'hypothesized' | 'perspective' | 'source' | 'other'
  readonly data?: JsonObject
}

export type Type = TypeDefinition
export type Entity = EntityDefinition
export type Relation = RelationDefinition
export type Context = ContextDefinition

/**
 * Assertions carry no implicit context. The containing context is the boundary:
 * private world truth, player knowledge/hypotheses, a source, or a perspective.
 */
export interface AssertionDraft {
  readonly id: string
  readonly relation: string
  readonly key: JsonObject
  readonly value: JsonValue
  readonly polarity: AssertionPolarity
  readonly confidence?: number
  readonly visibility?: AssertionVisibility
  readonly provenance?: JsonObject
  /** The time/interval the claim is about. Never inferred from event time. */
  readonly validity: JsonObject
  /** When the claim was made/recorded. Kernel fills this on record when omitted. */
  readonly assertedAt?: JsonObject
}

export interface Assertion extends Omit<AssertionDraft, 'assertedAt'> {
  readonly assertedAt: JsonObject
}

export interface AssertionStores {
  readonly contexts: Readonly<Record<AssertionContextId, readonly Assertion[]>>
}

export interface AssertionContextRef {
  readonly contextId: AssertionContextId
}

/** @deprecated Prefer AssertionContextRef. */
export type AssertionStoreRef = AssertionContextRef

export type AssertionQuery = AssertionContextRef & {
  readonly relation: string
  readonly key?: JsonObject
  readonly value?: JsonValue
}

export type AssertionQueryStatus = 'affirmed' | 'denied' | 'unknown' | 'conflicted'

export interface AssertionQueryResult {
  readonly status: AssertionQueryStatus
  readonly supporting: readonly Assertion[]
  readonly refuting: readonly Assertion[]
}

export interface InitialAssertionStores {
  readonly contexts: Readonly<Record<AssertionContextId, readonly AssertionDraft[]>>
}

export type ScheduleClock = 'case' | 'active' | 'wall'
export type ScheduleDeliveryPolicy = 'immediate' | 'on_resume'
export type ScheduleStatus = 'scheduled' | 'fired' | 'cancelled' | 'missed'

export interface ScheduledEvent {
  readonly type: string
  readonly payload?: JsonObject
  /** Defaults to the kernel capability for kernel.* events. */
  readonly capability?: CapabilityRef
}

export interface SchedulePlan {
  readonly id: string
  readonly clock: ScheduleClock
  /** Absolute value on the selected clock. Mutually exclusive with afterMs. */
  readonly dueAtMs?: number
  /** Offset from the selected clock when the schedule is installed. */
  readonly afterMs?: number
  readonly deliveryPolicy?: ScheduleDeliveryPolicy
  readonly maximumLatenessMs?: number
  readonly event: ScheduledEvent
  readonly missedEvent?: ScheduledEvent
  /** Safe presentation metadata only; delivery payloads are never projected. */
  readonly publicData?: JsonObject
}

export interface ScheduleState {
  readonly id: string
  readonly clock: ScheduleClock
  readonly dueAtMs: number
  readonly deliveryPolicy: ScheduleDeliveryPolicy
  readonly maximumLatenessMs?: number
  readonly event: ScheduledEvent
  readonly missedEvent?: ScheduledEvent
  readonly publicData?: JsonObject
  readonly generation: number
  readonly status: ScheduleStatus
  readonly deliveredGeneration?: number
}

export type RuleCompareOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'

export type RuleCondition =
  | { readonly type: 'always' }
  | { readonly type: 'all'; readonly conditions: readonly RuleCondition[] }
  | { readonly type: 'any'; readonly conditions: readonly RuleCondition[] }
  | { readonly type: 'not'; readonly condition: RuleCondition }
  | {
      readonly type: 'event.field'
      readonly path: string
      readonly operator?: RuleCompareOperator
      readonly value: JsonValue
    }
  | {
      readonly type: 'state.slot'
      readonly path: string
      readonly operator?: RuleCompareOperator
      readonly value: JsonValue
    }
  | {
      readonly type: 'capability.state'
      readonly capability: CapabilityRef
      readonly path?: string
      readonly operator?: RuleCompareOperator
      readonly value: JsonValue
    }
  | {
      readonly type: 'assertion'
      readonly query: AssertionQuery
      readonly status: AssertionQueryStatus
    }
  | {
      readonly type: 'schedule'
      readonly scheduleId: string
      readonly status: ScheduleStatus
    }
  | {
      readonly type: 'clock'
      readonly clock: ScheduleClock
      readonly operator: RuleCompareOperator
      readonly value: number
    }

export type RuleEffect =
  | { readonly type: 'state.write'; readonly path: string; readonly value: JsonValue }
  | { readonly type: 'state.adjust'; readonly path: string; readonly by: number }
  | { readonly type: 'clock.advance'; readonly clock: 'case'; readonly byMs: number }
  | { readonly type: 'schedule.cancel'; readonly scheduleId: string }
  | { readonly type: 'schedule.shift'; readonly scheduleId: string; readonly byMs: number }
  | { readonly type: 'event.emit'; readonly event: ScheduledEvent }

export interface RulePlan {
  readonly id: string
  readonly on: string | readonly string[]
  readonly priority?: number
  readonly when?: RuleCondition
  readonly effects: readonly RuleEffect[]
  readonly once?: boolean
  readonly reactionGroup?: string
  readonly exclusive?: boolean
}

export interface CaseKernelIR {
  readonly schemaVersion: string
  readonly id: string
  readonly version: string
  readonly digest: string
  readonly capabilities: readonly CapabilityRef[]
  readonly types?: readonly TypeDefinition[]
  readonly entities?: readonly EntityDefinition[]
  readonly relations?: readonly RelationDefinition[]
  readonly contexts?: readonly ContextDefinition[]
  readonly rules?: readonly RulePlan[]
  readonly initial?: {
    readonly caseTimeMs?: number
    readonly activeTimeMs?: number
    readonly assertions?: Partial<InitialAssertionStores>
    /** Keys are capabilityKey(ref), for example interview@1. */
    readonly capabilityState?: Readonly<Record<string, JsonValue>>
    /** Generic private state addressed by declarative rules. */
    readonly slots?: JsonObject
    readonly schedules?: readonly SchedulePlan[]
  }
}

export type KernelStatus = 'empty' | 'active' | 'ended'

export interface KernelState {
  readonly status: KernelStatus
  readonly revision: number
  readonly sequence: number
  readonly case?: {
    readonly id: string
    readonly version: string
    readonly digest: string
    readonly schemaVersion: string
  }
  readonly capabilityLocks: readonly CapabilityRef[]
  readonly clocks: {
    readonly caseTimeMs: number
    readonly activeTimeMs: number
    readonly wallTimeMs: number
  }
  readonly assertions: AssertionStores
  readonly schedules: Readonly<Record<string, ScheduleState>>
  readonly capabilityState: Readonly<Record<string, JsonValue>>
  readonly slots: JsonObject
  readonly firedRuleIds: readonly string[]
  readonly appliedCommandIds: readonly string[]
}

export interface ScheduleToken {
  readonly id: string
  readonly generation: number
}

export interface DomainEventDraft {
  readonly type: string
  readonly payload?: JsonObject
  /** Defaults to the deciding capability. */
  readonly capability?: CapabilityRef
  /** Used only by trusted schedule delivery. Stale generations reduce to no-ops. */
  readonly schedule?: ScheduleToken
}

export interface DomainEvent {
  readonly id: string
  readonly type: string
  readonly payload: JsonObject
  readonly meta: {
    readonly sequence: number
    readonly commandId: string
    readonly commandType: string
    readonly capability: CapabilityRef
    readonly occurredAt: {
      readonly caseTimeMs: number
      readonly activeTimeMs: number
      readonly wallTimeMs: number
    }
    readonly schedule?: ScheduleToken
  }
}

export interface KernelCommand {
  readonly id?: string
  readonly type: string
  readonly payload?: JsonObject
}

export interface NormalizedKernelCommand {
  readonly id: string
  readonly type: string
  readonly payload: JsonObject
}

export interface DecisionContext {
  readonly state: KernelState
  readonly command: NormalizedKernelCommand
  readonly caseIR: CaseKernelIR
  /** Sampled exactly once at dispatch start from the injected wall clock. */
  readonly wallNowMs: number
}

export interface DecisionAccepted {
  readonly ok: true
  readonly events: readonly DomainEventDraft[]
}

export interface DecisionRejected {
  readonly ok: false
  readonly code: string
  readonly message: string
}

export type CommandDecision = DecisionAccepted | DecisionRejected
export type CommandDecider = (context: DecisionContext) => CommandDecision

export type CapabilityEventReducer = (
  state: JsonValue | undefined,
  event: DomainEvent,
  caseIR: CaseKernelIR,
) => JsonValue | undefined

export interface CapabilityDefinition extends CapabilityRef {
  readonly commands: Readonly<Record<string, CommandDecider>>
  readonly reducers?: Readonly<Record<string, CapabilityEventReducer>>
}

export interface CapabilityRegistry {
  readonly definitions: Readonly<Record<string, CapabilityDefinition>>
}

export interface KernelDependencies {
  readonly ids: {
    nextCommandId(): string
    nextEventId(): string
  }
  readonly wallClock: {
    now(): number
  }
}

export interface KernelRuntime {
  readonly caseIR: CaseKernelIR
  readonly registry: CapabilityRegistry
  readonly dependencies: KernelDependencies
}

export interface KernelSession {
  readonly state: KernelState
  readonly eventLog: readonly DomainEvent[]
}

export interface DispatchSuccess {
  readonly ok: true
  readonly session: KernelSession
  readonly events: readonly DomainEvent[]
}

export interface DispatchFailure {
  readonly ok: false
  readonly session: KernelSession
  readonly events: readonly []
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

export type DispatchResult = DispatchSuccess | DispatchFailure

export interface PublicKernelState {
  readonly status: Exclude<KernelStatus, 'empty'>
  readonly revision: number
  readonly case: NonNullable<KernelState['case']>
  readonly clocks: KernelState['clocks']
  readonly assertions: {
    readonly observed: readonly Assertion[]
    readonly hypotheses: readonly Assertion[]
  }
  readonly schedules: readonly {
    readonly id: string
    readonly clock: ScheduleClock
    readonly dueAtMs: number
    readonly status: ScheduleStatus
    readonly generation: number
    readonly publicData?: JsonObject
  }[]
}
