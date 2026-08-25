import { cloneFrozen, compareCodeUnits } from './freeze'
import { ASSERTION_CONTEXTS, type Assertion, type KernelState, type PublicKernelState } from './types'

function visible(assertion: Assertion): boolean {
  return assertion.visibility !== 'hidden'
}

/**
 * The only state shape intended for untrusted/UI consumers. It deliberately
 * excludes world truth, NPC perspectives, capability state, command IDs, and
 * schedule delivery payloads.
 */
export function projectPublicState(state: KernelState): PublicKernelState {
  if (!state.case || state.status === 'empty') throw new Error('Cannot project an uninitialized session')
  return cloneFrozen({
    status: state.status,
    revision: state.revision,
    case: state.case,
    clocks: state.clocks,
    assertions: {
      observed: (state.assertions.contexts[ASSERTION_CONTEXTS.PLAYER_OBSERVED] ?? []).filter(visible),
      hypotheses: (state.assertions.contexts[ASSERTION_CONTEXTS.PLAYER_HYPOTHESIZED] ?? []).filter(visible),
    },
    schedules: Object.values(state.schedules)
      .map((schedule) => ({
        id: schedule.id,
        clock: schedule.clock,
        dueAtMs: schedule.dueAtMs,
        status: schedule.status,
        generation: schedule.generation,
        ...(schedule.publicData ? { publicData: schedule.publicData } : {}),
      }))
      .sort((left, right) => left.dueAtMs - right.dueAtMs || compareCodeUnits(left.id, right.id)),
  }) as PublicKernelState
}
