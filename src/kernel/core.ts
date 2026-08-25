import { findAssertion, validateAssertionCardinality } from './assertions'
import { accept, reject } from './decision'
import { assertJsonValue, compareCodeUnits, deepFreeze } from './freeze'
import { collectDueScheduleEvents, normalizeSchedule, validateSchedulePlan } from './schedules'
import {
  KERNEL_CAPABILITY,
  ASSERTION_CONTEXTS,
  type Assertion,
  type AssertionContextRef,
  type AssertionDraft,
  type AssertionStores,
  type CapabilityDefinition,
  type CapabilityRef,
  type CaseKernelIR,
  type DecisionContext,
  type DomainEvent,
  type JsonObject,
  type JsonValue,
  type KernelState,
  type InitialAssertionStores,
  type SchedulePlan,
  type ScheduleState,
  type ScheduledEvent,
} from './types'

export const KERNEL_COMMANDS = {
  initialize: 'kernel.case.initialize',
  end: 'kernel.case.end',
  recordAssertion: 'kernel.assertion.record',
  retractAssertion: 'kernel.assertion.retract',
  advanceCaseTime: 'kernel.clock.advance-case',
  advanceActiveTime: 'kernel.clock.advance-active',
  observeWallTime: 'kernel.clock.observe-wall',
  resume: 'kernel.session.resume',
  setSchedule: 'kernel.schedule.set',
  cancelSchedule: 'kernel.schedule.cancel',
} as const

export const KERNEL_EVENTS = {
  initialized: 'kernel.case.initialized',
  ended: 'kernel.case.ended',
  assertionRecorded: 'kernel.assertion.recorded',
  assertionRetracted: 'kernel.assertion.retracted',
  caseTimeAdvanced: 'kernel.clock.case-advanced',
  activeTimeAdvanced: 'kernel.clock.active-advanced',
  wallTimeObserved: 'kernel.clock.wall-observed',
  scheduleSet: 'kernel.schedule.set',
  scheduleCancelled: 'kernel.schedule.cancelled',
  scheduleMissed: 'kernel.schedule.missed',
  ruleEffectsApplied: 'kernel.rule.effects-applied',
} as const

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function string(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`)
  return value
}

function number(value: JsonValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function optionalNumber(value: JsonValue | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  return number(value, label)
}

function capabilityRef(value: JsonValue | undefined, label: string): CapabilityRef {
  const ref = object(value, label)
  return {
    id: string(ref.id, `${label}.id`),
    version: string(ref.version, `${label}.version`),
    digest: string(ref.digest, `${label}.digest`),
  }
}

function scheduledEvent(value: JsonValue | undefined, label: string): ScheduledEvent {
  const candidate = object(value, label)
  return {
    type: string(candidate.type, `${label}.type`),
    ...(candidate.payload ? { payload: object(candidate.payload, `${label}.payload`) } : {}),
    ...(candidate.capability
      ? { capability: capabilityRef(candidate.capability, `${label}.capability`) }
      : {}),
  }
}

function schedulePlan(value: JsonValue | undefined): SchedulePlan {
  const plan = object(value, 'schedule plan')
  const clock = string(plan.clock, 'schedule plan.clock')
  if (clock !== 'case' && clock !== 'active' && clock !== 'wall') {
    throw new Error('schedule plan.clock must be case, active or wall')
  }
  const policyValue = plan.deliveryPolicy
  if (policyValue !== undefined && policyValue !== 'immediate' && policyValue !== 'on_resume') {
    throw new Error('schedule plan.deliveryPolicy is invalid')
  }
  const result: SchedulePlan = {
    id: string(plan.id, 'schedule plan.id'),
    clock,
    ...(plan.dueAtMs !== undefined ? { dueAtMs: number(plan.dueAtMs, 'schedule plan.dueAtMs') } : {}),
    ...(plan.afterMs !== undefined ? { afterMs: number(plan.afterMs, 'schedule plan.afterMs') } : {}),
    ...(policyValue ? { deliveryPolicy: policyValue } : {}),
    ...(plan.maximumLatenessMs !== undefined
      ? { maximumLatenessMs: number(plan.maximumLatenessMs, 'schedule plan.maximumLatenessMs') }
      : {}),
    event: scheduledEvent(plan.event, 'schedule plan.event'),
    ...(plan.missedEvent
      ? { missedEvent: scheduledEvent(plan.missedEvent, 'schedule plan.missedEvent') }
      : {}),
    ...(plan.publicData ? { publicData: object(plan.publicData, 'schedule plan.publicData') } : {}),
  }
  validateSchedulePlan(result)
  return result
}

function assertionDraft(value: JsonValue | undefined, label = 'assertion'): AssertionDraft {
  const candidate = object(value, label)
  const polarity = string(candidate.polarity, `${label}.polarity`)
  const visibility = candidate.visibility
  if (polarity !== 'affirm' && polarity !== 'deny') throw new Error(`${label}.polarity is invalid`)
  if (visibility !== undefined && visibility !== 'public' && visibility !== 'hidden') {
    throw new Error(`${label}.visibility is invalid`)
  }
  const confidence = optionalNumber(candidate.confidence, `${label}.confidence`)
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    throw new Error(`${label}.confidence must be between zero and one`)
  }
  return {
    id: string(candidate.id, `${label}.id`),
    relation: string(candidate.relation, `${label}.relation`),
    key: object(candidate.key, `${label}.key`),
    value: candidate.value ?? null,
    polarity,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(visibility ? { visibility } : {}),
    ...(candidate.provenance ? { provenance: object(candidate.provenance, `${label}.provenance`) } : {}),
    validity: object(candidate.validity, `${label}.validity`),
    ...(candidate.assertedAt
      ? { assertedAt: object(candidate.assertedAt, `${label}.assertedAt`) }
      : {}),
  }
}

function assertion(
  value: JsonValue | undefined,
  label: string,
  defaultAssertedAt: JsonObject,
): Assertion {
  const draft = assertionDraft(value, label)
  return { ...draft, assertedAt: draft.assertedAt ?? defaultAssertedAt }
}

function contextRef(payload: JsonObject): AssertionContextRef {
  return { contextId: string(payload.contextId, 'assertion contextId') }
}

function jsonPayload(value: unknown, label: string): JsonObject {
  assertJsonValue(value, label)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function normalizedInitialAssertions(context: DecisionContext): InitialAssertionStores {
  const initial = context.caseIR.initial?.assertions
  return {
    contexts: {
      [ASSERTION_CONTEXTS.WORLD]: [],
      [ASSERTION_CONTEXTS.PLAYER_OBSERVED]: [],
      [ASSERTION_CONTEXTS.PLAYER_HYPOTHESIZED]: [],
      ...Object.fromEntries(
        Object.entries(initial?.contexts ?? {}).map(([id, assertions]) => [id, [...assertions]]),
      ),
    },
  }
}

function initialize(context: DecisionContext) {
  if (context.state.status !== 'empty') return reject('already-initialized', 'The session is already initialized.')
  const caseTimeMs = context.caseIR.initial?.caseTimeMs ?? 0
  if (!Number.isFinite(caseTimeMs) || caseTimeMs < 0) {
    return reject('invalid-case-time', 'Initial case time must be finite and non-negative.')
  }
  const activeTimeMs = context.caseIR.initial?.activeTimeMs ?? 0
  if (!Number.isFinite(activeTimeMs) || activeTimeMs < 0) {
    return reject('invalid-active-time', 'Initial active time must be finite and non-negative.')
  }
  const clocks = { caseTimeMs, activeTimeMs, wallTimeMs: context.wallNowMs }
  const schedules = (context.caseIR.initial?.schedules ?? []).map((plan) =>
    normalizeSchedule(plan, clocks, 1),
  )
  const ids = new Set<string>()
  for (const schedule of schedules) {
    if (ids.has(schedule.id)) return reject('duplicate-schedule', `Duplicate schedule ${schedule.id}.`)
    ids.add(schedule.id)
  }
  const payload = jsonPayload(
    {
      case: {
        id: context.caseIR.id,
        version: context.caseIR.version,
        digest: context.caseIR.digest,
        schemaVersion: context.caseIR.schemaVersion,
      },
      capabilityLocks: [KERNEL_CAPABILITY, ...context.caseIR.capabilities],
      clocks,
      assertions: normalizedInitialAssertions(context),
      schedules,
      capabilityState: context.caseIR.initial?.capabilityState ?? {},
      slots: context.caseIR.initial?.slots ?? {},
      firedRuleIds: [],
    },
    'initialization event payload',
  )
  return accept({ type: KERNEL_EVENTS.initialized, payload })
}

function recordAssertion(context: DecisionContext) {
  try {
    const item = assertionDraft(context.command.payload.assertion)
    if (findAssertion(context.state, item.id)) {
      return reject('duplicate-assertion', `Assertion ${item.id} already exists.`)
    }
    const target = contextRef(context.command.payload)
    validateAssertionCardinality(context.caseIR, context.state.assertions, target.contextId, item)
    return accept({
      type: KERNEL_EVENTS.assertionRecorded,
      payload: jsonPayload({ ...target, assertion: item }, 'assertion event payload'),
    })
  } catch (error) {
    return reject('invalid-assertion', error instanceof Error ? error.message : 'Invalid assertion.')
  }
}

function retractAssertion(context: DecisionContext) {
  try {
    const id = string(context.command.payload.assertionId, 'assertionId')
    if (!findAssertion(context.state, id)) return reject('unknown-assertion', `Assertion ${id} does not exist.`)
    const target = contextRef(context.command.payload)
    return accept({
      type: KERNEL_EVENTS.assertionRetracted,
      payload: jsonPayload({ ...target, assertionId: id }, 'assertion retraction payload'),
    })
  } catch (error) {
    return reject('invalid-assertion', error instanceof Error ? error.message : 'Invalid assertion.')
  }
}

function advanceCaseTime(context: DecisionContext) {
  const byMs = context.command.payload.byMs
  if (typeof byMs !== 'number' || !Number.isFinite(byMs) || byMs < 0) {
    return reject('invalid-duration', 'byMs must be finite and non-negative.')
  }
  const toMs = context.state.clocks.caseTimeMs + byMs
  return accept(
    {
      type: KERNEL_EVENTS.caseTimeAdvanced,
      payload: { byMs, toMs },
    },
    ...collectDueScheduleEvents(context.state, toMs, 'case_advance'),
  )
}

function advanceActiveTime(context: DecisionContext) {
  const byMs = context.command.payload.byMs
  if (typeof byMs !== 'number' || !Number.isFinite(byMs) || byMs < 0) {
    return reject('invalid-duration', 'byMs must be finite and non-negative.')
  }
  const toMs = context.state.clocks.activeTimeMs + byMs
  return accept(
    {
      type: KERNEL_EVENTS.activeTimeAdvanced,
      payload: { byMs, toMs },
    },
    ...collectDueScheduleEvents(context.state, toMs, 'active_advance'),
  )
}

function observeWall(context: DecisionContext, reason: 'resume' | 'wall_tick') {
  if (context.wallNowMs < context.state.clocks.wallTimeMs) {
    return reject('wall-clock-regressed', 'The observed wall clock cannot move backwards.')
  }
  return accept(
    {
      type: KERNEL_EVENTS.wallTimeObserved,
      payload: { fromMs: context.state.clocks.wallTimeMs, toMs: context.wallNowMs, reason },
    },
    ...collectDueScheduleEvents(context.state, context.wallNowMs, reason),
  )
}

function setSchedule(context: DecisionContext) {
  try {
    const plan = schedulePlan(context.command.payload.plan)
    const generation = (context.state.schedules[plan.id]?.generation ?? 0) + 1
    const schedule = normalizeSchedule(plan, context.state.clocks, generation)
    return accept({
      type: KERNEL_EVENTS.scheduleSet,
      payload: jsonPayload({ schedule }, 'schedule set payload'),
    })
  } catch (error) {
    return reject('invalid-schedule', error instanceof Error ? error.message : 'Invalid schedule.')
  }
}

function cancelSchedule(context: DecisionContext) {
  const id = context.command.payload.scheduleId
  if (typeof id !== 'string' || !id) return reject('invalid-schedule', 'scheduleId is required.')
  const current = context.state.schedules[id]
  if (!current) return reject('unknown-schedule', `Schedule ${id} does not exist.`)
  if (current.status !== 'scheduled') return reject('schedule-inactive', `Schedule ${id} is not active.`)
  return accept({
    type: KERNEL_EVENTS.scheduleCancelled,
    payload: { scheduleId: id, generation: current.generation + 1 },
  })
}

export const coreCapability: CapabilityDefinition = deepFreeze({
  ...KERNEL_CAPABILITY,
  commands: {
    [KERNEL_COMMANDS.initialize]: initialize,
    [KERNEL_COMMANDS.end]: () => accept({ type: KERNEL_EVENTS.ended }),
    [KERNEL_COMMANDS.recordAssertion]: recordAssertion,
    [KERNEL_COMMANDS.retractAssertion]: retractAssertion,
    [KERNEL_COMMANDS.advanceCaseTime]: advanceCaseTime,
    [KERNEL_COMMANDS.advanceActiveTime]: advanceActiveTime,
    [KERNEL_COMMANDS.observeWallTime]: (context) => observeWall(context, 'wall_tick'),
    [KERNEL_COMMANDS.resume]: (context) => observeWall(context, 'resume'),
    [KERNEL_COMMANDS.setSchedule]: setSchedule,
    [KERNEL_COMMANDS.cancelSchedule]: cancelSchedule,
  },
}) as CapabilityDefinition

function parseAssertions(
  value: JsonValue | undefined,
  defaultAssertedAt: JsonObject,
  caseIR: CaseKernelIR,
): AssertionStores {
  const stores = object(value, 'assertion stores')
  const parseList = (candidate: JsonValue | undefined, label: string): Assertion[] => {
    if (!Array.isArray(candidate)) throw new Error(`${label} must be an array`)
    return candidate.map((item, index) => assertion(item, `${label}[${index}]`, defaultAssertedAt))
  }
  const contextObject = object(stores.contexts, 'assertion stores.contexts')
  let result: AssertionStores = { contexts: {} }
  for (const [contextId, list] of Object.entries(contextObject)) {
    const assertions = parseList(list, `context ${contextId}`)
    for (const item of assertions) {
      validateAssertionCardinality(caseIR, result, contextId, item)
      result = {
        contexts: {
          ...result.contexts,
          [contextId]: [...(result.contexts[contextId] ?? []), item],
        },
      }
    }
  }
  return result
}

function parseScheduleState(value: JsonValue | undefined): ScheduleState {
  const candidate = object(value, 'schedule state')
  const status = string(candidate.status, 'schedule state.status')
  const clock = string(candidate.clock, 'schedule state.clock')
  const policy = string(candidate.deliveryPolicy, 'schedule state.deliveryPolicy')
  if (status !== 'scheduled' && status !== 'fired' && status !== 'cancelled' && status !== 'missed') {
    throw new Error('schedule state.status is invalid')
  }
  if (clock !== 'case' && clock !== 'active' && clock !== 'wall') {
    throw new Error('schedule state.clock is invalid')
  }
  if (policy !== 'immediate' && policy !== 'on_resume') throw new Error('schedule state.deliveryPolicy is invalid')
  return {
    id: string(candidate.id, 'schedule state.id'),
    clock,
    dueAtMs: number(candidate.dueAtMs, 'schedule state.dueAtMs'),
    deliveryPolicy: policy,
    ...(candidate.maximumLatenessMs !== undefined
      ? { maximumLatenessMs: number(candidate.maximumLatenessMs, 'schedule state.maximumLatenessMs') }
      : {}),
    event: scheduledEvent(candidate.event, 'schedule state.event'),
    ...(candidate.missedEvent
      ? { missedEvent: scheduledEvent(candidate.missedEvent, 'schedule state.missedEvent') }
      : {}),
    ...(candidate.publicData ? { publicData: object(candidate.publicData, 'schedule state.publicData') } : {}),
    generation: number(candidate.generation, 'schedule state.generation'),
    status,
    ...(candidate.deliveredGeneration !== undefined
      ? { deliveredGeneration: number(candidate.deliveredGeneration, 'schedule state.deliveredGeneration') }
      : {}),
  }
}

function replaceAssertionStore(
  stores: AssertionStores,
  target: AssertionContextRef,
  update: (items: readonly Assertion[]) => readonly Assertion[],
): AssertionStores {
  return {
    contexts: {
      ...stores.contexts,
      [target.contextId]: update(stores.contexts[target.contextId] ?? []),
    },
  }
}

/** Core event reducer. Sequence/revision and capability reducers are handled by kernel.ts. */
export function reduceCoreEvent(state: KernelState, event: DomainEvent, caseIR: CaseKernelIR): KernelState {
  switch (event.type) {
    case KERNEL_EVENTS.initialized: {
      if (state.status !== 'empty') throw new Error('Initialization event can only be reduced once')
      const caseValue = object(event.payload.case, 'initialized case')
      const clocks = object(event.payload.clocks, 'initialized clocks')
      const lockValues = event.payload.capabilityLocks
      const scheduleValues = event.payload.schedules
      const capabilityValues = object(event.payload.capabilityState, 'initialized capability state')
      if (!Array.isArray(lockValues) || !Array.isArray(scheduleValues)) {
        throw new Error('Initialization event contains invalid arrays')
      }
      const schedules = scheduleValues.map(parseScheduleState)
      return {
        ...state,
        status: 'active',
        case: {
          id: string(caseValue.id, 'case.id'),
          version: string(caseValue.version, 'case.version'),
          digest: string(caseValue.digest, 'case.digest'),
          schemaVersion: string(caseValue.schemaVersion, 'case.schemaVersion'),
        },
        capabilityLocks: lockValues.map((value, index) => capabilityRef(value, `capabilityLocks[${index}]`)),
        clocks: {
          caseTimeMs: number(clocks.caseTimeMs, 'clocks.caseTimeMs'),
          activeTimeMs: number(clocks.activeTimeMs, 'clocks.activeTimeMs'),
          wallTimeMs: number(clocks.wallTimeMs, 'clocks.wallTimeMs'),
        },
        assertions: parseAssertions(event.payload.assertions, {
          caseTimeMs: event.meta.occurredAt.caseTimeMs,
          activeTimeMs: event.meta.occurredAt.activeTimeMs,
          wallTimeMs: event.meta.occurredAt.wallTimeMs,
        }, caseIR),
        schedules: Object.fromEntries(schedules.map((schedule) => [schedule.id, schedule])),
        capabilityState: { ...capabilityValues },
        slots: { ...object(event.payload.slots, 'initialized slots') },
        firedRuleIds: Array.isArray(event.payload.firedRuleIds)
          ? event.payload.firedRuleIds.map((value, index) => string(value, `firedRuleIds[${index}]`))
          : [],
      }
    }
    case KERNEL_EVENTS.ended:
      return { ...state, status: 'ended' }
    case KERNEL_EVENTS.assertionRecorded: {
      const target = contextRef(event.payload)
      const item = assertion(event.payload.assertion, 'assertion', {
        caseTimeMs: event.meta.occurredAt.caseTimeMs,
        activeTimeMs: event.meta.occurredAt.activeTimeMs,
        wallTimeMs: event.meta.occurredAt.wallTimeMs,
      })
      if (findAssertion(state, item.id)) throw new Error(`Duplicate assertion ${item.id}`)
      validateAssertionCardinality(caseIR, state.assertions, target.contextId, item)
      return {
        ...state,
        assertions: replaceAssertionStore(state.assertions, target, (items) => [...items, item]),
      }
    }
    case KERNEL_EVENTS.assertionRetracted: {
      const target = contextRef(event.payload)
      const id = string(event.payload.assertionId, 'assertionId')
      return {
        ...state,
        assertions: replaceAssertionStore(state.assertions, target, (items) =>
          items.filter((item) => item.id !== id),
        ),
      }
    }
    case KERNEL_EVENTS.caseTimeAdvanced:
      return {
        ...state,
        clocks: {
          ...state.clocks,
          caseTimeMs: number(event.payload.toMs, 'case time'),
        },
      }
    case KERNEL_EVENTS.activeTimeAdvanced:
      return {
        ...state,
        clocks: {
          ...state.clocks,
          activeTimeMs: number(event.payload.toMs, 'active time'),
        },
      }
    case KERNEL_EVENTS.wallTimeObserved:
      return {
        ...state,
        clocks: {
          ...state.clocks,
          wallTimeMs: number(event.payload.toMs, 'wall time'),
        },
      }
    case KERNEL_EVENTS.scheduleSet: {
      const schedule = parseScheduleState(object(event.payload.schedule, 'schedule set event'))
      return { ...state, schedules: { ...state.schedules, [schedule.id]: schedule } }
    }
    case KERNEL_EVENTS.scheduleCancelled: {
      const id = string(event.payload.scheduleId, 'scheduleId')
      const current = state.schedules[id]
      if (!current) return state
      return {
        ...state,
        schedules: {
          ...state.schedules,
          [id]: {
            ...current,
            generation: number(event.payload.generation, 'schedule generation'),
            status: 'cancelled',
          },
        },
      }
    }
    case KERNEL_EVENTS.scheduleMissed: {
      const id = string(event.payload.scheduleId, 'scheduleId')
      const current = state.schedules[id]
      if (!current) return state
      return {
        ...state,
        schedules: { ...state.schedules, [id]: { ...current, status: 'missed' } },
      }
    }
    case KERNEL_EVENTS.ruleEffectsApplied: {
      const ruleIdsValue = event.payload.firedRuleIds
      const writesValue = event.payload.writes
      const scheduleOpsValue = event.payload.scheduleOps
      if (!Array.isArray(ruleIdsValue) || !Array.isArray(writesValue) || !Array.isArray(scheduleOpsValue)) {
        throw new Error('Rule effect event contains invalid arrays')
      }
      const slots = structuredClone(state.slots)
      for (const [index, value] of writesValue.entries()) {
        const write = object(value, `writes[${index}]`)
        writeSlot(slots, string(write.path, `writes[${index}].path`), write.value ?? null)
      }
      const schedules = { ...state.schedules }
      for (const [index, value] of scheduleOpsValue.entries()) {
        const operation = object(value, `scheduleOps[${index}]`)
        const id = string(operation.scheduleId, `scheduleOps[${index}].scheduleId`)
        const current = schedules[id]
        if (!current || current.status !== 'scheduled') {
          throw new Error(`Rule effect targets inactive schedule ${id}`)
        }
        if (operation.type === 'cancel') {
          schedules[id] = { ...current, generation: current.generation + 1, status: 'cancelled' }
        } else if (operation.type === 'shift') {
          schedules[id] = {
            ...current,
            generation: current.generation + 1,
            dueAtMs: current.dueAtMs + number(operation.byMs, `scheduleOps[${index}].byMs`),
          }
        } else {
          throw new Error(`Unknown rule schedule operation ${String(operation.type)}`)
        }
      }
      const caseTimeAdvanceMs = number(event.payload.caseTimeAdvanceMs, 'caseTimeAdvanceMs')
      if (caseTimeAdvanceMs < 0) throw new Error('caseTimeAdvanceMs cannot be negative')
      return {
        ...state,
        slots,
        schedules,
        clocks: {
          ...state.clocks,
          caseTimeMs: state.clocks.caseTimeMs + caseTimeAdvanceMs,
        },
        firedRuleIds: [
          ...new Set([
            ...state.firedRuleIds,
            ...ruleIdsValue.map((value, index) => string(value, `ruleIds[${index}]`)),
          ]),
        ].sort(compareCodeUnits),
      }
    }
    default:
      return state
  }
}

function writeSlot(slots: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split('.').filter(Boolean)
  if (parts.length === 0) throw new Error('Rule state-write path cannot be empty')
  if (parts.some((part) => part === '__proto__' || part === 'prototype' || part === 'constructor')) {
    throw new Error(`Unsafe rule state-write path: ${path}`)
  }
  let target = slots
  for (const part of parts.slice(0, -1)) {
    const current = target[part]
    if (!current || typeof current !== 'object' || Array.isArray(current)) target[part] = {}
    target = target[part] as JsonObject
  }
  target[parts.at(-1) as string] = structuredClone(value)
}
