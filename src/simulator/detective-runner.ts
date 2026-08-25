import {
  advanceActiveTime,
  advanceCaseTime,
  attemptDeduction,
  compileToKernelIR,
  createCaseRuntime,
  observeEvidence,
  observeWallTime,
  performAction,
  projectCaseState,
  replayCase,
  resumeCase,
  startCase,
  type PublicCaseRuntimeState,
} from '../case-runtime'
import { canonicalize, type CompiledCaseIR, type JsonValue } from '../compiler'
import type { DispatchResult, JsonObject, KernelSession } from '../kernel'

import { DeterministicWallClock, deterministicDependencies } from './determinism'
import type {
  CaseTestExpectation,
  CaseTestStateExpectation,
  DetectiveCaseTestScenario,
  DetectiveCaseTestStep,
  SimulatorClock,
  TestFailure,
} from './types'

const FIXED_WALL_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0)

export interface DetectiveCaseTestTraceEntry {
  readonly step: number
  readonly operation: DetectiveCaseTestStep['operation']
  readonly detail: JsonValue
  readonly result: 'accepted' | 'denied' | 'checkpoint'
  readonly errorCode?: string
  readonly revisionBefore: number
  readonly revisionAfter: number
}

export interface DetectiveCaseTestResult {
  readonly id: string
  readonly sourceFile: string
  readonly ok: boolean
  readonly failures: readonly TestFailure[]
  readonly trace: readonly DetectiveCaseTestTraceEntry[]
  readonly commandCount: number
  readonly revision: number
  readonly outcome?: string
}

interface DetectiveHarness {
  readonly runtime: ReturnType<typeof createCaseRuntime>
  readonly wallClock: DeterministicWallClock
  readonly initialClocks: PublicCaseRuntimeState['clocks']
  session: KernelSession
  project(): PublicCaseRuntimeState
}

function stable(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function failure(expectation: string, message: string, actual?: JsonValue): TestFailure {
  return {
    expectation,
    message,
    ...(actual !== undefined ? { actual } : {}),
  }
}

function createHarness(ir: CompiledCaseIR, scenarioId: string): DetectiveHarness {
  const wallClock = new DeterministicWallClock(FIXED_WALL_EPOCH_MS)
  const runtime = createCaseRuntime(
    compileToKernelIR(ir),
    deterministicDependencies(wallClock, `${ir.case.id}:${ir.case.version}:${scenarioId}`),
  )
  let harness!: DetectiveHarness
  const session = startCase(runtime)
  harness = {
    runtime,
    wallClock,
    session,
    initialClocks: projectCaseState(session).clocks,
    project: () => projectCaseState(harness.session),
  }
  return harness
}

function commandId(scenario: DetectiveCaseTestScenario, stepIndex: number): string {
  return `${scenario.case.id}:${scenario.case.version}:${scenario.id}:step:${String(stepIndex + 1).padStart(4, '0')}`
}

function operationDetail(step: DetectiveCaseTestStep): JsonValue {
  if (step.operation === 'observe') return { evidence: step.evidenceId }
  if (step.operation === 'act') return { ...step.action }
  if (step.operation === 'deduce') return { deduction: step.deductionId }
  if (step.operation === 'conclude') return { target: step.target }
  if (step.operation === 'advance') return { clock: step.clock, byMs: step.byMs }
  if (step.operation === 'resume') return { afterMs: step.afterMs }
  return { checkpoint: true }
}

function dispatchStep(
  harness: DetectiveHarness,
  scenario: DetectiveCaseTestScenario,
  step: Exclude<DetectiveCaseTestStep, { readonly operation: 'expect' }>,
  stepIndex: number,
): DispatchResult {
  const id = commandId(scenario, stepIndex)
  if (step.operation === 'observe') {
    return observeEvidence(harness.runtime, harness.session, step.evidenceId, id)
  }
  if (step.operation === 'act') {
    return performAction(harness.runtime, harness.session, step.action, id)
  }
  if (step.operation === 'deduce') {
    return attemptDeduction(harness.runtime, harness.session, step.deductionId, id)
  }
  if (step.operation === 'conclude') {
    return performAction(
      harness.runtime,
      harness.session,
      { action: 'submit-conclusion', target: step.target },
      id,
    )
  }
  if (step.operation === 'advance') {
    if (step.clock === 'wall') {
      harness.wallClock.advance(step.byMs)
      return observeWallTime(harness.runtime, harness.session, id)
    }
    return step.clock === 'active'
      ? advanceActiveTime(harness.runtime, harness.session, step.byMs, id)
      : advanceCaseTime(harness.runtime, harness.session, step.byMs, id)
  }
  harness.wallClock.advance(step.afterMs)
  return resumeCase(harness.runtime, harness.session, id)
}

function assertionReference(assertion: JsonObject, key: 'observationId' | 'deductionId'): string | undefined {
  const value = assertion.key
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return typeof value[key] === 'string' ? value[key] : undefined
}

function elapsedClock(
  projection: PublicCaseRuntimeState,
  initial: PublicCaseRuntimeState['clocks'],
  clock: SimulatorClock,
): number {
  if (clock === 'wall') return projection.clocks.wallTimeMs - initial.wallTimeMs
  if (clock === 'active') return projection.clocks.activeTimeMs - initial.activeTimeMs
  return projection.clocks.caseTimeMs - initial.caseTimeMs
}

function assertState(
  projection: PublicCaseRuntimeState,
  initialClocks: PublicCaseRuntimeState['clocks'],
  expected: CaseTestStateExpectation,
  path: string,
): TestFailure[] {
  const failures: TestFailure[] = []
  if (expected.status !== undefined && projection.status !== expected.status) {
    failures.push(failure(`${path}.status`, `expected status '${expected.status}'`, projection.status))
  }

  for (const [clock, milliseconds] of Object.entries(expected.clocks ?? {}) as [
    SimulatorClock,
    number,
  ][]) {
    const actual = elapsedClock(projection, initialClocks, clock)
    if (actual !== milliseconds) {
      failures.push(
        failure(`${path}.clocks.${clock}`, `expected elapsed ${milliseconds}ms`, actual),
      )
    }
  }

  for (const [id, wanted] of Object.entries(expected.affordances ?? {})) {
    const actual = projection.affordances.some((affordance) => affordance.id === id)
      ? 'offered'
      : 'hidden'
    if (actual !== wanted) {
      failures.push(
        failure(
          `${path}.affordances.${id}`,
          `expected affordance '${id}' to be ${wanted}`,
          actual,
        ),
      )
    }
  }

  for (const [id, evidenceExpectation] of Object.entries(expected.evidence ?? {})) {
    const card = projection.evidence.find((candidate) => candidate.id === id)
    const actualStatus = !card ? 'hidden' : card.observed ? 'observed' : 'available'
    if (actualStatus !== evidenceExpectation.status) {
      failures.push(
        failure(
          `${path}.evidence.${id}.status`,
          `expected evidence '${id}' to be ${evidenceExpectation.status}`,
          actualStatus,
        ),
      )
    }
    if (evidenceExpectation.assets !== undefined) {
      const actualAssets = [...(card?.assets.map(({ id: assetId }) => assetId) ?? [])].sort()
      const wantedAssets = [...evidenceExpectation.assets].sort()
      if (stable(actualAssets) !== stable(wantedAssets)) {
        failures.push(
          failure(
            `${path}.evidence.${id}.assets`,
            `expected opaque asset ids ${stable(wantedAssets)}`,
            actualAssets,
          ),
        )
      }
    }
  }

  for (const [id, value] of Object.entries(expected.observations ?? {})) {
    const assertion = projection.observations.find(
      (candidate) => assertionReference(candidate, 'observationId') === id,
    )
    if (!assertion || stable(assertion.value) !== stable(value)) {
      failures.push(
        failure(
          `${path}.observations.${id}`,
          `expected observed value ${stable(value)}`,
          assertion?.value,
        ),
      )
    }
  }

  for (const id of expected.unknownObservations ?? []) {
    const assertion = projection.observations.find(
      (candidate) => assertionReference(candidate, 'observationId') === id,
    )
    if (assertion) {
      failures.push(
        failure(
          `${path}.unknown_observations.${id}`,
          `expected observation '${id}' to remain unknown`,
          assertion.value,
        ),
      )
    }
  }

  for (const [id, wanted] of Object.entries(expected.deductions ?? {})) {
    const supported = projection.hypotheses.some(
      (candidate) => assertionReference(candidate, 'deductionId') === id,
    )
    const actual = supported ? 'supported' : 'unknown'
    if (actual !== wanted) {
      failures.push(
        failure(`${path}.deductions.${id}`, `expected deduction '${id}' to be ${wanted}`, actual),
      )
    }
  }

  if (expected.finalConclusion !== undefined) {
    const actual = projection.finalConclusion?.target ?? null
    if (actual !== expected.finalConclusion) {
      failures.push(
        failure(
          `${path}.final_conclusion`,
          `expected final conclusion ${stable(expected.finalConclusion)}`,
          actual,
        ),
      )
    }
  }
  if (expected.outcome !== undefined) {
    const actual = projection.outcome?.id ?? null
    if (actual !== expected.outcome) {
      failures.push(
        failure(`${path}.outcome`, `expected outcome ${stable(expected.outcome)}`, actual),
      )
    }
  }
  if (expected.assessment !== undefined) {
    const actual = projection.outcome?.assessment ?? null
    if (expected.assessment === null) {
      if (actual !== null) {
        failures.push(
          failure(
            `${path}.assessment`,
            'expected no resolved assessment',
            canonicalize<unknown>(actual) as JsonValue,
          ),
        )
      }
    } else if (!actual) {
      failures.push(failure(`${path}.assessment`, 'expected a resolved assessment', null))
    } else {
      if (expected.assessment.score !== undefined && actual.score !== expected.assessment.score) {
        failures.push(failure(
          `${path}.assessment.score`,
          `expected assessment score ${expected.assessment.score}`,
          actual.score,
        ))
      }
      if (expected.assessment.maxScore !== undefined && actual.maxScore !== expected.assessment.maxScore) {
        failures.push(failure(
          `${path}.assessment.max_score`,
          `expected assessment maximum ${expected.assessment.maxScore}`,
          actual.maxScore,
        ))
      }
      if (expected.assessment.bandLabel !== undefined && actual.bandLabel !== expected.assessment.bandLabel) {
        failures.push(failure(
          `${path}.assessment.band_label`,
          `expected assessment band ${stable(expected.assessment.bandLabel)}`,
          actual.bandLabel ?? null,
        ))
      }
    }
  }
  return failures
}

function assertExpectation(
  harness: DetectiveHarness,
  expectation: CaseTestExpectation,
  path: string,
): TestFailure[] {
  return expectation.state
    ? assertState(harness.project(), harness.initialClocks, expectation.state, `${path}.state`)
    : []
}

function replayMatches(harness: DetectiveHarness): boolean {
  const replayed = replayCase(harness.runtime, harness.session.eventLog)
  return stable(replayed.state) === stable(harness.session.state)
}

export function runDetectiveCaseTest(
  ir: CompiledCaseIR,
  scenario: DetectiveCaseTestScenario,
): DetectiveCaseTestResult {
  const harness = createHarness(ir, scenario.id)
  const failures: TestFailure[] = []
  const trace: DetectiveCaseTestTraceEntry[] = []
  let commandCount = 0

  for (const [stepIndex, step] of scenario.steps.entries()) {
    const path = `steps[${stepIndex}]`
    const beforeRevision = harness.project().revision
    if (step.operation === 'expect') {
      failures.push(...assertExpectation(harness, step.expect, path))
      trace.push({
        step: stepIndex + 1,
        operation: 'expect',
        detail: operationDetail(step),
        result: 'checkpoint',
        revisionBefore: beforeRevision,
        revisionAfter: beforeRevision,
      })
      continue
    }

    commandCount += 1
    const beforeSession = stable(harness.session)
    const result = dispatchStep(harness, scenario, step, stepIndex)
    const expectedResult = step.expect?.result ?? { status: 'accepted' as const }
    if (!result.ok && stable(result.session) !== beforeSession) {
      failures.push(
        failure(`${path}.atomicity`, 'a denied detective command changed the authoritative session'),
      )
    }
    harness.session = result.session

    if (expectedResult.status === 'accepted') {
      if (!result.ok) {
        failures.push(
          failure(
            `${path}.expect.result`,
            `expected command acceptance, received '${result.error.code}'`,
            result.error.code,
          ),
        )
      }
    } else if (result.ok) {
      failures.push(
        failure(
          `${path}.expect.result`,
          `expected command denial '${expectedResult.code}', but it was accepted`,
          'accepted',
        ),
      )
    } else if (result.error.code !== expectedResult.code) {
      failures.push(
        failure(
          `${path}.expect.result`,
          `expected denial '${expectedResult.code}', received '${result.error.code}'`,
          result.error.code,
        ),
      )
    }

    if (step.expect) failures.push(...assertExpectation(harness, step.expect, `${path}.expect`))
    if (!replayMatches(harness)) {
      failures.push(
        failure(`${path}.replay`, 'event-only replay produced a different authoritative state'),
      )
    }

    const afterRevision = harness.project().revision
    trace.push({
      step: stepIndex + 1,
      operation: step.operation,
      detail: operationDetail(step),
      result: result.ok ? 'accepted' : 'denied',
      ...(!result.ok ? { errorCode: result.error.code } : {}),
      revisionBefore: beforeRevision,
      revisionAfter: afterRevision,
    })
  }

  if (!replayMatches(harness)) {
    failures.push(failure('replay', 'final event-only replay produced a different authoritative state'))
  }
  const projection = harness.project()
  return {
    id: scenario.id,
    sourceFile: scenario.sourceFile,
    ok: failures.length === 0,
    failures,
    trace,
    commandCount,
    revision: projection.revision,
    ...(projection.outcome ? { outcome: projection.outcome.id } : {}),
  }
}
