import { deepFreeze, stableStringify } from './freeze'
import type {
  Assertion,
  AssertionContextRef,
  AssertionDraft,
  AssertionQuery,
  AssertionQueryResult,
  AssertionStores,
  CaseKernelIR,
  JsonObject,
  KernelState,
} from './types'

export function assertionsIn(
  assertions: AssertionStores,
  context: AssertionContextRef,
): readonly Assertion[] {
  return assertions.contexts[context.contextId] ?? []
}

function objectContains(candidate: JsonObject, expected: JsonObject): boolean {
  return Object.entries(expected).every(([key, value]) => stableStringify(candidate[key]) === stableStringify(value))
}

function matches(assertion: Assertion, query: AssertionQuery): boolean {
  if (assertion.relation !== query.relation) return false
  if (query.key && !objectContains(assertion.key, query.key)) return false
  if (query.value !== undefined && stableStringify(assertion.value) !== stableStringify(query.value)) {
    return false
  }
  return true
}

/** Open-world lookup: absence is unknown, never an implicit refutation. */
export function queryAssertions(state: KernelState, query: AssertionQuery): AssertionQueryResult {
  const found = assertionsIn(state.assertions, query).filter((assertion) => matches(assertion, query))
  const supporting = found.filter(({ polarity }) => polarity === 'affirm')
  const refuting = found.filter(({ polarity }) => polarity === 'deny')
  const status =
    supporting.length > 0 && refuting.length > 0
      ? 'conflicted'
      : supporting.length > 0
        ? 'affirmed'
        : refuting.length > 0
          ? 'denied'
          : 'unknown'
  return deepFreeze({ status, supporting: [...supporting], refuting: [...refuting] })
}

export function findAssertion(state: KernelState, id: string): Assertion | undefined {
  for (const assertions of Object.values(state.assertions.contexts)) {
    const found = assertions.find((assertion) => assertion.id === id)
    if (found) return found
  }
  return undefined
}

export function validateAssertionRelation(caseIR: CaseKernelIR, assertion: AssertionDraft): void {
  if (!(caseIR.relations ?? []).some(({ id }) => id === assertion.relation)) {
    throw new Error(`Assertion ${assertion.id} uses unknown relation ${assertion.relation}`)
  }
}

/**
 * A one_per_context relation permits multiple attestations of one value (and
 * contrary denials), but never two distinct affirmed values for the same key
 * inside one context.
 */
export function validateAssertionCardinality(
  caseIR: CaseKernelIR,
  stores: { readonly contexts: Readonly<Record<string, readonly AssertionDraft[]>> },
  contextId: string,
  assertion: AssertionDraft,
): void {
  validateAssertionRelation(caseIR, assertion)
  const relation = (caseIR.relations ?? []).find(({ id }) => id === assertion.relation)
  if (relation?.cardinality !== 'one_per_context' || assertion.polarity !== 'affirm') return
  const conflicting = (stores.contexts[contextId] ?? []).find(
    (existing) =>
      existing.id !== assertion.id &&
      existing.relation === assertion.relation &&
      existing.polarity === 'affirm' &&
      stableStringify(existing.key) === stableStringify(assertion.key) &&
      stableStringify(existing.value) !== stableStringify(assertion.value),
  )
  if (conflicting) {
    throw new Error(
      `Relation ${assertion.relation} is one_per_context and already affirms a different value in ${contextId}`,
    )
  }
}
