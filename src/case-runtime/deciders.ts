import {
  ASSERTION_CONTEXTS,
  KERNEL_CAPABILITY,
  KERNEL_EVENTS,
  accept,
  reject,
  stableStringify,
  type CommandDecider,
  type DomainEventDraft,
  type JsonObject,
  type JsonValue,
  type KernelState,
} from '../kernel'

import {
  CASE_COMMANDS,
  CASE_EVENTS,
  CASE_RUNTIME_SCHEMA,
  CASE_SLOT,
  type CaseAction,
  type CaseRuntimeCatalog,
  type RuntimeProofAlternative,
  type RuntimeProofCheck,
} from './protocol'
import {
  isActorDecisionAction,
  isActorDecisionTargetListed,
} from './decision-visibility'

const CATALOG_KEY = 'investigation@1'

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function nonEmptyString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function runtimeCatalog(state: KernelState): CaseRuntimeCatalog {
  const value = object(state.capabilityState[CATALOG_KEY], 'case runtime catalog')
  if (value.schema !== CASE_RUNTIME_SCHEMA) throw new Error('Unsupported case runtime catalog')
  return value as unknown as CaseRuntimeCatalog
}

function slotObject(state: KernelState): JsonObject {
  return object(state.slots[CASE_SLOT], 'case runtime state')
}

function evidenceState(state: KernelState, evidenceId: string): JsonObject | undefined {
  const evidence = object(slotObject(state).evidence, 'case runtime evidence')
  const candidate = evidence[evidenceId]
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : undefined
}

function deductionSupported(state: KernelState, deductionId: string): boolean {
  const deductions = object(slotObject(state).deductions, 'case runtime deductions')
  return deductions[deductionId] === true
}

const ROUTED_ACTION_FIELDS = ['actor', 'from', 'target', 'evidence', 'ref'] as const

/**
 * An exclusive affordance closes only its routed command family. This keeps an
 * interview with another actor or an open command for another record generic,
 * while preventing omitted or altered topic/tone/query fields from bypassing
 * the authored command and its cost. Commands without a routed identity (for
 * example a search) form a verb-wide family and must opt out explicitly when
 * free-form alternatives are intentional.
 */
function sameRoutedActionFamily(
  authored: CaseAction,
  candidate: Readonly<Record<string, string>>,
): boolean {
  if (authored.action !== candidate.action) return false
  const authoredRoutes = ROUTED_ACTION_FIELDS.filter(
    (field) => authored[field] !== undefined,
  )
  if (authoredRoutes.length === 0) return true
  if (!ROUTED_ACTION_FIELDS.some((field) => candidate[field] !== undefined)) return true
  return authoredRoutes.some((field) => candidate[field] === authored[field])
}

function observationValue(
  state: KernelState,
  catalog: CaseRuntimeCatalog,
  observationId: string,
): JsonValue | undefined {
  const definition = catalog.observations[observationId]
  if (!definition) return undefined
  const assertion = (state.assertions.contexts[ASSERTION_CONTEXTS.PLAYER_OBSERVED] ?? []).find(
    (candidate) =>
      candidate.relation === 'evidence.observation' &&
      candidate.polarity === 'affirm' &&
      candidate.key.observationId === observationId,
  )
  if (!assertion || stableStringify(assertion.value) !== stableStringify(definition.value)) {
    return undefined
  }
  return assertion.value
}

function parseClockValue(value: string): number | undefined {
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (clock) {
    const hours = Number(clock[1])
    const minutes = Number(clock[2])
    const seconds = Number(clock[3] ?? '0')
    if (hours > 23 || minutes > 59 || seconds > 59) return undefined
    return ((hours * 60 + minutes) * 60 + seconds) * 1000
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function parseComparableTime(
  value: string,
): { kind: 'clock' | 'timestamp'; milliseconds: number } | undefined {
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (clock) {
    const milliseconds = parseClockValue(value)
    return milliseconds === undefined ? undefined : { kind: 'clock', milliseconds }
  }
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? { kind: 'timestamp', milliseconds } : undefined
}

function parseOffset(value: string): number | undefined {
  const match = /^([+-])(\d+)(s|m|h)$/.exec(value)
  if (!match) return undefined
  const factor = match[3] === 's' ? 1000 : match[3] === 'm' ? 60_000 : 3_600_000
  return (match[1] === '-' ? -1 : 1) * Number(match[2]) * factor
}

function proofCheckPasses(
  check: RuntimeProofCheck,
  state: KernelState,
  catalog: CaseRuntimeCatalog,
): boolean {
  if (check.type === 'equals') {
    const value = observationValue(state, catalog, check.ref)
    return value !== undefined && stableStringify(value) === stableStringify(check.value)
  }
  if (check.type === 'notEquals') {
    const value = observationValue(state, catalog, check.ref)
    return value !== undefined && stableStringify(value) !== stableStringify(check.value)
  }
  if (check.type === 'numberLessThan' || check.type === 'numberGreaterThan') {
    const value = observationValue(state, catalog, check.ref)
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(check.value)) {
      return false
    }
    return check.type === 'numberLessThan' ? value < check.value : value > check.value
  }
  if (check.type === 'arrayContains') {
    const value = observationValue(state, catalog, check.ref)
    return Array.isArray(value) && value.some(
      (item) => stableStringify(item) === stableStringify(check.value),
    )
  }
  if (check.type === 'arrayCountEquals') {
    const value = observationValue(state, catalog, check.ref)
    return Array.isArray(value) && value.length === check.count
  }
  if (check.type === 'timeOffsetEquals') {
    const shownValue = observationValue(state, catalog, check.shownRef)
    const offsetValue = observationValue(state, catalog, check.offsetRef)
    if (typeof shownValue !== 'string' || typeof offsetValue !== 'string') return false
    const shown = parseClockValue(shownValue)
    const offset = parseOffset(offsetValue)
    const expected = parseClockValue(check.expected)
    return shown !== undefined && offset !== undefined && expected !== undefined && shown - offset === expected
  }
  const leftValue = observationValue(state, catalog, check.leftRef)
  if (typeof leftValue !== 'string') return false
  const rightValue = check.type === 'beforeRef' || check.type === 'afterRef'
    ? observationValue(state, catalog, check.rightRef)
    : check.rightValue
  if (typeof rightValue !== 'string') return false
  const left = parseComparableTime(leftValue)
  const right = parseComparableTime(rightValue)
  if (!left || !right || left.kind !== right.kind) return false
  return check.type === 'beforeValue' || check.type === 'beforeRef'
    ? left.milliseconds < right.milliseconds
    : left.milliseconds > right.milliseconds
}

function proofAlternativePasses(
  alternative: RuntimeProofAlternative,
  state: KernelState,
  catalog: CaseRuntimeCatalog,
): boolean {
  return (
    alternative.terms.every((term) =>
      term.type === 'observation'
        ? observationValue(state, catalog, term.id) !== undefined
        : deductionSupported(state, term.id),
    ) && alternative.checks.every((check) => proofCheckPasses(check, state, catalog))
  )
}

const observeEvidence: CommandDecider = ({ state, command }) => {
  try {
    const catalog = runtimeCatalog(state)
    const evidenceId = nonEmptyString(command.payload.evidenceId, 'evidenceId')
    const definition = catalog.evidence[evidenceId]
    if (!definition) return reject('unknown-evidence', `Unknown evidence ${evidenceId}.`)
    const current = evidenceState(state, evidenceId)
    if (!current || current.access !== 'granted') {
      return reject('evidence-locked', `Evidence ${evidenceId} is not available.`)
    }
    if (current.observed === true) {
      return reject('evidence-already-observed', `Evidence ${evidenceId} was already observed.`)
    }

    const observations = Object.entries(catalog.observations)
      .filter(([, observation]) => observation.evidenceId === evidenceId)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    const events: DomainEventDraft[] = [
      {
        type: CASE_EVENTS.evidenceObserved,
        payload: { evidenceId, tool: definition.tool },
      },
    ]
    for (const [observationId, observation] of observations) {
      events.push({
        type: KERNEL_EVENTS.assertionRecorded,
        capability: KERNEL_CAPABILITY,
        payload: {
          contextId: ASSERTION_CONTEXTS.PLAYER_OBSERVED,
          assertion: {
            id: `observed:${observationId}`,
            relation: 'evidence.observation',
            key: {
              observationId,
              evidenceId,
              field: observation.field,
            },
            value: observation.value,
            polarity: 'affirm',
            visibility: 'public',
            provenance: {
              sourceContext: `source:${evidenceId}`,
              sourceAssertionId: observation.sourceAssertionId,
            },
            validity: { source: evidenceId },
          },
        },
      })
    }
    return accept(...events)
  } catch (error) {
    return reject('invalid-observation', error instanceof Error ? error.message : 'Invalid evidence observation.')
  }
}

const performAction: CommandDecider = ({ state, command }) => {
  try {
    const catalog = runtimeCatalog(state)
    const action = nonEmptyString(command.payload.action, 'action')
    if (!catalog.allowedActions.includes(action)) {
      return reject('unsupported-action', `Action ${action} is not available in this case.`)
    }
    const normalized: Record<string, string> & { action: string } = { action }
    for (const field of ['target', 'actor', 'from', 'topic', 'evidence', 'tone', 'query', 'ref'] as const) {
      const value = command.payload[field]
      if (value !== undefined) normalized[field] = nonEmptyString(value, field)
    }
    const actionAffordances = Object.entries(catalog.affordances).flatMap(([id, definition]) => (
      definition.intent.kind === 'action'
        ? [{id, definition, action: definition.intent.action}]
        : []
    ))
    const matchingAffordance = actionAffordances.find(({action: authored}) => (
      Object.entries(authored).every(([field, value]) => normalized[field] === value)
    ))
    const exactMatchingAffordance = matchingAffordance && (
      stableStringify(matchingAffordance.action) === stableStringify(normalized)
    )
      ? matchingAffordance
      : undefined
    const affordanceSlots = object(slotObject(state).affordances, 'case runtime affordances')
    const actorSlots = object(slotObject(state).actors, 'case runtime actors')
    if (isActorDecisionAction(normalized)) {
      const hasAuthoredFamily = actionAffordances.some(({action: authored}) => (
        authored.action === action
      ))
      const exactAuthoredDecisionIsOffered = Boolean(
        exactMatchingAffordance &&
        affordanceSlots[exactMatchingAffordance.id] === 'offered',
      )
      const legacyFinalTargetIsAllowed = (
        action === 'submit-conclusion' &&
        !hasAuthoredFamily &&
        Object.keys(normalized).length === 2 &&
        typeof normalized.target === 'string' &&
        catalog.allowedFinalTargets.includes(normalized.target)
      )
      const decisionIsAvailable = (
        (hasAuthoredFamily ? exactAuthoredDecisionIsOffered : legacyFinalTargetIsAllowed) &&
        isActorDecisionTargetListed(catalog, actorSlots, normalized) &&
        (action !== 'submit-conclusion' || (
          typeof normalized.target === 'string' &&
          catalog.allowedFinalTargets.includes(normalized.target)
        ))
      )
      if (!decisionIsAvailable) {
        return reject(
          'affordance-unavailable',
          'That investigation action is not currently available.',
        )
      }
    } else if (matchingAffordance) {
      if (!exactMatchingAffordance) {
        return reject(
          'affordance-command-mismatch',
          'The investigation action does not match its authored public command.',
        )
      }
      if (affordanceSlots[matchingAffordance.id] !== 'offered') {
        return reject('affordance-unavailable', 'That investigation action is not currently offered.')
      }
    } else if (actionAffordances.some(({definition, action: authored}) => (
      definition.exclusive && sameRoutedActionFamily(authored, normalized)
    ))) {
      return reject(
        'affordance-command-mismatch',
        'The investigation action does not match its authored public command.',
      )
    }
    const regulatedActors = Object.entries(catalog.actors).filter(([, definition]) =>
      Object.hasOwn(definition.channels, action),
    )
    if (regulatedActors.length > 0) {
      const requiredFields = new Set(
        regulatedActors.map(([, definition]) => definition.channels[action]!),
      )
      if (![...requiredFields].some((field) => normalized[field] !== undefined)) {
        return reject('actor-required', `Action ${action} requires an actor.`)
      }
      const candidates = regulatedActors.filter(([actorId, definition]) => {
        const field = definition.channels[action]
        return field !== undefined && normalized[field] === actorId
      })
      if (candidates.length > 1) {
        return reject('actor-argument-conflict', 'The action identifies more than one actor.')
      }
      const candidate = candidates[0]
      if (!candidate || !candidate[1].public) {
        return reject('actor-unavailable', 'That actor is not available for this action.')
      }
      const [actorId, definition] = candidate
      const actorState = object(actorSlots[actorId], `actor state ${actorId}`)
      const contact = actorState.contact ?? definition.contactInitial
      if (contact !== 'listed') {
        return reject('actor-unavailable', 'That actor is not available for this action.')
      }
      const stateId = nonEmptyString(actorState.conversation, `actor ${actorId} conversation state`)
      const current = definition.states[stateId]
      if (!current) return reject('actor-unavailable', 'That actor is not available for this action.')
      if (!current.canTalk && !definition.allowWhileUnavailable.includes(action)) {
        return reject('actor-unavailable', 'That actor is not available for this action.')
      }
    }
    const evidencePrerequisite = normalized.evidence ?? (
      normalized.ref && catalog.evidence[normalized.ref] ? normalized.ref : undefined
    )
    if (evidencePrerequisite) {
      const current = evidenceState(state, evidencePrerequisite)
      if (!current || current.observed !== true) {
        return reject('evidence-not-observed', `Evidence ${evidencePrerequisite} must be observed first.`)
      }
    }
    if (action === 'submit-conclusion') {
      const target = normalized.target
      if (!target || !catalog.allowedFinalTargets.includes(target)) {
        return reject('invalid-final-target', `Final target ${target ?? '<missing>'} is not allowed.`)
      }
      const finalState = object(slotObject(state).final, 'case runtime final conclusion')
      if (catalog.finalConclusion === 'first-write-wins' && typeof finalState.target === 'string') {
        return reject('final-conclusion-locked', 'The final conclusion is already locked.')
      }
    }
    return accept({ type: CASE_EVENTS.actionPerformed, payload: normalized })
  } catch (error) {
    return reject('invalid-action', error instanceof Error ? error.message : 'Invalid case action.')
  }
}

const attemptDeduction: CommandDecider = ({ state, command }) => {
  try {
    const catalog = runtimeCatalog(state)
    const deductionId = nonEmptyString(command.payload.deductionId, 'deductionId')
    const definition = catalog.deductions[deductionId]
    if (!definition) return reject('unknown-deduction', `Unknown deduction ${deductionId}.`)
    if (deductionSupported(state, deductionId)) {
      return reject('deduction-already-supported', `Deduction ${deductionId} is already supported.`)
    }
    const affordances = Object.entries(catalog.affordances)
    const matchingAffordance = affordances.find(([, affordance]) => (
      affordance.intent.kind === 'deduce' && affordance.intent.deductionId === deductionId
    ))
    if (affordances.length > 0 && !matchingAffordance) {
      return reject('affordance-unavailable', 'That investigation action is not currently offered.')
    }
    if (matchingAffordance) {
      const affordanceSlots = object(slotObject(state).affordances, 'case runtime affordances')
      if (affordanceSlots[matchingAffordance[0]] !== 'offered') {
        return reject('affordance-unavailable', 'That investigation action is not currently offered.')
      }
    }
    const missing = definition.requiredDeductions.filter(
      (requiredId) => !deductionSupported(state, requiredId),
    )
    if (missing.length > 0) {
      return reject('deduction-requires-support', `Missing required deductions: ${missing.join(', ')}.`)
    }
    const proof = definition.proofAlternatives.find((alternative) =>
      proofAlternativePasses(alternative, state, catalog),
    )
    if (!proof && definition.proofAlternatives.length > 0) {
      return reject('deduction-unproven', `Observed evidence does not support ${deductionId}.`)
    }
    if (!proof && definition.requiredDeductions.length === 0) {
      return reject('deduction-unproven', `Deduction ${deductionId} has no valid proof.`)
    }
    const proofTerms = proof?.terms ?? definition.requiredDeductions.map((id) => ({ type: 'deduction' as const, id }))
    const observations = proofTerms.filter(({ type }) => type === 'observation').map(({ id }) => id)
    const deductions = [
      ...definition.requiredDeductions,
      ...proofTerms.filter(({ type }) => type === 'deduction').map(({ id }) => id),
    ].filter((id, index, all) => all.indexOf(id) === index)
    return accept(
      {
        type: CASE_EVENTS.deductionSupported,
        payload: { deductionId, proof: { observations, deductions } },
      },
      {
        type: KERNEL_EVENTS.assertionRecorded,
        capability: KERNEL_CAPABILITY,
        payload: {
          contextId: ASSERTION_CONTEXTS.PLAYER_HYPOTHESIZED,
          assertion: {
            id: `hypothesis:${deductionId}`,
            relation: 'deduction.conclusion',
            key: { deductionId },
            value: definition.conclusion,
            polarity: 'affirm',
            visibility: 'public',
            provenance: { observations, deductions },
            validity: { case: 'current' },
          },
        },
      },
    )
  } catch (error) {
    return reject('invalid-deduction', error instanceof Error ? error.message : 'Invalid deduction attempt.')
  }
}

export const caseCommandDeciders: Readonly<Record<string, CommandDecider>> = Object.freeze({
  [CASE_COMMANDS.observeEvidence]: observeEvidence,
  [CASE_COMMANDS.performAction]: performAction,
  [CASE_COMMANDS.attemptDeduction]: attemptDeduction,
})
