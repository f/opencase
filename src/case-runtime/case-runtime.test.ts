import { describe, expect, it } from 'vitest'

import { compileCaseSourceOrThrow } from '../compiler'
import {
  ASSERTION_CONTEXTS,
  KERNEL_COMMANDS,
  type DispatchResult,
  type KernelSession,
} from '../kernel'

import {
  CASE_EVENTS,
  advanceCaseTime,
  attemptDeduction,
  compileToKernelIR,
  createCaseRuntime,
  dispatchCaseCommand,
  observeEvidence,
  performAction,
  projectCaseState,
  replayCase,
  startCase,
} from './index'

const GENERIC_CASE = `schema: case-source/v0.1
case:
  id: demo.runtime-fixture
  version: 0.1.0
  title: Runtime Fixture
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "10:00"}
  synopsis: A generic runtime fixture.
use: [investigation@1, artifacts@1, generic-actions@1]
assets:
  private_media:
    kind: image
    source: {https: "https://assets.example.test/media.png"}
    mime_type: image/png
    visibility: private
    integrity: {sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
cast:
  observer: {name: Observer, role: witness, client: true}
  subject: {name: Subject, role: subject}
conversations:
  observer:
    initial: reachable
    states:
      reachable: {can_talk: true}
    channels: {interview: actor}
  subject:
    initial: unavailable
    states:
      unavailable: {can_talk: false, reason: Not answering.}
      reachable: {can_talk: true}
    channels: {interview: actor}
affordances:
  inspect_item:
    label: Inspect the item
    result: Item preserved.
    risk: consequential
    confirmation: Preserve this item now?
    surface: files
    initial: offered
    action: {action: preserve, target: item}
    cost: {clock: case-time, by: 30s}
  deferred_search:
    label: Search the index
    surface: web
    initial: withdrawn
    action: {action: search, query: generic-index-query}
    exclusive: false
    cost: {clock: case-time, by: 30s}
  guided_interview:
    label: Ask about the record
    surface: phone
    initial: withdrawn
    action: {action: interview, actor: observer, topic: record}
  open_observed_record:
    label: Open the observed record
    surface: files
    initial: offered
    action: {action: open, ref: opening_record}
  observation_followup:
    label: Request the observation follow-up
    surface: casebook
    initial: withdrawn
    action: {action: request, from: observer, topic: observation-follow-up}
  theory_location:
    label: Test the location theory
    result: The location theory is supported by the record.
    risk: consequential
    confirmation: Commit this theory to the casebook?
    surface: casebook
    initial: offered
    deduction: hypothesis
    cost: {clock: case-time, by: 5s}
  test_false_signal:
    label: Test the false signal
    surface: casebook
    initial: withdrawn
    deduction: false_signal
  test_wrong_boolean:
    label: Test the wrong boolean
    surface: casebook
    initial: withdrawn
    deduction: wrong_boolean
  test_numeric_range:
    label: Test the numeric range
    surface: casebook
    initial: withdrawn
    deduction: numeric_range
  test_numeric_mismatch:
    label: Test the numeric mismatch
    surface: casebook
    initial: withdrawn
    deduction: numeric_mismatch
  test_array_shape:
    label: Test the array shape
    surface: casebook
    initial: withdrawn
    deduction: array_shape
  test_array_mismatch:
    label: Test the array mismatch
    surface: casebook
    initial: withdrawn
    deduction: array_mismatch
  test_clock_order:
    label: Test the clock order
    surface: casebook
    initial: withdrawn
    deduction: clock_order
  test_clock_mismatch:
    label: Test the clock mismatch
    surface: casebook
    initial: withdrawn
    deduction: clock_mismatch
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
    presentation:
      title: Opening Record
      description: A short record from the scene.
      findings:
        value: The record contains a useful clue.
        score: The recorded score is in the expected range.
    at: start
    assets: [private_media]
    reports:
      {value: clue_value, quiet: false, score: 12, tags: [alpha, beta],
       empty: [], started_at: "10:00", ended_at: "10:05"}
  locked_record:
    tool: log
    unlock: {after: observe, ref: opening_record.value}
    reports: {detail: later_value}
  opened_record:
    tool: log
    unlock: {after: open, ref: opening_record}
    reports: {detail: opened_value}
deductions:
  hypothesis:
    conclude: {item: item, status: located}
    prove: {any: [[opening_record.value]]}
  false_signal:
    conclude: {signal: quiet}
    prove:
      any:
        - terms: [opening_record.quiet]
          checks:
            - {ref: opening_record.quiet, equals: false}
            - {ref: opening_record.quiet, not_equals: true}
  wrong_boolean:
    conclude: {signal: noisy}
    prove:
      any:
        - terms: [opening_record.quiet]
          checks: [{ref: opening_record.quiet, equals: true}]
  numeric_range:
    conclude: {score: in-range}
    prove:
      any:
        - terms: [opening_record.score]
          checks:
            - {ref: opening_record.score, greater_than: 10}
            - {ref: opening_record.score, less_than: 20}
  numeric_mismatch:
    conclude: {score: unexpectedly-low}
    prove:
      any:
        - terms: [opening_record.score]
          checks: [{ref: opening_record.score, less_than: 10}]
  array_shape:
    conclude: {tags: expected}
    prove:
      any:
        - terms: [opening_record.tags, opening_record.empty]
          checks:
            - {ref: opening_record.tags, contains: beta}
            - {ref: opening_record.empty, count: 0}
  array_mismatch:
    conclude: {tags: unexpected}
    prove:
      any:
        - terms: [opening_record.tags]
          checks: [{ref: opening_record.tags, contains: gamma}]
  clock_order:
    conclude: {order: valid}
    prove:
      any:
        - terms: [opening_record.started_at, opening_record.ended_at]
          checks:
            - {ref: opening_record.started_at, before: {ref: opening_record.ended_at}}
            - {ref: opening_record.ended_at, after: {value: "09:59"}}
  clock_mismatch:
    conclude: {order: reversed}
    prove:
      any:
        - terms: [opening_record.started_at, opening_record.ended_at]
          checks: [{ref: opening_record.started_at, after: {ref: opening_record.ended_at}}]
flags: [expired, searched]
reactions:
  - on: {observed: opening_record.value}
    once: true
    do: [{offer: observation_followup}]
  - on: {action: preserve, target: item}
    once: true
    do: [{offer: deferred_search}]
  - on: {action: search, query: generic-index-query}
    once: true
    do: [{mark: searched}]
  - on: {action: open, target: item}
    once: true
    do: [{conversation: [subject, reachable]}]
  - on: {action: submit-conclusion, target: subject}
    when: {supported: hypothesis}
    once: true
    do: [{cancel: timeout}]
deadlines:
  timeout:
    label: Time limit
    clock: case-time
    after: 1m
    offline: pause
    do: [{mark: expired}]
objectives:
  solve: {supported: hypothesis}
outcomes:
  resolved: {title: Resolved, body: Work finished., priority: 100, require: [solve], final_target: subject}
  expired_result: {title: Expired, priority: 10, when_marked: expired}
`

const CONTACT_CASE = `schema: case-source/v0.1
case:
  id: demo.runtime-contact-fixture
  version: 0.1.0
  title: Runtime Contact Fixture
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "10:00"}
  synopsis: A generic contact-directory runtime fixture.
use: [investigation@1, artifacts@1, interview@1, contact-directory@1]
cast:
  caller: {name: Caller, role: client, client: true}
  witness:
    name: Hidden Witness
    role: witness
    phone: "+90 555 000 00 01"
    operator: Anatolia Mobile
    contact_source: {$text: contacts.witness.source}
conversations:
  witness:
    contact: {initial: hidden}
    initial: reachable
    states:
      reachable: {can_talk: true}
    channels: {interview: actor, present: target}
affordances:
  find_witness:
    label: Find the witness
    result: The directory lead returned the witness contact.
    surface: inbox
    initial: offered
    action: {action: locate-contact, target: witness}
    interaction:
      kind: async-message
      channel: forensics
      request: {$text: affordances.find_witness.request}
      context: {kind: opening-call}
  save_witness_mention:
    label: Save the witness mention
    surface: casebook
    initial: offered
    action: {action: preserve, target: witness}
  report_witness:
    label: Report Hidden Witness
    surface: casebook
    initial: offered
    action: {action: report-suspect, target: witness}
  conclude_witness:
    label: Close on Hidden Witness
    risk: terminal
    surface: casebook
    initial: offered
    action: {action: submit-conclusion, target: witness}
  interview_witness:
    label: Call the witness
    surface: phone
    initial: withdrawn
    action: {action: interview, actor: witness}
  test_lead:
    label: Test the directory lead
    surface: casebook
    initial: offered
    deduction: lead
places: {site: Test Site}
things: {item: {type: object, name: Item}}
truth:
  events:
    incident: {at: "10:01", type: item.moved, actor: caller, object: item, place: site}
  facts: {}
perspectives: {}
opening:
  call: {from: caller, text: Find the witness.}
  grants: [seed]
  starts: []
evidence:
  seed:
    tool: document
    at: start
    reports: {lead: witness}
deductions:
  lead:
    conclude: {witness: witness, status: identified}
    prove: {any: [[seed.lead]]}
flags: []
reactions:
  - on: {action: locate-contact, target: witness}
    once: true
    do: [{contact: [witness, listed]}, {offer: interview_witness}]
deadlines: {}
objectives:
  solve: {supported: lead}
outcomes:
  resolved: {title: Resolved, priority: 100, require: [solve], final_target: witness}
`

const CONTACT_PRESENTATION = {
  defaultLocale: 'en',
  locale: 'en',
  messages: {
    'affordances.find_witness.request': 'Please locate the witness contact.',
    'contacts.witness.source': 'Forensics directory response',
  },
} as const

function source() {
  return compileCaseSourceOrThrow(GENERIC_CASE, { fileName: 'runtime-fixture.case.yml' }).ir
}

function contactSource() {
  return compileCaseSourceOrThrow(CONTACT_CASE, {
    fileName: 'runtime-contact-fixture.case.yml',
    localization: {
      defaultLocale: 'en',
      availableKeys: new Set(Object.keys(CONTACT_PRESENTATION.messages)),
    },
  }).ir
}

function harness(ir = source()) {
  let sequence = 0
  const kernelIR = compileToKernelIR(ir)
  const runtime = createCaseRuntime(kernelIR, {
    ids: {
      nextCommandId: () => `command-${++sequence}`,
      nextEventId: () => `event-${++sequence}`,
    },
    wallClock: { now: () => 0 },
  })
  let session = startCase(runtime)
  const apply = (result: DispatchResult): void => {
    expect(result.ok, result.ok ? '' : `${result.error.code}: ${result.error.message}`).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    session = result.session
  }
  return {
    kernelIR,
    runtime,
    get session(): KernelSession {
      return session
    },
    apply,
  }
}

describe('generic compiled case runtime', () => {
  it('fires observed reactions only for the canonical player observation event', () => {
    const canonicalObservation = {
      id: 'observed:opening_record.value',
      relation: 'evidence.observation',
      key: {
        observationId: 'opening_record.value',
        evidenceId: 'opening_record',
        field: 'value',
      },
      value: 'clue_value',
      polarity: 'affirm',
      visibility: 'public',
      provenance: {
        sourceContext: 'source:opening_record',
        sourceAssertionId: 'source:opening_record.value',
      },
      validity: {source: 'opening_record'},
    } as const
    const forgeries = [
      {
        ...canonicalObservation,
        id: 'forged:unrelated-relation',
        relation: 'world.event',
      },
      {
        ...canonicalObservation,
        id: 'forged:malformed-observation',
        key: {
          observationId: 'opening_record.value',
          evidenceId: 'locked_record',
          field: 'detail',
        },
      },
      canonicalObservation,
    ]

    for (const assertion of forgeries) {
      const forged = harness()
      forged.apply(dispatchCaseCommand(forged.runtime, forged.session, {
        type: KERNEL_COMMANDS.recordAssertion,
        payload: {
          contextId: ASSERTION_CONTEXTS.PLAYER_OBSERVED,
          assertion,
        },
      }))
      expect(projectCaseState(forged.session).affordances.map(({id}) => id))
        .not.toContain('observation_followup')
    }

    const observed = harness()
    observed.apply(observeEvidence(observed.runtime, observed.session, 'opening_record'))
    expect(projectCaseState(observed.session).affordances.map(({id}) => id))
      .toContain('observation_followup')
  })

  it('projects only offered affordances and applies their cost exactly once on acceptance', () => {
    const h = harness()
    const opening = projectCaseState(h.session)
    expect(opening.affordances).toEqual([
      {
        id: 'inspect_item',
        surface: 'files',
        intent: {kind: 'action', action: {action: 'preserve', target: 'item'}},
        cost: {clock: 'case-time', milliseconds: 30_000},
        label: 'Inspect the item',
        risk: 'consequential',
        confirmation: 'Preserve this item now?',
      },
      {
        id: 'theory_location',
        surface: 'casebook',
        intent: {kind: 'deduce', deductionId: 'hypothesis'},
        cost: {clock: 'case-time', milliseconds: 5_000},
        label: 'Test the location theory',
        risk: 'consequential',
        confirmation: 'Commit this theory to the casebook?',
      },
    ])
    expect(opening.actors.find(({id}) => id === 'observer')?.conversation.channels).toEqual([])
    expect(JSON.stringify(opening)).not.toContain('Item preserved.')
    expect(JSON.stringify(opening)).not.toContain('The location theory is supported')
    expect(JSON.stringify(opening)).not.toContain('generic-index-query')
    expect(JSON.stringify(opening)).not.toContain('observation-follow-up')

    const unopened = performAction(h.runtime, h.session, {
      action: 'open',
      ref: 'opening_record',
    })
    expect(unopened.ok).toBe(false)
    if (unopened.ok) throw new Error('Expected unobserved evidence prerequisite rejection')
    expect(unopened.error.code).toBe('evidence-not-observed')
    expect(unopened.events).toEqual([])
    expect(projectCaseState(unopened.session).clocks.caseTimeMs).toBe(0)

    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    expect(projectCaseState(h.session).evidence.map(({id}) => id)).not.toContain('opened_record')
    expect(projectCaseState(h.session).affordances.map(({id}) => id)).toEqual([
      'inspect_item',
      'observation_followup',
      'open_observed_record',
      'theory_location',
    ])
    h.apply(performAction(h.runtime, h.session, {action: 'open', ref: 'opening_record'}))
    expect(projectCaseState(h.session).affordances.map(({id}) => id)).toEqual([
      'inspect_item',
      'observation_followup',
      'theory_location',
    ])
    expect(projectCaseState(h.session).evidence.map(({id}) => id)).toContain('opened_record')

    const beforeDenied = JSON.stringify(h.session)
    const hidden = performAction(h.runtime, h.session, {
      action: 'search',
      query: 'generic-index-query',
    })
    expect(hidden.ok).toBe(false)
    if (hidden.ok) throw new Error('Expected withdrawn affordance rejection')
    expect(hidden.error.code).toBe('affordance-unavailable')
    expect(hidden.events).toEqual([])
    expect(JSON.stringify(hidden.session)).toBe(beforeDenied)
    expect(projectCaseState(hidden.session).clocks.caseTimeMs).toBe(0)

    const appendedField = performAction(h.runtime, h.session, {
      action: 'search',
      query: 'generic-index-query',
      tone: 'bypass-attempt',
    })
    expect(appendedField.ok).toBe(false)
    if (appendedField.ok) throw new Error('Expected non-canonical affordance rejection')
    expect(appendedField.error.code).toBe('affordance-command-mismatch')
    expect(appendedField.events).toEqual([])
    expect(JSON.stringify(appendedField.session)).toBe(beforeDenied)

    h.apply(performAction(h.runtime, h.session, {
      action: 'search',
      query: 'deliberately-wrong-query',
    }))
    expect(projectCaseState(h.session).clocks.caseTimeMs).toBe(0)
    expect(projectCaseState(h.session).affordances.map(({id}) => id)).not.toContain('deferred_search')

    h.apply(performAction(h.runtime, h.session, { action: 'preserve', target: 'item' }))
    const afterPreserve = projectCaseState(h.session)
    expect(afterPreserve).toMatchObject({
      clocks: {caseTimeMs: 30_000},
      affordances: [{
        id: 'deferred_search',
        surface: 'web',
        intent: {kind: 'action', action: {action: 'search', query: 'generic-index-query'}},
      }, {
        id: 'observation_followup',
        surface: 'casebook',
        intent: {kind: 'action', action: {action: 'request', from: 'observer', topic: 'observation-follow-up'}},
      }, {
        id: 'theory_location',
        surface: 'casebook',
        intent: {kind: 'deduce', deductionId: 'hypothesis'},
      }],
    })
    expect(afterPreserve.completedAffordances).toContainEqual({
      id: 'inspect_item',
      surface: 'files',
      intent: {kind: 'action', action: {action: 'preserve', target: 'item'}},
      label: 'Inspect the item',
      result: 'Item preserved.',
      risk: 'consequential',
      cost: {clock: 'case-time', milliseconds: 30_000},
      completedAtMs: 30_000,
      eventSequence: expect.any(Number),
    })

    const spentOnce = performAction(h.runtime, h.session, { action: 'preserve', target: 'item' })
    expect(spentOnce.ok).toBe(false)
    if (spentOnce.ok) throw new Error('Expected consumed affordance rejection')
    expect(spentOnce.error.code).toBe('affordance-unavailable')
    expect(projectCaseState(spentOnce.session).clocks.caseTimeMs).toBe(30_000)

    h.apply(performAction(h.runtime, h.session, {
      action: 'search',
      query: 'generic-index-query',
    }))
    expect(projectCaseState(h.session)).toMatchObject({
      clocks: {caseTimeMs: 60_000},
      status: 'ended',
      affordances: [],
      outcome: {id: 'expired_result'},
    })
    expect(h.session.eventLog.filter(({ type, payload }) => (
      type === 'kernel.rule.effects-applied' && payload.caseTimeAdvanceMs === 30_000
    ))).toHaveLength(2)
  })

  it('charges and withdraws an authored deduction affordance only after support succeeds', () => {
    const h = harness()
    const rejected = attemptDeduction(h.runtime, h.session, 'hypothesis')
    expect(rejected.ok).toBe(false)
    if (rejected.ok) throw new Error('Expected unproven deduction rejection')
    expect(rejected.error.code).toBe('deduction-unproven')
    expect(projectCaseState(rejected.session).clocks.caseTimeMs).toBe(0)
    expect(projectCaseState(rejected.session).affordances.map(({id}) => id)).toContain('theory_location')

    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))
    expect(projectCaseState(h.session).clocks.caseTimeMs).toBe(5_000)
    expect(projectCaseState(h.session).affordances.map(({id}) => id)).not.toContain('theory_location')
    expect(projectCaseState(h.session).supportedDeductions).toEqual([
      {id: 'hypothesis', label: 'Test the location theory'},
    ])
    expect(projectCaseState(h.session).completedAffordances).toContainEqual({
      id: 'theory_location',
      surface: 'casebook',
      intent: {kind: 'deduce', deductionId: 'hypothesis'},
      label: 'Test the location theory',
      result: 'The location theory is supported by the record.',
      risk: 'consequential',
      cost: {clock: 'case-time', milliseconds: 5_000},
      completedAtMs: 5_000,
      eventSequence: expect.any(Number),
    })
  })

  it('projects player-safe evidence, action and deduction activity in engine order', () => {
    const h = harness()
    expect(projectCaseState(h.session).activity).toEqual([])

    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    h.apply(performAction(h.runtime, h.session, { action: 'preserve', target: 'item' }))
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))

    const projected = projectCaseState(h.session)
    const observedEvent = h.session.eventLog.find((event) => (
      event.type === CASE_EVENTS.evidenceObserved && event.payload.evidenceId === 'opening_record'
    ))
    const actionEvent = h.session.eventLog.find((event) => (
      event.type === CASE_EVENTS.actionPerformed &&
      event.payload.action === 'preserve' &&
      event.payload.target === 'item'
    ))
    const deductionEvent = h.session.eventLog.find((event) => (
      event.type === CASE_EVENTS.deductionSupported && event.payload.deductionId === 'hypothesis'
    ))
    const action = projected.completedAffordances.find(({id}) => id === 'inspect_item')
    const deduction = projected.completedAffordances.find(({id}) => id === 'theory_location')
    if (
      !observedEvent ||
      !actionEvent ||
      !deductionEvent ||
      action?.eventSequence === undefined ||
      deduction?.eventSequence === undefined
    ) {
      throw new Error('Expected projected activity source events')
    }
    expect(action.eventSequence).toBe(actionEvent.meta.sequence)
    expect(deduction.eventSequence).toBe(deductionEvent.meta.sequence)

    expect(projected.activity).toEqual([
      {
        id: `activity:${observedEvent.meta.sequence}`,
        kind: 'evidence-observed',
        sequence: observedEvent.meta.sequence,
        occurredAtMs: observedEvent.meta.occurredAt.caseTimeMs,
        evidenceId: 'opening_record',
      },
      {
        id: `activity:${action.eventSequence}`,
        kind: 'affordance-completed',
        sequence: action.eventSequence,
        occurredAtMs: 30_000,
        affordanceId: 'inspect_item',
      },
      {
        id: `activity:${deduction.eventSequence}`,
        kind: 'affordance-completed',
        sequence: deduction.eventSequence,
        occurredAtMs: 35_000,
        affordanceId: 'theory_location',
      },
    ])
    expect(projected.activity?.map(({sequence}) => sequence)).toEqual(
      [...(projected.activity ?? [])].map(({sequence}) => sequence).sort((left, right) => left - right),
    )
    expect(projected.activity?.filter((entry) => (
      entry.kind === 'affordance-completed' && entry.affordanceId === 'theory_location'
    ))).toHaveLength(1)
    expect(JSON.stringify(projected.activity)).not.toContain(observedEvent.id)
    expect(JSON.stringify(projected.activity)).not.toContain(observedEvent.meta.commandId)
  })

  it('does not project an already-supported deduction from legacy repeatable IR', () => {
    const ir = source()
    const affordance = ir.affordances.find(({id}) => id === 'theory_location')
    if (!affordance) throw new Error('Missing theory_location affordance')
    affordance.once = false
    const h = harness(ir)

    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))

    expect(projectCaseState(h.session).affordances.map(({id}) => id)).not.toContain('theory_location')
    expect(projectCaseState(h.session).supportedDeductions).toEqual([
      {id: 'hypothesis', label: 'Test the location theory'},
    ])
    const repeated = attemptDeduction(h.runtime, h.session, 'hypothesis')
    expect(repeated.ok).toBe(false)
    if (repeated.ok) throw new Error('Expected already-supported deduction rejection')
    expect(repeated.error.code).toBe('deduction-already-supported')
  })

  it('fails closed when checked values are unobserved and evaluates generic predicates', () => {
    const legacyIr = source()
    legacyIr.affordances = []
    const h = harness(legacyIr)

    const beforeObservation = attemptDeduction(h.runtime, h.session, 'false_signal')
    expect(beforeObservation.ok).toBe(false)
    if (beforeObservation.ok) throw new Error('Expected unobserved check to fail')
    expect(beforeObservation.error.code).toBe('deduction-unproven')

    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    for (const deductionId of ['false_signal', 'numeric_range', 'array_shape', 'clock_order']) {
      h.apply(attemptDeduction(h.runtime, h.session, deductionId))
    }
    for (const deductionId of [
      'wrong_boolean',
      'numeric_mismatch',
      'array_mismatch',
      'clock_mismatch',
    ]) {
      const wrongValue = attemptDeduction(h.runtime, h.session, deductionId)
      expect(wrongValue.ok).toBe(false)
      if (wrongValue.ok) throw new Error('Expected mismatched predicate to fail')
      expect(wrongValue.error.code).toBe('deduction-unproven')
    }

    expect(projectCaseState(h.session).hypotheses.map(({ key }) => (
      typeof key === 'object' && key !== null && !Array.isArray(key)
        ? key.deductionId
        : undefined
    ))).toEqual([
      'false_signal',
      'numeric_range',
      'array_shape',
      'clock_order',
    ])
  })

  it('fails closed when affordance-enabled legacy IR omits a deduction affordance', () => {
    const ir = source()
    ir.affordances = ir.affordances.filter(({intent}) => (
      intent.kind !== 'deduce' || intent.deductionId !== 'false_signal'
    ))
    const h = harness(ir)
    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    const before = JSON.stringify(h.session)

    const result = attemptDeduction(h.runtime, h.session, 'false_signal')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected missing affordance rejection')
    expect(result.error.code).toBe('affordance-unavailable')
    expect(result.events).toEqual([])
    expect(JSON.stringify(result.session)).toBe(before)
  })

  it('resolves a revealed outcome through host presentation copy, never kernel copy', () => {
    const localizedSource = GENERIC_CASE.replace(
      'resolved: {title: Resolved, body: Work finished.,',
      'resolved: {title: {$text: outcomes.resolved.title}, body: {$text: outcomes.resolved.body},',
    )
    const ir = compileCaseSourceOrThrow(localizedSource, {
      localization: {
        defaultLocale: 'en',
        availableKeys: new Set(['outcomes.resolved.title', 'outcomes.resolved.body']),
      },
    }).ir
    const h = harness(ir)
    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))
    h.apply(performAction(h.runtime, h.session, {
      action: 'submit-conclusion',
      target: 'subject',
    }))

    expect(projectCaseState(h.session).outcome).toEqual({
      id: 'resolved',
      textKey: 'outcomes.resolved.title',
      bodyKey: 'outcomes.resolved.body',
    })
    expect(projectCaseState(h.session, {
      defaultLocale: 'en',
      locale: 'tr',
      messages: {
        'outcomes.resolved.title': 'Çözüldü',
        'outcomes.resolved.body': 'Çalışma tamamlandı.',
      },
    }).outcome).toEqual({
      id: 'resolved',
      title: 'Çözüldü',
      body: 'Çalışma tamamlandı.',
    })
  })

  it('evaluates a private authored assessment only after the outcome is revealed', () => {
    const assessedSource = GENERIC_CASE.replace(
      'cast:',
      `assessment:
  max_score: 100
  bands:
    - {min_score: 0, label: {$text: assessment.bands.developing}}
    - {min_score: 80, label: {$text: assessment.bands.strong}}
  categories:
    reasoning:
      label: {$text: assessment.categories.reasoning}
      criteria:
        supported:
          points: 70
          when: {supported: hypothesis}
          met: {$text: assessment.criteria.supported.met}
          missed: {$text: assessment.criteria.supported.missed}
    control:
      label: {$text: assessment.categories.control}
      criteria:
        deadline_active:
          points: 10
          when: {schedule-active: timeout}
          met: {$text: assessment.criteria.deadline.met}
          missed: {$text: assessment.criteria.deadline.missed}
        no_expiry:
          points: 20
          when: {not-marked: expired}
          met: {$text: assessment.criteria.expiry.met}
          missed: {$text: assessment.criteria.expiry.missed}
cast:`,
    )
    const keys = new Set([
      'assessment.bands.developing',
      'assessment.bands.strong',
      'assessment.categories.reasoning',
      'assessment.categories.control',
      'assessment.criteria.supported.met',
      'assessment.criteria.supported.missed',
      'assessment.criteria.deadline.met',
      'assessment.criteria.deadline.missed',
      'assessment.criteria.expiry.met',
      'assessment.criteria.expiry.missed',
    ])
    const ir = compileCaseSourceOrThrow(assessedSource, {
      localization: { defaultLocale: 'en', availableKeys: keys },
    }).ir
    const h = harness(ir)

    expect(projectCaseState(h.session)).not.toHaveProperty('outcome')
    expect(JSON.stringify(projectCaseState(h.session))).not.toContain('assessment')
    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))
    h.apply(performAction(h.runtime, h.session, {
      action: 'submit-conclusion',
      target: 'subject',
    }))

    const unresolvedCopy = projectCaseState(h.session)
    expect(unresolvedCopy.outcome?.assessment).toEqual({
      score: 90,
      maxScore: 100,
      bandLabelKey: 'assessment.bands.strong',
      categories: [
        {
          labelKey: 'assessment.categories.control',
          score: 20,
          maxScore: 30,
          details: [
            {
              status: 'missed',
              score: 0,
              maxScore: 10,
              textKey: 'assessment.criteria.deadline.missed',
            },
            {
              status: 'met',
              score: 20,
              maxScore: 20,
              textKey: 'assessment.criteria.expiry.met',
            },
          ],
        },
        {
          labelKey: 'assessment.categories.reasoning',
          score: 70,
          maxScore: 70,
          details: [{
            status: 'met',
            score: 70,
            maxScore: 70,
            textKey: 'assessment.criteria.supported.met',
          }],
        },
      ],
    })
    expect(JSON.stringify(unresolvedCopy)).not.toContain('deadline_active')
    expect(JSON.stringify(unresolvedCopy)).not.toContain('no_expiry')

    expect(projectCaseState(h.session, {
      defaultLocale: 'en',
      locale: 'tr',
      messages: {
        'assessment.bands.strong': 'Güçlü yaklaşım',
        'assessment.categories.control': 'Vaka kontrolü',
        'assessment.categories.reasoning': 'Muhakeme',
        'assessment.criteria.deadline.missed': 'Süreç kapanırken zamanlayıcı aktif değildi.',
        'assessment.criteria.expiry.met': 'Vaka zaman aşımına uğramadı.',
        'assessment.criteria.supported.met': 'Sonuç kanıtlarla doğrulandı.',
      },
    }).outcome?.assessment).toMatchObject({
      score: 90,
      maxScore: 100,
      bandLabel: 'Güçlü yaklaşım',
      categories: [
        {
          label: 'Vaka kontrolü',
          details: [
            {status: 'missed', text: 'Süreç kapanırken zamanlayıcı aktif değildi.'},
            {status: 'met', text: 'Vaka zaman aşımına uğramadı.'},
          ],
        },
        {
          label: 'Muhakeme',
          details: [{status: 'met', text: 'Sonuç kanıtlarla doğrulandı.'}],
        },
      ],
    })
  })

  it('lowers entities, relations and only opening schedules without case-specific code', () => {
    const compiled = compileToKernelIR(source())

    expect(compiled.entities).toContainEqual({
      id: 'site',
      typeId: 'place',
    })
    expect(compiled.types).toContainEqual({ id: 'object', parentId: 'thing' })
    expect(compiled.initial?.schedules?.map(({ id }) => id)).toEqual(['timeout'])
    expect(compiled.relations).toContainEqual({
      id: 'evidence.observation',
      cardinality: 'one_per_context',
    })
  })

  it('projects only granted evidence and opaque asset handles', () => {
    const h = harness()
    const initial = projectCaseState(h.session)
    const serialized = JSON.stringify(initial)
    const opening = initial.evidence.find(({ id }) => id === 'opening_record')

    expect(opening?.assets).toEqual([
      { id: 'private_media', kind: 'image', mimeType: 'image/png' },
    ])
    expect(opening).toMatchObject({
      title: 'Opening Record',
      description: 'A short record from the scene.',
      findings: [],
    })
    expect(serialized).not.toContain('locked_record')
    expect(serialized).not.toContain('assets.example.test')
    expect(serialized).not.toContain('aaaaaaaaaaaaaaaa')

    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    const observed = projectCaseState(h.session).evidence.find(({ id }) => id === 'opening_record')
    expect(observed?.findings).toEqual([
      {field: 'score', text: 'The recorded score is in the expected range.'},
      {field: 'value', text: 'The record contains a useful clue.'},
    ])
    const presentationBytes = JSON.stringify(observed)
    expect(presentationBytes).not.toContain('clue_value')
    expect(presentationBytes).not.toContain('opening_record.value')
    expect(presentationBytes).not.toContain('started_at')
  })

  it('rejects an unproven deduction without mutating the session', () => {
    const h = harness()
    const before = JSON.stringify(h.session)
    const result = attemptDeduction(h.runtime, h.session, 'hypothesis')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected rejection')
    expect(result.error.code).toBe('deduction-unproven')
    expect(JSON.stringify(result.session)).toBe(before)
    expect(result.events).toEqual([])
  })

  it('observes, explicitly deduces and reaches an outcome through public commands', () => {
    const h = harness()
    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    expect(projectCaseState(h.session).evidence.map(({ id }) => id)).toContain('locked_record')
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))
    h.apply(
      performAction(h.runtime, h.session, {
        action: 'submit-conclusion',
        target: 'subject',
      }),
    )

    expect(projectCaseState(h.session)).toMatchObject({
      finalConclusion: { target: 'subject' },
      outcome: { id: 'resolved' },
    })
    expect(projectCaseState(h.session).hypotheses[0]).toMatchObject({
      key: { deductionId: 'hypothesis' },
      value: { item: 'item', status: 'located' },
    })
  })

  it('rejects every direct case command after an authored outcome becomes eligible', () => {
    const h = harness()
    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))
    h.apply(performAction(h.runtime, h.session, {
      action: 'submit-conclusion',
      target: 'subject',
    }))

    expect(projectCaseState(h.session)).toMatchObject({
      status: 'ended',
      outcome: { id: 'resolved' },
    })
    const terminalSession = JSON.stringify(h.session)

    const action = performAction(h.runtime, h.session, {
      action: 'present',
      target: 'subject',
    })
    expect(action.ok).toBe(false)
    if (action.ok) throw new Error('Expected post-outcome action rejection')
    expect(action.error.code).toBe('case-ended')
    expect(action.events).toEqual([])
    expect(JSON.stringify(action.session)).toBe(terminalSession)

    const direct = dispatchCaseCommand(h.runtime, h.session, {
      type: KERNEL_COMMANDS.advanceCaseTime,
      payload: { byMs: 1_000 },
    })
    expect(direct.ok).toBe(false)
    if (direct.ok) throw new Error('Expected post-outcome direct dispatch rejection')
    expect(direct.error.code).toBe('case-ended')
    expect(direct.events).toEqual([])
    expect(JSON.stringify(direct.session)).toBe(terminalSession)
    expect(projectCaseState(direct.session).clocks.caseTimeMs).toBe(5_000)
  })

  it('preserves the complete structured action payload', () => {
    const h = harness()
    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    const action = {
      action: 'present',
      target: 'subject',
      actor: 'observer',
      from: 'observer',
      topic: 'generic_topic',
      evidence: 'opening_record',
      tone: 'neutral',
      query: 'generic_query',
      ref: 'opening_record',
    }
    const result = performAction(h.runtime, h.session, action)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.events.find(({ type }) => type === 'case.action.performed')?.payload).toEqual(
      action,
    )
  })

  it('enforces case-authored actor availability without story tokens in the engine', () => {
    const h = harness()
    const before = JSON.stringify(h.session)

    const unavailable = performAction(h.runtime, h.session, {
      action: 'interview',
      actor: 'subject',
    })
    expect(unavailable.ok).toBe(false)
    if (unavailable.ok) throw new Error('Expected unavailable actor rejection')
    expect(unavailable.error.code).toBe('actor-unavailable')
    expect(JSON.stringify(unavailable.session)).toBe(before)
    expect(unavailable.events).toEqual([])

    const unknown = performAction(h.runtime, h.session, {
      action: 'interview',
      actor: 'unlisted_person',
    })
    expect(unknown.ok).toBe(false)
    if (unknown.ok) throw new Error('Expected unknown actor rejection')
    expect(unknown.error.code).toBe('actor-unavailable')

    const incompleteGuidedInterview = performAction(h.runtime, h.session, {
      action: 'interview',
      actor: 'observer',
    })
    expect(incompleteGuidedInterview.ok).toBe(false)
    if (incompleteGuidedInterview.ok) throw new Error('Expected exclusive affordance rejection')
    expect(incompleteGuidedInterview.error.code).toBe('affordance-command-mismatch')
    expect(incompleteGuidedInterview.events).toEqual([])

    const hiddenGuidedInterview = performAction(h.runtime, h.session, {
      action: 'interview',
      actor: 'observer',
      topic: 'record',
    })
    expect(hiddenGuidedInterview.ok).toBe(false)
    if (hiddenGuidedInterview.ok) throw new Error('Expected withdrawn affordance rejection')
    expect(hiddenGuidedInterview.error.code).toBe('affordance-unavailable')

    h.apply(performAction(h.runtime, h.session, {
      action: 'open',
      target: 'item',
    }))

    expect(projectCaseState(h.session).actors).toContainEqual({
      id: 'subject',
      name: 'Subject',
      role: 'subject',
      conversation: {
        state: 'reachable',
        canTalk: true,
        channels: [{ action: 'interview', actorField: 'actor', available: true }],
      },
    })
    h.apply(performAction(h.runtime, h.session, {
      action: 'interview',
      actor: 'subject',
    }))
  })

  it('reveals a contact only after its authored async lookup completes and preserves it on replay', () => {
    const h = harness(contactSource())
    const opening = projectCaseState(h.session, CONTACT_PRESENTATION)
    const lookup = opening.affordances.find(({id}) => id === 'find_witness')

    expect(opening.actors).toEqual([])
    expect(opening.affordances.map(({id}) => id)).toEqual(expect.arrayContaining([
      'find_witness',
      'save_witness_mention',
      'test_lead',
    ]))
    expect(opening.affordances.map(({id}) => id)).not.toEqual(expect.arrayContaining([
      'report_witness',
      'conclude_witness',
    ]))
    expect(JSON.stringify(opening)).not.toContain('Report Hidden Witness')
    expect(JSON.stringify(opening)).not.toContain('Close on Hidden Witness')
    expect(lookup).toMatchObject({
      id: 'find_witness',
      surface: 'inbox',
      interaction: {
        kind: 'async-message',
        channel: 'forensics',
        request: 'Please locate the witness contact.',
        context: {kind: 'opening-call'},
      },
    })
    expect(JSON.stringify(lookup)).not.toContain('directory lead returned')

    for (const action of [
      {action: 'report-suspect', target: 'witness'},
      {action: 'submit-conclusion', target: 'witness'},
      {action: 'report-suspect', target: 'invented-person'},
      {action: 'submit-conclusion', target: 'invented-person'},
      {action: 'report-suspect', actor: 'witness'},
      {action: 'submit-conclusion', from: 'witness'},
      {action: 'report-suspect', target: 'witness', topic: 'guessed-detail'},
    ]) {
      const before = JSON.stringify(h.session)
      const hiddenDecision = performAction(h.runtime, h.session, action)
      expect(hiddenDecision.ok).toBe(false)
      if (hiddenDecision.ok) throw new Error('Expected hidden-decision rejection')
      expect(hiddenDecision.error.code).toBe('affordance-unavailable')
      expect(hiddenDecision.events).toEqual([])
      expect(JSON.stringify(hiddenDecision.session)).toBe(before)
    }

    const hiddenConversation = performAction(h.runtime, h.session, {
      action: 'present',
      target: 'witness',
    })
    expect(hiddenConversation.ok).toBe(false)
    if (hiddenConversation.ok) throw new Error('Expected hidden-contact rejection')
    expect(hiddenConversation.error.code).toBe('actor-unavailable')
    expect(hiddenConversation.events).toEqual([])

    h.apply(performAction(h.runtime, h.session, {
      action: 'locate-contact',
      target: 'witness',
    }))

    const listed = projectCaseState(h.session, CONTACT_PRESENTATION)
    expect(listed.affordances.map(({id}) => id)).toEqual(expect.arrayContaining([
      'interview_witness',
      'report_witness',
      'conclude_witness',
    ]))
    expect(listed.completedAffordances).toContainEqual(expect.objectContaining({
      id: 'find_witness',
      result: 'The directory lead returned the witness contact.',
      completedAtMs: 0,
      contactsListed: ['witness'],
      interaction: {
        kind: 'async-message',
        channel: 'forensics',
        request: 'Please locate the witness contact.',
        context: {kind: 'opening-call'},
      },
    }))
    expect(listed.actors).toEqual([{
      id: 'witness',
      name: 'Hidden Witness',
      role: 'witness',
      phone: '+90 555 000 00 01',
      operator: 'Anatolia Mobile',
      contactSource: 'Forensics directory response',
      conversation: {
        state: 'reachable',
        canTalk: true,
        channels: [{action: 'present', actorField: 'target', available: true}],
      },
    }])

    h.apply(performAction(h.runtime, h.session, {
      action: 'report-suspect',
      target: 'witness',
    }))
    h.apply(performAction(h.runtime, h.session, {
      action: 'submit-conclusion',
      target: 'witness',
    }))

    h.apply(performAction(h.runtime, h.session, {
      action: 'present',
      target: 'witness',
    }))
    h.apply(performAction(h.runtime, h.session, {
      action: 'interview',
      actor: 'witness',
    }))

    const replayed = replayCase(h.runtime, h.session.eventLog)
    expect(replayed.state).toEqual(h.session.state)
    expect(projectCaseState(replayed, CONTACT_PRESENTATION)).toEqual(
      projectCaseState(h.session, CONTACT_PRESENTATION),
    )
    expect(projectCaseState(replayed, CONTACT_PRESENTATION).actors.map(({id}) => id))
      .toContain('witness')
  })

  it('keeps a pre-fix hidden-actor conclusion terminal instead of soft-locking the save', () => {
    const h = harness(contactSource())
    h.apply(observeEvidence(h.runtime, h.session, 'seed'))
    h.apply(attemptDeduction(h.runtime, h.session, 'lead'))
    h.apply(performAction(h.runtime, h.session, {
      action: 'locate-contact',
      target: 'witness',
    }))
    h.apply(performAction(h.runtime, h.session, {
      action: 'submit-conclusion',
      target: 'witness',
    }))

    const contactEvent = h.session.eventLog.find((event) => (
      event.type === CASE_EVENTS.contactChanged && event.payload.actorId === 'witness'
    ))
    expect(contactEvent).toBeDefined()
    const legacyEvents = h.session.eventLog
      .filter((event) => event.meta.commandId !== contactEvent?.meta.commandId)
      .map((event, index) => ({
        ...event,
        meta: {...event.meta, sequence: index + 1},
      }))
    const restored = replayCase(h.runtime, legacyEvents)
    const projected = projectCaseState(restored, CONTACT_PRESENTATION)

    expect(projected.actors).toEqual([])
    expect(projected).toMatchObject({
      status: 'ended',
      finalConclusion: {target: 'witness'},
      outcome: {id: 'resolved'},
    })
  })

  it('delivers a generic deadline through the public outcome projection', () => {
    const h = harness()
    expect(projectCaseState(h.session).deadlines).toEqual([{
      id: 'timeout',
      title: 'Time limit',
      clock: 'case',
      dueAtMs: 60_000,
      remainingMs: 60_000,
      status: 'scheduled',
    }])
    h.apply(advanceCaseTime(h.runtime, h.session, 60_000))

    expect(projectCaseState(h.session)).toMatchObject({
      status: 'ended',
      affordances: [],
      clocks: { caseTimeMs: 60_000 },
      deadlines: [{
        id: 'timeout',
        remainingMs: 0,
        status: 'fired',
      }],
      outcome: { id: 'expired_result' },
    })
  })

  it('replays the complete authoritative state from the event log', () => {
    const h = harness()
    h.apply(observeEvidence(h.runtime, h.session, 'opening_record'))
    h.apply(attemptDeduction(h.runtime, h.session, 'hypothesis'))
    const replayed = replayCase(h.runtime, h.session.eventLog)

    expect(replayed.state).toEqual(h.session.state)
    expect(projectCaseState(replayed)).toEqual(projectCaseState(h.session))
  })
})
