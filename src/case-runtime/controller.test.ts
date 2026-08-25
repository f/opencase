import { describe, expect, it } from 'vitest'

import { compileCaseSourceOrThrow } from '../compiler'
import { KERNEL_SAVE_SCHEMA_VERSION } from '../persistence'

import { compileToKernelIR } from './adapter'
import {
  createCaseSessionController,
  deleteCaseSessionFromStorage,
  restoreCaseSessionController,
  restoreCaseSessionControllerFromStorage,
  type CaseSaveStorage,
  type CaseSaveStorageKey,
} from './controller'
import { CASE_COMMANDS, type CasePresentationCatalog } from './protocol'
import { createCaseRuntime, type CaseRuntime } from './session'

const CONTROLLER_CASE = `schema: case-source/v0.1
case:
  id: demo.session-controller
  version: 0.1.0
  title: Session Controller
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "09:00"}
  synopsis: A generic controller fixture.
use: [investigation@1, artifacts@1, generic-actions@1]
cast:
  caller: {name: Caller, role: client, client: true}
  subject: {name: Subject, role: subject}
places: {room: Test Room}
things: {record: {type: document, name: Record}}
truth:
  events:
    hidden_event:
      {at: "08:59", type: record.created, actor: subject, object: record, place: room,
       private_marker: sealed-world-value}
  facts: {}
perspectives: {}
opening:
  call: {from: caller, text: Inspect the record.}
  grants: [opening_record]
  starts: []
evidence:
  opening_record:
    tool: document
    at: start
    reports: {location: room}
deductions:
  record_located:
    conclude: {record: record, location: room}
    prove: {any: [[opening_record.location]]}
flags: []
reactions: []
deadlines: {}
objectives:
  locate_record: {supported: record_located}
outcomes:
  resolved:
    {title: {$text: outcomes.resolved.title}, priority: 100, require: [locate_record]}
`

function runtime(prefix: string): CaseRuntime {
  let commandSequence = 0
  let eventSequence = 0
  const source = compileCaseSourceOrThrow(CONTROLLER_CASE, {
    fileName: 'session-controller.case.yml',
    localization: {
      defaultLocale: 'en',
      availableKeys: new Set(['outcomes.resolved.title']),
    },
  }).ir
  return createCaseRuntime(compileToKernelIR(source), {
    ids: {
      nextCommandId: () => `${prefix}:command:${++commandSequence}`,
      nextEventId: () => `${prefix}:event:${++eventSequence}`,
    },
    wallClock: { now: () => 1_000 },
  })
}

const TURKISH_PRESENTATION: CasePresentationCatalog = {
  defaultLocale: 'en',
  locale: 'tr',
  messages: { 'outcomes.resolved.title': 'Çözüldü' },
}

describe('authoritative case session controller', () => {
  it('keeps the KernelSession and event log behind a public projection boundary', () => {
    const session = createCaseSessionController(runtime('new'))

    expect(Object.keys(session).sort()).toEqual([
      'dispatch',
      'getSnapshot',
      'persist',
      'serialize',
    ])
    expect(Object.isFrozen(session)).toBe(true)

    const snapshot = session.getSnapshot()
    const serialized = JSON.stringify(snapshot)
    expect(snapshot).toMatchObject({
      schema: 'case-runtime/public-v1',
      status: 'active',
      revision: 1,
      case: { id: 'demo.session-controller', version: '0.1.0' },
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(serialized).not.toContain('eventLog')
    expect(serialized).not.toContain('capabilityState')
    expect(serialized).not.toContain('sealed-world-value')
  })

  it('accepts generic command intent and returns no private session or events', () => {
    const session = createCaseSessionController(runtime('commands'))
    const observed = session.dispatch({
      type: CASE_COMMANDS.observeEvidence,
      payload: { evidenceId: 'opening_record' },
    })

    expect(observed.ok).toBe(true)
    expect(Object.keys(observed).sort()).toEqual(['ok', 'snapshot'])
    expect(observed).not.toHaveProperty('session')
    expect(observed).not.toHaveProperty('events')
    expect(observed.snapshot.evidence).toContainEqual({
      id: 'opening_record',
      tool: 'document',
      observed: true,
      assets: [],
      findings: [],
    })

    const revision = observed.snapshot.revision
    const rejected = session.dispatch({
      type: CASE_COMMANDS.attemptDeduction,
      payload: { deductionId: 'not-a-deduction' },
    })
    expect(rejected.ok).toBe(false)
    if (rejected.ok) throw new Error('Expected the command to be rejected')
    expect(rejected.snapshot.revision).toBe(revision)
    expect(rejected.error.code).toBe('unknown-deduction')
    expect(rejected).not.toHaveProperty('session')
    expect(rejected).not.toHaveProperty('events')
  })

  it('serializes the authoritative revision as kernel-save@1 and restores it', async () => {
    const session = createCaseSessionController(runtime('source'))
    const observed = session.dispatch({
      type: CASE_COMMANDS.observeEvidence,
      payload: { evidenceId: 'opening_record' },
    })
    expect(observed.ok).toBe(true)

    const serialized = await session.serialize()
    const save = JSON.parse(serialized) as Record<string, unknown>
    expect(save.schemaVersion).toBe(KERNEL_SAVE_SCHEMA_VERSION)
    expect(save.case).toMatchObject({
      id: 'demo.session-controller',
      version: '0.1.0',
    })
    expect(save).toHaveProperty('events')
    expect(save).not.toHaveProperty('state')
    expect(save).not.toHaveProperty('caseIR')

    const restored = await restoreCaseSessionController(runtime('restored'), serialized)
    expect(restored.getSnapshot()).toEqual(session.getSnapshot())

    const deduction = restored.dispatch({
      type: CASE_COMMANDS.attemptDeduction,
      payload: { deductionId: 'record_located' },
    }, TURKISH_PRESENTATION)
    expect(deduction.ok).toBe(true)
    expect(deduction.snapshot.outcome).toEqual({ id: 'resolved', title: 'Çözüldü' })
    expect(deduction.snapshot.status).toBe('ended')
    expect(deduction.snapshot.affordances).toEqual([])

    const afterOutcome = restored.dispatch({
      type: CASE_COMMANDS.observeEvidence,
      payload: { evidenceId: 'opening_record' },
    }, TURKISH_PRESENTATION)
    expect(afterOutcome.ok).toBe(false)
    if (afterOutcome.ok) throw new Error('Expected a resolved case to reject commands')
    expect(afterOutcome.error.code).toBe('case-ended')
    expect(afterOutcome.snapshot).toEqual(deduction.snapshot)
  })

  it('keeps presentation copy out of authoritative state and save bytes', async () => {
    const session = createCaseSessionController(runtime('presentation'))
    expect(session.dispatch({
      type: CASE_COMMANDS.observeEvidence,
      payload: { evidenceId: 'opening_record' },
    }).ok).toBe(true)
    expect(session.dispatch({
      type: CASE_COMMANDS.attemptDeduction,
      payload: { deductionId: 'record_located' },
    }).ok).toBe(true)

    const unresolved = session.getSnapshot()
    const localized = session.getSnapshot(TURKISH_PRESENTATION)
    expect(unresolved.outcome).toEqual({
      id: 'resolved',
      textKey: 'outcomes.resolved.title',
    })
    expect(localized.outcome).toEqual({ id: 'resolved', title: 'Çözüldü' })
    expect(unresolved.revision).toBe(localized.revision)

    const before = await session.serialize()
    session.getSnapshot({
      defaultLocale: 'en',
      locale: 'en',
      messages: { 'outcomes.resolved.title': 'Resolved' },
    })
    const after = await session.serialize()
    expect(after).toBe(before)
    expect(after).not.toContain('Çözüldü')
    expect(after).not.toContain('Resolved')
  })

  it('persists opaque save bytes under an exact case/build slot', async () => {
    const values = new Map<string, string>()
    const writes: Array<{ key: CaseSaveStorageKey; value: string }> = []
    const storageKey = (key: CaseSaveStorageKey) => JSON.stringify(key)
    const storage: CaseSaveStorage = {
      async read(key) {
        return values.get(storageKey(key))
      },
      async write(key, value) {
        writes.push({ key, value })
        values.set(storageKey(key), value)
      },
      async delete(key) {
        values.delete(storageKey(key))
      },
    }

    const session = createCaseSessionController(runtime('stored'))
    const observed = session.dispatch({
      type: CASE_COMMANDS.observeEvidence,
      payload: { evidenceId: 'opening_record' },
    })
    expect(observed.ok).toBe(true)

    const receipt = await session.persist(storage, 'detective-one')
    expect(receipt).toEqual({
      key: {
        saveId: 'detective-one',
        caseId: 'demo.session-controller',
        caseVersion: '0.1.0',
        kernelIrDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      revision: observed.snapshot.revision,
    })
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.key)).toBe(true)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]!.value)).toMatchObject({
      schemaVersion: KERNEL_SAVE_SCHEMA_VERSION,
      case: {
        id: 'demo.session-controller',
        version: '0.1.0',
      },
    })
    expect(writes[0]!.value).not.toContain('snapshot')

    const restored = await restoreCaseSessionControllerFromStorage(
      runtime('loaded'),
      storage,
      'detective-one',
    )
    expect(restored?.getSnapshot()).toEqual(session.getSnapshot())
    const deleted = await deleteCaseSessionFromStorage(
      runtime('delete'),
      storage,
      'detective-one',
    )
    expect(deleted).toEqual(receipt.key)
    await expect(
      restoreCaseSessionControllerFromStorage(runtime('after-delete'), storage, 'detective-one'),
    ).resolves.toBeUndefined()
    const restarted = createCaseSessionController(runtime('fresh-run')).getSnapshot()
    expect(restarted.clocks).toMatchObject({ caseTimeMs: 0, activeTimeMs: 0 })
    expect(restarted.observations).toEqual([])
    expect(restarted.hypotheses).toEqual([])
    expect(restarted.finalConclusion).toBeUndefined()
    expect(restarted.outcome).toBeUndefined()
    await expect(
      restoreCaseSessionControllerFromStorage(runtime('missing'), storage, 'missing'),
    ).resolves.toBeUndefined()
    await expect(session.persist(storage, '   ')).rejects.toThrow(
      'saveId must be a non-empty string.',
    )
  })
})
