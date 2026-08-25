import { cloneFrozen } from './freeze'
import type { CommandDecision, DomainEventDraft } from './types'

export function accept(...events: DomainEventDraft[]): CommandDecision {
  if (events.length === 0) return reject('empty-decision', 'An accepted command must emit at least one event.')
  return cloneFrozen({ ok: true, events }) as CommandDecision
}

export function reject(code: string, message: string): CommandDecision {
  return cloneFrozen({ ok: false, code, message }) as CommandDecision
}

