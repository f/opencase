import { describe, expect, it } from 'vitest'
import {
  KERNEL_COMMANDS,
  accept,
  capabilityKey,
  createCapabilityRegistry,
  createKernelRuntime,
  dispatchCommand,
  startSession,
  type CapabilityDefinition,
  type CapabilityRef,
  type CaseKernelIR,
  type DomainEvent,
  type KernelDependencies,
  type RulePlan,
} from './index'

const TEST_REF: CapabilityRef = {
  id: 'rule-test',
  version: '1',
  digest: 'sha256:rule-test-v1',
}

function capability(): CapabilityDefinition {
  return {
    ...TEST_REF,
    commands: {
      'test.fire': () => accept({ type: 'test.fired', payload: { target: 'actor_a' } }),
    },
    reducers: {
      'test.deadline': (state) => ({
        deadlineCount:
          (state && typeof state === 'object' && !Array.isArray(state) && typeof state.deadlineCount === 'number'
            ? state.deadlineCount
            : 0) + 1,
      }),
    },
  }
}

function dependencies(): KernelDependencies {
  let command = 0
  let event = 0
  return {
    ids: {
      nextCommandId: () => `command:${++command}`,
      nextEventId: () => `event:${++event}`,
    },
    wallClock: { now: () => 1_000 },
  }
}

function rules(): RulePlan[] {
  return [
    {
      id: 'z-low-exclusive',
      on: 'test.fired',
      priority: 10,
      reactionGroup: 'response',
      exclusive: true,
      effects: [{ type: 'state.write', path: 'choice', value: 'low' }],
    },
    {
      id: 'b-adjust',
      on: 'test.fired',
      priority: 50,
      effects: [{ type: 'state.adjust', path: 'score', by: 3 }],
    },
    {
      id: 'a-high-exclusive',
      on: 'test.fired',
      priority: 100,
      reactionGroup: 'response',
      exclusive: true,
      once: true,
      effects: [
        { type: 'state.write', path: 'choice', value: 'high' },
        { type: 'state.adjust', path: 'score', by: 2 },
        { type: 'state.write', path: 'marker', value: true },
        { type: 'clock.advance', clock: 'case', byMs: 10 },
        {
          type: 'event.emit',
          event: { type: 'test.follow', capability: TEST_REF, payload: { order: 'after-deadline' } },
        },
      ],
    },
    {
      id: 'same-snapshot-check',
      on: 'test.fired',
      priority: 1,
      when: { type: 'state.slot', path: 'marker', value: true },
      effects: [{ type: 'event.emit', event: { type: 'test.should-not-fire', capability: TEST_REF } }],
    },
  ]
}

function ir(rulePlans: RulePlan[]): CaseKernelIR {
  return {
    schemaVersion: 'case-ir@1',
    id: 'case.rules',
    version: '1',
    digest: 'sha256:rules',
    capabilities: [TEST_REF],
    rules: rulePlans,
    initial: {
      caseTimeMs: 0,
      slots: { score: 0, marker: false },
      capabilityState: { [capabilityKey(TEST_REF)]: { deadlineCount: 0 } },
      schedules: [
        {
          id: 'case-deadline',
          clock: 'case',
          afterMs: 8,
          event: { type: 'test.deadline', capability: TEST_REF },
        },
      ],
    },
  }
}

function semanticEvents(events: readonly DomainEvent[]) {
  return events.map(({ type, payload, meta }) => ({ type, payload, schedule: meta.schedule }))
}

describe('declarative kernel rules', () => {
  it('uses one snapshot, stable priority/id order, exclusive groups, and next-queue emission', () => {
    const registry = createCapabilityRegistry([capability()])
    const runtime = createKernelRuntime(ir(rules()), registry, dependencies())
    const result = dispatchCommand(runtime, startSession(runtime), { type: 'test.fire' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.events.map(({ type }) => type)).toEqual([
      'test.fired',
      'kernel.rule.effects-applied',
      'test.deadline',
      'test.follow',
    ])
    expect(result.events.some(({ type }) => type === 'test.should-not-fire')).toBe(false)
    expect(result.session.state.slots).toMatchObject({ score: 5, marker: true, choice: 'high' })
    expect(result.session.state.clocks.caseTimeMs).toBe(10)
    expect(result.session.state.schedules['case-deadline']?.status).toBe('fired')
    expect(result.session.state.firedRuleIds).toEqual(['a-high-exclusive'])
    expect(result.session.state.capabilityState[capabilityKey(TEST_REF)]).toEqual({ deadlineCount: 1 })
  })

  it('is independent of rule source order', () => {
    const registry = createCapabilityRegistry([capability()])
    const firstRuntime = createKernelRuntime(ir(rules()), registry, dependencies())
    const secondRuntime = createKernelRuntime(ir([...rules()].reverse()), registry, dependencies())
    const first = dispatchCommand(firstRuntime, startSession(firstRuntime), { type: 'test.fire' })
    const second = dispatchCommand(secondRuntime, startSession(secondRuntime), { type: 'test.fire' })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(semanticEvents(first.events)).toEqual(semanticEvents(second.events))
    expect(first.session.state.slots).toEqual(second.session.state.slots)
  })

  it('rejects conflicting writes atomically', () => {
    const conflicting: RulePlan[] = [
      {
        id: 'a',
        on: 'test.fired',
        effects: [{ type: 'state.write', path: 'score', value: 1 }],
      },
      {
        id: 'b',
        on: 'test.fired',
        effects: [{ type: 'state.write', path: 'score', value: 2 }],
      },
    ]
    const registry = createCapabilityRegistry([capability()])
    const runtime = createKernelRuntime(ir(conflicting), registry, dependencies())
    const initial = startSession(runtime)
    const result = dispatchCommand(runtime, initial, { type: 'test.fire' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('rule-conflict')
    expect(result.session).toBe(initial)
    expect(initial.state.slots.score).toBe(0)
  })

  it('increments schedule generations and delivers newly due shifted schedules', () => {
    const shifting: RulePlan[] = [
      {
        id: 'shift-now',
        on: 'test.fired',
        effects: [{ type: 'schedule.shift', scheduleId: 'case-deadline', byMs: -8 }],
      },
    ]
    const registry = createCapabilityRegistry([capability()])
    const runtime = createKernelRuntime(ir(shifting), registry, dependencies())
    const result = dispatchCommand(runtime, startSession(runtime), { type: 'test.fire' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const delivery = result.events.find(({ type }) => type === 'test.deadline')
    expect(delivery?.meta.schedule).toEqual({ id: 'case-deadline', generation: 2 })
    expect(result.session.state.schedules['case-deadline']).toMatchObject({
      status: 'fired',
      generation: 2,
      deliveredGeneration: 2,
    })
  })

  it('treats cancellation of an already completed schedule as an idempotent no-op', () => {
    const releaseRule: RulePlan[] = [
      {
        id: 'release-after-deadline',
        on: 'test.fired',
        effects: [
          { type: 'schedule.cancel', scheduleId: 'case-deadline' },
          { type: 'state.write', path: 'released', value: true },
        ],
      },
    ]
    const registry = createCapabilityRegistry([capability()])
    const runtime = createKernelRuntime(ir(releaseRule), registry, dependencies())
    const advanced = dispatchCommand(runtime, startSession(runtime), {
      type: KERNEL_COMMANDS.advanceCaseTime,
      payload: { byMs: 8 },
    })
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.session.state.schedules['case-deadline']?.status).toBe('fired')

    const released = dispatchCommand(runtime, advanced.session, { type: 'test.fire' })
    expect(released.ok).toBe(true)
    if (!released.ok) return
    expect(released.session.state.slots.released).toBe(true)
    expect(released.session.state.schedules['case-deadline']?.status).toBe('fired')
  })
})
