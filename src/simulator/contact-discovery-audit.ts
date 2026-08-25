import type { CaseAction } from '../case-runtime'
import type { CompiledAction, CompiledAffordance, CompiledCaseIR } from '../compiler'

import type { DetectiveCaseTestResult } from './detective-runner'
import type { DetectiveCaseTestScenario, DetectiveCaseTestStep } from './types'

const ACTION_ARGUMENT_FIELDS = [
  'target',
  'actor',
  'from',
  'topic',
  'evidence',
  'tone',
  'query',
  'ref',
] as const

interface ContactLookupAffordance {
  readonly id: string
  readonly action: CompiledAction
  readonly interaction: NonNullable<CompiledAffordance['interaction']>
}

export interface ContactDiscoveryCoverageItem {
  readonly actorId: string
  readonly ok: boolean
  readonly candidateAffordanceIds: readonly string[]
  readonly scenarioId?: string
  readonly sourceFile?: string
  readonly affordanceId?: string
  readonly message?: string
}

export interface ContactDiscoveryCoverageAudit {
  readonly ok: boolean
  readonly required: number
  readonly covered: number
  readonly items: readonly ContactDiscoveryCoverageItem[]
}

function exactActionMatches(expected: CompiledAction, actual: CaseAction): boolean {
  return (
    actual.action === expected.verb &&
    ACTION_ARGUMENT_FIELDS.every((field) => actual[field] === expected[field])
  )
}

function lookupAffordances(
  ir: CompiledCaseIR,
  actorId: string,
): ContactLookupAffordance[] {
  const result: ContactLookupAffordance[] = []
  for (const affordance of ir.affordances) {
    if (
      affordance.surface !== 'inbox' ||
      affordance.interaction?.kind !== 'async-message' ||
      affordance.intent.kind !== 'action' ||
      affordance.intent.action.verb !== 'locate-contact' ||
      affordance.intent.action.target !== actorId
    ) {
      continue
    }
    result.push({
      id: affordance.id,
      action: affordance.intent.action,
      interaction: affordance.interaction,
    })
  }
  return result.sort((left, right) => left.id.localeCompare(right.id))
}

function explicitlyPreservesState(step: DetectiveCaseTestStep): boolean {
  if (step.operation === 'expect') return true
  return step.expect?.result?.status === 'denied'
}

function hasStablePrecondition(
  scenario: DetectiveCaseTestScenario,
  actionIndex: number,
  actorId: string,
  affordanceId: string,
): number | undefined {
  for (let index = actionIndex - 1; index >= 0; index -= 1) {
    const step = scenario.steps[index]!
    const state = step.expect?.state
    if (
      state?.contacts?.[actorId] === 'hidden' &&
      state.affordances?.[affordanceId] === 'offered'
    ) {
      return scenario.steps
        .slice(index + 1, actionIndex)
        .every(explicitlyPreservesState)
        ? index
        : undefined
    }
    if (!explicitlyPreservesState(step)) return undefined
  }
  return undefined
}

function completedAffordanceIsProven(
  ir: CompiledCaseIR,
  scenario: DetectiveCaseTestScenario,
  result: DetectiveCaseTestResult,
  checkpointIndex: number,
  affordanceId: string,
): boolean {
  const referenced = ir.affordances.find((affordance) => affordance.id === affordanceId)
  if (!referenced) return false

  return scenario.steps.slice(0, checkpointIndex).some((step, index) => {
    if (
      step.expect?.result?.status !== 'accepted' ||
      result.trace[index]?.result !== 'accepted'
    ) {
      return false
    }
    if (referenced.intent.kind === 'deduce') {
      return step.operation === 'deduce' && step.deductionId === referenced.intent.deductionId
    }
    return step.operation === 'act' && exactActionMatches(referenced.intent.action, step.action)
  })
}

function contextIsProvenAvailable(
  ir: CompiledCaseIR,
  scenario: DetectiveCaseTestScenario,
  result: DetectiveCaseTestResult,
  checkpointIndex: number,
  candidate: ContactLookupAffordance,
): boolean {
  const context = candidate.interaction.context
  if (!context || context.kind === 'opening-call') return true
  if (context.kind === 'evidence') {
    const status = scenario.steps[checkpointIndex]?.expect?.state?.evidence?.[context.ref]?.status
    return status === 'available' || status === 'observed'
  }
  return completedAffordanceIsProven(
    ir,
    scenario,
    result,
    checkpointIndex,
    context.ref,
  )
}

function hasImmediateListedPostcondition(
  scenario: DetectiveCaseTestScenario,
  actionIndex: number,
  actorId: string,
): boolean {
  for (let index = actionIndex; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index]!
    if (step.expect?.state?.contacts?.[actorId] === 'listed') return true
    if (index > actionIndex && step.operation !== 'expect') return false
  }
  return false
}

function resultKey(sourceFile: string, scenarioId: string): string {
  return `${sourceFile}\0${scenarioId}`
}

function findCoverage(
  ir: CompiledCaseIR,
  actorId: string,
  candidates: readonly ContactLookupAffordance[],
  scenarios: readonly DetectiveCaseTestScenario[],
  resultsByScenario: ReadonlyMap<string, DetectiveCaseTestResult>,
): Omit<ContactDiscoveryCoverageItem, 'actorId' | 'candidateAffordanceIds'> | undefined {
  for (const scenario of scenarios) {
    const result = resultsByScenario.get(resultKey(scenario.sourceFile, scenario.id))
    if (!result?.ok) continue

    for (const [actionIndex, step] of scenario.steps.entries()) {
      if (
        step.operation !== 'act' ||
        step.expect?.result?.status !== 'accepted' ||
        result.trace[actionIndex]?.result !== 'accepted'
      ) {
        continue
      }

      for (const candidate of candidates) {
        if (!exactActionMatches(candidate.action, step.action)) continue
        const checkpointIndex = hasStablePrecondition(
          scenario,
          actionIndex,
          actorId,
          candidate.id,
        )
        if (checkpointIndex === undefined) continue
        if (!contextIsProvenAvailable(ir, scenario, result, checkpointIndex, candidate)) continue
        if (!hasImmediateListedPostcondition(scenario, actionIndex, actorId)) continue
        return {
          ok: true,
          scenarioId: scenario.id,
          sourceFile: scenario.sourceFile,
          affordanceId: candidate.id,
        }
      }
    }
  }
  return undefined
}

/**
 * Requires public, initially hidden contacts to have one passing detective
 * scenario that explicitly demonstrates the complete projected lookup route.
 * This is a suite-coverage audit; it neither plans commands nor reads runtime
 * slots, truth, flags, or case-specific identifiers.
 */
export function auditContactDiscoveryCoverage(
  ir: CompiledCaseIR,
  scenarios: readonly DetectiveCaseTestScenario[],
  results: readonly DetectiveCaseTestResult[],
): ContactDiscoveryCoverageAudit {
  const resultsByScenario = new Map(
    results.map((result) => [resultKey(result.sourceFile, result.id), result]),
  )
  const items = ir.private.conversations
    .filter((conversation) => conversation.public && conversation.contactInitial === 'hidden')
    .map((conversation): ContactDiscoveryCoverageItem => {
      const candidates = lookupAffordances(ir, conversation.actorId)
      const candidateAffordanceIds = candidates.map(({ id }) => id)
      const coverage = findCoverage(
        ir,
        conversation.actorId,
        candidates,
        scenarios,
        resultsByScenario,
      )
      if (coverage) {
        return {
          actorId: conversation.actorId,
          candidateAffordanceIds,
          ...coverage,
        }
      }
      return {
        actorId: conversation.actorId,
        candidateAffordanceIds,
        ok: false,
        message: candidates.length === 0
          ? 'no matching inbox async-message locate-contact affordance exists'
          : 'no passing scenario explicitly proves a visible context note with hidden and offered before the accepted exact lookup action, then listed immediately after it',
      }
    })
    .sort((left, right) => left.actorId.localeCompare(right.actorId))
  const covered = items.filter(({ ok }) => ok).length
  return {
    ok: covered === items.length,
    required: items.length,
    covered,
    items,
  }
}
