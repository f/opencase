import type { JsonValue } from '../compiler'
import type { CaseAction } from '../case-runtime'

export type SimulatorClock = 'wall' | 'active' | 'case-time'

export interface TestFailure {
  readonly expectation: string
  readonly message: string
  readonly actual?: JsonValue
}

export interface MutableSimulatorClock {
  now(): number
  advance(byMs: number): void
}

export type CaseTestEvidenceStatus = 'hidden' | 'available' | 'observed'
export type CaseTestAffordanceStatus = 'offered' | 'hidden'
export type CaseTestDeductionStatus = 'supported' | 'unknown'

export type CaseTestResultExpectation =
  | { readonly status: 'accepted' }
  | { readonly status: 'denied'; readonly code: string }

export interface CaseTestEvidenceExpectation {
  readonly status: CaseTestEvidenceStatus
  readonly assets?: readonly string[]
}

export interface CaseTestStateExpectation {
  readonly status?: 'active' | 'ended'
  /** Elapsed milliseconds from the scenario's initial public clock values. */
  readonly clocks?: Readonly<Partial<Record<SimulatorClock, number>>>
  readonly affordances?: Readonly<Record<string, CaseTestAffordanceStatus>>
  readonly evidence?: Readonly<Record<string, CaseTestEvidenceExpectation>>
  readonly observations?: Readonly<Record<string, JsonValue>>
  readonly unknownObservations?: readonly string[]
  readonly deductions?: Readonly<Record<string, CaseTestDeductionStatus>>
  readonly finalConclusion?: string | null
  readonly outcome?: string | null
  readonly assessment?: {
    readonly score?: number
    readonly maxScore?: number
    readonly bandLabel?: string
  } | null
}

export interface CaseTestExpectation {
  readonly result?: CaseTestResultExpectation
  readonly state?: CaseTestStateExpectation
}

interface CaseTestOperationStep {
  readonly expect?: CaseTestExpectation
}

export type DetectiveCaseTestStep =
  | (CaseTestOperationStep & {
      readonly operation: 'observe'
      readonly evidenceId: string
    })
  | (CaseTestOperationStep & {
      readonly operation: 'act'
      readonly action: CaseAction
    })
  | (CaseTestOperationStep & {
      readonly operation: 'deduce'
      readonly deductionId: string
    })
  | (CaseTestOperationStep & {
      readonly operation: 'conclude'
      readonly target: string
    })
  | (CaseTestOperationStep & {
      readonly operation: 'advance'
      readonly clock: SimulatorClock
      readonly byMs: number
    })
  | (CaseTestOperationStep & {
      readonly operation: 'resume'
      readonly afterMs: number
    })
  | {
      readonly operation: 'expect'
      readonly expect: CaseTestExpectation & { readonly state: CaseTestStateExpectation }
    }

/** A fully parsed, schema-checked scenario ready for deterministic execution. */
export interface DetectiveCaseTestScenario {
  readonly schema: 'case-test/v0.1'
  readonly sourceFile: string
  readonly case: {
    readonly id: string
    readonly version: string
  }
  readonly id: string
  readonly perspective: 'detective'
  readonly description?: string
  readonly steps: readonly DetectiveCaseTestStep[]
}

export interface DetectiveCaseTestSuite {
  readonly packageRoot: string
  readonly testsRoot: string
  /** Private build-time digest; never part of the playable case build lock. */
  readonly digest: string
  readonly scenarios: readonly DetectiveCaseTestScenario[]
}
