import { describe, expect, it } from 'vitest'

import type { CompiledCaseIR } from '../compiler'

import {
  auditContactDiscoveryCoverage,
  type ContactDiscoveryCoverageAudit,
} from './contact-discovery-audit'
import type { DetectiveCaseTestResult } from './detective-runner'
import { formatConformanceResult, type DetectiveCaseConformanceResult } from './runner'
import type { DetectiveCaseTestScenario, DetectiveCaseTestStep } from './types'

const SOURCE_FILE = '/fixtures/directory_coverage_fixture.yml'
const SCENARIO_ID = 'directory_coverage_fixture'
const ACTOR_ID = 'directory_person'
const AFFORDANCE_ID = 'find_directory_person'

type LookupContext =
  | { readonly kind: 'opening-call' }
  | { readonly kind: 'evidence'; readonly ref: string }
  | { readonly kind: 'completed-affordance'; readonly ref: string }

function fixtureIr(context?: LookupContext): CompiledCaseIR {
  return {
    affordances: [{
      id: AFFORDANCE_ID,
      label: 'Find contact',
      result: 'Contact found',
      risk: 'normal',
      surface: 'inbox',
      initial: 'offered',
      intent: {
        kind: 'action',
        action: { kind: 'action', verb: 'locate-contact', target: ACTOR_ID },
      },
      exclusive: true,
      interaction: {
        kind: 'async-message',
        channel: 'directory',
        request: 'Find this person.',
        ...(context ? { context } : {}),
      },
      once: true,
    }, {
      id: 'inspect_context_record',
      label: 'Inspect context record',
      risk: 'normal',
      surface: 'files',
      initial: 'offered',
      intent: {
        kind: 'action',
        action: { kind: 'action', verb: 'inspect', target: 'context_record' },
      },
      exclusive: true,
      once: true,
    }],
    private: {
      conversations: [
        {
          actorId: ACTOR_ID,
          public: true,
          contactInitial: 'hidden',
          presentation: {},
          initialStateId: 'available',
          states: [{ id: 'available', canTalk: true }],
          channels: {},
          allowWhileUnavailable: [],
        },
        {
          actorId: 'already_listed_person',
          public: true,
          contactInitial: 'listed',
          presentation: {},
          initialStateId: 'available',
          states: [{ id: 'available', canTalk: true }],
          channels: {},
          allowWhileUnavailable: [],
        },
        {
          actorId: 'non_public_person',
          public: false,
          contactInitial: 'hidden',
          presentation: {},
          initialStateId: 'unavailable',
          states: [{ id: 'unavailable', canTalk: false }],
          channels: {},
          allowWhileUnavailable: [],
        },
      ],
    },
  } as unknown as CompiledCaseIR
}

function proofSteps(): DetectiveCaseTestStep[] {
  return [
    {
      operation: 'expect',
      expect: {
        state: {
          contacts: { [ACTOR_ID]: 'hidden' },
          affordances: { [AFFORDANCE_ID]: 'offered' },
        },
      },
    },
    {
      operation: 'act',
      action: { action: 'locate-contact', target: ACTOR_ID },
      expect: {
        result: { status: 'accepted' },
        state: { contacts: { [ACTOR_ID]: 'listed' } },
      },
    },
  ]
}

function scenario(steps = proofSteps()): DetectiveCaseTestScenario {
  return {
    schema: 'case-test/v0.1',
    sourceFile: SOURCE_FILE,
    case: { id: 'engine.directory-fixture', version: '0.1.0' },
    id: SCENARIO_ID,
    perspective: 'detective',
    steps,
  }
}

function result(ok = true): DetectiveCaseTestResult {
  return {
    id: SCENARIO_ID,
    sourceFile: SOURCE_FILE,
    ok,
    failures: ok ? [] : [{ expectation: 'steps[1]', message: 'fixture failure' }],
    trace: [
      {
        step: 1,
        operation: 'expect',
        detail: { checkpoint: true },
        result: 'checkpoint',
        revisionBefore: 0,
        revisionAfter: 0,
      },
      {
        step: 2,
        operation: 'act',
        detail: { action: 'locate-contact', target: ACTOR_ID },
        result: 'accepted',
        revisionBefore: 0,
        revisionAfter: 1,
      },
    ],
    commandCount: 1,
    revision: 1,
  }
}

describe('contact-discovery conformance coverage', () => {
  it('covers each public initially hidden contact with one explicit passing route', () => {
    const audit = auditContactDiscoveryCoverage(fixtureIr(), [scenario()], [result()])

    expect(audit).toEqual({
      ok: true,
      required: 1,
      covered: 1,
      items: [{
        actorId: ACTOR_ID,
        ok: true,
        candidateAffordanceIds: [AFFORDANCE_ID],
        scenarioId: SCENARIO_ID,
        sourceFile: SOURCE_FILE,
        affordanceId: AFFORDANCE_ID,
      }],
    })
  })

  it('does not count a failed scenario or an implicit acceptance as proof', () => {
    const implicitSteps = proofSteps()
    implicitSteps[1] = {
      operation: 'act',
      action: { action: 'locate-contact', target: ACTOR_ID },
      expect: { state: { contacts: { [ACTOR_ID]: 'listed' } } },
    }

    expect(auditContactDiscoveryCoverage(fixtureIr(), [scenario()], [result(false)]).ok)
      .toBe(false)
    expect(auditContactDiscoveryCoverage(fixtureIr(), [scenario(implicitSteps)], [result()]).ok)
      .toBe(false)
  })

  it('requires the hidden and offered checkpoint to remain stable until lookup', () => {
    const steps = proofSteps()
    steps.splice(1, 0, {
      operation: 'act',
      action: { action: 'locate-contact', target: 'different_person' },
      expect: { result: { status: 'accepted' } },
    })
    const acceptedTrace = result().trace[1]!
    const shiftedResult: DetectiveCaseTestResult = {
      ...result(),
      trace: [result().trace[0]!, acceptedTrace, acceptedTrace],
      commandCount: 2,
    }

    expect(auditContactDiscoveryCoverage(fixtureIr(), [scenario(steps)], [shiftedResult]).ok)
      .toBe(false)
  })

  it('requires an evidence-anchored lookup to prove that evidence note is visible', () => {
    const ir = fixtureIr({ kind: 'evidence', ref: 'context_record' })
    expect(auditContactDiscoveryCoverage(ir, [scenario()], [result()]).ok).toBe(false)

    const anchoredSteps = proofSteps()
    anchoredSteps[0] = {
      operation: 'expect',
      expect: {
        state: {
          contacts: { [ACTOR_ID]: 'hidden' },
          affordances: { [AFFORDANCE_ID]: 'offered' },
          evidence: { context_record: { status: 'available' } },
        },
      },
    }
    expect(auditContactDiscoveryCoverage(ir, [scenario(anchoredSteps)], [result()]).ok)
      .toBe(true)
  })

  it('requires a completed-affordance anchor to be explicitly accepted first', () => {
    const ir = fixtureIr({ kind: 'completed-affordance', ref: 'inspect_context_record' })
    expect(auditContactDiscoveryCoverage(ir, [scenario()], [result()]).ok).toBe(false)

    const anchoredSteps: DetectiveCaseTestStep[] = [
      {
        operation: 'act',
        action: { action: 'inspect', target: 'context_record' },
        expect: { result: { status: 'accepted' } },
      },
      ...proofSteps(),
    ]
    const anchoredResult: DetectiveCaseTestResult = {
      ...result(),
      trace: [
        {
          step: 1,
          operation: 'act',
          detail: { action: 'inspect', target: 'context_record' },
          result: 'accepted',
          revisionBefore: 0,
          revisionAfter: 1,
        },
        ...result().trace.map((entry, index) => ({
          ...entry,
          step: index + 2,
          revisionBefore: entry.revisionBefore + 1,
          revisionAfter: entry.revisionAfter + 1,
        })),
      ],
      commandCount: 2,
      revision: 2,
    }
    expect(auditContactDiscoveryCoverage(ir, [scenario(anchoredSteps)], [anchoredResult]).ok)
      .toBe(true)
  })

  it('prints a distinct suite-level PASS or FAIL with per-actor detail', () => {
    const passingAudit = auditContactDiscoveryCoverage(fixtureIr(), [scenario()], [result()])
    const passing: DetectiveCaseConformanceResult = {
      sourceFile: '/fixtures/case.yml',
      testsRoot: '/fixtures/tests',
      testSuiteDigest: 'digest',
      caseId: 'engine.directory-fixture',
      caseVersion: '0.1.0',
      ok: true,
      tests: [result()],
      contactDiscovery: passingAudit,
    }
    expect(formatConformanceResult(passing)).toContain(
      'PASS contact-discovery coverage (1/1 hidden public contacts)',
    )
    expect(formatConformanceResult(passing)).toContain(
      `PASS actor '${ACTOR_ID}' via scenario '${SCENARIO_ID}' and affordance '${AFFORDANCE_ID}'`,
    )

    const failingAudit: ContactDiscoveryCoverageAudit = {
      ok: false,
      required: 1,
      covered: 0,
      items: [{
        actorId: ACTOR_ID,
        ok: false,
        candidateAffordanceIds: [AFFORDANCE_ID],
        message: 'missing explicit route',
      }],
    }
    expect(formatConformanceResult({
      ...passing,
      ok: false,
      contactDiscovery: failingAudit,
    })).toContain(`FAIL actor '${ACTOR_ID}': missing explicit route`)
  })
})
