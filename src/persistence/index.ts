import {
  KERNEL_CAPABILITY,
  assertJsonValue,
  capabilityKey,
  cloneFrozen,
  deepFreeze,
  replayEventLog,
  stableStringify,
  type CapabilityRef,
  type DomainEvent,
  type JsonObject,
  type KernelRuntime,
  type KernelSession,
} from '../kernel'

export const KERNEL_SAVE_SCHEMA_VERSION = 'kernel-save@1' as const

export const KERNEL_SAVE_ERROR = {
  invalidFormat: 'invalid-format',
  unsupportedSchema: 'unsupported-schema',
  migrationFailed: 'migration-failed',
  checksumMismatch: 'checksum-mismatch',
  caseBuildMismatch: 'case-build-mismatch',
  capabilityLockMismatch: 'capability-lock-mismatch',
  eventLogInvalid: 'event-log-invalid',
  sessionStateMismatch: 'session-state-mismatch',
} as const

export type KernelSaveErrorCode = (typeof KERNEL_SAVE_ERROR)[keyof typeof KERNEL_SAVE_ERROR]

export class KernelSaveError extends Error {
  readonly code: KernelSaveErrorCode

  constructor(code: KernelSaveErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'KernelSaveError'
    this.code = code
  }
}

export interface KernelSaveCaseLock {
  readonly id: string
  readonly version: string
  /** Digest of the final, compiler-produced kernel IR. The IR itself is never saved. */
  readonly kernelIrDigest: string
}

export interface KernelSaveUnsigned {
  readonly schemaVersion: typeof KERNEL_SAVE_SCHEMA_VERSION
  readonly case: KernelSaveCaseLock
  /** Exact capability id/version/digest locks, including the built-in kernel capability. */
  readonly capabilityLocks: readonly CapabilityRef[]
  /** The sole source of restorable session state. Commands and state snapshots are not saved. */
  readonly events: readonly DomainEvent[]
}

export interface KernelSave extends KernelSaveUnsigned {
  /** SHA-256 of the canonical JSON encoding of every other save field. */
  readonly checksum: string
}

export interface KernelSaveMigrationContext {
  readonly fromSchemaVersion: string
  readonly toSchemaVersion: typeof KERNEL_SAVE_SCHEMA_VERSION
}

/**
 * Persistence intentionally ships with no migrations. A host may inject an
 * explicit, audited migration and must return a complete current-schema save,
 * including a checksum valid under the current canonical format.
 */
export type KernelSaveMigration = (
  source: unknown,
  context: KernelSaveMigrationContext,
) => unknown | Promise<unknown>

export interface ParseKernelSaveOptions {
  readonly migrate?: KernelSaveMigration
}

type UnknownRecord = Record<string, unknown>

function fail(code: KernelSaveErrorCode, message: string, cause?: unknown): never {
  throw new KernelSaveError(code, message, cause === undefined ? undefined : { cause })
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, `${label} must be an object.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, `${label} must be a plain object.`)
  }
  return value as UnknownRecord
}

function exactKeys(
  value: UnknownRecord,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(KERNEL_SAVE_ERROR.invalidFormat, `${label} contains unknown field ${key}.`)
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(KERNEL_SAVE_ERROR.invalidFormat, `${label} is missing required field ${key}.`)
    }
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, `${label} must be a non-empty string.`)
  }
  return value
}

function nonNegativeFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, `${label} must be a finite, non-negative number.`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, `${label} must be a positive safe integer.`)
  }
  return value
}

function capabilityRef(value: unknown, label: string): CapabilityRef {
  const candidate = record(value, label)
  exactKeys(candidate, label, ['id', 'version', 'digest'])
  return {
    id: nonEmptyString(candidate.id, `${label}.id`),
    version: nonEmptyString(candidate.version, `${label}.version`),
    digest: nonEmptyString(candidate.digest, `${label}.digest`),
  }
}

function occurredAt(value: unknown, label: string): DomainEvent['meta']['occurredAt'] {
  const candidate = record(value, label)
  exactKeys(candidate, label, ['caseTimeMs', 'activeTimeMs', 'wallTimeMs'])
  return {
    caseTimeMs: nonNegativeFiniteNumber(candidate.caseTimeMs, `${label}.caseTimeMs`),
    activeTimeMs: nonNegativeFiniteNumber(candidate.activeTimeMs, `${label}.activeTimeMs`),
    wallTimeMs: nonNegativeFiniteNumber(candidate.wallTimeMs, `${label}.wallTimeMs`),
  }
}

function scheduleToken(value: unknown, label: string): NonNullable<DomainEvent['meta']['schedule']> {
  const candidate = record(value, label)
  exactKeys(candidate, label, ['id', 'generation'])
  return {
    id: nonEmptyString(candidate.id, `${label}.id`),
    generation: positiveInteger(candidate.generation, `${label}.generation`),
  }
}

function event(value: unknown, index: number): DomainEvent {
  const label = `save.events[${index}]`
  const candidate = record(value, label)
  exactKeys(candidate, label, ['id', 'type', 'payload', 'meta'])

  const payload = record(candidate.payload, `${label}.payload`)
  try {
    assertJsonValue(payload, `${label}.payload`)
  } catch (error) {
    fail(
      KERNEL_SAVE_ERROR.invalidFormat,
      error instanceof Error ? error.message : `${label}.payload must be JSON-safe.`,
      error,
    )
  }

  const metaLabel = `${label}.meta`
  const meta = record(candidate.meta, metaLabel)
  exactKeys(
    meta,
    metaLabel,
    ['sequence', 'commandId', 'commandType', 'capability', 'occurredAt'],
    ['schedule'],
  )
  const sequence = positiveInteger(meta.sequence, `${metaLabel}.sequence`)
  if (sequence !== index + 1) {
    fail(
      KERNEL_SAVE_ERROR.invalidFormat,
      `${metaLabel}.sequence must be ${index + 1}, received ${sequence}.`,
    )
  }

  return {
    id: nonEmptyString(candidate.id, `${label}.id`),
    type: nonEmptyString(candidate.type, `${label}.type`),
    payload: structuredClone(payload) as JsonObject,
    meta: {
      sequence,
      commandId: nonEmptyString(meta.commandId, `${metaLabel}.commandId`),
      commandType: nonEmptyString(meta.commandType, `${metaLabel}.commandType`),
      capability: capabilityRef(meta.capability, `${metaLabel}.capability`),
      occurredAt: occurredAt(meta.occurredAt, `${metaLabel}.occurredAt`),
      ...(meta.schedule !== undefined
        ? { schedule: scheduleToken(meta.schedule, `${metaLabel}.schedule`) }
        : {}),
    },
  }
}

function parseUnsigned(candidate: UnknownRecord): KernelSaveUnsigned {
  if (candidate.schemaVersion !== KERNEL_SAVE_SCHEMA_VERSION) {
    fail(
      KERNEL_SAVE_ERROR.unsupportedSchema,
      `Unsupported save schema ${String(candidate.schemaVersion)}.`,
    )
  }

  const caseValue = record(candidate.case, 'save.case')
  exactKeys(caseValue, 'save.case', ['id', 'version', 'kernelIrDigest'])
  const caseLock: KernelSaveCaseLock = {
    id: nonEmptyString(caseValue.id, 'save.case.id'),
    version: nonEmptyString(caseValue.version, 'save.case.version'),
    kernelIrDigest: nonEmptyString(caseValue.kernelIrDigest, 'save.case.kernelIrDigest'),
  }

  if (!Array.isArray(candidate.capabilityLocks) || candidate.capabilityLocks.length === 0) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, 'save.capabilityLocks must be a non-empty array.')
  }
  const capabilityLocks = candidate.capabilityLocks.map((lock, index) =>
    capabilityRef(lock, `save.capabilityLocks[${index}]`),
  )
  const lockKeys = new Set<string>()
  for (const lock of capabilityLocks) {
    const key = capabilityKey(lock)
    if (lockKeys.has(key)) {
      fail(KERNEL_SAVE_ERROR.invalidFormat, `save.capabilityLocks contains duplicate ${key}.`)
    }
    lockKeys.add(key)
  }
  const kernelLock = capabilityLocks.find((lock) => capabilityKey(lock) === capabilityKey(KERNEL_CAPABILITY))
  if (!kernelLock || kernelLock.digest !== KERNEL_CAPABILITY.digest) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, 'save.capabilityLocks has no exact built-in kernel lock.')
  }

  if (!Array.isArray(candidate.events) || candidate.events.length === 0) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, 'save.events must be a non-empty array.')
  }
  const events = candidate.events.map(event)
  const eventIds = new Set<string>()
  for (const item of events) {
    if (eventIds.has(item.id)) {
      fail(KERNEL_SAVE_ERROR.invalidFormat, `save.events contains duplicate event id ${item.id}.`)
    }
    eventIds.add(item.id)
    const eventLock = capabilityLocks.find(
      (lock) => capabilityKey(lock) === capabilityKey(item.meta.capability),
    )
    if (!eventLock || eventLock.digest !== item.meta.capability.digest) {
      fail(
        KERNEL_SAVE_ERROR.invalidFormat,
        `Event ${item.id} uses capability not present in the exact save locks.`,
      )
    }
  }

  return {
    schemaVersion: KERNEL_SAVE_SCHEMA_VERSION,
    case: caseLock,
    capabilityLocks,
    events,
  }
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, 'This environment does not provide Web Crypto SHA-256.')
  }
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

async function checksumFor(unsigned: KernelSaveUnsigned): Promise<string> {
  return sha256(stableStringify(unsigned))
}

function same(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

function expectedCapabilityLocks(runtime: KernelRuntime): readonly CapabilityRef[] {
  return [KERNEL_CAPABILITY, ...runtime.caseIR.capabilities].map(({ id, version, digest }) => ({
    id,
    version,
    digest,
  }))
}

function assertRuntimeBuild(runtime: KernelRuntime, save: KernelSaveUnsigned): void {
  if (
    save.case.id !== runtime.caseIR.id ||
    save.case.version !== runtime.caseIR.version ||
    save.case.kernelIrDigest !== runtime.caseIR.digest
  ) {
    fail(
      KERNEL_SAVE_ERROR.caseBuildMismatch,
      `Save targets ${save.case.id}@${save.case.version} (${save.case.kernelIrDigest}), ` +
        `but runtime has ${runtime.caseIR.id}@${runtime.caseIR.version} (${runtime.caseIR.digest}).`,
    )
  }
  if (!same(save.capabilityLocks, expectedCapabilityLocks(runtime))) {
    fail(
      KERNEL_SAVE_ERROR.capabilityLockMismatch,
      'Save capability id/version/digest locks do not match this runtime build.',
    )
  }
}

function replayChecked(runtime: KernelRuntime, save: KernelSaveUnsigned): KernelSession {
  assertRuntimeBuild(runtime, save)
  let restored: KernelSession
  try {
    restored = replayEventLog(runtime, save.events)
  } catch (error) {
    fail(
      KERNEL_SAVE_ERROR.eventLogInvalid,
      error instanceof Error ? `Saved event log cannot be replayed: ${error.message}` : 'Saved event log cannot be replayed.',
      error,
    )
  }
  if (
    !restored.state.case ||
    restored.state.case.id !== save.case.id ||
    restored.state.case.version !== save.case.version ||
    restored.state.case.digest !== save.case.kernelIrDigest
  ) {
    fail(KERNEL_SAVE_ERROR.caseBuildMismatch, 'Replayed event log has different case build metadata.')
  }
  if (!same(restored.state.capabilityLocks, save.capabilityLocks)) {
    fail(
      KERNEL_SAVE_ERROR.capabilityLockMismatch,
      'Replayed event log capability locks differ from the save header.',
    )
  }
  return restored
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch (error) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, 'Save is not valid JSON.', error)
  }
}

async function migrateIfRequired(
  input: unknown,
  options: ParseKernelSaveOptions | undefined,
): Promise<unknown> {
  const candidate = record(input, 'save')
  const version = candidate.schemaVersion
  if (version === KERNEL_SAVE_SCHEMA_VERSION) return input
  if (typeof version !== 'string' || version.length === 0) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, 'save.schemaVersion must be a non-empty string.')
  }
  if (!options?.migrate) {
    fail(
      KERNEL_SAVE_ERROR.unsupportedSchema,
      `Unsupported save schema ${version}; no migration hook was supplied.`,
    )
  }
  let migrated: unknown
  try {
    migrated = await options.migrate(cloneFrozen(input), {
      fromSchemaVersion: version,
      toSchemaVersion: KERNEL_SAVE_SCHEMA_VERSION,
    })
  } catch (error) {
    fail(KERNEL_SAVE_ERROR.migrationFailed, `Migration from ${version} failed.`, error)
  }
  const migratedVersion = record(migrated, 'migrated save').schemaVersion
  if (migratedVersion !== KERNEL_SAVE_SCHEMA_VERSION) {
    fail(
      KERNEL_SAVE_ERROR.migrationFailed,
      `Migration from ${version} did not produce ${KERNEL_SAVE_SCHEMA_VERSION}.`,
    )
  }
  return migrated
}

export async function createKernelSave(
  runtime: KernelRuntime,
  session: KernelSession,
): Promise<KernelSave> {
  let replayed: KernelSession
  try {
    replayed = replayEventLog(runtime, session.eventLog)
  } catch (error) {
    fail(
      KERNEL_SAVE_ERROR.eventLogInvalid,
      error instanceof Error ? `Session event log cannot be replayed: ${error.message}` : 'Session event log cannot be replayed.',
      error,
    )
  }
  if (!same(replayed.state, session.state)) {
    fail(
      KERNEL_SAVE_ERROR.sessionStateMismatch,
      'Session state is not the reducer result of its event log.',
    )
  }
  if (!replayed.state.case) {
    fail(KERNEL_SAVE_ERROR.eventLogInvalid, 'Session event log does not initialize a case.')
  }

  const unsignedCandidate: UnknownRecord = {
    schemaVersion: KERNEL_SAVE_SCHEMA_VERSION,
    case: {
      id: replayed.state.case.id,
      version: replayed.state.case.version,
      kernelIrDigest: replayed.state.case.digest,
    },
    capabilityLocks: replayed.state.capabilityLocks,
    events: replayed.eventLog,
  }
  const unsigned = parseUnsigned(unsignedCandidate)
  assertRuntimeBuild(runtime, unsigned)
  const checksum = await checksumFor(unsigned)
  return cloneFrozen({ ...unsigned, checksum }) as KernelSave
}

export async function serializeKernelSave(
  runtime: KernelRuntime,
  session: KernelSession,
): Promise<string> {
  return stableStringify(await createKernelSave(runtime, session))
}

export async function parseKernelSave(
  input: string | unknown,
  options?: ParseKernelSaveOptions,
): Promise<KernelSave> {
  const parsed = typeof input === 'string' ? parseJson(input) : input
  const migrated = await migrateIfRequired(parsed, options)
  const candidate = record(migrated, 'save')
  exactKeys(candidate, 'save', ['schemaVersion', 'case', 'capabilityLocks', 'events', 'checksum'])
  const checksum = nonEmptyString(candidate.checksum, 'save.checksum')
  if (!/^sha256:[0-9a-f]{64}$/.test(checksum)) {
    fail(KERNEL_SAVE_ERROR.invalidFormat, 'save.checksum must be a lowercase SHA-256 digest.')
  }
  const unsigned = parseUnsigned(candidate)
  const expected = await checksumFor(unsigned)
  if (checksum !== expected) {
    fail(KERNEL_SAVE_ERROR.checksumMismatch, 'Save checksum does not match its canonical contents.')
  }
  return deepFreeze({ ...unsigned, checksum }) as KernelSave
}

export async function restoreKernelSave(
  runtime: KernelRuntime,
  input: string | unknown,
  options?: ParseKernelSaveOptions,
): Promise<KernelSession> {
  const save = await parseKernelSave(input, options)
  return replayChecked(runtime, save)
}
