import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import casebookIcon from 'lucide-static/icons/notebook-pen.svg'
import caseBoardIcon from 'lucide-static/icons/network.svg'
import evidenceIcon from 'lucide-static/icons/file-search.svg'
import filesIcon from 'lucide-static/icons/folder-open.svg'
import inboxIcon from 'lucide-static/icons/messages-square.svg'
import dispatchIcon from 'lucide-static/icons/landmark.svg'
import phoneIcon from 'lucide-static/icons/phone.svg'
import rotateCcwIcon from 'lucide-static/icons/rotate-ccw.svg'
import triangleAlertIcon from 'lucide-static/icons/triangle-alert.svg'
import webIcon from 'lucide-static/icons/compass.svg'
import opencasePhoneWallpaper from './assets/shell/opencase-phone-wallpaper.png'
import opencaseWallpaper from './assets/shell/opencase-wallpaper.png'
import { AccessibleModal, ModalBackground } from './AccessibleModal'
import { CaseOutcomeReport } from './CaseOutcomeReport'
import {
  CaseLibraryClientError,
  caseLibraryClient,
  type CaseCatalogEntry,
} from './case-library-client'
import { browserGameSessionClient } from './browser-host/game-client'
import {
  createLocalStorageLayoutPersistence,
  DesktopShell,
  kebabCaseChannelName,
  type DesktopItemDefinition,
  type ShellAppDefinition,
} from './shell'
import {
  AssetViewerDialog,
  CaseBoardApp,
  CaseDispatchApp,
  CasebookApp,
  EvidenceQuestionsRail,
  FilesApp,
  InboxApp,
  PhoneApp,
  type AuthorizedAssetViewModel,
  type InboxViewModel,
  type PhoneOpenContactRequest,
  type PhoneOutgoingCallViewModel,
  type PhoneViewModel,
  WebResearchApp,
} from './shell/apps'
import { createCaseBoardViewModel } from './shell/case-board-model'
import { createCaseBoardPersistence } from './shell/case-board-state'
import { createCaseChannelActivityMessages } from './shell/case-channel-activity'
import {
  appendForensicsRequest,
  clearForensicsWorkflow,
  createAsyncForensicsRequest,
  createForensicsRequest,
  FORENSICS_LEAD_NAME,
  FORENSICS_THREAD_ID,
  FORENSICS_TYPING_DELAY_MS,
  forensicsReplyDurationMs,
  type ForensicsRequestRecord,
  type ForensicsWorkflowState,
  readForensicsWorkflow,
  updateForensicsRequest,
  writeForensicsWorkflow,
} from './shell/forensics-workflow'
import {
  caseClockLabel,
  caseTimeLabel,
  createManifestWorkspaceModels,
  type ManifestWorkspaceSelection,
  type ShellPublicCaseManifest,
} from './shell/manifest-workspace'
import type { PublicCaseRuntimeState } from './case-runtime/protocol'
import {
  createPlayerProfileStore,
  type PlayerPreferredLocale,
  type PlayerProfileStore,
} from './player-profiles'
import {
  SettingsWorkspace,
  type InstalledCaseSummary,
  type SettingsImportRequest,
  type SettingsImportState,
} from './settings'
import {
  type AppLocale,
  detectBrowserLocale,
  UiLocaleProvider,
  useUiCopy,
  useUiLocale,
} from './ui-locale'
import {
  type DemoBrowserIntent,
  type DemoCaseSessionRef,
  type DemoCommandResponse,
} from './demo-host-client'

const CASE_PREFERENCE_KEY = 'opencase:selected-case'
const LEGACY_CASE_PREFERENCE_KEY = 'karanlik-oda:selected-case'
const BRAND_STORAGE_PREFIX = 'opencase:v1'
const LEGACY_BRAND_STORAGE_PREFIX = 'dedektif:v1'

type OpeningPhase = 'checking' | 'ringing' | 'missed' | 'connected' | 'active' | 'restarting' | 'error'

interface AppCopy {
  readonly newEvidence: string
  readonly evidence: string
  readonly evidenceAdded: (title: string) => string
  readonly evidenceAddedMany: (count: number) => string
  readonly dispatchReady: string
  readonly dispatchReadyMany: (count: number) => string
  readonly contactResearchReady: string
  readonly contactResearchReadyMany: (count: number) => string
  readonly evidenceInspected: (title: string) => string
  readonly deductionVerified: string
  readonly actionCompleted: string
  readonly actionFailed: string
  readonly actionUnavailable: string
  readonly dispatchCompleted: string
  readonly activeCallFirst: string
  readonly lineBusy: string
  readonly callFailed: string
  readonly contactUnavailable: string
  readonly conversation: string
  readonly callCompleted: string
  readonly noAdditionalFinding: string
  readonly forensicsReviewComplete: (title: string, detail: string) => string
  readonly forensicsReviewRequest: (lead: string, title: string) => string
  readonly newPerson: string
  readonly forensicsReviewNotice: (title: string, lead: string) => string
  readonly forensicsRequestNotice: (subject: string, lead: string) => string
  readonly forensicsReviewFailed: string
  readonly forensicsRequestFailed: string
  readonly recordUnavailable: string
  readonly recordAlreadyReviewed: string
  readonly forensicsCompletingReview: (lead: string) => string
  readonly sentForReview: (title: string, lead: string) => string
  readonly researchUnavailable: string
  readonly forensicsCompletingRequest: (lead: string) => string
  readonly investigationRequest: string
  readonly requestSent: (subject: string, lead: string) => string
  readonly noRequests: string
  readonly forensicReview: string
  readonly now: string
  readonly typing: string
  readonly detective: string
  readonly investigatorRole: string
  readonly system: string
  readonly contactAdded: (name: string) => string
  readonly openContact: (name: string) => string
  readonly openContactAccessible: (name: string) => string
  readonly bureau: string
  readonly forensicsLeadRole: string
  readonly askLead: string
  readonly caseDeskTopic: string
  readonly forensicsTopic: string
  readonly operations: string
  readonly operationsTopic: string
  readonly evidenceChain: string
  readonly evidenceChainTopic: string
  readonly shiftHandoff: string
  readonly shiftHandoffTopic: string
  readonly officeManagement: string
  readonly officeManagementTopic: string
  readonly casebookApp: string
  readonly caseBoardApp: string
  readonly dispatchApp: string
  readonly inboxApp: string
  readonly evidenceRailApp: string
  readonly deductionUnavailable: string
  readonly searchUnavailable: string
  readonly desktopAria: (title: string) => string
  readonly finalSubmission: string
  readonly caseAction: string
  readonly finalDecision: string
  readonly consequentialAction: string
  readonly confirmAction: string
  readonly actionConsequence: string
  readonly duration: (minutes: number) => string
  readonly cancel: string
  readonly submitFinalReport: string
  readonly approveAndSend: string
  readonly takeAction: string
  readonly inspectDesktop: string
  readonly playAgain: string
  readonly newInvestigation: string
  readonly restartTitle: string
  readonly restartDescription: string
  readonly eraseAndRestart: string
  readonly unknownCaller: string
  readonly caseLiaison: string
  readonly secureCaseLine: string
  readonly incomingCall: string
  readonly newCaseCall: string
  readonly incomingCallAria: (title: string) => string
  readonly bootFailed: string
  readonly bootPreparing: string
  readonly bootFailureDetail: string
  readonly loading: string
  readonly connectionFailed: string
  readonly caseStartFailed: string
  readonly caseResetFailed: string
  readonly commandErrors: Readonly<Record<string, string>>
  readonly commandErrorFallback: string
}

const APP_COPY: Readonly<Record<AppLocale, AppCopy>> = {
  tr: {
    newEvidence: 'Yeni kanıt',
    evidence: 'Kanıt',
    evidenceAdded: (title) => `${title} Finder'a eklendi.`,
    evidenceAddedMany: (count) => `${count} yeni kanıt Finder'a eklendi.`,
    dispatchReady: 'Dosya İşlemleri’nde yeni bir onay bekliyor.',
    dispatchReadyMany: (count) => `Dosya İşlemleri’nde ${count} yeni onay bekliyor.`,
    contactResearchReady: 'Vaka Notları’nda yeni bir kişi araştırması hazır.',
    contactResearchReadyMany: (count) => `Vaka Notları’nda ${count} yeni kişi araştırması hazır.`,
    evidenceInspected: (title) => `${title} incelendi. Bulgular Vaka Notları'na eklendi.`,
    deductionVerified: 'Çıkarım kanıtlarla doğrulandı.',
    actionCompleted: 'İşlem tamamlandı. Yeni bilgiler Vaka Notları’na işlendi.',
    actionFailed: 'İşlem tamamlanamadı. Tekrar deneyin.',
    actionUnavailable: 'Bu hamle artık kullanılabilir değil.',
    dispatchCompleted: 'İşlem iletildi. Sonuç vaka dosyasına kaydedildi.',
    activeCallFirst: 'Önce devam eden görüşmeyi tamamla.',
    lineBusy: 'Hat şu anda başka bir işlemle meşgul. Biraz sonra tekrar ara.',
    callFailed: 'Arama tamamlanamadı. Bağlantıyı kontrol edip tekrar dene.',
    contactUnavailable: 'Bu kişi artık telefon rehberinde görünmüyor.',
    conversation: 'Görüşme',
    callCompleted: 'Görüşme tamamlandı. Yeni bilgiler vaka notlarına işlendi.',
    noAdditionalFinding: 'Kayıt kontrol edildi; ek bir bulgu görünmüyor.',
    forensicsReviewComplete: (title, detail) => `“${title}” için inceleme tamam. ${detail}`,
    forensicsReviewRequest: (lead, title) => `${lead}, “${title}” kaydını incelemeye alır mısın? Görünen içeriği ve önemli ayrıntıları kontrol et.`,
    newPerson: 'Yeni kişi',
    forensicsReviewNotice: (title, lead) => `${title} incelemesi tamamlandı. ${lead} bulguları paylaştı.`,
    forensicsRequestNotice: (subject, lead) => `${subject} tamamlandı. ${lead} yanıtını paylaştı.`,
    forensicsReviewFailed: 'İncelemeyi tamamlayamadım. Kaydı yeniden gönderebilir misin?',
    forensicsRequestFailed: 'İsteği tamamlayamadım. Soruyu yeniden gönderebilir misin?',
    recordUnavailable: 'Bu kayıt artık erişilebilir değil.',
    recordAlreadyReviewed: 'Bu kayıt zaten incelendi.',
    forensicsCompletingReview: (lead) => `${lead} mevcut incelemeyi tamamlıyor.`,
    sentForReview: (title, lead) => `${title} inceleme için ${lead}'a gönderildi.`,
    researchUnavailable: 'Bu araştırma isteği artık kullanılamıyor.',
    forensicsCompletingRequest: (lead) => `${lead} mevcut isteği tamamlıyor.`,
    investigationRequest: 'Soruşturma isteği',
    requestSent: (subject, lead) => `${subject} isteği ${lead}'a gönderildi.`,
    noRequests: 'Henüz istek yok.',
    forensicReview: 'Adli inceleme',
    now: 'Şimdi',
    typing: 'yazıyor',
    detective: 'Dedektif',
    investigatorRole: 'Soruşturma sorumlusu',
    system: 'Sistem',
    contactAdded: (name) => `${name} Kişiler’e eklendi.`,
    openContact: (name) => `${name} kişisini iPhone’da aç`,
    openContactAccessible: (name) => `${name} kişi kartını iPhone’da aç`,
    bureau: 'OpenCase Bürosu',
    forensicsLeadRole: 'İç ekip · Adli inceleme lideri',
    askLead: 'Ece’ye sor',
    caseDeskTopic: 'Aktif vaka, saha notları ve görev bildirimleri',
    forensicsTopic: 'Kanıt incelemeleri ve soruşturma talepleri',
    operations: 'operasyon',
    operationsTopic: 'Saha koordinasyonu',
    evidenceChain: 'delil-zinciri',
    evidenceChainTopic: 'Teslim ve muhafaza kayıtları',
    shiftHandoff: 'nöbet-devir',
    shiftHandoffTopic: 'Vardiya notları ve açık işler',
    officeManagement: 'büro-yönetimi',
    officeManagementTopic: 'Ekip içi duyurular',
    casebookApp: 'Vaka Notları',
    caseBoardApp: 'Vaka Panosu',
    dispatchApp: 'Dosya İşlemleri',
    inboxApp: 'Gelen Kutusu',
    evidenceRailApp: 'Kanıt / Sorular',
    deductionUnavailable: 'Bu çıkarım artık değerlendirilebilir değil.',
    searchUnavailable: 'Bu arama için doğrulanmış bir yol yok. Önerilen araştırmalardan birini kullan.',
    desktopAria: (title) => `${title} dedektif çalışma masası`,
    finalSubmission: 'Nihai dosya gönderimi',
    caseAction: 'Dosya işlemi',
    finalDecision: 'Son karar',
    consequentialAction: 'Sonucu olan hamle',
    confirmAction: 'Bu hamleyi yapmak istiyor musun?',
    actionConsequence: 'Bu hamle soruşturmanın gidişini kalıcı olarak değiştirebilir.',
    duration: (minutes) => `${minutes} dk sürecek`,
    cancel: 'Vazgeç',
    submitFinalReport: 'Nihai raporu ilet',
    approveAndSend: 'Onayla ve ilet',
    takeAction: 'Hamleyi yap',
    inspectDesktop: 'Masaüstünü incele',
    playAgain: 'Yeniden oyna',
    newInvestigation: 'Yeni soruşturma',
    restartTitle: 'Bu vakaya baştan başlamak istiyor musun?',
    restartDescription: 'Gözlemler, çıkarımlar, görüşmeler, geçen süre ve bu vakaya ait masa düzeni silinecek.',
    eraseAndRestart: 'Sil ve baştan başla',
    unknownCaller: 'Bilinmeyen arayan',
    caseLiaison: 'Vaka bağlantısı',
    secureCaseLine: 'Güvenli Vaka Hattı',
    incomingCall: 'Gelen Çağrı',
    newCaseCall: 'Yeni vaka çağrısı',
    incomingCallAria: (title) => `${title} gelen vaka çağrısı`,
    bootFailed: 'Vaka masası açılamadı',
    bootPreparing: 'Güvenli masa hazırlanıyor',
    bootFailureDetail: 'Vaka dosyaları yüklenemedi. Sayfayı yenileyip tekrar deneyin.',
    loading: 'Yükleniyor',
    connectionFailed: 'Bağlantı kurulamadı. Sayfayı yenileyip tekrar deneyin.',
    caseStartFailed: 'Vaka başlatılamadı. Tekrar deneyin.',
    caseResetFailed: 'Vaka sıfırlanamadı. Tekrar deneyin.',
    commandErrors: {
      'evidence-locked': 'Bu kanıta henüz erişimin yok. Önce açık ipuçlarını takip et.',
      'evidence-already-observed': 'Bu kanıt zaten incelendi.',
      'evidence-not-observed': 'Bu hamleden önce ilgili kanıtı incelemelisin.',
      'deduction-unproven': 'Bu çıkarım için henüz yeterli kanıt yok.',
      'deduction-requires-support': 'Önce önceki çıkarımları tamamlamalısın.',
      'deduction-already-supported': 'Bu çıkarım zaten doğrulandı.',
      'actor-unavailable': 'Bu kişi şu anda görüşmeye açık değil.',
      'affordance-unavailable': 'Bu fırsat artık açık değil. Güncel ipuçlarına bak.',
      'affordance-command-mismatch': 'Bu hamle şu anda bu şekilde yapılamıyor.',
      'final-conclusion-locked': 'Vaka için son karar zaten verildi.',
      'case-ended': 'Bu vaka kapandı. Yeni bir hamle yapılamaz.',
    },
    commandErrorFallback: 'Bu hamle şu anda yapılamıyor.',
  },
  en: {
    newEvidence: 'New evidence',
    evidence: 'Evidence',
    evidenceAdded: (title) => `${title} was added to Finder.`,
    evidenceAddedMany: (count) => `${count} new evidence records were added to Finder.`,
    dispatchReady: 'A new approval is waiting in Case Actions.',
    dispatchReadyMany: (count) => `${count} new approvals are waiting in Case Actions.`,
    contactResearchReady: 'A new contact research task is ready in Case Notes.',
    contactResearchReadyMany: (count) => `${count} new contact research tasks are ready in Case Notes.`,
    evidenceInspected: (title) => `${title} was reviewed. The findings were added to Case Notes.`,
    deductionVerified: 'The deduction was verified with evidence.',
    actionCompleted: 'Action completed. New information was added to Case Notes.',
    actionFailed: 'The action could not be completed. Try again.',
    actionUnavailable: 'This action is no longer available.',
    dispatchCompleted: 'The action was sent. Its result was saved to the case file.',
    activeCallFirst: 'Finish the current call first.',
    lineBusy: 'The line is busy with another action. Call again shortly.',
    callFailed: 'The call could not be completed. Check the connection and try again.',
    contactUnavailable: 'This person is no longer in the phone contacts.',
    conversation: 'Call',
    callCompleted: 'Call completed. New information was added to the case notes.',
    noAdditionalFinding: 'The record was checked; there are no additional findings.',
    forensicsReviewComplete: (title, detail) => `Review complete for “${title}”. ${detail}`,
    forensicsReviewRequest: (lead, title) => `${lead}, can you review “${title}”? Check the visible content and any important details.`,
    newPerson: 'New person',
    forensicsReviewNotice: (title, lead) => `${title} review completed. ${lead} shared the findings.`,
    forensicsRequestNotice: (subject, lead) => `${subject} completed. ${lead} shared a reply.`,
    forensicsReviewFailed: 'I could not complete the review. Can you send the record again?',
    forensicsRequestFailed: 'I could not complete the request. Can you send the question again?',
    recordUnavailable: 'This record is no longer available.',
    recordAlreadyReviewed: 'This record has already been reviewed.',
    forensicsCompletingReview: (lead) => `${lead} is finishing the current review.`,
    sentForReview: (title, lead) => `${title} was sent to ${lead} for review.`,
    researchUnavailable: 'This research request is no longer available.',
    forensicsCompletingRequest: (lead) => `${lead} is finishing the current request.`,
    investigationRequest: 'Investigation request',
    requestSent: (subject, lead) => `${subject} was sent to ${lead}.`,
    noRequests: 'No requests yet.',
    forensicReview: 'Forensics review',
    now: 'Now',
    typing: 'typing',
    detective: 'Detective',
    investigatorRole: 'Investigator in charge',
    system: 'System',
    contactAdded: (name) => `${name} was added to Contacts.`,
    openContact: (name) => `Open ${name} on iPhone`,
    openContactAccessible: (name) => `Open ${name}'s contact card on iPhone`,
    bureau: 'OpenCase Bureau',
    forensicsLeadRole: 'Internal team · Forensics lead',
    askLead: 'Ask Ece',
    caseDeskTopic: 'Active case, field notes, and task updates',
    forensicsTopic: 'Evidence reviews and investigation requests',
    operations: 'operations',
    operationsTopic: 'Field coordination',
    evidenceChain: 'chain-of-custody',
    evidenceChainTopic: 'Evidence transfer and custody records',
    shiftHandoff: 'shift-handoff',
    shiftHandoffTopic: 'Shift notes and open work',
    officeManagement: 'office-management',
    officeManagementTopic: 'Internal team announcements',
    casebookApp: 'Case Notes',
    caseBoardApp: 'Case Board',
    dispatchApp: 'Case Actions',
    inboxApp: 'Inbox',
    evidenceRailApp: 'Evidence / Questions',
    deductionUnavailable: 'This deduction can no longer be evaluated.',
    searchUnavailable: 'There is no verified path for this search. Use one of the suggested research tasks.',
    desktopAria: (title) => `${title} detective workspace`,
    finalSubmission: 'Final case submission',
    caseAction: 'Case action',
    finalDecision: 'Final decision',
    consequentialAction: 'Consequential action',
    confirmAction: 'Do you want to take this action?',
    actionConsequence: 'This action may permanently change the course of the investigation.',
    duration: (minutes) => `Takes ${minutes} min`,
    cancel: 'Cancel',
    submitFinalReport: 'Submit final report',
    approveAndSend: 'Approve and send',
    takeAction: 'Take action',
    inspectDesktop: 'Review desktop',
    playAgain: 'Play again',
    newInvestigation: 'New investigation',
    restartTitle: 'Do you want to restart this case?',
    restartDescription: 'Observations, deductions, calls, elapsed time, and this case\'s desktop layout will be erased.',
    eraseAndRestart: 'Erase and restart',
    unknownCaller: 'Unknown caller',
    caseLiaison: 'Case liaison',
    secureCaseLine: 'Secure Case Line',
    incomingCall: 'Incoming Call',
    newCaseCall: 'New case call',
    incomingCallAria: (title) => `Incoming case call for ${title}`,
    bootFailed: 'Could not open the case desk',
    bootPreparing: 'Preparing secure desk',
    bootFailureDetail: 'The case files could not be loaded. Refresh the page and try again.',
    loading: 'Loading',
    connectionFailed: 'Could not connect. Refresh the page and try again.',
    caseStartFailed: 'The case could not be started. Try again.',
    caseResetFailed: 'The case could not be reset. Try again.',
    commandErrors: {
      'evidence-locked': 'You do not have access to this evidence yet. Follow the available leads first.',
      'evidence-already-observed': 'This evidence has already been reviewed.',
      'evidence-not-observed': 'Review the related evidence before taking this action.',
      'deduction-unproven': 'There is not enough evidence for this deduction yet.',
      'deduction-requires-support': 'Complete the earlier deductions first.',
      'deduction-already-supported': 'This deduction has already been verified.',
      'actor-unavailable': 'This person is not available to talk right now.',
      'affordance-unavailable': 'This opportunity is no longer available. Check the current leads.',
      'affordance-command-mismatch': 'This action cannot be taken this way right now.',
      'final-conclusion-locked': 'The final decision for this case has already been made.',
      'case-ended': 'This case is closed. No new actions can be taken.',
    },
    commandErrorFallback: 'This action cannot be taken right now.',
  },
}

function desktopLayoutKey(
  manifest: ShellPublicCaseManifest,
  saveId: string,
  prefix: string = BRAND_STORAGE_PREFIX,
): string {
  return `${prefix}:profile:${saveId}:case:${manifest.case.id}:${manifest.case.version}:desktop-layout`
}

function forensicsWorkflowKey(
  manifest: ShellPublicCaseManifest,
  assetSessionId: string,
  saveId: string,
  prefix: string = BRAND_STORAGE_PREFIX,
): string {
  return `${prefix}:profile:${saveId}:case:${manifest.case.id}:${manifest.case.version}:${assetSessionId}:forensics-workflow`
}

function caseBoardStateKey(
  manifest: ShellPublicCaseManifest,
  caseDigest: string,
  saveId: string,
  prefix: string = BRAND_STORAGE_PREFIX,
): string {
  return `${prefix}:profile:${saveId}:case:${manifest.case.id}:${manifest.case.version}:${caseDigest}:case-board`
}

function browserLocalStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function castValue(manifest: ShellPublicCaseManifest, actorId: string, field: string): string | undefined {
  const actor = manifest.cast[actorId]
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return undefined
  const value = (actor as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

function playerFacingLabel(value: string): string {
  return value.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function completedForensicsReply(
  snapshot: PublicCaseRuntimeState,
  request: ForensicsRequestRecord,
  copy: AppCopy,
): string | undefined {
  if (request.kind === 'async-interaction') {
    return snapshot.completedAffordances
      .find(({ id }) => id === request.affordanceId)
      ?.result
      ?.trim()
      .slice(0, 12_000)
  }
  const evidence = snapshot.evidence.find(({ id }) => id === request.evidenceId)
  if (!evidence?.observed) return undefined

  const findings = evidence.findings
    .map(({ text }) => text?.trim())
    .filter((text): text is string => Boolean(text))
  const detail = findings.length > 0
    ? findings.join(' ')
    : evidence.description?.trim() || copy.noAdditionalFinding
  return copy.forensicsReviewComplete(request.evidenceTitle, detail).slice(0, 12_000)
}

function forensicsRequestBody(request: ForensicsRequestRecord, copy: AppCopy): string {
  if (request.kind === 'async-interaction') return request.requestBody
  return copy.forensicsReviewRequest(FORENSICS_LEAD_NAME, request.evidenceTitle)
}

function forensicsRequestSubject(request: ForensicsRequestRecord): string {
  return request.kind === 'async-interaction' ? request.subjectLabel : request.evidenceTitle
}

function revealedActor(
  snapshot: PublicCaseRuntimeState,
  request: ForensicsRequestRecord,
  copy: AppCopy,
): { readonly id: string; readonly name: string } | undefined {
  if (request.kind !== 'async-interaction') return undefined
  const completed = snapshot.completedAffordances.find(({ id }) => id === request.affordanceId)
  const listedByCommand = completed?.contactsListed ?? []
  if (listedByCommand.length !== 1) return undefined
  const actor = snapshot.actors.find(({ id }) => id === listedByCommand[0])
  if (!actor) return undefined
  return {
    id: actor.id,
    name: actor.displayName?.trim() || actor.name?.trim() || copy.newPerson,
  }
}

function completeForensicsRecord(
  request: ForensicsRequestRecord,
  snapshot: PublicCaseRuntimeState,
  replyBody: string,
  replyLabel: string,
  copy: AppCopy,
): ForensicsRequestRecord {
  if (request.kind === 'evidence-review') {
    return { ...request, status: 'complete', replyBody, replyLabel }
  }
  const actor = revealedActor(snapshot, request, copy)
  return {
    ...request,
    status: 'complete',
    replyBody,
    replyLabel,
    ...(actor ? { revealedActorId: actor.id, revealedActorName: actor.name } : {}),
  }
}

type IntentExecution =
  | { readonly kind: 'busy' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'response'; readonly response: DemoCommandResponse }

type PublicAffordance = PublicCaseRuntimeState['affordances'][number]
type DemoActionIntent = Extract<DemoBrowserIntent, { readonly kind: 'action' }>
type PhoneCallResultMatch =
  | { readonly affordanceId: string }
  | { readonly action: DemoActionIntent }

export const OUTGOING_CALL_DIAL_MS = 900
export const OUTGOING_CALL_SPEAK_MS = 2_400
export const OUTGOING_CALL_END_MS = 320

const ACTION_FIELDS = [
  'action',
  'target',
  'actor',
  'from',
  'topic',
  'evidence',
  'tone',
  'query',
  'ref',
] as const

function sameAction(
  completed: Extract<PublicAffordance['intent'], { readonly kind: 'action' }>['action'],
  requested: DemoActionIntent,
): boolean {
  return ACTION_FIELDS.every((field) => completed[field] === requested[field])
}

function outgoingCallDurations(): {
  readonly dialMs: number
  readonly speakMs: number
  readonly endMs: number
} {
  const reduceMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduceMotion
    ? { dialMs: 80, speakMs: 240, endMs: 80 }
    : {
        dialMs: OUTGOING_CALL_DIAL_MS,
        speakMs: OUTGOING_CALL_SPEAK_MS,
        endMs: OUTGOING_CALL_END_MS,
      }
}

function playerCommandError(code: string, copy: AppCopy): string {
  return copy.commandErrors[code] ?? copy.commandErrorFallback
}

function outgoingCallOutcome(
  execution: IntentExecution,
  completedBefore: number,
  match: PhoneCallResultMatch,
  copy: AppCopy,
): { readonly successful: boolean; readonly result: string } {
  if (execution.kind === 'busy') {
    return { successful: false, result: copy.lineBusy }
  }
  if (execution.kind === 'failed') {
    return { successful: false, result: copy.callFailed }
  }
  if (!execution.response.ok) {
    return {
      successful: false,
      result: playerCommandError(execution.response.error.code, copy),
    }
  }
  const matchingResults = execution.response.snapshot.completedAffordances
    .slice(completedBefore)
    .filter((completed) => (
      completed.surface === 'phone'
      && Boolean(completed.result?.trim())
      && ('affordanceId' in match
        ? completed.id === match.affordanceId
        : completed.intent.kind === 'action' && sameAction(completed.intent.action, match.action))
    ))
  const latestPhoneResult = matchingResults
    .at(-1)
    ?.result
    ?.trim()
  return {
    successful: true,
    result: latestPhoneResult || copy.callCompleted,
  }
}

function installedCaseSummary(entry: CaseCatalogEntry): InstalledCaseSummary {
  return {
    id: caseSelectionKey(entry),
    version: entry.version,
    title: entry.title,
    synopsis: entry.synopsis,
    locales: entry.locales,
    source: entry.source.kind === 'built-in'
      ? { kind: 'built-in', label: entry.source.label }
      : {
          kind: entry.source.kind,
          url: entry.source.url,
          ...(entry.source.revision ? { label: entry.source.revision.slice(0, 8) } : {}),
        },
    verification: entry.verification.level === 'compiler-and-smoke'
      ? 'compatible'
      : 'verified',
  }
}

function caseSelectionKey(entry: Pick<CaseCatalogEntry, 'id' | 'version'>): string {
  return `${entry.id}@${entry.version}`
}

function selectedCatalogEntry(
  catalog: readonly CaseCatalogEntry[] | null,
  selection: string | undefined,
): CaseCatalogEntry | undefined {
  if (!catalog || catalog.length === 0) return undefined
  if (!selection) return catalog[0]
  return catalog.find((entry) => caseSelectionKey(entry) === selection)
    ?? catalog.find(({ id }) => id === selection)
    ?? catalog[0]
}

function importFailureCopy(locale: PlayerPreferredLocale, error: unknown): {
  readonly message: string
  readonly details?: string
} {
  const fallback = locale === 'tr'
    ? 'Vaka eklenemedi. Bağlantıyı ve vaka dosyasını kontrol et.'
    : 'The case could not be added. Check the link and case files.'
  if (!(error instanceof CaseLibraryClientError)) return { message: fallback }
  const known: Readonly<Record<string, readonly [string, string]>> = {
    'case-tests-failed': [
      'Vakanın kendi testlerinden biri başarısız oldu.',
      'One or more authored case tests failed.',
    ],
    'case-validation-failed': [
      'Vaka dosyaları opencase formatına uymuyor.',
      'The case files do not match the opencase format.',
    ],
    'direct-yaml-assets-unsupported': [
      'Tek YAML bağlantıları varlık içeremez. Görsel veya ses için GitHub klasörü kullan.',
      'Direct YAML cannot include assets. Use a GitHub folder for images or audio.',
    ],
    'direct-yaml-i18n-unsupported': [
      'Tek YAML bağlantısında çeviri anahtarları kullanılamaz. Metinleri doğrudan YAML içine yaz.',
      'Direct YAML cannot use translation keys. Put literal text in the YAML file.',
    ],
    'github-case-not-found': [
      'GitHub bağlantısında bir case.yml bulunamadı.',
      'No case.yml was found at the GitHub URL.',
    ],
    'case-version-conflict': [
      'Bu vaka sürümü farklı içerikle zaten yüklü.',
      'This case version is already installed with different content.',
    ],
    'unsafe-import-url': [
      'Yalnızca herkese açık ve güvenli HTTPS bağlantıları kullanılabilir.',
      'Only public, safe HTTPS links can be imported.',
    ],
  }
  const copy = known[error.code]
  const details = error.diagnostics
    .map((diagnostic) => [diagnostic.path, diagnostic.message].filter(Boolean).join(': '))
    .join('\n')
  return {
    message: copy ? copy[locale === 'tr' ? 0 : 1] : error.message || fallback,
    ...(details ? { details } : {}),
  }
}

function clearProfileSidecars(profileId: string): void {
  try {
    const prefixes = [
      `${BRAND_STORAGE_PREFIX}:profile:${profileId}:`,
      `${LEGACY_BRAND_STORAGE_PREFIX}:profile:${profileId}:`,
    ]
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => (
      window.localStorage.key(index)
    )).filter((key): key is string => Boolean(
      key && prefixes.some((prefix) => key.startsWith(prefix)),
    ))
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // Profile metadata remains authoritative when browser storage is restricted.
  }
}

export function readCasePreference(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): string | undefined {
  try {
    const current = storage.getItem(CASE_PREFERENCE_KEY)
    if (current !== null) return current
    const legacy = storage.getItem(LEGACY_CASE_PREFERENCE_KEY)
    if (legacy !== null) {
      try {
        storage.setItem(CASE_PREFERENCE_KEY, legacy)
      } catch {
        // A readable legacy preference remains valid if its best-effort rewrite is blocked.
      }
    }
    return legacy ?? undefined
  } catch {
    return undefined
  }
}

function writeCasePreference(caseId: string): void {
  try {
    window.localStorage.setItem(CASE_PREFERENCE_KEY, caseId)
  } catch {
    // The selected case is a convenience preference; blocked storage is safe.
  }
}

interface WorkspaceSettingsContext {
  readonly activeCaseId: string
  readonly activeCaseLocale: string
  readonly caseStatus: 'not-started' | 'active' | 'ended'
  readonly autosaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  readonly busy?: boolean
  readonly deadline?: {
    readonly title?: string
    readonly remainingMs: number
  }
  readonly onRestart: () => void
}

type RenderWorkspaceSettings = (context: WorkspaceSettingsContext) => ReactNode

interface CaseDesktopProps {
  readonly manifest: ShellPublicCaseManifest
  readonly snapshot: PublicCaseRuntimeState
  readonly assetSessionId: string
  readonly runEpoch: number
  readonly saveId: string
  readonly detectiveDisplayName: string
  readonly renderSettings: RenderWorkspaceSettings
  readonly onCommand: (intent: DemoBrowserIntent) => Promise<DemoCommandResponse>
  readonly onRestart: () => Promise<void>
}

function CaseDesktop({
  manifest,
  snapshot,
  assetSessionId,
  runEpoch,
  saveId,
  detectiveDisplayName,
  renderSettings,
  onCommand,
  onRestart,
}: CaseDesktopProps) {
  const uiLocale = useUiLocale()
  const copy = useUiCopy(APP_COPY)
  const detectiveName = detectiveDisplayName.trim() || copy.detective
  const workflowKey = useMemo(
    () => forensicsWorkflowKey(manifest, assetSessionId, saveId),
    [assetSessionId, manifest, saveId],
  )
  const legacyWorkflowKey = useMemo(
    () => forensicsWorkflowKey(manifest, assetSessionId, saveId, LEGACY_BRAND_STORAGE_PREFIX),
    [assetSessionId, manifest, saveId],
  )
  const [selection, setSelection] = useState<ManifestWorkspaceSelection>({
    query: '',
    replyDraft: '',
  })
  const [forensicsWorkflow, setForensicsWorkflow] = useState<ForensicsWorkflowState>(() => (
    readForensicsWorkflow(browserLocalStorage(), workflowKey, legacyWorkflowKey)
  ))
  const [streamingForensicsReply, setStreamingForensicsReply] = useState<{
    readonly requestId: string
    readonly endsAtWallMs: number
  }>()
  const [seenContactIds, setSeenContactIds] = useState<readonly string[]>([])
  const [phoneOpenContactRequest, setPhoneOpenContactRequest] = useState<PhoneOpenContactRequest>()
  const phoneOpenNonceRef = useRef(0)
  const [outgoingPhoneCall, setOutgoingPhoneCall] = useState<PhoneOutgoingCallViewModel>()
  const outgoingPhoneCallRef = useRef<PhoneOutgoingCallViewModel | undefined>(undefined)
  const outgoingPhoneCallSessionRef = useRef(0)
  const outgoingPhoneCallTimersRef = useRef(new Map<number, () => void>())
  const outgoingPhoneCallCommandStartedRef = useRef(false)
  const pendingPhoneFollowUpAppRef = useRef<string | undefined>(undefined)
  const pendingPhoneFollowUpNoticeRef = useRef<string | undefined>(undefined)
  const [commandBusy, setCommandBusy] = useState(false)
  const commandBusyRef = useRef(false)
  const forensicsInFlightRef = useRef(new Set<string>())
  const desktopMountedRef = useRef(true)
  const [commandNotice, setCommandNotice] = useState<string>()
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [restartBusy, setRestartBusy] = useState(false)
  const restartBusyRef = useRef(false)
  const [restartFromOutcome, setRestartFromOutcome] = useState(false)
  const [pendingAffordanceId, setPendingAffordanceId] = useState<string>()
  const [outcomeDismissed, setOutcomeDismissed] = useState(false)
  const [openAssetId, setOpenAssetId] = useState<string>()
  const initialAffordance = snapshot.affordances.find(({ risk }) => risk === 'normal')
    ?? snapshot.affordances[0]
  const initialAppId = snapshot.evidence.some(({ observed }) => !observed)
    ? 'files'
    : initialAffordance?.surface === 'casebook' && initialAffordance.intent.kind === 'action'
      ? 'case-dispatch'
      : initialAffordance?.surface ?? 'casebook'
  const [focusRequest, setFocusRequest] = useState<{ appId: string; nonce: number }>({
    appId: initialAppId,
    nonce: 1,
  })
  const focusNonceRef = useRef(1)
  const knownEvidenceRef = useRef(new Set(snapshot.evidence.map(({ id }) => id)))
  const knownDispatchAffordancesRef = useRef(new Set(
    snapshot.affordances.flatMap((affordance) => (
      affordance.surface === 'casebook' && affordance.intent.kind === 'action'
        ? [affordance.id]
        : []
    )),
  ))
  const knownContactActionAffordancesRef = useRef(new Set(
    snapshot.affordances.flatMap((affordance) => (
      affordance.surface === 'inbox' && affordance.interaction?.kind === 'async-message'
        ? [affordance.id]
        : []
    )),
  ))
  const focusApp = useCallback((appId: string) => {
    focusNonceRef.current += 1
    setFocusRequest({ appId, nonce: focusNonceRef.current })
  }, [])

  const updateOutgoingPhoneCall = useCallback((next: PhoneOutgoingCallViewModel | undefined) => {
    outgoingPhoneCallRef.current = next
    setOutgoingPhoneCall(next)
  }, [])

  const waitForOutgoingCall = useCallback((milliseconds: number): Promise<void> => (
    new Promise((resolve) => {
      const finish = () => {
        outgoingPhoneCallTimersRef.current.delete(timer)
        resolve()
      }
      const timer = window.setTimeout(finish, milliseconds)
      outgoingPhoneCallTimersRef.current.set(timer, finish)
    })
  ), [])

  const cancelOutgoingPhoneCall = useCallback(() => {
    outgoingPhoneCallSessionRef.current += 1
    for (const [timer, finish] of outgoingPhoneCallTimersRef.current) {
      window.clearTimeout(timer)
      finish()
    }
    outgoingPhoneCallTimersRef.current.clear()
    if (outgoingPhoneCallRef.current && !outgoingPhoneCallCommandStartedRef.current) {
      commandBusyRef.current = false
      setCommandBusy(false)
    }
    outgoingPhoneCallCommandStartedRef.current = false
    pendingPhoneFollowUpAppRef.current = undefined
    pendingPhoneFollowUpNoticeRef.current = undefined
    updateOutgoingPhoneCall(undefined)
  }, [updateOutgoingPhoneCall])

  useEffect(() => {
    desktopMountedRef.current = true
    return () => {
      desktopMountedRef.current = false
      outgoingPhoneCallSessionRef.current += 1
      for (const [timer, finish] of outgoingPhoneCallTimersRef.current) {
        window.clearTimeout(timer)
        finish()
      }
      outgoingPhoneCallTimersRef.current.clear()
    }
  }, [])

  const phoneRunKey = `${manifest.case.id}:${runEpoch}`
  const previousPhoneRunKeyRef = useRef(phoneRunKey)
  useEffect(() => {
    if (previousPhoneRunKeyRef.current === phoneRunKey) return
    previousPhoneRunKeyRef.current = phoneRunKey
    cancelOutgoingPhoneCall()
  }, [cancelOutgoingPhoneCall, phoneRunKey])

  useEffect(() => {
    writeForensicsWorkflow(browserLocalStorage(), workflowKey, forensicsWorkflow)
  }, [forensicsWorkflow, workflowKey])

  useEffect(() => {
    const currentIds = new Set(snapshot.evidence.map(({ id }) => id))
    const added = snapshot.evidence.filter(({ id }) => !knownEvidenceRef.current.has(id))
    knownEvidenceRef.current = currentIds
    if (added.length === 0) return

    setSelection((current) => ({
      ...current,
      selectedEvidenceId: added[0].id,
      selectedRecordId: added[0].id,
    }))
    const notice = added.length === 1
      ? copy.evidenceAdded(added[0].title ?? copy.newEvidence)
      : copy.evidenceAddedMany(added.length)
    if (outgoingPhoneCallRef.current) {
      pendingPhoneFollowUpAppRef.current = 'files'
      pendingPhoneFollowUpNoticeRef.current = notice
    } else {
      setCommandNotice(notice)
      focusApp('files')
    }
  }, [copy, focusApp, snapshot.evidence])

  useEffect(() => {
    const current = snapshot.affordances.flatMap((affordance) => (
      affordance.surface === 'casebook' && affordance.intent.kind === 'action'
        ? [affordance]
        : []
    ))
    const currentIds = new Set(current.map(({ id }) => id))
    const added = current.filter(({ id }) => !knownDispatchAffordancesRef.current.has(id))
    knownDispatchAffordancesRef.current = currentIds
    if (added.length === 0) return

    const notice = added.length === 1
      ? copy.dispatchReady
      : copy.dispatchReadyMany(added.length)
    if (outgoingPhoneCallRef.current) {
      pendingPhoneFollowUpAppRef.current = 'case-dispatch'
      pendingPhoneFollowUpNoticeRef.current = notice
    } else {
      setCommandNotice(notice)
      focusApp('case-dispatch')
    }
  }, [copy, focusApp, snapshot.affordances])

  useEffect(() => {
    const current = snapshot.affordances.flatMap((affordance) => (
      affordance.surface === 'inbox' && affordance.interaction?.kind === 'async-message'
        ? [affordance]
        : []
    ))
    const currentIds = new Set(current.map(({ id }) => id))
    const added = current.filter(({ id }) => !knownContactActionAffordancesRef.current.has(id))
    knownContactActionAffordancesRef.current = currentIds
    if (added.length === 0) return

    setSelection((currentSelection) => ({
      ...currentSelection,
      selectedEntryId: undefined,
    }))
    const notice = added.length === 1
      ? copy.contactResearchReady
      : copy.contactResearchReadyMany(added.length)
    if (outgoingPhoneCallRef.current) {
      pendingPhoneFollowUpAppRef.current = 'casebook'
      pendingPhoneFollowUpNoticeRef.current = notice
    } else {
      setCommandNotice(notice)
      focusApp('casebook')
    }
  }, [copy, focusApp, snapshot.affordances])

  useEffect(() => {
    setOutcomeDismissed(false)
    if (snapshot.outcome) {
      setPendingAffordanceId(undefined)
      setOpenAssetId(undefined)
    }
  }, [snapshot.outcome?.id])

  const contactActionStatuses = useMemo(() => {
    const statuses: Record<string, 'pending' | 'completed'> = {}
    for (const request of forensicsWorkflow.requests) {
      if (request.kind !== 'async-interaction') continue
      if (request.status === 'waiting') statuses[request.affordanceId] = 'pending'
      if (request.status === 'complete') statuses[request.affordanceId] = 'completed'
    }
    return statuses
  }, [forensicsWorkflow.requests])
  const newContactIds = useMemo(() => forensicsWorkflow.requests.flatMap((request) => (
    request.kind === 'async-interaction'
    && request.status === 'complete'
    && request.revealedActorId
    && !seenContactIds.includes(request.revealedActorId)
      ? [request.revealedActorId]
      : []
  )), [forensicsWorkflow.requests, seenContactIds])
  const models = useMemo(
    () => createManifestWorkspaceModels(
      manifest,
      {
        ...selection,
        contactActionStatuses,
        newContactIds,
      },
      snapshot,
      (asset) => browserGameSessionClient.assetUrl({
        caseId: snapshot.case.id,
        caseVersion: snapshot.case.version,
        locale: manifest.case.locale ?? 'tr',
        saveId,
      }, {
        assetSessionId,
        caseDigest: snapshot.case.digest,
        assetId: asset.id,
      }, snapshot),
      uiLocale,
    ),
    [assetSessionId, contactActionStatuses, manifest, newContactIds, saveId, selection, snapshot, uiLocale],
  )
  const phoneModel = useMemo<PhoneViewModel>(() => (
    outgoingPhoneCall ? { ...models.phone, outgoingCall: outgoingPhoneCall } : models.phone
  ), [models.phone, outgoingPhoneCall])
  const caseChannelMessages = useMemo(() => createCaseChannelActivityMessages(
    models.inbox.messages,
    snapshot,
    detectiveName,
    uiLocale,
    (occurredAtMs) => caseTimeLabel(manifest, occurredAtMs),
  ), [detectiveName, manifest, models.inbox.messages, snapshot, uiLocale])
  const caseBoardKey = useMemo(
    () => caseBoardStateKey(manifest, snapshot.case.digest, saveId),
    [manifest, saveId, snapshot.case.digest],
  )
  const legacyCaseBoardKey = useMemo(
    () => caseBoardStateKey(
      manifest,
      snapshot.case.digest,
      saveId,
      LEGACY_BRAND_STORAGE_PREFIX,
    ),
    [manifest, saveId, snapshot.case.digest],
  )
  const caseBoardPersistence = useMemo(
    () => createCaseBoardPersistence(caseBoardKey, { legacyKey: legacyCaseBoardKey }),
    [caseBoardKey, legacyCaseBoardKey],
  )
  const caseBoardModel = useMemo(
    () => createCaseBoardViewModel(manifest.case.title, models.phone, models.files),
    [manifest.case.title, models.files, models.phone],
  )
  const layoutPersistence = useMemo(
    () => createLocalStorageLayoutPersistence(desktopLayoutKey(manifest, saveId), {
      legacyKey: desktopLayoutKey(manifest, saveId, LEGACY_BRAND_STORAGE_PREFIX),
    }),
    [manifest.case.id, manifest.case.version, saveId],
  )
  const select = <Key extends keyof ManifestWorkspaceSelection>(
    key: Key,
    value: ManifestWorkspaceSelection[Key],
  ) => setSelection((current) => ({ ...current, [key]: value }))
  const executeIntent = useCallback(async (
    intent: DemoBrowserIntent,
    options: {
      readonly silent?: boolean
      readonly outgoingCallSessionId?: number
    } = {},
  ): Promise<IntentExecution> => {
    const ownsOutgoingCallReservation = options.outgoingCallSessionId !== undefined
      && outgoingPhoneCallRef.current?.sessionId === options.outgoingCallSessionId
    if (commandBusyRef.current && !ownsOutgoingCallReservation) return { kind: 'busy' }
    if (!commandBusyRef.current) {
      commandBusyRef.current = true
      setCommandBusy(true)
    }
    setCommandNotice(undefined)
    try {
      const result = await onCommand(intent)
      if (!result.ok) {
        if (!options.silent) setCommandNotice(playerCommandError(result.error.code, copy))
        return { kind: 'response', response: result }
      }
      if (!options.silent) {
        if (intent.kind === 'observe') {
          const title = snapshot.evidence.find(({ id }) => id === intent.evidenceId)?.title
          setCommandNotice(copy.evidenceInspected(title ?? copy.evidence))
        } else if (intent.kind === 'deduce') {
          setCommandNotice(copy.deductionVerified)
        } else {
          setCommandNotice(copy.actionCompleted)
        }
      }
      return { kind: 'response', response: result }
    } catch {
      if (!options.silent) setCommandNotice(copy.actionFailed)
      return { kind: 'failed' }
    } finally {
      commandBusyRef.current = false
      if (desktopMountedRef.current) setCommandBusy(false)
    }
  }, [copy, onCommand, snapshot.evidence])
  const executeAffordance = useCallback(async (affordanceId: string): Promise<IntentExecution> => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    if (!affordance) {
      setCommandNotice(copy.actionUnavailable)
      return { kind: 'failed' }
    }
    return affordance.intent.kind === 'deduce'
      ? executeIntent(affordance.intent)
      : executeIntent({ kind: 'action', ...affordance.intent.action })
  }, [copy, executeIntent, snapshot.affordances])
  const dispatchAffordance = useCallback(async (affordanceId: string): Promise<boolean> => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    const execution = await executeAffordance(affordanceId)
    const accepted = execution.kind === 'response' && execution.response.ok
    if (accepted && affordance?.surface === 'casebook' && affordance.intent.kind === 'action') {
      setCommandNotice(copy.dispatchCompleted)
    }
    return accepted
  }, [copy, executeAffordance, snapshot.affordances])
  const requestAffordance = useCallback(async (affordanceId: string): Promise<boolean> => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    if (!affordance) {
      setCommandNotice(copy.actionUnavailable)
      return false
    }
    if (affordance.risk !== 'normal' || affordance.confirmation) {
      setPendingAffordanceId(affordanceId)
      return false
    }
    return dispatchAffordance(affordanceId)
  }, [copy, dispatchAffordance, snapshot.affordances])

  const startOutgoingPhoneCall = useCallback((
    contactId: string,
    actionLabel: string,
    resultMatch: PhoneCallResultMatch,
    execute: (sessionId: number) => Promise<IntentExecution>,
  ) => {
    if (outgoingPhoneCallRef.current) {
      setCommandNotice(copy.activeCallFirst)
      return
    }
    if (commandBusyRef.current) {
      setCommandNotice(copy.lineBusy)
      return
    }
    const contact = models.phone.contacts.find(({ id }) => id === contactId)
    if (!contact) {
      setCommandNotice(copy.contactUnavailable)
      return
    }

    const sessionId = outgoingPhoneCallSessionRef.current + 1
    outgoingPhoneCallSessionRef.current = sessionId
    outgoingPhoneCallCommandStartedRef.current = false
    pendingPhoneFollowUpAppRef.current = undefined
    pendingPhoneFollowUpNoticeRef.current = undefined
    const initialCall: PhoneOutgoingCallViewModel = {
      sessionId,
      phase: 'dialing',
      contactId,
      contactName: contact.name,
      ...(contact.roleLabel ? { roleLabel: contact.roleLabel } : {}),
      actionLabel,
    }
    commandBusyRef.current = true
    setCommandBusy(true)
    updateOutgoingPhoneCall(initialCall)
    setSelection((current) => ({ ...current, selectedContactId: contactId }))
    setCommandNotice(undefined)
    focusApp('phone')

    const { dialMs, speakMs, endMs } = outgoingCallDurations()
    const completedBefore = snapshot.completedAffordances.length
    void (async () => {
      await waitForOutgoingCall(dialMs)
      if (outgoingPhoneCallSessionRef.current !== sessionId) return
      updateOutgoingPhoneCall({ ...initialCall, phase: 'speaking' })

      outgoingPhoneCallCommandStartedRef.current = true
      const executionPromise = execute(sessionId).finally(() => {
        if (outgoingPhoneCallSessionRef.current === sessionId) {
          outgoingPhoneCallCommandStartedRef.current = false
        }
      })
      const [, execution] = await Promise.all([
        waitForOutgoingCall(speakMs),
        executionPromise,
      ])
      if (outgoingPhoneCallSessionRef.current !== sessionId) return
      const outcome = outgoingCallOutcome(execution, completedBefore, resultMatch, copy)
      updateOutgoingPhoneCall({
        ...initialCall,
        phase: 'ending',
        ...outcome,
      })

      await waitForOutgoingCall(endMs)
      if (outgoingPhoneCallSessionRef.current !== sessionId) return
      updateOutgoingPhoneCall({
        ...initialCall,
        phase: 'result',
        ...outcome,
      })
    })()
  }, [copy, focusApp, models.phone.contacts, snapshot.completedAffordances.length, updateOutgoingPhoneCall, waitForOutgoingCall])

  const startPhoneAffordance = useCallback((affordance: PublicAffordance): boolean => {
    if (affordance.surface !== 'phone' || affordance.intent.kind !== 'action') return false
    const actionIntent = affordance.intent.action
    const contactId = actionIntent.actor ?? actionIntent.from ?? actionIntent.target
    if (!contactId || !models.phone.contacts.some(({ id }) => id === contactId)) return false

    startOutgoingPhoneCall(
      contactId,
      affordance.label?.trim() || copy.conversation,
      { affordanceId: affordance.id },
      (sessionId) => executeIntent(
        { kind: 'action', ...actionIntent },
        { silent: true, outgoingCallSessionId: sessionId },
      ),
    )
    return true
  }, [copy, executeIntent, models.phone.contacts, startOutgoingPhoneCall])

  const dismissOutgoingPhoneCall = useCallback(() => {
    const completedCall = outgoingPhoneCallRef.current
    if (completedCall?.phase !== 'result') return
    outgoingPhoneCallSessionRef.current += 1
    updateOutgoingPhoneCall(undefined)
    const followUpApp = pendingPhoneFollowUpAppRef.current
    const followUpNotice = pendingPhoneFollowUpNoticeRef.current
    pendingPhoneFollowUpAppRef.current = undefined
    pendingPhoneFollowUpNoticeRef.current = undefined
    if (followUpNotice) setCommandNotice(followUpNotice)
    if (followUpApp) {
      focusApp(followUpApp)
    } else {
      phoneOpenNonceRef.current += 1
      setPhoneOpenContactRequest({
        contactId: completedCall.contactId,
        nonce: phoneOpenNonceRef.current,
      })
    }
  }, [focusApp, updateOutgoingPhoneCall])

  useEffect(() => {
    const evidenceIds = new Set(snapshot.evidence.map(({ id }) => id))
    const replyLabel = caseClockLabel(manifest, snapshot.clocks.caseTimeMs)
    setForensicsWorkflow((current) => {
      let changed = false
      const requests = current.requests.flatMap((request) => {
        if (request.kind === 'evidence-review' && !evidenceIds.has(request.evidenceId)) {
          changed = true
          return []
        }
        const replyBody = completedForensicsReply(snapshot, request, copy)
        if (!replyBody) return [request]
        const actor = revealedActor(snapshot, request, copy)
        if (
          request.status === 'complete'
          && request.replyBody
          && (request.kind === 'evidence-review' || request.revealedActorId || !actor)
        ) return [request]
        changed = true
        return [completeForensicsRecord(
          request,
          snapshot,
          replyBody,
          request.replyLabel ?? replyLabel,
          copy,
        )]
      })
      return changed ? { ...current, requests } : current
    })
  }, [copy, manifest, snapshot])

  const pendingForensicsRequest = useMemo(
    () => forensicsWorkflow.requests.find(({ status }) => status === 'waiting'),
    [forensicsWorkflow.requests],
  )

  useEffect(() => {
    const request = pendingForensicsRequest
    if (!request) return

    let retryTimer: number | undefined
    const submit = (): void => {
      if (!desktopMountedRef.current) return
      if (commandBusyRef.current || forensicsInFlightRef.current.has(request.id)) {
        retryTimer = window.setTimeout(submit, 250)
        return
      }

      forensicsInFlightRef.current.add(request.id)
      const executionPromise = request.kind === 'evidence-review'
        ? executeIntent({ kind: 'observe', evidenceId: request.evidenceId })
        : executeAffordance(request.affordanceId)
      void executionPromise
        .then((execution) => {
          if (!desktopMountedRef.current) return
          if (execution.kind === 'busy') {
            retryTimer = window.setTimeout(submit, 250)
            return
          }

          const response = execution.kind === 'response' ? execution.response : undefined
          const responseSnapshot = response?.snapshot ?? snapshot
          const replyBody = completedForensicsReply(responseSnapshot, request, copy)
          const alreadyResolved = request.kind === 'evidence-review' && response && !response.ok
            ? response.error.code === 'evidence-already-observed' && Boolean(replyBody)
            : request.kind === 'async-interaction' && Boolean(replyBody)

          if ((response?.ok || alreadyResolved) && replyBody) {
            const replyLabel = caseClockLabel(manifest, responseSnapshot.clocks.caseTimeMs)
            setForensicsWorkflow((current) => updateForensicsRequest(
              current,
              request.id,
              (item) => completeForensicsRecord(
                item,
                responseSnapshot,
                replyBody,
                replyLabel,
                copy,
              ),
            ))
            setStreamingForensicsReply({
              requestId: request.id,
              endsAtWallMs: Date.now() + forensicsReplyDurationMs(replyBody),
            })
            setCommandNotice(
              request.kind === 'evidence-review'
                ? copy.forensicsReviewNotice(request.evidenceTitle, FORENSICS_LEAD_NAME)
                : copy.forensicsRequestNotice(request.subjectLabel, FORENSICS_LEAD_NAME),
            )
            return
          }

          const failureBody = request.kind === 'evidence-review'
            ? copy.forensicsReviewFailed
            : copy.forensicsRequestFailed
          setForensicsWorkflow((current) => updateForensicsRequest(current, request.id, (item) => ({
            ...item,
            status: 'failed',
            replyBody: failureBody,
            replyLabel: caseClockLabel(manifest, snapshot.clocks.caseTimeMs),
          })))
          setStreamingForensicsReply({
            requestId: request.id,
            endsAtWallMs: Date.now() + forensicsReplyDurationMs(failureBody),
          })
        })
        .finally(() => {
          forensicsInFlightRef.current.delete(request.id)
        })
    }

    retryTimer = window.setTimeout(
      submit,
      Math.max(0, request.requestedAtWallMs + FORENSICS_TYPING_DELAY_MS - Date.now()),
    )
    return () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [copy, executeAffordance, executeIntent, manifest, pendingForensicsRequest, snapshot])

  useEffect(() => {
    if (!streamingForensicsReply) return
    const timeout = window.setTimeout(
      () => setStreamingForensicsReply(undefined),
      Math.max(0, streamingForensicsReply.endsAtWallMs - Date.now()),
    )
    return () => window.clearTimeout(timeout)
  }, [streamingForensicsReply])

  const forensicsBusy = Boolean(pendingForensicsRequest || streamingForensicsReply)
  const caseChannelName = kebabCaseChannelName(manifest.case.title, manifest.case.locale)
  const requestForensicsReview = useCallback((evidenceId: string) => {
    const record = models.files.records.find(({ id }) => id === evidenceId)
    if (!record) {
      setCommandNotice(copy.recordUnavailable)
      return
    }

    setSelection((current) => ({ ...current, selectedThreadId: FORENSICS_THREAD_ID }))
    focusApp('inbox')

    if (record.status === 'observed') {
      setCommandNotice(copy.recordAlreadyReviewed)
      return
    }
    if (pendingForensicsRequest || streamingForensicsReply) {
      setCommandNotice(copy.forensicsCompletingReview(FORENSICS_LEAD_NAME))
      return
    }

    const requestedAtWallMs = Date.now()
    const request = createForensicsRequest({
      evidenceId,
      evidenceTitle: record.title,
      requestedAtWallMs,
      requestedAtCaseMs: snapshot.clocks.caseTimeMs,
      requestedLabel: caseClockLabel(manifest, snapshot.clocks.caseTimeMs),
    })
    setForensicsWorkflow((current) => appendForensicsRequest(current, request))
    setCommandNotice(copy.sentForReview(record.title, FORENSICS_LEAD_NAME))
  }, [copy, focusApp, manifest, models.files.records, pendingForensicsRequest, snapshot.clocks.caseTimeMs, streamingForensicsReply])

  const requestAsyncForensicsAction = useCallback((affordanceId: string) => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    const interaction = affordance?.interaction
    if (
      !affordance
      || affordance.surface !== 'inbox'
      || interaction?.kind !== 'async-message'
      || !interaction.request?.trim()
    ) {
      setCommandNotice(copy.researchUnavailable)
      return
    }

    setSelection((current) => ({ ...current, selectedThreadId: FORENSICS_THREAD_ID }))
    focusApp('inbox')
    if (pendingForensicsRequest || streamingForensicsReply) {
      setCommandNotice(copy.forensicsCompletingRequest(FORENSICS_LEAD_NAME))
      return
    }

    const requestedAtWallMs = Date.now()
    const subjectLabel = affordance.label?.trim() || copy.investigationRequest
    const request = createAsyncForensicsRequest({
      affordanceId,
      subjectLabel,
      requestBody: interaction.request.trim(),
      requestedAtWallMs,
      requestedAtCaseMs: snapshot.clocks.caseTimeMs,
      requestedLabel: caseClockLabel(manifest, snapshot.clocks.caseTimeMs),
    })
    setForensicsWorkflow((current) => appendForensicsRequest(current, request))
    setCommandNotice(copy.requestSent(subjectLabel, FORENSICS_LEAD_NAME))
  }, [copy, focusApp, manifest, pendingForensicsRequest, snapshot, streamingForensicsReply])

  const openDiscoveredContact = useCallback((requestId: string) => {
    const request = forensicsWorkflow.requests.find(({ id }) => id === requestId)
    if (
      request?.kind !== 'async-interaction'
      || request.status !== 'complete'
      || !request.revealedActorId
    ) return
    setSeenContactIds((current) => (
      current.includes(request.revealedActorId!) ? current : [...current, request.revealedActorId!]
    ))
    setSelection((current) => ({ ...current, selectedContactId: request.revealedActorId }))
    phoneOpenNonceRef.current += 1
    setPhoneOpenContactRequest({
      contactId: request.revealedActorId,
      nonce: phoneOpenNonceRef.current,
    })
    focusApp('phone')
  }, [focusApp, forensicsWorkflow.requests])

  const inboxModel = useMemo<InboxViewModel>(() => {
    const latestCaseMessage = caseChannelMessages.at(-1)
    const baseThreads = models.inbox.threads.map((thread) => ({
      ...thread,
      channelId: 'case-desk',
      ...(latestCaseMessage ? {
        preview: latestCaseMessage.body,
        timestampLabel: latestCaseMessage.timestampLabel,
      } : {}),
    }))
    const baseThreadId = baseThreads[0]?.id
    const selectedThreadId = selection.selectedThreadId ?? baseThreadId ?? FORENSICS_THREAD_ID
    const forensicsSelected = selectedThreadId === FORENSICS_THREAD_ID
    const latestRequest = forensicsWorkflow.requests.at(-1)
    const preview = latestRequest?.replyBody
      ?? (latestRequest ? forensicsRequestBody(latestRequest, copy) : copy.noRequests)
    const forensicsThread = {
      id: FORENSICS_THREAD_ID,
      channelId: 'forensics',
      sender: FORENSICS_LEAD_NAME,
      subject: latestRequest ? forensicsRequestSubject(latestRequest) : copy.forensicReview,
      preview,
      timestampLabel: latestRequest?.replyLabel ?? latestRequest?.requestedLabel ?? copy.now,
      unread: !forensicsSelected && latestRequest?.status === 'complete',
      ...(pendingForensicsRequest ? { badgeLabel: copy.typing } : {}),
    }
    const forensicsMessages = forensicsWorkflow.requests.flatMap((request) => {
      const requestMessage = {
        id: `${request.id}:request`,
        author: detectiveName,
        roleLabel: copy.investigatorRole,
        body: forensicsRequestBody(request, copy),
        timestampLabel: request.requestedLabel,
        direction: 'outgoing' as const,
      }
      if (!request.replyBody) return [requestMessage]
      const streaming = streamingForensicsReply?.requestId === request.id
      const reviewedRecord = request.kind === 'evidence-review'
        ? models.files.records.find(({ id }) => id === request.evidenceId)
        : undefined
      const reviewedImages = reviewedRecord?.assets.filter(({ kind }) => kind === 'image') ?? []
      const replyMessage = {
        id: `${request.id}:reply`,
        author: FORENSICS_LEAD_NAME,
        roleLabel: copy.forensicsLeadRole,
        avatarLabel: 'EA',
        body: request.replyBody,
        timestampLabel: request.replyLabel ?? request.requestedLabel,
        direction: 'incoming' as const,
        streaming,
        ...(reviewedImages.length > 0 ? {
          attachments: reviewedImages.map((image) => ({
            ...image,
            label: request.kind === 'evidence-review' ? request.evidenceTitle : image.label,
            ...(reviewedRecord?.summary || image.description
              ? { description: reviewedRecord?.summary || image.description }
              : {}),
          })),
        } : {}),
      }
      if (
        streaming
        || request.kind !== 'async-interaction'
        || !request.revealedActorId
        || !request.revealedActorName
      ) return [requestMessage, replyMessage]
      return [requestMessage, replyMessage, {
        id: `${request.id}:contact-added`,
        author: copy.system,
        body: copy.contactAdded(request.revealedActorName),
        timestampLabel: request.replyLabel ?? request.requestedLabel,
        direction: 'system' as const,
        cta: {
          id: request.id,
          label: copy.openContact(request.revealedActorName),
          accessibleLabel: copy.openContactAccessible(request.revealedActorName),
        },
      }]
    })
    return {
      ...models.inbox,
      workspaceLabel: copy.bureau,
      channelLead: {
        name: FORENSICS_LEAD_NAME,
        roleLabel: copy.forensicsLeadRole,
        avatarLabel: 'EA',
        promptLabel: copy.askLead,
      },
      selectedThreadId,
      selectedChannelId: forensicsSelected ? 'forensics' : 'case-desk',
      channels: [
        {
          id: 'case-desk',
          label: caseChannelName,
          ...(baseThreadId ? { threadId: baseThreadId } : {}),
          topic: copy.caseDeskTopic,
        },
        {
          id: 'forensics',
          label: 'forensics',
          threadId: FORENSICS_THREAD_ID,
          topic: copy.forensicsTopic,
          ...(!forensicsSelected && latestRequest?.status === 'complete' ? { unreadCount: 1 } : {}),
        },
        {
          id: 'operations',
          label: copy.operations,
          topic: copy.operationsTopic,
          private: true,
        },
        {
          id: 'evidence-chain',
          label: copy.evidenceChain,
          topic: copy.evidenceChainTopic,
          private: true,
        },
        {
          id: 'shift-handoff',
          label: copy.shiftHandoff,
          topic: copy.shiftHandoffTopic,
          private: true,
        },
        {
          id: 'office-management',
          label: copy.officeManagement,
          topic: copy.officeManagementTopic,
          private: true,
        },
      ],
      threads: [...baseThreads, forensicsThread],
      messages: forensicsSelected ? forensicsMessages : caseChannelMessages,
      typingAuthor: forensicsSelected && pendingForensicsRequest ? FORENSICS_LEAD_NAME : undefined,
      sending: forensicsSelected && forensicsBusy,
    }
  }, [caseChannelMessages, caseChannelName, copy, detectiveName, forensicsWorkflow.requests, models.files.records, models.inbox, pendingForensicsRequest, selection.selectedThreadId, streamingForensicsReply])

  const openAsset = useMemo<AuthorizedAssetViewModel | undefined>(() => {
    if (!openAssetId) return undefined
    const messageAsset = inboxModel.messages
      .flatMap(({ attachments }) => attachments ?? [])
      .find(({ id }) => id === openAssetId)
    if (messageAsset) return messageAsset
    const boardAsset = caseBoardModel.pins.flatMap((pin) => (
      pin.kind === 'evidence' ? [pin.asset] : []
    )).find(({ id }) => id === openAssetId)
    if (boardAsset) return boardAsset
    for (const record of models.files.records) {
      const asset = record.assets.find(({ id }) => id === openAssetId)
      if (asset) {
        return {
          ...asset,
          label: record.assets.length === 1
            ? record.title
            : `${record.title} · ${asset.label}`,
          description: asset.description ?? record.summary,
        }
      }
    }
    return undefined
  }, [caseBoardModel.pins, inboxModel.messages, models.files.records, openAssetId])

  const desktopItems = useMemo<readonly DesktopItemDefinition[]>(() => (
    models.files.records.map((record) => {
      const asset = record.assets[0]
      const previewUrl = asset?.thumbnailUrl ?? (
        asset?.kind === 'image' ? asset.deliveryUrl : undefined
      )
      return {
        id: record.id,
        title: record.title,
        kind: asset?.kind ?? 'file',
        ...(previewUrl ? { previewUrl } : {}),
        status: record.status === 'new' ? 'new' : 'reviewed',
      }
    })
  ), [models.files.records])

  const openDesktopItem = useCallback((recordId: string) => {
    const record = models.files.records.find(({ id }) => id === recordId)
    if (!record) return
    setSelection((current) => ({
      ...current,
      selectedEvidenceId: record.id,
      selectedRecordId: record.id,
    }))
    const firstAsset = record.assets[0]
    if (firstAsset?.deliveryUrl) {
      setOpenAssetId(firstAsset.id)
      return
    }
    focusApp('files')
  }, [focusApp, models.files.records])

  const apps = useMemo<readonly ShellAppDefinition[]>(() => [
    {
      id: 'casebook',
      title: copy.casebookApp,
      icon: { type: 'image', src: casebookIcon },
      content: (
        <CasebookApp
          model={models.casebook}
          onAttemptDeduction={(deductionId) => {
            const affordance = snapshot.affordances.find((candidate) => (
              candidate.intent.kind === 'deduce' && candidate.intent.deductionId === deductionId
            ))
            if (!affordance) {
              setCommandNotice(copy.deductionUnavailable)
              return
            }
            void requestAffordance(affordance.id)
          }}
          onOpenLead={(surface) => focusApp(surface)}
          onContactAction={requestAsyncForensicsAction}
          busy={commandBusy}
          onSelectEntry={(id) => select('selectedEntryId', id)}
          onOpenEvidence={(id) => {
            setSelection((current) => ({
              ...current,
              selectedEvidenceId: id,
              selectedRecordId: id,
            }))
            focusApp('files')
          }}
        />
      ),
      badge: models.casebook.contactActions?.filter(({ status }) => (
        status === undefined || status === 'ready'
      )).length || undefined,
      initialBounds: { x: 285, y: 44, width: 880, height: 676 },
      initialZIndex: 100,
      defaultActive: false,
      minSize: { width: 650, height: 430 },
      defaultOpen: true,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--casebook',
      mobile: { placement: 'home', order: 1 },
    },
    {
      id: 'case-board',
      title: copy.caseBoardApp,
      icon: { type: 'image', src: caseBoardIcon },
      content: (
        <CaseBoardApp
          key={caseBoardKey}
          model={caseBoardModel}
          persistence={caseBoardPersistence}
          onOpenAsset={setOpenAssetId}
        />
      ),
      initialBounds: { x: 145, y: 52, width: 940, height: 650 },
      minSize: { width: 760, height: 520 },
      defaultOpen: false,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--case-board',
      mobile: { placement: 'home', order: 2 },
    },
    {
      id: 'case-dispatch',
      title: copy.dispatchApp,
      icon: { type: 'image', src: dispatchIcon },
      content: (
        <CaseDispatchApp
          model={models.caseDispatch}
          busy={commandBusy}
          onSubmit={(id) => { void requestAffordance(id) }}
        />
      ),
      badge: models.caseDispatch.affordances.length || undefined,
      initialBounds: { x: 355, y: 58, width: 820, height: 610 },
      minSize: { width: 680, height: 480 },
      defaultOpen: false,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--case-dispatch',
      mobile: { placement: 'home', order: 3 },
    },
    {
      id: 'inbox',
      title: copy.inboxApp,
      icon: { type: 'image', src: inboxIcon },
      content: (
        <InboxApp
          model={inboxModel}
          onSelectThread={(id) => select('selectedThreadId', id)}
          onReplyDraftChange={(value) => select('replyDraft', value)}
          onOpenAttachment={setOpenAssetId}
          onMessageCta={openDiscoveredContact}
          onQuickPrompt={requestAsyncForensicsAction}
        />
      ),
      badge: pendingForensicsRequest ? 1 : undefined,
      initialBounds: { x: 105, y: 35, width: 900, height: 620 },
      minSize: { width: 720, height: 450 },
      defaultOpen: false,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--inbox',
      mobile: { placement: 'dock', order: 1 },
    },
    {
      id: 'phone',
      title: 'iPhone',
      icon: { type: 'image', src: phoneIcon },
      content: (
        <PhoneApp
          model={phoneModel}
          openContactRequest={phoneOpenContactRequest}
          onSelectContact={(id) => select('selectedContactId', id)}
          onAction={(actorId, action, actorField) => {
            const actionLabel = models.phone.contacts
              .find(({ id }) => id === actorId)
              ?.actions
              ?.find((candidate) => (
                candidate.action === action && candidate.actorField === actorField
              ))
              ?.label ?? copy.conversation
            const intent = {
              kind: 'action',
              action,
              [actorField]: actorId,
            } as DemoActionIntent
            startOutgoingPhoneCall(
              actorId,
              actionLabel,
              { action: intent },
              (sessionId) => executeIntent(intent, {
                silent: true,
                outgoingCallSessionId: sessionId,
              }),
            )
          }}
          onAffordance={(id) => {
            const affordance = snapshot.affordances.find((candidate) => candidate.id === id)
            if (
              affordance?.risk === 'normal'
              && !affordance.confirmation
              && startPhoneAffordance(affordance)
            ) {
              return
            }
            void requestAffordance(id)
          }}
          busy={commandBusy}
          onEndCall={() => select('activeCallContactId', undefined)}
          onDismissOutgoingCall={dismissOutgoingPhoneCall}
        />
      ),
      initialBounds: { x: 42, y: 150, width: 560, height: 540 },
      minSize: { width: 430, height: 320 },
      placement: 'right-dock',
      closable: true,
      defaultOpen: true,
      defaultActive: true,
      startMenu: true,
      taskbarPinned: true,
      badge: newContactIds.length || models.phone.affordances?.length || undefined,
      mobile: { placement: 'dock', chrome: 'self', order: 2 },
    },
    {
      id: 'files',
      title: 'Finder',
      icon: { type: 'image', src: filesIcon },
      content: (
        <FilesApp
          model={models.files}
          onSelectRecord={(id) => {
            setSelection((current) => ({
              ...current,
              selectedEvidenceId: id,
              selectedRecordId: id,
            }))
          }}
          onInspectRecord={requestForensicsReview}
          onOpenAsset={setOpenAssetId}
          onAffordance={(id) => { void requestAffordance(id) }}
          busy={commandBusy || forensicsBusy}
        />
      ),
      badge: snapshot.evidence.filter(({ observed }) => !observed).length,
      initialBounds: { x: 72, y: 28, width: 920, height: 620 },
      minSize: { width: 720, height: 500 },
      defaultOpen: false,
      startMenu: true,
      taskbarPinned: true,
      mobile: { placement: 'dock', order: 3 },
    },
    {
      id: 'web',
      title: 'Safari',
      icon: { type: 'image', src: webIcon },
      content: (
        <WebResearchApp
          model={models.web}
          onQueryChange={(value) => select('query', value)}
          onSearch={(query) => {
            const offered = snapshot.affordances.find((affordance) => (
              affordance.surface === 'web'
              && affordance.intent.kind === 'action'
              && affordance.intent.action.action === 'search'
              && affordance.intent.action.query === query
            ))
            if (!offered) {
              setCommandNotice(copy.searchUnavailable)
              return
            }
            void requestAffordance(offered.id)
          }}
          onAffordance={(id) => { void requestAffordance(id) }}
          busy={commandBusy}
          onOpenResult={(resultId) => select('activeResearchResultId', resultId)}
          onClosePage={() => select('activeResearchResultId', undefined)}
        />
      ),
      initialBounds: { x: 180, y: 54, width: 960, height: 640 },
      minSize: { width: 450, height: 280 },
      defaultOpen: false,
      startMenu: true,
      taskbarPinned: true,
      badge: snapshot.affordances.filter(({ surface }) => surface === 'web').length || undefined,
      mobile: { placement: 'dock', order: 4 },
    },
    {
      id: 'evidence-rail',
      title: copy.evidenceRailApp,
      icon: { type: 'image', src: evidenceIcon },
      content: (
        <EvidenceQuestionsRail
          model={models.rail}
          onSelectEvidence={(id) => {
            setSelection((current) => ({
              ...current,
              selectedEvidenceId: id,
              selectedRecordId: id,
            }))
            focusApp('files')
          }}
          onSelectQuestion={(id) => select('selectedQuestionId', id)}
        />
      ),
      initialBounds: { x: 1130, y: 115, width: 310, height: 594 },
      minSize: { width: 280, height: 380 },
      defaultOpen: false,
      startMenu: true,
      taskbarPinned: false,
      mobile: { placement: 'home', order: 4 },
    },
  ], [caseBoardKey, caseBoardModel, caseBoardPersistence, commandBusy, copy, dismissOutgoingPhoneCall, executeIntent, focusApp, forensicsBusy, inboxModel, models, newContactIds.length, openDiscoveredContact, phoneModel, phoneOpenContactRequest, requestAffordance, requestAsyncForensicsAction, requestForensicsReview, snapshot.affordances, snapshot.evidence, startOutgoingPhoneCall, startPhoneAffordance])

  const pendingAffordance = pendingAffordanceId
    ? snapshot.affordances.find(({ id }) => id === pendingAffordanceId)
    : undefined
  const pendingIsDispatch = pendingAffordance?.surface === 'casebook'
    && pendingAffordance.intent.kind === 'action'
  const nextDeadline = [...snapshot.deadlines]
    .filter(({ status, remainingMs }) => status === 'scheduled' && remainingMs >= 0)
    .sort((left, right) => left.remainingMs - right.remainingMs)[0]
  const outcomeOpen = Boolean(snapshot.outcome && !outcomeDismissed)
  const activeAppDialog = confirmRestart
    ? 'restart'
    : outcomeOpen
      ? 'outcome'
      : pendingAffordance
        ? 'decision'
        : undefined
  const appDialogOpen = activeAppDialog !== undefined
  const desktopBlocked = appDialogOpen || Boolean(openAsset)
  const dismissRestartDialog = () => {
    if (restartBusy) return
    setConfirmRestart(false)
    if (restartFromOutcome) setOutcomeDismissed(false)
    setRestartFromOutcome(false)
  }

  return (
    <>
      <ModalBackground className="case-desktop-surface" blocked={desktopBlocked}>
        <DesktopShell
          key={`${manifest.case.id}:${runEpoch}`}
          apps={apps}
          desktopItems={desktopItems}
          onOpenDesktopItem={openDesktopItem}
          brand="opencase"
          subtitle={manifest.case.title}
          ariaLabel={copy.desktopAria(manifest.case.title)}
          backgroundImage={opencaseWallpaper}
          mobileBackgroundImage={opencasePhoneWallpaper}
          mobileClockLabel={phoneModel.clockLabel}
          mobileInitialView="home"
          brandIcon={{ type: 'image', src: casebookIcon }}
          startLabel="opencase"
          locale={uiLocale}
          layoutPersistence={layoutPersistence}
          focusRequest={focusRequest}
          settingsSlot={(
            renderSettings({
              activeCaseId: `${manifest.case.id}@${manifest.case.version}`,
              activeCaseLocale: manifest.case.locale ?? uiLocale,
              caseStatus: snapshot.status === 'ended' ? 'ended' : 'active',
              autosaveStatus: commandBusy || restartBusy ? 'saving' : 'saved',
              busy: commandBusy || restartBusy,
              ...(nextDeadline ? { deadline: nextDeadline } : {}),
              onRestart: () => {
                if (restartBusyRef.current || commandBusyRef.current) return
                restartBusyRef.current = true
                setRestartBusy(true)
                void onRestart().finally(() => {
                  restartBusyRef.current = false
                  setRestartBusy(false)
                })
              },
            })
          )}
          notificationSlot={commandNotice ? (
            <span className="workspace-status__notice" role="status">{commandNotice}</span>
          ) : null}
        />
      </ModalBackground>
      {openAsset && !appDialogOpen ? (
        <AssetViewerDialog asset={openAsset} onClose={() => setOpenAssetId(undefined)} />
      ) : null}
      {activeAppDialog === 'decision' && pendingAffordance ? (
        <AccessibleModal
          className="modal-overlay restart-dialog decision-dialog"
          dialogClassName="modal-surface modal-surface--decision"
          modalKind="decision"
          role="alertdialog"
          labelledBy="decision-title"
          describedBy="decision-description"
          onDismiss={() => setPendingAffordanceId(undefined)}
        >
          <div className="modal-sheet__content">
            <span className="modal-sheet__icon" aria-hidden="true"><img src={triangleAlertIcon} alt="" /></span>
            <div className="modal-sheet__copy">
              <span className="modal-sheet__eyebrow">{
                pendingIsDispatch
                  ? pendingAffordance.risk === 'terminal' ? copy.finalSubmission : copy.caseAction
                  : pendingAffordance.risk === 'terminal' ? copy.finalDecision : copy.consequentialAction
              }</span>
              <h2 id="decision-title">{pendingAffordance.label ?? copy.confirmAction}</h2>
              <p id="decision-description">{pendingAffordance.confirmation ?? copy.actionConsequence}</p>
              {pendingAffordance.cost?.milliseconds ? (
                <small className="modal-sheet__cost">{
                  copy.duration(Math.max(0, Math.ceil(pendingAffordance.cost.milliseconds / 60_000)))
                }</small>
              ) : null}
            </div>
          </div>
          <footer className="modal-sheet__actions">
            <button type="button" onClick={() => setPendingAffordanceId(undefined)}>{copy.cancel}</button>
            <button
              type="button"
              className="is-danger"
              disabled={commandBusy}
              onClick={() => {
                const affordance = pendingAffordance
                setPendingAffordanceId(undefined)
                if (!startPhoneAffordance(affordance)) void dispatchAffordance(affordance.id)
              }}
            >
              {pendingIsDispatch
                ? pendingAffordance.risk === 'terminal' ? copy.submitFinalReport : copy.approveAndSend
                : copy.takeAction}
            </button>
          </footer>
        </AccessibleModal>
      ) : null}
      {activeAppDialog === 'outcome' && snapshot.outcome ? (
        <AccessibleModal
          className="modal-overlay restart-dialog outcome-dialog"
          dialogClassName="modal-surface modal-surface--outcome"
          modalKind="outcome"
          labelledBy="outcome-title"
          describedBy="outcome-description"
          initialFocus="dialog"
          onDismiss={() => setOutcomeDismissed(true)}
        >
          <CaseOutcomeReport outcome={snapshot.outcome} />
          <footer className="modal-sheet__actions">
            <button type="button" onClick={() => setOutcomeDismissed(true)}>{copy.inspectDesktop}</button>
            <button type="button" className="is-primary" onClick={() => {
              setOutcomeDismissed(true)
              setRestartFromOutcome(true)
              setConfirmRestart(true)
            }}>
              {copy.playAgain}
            </button>
          </footer>
        </AccessibleModal>
      ) : null}
      {activeAppDialog === 'restart' ? (
        <AccessibleModal
          className="modal-overlay restart-dialog"
          dialogClassName="modal-surface modal-surface--restart"
          modalKind="restart"
          role="alertdialog"
          labelledBy="restart-title"
          describedBy="restart-description"
          onDismiss={restartBusy ? undefined : dismissRestartDialog}
        >
          <div className="modal-sheet__content">
            <span className="modal-sheet__icon" aria-hidden="true"><img src={rotateCcwIcon} alt="" /></span>
            <div className="modal-sheet__copy">
              <span className="modal-sheet__eyebrow">{copy.newInvestigation}</span>
              <h2 id="restart-title">{copy.restartTitle}</h2>
              <p id="restart-description">{copy.restartDescription}</p>
            </div>
          </div>
          <footer className="modal-sheet__actions">
            <button
              type="button"
              disabled={restartBusy}
              onClick={dismissRestartDialog}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              className="is-danger"
              disabled={restartBusy || commandBusy}
              onClick={() => {
                if (restartBusyRef.current) return
                restartBusyRef.current = true
                setRestartBusy(true)
                setConfirmRestart(false)
                const restoreOutcome = restartFromOutcome
                setRestartFromOutcome(false)
                void onRestart().finally(() => {
                  restartBusyRef.current = false
                  setRestartBusy(false)
                  if (restoreOutcome) setOutcomeDismissed(false)
                })
              }}
            >
              {copy.eraseAndRestart}
            </button>
          </footer>
        </AccessibleModal>
      ) : null}
    </>
  )
}

interface OpeningDesktopProps {
  readonly manifest: ShellPublicCaseManifest
  readonly phase: 'ringing' | 'missed' | 'connected'
  readonly busy: boolean
  readonly error?: string
  readonly onAnswer: () => void
  readonly onDecline: () => void
  readonly onAccept: () => void
  readonly onRestart: () => void
  readonly renderSettings: RenderWorkspaceSettings
}

function OpeningDesktop({
  manifest,
  phase,
  busy,
  error,
  onAnswer,
  onDecline,
  onAccept,
  onRestart,
  renderSettings,
}: OpeningDesktopProps) {
  const uiLocale = useUiLocale()
  const copy = useUiCopy(APP_COPY)
  const callerId = manifest.opening.call?.from ?? 'case-desk'
  const callerName = castValue(manifest, callerId, 'name') ?? copy.unknownCaller
  const roleLabel = playerFacingLabel(
    castValue(manifest, callerId, 'role') ?? copy.caseLiaison,
  )
  const model = useMemo(() => ({
    clockLabel: caseClockLabel(manifest, 0),
    contacts: [],
    recentCalls: [],
    incomingCall: {
      phase,
      contactId: callerId,
      contactName: callerName,
      roleLabel,
      ...(phase === 'connected' ? { body: manifest.opening.call?.text ?? manifest.case.synopsis } : {}),
      timestampLabel: manifest.case.time?.startsAt,
    },
  }), [callerId, callerName, manifest, phase, roleLabel])
  const apps = useMemo<readonly ShellAppDefinition[]>(() => [{
    id: 'incoming-phone',
    title: phase === 'connected' ? copy.secureCaseLine : copy.incomingCall,
    icon: { type: 'image', src: phoneIcon },
    content: (
      <PhoneApp
        model={model}
        busy={busy}
        onAnswerIncoming={onAnswer}
        onDeclineIncoming={onDecline}
        onAcceptBriefing={onAccept}
      />
    ),
    initialBounds: { x: 330, y: 65, width: 780, height: 650 },
    minSize: { width: 460, height: 470 },
    placement: 'right-dock',
    defaultOpen: true,
    defaultActive: true,
    initialZIndex: 100,
    taskbarPinned: true,
    mobile: { placement: 'dock', chrome: 'self', order: 1 },
  }], [busy, copy, model, onAccept, onAnswer, onDecline, phase])

  return (
    <DesktopShell
      apps={apps}
      brand="opencase"
      subtitle={copy.newCaseCall}
      ariaLabel={copy.incomingCallAria(manifest.case.title)}
      backgroundImage={opencaseWallpaper}
      mobileBackgroundImage={opencasePhoneWallpaper}
      mobileClockLabel={model.clockLabel}
      mobileInitialView="active-app"
      brandIcon={{ type: 'image', src: phoneIcon }}
      startLabel="opencase"
      locale={uiLocale}
      settingsSlot={(
        renderSettings({
          activeCaseId: `${manifest.case.id}@${manifest.case.version}`,
          activeCaseLocale: manifest.case.locale ?? uiLocale,
          caseStatus: 'not-started',
          autosaveStatus: busy ? 'saving' : 'idle',
          busy,
          onRestart,
        })
      )}
      notificationSlot={error ? <span className="workspace-status__notice" role="status">{error}</span> : null}
    />
  )
}

function BootScreen({ error }: { readonly error?: boolean }) {
  const copy = useUiCopy(APP_COPY)
  return (
    <main className="case-boot" aria-live="polite">
      <div className="case-boot__mark">
        <img src={casebookIcon} alt="" />
        <span aria-hidden="true" />
      </div>
      <p>opencase</p>
      <h1>{error ? copy.bootFailed : copy.bootPreparing}</h1>
      {error ? (
        <p className="case-boot__detail">
          {copy.bootFailureDetail}
        </p>
      ) : (
        <div className="case-boot__progress" aria-label={copy.loading}><span /></div>
      )}
    </main>
  )
}

interface CaseExperienceProps {
  readonly manifest: ShellPublicCaseManifest
  readonly saveId: string
  readonly detectiveDisplayName: string
  readonly renderSettings: RenderWorkspaceSettings
}

function CaseExperience({
  manifest,
  saveId,
  detectiveDisplayName,
  renderSettings,
}: CaseExperienceProps) {
  const copy = useUiCopy(APP_COPY)
  const copyRef = useRef(copy)
  copyRef.current = copy
  const [phase, setPhase] = useState<OpeningPhase>('checking')
  const [snapshot, setSnapshot] = useState<PublicCaseRuntimeState>()
  const [assetSessionId, setAssetSessionId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [runEpoch, setRunEpoch] = useState(0)
  const sessionRef = useMemo<DemoCaseSessionRef>(() => ({
    caseId: manifest.case.id,
    caseVersion: manifest.case.version,
    locale: manifest.case.locale ?? 'tr',
    saveId,
  }), [manifest.case.id, manifest.case.locale, manifest.case.version, saveId])
  const shouldPollWallClock = phase === 'active' && snapshot?.status === 'active' && (
    snapshot.deadlines.some(({ clock, status }) => clock === 'wall' && status === 'scheduled')
  )

  useEffect(() => {
    let current = true
    setPhase('checking')
    setError(undefined)
    setAssetSessionId(undefined)
    browserGameSessionClient.status(sessionRef)
      .then((status) => {
        if (!current) return
        if (status.exists && status.snapshot) {
          if (!status.assetSessionId) throw new Error('Missing asset session.')
          setSnapshot(status.snapshot)
          setAssetSessionId(status.assetSessionId)
          setPhase('active')
        } else {
          setSnapshot(undefined)
          setAssetSessionId(undefined)
          setPhase('ringing')
        }
      })
      .catch(() => {
        if (!current) return
        setError(copyRef.current.connectionFailed)
        setPhase('ringing')
      })
    return () => { current = false }
  }, [sessionRef])

  useEffect(() => {
    if (!shouldPollWallClock) return
    let current = true
    let inFlight = false
    const refresh = (): void => {
      if (inFlight) return
      inFlight = true
      browserGameSessionClient.status(sessionRef)
        .then((status) => {
          if (!current) return
          if (!status.exists) {
            setSnapshot(undefined)
            setAssetSessionId(undefined)
            setError(undefined)
            setPhase('ringing')
            return
          }
          if (!status.snapshot) return
          setSnapshot((existing) => (
            existing && existing.revision > status.snapshot!.revision ? existing : status.snapshot
          ))
          if (status.assetSessionId) setAssetSessionId(status.assetSessionId)
        })
        .catch(() => undefined)
        .finally(() => { inFlight = false })
    }
    const interval = window.setInterval(refresh, 5_000)
    return () => {
      current = false
      window.clearInterval(interval)
    }
  }, [sessionRef, shouldPollWallClock])

  const acceptCase = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const started = await browserGameSessionClient.start(sessionRef)
      if (!started.snapshot) throw new Error('Missing case state.')
      if (!started.assetSessionId) throw new Error('Missing asset session.')
      createCaseBoardPersistence(
        caseBoardStateKey(manifest, started.snapshot.case.digest, saveId),
        {
          legacyKey: caseBoardStateKey(
            manifest,
            started.snapshot.case.digest,
            saveId,
            LEGACY_BRAND_STORAGE_PREFIX,
          ),
        },
      ).clear()
      setSnapshot(started.snapshot)
      setAssetSessionId(started.assetSessionId)
      setRunEpoch((current) => current + 1)
      setPhase('active')
    } catch {
      setError(copy.caseStartFailed)
    } finally {
      setBusy(false)
    }
  }, [copy, manifest, saveId, sessionRef])

  const command = useCallback(async (intent: DemoBrowserIntent): Promise<DemoCommandResponse> => {
    const result = await browserGameSessionClient.command(sessionRef, intent)
    setSnapshot((current) => (
      current && current.revision > result.snapshot.revision ? current : result.snapshot
    ))
    if (result.ok) setError(undefined)
    return result
  }, [sessionRef])

  const restart = useCallback(async () => {
    setPhase('restarting')
    setBusy(true)
    setError(undefined)
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    try {
      await browserGameSessionClient.restart(sessionRef)
      createLocalStorageLayoutPersistence(desktopLayoutKey(manifest, saveId), {
        legacyKey: desktopLayoutKey(manifest, saveId, LEGACY_BRAND_STORAGE_PREFIX),
      }).clear?.()
      if (snapshot) {
        createCaseBoardPersistence(
          caseBoardStateKey(manifest, snapshot.case.digest, saveId),
          {
            legacyKey: caseBoardStateKey(
              manifest,
              snapshot.case.digest,
              saveId,
              LEGACY_BRAND_STORAGE_PREFIX,
            ),
          },
        ).clear()
      }
      if (assetSessionId) {
        clearForensicsWorkflow(
          browserLocalStorage(),
          forensicsWorkflowKey(manifest, assetSessionId, saveId),
          forensicsWorkflowKey(
            manifest,
            assetSessionId,
            saveId,
            LEGACY_BRAND_STORAGE_PREFIX,
          ),
        )
      }
      setSnapshot(undefined)
      setAssetSessionId(undefined)
      setRunEpoch((current) => current + 1)
      setPhase('ringing')
    } catch {
      setError(copy.caseResetFailed)
      setPhase(snapshot ? 'active' : 'ringing')
    } finally {
      setBusy(false)
    }
  }, [assetSessionId, copy, manifest, saveId, sessionRef, snapshot])

  if (phase === 'checking' || phase === 'restarting') return <BootScreen />
  if (phase === 'active' && snapshot && assetSessionId) {
    return (
      <CaseDesktop
        manifest={manifest}
        snapshot={snapshot}
        assetSessionId={assetSessionId}
        runEpoch={runEpoch}
        saveId={saveId}
        detectiveDisplayName={detectiveDisplayName}
        renderSettings={renderSettings}
        onCommand={command}
        onRestart={restart}
      />
    )
  }

  return (
    <OpeningDesktop
      manifest={manifest}
      phase={phase === 'connected' ? 'connected' : phase === 'missed' ? 'missed' : 'ringing'}
      busy={busy}
      error={error}
      onAnswer={() => setPhase('connected')}
      onDecline={() => setPhase('missed')}
      onAccept={() => { void acceptCase() }}
      onRestart={() => { void restart() }}
      renderSettings={renderSettings}
    />
  )
}

export default function App() {
  const [profileStore] = useState<PlayerProfileStore>(() => {
    const defaultLocale = detectBrowserLocale()
    return createPlayerProfileStore({
      defaultDisplayName: defaultLocale === 'tr' ? 'Dedektif' : 'Detective',
      defaultLocale,
    })
  })
  const profileState = useSyncExternalStore(
    profileStore.subscribe,
    profileStore.getSnapshot,
    profileStore.getSnapshot,
  )
  const activeProfile = profileStore.getProfile(profileState.activeProfileId)!
  const [catalog, setCatalog] = useState<readonly CaseCatalogEntry[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [importState, setImportState] = useState<SettingsImportState>({ status: 'idle' })
  const preferredLocale: PlayerPreferredLocale = activeProfile.preferredLocale
  const selectedCaseId = activeProfile.selectedCaseId
    ?? (activeProfile.id === 'primary' ? readCasePreference() : undefined)
  const requestedCaseLocale = selectedCaseId
    ? activeProfile.caseLocales?.[selectedCaseId] ?? preferredLocale
    : preferredLocale

  useEffect(() => {
    const controller = new AbortController()
    setLoadError(false)
    setCatalog(null)
    void (async () => {
      const response = await caseLibraryClient.list(requestedCaseLocale, controller.signal)
      if (response.schema !== 'detective-case-catalog/v1' || !Array.isArray(response.cases)) {
        throw new Error('The case catalog response is not compatible.')
      }
      const cases = response.cases
      if (controller.signal.aborted) return
      setCatalog(cases)
      const selectedEntry = selectedCatalogEntry(cases, selectedCaseId)
      const selected = selectedEntry ? caseSelectionKey(selectedEntry) : undefined
      if (selected && activeProfile.selectedCaseId !== selected) {
        profileStore.updateProfile(activeProfile.id, { selectedCaseId: selected })
      }
    })().catch(() => {
      if (controller.signal.aborted) return
      setLoadError(true)
    })
    return () => controller.abort()
  }, [
    activeProfile.id,
    activeProfile.selectedCaseId,
    profileStore,
    requestedCaseLocale,
    selectedCaseId,
  ])

  const selectCase = (caseId: string) => {
    if (activeProfile.id === 'primary') writeCasePreference(caseId)
    profileStore.updateProfile(activeProfile.id, { selectedCaseId: caseId })
  }

  const importCase = async (request: SettingsImportRequest): Promise<void> => {
    const timers: number[] = []
    setImportState({ status: 'progress', stage: 'connecting', progress: 8 })
    timers.push(window.setTimeout(() => {
      setImportState({ status: 'progress', stage: 'downloading', progress: 30 })
    }, 180))
    timers.push(window.setTimeout(() => {
      setImportState({ status: 'progress', stage: 'checking', progress: 62 })
    }, 850))
    timers.push(window.setTimeout(() => {
      setImportState({ status: 'progress', stage: 'installing', progress: 88 })
    }, 1_650))
    try {
      const imported = await caseLibraryClient.importCase(request, requestedCaseLocale)
      for (const timer of timers) window.clearTimeout(timer)
      setCatalog((current) => {
        const next = [
          ...(current ?? []).filter(({ id, version }) => (
            id !== imported.entry.id || version !== imported.entry.version
          )),
          imported.entry,
        ]
        return next.sort((left, right) => left.title.localeCompare(right.title, preferredLocale))
      })
      profileStore.updateProfile(activeProfile.id, {
        selectedCaseId: caseSelectionKey(imported.entry),
      })
      setImportState({
        status: 'success',
        caseTitle: imported.entry.title,
      })
    } catch (error) {
      for (const timer of timers) window.clearTimeout(timer)
      setImportState({ status: 'error', ...importFailureCopy(preferredLocale, error) })
    }
  }

  const selected = selectedCatalogEntry(catalog, selectedCaseId)
  const installedCases = (catalog ?? []).map(installedCaseSummary)
  const renderSettings: RenderWorkspaceSettings = (context) => (
    <SettingsWorkspace
      profiles={profileState.profiles}
      activeProfileId={activeProfile.id}
      installedCases={installedCases}
      activeCaseId={context.activeCaseId}
      activeCaseLocale={context.activeCaseLocale}
      caseStatus={context.caseStatus}
      autosaveStatus={context.autosaveStatus}
      locale={preferredLocale}
      importState={importState}
      busy={Boolean(context.busy) || importState.status === 'progress'}
      {...(context.deadline ? { deadline: context.deadline } : {})}
      onProfileSwitch={(profileId) => profileStore.setActiveProfile(profileId)}
      onProfileCreate={(profile) => profileStore.createProfile({
        ...profile,
        ...(selected ? { selectedCaseId: caseSelectionKey(selected) } : {}),
        makeActive: true,
      })}
      onProfileRename={(profileId, displayName) => {
        profileStore.updateProfile(profileId, { displayName })
      }}
      onProfileDelete={(profileId) => {
        clearProfileSidecars(profileId)
        profileStore.deleteProfile(profileId)
      }}
      onLanguageChange={(locale) => {
        profileStore.updateProfile(activeProfile.id, {
          preferredLocale: locale,
          caseLocales: {
            ...activeProfile.caseLocales,
            [context.activeCaseId]: context.activeCaseLocale,
          },
        })
      }}
      onCaseLanguageChange={(locale) => {
        profileStore.updateProfile(activeProfile.id, {
          caseLocales: {
            ...activeProfile.caseLocales,
            [context.activeCaseId]: locale,
          },
        })
      }}
      onCaseSelect={selectCase}
      onImport={importCase}
      onRestart={context.onRestart}
    />
  )

  return (
    <UiLocaleProvider locale={preferredLocale}>
      {loadError ? <BootScreen error /> : !selected ? <BootScreen /> : (
        <CaseExperience
          key={`${activeProfile.id}:${selected.id}:${selected.version}:${selected.locale}`}
          manifest={selected.manifest}
          saveId={activeProfile.id}
          detectiveDisplayName={activeProfile.displayName}
          renderSettings={renderSettings}
        />
      )}
    </UiLocaleProvider>
  )
}
