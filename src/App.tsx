import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import dedektifWallpaper from './assets/shell/dedektif-wallpaper.png'
import { AccessibleModal, ModalBackground } from './AccessibleModal'
import { CaseOutcomeReport } from './CaseOutcomeReport'
import {
  createLocalStorageLayoutPersistence,
  DesktopShell,
  kebabCaseChannelName,
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
import {
  appendForensicsRequest,
  clearForensicsWorkflow,
  createAsyncForensicsRequest,
  createForensicsRequest,
  FORENSICS_LEAD_NAME,
  FORENSICS_LEAD_ROLE,
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
  createManifestWorkspaceModels,
  type ManifestWorkspaceSelection,
  type ShellPublicCaseManifest,
} from './shell/manifest-workspace'
import type { PublicCaseRuntimeState } from './case-runtime/protocol'
import {
  createDemoAssetUrl,
  demoSessionClient,
  PRIMARY_DEMO_SAVE_ID,
  type DemoBrowserIntent,
  type DemoCaseSessionRef,
  type DemoCommandResponse,
} from './demo-host-client'

interface PublicCaseIndex {
  readonly schema: 'case-public-index/v0.3'
  readonly cases: readonly ShellPublicCaseManifest[]
  readonly packages: readonly {
    readonly slug: string
    readonly caseId: string
    readonly caseVersion: string
    readonly caseDigest: string
    readonly manifestUrl: string
    readonly manifestDigest: string
    readonly defaultLocale: string
    readonly locales: readonly {
      readonly locale: string
      readonly manifestUrl: string
      readonly manifestDigest: string
    }[]
    readonly assetManifestUrl: string
    readonly assetManifestDigest: string
  }[]
}

const CASE_PREFERENCE_KEY = 'karanlik-oda:selected-case'

type OpeningPhase = 'checking' | 'ringing' | 'missed' | 'connected' | 'active' | 'restarting' | 'error'

function desktopLayoutKey(manifest: ShellPublicCaseManifest): string {
  return `karanlik-oda:${manifest.case.id}:${manifest.case.version}:${PRIMARY_DEMO_SAVE_ID}:desktop-layout`
}

function forensicsWorkflowKey(
  manifest: ShellPublicCaseManifest,
  assetSessionId: string,
): string {
  return `karanlik-oda:${manifest.case.id}:${manifest.case.version}:${PRIMARY_DEMO_SAVE_ID}:${assetSessionId}:forensics-workflow`
}

function caseBoardStateKey(
  manifest: ShellPublicCaseManifest,
  caseDigest: string,
): string {
  return `karanlik-oda:${manifest.case.id}:${manifest.case.version}:${caseDigest}:${PRIMARY_DEMO_SAVE_ID}:case-board`
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

function caseClockLabel(manifest: ShellPublicCaseManifest, milliseconds: number): string {
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

function remainingLabel(milliseconds: number): string {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000))
  return `${minutes} dk kaldı`
}

function completedForensicsReply(
  snapshot: PublicCaseRuntimeState,
  request: ForensicsRequestRecord,
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
    : evidence.description?.trim() || 'Kayıt kontrol edildi; ek bir bulgu görünmüyor.'
  return `“${request.evidenceTitle}” için inceleme tamam. ${detail}`.slice(0, 12_000)
}

function forensicsRequestBody(request: ForensicsRequestRecord): string {
  if (request.kind === 'async-interaction') return request.requestBody
  return `${FORENSICS_LEAD_NAME}, “${request.evidenceTitle}” kaydını incelemeye alır mısın? Görünen içeriği ve önemli ayrıntıları kontrol et.`
}

function forensicsRequestSubject(request: ForensicsRequestRecord): string {
  return request.kind === 'async-interaction' ? request.subjectLabel : request.evidenceTitle
}

function revealedActor(
  snapshot: PublicCaseRuntimeState,
  request: ForensicsRequestRecord,
): { readonly id: string; readonly name: string } | undefined {
  if (request.kind !== 'async-interaction') return undefined
  const completed = snapshot.completedAffordances.find(({ id }) => id === request.affordanceId)
  const listedByCommand = completed?.contactsListed ?? []
  if (listedByCommand.length !== 1) return undefined
  const actor = snapshot.actors.find(({ id }) => id === listedByCommand[0])
  if (!actor) return undefined
  return {
    id: actor.id,
    name: actor.displayName?.trim() || actor.name?.trim() || 'Yeni kişi',
  }
}

function completeForensicsRecord(
  request: ForensicsRequestRecord,
  snapshot: PublicCaseRuntimeState,
  replyBody: string,
  replyLabel: string,
): ForensicsRequestRecord {
  if (request.kind === 'evidence-review') {
    return { ...request, status: 'complete', replyBody, replyLabel }
  }
  const actor = revealedActor(snapshot, request)
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

function playerCommandError(code: string): string {
  const messages: Record<string, string> = {
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
  }
  return messages[code] ?? 'Bu hamle şu anda yapılamıyor.'
}

function outgoingCallOutcome(
  execution: IntentExecution,
  completedBefore: number,
  match: PhoneCallResultMatch,
): { readonly successful: boolean; readonly result: string } {
  if (execution.kind === 'busy') {
    return { successful: false, result: 'Hat şu anda başka bir işlemle meşgul. Biraz sonra tekrar ara.' }
  }
  if (execution.kind === 'failed') {
    return { successful: false, result: 'Arama tamamlanamadı. Bağlantıyı kontrol edip tekrar dene.' }
  }
  if (!execution.response.ok) {
    return {
      successful: false,
      result: playerCommandError(execution.response.error.code),
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
    result: latestPhoneResult || 'Görüşme tamamlandı. Yeni bilgiler vaka notlarına işlendi.',
  }
}

function localizedManifestUrl(
  packageEntry: PublicCaseIndex['packages'][number],
  requestedLocales: readonly string[],
): string {
  for (const requested of requestedLocales) {
    const exact = packageEntry.locales.find(({ locale }) => locale === requested)
    if (exact) return exact.manifestUrl
    const base = requested.split('-')[0]
    const language = packageEntry.locales.find(({ locale }) => locale === base)
    if (language) return language.manifestUrl
  }
  return packageEntry.locales.find(
    ({ locale }) => locale === packageEntry.defaultLocale,
  )?.manifestUrl ?? packageEntry.manifestUrl
}

function readCasePreference(): string | undefined {
  try {
    return window.localStorage.getItem(CASE_PREFERENCE_KEY) ?? undefined
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

interface CaseDesktopProps {
  readonly manifest: ShellPublicCaseManifest
  readonly cases: readonly ShellPublicCaseManifest[]
  readonly snapshot: PublicCaseRuntimeState
  readonly assetSessionId: string
  readonly runEpoch: number
  readonly onSelectCase: (caseId: string) => void
  readonly onCommand: (intent: DemoBrowserIntent) => Promise<DemoCommandResponse>
  readonly onRestart: () => Promise<void>
}

function CaseDesktop({
  manifest,
  cases,
  snapshot,
  assetSessionId,
  runEpoch,
  onSelectCase,
  onCommand,
  onRestart,
}: CaseDesktopProps) {
  const workflowKey = useMemo(
    () => forensicsWorkflowKey(manifest, assetSessionId),
    [assetSessionId, manifest],
  )
  const [selection, setSelection] = useState<ManifestWorkspaceSelection>({
    query: '',
    replyDraft: '',
  })
  const [forensicsWorkflow, setForensicsWorkflow] = useState<ForensicsWorkflowState>(() => (
    readForensicsWorkflow(browserLocalStorage(), workflowKey)
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
      ? `${added[0].title ?? 'Yeni kanıt'} Finder'a eklendi.`
      : `${added.length} yeni kanıt Finder'a eklendi.`
    if (outgoingPhoneCallRef.current) {
      pendingPhoneFollowUpAppRef.current = 'files'
      pendingPhoneFollowUpNoticeRef.current = notice
    } else {
      setCommandNotice(notice)
      focusApp('files')
    }
  }, [focusApp, snapshot.evidence])

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
      ? 'Dosya İşlemleri’nde yeni bir onay bekliyor.'
      : `Dosya İşlemleri’nde ${added.length} yeni onay bekliyor.`
    if (outgoingPhoneCallRef.current) {
      pendingPhoneFollowUpAppRef.current = 'case-dispatch'
      pendingPhoneFollowUpNoticeRef.current = notice
    } else {
      setCommandNotice(notice)
      focusApp('case-dispatch')
    }
  }, [focusApp, snapshot.affordances])

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
      ? 'Vaka Notları’nda yeni bir kişi araştırması hazır.'
      : `Vaka Notları’nda ${added.length} yeni kişi araştırması hazır.`
    if (outgoingPhoneCallRef.current) {
      pendingPhoneFollowUpAppRef.current = 'casebook'
      pendingPhoneFollowUpNoticeRef.current = notice
    } else {
      setCommandNotice(notice)
      focusApp('casebook')
    }
  }, [focusApp, snapshot.affordances])

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
      (asset) => createDemoAssetUrl({
        caseId: snapshot.case.id,
        caseVersion: snapshot.case.version,
        locale: manifest.case.locale ?? 'tr',
        saveId: PRIMARY_DEMO_SAVE_ID,
        assetSessionId,
        caseDigest: snapshot.case.digest,
      }, asset.id),
    ),
    [assetSessionId, contactActionStatuses, manifest, newContactIds, selection, snapshot],
  )
  const phoneModel = useMemo<PhoneViewModel>(() => (
    outgoingPhoneCall ? { ...models.phone, outgoingCall: outgoingPhoneCall } : models.phone
  ), [models.phone, outgoingPhoneCall])
  const caseBoardKey = useMemo(
    () => caseBoardStateKey(manifest, snapshot.case.digest),
    [manifest, snapshot.case.digest],
  )
  const caseBoardPersistence = useMemo(
    () => createCaseBoardPersistence(caseBoardKey),
    [caseBoardKey],
  )
  const caseBoardModel = useMemo(
    () => createCaseBoardViewModel(manifest.case.title, models.phone, models.files),
    [manifest.case.title, models.files, models.phone],
  )
  const layoutPersistence = useMemo(
    () => createLocalStorageLayoutPersistence(desktopLayoutKey(manifest)),
    [manifest.case.id, manifest.case.version],
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
        if (!options.silent) setCommandNotice(playerCommandError(result.error.code))
        return { kind: 'response', response: result }
      }
      if (!options.silent) {
        if (intent.kind === 'observe') {
          const title = snapshot.evidence.find(({ id }) => id === intent.evidenceId)?.title
          setCommandNotice(`${title ?? 'Kanıt'} incelendi. Bulgular Vaka Notları'na eklendi.`)
        } else if (intent.kind === 'deduce') {
          setCommandNotice('Çıkarım kanıtlarla doğrulandı.')
        } else {
          setCommandNotice('İşlem tamamlandı. Yeni bilgiler Vaka Notları’na işlendi.')
        }
      }
      return { kind: 'response', response: result }
    } catch {
      if (!options.silent) setCommandNotice('İşlem tamamlanamadı. Tekrar deneyin.')
      return { kind: 'failed' }
    } finally {
      commandBusyRef.current = false
      if (desktopMountedRef.current) setCommandBusy(false)
    }
  }, [onCommand, snapshot.evidence])
  const executeAffordance = useCallback(async (affordanceId: string): Promise<IntentExecution> => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    if (!affordance) {
      setCommandNotice('Bu hamle artık kullanılabilir değil.')
      return { kind: 'failed' }
    }
    return affordance.intent.kind === 'deduce'
      ? executeIntent(affordance.intent)
      : executeIntent({ kind: 'action', ...affordance.intent.action })
  }, [executeIntent, snapshot.affordances])
  const dispatchAffordance = useCallback(async (affordanceId: string): Promise<boolean> => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    const execution = await executeAffordance(affordanceId)
    const accepted = execution.kind === 'response' && execution.response.ok
    if (accepted && affordance?.surface === 'casebook' && affordance.intent.kind === 'action') {
      setCommandNotice('İşlem iletildi. Sonuç vaka dosyasına kaydedildi.')
    }
    return accepted
  }, [executeAffordance, snapshot.affordances])
  const requestAffordance = useCallback(async (affordanceId: string): Promise<boolean> => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    if (!affordance) {
      setCommandNotice('Bu hamle artık kullanılabilir değil.')
      return false
    }
    if (affordance.risk !== 'normal' || affordance.confirmation) {
      setPendingAffordanceId(affordanceId)
      return false
    }
    return dispatchAffordance(affordanceId)
  }, [dispatchAffordance, snapshot.affordances])

  const startOutgoingPhoneCall = useCallback((
    contactId: string,
    actionLabel: string,
    resultMatch: PhoneCallResultMatch,
    execute: (sessionId: number) => Promise<IntentExecution>,
  ) => {
    if (outgoingPhoneCallRef.current) {
      setCommandNotice('Önce devam eden görüşmeyi tamamla.')
      return
    }
    if (commandBusyRef.current) {
      setCommandNotice('Hat şu anda başka bir işlemle meşgul. Biraz sonra tekrar ara.')
      return
    }
    const contact = models.phone.contacts.find(({ id }) => id === contactId)
    if (!contact) {
      setCommandNotice('Bu kişi artık telefon rehberinde görünmüyor.')
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
      const outcome = outgoingCallOutcome(execution, completedBefore, resultMatch)
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
  }, [focusApp, models.phone.contacts, snapshot.completedAffordances.length, updateOutgoingPhoneCall, waitForOutgoingCall])

  const startPhoneAffordance = useCallback((affordance: PublicAffordance): boolean => {
    if (affordance.surface !== 'phone' || affordance.intent.kind !== 'action') return false
    const actionIntent = affordance.intent.action
    const contactId = actionIntent.actor ?? actionIntent.from ?? actionIntent.target
    if (!contactId || !models.phone.contacts.some(({ id }) => id === contactId)) return false

    startOutgoingPhoneCall(
      contactId,
      affordance.label?.trim() || 'Görüşme',
      { affordanceId: affordance.id },
      (sessionId) => executeIntent(
        { kind: 'action', ...actionIntent },
        { silent: true, outgoingCallSessionId: sessionId },
      ),
    )
    return true
  }, [executeIntent, models.phone.contacts, startOutgoingPhoneCall])

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
        const replyBody = completedForensicsReply(snapshot, request)
        if (!replyBody) return [request]
        const actor = revealedActor(snapshot, request)
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
        )]
      })
      return changed ? { ...current, requests } : current
    })
  }, [manifest, snapshot])

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
          const replyBody = completedForensicsReply(responseSnapshot, request)
          const alreadyResolved = request.kind === 'evidence-review' && response && !response.ok
            ? response.error.code === 'evidence-already-observed' && Boolean(replyBody)
            : request.kind === 'async-interaction' && Boolean(replyBody)

          if ((response?.ok || alreadyResolved) && replyBody) {
            const replyLabel = caseClockLabel(manifest, responseSnapshot.clocks.caseTimeMs)
            setForensicsWorkflow((current) => updateForensicsRequest(
              current,
              request.id,
              (item) => completeForensicsRecord(item, responseSnapshot, replyBody, replyLabel),
            ))
            setStreamingForensicsReply({
              requestId: request.id,
              endsAtWallMs: Date.now() + forensicsReplyDurationMs(replyBody),
            })
            setCommandNotice(
              request.kind === 'evidence-review'
                ? `${request.evidenceTitle} incelemesi tamamlandı. ${FORENSICS_LEAD_NAME} bulguları paylaştı.`
                : `${request.subjectLabel} tamamlandı. ${FORENSICS_LEAD_NAME} doğrulanmış kaydı paylaştı.`,
            )
            return
          }

          const failureBody = request.kind === 'evidence-review'
            ? 'İncelemeyi tamamlayamadım. Kaydı yeniden gönderebilir misin?'
            : 'İletişim kaydını doğrulayamadım. İsteği yeniden gönderebilir misin?'
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
  }, [executeAffordance, executeIntent, manifest, pendingForensicsRequest, snapshot])

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
      setCommandNotice('Bu kayıt artık erişilebilir değil.')
      return
    }

    setSelection((current) => ({ ...current, selectedThreadId: FORENSICS_THREAD_ID }))
    focusApp('inbox')

    if (record.status === 'observed') {
      setCommandNotice('Bu kayıt zaten incelendi.')
      return
    }
    if (pendingForensicsRequest || streamingForensicsReply) {
      setCommandNotice(`${FORENSICS_LEAD_NAME} mevcut incelemeyi tamamlıyor.`)
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
    setCommandNotice(`${record.title} inceleme için ${FORENSICS_LEAD_NAME}'a gönderildi.`)
  }, [focusApp, manifest, models.files.records, pendingForensicsRequest, snapshot.clocks.caseTimeMs, streamingForensicsReply])

  const requestAsyncForensicsAction = useCallback((affordanceId: string) => {
    const affordance = snapshot.affordances.find(({ id }) => id === affordanceId)
    const interaction = affordance?.interaction
    if (
      !affordance
      || affordance.surface !== 'inbox'
      || interaction?.kind !== 'async-message'
      || !interaction.request?.trim()
    ) {
      setCommandNotice('Bu araştırma isteği artık kullanılamıyor.')
      return
    }

    setSelection((current) => ({ ...current, selectedThreadId: FORENSICS_THREAD_ID }))
    focusApp('inbox')
    if (pendingForensicsRequest || streamingForensicsReply) {
      setCommandNotice(`${FORENSICS_LEAD_NAME} mevcut isteği tamamlıyor.`)
      return
    }

    const requestedAtWallMs = Date.now()
    const subjectLabel = affordance.label?.trim() || 'İletişim kaydını bul'
    const request = createAsyncForensicsRequest({
      affordanceId,
      subjectLabel,
      requestBody: interaction.request.trim(),
      requestedAtWallMs,
      requestedAtCaseMs: snapshot.clocks.caseTimeMs,
      requestedLabel: caseClockLabel(manifest, snapshot.clocks.caseTimeMs),
    })
    setForensicsWorkflow((current) => appendForensicsRequest(current, request))
    setCommandNotice(`${subjectLabel} isteği ${FORENSICS_LEAD_NAME}'a gönderildi.`)
  }, [focusApp, manifest, pendingForensicsRequest, snapshot, streamingForensicsReply])

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
    const baseThreads = models.inbox.threads.map((thread) => ({
      ...thread,
      channelId: 'case-desk',
    }))
    const baseThreadId = baseThreads[0]?.id
    const selectedThreadId = selection.selectedThreadId ?? baseThreadId ?? FORENSICS_THREAD_ID
    const forensicsSelected = selectedThreadId === FORENSICS_THREAD_ID
    const latestRequest = forensicsWorkflow.requests.at(-1)
    const preview = latestRequest?.replyBody
      ?? (latestRequest ? forensicsRequestBody(latestRequest) : 'Henüz inceleme isteği yok.')
    const forensicsThread = {
      id: FORENSICS_THREAD_ID,
      channelId: 'forensics',
      sender: FORENSICS_LEAD_NAME,
      subject: latestRequest ? forensicsRequestSubject(latestRequest) : 'Adli inceleme',
      preview,
      timestampLabel: latestRequest?.replyLabel ?? latestRequest?.requestedLabel ?? 'Şimdi',
      unread: !forensicsSelected && latestRequest?.status === 'complete',
      ...(pendingForensicsRequest ? { badgeLabel: 'yazıyor' } : {}),
    }
    const forensicsMessages = forensicsWorkflow.requests.flatMap((request) => {
      const requestMessage = {
        id: `${request.id}:request`,
        author: 'Dedektif',
        roleLabel: 'Soruşturma sorumlusu',
        avatarLabel: 'D',
        body: forensicsRequestBody(request),
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
        roleLabel: FORENSICS_LEAD_ROLE,
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
        author: 'Sistem',
        body: `${request.revealedActorName} Kişiler’e eklendi.`,
        timestampLabel: request.replyLabel ?? request.requestedLabel,
        direction: 'system' as const,
        cta: {
          id: request.id,
          label: `${request.revealedActorName} kişisini iPhone’da aç`,
          accessibleLabel: `${request.revealedActorName} kişi kartını iPhone’da aç`,
        },
      }]
    })
    return {
      ...models.inbox,
      workspaceLabel: 'Dedektif Bürosu',
      channelLead: {
        name: FORENSICS_LEAD_NAME,
        roleLabel: 'Adli İnceleme Lideri',
        avatarLabel: 'EA',
      },
      selectedThreadId,
      selectedChannelId: forensicsSelected ? 'forensics' : 'case-desk',
      channels: [
        {
          id: 'case-desk',
          label: caseChannelName,
          ...(baseThreadId ? { threadId: baseThreadId } : {}),
          topic: 'Aktif vaka, saha notları ve görev bildirimleri',
        },
        {
          id: 'forensics',
          label: 'forensics',
          threadId: FORENSICS_THREAD_ID,
          topic: 'Kanıt incelemeleri ve doğrulanmış iletişim kayıtları',
          ...(!forensicsSelected && latestRequest?.status === 'complete' ? { unreadCount: 1 } : {}),
        },
        {
          id: 'operations',
          label: 'operasyon',
          topic: 'Saha koordinasyonu',
          private: true,
        },
        {
          id: 'evidence-chain',
          label: 'delil-zinciri',
          topic: 'Teslim ve muhafaza kayıtları',
          private: true,
        },
        {
          id: 'shift-handoff',
          label: 'nöbet-devir',
          topic: 'Vardiya notları ve açık işler',
          private: true,
        },
        {
          id: 'office-management',
          label: 'büro-yönetimi',
          topic: 'Ekip içi duyurular',
          private: true,
        },
      ],
      threads: [...baseThreads, forensicsThread],
      messages: forensicsSelected ? forensicsMessages : models.inbox.messages,
      typingAuthor: forensicsSelected && pendingForensicsRequest ? FORENSICS_LEAD_NAME : undefined,
    }
  }, [caseChannelName, forensicsWorkflow.requests, models.files.records, models.inbox, pendingForensicsRequest, selection.selectedThreadId, streamingForensicsReply])

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
      if (asset) return asset
    }
    return undefined
  }, [caseBoardModel.pins, inboxModel.messages, models.files.records, openAssetId])

  const apps = useMemo<readonly ShellAppDefinition[]>(() => [
    {
      id: 'casebook',
      title: 'Vaka Notları',
      icon: { type: 'image', src: casebookIcon },
      content: (
        <CasebookApp
          model={models.casebook}
          onAttemptDeduction={(deductionId) => {
            const affordance = snapshot.affordances.find((candidate) => (
              candidate.intent.kind === 'deduce' && candidate.intent.deductionId === deductionId
            ))
            if (!affordance) {
              setCommandNotice('Bu çıkarım artık değerlendirilebilir değil.')
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
      desktopShortcut: true,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--casebook',
    },
    {
      id: 'case-board',
      title: 'Vaka Panosu',
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
      desktopShortcut: true,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--case-board',
    },
    {
      id: 'case-dispatch',
      title: 'Dosya İşlemleri',
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
      desktopShortcut: true,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--case-dispatch',
    },
    {
      id: 'inbox',
      title: 'Gelen Kutusu',
      icon: { type: 'image', src: inboxIcon },
      content: (
        <InboxApp
          model={inboxModel}
          onSelectThread={(id) => select('selectedThreadId', id)}
          onReplyDraftChange={(value) => select('replyDraft', value)}
          onOpenAttachment={setOpenAssetId}
          onMessageCta={openDiscoveredContact}
        />
      ),
      badge: pendingForensicsRequest ? 1 : undefined,
      initialBounds: { x: 105, y: 35, width: 900, height: 620 },
      minSize: { width: 720, height: 450 },
      defaultOpen: false,
      desktopShortcut: true,
      startMenu: true,
      taskbarPinned: true,
      windowClassName: 'detective-window--inbox',
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
              ?.label ?? 'Görüşme'
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
      desktopShortcut: true,
      startMenu: true,
      taskbarPinned: true,
      badge: newContactIds.length || models.phone.affordances?.length || undefined,
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
      desktopShortcut: true,
      startMenu: true,
      taskbarPinned: true,
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
              setCommandNotice('Bu arama için doğrulanmış bir yol yok. Önerilen araştırmalardan birini kullan.')
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
      initialBounds: { x: 910, y: 486, width: 525, height: 308 },
      minSize: { width: 450, height: 280 },
      defaultOpen: false,
      desktopShortcut: true,
      startMenu: true,
      taskbarPinned: true,
      badge: snapshot.affordances.filter(({ surface }) => surface === 'web').length || undefined,
    },
    {
      id: 'evidence-rail',
      title: 'Kanıt / Sorular',
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
      desktopShortcut: false,
      startMenu: true,
      taskbarPinned: false,
    },
  ], [caseBoardKey, caseBoardModel, caseBoardPersistence, commandBusy, dismissOutgoingPhoneCall, executeIntent, focusApp, forensicsBusy, inboxModel, models, newContactIds.length, openDiscoveredContact, phoneModel, phoneOpenContactRequest, requestAffordance, requestAsyncForensicsAction, requestForensicsReview, snapshot.affordances, snapshot.evidence, startOutgoingPhoneCall, startPhoneAffordance])

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
          brand="dedektif"
          subtitle={manifest.case.title}
          ariaLabel={`${manifest.case.title} dedektif çalışma masası`}
          backgroundImage={dedektifWallpaper}
          brandIcon={{ type: 'image', src: casebookIcon }}
          startLabel="dedektif"
          layoutPersistence={layoutPersistence}
          focusRequest={focusRequest}
          statusSlot={(
            <div className="workspace-status">
              <span className="workspace-status__timer" title="Vaka saati">
                <i aria-hidden="true" /> {caseClockLabel(manifest, snapshot.clocks.caseTimeMs)}
              </span>
              {nextDeadline ? (
                <span
                  className={`workspace-status__deadline ${nextDeadline.remainingMs <= 5 * 60_000 ? 'is-urgent' : ''}`.trim()}
                  title={nextDeadline.title ?? 'Yaklaşan zaman sınırı'}
                >
                  {nextDeadline.title ?? 'Zaman sınırı'} · {remainingLabel(nextDeadline.remainingMs)}
                </span>
              ) : null}
              <label className="workspace-case-picker">
                <span className="detective-sr-only">Aktif vaka</span>
                <select
                  value={manifest.case.id}
                  onChange={(event) => onSelectCase(event.currentTarget.value)}
                  title="Vaka seç"
                >
                  {cases.map((candidate) => (
                    <option key={candidate.case.id} value={candidate.case.id}>
                      {candidate.case.title}
                    </option>
                  ))}
                </select>
              </label>
              {commandNotice ? (
                <span className="workspace-status__notice" role="status">{commandNotice}</span>
              ) : null}
              <button
                type="button"
                className="workspace-status__restart"
                disabled={commandBusy || restartBusy}
                onClick={() => {
                  setRestartFromOutcome(false)
                  setConfirmRestart(true)
                }}
              >
                Baştan başlat
              </button>
              <span className="workspace-status__safe" title="İlerleme otomatik kaydedilir">
                {commandBusy ? 'KAYDEDİLİYOR' : 'KAYDEDİLDİ'}
              </span>
            </div>
          )}
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
                  ? pendingAffordance.risk === 'terminal' ? 'Nihai dosya gönderimi' : 'Dosya işlemi'
                  : pendingAffordance.risk === 'terminal' ? 'Son karar' : 'Sonucu olan hamle'
              }</span>
              <h2 id="decision-title">{pendingAffordance.label ?? 'Bu hamleyi yapmak istiyor musun?'}</h2>
              <p id="decision-description">{pendingAffordance.confirmation ?? 'Bu hamle soruşturmanın gidişini kalıcı olarak değiştirebilir.'}</p>
              {pendingAffordance.cost?.milliseconds ? (
                <small className="modal-sheet__cost">{remainingLabel(pendingAffordance.cost.milliseconds).replace('kaldı', 'sürecek')}</small>
              ) : null}
            </div>
          </div>
          <footer className="modal-sheet__actions">
            <button type="button" onClick={() => setPendingAffordanceId(undefined)}>Vazgeç</button>
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
                ? pendingAffordance.risk === 'terminal' ? 'Nihai raporu ilet' : 'Onayla ve ilet'
                : 'Hamleyi yap'}
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
            <button type="button" onClick={() => setOutcomeDismissed(true)}>Masaüstünü incele</button>
            <button type="button" className="is-primary" onClick={() => {
              setOutcomeDismissed(true)
              setRestartFromOutcome(true)
              setConfirmRestart(true)
            }}>
              Yeniden oyna
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
              <span className="modal-sheet__eyebrow">Yeni soruşturma</span>
              <h2 id="restart-title">Bu vakaya baştan başlamak istiyor musun?</h2>
              <p id="restart-description">Gözlemler, çıkarımlar, görüşmeler, geçen süre ve bu vakaya ait masa düzeni silinecek.</p>
            </div>
          </div>
          <footer className="modal-sheet__actions">
            <button
              type="button"
              disabled={restartBusy}
              onClick={dismissRestartDialog}
            >
              Vazgeç
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
              Sil ve baştan başla
            </button>
          </footer>
        </AccessibleModal>
      ) : null}
    </>
  )
}

interface OpeningDesktopProps {
  readonly manifest: ShellPublicCaseManifest
  readonly cases: readonly ShellPublicCaseManifest[]
  readonly phase: 'ringing' | 'missed' | 'connected'
  readonly busy: boolean
  readonly error?: string
  readonly onAnswer: () => void
  readonly onDecline: () => void
  readonly onAccept: () => void
  readonly onSelectCase: (caseId: string) => void
}

function OpeningDesktop({
  manifest,
  cases,
  phase,
  busy,
  error,
  onAnswer,
  onDecline,
  onAccept,
  onSelectCase,
}: OpeningDesktopProps) {
  const callerId = manifest.opening.call?.from ?? 'case-desk'
  const callerName = castValue(manifest, callerId, 'name') ?? 'Bilinmeyen arayan'
  const roleLabel = playerFacingLabel(
    castValue(manifest, callerId, 'role') ?? 'Vaka bağlantısı',
  )
  const model = useMemo(() => ({
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
    title: phase === 'connected' ? 'Güvenli Vaka Hattı' : 'Gelen Çağrı',
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
  }], [busy, model, onAccept, onAnswer, onDecline, phase])

  return (
    <DesktopShell
      apps={apps}
      brand="dedektif"
      subtitle="Yeni vaka çağrısı"
      ariaLabel={`${manifest.case.title} gelen vaka çağrısı`}
      backgroundImage={dedektifWallpaper}
      brandIcon={{ type: 'image', src: phoneIcon }}
      startLabel="dedektif"
      statusSlot={(
        <div className="workspace-status workspace-status--opening">
          <label className="workspace-case-picker">
            <span className="detective-sr-only">Gelen vaka</span>
            <select
              value={manifest.case.id}
              onChange={(event) => onSelectCase(event.currentTarget.value)}
              disabled={busy}
            >
              {cases.map((candidate) => (
                <option key={candidate.case.id} value={candidate.case.id}>
                  {candidate.case.title}
                </option>
              ))}
            </select>
          </label>
          {error ? <span className="workspace-status__notice">{error}</span> : null}
          <span className="workspace-status__safe">
            {busy ? 'BAŞLATILIYOR' : 'VAKA SAATİ DURUYOR'}
          </span>
        </div>
      )}
    />
  )
}

function BootScreen({ error }: { readonly error?: boolean }) {
  return (
    <main className="case-boot" aria-live="polite">
      <div className="case-boot__mark">
        <img src={casebookIcon} alt="" />
        <span aria-hidden="true" />
      </div>
      <p>dedektif</p>
      <h1>{error ? 'Vaka masası açılamadı' : 'Güvenli masa hazırlanıyor'}</h1>
      {error ? (
        <p className="case-boot__detail">
          Vaka dosyaları yüklenemedi. Sayfayı yenileyip tekrar deneyin.
        </p>
      ) : (
        <div className="case-boot__progress" aria-label="Yükleniyor"><span /></div>
      )}
    </main>
  )
}

interface CaseExperienceProps {
  readonly manifest: ShellPublicCaseManifest
  readonly cases: readonly ShellPublicCaseManifest[]
  readonly onSelectCase: (caseId: string) => void
}

function CaseExperience({ manifest, cases, onSelectCase }: CaseExperienceProps) {
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
    saveId: PRIMARY_DEMO_SAVE_ID,
  }), [manifest.case.id, manifest.case.locale, manifest.case.version])
  const shouldPollWallClock = phase === 'active' && snapshot?.status === 'active' && (
    snapshot.deadlines.some(({ clock, status }) => clock === 'wall' && status === 'scheduled')
  )

  useEffect(() => {
    let current = true
    setPhase('checking')
    setError(undefined)
    setAssetSessionId(undefined)
    demoSessionClient.status(sessionRef)
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
        setError('Bağlantı kurulamadı. Sayfayı yenileyip tekrar deneyin.')
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
      demoSessionClient.status(sessionRef)
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
      const started = await demoSessionClient.start(sessionRef)
      if (!started.snapshot) throw new Error('Missing case state.')
      if (!started.assetSessionId) throw new Error('Missing asset session.')
      createCaseBoardPersistence(
        caseBoardStateKey(manifest, started.snapshot.case.digest),
      ).clear()
      setSnapshot(started.snapshot)
      setAssetSessionId(started.assetSessionId)
      setRunEpoch((current) => current + 1)
      setPhase('active')
    } catch {
      setError('Vaka başlatılamadı. Tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }, [manifest, sessionRef])

  const command = useCallback(async (intent: DemoBrowserIntent): Promise<DemoCommandResponse> => {
    const result = await demoSessionClient.command(sessionRef, intent)
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
      await demoSessionClient.restart(sessionRef)
      createLocalStorageLayoutPersistence(desktopLayoutKey(manifest)).clear?.()
      if (snapshot) {
        createCaseBoardPersistence(
          caseBoardStateKey(manifest, snapshot.case.digest),
        ).clear()
      }
      if (assetSessionId) {
        clearForensicsWorkflow(
          browserLocalStorage(),
          forensicsWorkflowKey(manifest, assetSessionId),
        )
      }
      setSnapshot(undefined)
      setAssetSessionId(undefined)
      setRunEpoch((current) => current + 1)
      setPhase('ringing')
    } catch {
      setError('Vaka sıfırlanamadı. Tekrar deneyin.')
      setPhase(snapshot ? 'active' : 'ringing')
    } finally {
      setBusy(false)
    }
  }, [assetSessionId, manifest, sessionRef, snapshot])

  if (phase === 'checking' || phase === 'restarting') return <BootScreen />
  if (phase === 'active' && snapshot && assetSessionId) {
    return (
      <CaseDesktop
        manifest={manifest}
        cases={cases}
        snapshot={snapshot}
        assetSessionId={assetSessionId}
        runEpoch={runEpoch}
        onSelectCase={onSelectCase}
        onCommand={command}
        onRestart={restart}
      />
    )
  }

  return (
    <OpeningDesktop
      manifest={manifest}
      cases={cases}
      phase={phase === 'connected' ? 'connected' : phase === 'missed' ? 'missed' : 'ringing'}
      busy={busy}
      error={error}
      onAnswer={() => setPhase('connected')}
      onDecline={() => setPhase('missed')}
      onAccept={() => { void acceptCase() }}
      onSelectCase={onSelectCase}
    />
  )
}

export default function App() {
  const [index, setIndex] = useState<PublicCaseIndex | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selectedCaseId, setSelectedCaseId] = useState(readCasePreference)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/generated/cases.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Manifest index: ${response.status}`)
        return response.json() as Promise<PublicCaseIndex>
      })
      .then(async (value) => {
        const cases = await Promise.all(
          value.packages.map(async (packageEntry) => {
            const response = await fetch(
              localizedManifestUrl(packageEntry, [packageEntry.defaultLocale]),
              { signal: controller.signal },
            )
            if (!response.ok) throw new Error(`Localized manifest: ${response.status}`)
            return response.json() as Promise<ShellPublicCaseManifest>
          }),
        )
        setIndex({ ...value, cases })
        setSelectedCaseId((current) => (
          current && cases.some(({ case: candidate }) => candidate.id === current)
            ? current
            : cases[0]?.case.id
        ))
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(true)
      })
    return () => controller.abort()
  }, [])

  const selectCase = (caseId: string) => {
    writeCasePreference(caseId)
    setSelectedCaseId(caseId)
  }

  if (loadError) return <BootScreen error />
  if (!index || index.cases.length === 0) return <BootScreen />

  const selected = index.cases.find(({ case: candidate }) => candidate.id === selectedCaseId)
    ?? index.cases[0]

  return (
    <CaseExperience
      key={`${selected.case.id}:${selected.case.version}`}
      manifest={selected}
      cases={index.cases}
      onSelectCase={selectCase}
    />
  )
}
