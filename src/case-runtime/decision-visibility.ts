import type { JsonObject, JsonValue } from '../kernel'

import type { CaseAction, CaseRuntimeCatalog } from './protocol'

const ACTOR_DECISION_ACTIONS = new Set(['report-suspect', 'submit-conclusion'])

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

/**
 * Capability-level decisions that identify a person in the detective's
 * official file. These are engine vocabulary, never case or character ids.
 */
export function isActorDecisionAction(
  action: Pick<CaseAction, 'action'>,
): boolean {
  return ACTOR_DECISION_ACTIONS.has(action.action)
}

/**
 * A decision about an authored actor can be public only after that actor has
 * entered the public contact projection. Abstract/object conclusion targets
 * are unaffected.
 */
export function isActorDecisionTargetListed(
  catalog: CaseRuntimeCatalog,
  actorSlots: JsonObject,
  action: CaseAction,
): boolean {
  if (!isActorDecisionAction(action)) return true
  const actorId = action.target
  if (!actorId || action.actor !== undefined || action.from !== undefined) return false
  if (!Object.hasOwn(catalog.actors, actorId)) return true

  const definition = catalog.actors[actorId]!
  if (!definition.public) return false
  const actorState = object(actorSlots[actorId], `actor state ${actorId}`)
  const contact = actorState.contact ?? definition.contactInitial
  if (contact !== 'hidden' && contact !== 'listed') {
    throw new Error(`Unknown contact state ${String(contact)} for actor ${actorId}`)
  }
  return contact === 'listed'
}
