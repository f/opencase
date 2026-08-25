import type {
  AffordanceViewModel,
  AssetKind,
  CaseDispatchViewModel,
  CasebookViewModel,
  EvidenceQuestionsViewModel,
  FilesViewModel,
  InboxViewModel,
  PhoneViewModel,
  WebResearchViewModel,
} from './apps'
import type { PublicCaseRuntimeState } from '../case-runtime/protocol'
import { localeTag, type AppLocale } from '../ui-locale'

const WORKSPACE_COPY = {
  tr: {
    now: 'Şimdi', caller: 'Vaka görevlisi', action: 'İşlem', move: 'Hamle',
    interview: 'Görüş', apologize: 'Özür dile', present: 'Kanıt sun', request: 'Talep et',
    image: 'Görsel', audio: 'Ses kaydı', video: 'Video', document: 'Belge', file: 'Dosya',
    evidence: 'Kanıt', person: 'Kişi', researchResult: 'Araştırma sonucu', findPerson: 'Kişiyi bul',
    foundPerson: 'Bulunan kişi', question: 'Soru', reviewComplete: 'İnceleme tamamlandı.',
    evidencePending: 'Bu kanıt henüz incelenmedi.', type: 'Tür', status: 'Durum', reviewed: 'İncelendi',
    fresh: 'Yeni', casePerson: 'Vaka kişisi', reachable: 'Görüşme için ulaşılabilir.',
    unavailable: 'Bu kişi şu anda görüşmeye açık değil.', activeCase: 'AKTİF VAKA',
    caseSummary: 'Vaka özeti', openingBrief: 'Açılış brifingi', incomingCall: 'Gelen çağrı',
    reviewedEvidence: 'İncelenen kanıt', recordReviewed: 'Kayıt incelendi.',
    phoneOperation: 'Görüşme / işlem', investigationOperation: 'Soruşturma işlemi',
    completedOperation: 'Tamamlanan işlem', deduction: 'Çıkarım', verifiedDeduction: 'Doğrulanan çıkarım',
    verifiedByEvidence: 'Kanıtlarla doğrulandı', assignedOnSubmit: 'Gönderimde atanacak',
    investigationOffice: 'Olay ve soruşturma işlemleri', readyToSubmit: 'işlem gönderime hazır',
    fileClosed: 'Dosya kapatıldı', filePreparing: 'Dosya hazırlanıyor',
    routeOnApproval: 'Onay sırasında belirlenecek', lastUpdate: 'Son güncelleme', incidentSummary: 'Olay özeti',
    officialAction: 'Resmî işlem', openingNotice: 'Vaka açılış bildirimi', openingCall: 'Vaka açılış çağrısı',
    research: 'Araştırma', policeQuery: 'EKİP · Adli evrak sorgusu', readyInNotes: "Vaka Notları'nda değerlendirilmeye hazır.",
    apps: { phone: 'Aramalar', web: 'Safari', files: 'Finder', casebook: 'Vaka Notları', inbox: 'Ekip Alanı' },
    inApplicationPrefix: '', inApplication: 'uygulamasında.', minute: 'dk', second: 'sn',
    readyToSubmitPlural: 'işlem gönderime hazır',
  },
  en: {
    now: 'Now', caller: 'Case officer', action: 'Action', move: 'Move',
    interview: 'Interview', apologize: 'Apologize', present: 'Present evidence', request: 'Request',
    image: 'Image', audio: 'Audio', video: 'Video', document: 'Document', file: 'File',
    evidence: 'Evidence', person: 'Person', researchResult: 'Research result', findPerson: 'Find person',
    foundPerson: 'Located person', question: 'Question', reviewComplete: 'Review complete.',
    evidencePending: 'This evidence has not been reviewed yet.', type: 'Type', status: 'Status', reviewed: 'Reviewed',
    fresh: 'New', casePerson: 'Case contact', reachable: 'Available for an interview.',
    unavailable: 'This person is not available right now.', activeCase: 'ACTIVE CASE',
    caseSummary: 'Case summary', openingBrief: 'Opening briefing', incomingCall: 'Incoming call',
    reviewedEvidence: 'Reviewed evidence', recordReviewed: 'Record reviewed.',
    phoneOperation: 'Call / action', investigationOperation: 'Investigation action',
    completedOperation: 'Completed action', deduction: 'Deduction', verifiedDeduction: 'Verified deduction',
    verifiedByEvidence: 'Verified by evidence', assignedOnSubmit: 'Assigned on submission',
    investigationOffice: 'Incident and investigation desk', readyToSubmit: 'action ready to submit',
    fileClosed: 'Case closed', filePreparing: 'Case file in progress',
    routeOnApproval: 'Set during approval', lastUpdate: 'Last update', incidentSummary: 'Incident summary',
    officialAction: 'Official action', openingNotice: 'Case opening notice', openingCall: 'Opening case call',
    research: 'Research', policeQuery: 'EKİP · Forensic records search', readyInNotes: 'Ready to review in Case Notes.',
    apps: { phone: 'Calls', web: 'Safari', files: 'Finder', casebook: 'Case Notes', inbox: 'Team Space' },
    inApplicationPrefix: 'In the ', inApplication: 'app.', minute: 'min', second: 'sec',
    readyToSubmitPlural: 'actions ready to submit',
  },
} as const

type WorkspaceCopy = typeof WORKSPACE_COPY[AppLocale]

export interface ShellPublicAssetHandle {
  readonly id: string
  readonly kind: string
  readonly mimeType: string
}

export interface ShellOpeningEvidence {
  readonly id: string
  readonly tool: string
  readonly assets: readonly ShellPublicAssetHandle[]
}

export interface ShellPublicCaseManifest {
  readonly schema: 'case-public/v0.2'
  readonly case: {
    readonly id: string
    readonly version: string
    readonly title: string
    readonly durationMinutes: number
    readonly synopsis: string
    readonly locale?: string
    readonly time?: {
      readonly date?: string
      readonly startsAt?: string
      readonly timezone?: string
    }
  }
  readonly cast: Readonly<Record<string, unknown>>
  readonly places?: Readonly<Record<string, unknown>>
  readonly assets: readonly ShellPublicAssetHandle[]
  readonly opening: {
    readonly call?: {
      readonly from?: string
      readonly text?: string
    }
    readonly evidence: readonly ShellOpeningEvidence[]
  }
  readonly integrity: {
    readonly manifest: string
  }
}

export interface ManifestWorkspaceSelection {
  readonly selectedEntryId?: string
  readonly selectedEvidenceId?: string
  readonly selectedQuestionId?: string
  readonly selectedRecordId?: string
  readonly selectedThreadId?: string
  readonly selectedContactId?: string
  readonly query: string
  readonly activeResearchResultId?: string
  readonly replyDraft: string
  readonly activeCallContactId?: string
  /** Cosmetic state only; runtime actor projection remains contact truth. */
  readonly contactActionStatuses?: Readonly<Record<string, 'pending' | 'completed'>>
  readonly newContactIds?: readonly string[]
}

export interface ManifestWorkspaceModels {
  readonly casebook: CasebookViewModel
  readonly caseDispatch: CaseDispatchViewModel
  readonly inbox: InboxViewModel
  readonly phone: PhoneViewModel
  readonly files: FilesViewModel
  readonly web: WebResearchViewModel
  readonly rail: EvidenceQuestionsViewModel
}

export type ShellAssetDeliveryUrl = (asset: ShellPublicAssetHandle) => string | undefined

export function humanizeIdentifier(value: string): string {
  const words = value.replace(/[._-]+/g, ' ').trim()
  return words.length === 0 ? value : words.charAt(0).toLocaleUpperCase() + words.slice(1)
}

function castText(manifest: ShellPublicCaseManifest, actorId: string, field: string): string | undefined {
  const actor = manifest.cast[actorId]
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return undefined
  const value = (actor as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

function castRole(manifest: ShellPublicCaseManifest, actorId: string): string | undefined {
  const role = castText(manifest, actorId, 'role')
  return role ? humanizeIdentifier(role) : undefined
}

function assetKind(tool: string, declared?: string): AssetKind {
  const candidate = (declared ?? tool).toLowerCase()
  if (candidate.includes('image') || candidate.includes('photo')) return 'image'
  if (candidate.includes('audio') || candidate.includes('voice')) return 'audio'
  if (candidate.includes('video')) return 'video'
  if (
    candidate.includes('document') ||
    candidate.includes('pdf') ||
    candidate.includes('email') ||
    candidate.includes('message') ||
    candidate.includes('log')
  ) return 'document'
  return 'file'
}

function startLabel(manifest: ShellPublicCaseManifest, copy: WorkspaceCopy): string {
  return manifest.case.time?.startsAt ?? copy.now
}

export function caseClockLabel(manifest: ShellPublicCaseManifest, milliseconds: number): string {
  const authored = manifest.case.time?.startsAt
  const match = authored?.match(/^(\d{2}):(\d{2})/)
  if (!match) {
    const totalMinutes = Math.floor(milliseconds / 60_000)
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
  }
  const startMinutes = Number(match[1]) * 60 + Number(match[2])
  const currentMinutes = (startMinutes + Math.floor(milliseconds / 60_000)) % (24 * 60)
  return `${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}`
}

export function caseTimeLabel(manifest: ShellPublicCaseManifest, milliseconds: number): string {
  const authored = manifest.case.time?.startsAt
  const match = authored?.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  const startSeconds = match
    ? Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
    : 0
  const totalSeconds = (startSeconds + Math.floor(milliseconds / 1_000)) % (24 * 3_600)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  return match?.[3] !== undefined || milliseconds % 60_000 !== 0
    ? `${base}:${String(seconds).padStart(2, '0')}`
    : base
}

function investigationRecordUrl(
  manifest: ShellPublicCaseManifest,
  completedAtMs: number,
  index: number,
): string {
  const caseDate = manifest.case.time?.date?.replace(/\D/gu, '').slice(0, 8) || 'arsiv'
  const elapsedSeconds = String(Math.max(0, Math.floor(completedAtMs / 1_000))).padStart(6, '0')
  const sequence = String(index + 1).padStart(2, '0')
  return `ekip.polnet/adli-evrak/sorgu/${caseDate}-${elapsedSeconds}-${sequence}`
}

function actionLabel(action: string, index: number, copy: WorkspaceCopy): string {
  const labels: Record<string, string> = {
    interview: copy.interview,
    apologize: copy.apologize,
    present: copy.present,
    request: copy.request,
  }
  return labels[action] ?? `${copy.action} ${index + 1}`
}

function affordanceLabel(
  affordance: PublicCaseRuntimeState['affordances'][number],
  fallback: string,
): string {
  return affordance.label?.trim() || fallback
}

function assetKindLabel(kind: AssetKind, copy: WorkspaceCopy): string {
  const labels: Record<AssetKind, string> = {
    image: copy.image,
    audio: copy.audio,
    video: copy.video,
    document: copy.document,
    file: copy.file,
  }
  return labels[kind]
}

function evidenceFallbackLabel(index: number, copy: WorkspaceCopy): string {
  return `${copy.evidence} ${index + 1}`
}

function actorFallbackLabel(index: number, copy: WorkspaceCopy): string {
  return `${copy.person} ${index + 1}`
}

function affordanceCostLabel(
  affordance: PublicCaseRuntimeState['affordances'][number],
  locale: AppLocale,
  copy: WorkspaceCopy,
): string | undefined {
  const milliseconds = affordance.cost?.milliseconds
  if (milliseconds === undefined || milliseconds <= 0) return undefined
  if (milliseconds % 60_000 === 0) return `+${milliseconds / 60_000} ${copy.minute}`
  if (milliseconds >= 60_000) {
    return `+${(milliseconds / 60_000).toLocaleString(localeTag(locale), { maximumFractionDigits: 1 })} ${copy.minute}`
  }
  return `+${Math.ceil(milliseconds / 1_000)} ${copy.second}`
}

function callDurationLabel(
  milliseconds: number | undefined,
  locale: AppLocale,
  copy: WorkspaceCopy,
): string | undefined {
  if (milliseconds === undefined || milliseconds <= 0) return undefined
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000} ${copy.minute}`
  if (milliseconds >= 60_000) {
    return `${(milliseconds / 60_000).toLocaleString(localeTag(locale), { maximumFractionDigits: 1 })} ${copy.minute}`
  }
  return `${Math.ceil(milliseconds / 1_000)} ${copy.second}`
}

function affordanceViewModel(
  affordance: PublicCaseRuntimeState['affordances'][number],
  index: number,
  locale: AppLocale,
  copy: WorkspaceCopy,
  fallbackNoun: string = copy.move,
): AffordanceViewModel {
  const costLabel = affordanceCostLabel(affordance, locale, copy)
  const consequence = affordance.confirmation?.trim()
  return {
    id: affordance.id,
    label: affordanceLabel(affordance, `${fallbackNoun} ${index + 1}`),
    ...(costLabel ? { costLabel } : {}),
    ...(affordance.risk !== 'normal' ? { risk: affordance.risk } : {}),
    ...(consequence ? { consequence } : {}),
  }
}

function evidenceTitle(
  evidence: PublicCaseRuntimeState['evidence'][number],
  index: number,
  copy: WorkspaceCopy,
): string {
  return evidence.title?.trim() || evidenceFallbackLabel(index, copy)
}

function evidenceFindings(
  evidence: PublicCaseRuntimeState['evidence'][number],
): string[] {
  if (!evidence.observed) return []
  return evidence.findings.flatMap((finding) => {
    const text = finding.text?.trim()
    return text ? [text] : []
  })
}

export function createManifestWorkspaceModels(
  manifest: ShellPublicCaseManifest,
  selection: ManifestWorkspaceSelection,
  runtime?: PublicCaseRuntimeState,
  assetDeliveryUrl?: ShellAssetDeliveryUrl,
  interfaceLocale: AppLocale = 'en',
): ManifestWorkspaceModels {
  const copy = WORKSPACE_COPY[interfaceLocale]
  const callerId = manifest.opening.call?.from ?? 'case-desk'
  const callerName = castText(manifest, callerId, 'name') ?? copy.caller
  const openingText = manifest.opening.call?.text ?? manifest.case.synopsis
  const runtimeEvidence: PublicCaseRuntimeState['evidence'] = runtime?.evidence
    ?? manifest.opening.evidence.map((evidence, index) => ({
      id: evidence.id,
      tool: evidence.tool,
      assets: evidence.assets.map((asset) => ({
        id: asset.id,
        kind: assetKind(evidence.tool, asset.kind),
        mimeType: asset.mimeType,
      })),
      observed: false,
      title: evidenceFallbackLabel(index, copy),
      findings: [],
    }))
  const offeredAffordances = runtime?.affordances ?? []
  const completedAffordances = runtime?.completedAffordances ?? []
  const completedDeductionResults = new Map<string, string>()
  for (const completed of completedAffordances) {
    if (completed.intent.kind !== 'deduce') continue
    const result = completed.result?.trim()
    if (result) completedDeductionResults.set(completed.intent.deductionId, result)
  }
  const affordancesFor = (surface: PublicCaseRuntimeState['affordances'][number]['surface']) => (
    offeredAffordances.filter((affordance) => affordance.surface === surface)
  )
  const allPhoneAffordances = affordancesFor('phone')
  const phoneAffordances = allPhoneAffordances.filter(
    (affordance) => affordance.intent.kind === 'action',
  )
  const belongsToActor = (
    affordance: (typeof phoneAffordances)[number],
    actorId: string,
  ) => affordance.intent.kind === 'action' && (
    affordance.intent.action.actor === actorId
    || affordance.intent.action.from === actorId
    || affordance.intent.action.target === actorId
  )
  const actorAffordanceAvailable = (
    affordance: (typeof phoneAffordances)[number],
    actor: PublicCaseRuntimeState['actors'][number],
  ): boolean => {
    if (affordance.intent.kind !== 'action') return false
    const action = affordance.intent.action
    const actorFields = (['actor', 'target', 'from'] as const).filter(
      (actorField) => action[actorField] === actor.id,
    )
    const hasAvailableChannel = actor.conversation.channels.some((channel) => (
      channel.action === action.action
      && actorFields.includes(channel.actorField)
      && channel.available
    ))
    return actor.conversation.canTalk || hasAvailableChannel
  }
  const unassignedPhoneAffordances = allPhoneAffordances.filter((affordance) => (
    affordance.intent.kind !== 'action' || [
      affordance.intent.action.actor,
      affordance.intent.action.from,
      affordance.intent.action.target,
    ].every((candidate) => candidate === undefined)
  ))
  const readyDeductions = affordancesFor('casebook').filter(
    (affordance) => affordance.intent.kind === 'deduce',
  )
  const filingAffordances = affordancesFor('casebook').filter(
    (affordance) => affordance.intent.kind === 'action',
  )
  const readyDeductionIds = new Set(readyDeductions.map((affordance) => (
    affordance.intent.kind === 'deduce' ? affordance.intent.deductionId : ''
  )))
  const briefingId = 'public-briefing'
  const callId = 'opening-call'
  const currentLeads = offeredAffordances
    .filter((affordance) => (
      affordance.intent.kind === 'action'
      && affordance.surface !== 'casebook'
      && affordance.surface !== 'inbox'
    ))
    .map((affordance, index) => ({
      ...affordanceViewModel(affordance, index, interfaceLocale, copy),
      surface: affordance.surface,
    }))
    .sort((left, right) => {
      const leftRisk = left.risk === 'normal' || left.risk === undefined ? 0 : 1
      const rightRisk = right.risk === 'normal' || right.risk === undefined ? 0 : 1
      return leftRisk - rightRisk || left.label.localeCompare(right.label, localeTag(interfaceLocale))
    })
  let webResultIndex = 0
  const completedWebResults = completedAffordances.flatMap((completed, completedIndex) => {
    const result = completed.result?.trim()
    if (completed.surface !== 'web' || !result) return []
    const resultIndex = webResultIndex
    webResultIndex += 1
    return [{
      id: `research-${completed.id}-${completed.completedAtMs}-${completedIndex}`,
      title: completed.label?.trim() || `${copy.researchResult} ${resultIndex + 1}`,
      displayUrl: investigationRecordUrl(manifest, completed.completedAtMs, resultIndex),
      result,
    }]
  })
  const activeResearchResult = completedWebResults.find(({ id }) => (
    id === selection.activeResearchResultId
  ))

  const completedEntryId = (
    completed: PublicCaseRuntimeState['completedAffordances'][number],
    index: number,
  ): string => `action-note-${completed.id}-${completed.completedAtMs}-${index}`
  const entryIdForInteraction = (
    interaction: NonNullable<PublicCaseRuntimeState['affordances'][number]['interaction']>,
  ): string | undefined => {
    const context = interaction.context
    if (!context || context.kind === 'opening-call') return callId
    if (context.kind === 'evidence') return `evidence-note-${context.ref}`
    const completedIndex = completedAffordances.findIndex(({ id }) => id === context.ref)
    const completed = completedAffordances[completedIndex]
    return completed ? completedEntryId(completed, completedIndex) : undefined
  }
  const activeContactActions = affordancesFor('inbox').filter((affordance) => (
    affordance.interaction?.kind === 'async-message'
  ))
  const completedContactActions = completedAffordances.filter((affordance) => (
    affordance.surface === 'inbox' && affordance.interaction?.kind === 'async-message'
  ))
  const activeContactEntryCandidates = activeContactActions.flatMap((affordance) => {
    if (!affordance.interaction) return []
    const entryId = entryIdForInteraction(affordance.interaction)
    return entryId ? [{ entryId, context: affordance.interaction.context }] : []
  })
  const preferredEntryId = activeContactEntryCandidates.find(({ context }) => (
    context && context.kind !== 'opening-call'
  ))?.entryId
    ?? activeContactEntryCandidates[0]?.entryId
    ?? briefingId
  const selectedCasebookEntryId = selection.selectedEntryId ?? preferredEntryId
  const contactActions: NonNullable<CasebookViewModel['contactActions']> = [
    ...activeContactActions.flatMap((affordance, index) => {
      if (!affordance.interaction || entryIdForInteraction(affordance.interaction) !== selectedCasebookEntryId) {
        return []
      }
      const status: 'ready' | 'pending' | 'completed' = (
        selection.contactActionStatuses?.[affordance.id] ?? 'ready'
      )
      return [{
        affordanceId: affordance.id,
        label: affordanceLabel(affordance, `${copy.findPerson} ${index + 1}`),
        ...(affordance.interaction.request?.trim()
          ? { description: affordance.interaction.request.trim() }
          : {}),
        destinationLabel: `#${affordance.interaction.channel}`,
        status,
      }]
    }),
    ...completedContactActions.flatMap((affordance, index) => {
      if (!affordance.interaction || entryIdForInteraction(affordance.interaction) !== selectedCasebookEntryId) {
        return []
      }
      return [{
        affordanceId: affordance.id,
        label: affordance.label?.trim() || `${copy.foundPerson} ${index + 1}`,
        ...(affordance.interaction.request?.trim()
          ? { description: affordance.interaction.request.trim() }
          : {}),
        destinationLabel: `#${affordance.interaction.channel}`,
        status: 'completed' as const,
      }]
    }),
  ]
  const inboxQuickPrompts: NonNullable<InboxViewModel['quickPrompts']> = activeContactActions.flatMap(
    (affordance, index) => {
      const interaction = affordance.interaction
      const request = interaction?.request?.trim()
      if (!interaction || !request || selection.contactActionStatuses?.[affordance.id] === 'completed') {
        return []
      }
      return [{
        affordanceId: affordance.id,
        channelId: interaction.channel,
        label: affordanceLabel(affordance, `${copy.question} ${index + 1}`),
        request,
        status: selection.contactActionStatuses?.[affordance.id] === 'pending'
          ? 'pending' as const
          : 'ready' as const,
      }]
    },
  )

  const files: FilesViewModel = {
    selectedRecordId: selection.selectedRecordId ?? runtimeEvidence[0]?.id,
    affordances: affordancesFor('files').map((affordance, index) => (
      affordanceViewModel(affordance, index, interfaceLocale, copy, copy.action)
    )),
    records: runtimeEvidence.map((evidence, evidenceIndex) => {
      const recordKind = assetKind(evidence.tool, evidence.assets[0]?.kind)
      const recordTitle = evidenceTitle(evidence, evidenceIndex, copy)
      const findings = evidenceFindings(evidence)
      return {
        id: evidence.id,
        title: recordTitle,
        sourceLabel: assetKindLabel(recordKind, copy),
        receivedLabel: startLabel(manifest, copy),
        summary: evidence.description?.trim() || (
          evidence.observed
            ? copy.reviewComplete
            : copy.evidencePending
        ),
        ...(findings.length > 0 ? { findings } : {}),
        status: evidence.observed ? 'observed' : 'new',
        assets: evidence.assets.map((asset, assetIndex) => {
          const deliveryUrl = assetDeliveryUrl?.(asset)
          const kind = assetKind(evidence.tool, asset.kind)
          return {
            id: asset.id,
            kind,
            label: `${assetKindLabel(kind, copy)} ${assetIndex + 1}`,
            ...(deliveryUrl ? { deliveryUrl } : {}),
          }
        }),
        metadata: [
          { label: copy.type, value: assetKindLabel(recordKind, copy) },
          { label: copy.status, value: evidence.observed ? copy.reviewed : copy.fresh },
        ],
      }
    }),
  }

  const phoneContacts: PhoneViewModel['contacts'] = (runtime?.actors ?? []).map((actor, actorIndex) => {
    const exactAffordances = phoneAffordances.filter((affordance) => (
      belongsToActor(affordance, actor.id)
    ))
    const exactActions = new Set(exactAffordances.flatMap((affordance) => (
      affordance.intent.kind === 'action' ? [affordance.intent.action.action] : []
    )))
    return {
      id: actor.id,
      name: actor.displayName?.trim()
        || actor.name?.trim()
        || castText(manifest, actor.id, 'name')
        || actorFallbackLabel(actorIndex, copy),
      roleLabel: actor.role?.trim()
        || castRole(manifest, actor.id)
        || copy.casePerson,
      detail: actor.conversation.reason ?? (
        actor.conversation.canTalk
          ? copy.reachable
          : copy.unavailable
      ),
      ...(actor.phone?.trim() ? { phoneNumber: actor.phone.trim() } : {}),
      ...('operator' in actor && typeof actor.operator === 'string' && actor.operator.trim()
        ? { operatorLabel: actor.operator.trim() }
        : {}),
      ...('contactSource' in actor && typeof actor.contactSource === 'string' && actor.contactSource.trim()
        ? { sourceLabel: actor.contactSource.trim() }
        : {}),
      ...(selection.newContactIds?.includes(actor.id) ? { newlyAdded: true } : {}),
      available: actor.conversation.canTalk,
      actions: [
        ...exactAffordances.map((affordance, index) => {
          if (affordance.intent.kind !== 'action') throw new Error('Unreachable affordance kind.')
          const costLabel = affordanceCostLabel(affordance, interfaceLocale, copy)
          return {
            action: affordance.intent.action.action,
            label: affordanceLabel(affordance, `${copy.action} ${index + 1}`),
            affordanceId: affordance.id,
            available: actorAffordanceAvailable(affordance, actor),
            ...(costLabel ? { costLabel } : {}),
          }
        }),
        ...actor.conversation.channels
          .filter((channel) => !exactActions.has(channel.action))
          .map((channel, index) => ({
            ...channel,
            label: actionLabel(channel.action, index, copy),
          })),
      ],
    }
  })
  const phoneContactsById = new Map(phoneContacts.map((contact) => [contact.id, contact]))
  const completedPhoneCalls: PhoneViewModel['recentCalls'] = completedAffordances
    .flatMap((completed, completedIndex) => {
      if (completed.surface !== 'phone' || completed.intent.kind !== 'action') return []
      const action = completed.intent.action
      const contactId = action.actor ?? action.from ?? action.target
      if (!contactId) return []
      const contact = phoneContactsById.get(contactId)
      if (!contact) return []
      const durationMs = completed.cost?.milliseconds
      const durationLabel = callDurationLabel(durationMs, interfaceLocale, copy)
      const startedAtMs = Math.max(0, completed.completedAtMs - (durationMs ?? 0))
      return [{
        id: `outgoing-${completed.id}-${completed.completedAtMs}-${completedIndex}`,
        contactId,
        contactName: contact.name,
        timestampLabel: caseTimeLabel(manifest, startedAtMs),
        detailLabel: completed.label?.trim() || actionLabel(action.action, completedIndex, copy),
        ...(durationLabel ? { durationLabel } : {}),
        direction: 'outgoing' as const,
      }]
    })
    .reverse()

  return {
    casebook: {
      heading: manifest.case.title,
      synopsis: manifest.case.synopsis,
      phaseLabel: copy.activeCase,
      selectedEntryId: selectedCasebookEntryId,
      leads: currentLeads,
      ...(contactActions.length > 0 ? { contactActions } : {}),
      entries: [
        {
          id: briefingId,
          eyebrow: copy.caseSummary,
          title: copy.openingBrief,
          body: manifest.case.synopsis,
          timestampLabel: startLabel(manifest, copy),
        },
        {
          id: callId,
          eyebrow: copy.incomingCall,
          title: callerName,
          body: openingText,
          timestampLabel: startLabel(manifest, copy),
        },
        ...runtimeEvidence.flatMap((evidence, evidenceIndex) => {
          if (!evidence.observed) return []
          const label = evidenceTitle(evidence, evidenceIndex, copy)
          const findings = evidenceFindings(evidence)
          return [{
            id: `evidence-note-${evidence.id}`,
            eyebrow: copy.reviewedEvidence,
            title: label,
            body: evidence.description?.trim() || copy.recordReviewed,
            ...(findings.length > 0 ? { findings } : {}),
            evidence: [{ id: evidence.id, label }],
          }]
        }),
        ...completedAffordances.flatMap((completed, index) => {
          const result = completed.result?.trim()
          if (!result) return []
          return [{
            id: completedEntryId(completed, index),
            eyebrow: completed.surface === 'phone' ? copy.phoneOperation : copy.investigationOperation,
            title: completed.label?.trim() || `${copy.completedOperation} ${index + 1}`,
            body: result,
            timestampLabel: caseTimeLabel(manifest, completed.completedAtMs),
          }]
        }),
      ],
      deductions: [
        ...readyDeductions.map((affordance, index) => {
          if (affordance.intent.kind !== 'deduce') throw new Error('Unreachable affordance kind.')
          const costLabel = affordanceCostLabel(affordance, interfaceLocale, copy)
          return {
            id: affordance.intent.deductionId,
            title: affordanceLabel(affordance, `${copy.deduction} ${index + 1}`),
            status: 'ready' as const,
            ...(costLabel ? { costLabel } : {}),
          }
        }),
        ...(runtime?.supportedDeductions ?? []).flatMap((deduction, index) => (
          readyDeductionIds.has(deduction.id)
            ? []
            : [{
                id: deduction.id,
                title: deduction.label?.trim() || `${copy.verifiedDeduction} ${index + 1}`,
                status: 'supported' as const,
                ...(completedDeductionResults.has(deduction.id)
                  ? { result: completedDeductionResults.get(deduction.id) }
                  : {}),
                supportLabel: copy.verifiedByEvidence,
              }]
        )),
      ],
    },
    caseDispatch: {
      heading: manifest.case.title,
      lifecycle: runtime?.status === 'ended'
        ? 'closed'
        : filingAffordances.length > 0
          ? 'pending'
          : 'draft',
      caseNumberLabel: copy.assignedOnSubmit,
      officeLabel: copy.investigationOffice,
      statusLabel: filingAffordances.length > 0
        ? `${filingAffordances.length} ${filingAffordances.length === 1 ? copy.readyToSubmit : copy.readyToSubmitPlural}`
        : runtime?.status === 'ended'
          ? copy.fileClosed
          : copy.filePreparing,
      routeLabel: copy.routeOnApproval,
      updatedLabel: `${copy.lastUpdate} ${caseTimeLabel(manifest, runtime?.clocks.caseTimeMs ?? 0)}`,
      summaryTitle: copy.incidentSummary,
      summary: manifest.case.synopsis,
      evidence: {
        total: runtimeEvidence.length,
        observed: runtimeEvidence.filter(({ observed }) => observed).length,
        decisive: runtime?.supportedDeductions.length ?? 0,
        items: runtimeEvidence.flatMap((evidence, index) => (
          evidence.observed
            ? [{
                id: evidence.id,
                label: evidenceTitle(evidence, index, copy),
                sourceLabel: assetKindLabel(assetKind(evidence.tool, evidence.assets[0]?.kind), copy),
                statusLabel: copy.reviewed,
              }]
            : []
        )),
      },
      affordances: filingAffordances.map((affordance, index) => (
        affordanceViewModel(affordance, index, interfaceLocale, copy, copy.officialAction)
      )),
    },
    inbox: {
      selectedThreadId: selection.selectedThreadId ?? callId,
      replyDraft: selection.replyDraft,
      ...(inboxQuickPrompts.length > 0 ? { quickPrompts: inboxQuickPrompts } : {}),
      threads: [{
        id: callId,
        sender: callerName,
        subject: copy.openingNotice,
        preview: openingText,
        timestampLabel: startLabel(manifest, copy),
        unread: true,
      }],
      messages: [{
        id: `${callId}-message`,
        author: callerName,
        body: openingText,
        timestampLabel: startLabel(manifest, copy),
        direction: 'incoming',
      }],
    },
    phone: {
      clockLabel: caseClockLabel(manifest, runtime?.clocks.caseTimeMs ?? 0),
      selectedContactId: selection.selectedContactId ?? callerId,
      affordances: unassignedPhoneAffordances.map((affordance, index) => (
        affordanceViewModel(affordance, index, interfaceLocale, copy, copy.action)
      )),
      contacts: phoneContacts,
      recentCalls: [
        ...completedPhoneCalls,
        {
          id: `opening-${callerId}`,
          contactId: callerId,
          contactName: callerName,
          timestampLabel: startLabel(manifest, copy),
          detailLabel: copy.openingCall,
          direction: 'incoming',
        },
      ],
      ...(selection.activeCallContactId ? {
        activeCall: {
          contactId: selection.activeCallContactId,
          contactName: (() => {
            const actor = runtime?.actors.find(({ id }) => id === selection.activeCallContactId)
            return actor?.displayName?.trim()
              || actor?.name?.trim()
              || castText(manifest, selection.activeCallContactId, 'name')
              || copy.casePerson
          })(),
          elapsedLabel: '00:00',
          transcript: completedAffordances.flatMap((completed) => {
            if (completed.surface !== 'phone' || completed.intent.kind !== 'action') return []
            const action = completed.intent.action
            const relatesToContact = [action.actor, action.from, action.target]
              .includes(selection.activeCallContactId)
            const result = completed.result?.trim()
            return relatesToContact && result ? [result] : []
          }),
        },
      } : {}),
    },
    files,
    web: {
      query: selection.query,
      affordances: affordancesFor('web').map((affordance, index) => (
        affordanceViewModel(affordance, index, interfaceLocale, copy, copy.research)
      )),
      results: completedWebResults.map((result) => ({
          id: result.id,
          title: result.title,
          displayUrl: result.displayUrl,
          excerpt: result.result,
          sourceLabel: copy.policeQuery,
        })),
      ...(activeResearchResult ? {
        activePage: {
          id: activeResearchResult.id,
          title: activeResearchResult.title,
          displayUrl: activeResearchResult.displayUrl,
          paragraphs: [activeResearchResult.result],
        },
      } : {}),
    },
    rail: {
      selectedEvidenceId: selection.selectedEvidenceId ?? runtimeEvidence[0]?.id,
      selectedQuestionId: selection.selectedQuestionId,
      evidence: runtimeEvidence.map((evidence, index) => ({
        id: evidence.id,
        label: evidenceTitle(evidence, index, copy),
        sourceLabel: assetKindLabel(assetKind(evidence.tool, evidence.assets[0]?.kind), copy),
        observed: evidence.observed,
        assetKind: assetKind(evidence.tool, evidence.assets[0]?.kind),
      })),
      questions: [
        ...readyDeductions.map((affordance, index) => ({
          id: `deduction-${affordance.id}`,
          text: affordanceLabel(affordance, `${copy.deduction} ${index + 1}`),
          status: 'open' as const,
          detail: copy.readyInNotes,
        })),
        ...(runtime?.supportedDeductions ?? []).map((deduction, index) => ({
          id: `supported-${deduction.id}`,
          text: deduction.label?.trim() || `${copy.verifiedDeduction} ${index + 1}`,
          status: 'answered' as const,
          detail: `${copy.verifiedByEvidence}.`,
        })),
        ...currentLeads.slice(0, 5).map((lead) => ({
          id: `lead-${lead.id}`,
          text: lead.label,
          status: 'open' as const,
          detail: `${copy.inApplicationPrefix}${copy.apps[lead.surface]} ${copy.inApplication}`,
        })),
      ],
    },
  }
}
