import { describe, expect, it } from 'vitest'
import {
  ASSERTION_CONTEXTS,
  KERNEL_CAPABILITY,
  KERNEL_COMMANDS,
  accept,
  capabilityKey,
  createCapabilityRegistry,
  createKernelRuntime,
  dispatchCommand,
  projectPublicState,
  queryAssertions,
  replayEventLog,
  startSession,
  type AssertionDraft,
  type CapabilityDefinition,
  type CapabilityRef,
  type CaseKernelIR,
  type JsonObject,
  type JsonValue,
  type KernelDependencies,
} from './index'

const COUNTER_REF: CapabilityRef = {
  id: 'counter',
  version: '1',
  digest: 'sha256:counter-v1',
}

function numericState(state: JsonValue | undefined): number {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 0
  const value = state.value
  return typeof value === 'number' ? value : 0
}

function counterCapability(decisions?: { count: number }): CapabilityDefinition {
  return {
    ...COUNTER_REF,
    commands: {
      'counter.add': ({ command }) => {
        if (decisions) decisions.count += 1
        const by = command.payload.by
        if (typeof by !== 'number') return { ok: false, code: 'invalid', message: 'by is required' }
        return accept({ type: 'counter.added', payload: { by } })
      },
    },
    reducers: {
      'counter.added': (state, event) => ({ value: numericState(state) + Number(event.payload.by) }),
    },
  }
}

interface TestEnvironment {
  readonly dependencies: KernelDependencies
  readonly calls: { commandIds: number; eventIds: number; wall: number }
  setWall(value: number): void
}

function environment(initialWall = 10_000): TestEnvironment {
  let wall = initialWall
  const calls = { commandIds: 0, eventIds: 0, wall: 0 }
  return {
    calls,
    setWall(value) {
      wall = value
    },
    dependencies: {
      ids: {
        nextCommandId() {
          calls.commandIds += 1
          return `command:${calls.commandIds}`
        },
        nextEventId() {
          calls.eventIds += 1
          return `event:${calls.eventIds}`
        },
      },
      wallClock: {
        now() {
          calls.wall += 1
          return wall
        },
      },
    },
  }
}

function caseIR(overrides: Partial<CaseKernelIR> = {}): CaseKernelIR {
  return {
    schemaVersion: 'case-ir@1',
    id: 'case.kernel-test',
    version: '1.0.0',
    digest: 'sha256:case-v1',
    capabilities: [COUNTER_REF],
    types: [{ id: 'actor' }],
    entities: [{ id: 'actor_a', typeId: 'actor' }, { id: 'actor_b', typeId: 'actor' }],
    relations: [
      { id: 'case:exit-time', cardinality: 'one_per_context' },
      { id: 'case:responsible-party', cardinality: 'one_per_context' },
    ],
    contexts: [
      { id: 'source:badge-reader', kind: 'source' },
      { id: 'perspective:actor_c', kind: 'perspective' },
    ],
    initial: {
      caseTimeMs: 0,
      capabilityState: { [capabilityKey(COUNTER_REF)]: { value: 0 } },
      slots: { score: 0, marker: false },
    },
    ...overrides,
  }
}

function mustDispatch(
  runtime: ReturnType<typeof createKernelRuntime>,
  session: ReturnType<typeof startSession>,
  command: Parameters<typeof dispatchCommand>[2],
) {
  const result = dispatchCommand(runtime, session, command)
  expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result
}

function assertion(
  id: string,
  polarity: 'affirm' | 'deny',
  visibility: 'public' | 'hidden' = 'public',
): AssertionDraft {
  return {
    id,
    relation: 'case:exit-time',
    key: { actor: 'actor_a' },
    value: '20:57',
    polarity,
    visibility,
    validity: { at: '2026-08-15T20:57:00+03:00' },
  }
}

describe('event-sourced kernel', () => {
  it('uses injected IDs/clocks, freezes results deeply, and replays reducers only', () => {
    const decisions = { count: 0 }
    const env = environment()
    const registry = createCapabilityRegistry([counterCapability(decisions)])
    const runtime = createKernelRuntime(caseIR(), registry, env.dependencies)
    const initial = startSession(runtime)
    const input: JsonObject = { by: 3, nested: { mutable: true } }
    const result = mustDispatch(runtime, initial, { type: 'counter.add', payload: input })

    input.by = 99
    ;(input.nested as JsonObject).mutable = false
    expect(result.events[0]?.payload).toEqual({ by: 3 })
    expect(result.events[0]?.meta.capability).toEqual(COUNTER_REF)
    expect(result.events[0]?.meta.occurredAt.wallTimeMs).toBe(10_000)
    expect(result.session.state.capabilityState[capabilityKey(COUNTER_REF)]).toEqual({ value: 3 })
    expect(Object.isFrozen(result.session.state)).toBe(true)
    expect(Object.isFrozen(result.session.state.capabilityState)).toBe(true)
    expect(Object.isFrozen(result.events[0]?.payload)).toBe(true)
    expect(() => {
      ;(result.session.state.slots as { score: number }).score = 100
    }).toThrow(TypeError)
    expect(initial.state.revision).toBe(1)

    const callsBeforeReplay = { ...env.calls }
    const decisionsBeforeReplay = decisions.count
    const replayed = replayEventLog(runtime, result.session.eventLog)
    expect(replayed.state).toEqual(result.session.state)
    expect(replayed.eventLog).toEqual(result.session.eventLog)
    expect(env.calls).toEqual(callsBeforeReplay)
    expect(decisions.count).toBe(decisionsBeforeReplay)
  })

  it('keeps assertion contexts separate and treats absence as unknown', () => {
    const env = environment()
    const observedAffirm = assertion('observed-affirm', 'affirm')
    const observedDeny = assertion('observed-deny', 'deny')
    const hiddenObserved = assertion('hidden-observation', 'affirm', 'hidden')
    const registry = createCapabilityRegistry([counterCapability()])
    const runtime = createKernelRuntime(
      caseIR({
        initial: {
          assertions: {
            contexts: {
              [ASSERTION_CONTEXTS.WORLD]: [assertion('world-truth', 'affirm')],
              [ASSERTION_CONTEXTS.PLAYER_OBSERVED]: [observedAffirm, observedDeny, hiddenObserved],
              'source:badge-reader': [assertion('badge-reader-source', 'affirm')],
              'perspective:actor_c': [assertion('actor-c-denial', 'deny')],
            },
          },
        },
      }),
      registry,
      env.dependencies,
    )
    let session = startSession(runtime)

    expect(
      queryAssertions(session.state, {
        contextId: ASSERTION_CONTEXTS.PLAYER_OBSERVED,
        relation: 'case:missing-relation',
      }).status,
    ).toBe('unknown')
    expect(
      queryAssertions(session.state, {
        contextId: ASSERTION_CONTEXTS.WORLD,
        relation: 'case:exit-time',
        key: { actor: 'actor_a' },
        value: '20:57',
      }).status,
    ).toBe('affirmed')
    expect(
      queryAssertions(session.state, {
        contextId: ASSERTION_CONTEXTS.PLAYER_OBSERVED,
        relation: 'case:exit-time',
        key: { actor: 'actor_a' },
        value: '20:57',
      }).status,
    ).toBe('conflicted')
    expect(
      queryAssertions(session.state, {
        contextId: 'perspective:actor_c',
        relation: 'case:exit-time',
        value: '20:57',
      }).status,
    ).toBe('denied')

    const recorded = mustDispatch(runtime, session, {
      type: KERNEL_COMMANDS.recordAssertion,
      payload: {
        contextId: ASSERTION_CONTEXTS.PLAYER_HYPOTHESIZED,
        assertion: {
          id: 'player-theory',
          relation: 'case:responsible-party',
          key: {},
          value: 'actor_b',
          polarity: 'affirm',
          validity: { at: 'case:21:11' },
        },
      },
    })
    session = recorded.session
    const theory = session.state.assertions.contexts[ASSERTION_CONTEXTS.PLAYER_HYPOTHESIZED]
      ?.find(({ id }) => id === 'player-theory')
    expect(theory?.validity).toEqual({ at: 'case:21:11' })
    expect(theory?.assertedAt).toEqual(recorded.events[0]?.meta.occurredAt)

    const projection = projectPublicState(session.state) as unknown as Record<string, unknown>
    expect(projection).not.toHaveProperty('world')
    expect(projection).not.toHaveProperty('perspectives')
    expect(projection).not.toHaveProperty('capabilityState')
    expect(projection).not.toHaveProperty('slots')
    const publicAssertions = projection.assertions as { observed: Array<{ id: string }> }
    expect(publicAssertions.observed.map(({ id }) => id)).not.toContain('hidden-observation')
    expect(JSON.stringify(projection)).not.toContain('badge-reader-source')
  })

  it('validates relation IDs and one-per-context affirmed values', () => {
    const env = environment()
    const registry = createCapabilityRegistry([counterCapability()])
    expect(() =>
      createKernelRuntime(
        caseIR({
          initial: {
            assertions: {
              contexts: {
                [ASSERTION_CONTEXTS.WORLD]: [
                  { ...assertion('unknown-relation', 'affirm'), relation: 'case:unknown' },
                ],
              },
            },
          },
        }),
        registry,
        env.dependencies,
      ),
    ).toThrow(/unknown relation/i)

    const runtime = createKernelRuntime(
      caseIR({
        initial: {
          assertions: {
            contexts: { [ASSERTION_CONTEXTS.PLAYER_OBSERVED]: [assertion('first-time', 'affirm')] },
          },
        },
      }),
      registry,
      env.dependencies,
    )
    const initial = startSession(runtime)
    const conflict = dispatchCommand(runtime, initial, {
      type: KERNEL_COMMANDS.recordAssertion,
      payload: {
        contextId: ASSERTION_CONTEXTS.PLAYER_OBSERVED,
        assertion: { ...assertion('second-time', 'affirm'), value: '21:04' },
      },
    })
    expect(conflict.ok).toBe(false)
    expect(conflict.session).toBe(initial)
    if (!conflict.ok) expect(conflict.error.message).toMatch(/one_per_context/i)
  })

  it('pins exact capability versions and digests', () => {
    const env = environment()
    const registry = createCapabilityRegistry([
      counterCapability(),
      {
        id: 'counter',
        version: '2',
        digest: 'sha256:counter-v2',
        commands: { 'counter.add-v2': () => accept({ type: 'counter.v2' }) },
      },
    ])
    expect(() =>
      createKernelRuntime(
        caseIR({
          capabilities: [{ ...COUNTER_REF, digest: 'sha256:tampered' }],
        }),
        registry,
        env.dependencies,
      ),
    ).toThrow(/digest mismatch/i)

    const runtime = createKernelRuntime(caseIR(), registry, env.dependencies)
    const result = mustDispatch(runtime, startSession(runtime), {
      type: 'counter.add',
      payload: { by: 1 },
    })
    expect(result.events[0]?.meta.capability).toEqual(COUNTER_REF)
    expect(result.session.state.capabilityLocks).toContainEqual(KERNEL_CAPABILITY)
  })
})
