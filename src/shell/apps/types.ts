/**
 * Presentation-only contracts for the detective desktop apps.
 *
 * Callers must populate these models from an already-sanitized projection.
 * Components never receive a case definition, private IR, source locator, or
 * engine command object; user intent leaves through the callbacks below.
 */

export type AssetKind = 'image' | 'audio' | 'video' | 'document' | 'file'

export interface AuthorizedAssetViewModel {
  readonly id: string
  readonly kind: AssetKind
  readonly label: string
  readonly mimeType?: string
  readonly description?: string
  /** A host-authorized, player-safe URL. Never pass an authored source locator. */
  readonly deliveryUrl?: string
  /** A host-authorized thumbnail URL, if different from deliveryUrl. */
  readonly thumbnailUrl?: string
  readonly durationLabel?: string
}

export interface EvidenceLinkViewModel {
  readonly id: string
  readonly label: string
}

/**
 * A presentation-safe action offered by the runtime on a specific app
 * surface. The engine command deliberately stays outside component models;
 * apps return only this opaque id to their host.
 */
export interface AffordanceViewModel {
  readonly id: string
  readonly label: string
  readonly costLabel?: string
  readonly risk?: 'normal' | 'consequential' | 'terminal'
  /** Authored player-facing consequence or confirmation copy, never command data. */
  readonly consequence?: string
}

export interface InvestigationLeadViewModel extends AffordanceViewModel {
  readonly surface: 'phone' | 'web' | 'files' | 'casebook'
}

export type DeductionStatus = 'ready' | 'supported' | 'waiting'

export interface CasebookEntryViewModel {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly eyebrow?: string
  readonly timestampLabel?: string
  readonly evidence?: readonly EvidenceLinkViewModel[]
  readonly findings?: readonly string[]
}

export interface CasebookDeductionViewModel {
  readonly id: string
  readonly title: string
  readonly summary?: string
  readonly result?: string
  readonly status: DeductionStatus
  readonly supportLabel?: string
  readonly costLabel?: string
}

export interface CasebookViewModel {
  readonly heading?: string
  readonly synopsis?: string
  readonly phaseLabel?: string
  readonly entries: readonly CasebookEntryViewModel[]
  readonly deductions: readonly CasebookDeductionViewModel[]
  /** Active player-facing actions across every app, without their command payloads. */
  readonly leads: readonly InvestigationLeadViewModel[]
  readonly selectedEntryId?: string
}

export interface CaseDispatchEvidenceItemViewModel {
  readonly id: string
  readonly label: string
  readonly sourceLabel?: string
  readonly statusLabel?: string
}

/**
 * Player-safe projection for the fictional judicial-file application.
 * It models a report handoff without exposing engine commands or private case data.
 */
export interface CaseDispatchViewModel {
  readonly heading?: string
  readonly lifecycle: 'draft' | 'pending' | 'closed'
  readonly caseNumberLabel?: string
  readonly officeLabel?: string
  readonly statusLabel?: string
  readonly routeLabel?: string
  readonly updatedLabel?: string
  readonly summaryTitle?: string
  readonly summary: string
  readonly evidence: {
    readonly total: number
    readonly observed: number
    readonly decisive: number
    readonly items?: readonly CaseDispatchEvidenceItemViewModel[]
  }
  readonly affordances: readonly AffordanceViewModel[]
}

export interface InboxThreadViewModel {
  readonly id: string
  /** Optional room that owns this conversation in the workspace UI. */
  readonly channelId?: string
  readonly sender: string
  readonly subject: string
  readonly preview: string
  readonly timestampLabel: string
  readonly unread?: boolean
  readonly badgeLabel?: string
}

export interface InboxMessageViewModel {
  readonly id: string
  readonly author: string
  readonly roleLabel?: string
  readonly avatarLabel?: string
  readonly body: string
  readonly timestampLabel: string
  readonly direction: 'incoming' | 'outgoing' | 'system'
  readonly attachment?: AuthorizedAssetViewModel
  /** Reveals the visual copy word by word while keeping one complete accessible copy. */
  readonly streaming?: boolean
}

export interface InboxChannelViewModel {
  readonly id: string
  readonly label: string
  /** Existing thread opened by this room. No authored command data belongs here. */
  readonly threadId?: string
  readonly topic?: string
  readonly unreadCount?: number
  readonly private?: boolean
}

export interface InboxViewModel {
  readonly workspaceLabel?: string
  readonly channels?: readonly InboxChannelViewModel[]
  readonly selectedChannelId?: string
  readonly channelLead?: {
    readonly name: string
    readonly roleLabel: string
    readonly avatarLabel?: string
  }
  readonly typingAuthor?: string
  readonly threads: readonly InboxThreadViewModel[]
  readonly selectedThreadId?: string
  readonly messages: readonly InboxMessageViewModel[]
  readonly replyDraft: string
  readonly sending?: boolean
}

export interface PhoneContactViewModel {
  readonly id: string
  readonly name: string
  readonly roleLabel?: string
  readonly detail?: string
  readonly initials?: string
  readonly available?: boolean
  readonly actions?: readonly {
    readonly action: string
    readonly label: string
    readonly actorField?: 'actor' | 'target' | 'from'
    readonly affordanceId?: string
    readonly costLabel?: string
    readonly available: boolean
  }[]
}

export interface PhoneCallViewModel {
  readonly id: string
  readonly contactId: string
  readonly contactName: string
  readonly timestampLabel: string
  readonly durationLabel?: string
  readonly direction: 'incoming' | 'outgoing' | 'missed'
}

export interface PhoneViewModel {
  readonly contacts: readonly PhoneContactViewModel[]
  readonly recentCalls: readonly PhoneCallViewModel[]
  readonly affordances?: readonly AffordanceViewModel[]
  readonly selectedContactId?: string
  readonly incomingCall?: {
    readonly phase: 'ringing' | 'connected' | 'missed'
    readonly contactId: string
    readonly contactName: string
    readonly roleLabel?: string
    readonly body?: string
    readonly timestampLabel?: string
  }
  readonly activeCall?: {
    readonly contactId: string
    readonly contactName: string
    readonly elapsedLabel: string
    readonly transcript?: readonly string[]
  }
}

export type FileStatus = 'new' | 'observed'

export interface FileRecordViewModel {
  readonly id: string
  readonly title: string
  readonly sourceLabel?: string
  readonly receivedLabel?: string
  readonly summary?: string
  readonly findings?: readonly string[]
  readonly status: FileStatus
  /** Every asset attached to the evidence record, in authored order. */
  readonly assets: readonly AuthorizedAssetViewModel[]
  readonly metadata?: readonly {
    readonly label: string
    readonly value: string
  }[]
}

export interface FilesViewModel {
  readonly records: readonly FileRecordViewModel[]
  readonly affordances: readonly AffordanceViewModel[]
  readonly selectedRecordId?: string
}

export interface WebResultViewModel {
  readonly id: string
  readonly title: string
  readonly displayUrl: string
  readonly excerpt: string
  readonly sourceLabel?: string
  readonly saved?: boolean
}

export interface WebPageViewModel {
  readonly id: string
  readonly title: string
  readonly displayUrl: string
  readonly byline?: string
  readonly paragraphs: readonly string[]
}

export interface WebResearchViewModel {
  readonly query: string
  readonly results: readonly WebResultViewModel[]
  readonly affordances: readonly AffordanceViewModel[]
  readonly activePage?: WebPageViewModel
  readonly searching?: boolean
}

export interface EvidenceRailItemViewModel {
  readonly id: string
  readonly label: string
  readonly sourceLabel?: string
  readonly observed: boolean
  readonly assetKind?: AssetKind
}

export interface QuestionViewModel {
  readonly id: string
  readonly text: string
  readonly status: 'open' | 'answered'
  readonly detail?: string
}

export interface EvidenceQuestionsViewModel {
  readonly evidence: readonly EvidenceRailItemViewModel[]
  readonly questions: readonly QuestionViewModel[]
  readonly selectedEvidenceId?: string
  readonly selectedQuestionId?: string
}
