import { queryAssertions } from './assertions'
import { KERNEL_EVENTS } from './core'
import { compareCodeUnits, stableStringify } from './freeze'
import {
  KERNEL_CAPABILITY,
  capabilityKey,
  type CaseKernelIR,
  type DomainEvent,
  type DomainEventDraft,
  type JsonObject,
  type JsonValue,
  type KernelState,
  type RuleCompareOperator,
  type RuleCondition,
  type RulePlan,
} from './types'

export interface PlannedRuleReaction {
  readonly batch: DomainEventDraft
  readonly emitted: readonly DomainEventDraft[]
}

export class RuleConflictError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(message)
    this.name = 'RuleConflictError'
    this.path = path
  }
}

function getPath(value: unknown, path: string): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function compare(left: unknown, operator: RuleCompareOperator, right: unknown): boolean {
  switch (operator) {
    case 'eq':
      return stableStringify(left) === stableStringify(right)
    case 'neq':
      return stableStringify(left) !== stableStringify(right)
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
  }
}

export function evaluateRuleCondition(
  state: KernelState,
  event: DomainEvent,
  condition: RuleCondition | undefined,
): boolean {
  if (!condition) return true
  switch (condition.type) {
    case 'always':
      return true
    case 'all':
      return condition.conditions.every((item) => evaluateRuleCondition(state, event, item))
    case 'any':
      return condition.conditions.some((item) => evaluateRuleCondition(state, event, item))
    case 'not':
      return !evaluateRuleCondition(state, event, condition.condition)
    case 'event.field':
      return compare(getPath(event, condition.path), condition.operator ?? 'eq', condition.value)
    case 'state.slot':
      return compare(getPath(state.slots, condition.path), condition.operator ?? 'eq', condition.value)
    case 'capability.state':
      return compare(
        getPath(state.capabilityState[capabilityKey(condition.capability)], condition.path ?? ''),
        condition.operator ?? 'eq',
        condition.value,
      )
    case 'assertion':
      return queryAssertions(state, condition.query).status === condition.status
    case 'schedule':
      return state.schedules[condition.scheduleId]?.status === condition.status
    case 'clock':
      return compare(
        condition.clock === 'case'
          ? state.clocks.caseTimeMs
          : condition.clock === 'active'
            ? state.clocks.activeTimeMs
            : state.clocks.wallTimeMs,
        condition.operator,
        condition.value,
      )
  }
}

function listensTo(rule: RulePlan, eventType: string): boolean {
  return typeof rule.on === 'string' ? rule.on === eventType || rule.on === '*' : rule.on.includes(eventType) || rule.on.includes('*')
}

export function matchingRules(
  caseIR: CaseKernelIR,
  state: KernelState,
  event: DomainEvent,
): readonly RulePlan[] {
  const matches = (caseIR.rules ?? [])
    .filter(
      (rule) =>
        listensTo(rule, event.type) &&
        !(rule.once && state.firedRuleIds.includes(rule.id)) &&
        evaluateRuleCondition(state, event, rule.when),
    )
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || compareCodeUnits(left.id, right.id))

  const exclusiveGroups = new Set(
    matches
      .filter((rule) => rule.exclusive && rule.reactionGroup)
      .map((rule) => rule.reactionGroup as string),
  )
  const claimed = new Set<string>()
  return matches.filter((rule) => {
    if (!rule.reactionGroup || !exclusiveGroups.has(rule.reactionGroup)) return true
    if (claimed.has(rule.reactionGroup)) return false
    claimed.add(rule.reactionGroup)
    return true
  })
}

function safePath(path: string): void {
  const parts = path.split('.').filter(Boolean)
  if (parts.length === 0) throw new Error('Rule state path cannot be empty')
  if (parts.some((part) => part === '__proto__' || part === 'prototype' || part === 'constructor')) {
    throw new Error(`Unsafe rule state path: ${path}`)
  }
}

export function validateRules(caseIR: CaseKernelIR): void {
  const ids = new Set<string>()
  for (const rule of caseIR.rules ?? []) {
    if (!rule.id) throw new Error('Rule id is required')
    if (ids.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id}`)
    ids.add(rule.id)
    if (!Number.isFinite(rule.priority ?? 0)) throw new Error(`Rule ${rule.id} priority must be finite`)
    for (const effect of rule.effects) {
      if (effect.type === 'state.write' || effect.type === 'state.adjust') safePath(effect.path)
      if (effect.type === 'state.adjust' && !Number.isFinite(effect.by)) {
        throw new Error(`Rule ${rule.id} has a non-finite adjustment`)
      }
      if (effect.type === 'event.emit' && !effect.event.type) {
        throw new Error(`Rule ${rule.id} emits an event without a type`)
      }
      if (effect.type === 'clock.advance' && (!Number.isFinite(effect.byMs) || effect.byMs < 0)) {
        throw new Error(`Rule ${rule.id} has an invalid case-clock advance`)
      }
      if (effect.type === 'schedule.shift' && !Number.isFinite(effect.byMs)) {
        throw new Error(`Rule ${rule.id} has an invalid schedule shift`)
      }
      if (
        (effect.type === 'schedule.cancel' || effect.type === 'schedule.shift') &&
        !effect.scheduleId
      ) {
        throw new Error(`Rule ${rule.id} has a schedule effect without an id`)
      }
    }
  }
}

/**
 * Plans one atomic reaction from a single immutable post-event snapshot.
 * It never mutates state and is therefore independent of source/load order.
 */
export function planRuleReaction(
  caseIR: CaseKernelIR,
  snapshot: KernelState,
  trigger: DomainEvent,
): PlannedRuleReaction | undefined {
  const rules = matchingRules(caseIR, snapshot, trigger)
  if (rules.length === 0) return undefined

  const sets = new Map<string, JsonValue>()
  const adjustments = new Map<string, number>()
  const emitted: DomainEventDraft[] = []
  let caseTimeAdvanceMs = 0
  const scheduleShifts = new Map<string, number>()
  const scheduleCancels = new Set<string>()

  for (const rule of rules) {
    for (const effect of rule.effects) {
      if (effect.type === 'event.emit') {
        emitted.push({
          type: effect.event.type,
          payload: effect.event.payload ?? {},
          capability: effect.event.capability,
        })
        continue
      }
      if (effect.type === 'clock.advance') {
        if (!Number.isFinite(effect.byMs) || effect.byMs < 0) {
          throw new RuleConflictError('clocks.case', 'Case-clock advances must be finite and non-negative')
        }
        caseTimeAdvanceMs += effect.byMs
        continue
      }
      if (effect.type === 'schedule.cancel') {
        if (scheduleShifts.has(effect.scheduleId)) {
          throw new RuleConflictError(
            `schedules.${effect.scheduleId}`,
            `Rule batch mixes schedule.cancel and schedule.shift for ${effect.scheduleId}`,
          )
        }
        const current = snapshot.schedules[effect.scheduleId]
        if (!current) {
          throw new RuleConflictError(
            `schedules.${effect.scheduleId}`,
            `Cannot cancel unknown schedule ${effect.scheduleId}`,
          )
        }
        if (current.status !== 'scheduled') continue
        scheduleCancels.add(effect.scheduleId)
        continue
      }
      if (effect.type === 'schedule.shift') {
        if (scheduleCancels.has(effect.scheduleId)) {
          throw new RuleConflictError(
            `schedules.${effect.scheduleId}`,
            `Rule batch mixes schedule.cancel and schedule.shift for ${effect.scheduleId}`,
          )
        }
        const current = snapshot.schedules[effect.scheduleId]
        if (!current || current.status !== 'scheduled') {
          throw new RuleConflictError(
            `schedules.${effect.scheduleId}`,
            `Cannot shift inactive schedule ${effect.scheduleId}`,
          )
        }
        const total = (scheduleShifts.get(effect.scheduleId) ?? 0) + effect.byMs
        if (!Number.isFinite(total) || current.dueAtMs + total < 0) {
          throw new RuleConflictError(
            `schedules.${effect.scheduleId}`,
            `Schedule shift would create an invalid due time for ${effect.scheduleId}`,
          )
        }
        scheduleShifts.set(effect.scheduleId, total)
        continue
      }
      safePath(effect.path)
      if (effect.type === 'state.write') {
        if (adjustments.has(effect.path)) {
          throw new RuleConflictError(
            effect.path,
            `Rule batch mixes state.write and state.adjust at ${effect.path}`,
          )
        }
        const existing = sets.get(effect.path)
        if (existing !== undefined && stableStringify(existing) !== stableStringify(effect.value)) {
          throw new RuleConflictError(effect.path, `Conflicting state writes at ${effect.path}`)
        }
        sets.set(effect.path, effect.value)
        continue
      }
      if (sets.has(effect.path)) {
        throw new RuleConflictError(
          effect.path,
          `Rule batch mixes state.write and state.adjust at ${effect.path}`,
        )
      }
      adjustments.set(effect.path, (adjustments.get(effect.path) ?? 0) + effect.by)
    }
  }

  const writes = [...sets.entries()].map(([path, value]) => ({ path, value }))
  for (const [path, by] of adjustments) {
    const current = getPath(snapshot.slots, path)
    if (typeof current !== 'number' || !Number.isFinite(current)) {
      throw new RuleConflictError(path, `Cannot adjust non-numeric state at ${path}`)
    }
    writes.push({ path, value: current + by })
  }
  writes.sort((left, right) => compareCodeUnits(left.path, right.path))

  const payload: JsonObject = {
    triggerEventId: trigger.id,
    ruleIds: rules.map(({ id }) => id),
    firedRuleIds: rules.filter(({ once }) => once).map(({ id }) => id),
    writes,
    caseTimeAdvanceMs,
    scheduleOps: [
      ...[...scheduleCancels].sort(compareCodeUnits).map((scheduleId) => ({ type: 'cancel', scheduleId })),
      ...[...scheduleShifts.entries()]
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([scheduleId, byMs]) => ({ type: 'shift', scheduleId, byMs })),
    ],
  }
  return {
    batch: {
      type: KERNEL_EVENTS.ruleEffectsApplied,
      payload,
      capability: KERNEL_CAPABILITY,
    },
    emitted,
  }
}
