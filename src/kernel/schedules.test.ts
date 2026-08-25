import { describe, expect, it } from 'vitest'
import {
  KERNEL_COMMANDS,
  accept,
  capabilityKey,
  createCapabilityRegistry,
  createKernelRuntime,
  dispatchCommand,
  replayEventLog,
  startSession,
  type CapabilityDefinition,
  type CapabilityRef,
  type CaseKernelIR,
  type JsonObject,
  type JsonValue,
  type KernelSession,
} from './index'

const TIMER_REF: CapabilityRef = {
  id: 'timer-fixture',
  version: '1',
  digest: 'sha256:timer-v1',
}

function count(state: JsonValue | undefined): number {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 0
  return typeof state.count === 'number' ? state.count : 0
}

function capability(): CapabilityDefinition {
  return {
    ...TIMER_REF,
    commands: { 'timer.noop': () => accept({ type: 'timer.noop' }) },
    reducers: {
      'timer.delivered': (state) => ({ count: count(state) + 1 }),
    },
  }
}

function ir(): CaseKernelIR {
  return {
    schemaVersion: 'case-ir@1',
    id: 'case.schedules',
    version: '1',
    digest: 'sha256:schedules',
    capabilities: [TIMER_REF],
    initial: {
      capabilityState: { [capabilityKey(TIMER_REF)]: { count: 0 } },
      schedules: [
        {
          id: 'case-ten',
          clock: 'case',
          afterMs: 10,
          event: { type: 'timer.delivered', capability: TIMER_REF },
        },
        {
          id: 'active-wall',
          clock: 'wall',
          afterMs: 1_000,
          deliveryPolicy: 'on_resume',
          event: { type: 'timer.delivered', capability: TIMER_REF },
        },
        {
          id: 'offline-missed',
          clock: 'wall',
          afterMs: 2_000,
          deliveryPolicy: 'on_resume',
          maximumLatenessMs: 500,
          event: { type: 'timer.delivered', capability: TIMER_REF },
        },
      ],
    },
  }
}

describe('three clocks and generation-safe schedules', () => {
  it('fires case time, active wall ticks, and offline resume deliveries exactly once', () => {
    let wall = 10_000
    let commandId = 0
    let eventId = 0
    const registry = createCapabilityRegistry([capability()])
    const runtime = createKernelRuntime(ir(), registry, {
      ids: {
        nextCommandId: () => `command:${++commandId}`,
        nextEventId: () => `event:${++eventId}`,
      },
      wallClock: { now: () => wall },
    })
    let session = startSession(runtime)

    session = run(runtime, session, KERNEL_COMMANDS.advanceCaseTime, { byMs: 10 })
    expect(session.state.schedules['case-ten']?.status).toBe('fired')

    wall = 11_000
    const active = dispatchCommand(runtime, session, { type: KERNEL_COMMANDS.observeWallTime })
    expect(active.ok).toBe(true)
    if (!active.ok) return
    session = active.session
    expect(active.events.some(({ type }) => type === 'timer.delivered')).toBe(true)
    expect(session.state.schedules['active-wall']?.status).toBe('fired')

    wall = 13_000
    const resumed = dispatchCommand(runtime, session, { type: KERNEL_COMMANDS.resume })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return
    session = resumed.session
    expect(resumed.events.filter(({ type }) => type === 'kernel.schedule.missed')).toHaveLength(1)
    expect(session.state.schedules['offline-missed']?.status).toBe('missed')
    expect(session.state.capabilityState[capabilityKey(TIMER_REF)]).toEqual({ count: 2 })

    wall = 14_000
    const secondResume = dispatchCommand(runtime, session, { type: KERNEL_COMMANDS.resume })
    expect(secondResume.ok).toBe(true)
    if (!secondResume.ok) return
    expect(secondResume.events.some(({ type }) => type === 'kernel.schedule.missed')).toBe(false)
    expect(secondResume.session.state.capabilityState[capabilityKey(TIMER_REF)]).toEqual({ count: 2 })
    expect(replayEventLog(runtime, secondResume.session.eventLog).state).toEqual(secondResume.session.state)
  })

  it('advances active time only through its explicit command', () => {
    let wall = 80_000
    let commandId = 0
    let eventId = 0
    const registry = createCapabilityRegistry([capability()])
    const runtime = createKernelRuntime(
      {
        ...ir(),
        initial: {
          capabilityState: { [capabilityKey(TIMER_REF)]: { count: 0 } },
          schedules: [
            {
              id: 'active-five',
              clock: 'active',
              afterMs: 5,
              event: { type: 'timer.delivered', capability: TIMER_REF },
            },
          ],
        },
      },
      registry,
      {
        ids: {
          nextCommandId: () => `command:${++commandId}`,
          nextEventId: () => `event:${++eventId}`,
        },
        wallClock: { now: () => wall },
      },
    )
    let session = startSession(runtime)
    wall += 60_000
    session = run(runtime, session, KERNEL_COMMANDS.observeWallTime)
    session = run(runtime, session, KERNEL_COMMANDS.advanceCaseTime, { byMs: 20 })
    expect(session.state.clocks).toEqual({ caseTimeMs: 20, activeTimeMs: 0, wallTimeMs: wall })
    expect(session.state.schedules['active-five']?.status).toBe('scheduled')

    session = run(runtime, session, KERNEL_COMMANDS.advanceActiveTime, { byMs: 5 })
    expect(session.state.clocks.activeTimeMs).toBe(5)
    expect(session.state.schedules['active-five']?.status).toBe('fired')
    expect(session.state.capabilityState[capabilityKey(TIMER_REF)]).toEqual({ count: 1 })
  })

  it('rescheduling increments generation and only the newest generation can deliver', () => {
    let wall = 50_000
    let commandId = 0
    let eventId = 0
    const registry = createCapabilityRegistry([capability()])
    const runtime = createKernelRuntime(
      { ...ir(), initial: { capabilityState: { [capabilityKey(TIMER_REF)]: { count: 0 } } } },
      registry,
      {
        ids: {
          nextCommandId: () => `command:${++commandId}`,
          nextEventId: () => `event:${++eventId}`,
        },
        wallClock: { now: () => wall },
      },
    )
    let session = startSession(runtime)
    session = setSchedule(runtime, session, 1_000)
    session = setSchedule(runtime, session, 2_000)
    expect(session.state.schedules.dynamic?.generation).toBe(2)

    wall = 51_500
    session = run(runtime, session, KERNEL_COMMANDS.observeWallTime)
    expect(session.state.schedules.dynamic?.status).toBe('scheduled')

    wall = 52_500
    const delivered = dispatchCommand(runtime, session, { type: KERNEL_COMMANDS.observeWallTime })
    expect(delivered.ok).toBe(true)
    if (!delivered.ok) return
    expect(delivered.events.filter(({ type }) => type === 'timer.delivered')).toHaveLength(1)
    expect(delivered.events.find(({ type }) => type === 'timer.delivered')?.meta.schedule).toEqual({
      id: 'dynamic',
      generation: 2,
    })
  })
})

function run(
  runtime: ReturnType<typeof createKernelRuntime>,
  session: KernelSession,
  type: string,
  payload: JsonObject = {},
): KernelSession {
  const result = dispatchCommand(runtime, session, { type, payload })
  expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.session
}

function setSchedule(
  runtime: ReturnType<typeof createKernelRuntime>,
  session: KernelSession,
  afterMs: number,
): KernelSession {
  return run(runtime, session, KERNEL_COMMANDS.setSchedule, {
    plan: {
      id: 'dynamic',
      clock: 'wall',
      afterMs,
      deliveryPolicy: 'immediate',
      event: {
        type: 'timer.delivered',
        capability: {
          id: TIMER_REF.id,
          version: TIMER_REF.version,
          digest: TIMER_REF.digest,
        },
      },
    },
  })
}
