import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { UiLocaleProvider } from '../../ui-locale'
import { CaseDispatchApp } from './CaseDispatchApp'
import { CaseBoardApp } from './CaseBoardApp'
import { CasebookApp } from './CasebookApp'
import { EvidenceQuestionsRail } from './EvidenceQuestionsRail'
import { FilesApp } from './FilesApp'
import { InboxApp } from './InboxApp'
import { PhoneApp } from './PhoneApp'
import { WebResearchApp } from './WebResearchApp'
import type {
  CaseDispatchViewModel,
  CaseBoardViewModel,
  CasebookViewModel,
  EvidenceQuestionsViewModel,
  FilesViewModel,
  InboxViewModel,
  PhoneViewModel,
  WebResearchViewModel,
} from './types'

function renderTurkish(children: ReactNode): string {
  return renderToStaticMarkup(
    <UiLocaleProvider locale="tr">{children}</UiLocaleProvider>,
  )
}

const INTERNAL_SENTINELS = {
  id: '__internal_evidence_identifier__',
  tool: '__internal_tool_token__',
  key: '__internal_localization_key__',
  relation: '__internal_assertion_relation__',
} as const

const casebook: CasebookViewModel = {
  heading: 'Gece Vardiyası',
  synopsis: 'Kayıp tutanağın izini sür.',
  phaseLabel: 'AÇIK VAKA',
  selectedEntryId: INTERNAL_SENTINELS.id,
  leads: [],
  entries: [{
    id: INTERNAL_SENTINELS.id,
    eyebrow: 'İlk not',
    title: 'Görev özeti',
    body: 'Arşiv görevlisi belgeyi son kez gece yarısı gördü.',
    evidence: [{ id: INTERNAL_SENTINELS.tool, label: 'Teslim tutanağı' }],
  }],
  deductions: [{
    id: INTERNAL_SENTINELS.relation,
    title: 'Belge gece vardiyasında taşındı',
    result: 'Saatler karşılaştırıldı. Belge 00:14 ile 00:18 arasında taşındı.',
    status: 'supported',
    supportLabel: 'Kanıtlarla doğrulandı',
  }],
}

const caseDispatch: CaseDispatchViewModel = {
  heading: 'Gece Vardiyası',
  lifecycle: 'pending',
  caseNumberLabel: 'Çalışma dosyası · 00:18',
  officeLabel: 'Olay ve soruşturma işlemleri',
  statusLabel: '1 işlem gönderime hazır',
  routeLabel: 'Onay sırasında belirlenecek',
  updatedLabel: 'Son güncelleme 00:18',
  summaryTitle: 'Belge teslim kaydı',
  summary: 'Kayıp tutanağın gece vardiyasındaki hareketleri inceleniyor.',
  evidence: {
    total: 1,
    observed: 1,
    decisive: 1,
    items: [{
      id: INTERNAL_SENTINELS.id,
      label: 'Teslim tutanağı',
      sourceLabel: 'Arşiv masası',
      statusLabel: 'İncelendi',
    }],
  },
  affordances: [{
    id: INTERNAL_SENTINELS.key,
    label: 'Teslim raporunu yetkili birime ilet',
    costLabel: '+2 dk',
    risk: 'consequential',
    consequence: 'Bu işlem vaka kaydına geçer ve teslim sorumlusuna bildirilir.',
  }],
}

const files: FilesViewModel = {
  selectedRecordId: INTERNAL_SENTINELS.id,
  affordances: [{ id: INTERNAL_SENTINELS.key, label: 'Yeni kopya talep et' }],
  records: [{
    id: INTERNAL_SENTINELS.id,
    title: 'Teslim tutanağı',
    sourceLabel: 'Arşiv masası',
    summary: 'Gece vardiyasına ait imzalı kayıt.',
    status: 'new',
    assets: [{
      id: INTERNAL_SENTINELS.tool,
      kind: 'image',
      label: 'Tutanak fotoğrafı',
      description: 'Masada duran imzalı teslim tutanağı.',
      deliveryUrl: '/authorized/evidence-photo',
    }],
    metadata: [{ label: 'Alındığı yer', value: 'Arşiv masası' }],
  }],
}

const caseBoard: CaseBoardViewModel = {
  heading: 'Gece Vardiyası',
  pins: [{
    id: `person:${INTERNAL_SENTINELS.id}`,
    kind: 'person',
    name: 'Deniz Kaya',
    roleLabel: 'Gece görevlisi',
  }, {
    id: `evidence:${INTERNAL_SENTINELS.id}:${INTERNAL_SENTINELS.tool}`,
    kind: 'evidence',
    title: 'Teslim tutanağı',
    sourceLabel: 'Arşiv masası',
    statusLabel: 'İncelendi',
    asset: files.records[0]!.assets[0]!,
  }],
}

const inbox: InboxViewModel = {
  selectedChannelId: 'forensics',
  selectedThreadId: INTERNAL_SENTINELS.id,
  replyDraft: '',
  channelLead: {
    name: 'Ece Aydın',
    roleLabel: 'Adli İnceleme Lideri',
    promptLabel: 'Ece’ye sor',
  },
  channels: [{
    id: 'forensics',
    label: 'forensics',
    threadId: INTERNAL_SENTINELS.id,
  }],
  threads: [{
    id: INTERNAL_SENTINELS.id,
    channelId: 'forensics',
    sender: 'Gece görevlisi',
    subject: 'Teslim kaydı',
    preview: 'Tutanağı masada bıraktım.',
    timestampLabel: '00:12',
    unread: true,
  }],
  messages: [{
    id: INTERNAL_SENTINELS.relation,
    author: 'Gece görevlisi',
    body: 'Tutanağı vardiya değişiminden önce masada bıraktım.',
    timestampLabel: '00:12',
    direction: 'incoming',
    attachments: [{
      id: INTERNAL_SENTINELS.tool,
      kind: 'document',
      label: 'Vardiya notu',
    }],
  }],
  quickPrompts: [{
    affordanceId: INTERNAL_SENTINELS.key,
    channelId: 'forensics',
    label: 'Deniz Kaya’nın kurum kaydını sor',
    request: 'Deniz Kaya’nın güncel kurum kaydını doğrulayabilir misin?',
    status: 'ready',
  }],
}

const phone: PhoneViewModel = {
  clockLabel: '00:18',
  selectedContactId: INTERNAL_SENTINELS.id,
  affordances: [{ id: INTERNAL_SENTINELS.key, label: 'Danışma masasını ara' }],
  contacts: [{
    id: INTERNAL_SENTINELS.id,
    name: 'Deniz Kaya',
    roleLabel: 'Gece görevlisi',
    detail: 'Şu anda telefonunu açabilir.',
    available: true,
    actions: [{
      action: INTERNAL_SENTINELS.tool,
      affordanceId: INTERNAL_SENTINELS.key,
      label: 'Teslim saatini sor',
      available: true,
    }],
  }],
  recentCalls: [{
    id: INTERNAL_SENTINELS.relation,
    contactId: INTERNAL_SENTINELS.id,
    contactName: 'Deniz Kaya',
    timestampLabel: '00:18',
    direction: 'incoming',
  }],
}

const web: WebResearchViewModel = {
  query: 'gece vardiyası teslim kaydı',
  affordances: [{ id: INTERNAL_SENTINELS.key, label: 'Arşiv kataloğunu ara' }],
  results: [{
    id: INTERNAL_SENTINELS.id,
    title: 'Gece vardiyası kayıtları',
    displayUrl: 'arsiv.local/vardiya-kayitlari',
    sourceLabel: 'Kurum arşivi',
    excerpt: 'Gece vardiyasında teslim alınan belgelerin listesi.',
  }],
  activePage: {
    id: INTERNAL_SENTINELS.relation,
    title: 'Gece vardiyası kayıtları',
    displayUrl: 'arsiv.local/vardiya-kayitlari',
    byline: 'Kurum arşivi',
    paragraphs: ['Teslim tutanağı 00:05 tarihinde kayıt altına alınmış.'],
  },
}

const rail: EvidenceQuestionsViewModel = {
  selectedEvidenceId: INTERNAL_SENTINELS.id,
  selectedQuestionId: INTERNAL_SENTINELS.relation,
  evidence: [{
    id: INTERNAL_SENTINELS.id,
    label: 'Teslim tutanağı',
    sourceLabel: 'Arşiv masası',
    observed: false,
    assetKind: 'image',
  }],
  questions: [{
    id: INTERNAL_SENTINELS.relation,
    text: 'Belgeyi masadan kim aldı?',
    detail: 'Vardiya değişimini kontrol et.',
    status: 'open',
  }],
}

const STRONG_TECHNICAL_COPY = [
  /\bmotor\b/iu,
  /\b(?:engine|runtime|kernel|manifest|digest|schema|affordance)\b/iu,
  /\bsanitize(?:d| edilmiş)?\b/iu,
  /\bpublic (?:projection|projeksiyon|vaka manifest(?:i|leri)?)\b/iu,
  /özel ir/iu,
  /\b(?:asset session|varlık oturumu)\b/iu,
  /\b(?:local detective host|yerel (?:dedektif )?(?:host|ana bilgisayar))\b/iu,
  /\bnpm run\b/iu,
  /\boyun eylemi\b/iu,
  /\bstatik tarayıcı paketi\b/iu,
]

const PLAYER_COPY_ATTRIBUTES = /\s(?:title|aria-label|alt|placeholder)="([^"]*)"/giu

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;|&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
}

function playerVisibleSurface(markup: string): string {
  const attributes = Array.from(markup.matchAll(PLAYER_COPY_ATTRIBUTES), (match) => match[1] ?? '')
  const text = markup.replace(/<[^>]*>/gu, ' ')
  return decodeHtml(`${text} ${attributes.join(' ')}`).replace(/\s+/gu, ' ').trim()
}

const renderedSurfaces = {
  casebook: renderTurkish(<CasebookApp model={casebook} />),
  caseBoard: renderTurkish(<CaseBoardApp model={caseBoard} />),
  caseDispatch: renderTurkish(<CaseDispatchApp model={caseDispatch} />),
  files: renderTurkish(<FilesApp model={files} />),
  inbox: renderTurkish(<InboxApp model={inbox} />),
  phone: renderTurkish(<PhoneApp model={phone} />),
  web: renderTurkish(<WebResearchApp model={web} />),
  rail: renderTurkish(<EvidenceQuestionsRail model={rail} />),
}

describe('player-facing shell contract', () => {
  it('states the concrete result of a verified deduction', () => {
    const surface = playerVisibleSurface(renderedSurfaces.casebook)

    expect(surface).toContain('Doğrulandı')
    expect(surface).toContain('Sonuç')
    expect(surface).toContain('Belge 00:14 ile 00:18 arasında taşındı.')
  })

  it('states the authored consequence before a file operation is submitted', () => {
    const surface = playerVisibleSurface(renderedSurfaces.caseDispatch)

    expect(surface).toContain('Bu işlem vaka kaydına geçer')
    expect(surface).toContain('teslim sorumlusuna bildirilir')
  })

  it.each(Object.entries(renderedSurfaces))(
    '%s renders authored copy without implementation language or opaque identifiers',
    (_name, markup) => {
      const surface = playerVisibleSurface(markup)

      expect(surface).toMatch(/(?:Teslim|Vardiya|Arşiv|Belge|Görev|Deniz)/u)
      for (const sentinel of Object.values(INTERNAL_SENTINELS)) {
        expect(surface).not.toContain(sentinel)
        expect(surface.toLocaleLowerCase('tr')).not.toContain(
          sentinel.replace(/^__|__$/gu, '').replace(/[_-]+/gu, ' ').toLocaleLowerCase('tr'),
        )
      }
      for (const technicalCopy of STRONG_TECHNICAL_COPY) {
        expect(surface).not.toMatch(technicalCopy)
      }
    },
  )
})
