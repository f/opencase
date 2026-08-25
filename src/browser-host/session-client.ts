import {
  createCaseSessionController,
  deleteCaseSessionFromStorage,
  restoreCaseSessionController,
  restoreCaseSessionControllerFromStorage,
  type CaseSaveStorage,
  type CaseSessionController,
} from '../case-runtime/controller'
import {
  CASE_COMMANDS,
  type CasePresentationCatalog,
  type PublicCaseRuntimeState,
} from '../case-runtime/protocol'
import { createCaseRuntime, type CaseRuntime } from '../case-runtime/session'
import type {
  DemoAssetRequest,
  DemoBrowserIntent,
  DemoCaseSessionRef,
  DemoCommandResponse,
  DemoSessionStatus,
} from '../demo-host-client'
import { KERNEL_COMMANDS, type KernelCommand } from '../kernel'
import type { StaticCaseRuntimeBundle } from './static-bundle'
import type {
  BrowserCaseRuntimeRepository,
  LoadedBrowserCaseRuntime,
} from './runtime-repository'

const DEFAULT_SAVE_ID = 'primary'
const SAVE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const WALL_CLOCK_OBSERVATION_INTERVAL_MS = 5_000

export interface BrowserGameSessionClient {
  status(ref: DemoCaseSessionRef): Promise<DemoSessionStatus>
  start(ref: DemoCaseSessionRef): Promise<DemoSessionStatus>
  command(ref: DemoCaseSessionRef, intent: DemoBrowserIntent): Promise<DemoCommandResponse>
  restart(ref: DemoCaseSessionRef): Promise<DemoSessionStatus>
  assetUrl(
    ref: DemoCaseSessionRef,
    request: DemoAssetRequest,
    snapshot: PublicCaseRuntimeState,
  ): string | undefined
}

export interface CreateBrowserGameSessionClientOptions {
  readonly repository: BrowserCaseRuntimeRepository
  readonly storage: CaseSaveStorage
  readonly now?: () => number
  readonly nextId?: () => string
}

export class BrowserGameSessionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BrowserGameSessionError'
  }
}

interface ResolvedCase {
  readonly loaded: LoadedBrowserCaseRuntime
  readonly runtime: CaseRuntime
}

interface SessionSlot {
  initialized: boolean
  controller?: CaseSessionController
  resolved?: ResolvedCase
  assetSessionId?: string
}

class KeyedSerialQueue {
  readonly #tails = new Map<string, Promise<void>>()

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.#tails.set(key, tail)
    void tail.finally(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key)
    })
    return result
  }
}

function normalizedRef(ref: DemoCaseSessionRef): Required<DemoCaseSessionRef> {
  const saveId = ref.saveId ?? DEFAULT_SAVE_ID
  if (!SAVE_ID.test(saveId)) {
    throw new BrowserGameSessionError(
      'invalid-save-id',
      'saveId must contain only letters, numbers, underscores, or hyphens.',
    )
  }
  for (const [label, value, maximum] of [
    ['caseId', ref.caseId, 256],
    ['caseVersion', ref.caseVersion, 128],
    ['locale', ref.locale, 32],
  ] as const) {
    if (!value || value.length > maximum) {
      throw new BrowserGameSessionError('invalid-session', `${label} is invalid.`)
    }
  }
  return { ...ref, saveId }
}

function slotKey(ref: Required<DemoCaseSessionRef>): string {
  return `${ref.caseId}\u0000${ref.caseVersion}\u0000${ref.saveId}`
}

function presentation(
  bundle: StaticCaseRuntimeBundle,
  requestedLocale: string,
): CasePresentationCatalog {
  const exact = bundle.presentations[requestedLocale]
  if (exact) return exact
  const base = requestedLocale.split('-')[0] ?? ''
  const language = bundle.presentations[base]
  if (language) return language
  const fallback = bundle.presentations[bundle.case.defaultLocale]
  if (!fallback) {
    throw new BrowserGameSessionError(
      'invalid-static-bundle',
      'The static case has no default presentation catalog.',
    )
  }
  return fallback
}

function browserCommand(intent: DemoBrowserIntent): KernelCommand {
  if (intent.kind === 'observe') {
    return {
      type: CASE_COMMANDS.observeEvidence,
      payload: { evidenceId: intent.evidenceId },
    }
  }
  if (intent.kind === 'deduce') {
    return {
      type: CASE_COMMANDS.attemptDeduction,
      payload: { deductionId: intent.deductionId },
    }
  }
  const action: Record<string, string> = { action: intent.action }
  for (const field of [
    'target',
    'actor',
    'from',
    'topic',
    'evidence',
    'tone',
    'query',
    'ref',
  ] as const) {
    const value = intent[field]
    if (value !== undefined) action[field] = value
  }
  return { type: CASE_COMMANDS.performAction, payload: action }
}

function stableAssetSessionId(bundle: StaticCaseRuntimeBundle, saveId: string): string {
  return `static:${bundle.case.kernelDigest}:${saveId}`
}

function defaultNextId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Application-owned host for a fully static build.
 *
 * Private runtime data stays inside this adapter even though its bytes are
 * downloadable. React still receives only public projections and submits
 * intent through the same asynchronous contract as the former local server.
 */
export function createBrowserGameSessionClient(
  options: CreateBrowserGameSessionClientOptions,
): BrowserGameSessionClient {
  const queue = new KeyedSerialQueue()
  const slots = new Map<string, SessionSlot>()
  const runtimes = new Map<string, CaseRuntime>()
  const now = options.now ?? Date.now
  const nextId = options.nextId ?? defaultNextId

  const resolveCase = async (
    ref: Required<DemoCaseSessionRef>,
    slot: SessionSlot,
  ): Promise<ResolvedCase> => {
    if (slot.resolved) return slot.resolved
    let loaded: LoadedBrowserCaseRuntime
    try {
      loaded = await options.repository.loadRuntime(ref.caseId, ref.caseVersion)
    } catch (cause) {
      throw new BrowserGameSessionError(
        'unknown-case',
        'The selected case runtime is not installed in this browser.',
        { cause },
      )
    }
    const { bundle } = loaded
    if (
      bundle.case.id !== ref.caseId ||
      bundle.case.version !== ref.caseVersion ||
      bundle.kernelIr.id !== ref.caseId ||
      bundle.kernelIr.version !== ref.caseVersion ||
      bundle.kernelIr.digest !== bundle.case.kernelDigest
    ) {
      throw new BrowserGameSessionError(
        'invalid-static-bundle',
        'The static case runtime does not match the selected case.',
      )
    }
    let runtime = runtimes.get(bundle.case.kernelDigest)
    if (!runtime) {
      runtime = createCaseRuntime(bundle.kernelIr, {
        ids: { nextCommandId: nextId, nextEventId: nextId },
        wallClock: { now },
      })
      runtimes.set(bundle.case.kernelDigest, runtime)
    }
    const resolved = { loaded, runtime }
    slot.resolved = resolved
    return resolved
  }

  const initialize = async (
    ref: Required<DemoCaseSessionRef>,
    slot: SessionSlot,
  ): Promise<ResolvedCase> => {
    const resolved = await resolveCase(ref, slot)
    if (!slot.initialized) {
      slot.controller = await restoreCaseSessionControllerFromStorage(
        resolved.runtime,
        options.storage,
        ref.saveId,
      )
      slot.initialized = true
      if (slot.controller) {
        slot.assetSessionId = stableAssetSessionId(resolved.loaded.bundle, ref.saveId)
      }
    }
    return resolved
  }

  const refreshWallClock = async (
    ref: Required<DemoCaseSessionRef>,
    slot: SessionSlot,
    resolved: ResolvedCase,
  ): Promise<void> => {
    const controller = slot.controller
    if (!controller) return
    const projected = controller.getSnapshot(presentation(resolved.loaded.bundle, ref.locale))
    if (projected.status === 'ended') return
    const deadlines = projected.deadlines.filter(({ clock, status }) => (
      clock === 'wall' && status === 'scheduled'
    ))
    if (deadlines.length === 0) return
    const observedNow = now()
    if (!Number.isFinite(observedNow) || observedNow < projected.clocks.wallTimeMs) return
    const nextDueAtMs = Math.min(...deadlines.map(({ dueAtMs }) => dueAtMs))
    if (
      observedNow < nextDueAtMs &&
      observedNow - projected.clocks.wallTimeMs < WALL_CLOCK_OBSERVATION_INTERVAL_MS
    ) return
    const candidate = await restoreCaseSessionController(
      resolved.runtime,
      await controller.serialize(),
    )
    const refreshed = candidate.dispatch(
      { type: KERNEL_COMMANDS.resume },
      presentation(resolved.loaded.bundle, ref.locale),
    )
    if (!refreshed.ok) {
      if (refreshed.error.code === 'case-ended') return
      throw new BrowserGameSessionError(
        'wall-clock-refresh-failed',
        'The browser could not refresh the case clock.',
      )
    }
    await candidate.persist(options.storage, ref.saveId)
    slot.controller = candidate
  }

  const sessionStatus = (
    ref: Required<DemoCaseSessionRef>,
    slot: SessionSlot,
    resolved: ResolvedCase,
  ): DemoSessionStatus => {
    const selectedPresentation = presentation(resolved.loaded.bundle, ref.locale)
    return {
      schema: 'detective-demo-session/v1',
      caseId: ref.caseId,
      caseVersion: ref.caseVersion,
      locale: selectedPresentation.locale,
      saveId: ref.saveId,
      exists: slot.controller !== undefined,
      ...(slot.controller ? {
        assetSessionId: slot.assetSessionId,
        snapshot: slot.controller.getSnapshot(selectedPresentation),
      } : {}),
    }
  }

  return Object.freeze({
    async status(inputRef: DemoCaseSessionRef): Promise<DemoSessionStatus> {
      const ref = normalizedRef(inputRef)
      return queue.run(slotKey(ref), async () => {
        const slot = slots.get(slotKey(ref)) ?? { initialized: false }
        slots.set(slotKey(ref), slot)
        const resolved = await initialize(ref, slot)
        await refreshWallClock(ref, slot, resolved)
        return sessionStatus(ref, slot, resolved)
      })
    },

    async start(inputRef: DemoCaseSessionRef): Promise<DemoSessionStatus> {
      const ref = normalizedRef(inputRef)
      return queue.run(slotKey(ref), async () => {
        const slot = slots.get(slotKey(ref)) ?? { initialized: false }
        slots.set(slotKey(ref), slot)
        const resolved = await initialize(ref, slot)
        if (slot.controller) {
          throw new BrowserGameSessionError(
            'session-already-started',
            'This profile already has a save for the case.',
          )
        }
        const candidate = createCaseSessionController(resolved.runtime)
        await candidate.persist(options.storage, ref.saveId)
        slot.controller = candidate
        slot.assetSessionId = stableAssetSessionId(resolved.loaded.bundle, ref.saveId)
        return sessionStatus(ref, slot, resolved)
      })
    },

    async command(
      inputRef: DemoCaseSessionRef,
      intent: DemoBrowserIntent,
    ): Promise<DemoCommandResponse> {
      const ref = normalizedRef(inputRef)
      return queue.run(slotKey(ref), async () => {
        const slot = slots.get(slotKey(ref)) ?? { initialized: false }
        slots.set(slotKey(ref), slot)
        const resolved = await initialize(ref, slot)
        if (!slot.controller) {
          throw new BrowserGameSessionError(
            'session-not-started',
            'Start the case before sending detective commands.',
          )
        }
        await refreshWallClock(ref, slot, resolved)
        const candidate = await restoreCaseSessionController(
          resolved.runtime,
          await slot.controller.serialize(),
        )
        const result = candidate.dispatch(
          browserCommand(intent),
          presentation(resolved.loaded.bundle, ref.locale),
        )
        if (!result.ok) {
          return {
            schema: 'detective-demo-command/v1',
            ok: false,
            snapshot: result.snapshot,
            error: result.error,
          }
        }
        await candidate.persist(options.storage, ref.saveId)
        slot.controller = candidate
        return {
          schema: 'detective-demo-command/v1',
          ok: true,
          snapshot: result.snapshot,
        }
      })
    },

    async restart(inputRef: DemoCaseSessionRef): Promise<DemoSessionStatus> {
      const ref = normalizedRef(inputRef)
      return queue.run(slotKey(ref), async () => {
        const slot = slots.get(slotKey(ref)) ?? { initialized: false }
        const resolved = await resolveCase(ref, slot)
        await deleteCaseSessionFromStorage(resolved.runtime, options.storage, ref.saveId)
        slots.delete(slotKey(ref))
        return {
          schema: 'detective-demo-session/v1',
          caseId: ref.caseId,
          caseVersion: ref.caseVersion,
          locale: presentation(resolved.loaded.bundle, ref.locale).locale,
          saveId: ref.saveId,
          exists: false,
        }
      })
    },

    assetUrl(
      inputRef: DemoCaseSessionRef,
      request: DemoAssetRequest,
      snapshot: PublicCaseRuntimeState,
    ): string | undefined {
      const ref = normalizedRef(inputRef)
      const slot = slots.get(slotKey(ref))
      const bundle = slot?.resolved?.loaded.bundle
      if (
        !slot?.controller ||
        !bundle ||
        request.assetSessionId !== slot.assetSessionId ||
        request.caseDigest !== bundle.case.kernelDigest ||
        snapshot.case.digest !== bundle.case.kernelDigest ||
        snapshot.case.id !== ref.caseId ||
        snapshot.case.version !== ref.caseVersion
      ) return undefined
      const currentSnapshot = slot.controller.getSnapshot(presentation(bundle, ref.locale))
      if (snapshot.revision !== currentSnapshot.revision) return undefined
      const projected = currentSnapshot.evidence
        .flatMap(({ assets }) => assets)
        .find(({ id }) => id === request.assetId)
      if (!projected) return undefined
      const packaged = bundle.assets.find(({ id }) => id === request.assetId)
      if (
        !packaged ||
        packaged.kind !== projected.kind ||
        packaged.mimeType !== projected.mimeType
      ) return undefined
      return slot.resolved?.loaded.assetUrls[request.assetId]
    },
  })
}
