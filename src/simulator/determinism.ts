import type { KernelDependencies } from '../kernel'

import type { MutableSimulatorClock } from './types'

export class DeterministicWallClock implements MutableSimulatorClock {
  constructor(private value: number) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Initial wall time must be non-negative.')
  }

  now(): number {
    return this.value
  }

  advance(byMs: number): void {
    if (!Number.isFinite(byMs) || byMs < 0) throw new Error('Wall-clock advance must be non-negative.')
    this.value += byMs
  }
}

export function deterministicDependencies(
  wallClock: MutableSimulatorClock,
  namespace = 'sim',
): KernelDependencies {
  let command = 0
  let event = 0
  return {
    wallClock,
    ids: {
      nextCommandId: () => `${namespace}:command:${String(++command).padStart(4, '0')}`,
      nextEventId: () => `${namespace}:event:${String(++event).padStart(6, '0')}`,
    },
  }
}
