import {
  ASSERTION_CONTEXTS,
  projectPublicState,
  type Assertion,
  type JsonObject,
  type JsonValue,
  type KernelSession,
} from '../kernel'

import {
  CASE_RUNTIME_SCHEMA,
  CASE_EVENTS,
  CASE_SLOT,
  type CaseAction,
  type CaseRuntimeCatalog,
  type CasePresentationCatalog,
  type PublicCaseActivityEntry,
  type PublicCaseRuntimeState,
  type RuntimeAssessmentDefinition,
  type RuntimeObjectiveCondition,
} from './protocol'
import { isActorDecisionTargetListed } from './decision-visibility'

const CATALOG_KEY = 'investigation@1'

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function catalog(session: KernelSession): CaseRuntimeCatalog {
  const value = object(session.state.capabilityState[CATALOG_KEY], 'case runtime catalog')
  if (value.schema !== CASE_RUNTIME_SCHEMA) throw new Error('Unsupported case runtime catalog')
  return value as unknown as CaseRuntimeCatalog
}

function runtimeSlots(session: KernelSession): JsonObject {
  return object(session.state.slots[CASE_SLOT], 'case runtime state')
}

function mapAssertions(assertions: readonly Assertion[]): JsonObject[] {
  return assertions.map((assertion) => ({
    id: assertion.id,
    relation: assertion.relation,
    key: assertion.key,
    value: assertion.value,
    polarity: assertion.polarity,
    ...(assertion.confidence !== undefined ? { confidence: assertion.confidence } : {}),
    ...(assertion.provenance ? { provenance: assertion.provenance } : {}),
    validity: assertion.validity,
    assertedAt: assertion.assertedAt,
  }))
}

function conditionSatisfied(
  condition: RuntimeObjectiveCondition,
  session: KernelSession,
  slots: JsonObject,
): boolean {
  if (condition.type === 'all') {
    return condition.conditions.every((item) => conditionSatisfied(item, session, slots))
  }
  if (condition.type === 'any') {
    return condition.conditions.some((item) => conditionSatisfied(item, session, slots))
  }
  if (condition.type === 'not') return !conditionSatisfied(condition.condition, session, slots)
  if (condition.type === 'schedule') {
    const active = session.state.schedules[condition.scheduleId]?.status === 'scheduled'
    return active === condition.active
  }
  if (condition.type === 'observed') {
    const evidence = object(slots.evidence, 'case runtime evidence')
    const observation = session.state.assertions.contexts[ASSERTION_CONTEXTS.PLAYER_OBSERVED] ?? []
    return (
      Object.values(evidence).some(
        (value) => value && typeof value === 'object' && !Array.isArray(value) && value.observed === true,
      ) &&
      observation.some(
        (assertion) =>
          assertion.relation === 'evidence.observation' &&
          assertion.polarity === 'affirm' &&
          assertion.key.observationId === condition.observationId,
      )
    )
  }
  if (condition.type === 'supported') {
    return object(slots.deductions, 'case runtime deductions')[condition.deductionId] === true
  }
  return object(slots.flags, 'case runtime flags')[condition.flagId] === condition.marked
}

function presentedOutcome(
  outcome: CaseRuntimeCatalog['outcomes'][number],
  presentation?: CasePresentationCatalog,
): NonNullable<PublicCaseRuntimeState['outcome']> {
  const title = typeof outcome.title === 'string'
    ? { title: outcome.title }
    : presentation?.messages[outcome.title.$text] !== undefined
      ? { title: presentation.messages[outcome.title.$text] }
      : { textKey: outcome.title.$text }
  const body = typeof outcome.body === 'string'
    ? { body: outcome.body }
    : outcome.body && presentation?.messages[outcome.body.$text] !== undefined
      ? { body: presentation.messages[outcome.body.$text] }
      : outcome.body
        ? { bodyKey: outcome.body.$text }
        : {}
  return { id: outcome.id, ...title, ...body }
}

function presentedAssessmentText(
  text: RuntimeAssessmentDefinition['bands'][number]['label'],
  valueName: 'bandLabel' | 'label' | 'text',
  keyName: 'bandLabelKey' | 'labelKey' | 'textKey',
  presentation?: CasePresentationCatalog,
): Record<string, string> {
  if (typeof text === 'string') return { [valueName]: text }
  const translated = presentation?.messages[text.$text]
  return translated !== undefined
    ? { [valueName]: translated }
    : { [keyName]: text.$text }
}

function presentedAssessment(
  definition: RuntimeAssessmentDefinition,
  session: KernelSession,
  slots: JsonObject,
  presentation?: CasePresentationCatalog,
): NonNullable<NonNullable<PublicCaseRuntimeState['outcome']>['assessment']> {
  const categories = definition.categories.map((category) => {
    const details = category.criteria.map((criterion) => {
      const met = conditionSatisfied(criterion.when, session, slots)
      return {
        status: met ? 'met' as const : 'missed' as const,
        score: met ? criterion.points : 0,
        maxScore: criterion.points,
        ...presentedAssessmentText(
          met ? criterion.met : criterion.missed,
          'text',
          'textKey',
          presentation,
        ),
      }
    })
    return {
      ...presentedAssessmentText(category.label, 'label', 'labelKey', presentation),
      score: details.reduce((sum, detail) => sum + detail.score, 0),
      maxScore: category.criteria.reduce((sum, criterion) => sum + criterion.points, 0),
      details,
    }
  })
  const score = categories.reduce((sum, category) => sum + category.score, 0)
  const band = [...definition.bands]
    .sort((left, right) => right.minScore - left.minScore)
    .find((candidate) => candidate.minScore <= score)
  return {
    score,
    maxScore: definition.maxScore,
    ...(band
      ? presentedAssessmentText(band.label, 'bandLabel', 'bandLabelKey', presentation)
      : {}),
    categories,
  }
}

function presentedConversationReason(
  reason: CaseRuntimeCatalog['actors'][string]['states'][string]['reason'],
  presentation?: CasePresentationCatalog,
): { reason?: string; reasonKey?: string } {
  if (reason === undefined) return {}
  if (typeof reason === 'string') return { reason }
  const translated = presentation?.messages[reason.$text]
  return translated !== undefined ? { reason: translated } : { reasonKey: reason.$text }
}

function presentedAffordanceLabel(
  label: CaseRuntimeCatalog['affordances'][string]['label'],
  presentation?: CasePresentationCatalog,
): { label?: string; labelKey?: string } {
  if (typeof label === 'string') return { label }
  const translated = presentation?.messages[label.$text]
  return translated !== undefined ? { label: translated } : { labelKey: label.$text }
}

function presentedAffordanceResult(
  result: CaseRuntimeCatalog['affordances'][string]['result'],
  presentation?: CasePresentationCatalog,
): { result?: string; resultKey?: string } {
  if (result === undefined) return {}
  if (typeof result === 'string') return { result }
  const translated = presentation?.messages[result.$text]
  return translated !== undefined ? { result: translated } : { resultKey: result.$text }
}

function presentedAffordanceConfirmation(
  confirmation: CaseRuntimeCatalog['affordances'][string]['confirmation'],
  presentation?: CasePresentationCatalog,
): { confirmation?: string; confirmationKey?: string } {
  if (confirmation === undefined) return {}
  if (typeof confirmation === 'string') return { confirmation }
  const translated = presentation?.messages[confirmation.$text]
  return translated !== undefined
    ? { confirmation: translated }
    : { confirmationKey: confirmation.$text }
}

function presentedAffordanceInteraction(
  interaction: CaseRuntimeCatalog['affordances'][string]['interaction'],
  presentation?: CasePresentationCatalog,
): { interaction?: NonNullable<PublicCaseRuntimeState['affordances'][number]['interaction']> } {
  if (!interaction) return {}
  const request = typeof interaction.request === 'string'
    ? { request: interaction.request }
    : presentation?.messages[interaction.request.$text] !== undefined
      ? { request: presentation.messages[interaction.request.$text] }
      : { requestKey: interaction.request.$text }
  return {
    interaction: {
      kind: interaction.kind,
      channel: interaction.channel,
      ...request,
      ...(interaction.context ? { context: interaction.context } : {}),
    },
  }
}

function presentedActorText(
  text: CaseRuntimeCatalog['actors'][string]['presentation']['name'],
  valueName: 'name' | 'displayName' | 'role' | 'status' | 'contactSource' | 'pronouns',
  keyName:
    | 'nameKey'
    | 'displayNameKey'
    | 'roleKey'
    | 'statusKey'
    | 'contactSourceKey'
    | 'pronounsKey',
  presentation?: CasePresentationCatalog,
): Record<string, string> {
  if (text === undefined) return {}
  if (typeof text === 'string') return { [valueName]: text }
  const translated = presentation?.messages[text.$text]
  return translated !== undefined
    ? { [valueName]: translated }
    : { [keyName]: text.$text }
}

function presentedActor(
  definition: CaseRuntimeCatalog['actors'][string],
  presentation?: CasePresentationCatalog,
): Omit<PublicCaseRuntimeState['actors'][number], 'id' | 'conversation'> {
  const actor = definition.presentation
  return {
    ...presentedActorText(actor.name, 'name', 'nameKey', presentation),
    ...presentedActorText(actor.displayName, 'displayName', 'displayNameKey', presentation),
    ...presentedActorText(actor.role, 'role', 'roleKey', presentation),
    ...presentedActorText(actor.status, 'status', 'statusKey', presentation),
    ...(actor.phone !== undefined ? { phone: actor.phone } : {}),
    ...(actor.operator !== undefined ? { operator: actor.operator } : {}),
    ...presentedActorText(
      actor.contactSource,
      'contactSource',
      'contactSourceKey',
      presentation,
    ),
    ...presentedActorText(actor.pronouns, 'pronouns', 'pronounsKey', presentation),
    ...(actor.client !== undefined ? { client: actor.client } : {}),
  }
}

function presentedEvidenceText(
  text: NonNullable<CaseRuntimeCatalog['evidence'][string]['presentation']>['title'] | undefined,
  valueName: 'title' | 'description' | 'text',
  keyName: 'titleKey' | 'descriptionKey' | 'textKey',
  presentation?: CasePresentationCatalog,
): Record<string, string> {
  if (text === undefined) return {}
  if (typeof text === 'string') return { [valueName]: text }
  const translated = presentation?.messages[text.$text]
  return translated !== undefined
    ? { [valueName]: translated }
    : { [keyName]: text.$text }
}

function actionMatches(
  authored: CaseAction,
  payload: JsonObject,
): boolean {
  const fields = ['action', 'target', 'actor', 'from', 'topic', 'evidence', 'tone', 'query', 'ref'] as const
  return fields.every((field) => authored[field] === payload[field])
}

function clockNow(
  clock: 'case' | 'active' | 'wall',
  clocks: PublicCaseRuntimeState['clocks'],
): number {
  if (clock === 'case') return clocks.caseTimeMs
  if (clock === 'active') return clocks.activeTimeMs
  return clocks.wallTimeMs
}

export function projectCaseState(
  session: KernelSession,
  presentation?: CasePresentationCatalog,
): PublicCaseRuntimeState {
  const kernel = projectPublicState(session.state)
  const privateCatalog = catalog(session)
  const slots = runtimeSlots(session)
  const evidenceSlots = object(slots.evidence, 'case runtime evidence')
  const actorSlots = object(slots.actors, 'case runtime actors')
  const affordanceSlots = object(slots.affordances, 'case runtime affordances')
  const deductionSlots = object(slots.deductions, 'case runtime deductions')
  const finalSlots = object(slots.final, 'case runtime final conclusion')
  const listedActorIds = new Set(Object.entries(privateCatalog.actors).flatMap(([id, definition]) => {
    if (!definition.public) return []
    const actorState = object(actorSlots[id], `actor state ${id}`)
    const contact = actorState.contact ?? definition.contactInitial
    if (contact !== 'hidden' && contact !== 'listed') {
      throw new Error(`Unknown contact state ${String(contact)} for actor ${id}`)
    }
    return contact === 'listed' ? [id] : []
  }))
  const objectiveState = Object.fromEntries(
    Object.entries(privateCatalog.objectives).map(([id, condition]) => [
      id,
      conditionSatisfied(condition, session, slots),
    ]),
  )
  const target = typeof finalSlots.target === 'string' ? finalSlots.target : undefined
  const flags = object(slots.flags, 'case runtime flags')
  const outcome = [...privateCatalog.outcomes]
    .sort((left, right) => right.priority - left.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .find((candidate) => {
      if (!candidate.requiredObjectives.every((id) => objectiveState[id] === true)) return false
      if (candidate.excludedObjectives.some((id) => objectiveState[id] === true)) return false
      if (candidate.finalTargets.length > 0 && (!target || !candidate.finalTargets.includes(target))) return false
      if (candidate.whenMarked && flags[candidate.whenMarked] !== true) return false
      if (
        candidate.whenAnyMarked.length > 0 &&
        !candidate.whenAnyMarked.some((flagId) => flags[flagId] === true)
      ) {
        return false
      }
      return true
    })
  const caseClosed = kernel.status === 'ended' || outcome !== undefined
  const completedAffordances = session.eventLog.flatMap((event) => {
    const match = event.type === CASE_EVENTS.actionPerformed
      ? Object.entries(privateCatalog.affordances).find(([, definition]) => (
          definition.intent.kind === 'action' && actionMatches(definition.intent.action, event.payload)
        ))
      : event.type === CASE_EVENTS.deductionSupported && typeof event.payload.deductionId === 'string'
        ? Object.entries(privateCatalog.affordances).find(([, definition]) => (
            definition.intent.kind === 'deduce' &&
            definition.intent.deductionId === event.payload.deductionId
          ))
        : undefined
    if (!match) return []
    const [id, definition] = match
    const contactsListed = session.eventLog
      .filter((candidate) => (
        candidate.meta.commandId === event.meta.commandId &&
        candidate.type === CASE_EVENTS.contactChanged &&
        candidate.payload.state === 'listed' &&
        typeof candidate.payload.actorId === 'string'
      ))
      .map((candidate) => String(candidate.payload.actorId))
      .filter((actorId, index, all) => all.indexOf(actorId) === index)
      .sort()
    return [{
      id,
      surface: definition.surface,
      intent: definition.intent,
      ...(definition.cost ? { cost: definition.cost } : {}),
      ...presentedAffordanceLabel(definition.label, presentation),
      ...presentedAffordanceResult(definition.result, presentation),
      risk: definition.risk,
      completedAtMs: event.meta.occurredAt.caseTimeMs + (definition.cost?.milliseconds ?? 0),
      eventSequence: event.meta.sequence,
      ...presentedAffordanceInteraction(definition.interaction, presentation),
      ...(contactsListed.length > 0 ? { contactsListed } : {}),
    }]
  })
  const completedAffordancesBySequence = new Map(
    completedAffordances.map((completed) => [completed.eventSequence, completed]),
  )
  const activity = session.eventLog
    .flatMap<PublicCaseActivityEntry>((event) => {
      if (
        event.type === CASE_EVENTS.evidenceObserved &&
        typeof event.payload.evidenceId === 'string' &&
        privateCatalog.evidence[event.payload.evidenceId]
      ) {
        const evidenceId = event.payload.evidenceId
        const current = evidenceSlots[evidenceId]
        if (
          !current ||
          typeof current !== 'object' ||
          Array.isArray(current) ||
          (current.access !== 'granted' && current.observed !== true)
        ) {
          return []
        }
        return [{
          id: `activity:${event.meta.sequence}`,
          kind: 'evidence-observed' as const,
          sequence: event.meta.sequence,
          occurredAtMs: event.meta.occurredAt.caseTimeMs,
          evidenceId,
        }]
      }

      const completed = completedAffordancesBySequence.get(event.meta.sequence)
      if (!completed) return []
      return [{
        id: `activity:${event.meta.sequence}`,
        kind: 'affordance-completed' as const,
        sequence: event.meta.sequence,
        occurredAtMs: completed.completedAtMs,
        affordanceId: completed.id,
      }]
    })
    .sort((left, right) => left.sequence - right.sequence)

  return {
    schema: 'case-runtime/public-v1',
    status: caseClosed ? 'ended' : 'active',
    revision: kernel.revision,
    case: {
      id: kernel.case.id,
      version: kernel.case.version,
      digest: kernel.case.digest,
    },
    clocks: kernel.clocks,
    affordances: (caseClosed ? [] : Object.entries(privateCatalog.affordances))
      .filter(([id, definition]) => {
        if (affordanceSlots[id] !== 'offered') return false
        if (definition.intent.kind === 'deduce') {
          return deductionSlots[definition.intent.deductionId] !== true
        }
        if (definition.intent.kind !== 'action') return true
        const action = definition.intent.action
        if (!isActorDecisionTargetListed(privateCatalog, actorSlots, action)) return false
        const prerequisite = action.evidence ?? (
          action.ref && privateCatalog.evidence[action.ref] ? action.ref : undefined
        )
        if (!prerequisite) return true
        const evidenceState = evidenceSlots[prerequisite]
        return Boolean(
          evidenceState &&
          typeof evidenceState === 'object' &&
          !Array.isArray(evidenceState) &&
          evidenceState.observed === true,
        )
      })
      .map(([id, definition]) => ({
        id,
        surface: definition.surface,
        intent: definition.intent.kind === 'deduce'
          ? {kind: 'deduce' as const, deductionId: definition.intent.deductionId}
          : {
              kind: 'action' as const,
              action: {
                action: definition.intent.action.action,
                ...(definition.intent.action.target !== undefined ? { target: definition.intent.action.target } : {}),
                ...(definition.intent.action.actor !== undefined ? { actor: definition.intent.action.actor } : {}),
                ...(definition.intent.action.from !== undefined ? { from: definition.intent.action.from } : {}),
                ...(definition.intent.action.topic !== undefined ? { topic: definition.intent.action.topic } : {}),
                ...(definition.intent.action.evidence !== undefined ? { evidence: definition.intent.action.evidence } : {}),
                ...(definition.intent.action.tone !== undefined ? { tone: definition.intent.action.tone } : {}),
                ...(definition.intent.action.query !== undefined ? { query: definition.intent.action.query } : {}),
                ...(definition.intent.action.ref !== undefined ? { ref: definition.intent.action.ref } : {}),
              },
            },
        ...(definition.cost ? {
          cost: {
            clock: definition.cost.clock,
            milliseconds: definition.cost.milliseconds,
          },
        } : {}),
        ...presentedAffordanceLabel(definition.label, presentation),
        risk: definition.risk,
        ...presentedAffordanceConfirmation(definition.confirmation, presentation),
        ...presentedAffordanceInteraction(definition.interaction, presentation),
      }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    completedAffordances,
    activity,
    supportedDeductions: Object.values(privateCatalog.affordances)
      .filter((definition) => (
        definition.intent.kind === 'deduce' && deductionSlots[definition.intent.deductionId] === true
      ))
      .map((definition) => {
        if (definition.intent.kind !== 'deduce') {
          throw new Error('Affordance intent changed during deduction projection')
        }
        return {
          id: definition.intent.deductionId,
          ...presentedAffordanceLabel(definition.label, presentation),
        }
      })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    actors: Object.entries(privateCatalog.actors)
      .filter(([id]) => listedActorIds.has(id))
      .map(([id, definition]) => {
        const actorState = object(actorSlots[id], `actor state ${id}`)
        const stateId = typeof actorState.conversation === 'string'
          ? actorState.conversation
          : definition.initialState
        const current = definition.states[stateId]
        if (!current) throw new Error(`Unknown conversation state ${stateId} for actor ${id}`)
        return {
          id,
          ...presentedActor(definition, presentation),
          conversation: {
            state: stateId,
            canTalk: current.canTalk,
            channels: Object.entries(definition.channels)
              .filter(([action, actorField]) => !Object.values(privateCatalog.affordances).some(
                (affordance) => affordance.intent.kind === 'action' && (
                  affordance.intent.action.action === action &&
                  affordance.intent.action[actorField] === id
                ),
              ))
              .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
              .map(([action, actorField]) => ({
                action,
                actorField,
                available: current.canTalk || definition.allowWhileUnavailable.includes(action),
              })),
            ...presentedConversationReason(current.reason, presentation),
          },
        }
      })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    evidence: Object.entries(privateCatalog.evidence)
      .filter(([id]) => {
        const value = evidenceSlots[id]
        return Boolean(
          value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            (value.access === 'granted' || value.observed === true),
        )
      })
      .map(([id, definition]) => {
        const value = object(evidenceSlots[id], `evidence state ${id}`)
        const observed = value.observed === true
        const authoredPresentation = definition.presentation
        return {
          id,
          tool: definition.tool,
          observed,
          assets: definition.assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            mimeType: asset.mimeType,
          })),
          ...(authoredPresentation ? {
            ...presentedEvidenceText(
              authoredPresentation.title,
              'title',
              'titleKey',
              presentation,
            ),
            ...presentedEvidenceText(
              authoredPresentation.description,
              'description',
              'descriptionKey',
              presentation,
            ),
          } : {}),
          findings: observed && authoredPresentation
            ? Object.entries(authoredPresentation.findings)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([field, finding]) => ({
                  field,
                  ...presentedEvidenceText(finding, 'text', 'textKey', presentation),
                }))
            : [],
        }
      })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    deadlines: Object.entries(privateCatalog.deadlines)
      .flatMap(([id, definition]) => {
        const schedule = session.state.schedules[id]
        if (!schedule) return []
        return [{
          id,
          ...(definition.label
            ? presentedEvidenceText(definition.label, 'title', 'titleKey', presentation)
            : {}),
          clock: schedule.clock,
          dueAtMs: schedule.dueAtMs,
          remainingMs: Math.max(0, schedule.dueAtMs - clockNow(schedule.clock, kernel.clocks)),
          status: schedule.status,
        }]
      })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    observations: mapAssertions(kernel.assertions.observed),
    hypotheses: mapAssertions(kernel.assertions.hypotheses),
    ...(target ? { finalConclusion: { target } } : {}),
    ...(outcome ? {
      outcome: {
        ...presentedOutcome(outcome, presentation),
        ...(privateCatalog.assessment ? {
          assessment: presentedAssessment(
            privateCatalog.assessment,
            session,
            slots,
            presentation,
          ),
        } : {}),
      },
    } : {}),
  }
}
