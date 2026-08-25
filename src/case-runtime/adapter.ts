import { capabilityVocabulary, getCapabilityManifest } from '../capabilities'
import { hashCanonical } from '../compiler/canonical'
import type {
  CompiledAction,
  CompiledCaseIR,
  CompiledEffect,
  CompiledReaction,
  ConditionExpression,
  JsonValue as CompilerJsonValue,
  UnlockExpression,
} from '../compiler/types'
import {
  ASSERTION_CONTEXTS,
  KERNEL_CAPABILITY,
  KERNEL_EVENTS,
  stableStringify,
  type AssertionDraft,
  type CapabilityRef,
  type CaseKernelIR,
  type ContextDefinition,
  type EntityDefinition,
  type JsonObject,
  type JsonValue,
  type RelationDefinition,
  type RuleCondition,
  type RuleEffect,
  type RulePlan,
  type SchedulePlan,
  type TypeDefinition,
} from '../kernel'

import {
  CASE_COMMANDS,
  CASE_EVENTS,
  CASE_RUNTIME_SCHEMA,
  CASE_SLOT,
  type CaseAction,
  type CaseRuntimeCatalog,
  type RuntimeAffordanceDefinition,
  type RuntimeActorConversationDefinition,
  type RuntimeDeductionDefinition,
  type RuntimeObjectiveCondition,
  type RuntimeOutcomeDefinition,
} from './protocol'
import {
  INVESTIGATION_CAPABILITY,
  assertTrustedCapabilityLocks,
} from './trusted-capabilities'

const MINUTE_MS = 60_000

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function asJson(value: CompilerJsonValue): JsonValue {
  return value as JsonValue
}

function asObject(value: CompilerJsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function entries(value: CompilerJsonValue | undefined): Array<[string, JsonObject]> {
  return Object.entries(asObject(value))
    .filter((entry): entry is [string, JsonObject] => Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]))
    .sort(([left], [right]) => compareRaw(left, right))
}

function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function safeStateSegment(value: string, label: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(value)) throw new Error(`Unsafe ${label} id ${value}`)
  return value
}

function sourceAssertionId(observationId: string): string {
  return `source:${observationId}`
}

function observationPath(observationId: string): string {
  const separator = observationId.indexOf('.')
  return `${CASE_SLOT}.evidence.${safeStateSegment(observationId.slice(0, separator), 'evidence')}.observed`
}

function deductionPath(id: string): string {
  return `${CASE_SLOT}.deductions.${safeStateSegment(id, 'deduction')}`
}

function flagPath(id: string): string {
  return `${CASE_SLOT}.flags.${safeStateSegment(id, 'flag')}`
}

function evidenceAccessPath(id: string): string {
  return `${CASE_SLOT}.evidence.${safeStateSegment(id, 'evidence')}.access`
}

function affordanceStatePath(id: string): string {
  return `${CASE_SLOT}.affordances.${safeStateSegment(id, 'affordance')}`
}

function claimAssertion(
  id: string,
  claim: JsonObject,
  provenance: JsonObject,
  visibility: 'public' | 'hidden' = 'hidden',
): AssertionDraft {
  const relation = typeof claim.relation === 'string' ? claim.relation : 'statement.claim'
  const key: JsonObject = {}
  const validity: JsonObject = {}
  for (const [field, value] of Object.entries(claim).sort(([left], [right]) => compareRaw(left, right))) {
    if (['relation', 'value', 'polarity', 'confidence', 'intent', 'reason'].includes(field)) continue
    if (['at', 'from', 'to', 'during'].includes(field)) validity[field] = value
    else key[field] = value
  }
  const polarity = claim.polarity === 'deny' ? 'deny' : 'affirm'
  return {
    id,
    relation,
    key,
    value: claim.value ?? true,
    polarity,
    ...(typeof claim.confidence === 'number' ? { confidence: claim.confidence } : {}),
    visibility,
    provenance,
    validity,
  }
}

interface AssertionBuild {
  contexts: Record<string, AssertionDraft[]>
  relations: Set<string>
  reveals: Map<string, AssertionDraft[]>
  initialStatements: Map<string, AssertionDraft[]>
}

function buildAssertions(ir: CompiledCaseIR): AssertionBuild {
  const contexts: Record<string, AssertionDraft[]> = {
    [ASSERTION_CONTEXTS.WORLD]: [],
    [ASSERTION_CONTEXTS.PLAYER_OBSERVED]: [],
    [ASSERTION_CONTEXTS.PLAYER_HYPOTHESIZED]: [],
  }
  const relations = new Set(['world.event', 'evidence.observation', 'deduction.conclusion'])
  const reveals = new Map<string, AssertionDraft[]>()
  const initialStatements = new Map<string, AssertionDraft[]>()

  const truth = asObject(ir.private.truth)
  const truthEvents = asObject(truth.events)
  for (const [eventId, event] of entries(truth.events)) {
    const validity: JsonObject = {}
    for (const field of ['at', 'from', 'to']) {
      if (event[field] !== undefined) validity[field] = event[field]
    }
    contexts[ASSERTION_CONTEXTS.WORLD].push({
      id: `world:event:${eventId}`,
      relation: 'world.event',
      key: { eventId, ...(typeof event.type === 'string' ? { eventType: event.type } : {}) },
      value: event,
      polarity: 'affirm',
      visibility: 'hidden',
      provenance: { source: 'case.truth.events' },
      validity,
    })
  }
  for (const [factId, fact] of entries(truth.facts)) {
    const relation = typeof fact.relation === 'string' ? fact.relation : 'world.fact'
    const key: JsonObject = {}
    for (const [field, value] of Object.entries(fact)) {
      if (field !== 'relation' && field !== 'value') key[field] = value
    }
    relations.add(relation)
    contexts[ASSERTION_CONTEXTS.WORLD].push({
      id: `world:fact:${factId}`,
      relation,
      key,
      value: fact.value ?? true,
      polarity: 'affirm',
      visibility: 'hidden',
      provenance: { source: 'case.truth.facts' },
      validity: {},
    })
  }

  for (const evidence of ir.evidence) {
    const contextId = `source:${evidence.id}`
    contexts[contextId] = evidence.observations.map((observation): AssertionDraft => ({
      id: sourceAssertionId(observation.id),
      relation: 'evidence.observation',
      key: { observationId: observation.id, evidenceId: evidence.id, field: observation.field },
      value: asJson(observation.value),
      polarity: 'affirm',
      visibility: 'hidden',
      provenance: { source: evidence.id },
      validity: { source: evidence.id },
    }))
  }

  for (const [actorId, perspective] of entries(ir.private.perspectives)) {
    const contextId = `perspective:${actorId}`
    const assertions: AssertionDraft[] = []
    for (const eventId of strings(perspective.knows)) {
      const event = asObject(truthEvents[eventId])
      if (Object.keys(event).length === 0) continue
      const validity: JsonObject = {}
      for (const field of ['at', 'from', 'to']) {
        if (event[field] !== undefined) validity[field] = event[field]
      }
      assertions.push({
        id: `perspective:${actorId}:knows:${eventId}`,
        relation: 'world.event',
        key: { eventId, ...(typeof event.type === 'string' ? { eventType: event.type } : {}) },
        value: event,
        polarity: 'affirm',
        visibility: 'hidden',
        provenance: { sourceContext: ASSERTION_CONTEXTS.WORLD, sourceAssertionId: `world:event:${eventId}` },
        validity,
      })
    }
    const beliefs = Array.isArray(perspective.believes) ? perspective.believes : []
    const beliefAssertions: AssertionDraft[] = []
    beliefs.forEach((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      const assertion = claimAssertion(
        `perspective:${actorId}:belief:${index + 1}`,
        value as JsonObject,
        {
          source: 'case.perspectives',
          kind: 'belief',
          ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
        },
      )
      relations.add(assertion.relation)
      beliefAssertions.push(assertion)
      assertions.push(assertion)
    })
    const says = asObject(perspective.says)
    for (const [stage, rawStatements] of Object.entries(says).sort(([left], [right]) => compareRaw(left, right))) {
      if (!Array.isArray(rawStatements)) continue
      const statements: AssertionDraft[] = []
      rawStatements.forEach((value, index) => {
        if (value === 'same-as-belief') {
          for (const [beliefIndex, belief] of beliefAssertions.entries()) {
            const copy: AssertionDraft = {
              ...belief,
              id: `perspective:${actorId}:says:${stage}:${index + 1}:${beliefIndex + 1}`,
              provenance: { source: 'case.perspectives', kind: 'statement', stage },
            }
            statements.push(copy)
            assertions.push(copy)
          }
          return
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return
        const claim = value as JsonObject
        const assertion = claimAssertion(
          `perspective:${actorId}:says:${stage}:${index + 1}`,
          claim,
          {
            source: 'case.perspectives',
            kind: 'statement',
            stage,
            ...(typeof claim.intent === 'string' ? { intent: claim.intent } : {}),
          },
        )
        relations.add(assertion.relation)
        statements.push(assertion)
        assertions.push(assertion)
      })
      reveals.set(`${actorId}.says.${stage}`, statements)
      if (stage === 'initial') initialStatements.set(actorId, statements)
    }
    contexts[contextId] = assertions
  }

  for (const list of Object.values(contexts)) list.sort((left, right) => compareRaw(left.id, right.id))
  return { contexts, relations, reveals, initialStatements }
}

function publicCopy(assertion: AssertionDraft): AssertionDraft {
  return {
    ...assertion,
    id: `observed:${assertion.id}`,
    visibility: 'public',
    provenance: {
      sourceAssertionId: assertion.id,
      sourceContext: assertion.id.split(':').slice(0, 2).join(':'),
    },
  }
}

function assertionEvent(assertion: AssertionDraft): RuleEffect {
  return {
    type: 'event.emit',
    event: {
      type: KERNEL_EVENTS.assertionRecorded,
      capability: KERNEL_CAPABILITY,
      payload: {
        contextId: ASSERTION_CONTEXTS.PLAYER_OBSERVED,
        assertion: assertion as unknown as JsonObject,
      },
    },
  }
}

interface RouteTokens {
  readonly actions: Map<string, string>
  readonly events: Map<string, string>
}

function actionSignature(action: CompiledAction): string {
  return stableStringify(action)
}

function collectRouteTokens(ir: CompiledCaseIR): RouteTokens {
  const actionKeys = new Set<string>()
  const eventTypes = new Set<string>()
  const visit = (expression: UnlockExpression): void => {
    if (expression.kind === 'all' || expression.kind === 'any') {
      expression.conditions.forEach(visit)
    } else if (expression.kind === 'action') {
      // `observe` is represented by the authoritative observed assertion, but
      // `open` is a distinct player action and must have its own route token.
      if (!(expression.ref && expression.verb === 'observe')) {
        actionKeys.add(actionSignature(expression))
      }
    } else if (expression.kind === 'event') {
      eventTypes.add(expression.eventType)
    }
  }
  for (const evidence of ir.evidence) {
    if (evidence.availability.kind === 'unlock') visit(evidence.availability.condition)
  }
  return {
    actions: new Map([...actionKeys].sort(compareRaw).map((key, index) => [key, `action_${index + 1}`])),
    events: new Map([...eventTypes].sort(compareRaw).map((key, index) => [key, `event_${index + 1}`])),
  }
}

function eventField(path: string, value: JsonValue): RuleCondition {
  return { type: 'event.field', path, value }
}

function stateEquals(path: string, value: JsonValue): RuleCondition {
  return { type: 'state.slot', path, value }
}

function all(conditions: Array<RuleCondition | undefined>): RuleCondition {
  const defined = conditions.filter((condition): condition is RuleCondition => Boolean(condition))
  if (defined.length === 0) return { type: 'always' }
  if (defined.length === 1) return defined[0]
  return { type: 'all', conditions: defined }
}

function observedCondition(ref: string, ir: CompiledCaseIR): RuleCondition {
  if (ir.observations.some(({ id }) => id === ref)) {
    return {
      type: 'assertion',
      query: {
        contextId: ASSERTION_CONTEXTS.PLAYER_OBSERVED,
        relation: 'evidence.observation',
        key: { observationId: ref },
      },
      status: 'affirmed',
    }
  }
  if (ir.evidence.some(({ id }) => id === ref)) return stateEquals(observationPath(`${ref}.x`), true)
  throw new Error(`Cannot lower unknown observation reference ${ref}`)
}

function conditionToRule(condition: ConditionExpression, ir: CompiledCaseIR): RuleCondition {
  switch (condition.kind) {
    case 'all':
      return all(condition.conditions.map((item) => conditionToRule(item, ir)))
    case 'any':
      return { type: 'any', conditions: condition.conditions.map((item) => conditionToRule(item, ir)) }
    case 'not':
      return { type: 'not', condition: conditionToRule(condition.condition, ir) }
    case 'observed':
      return observedCondition(condition.ref, ir)
    case 'supported':
      return stateEquals(deductionPath(condition.deductionId), true)
    case 'flag':
      return stateEquals(flagPath(condition.flagId), condition.value)
    case 'schedule':
      return {
        type: 'schedule',
        scheduleId: condition.scheduleId,
        status: condition.active ? 'scheduled' : 'cancelled',
      }
  }
}

function actionEventCondition(action: CompiledAction): RuleCondition {
  const conditions: RuleCondition[] = [eventField('payload.action', action.verb)]
  for (const field of ['target', 'actor', 'from', 'topic', 'evidence', 'tone', 'query', 'ref'] as const) {
    const value = action[field]
    if (value !== undefined) conditions.push(eventField(`payload.${field}`, value))
  }
  return all(conditions)
}

function unlockToRule(
  expression: UnlockExpression,
  ir: CompiledCaseIR,
  routes: RouteTokens,
): RuleCondition {
  switch (expression.kind) {
    case 'all':
      return all(expression.conditions.map((item) => unlockToRule(item, ir, routes)))
    case 'any':
      return { type: 'any', conditions: expression.conditions.map((item) => unlockToRule(item, ir, routes)) }
    case 'observed':
      return observedCondition(expression.ref, ir)
    case 'supported':
      return stateEquals(deductionPath(expression.deductionId), true)
    case 'trust':
      return {
        type: 'state.slot',
        path: `${CASE_SLOT}.trust.${safeStateSegment(expression.actorId, 'actor')}`,
        operator: 'gte',
        value: expression.minimum,
      }
    case 'event': {
      const token = routes.events.get(expression.eventType)
      if (!token) throw new Error(`Missing route token for event ${expression.eventType}`)
      return stateEquals(`${CASE_SLOT}.routes.${token}`, true)
    }
    case 'action': {
      const token = routes.actions.get(actionSignature(expression))
      if (!token) throw new Error(`Missing route token for action ${expression.verb}`)
      const actionOccurred = stateEquals(`${CASE_SLOT}.routes.${token}`, true)
      if (expression.ref && expression.verb === 'open') {
        return all([observedCondition(expression.ref, ir), actionOccurred])
      }
      return actionOccurred
    }
  }
}

function reactionTrigger(
  reaction: CompiledReaction,
  ir: CompiledCaseIR,
): { on: string; condition: RuleCondition } {
  if (reaction.trigger.kind === 'action') {
    return { on: CASE_EVENTS.actionPerformed, condition: actionEventCondition(reaction.trigger) }
  }
  if (reaction.trigger.kind === 'deduction-supported') {
    return {
      on: CASE_EVENTS.deductionSupported,
      condition: eventField('payload.deductionId', reaction.trigger.deductionId),
    }
  }
  if (reaction.trigger.kind === 'observation-observed') {
    const observationId = reaction.trigger.observationId
    const observation = ir.observations.find(({id}) => id === observationId)
    if (!observation) {
      throw new Error(`Cannot lower unknown observed trigger ${observationId}`)
    }
    return {
      on: KERNEL_EVENTS.assertionRecorded,
      condition: all([
        eventField('meta.commandType', CASE_COMMANDS.observeEvidence),
        eventField('payload.contextId', ASSERTION_CONTEXTS.PLAYER_OBSERVED),
        eventField('payload.assertion.id', `observed:${observation.id}`),
        eventField('payload.assertion.relation', 'evidence.observation'),
        eventField('payload.assertion.key', {
          observationId: observation.id,
          evidenceId: observation.evidenceId,
          field: observation.field,
        }),
        eventField('payload.assertion.value', asJson(observation.value)),
        eventField('payload.assertion.polarity', 'affirm'),
        eventField('payload.assertion.visibility', 'public'),
        eventField('payload.assertion.provenance', {
          sourceContext: `source:${observation.evidenceId}`,
          sourceAssertionId: sourceAssertionId(observation.id),
        }),
        eventField('payload.assertion.validity', {source: observation.evidenceId}),
        stateEquals(observationPath(observation.id), true),
      ]),
    }
  }
  return { on: reaction.trigger.eventType, condition: { type: 'always' } }
}

function effectToRules(
  effect: Exclude<CompiledEffect, { kind: 'conditional' }>,
  reveals: Map<string, AssertionDraft[]>,
): RuleEffect[] {
  switch (effect.kind) {
    case 'trust':
      return [
        { type: 'state.adjust', path: `${CASE_SLOT}.trust.${safeStateSegment(effect.actorId, 'actor')}`, by: effect.delta },
        { type: 'event.emit', event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY } },
      ]
    case 'flag':
      return [
        { type: 'state.write', path: flagPath(effect.flagId), value: effect.value },
        { type: 'event.emit', event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY } },
      ]
    case 'evidence':
      return [{ type: 'state.write', path: evidenceAccessPath(effect.evidenceId), value: effect.operation === 'grant' ? 'granted' : 'revoked' }]
    case 'reroute':
      return [
        { type: 'state.write', path: evidenceAccessPath(effect.evidenceId), value: 'granted' },
        { type: 'state.write', path: `${CASE_SLOT}.evidence.${safeStateSegment(effect.evidenceId, 'evidence')}.provider`, value: effect.provider },
      ]
    case 'clock-spend':
      if (effect.clock !== 'case-time') throw new Error(`Unsupported rule clock spend ${effect.clock}`)
      return [{ type: 'clock.advance', clock: 'case', byMs: effect.minutes * MINUTE_MS }]
    case 'schedule-cancel':
      return [{ type: 'schedule.cancel', scheduleId: effect.scheduleId }]
    case 'schedule-shift':
      return [{ type: 'schedule.shift', scheduleId: effect.scheduleId, byMs: -effect.earlierByMinutes * MINUTE_MS }]
    case 'event-emit':
      return [{ type: 'event.emit', event: { type: effect.eventType, capability: INVESTIGATION_CAPABILITY } }]
    case 'reveal': {
      const assertions = reveals.get(effect.path)
      if (!assertions) throw new Error(`Unknown perspective reveal ${effect.path}`)
      return assertions.map((assertion) => assertionEvent(publicCopy(assertion)))
    }
    case 'metric-adjust':
      return [{
        type: 'state.adjust',
        path: `${CASE_SLOT}.metrics.${safeStateSegment(effect.metric, 'metric')}.${safeStateSegment(effect.entityId, 'entity')}`,
        by: effect.delta,
      }]
    case 'conversation':
      return [
        {
          type: 'state.write',
          path: `${CASE_SLOT}.actors.${safeStateSegment(effect.actorId, 'actor')}.conversation`,
          value: effect.stateId,
        },
        {
          type: 'event.emit',
          event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY },
        },
      ]
    case 'contact':
      return [
        {
          type: 'state.write',
          path: `${CASE_SLOT}.actors.${safeStateSegment(effect.actorId, 'actor')}.contact`,
          value: effect.state,
        },
        {
          type: 'event.emit',
          event: {
            type: CASE_EVENTS.contactChanged,
            capability: INVESTIGATION_CAPABILITY,
            payload: { actorId: effect.actorId, state: effect.state },
          },
        },
      ]
    case 'affordance':
      return [
        {
          type: 'state.write',
          path: affordanceStatePath(effect.affordanceId),
          value: effect.operation === 'offer' ? 'offered' : 'withdrawn',
        },
        {
          type: 'event.emit',
          event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY },
        },
      ]
  }
}

interface EffectGroup {
  readonly suffix: string
  readonly extraConditions: readonly RuleCondition[]
  readonly effects: readonly RuleEffect[]
}

function expandEffectGroups(
  effects: readonly CompiledEffect[],
  ir: CompiledCaseIR,
  reveals: Map<string, AssertionDraft[]>,
  suffix = 'base',
  extraConditions: readonly RuleCondition[] = [],
): EffectGroup[] {
  const direct: RuleEffect[] = []
  const nested: EffectGroup[] = []
  effects.forEach((effect, index) => {
    if (effect.kind === 'conditional') {
      nested.push(
        ...expandEffectGroups(
          effect.effects,
          ir,
          reveals,
          `${suffix}-conditional-${index + 1}`,
          [...extraConditions, conditionToRule(effect.condition, ir)],
        ),
      )
    } else {
      direct.push(...effectToRules(effect, reveals))
    }
  })
  return [
    ...(direct.length > 0 ? [{ suffix, extraConditions, effects: direct }] : []),
    ...nested,
  ]
}

function objectiveCondition(condition: ConditionExpression): RuntimeObjectiveCondition {
  switch (condition.kind) {
    case 'all':
      return { type: 'all', conditions: condition.conditions.map(objectiveCondition) }
    case 'any':
      return { type: 'any', conditions: condition.conditions.map(objectiveCondition) }
    case 'not':
      return { type: 'not', condition: objectiveCondition(condition.condition) }
    case 'observed':
      return { type: 'observed', observationId: condition.ref }
    case 'supported':
      return { type: 'supported', deductionId: condition.deductionId }
    case 'flag':
      return { type: 'flag', flagId: condition.flagId, marked: condition.value }
    case 'schedule':
      return { type: 'schedule', scheduleId: condition.scheduleId, active: condition.active }
  }
}

function buildActorCatalog(
  ir: CompiledCaseIR,
): Readonly<Record<string, RuntimeActorConversationDefinition>> {
  return Object.fromEntries(
    ir.private.conversations.map((conversation) => [
      conversation.actorId,
      {
        public: conversation.public,
        contactInitial: conversation.contactInitial,
        presentation: conversation.presentation,
        initialState: conversation.initialStateId,
        states: Object.fromEntries(
          conversation.states.map((state) => [
            state.id,
            {
              canTalk: state.canTalk,
              ...(state.reason !== undefined ? { reason: state.reason } : {}),
            },
          ]),
        ),
        channels: conversation.channels,
        allowWhileUnavailable: conversation.allowWhileUnavailable,
      },
    ]),
  )
}

function runtimeAction(action: CompiledAction): CaseAction {
  const result: Record<string, string> = { action: action.verb }
  for (const field of ['target', 'actor', 'from', 'topic', 'evidence', 'tone', 'query', 'ref'] as const) {
    if (action[field] !== undefined) result[field] = action[field]
  }
  return result as unknown as CaseAction
}

function buildAffordanceCatalog(
  ir: CompiledCaseIR,
): Readonly<Record<string, RuntimeAffordanceDefinition>> {
  return Object.fromEntries(
    ir.affordances.map((affordance) => [
      affordance.id,
      {
        label: affordance.label,
        ...(affordance.result !== undefined ? { result: affordance.result } : {}),
        risk: affordance.risk,
        ...(affordance.confirmation !== undefined
          ? { confirmation: affordance.confirmation }
          : {}),
        surface: affordance.surface,
        intent: affordance.intent.kind === 'action'
          ? {kind: 'action' as const, action: runtimeAction(affordance.intent.action)}
          : {kind: 'deduce' as const, deductionId: affordance.intent.deductionId},
        exclusive: affordance.exclusive,
        ...(affordance.interaction ? {
          interaction: {
            kind: affordance.interaction.kind,
            channel: affordance.interaction.channel,
            request: affordance.interaction.request,
            ...(affordance.interaction.context
              ? { context: affordance.interaction.context }
              : {}),
          },
        } : {}),
        ...(affordance.cost ? { cost: affordance.cost } : {}),
        once: affordance.once,
      },
    ]),
  )
}

function buildCatalog(ir: CompiledCaseIR, allowedActions: readonly string[], finalTargets: readonly string[]): CaseRuntimeCatalog {
  const assets = new Map(ir.assets.map((asset) => [asset.id, asset]))
  const observations = Object.fromEntries(
    ir.observations.map((observation) => [
      observation.id,
      {
        evidenceId: observation.evidenceId,
        field: observation.field,
        value: asJson(observation.value),
        sourceAssertionId: sourceAssertionId(observation.id),
      },
    ]),
  )
  const deductions = Object.fromEntries(
    ir.deductions.map((deduction): [string, RuntimeDeductionDefinition] => [
      deduction.id,
      {
        conclusion: deduction.conclusion as JsonObject,
        requiredDeductions: deduction.requiredDeductions,
        proofAlternatives: deduction.proofAlternatives.map((alternative) => ({
          terms: alternative.terms.map((term) =>
            term.kind === 'observation'
              ? { type: 'observation' as const, id: term.ref }
              : { type: 'deduction' as const, id: term.deductionId },
          ),
          checks: alternative.checks.map((check) => {
            if (check.kind === 'equals') return { type: 'equals' as const, ref: check.ref, value: asJson(check.value) }
            if (check.kind === 'notEquals') return { type: 'notEquals' as const, ref: check.ref, value: asJson(check.value) }
            if (check.kind === 'numberLessThan') return { type: 'numberLessThan' as const, ref: check.ref, value: check.value }
            if (check.kind === 'numberGreaterThan') return { type: 'numberGreaterThan' as const, ref: check.ref, value: check.value }
            if (check.kind === 'arrayContains') return { type: 'arrayContains' as const, ref: check.ref, value: asJson(check.value) }
            if (check.kind === 'arrayCountEquals') return { type: 'arrayCountEquals' as const, ref: check.ref, count: check.count }
            if (check.kind === 'timeOffsetEquals') {
              return {
                type: 'timeOffsetEquals' as const,
                shownRef: check.shownRef,
                offsetRef: check.offsetRef,
                expected: check.expected,
              }
            }
            if (check.kind === 'beforeValue') return { type: 'beforeValue' as const, leftRef: check.leftRef, rightValue: check.rightValue }
            if (check.kind === 'beforeRef') return { type: 'beforeRef' as const, leftRef: check.leftRef, rightRef: check.rightRef }
            if (check.kind === 'afterValue') return { type: 'afterValue' as const, leftRef: check.leftRef, rightValue: check.rightValue }
            return { type: 'afterRef' as const, leftRef: check.leftRef, rightRef: check.rightRef }
          }),
        })),
      },
    ]),
  )
  const outcomes: RuntimeOutcomeDefinition[] = ir.private.outcomes.map((outcome) => ({
    id: outcome.id,
    title: outcome.title,
    ...(outcome.body !== undefined ? { body: outcome.body } : {}),
    priority: outcome.priority,
    requiredObjectives: outcome.requiredObjectives,
    excludedObjectives: outcome.excludedObjectives,
    finalTargets: outcome.finalTargets,
    ...(outcome.whenFlag ? { whenMarked: outcome.whenFlag } : {}),
    whenAnyMarked: outcome.whenAnyFlags,
  }))
  const assessment = ir.private.assessment
    ? {
        maxScore: ir.private.assessment.maxScore,
        bands: ir.private.assessment.bands.map((band) => ({
          minScore: band.minScore,
          label: band.label,
        })),
        categories: ir.private.assessment.categories.map((category) => ({
          id: category.id,
          label: category.label,
          criteria: category.criteria.map((criterion) => ({
            id: criterion.id,
            points: criterion.points,
            when: objectiveCondition(criterion.when),
            met: criterion.met,
            missed: criterion.missed,
          })),
        })),
      }
    : undefined
  return {
    schema: CASE_RUNTIME_SCHEMA,
    actors: buildActorCatalog(ir),
    affordances: buildAffordanceCatalog(ir),
    evidence: Object.fromEntries(
      ir.evidence.map((evidence) => [
        evidence.id,
        {
          tool: evidence.tool,
          ...(evidence.presentation ? {
            presentation: {
              title: evidence.presentation.title,
              ...(evidence.presentation.description !== undefined
                ? { description: evidence.presentation.description }
                : {}),
              findings: Object.fromEntries(
                Object.entries(evidence.presentation.findings)
                  .sort(([left], [right]) => compareRaw(left, right))
                  .map(([field, text]) => [field, text]),
              ),
            },
          } : {}),
          assets: evidence.assetIds.map((assetId) => {
            const asset = assets.get(assetId)
            if (!asset) throw new Error(`Evidence ${evidence.id} references unknown asset ${assetId}`)
            // Copy the fixed handle fields explicitly. Never spread the trusted
            // asset record: it also carries private source paths/URLs/provider refs.
            return {
              id: asset.handle.id,
              kind: asset.handle.kind,
              mimeType: asset.handle.mimeType,
            }
          }),
        },
      ]),
    ),
    observations,
    deductions,
    allowedActions,
    allowedFinalTargets: finalTargets,
    finalConclusion: ir.case.finalConclusion,
    objectives: Object.fromEntries(
      ir.private.objectives.map((objective) => [objective.id, objectiveCondition(objective.condition)]),
    ),
    outcomes,
    ...(assessment ? { assessment } : {}),
    deadlines: Object.fromEntries(
      ir.private.deadlines.map((deadline) => [
        deadline.id,
        deadline.label !== undefined ? { label: deadline.label } : {},
      ]),
    ),
  }
}

function buildEntities(ir: CompiledCaseIR): EntityDefinition[] {
  const result: EntityDefinition[] = []
  for (const [id, data] of entries(ir.entities.cast)) result.push({ id, typeId: 'actor', data })
  for (const [id, value] of Object.entries(ir.entities.places).sort(([left], [right]) => compareRaw(left, right))) {
    const source = asObject(value)
    const mechanicalData = Object.fromEntries(
      Object.entries(source).filter(([key]) =>
        key !== '$text' &&
        key !== 'name' &&
        key !== 'display_name' &&
        key !== 'protected' &&
        key !== 'hidden' &&
        key !== 'public' &&
        key !== 'visibility',
      ),
    ) as JsonObject
    result.push({
      id,
      typeId: 'place',
      ...(Object.keys(mechanicalData).length > 0 ? { data: mechanicalData } : {}),
    })
  }
  for (const [id, data] of entries(ir.entities.things)) {
    result.push({
      id,
      typeId: typeof data.type === 'string' ? data.type : 'thing',
      data,
    })
  }
  return result.sort((left, right) => compareRaw(left.id, right.id))
}

function buildTypes(ir: CompiledCaseIR): TypeDefinition[] {
  const thingTypes = new Set<string>()
  for (const [, data] of entries(ir.entities.things)) {
    if (typeof data.type === 'string' && data.type !== 'thing') thingTypes.add(data.type)
  }
  return [
    { id: 'actor' },
    { id: 'place' },
    { id: 'thing' },
    ...[...thingTypes].sort(compareRaw).map((id) => ({ id, parentId: 'thing' })),
  ]
}

function buildContexts(ir: CompiledCaseIR): ContextDefinition[] {
  return [
    { id: ASSERTION_CONTEXTS.WORLD, kind: 'world' },
    { id: ASSERTION_CONTEXTS.PLAYER_OBSERVED, kind: 'observed' },
    { id: ASSERTION_CONTEXTS.PLAYER_HYPOTHESIZED, kind: 'hypothesized' },
    ...Object.keys(ir.entities.cast).sort(compareRaw).map((actorId) => ({
      id: `perspective:${actorId}`,
      kind: 'perspective' as const,
      data: { actorId },
    })),
    ...ir.evidence.map((evidence) => ({
      id: `source:${evidence.id}`,
      kind: 'source' as const,
      data: { evidenceId: evidence.id },
    })),
  ]
}

function initialSlots(ir: CompiledCaseIR, routes: RouteTokens): JsonObject {
  const castIds = Object.keys(ir.entities.cast).sort(compareRaw)
  const actors = buildActorCatalog(ir)
  const metricNames = new Set<string>()
  for (const reaction of ir.private.reactions) {
    const visit = (effects: readonly CompiledEffect[]): void => {
      for (const effect of effects) {
        if (effect.kind === 'metric-adjust') metricNames.add(effect.metric)
        else if (effect.kind === 'conditional') visit(effect.effects)
      }
    }
    visit(reaction.effects)
  }
  return {
    [CASE_SLOT]: {
      actors: Object.fromEntries(
        Object.entries(actors).map(([id, actor]) => [
          id,
          { conversation: actor.initialState, contact: actor.contactInitial },
        ]),
      ),
      affordances: Object.fromEntries(
        ir.affordances.map((affordance) => [affordance.id, affordance.initial]),
      ),
      evidence: Object.fromEntries(
        ir.evidence.map((evidence) => [
          evidence.id,
          {
            access: evidence.availability.kind === 'opening' ? 'granted' : 'locked',
            observed: false,
            provider: null,
          },
        ]),
      ),
      deductions: Object.fromEntries(ir.deductions.map(({ id }) => [id, false])),
      flags: Object.fromEntries(ir.private.flags.map((id) => [id, false])),
      trust: Object.fromEntries(castIds.map((id) => [id, 0])),
      metrics: Object.fromEntries(
        [...metricNames].sort(compareRaw).map((metric) => [
          metric,
          Object.fromEntries(castIds.map((id) => [id, 0])),
        ]),
      ),
      final: { target: null },
      routes: Object.fromEntries(
        [...routes.actions.values(), ...routes.events.values()].sort(compareRaw).map((token) => [token, false]),
      ),
    },
  }
}

function schedulePlan(deadline: CompiledCaseIR['private']['deadlines'][number]): SchedulePlan {
  const clock = deadline.clock === 'case-time' ? 'case' : deadline.offline === 'pause' ? 'active' : 'wall'
  return {
    id: deadline.id,
    clock,
    afterMs: deadline.afterMinutes * MINUTE_MS,
    deliveryPolicy: clock === 'wall' && deadline.offline === 'on-resume-once' ? 'on_resume' : 'immediate',
    event: {
      type: CASE_EVENTS.deadlineReached,
      capability: INVESTIGATION_CAPABILITY,
      payload: { deadlineId: deadline.id },
    },
  }
}

function collectAllowedActions(ir: CompiledCaseIR): string[] {
  const manifests = ir.capabilityLocks.map((lock) => getCapabilityManifest(lock.specifier))
  if (manifests.some((manifest) => !manifest)) throw new Error('Compiled case contains an unknown capability')
  return [
    ...capabilityVocabulary(
      manifests.filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest)),
    ).verbs,
  ].sort(compareRaw)
}

function collectFinalTargets(ir: CompiledCaseIR): string[] {
  const targets = new Set(ir.private.outcomes.flatMap((outcome) => outcome.finalTargets))
  for (const reaction of ir.private.reactions) {
    if (reaction.trigger.kind === 'action' && reaction.trigger.verb === 'submit-conclusion' && reaction.trigger.target) {
      targets.add(reaction.trigger.target)
    }
  }
  return [...targets].sort(compareRaw)
}

function routeRules(routes: RouteTokens): RulePlan[] {
  const rules: RulePlan[] = []
  for (const [signature, token] of routes.actions) {
    const action = JSON.parse(signature) as CompiledAction
    rules.push({
      id: `route:${token}`,
      on: CASE_EVENTS.actionPerformed,
      when: actionEventCondition(action),
      effects: [
        { type: 'state.write', path: `${CASE_SLOT}.routes.${token}`, value: true },
        { type: 'event.emit', event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY } },
      ],
      once: true,
    })
  }
  for (const [eventType, token] of routes.events) {
    rules.push({
      id: `route:${token}`,
      on: eventType,
      effects: [
        { type: 'state.write', path: `${CASE_SLOT}.routes.${token}`, value: true },
        { type: 'event.emit', event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY } },
      ],
      once: true,
    })
  }
  return rules
}

function buildRules(
  ir: CompiledCaseIR,
  assertions: AssertionBuild,
  routes: RouteTokens,
  finalTargets: readonly string[],
): RulePlan[] {
  const rules = routeRules(routes)

  for (const affordance of ir.affordances) {
    const trigger = affordance.intent.kind === 'action'
      ? {
          on: CASE_EVENTS.actionPerformed,
          condition: actionEventCondition(affordance.intent.action),
        }
      : {
          on: CASE_EVENTS.deductionSupported,
          condition: eventField('payload.deductionId', affordance.intent.deductionId),
        }
    rules.push({
      id: `affordance-used:${affordance.id}`,
      on: trigger.on,
      when: all([
        stateEquals(affordanceStatePath(affordance.id), 'offered'),
        trigger.condition,
      ]),
      effects: [
        ...(affordance.cost ? [{
          type: 'clock.advance' as const,
          clock: 'case' as const,
          byMs: affordance.cost.milliseconds,
        }] : []),
        ...(affordance.once ? [{
          type: 'state.write' as const,
          path: affordanceStatePath(affordance.id),
          value: 'withdrawn',
        }] : []),
        { type: 'event.emit', event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY } },
      ],
      once: false,
    })
  }

  for (const evidence of ir.evidence) {
    rules.push({
      id: `evidence-observed:${evidence.id}`,
      on: CASE_EVENTS.evidenceObserved,
      when: eventField('payload.evidenceId', evidence.id),
      effects: [
        { type: 'state.write', path: `${CASE_SLOT}.evidence.${evidence.id}.observed`, value: true },
        { type: 'event.emit', event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY } },
      ],
      once: true,
    })
    if (evidence.availability.kind === 'unlock') {
      rules.push({
        id: `evidence-unlock:${evidence.id}`,
        on: '*',
        when: all([
          stateEquals(evidenceAccessPath(evidence.id), 'locked'),
          unlockToRule(evidence.availability.condition, ir, routes),
        ]),
        effects: [{ type: 'state.write', path: evidenceAccessPath(evidence.id), value: 'granted' }],
        once: true,
      })
    }
  }

  for (const deduction of ir.deductions) {
    rules.push({
      id: `deduction-supported:${deduction.id}`,
      on: CASE_EVENTS.deductionSupported,
      when: eventField('payload.deductionId', deduction.id),
      effects: [
        { type: 'state.write', path: deductionPath(deduction.id), value: true },
        { type: 'event.emit', event: { type: CASE_EVENTS.routeProgressed, capability: INVESTIGATION_CAPABILITY } },
      ],
      once: true,
    })
  }

  for (const target of finalTargets) {
    rules.push({
      id: `final-conclusion:${target}`,
      on: CASE_EVENTS.actionPerformed,
      when: all([
        eventField('payload.action', 'submit-conclusion'),
        eventField('payload.target', target),
        ...(ir.case.finalConclusion === 'first-write-wins'
          ? [stateEquals(`${CASE_SLOT}.final.target`, null)]
          : []),
      ]),
      effects: [{ type: 'state.write', path: `${CASE_SLOT}.final.target`, value: target }],
      once: ir.case.finalConclusion === 'first-write-wins',
    })
  }

  for (const [actorId, statements] of assertions.initialStatements) {
    if (statements.length === 0) continue
    rules.push({
      id: `initial-statements:${actorId}`,
      on: CASE_EVENTS.actionPerformed,
      when: all([
        eventField('payload.action', 'interview'),
        {
          type: 'any',
          conditions: [eventField('payload.actor', actorId), eventField('payload.target', actorId)],
        },
      ]),
      effects: statements.map((statement) => assertionEvent(publicCopy(statement))),
      once: true,
    })
  }

  for (const reaction of ir.private.reactions) {
    const trigger = reactionTrigger(reaction, ir)
    const baseConditions: RuleCondition[] = [trigger.condition]
    if (reaction.when) baseConditions.push(conditionToRule(reaction.when, ir))
    if (reaction.unless) {
      baseConditions.push({ type: 'not', condition: conditionToRule(reaction.unless, ir) })
    }
    for (const group of expandEffectGroups(reaction.effects, ir, assertions.reveals)) {
      rules.push({
        id: `reaction:${reaction.id}:${group.suffix}`,
        on: trigger.on,
        priority: reaction.priority,
        when: all([...baseConditions, ...group.extraConditions]),
        effects: group.effects,
        once: reaction.once,
      })
    }
  }

  for (const deadline of ir.private.deadlines) {
    for (const group of expandEffectGroups(deadline.effects, ir, assertions.reveals)) {
      rules.push({
        id: `deadline:${deadline.id}:${group.suffix}`,
        on: CASE_EVENTS.deadlineReached,
        when: all([
          eventField('payload.deadlineId', deadline.id),
          ...(deadline.cancelOn ? [stateEquals(flagPath(deadline.cancelOn), false)] : []),
          ...group.extraConditions,
        ]),
        effects: group.effects,
        once: true,
      })
    }
    if (deadline.cancelOn) {
      rules.push({
        id: `deadline-cancel-on:${deadline.id}`,
        on: '*',
        when: all([
          stateEquals(flagPath(deadline.cancelOn), true),
          { type: 'schedule', scheduleId: deadline.id, status: 'scheduled' },
        ]),
        effects: [{ type: 'schedule.cancel', scheduleId: deadline.id }],
        once: true,
      })
    }
  }

  for (const evidence of ir.evidence) {
    if (!evidence.expiresWith) continue
    rules.push({
      id: `evidence-expiry:${evidence.id}`,
      on: CASE_EVENTS.deadlineReached,
      when: eventField('payload.deadlineId', evidence.expiresWith),
      effects: [{ type: 'state.write', path: evidenceAccessPath(evidence.id), value: 'revoked' }],
      once: true,
    })
  }

  return rules.sort((left, right) => compareRaw(left.id, right.id))
}

/**
 * Pure second compiler phase. The result contains only kernel ontology,
 * assertions, state, schedules and primitive rules; no YAML templates or raw
 * reaction macros survive into session execution.
 */
export function compileToKernelIR(ir: CompiledCaseIR): CaseKernelIR {
  const locks: CapabilityRef[] = ir.capabilityLocks.map((lock) => ({
    id: lock.id,
    version: String(lock.version),
    digest: lock.digest,
  }))
  assertTrustedCapabilityLocks(locks)
  const assertions = buildAssertions(ir)
  const routes = collectRouteTokens(ir)
  const finalTargets = collectFinalTargets(ir)
  const allowedActions = collectAllowedActions(ir)
  const catalog = buildCatalog(ir, allowedActions, finalTargets)
  const rules = buildRules(ir, assertions, routes, finalTargets)
  const relations: RelationDefinition[] = [...assertions.relations]
    .sort(compareRaw)
    .map((id) => ({
      id,
      cardinality:
        id === 'evidence.observation' || id === 'deduction.conclusion'
          ? 'one_per_context'
          : 'many_per_context',
    }))

  const opening = asObject(ir.opening)
  const startedDeadlines = new Set(strings(opening.starts))

  const withoutDigest = {
    schemaVersion: 'case-kernel-ir/v1',
    id: ir.case.id,
    version: ir.case.version,
    capabilities: locks,
    types: buildTypes(ir),
    entities: buildEntities(ir),
    relations,
    contexts: buildContexts(ir),
    rules,
    initial: {
      caseTimeMs: 0,
      activeTimeMs: 0,
      assertions: { contexts: assertions.contexts },
      capabilityState: {
        [`${INVESTIGATION_CAPABILITY.id}@${INVESTIGATION_CAPABILITY.version}`]: catalog as unknown as JsonObject,
      },
      slots: initialSlots(ir, routes),
      schedules: ir.private.deadlines.filter(({ id }) => startedDeadlines.has(id)).map(schedulePlan),
    },
  }
  return {
    ...withoutDigest,
    digest: hashCanonical({
      adapter: 'case-runtime/v1',
      sourcePrivateIr: ir.integrity.privateIr,
      kernel: withoutDigest,
    }),
  }
}

export function compileCaseRuntime(ir: CompiledCaseIR): CaseKernelIR {
  return compileToKernelIR(ir)
}
