export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }
export type JsonRecord = { [key: string]: JsonValue }

export interface SourceLocation {
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

export type DiagnosticSeverity = 'error' | 'warning'

export interface CompilerDiagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  path: string
  location?: SourceLocation
}

export interface CapabilityLock {
  id: string
  version: number
  specifier: string
  digest: string
}

export interface CompiledObservation {
  id: string
  evidenceId: string
  field: string
  value: JsonValue
}

export type AssetKind = 'image' | 'audio' | 'video' | 'document' | 'file'
export type AssetVisibility = 'public' | 'private'

export type CompiledAssetSource =
  | { kind: 'local'; path: string }
  | { kind: 'https'; url: string }
  | { kind: 'provider'; provider: string; ref: string }

/**
 * A player-safe asset reference. Delivery is deliberately resolved by the
 * host; this object never contains a filesystem path, third-party key or URL.
 */
export interface AssetHandle {
  id: string
  kind: AssetKind
  mimeType: string
}

/** Trusted package metadata. Only `handle` may cross the runtime boundary. */
export interface CompiledAsset {
  id: string
  kind: AssetKind
  mimeType: string
  visibility: AssetVisibility
  source: CompiledAssetSource
  integrity: {
    algorithm: 'sha256'
    digest: string
  }
  handle: AssetHandle
}

export interface CompiledEvidence {
  id: string
  tool: string
  presentation?: {
    title: LocalizedText
    description?: LocalizedText
    findings: Record<string, LocalizedText>
  }
  availability:
    | { kind: 'opening' }
    | { kind: 'unlock'; condition: UnlockExpression }
  expiresWith?: string
  assetIds: string[]
  observations: CompiledObservation[]
  privateAnnotations?: {
    omits?: JsonValue
    reliability?: JsonValue
  }
}

/** Closed, runtime-ready unlock language. No capability or template lookup is required. */
export type UnlockExpression =
  | { kind: 'all'; conditions: UnlockExpression[] }
  | { kind: 'any'; conditions: UnlockExpression[] }
  | { kind: 'event'; eventType: string }
  | { kind: 'trust'; actorId: string; minimum: number }
  | { kind: 'supported'; deductionId: string }
  | { kind: 'observed'; ref: string }
  | CompiledAction

export interface CompiledAction {
  kind: 'action'
  verb: string
  target?: string
  actor?: string
  from?: string
  topic?: string
  evidence?: string
  tone?: string
  query?: string
  ref?: string
}

/**
 * An author-declared player-safe command surface. Affordances are kept in the
 * trusted IR and enter the public projection only while their runtime slot is
 * offered; they are never inferred from private unlock or reaction rules.
 */
export interface CompiledAffordance {
  id: string
  label: LocalizedText
  result?: LocalizedText
  risk: 'normal' | 'consequential' | 'terminal'
  confirmation?: LocalizedText
  surface: 'phone' | 'web' | 'files' | 'casebook' | 'inbox'
  initial: 'offered' | 'withdrawn'
  intent:
    | { kind: 'action'; action: CompiledAction }
    | { kind: 'deduce'; deductionId: string }
  /** Whether alternate commands in the same routed action family are denied. */
  exclusive: boolean
  interaction?: {
    kind: 'async-message'
    channel: string
    request: LocalizedText
    context?:
      | { kind: 'opening-call' }
      | { kind: 'evidence'; ref: string }
      | { kind: 'completed-affordance'; ref: string }
  }
  cost?: {
    clock: 'case-time'
    milliseconds: number
  }
  once: boolean
}

export type DeadlineTiming =
  | { kind: 'relative'; authoredAfter: string; afterMinutes: number }
  | {
      kind: 'absolute-case-time'
      authoredAt: string
      dueAtMinute: number
      afterMinutes: number
    }

export interface CompiledDeadline {
  id: string
  label?: LocalizedText
  clock: 'wall' | 'case-time'
  /** Normalized delay from case start; retained for a small runtime interface. */
  afterMinutes: number
  timing: DeadlineTiming
  offline: 'on-resume-once' | 'pause' | 'continue'
  cancelOn?: string
  effects: CompiledEffect[]
}

export interface CompiledDeduction {
  id: string
  conclusion: JsonRecord
  proofAlternatives: CompiledProofAlternative[]
  requiredDeductions: string[]
}

export type CompiledProofTerm =
  | { kind: 'observation'; ref: string }
  | { kind: 'deduction'; deductionId: string }

export type PrimitiveDeductionCheck =
  | { kind: 'equals'; ref: string; value: JsonValue }
  | { kind: 'notEquals'; ref: string; value: JsonValue }
  | { kind: 'numberLessThan'; ref: string; value: number }
  | { kind: 'numberGreaterThan'; ref: string; value: number }
  | { kind: 'arrayContains'; ref: string; value: JsonValue }
  | { kind: 'arrayCountEquals'; ref: string; count: number }
  | {
      kind: 'timeOffsetEquals'
      shownRef: string
      offsetRef: string
      expected: string
    }
  | { kind: 'beforeValue'; leftRef: string; rightValue: string }
  | { kind: 'beforeRef'; leftRef: string; rightRef: string }
  | { kind: 'afterValue'; leftRef: string; rightValue: string }
  | { kind: 'afterRef'; leftRef: string; rightRef: string }

export interface CompiledProofAlternative {
  terms: CompiledProofTerm[]
  checks: PrimitiveDeductionCheck[]
}

export type ConditionExpression =
  | { kind: 'all'; conditions: ConditionExpression[] }
  | { kind: 'any'; conditions: ConditionExpression[] }
  | { kind: 'not'; condition: ConditionExpression }
  | { kind: 'observed'; ref: string }
  | { kind: 'supported'; deductionId: string }
  | { kind: 'flag'; flagId: string; value: boolean }
  | { kind: 'schedule'; scheduleId: string; active: boolean }

export type ReactionTrigger =
  | CompiledAction
  | { kind: 'deduction-supported'; deductionId: string }
  | { kind: 'observation-observed'; observationId: string }
  | { kind: 'event'; eventType: string }

export type CompiledEffect =
  | { kind: 'trust'; actorId: string; delta: number }
  | { kind: 'flag'; flagId: string; value: boolean }
  | { kind: 'evidence'; evidenceId: string; operation: 'grant' | 'revoke' }
  | { kind: 'reroute'; evidenceId: string; provider: string }
  | { kind: 'clock-spend'; clock: 'wall' | 'active' | 'case-time'; minutes: number }
  | { kind: 'schedule-cancel'; scheduleId: string }
  | { kind: 'schedule-shift'; scheduleId: string; earlierByMinutes: number }
  | { kind: 'event-emit'; eventType: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'metric-adjust'; metric: string; entityId: string; delta: number }
  | { kind: 'conversation'; actorId: string; stateId: string }
  | { kind: 'contact'; actorId: string; state: 'hidden' | 'listed' }
  | { kind: 'affordance'; affordanceId: string; operation: 'offer' | 'withdraw' }
  | { kind: 'conditional'; condition: ConditionExpression; effects: CompiledEffect[] }

export interface CompiledReaction {
  id: string
  priority: number
  trigger: ReactionTrigger
  when?: ConditionExpression
  unless?: ConditionExpression
  once: boolean
  effects: CompiledEffect[]
}

export interface CompiledActorConversation {
  actorId: string
  public: boolean
  contactInitial: 'hidden' | 'listed'
  presentation: {
    name?: LocalizedText
    displayName?: LocalizedText
    role?: LocalizedText
    status?: LocalizedText
    phone?: string
    operator?: string
    contactSource?: LocalizedText
    pronouns?: LocalizedText
    client?: boolean
  }
  initialStateId: string
  states: Array<{
    id: string
    canTalk: boolean
    reason?: LocalizedText
  }>
  /** Action verb -> CaseAction field that carries the actor ID. */
  channels: Record<string, 'actor' | 'target' | 'from'>
  allowWhileUnavailable: string[]
}

export interface CompiledObjective {
  id: string
  condition: ConditionExpression
}

export interface CompiledAssessmentCriterion {
  id: string
  points: number
  when: ConditionExpression
  met: LocalizedText
  missed: LocalizedText
}

export interface CompiledAssessmentCategory {
  id: string
  label: LocalizedText
  criteria: CompiledAssessmentCriterion[]
}

export interface CompiledAssessmentBand {
  minScore: number
  label: LocalizedText
}

export interface CompiledAssessment {
  maxScore: number
  bands: CompiledAssessmentBand[]
  categories: CompiledAssessmentCategory[]
}

export interface CompiledOutcome {
  id: string
  title: LocalizedText
  body?: LocalizedText
  priority: number
  requiredObjectives: string[]
  excludedObjectives: string[]
  finalTargets: string[]
  whenFlag?: string
  whenAnyFlags: string[]
}

export interface LocalizedTextReference {
  /** Stable presentation handle. Catalog copy is deliberately external to IR. */
  $text: string
}

export type LocalizedText = string | LocalizedTextReference

export interface CaseIdentity {
  id: string
  version: string
  title: LocalizedText
  locale: string
  durationMinutes: number
  mode: 'elastic' | 'strict'
  finalConclusion: 'first-write-wins' | 'replaceable'
  synopsis: LocalizedText
  time: {
    date: string
    timezone: string
    startsAt: string
    startMinute: number
  }
}

export interface CompiledLocalization {
  defaultLocale: string
  /** JSON Pointer -> translation key. Values are presentation metadata only. */
  references: JsonRecord
}

export interface IntegrityBlock {
  algorithm: 'sha256'
  source: string
  capabilities: string
  assets: string
  privateIr: string
}

/**
 * Canonical, private build artifact. It is trusted engine input and must never
 * be shipped wholesale to a player client.
 */
export interface CompiledCaseIR {
  schema: 'case-ir/v0.2'
  case: CaseIdentity
  localization: CompiledLocalization
  capabilityLocks: CapabilityLock[]
  authoring: JsonRecord
  assets: CompiledAsset[]
  entities: {
    cast: JsonRecord
    places: JsonRecord
    things: JsonRecord
  }
  opening: JsonRecord
  evidence: CompiledEvidence[]
  observations: CompiledObservation[]
  deductions: CompiledDeduction[]
  /** Player-safe definitions, projected only when their runtime state is offered. */
  affordances: CompiledAffordance[]
  private: {
    truth: JsonRecord
    perspectives: JsonRecord
    reactions: CompiledReaction[]
    conversations: CompiledActorConversation[]
    flags: string[]
    deadlines: CompiledDeadline[]
    objectives: CompiledObjective[]
    outcomes: CompiledOutcome[]
    assessment?: CompiledAssessment
  }
  integrity: IntegrityBlock
}

export interface PublicEvidence {
  id: string
  tool: string
  assets: AssetHandle[]
}

/** Player-safe bootstrap data. No unlock graph, truth, perspectives or endings. */
export interface PublicCaseManifest {
  schema: 'case-public/v0.2'
  case: CaseIdentity
  cast: JsonRecord
  /** Player-safe place labels keyed by stable mechanical place ID. */
  places: JsonRecord
  /** Safe handles reachable from opening evidence only. */
  assets: AssetHandle[]
  opening: {
    call: JsonRecord
    evidence: PublicEvidence[]
  }
  integrity: {
    algorithm: 'sha256'
    assets: string
    manifest: string
  }
}

export interface CompileOptions {
  fileName?: string
  /**
   * A package-verified, already-fallback-resolved catalog. The compiler never
   * reads translation files or performs locale negotiation itself.
   */
  localization?: {
    defaultLocale: string
    availableKeys: ReadonlySet<string>
  }
}

export interface CaseSourceLocalizationInspection {
  caseId?: string
  caseVersion?: string
  defaultLocale?: string
  referenceKeys: string[]
}

export interface CompileResult {
  ok: boolean
  diagnostics: CompilerDiagnostic[]
  ir?: CompiledCaseIR
  publicManifest?: PublicCaseManifest
  canonicalIrJson?: string
  canonicalPublicManifestJson?: string
}
