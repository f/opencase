import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compileCaseSourceOrThrow } from '../compiler'

import { parseCaseTestDocument } from './case-test-documents'
import { runDetectiveCaseTest } from './detective-runner'

const ENGINE_FIXTURE = `schema: case-source/v0.1
case:
  id: demo.engine-fixture
  version: 0.1.0
  title: Engine Fixture
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "10:00"}
  synopsis: A generic fixture used only by engine tests.
use: [investigation@1, artifacts@1, generic-actions@1]
assets:
  private_provider_file:
    kind: file
    source: {provider: signed-media, ref: provider-private-fixture-ref}
    mime_type: application/octet-stream
    visibility: private
    integrity: {sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
cast:
  observer: {name: Observer, role: witness, client: true}
  subject: {name: Subject, role: subject}
affordances:
  inspect_index:
    label: Inspect the index
    surface: web
    initial: offered
    action: {action: search, query: synthetic-index}
    cost: {clock: case-time, by: 10s}
  preserve_followup:
    label: Preserve the follow-up
    surface: casebook
    initial: withdrawn
    action: {action: preserve, target: item, topic: follow-up}
    exclusive: false
  test_hypothesis:
    label: Test the hypothesis
    surface: casebook
    initial: offered
    deduction: hypothesis
places: {site: Test Site}
things: {item: {type: object, name: Item}}
truth:
  events:
    incident: {at: "10:01", type: item.moved, actor: subject, object: item, place: site}
  facts: {}
perspectives: {}
opening:
  call: {from: observer, text: Inspect the record.}
  grants: [opening_record]
  starts: [timeout]
evidence:
  opening_record:
    tool: document
    at: start
    assets: [private_provider_file]
    reports:
      value: clue_value
      structured: {alpha: one, beta: {first: 1, second: 2}}
  locked_record:
    tool: log
    unlock: {after: observe, ref: opening_record.value}
    reports: {detail: later_value}
deductions:
  hypothesis:
    conclude: {item: item, status: located}
    prove: {any: [[opening_record.value]]}
flags: [fixture_preserved, fixture_expired]
reactions:
  - on: {action: search, query: synthetic-index}
    once: true
    do: [{offer: preserve_followup}]
  - on: {action: preserve, target: item}
    once: true
    do: [{mark: fixture_preserved}, {cancel: timeout}]
deadlines:
  timeout:
    clock: case-time
    after: 1m
    offline: pause
    do: [{mark: fixture_expired}]
objectives:
  solve: {supported: hypothesis}
outcomes:
  resolved: {title: Resolved, priority: 10, require: [solve]}
`

function fixtureIr() {
  return compileCaseSourceOrThrow(ENGINE_FIXTURE, { fileName: 'engine-fixture.case.yml' }).ir
}

function scenarioSource(id: string, steps: string): string {
  return `schema: case-test/v0.1
case: {id: demo.engine-fixture, version: 0.1.0}
scenario:
  id: ${id}
  perspective: detective
  steps:
${steps}
`
}

function parseScenario(id: string, steps: string) {
  return parseCaseTestDocument(scenarioSource(id, steps), {
    fileName: `${id}.yml`,
    expectedScenarioId: id,
    ir: fixtureIr(),
  })
}

describe('detective-perspective case test engine', () => {
  it('asserts offered and hidden affordances using only the public projection', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'affordance_progression',
      `    - expect:
        state:
          affordances: {inspect_index: offered, preserve_followup: hidden}
          clocks: {case-time: 0s}
    - detective.act: {action: search, query: synthetic-index}
      expect:
        result: {status: accepted}
        state:
          affordances: {inspect_index: hidden, preserve_followup: offered}
          clocks: {case-time: 10s}`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
  })

  it('asserts opaque handles for private provider assets without exposing their locator', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'private_asset_handle',
      `    - expect:
        state:
          evidence:
            opening_record: {status: available, assets: [private_provider_file]}`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('provider-private-fixture-ref')
    expect(JSON.stringify(result)).not.toContain('signed-media')
  })

  it('compares observation JSON structurally regardless of object key order', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'structural_observation',
      `    - detective.observe: opening_record
      expect:
        state:
          observations:
            opening_record.structured:
              beta: {second: 2, first: 1}
              alpha: one`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
  })

  it('starts elapsed clocks at zero and advances each clock in isolation', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'clock_isolation',
      `    - expect:
        state:
          clocks: {wall: 0s, active: 0s, case-time: 0s}
    - detective.advance: {clock: case-time, by: 1s}
      expect:
        state:
          clocks: {wall: 0s, active: 0s, case-time: 1s}
    - detective.advance: {clock: active, by: 2s}
      expect:
        state:
          clocks: {wall: 0s, active: 2s, case-time: 1s}
    - detective.advance: {clock: wall, by: 3s}
      expect:
        state:
          clocks: {wall: 3s, active: 2s, case-time: 1s}`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
    expect(result.trace.map(({ operation }) => operation)).toEqual([
      'expect',
      'advance',
      'advance',
      'advance',
    ])
  })

  it('does not infer or submit a ready deduction after evidence is observed', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'observe_only',
      `    - detective.observe: opening_record
      expect:
        state:
          evidence: {opening_record: observed}
          deductions: {hypothesis: unknown}`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
    expect(result.trace.map(({ operation }) => operation)).toEqual(['observe'])
  })

  it('accepts an exact denial and proves the rejected command is atomic', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'locked_denial',
      `    - detective.observe: locked_record
      expect:
        result: {status: denied, code: evidence-locked}
        state:
          evidence: {locked_record: hidden}
          unknown_observations: [locked_record.detail]`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    const step = result.trace[0]
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
    expect(step).toMatchObject({
      operation: 'observe',
      result: 'denied',
      errorCode: 'evidence-locked',
    })
    expect(step?.revisionAfter).toBe(step?.revisionBefore)
  })

  it('never changes command execution because an expectation changes', () => {
    const ir = fixtureIr()
    const correct = parseScenario(
      'expectation_independence',
      `    - detective.observe: opening_record
      expect: {state: {evidence: {opening_record: observed}}}`,
    )
    const intentionallyWrong = parseScenario(
      'expectation_independence',
      `    - detective.observe: opening_record
      expect: {state: {evidence: {opening_record: available}}}`,
    )

    const first = runDetectiveCaseTest(ir, correct)
    const second = runDetectiveCaseTest(ir, intentionallyWrong)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.trace).toEqual(first.trace)
    expect(second.commandCount).toBe(first.commandCount)
    expect(second.revision).toBe(first.revision)
  })

  it('preserves every authored CaseAction argument in the public-safe trace', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'complete_action_payload',
      `    - detective.observe: opening_record
    - detective.act:
        action: present
        target: subject
        actor: observer
        from: observer
        topic: generic_topic
        evidence: opening_record
        tone: neutral
        query: generic_query
        ref: opening_record
      expect: {result: {status: accepted}}`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
    expect(result.trace[1]?.detail).toEqual({
      action: 'present',
      target: 'subject',
      actor: 'observer',
      from: 'observer',
      topic: 'generic_topic',
      evidence: 'opening_record',
      tone: 'neutral',
      query: 'generic_query',
      ref: 'opening_record',
    })
  })

  it('executes authored order literally around a deadline', () => {
    const ir = fixtureIr()
    const before = parseScenario(
      'act_before_time',
      `    - detective.act: {action: preserve, target: item}
    - detective.advance: {clock: case-time, by: 1m}
      expect:
        state:
          clocks: {case-time: 1m}`,
    )
    const after = parseScenario(
      'time_before_act',
      `    - detective.advance: {clock: case-time, by: 1m}
    - detective.act: {action: preserve, target: item}
      expect:
        state:
          clocks: {case-time: 1m}`,
    )

    const first = runDetectiveCaseTest(ir, before)
    const second = runDetectiveCaseTest(ir, after)
    expect(first.ok, JSON.stringify(first.failures, null, 2)).toBe(true)
    expect(second.ok, JSON.stringify(second.failures, null, 2)).toBe(true)
    expect(first.trace.map(({ operation }) => operation)).toEqual(['act', 'advance'])
    expect(second.trace.map(({ operation }) => operation)).toEqual(['advance', 'act'])
    expect(first.revision).not.toBe(second.revision)
  })

  it('is deterministic across independent scenario runs', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'deterministic_route',
      `    - detective.observe: opening_record
    - detective.deduce: hypothesis
      expect: {state: {deductions: {hypothesis: supported}, outcome: resolved}}`,
    )
    const first = runDetectiveCaseTest(ir, scenario)
    const second = runDetectiveCaseTest(ir, scenario)
    expect(second).toEqual(first)
  })

  it('rejects simulator commands after the projected outcome closes the case', () => {
    const ir = fixtureIr()
    const scenario = parseScenario(
      'terminal_outcome_guard',
      `    - detective.observe: opening_record
    - detective.deduce: hypothesis
      expect: {state: {status: ended, outcome: resolved}}
    - detective.act: {action: present, target: subject}
      expect:
        result: {status: denied, code: case-ended}
        state:
          status: ended
          deductions: {hypothesis: supported}
          outcome: resolved`,
    )

    const result = runDetectiveCaseTest(ir, scenario)
    expect(result.ok, JSON.stringify(result.failures, null, 2)).toBe(true)
    expect(result.trace[2]).toMatchObject({
      operation: 'act',
      result: 'denied',
      errorCode: 'case-ended',
    })
    expect(result.trace[2]?.revisionAfter).toBe(result.trace[2]?.revisionBefore)
  })

  it('keeps the detective executor independent of private planning code', () => {
    const runner = readFileSync(
      resolve(process.cwd(), 'src/simulator/detective-runner.ts'),
      'utf8',
    )
    expect(runner).not.toMatch(/from ['"]\.\/planner['"]/)
    expect(runner).not.toContain('simulatorPrivateState')
    expect(runner).not.toContain('proofAlternatives')
  })
})
