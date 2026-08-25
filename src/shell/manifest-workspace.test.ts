import { describe, expect, it } from 'vitest'

import type { PublicCaseRuntimeState } from '../case-runtime'
import { createCaseBoardViewModel } from './case-board-model'
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
  it('projects the current game clock into the phone status bar model', () => {
    const models = createManifestWorkspaceModels(
      manifest,
      { query: '', replyDraft: '' },
      {
        ...runtime,
        clocks: { ...runtime.clocks, caseTimeMs: 150_000 },
      },
    )

    expect(models.phone.clockLabel).toBe('21:02')
  })

  it('keeps an undiscovered actor out of Phone and anchors its authored lookup to the mention note', () => {
    const callerOnlyManifest: ShellPublicCaseManifest = {
      ...manifest,
      cast: { caller: manifest.cast.caller },
    }
    const discoveryRuntime: PublicCaseRuntimeState = {
      ...runtime,
      actors: [{
        id: 'caller',
        name: 'Case Caller',
        role: 'Client',
        conversation: {
          state: 'available',
          canTalk: true,
          channels: [],
        },
      }],
      affordances: [{
        id: 'find-hidden-witness',
        surface: 'inbox',
        risk: 'normal',
        label: 'Tanığı bul',
        intent: {
          kind: 'action',
          action: { action: 'locate-contact', target: 'hidden-witness' },
        },
        interaction: {
          kind: 'async-message',
          channel: 'forensics',
          request: 'Tanığın güncel iletişim kaydını doğrular mısın?',
          context: { kind: 'opening-call' },
        },
      }, {
        id: 'premature-hidden-call',
        surface: 'phone',
        risk: 'normal',
        label: 'Tanığı ara',
        intent: {
          kind: 'action',
          action: { action: 'interview', actor: 'hidden-witness' },
        },
      }],
    }

    const models = createManifestWorkspaceModels(
      callerOnlyManifest,
      { query: '', replyDraft: '', selectedEntryId: 'opening-call' },
      discoveryRuntime,
    )

    expect(models.phone.contacts.map(({ id }) => id)).toEqual(['caller'])
    expect(models.phone.affordances).toEqual([])
    expect(models.casebook.contactActions).toEqual([{
      affordanceId: 'find-hidden-witness',
      label: 'Tanığı bul',
      description: 'Tanığın güncel iletişim kaydını doğrular mısın?',
      destinationLabel: '#forensics',
      status: 'ready',
    }])
    expect(models.inbox.quickPrompts).toEqual([{
      affordanceId: 'find-hidden-witness',
      channelId: 'forensics',
      label: 'Tanığı bul',
      request: 'Tanığın güncel iletişim kaydını doğrular mısın?',
      status: 'ready',
    }])
    expect(JSON.stringify(models.phone)).not.toContain('hidden-witness')
    expect(JSON.stringify(createCaseBoardViewModel('Fixture', models.phone, models.files)))
      .not.toContain('hidden-witness')
  })

  it('selects the completed statement note that owns a newly offered contact lookup', () => {
    const contextualRuntime: PublicCaseRuntimeState = {
      ...runtime,
      completedAffordances: [{
        id: 'take-caller-statement',
        surface: 'phone',
        risk: 'normal',
        intent: { kind: 'action', action: { action: 'interview', actor: 'caller' } },
        label: 'İlk ifadeyi al',
        result: 'Arayan kişi, görüşülmesi gereken yeni bir tanığın adını verdi.',
        completedAtMs: 120_000,
      }],
      affordances: [{
        id: 'find-mentioned-witness',
        surface: 'inbox',
        risk: 'normal',
        label: 'Tanığın iletişim bilgisini bul',
        intent: {
          kind: 'action',
          action: { action: 'locate-contact', target: 'mentioned-witness' },
        },
        interaction: {
          kind: 'async-message',
          channel: 'forensics',
          request: 'İfadede adı geçen tanığın doğrulanmış iletişim bilgisini bulur musun?',
          context: { kind: 'completed-affordance', ref: 'take-caller-statement' },
        },
      }, {
        id: 'find-opening-contact',
        surface: 'inbox',
        risk: 'normal',
        label: 'Açılışta adı geçen kişiyi bul',
        intent: {
          kind: 'action',
          action: { action: 'locate-contact', target: 'opening-contact' },
        },
        interaction: {
          kind: 'async-message',
          channel: 'forensics',
          request: 'Açılışta adı geçen kişinin kaydını bulur musun?',
          context: { kind: 'opening-call' },
        },
      }],
    }

    const models = createManifestWorkspaceModels(
      manifest,
      { query: '', replyDraft: '' },
      contextualRuntime,
    )

    expect(models.casebook.selectedEntryId).toBe(
      'action-note-take-caller-statement-120000-0',
    )
    expect(models.casebook.contactActions).toEqual([expect.objectContaining({
      affordanceId: 'find-mentioned-witness',
      status: 'ready',
    })])
  })

  it('uses only the newly listed actor projection for realistic Phone metadata', () => {
    const listedRuntime: PublicCaseRuntimeState = {
      ...runtime,
      actors: [{
        id: 'new-witness',
        name: 'Deniz Kaya',
        role: 'Bağımsız tanık',
        phone: '+90 555 010 20 30',
        operator: 'Anadolu Mobil',
        contactSource: 'Adli inceleme dizini',
        conversation: {
          state: 'available',
          canTalk: true,
          channels: [],
        },
      }],
      affordances: [],
    }
    const models = createManifestWorkspaceModels(
      { ...manifest, cast: { caller: manifest.cast.caller } },
      { query: '', replyDraft: '', newContactIds: ['new-witness'] },
      listedRuntime,
    )

    expect(models.phone.contacts).toEqual([expect.objectContaining({
      id: 'new-witness',
      name: 'Deniz Kaya',
      roleLabel: 'Bağımsız tanık',
      phoneNumber: '+90 555 010 20 30',
      operatorLabel: 'Anadolu Mobil',
      sourceLabel: 'Adli inceleme dizini',
      newlyAdded: true,
    })])
  })

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

  it('projects completed contact calls into stable newest-first recents', () => {
    const completedRuntime: PublicCaseRuntimeState = {
      ...runtime,
      completedAffordances: [{
        id: 'first-witness-call',
        surface: 'phone',
        intent: { kind: 'action', action: { action: 'interview', actor: 'witness' } },
        label: 'İlk ifadeyi al',
        result: 'Tanık ilk ifadesini verdi.',
        risk: 'normal',
        cost: { clock: 'case-time', milliseconds: 60_000 },
        completedAtMs: 120_000,
      }, {
        id: 'follow-up-witness-call',
        surface: 'phone',
        intent: { kind: 'action', action: { action: 'interview', actor: 'witness', topic: 'timeline' } },
        label: 'Zaman çizelgesini yeniden sor',
        result: 'Tanık zaman çizelgesini netleştirdi.',
        risk: 'normal',
        cost: { clock: 'case-time', milliseconds: 30_000 },
        completedAtMs: 210_000,
      }, {
        id: 'search-registry',
        surface: 'web',
        intent: { kind: 'action', action: { action: 'search', query: 'fixture registry' } },
        label: 'Sicili ara',
        result: 'Sicil kaydı bulundu.',
        risk: 'normal',
        completedAtMs: 240_000,
      }, {
        id: 'call-unlisted-person',
        surface: 'phone',
        intent: { kind: 'action', action: { action: 'interview', actor: 'unlisted-person' } },
        label: 'Listelenmemiş kişiyi ara',
        result: 'Bu kayıt oyuncuya açık bir kişiye bağlanamıyor.',
        risk: 'normal',
        cost: { clock: 'case-time', milliseconds: 60_000 },
        completedAtMs: 300_000,
      }],
    }

    const models = createManifestWorkspaceModels(
      manifest,
      { query: '', replyDraft: '' },
      completedRuntime,
    )

    expect(models.phone.recentCalls).toMatchObject([{
      contactId: 'witness',
      contactName: 'Case Witness',
      detailLabel: 'Zaman çizelgesini yeniden sor',
      timestampLabel: '21:03',
      durationLabel: '30 sn',
      direction: 'outgoing',
    }, {
      contactId: 'witness',
      contactName: 'Case Witness',
      detailLabel: 'İlk ifadeyi al',
      timestampLabel: '21:01',
      durationLabel: '1 dk',
      direction: 'outgoing',
    }, {
      id: 'opening-caller',
      contactId: 'caller',
      contactName: 'Case Caller',
      timestampLabel: '21:00',
      direction: 'incoming',
    }])
    expect(models.phone.recentCalls).toHaveLength(3)
    expect(new Set(models.phone.recentCalls.map(({ id }) => id)).size).toBe(3)
    expect(models.phone.recentCalls.map(({ id }) => id)).toEqual(
      createManifestWorkspaceModels(
        manifest,
        { query: '', replyDraft: '' },
        completedRuntime,
      ).phone.recentCalls.map(({ id }) => id),
    )
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
    expect(createCaseBoardViewModel('Fixture', models.phone, models.files).pins)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'evidence',
          title: 'Açılış notu',
          asset: expect.objectContaining({ id: 'scene-photo' }),
        }),
      ]))
    expect(JSON.stringify(createCaseBoardViewModel('Fixture', models.phone, models.files)))
      .not.toContain('witness-audio')
    expect(JSON.stringify(models.files)).not.toContain('/cases/')
    expect(JSON.stringify(models.files)).not.toContain('https://')
  })

  it('localizes application fallbacks in English without changing authored case copy', () => {
    const fallbackManifest: ShellPublicCaseManifest = {
      ...manifest,
      case: {
        id: manifest.case.id,
        version: manifest.case.version,
        title: manifest.case.title,
        durationMinutes: manifest.case.durationMinutes,
        synopsis: manifest.case.synopsis,
      },
      cast: {},
      opening: {
        call: {},
        evidence: [{ id: 'fallback-record', tool: 'document', assets: [] }],
      },
    }
    const fallbackRuntime: PublicCaseRuntimeState = {
      ...runtime,
      affordances: [{
        id: 'fallback-search',
        surface: 'web',
        risk: 'normal',
        intent: { kind: 'action', action: { action: 'search', query: 'fixture' } },
        cost: { clock: 'case-time', milliseconds: 30_000 },
      }],
      completedAffordances: [{
        id: 'completed-search',
        surface: 'web',
        risk: 'normal',
        intent: { kind: 'action', action: { action: 'search', query: 'fixture' } },
        result: 'Authored search result stays unchanged.',
        completedAtMs: 30_000,
      }],
      supportedDeductions: [{ id: 'fallback-deduction' }],
      actors: [{
        id: 'fallback-person',
        conversation: {
          state: 'available',
          canTalk: true,
          channels: [{ action: 'interview', actorField: 'actor', available: true }],
        },
      }],
      evidence: [{
        id: 'fallback-record',
        tool: 'document',
        observed: true,
        findings: [],
        assets: [],
      }],
    }

    const models = createManifestWorkspaceModels(
      fallbackManifest,
      { query: '', replyDraft: '' },
      fallbackRuntime,
      undefined,
      'en',
    )

    expect(models.casebook).toMatchObject({
      heading: 'Shell Fixture',
      synopsis: 'A presentation-only fixture.',
      phaseLabel: 'ACTIVE CASE',
    })
    expect(models.casebook.entries.slice(0, 3)).toMatchObject([
      { eyebrow: 'Case summary', title: 'Opening briefing', body: 'A presentation-only fixture.', timestampLabel: 'Now' },
      { eyebrow: 'Incoming call', title: 'Case officer', body: 'A presentation-only fixture.', timestampLabel: 'Now' },
      { eyebrow: 'Reviewed evidence', title: 'Evidence 1', body: 'Record reviewed.' },
    ])
    expect(models.files.records[0]).toMatchObject({
      title: 'Evidence 1',
      sourceLabel: 'Document',
      receivedLabel: 'Now',
      summary: 'Review complete.',
      metadata: [
        { label: 'Type', value: 'Document' },
        { label: 'Status', value: 'Reviewed' },
      ],
    })
    expect(models.phone.contacts[0]).toMatchObject({
      name: 'Person 1',
      roleLabel: 'Case contact',
      detail: 'Available for an interview.',
      actions: [{ action: 'interview', label: 'Interview' }],
    })
    expect(models.web).toMatchObject({
      affordances: [{ label: 'Research 1', costLabel: '+30 sec' }],
      results: [{
        title: 'Research result 1',
        excerpt: 'Authored search result stays unchanged.',
        sourceLabel: 'EKİP · Forensic records search',
      }],
    })
    expect(models.rail.questions).toContainEqual(expect.objectContaining({
      text: 'Verified deduction 1',
      detail: 'Verified by evidence.',
    }))
  })
})
