import type {
  DomainEventDraft,
  JsonObject,
  KernelState,
  SchedulePlan,
  ScheduleState,
  ScheduledEvent,
} from './types'
import { KERNEL_CAPABILITY } from './types'
import { compareCodeUnits } from './freeze'

export type ScheduleCollectionReason = 'case_advance' | 'active_advance' | 'resume' | 'wall_tick'

function finiteNonNegative(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} must be a finite non-negative number`)
  }
}

export function validateSchedulePlan(plan: SchedulePlan): void {
  if (!plan.id) throw new Error('Schedule id is required')
  if (plan.clock !== 'case' && plan.clock !== 'active' && plan.clock !== 'wall') {
    throw new Error(`Schedule ${plan.id} has an invalid clock`)
  }
  if (
    plan.deliveryPolicy !== undefined &&
    plan.deliveryPolicy !== 'immediate' &&
    plan.deliveryPolicy !== 'on_resume'
  ) {
    throw new Error(`Schedule ${plan.id} has an invalid delivery policy`)
  }
  if (plan.dueAtMs === undefined === (plan.afterMs === undefined)) {
    throw new Error(`Schedule ${plan.id} must set exactly one of dueAtMs or afterMs`)
  }
  finiteNonNegative(plan.dueAtMs, `Schedule ${plan.id} dueAtMs`)
  finiteNonNegative(plan.afterMs, `Schedule ${plan.id} afterMs`)
  finiteNonNegative(plan.maximumLatenessMs, `Schedule ${plan.id} maximumLatenessMs`)
  if (plan.clock !== 'wall' && plan.deliveryPolicy === 'on_resume') {
    throw new Error(`${plan.clock}-clock schedule ${plan.id} cannot use on_resume delivery`)
  }
  if (!plan.event.type) throw new Error(`Schedule ${plan.id} delivery event type is required`)
}

export function normalizeSchedule(
  plan: SchedulePlan,
  clocks: KernelState['clocks'],
  generation: number,
): ScheduleState {
  validateSchedulePlan(plan)
  const base =
    plan.clock === 'case'
      ? clocks.caseTimeMs
      : plan.clock === 'active'
        ? clocks.activeTimeMs
        : clocks.wallTimeMs
  return {
    id: plan.id,
    clock: plan.clock,
    dueAtMs: plan.dueAtMs ?? base + (plan.afterMs ?? 0),
    deliveryPolicy: plan.deliveryPolicy ?? 'immediate',
    ...(plan.maximumLatenessMs !== undefined
      ? { maximumLatenessMs: plan.maximumLatenessMs }
      : {}),
    event: plan.event,
    ...(plan.missedEvent ? { missedEvent: plan.missedEvent } : {}),
    ...(plan.publicData ? { publicData: plan.publicData } : {}),
    generation,
    status: 'scheduled',
  }
}

function scheduledDraft(
  event: ScheduledEvent,
  schedule: ScheduleState,
  fallbackPayload?: JsonObject,
): DomainEventDraft {
  return {
    type: event.type,
    payload: event.payload ?? fallbackPayload ?? {},
    capability: event.capability,
    schedule: { id: schedule.id, generation: schedule.generation },
  }
}

/**
 * Returns delivery drafts only. The clock-advance/observation event must be
 * reduced before these drafts so their generation and due-time guard passes.
 */
export function collectDueScheduleEvents(
  state: KernelState,
  targetTimeMs: number,
  reason: ScheduleCollectionReason,
): readonly DomainEventDraft[] {
  const clock = reason === 'case_advance' ? 'case' : reason === 'active_advance' ? 'active' : 'wall'
  return Object.values(state.schedules)
    .filter((schedule) => {
      if (schedule.status !== 'scheduled' || schedule.clock !== clock) return false
      if (schedule.dueAtMs > targetTimeMs) return false
      return true
    })
    .sort((left, right) => left.dueAtMs - right.dueAtMs || compareCodeUnits(left.id, right.id))
    .map((schedule) => {
      const latenessMs = Math.max(0, targetTimeMs - schedule.dueAtMs)
      if (
        schedule.maximumLatenessMs !== undefined &&
        latenessMs > schedule.maximumLatenessMs
      ) {
        if (schedule.missedEvent) return scheduledDraft(schedule.missedEvent, schedule)
        return scheduledDraft(
          {
            type: 'kernel.schedule.missed',
            capability: KERNEL_CAPABILITY,
          },
          schedule,
          {
            scheduleId: schedule.id,
            generation: schedule.generation,
            dueAtMs: schedule.dueAtMs,
            observedAtMs: targetTimeMs,
            latenessMs,
          },
        )
      }
      return scheduledDraft(schedule.event, schedule)
    })
}
