import { describe, expect, it } from 'vitest'

import type { PublicCaseRuntimeState } from '../case-runtime'
import {
  createManifestWorkspaceModels,
  type ShellPublicCaseManifest,
} from './manifest-workspace'

const manifest: ShellPublicCaseManifest = {
  schema: 'case-public/v0.2',
  case: {
    id: 'fixture.shell-case',
    version: '1.0.0',
    title: 'Shell Fixture',
    durationMinutes: 15,
    synopsis: 'A presentation-only fixture.',
    time: { date: '2026-08-15', startsAt: '21:00' },
  },
  cast: {
    caller: { name: 'Case Caller', role: 'client' },
    witness: { name: 'Case Witness', role: 'witness' },
  },
  assets: [],
  opening: {
    call: { from: 'caller', text: 'Please investigate.' },
    evidence: [{ id: 'opening_note', tool: 'document', assets: [] }],
  },
  integrity: { manifest: 'sha256:fixture' },
}

const runtime: PublicCaseRuntimeState = {
  schema: 'case-runtime/public-v1',
  status: 'active',
  revision: 4,
  case: { id: 'fixture.shell-case', version: '1.0.0', digest: 'sha256:runtime' },
  clocks: { caseTimeMs: 0, activeTimeMs: 0, wallTimeMs: 0 },
  affordances: [
    {
      id: 'repair-contact',
      surface: 'phone',
      risk: 'normal',
      intent: {
        kind: 'action',
        action: { action: 'apologize', target: 'witness', tone: 'direct' },
      },
      label: 'Doğrudan özür dile',
      cost: { clock: 'case-time', milliseconds: 120_000 },
    },
    {
      id: 'blocked-interview',
      surface: 'phone',
      risk: 'normal',
      intent: {
        kind: 'action',
        action: { action: 'interview', actor: 'witness', topic: 'timeline' },
      },
      label: 'Zaman çizelgesini yeniden sor',
      cost: { clock: 'case-time', milliseconds: 60_000 },
    },
    {
      id: 'listen-hotline',
      surface: 'phone',
      risk: 'normal',
      intent: { kind: 'action', action: { action: 'open', ref: 'public-hotline' } },
      label: 'İhbar hattını dinle',
    },
    {
      id: 'search-registry',
      surface: 'web',
      risk: 'normal',
      intent: { kind: 'action', action: { action: 'search', query: 'fixture registry' } },
      labelKey: 'affordances.search-registry',
      cost: { clock: 'case-time', milliseconds: 30_000 },
    },
    {
      id: 'request-export',
      surface: 'files',
      risk: 'normal',
      intent: { kind: 'action', action: { action: 'request', topic: 'export' } },
      label: 'Dışa aktarımı talep et',
    },
    {
      id: 'record-lead',
      surface: 'casebook',
      risk: 'consequential',
      intent: { kind: 'action', action: { action: 'mark', ref: 'lead' } },
      label: 'İpucunu kaydet',
      confirmation: 'Bu kayıt soruşturma dosyasına kalıcı olarak eklenecek.',
    },
    {
      id: 'test-theory',
      surface: 'casebook',
      risk: 'normal',
      intent: { kind: 'deduce', deductionId: 'theory-one' },
      label: 'Birinci teoriyi sına',
      cost: { clock: 'case-time', milliseconds: 60_000 },
    },
  ],
  completedAffordances: [],
  supportedDeductions: [{ id: 'theory-two', label: 'İkinci teori doğrulandı' }],
  actors: [{
    id: 'witness',
    conversation: {
      state: 'closed',
      canTalk: false,
      reason: 'Contact is temporarily closed.',
      channels: [
        { action: 'interview', actorField: 'actor', available: false },
        { action: 'apologize', actorField: 'target', available: true },
      ],
    },
  }],
  evidence: [
    {
      id: 'opening_note',
      tool: 'document',
      observed: true,
      title: 'Açılış notu',
      description: 'İmzalı açılış kaydı.',
      findings: [{ field: 'time', text: 'Kayıt 21:04 saatini gösteriyor.' }],
      assets: [
        { id: 'scene-photo', kind: 'image', mimeType: 'image/png' },
        { id: 'witness-audio', kind: 'audio', mimeType: 'audio/mpeg' },
      ],
    },
    {
      id: 'unread_export',
      tool: 'document',
      observed: false,
      title: 'Okunmamış dışa aktarım',
      findings: [],
      assets: [],
    },
  ],
  deadlines: [],
  observations: [],
  hypotheses: [],
}

describe('manifest workspace projection adapter', () => {
  it('keeps recovery actions available while an actor refuses ordinary contact', () => {
    const models = createManifestWorkspaceModels(
      manifest,
      { query: '', replyDraft: '' },
      runtime,
    )

    expect(models.phone.contacts).toEqual([{
      id: 'witness',
      name: 'Case Witness',
      roleLabel: 'Witness',
      detail: 'Contact is temporarily closed.',
      available: false,
      actions: [
        {
          action: 'apologize',
          affordanceId: 'repair-contact',
          available: true,
          costLabel: '+2 dk',
          label: 'Doğrudan özür dile',
        },
        {
          action: 'interview',
          affordanceId: 'blocked-interview',
          available: false,
          costLabel: '+1 dk',
          label: 'Zaman çizelgesini yeniden sor',
        },
      ],
    }])
    expect(models.phone.affordances).toEqual([{
      id: 'listen-hotline',
      label: 'İhbar hattını dinle',
    }])
    expect(models.files.records[0]?.status).toBe('observed')
  })

  it('routes only explicitly offered actions to their declared public surface', () => {
    const runtimeWithDeductionResult: PublicCaseRuntimeState = {
      ...runtime,
      completedAffordances: [{
        id: 'test-theory-two',
        surface: 'casebook',
        risk: 'normal',
        intent: { kind: 'deduce', deductionId: 'theory-two' },
        label: 'İkinci teori doğrulandı',
        result: 'Saat düzeltildiğinde gerçek çıkış zamanı 20:57.',
        completedAtMs: 240_000,
      }],
    }
    const models = createManifestWorkspaceModels(
      manifest,
      { query: '', replyDraft: '' },
      runtimeWithDeductionResult,
    )

    expect(models.caseDispatch.affordances).toEqual([{
      id: 'record-lead',
      label: 'İpucunu kaydet',
      risk: 'consequential',
      consequence: 'Bu kayıt soruşturma dosyasına kalıcı olarak eklenecek.',
    }])
    expect(models.caseDispatch.summary).toBe('A presentation-only fixture.')
    expect(models.caseDispatch.lifecycle).toBe('pending')
    expect(models.caseDispatch.evidence).toMatchObject({
      total: 2,
      observed: 1,
      decisive: 1,
    })
    expect(models.caseDispatch.evidence.items?.map(({ label }) => label)).toEqual(['Açılış notu'])
    expect(models.caseDispatch.affordances[0]).not.toHaveProperty('intent')
    expect(models.caseDispatch.affordances[0]).not.toHaveProperty('surface')
    expect(models.casebook.deductions).toEqual([{
      id: 'theory-one',
      title: 'Birinci teoriyi sına',
      status: 'ready',
      costLabel: '+1 dk',
    }, {
      id: 'theory-two',
      title: 'İkinci teori doğrulandı',
      status: 'supported',
      result: 'Saat düzeltildiğinde gerçek çıkış zamanı 20:57.',
      supportLabel: 'Kanıtlarla doğrulandı',
    }])
    expect(models.files.affordances).toEqual([{
      id: 'request-export',
      label: 'Dışa aktarımı talep et',
    }])
    expect(models.web.affordances).toEqual([{
      id: 'search-registry',
      label: 'Araştırma 1',
      costLabel: '+30 sn',
    }])
  })

  it('keeps opening notes concise and adds evidence notes only after observation', () => {
    const models = createManifestWorkspaceModels(
      manifest,
      { query: '', replyDraft: '' },
      runtime,
    )

    expect(models.casebook.entries.map(({ id }) => id)).toEqual([
      'public-briefing',
      'opening-call',
      'evidence-note-opening_note',
    ])
    expect(models.casebook.entries[0]?.evidence).toBeUndefined()
    expect(models.casebook.entries[1]?.evidence).toBeUndefined()
    expect(models.inbox.threads[0]?.badgeLabel).toBeUndefined()
    expect(models.files.records.map(({ id }) => id)).toEqual(['opening_note', 'unread_export'])
    expect(models.files.records[0]).toMatchObject({
      title: 'Açılış notu',
      findings: ['Kayıt 21:04 saatini gösteriyor.'],
    })
    expect(models.casebook.entries.find(({ id }) => id === 'evidence-note-opening_note')).toMatchObject({
      title: 'Açılış notu',
      findings: ['Kayıt 21:04 saatini gösteriyor.'],
    })
    expect(models.rail.evidence[0]?.label).toBe('Açılış notu')
    expect(models.casebook.leads).toHaveLength(5)
    expect(models.casebook.leads.map(({ surface }) => surface)).toEqual(expect.arrayContaining([
      'files', 'phone', 'web',
    ]))
  })

  it('turns authored completed-action copy into readable interview notes and web results', () => {
    const completedRuntime: PublicCaseRuntimeState = {
      ...runtime,
      completedAffordances: [{
        id: 'interview-witness',
        surface: 'phone',
        intent: { kind: 'action', action: { action: 'interview', actor: 'witness' } },
        label: 'Tanıkla görüş',
        result: 'Tanık, kapının 21:03’te açıldığını söyledi.',
        risk: 'normal',
        completedAtMs: 60_000,
      }, {
        id: 'search-registry',
        surface: 'web',
        intent: { kind: 'action', action: { action: 'search', query: 'fixture registry' } },
        label: 'Sicili ara',
        result: 'Sicil kaydı şirketin gerçek sahibini doğruluyor.',
        risk: 'normal',
        completedAtMs: 90_000,
      }, {
        id: 'search-registry',
        surface: 'web',
        intent: { kind: 'action', action: { action: 'search', query: 'fixture registry' } },
        label: 'Sicili yeniden ara',
        result: 'İkinci arama aynı kaydın güncel kopyasını buldu.',
        risk: 'normal',
        completedAtMs: 90_000,
      }],
    }
    const models = createManifestWorkspaceModels(
      manifest,
      { query: 'fixture registry', replyDraft: '', activeCallContactId: 'witness' },
      completedRuntime,
    )

    expect(models.phone.activeCall?.transcript).toEqual([
      'Tanık, kapının 21:03’te açıldığını söyledi.',
    ])
    expect(models.web.results[0]).toMatchObject({
      title: 'Sicili ara',
      excerpt: 'Sicil kaydı şirketin gerçek sahibini doğruluyor.',
      displayUrl: 'ekip.polnet/adli-evrak/sorgu/20260815-000090-01',
      sourceLabel: 'EKİP · Adli evrak sorgusu',
    })
    expect(models.web.results.map(({ id }) => id)).toEqual([
      'research-search-registry-90000-1',
      'research-search-registry-90000-2',
    ])
    expect(models.casebook.entries.map(({ body }) => body)).toContain(
      'Sicil kaydı şirketin gerçek sahibini doğruluyor.',
    )
    expect(models.casebook.entries.find(({ id }) => id.startsWith('action-note-interview')))
      .toMatchObject({ timestampLabel: '21:01' })
    expect(models.casebook.entries.find(({ id }) => id.endsWith('-90000-1')))
      .toMatchObject({ timestampLabel: '21:01:30' })

    const selected = createManifestWorkspaceModels(
      manifest,
      {
        query: 'fixture registry',
        replyDraft: '',
        activeResearchResultId: models.web.results[1]!.id,
      },
      completedRuntime,
    )
    expect(selected.web.activePage).toMatchObject({
      id: 'research-search-registry-90000-2',
      displayUrl: 'ekip.polnet/adli-evrak/sorgu/20260815-000090-02',
      paragraphs: ['İkinci arama aynı kaydın güncel kopyasını buldu.'],
    })
  })

  it('preserves every projected asset and adds only host-authorized delivery URLs', () => {
    const models = createManifestWorkspaceModels(
      manifest,
      { query: '', replyDraft: '' },
      runtime,
      ({ id }) => `/api/authorized-asset?handle=${encodeURIComponent(id)}`,
    )

    expect(models.files.records[0]?.assets).toEqual([
      {
        id: 'scene-photo',
        kind: 'image',
        label: 'Görsel 1',
        deliveryUrl: '/api/authorized-asset?handle=scene-photo',
      },
      {
        id: 'witness-audio',
        kind: 'audio',
        label: 'Ses kaydı 2',
        deliveryUrl: '/api/authorized-asset?handle=witness-audio',
      },
    ])
    expect(models.files.records[1]?.assets).toEqual([])
    expect(JSON.stringify(models.files)).not.toContain('/cases/')
    expect(JSON.stringify(models.files)).not.toContain('https://')
  })
})
