import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type {
  CaseSaveStorage,
  CaseSaveStorageKey,
  PublicCaseRuntimeState,
} from '../../src/case-runtime'
import {
  createDemoAssetUrl,
  PRIMARY_DEMO_SAVE_ID,
  type DemoBrowserIntent,
  type DemoCaseSessionRef,
} from '../../src/demo-host-client'

import { createFileCaseSaveStorage } from './file-save-storage'
import { loadDemoCaseRegistry, type DemoCaseRegistry } from './registry'
import { createDemoSessionService, DemoHostRequestError } from './service'
import { demoAssetHeaders } from './vite-plugin'

function storageKey(key: CaseSaveStorageKey): string {
  return JSON.stringify(key)
}

class MemoryStorage implements CaseSaveStorage {
  readonly values = new Map<string, string>()
  readonly writes: Array<{ key: CaseSaveStorageKey; value: string }> = []
  readonly deletes: CaseSaveStorageKey[] = []
  #blockedWrite?: {
    readonly started: Promise<void>
    readonly announce: () => void
    readonly wait: Promise<void>
    readonly release: () => void
  }

  blockNextWrite(): { started: Promise<void>; release: () => void } {
    let announce = (): void => undefined
    let release = (): void => undefined
    const started = new Promise<void>((resolveStarted) => { announce = resolveStarted })
    const wait = new Promise<void>((resolveWrite) => { release = resolveWrite })
    this.#blockedWrite = { started, announce, wait, release }
    return { started, release }
  }

  async read(key: CaseSaveStorageKey): Promise<string | undefined> {
    return this.values.get(storageKey(key))
  }

  async write(key: CaseSaveStorageKey, value: string): Promise<void> {
    const blocker = this.#blockedWrite
    if (blocker) {
      this.#blockedWrite = undefined
      blocker.announce()
      await blocker.wait
    }
    const copy = structuredClone(key)
    this.writes.push({ key: copy, value })
    this.values.set(storageKey(copy), value)
  }

  async delete(key: CaseSaveStorageKey): Promise<void> {
    const copy = structuredClone(key)
    this.deletes.push(copy)
    this.values.delete(storageKey(copy))
  }
}

function firstOfferedAction(snapshot: PublicCaseRuntimeState): DemoBrowserIntent {
  const affordance = snapshot.affordances.find(({intent}) => intent.kind === 'action')
  if (!affordance || affordance.intent.kind !== 'action') {
    throw new Error('The demo host test requires one initially offered action affordance.')
  }
  return {kind: 'action', ...affordance.intent.action}
}

describe('trusted local demo session host', () => {
  let registry: DemoCaseRegistry
  let sessionRef: Required<DemoCaseSessionRef>

  beforeAll(async () => {
    registry = await loadDemoCaseRegistry({
      casesDirectory: resolve(import.meta.dirname, '..', '..', 'cases'),
    })
    const selected = registry.list()[0]!
    sessionRef = {
      caseId: selected.caseId,
      caseVersion: selected.caseVersion,
      locale: selected.compiled.localization.defaultLocale,
      saveId: PRIMARY_DEMO_SAVE_ID,
    }
  }, 30_000)

  it('discovers and compiles the installed case packages on the trusted side', () => {
    expect(registry.list().length).toBeGreaterThanOrEqual(2)
    expect(new Set(registry.list().map(({ caseId }) => caseId)).size).toBe(
      registry.list().length,
    )
    for (const entry of registry.list()) {
      expect(entry.runtime.kernel.caseIR.digest).toBe(entry.compiled.kernelDigest)
    }
  })

  it('reports no save before start and persists a fresh public session', async () => {
    const storage = new MemoryStorage()
    const service = createDemoSessionService({ registry, storage })

    await expect(service.status(sessionRef)).resolves.toMatchObject({
      schema: 'detective-demo-session/v1',
      exists: false,
      caseId: sessionRef.caseId,
      caseVersion: sessionRef.caseVersion,
      saveId: PRIMARY_DEMO_SAVE_ID,
    })

    const started = await service.start(sessionRef)
    expect(started.exists).toBe(true)
    expect(started.snapshot).toMatchObject({
      schema: 'case-runtime/public-v1',
      revision: 1,
      clocks: { caseTimeMs: 0, activeTimeMs: 0 },
      observations: [],
      hypotheses: [],
    })
    expect(started.snapshot?.evidence.every(({ observed }) => !observed)).toBe(true)
    expect(storage.writes).toHaveLength(1)
    expect(JSON.parse(storage.writes[0]!.value)).toMatchObject({
      schemaVersion: 'kernel-save@1',
    })
    const publicBytes = JSON.stringify(started)
    expect(publicBytes).not.toContain('eventLog')
    expect(publicBytes).not.toContain('capabilityState')
    expect(publicBytes).not.toContain('kernel-save@1')
  })

  it('autosaves accepted closed intents and resumes them in a new host instance', async () => {
    const storage = new MemoryStorage()
    const firstHost = createDemoSessionService({ registry, storage })
    const started = await firstHost.start(sessionRef)
    if (!started.snapshot) throw new Error('Expected a started snapshot.')

    const progressed = await firstHost.command(sessionRef, firstOfferedAction(started.snapshot))
    expect(progressed.ok).toBe(true)
    expect(progressed.snapshot.revision).toBeGreaterThan(started.snapshot.revision)
    expect(storage.writes).toHaveLength(2)

    const resumed = await createDemoSessionService({ registry, storage }).status(sessionRef)
    expect(resumed.exists).toBe(true)
    expect(resumed.snapshot).toEqual(progressed.snapshot)

    const writesBeforeRejection = storage.writes.length
    const rejected = await firstHost.command(sessionRef, {
      kind: 'observe',
      evidenceId: 'missing-public-evidence',
    })
    expect(rejected.ok).toBe(false)
    if (rejected.ok) throw new Error('Expected a rejected command.')
    expect(rejected.error.code).toBe('unknown-evidence')
    expect(storage.writes).toHaveLength(writesBeforeRejection)
  })

  it('observes authored wall deadlines through status without writing on every poll', async () => {
    let wallNowMs = 10_000
    let id = 0
    const wallRegistry = await loadDemoCaseRegistry({
      casesDirectory: resolve(import.meta.dirname, '..', '..', 'cases'),
      now: () => wallNowMs,
      nextId: () => `wall-refresh-${++id}`,
    })
    const selected = wallRegistry.list().find(({ compiled }) => (
      compiled.result.ir.private.deadlines.some(({ clock }) => clock === 'wall')
    ))
    if (!selected) throw new Error('Expected an installed case with a wall deadline.')
    const ref: Required<DemoCaseSessionRef> = {
      caseId: selected.caseId,
      caseVersion: selected.caseVersion,
      locale: selected.compiled.localization.defaultLocale,
      saveId: PRIMARY_DEMO_SAVE_ID,
    }
    const storage = new MemoryStorage()
    const service = createDemoSessionService({ registry: wallRegistry, storage })
    const started = await service.start(ref)
    const openingDeadline = started.snapshot?.deadlines.find(({ clock }) => clock === 'wall')
    if (!started.snapshot || !openingDeadline) throw new Error('Expected a projected wall deadline.')

    wallNowMs += 1_000
    const throttled = await service.status(ref)
    expect(throttled.snapshot?.revision).toBe(started.snapshot.revision)
    expect(storage.writes).toHaveLength(1)

    wallNowMs += 4_000
    const ticked = await service.status(ref)
    expect(ticked.snapshot?.clocks.wallTimeMs).toBe(wallNowMs)
    expect(ticked.snapshot?.deadlines.find(({ id: deadlineId }) => (
      deadlineId === openingDeadline.id
    ))?.remainingMs).toBe(openingDeadline.remainingMs - 5_000)
    expect(storage.writes).toHaveLength(2)

    wallNowMs = openingDeadline.dueAtMs + 1
    const fired = await service.status(ref)
    expect(fired.snapshot?.clocks.wallTimeMs).toBe(wallNowMs)
    expect(fired.snapshot?.deadlines.find(({ id: deadlineId }) => (
      deadlineId === openingDeadline.id
    ))).toMatchObject({ status: 'fired', remainingMs: 0 })
    expect(storage.writes).toHaveLength(3)
  }, 30_000)

  it('never lets start overwrite an existing primary save', async () => {
    const storage = new MemoryStorage()
    const service = createDemoSessionService({ registry, storage })
    const started = await service.start(sessionRef)
    if (!started.snapshot) throw new Error('Expected a started snapshot.')
    const progressed = await service.command(sessionRef, firstOfferedAction(started.snapshot))
    expect(progressed.ok).toBe(true)
    const writesBeforeSecondStart = storage.writes.length

    await expect(service.start(sessionRef)).rejects.toMatchObject({
      name: 'DemoHostRequestError',
      code: 'session-already-started',
      status: 409,
    } satisfies Partial<DemoHostRequestError>)
    expect(storage.writes).toHaveLength(writesBeforeSecondStart)
    const current = await service.status(sessionRef)
    expect(current.snapshot).toEqual(progressed.snapshot)
  })

  it('isolates the same case save between player profile slots', async () => {
    const storage = new MemoryStorage()
    const service = createDemoSessionService({ registry, storage })
    const firstProfile = { ...sessionRef, saveId: 'detective_alpha' }
    const secondProfile = { ...sessionRef, saveId: 'detective_beta' }

    const firstStarted = await service.start(firstProfile)
    if (!firstStarted.snapshot) throw new Error('Expected a started snapshot.')
    const firstProgressed = await service.command(
      firstProfile,
      firstOfferedAction(firstStarted.snapshot),
    )
    expect(firstProgressed.ok).toBe(true)

    const secondStarted = await service.start(secondProfile)
    expect(secondStarted).toMatchObject({
      exists: true,
      saveId: 'detective_beta',
      snapshot: { revision: 1 },
    })
    expect(firstProgressed.snapshot.revision).toBeGreaterThan(1)
    await expect(service.status(firstProfile)).resolves.toMatchObject({
      saveId: 'detective_alpha',
      snapshot: { revision: firstProgressed.snapshot.revision },
    })

    await service.restart(secondProfile)
    await expect(service.status(secondProfile)).resolves.toMatchObject({ exists: false })
    await expect(service.status(firstProfile)).resolves.toMatchObject({
      exists: true,
      snapshot: { revision: firstProgressed.snapshot.revision },
    })
  })

  it('rejects unsafe profile save identifiers before storage lookup', async () => {
    const service = createDemoSessionService({ registry, storage: new MemoryStorage() })
    for (const saveId of ['../other-profile', 'profile:one', '', 'a'.repeat(65)]) {
      await expect(service.status({ ...sessionRef, saveId })).rejects.toMatchObject({
        name: 'DemoHostRequestError',
        code: saveId === '' || saveId.length > 64 ? 'invalid-request' : 'invalid-save-id',
        status: 400,
      })
    }
  })

  it('deletes only the exact primary case/build slot and starts cleanly again', async () => {
    const storage = new MemoryStorage()
    const service = createDemoSessionService({ registry, storage })
    const started = await service.start(sessionRef)
    if (!started.snapshot) throw new Error('Expected a started snapshot.')
    await service.command(sessionRef, firstOfferedAction(started.snapshot))
    const primaryKey = storage.writes.at(-1)!.key
    const unrelatedKey: CaseSaveStorageKey = {
      ...primaryKey,
      saveId: 'another-detective',
    }
    storage.values.set(storageKey(unrelatedKey), 'unrelated opaque bytes')

    const restarted = await service.restart(sessionRef)
    expect(restarted).toMatchObject({ exists: false, saveId: PRIMARY_DEMO_SAVE_ID })
    expect(restarted.snapshot).toBeUndefined()
    expect(storage.deletes).toEqual([primaryKey])
    expect(storage.values.has(storageKey(primaryKey))).toBe(false)
    expect(storage.values.get(storageKey(unrelatedKey))).toBe('unrelated opaque bytes')
    await expect(service.status(sessionRef)).resolves.toMatchObject({ exists: false })

    const fresh = await service.start(sessionRef)
    expect(fresh.snapshot).toMatchObject({
      revision: 1,
      clocks: { caseTimeMs: 0, activeTimeMs: 0 },
      observations: [],
      hypotheses: [],
    })
    expect(fresh.snapshot?.evidence.every(({ observed }) => !observed)).toBe(true)
    expect(fresh.snapshot?.finalConclusion).toBeUndefined()
    expect(fresh.snapshot?.outcome).toBeUndefined()
  })

  it('queues restart behind an in-flight autosave so stale bytes cannot resurrect', async () => {
    const storage = new MemoryStorage()
    const service = createDemoSessionService({ registry, storage })
    const started = await service.start(sessionRef)
    if (!started.snapshot) throw new Error('Expected a started snapshot.')
    const primaryKey = storage.writes[0]!.key
    const blocker = storage.blockNextWrite()

    const command = service.command(sessionRef, firstOfferedAction(started.snapshot))
    await blocker.started
    const restart = service.restart(sessionRef)
    await Promise.resolve()
    expect(storage.deletes).toHaveLength(0)

    blocker.release()
    await expect(command).resolves.toMatchObject({ ok: true })
    await expect(restart).resolves.toMatchObject({ exists: false })
    expect(storage.deletes).toEqual([primaryKey])
    expect(storage.values.has(storageKey(primaryKey))).toBe(false)
    await expect(service.status(sessionRef)).resolves.toMatchObject({ exists: false })
  })

  it('delivers only current projected handles through a run-bound opaque URL', async () => {
    const assetRegistry = await loadDemoCaseRegistry({
      casesDirectory: resolve(import.meta.dirname, '..', '..', 'examples', 'cases'),
    })
    const selected = assetRegistry.get('examples.yard-switch', '0.1.1')
    const ref: Required<DemoCaseSessionRef> = {
      caseId: selected.caseId,
      caseVersion: selected.caseVersion,
      locale: selected.compiled.localization.defaultLocale,
      saveId: PRIMARY_DEMO_SAVE_ID,
    }
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'detective-demo-assets-'))
    let run = 0
    const service = createDemoSessionService({
      registry: assetRegistry,
      storage: new MemoryStorage(),
      assetCacheDirectory: cacheDirectory,
      nextAssetSessionId: () => `asset-run-${++run}`,
    })

    try {
      const started = await service.start(ref)
      if (!started.snapshot || !started.assetSessionId) {
        throw new Error('Expected an asset-enabled session.')
      }
      const projected = started.snapshot.evidence.flatMap(({ assets }) => assets)
      const handle = projected.find(({ id }) => id === 'switch-plan')
      if (!handle) throw new Error('Expected the projected switch-plan handle.')
      expect(projected.some(({ id }) => id === 'radio-maintenance-log')).toBe(false)

      const request = {
        assetSessionId: started.assetSessionId,
        caseDigest: started.snapshot.case.digest,
        assetId: handle.id,
      }
      const delivered = await service.asset(ref, request)
      expect(delivered).toMatchObject({
        kind: 'verified-file',
        assetKind: 'image',
        mimeType: 'image/png',
        contentDisposition: 'inline',
      })
      expect((await readFile(delivered.absolutePath)).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
      expect(demoAssetHeaders(delivered)).toMatchObject({
        'content-type': 'image/png',
        'content-length': String(delivered.sizeBytes),
        'content-disposition': 'inline; filename="case-asset.png"',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'accept-ranges': 'bytes',
        'cross-origin-resource-policy': 'same-origin',
      })

      const deliveryUrl = createDemoAssetUrl({
        ...ref,
        assetSessionId: started.assetSessionId,
        caseDigest: started.snapshot.case.digest,
      }, handle.id)
      expect(deliveryUrl).toContain('/api/demo/session/asset?')
      expect(deliveryUrl).toContain('assetSessionId=asset-run-1')
      expect(deliveryUrl).not.toContain(selected.compiled.packageRoot)
      expect(deliveryUrl).not.toContain('assets%2F')

      const failures = await Promise.all([
        service.asset(ref, { ...request, assetId: 'radio-maintenance-log' }),
        service.asset(ref, { ...request, assetId: 'guessed-private-handle' }),
        service.asset(ref, { ...request, caseDigest: 'stale-kernel-digest' }),
        service.asset(ref, { ...request, assetSessionId: 'stale-run' }),
      ].map((promise) => promise.catch((error: unknown) => error)))
      for (const failure of failures) {
        expect(failure).toMatchObject({
          code: 'asset-unavailable',
          status: 404,
          message: 'The requested asset is not available to this session.',
        })
      }

      await service.restart(ref)
      const restarted = await service.start(ref)
      expect(restarted.assetSessionId).toBe('asset-run-2')
      await expect(service.asset(ref, request)).rejects.toMatchObject({
        code: 'asset-unavailable',
        status: 404,
      })
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  }, 60_000)

  it('releases the session queue during materialization and rejects a capture invalidated by restart', async () => {
    const selected = registry.get('community.fka.yedi-dakika', '0.4.2')
    const ref: Required<DemoCaseSessionRef> = {
      caseId: selected.caseId,
      caseVersion: selected.caseVersion,
      locale: selected.compiled.localization.defaultLocale,
      saveId: PRIMARY_DEMO_SAVE_ID,
    }
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'detective-slow-asset-'))
    let announceMaterialization = (): void => undefined
    let releaseMaterialization = (): void => undefined
    const materializationStarted = new Promise<void>((resolveStarted) => {
      announceMaterialization = resolveStarted
    })
    const materializationRelease = new Promise<void>((resolveRelease) => {
      releaseMaterialization = resolveRelease
    })
    let gatewayCreations = 0
    let authorizationAccepted = false
    const service = createDemoSessionService({
      registry,
      storage: new MemoryStorage(),
      assetCacheDirectory: cacheDirectory,
      nextAssetSessionId: () => 'slow-run',
      nextAssetAuthorizationGrant: () => 'single-use-grant',
      createAssetGateway: (_compiled, gatewayOptions) => {
        gatewayCreations += 1
        return {
          async deliver(context) {
            authorizationAccepted = gatewayOptions.authorize(context)
            announceMaterialization()
            await materializationRelease
            return {
              kind: 'verified-file',
              assetKind: 'image',
              absolutePath: join(cacheDirectory, 'fake.asset'),
              mimeType: 'image/png',
              digest: 'a'.repeat(64),
              sizeBytes: 1,
              contentDisposition: 'inline',
              acceptRanges: true,
            }
          },
        }
      },
    })

    try {
      const started = await service.start(ref)
      if (!started.snapshot || !started.assetSessionId) {
        throw new Error('Expected an asset-enabled session.')
      }
      const unlocked = await service.command(ref, {
        kind: 'action',
        action: 'request',
        from: 'leyla',
        topic: 'lobby-video',
      })
      expect(unlocked.ok).toBe(true)
      const request = service.asset(ref, {
        assetSessionId: started.assetSessionId,
        caseDigest: started.snapshot.case.digest,
        assetId: 'lobby-cctv-still',
      })
      await materializationStarted
      expect(authorizationAccepted).toBe(true)

      const restart = service.restart(ref)
      const queueStayedResponsive = await Promise.race([
        restart.then(() => true),
        new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 250)),
      ])
      expect(queueStayedResponsive).toBe(true)

      releaseMaterialization()
      await expect(request).rejects.toMatchObject({
        code: 'asset-unavailable',
        status: 404,
      })
      expect(gatewayCreations).toBe(1)
    } finally {
      releaseMaterialization()
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  })
})

describe('private file save adapter', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'detective-demo-storage-'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('round-trips opaque bytes and deletes only the derived exact-key file', async () => {
    const storage = createFileCaseSaveStorage(directory)
    const first: CaseSaveStorageKey = {
      saveId: PRIMARY_DEMO_SAVE_ID,
      caseId: 'fixture.case',
      caseVersion: '1.0.0',
      kernelIrDigest: 'digest-a',
    }
    const second: CaseSaveStorageKey = { ...first, caseVersion: '2.0.0' }
    await storage.write(first, 'opaque-one')
    await storage.write(second, 'opaque-two')

    await expect(storage.read(first)).resolves.toBe('opaque-one')
    await expect(storage.read(second)).resolves.toBe('opaque-two')
    expect(storage.pathFor(first)).not.toBe(storage.pathFor(second))

    await storage.delete(first)
    await expect(storage.read(first)).resolves.toBeUndefined()
    await expect(storage.read(second)).resolves.toBe('opaque-two')
  })
})
