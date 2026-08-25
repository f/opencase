import {
  KERNEL_COMMANDS,
  createCapabilityRegistry,
  createKernelRuntime,
  deepFreeze,
  dispatchCommand,
  replayEventLog,
  startSession,
  type CaseKernelIR,
  type DispatchResult,
  type DomainEvent,
  type KernelCommand,
  type KernelDependencies,
  type JsonObject,
  type KernelRuntime,
  type KernelSession,
} from '../kernel'

import { CASE_COMMANDS, type CaseAction } from './protocol'
import {
  assertTrustedCapabilityLocks,
  trustedCapabilityDefinitions,
} from './trusted-capabilities'
import { projectCaseState } from './projection'

export interface CaseRuntime {
  readonly kernel: KernelRuntime
}

export function createCaseRuntime(
  caseIR: CaseKernelIR,
  dependencies: KernelDependencies,
): CaseRuntime {
  assertTrustedCapabilityLocks(caseIR.capabilities)
  const registry = createCapabilityRegistry(trustedCapabilityDefinitions())
  return Object.freeze({ kernel: createKernelRuntime(caseIR, registry, dependencies) })
}

export function startCase(runtime: CaseRuntime): KernelSession {
  return startSession(runtime.kernel)
}

export function dispatchCaseCommand(
  runtime: CaseRuntime,
  session: KernelSession,
  command: KernelCommand,
): DispatchResult {
  // An authored outcome closes the investigation even though the generic
  // kernel itself has no knowledge of case outcomes. Keep this guard at the
  // authoritative case-runtime boundary so controllers, helpers, and the
  // deterministic simulator all enforce the same terminal state.
  if (projectCaseState(session).status === 'ended') {
    return deepFreeze({
      ok: false,
      session,
      events: [] as const,
      error: {
        code: 'case-ended',
        message: 'The case has ended.',
      },
    }) as DispatchResult
  }
  return dispatchCommand(runtime.kernel, session, command)
}

export function observeEvidence(
  runtime: CaseRuntime,
  session: KernelSession,
  evidenceId: string,
  id?: string,
): DispatchResult {
  return dispatchCaseCommand(runtime, session, {
    id,
    type: CASE_COMMANDS.observeEvidence,
    payload: { evidenceId },
  })
}

export function performAction(
  runtime: CaseRuntime,
  session: KernelSession,
  action: CaseAction,
  id?: string,
): DispatchResult {
  return dispatchCaseCommand(runtime, session, {
    id,
    type: CASE_COMMANDS.performAction,
    payload: action as unknown as JsonObject,
  })
}

export function attemptDeduction(
  runtime: CaseRuntime,
  session: KernelSession,
  deductionId: string,
  id?: string,
): DispatchResult {
  return dispatchCaseCommand(runtime, session, {
    id,
    type: CASE_COMMANDS.attemptDeduction,
    payload: { deductionId },
  })
}

export function advanceCaseTime(
  runtime: CaseRuntime,
  session: KernelSession,
  byMs: number,
  id?: string,
): DispatchResult {
  return dispatchCaseCommand(runtime, session, {
    id,
    type: KERNEL_COMMANDS.advanceCaseTime,
    payload: { byMs },
  })
}

export function advanceActiveTime(
  runtime: CaseRuntime,
  session: KernelSession,
  byMs: number,
  id?: string,
): DispatchResult {
  return dispatchCaseCommand(runtime, session, {
    id,
    type: KERNEL_COMMANDS.advanceActiveTime,
    payload: { byMs },
  })
}

export function observeWallTime(
  runtime: CaseRuntime,
  session: KernelSession,
  id?: string,
): DispatchResult {
  return dispatchCaseCommand(runtime, session, {
    id,
    type: KERNEL_COMMANDS.observeWallTime,
  })
}

export function resumeCase(
  runtime: CaseRuntime,
  session: KernelSession,
  id?: string,
): DispatchResult {
  return dispatchCaseCommand(runtime, session, {
    id,
    type: KERNEL_COMMANDS.resume,
  })
}

export function replayCase(runtime: CaseRuntime, events: readonly DomainEvent[]): KernelSession {
  return replayEventLog(runtime.kernel, events)
}
