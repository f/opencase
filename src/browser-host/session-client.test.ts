import { describe, expect, it } from 'vitest'

import { compileCaseSourceOrThrow } from '../compiler'
import { compileToKernelIR } from '../case-runtime/adapter'
import type { CaseSaveStorage, CaseSaveStorageKey } from '../case-runtime/controller'
import type { StaticCaseRuntimeBundle } from './static-bundle'
import type { BrowserCaseRuntimeRepository } from './runtime-repository'
import { createBrowserGameSessionClient } from './session-client'

const CASE_SOURCE = `schema: case-source/v0.1
case:
  id: demo.browser-host
  version: 0.1.0
  title: Browser Host
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "09:00"}
  synopsis: A browser host fixture.
use: [investigation@1, artifacts@1, generic-actions@1]
assets:
  clue-photo:
    kind: image
    source: {https: "https://assets.example.test/clue.png"}
    mime_type: image/png
    visibility: public
    integrity: {sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
cast:
  caller: {name: Caller, role: client, client: true}
  subject: {name: Subject, role: subject}
places: {room: Test Room}
things: {record: {type: document, name: Record}}
truth:
  events:
    hidden_event: {at: "08:59", type: record.created, actor: subject, object: record, place: room}
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
    assets: [clue-photo]
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
  resolved: {title: Resolved, priority: 100, require: [locate_record]}
`

function runtimeBundle(): StaticCaseRuntimeBundle {
  const compiled = compileCaseSourceOrThrow(CASE_SOURCE, {
    fileName: 'browser-host.case.yml',
  }).ir
  const kernelIr = compileToKernelIR(compiled)
  return {
    schema: 'case-static-runtime/v1',
    case: {
      id: kernelIr.id,
      version: kernelIr.version,
      kernelDigest: kernelIr.digest,
      packageDigest: 'sha256:fixture-package',
      defaultLocale: 'en',
    },
    kernelIr,
    presentations: {
      en: { defaultLocale: 'en', locale: 'en', messages: {} },
    },
    assets: [{
      id: 'clue-photo',
      kind: 'image',
      mimeType: 'image/png',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      url: './assets/clue.png',
    }],
    integrity: { algorithm: 'sha256', bundle: 'fixture-runtime' },
  }
}

function storageFixture(): {
  storage: CaseSaveStorage
  values: Map<string, string>
  writes: string[]
  deletes: string[]
} {
  const values = new Map<string, string>()
  const writes: string[] = []
  const deletes: string[] = []
  const key = (value: CaseSaveStorageKey) => JSON.stringify(value)
  return {
    values,
    writes,
    deletes,
    storage: {
      async read(value) {
        return values.get(key(value))
      },
      async write(value, serializedSave) {
        writes.push(serializedSave)
        values.set(key(value), serializedSave)
      },
      async delete(value) {
        deletes.push(key(value))
        values.delete(key(value))
      },
    },
  }
}

function repository(bundle = runtimeBundle()): BrowserCaseRuntimeRepository {
  return {
    async loadRuntime(caseId, caseVersion) {
      if (caseId !== bundle.case.id || caseVersion !== bundle.case.version) {
        throw new Error('missing case')
      }
      return {
        bundle,
        assetUrls: { 'clue-photo': 'blob:https://detective.test/clue-photo' },
      }
    },
  }
}

const REF = {
  caseId: 'demo.browser-host',
  caseVersion: '0.1.0',
  locale: 'en',
  saveId: 'detective-one',
} as const

describe('static browser game session client', () => {
  it('starts, persists, restores, and deletes an opaque engine save', async () => {
    const saved = storageFixture()
    const client = createBrowserGameSessionClient({
      repository: repository(),
      storage: saved.storage,
      now: () => 1_000,
      nextId: (() => {
        let id = 0
        return () => `browser-event-${++id}`
      })(),
    })

    expect(await client.status(REF)).toMatchObject({ exists: false })
    const started = await client.start(REF)
    expect(started).toMatchObject({ exists: true, snapshot: { revision: 1 } })
    expect(saved.writes).toHaveLength(1)
    expect(saved.writes[0]).toContain('kernel-save@1')

    const observed = await client.command(REF, {
      kind: 'observe',
      evidenceId: 'opening_record',
    })
    expect(observed.ok).toBe(true)
    expect(observed.snapshot.evidence[0]).toMatchObject({
      id: 'opening_record',
      observed: true,
    })
    expect(saved.writes).toHaveLength(2)

    const restoredClient = createBrowserGameSessionClient({
      repository: repository(),
      storage: saved.storage,
      now: () => 1_000,
      nextId: () => 'restored-event',
    })
    const restored = await restoredClient.status(REF)
    expect(restored.snapshot?.evidence[0]).toMatchObject({ observed: true })

    const restarted = await restoredClient.restart(REF)
    expect(restarted.exists).toBe(false)
    expect(saved.values.size).toBe(0)
    expect(saved.deletes).toHaveLength(1)
  })

  it('does not persist rejected commands and only resolves projected asset handles', async () => {
    const saved = storageFixture()
    const bundle = runtimeBundle()
    const client = createBrowserGameSessionClient({
      repository: repository(bundle),
      storage: saved.storage,
      now: () => 1_000,
      nextId: () => 'browser-event',
    })
    const started = await client.start(REF)
    const rejected = await client.command(REF, {
      kind: 'deduce',
      deductionId: 'missing-deduction',
    })
    expect(rejected.ok).toBe(false)
    expect(saved.writes).toHaveLength(1)

    const assetSessionId = started.assetSessionId
    const snapshot = started.snapshot
    expect(assetSessionId).toBeTruthy()
    expect(snapshot).toBeTruthy()
    if (!assetSessionId || !snapshot) throw new Error('Expected a started session')
    expect(client.assetUrl(REF, {
      assetSessionId,
      caseDigest: bundle.case.kernelDigest,
      assetId: 'clue-photo',
    }, snapshot)).toBe('blob:https://detective.test/clue-photo')
    expect(client.assetUrl(REF, {
      assetSessionId: 'wrong-session',
      caseDigest: bundle.case.kernelDigest,
      assetId: 'clue-photo',
    }, snapshot)).toBeUndefined()
  })

  it('does not publish an accepted command in memory when durable storage fails', async () => {
    const saved = storageFixture()
    let writes = 0
    let ids = 0
    const client = createBrowserGameSessionClient({
      repository: repository(),
      storage: {
        ...saved.storage,
        async write(key, value) {
          writes += 1
          if (writes > 1) throw new Error('quota exceeded')
          await saved.storage.write(key, value)
        },
      },
      now: () => 1_000,
      nextId: () => `browser-event-${++ids}`,
    })
    await client.start(REF)
    await expect(client.command(REF, {
      kind: 'observe',
      evidenceId: 'opening_record',
    })).rejects.toThrow('quota exceeded')
    const afterFailure = await client.status(REF)
    expect(afterFailure.snapshot?.evidence[0]).toMatchObject({ observed: false })
  })
})
