import { randomUUID } from 'node:crypto'

import {
  CASE_COMMANDS,
  createCaseSessionController,
  deleteCaseSessionFromStorage,
  restoreCaseSessionController,
  restoreCaseSessionControllerFromStorage,
  type CaseSaveStorage,
  type CaseSessionController,
  type PublicCaseCommandResult,
} from '../../src/case-runtime'
import {
  createCaseAssetGateway,
  type AssetAuthorizationContext,
  type CaseAssetGateway,
  type VerifiedAssetFile,
} from '../../src/case-package'
import { CasePackageError } from '../../src/case-package/types'
import { KERNEL_COMMANDS, type KernelCommand } from '../../src/kernel'
import {
  PRIMARY_DEMO_SAVE_ID,
  type DemoAssetRequest,
  type DemoBrowserIntent,
  type DemoCaseSessionRef,
  type DemoCommandResponse,
  type DemoSessionStatus,
} from '../../src/demo-host-client'

import {
  DemoCaseRegistryError,
  type DemoCaseRegistry,
  type TrustedDemoCase,
} from './registry'

type UnknownRecord = Record<string, unknown>

const WALL_CLOCK_OBSERVATION_INTERVAL_MS = 5_000
const SAVE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i

interface SessionSlot {
  controller?: CaseSessionController
  /** Host-owned run identity. Restarting the case destroys this capability. */
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

export class DemoHostRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'DemoHostRequestError'
  }
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DemoHostRequestError('invalid-request', `${label} must be an object.`, 400)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DemoHostRequestError('invalid-request', `${label} must be a plain object.`, 400)
  }
  return value as UnknownRecord
}

function exactKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const accepted = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) {
      throw new DemoHostRequestError(
        'invalid-request',
        `${label} contains unsupported field '${key}'.`,
        400,
      )
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new DemoHostRequestError(
        'invalid-request',
        `${label} is missing required field '${key}'.`,
        400,
      )
    }
  }
}

function string(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new DemoHostRequestError(
      'invalid-request',
      `${label} must be a non-empty string no longer than ${maximum} characters.`,
      400,
    )
  }
  return value
}

export function parseDemoSessionRef(value: unknown): Required<DemoCaseSessionRef> {
  const input = record(value, 'session reference')
  exactKeys(
    input,
    ['caseId', 'caseVersion', 'locale', 'saveId'],
    ['caseId', 'caseVersion', 'locale'],
    'session reference',
  )
  const saveId = string(input.saveId ?? PRIMARY_DEMO_SAVE_ID, 'saveId', 64)
  if (!SAVE_ID.test(saveId)) {
    throw new DemoHostRequestError(
      'invalid-save-id',
      'saveId must contain only letters, numbers, underscores, or hyphens.',
      400,
    )
  }
  return {
    caseId: string(input.caseId, 'caseId', 256),
    caseVersion: string(input.caseVersion, 'caseVersion', 128),
    locale: string(input.locale, 'locale', 32),
    saveId,
  }
}

export function parseDemoBrowserIntent(value: unknown): DemoBrowserIntent {
  const input = record(value, 'intent')
  const kind = string(input.kind, 'intent.kind', 32)
  if (kind === 'observe') {
    exactKeys(input, ['kind', 'evidenceId'], ['kind', 'evidenceId'], 'observe intent')
    return { kind, evidenceId: string(input.evidenceId, 'intent.evidenceId', 256) }
  }
  if (kind === 'deduce') {
    exactKeys(input, ['kind', 'deductionId'], ['kind', 'deductionId'], 'deduce intent')
    return { kind, deductionId: string(input.deductionId, 'intent.deductionId', 256) }
  }
  if (kind !== 'action') {
    throw new DemoHostRequestError('unsupported-intent', 'Unsupported browser intent.', 400)
  }
  const fields = [
    'target',
    'actor',
    'from',
    'topic',
    'evidence',
    'tone',
    'query',
    'ref',
  ] as const
  exactKeys(input, ['kind', 'action', ...fields], ['kind', 'action'], 'action intent')
  return {
    kind,
    action: string(input.action, 'intent.action', 256),
    ...Object.fromEntries(
      fields
        .filter((field) => input[field] !== undefined)
        .map((field) => [field, string(input[field], `intent.${field}`)]),
    ),
  } as DemoBrowserIntent
}

export function parseDemoAssetRequest(value: unknown): DemoAssetRequest {
  const input = record(value, 'asset request')
  exactKeys(
    input,
    ['assetSessionId', 'caseDigest', 'assetId'],
    ['assetSessionId', 'caseDigest', 'assetId'],
    'asset request',
  )
  return {
    assetSessionId: string(input.assetSessionId, 'assetSessionId', 256),
    caseDigest: string(input.caseDigest, 'caseDigest', 256),
    assetId: string(input.assetId, 'assetId', 256),
  }
}

function slotKey(ref: Required<DemoCaseSessionRef>): string {
  return `${ref.caseId}\u0000${ref.caseVersion}\u0000${ref.saveId}`
}

function toCommand(intent: DemoBrowserIntent): KernelCommand {
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

function status(
  trustedCase: TrustedDemoCase,
  ref: Required<DemoCaseSessionRef>,
  slot: SessionSlot,
): DemoSessionStatus {
  const controller = slot.controller
  const presentation = trustedCase.presentation(ref.locale)
  return {
    schema: 'detective-demo-session/v1',
    caseId: ref.caseId,
    caseVersion: ref.caseVersion,
    locale: presentation.locale,
    saveId: ref.saveId,
    exists: controller !== undefined,
    ...(controller ? {
      assetSessionId: slot.assetSessionId,
      snapshot: controller.getSnapshot(presentation),
    } : {}),
  }
}

export interface DemoSessionService {
  status(ref: DemoCaseSessionRef): Promise<DemoSessionStatus>
  start(ref: DemoCaseSessionRef): Promise<DemoSessionStatus>
  command(ref: DemoCaseSessionRef, intent: DemoBrowserIntent): Promise<DemoCommandResponse>
  asset(
    ref: DemoCaseSessionRef,
    request: DemoAssetRequest,
    signal?: AbortSignal,
  ): Promise<VerifiedAssetFile>
  restart(ref: DemoCaseSessionRef): Promise<DemoSessionStatus>
}

export interface CreateDemoSessionServiceOptions {
  readonly registry: DemoCaseRegistry
  readonly storage: CaseSaveStorage
  /** Required only when the local demo delivers projected case assets. */
  readonly assetCacheDirectory?: string
  readonly nextAssetSessionId?: () => string
  readonly nextAssetAuthorizationGrant?: () => string
  /** Test/trusted-host injection point; production uses the hardened gateway. */
  readonly createAssetGateway?: typeof createCaseAssetGateway
}

export function createDemoSessionService(
  options: CreateDemoSessionServiceOptions,
): DemoSessionService {
  const slots = new Map<string, SessionSlot>()
  const queue = new KeyedSerialQueue()
  const nextAssetSessionId = options.nextAssetSessionId ?? randomUUID
  const nextAssetAuthorizationGrant = options.nextAssetAuthorizationGrant ?? randomUUID
  const assetAuthorizations = new Map<string, AssetAuthorizationContext>()
  const assetGateways = new Map<string, CaseAssetGateway>()
  const createAssetGateway = options.createAssetGateway ?? createCaseAssetGateway

  const resolveCase = (ref: Required<DemoCaseSessionRef>): TrustedDemoCase => {
    try {
      return options.registry.get(ref.caseId, ref.caseVersion)
    } catch (error) {
      if (error instanceof DemoCaseRegistryError) {
        const status = error.code === 'unknown-case' ? 404 : 409
        throw new DemoHostRequestError(error.code, error.message, status)
      }
      throw error
    }
  }

  const load = async (
    trustedCase: TrustedDemoCase,
    ref: Required<DemoCaseSessionRef>,
    slot: SessionSlot,
  ): Promise<CaseSessionController | undefined> => {
    if (slot.controller) return slot.controller
    const restored = await restoreCaseSessionControllerFromStorage(
      trustedCase.runtime,
      options.storage,
      ref.saveId,
    )
    slot.controller = restored
    if (restored && !slot.assetSessionId) slot.assetSessionId = nextAssetSessionId()
    return restored
  }

  const refreshWallClock = async (
    trustedCase: TrustedDemoCase,
    ref: Required<DemoCaseSessionRef>,
    slot: SessionSlot,
  ): Promise<void> => {
    const controller = slot.controller
    if (!controller) return
    const presentation = trustedCase.presentation(ref.locale)
    const snapshot = controller.getSnapshot(presentation)
    if (snapshot.status === 'ended') return
    const wallDeadlines = snapshot.deadlines.filter(({ clock, status }) => (
      clock === 'wall' && status === 'scheduled'
    ))
    if (wallDeadlines.length === 0) return

    const observedNow = trustedCase.runtime.kernel.dependencies.wallClock.now()
    if (!Number.isFinite(observedNow) || observedNow < snapshot.clocks.wallTimeMs) return
    const nextDueAtMs = Math.min(...wallDeadlines.map(({ dueAtMs }) => dueAtMs))
    if (
      observedNow < nextDueAtMs &&
      observedNow - snapshot.clocks.wallTimeMs < WALL_CLOCK_OBSERVATION_INTERVAL_MS
    ) {
      return
    }

    const refreshed = controller.dispatch({ type: KERNEL_COMMANDS.resume }, presentation)
    if (!refreshed.ok) {
      if (refreshed.error.code === 'case-ended') return
      throw new DemoHostRequestError(
        'wall-clock-refresh-failed',
        'The trusted local host could not refresh the case clock.',
        500,
      )
    }
    await controller.persist(options.storage, ref.saveId)
  }

  const unavailableAsset = (): DemoHostRequestError => new DemoHostRequestError(
    'asset-unavailable',
    'The requested asset is not available to this session.',
    404,
  )

  const uniqueAssetAuthorizationGrant = (): string => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = nextAssetAuthorizationGrant()
      if (candidate.length > 0 && !assetAuthorizations.has(candidate)) return candidate
    }
    throw new DemoHostRequestError(
      'asset-delivery-failed',
      'The trusted local host could not deliver this asset safely.',
      502,
    )
  }

  const assetGateway = (trustedCase: TrustedDemoCase): CaseAssetGateway => {
    const key = [
      trustedCase.caseId,
      trustedCase.caseVersion,
      trustedCase.compiled.kernelDigest,
    ].join('\u0000')
    const existing = assetGateways.get(key)
    if (existing) return existing
    if (!options.assetCacheDirectory) throw unavailableAsset()
    const gateway = createAssetGateway(trustedCase.compiled, {
      cacheDirectory: options.assetCacheDirectory,
      authorize: (context) => {
        const grantId = context.authorizationGrant
        if (!grantId) return false
        const captured = assetAuthorizations.get(grantId)
        if (!captured) return false
        const accepted = (
          captured.caseId === context.caseId &&
          captured.caseVersion === context.caseVersion &&
          captured.caseDigest === context.caseDigest &&
          captured.handle.id === context.handle.id &&
          captured.handle.kind === context.handle.kind &&
          captured.handle.mimeType === context.handle.mimeType
        )
        // A captured authorization can authorize exactly one gateway call.
        assetAuthorizations.delete(grantId)
        return accepted
      },
    })
    assetGateways.set(key, gateway)
    return gateway
  }

  return Object.freeze({
    async status(inputRef: DemoCaseSessionRef): Promise<DemoSessionStatus> {
      const ref = parseDemoSessionRef(inputRef)
      const trustedCase = resolveCase(ref)
      return queue.run(slotKey(ref), async () => {
        const slot = slots.get(slotKey(ref)) ?? {}
        slots.set(slotKey(ref), slot)
        await load(trustedCase, ref, slot)
        await refreshWallClock(trustedCase, ref, slot)
        return status(trustedCase, ref, slot)
      })
    },

    async start(inputRef: DemoCaseSessionRef): Promise<DemoSessionStatus> {
      const ref = parseDemoSessionRef(inputRef)
      const trustedCase = resolveCase(ref)
      return queue.run(slotKey(ref), async () => {
        const slot = slots.get(slotKey(ref)) ?? {}
        slots.set(slotKey(ref), slot)
        if (await load(trustedCase, ref, slot)) {
          throw new DemoHostRequestError(
            'session-already-started',
            'This profile already has a save for the case. Resume or restart it explicitly.',
            409,
          )
        }
        const candidate = createCaseSessionController(trustedCase.runtime)
        await candidate.persist(options.storage, ref.saveId)
        slot.controller = candidate
        slot.assetSessionId = nextAssetSessionId()
        return status(trustedCase, ref, slot)
      })
    },

    async asset(
      inputRef: DemoCaseSessionRef,
      inputRequest: DemoAssetRequest,
      signal?: AbortSignal,
    ): Promise<VerifiedAssetFile> {
      const ref = parseDemoSessionRef(inputRef)
      const request = parseDemoAssetRequest(inputRequest)
      let authorizationGrant: string | undefined
      try {
        const captured = await queue.run(slotKey(ref), async () => {
          const trustedCase = resolveCase(ref)
          const slot = slots.get(slotKey(ref)) ?? {}
          slots.set(slotKey(ref), slot)
          const controller = await load(trustedCase, ref, slot)
          await refreshWallClock(trustedCase, ref, slot)
          if (
            !controller ||
            !slot.assetSessionId ||
            slot.assetSessionId !== request.assetSessionId ||
            !options.assetCacheDirectory
          ) {
            throw unavailableAsset()
          }

          const snapshot = controller.getSnapshot(trustedCase.presentation(ref.locale))
          if (
            snapshot.case.id !== ref.caseId ||
            snapshot.case.version !== ref.caseVersion ||
            snapshot.case.digest !== trustedCase.compiled.kernelDigest ||
            request.caseDigest !== snapshot.case.digest
          ) {
            throw unavailableAsset()
          }
          const projectedHandles = snapshot.evidence.flatMap(({ assets }) => assets)
          const handle = projectedHandles.find(({ id }) => id === request.assetId)
          if (!handle) throw unavailableAsset()
          authorizationGrant = uniqueAssetAuthorizationGrant()
          const context: AssetAuthorizationContext = {
            caseId: snapshot.case.id,
            caseVersion: snapshot.case.version,
            caseDigest: snapshot.case.digest,
            handle,
          }
          assetAuthorizations.set(authorizationGrant, context)
          return {
            trustedCase,
            context,
            controller,
            assetSessionId: slot.assetSessionId,
          }
        })

        // Authorization above is atomic with commands/restart. Slow source
        // materialization happens after releasing that queue; this request
        // retains only its one-use captured grant.
        const delivered = await assetGateway(captured.trustedCase).deliver({
          ...captured.context,
          authorizationGrant,
        }, signal)
        await queue.run(slotKey(ref), async () => {
          const slot = slots.get(slotKey(ref))
          if (
            !slot?.controller ||
            slot.controller !== captured.controller ||
            slot.assetSessionId !== captured.assetSessionId
          ) {
            throw unavailableAsset()
          }
          const snapshot = slot.controller.getSnapshot(
            captured.trustedCase.presentation(ref.locale),
          )
          const currentHandle = snapshot.evidence
            .flatMap(({ assets }) => assets)
            .find(({ id }) => id === captured.context.handle.id)
          if (
            snapshot.case.id !== captured.context.caseId ||
            snapshot.case.version !== captured.context.caseVersion ||
            snapshot.case.digest !== captured.context.caseDigest ||
            !currentHandle ||
            currentHandle.kind !== captured.context.handle.kind ||
            currentHandle.mimeType !== captured.context.handle.mimeType
          ) {
            throw unavailableAsset()
          }
        })
        return delivered
      } catch (error) {
        if (error instanceof DemoHostRequestError) {
          if (error.code === 'asset-delivery-failed') throw error
          throw unavailableAsset()
        }
        if (error instanceof CasePackageError) {
          if (error.code === 'E_ASSET_UNAUTHORIZED') throw unavailableAsset()
          throw new DemoHostRequestError(
            'asset-delivery-failed',
            'The trusted local host could not deliver this asset safely.',
            502,
          )
        }
        throw error
      } finally {
        if (authorizationGrant) assetAuthorizations.delete(authorizationGrant)
      }
    },

    async command(
      inputRef: DemoCaseSessionRef,
      inputIntent: DemoBrowserIntent,
    ): Promise<DemoCommandResponse> {
      const ref = parseDemoSessionRef(inputRef)
      const intent = parseDemoBrowserIntent(inputIntent)
      const trustedCase = resolveCase(ref)
      return queue.run(slotKey(ref), async () => {
        const slot = slots.get(slotKey(ref)) ?? {}
        slots.set(slotKey(ref), slot)
        const current = await load(trustedCase, ref, slot)
        if (!current) {
          throw new DemoHostRequestError(
            'session-not-started',
            'Start the case before sending detective commands.',
            409,
          )
        }
        await refreshWallClock(trustedCase, ref, slot)

        // Dispatch against a private clone. The live controller is swapped only
        // after the accepted revision is durably written.
        const candidate = await restoreCaseSessionController(
          trustedCase.runtime,
          await current.serialize(),
        )
        const presentation = trustedCase.presentation(ref.locale)
        const result: PublicCaseCommandResult = candidate.dispatch(
          toCommand(intent),
          presentation,
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
      const ref = parseDemoSessionRef(inputRef)
      const trustedCase = resolveCase(ref)
      return queue.run(slotKey(ref), async () => {
        await deleteCaseSessionFromStorage(
          trustedCase.runtime,
          options.storage,
          ref.saveId,
        )
        slots.delete(slotKey(ref))
        return status(trustedCase, ref, {})
      })
    },
  })
}
