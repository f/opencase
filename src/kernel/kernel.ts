import { KERNEL_COMMANDS, KERNEL_EVENTS, reduceCoreEvent } from './core'
import { assertJsonValue, cloneFrozen, compareCodeUnits, deepFreeze } from './freeze'
import { resolveCapability, resolveCommandDecider } from './registry'
import { planRuleReaction, RuleConflictError } from './rules'
import { collectDueScheduleEvents } from './schedules'
import {
  KERNEL_CAPABILITY,
  capabilityKey,
  type CapabilityDefinition,
  type CommandDecision,
  type DispatchFailure,
  type DispatchResult,
  type DomainEvent,
  type DomainEventDraft,
  type KernelCommand,
  type KernelRuntime,
  type KernelSession,
  type KernelState,
  type NormalizedKernelCommand,
} from './types'

const MAX_EVENTS_PER_DISPATCH = 512
const EMPTY_EVENTS = deepFreeze([]) as readonly []

interface ReductionResult {
  readonly state: KernelState
  readonly applied: boolean
}

interface PendingDraft {
  readonly draft: DomainEventDraft
  readonly defaultCapability: CapabilityDefinition
}

export function emptyKernelState(): KernelState {
  return cloneFrozen({
    status: 'empty',
    revision: 0,
    sequence: 0,
    capabilityLocks: [],
    clocks: { caseTimeMs: 0, activeTimeMs: 0, wallTimeMs: 0 },
    assertions: { contexts: {} },
    schedules: {},
    capabilityState: {},
    slots: {},
    firedRuleIds: [],
    appliedCommandIds: [],
  }) as KernelState
}

export function emptyKernelSession(): KernelSession {
  return deepFreeze({ state: emptyKernelState(), eventLog: [] }) as KernelSession
}

function failure(session: KernelSession, code: string, message: string): DispatchFailure {
  return deepFreeze({
    ok: false,
    session,
    events: EMPTY_EVENTS,
    error: { code, message },
  }) as DispatchFailure
}

function isLocked(state: KernelState, capability: CapabilityDefinition): boolean {
  if (state.status === 'empty') return capabilityKey(capability) === capabilityKey(KERNEL_CAPABILITY)
  return state.capabilityLocks.some((lock) => capabilityKey(lock) === capabilityKey(capability))
}

function scheduleGuard(state: KernelState, event: DomainEvent): KernelState | undefined {
  const token = event.meta.schedule
  if (!token) return state
  const schedule = state.schedules[token.id]
  if (!schedule || schedule.status !== 'scheduled' || schedule.generation !== token.generation) {
    return undefined
  }
  const now =
    schedule.clock === 'case'
      ? state.clocks.caseTimeMs
      : schedule.clock === 'active'
        ? state.clocks.activeTimeMs
        : state.clocks.wallTimeMs
  if (now < schedule.dueAtMs) return undefined
  return {
    ...state,
    schedules: {
      ...state.schedules,
      [schedule.id]: {
        ...schedule,
        status: 'fired',
        deliveredGeneration: token.generation,
      },
    },
  }
}

function finalizeReduction(state: KernelState, event: DomainEvent): KernelState {
  return cloneFrozen({
    ...state,
    revision: state.revision + 1,
    sequence: event.meta.sequence,
    appliedCommandIds: [...new Set([...state.appliedCommandIds, event.meta.commandId])].sort(compareCodeUnits),
  }) as KernelState
}

/**
 * Pure reducer used by both live dispatch and replay. It never invokes a
 * command decider or evaluates a rule.
 */
export function reduceDomainEvent(
  runtime: KernelRuntime,
  state: KernelState,
  event: DomainEvent,
): ReductionResult {
  if (event.meta.sequence !== state.sequence + 1) {
    throw new Error(`Expected event sequence ${state.sequence + 1}, received ${event.meta.sequence}`)
  }
  const capability = resolveCapability(runtime.registry, event.meta.capability)
  if (!isLocked(state, capability) && event.type !== KERNEL_EVENTS.initialized) {
    throw new Error(`Event uses unlocked capability ${capabilityKey(capability)}`)
  }

  const guarded = scheduleGuard(state, event)
  if (!guarded) return { state: finalizeReduction(state, event), applied: false }

  let next = reduceCoreEvent(guarded, event, runtime.caseIR)
  const reducer = capability.reducers?.[event.type]
  if (reducer) {
    const key = capabilityKey(capability)
    const reduced = reducer(next.capabilityState[key], event, runtime.caseIR)
    if (reduced !== undefined) assertJsonValue(reduced, `Capability state returned by ${key}`)
    const capabilityState = { ...next.capabilityState }
    if (reduced === undefined) delete capabilityState[key]
    else capabilityState[key] = structuredClone(reduced)
    next = { ...next, capabilityState }
  }
  return { state: finalizeReduction(next, event), applied: true }
}

function normalizeCommand(runtime: KernelRuntime, command: KernelCommand): NormalizedKernelCommand {
  const payload = structuredClone(command.payload ?? {})
  assertJsonValue(payload, 'Command payload')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Command payload must be an object')
  }
  const id = command.id ?? runtime.dependencies.ids.nextCommandId()
  if (!id || !command.type) throw new Error('Command id and type are required')
  return cloneFrozen({ id, type: command.type, payload }) as NormalizedKernelCommand
}

export interface DecidedCommand {
  readonly command: NormalizedKernelCommand
  readonly capability: CapabilityDefinition
  readonly decision: CommandDecision
  readonly wallNowMs: number
}

/** Exposes the command-decision boundary without reducing or appending events. */
export function decideCommand(
  runtime: KernelRuntime,
  session: KernelSession,
  commandInput: KernelCommand,
): DecidedCommand {
  const command = normalizeCommand(runtime, commandInput)
  if (session.state.appliedCommandIds.includes(command.id)) {
    return {
      command,
      capability: resolveCapability(runtime.registry, KERNEL_CAPABILITY),
      decision: { ok: false, code: 'duplicate-command', message: `Command ${command.id} was already applied.` },
      wallNowMs: session.state.clocks.wallTimeMs,
    }
  }
  const resolved = resolveCommandDecider(runtime, session.state, command.type)
  if (!resolved) {
    return {
      command,
      capability: resolveCapability(runtime.registry, KERNEL_CAPABILITY),
      decision: { ok: false, code: 'unknown-command', message: `No capability accepts ${command.type}.` },
      wallNowMs: session.state.clocks.wallTimeMs,
    }
  }
  const wallNowMs = runtime.dependencies.wallClock.now()
  if (!Number.isFinite(wallNowMs) || wallNowMs < 0) throw new Error('Injected wall clock returned an invalid value')
  const decision = resolved.decide({
    state: session.state,
    command,
    caseIR: runtime.caseIR,
    wallNowMs,
  })
  return deepFreeze({ command, capability: resolved.capability, decision, wallNowMs }) as DecidedCommand
}

function stampEvent(
  runtime: KernelRuntime,
  state: KernelState,
  command: NormalizedKernelCommand,
  pending: PendingDraft,
  usedEventIds: Set<string>,
): DomainEvent {
  if (!pending.draft.type) throw new Error('Domain event type is required')
  const payload = structuredClone(pending.draft.payload ?? {})
  assertJsonValue(payload, `Payload for ${pending.draft.type}`)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Payload for ${pending.draft.type} must be an object`)
  }
  const target = resolveCapability(
    runtime.registry,
    pending.draft.capability ?? pending.defaultCapability,
  )
  if (!isLocked(state, target) && pending.draft.type !== KERNEL_EVENTS.initialized) {
    throw new Error(`Event targets unlocked capability ${capabilityKey(target)}`)
  }
  const id = runtime.dependencies.ids.nextEventId()
  if (!id || usedEventIds.has(id)) throw new Error(`Duplicate or empty event id ${id}`)
  usedEventIds.add(id)
  return cloneFrozen({
    id,
    type: pending.draft.type,
    payload,
    meta: {
      sequence: state.sequence + 1,
      commandId: command.id,
      commandType: command.type,
      capability: { id: target.id, version: target.version, digest: target.digest },
      occurredAt: {
        caseTimeMs: state.clocks.caseTimeMs,
        activeTimeMs: state.clocks.activeTimeMs,
        wallTimeMs: state.clocks.wallTimeMs,
      },
      ...(pending.draft.schedule ? { schedule: pending.draft.schedule } : {}),
    },
  }) as DomainEvent
}

export function dispatchCommand(
  runtime: KernelRuntime,
  session: KernelSession,
  commandInput: KernelCommand,
): DispatchResult {
  if (session.state.status === 'ended') return failure(session, 'case-ended', 'The case has ended.')

  let decided: DecidedCommand
  try {
    decided = decideCommand(runtime, session, commandInput)
  } catch (error) {
    return failure(session, 'decision-error', error instanceof Error ? error.message : 'Command decision failed.')
  }
  if (!decided.decision.ok) {
    return failure(session, decided.decision.code, decided.decision.message)
  }
  if (decided.decision.events.length === 0) {
    return failure(session, 'empty-decision', 'An accepted command must emit at least one event.')
  }

  let state = session.state
  const eventLog = [...session.eventLog]
  const emitted: DomainEvent[] = []
  const usedEventIds = new Set(eventLog.map(({ id }) => id))
  const core = resolveCapability(runtime.registry, KERNEL_CAPABILITY)
  const queue: PendingDraft[] = decided.decision.events.map((draft) => ({
    draft,
    defaultCapability: decided.capability,
  }))

  try {
    while (queue.length > 0) {
      if (emitted.length >= MAX_EVENTS_PER_DISPATCH) throw new Error('Event cascade limit exceeded')
      const pending = queue.shift()
      if (!pending) break
      const event = stampEvent(runtime, state, decided.command, pending, usedEventIds)
      const reduction = reduceDomainEvent(runtime, state, event)
      state = reduction.state
      eventLog.push(event)
      emitted.push(event)
      if (!reduction.applied) continue

      const reaction = planRuleReaction(runtime.caseIR, state, event)
      if (!reaction) continue

      const beforeBatch = state
      const batch = stampEvent(
        runtime,
        state,
        decided.command,
        { draft: reaction.batch, defaultCapability: core },
        usedEventIds,
      )
      const batchReduction = reduceDomainEvent(runtime, state, batch)
      state = batchReduction.state
      eventLog.push(batch)
      emitted.push(batch)

      const advancedCaseClock = state.clocks.caseTimeMs !== beforeBatch.clocks.caseTimeMs
      const shiftedCaseSchedule = Object.values(state.schedules).some((schedule) => {
        const before = beforeBatch.schedules[schedule.id]
        return schedule.clock === 'case' && before?.generation !== schedule.generation
      })
      if (advancedCaseClock || shiftedCaseSchedule) {
        for (const draft of collectDueScheduleEvents(
          state,
          state.clocks.caseTimeMs,
          'case_advance',
        )) {
          queue.push({ draft, defaultCapability: core })
        }
      }
      for (const draft of reaction.emitted) queue.push({ draft, defaultCapability: core })
    }
  } catch (error) {
    const code = error instanceof RuleConflictError ? 'rule-conflict' : 'dispatch-error'
    return failure(session, code, error instanceof Error ? error.message : 'Dispatch failed.')
  }

  const next = deepFreeze({ state, eventLog: deepFreeze(eventLog) }) as KernelSession
  return deepFreeze({ ok: true, session: next, events: deepFreeze(emitted) }) as DispatchResult
}

export function startSession(runtime: KernelRuntime): KernelSession {
  const result = dispatchCommand(runtime, emptyKernelSession(), {
    type: KERNEL_COMMANDS.initialize,
  })
  if (!result.ok) throw new Error(`Kernel initialization failed: ${result.error.message}`)
  return result.session
}

/** Replay invokes reducers only. IDs, clocks, command deciders, and rules are never called. */
export function replayEventLog(
  runtime: KernelRuntime,
  events: readonly DomainEvent[],
): KernelSession {
  let state = emptyKernelState()
  const eventLog: DomainEvent[] = []
  const ids = new Set<string>()
  for (const input of events) {
    const event = cloneFrozen(input) as DomainEvent
    if (ids.has(event.id)) throw new Error(`Duplicate event id ${event.id}`)
    ids.add(event.id)
    state = reduceDomainEvent(runtime, state, event).state
    eventLog.push(event)
  }
  if (state.status === 'empty' || !state.case) throw new Error('Event log does not initialize a case')
  if (
    state.case.id !== runtime.caseIR.id ||
    state.case.version !== runtime.caseIR.version ||
    state.case.digest !== runtime.caseIR.digest
  ) {
    throw new Error('Event log belongs to a different case build')
  }
  return deepFreeze({ state, eventLog: deepFreeze(eventLog) }) as KernelSession
}
