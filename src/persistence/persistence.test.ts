import { describe, expect, it } from 'vitest'
import {
  accept,
  capabilityKey,
  createCapabilityRegistry,
  createKernelRuntime,
  dispatchCommand,
  startSession,
  type CapabilityDefinition,
  type CapabilityRef,
  type CaseKernelIR,
  type JsonValue,
  type KernelDependencies,
  type KernelRuntime,
  type KernelSession,
} from '../kernel'
import {
  KERNEL_SAVE_ERROR,
  KERNEL_SAVE_SCHEMA_VERSION,
  KernelSaveError,
  parseKernelSave,
  restoreKernelSave,
  serializeKernelSave,
} from './index'

const COUNTER_REF: CapabilityRef = {
  id: 'counter',
  version: '1',
  digest: 'sha256:counter-v1',
}

interface TestEnvironment {
  readonly dependencies: KernelDependencies
  readonly calls: { commandIds: number; eventIds: number; wall: number; decisions: number }
}

function environment(): TestEnvironment {
  const calls = { commandIds: 0, eventIds: 0, wall: 0, decisions: 0 }
  return {
    calls,
    dependencies: {
      ids: {
        nextCommandId() {
          calls.commandIds += 1
          return `command:${calls.commandIds}`
        },
        nextEventId() {
          calls.eventIds += 1
          return `event:${calls.eventIds}`
        },
      },
      wallClock: {
        now() {
          calls.wall += 1
          return 10_000
        },
      },
    },
  }
}

function counterValue(value: JsonValue | undefined): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  return typeof value.value === 'number' ? value.value : 0
}

function counterCapability(ref: CapabilityRef, calls: TestEnvironment['calls']): CapabilityDefinition {
  return {
    ...ref,
    commands: {
      'counter.add': ({ command }) => {
        calls.decisions += 1
        if (typeof command.payload.by !== 'number') {
          return { ok: false, code: 'invalid', message: 'by must be a number' }
        }
        return accept({ type: 'counter.added', payload: command.payload })
      },
    },
    reducers: {
      'counter.added': (state, event) => ({
        value: counterValue(state) + Number(event.payload.by),
      }),
    },
  }
}

function caseIR(
  capability: CapabilityRef = COUNTER_REF,
  digest = 'sha256:case-build-v1',
): CaseKernelIR {
  return {
    schemaVersion: 'case-ir@1',
    id: 'case.persistence-test',
    version: '1.0.0',
    digest,
    capabilities: [capability],
    types: [{ id: 'person' }],
    entities: [
      {
        id: 'culprit',
        typeId: 'person',
        data: { privateIrOnlyMarker: 'must-never-be-in-save' },
      },
    ],
    initial: {
      capabilityState: { [capabilityKey(capability)]: { value: 0 } },
      slots: { chapter: 1 },
    },
  }
}

function runtime(
  env: TestEnvironment,
  capability: CapabilityRef = COUNTER_REF,
  digest = 'sha256:case-build-v1',
): KernelRuntime {
  return createKernelRuntime(
    caseIR(capability, digest),
    createCapabilityRegistry([counterCapability(capability, env.calls)]),
    env.dependencies,
  )
}

function add(
  activeRuntime: KernelRuntime,
  session: KernelSession,
  payload: Record<string, JsonValue>,
): KernelSession {
  const result = dispatchCommand(activeRuntime, session, { type: 'counter.add', payload })
  expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.session
}

async function populatedSave(payload: Record<string, JsonValue> = { by: 3 }) {
  const env = environment()
  const activeRuntime = runtime(env)
  let session = startSession(activeRuntime)
  session = add(activeRuntime, session, payload)
  return {
    env,
    runtime: activeRuntime,
    session,
    serialized: await serializeKernelSave(activeRuntime, session),
  }
}

function expectSaveError(code: string) {
  return expect.objectContaining({ name: 'KernelSaveError', code })
}

describe('kernel persistence', () => {
  it('round-trips from events only without invoking IDs, clocks, or command deciders', async () => {
    const fixture = await populatedSave({ by: 3, note: 'first' })
    const callsBeforeRestore = { ...fixture.env.calls }
    const restored = await restoreKernelSave(fixture.runtime, fixture.serialized)

    expect(restored).toEqual(fixture.session)
    expect(fixture.env.calls).toEqual(callsBeforeRestore)
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored.eventLog)).toBe(true)

    const raw = JSON.parse(fixture.serialized) as Record<string, unknown>
    expect(Object.keys(raw).sort()).toEqual([
      'capabilityLocks',
      'case',
      'checksum',
      'events',
      'schemaVersion',
    ])
    expect(raw).not.toHaveProperty('state')
    expect(raw).not.toHaveProperty('commands')
    expect(raw).not.toHaveProperty('commandLog')
    expect(raw).not.toHaveProperty('caseIR')
    expect(fixture.serialized).not.toContain('must-never-be-in-save')
  })

  it('emits deterministic canonical bytes independent of object insertion order', async () => {
    const left = await populatedSave({ by: 4, zeta: 'last', alpha: 'first' })
    const right = await populatedSave({ alpha: 'first', zeta: 'last', by: 4 })

    expect(left.serialized).toBe(right.serialized)
    expect(await serializeKernelSave(left.runtime, left.session)).toBe(left.serialized)
    expect(left.serialized).toContain(`"schemaVersion":"${KERNEL_SAVE_SCHEMA_VERSION}"`)
  })

  it('rejects content tampering and unknown save fields', async () => {
    const fixture = await populatedSave()
    const tampered = JSON.parse(fixture.serialized) as {
      events: Array<{ payload: Record<string, unknown> }>
    }
    tampered.events[1]!.payload.by = 900

    await expect(restoreKernelSave(fixture.runtime, JSON.stringify(tampered))).rejects.toEqual(
      expectSaveError(KERNEL_SAVE_ERROR.checksumMismatch),
    )

    const withSnapshot = JSON.parse(fixture.serialized) as Record<string, unknown>
    withSnapshot.state = { forged: true }
    await expect(parseKernelSave(withSnapshot)).rejects.toEqual(
      expectSaveError(KERNEL_SAVE_ERROR.invalidFormat),
    )
  })

  it('rejects saves from a different final kernel IR build', async () => {
    const fixture = await populatedSave()
    const otherEnvironment = environment()
    const otherRuntime = runtime(otherEnvironment, COUNTER_REF, 'sha256:case-build-v2')

    await expect(restoreKernelSave(otherRuntime, fixture.serialized)).rejects.toEqual(
      expectSaveError(KERNEL_SAVE_ERROR.caseBuildMismatch),
    )
  })

  it('rejects any capability id/version/digest lock mismatch', async () => {
    const fixture = await populatedSave()
    const replacementRef: CapabilityRef = {
      ...COUNTER_REF,
      digest: 'sha256:counter-v2',
    }
    const otherEnvironment = environment()
    const otherRuntime = runtime(otherEnvironment, replacementRef)

    await expect(restoreKernelSave(otherRuntime, fixture.serialized)).rejects.toEqual(
      expectSaveError(KERNEL_SAVE_ERROR.capabilityLockMismatch),
    )
  })

  it('has an explicit migration hook but performs no implicit or fake migration', async () => {
    const fixture = await populatedSave()
    const current = JSON.parse(fixture.serialized) as Record<string, unknown>
    const legacy = { ...current, schemaVersion: 'kernel-save@0' }

    await expect(parseKernelSave(legacy)).rejects.toEqual(
      expectSaveError(KERNEL_SAVE_ERROR.unsupportedSchema),
    )

    const calls: Array<{ fromSchemaVersion: string; toSchemaVersion: string }> = []
    const migrated = await parseKernelSave(legacy, {
      migrate: (_source, context) => {
        calls.push(context)
        return current
      },
    })
    expect(migrated.schemaVersion).toBe(KERNEL_SAVE_SCHEMA_VERSION)
    expect(calls).toEqual([
      { fromSchemaVersion: 'kernel-save@0', toSchemaVersion: KERNEL_SAVE_SCHEMA_VERSION },
    ])

    await expect(
      parseKernelSave(legacy, { migrate: (source) => source }),
    ).rejects.toEqual(expectSaveError(KERNEL_SAVE_ERROR.migrationFailed))
  })

  it('uses a typed error so hosts can reject saves without message matching', async () => {
    try {
      await parseKernelSave('{}')
      throw new Error('Expected parsing to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(KernelSaveError)
      expect((error as KernelSaveError).code).toBe(KERNEL_SAVE_ERROR.invalidFormat)
    }
  })
})
