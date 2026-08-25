import { describe, expect, it } from 'vitest'

import type { PublicCaseRuntimeState } from '../case-runtime/protocol'
import type { InboxMessageViewModel } from './apps/types'
import { createCaseChannelActivityMessages } from './case-channel-activity'

const opening: InboxMessageViewModel = {
  id: 'opening',
  author: 'Desk Officer',
  body: 'The case is open.',
  timestampLabel: '21:00',
  direction: 'incoming',
}

function runtime(
  overrides: Partial<PublicCaseRuntimeState> = {},
): PublicCaseRuntimeState {
  return {
    schema: 'case-runtime/public-v1',
    status: 'active',
    revision: 1,
    case: {
      id: 'fixture.case',
      version: '1.0.0',
      digest: 'sha256:stable-fixture',
    },
    clocks: { caseTimeMs: 900_000, activeTimeMs: 900_000, wallTimeMs: 900_000 },
    affordances: [],
    completedAffordances: [],
    supportedDeductions: [],
    actors: [],
    evidence: [],
    deadlines: [],
    observations: [],
    hypotheses: [],
    ...overrides,
  }
}

function displayText(messages: readonly InboxMessageViewModel[]): string {
  return messages.map(({ author, roleLabel, avatarLabel, body, timestampLabel }) => (
    [author, roleLabel, avatarLabel, body, timestampLabel].filter(Boolean).join(' ')
  )).join('\n')
}

describe('createCaseChannelActivityMessages', () => {
  it('keeps the opening first and renders activity in event chronology', () => {
    const messages = createCaseChannelActivityMessages(opening, runtime({
      activity: [
        {
          id: 'activity:8',
          kind: 'affordance-completed',
          sequence: 8,
          occurredAtMs: 480_000,
          affordanceId: 'later-step',
        },
        {
          id: 'activity:3',
          kind: 'evidence-observed',
          sequence: 3,
          occurredAtMs: 180_000,
          evidenceId: 'earlier-evidence',
        },
      ],
      completedAffordances: [{
        id: 'later-step',
        surface: 'web',
        risk: 'normal',
        intent: { kind: 'action', action: { action: 'search', query: 'public query' } },
        label: 'Registry search',
        result: 'The registry returned one match.',
        completedAtMs: 480_000,
        eventSequence: 8,
      }],
      evidence: [{
        id: 'earlier-evidence',
        tool: 'document',
        observed: true,
        assets: [],
        title: 'Delivery note',
        description: 'The note was signed at 21:03.',
        findings: [],
      }],
    }), 'Ada Demir', 'en', (ms) => `T+${ms}`)

    expect(messages[0]).toEqual(opening)
    expect(messages).toHaveLength(5)
    expect(messages[1]?.body).toContain('Delivery note')
    expect(messages[1]?.timestampLabel).toBe('T+180000')
    expect(messages[3]?.body).toContain('Registry search')
    expect(messages[3]?.timestampLabel).toBe('T+480000')
    expect(messages.slice(1).map(({ direction }) => direction)).toEqual([
      'outgoing', 'incoming', 'outgoing', 'incoming',
    ])
  })

  it('is deterministic across reloads without random or wall-clock state', () => {
    const snapshot = runtime({
      activity: [{
        id: 'activity:4',
        kind: 'evidence-observed',
        sequence: 4,
        occurredAtMs: 240_000,
        evidenceId: 'photo',
      }],
      evidence: [{
        id: 'photo',
        tool: 'image',
        observed: true,
        assets: [],
        title: 'Lobby photo',
        description: 'A person is visible near the lift.',
        findings: [],
      }],
    })

    const first = createCaseChannelActivityMessages(opening, snapshot, 'Ada Demir', 'en', String)
    const reloaded = createCaseChannelActivityMessages(opening, snapshot, 'Ada Demir', 'en', String)

    expect(reloaded).toEqual(first)
    expect(first[2]?.author).toMatch(/^(Ece Aydın|Deniz Kara|Melis Kaya|Ozan Demir)$/u)
  })

  it('summarizes evidence using only its public title, description, and findings', () => {
    const snapshot = runtime({
      activity: [{
        id: 'opaque-activity-token',
        kind: 'evidence-observed',
        sequence: 2,
        occurredAtMs: 120_000,
        evidenceId: 'secret-evidence-id',
      }],
      evidence: [{
        id: 'secret-evidence-id',
        tool: 'private-tool-token',
        observed: true,
        assets: [],
        title: 'Kamera kaydı',
        description: 'Görüntü 21.04’te kesintisiz devam ediyor.',
        findings: [
          { field: 'private-field-token', text: 'Çıkışta kayıp kare yok.' },
          { field: 'another-private-field', text: 'Saat damgası doğrulandı.' },
        ],
      }],
    })

    const messages = createCaseChannelActivityMessages(opening, snapshot, 'Ada', 'tr', String)
    const summary = messages[1]?.body ?? ''
    const rendered = displayText(messages)

    expect(summary).toContain('Kamera kaydı')
    expect(summary).toContain('Görüntü 21.04’te kesintisiz devam ediyor.')
    expect(summary).toContain('Çıkışta kayıp kare yok.')
    expect(summary).toContain('Saat damgası doğrulandı.')
    expect(rendered).not.toContain('secret-evidence-id')
    expect(rendered).not.toContain('opaque-activity-token')
    expect(rendered).not.toContain('private-tool-token')
    expect(rendered).not.toContain('private-field-token')
  })

  it('uses the exact public action result without rendering private intent data', () => {
    const snapshot = runtime({
      activity: [{
        id: 'activity:5',
        kind: 'affordance-completed',
        sequence: 5,
        occurredAtMs: 300_000,
        affordanceId: 'opaque-affordance-id',
      }],
      completedAffordances: [{
        id: 'opaque-affordance-id',
        surface: 'phone',
        risk: 'normal',
        intent: {
          kind: 'action',
          action: { action: 'interview', actor: 'private-actor-id', topic: 'private-topic-token' },
        },
        label: 'Aylin ile tekrar konuş',
        result: 'Aylin, dosyayı Bora’nın en son 20.58’de aldığını söyledi.',
        completedAtMs: 300_000,
        eventSequence: 5,
      }],
    })

    const messages = createCaseChannelActivityMessages(opening, snapshot, 'Ada', 'tr', String)
    const summary = messages[1]?.body ?? ''
    const rendered = displayText(messages)

    expect(summary).toContain('Aylin ile tekrar konuş')
    expect(summary).toContain('Aylin, dosyayı Bora’nın en son 20.58’de aldığını söyledi.')
    expect(rendered).not.toContain('opaque-affordance-id')
    expect(rendered).not.toContain('private-actor-id')
    expect(rendered).not.toContain('private-topic-token')
    expect(rendered).not.toContain('interview')
  })

  it('does not emit a second deduction message from supportedDeductions', () => {
    const snapshot = runtime({
      activity: [{
        id: 'activity:7',
        kind: 'affordance-completed',
        sequence: 7,
        occurredAtMs: 420_000,
        affordanceId: 'timeline-deduction',
      }],
      completedAffordances: [{
        id: 'timeline-deduction',
        surface: 'casebook',
        risk: 'normal',
        intent: { kind: 'deduce', deductionId: 'private-deduction-token' },
        label: 'Kamera saati üç dakika geri',
        result: 'Gerçek çıkış saati 21.07 olarak hesaplandı.',
        completedAtMs: 420_000,
        eventSequence: 7,
      }],
      supportedDeductions: [{
        id: 'private-deduction-token',
        label: 'Kamera saati üç dakika geri',
      }],
    })

    const messages = createCaseChannelActivityMessages(opening, snapshot, 'Ada', 'tr', String)

    expect(messages.filter(({ direction }) => direction === 'outgoing')).toHaveLength(1)
    expect(displayText(messages).match(/Kamera saati üç dakika geri/gu)).toHaveLength(1)
    expect(displayText(messages)).not.toContain('private-deduction-token')
  })

  it('keeps repeated executions of one affordance as distinct exact events', () => {
    const snapshot = runtime({
      activity: [
        {
          id: 'activity:11',
          kind: 'affordance-completed',
          sequence: 11,
          occurredAtMs: 660_000,
          affordanceId: 'repeat-call',
        },
        {
          id: 'activity:6',
          kind: 'affordance-completed',
          sequence: 6,
          occurredAtMs: 360_000,
          affordanceId: 'repeat-call',
        },
      ],
      completedAffordances: [
        {
          id: 'repeat-call',
          surface: 'phone',
          risk: 'normal',
          intent: { kind: 'action', action: { action: 'interview', actor: 'witness' } },
          label: 'Tanığı ara',
          result: 'İkinci aramada yeni saati hatırladı.',
          completedAtMs: 660_000,
          eventSequence: 11,
        },
        {
          id: 'repeat-call',
          surface: 'phone',
          risk: 'normal',
          intent: { kind: 'action', action: { action: 'interview', actor: 'witness' } },
          label: 'Tanığı ara',
          result: 'İlk aramada olayı görmediğini söyledi.',
          completedAtMs: 360_000,
          eventSequence: 6,
        },
      ],
    })

    const messages = createCaseChannelActivityMessages(opening, snapshot, 'Ada', 'tr', String)
    const detectiveMessages = messages.filter(({ direction }) => direction === 'outgoing')

    expect(detectiveMessages).toHaveLength(2)
    expect(detectiveMessages[0]?.body).toContain('İlk aramada olayı görmediğini söyledi.')
    expect(detectiveMessages[1]?.body).toContain('İkinci aramada yeni saati hatırladı.')
    expect(detectiveMessages[0]?.id).not.toBe(detectiveMessages[1]?.id)
  })

  it('adds one safe current hint, preferring a normal phone action', () => {
    const snapshot = runtime({
      affordances: [
        {
          id: 'private-casebook-id',
          surface: 'casebook',
          risk: 'normal',
          intent: { kind: 'deduce', deductionId: 'private-deduction-id' },
          label: 'Notlardaki çelişkiyi sına',
        },
        {
          id: 'private-terminal-id',
          surface: 'phone',
          risk: 'terminal',
          intent: { kind: 'action', action: { action: 'accuse', actor: 'private-suspect-id' } },
          label: 'Riskli suçlama',
        },
        {
          id: 'private-phone-id',
          surface: 'phone',
          risk: 'normal',
          intent: { kind: 'action', action: { action: 'interview', actor: 'private-witness-id' } },
          label: 'Aylin’i ara',
        },
      ],
    })

    const messages = createCaseChannelActivityMessages(opening, snapshot, 'Ada', 'tr', String)
    const rendered = displayText(messages)

    expect(messages).toHaveLength(2)
    expect(messages[1]?.body).toContain('Aylin’i ara')
    expect(rendered).not.toContain('Riskli suçlama')
    expect(rendered).not.toContain('private-phone-id')
    expect(rendered).not.toContain('private-witness-id')
  })

  it('varies casual lowercase chatter by stable public event seed', () => {
    const snapshot = runtime({
      activity: Array.from({ length: 24 }, (_, index) => ({
        id: `activity:${index + 1}`,
        kind: 'evidence-observed' as const,
        sequence: index + 1,
        occurredAtMs: (index + 1) * 60_000,
        evidenceId: `unresolved-public-record-${index + 1}`,
      })),
    })

    const messages = createCaseChannelActivityMessages(opening, snapshot, 'Ada', 'tr', String)
      .filter(({ id }) => id.startsWith('case-activity-'))
    const detectiveBodies = messages
      .filter(({ direction }) => direction === 'outgoing')
      .map(({ body }) => body)
    const officeBodies = messages
      .filter(({ direction }) => direction === 'incoming')
      .map(({ body }) => body)

    expect(new Set(detectiveBodies).size).toBeGreaterThanOrEqual(3)
    expect(new Set(officeBodies).size).toBeGreaterThanOrEqual(4)
    expect([...detectiveBodies, ...officeBodies].every((body) => /^[a-zçğıöşüh]/u.test(body))).toBe(true)
    expect(detectiveBodies.every((body) => /(?:👀|🕵️|🧐|🔎)/u.test(body))).toBe(true)
    expect(officeBodies.some((body) => /(?:👀|🤔|🧩|✍️)/u.test(body))).toBe(true)
  })

  it('localizes conversational copy and roles in Turkish and English', () => {
    const snapshot = runtime({
      activity: [{
        id: 'activity:2',
        kind: 'evidence-observed',
        sequence: 2,
        occurredAtMs: 120_000,
        evidenceId: 'record',
      }],
      evidence: [{
        id: 'record',
        tool: 'document',
        observed: true,
        assets: [],
        title: 'Clock record',
        findings: [],
      }],
    })

    const tr = createCaseChannelActivityMessages(opening, snapshot, '', 'tr', String)
    const en = createCaseChannelActivityMessages(opening, snapshot, '', 'en', String)

    expect(tr[1]).toMatchObject({
      author: 'Dedektif',
      roleLabel: 'Soruşturma sorumlusu',
      direction: 'outgoing',
    })
    expect(tr[1]?.body).toContain('Clock record')
    expect(tr[1]?.body).toMatch(/^[a-zçğıöşü]/u)
    expect(tr[1]?.body).toMatch(/(?:👀|🕵️|🧐|🔎)/u)
    expect(en[1]).toMatchObject({
      author: 'Detective',
      roleLabel: 'Lead investigator',
      direction: 'outgoing',
    })
    expect(en[1]?.body).toContain('Clock record')
    expect(en[1]?.body).toMatch(/^[a-z]/u)
    expect(en[1]?.body).toMatch(/(?:👀|🕵️|🧐|🔎)/u)
    expect(tr[2]?.roleLabel).not.toBe(en[2]?.roleLabel)
  })

  it('returns the opening unchanged when there is no activity or safe hint', () => {
    const messages = createCaseChannelActivityMessages(
      [opening],
      runtime({ activity: undefined, affordances: [] }),
      'Ada',
      'tr',
      String,
    )

    expect(messages).toEqual([opening])
  })
})
