import Ajv, { type ErrorObject } from 'ajv'
import { isIP } from 'node:net'
import {
  LineCounter,
  parseDocument,
  type Document,
  type Node as YamlNode,
} from 'yaml'

import {
  capabilityVocabulary,
  getCapabilityManifest,
  type CapabilityManifest,
  type CapabilityVocabulary,
} from '../capabilities'
import caseSourceSchema from '../../schema/case-source.v0.1.schema.json'
import {
  canonicalJson,
  canonicalize,
  compareCanonicalStrings,
  hashCanonical,
  sha256,
} from './canonical'
import type {
  AssetHandle,
  AssetKind,
  CapabilityLock,
  CompileOptions,
  CompileResult,
  CompiledAssessment,
  CompiledAffordance,
  CompiledCaseIR,
  CompiledAction,
  CompiledActorConversation,
  CompiledAsset,
  CompiledDeadline,
  CompiledDeduction,
  CompiledEvidence,
  CompiledEffect,
  CompiledObjective,
  CompiledObservation,
  CompiledOutcome,
  CompiledProofAlternative,
  CompiledProofTerm,
  CompiledReaction,
  ConditionExpression,
  CompilerDiagnostic,
  JsonRecord,
  JsonValue,
  LocalizedText,
  PublicCaseManifest,
  PrimitiveDeductionCheck,
  ReactionTrigger,
  SourceLocation,
  UnlockExpression,
  CaseSourceLocalizationInspection,
} from './types'

type AnyRecord = Record<string, unknown>
type Path = Array<string | number>

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'capabilityLocks',
  'assessment',
  'truth',
  'perspectives',
  'conversations',
  'reactions',
  'objectives',
  'outcomes',
  'tests',
  'unlock',
  'availability',
  'reliability',
  'omits',
  'intent',
  'conclusion',
  'deductions',
  'deadlines',
  'observations',
  'reports',
  'proofAlternatives',
  'requiredDeductions',
  'value',
  'source',
  'path',
  'url',
  'provider',
  'ref',
])

const PUBLIC_CAST_FIELDS = new Set([
  'name',
  'role',
  'status',
  'client',
  'display_name',
  'pronouns',
])

const PUBLIC_PLACE_FIELDS = new Set(['name', 'display_name'])

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true })
const validateSchema = ajv.compile(caseSourceSchema)

class DiagnosticCollector {
  readonly diagnostics: CompilerDiagnostic[] = []

  constructor(
    private readonly document: Document.Parsed,
    private readonly lineCounter: LineCounter,
    private readonly file: string,
  ) {}

  error(code: string, message: string, path: Path = []): void {
    this.diagnostics.push({
      code,
      severity: 'error',
      message,
      path: toPointer(path),
      location: this.location(path),
    })
  }

  warning(code: string, message: string, path: Path = []): void {
    this.diagnostics.push({
      code,
      severity: 'warning',
      message,
      path: toPointer(path),
      location: this.location(path),
    })
  }

  private location(path: Path): SourceLocation | undefined {
    let node: YamlNode | null | undefined
    try {
      node = this.document.getIn(path, true) as YamlNode | null | undefined
      if (!node && path.length > 0) {
        node = this.document.getIn(path.slice(0, -1), true) as YamlNode | null | undefined
      }
    } catch {
      node = this.document.contents as YamlNode | null
    }

    const range = node?.range
    if (!range) return undefined
    const start = this.lineCounter.linePos(range[0])
    const end = this.lineCounter.linePos(range[1])
    return {
      file: this.file,
      line: start.line,
      column: start.col,
      endLine: end.line,
      endColumn: end.col,
    }
  }
}

function isRecord(value: unknown): value is AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toJson(value: unknown): JsonValue {
  return canonicalize(value) as JsonValue
}

function toRecord(value: unknown): JsonRecord {
  return (isRecord(value) ? canonicalize(value) : {}) as JsonRecord
}

function localizedText(value: unknown): LocalizedText {
  return isRecord(value) && typeof value.$text === 'string'
    ? { $text: value.$text }
    : String(value)
}

function isLocalizedTextReference(value: unknown): value is { $text: string } {
  return isRecord(value) && Object.keys(value).length === 1 && typeof value.$text === 'string'
}

/**
 * Cast entries are authored in the trusted case source, so projecting the
 * mapping wholesale would make any future private annotation client-visible.
 * Protected/private people are omitted and public people are reduced to a
 * deliberately small presentation allow-list.
 */
function buildPublicCast(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  const result: Record<string, JsonValue> = {}
  for (const [id, entry] of Object.entries(value).sort(([left], [right]) =>
    compareCanonicalStrings(left, right),
  )) {
    if (typeof entry === 'string') {
      result[id] = entry
      continue
    }
    if (!isRecord(entry)) continue
    if (
      entry.protected === true ||
      entry.hidden === true ||
      entry.public === false ||
      entry.visibility === 'private' ||
      entry.visibility === 'hidden'
    ) {
      continue
    }
    const publicEntry: Record<string, JsonValue> = {}
    for (const field of [...PUBLIC_CAST_FIELDS].sort(compareCanonicalStrings)) {
      const fieldValue = entry[field]
      if (fieldValue !== undefined) publicEntry[field] = toJson(fieldValue)
    }
    result[id] = publicEntry
  }
  return canonicalize(result) as JsonRecord
}

/**
 * Places are public presentation metadata by default, but source annotations
 * are not. Preserve only the display label fields and honor the same explicit
 * visibility controls as cast entries. Stable place IDs remain the gameplay
 * representation used by truth, reports and rules.
 */
function buildPublicPlaces(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  const result: Record<string, JsonValue> = {}
  for (const [id, entry] of Object.entries(value).sort(([left], [right]) =>
    compareCanonicalStrings(left, right),
  )) {
    if (typeof entry === 'string' || isLocalizedTextReference(entry)) {
      result[id] = toJson(entry)
      continue
    }
    if (!isRecord(entry)) continue
    if (
      entry.protected === true ||
      entry.hidden === true ||
      entry.public === false ||
      entry.visibility === 'private' ||
      entry.visibility === 'hidden'
    ) {
      continue
    }
    const publicEntry: Record<string, JsonValue> = {}
    for (const field of [...PUBLIC_PLACE_FIELDS].sort(compareCanonicalStrings)) {
      const fieldValue = entry[field]
      if (fieldValue !== undefined) publicEntry[field] = toJson(fieldValue)
    }
    if (Object.keys(publicEntry).length > 0) result[id] = publicEntry
  }
  return canonicalize(result) as JsonRecord
}

const ASSET_MIME_PREFIX: Readonly<Record<AssetKind, string | undefined>> = {
  image: 'image/',
  audio: 'audio/',
  video: 'video/',
  document: undefined,
  file: undefined,
}

const DOCUMENT_MIME_TYPES = new Set([
  'application/epub+zip',
  'application/json',
  'application/msword',
  'application/pdf',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/markdown',
  'text/plain',
])

const FILE_MIME_TYPES = new Set([
  'application/json',
  'application/octet-stream',
  'application/zip',
  'text/csv',
  'text/markdown',
  'text/plain',
])

const LOCAL_EXTENSION_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  '.avif': ['image/avif'],
  '.bin': ['application/octet-stream'],
  '.csv': ['text/csv'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.epub': ['application/epub+zip'],
  '.flac': ['audio/flac'],
  '.gif': ['image/gif'],
  '.jpeg': ['image/jpeg'],
  '.jpg': ['image/jpeg'],
  '.json': ['application/json'],
  '.m4a': ['audio/mp4'],
  '.md': ['text/markdown'],
  '.mov': ['video/quicktime'],
  '.mp3': ['audio/mpeg'],
  '.mp4': ['audio/mp4', 'video/mp4'],
  '.oga': ['audio/ogg'],
  '.ogg': ['audio/ogg', 'video/ogg'],
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.rtf': ['application/rtf'],
  '.svg': ['image/svg+xml'],
  '.txt': ['text/plain'],
  '.wav': ['audio/wav', 'audio/wave', 'audio/x-wav'],
  '.webm': ['audio/webm', 'video/webm'],
  '.webp': ['image/webp'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.zip': ['application/zip'],
}

const FORBIDDEN_LOCAL_EXTENSIONS = new Set([
  '.app', '.cjs', '.command', '.dll', '.dylib', '.exe', '.htm', '.html',
  '.jar', '.js', '.jsx', '.mjs', '.php', '.pl', '.py', '.rb', '.sh', '.so',
  '.ts', '.tsx', '.wasm', '.xht', '.xhtml', '.xml',
])

function unsafeRemoteAssetHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  const unbracketed = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  return (
    isIP(unbracketed) !== 0 ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.localdomain')
  )
}

function localExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function buildAssets(source: AnyRecord): CompiledAsset[] {
  return mapEntries(source.assets).map(([id, definition]) => {
    const kind = definition.kind as AssetKind
    const mimeType = String(definition.mime_type)
    const authoredSource = definition.source as AnyRecord
    const sourceDescriptor =
      typeof authoredSource.local === 'string'
        ? { kind: 'local' as const, path: authoredSource.local }
        : typeof authoredSource.https === 'string'
          ? { kind: 'https' as const, url: authoredSource.https }
          : {
              kind: 'provider' as const,
              provider: String(authoredSource.provider),
              ref: String(authoredSource.ref),
            }
    const handle: AssetHandle = { id, kind, mimeType }
    return {
      id,
      kind,
      mimeType,
      visibility: definition.visibility as 'public' | 'private',
      source: sourceDescriptor,
      integrity: {
        algorithm: 'sha256',
        digest: String((definition.integrity as AnyRecord).sha256),
      },
      handle,
    }
  })
}

function toPointer(path: Path): string {
  if (path.length === 0) return '/'
  return `/${path
    .map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`
}

function isTranslatablePath(path: Path): boolean {
  if (path.length === 2 && path[0] === 'case') {
    return path[1] === 'title' || path[1] === 'synopsis'
  }
  if (path.length === 3 && path[0] === 'opening' && path[1] === 'call') {
    return path[2] === 'text'
  }
  if (path.length === 3 && path[0] === 'outcomes') {
    return path[2] === 'title' || path[2] === 'body'
  }
  if (path.length === 4 && path[0] === 'assessment' && path[1] === 'bands') {
    return path[3] === 'label'
  }
  if (path.length === 4 && path[0] === 'assessment' && path[1] === 'categories') {
    return path[3] === 'label'
  }
  if (
    path.length === 6 &&
    path[0] === 'assessment' &&
    path[1] === 'categories' &&
    path[3] === 'criteria'
  ) {
    return path[5] === 'met' || path[5] === 'missed'
  }
  if (path.length === 3 && path[0] === 'affordances') {
    return path[2] === 'label' || path[2] === 'result' || path[2] === 'confirmation'
  }
  if (path.length === 3 && path[0] === 'deadlines') return path[2] === 'label'
  if (path.length === 4 && path[0] === 'evidence' && path[2] === 'presentation') {
    return path[3] === 'title' || path[3] === 'description'
  }
  if (
    path.length === 5 &&
    path[0] === 'evidence' &&
    path[2] === 'presentation' &&
    path[3] === 'findings'
  ) {
    return true
  }
  if (path.length === 2 && path[0] === 'places') return true
  if (path.length === 3 && path[0] === 'places') {
    return path[2] === 'name' || path[2] === 'display_name'
  }
  if (path.length === 5 && path[0] === 'conversations' && path[2] === 'states') {
    return path[4] === 'reason'
  }
  return false
}

function collectTranslationReferences(
  value: unknown,
  path: Path = [],
  output: Array<{ path: Path; key: unknown; shapeValid: boolean }> = [],
): Array<{ path: Path; key: unknown; shapeValid: boolean }> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTranslationReferences(item, path.concat(index), output))
    return output
  }
  if (!isRecord(value)) return output
  if (Object.hasOwn(value, '$text') || Object.hasOwn(value, '$t')) {
    const key = Object.hasOwn(value, '$text') ? value.$text : value.$t
    output.push({
      path,
      key,
      shapeValid: Object.keys(value).length === 1 && typeof key === 'string',
    })
    return output
  }
  for (const [key, child] of Object.entries(value)) {
    collectTranslationReferences(child, path.concat(key), output)
  }
  return output
}

function setAtPath(root: AnyRecord, path: Path, value: unknown): void {
  let parent: unknown = root
  for (const part of path.slice(0, -1)) {
    if (Array.isArray(parent) && typeof part === 'number') parent = parent[part]
    else if (isRecord(parent)) parent = parent[String(part)]
    else return
  }
  const last = path.at(-1)
  if (last === undefined) return
  if (Array.isArray(parent) && typeof last === 'number') parent[last] = value
  else if (isRecord(parent)) parent[String(last)] = value
}

function resolveTranslationReferences(
  source: AnyRecord,
  collector: DiagnosticCollector,
  options: CompileOptions['localization'],
): JsonRecord {
  const references: Record<string, JsonValue> = {}
  for (const reference of collectTranslationReferences(source)) {
    const pointer = toPointer(reference.path)
    if (!reference.shapeValid) {
      collector.error(
        'E_I18N_REFERENCE_SHAPE',
        "A translation reference must contain exactly one string '$text' (or '$t') property.",
        reference.path,
      )
      continue
    }
    const key = String(reference.key)
    if (!isTranslatablePath(reference.path)) {
      collector.error(
        'E_I18N_REFERENCE_CONTEXT',
        `Translation reference '${key}' is not allowed in gameplay or structural data.`,
        reference.path,
      )
      continue
    }
    references[pointer] = key
    if (!options) {
      collector.error(
        'E_I18N_CATALOG_REQUIRED',
        `Translation reference '${key}' requires a package i18n catalog.`,
        reference.path,
      )
      continue
    }
    if (!options.availableKeys.has(key)) {
      collector.error(
        'E_I18N_MISSING_MESSAGE',
        `Default locale '${options.defaultLocale}' does not define translation key '${key}'.`,
        reference.path,
      )
      continue
    }
    // Normalize the short compatibility alias without materializing catalog
    // copy. The opaque key is stable gameplay input; translated copy is not.
    setAtPath(source, reference.path, { $text: key })
  }
  return canonicalize(references) as JsonRecord
}

export function inspectCaseSourceLocalization(
  sourceText: string,
): CaseSourceLocalizationInspection {
  const document = parseDocument(sourceText, {
    prettyErrors: false,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    throw new TypeError(`Invalid case YAML: ${document.errors.map(({ message }) => message).join('; ')}`)
  }
  const source = document.toJS({ maxAliasCount: 0 }) as unknown
  if (!isRecord(source)) return { referenceKeys: [] }
  const caseDefinition = isRecord(source.case) ? source.case : {}
  return {
    ...(typeof caseDefinition.id === 'string' ? { caseId: caseDefinition.id } : {}),
    ...(typeof caseDefinition.version === 'string'
      ? { caseVersion: caseDefinition.version }
      : {}),
    ...(typeof caseDefinition.locale === 'string'
      ? { defaultLocale: caseDefinition.locale }
      : {}),
    referenceKeys: [...new Set(
      collectTranslationReferences(source)
        .filter(({ shapeValid, key }) => shapeValid && typeof key === 'string')
        .map(({ key }) => String(key)),
    )].sort(compareCanonicalStrings),
  }
}

function fromPointer(pointer: string): Path {
  if (!pointer) return []
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function parseDuration(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value)
  if (!match) return Number.NaN
  const quantity = Number(match[1])
  const factor = ({ s: 1 / 60, m: 1, h: 60, d: 1440 } as Record<string, number>)[match[2]]
  return quantity * factor
}

function parseClockMinute(value: string): number {
  const [hour, minute, second = '0'] = value.split(':')
  return Number(hour) * 60 + Number(minute) + Number(second) / 60
}

function parseComparableTime(
  value: unknown,
): { kind: 'clock' | 'timestamp'; milliseconds: number } | undefined {
  if (typeof value !== 'string') return undefined
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (clock) {
    const hours = Number(clock[1])
    const minutes = Number(clock[2])
    const seconds = Number(clock[3] ?? '0')
    if (hours > 23 || minutes > 59 || seconds > 59) return undefined
    return {
      kind: 'clock',
      milliseconds: ((hours * 60 + minutes) * 60 + seconds) * 1000,
    }
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? { kind: 'timestamp', milliseconds: timestamp }
    : undefined
}

function jsonValueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value === 'object' ? 'object' : typeof value
}

function schemaPath(error: ErrorObject): Path {
  const path = fromPointer(error.instancePath)
  if (error.keyword === 'required') {
    path.push(String(error.params.missingProperty))
  } else if (error.keyword === 'additionalProperties') {
    path.push(String(error.params.additionalProperty))
  }
  return path
}

function schemaMessage(error: ErrorObject): string {
  const at = toPointer(schemaPath(error))
  return `${at} ${error.message ?? 'is invalid'}`
}

function resolveCapabilities(
  specifiers: string[],
  collector: DiagnosticCollector,
): CapabilityManifest[] {
  const manifests: CapabilityManifest[] = []
  for (const [index, specifier] of specifiers.entries()) {
    const manifest = getCapabilityManifest(specifier)
    if (!manifest) {
      collector.error(
        'E_UNKNOWN_CAPABILITY',
        `Unknown capability or profile specifier '${specifier}'.`,
        ['use', index],
      )
      continue
    }
    manifests.push(manifest)
  }
  return manifests.sort((left, right) =>
    compareCanonicalStrings(left.specifier, right.specifier),
  )
}

function makeCapabilityLocks(manifests: CapabilityManifest[]): CapabilityLock[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    version: manifest.version,
    specifier: manifest.specifier,
    digest: manifest.digest,
  }))
}

function mapEntries(value: unknown): Array<[string, AnyRecord]> {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .filter((entry): entry is [string, AnyRecord] => isRecord(entry[1]))
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringOrList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return stringList(value)
}

const ACTION_ARGUMENT_FIELDS = [
  'target',
  'actor',
  'from',
  'topic',
  'evidence',
  'tone',
  'query',
  'ref',
] as const

function normalizeVerb(verb: string): string {
  return verb === 'submit' ? 'submit-conclusion' : verb
}

function compileAction(verb: string, value: AnyRecord): CompiledAction {
  const action: CompiledAction = { kind: 'action', verb: normalizeVerb(verb) }
  for (const field of ACTION_ARGUMENT_FIELDS) {
    if (typeof value[field] === 'string') action[field] = value[field] as never
  }
  return action
}

function compileUnlock(value: unknown): UnlockExpression {
  if (typeof value === 'string') return { kind: 'event', eventType: value }
  if (!isRecord(value)) {
    throw new TypeError('Unlock expression must be validated before compilation.')
  }
  if (Array.isArray(value.any)) {
    return { kind: 'any', conditions: value.any.map(compileUnlock) }
  }
  if (Array.isArray(value.all)) {
    return { kind: 'all', conditions: value.all.map(compileUnlock) }
  }
  if (Array.isArray(value.trust)) {
    return {
      kind: 'trust',
      actorId: String(value.trust[0]),
      minimum: Number(value.trust[1]),
    }
  }
  if (typeof value.search === 'string') {
    return compileAction('search', { query: value.search })
  }
  if (typeof value.request === 'string') {
    return compileAction('request', { topic: value.request })
  }
  const after = String(value.after)
  if (after === 'supported') {
    return { kind: 'supported', deductionId: String(value.ref) }
  }
  if (after === 'observe') {
    return { kind: 'observed', ref: String(value.ref) }
  }
  return compileAction(after, value)
}

function buildEvidence(source: AnyRecord): {
  evidence: CompiledEvidence[]
  observations: CompiledObservation[]
} {
  const evidence: CompiledEvidence[] = []
  const observations: CompiledObservation[] = []

  for (const [id, definition] of mapEntries(source.evidence)) {
    const evidenceObservations = Object.entries(isRecord(definition.reports) ? definition.reports : {})
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([field, value]): CompiledObservation => ({
        id: `${id}.${field}`,
        evidenceId: id,
        field,
        value: toJson(value),
      }))

    observations.push(...evidenceObservations)
    const compiled: CompiledEvidence = {
      id,
      tool: String(definition.tool),
      ...(isRecord(definition.presentation) ? {
        presentation: {
          title: localizedText(definition.presentation.title),
          ...(definition.presentation.description !== undefined
            ? { description: localizedText(definition.presentation.description) }
            : {}),
          findings: Object.fromEntries(
            Object.entries(isRecord(definition.presentation.findings)
              ? definition.presentation.findings
              : {})
              .sort(([left], [right]) => compareCanonicalStrings(left, right))
              .map(([field, text]) => [field, localizedText(text)]),
          ),
        },
      } : {}),
      availability:
        definition.at === 'start'
          ? { kind: 'opening' }
          : { kind: 'unlock', condition: compileUnlock(definition.unlock) },
      assetIds: stringList(definition.assets).sort(compareCanonicalStrings),
      observations: evidenceObservations,
    }

    if (typeof definition.expires_with === 'string') compiled.expiresWith = definition.expires_with
    if (definition.omits !== undefined || definition.reliability !== undefined) {
      compiled.privateAnnotations = {}
      if (definition.omits !== undefined) compiled.privateAnnotations.omits = toJson(definition.omits)
      if (definition.reliability !== undefined) {
        compiled.privateAnnotations.reliability = toJson(definition.reliability)
      }
    }
    evidence.push(compiled)
  }

  return { evidence, observations }
}

const TEMPLATE_BINDING_KEYS: Readonly<Record<string, readonly string[]>> = {
  'safety.intentional-disable-and-command': [
    'failure',
    'damage',
    'command',
    'victim_positioned',
  ],
  'media.timestamp-offset': ['shown', 'offset'],
}

function observationSourceValue(source: AnyRecord, reference: unknown): unknown {
  if (typeof reference !== 'string') return undefined
  const dot = reference.indexOf('.')
  if (dot < 1) return undefined
  const evidenceId = reference.slice(0, dot)
  const field = reference.slice(dot + 1)
  const evidence = isRecord(source.evidence) ? source.evidence[evidenceId] : undefined
  const reports = isRecord(evidence) && isRecord(evidence.reports) ? evidence.reports : undefined
  return reports?.[field]
}

interface AuthoredProofAlternative {
  terms: string[]
  checks: AnyRecord[]
}

function authoredProofAlternatives(definition: AnyRecord): AuthoredProofAlternative[] {
  const prove = isRecord(definition.prove) ? definition.prove : undefined
  if (!Array.isArray(prove?.any)) return []
  return prove.any.flatMap((candidate): AuthoredProofAlternative[] => {
    if (Array.isArray(candidate)) {
      return [{ terms: stringList(candidate), checks: [] }]
    }
    if (isRecord(candidate)) {
      return [{
        terms: stringList(candidate.terms),
        checks: Array.isArray(candidate.checks) ? candidate.checks.filter(isRecord) : [],
      }]
    }
    return []
  })
}

function compileAuthoredProofCheck(check: AnyRecord): PrimitiveDeductionCheck {
  const ref = String(check.ref)
  if (Object.hasOwn(check, 'equals')) {
    return { kind: 'equals', ref, value: toJson(check.equals) }
  }
  if (Object.hasOwn(check, 'not_equals')) {
    return { kind: 'notEquals', ref, value: toJson(check.not_equals) }
  }
  if (Object.hasOwn(check, 'less_than')) {
    return { kind: 'numberLessThan', ref, value: Number(check.less_than) }
  }
  if (Object.hasOwn(check, 'greater_than')) {
    return { kind: 'numberGreaterThan', ref, value: Number(check.greater_than) }
  }
  if (Object.hasOwn(check, 'contains')) {
    return { kind: 'arrayContains', ref, value: toJson(check.contains) }
  }
  if (Object.hasOwn(check, 'count')) {
    return { kind: 'arrayCountEquals', ref, count: Number(check.count) }
  }
  const operand = isRecord(check.before) ? check.before : isRecord(check.after) ? check.after : {}
  const isBefore = isRecord(check.before)
  if (typeof operand.ref === 'string') {
    return isBefore
      ? { kind: 'beforeRef', leftRef: ref, rightRef: operand.ref }
      : { kind: 'afterRef', leftRef: ref, rightRef: operand.ref }
  }
  return isBefore
    ? { kind: 'beforeValue', leftRef: ref, rightValue: String(operand.value) }
    : { kind: 'afterValue', leftRef: ref, rightValue: String(operand.value) }
}

function parseSignedDuration(value: string): number {
  const match = /^([+-])(\d+)(s|m|h)$/.exec(value)
  if (!match) return Number.NaN
  const magnitude = parseDuration(`${match[2]}${match[3]}`)
  return match[1] === '-' ? -magnitude : magnitude
}

function validateTemplateExpansions(
  source: AnyRecord,
  collector: DiagnosticCollector,
): void {
  for (const [deductionId, definition] of mapEntries(source.deductions)) {
    if (typeof definition.use !== 'string') continue
    const template = definition.use
    const base: Path = ['deductions', deductionId]
    const bindings = isRecord(definition.with) ? definition.with : {}
    const alternatives = authoredProofAlternatives(definition).map(({ terms }) => terms)

    for (const key of TEMPLATE_BINDING_KEYS[template] ?? []) {
      if (typeof bindings[key] !== 'string') {
        collector.error(
          'E_TEMPLATE_BINDING',
          `Template '${template}' requires observation binding '${key}'.`,
          base.concat('with', key),
        )
      }
    }

    if (template === 'safety.intentional-disable-and-command') {
      if (definition.conclude && isRecord(definition.conclude)) {
        if (definition.conclude.intentional !== true || typeof definition.conclude.incident !== 'string') {
          collector.error(
            'E_TEMPLATE_CONCLUSION',
            `Template '${template}' requires conclude.incident and intentional: true.`,
            base.concat('conclude'),
          )
        }
      }
      const expectedValues: Record<string, JsonValue> = {
        failure: 'safety-pin-removed',
        damage: false,
        command: 'open',
      }
      for (const [binding, expected] of Object.entries(expectedValues)) {
        const actual = observationSourceValue(source, bindings[binding])
        if (actual !== expected) {
          collector.error(
            'E_TEMPLATE_VALUE',
            `Template '${template}' requires '${binding}' to report ${JSON.stringify(expected)}.`,
            base.concat('with', binding),
          )
        }
      }
    } else if (template === 'media.prerecorded-alibi') {
      if (
        !isRecord(definition.conclude) ||
        typeof definition.conclude.actor !== 'string' ||
        typeof definition.conclude.alibi_for !== 'string' ||
        definition.conclude.valid !== false
      ) {
        collector.error(
          'E_TEMPLATE_CONCLUSION',
          `Template '${template}' requires actor, alibi_for and valid: false.`,
          base.concat('conclude'),
        )
      }
      if (alternatives.length === 0 || alternatives.some((alternative) => alternative.length < 2)) {
        collector.error(
          'E_TEMPLATE_PROOF',
          `Template '${template}' requires timestamp and delivery observations in every proof alternative.`,
          base.concat('prove'),
        )
      }
      const incidentId = isRecord(definition.conclude)
        ? definition.conclude.alibi_for
        : undefined
      const incident =
        typeof incidentId === 'string' &&
        isRecord(source.truth) &&
        isRecord(source.truth.events) &&
        isRecord(source.truth.events[incidentId])
          ? source.truth.events[incidentId]
          : undefined
      const incidentMinute =
        typeof incident?.at === 'string' ? parseClockMinute(incident.at) : Number.NaN
      for (const [alternativeIndex, alternative] of alternatives.entries()) {
        const delivery = alternative.find(
          (reference) => observationSourceValue(source, reference) === 'scheduled',
        )
        const timestamp = alternative.find((reference) => reference !== delivery)
        const timestampValue = observationSourceValue(source, timestamp)
        const timestampMinute =
          typeof timestampValue === 'string' ? parseClockMinute(timestampValue) : Number.NaN
        if (
          !delivery ||
          !timestamp ||
          !Number.isFinite(timestampMinute) ||
          !Number.isFinite(incidentMinute) ||
          timestampMinute >= incidentMinute
        ) {
          collector.error(
            'E_TEMPLATE_TIME_ARITHMETIC',
            `Template '${template}' requires each branch to prove scheduled delivery from media created before the alibi incident.`,
            base.concat('prove', 'any', alternativeIndex),
          )
        }
      }
    } else if (template === 'media.timestamp-offset') {
      const shownReference = bindings.shown
      const offsetReference = bindings.offset
      const shown = observationSourceValue(source, shownReference)
      const offset = observationSourceValue(source, offsetReference)
      const concluded = isRecord(definition.conclude) ? definition.conclude.exited_at : undefined
      const shownMinute = typeof shown === 'string' ? parseClockMinute(shown) : Number.NaN
      const offsetMinute = typeof offset === 'string' ? parseSignedDuration(offset) : Number.NaN
      const concludedMinute = typeof concluded === 'string' ? parseClockMinute(concluded) : Number.NaN
      if (
        !Number.isFinite(shownMinute) ||
        !Number.isFinite(offsetMinute) ||
        !Number.isFinite(concludedMinute)
      ) {
        collector.error(
          'E_TEMPLATE_TIME_VALUE',
          `Template '${template}' requires clock-time 'shown', signed-duration 'offset', and a clock-time conclusion.`,
          base,
        )
      } else if (Math.abs(shownMinute - offsetMinute - concludedMinute) > 1 / 120) {
        collector.error(
          'E_TEMPLATE_TIME_ARITHMETIC',
          `Timestamp correction is inconsistent: ${String(shown)} - ${String(offset)} does not equal ${String(concluded)}.`,
          base.concat('conclude', 'exited_at'),
        )
      }
      const includesBoth = alternatives.some(
        (alternative) =>
          typeof shownReference === 'string' &&
          typeof offsetReference === 'string' &&
          alternative.includes(shownReference) &&
          alternative.includes(offsetReference),
      )
      if (!includesBoth) {
        collector.error(
          'E_TEMPLATE_PROOF',
          `Template '${template}' needs one proof alternative containing both bound observations.`,
          base.concat('prove'),
        )
      }
    } else if (
      template === 'investigation.composite-culprit' ||
      template === 'investigation.composite-explanation'
    ) {
      const required = stringOrList(definition.require)
      const conclusion = isRecord(definition.conclude) ? definition.conclude : {}
      const resultKey =
        template === 'investigation.composite-culprit' ? 'perpetrator' : 'explanation'
      if (
        required.length === 0 ||
        typeof conclusion.incident !== 'string' ||
        typeof conclusion[resultKey] !== 'string'
      ) {
        collector.error(
          'E_TEMPLATE_PROOF',
          `Template '${template}' requires a non-empty deduction list plus conclude.incident and conclude.${resultKey}.`,
          base,
        )
      }
    }
  }
}

function buildDeductions(source: AnyRecord): CompiledDeduction[] {
  const deductionIds = new Set(mapEntries(source.deductions).map(([id]) => id))
  return mapEntries(source.deductions).map(([id, definition]) => {
    const bindings = isRecord(definition.with) ? toRecord(definition.with) : undefined
    const explicitAlternatives = authoredProofAlternatives(definition)
    const bindingOrder =
      typeof definition.use === 'string' ? TEMPLATE_BINDING_KEYS[definition.use] : undefined
    const inferredAlternative = bindings
      ? (bindingOrder ?? Object.keys(bindings).sort(compareCanonicalStrings))
          .map((key) => bindings[key])
          .filter((value): value is string => typeof value === 'string')
      : []

    const references =
      explicitAlternatives.length > 0
        ? explicitAlternatives
        : inferredAlternative.length > 0
          ? [{ terms: inferredAlternative, checks: [] }]
          : []
    const makeTerm = (reference: string): CompiledProofTerm =>
      deductionIds.has(reference)
        ? { kind: 'deduction', deductionId: reference }
        : { kind: 'observation', ref: reference }
    const template = typeof definition.use === 'string' ? definition.use : undefined
    const proofAlternatives: CompiledProofAlternative[] = references.map((alternative) => {
      const checks: CompiledProofAlternative['checks'] = alternative.checks.map(
        compileAuthoredProofCheck,
      )
      if (template === 'safety.intentional-disable-and-command' && bindings) {
        checks.push(
          { kind: 'equals', ref: String(bindings.failure), value: 'safety-pin-removed' },
          { kind: 'equals', ref: String(bindings.damage), value: false },
          { kind: 'equals', ref: String(bindings.command), value: 'open' },
        )
      } else if (template === 'media.timestamp-offset' && bindings) {
        checks.push({
          kind: 'timeOffsetEquals',
          shownRef: String(bindings.shown),
          offsetRef: String(bindings.offset),
          expected: String(isRecord(definition.conclude) ? definition.conclude.exited_at : ''),
        })
      } else if (template === 'media.prerecorded-alibi') {
        const deliveryRef = alternative.terms.find(
          (reference) => observationSourceValue(source, reference) === 'scheduled',
        )
        const timestampRef = alternative.terms.find((reference) => reference !== deliveryRef)
        const incidentId = isRecord(definition.conclude)
          ? definition.conclude.alibi_for
          : undefined
        const incident =
          typeof incidentId === 'string' &&
          isRecord(source.truth) &&
          isRecord(source.truth.events) &&
          isRecord(source.truth.events[incidentId])
            ? source.truth.events[incidentId]
            : undefined
        if (deliveryRef) {
          checks.push({ kind: 'equals', ref: deliveryRef, value: 'scheduled' })
        }
        if (timestampRef && typeof incident?.at === 'string') {
          checks.push({
            kind: 'beforeValue',
            leftRef: timestampRef,
            rightValue: incident.at,
          })
        }
      }
      return { terms: alternative.terms.map(makeTerm), checks }
    })

    const result: CompiledDeduction = {
      id,
      conclusion: toRecord(definition.conclude),
      proofAlternatives,
      requiredDeductions: stringList(definition.require).sort(compareCanonicalStrings),
    }
    return result
  })
}

function buildDeadlines(source: AnyRecord, caseStartMinute: number): CompiledDeadline[] {
  return mapEntries(source.deadlines).map(([id, deadline]) => {
    const isAbsolute = typeof deadline.at === 'string'
    const dueAtMinute = isAbsolute ? parseClockMinute(String(deadline.at)) : undefined
    const afterMinutes = isAbsolute
      ? (dueAtMinute as number) - caseStartMinute
      : parseDuration(String(deadline.after))
    const compiled: CompiledDeadline = {
      id,
      ...(deadline.label !== undefined ? { label: localizedText(deadline.label) } : {}),
      clock: deadline.clock as 'wall' | 'case-time',
      afterMinutes,
      timing: isAbsolute
        ? {
            kind: 'absolute-case-time',
            authoredAt: String(deadline.at),
            dueAtMinute: dueAtMinute as number,
            afterMinutes,
          }
        : {
            kind: 'relative',
            authoredAfter: String(deadline.after),
            afterMinutes,
      },
      offline: deadline.offline as 'on-resume-once' | 'pause' | 'continue',
      effects: Array.isArray(deadline.do) ? deadline.do.filter(isRecord).map(compileEffect) : [],
    }
    if (typeof deadline.cancel_on === 'string') compiled.cancelOn = deadline.cancel_on
    return compiled
  })
}

function compileCondition(value: unknown): ConditionExpression {
  if (!isRecord(value)) {
    throw new TypeError('Condition must be validated before compilation.')
  }
  if (Array.isArray(value.all)) {
    return { kind: 'all', conditions: value.all.map(compileCondition) }
  }
  if (Array.isArray(value.any)) {
    return { kind: 'any', conditions: value.any.map(compileCondition) }
  }
  if (isRecord(value.unless)) {
    return { kind: 'not', condition: compileCondition(value.unless) }
  }
  if (typeof value.observed === 'string') return { kind: 'observed', ref: value.observed }
  if (typeof value.supported === 'string') {
    return { kind: 'supported', deductionId: value.supported }
  }
  if (typeof value.marked === 'string') {
    return { kind: 'flag', flagId: value.marked, value: true }
  }
  if (typeof value['not-marked'] === 'string') {
    return { kind: 'flag', flagId: value['not-marked'], value: false }
  }
  if (typeof value['schedule-active'] === 'string') {
    return { kind: 'schedule', scheduleId: value['schedule-active'], active: true }
  }
  throw new TypeError('Unknown condition reached compilation.')
}

function compileEffect(effect: AnyRecord): CompiledEffect {
  if (Array.isArray(effect.trust)) {
    return { kind: 'trust', actorId: String(effect.trust[0]), delta: Number(effect.trust[1]) }
  }
  if (typeof effect.mark === 'string') {
    return { kind: 'flag', flagId: effect.mark, value: true }
  }
  if (typeof effect.unmark === 'string') {
    return { kind: 'flag', flagId: effect.unmark, value: false }
  }
  if (typeof effect.grant === 'string') {
    return { kind: 'evidence', evidenceId: effect.grant, operation: 'grant' }
  }
  if (typeof effect.revoke === 'string') {
    return { kind: 'evidence', evidenceId: effect.revoke, operation: 'revoke' }
  }
  if (Array.isArray(effect.reroute)) {
    return {
      kind: 'reroute',
      evidenceId: String(effect.reroute[0]),
      provider: String(effect.reroute[1]),
    }
  }
  if (Array.isArray(effect.spend)) {
    return {
      kind: 'clock-spend',
      clock: effect.spend[0] as 'wall' | 'active' | 'case-time',
      minutes: parseDuration(String(effect.spend[1])),
    }
  }
  if (typeof effect.cancel === 'string') {
    return { kind: 'schedule-cancel', scheduleId: effect.cancel }
  }
  if (Array.isArray(effect['bring-forward-by'])) {
    return {
      kind: 'schedule-shift',
      scheduleId: String(effect['bring-forward-by'][0]),
      earlierByMinutes: parseDuration(String(effect['bring-forward-by'][1])),
    }
  }
  if (typeof effect.emit === 'string') {
    return { kind: 'event-emit', eventType: effect.emit }
  }
  if (typeof effect.reveal === 'string') return { kind: 'reveal', path: effect.reveal }
  if (Array.isArray(effect.adjust)) {
    return {
      kind: 'metric-adjust',
      metric: String(effect.adjust[0]),
      entityId: String(effect.adjust[1]),
      delta: Number(effect.adjust[2]),
    }
  }
  if (Array.isArray(effect.conversation)) {
    return {
      kind: 'conversation',
      actorId: String(effect.conversation[0]),
      stateId: String(effect.conversation[1]),
    }
  }
  if (typeof effect.offer === 'string') {
    return { kind: 'affordance', affordanceId: effect.offer, operation: 'offer' }
  }
  if (typeof effect.withdraw === 'string') {
    return { kind: 'affordance', affordanceId: effect.withdraw, operation: 'withdraw' }
  }
  if (typeof effect['if-marked'] === 'string' && Array.isArray(effect.then)) {
    return {
      kind: 'conditional',
      condition: { kind: 'flag', flagId: effect['if-marked'], value: true },
      effects: effect.then.filter(isRecord).map(compileEffect),
    }
  }
  throw new TypeError('Unknown effect reached compilation.')
}

function compileTrigger(value: unknown): ReactionTrigger {
  if (!isRecord(value)) throw new TypeError('Trigger must be validated before compilation.')
  if (typeof value.action === 'string') return compileAction(value.action, value)
  if (typeof value.supported === 'string') {
    return { kind: 'deduction-supported', deductionId: value.supported }
  }
  if (typeof value.observed === 'string') {
    return { kind: 'observation-observed', observationId: value.observed }
  }
  if (typeof value.event === 'string') return { kind: 'event', eventType: value.event }
  throw new TypeError('Unknown trigger reached compilation.')
}

function buildReactions(source: AnyRecord): CompiledReaction[] {
  if (!Array.isArray(source.reactions)) return []
  return source.reactions
    .filter(isRecord)
    .map((reaction): CompiledReaction => {
      const semanticContent = canonicalize({
        trigger: compileTrigger(reaction.on),
        when: isRecord(reaction.when) ? compileCondition(reaction.when) : undefined,
        unless: isRecord(reaction.unless) ? compileCondition(reaction.unless) : undefined,
        once: reaction.once === true,
        effects: Array.isArray(reaction.do) ? reaction.do.filter(isRecord).map(compileEffect) : [],
      })
      const digest = hashCanonical(semanticContent)
      const compiled: CompiledReaction = {
        id:
          typeof reaction.id === 'string'
            ? reaction.id
            : `reaction_${digest.slice(0, 16)}`,
        priority:
          typeof reaction.priority === 'number'
            ? reaction.priority
            : Number.parseInt(digest.slice(0, 7), 16),
        trigger: compileTrigger(reaction.on),
        once: reaction.once === true,
        effects: Array.isArray(reaction.do) ? reaction.do.filter(isRecord).map(compileEffect) : [],
      }
      if (isRecord(reaction.when)) compiled.when = compileCondition(reaction.when)
      if (isRecord(reaction.unless)) compiled.unless = compileCondition(reaction.unless)
      return compiled
    })
    .sort((left, right) =>
      right.priority - left.priority || compareCanonicalStrings(left.id, right.id),
    )
}

function buildConversations(source: AnyRecord): CompiledActorConversation[] {
  const cast = isRecord(source.cast) ? source.cast : {}
  return mapEntries(source.conversations)
    .map(([actorId, definition]): CompiledActorConversation => {
      const actor = isRecord(cast[actorId]) ? cast[actorId] as AnyRecord : {}
      const hidden =
        actor.protected === true ||
        actor.hidden === true ||
        actor.public === false ||
        actor.visibility === 'private' ||
        actor.visibility === 'hidden'
      return {
        actorId,
        public: !hidden,
        initialStateId: String(definition.initial),
        states: mapEntries(definition.states).map(([id, state]) => ({
          id,
          canTalk: state.can_talk === true,
          ...(state.reason !== undefined ? { reason: localizedText(state.reason) } : {}),
        })),
        channels: Object.fromEntries(
          Object.entries(isRecord(definition.channels) ? definition.channels : {})
            .sort(([left], [right]) => compareCanonicalStrings(left, right))
            .map(([verb, field]) => [verb, field as 'actor' | 'target' | 'from']),
        ),
        allowWhileUnavailable: stringList(definition.allow_while_unavailable)
          .sort(compareCanonicalStrings),
      }
    })
    .sort((left, right) => compareCanonicalStrings(left.actorId, right.actorId))
}

function buildAffordances(source: AnyRecord): CompiledAffordance[] {
  return mapEntries(source.affordances)
    .map(([id, definition]): CompiledAffordance => {
      const action = isRecord(definition.action) ? definition.action : {}
      return {
        id,
        label: localizedText(definition.label),
        ...(definition.result !== undefined ? { result: localizedText(definition.result) } : {}),
        risk: definition.risk === 'consequential' || definition.risk === 'terminal'
          ? definition.risk
          : 'normal',
        ...(definition.confirmation !== undefined
          ? { confirmation: localizedText(definition.confirmation) }
          : {}),
        surface: definition.surface as CompiledAffordance['surface'],
        initial: definition.initial as CompiledAffordance['initial'],
        intent: isRecord(definition.action)
          ? {kind: 'action' as const, action: compileAction(String(action.action), action)}
          : {kind: 'deduce' as const, deductionId: String(definition.deduction)},
        exclusive: definition.exclusive !== false,
        ...(isRecord(definition.cost) ? {
          cost: {
            clock: 'case-time' as const,
            milliseconds: parseDuration(String(definition.cost.by)) * 60_000,
          },
        } : {}),
        once: definition.once !== false,
      }
    })
    .sort((left, right) => compareCanonicalStrings(left.id, right.id))
}

function buildObjectives(value: unknown): CompiledObjective[] {
  return mapEntries(value).map(([id, definition]) => ({
    id,
    condition: compileCondition(definition),
  }))
}

function buildAssessment(value: unknown): CompiledAssessment | undefined {
  if (!isRecord(value)) return undefined
  const categories = mapEntries(value.categories).map(([id, definition]) => ({
    id,
    label: localizedText(definition.label),
    criteria: mapEntries(definition.criteria).map(([criterionId, criterion]) => ({
      id: criterionId,
      points: Number(criterion.points),
      when: compileCondition(criterion.when),
      met: localizedText(criterion.met),
      missed: localizedText(criterion.missed),
    })),
  }))
  const bands = (Array.isArray(value.bands) ? value.bands : [])
    .filter(isRecord)
    .map((band) => ({
      minScore: Number(band.min_score),
      label: localizedText(band.label),
    }))
    .sort((left, right) => left.minScore - right.minScore)
  return {
    maxScore: Number(value.max_score),
    bands,
    categories,
  }
}

function buildOutcomes(value: unknown): CompiledOutcome[] {
  return mapEntries(value)
    .map(([id, definition]): CompiledOutcome => {
      const outcome: CompiledOutcome = {
        id,
        title: localizedText(definition.title),
        ...(definition.body !== undefined ? { body: localizedText(definition.body) } : {}),
        priority: Number(definition.priority),
        requiredObjectives: stringOrList(definition.require).sort(compareCanonicalStrings),
        excludedObjectives: stringOrList(definition.unless).sort(compareCanonicalStrings),
        finalTargets: stringOrList(definition.final_target).sort(compareCanonicalStrings),
        whenAnyFlags: stringOrList(definition.when_any_marked).sort(compareCanonicalStrings),
      }
      if (typeof definition.when_marked === 'string') outcome.whenFlag = definition.when_marked
      return outcome
    })
    .sort(
      (left, right) =>
        right.priority - left.priority || compareCanonicalStrings(left.id, right.id),
    )
}

function assertKnown(
  collector: DiagnosticCollector,
  value: unknown,
  known: Set<string>,
  code: string,
  kind: string,
  path: Path,
): void {
  if (typeof value === 'string' && !known.has(value)) {
    collector.error(code, `Unknown ${kind} reference '${value}'.`, path)
  }
}

function validateCapabilityVocabulary(
  source: AnyRecord,
  collector: DiagnosticCollector,
  vocabulary: CapabilityVocabulary,
): void {
  for (const [assetId, definition] of mapEntries(source.assets)) {
    const base: Path = ['assets', assetId]
    const kind = definition.kind as AssetKind
    const mimeType = String(definition.mime_type)
    const requiredPrefix = ASSET_MIME_PREFIX[kind]
    if (
      (requiredPrefix && !mimeType.startsWith(requiredPrefix)) ||
      (kind === 'document' && !DOCUMENT_MIME_TYPES.has(mimeType)) ||
      (kind === 'file' && !FILE_MIME_TYPES.has(mimeType))
    ) {
      collector.error(
        'E_ASSET_MIME_KIND',
        `MIME type '${mimeType}' is not valid for asset kind '${kind}'.`,
        base.concat('mime_type'),
      )
    }

    const authoredSource = isRecord(definition.source) ? definition.source : {}
    if (typeof authoredSource.local === 'string') {
      const local = authoredSource.local
      const segments = local.split('/')
      if (
        local.includes('\\') ||
        local.includes('\0') ||
        local.startsWith('/') ||
        !local.startsWith('assets/') ||
        segments.some((segment) => segment === '' || segment === '.' || segment === '..')
      ) {
        collector.error(
          'E_ASSET_LOCAL_PATH',
          `Local asset '${local}' must be a normalized relative path below assets/.`,
          base.concat('source', 'local'),
        )
      }
      const extension = localExtension(local)
      if (!extension || FORBIDDEN_LOCAL_EXTENSIONS.has(extension)) {
        collector.error(
          'E_ASSET_EXTENSION',
          `Local asset '${local}' has a missing or forbidden extension.`,
          base.concat('source', 'local'),
        )
      } else {
        const expectedMimeTypes = LOCAL_EXTENSION_MIME_TYPES[extension]
        if (expectedMimeTypes && !expectedMimeTypes.includes(mimeType)) {
          collector.error(
            'E_ASSET_EXTENSION_MIME',
            `Extension '${extension}' does not match MIME type '${mimeType}'.`,
            base.concat('mime_type'),
          )
        } else if (!expectedMimeTypes) {
          collector.error(
            'E_ASSET_EXTENSION',
            `Extension '${extension}' is not supported for '${kind}' assets.`,
            base.concat('source', 'local'),
          )
        }
      }
    } else if (typeof authoredSource.https === 'string') {
      try {
        const url = new URL(authoredSource.https)
        if (
          url.protocol !== 'https:' ||
          !url.hostname ||
          unsafeRemoteAssetHostname(url.hostname) ||
          url.username ||
          url.password ||
          url.hash
        ) {
          throw new TypeError('Unsafe HTTPS asset URL.')
        }
      } catch {
        collector.error(
          'E_ASSET_HTTPS_URL',
          'Direct asset URLs must use a public DNS hostname over HTTPS, without credentials or fragments.',
          base.concat('source', 'https'),
        )
      }
    } else if (typeof authoredSource.provider === 'string') {
      if (!vocabulary.assetProviders.has(authoredSource.provider)) {
        collector.error(
          'E_UNKNOWN_ASSET_PROVIDER',
          `Asset provider '${authoredSource.provider}' is not provided by the selected capabilities.`,
          base.concat('source', 'provider'),
        )
      }
    }
  }

  const validateVerb = (verb: unknown, path: Path): void => {
    if (typeof verb !== 'string') {
      collector.error('E_ACTION_SHAPE', 'Action verb must be a string.', path)
      return
    }
    const normalized = normalizeVerb(verb)
    if (!vocabulary.verbs.has(normalized)) {
      collector.error(
        'E_UNKNOWN_ACTION',
        `Action '${verb}' is not provided by the selected capabilities.`,
        path,
      )
    }
  }

  const validateActionArguments = (value: AnyRecord, path: Path, discriminator: string): void => {
    const allowed = new Set<string>([discriminator, ...ACTION_ARGUMENT_FIELDS])
    for (const [key, item] of Object.entries(value)) {
      if (!allowed.has(key)) {
        collector.error('E_ACTION_ARGUMENT', `Unknown action argument '${key}'.`, path.concat(key))
      } else if (key !== discriminator && typeof item !== 'string') {
        collector.error('E_ACTION_ARGUMENT', `Action argument '${key}' must be a string.`, path.concat(key))
      }
    }
  }

  const validateUnlock = (value: unknown, path: Path): void => {
    if (typeof value === 'string') return
    if (!isRecord(value)) {
      collector.error('E_UNLOCK_SHAPE', 'Unlock must be an event string or expression.', path)
      return
    }
    const keys = Object.keys(value)
    if (keys.length === 1 && (keys[0] === 'any' || keys[0] === 'all')) {
      const children = value[keys[0]]
      if (!Array.isArray(children) || children.length === 0) {
        collector.error('E_UNLOCK_SHAPE', `${keys[0]} requires a non-empty expression list.`, path.concat(keys[0]))
      } else {
        children.forEach((child, index) => validateUnlock(child, path.concat(keys[0], index)))
      }
      return
    }
    if (keys.length === 1 && keys[0] === 'trust') {
      if (
        !Array.isArray(value.trust) ||
        value.trust.length !== 2 ||
        typeof value.trust[0] !== 'string' ||
        typeof value.trust[1] !== 'number'
      ) {
        collector.error('E_UNLOCK_SHAPE', 'trust requires [actor, minimum-number].', path.concat('trust'))
      }
      return
    }
    if (keys.length === 1 && (keys[0] === 'search' || keys[0] === 'request')) {
      validateVerb(keys[0], path.concat(keys[0]))
      if (typeof value[keys[0]] !== 'string') {
        collector.error('E_UNLOCK_SHAPE', `${keys[0]} shorthand requires a string.`, path.concat(keys[0]))
      }
      return
    }
    if (typeof value.after !== 'string') {
      collector.error('E_UNLOCK_SHAPE', 'Unlock action requires an after discriminator.', path)
      return
    }
    if (value.after === 'supported' || value.after === 'observe') {
      if (keys.length !== 2 || typeof value.ref !== 'string') {
        collector.error(
          'E_UNLOCK_SHAPE',
          `${value.after} unlock requires exactly one string ref.`,
          path,
        )
      }
      return
    }
    validateVerb(value.after, path.concat('after'))
    validateActionArguments(value, path, 'after')
  }

  const validateConditionShape = (value: unknown, path: Path): void => {
    if (!isRecord(value)) {
      collector.error('E_CONDITION_SHAPE', 'Condition must be an expression object.', path)
      return
    }
    const keys = Object.keys(value)
    if (keys.length !== 1) {
      collector.error('E_CONDITION_SHAPE', 'Condition must contain exactly one operator.', path)
      return
    }
    const key = keys[0]
    const child = value[key]
    if (key === 'all' || key === 'any') {
      if (!Array.isArray(child) || child.length === 0) {
        collector.error('E_CONDITION_SHAPE', `${key} requires a non-empty condition list.`, path.concat(key))
      } else {
        child.forEach((item, index) => validateConditionShape(item, path.concat(key, index)))
      }
    } else if (key === 'unless') {
      validateConditionShape(child, path.concat(key))
    } else if (
      !['observed', 'supported', 'marked', 'not-marked', 'schedule-active'].includes(key) ||
      typeof child !== 'string'
    ) {
      collector.error('E_UNKNOWN_CONDITION', `Unknown or malformed condition '${key}'.`, path.concat(key))
    }
  }

  const validateEffectsShape = (value: unknown, path: Path): void => {
    if (!Array.isArray(value)) {
      collector.error('E_EFFECT_SHAPE', 'Effects must be a list.', path)
      return
    }
    value.forEach((effect, index) => {
      const effectPath = path.concat(index)
      if (!isRecord(effect)) {
        collector.error('E_EFFECT_SHAPE', 'Effect must be an object.', effectPath)
        return
      }
      const keys = Object.keys(effect)
      if (typeof effect['if-marked'] === 'string' && Array.isArray(effect.then)) {
        if (keys.some((key) => key !== 'if-marked' && key !== 'then')) {
          collector.error('E_EFFECT_SHAPE', 'Conditional effect has unknown fields.', effectPath)
        }
        validateEffectsShape(effect.then, effectPath.concat('then'))
        return
      }
      if (keys.length !== 1) {
        collector.error('E_EFFECT_SHAPE', 'Effect must contain exactly one operator.', effectPath)
        return
      }
      const operator = keys[0]
      const operand = effect[operator]
      const stringOperators = [
        'mark',
        'unmark',
        'grant',
        'revoke',
        'cancel',
        'emit',
        'reveal',
        'offer',
        'withdraw',
      ]
      if (stringOperators.includes(operator)) {
        if (typeof operand !== 'string') collector.error('E_EFFECT_SHAPE', `${operator} requires a string.`, effectPath.concat(operator))
      } else if (operator === 'trust') {
        if (!Array.isArray(operand) || operand.length !== 2 || typeof operand[0] !== 'string' || typeof operand[1] !== 'number') {
          collector.error('E_EFFECT_SHAPE', 'trust requires [actor, delta-number].', effectPath.concat(operator))
        }
      } else if (operator === 'adjust') {
        if (!Array.isArray(operand) || operand.length !== 3 || typeof operand[0] !== 'string' || typeof operand[1] !== 'string' || typeof operand[2] !== 'number') {
          collector.error('E_EFFECT_SHAPE', 'adjust requires [metric, entity, delta-number].', effectPath.concat(operator))
        }
      } else if (operator === 'conversation') {
        if (
          !Array.isArray(operand) ||
          operand.length !== 2 ||
          typeof operand[0] !== 'string' ||
          typeof operand[1] !== 'string' ||
          !/^[a-z][a-z0-9_-]*$/.test(operand[1])
        ) {
          collector.error(
            'E_EFFECT_SHAPE',
            'conversation requires [actor, declared-state-id].',
            effectPath.concat(operator),
          )
        }
      } else if (operator === 'spend') {
        if (
          !Array.isArray(operand) ||
          operand.length !== 2 ||
          !['wall', 'active', 'case-time'].includes(String(operand[0])) ||
          !Number.isFinite(parseDuration(String(operand[1])))
        ) {
          collector.error('E_EFFECT_SHAPE', 'spend requires [clock, duration].', effectPath.concat(operator))
        }
      } else if (operator === 'bring-forward-by') {
        if (!Array.isArray(operand) || operand.length !== 2 || typeof operand[0] !== 'string' || !Number.isFinite(parseDuration(String(operand[1])))) {
          collector.error('E_EFFECT_SHAPE', 'bring-forward-by requires [schedule, duration].', effectPath.concat(operator))
        }
      } else if (operator === 'reroute') {
        if (!Array.isArray(operand) || operand.length !== 2 || typeof operand[0] !== 'string' || typeof operand[1] !== 'string') {
          collector.error('E_EFFECT_SHAPE', 'reroute requires [evidence, provider].', effectPath.concat(operator))
        } else if (!vocabulary.rerouteProviders.has(operand[1])) {
          collector.error('E_UNKNOWN_PROVIDER', `Reroute provider '${operand[1]}' is not provided by the selected capabilities.`, effectPath.concat(operator, 1))
        }
      } else {
        collector.error('E_UNKNOWN_EFFECT', `Unknown effect operator '${operator}'.`, effectPath.concat(operator))
      }
    })
  }

  const affordanceActions: Array<{id: string; action: CompiledAction}> = []
  for (const [affordanceId, affordance] of mapEntries(source.affordances)) {
    const base: Path = ['affordances', affordanceId]
    if (isRecord(affordance.cost)) {
      const milliseconds = parseDuration(String(affordance.cost.by)) * 60_000
      if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
        collector.error(
          'E_AFFORDANCE_COST',
          'Affordance cost must resolve to a positive safe integer number of milliseconds.',
          base.concat('cost', 'by'),
        )
      }
    }
    if (!isRecord(affordance.action)) continue
    validateVerb(affordance.action.action, base.concat('action', 'action'))
    validateActionArguments(affordance.action, base.concat('action'), 'action')
    if (typeof affordance.action.action === 'string') {
      const compiled = compileAction(affordance.action.action, affordance.action)
      const overlap = affordanceActions.find(({action}) => (
        action.verb === compiled.verb && ACTION_ARGUMENT_FIELDS.every((field) => (
          action[field] === undefined || compiled[field] === undefined || action[field] === compiled[field]
        ))
      ))
      if (overlap) {
        const exact = hashCanonical(overlap.action) === hashCanonical(compiled)
        collector.error(
          exact ? 'E_DUPLICATE_AFFORDANCE_ACTION' : 'E_OVERLAPPING_AFFORDANCE_ACTION',
          exact
            ? `Affordance '${affordanceId}' duplicates the public command declared by '${overlap.id}'.`
            : `Affordance '${affordanceId}' overlaps the public command declared by '${overlap.id}'.`,
          base.concat('action'),
        )
      } else {
        affordanceActions.push({id: affordanceId, action: compiled})
      }
    }
  }
  const authoredAffordances = mapEntries(source.affordances)
  if (authoredAffordances.length > 0) {
    for (const deductionId of mapEntries(source.deductions).map(([id]) => id)) {
      if (!authoredAffordances.some(([, affordance]) => affordance.deduction === deductionId)) {
        collector.error(
          'E_MISSING_DEDUCTION_AFFORDANCE',
          `Deduction '${deductionId}' requires exactly one deduction affordance when the case declares affordances.`,
          ['deductions', deductionId],
        )
      }
    }
  }

  for (const [actorId, conversation] of mapEntries(source.conversations)) {
    const base: Path = ['conversations', actorId]
    const allowedKeys = new Set(['initial', 'channels', 'allow_while_unavailable', 'states'])
    for (const key of Object.keys(conversation)) {
      if (!allowedKeys.has(key)) {
        collector.error('E_CONVERSATION_SHAPE', `Unknown conversation field '${key}'.`, base.concat(key))
      }
    }
    if (typeof conversation.initial !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(conversation.initial)) {
      collector.error(
        'E_CONVERSATION_SHAPE',
        'conversation.initial must be a state ID.',
        base.concat('initial'),
      )
    }
    if (!isRecord(conversation.states) || Object.keys(conversation.states).length === 0) {
      collector.error('E_CONVERSATION_SHAPE', 'conversation.states must be a non-empty map.', base.concat('states'))
    } else {
      for (const [stateId, rawState] of Object.entries(conversation.states)) {
        const statePath = base.concat('states', stateId)
        if (!/^[a-z][a-z0-9_-]*$/.test(stateId) || !isRecord(rawState)) {
          collector.error('E_CONVERSATION_SHAPE', 'Conversation state IDs must map to objects.', statePath)
          continue
        }
        if (
          Object.keys(rawState).some((key) => key !== 'can_talk' && key !== 'reason') ||
          typeof rawState.can_talk !== 'boolean'
        ) {
          collector.error(
            'E_CONVERSATION_SHAPE',
            'Conversation states require can_talk: boolean and may include reason: text.',
            statePath,
          )
        }
      }
      if (typeof conversation.initial === 'string' && !Object.hasOwn(conversation.states, conversation.initial)) {
        collector.error(
          'E_CONVERSATION_INITIAL',
          `Initial conversation state '${conversation.initial}' is not declared.`,
          base.concat('initial'),
        )
      }
    }
    if (!isRecord(conversation.channels) || Object.keys(conversation.channels).length === 0) {
      collector.error('E_CONVERSATION_SHAPE', 'conversation.channels must map actions to actor fields.', base.concat('channels'))
    } else {
      for (const [verb, field] of Object.entries(conversation.channels)) {
        validateVerb(verb, base.concat('channels', verb))
        if (field !== 'actor' && field !== 'target' && field !== 'from') {
          collector.error(
            'E_CONVERSATION_SHAPE',
            `Conversation action '${verb}' must use actor, target, or from.`,
            base.concat('channels', verb),
          )
        }
      }
    }
    const allowedWhileUnavailable = conversation.allow_while_unavailable
    if (
      allowedWhileUnavailable !== undefined &&
      (!Array.isArray(allowedWhileUnavailable) ||
        allowedWhileUnavailable.some((item) => typeof item !== 'string'))
    ) {
      collector.error(
        'E_CONVERSATION_SHAPE',
        'conversation.allow_while_unavailable must be an action list.',
        base.concat('allow_while_unavailable'),
      )
    } else if (Array.isArray(allowedWhileUnavailable)) {
      if (new Set(allowedWhileUnavailable).size !== allowedWhileUnavailable.length) {
        collector.error(
          'E_CONVERSATION_SHAPE',
          'conversation.allow_while_unavailable must not contain duplicates.',
          base.concat('allow_while_unavailable'),
        )
      }
      allowedWhileUnavailable.forEach((verb, index) => {
        validateVerb(verb, base.concat('allow_while_unavailable', index))
        if (!isRecord(conversation.channels) || !Object.hasOwn(conversation.channels, verb)) {
          collector.error(
            'E_CONVERSATION_SHAPE',
            `Unavailable action '${verb}' must also be declared in conversation.channels.`,
            base.concat('allow_while_unavailable', index),
          )
        }
      })
    }
  }

  for (const [evidenceId, definition] of mapEntries(source.evidence)) {
    if (typeof definition.tool === 'string' && !vocabulary.tools.has(definition.tool)) {
      collector.error(
        'E_UNKNOWN_TOOL',
        `Tool '${definition.tool}' is not provided by the selected capabilities.`,
        ['evidence', evidenceId, 'tool'],
      )
    }
    if (isRecord(definition.presentation) && isRecord(definition.presentation.findings)) {
      const reports = isRecord(definition.reports) ? definition.reports : {}
      for (const field of Object.keys(definition.presentation.findings)) {
        if (!Object.hasOwn(reports, field)) {
          collector.error(
            'E_UNKNOWN_EVIDENCE_FINDING',
            `Evidence presentation finding '${field}' does not match a declared report field.`,
            ['evidence', evidenceId, 'presentation', 'findings', field],
          )
        }
      }
    }
    if (definition.unlock !== undefined) validateUnlock(definition.unlock, ['evidence', evidenceId, 'unlock'])
  }

  for (const [deductionId, definition] of mapEntries(source.deductions)) {
    if (typeof definition.use === 'string' && !vocabulary.templates.has(definition.use)) {
      collector.error(
        'E_UNKNOWN_TEMPLATE',
        `Template '${definition.use}' is not provided by the selected capabilities.`,
        ['deductions', deductionId, 'use'],
      )
    }
  }

  if (Array.isArray(source.reactions)) {
    source.reactions.forEach((reaction, index) => {
      if (!isRecord(reaction)) return
      const base: Path = ['reactions', index]
      if (!isRecord(reaction.on)) {
        collector.error('E_TRIGGER_SHAPE', 'Reaction trigger must be an object.', base.concat('on'))
      } else if (typeof reaction.on.action === 'string') {
        validateVerb(reaction.on.action, base.concat('on', 'action'))
        validateActionArguments(reaction.on, base.concat('on'), 'action')
      } else if (
        !(
          Object.keys(reaction.on).length === 1 &&
          (
            typeof reaction.on.supported === 'string' ||
            typeof reaction.on.observed === 'string' ||
            typeof reaction.on.event === 'string'
          )
        )
      ) {
        collector.error(
          'E_TRIGGER_SHAPE',
          'Trigger must be action, observed, supported, or event.',
          base.concat('on'),
        )
      }
      if (reaction.when !== undefined) validateConditionShape(reaction.when, base.concat('when'))
      if (reaction.unless !== undefined) validateConditionShape(reaction.unless, base.concat('unless'))
      validateEffectsShape(reaction.do, base.concat('do'))
    })
  }

  for (const [deadlineId, deadline] of mapEntries(source.deadlines)) {
    validateEffectsShape(deadline.do, ['deadlines', deadlineId, 'do'])
  }
  for (const [objectiveId, objective] of mapEntries(source.objectives)) {
    validateConditionShape(objective, ['objectives', objectiveId])
  }
  if (isRecord(source.assessment)) {
    for (const [categoryId, category] of mapEntries(source.assessment.categories)) {
      for (const [criterionId, criterion] of mapEntries(category.criteria)) {
        validateConditionShape(
          criterion.when,
          ['assessment', 'categories', categoryId, 'criteria', criterionId, 'when'],
        )
      }
    }
  }

}

function validateDeadlineTiming(source: AnyRecord, collector: DiagnosticCollector): void {
  const caseDefinition = isRecord(source.case) ? source.case : {}
  const timeDefinition = isRecord(caseDefinition.time) ? caseDefinition.time : {}
  const startsAt = parseClockMinute(String(timeDefinition.starts_at))
  for (const [id, deadline] of mapEntries(source.deadlines)) {
    if (typeof deadline.at !== 'string') continue
    if (deadline.clock !== 'case-time') {
      collector.error('E_ABSOLUTE_WALL_DEADLINE', 'Absolute at deadlines must use the case-time clock.', ['deadlines', id, 'clock'])
    }
    const due = parseClockMinute(deadline.at)
    if (due < startsAt) {
      collector.error(
        'E_DEADLINE_BEFORE_START',
        `Absolute deadline '${deadline.at}' is before case start '${String(timeDefinition.starts_at)}'.`,
        ['deadlines', id, 'at'],
      )
    }
  }
}

function validateAssessment(source: AnyRecord, collector: DiagnosticCollector): void {
  if (!isRecord(source.assessment)) return
  const assessment = source.assessment
  const maxScore = Number(assessment.max_score)
  const criteria = mapEntries(assessment.categories).flatMap(([, category]) => (
    mapEntries(category.criteria)
  ))
  const total = criteria.reduce((sum, [, criterion]) => sum + Number(criterion.points), 0)
  if (total !== maxScore) {
    collector.error(
      'E_ASSESSMENT_POINTS',
      `Assessment criteria total ${total} must equal max_score ${maxScore}.`,
      ['assessment', 'max_score'],
    )
  }

  const thresholds = new Map<number, number>()
  const bands = Array.isArray(assessment.bands) ? assessment.bands : []
  bands.forEach((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.min_score !== 'number') return
    const threshold = candidate.min_score
    if (threshold > maxScore) {
      collector.error(
        'E_ASSESSMENT_BAND_RANGE',
        `Assessment band threshold ${threshold} must be between 0 and max_score ${maxScore}.`,
        ['assessment', 'bands', index, 'min_score'],
      )
    }
    const previous = thresholds.get(threshold)
    if (previous !== undefined) {
      collector.error(
        'E_ASSESSMENT_BAND_DUPLICATE',
        `Assessment band threshold ${threshold} duplicates bands[${previous}].`,
        ['assessment', 'bands', index, 'min_score'],
      )
    } else {
      thresholds.set(threshold, index)
    }
  })
  if (!thresholds.has(0)) {
    collector.error(
      'E_ASSESSMENT_BAND_ZERO',
      'Assessment bands must include a min_score of 0.',
      ['assessment', 'bands'],
    )
  }
}

function validateEmittedEventCycles(source: AnyRecord, collector: DiagnosticCollector): void {
  const edges = new Map<string, Set<string>>()
  const collectEmits = (effects: unknown, result: Set<string>): void => {
    if (!Array.isArray(effects)) return
    for (const effect of effects) {
      if (!isRecord(effect)) continue
      if (typeof effect.emit === 'string') result.add(effect.emit)
      collectEmits(effect.then, result)
    }
  }
  if (Array.isArray(source.reactions)) {
    source.reactions.forEach((reaction) => {
      if (!isRecord(reaction) || !isRecord(reaction.on)) return
      const triggers = stringOrList(reaction.on.event)
      const emitted = new Set<string>()
      collectEmits(reaction.do, emitted)
      for (const trigger of triggers) {
        const outgoing = edges.get(trigger) ?? new Set<string>()
        for (const event of emitted) outgoing.add(event)
        edges.set(trigger, outgoing)
      }
    })
  }
  const active = new Set<string>()
  const done = new Set<string>()
  const visit = (event: string, path: string[]): void => {
    if (active.has(event)) {
      const start = path.indexOf(event)
      const cycle = [...path.slice(start), event]
      collector.error('E_EMITTED_EVENT_CYCLE', `Emitted-event cycle: ${cycle.join(' -> ')}.`, ['reactions'])
      return
    }
    if (done.has(event)) return
    active.add(event)
    for (const next of edges.get(event) ?? []) visit(next, [...path, event])
    active.delete(event)
    done.add(event)
  }
  for (const event of [...edges.keys()].sort(compareCanonicalStrings)) visit(event, [])
}

function validateCrossReferences(source: AnyRecord, collector: DiagnosticCollector): void {
  const assets = new Set(Object.keys(isRecord(source.assets) ? source.assets : {}))
  const cast = new Set(Object.keys(isRecord(source.cast) ? source.cast : {}))
  const places = new Set(Object.keys(isRecord(source.places) ? source.places : {}))
  const things = new Set(Object.keys(isRecord(source.things) ? source.things : {}))
  const eventActors = new Set([...cast, ...things])
  const events = new Set(
    Object.keys(isRecord(source.truth) && isRecord(source.truth.events) ? source.truth.events : {}),
  )
  const evidence = new Set(Object.keys(isRecord(source.evidence) ? source.evidence : {}))
  const deductions = new Set(Object.keys(isRecord(source.deductions) ? source.deductions : {}))
  const affordances = new Set(Object.keys(isRecord(source.affordances) ? source.affordances : {}))
  const authoredAffordances = mapEntries(source.affordances)
  const flags = new Set(stringList(source.flags))
  const deadlines = new Set(Object.keys(isRecord(source.deadlines) ? source.deadlines : {}))
  const objectives = new Set(Object.keys(isRecord(source.objectives) ? source.objectives : {}))
  const decisionTargets = new Set<string>([...cast, ...things, ...places])
  if (Array.isArray(source.reactions)) {
    for (const reaction of source.reactions) {
      if (
        isRecord(reaction) &&
        isRecord(reaction.on) &&
        reaction.on.action === 'submit-conclusion' &&
        typeof reaction.on.target === 'string'
      ) {
        decisionTargets.add(reaction.on.target)
      }
    }
  }
  const observations = new Set<string>()
  for (const [evidenceId, definition] of mapEntries(source.evidence)) {
    for (const field of Object.keys(isRecord(definition.reports) ? definition.reports : {})) {
      observations.add(`${evidenceId}.${field}`)
    }
  }

  const privateEntityIds = new Set<string>()
  for (const collection of [source.cast, source.places, source.things]) {
    for (const [id, entry] of mapEntries(collection)) {
      if (
        entry.protected === true ||
        entry.hidden === true ||
        entry.public === false ||
        entry.visibility === 'private' ||
        entry.visibility === 'hidden'
      ) {
        privateEntityIds.add(id)
      }
    }
  }
  for (const [affordanceId, affordance] of mapEntries(source.affordances)) {
    if (isRecord(affordance.action)) {
      if (affordance.action.evidence !== undefined) {
        assertKnown(
          collector,
          affordance.action.evidence,
          evidence,
          'E_UNKNOWN_EVIDENCE',
          'evidence',
          ['affordances', affordanceId, 'action', 'evidence'],
        )
      }
      for (const field of ACTION_ARGUMENT_FIELDS) {
        const value = affordance.action[field]
        if (typeof value === 'string' && privateEntityIds.has(value)) {
          collector.error(
            'E_PUBLIC_AFFORDANCE_LEAK',
            `Public affordance '${affordanceId}' references private entity '${value}'.`,
            ['affordances', affordanceId, 'action', field],
          )
        }
      }
    }
    if (typeof affordance.deduction === 'string') {
      if (affordance.once === false) {
        collector.error(
          'E_REPEATABLE_DEDUCTION_AFFORDANCE',
          `Deduction affordance '${affordanceId}' cannot set once to false because a deduction can only be supported once.`,
          ['affordances', affordanceId, 'once'],
        )
      }
      assertKnown(
        collector,
        affordance.deduction,
        deductions,
        'E_UNKNOWN_DEDUCTION',
        'deduction',
        ['affordances', affordanceId, 'deduction'],
      )
      const duplicate = mapEntries(source.affordances).find(([otherId, other]) => (
        otherId < affordanceId && other.deduction === affordance.deduction
      ))
      if (duplicate) {
        collector.error(
          'E_DUPLICATE_AFFORDANCE_COMMAND',
          `Affordance '${affordanceId}' duplicates deduction '${affordance.deduction}' declared by '${duplicate[0]}'.`,
          ['affordances', affordanceId, 'deduction'],
        )
      }
    }
  }

  for (const [actorId, conversation] of mapEntries(source.conversations)) {
    assertKnown(
      collector,
      actorId,
      cast,
      'E_UNKNOWN_ACTOR',
      'actor',
      ['conversations', actorId],
    )
    if (isRecord(conversation.states) && typeof conversation.initial === 'string') {
      if (!Object.hasOwn(conversation.states, conversation.initial)) {
        collector.error(
          'E_CONVERSATION_INITIAL',
          `Initial conversation state '${conversation.initial}' is not declared for '${actorId}'.`,
          ['conversations', actorId, 'initial'],
        )
      }
    }
  }

  const assertObservation = (value: unknown, path: Path): void => {
    if (typeof value !== 'string') return
    if (deductions.has(value)) return
    // `after: {open: ...}` and similar gates may reference the evidence card;
    // assertion queries use the generated dotted observation identifier.
    if (evidence.has(value)) return
    if (!observations.has(value)) {
      collector.error(
        'E_UNKNOWN_OBSERVATION',
        `Unknown evidence or observation reference '${value}'.`,
        path,
      )
    }
  }

  if (isRecord(source.opening)) {
    if (isRecord(source.opening.call)) {
      assertKnown(
        collector,
        source.opening.call.from,
        cast,
        'E_UNKNOWN_ACTOR',
        'actor',
        ['opening', 'call', 'from'],
      )
    }
    for (const [index, id] of stringList(source.opening.grants).entries()) {
      assertKnown(collector, id, evidence, 'E_UNKNOWN_EVIDENCE', 'evidence', ['opening', 'grants', index])
      const definition = isRecord(source.evidence) ? source.evidence[id] : undefined
      if (isRecord(definition) && definition.at !== 'start') {
        collector.error(
          'E_LOCKED_EVIDENCE_GRANTED',
          `Opening grant '${id}' is not declared with at: start.`,
          ['opening', 'grants', index],
        )
      }
    }
    for (const [index, id] of stringList(source.opening.starts).entries()) {
      assertKnown(collector, id, deadlines, 'E_UNKNOWN_DEADLINE', 'deadline', ['opening', 'starts', index])
    }
  }

  const openingGrants = new Set(
    isRecord(source.opening) ? stringList(source.opening.grants) : [],
  )
  for (const [evidenceId, definition] of mapEntries(source.evidence)) {
    const path: Path = ['evidence', evidenceId]
    if (definition.at === 'start' && !openingGrants.has(evidenceId)) {
      collector.error(
        'E_INITIAL_EVIDENCE_NOT_GRANTED',
        `Evidence '${evidenceId}' is marked at: start but is absent from opening.grants.`,
        path.concat('at'),
      )
    }
    if (typeof definition.expires_with === 'string') {
      assertKnown(
        collector,
        definition.expires_with,
        deadlines,
        'E_UNKNOWN_DEADLINE',
        'deadline',
        path.concat('expires_with'),
      )
    }
    for (const [index, assetId] of stringList(definition.assets).entries()) {
      assertKnown(
        collector,
        assetId,
        assets,
        'E_UNKNOWN_ASSET',
        'asset',
        path.concat('assets', index),
      )
    }
    visitUnlock(definition.unlock, path.concat('unlock'), {
      actor(value, valuePath) {
        assertKnown(collector, value, cast, 'E_UNKNOWN_ACTOR', 'actor', valuePath)
      },
      observation(value, valuePath) {
        assertObservation(value, valuePath)
      },
    })
  }

  for (const [deductionId, definition] of mapEntries(source.deductions)) {
    const path: Path = ['deductions', deductionId]
    if (isRecord(definition.with)) {
      for (const [field, value] of Object.entries(definition.with)) {
        assertObservation(value, path.concat('with', field))
      }
    }
    if (isRecord(definition.prove) && Array.isArray(definition.prove.any)) {
      for (const [alternativeIndex, alternative] of definition.prove.any.entries()) {
        const alternativePath = path.concat('prove', 'any', alternativeIndex)
        const terms = Array.isArray(alternative)
          ? stringList(alternative)
          : isRecord(alternative)
            ? stringList(alternative.terms)
            : []
        const termsPath = Array.isArray(alternative)
          ? alternativePath
          : alternativePath.concat('terms')
        for (const [referenceIndex, reference] of terms.entries()) {
          if (!deductions.has(reference) && !observations.has(reference)) {
            collector.error(
              'E_UNKNOWN_OBSERVATION',
              `Unknown observation or deduction proof term '${reference}'.`,
              termsPath.concat(referenceIndex),
            )
          }
        }
        if (!isRecord(alternative) || !Array.isArray(alternative.checks)) continue
        const termSet = new Set(terms)
        const requireCheckObservation = (
          reference: unknown,
          referencePath: Path,
        ): unknown => {
          if (typeof reference !== 'string' || !observations.has(reference)) {
            collector.error(
              'E_PROOF_CHECK_REF',
              `Proof checks require a known observation reference; received '${String(reference)}'.`,
              referencePath,
            )
            return undefined
          }
          if (!termSet.has(reference)) {
            collector.error(
              'E_PROOF_CHECK_TERM',
              `Checked observation '${reference}' must also appear in the alternative's terms.`,
              referencePath,
            )
          }
          return observationSourceValue(source, reference)
        }
        for (const [checkIndex, rawCheck] of alternative.checks.entries()) {
          if (!isRecord(rawCheck)) continue
          const checkPath = alternativePath.concat('checks', checkIndex)
          const actual = requireCheckObservation(rawCheck.ref, checkPath.concat('ref'))
          if (actual === undefined) continue
          if (Object.hasOwn(rawCheck, 'equals') || Object.hasOwn(rawCheck, 'not_equals')) {
            const operator = Object.hasOwn(rawCheck, 'equals') ? 'equals' : 'not_equals'
            const expected = rawCheck[operator]
            if (jsonValueType(actual) !== jsonValueType(expected)) {
              collector.error(
                'E_PROOF_CHECK_TYPE',
                `${operator} compares '${String(rawCheck.ref)}' (${jsonValueType(actual)}) with ${jsonValueType(expected)}.`,
                checkPath.concat(operator),
              )
            }
          } else if (
            Object.hasOwn(rawCheck, 'less_than') ||
            Object.hasOwn(rawCheck, 'greater_than')
          ) {
            const operator = Object.hasOwn(rawCheck, 'less_than') ? 'less_than' : 'greater_than'
            if (typeof actual !== 'number' || !Number.isFinite(actual)) {
              collector.error(
                'E_PROOF_CHECK_TYPE',
                `${operator} requires '${String(rawCheck.ref)}' to report a finite number.`,
                checkPath.concat('ref'),
              )
            }
          } else if (Object.hasOwn(rawCheck, 'contains') || Object.hasOwn(rawCheck, 'count')) {
            const operator = Object.hasOwn(rawCheck, 'contains') ? 'contains' : 'count'
            if (!Array.isArray(actual)) {
              collector.error(
                'E_PROOF_CHECK_TYPE',
                `${operator} requires '${String(rawCheck.ref)}' to report an array.`,
                checkPath.concat('ref'),
              )
            }
          } else {
            const operator = Object.hasOwn(rawCheck, 'before') ? 'before' : 'after'
            const leftTime = parseComparableTime(actual)
            if (leftTime === undefined) {
              collector.error(
                'E_PROOF_CHECK_TYPE',
                `${operator} requires '${String(rawCheck.ref)}' to report a valid clock time or timestamp.`,
                checkPath.concat('ref'),
              )
            }
            const operand = isRecord(rawCheck[operator]) ? rawCheck[operator] as AnyRecord : {}
            if (typeof operand.ref === 'string') {
              const right = requireCheckObservation(
                operand.ref,
                checkPath.concat(operator, 'ref'),
              )
              if (right !== undefined) {
                const rightTime = parseComparableTime(right)
                if (rightTime === undefined) {
                  collector.error(
                    'E_PROOF_CHECK_TYPE',
                    `${operator} comparison '${operand.ref}' must report a valid clock time or timestamp.`,
                    checkPath.concat(operator, 'ref'),
                  )
                } else if (leftTime && leftTime.kind !== rightTime.kind) {
                  collector.error(
                    'E_PROOF_CHECK_TYPE',
                    `${operator} must compare two clock times or two absolute timestamps, not mix them.`,
                    checkPath.concat(operator),
                  )
                }
              }
            } else {
              const rightTime = parseComparableTime(operand.value)
              if (rightTime === undefined) {
                collector.error(
                  'E_PROOF_CHECK_TYPE',
                  `${operator} literal must be a valid clock time or timestamp.`,
                  checkPath.concat(operator, 'value'),
                )
              } else if (leftTime && leftTime.kind !== rightTime.kind) {
                collector.error(
                  'E_PROOF_CHECK_TYPE',
                  `${operator} must compare two clock times or two absolute timestamps, not mix them.`,
                  checkPath.concat(operator),
                )
              }
            }
          }
        }
      }
    }
    for (const [index, dependency] of stringList(definition.require).entries()) {
      assertKnown(
        collector,
        dependency,
        deductions,
        'E_UNKNOWN_DEDUCTION',
        'deduction',
        path.concat('require', index),
      )
      if (dependency === deductionId) {
        collector.error('E_DEDUCTION_CYCLE', `Deduction '${deductionId}' requires itself.`, path.concat('require', index))
      }
    }
  }

  if (isRecord(source.perspectives)) {
    for (const [actorId, perspective] of Object.entries(source.perspectives)) {
      assertKnown(collector, actorId, cast, 'E_UNKNOWN_ACTOR', 'actor', ['perspectives', actorId])
      if (!isRecord(perspective)) continue
      for (const [index, eventId] of stringList(perspective.knows).entries()) {
        assertKnown(
          collector,
          eventId,
          events,
          'E_UNKNOWN_TRUTH_EVENT',
          'truth event',
          ['perspectives', actorId, 'knows', index],
        )
      }
    }
  }

  if (isRecord(source.truth) && isRecord(source.truth.events)) {
    for (const [eventId, event] of Object.entries(source.truth.events)) {
      if (!isRecord(event)) continue
      const base: Path = ['truth', 'events', eventId]
      assertKnown(
        collector,
        event.actor,
        eventActors,
        'E_UNKNOWN_ENTITY',
        'event actor entity',
        base.concat('actor'),
      )
      if (Array.isArray(event.actors)) {
        for (const [index, actor] of event.actors.entries()) {
          assertKnown(
            collector,
            actor,
            eventActors,
            'E_UNKNOWN_ENTITY',
            'event actor entity',
            base.concat('actors', index),
          )
        }
      }
      assertKnown(collector, event.place, places, 'E_UNKNOWN_PLACE', 'place', base.concat('place'))
      for (const field of ['object', 'device', 'account', 'part', 'session']) {
        if (event[field] !== undefined) {
          assertKnown(collector, event[field], things, 'E_UNKNOWN_THING', 'thing', base.concat(field))
        }
      }
      const truthEvents = isRecord(source.truth.events) ? source.truth.events : {}
      if (event.target !== undefined && !things.has(String(event.target)) && !truthEvents[String(event.target)]) {
        collector.error('E_UNKNOWN_TARGET', `Unknown truth-event target '${String(event.target)}'.`, base.concat('target'))
      }
    }
  }

  const validateCondition = (condition: unknown, path: Path): void => {
    if (Array.isArray(condition)) {
      condition.forEach((item, index) => validateCondition(item, path.concat(index)))
      return
    }
    if (!isRecord(condition)) return
    for (const [key, value] of Object.entries(condition)) {
      const valuePath = path.concat(key)
      if (key === 'supported') assertKnown(collector, value, deductions, 'E_UNKNOWN_DEDUCTION', 'deduction', valuePath)
      else if (key === 'observed') assertObservation(value, valuePath)
      else if (key === 'marked' || key === 'not-marked') {
        assertKnown(collector, value, flags, 'E_UNKNOWN_FLAG', 'flag', valuePath)
      } else if (key === 'schedule-active') {
        assertKnown(collector, value, deadlines, 'E_UNKNOWN_DEADLINE', 'deadline', valuePath)
      } else if (key === 'all' || key === 'any' || key === 'unless') {
        validateCondition(value, valuePath)
      }
    }
  }

  const validateEffects = (effects: unknown, path: Path): void => {
    if (!Array.isArray(effects)) return
    effects.forEach((effect, index) => {
      if (!isRecord(effect)) return
      const effectPath = path.concat(index)
      if (Array.isArray(effect.trust)) {
        assertKnown(collector, effect.trust[0], cast, 'E_UNKNOWN_ACTOR', 'actor', effectPath.concat('trust', 0))
      }
      if (Array.isArray(effect.conversation)) {
        assertKnown(
          collector,
          effect.conversation[0],
          cast,
          'E_UNKNOWN_ACTOR',
          'actor',
          effectPath.concat('conversation', 0),
        )
        const actorId = effect.conversation[0]
        const stateId = effect.conversation[1]
        const conversation = typeof actorId === 'string' && isRecord(source.conversations)
          ? source.conversations[actorId]
          : undefined
        const states = isRecord(conversation) && isRecord(conversation.states)
          ? conversation.states
          : undefined
        if (typeof stateId === 'string' && (!states || !Object.hasOwn(states, stateId))) {
          collector.error(
            'E_UNKNOWN_CONVERSATION_STATE',
            `Unknown conversation state '${stateId}' for actor '${String(actorId)}'.`,
            effectPath.concat('conversation', 1),
          )
        }
      }
      for (const key of ['mark', 'unmark', 'if-marked']) {
        if (effect[key] !== undefined) {
          assertKnown(collector, effect[key], flags, 'E_UNKNOWN_FLAG', 'flag', effectPath.concat(key))
        }
      }
      for (const key of ['grant', 'revoke']) {
        if (effect[key] !== undefined) {
          assertKnown(collector, effect[key], evidence, 'E_UNKNOWN_EVIDENCE', 'evidence', effectPath.concat(key))
        }
      }
      for (const key of ['offer', 'withdraw']) {
        if (effect[key] !== undefined) {
          assertKnown(
            collector,
            effect[key],
            affordances,
            'E_UNKNOWN_AFFORDANCE',
            'affordance',
            effectPath.concat(key),
          )
        }
      }
      for (const key of ['cancel']) {
        if (effect[key] !== undefined) {
          assertKnown(collector, effect[key], deadlines, 'E_UNKNOWN_DEADLINE', 'deadline', effectPath.concat(key))
        }
      }
      if (Array.isArray(effect['bring-forward-by'])) {
        assertKnown(
          collector,
          effect['bring-forward-by'][0],
          deadlines,
          'E_UNKNOWN_DEADLINE',
          'deadline',
          effectPath.concat('bring-forward-by', 0),
        )
      }
      if (typeof effect.reveal === 'string') {
        const actorId = effect.reveal.split('.')[0]
        assertKnown(collector, actorId, cast, 'E_UNKNOWN_ACTOR', 'actor', effectPath.concat('reveal'))
      }
      if (Array.isArray(effect.reroute)) {
        assertKnown(
          collector,
          effect.reroute[0],
          evidence,
          'E_UNKNOWN_EVIDENCE',
          'evidence',
          effectPath.concat('reroute', 0),
        )
      }
      validateEffects(effect.then, effectPath.concat('then'))
    })
  }

  if (Array.isArray(source.reactions)) {
    source.reactions.forEach((reaction, index) => {
      if (!isRecord(reaction)) return
      const base: Path = ['reactions', index]
      if (isRecord(reaction.on) && typeof reaction.on.action === 'string') {
        const trigger = compileAction(reaction.on.action, reaction.on)
        const matchingOneShotAffordances = authoredAffordances.filter(([, affordance]) => (
          affordance.once !== false &&
          isRecord(affordance.action) &&
          hashCanonical(compileAction(String(affordance.action.action), affordance.action)) === hashCanonical(trigger)
        ))
        const rejectSelfOffers = (effects: unknown, path: Path): void => {
          if (!Array.isArray(effects)) return
          effects.forEach((effect, effectIndex) => {
            if (!isRecord(effect)) return
            const effectPath = path.concat(effectIndex)
            if (typeof effect.offer === 'string') {
              const affordance = matchingOneShotAffordances.find(([id]) => id === effect.offer)
              if (affordance) {
                collector.error(
                  'E_AFFORDANCE_SELF_REOFFER',
                  `Reaction for '${affordance[0]}' cannot offer the same one-shot affordance that its action consumes.`,
                  effectPath.concat('offer'),
                )
              }
            }
            rejectSelfOffers(effect.then, effectPath.concat('then'))
          })
        }
        rejectSelfOffers(reaction.do, base.concat('do'))
      }
      if (isRecord(reaction.on)) {
        if (reaction.on.supported !== undefined) {
          assertKnown(
            collector,
            reaction.on.supported,
            deductions,
            'E_UNKNOWN_DEDUCTION',
            'deduction',
            base.concat('on', 'supported'),
          )
        }
        if (reaction.on.observed !== undefined) {
          assertKnown(
            collector,
            reaction.on.observed,
            observations,
            'E_UNKNOWN_OBSERVATION',
            'observation',
            base.concat('on', 'observed'),
          )
        }
        if (reaction.on.evidence !== undefined) {
          assertKnown(
            collector,
            reaction.on.evidence,
            evidence,
            'E_UNKNOWN_EVIDENCE',
            'evidence',
            base.concat('on', 'evidence'),
          )
        }
      }
      validateCondition(reaction.when, base.concat('when'))
      validateCondition(reaction.unless, base.concat('unless'))
      validateEffects(reaction.do, base.concat('do'))
    })
  }

  for (const [deadlineId, deadline] of mapEntries(source.deadlines)) {
    if (deadline.cancel_on !== undefined) {
      assertKnown(
        collector,
        deadline.cancel_on,
        flags,
        'E_UNKNOWN_FLAG',
        'flag',
        ['deadlines', deadlineId, 'cancel_on'],
      )
    }
    validateEffects(deadline.do, ['deadlines', deadlineId, 'do'])
  }

  for (const [objectiveId, objective] of mapEntries(source.objectives)) {
    validateCondition(objective, ['objectives', objectiveId])
  }
  if (isRecord(source.assessment)) {
    for (const [categoryId, category] of mapEntries(source.assessment.categories)) {
      for (const [criterionId, criterion] of mapEntries(category.criteria)) {
        validateCondition(
          criterion.when,
          ['assessment', 'categories', categoryId, 'criteria', criterionId, 'when'],
        )
      }
    }
  }
  for (const [outcomeId, outcome] of mapEntries(source.outcomes)) {
    const base: Path = ['outcomes', outcomeId]
    for (const [index, objective] of stringList(outcome.require).entries()) {
      assertKnown(collector, objective, objectives, 'E_UNKNOWN_OBJECTIVE', 'objective', base.concat('require', index))
    }
    for (const [index, objective] of stringList(outcome.unless).entries()) {
      assertKnown(collector, objective, objectives, 'E_UNKNOWN_OBJECTIVE', 'objective', base.concat('unless', index))
    }
    if (outcome.when_marked !== undefined) {
      assertKnown(collector, outcome.when_marked, flags, 'E_UNKNOWN_FLAG', 'flag', base.concat('when_marked'))
    }
    for (const [index, flag] of stringList(outcome.when_any_marked).entries()) {
      assertKnown(collector, flag, flags, 'E_UNKNOWN_FLAG', 'flag', base.concat('when_any_marked', index))
    }
    for (const [index, actor] of stringOrList(outcome.final_target).entries()) {
      assertKnown(
        collector,
        actor,
        decisionTargets,
        'E_UNKNOWN_DECISION_TARGET',
        'decision target',
        base.concat('final_target', index),
      )
    }
  }

  validateDeductionGraph(source, collector, deductions)
  validateEvidenceReachability(source, collector, evidence, deductions, observations)
}

function visitUnlock(
  value: unknown,
  path: Path,
  visitors: {
    actor(value: unknown, path: Path): void
    observation(value: unknown, path: Path): void
  },
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitUnlock(item, path.concat(index), visitors))
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    const itemPath = path.concat(key)
    if (key === 'ref') visitors.observation(item, itemPath)
    else if (key === 'actor' || key === 'from') visitors.actor(item, itemPath)
    else if (key === 'trust' && Array.isArray(item)) visitors.actor(item[0], itemPath.concat(0))
    else visitUnlock(item, itemPath, visitors)
  }
}

function validateDeductionGraph(
  source: AnyRecord,
  collector: DiagnosticCollector,
  deductionIds: Set<string>,
): void {
  const edges = new Map<string, string[]>()
  for (const [id, definition] of mapEntries(source.deductions)) {
    const dependencies = new Set(stringList(definition.require))
    if (isRecord(definition.prove) && Array.isArray(definition.prove.any)) {
      for (const alternative of authoredProofAlternatives(definition)) {
        for (const candidate of alternative.terms) {
          if (typeof candidate === 'string' && deductionIds.has(candidate)) dependencies.add(candidate)
        }
      }
    }
    edges.set(id, [...dependencies])
  }

  const active = new Set<string>()
  const complete = new Set<string>()
  const visit = (id: string, chain: string[]): void => {
    if (complete.has(id)) return
    if (active.has(id)) {
      const cycleStart = chain.indexOf(id)
      const cycle = [...chain.slice(cycleStart), id]
      collector.error(
        'E_DEDUCTION_CYCLE',
        `Deduction dependency cycle: ${cycle.join(' -> ')}.`,
        ['deductions', id],
      )
      return
    }
    active.add(id)
    for (const dependency of edges.get(id) ?? []) visit(dependency, [...chain, id])
    active.delete(id)
    complete.add(id)
  }
  for (const id of [...edges.keys()].sort(compareCanonicalStrings)) visit(id, [])
}

function validateEvidenceReachability(
  source: AnyRecord,
  collector: DiagnosticCollector,
  evidenceIds: Set<string>,
  deductionIds: Set<string>,
  observationIds: Set<string>,
): void {
  const definitions = isRecord(source.evidence) ? source.evidence : {}
  const deductionDefinitions = isRecord(source.deductions) ? source.deductions : {}
  const evidenceMemo = new Map<string, boolean>()
  const deductionMemo = new Map<string, boolean>()

  const conditionReachable = (condition: unknown, active: Set<string>): boolean => {
    if (!isRecord(condition)) return typeof condition === 'string'
    if (Array.isArray(condition.any)) {
      return condition.any.some((candidate) => conditionReachable(candidate, new Set(active)))
    }
    if (isRecord(condition.after) && typeof condition.after.ref === 'string') {
      const reference = condition.after.ref
      return referenceReachable(reference, active)
    }
    if (typeof condition.ref === 'string') {
      return referenceReachable(condition.ref, active)
    }
    // Interview, request, search and trust gates are legal player routes.
    return true
  }

  const evidenceReachable = (id: string, active = new Set<string>()): boolean => {
    if (evidenceMemo.has(id)) return evidenceMemo.get(id) ?? false
    const token = `evidence:${id}`
    if (active.has(token)) return false
    const definition = definitions[id]
    if (!isRecord(definition)) return false
    if (definition.at === 'start') return true
    const next = new Set(active)
    next.add(token)
    const result = conditionReachable(definition.unlock, next)
    evidenceMemo.set(id, result)
    return result
  }

  const referenceReachable = (reference: unknown, active: Set<string>): boolean => {
    if (typeof reference !== 'string') return false
    if (observationIds.has(reference)) return evidenceReachable(reference.split('.')[0], active)
    if (deductionIds.has(reference)) return deductionReachable(reference, active)
    if (evidenceIds.has(reference)) return evidenceReachable(reference, active)
    return false
  }
  const deductionReachable = (id: string, active = new Set<string>()): boolean => {
    if (deductionMemo.has(id)) return deductionMemo.get(id) ?? false
    const token = `deduction:${id}`
    if (active.has(token)) return false
    const definition = deductionDefinitions[id]
    if (!isRecord(definition)) return false
    const next = new Set(active)
    next.add(token)
    const required = stringList(definition.require)
    if (required.length > 0) {
      const reachable = required.every((reference) => deductionReachable(reference, next))
      deductionMemo.set(id, reachable)
      return reachable
    }
    const explicitAlternatives = authoredProofAlternatives(definition)
    const alternatives = explicitAlternatives.length > 0
      ? explicitAlternatives.map(({ terms }) => terms)
      : isRecord(definition.with)
        ? [Object.values(definition.with)]
        : []
    const reachable = alternatives.some((alternative) =>
      alternative.every((reference) => referenceReachable(reference, next)),
    )
    deductionMemo.set(id, reachable)
    return reachable
  }

  for (const id of [...evidenceIds].sort(compareCanonicalStrings)) {
    if (!evidenceReachable(id)) {
      collector.error(
        'E_EVIDENCE_UNREACHABLE',
        `Evidence '${id}' has no route from opening evidence or a player action.`,
        ['evidence', id, 'unlock'],
      )
    }
  }

  for (const id of [...deductionIds].sort(compareCanonicalStrings)) {
    if (!deductionReachable(id)) {
      collector.error(
        'E_DEDUCTION_UNREACHABLE',
        `Deduction '${id}' has no complete legal evidence path.`,
        ['deductions', id],
      )
    }
  }
}

function publicSafetyErrors(manifest: PublicCaseManifest, openingIds: Set<string>): string[] {
  const errors: string[] = []
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}/${index}`))
      return
    }
    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PUBLIC_KEYS.has(key)) errors.push(`${path}/${key}`)
      visit(child, `${path}/${key}`)
    }
  }
  visit(manifest, '')
  for (const publicEvidence of manifest.opening.evidence) {
    if (!openingIds.has(publicEvidence.id)) errors.push(`/opening/evidence/${publicEvidence.id}`)
  }
  return errors
}

export function compileCaseSource(sourceText: string, options: CompileOptions = {}): CompileResult {
  const file = options.fileName ?? '<case-source>'
  const lineCounter = new LineCounter()
  const document = parseDocument(sourceText, {
    lineCounter,
    prettyErrors: false,
    uniqueKeys: true,
  })

  if (document.errors.length > 0) {
    const diagnostics = document.errors.map((error): CompilerDiagnostic => {
      const offset = error.pos?.[0] ?? 0
      const position = lineCounter.linePos(offset)
      return {
        code: 'E_YAML_PARSE',
        severity: 'error',
        message: error.message,
        path: '/',
        location: { file, line: position.line, column: position.col },
      }
    })
    return { ok: false, diagnostics }
  }

  const collector = new DiagnosticCollector(document, lineCounter, file)
  const source = document.toJS({ maxAliasCount: 100 }) as unknown
  if (!isRecord(source)) {
    collector.error('E_SOURCE_ROOT', 'Case source root must be a mapping.')
    return { ok: false, diagnostics: collector.diagnostics }
  }

  const localizationReferences = resolveTranslationReferences(
    source,
    collector,
    options.localization,
  )

  if (
    options.localization &&
    isRecord(source.case) &&
    typeof source.case.locale === 'string' &&
    source.case.locale !== options.localization.defaultLocale
  ) {
    collector.error(
      'E_I18N_DEFAULT_LOCALE',
      `case.locale '${source.case.locale}' must match localization default '${options.localization.defaultLocale}'.`,
      ['case', 'locale'],
    )
  }

  if (!validateSchema(source)) {
    for (const error of validateSchema.errors ?? []) {
      collector.error('E_SCHEMA', schemaMessage(error), schemaPath(error))
    }
  }
  if (collector.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics: collector.diagnostics }
  }

  const selectedManifests = resolveCapabilities(stringList(source.use), collector)
  const vocabulary = capabilityVocabulary(selectedManifests)
  validateCapabilityVocabulary(source, collector, vocabulary)
  validateTemplateExpansions(source, collector)
  validateDeadlineTiming(source, collector)
  validateAssessment(source, collector)
  validateEmittedEventCycles(source, collector)
  validateCrossReferences(source, collector)
  if (collector.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics: collector.diagnostics }
  }

  const caseDefinition = source.case as AnyRecord
  const timeDefinition = caseDefinition.time as AnyRecord
  const capabilities = makeCapabilityLocks(selectedManifests)
  const capabilityDigest = hashCanonical(capabilities)
  const sourceDigest = sha256(sourceText)
  const assets = buildAssets(source)
  const assetDigest = hashCanonical(assets)
  const { evidence, observations } = buildEvidence(source)
  const opening = toRecord(source.opening)
  const identity = {
    id: String(caseDefinition.id),
    version: String(caseDefinition.version),
    title: localizedText(caseDefinition.title),
    locale: String(caseDefinition.locale),
    durationMinutes: parseDuration(String(caseDefinition.duration)),
    mode: caseDefinition.mode as 'elastic' | 'strict',
    finalConclusion: caseDefinition.final_conclusion as 'first-write-wins' | 'replaceable',
    synopsis: localizedText(caseDefinition.synopsis),
    time: {
      date: String(timeDefinition.date),
      timezone: String(timeDefinition.timezone),
      startsAt: String(timeDefinition.starts_at),
      startMinute: parseClockMinute(String(timeDefinition.starts_at)),
    },
  }

  const irWithoutIntegrity = canonicalize({
    schema: 'case-ir/v0.2' as const,
    case: identity,
    localization: {
      defaultLocale: options.localization?.defaultLocale ?? String(caseDefinition.locale),
      references: localizationReferences,
    },
    capabilityLocks: capabilities,
    authoring: toRecord(source.authoring),
    assets,
    entities: {
      cast: toRecord(source.cast),
      places: toRecord(source.places),
      things: toRecord(source.things),
    },
    opening,
    evidence,
    observations,
    deductions: buildDeductions(source),
    affordances: buildAffordances(source),
    private: {
      truth: toRecord(source.truth),
      perspectives: toRecord(source.perspectives),
      reactions: buildReactions(source),
      conversations: buildConversations(source),
      flags: stringList(source.flags).sort(compareCanonicalStrings),
      deadlines: buildDeadlines(source, identity.time.startMinute),
      objectives: buildObjectives(source.objectives),
      outcomes: buildOutcomes(source.outcomes),
      ...(source.assessment !== undefined
        ? { assessment: buildAssessment(source.assessment) }
        : {}),
    },
  })
  const irDigest = hashCanonical(irWithoutIntegrity)
  const ir: CompiledCaseIR = {
    ...irWithoutIntegrity,
    integrity: {
      algorithm: 'sha256',
      source: sourceDigest,
      capabilities: capabilityDigest,
      assets: assetDigest,
      privateIr: irDigest,
    },
  }

  const openingEvidenceIds = new Set(
    isRecord(source.opening) ? stringList(source.opening.grants) : [],
  )
  const authoredPublicAssetIds = new Set(
    assets.filter((asset) => asset.visibility === 'public').map((asset) => asset.id),
  )
  const openingPublicAssets = evidence
    .filter((item) => openingEvidenceIds.has(item.id))
    .flatMap((item) => item.assetIds)
    .filter((assetId) => authoredPublicAssetIds.has(assetId))
    .filter((assetId, index, values) => values.indexOf(assetId) === index)
    .map((assetId) => assets.find((asset) => asset.id === assetId)?.handle)
    .filter((asset): asset is AssetHandle => asset !== undefined)
    .sort((left, right) => compareCanonicalStrings(left.id, right.id))
  const openingPublicAssetIds = new Set(openingPublicAssets.map((asset) => asset.id))
  const publicAssetDigest = hashCanonical(openingPublicAssets)
  const manifestWithoutIntegrity = canonicalize({
    schema: 'case-public/v0.2' as const,
    case: identity,
    cast: buildPublicCast(source.cast),
    places: buildPublicPlaces(source.places),
    assets: openingPublicAssets,
    opening: {
      call: isRecord(source.opening) ? toRecord(source.opening.call) : {},
      evidence: evidence
        .filter((item) => openingEvidenceIds.has(item.id))
        .map((item) => ({
          id: item.id,
          tool: item.tool,
          assets: item.assetIds
            .filter((assetId) => openingPublicAssetIds.has(assetId))
            .map((assetId) => assets.find((asset) => asset.id === assetId)?.handle)
            .filter((asset): asset is AssetHandle => asset !== undefined),
        })),
    },
  })
  const manifestDigest = hashCanonical(manifestWithoutIntegrity)
  const publicManifest: PublicCaseManifest = {
    ...manifestWithoutIntegrity,
    integrity: {
      algorithm: 'sha256',
      assets: publicAssetDigest,
      manifest: manifestDigest,
    },
  }

  for (const unsafePath of publicSafetyErrors(publicManifest, openingEvidenceIds)) {
    collector.error(
      'E_PUBLIC_DATA_LEAK',
      `Public manifest contains private or locked data at '${unsafePath}'.`,
    )
  }
  if (collector.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics: collector.diagnostics }
  }

  return {
    ok: true,
    diagnostics: collector.diagnostics,
    ir,
    publicManifest,
    canonicalIrJson: canonicalJson(ir),
    canonicalPublicManifestJson: canonicalJson(publicManifest),
  }
}

export class CaseCompileError extends Error {
  constructor(readonly diagnostics: CompilerDiagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join('\n'))
    this.name = 'CaseCompileError'
  }
}

export function compileCaseSourceOrThrow(
  sourceText: string,
  options: CompileOptions = {},
): Required<Pick<CompileResult, 'ir' | 'publicManifest' | 'canonicalIrJson' | 'canonicalPublicManifestJson'>> &
  Pick<CompileResult, 'diagnostics'> {
  const result = compileCaseSource(sourceText, options)
  if (!result.ok || !result.ir || !result.publicManifest || !result.canonicalIrJson || !result.canonicalPublicManifestJson) {
    throw new CaseCompileError(result.diagnostics)
  }
  return {
    diagnostics: result.diagnostics,
    ir: result.ir,
    publicManifest: result.publicManifest,
    canonicalIrJson: result.canonicalIrJson,
    canonicalPublicManifestJson: result.canonicalPublicManifestJson,
  }
}

export function formatDiagnostic(diagnostic: CompilerDiagnostic): string {
  const location = diagnostic.location
    ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.column}`
    : '<unknown>'
  return `${location} ${diagnostic.severity} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`
}

export function auditPublicManifest(manifest: PublicCaseManifest): string[] {
  return publicSafetyErrors(manifest, new Set(manifest.opening.evidence.map((item) => item.id)))
}
