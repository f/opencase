export const FORENSICS_WORKFLOW_SCHEMA = 'dedektif-forensics-workflow/v1' as const
export const FORENSICS_THREAD_ID = 'forensics' as const
export const FORENSICS_LEAD_NAME = 'Ece Aydın' as const
export const FORENSICS_LEAD_ROLE = 'İç ekip · Adli inceleme lideri' as const

export const FORENSICS_TYPING_DELAY_MS = 1_250
export const FORENSICS_WORD_DELAY_MS = 105
export const FORENSICS_WORD_START_DELAY_MS = 620

const MAX_REQUESTS = 24
const MAX_ID_LENGTH = 256
const MAX_TITLE_LENGTH = 500
const MAX_BODY_LENGTH = 12_000

export type ForensicsRequestStatus = 'waiting' | 'complete' | 'failed'

interface ForensicsRequestBase {
  readonly id: string
  readonly requestedAtWallMs: number
  readonly requestedAtCaseMs: number
  readonly requestedLabel: string
  readonly status: ForensicsRequestStatus
  readonly replyBody?: string
  readonly replyLabel?: string
}

export interface EvidenceForensicsRequestRecord extends ForensicsRequestBase {
  readonly kind: 'evidence-review'
  readonly evidenceId: string
  readonly evidenceTitle: string
}

/**
 * Presentation state for a case-authored asynchronous inbox interaction.
 *
 * The affordance id is deliberately opaque to the shell. The runtime remains
 * the only authority that can accept the action and reveal a contact. A
 * completed runtime affordance carries the exact public contact delta used to
 * reconcile an interrupted animation after a reload.
 */
export interface AsyncForensicsRequestRecord extends ForensicsRequestBase {
  readonly kind: 'async-interaction'
  readonly affordanceId: string
  readonly subjectLabel: string
  readonly requestBody: string
  readonly revealedActorId?: string
  readonly revealedActorName?: string
}

export type ForensicsRequestRecord =
  | EvidenceForensicsRequestRecord
  | AsyncForensicsRequestRecord

export interface ForensicsWorkflowState {
  readonly schema: typeof FORENSICS_WORKFLOW_SCHEMA
  readonly requests: readonly ForensicsRequestRecord[]
}

export const EMPTY_FORENSICS_WORKFLOW: ForensicsWorkflowState = Object.freeze({
  schema: FORENSICS_WORKFLOW_SCHEMA,
  requests: Object.freeze([]),
})

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
}

function parseRequest(value: unknown): ForensicsRequestRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (!isBoundedString(candidate.id, MAX_ID_LENGTH)) return undefined
  if (!isBoundedString(candidate.requestedLabel, 32)) return undefined
  if (
    typeof candidate.requestedAtWallMs !== 'number'
    || !Number.isFinite(candidate.requestedAtWallMs)
    || candidate.requestedAtWallMs < 0
    || typeof candidate.requestedAtCaseMs !== 'number'
    || !Number.isFinite(candidate.requestedAtCaseMs)
    || candidate.requestedAtCaseMs < 0
  ) return undefined
  if (!['waiting', 'complete', 'failed'].includes(String(candidate.status))) return undefined
  if (candidate.replyBody !== undefined && !isBoundedString(candidate.replyBody, MAX_BODY_LENGTH)) {
    return undefined
  }
  if (candidate.replyLabel !== undefined && !isBoundedString(candidate.replyLabel, 32)) {
    return undefined
  }
  if (candidate.status === 'waiting' && (candidate.replyBody !== undefined || candidate.replyLabel !== undefined)) {
    return undefined
  }
  if (candidate.status !== 'waiting' && candidate.replyBody === undefined) return undefined

  const common = {
    id: candidate.id,
    requestedAtWallMs: candidate.requestedAtWallMs,
    requestedAtCaseMs: candidate.requestedAtCaseMs,
    requestedLabel: candidate.requestedLabel,
    status: candidate.status as ForensicsRequestStatus,
    ...(candidate.replyBody ? { replyBody: candidate.replyBody } : {}),
    ...(candidate.replyLabel ? { replyLabel: candidate.replyLabel } : {}),
  }

  // Requests written before async interactions existed did not carry `kind`.
  if (candidate.kind === undefined || candidate.kind === 'evidence-review') {
    if (!isBoundedString(candidate.evidenceId, MAX_ID_LENGTH)) return undefined
    if (!isBoundedString(candidate.evidenceTitle, MAX_TITLE_LENGTH)) return undefined
    return {
      ...common,
      kind: 'evidence-review',
      evidenceId: candidate.evidenceId,
      evidenceTitle: candidate.evidenceTitle,
    }
  }

  if (candidate.kind !== 'async-interaction') return undefined
  if (!isBoundedString(candidate.affordanceId, MAX_ID_LENGTH)) return undefined
  if (!isBoundedString(candidate.subjectLabel, MAX_TITLE_LENGTH)) return undefined
  if (!isBoundedString(candidate.requestBody, MAX_BODY_LENGTH)) return undefined
  if (
    candidate.revealedActorId !== undefined
    && !isBoundedString(candidate.revealedActorId, MAX_ID_LENGTH)
  ) return undefined
  if (
    candidate.revealedActorName !== undefined
    && !isBoundedString(candidate.revealedActorName, MAX_TITLE_LENGTH)
  ) return undefined
  if ((candidate.revealedActorId === undefined) !== (candidate.revealedActorName === undefined)) {
    return undefined
  }
  return {
    ...common,
    kind: 'async-interaction',
    affordanceId: candidate.affordanceId,
    subjectLabel: candidate.subjectLabel,
    requestBody: candidate.requestBody,
    ...(candidate.revealedActorId ? { revealedActorId: candidate.revealedActorId } : {}),
    ...(candidate.revealedActorName ? { revealedActorName: candidate.revealedActorName } : {}),
  }
}

export function parseForensicsWorkflow(value: unknown): ForensicsWorkflowState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_FORENSICS_WORKFLOW
  const candidate = value as Record<string, unknown>
  if (candidate.schema !== FORENSICS_WORKFLOW_SCHEMA || !Array.isArray(candidate.requests)) {
    return EMPTY_FORENSICS_WORKFLOW
  }

  const requests = candidate.requests
    .slice(-MAX_REQUESTS)
    .map(parseRequest)
    .filter((request): request is ForensicsRequestRecord => request !== undefined)

  return { schema: FORENSICS_WORKFLOW_SCHEMA, requests }
}

export function readForensicsWorkflow(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
): ForensicsWorkflowState {
  if (!storage) return EMPTY_FORENSICS_WORKFLOW
  try {
    const serialized = storage.getItem(key)
    return serialized ? parseForensicsWorkflow(JSON.parse(serialized) as unknown) : EMPTY_FORENSICS_WORKFLOW
  } catch {
    return EMPTY_FORENSICS_WORKFLOW
  }
}

export function writeForensicsWorkflow(
  storage: Pick<Storage, 'setItem'> | undefined,
  key: string,
  state: ForensicsWorkflowState,
): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(parseForensicsWorkflow(state)))
  } catch {
    // Chat history is a presentation convenience; the engine save remains authoritative.
  }
}

export function clearForensicsWorkflow(
  storage: Pick<Storage, 'removeItem'> | undefined,
  key: string,
): void {
  try {
    storage?.removeItem(key)
  } catch {
    // A blocked storage backend must not prevent a case restart.
  }
}

export function createForensicsRequest(input: {
  readonly evidenceId: string
  readonly evidenceTitle: string
  readonly requestedAtWallMs: number
  readonly requestedAtCaseMs: number
  readonly requestedLabel: string
}): EvidenceForensicsRequestRecord {
  return {
    id: `${input.requestedAtWallMs}:${input.evidenceId}`,
    kind: 'evidence-review',
    evidenceId: input.evidenceId,
    evidenceTitle: input.evidenceTitle,
    requestedAtWallMs: input.requestedAtWallMs,
    requestedAtCaseMs: input.requestedAtCaseMs,
    requestedLabel: input.requestedLabel,
    status: 'waiting',
  }
}

export function createAsyncForensicsRequest(input: {
  readonly affordanceId: string
  readonly subjectLabel: string
  readonly requestBody: string
  readonly requestedAtWallMs: number
  readonly requestedAtCaseMs: number
  readonly requestedLabel: string
}): AsyncForensicsRequestRecord {
  return {
    id: `${input.requestedAtWallMs}:${input.affordanceId}`,
    kind: 'async-interaction',
    affordanceId: input.affordanceId,
    subjectLabel: input.subjectLabel,
    requestBody: input.requestBody,
    requestedAtWallMs: input.requestedAtWallMs,
    requestedAtCaseMs: input.requestedAtCaseMs,
    requestedLabel: input.requestedLabel,
    status: 'waiting',
  }
}

export function appendForensicsRequest(
  state: ForensicsWorkflowState,
  request: ForensicsRequestRecord,
): ForensicsWorkflowState {
  const duplicate = state.requests.find((candidate) => (
    candidate.kind === request.kind
    && candidate.status === 'waiting'
    && (
      candidate.kind === 'evidence-review' && request.kind === 'evidence-review'
        ? candidate.evidenceId === request.evidenceId
        : candidate.kind === 'async-interaction' && request.kind === 'async-interaction'
          ? candidate.affordanceId === request.affordanceId
          : false
    )
  ))
  if (duplicate) return state
  return {
    schema: FORENSICS_WORKFLOW_SCHEMA,
    requests: [...state.requests, request].slice(-MAX_REQUESTS),
  }
}

export function updateForensicsRequest(
  state: ForensicsWorkflowState,
  requestId: string,
  update: (request: ForensicsRequestRecord) => ForensicsRequestRecord,
): ForensicsWorkflowState {
  let changed = false
  const requests = state.requests.map((request) => {
    if (request.id !== requestId) return request
    const next = update(request)
    changed ||= next !== request
    return next
  })
  return changed ? { schema: FORENSICS_WORKFLOW_SCHEMA, requests } : state
}

export function forensicsReplyDurationMs(body: string): number {
  const words = body.trim().split(/\s+/u).filter(Boolean).length
  return FORENSICS_WORD_START_DELAY_MS + Math.max(1, words) * FORENSICS_WORD_DELAY_MS + 180
}
