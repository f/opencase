import { cloneFrozen, type KernelCommand, type KernelSession } from '../kernel'
import {
  restoreKernelSave,
  serializeKernelSave,
  type ParseKernelSaveOptions,
} from '../persistence'

import { projectCaseState } from './projection'
import type { CasePresentationCatalog, PublicCaseRuntimeState } from './protocol'
import { dispatchCaseCommand, startCase, type CaseRuntime } from './session'

export interface PublicCaseCommandSuccess {
  readonly ok: true
  /** A player-safe projection after the accepted command. */
  readonly snapshot: PublicCaseRuntimeState
}

export interface PublicCaseCommandFailure {
  readonly ok: false
  /** The unchanged player-safe projection. */
  readonly snapshot: PublicCaseRuntimeState
  readonly error: {
    readonly code: string
    readonly message: string
  }
}

export type PublicCaseCommandResult = PublicCaseCommandSuccess | PublicCaseCommandFailure

/** Exact host storage namespace for one save slot and one compiled case build. */
export interface CaseSaveStorageKey {
  readonly saveId: string
  readonly caseId: string
  readonly caseVersion: string
  readonly kernelIrDigest: string
}

/**
 * Trusted persistence port. Implementations may use a file, database, account
 * sync, native key-value store or an offline browser store. The serialized
 * value is opaque: adapters must not parse, merge, or patch it.
 */
export interface CaseSaveStorage {
  read(key: CaseSaveStorageKey): Promise<string | undefined>
  write(key: CaseSaveStorageKey, serializedSave: string): Promise<void>
  delete(key: CaseSaveStorageKey): Promise<void>
}

export interface CaseSaveReceipt {
  readonly key: CaseSaveStorageKey
  readonly revision: number
}

/**
 * Trusted session boundary for application hosts.
 *
 * The authoritative KernelSession and its event log remain inside this
 * closure. A presentation shell receives only public projections and sends
 * command intent. Window layout, selected tools, locale and other UI state do
 * not belong here and therefore cannot alter a case save.
 */
export interface CaseSessionController {
  getSnapshot(presentation?: CasePresentationCatalog): PublicCaseRuntimeState
  dispatch(
    command: KernelCommand,
    presentation?: CasePresentationCatalog,
  ): PublicCaseCommandResult
  /** Returns canonical kernel-save@1 bytes for a trusted storage adapter. */
  serialize(): Promise<string>
  /** Serializes one immutable revision and writes it through a trusted port. */
  persist(storage: CaseSaveStorage, saveId: string): Promise<CaseSaveReceipt>
}

function publicSnapshot(
  session: KernelSession,
  presentation?: CasePresentationCatalog,
): PublicCaseRuntimeState {
  return cloneFrozen(projectCaseState(session, presentation)) as PublicCaseRuntimeState
}

function caseSaveStorageKey(runtime: CaseRuntime, saveId: string): CaseSaveStorageKey {
  if (typeof saveId !== 'string' || saveId.trim().length === 0) {
    throw new Error('saveId must be a non-empty string.')
  }
  return cloneFrozen({
    saveId,
    caseId: runtime.kernel.caseIR.id,
    caseVersion: runtime.kernel.caseIR.version,
    kernelIrDigest: runtime.kernel.caseIR.digest,
  }) as CaseSaveStorageKey
}

function controller(
  runtime: CaseRuntime,
  initialSession: KernelSession,
): CaseSessionController {
  let session = initialSession

  return Object.freeze({
    getSnapshot(presentation?: CasePresentationCatalog): PublicCaseRuntimeState {
      return publicSnapshot(session, presentation)
    },

    dispatch(
      command: KernelCommand,
      presentation?: CasePresentationCatalog,
    ): PublicCaseCommandResult {
      const currentSnapshot = publicSnapshot(session, presentation)
      if (currentSnapshot.status === 'ended') {
        return Object.freeze({
          ok: false,
          snapshot: currentSnapshot,
          error: Object.freeze({
            code: 'case-ended',
            message: 'The case has ended.',
          }),
        })
      }
      const result = dispatchCaseCommand(runtime, session, command)
      if (!result.ok) {
        return Object.freeze({
          ok: false,
          snapshot: currentSnapshot,
          error: Object.freeze({ ...result.error }),
        })
      }

      session = result.session
      return Object.freeze({
        ok: true,
        snapshot: publicSnapshot(session, presentation),
      })
    },

    serialize(): Promise<string> {
      // Capture this exact immutable revision even if a later command is
      // dispatched while Web Crypto computes the checksum.
      const captured = session
      return serializeKernelSave(runtime.kernel, captured)
    },

    async persist(storage: CaseSaveStorage, saveId: string): Promise<CaseSaveReceipt> {
      const captured = session
      const key = caseSaveStorageKey(runtime, saveId)
      const serializedSave = await serializeKernelSave(runtime.kernel, captured)
      await storage.write(key, serializedSave)
      return cloneFrozen({ key, revision: captured.state.revision }) as CaseSaveReceipt
    },
  })
}

/** Starts a new authoritative session without exposing its KernelSession. */
export function createCaseSessionController(runtime: CaseRuntime): CaseSessionController {
  return controller(runtime, startCase(runtime))
}

/**
 * Restores an authoritative session after schema, checksum, build-lock and
 * event-log validation. No partial controller is returned on failure.
 */
export async function restoreCaseSessionController(
  runtime: CaseRuntime,
  input: string | unknown,
  options?: ParseKernelSaveOptions,
): Promise<CaseSessionController> {
  const restored = await restoreKernelSave(runtime.kernel, input, options)
  return controller(runtime, restored)
}

/**
 * Reads one exact case/build slot from a trusted storage port. Missing slots
 * are not errors; malformed or mismatched saves still fail closed.
 */
export async function restoreCaseSessionControllerFromStorage(
  runtime: CaseRuntime,
  storage: CaseSaveStorage,
  saveId: string,
  options?: ParseKernelSaveOptions,
): Promise<CaseSessionController | undefined> {
  const key = caseSaveStorageKey(runtime, saveId)
  const serializedSave = await storage.read(key)
  if (serializedSave === undefined) return undefined
  return restoreCaseSessionController(runtime, serializedSave, options)
}

/**
 * Deletes exactly one case/build/save slot. A true restart then creates a new
 * controller; it never appends a reset event to the previous investigation.
 */
export async function deleteCaseSessionFromStorage(
  runtime: CaseRuntime,
  storage: CaseSaveStorage,
  saveId: string,
): Promise<CaseSaveStorageKey> {
  const key = caseSaveStorageKey(runtime, saveId)
  await storage.delete(key)
  return key
}
