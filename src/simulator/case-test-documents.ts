import Ajv, { type ErrorObject } from 'ajv'
import { constants, type Dirent } from 'node:fs'
import { lstat, open, readdir, realpath, type FileHandle } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { parseAllDocuments, visit } from 'yaml'

import { capabilityVocabulary, getCapabilityManifest } from '../capabilities'
import type { CaseAction } from '../case-runtime'
import { hashCanonical, type CompiledCaseIR, type JsonValue } from '../compiler'
import caseTestSchema from '../../schema/case-test.v0.1.schema.json'
import { CaseTestDocumentError } from './errors'
import type {
  CaseTestDeductionStatus,
  CaseTestAffordanceStatus,
  CaseTestEvidenceExpectation,
  CaseTestEvidenceStatus,
  CaseTestExpectation,
  CaseTestResultExpectation,
  CaseTestStateExpectation,
  DetectiveCaseTestScenario,
  DetectiveCaseTestStep,
  DetectiveCaseTestSuite,
  SimulatorClock,
} from './types'

export const CASE_TEST_MAX_FILE_BYTES = 256 * 1024
export const CASE_TEST_MAX_TOTAL_BYTES = 8 * 1024 * 1024
export const CASE_TEST_MAX_SCENARIOS = 256

const CASE_TEST_FILE = /^[a-z][a-z0-9_-]*\.yml$/
const OPERATION_KEYS = [
  'detective.observe',
  'detective.act',
  'detective.deduce',
  'detective.conclude',
  'detective.advance',
  'detective.resume',
] as const
const ACTION_FIELDS = [
  'target',
  'actor',
  'from',
  'topic',
  'evidence',
  'tone',
  'query',
  'ref',
] as const

type AnyRecord = Record<string, unknown>

export interface DiscoveredCaseTestFiles {
  readonly packageRoot: string
  readonly testsRoot: string
  readonly entryNames: readonly string[]
  readonly files: readonly string[]
}

export interface ParseCaseTestDocumentOptions {
  readonly fileName: string
  readonly ir: CompiledCaseIR
  readonly expectedScenarioId?: string
}

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true })
const validateCaseTest = ajv.compile(caseTestSchema)

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function record(value: unknown): AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : {}
}

function pointer(error: ErrorObject): string {
  const missing =
    error.keyword === 'required' && typeof error.params.missingProperty === 'string'
      ? `/${error.params.missingProperty.replaceAll('~', '~0').replaceAll('/', '~1')}`
      : ''
  return `${error.instancePath}${missing}` || '/'
}

function schemaMessage(errors: readonly ErrorObject[]): { message: string; path: string } {
  const ordered = [...errors].sort((left, right) => {
    const leftPath = pointer(left)
    const rightPath = pointer(right)
    return compareRaw(leftPath, rightPath) || compareRaw(left.keyword, right.keyword)
  })
  const first = ordered[0]
  if (!first) return { message: 'Document does not match case-test/v0.1.', path: '/' }
  const path = pointer(first)
  const detail = first.message ?? `failed '${first.keyword}' validation`
  return {
    message: `Case test schema violation at ${path}: ${detail}.`,
    path,
  }
}

function semanticError(sourceFile: string, path: string, message: string): never {
  throw new CaseTestDocumentError(
    'E_CASE_TEST_REFERENCE',
    `Case test reference error at ${path}: ${message}`,
    sourceFile,
    path,
  )
}

function durationMilliseconds(
  value: unknown,
  sourceFile: string,
  path: string,
  kind: 'positive' | 'elapsed',
): number {
  const valid =
    typeof value === 'string' &&
    (kind === 'positive'
      ? /^[1-9][0-9]*(?:s|m|h|d)$/.test(value)
      : /^(?:0s|[1-9][0-9]*(?:s|m|h|d))$/.test(value))
  const match = valid ? /^([0-9]+)(s|m|h|d)$/.exec(value) : null
  if (!match) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_SCHEMA',
      `Invalid duration at ${path}.`,
      sourceFile,
      path,
    )
  }
  const factor = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }[match[2] as 's' | 'm' | 'h' | 'd']
  const milliseconds = Number(match[1]) * factor
  if (!Number.isSafeInteger(milliseconds)) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_SCHEMA',
      `Duration at ${path} exceeds the safe millisecond range.`,
      sourceFile,
      path,
    )
  }
  return milliseconds
}

function resultExpectation(value: unknown): CaseTestResultExpectation | undefined {
  if (value === undefined) return undefined
  const definition = record(value)
  return definition.status === 'accepted'
    ? { status: 'accepted' }
    : { status: 'denied', code: String(definition.code) }
}

function stateExpectation(
  value: unknown,
  sourceFile: string,
  basePath: string,
): CaseTestStateExpectation | undefined {
  if (value === undefined) return undefined
  const definition = record(value)
  const output: {
    status?: 'active' | 'ended'
    clocks?: Partial<Record<SimulatorClock, number>>
    affordances?: Record<string, CaseTestAffordanceStatus>
    evidence?: Record<string, CaseTestEvidenceExpectation>
    observations?: Record<string, JsonValue>
    unknownObservations?: string[]
    deductions?: Record<string, CaseTestDeductionStatus>
    finalConclusion?: string | null
    outcome?: string | null
    assessment?: {
      score?: number
      maxScore?: number
      bandLabel?: string
    } | null
  } = {}

  if (definition.status === 'active' || definition.status === 'ended') {
    output.status = definition.status
  }
  if (definition.clocks !== undefined) {
    const authoredClocks = record(definition.clocks)
    const clocks: Partial<Record<SimulatorClock, number>> = {}
    for (const clock of ['wall', 'active', 'case-time'] as const) {
      if (authoredClocks[clock] !== undefined) {
        clocks[clock] = durationMilliseconds(
          authoredClocks[clock],
          sourceFile,
          `${basePath}/clocks/${clock}`,
          'elapsed',
        )
      }
    }
    output.clocks = clocks
  }
  if (definition.affordances !== undefined) {
    output.affordances = definition.affordances as Record<string, CaseTestAffordanceStatus>
  }
  if (definition.evidence !== undefined) {
    const authoredEvidence = record(definition.evidence)
    const evidence: Record<string, CaseTestEvidenceExpectation> = {}
    for (const id of Object.keys(authoredEvidence).sort(compareRaw)) {
      const authored = authoredEvidence[id]
      if (typeof authored === 'string') {
        evidence[id] = { status: authored as CaseTestEvidenceStatus }
      } else {
        const item = record(authored)
        evidence[id] = {
          status: item.status as CaseTestEvidenceStatus,
          ...(Array.isArray(item.assets)
            ? { assets: item.assets.map((assetId) => String(assetId)) }
            : {}),
        }
      }
    }
    output.evidence = evidence
  }
  if (definition.observations !== undefined) {
    output.observations = definition.observations as Record<string, JsonValue>
  }
  if (Array.isArray(definition.unknown_observations)) {
    output.unknownObservations = definition.unknown_observations.map((id) => String(id))
  }
  if (definition.deductions !== undefined) {
    output.deductions = definition.deductions as Record<string, CaseTestDeductionStatus>
  }
  if (Object.hasOwn(definition, 'final_conclusion')) {
    output.finalConclusion = definition.final_conclusion as string | null
  }
  if (Object.hasOwn(definition, 'outcome')) {
    output.outcome = definition.outcome as string | null
  }
  if (Object.hasOwn(definition, 'assessment')) {
    if (definition.assessment === null) {
      output.assessment = null
    } else {
      const authoredAssessment = record(definition.assessment)
      output.assessment = {
        ...(typeof authoredAssessment.score === 'number'
          ? { score: authoredAssessment.score }
          : {}),
        ...(typeof authoredAssessment.max_score === 'number'
          ? { maxScore: authoredAssessment.max_score }
          : {}),
        ...(typeof authoredAssessment.band_label === 'string'
          ? { bandLabel: authoredAssessment.band_label }
          : {}),
      }
    }
  }
  return output
}

function expectation(
  value: unknown,
  sourceFile: string,
  basePath: string,
): CaseTestExpectation | undefined {
  if (value === undefined) return undefined
  const definition = record(value)
  return {
    ...(definition.result !== undefined ? { result: resultExpectation(definition.result) } : {}),
    ...(definition.state !== undefined
      ? { state: stateExpectation(definition.state, sourceFile, `${basePath}/state`) }
      : {}),
  } as CaseTestExpectation
}

function action(value: unknown): CaseAction {
  const definition = record(value)
  const output: {
    action: string
    target?: string
    actor?: string
    from?: string
    topic?: string
    evidence?: string
    tone?: string
    query?: string
    ref?: string
  } = { action: String(definition.action) }
  for (const field of ACTION_FIELDS) {
    if (definition[field] !== undefined) output[field] = String(definition[field])
  }
  return output
}

function normalizeStep(
  value: unknown,
  sourceFile: string,
  index: number,
): DetectiveCaseTestStep {
  const definition = record(value)
  const basePath = `/scenario/steps/${index}`
  const expect = expectation(definition.expect, sourceFile, `${basePath}/expect`)
  const operation = OPERATION_KEYS.find((key) => Object.hasOwn(definition, key))
  if (!operation) {
    return {
      operation: 'expect',
      expect: expect as CaseTestExpectation & { state: CaseTestStateExpectation },
    }
  }
  if (operation === 'detective.observe') {
    return { operation: 'observe', evidenceId: String(definition[operation]), ...(expect ? { expect } : {}) }
  }
  if (operation === 'detective.act') {
    return { operation: 'act', action: action(definition[operation]), ...(expect ? { expect } : {}) }
  }
  if (operation === 'detective.deduce') {
    return { operation: 'deduce', deductionId: String(definition[operation]), ...(expect ? { expect } : {}) }
  }
  if (operation === 'detective.conclude') {
    return { operation: 'conclude', target: String(definition[operation]), ...(expect ? { expect } : {}) }
  }
  if (operation === 'detective.advance') {
    const authored = record(definition[operation])
    return {
      operation: 'advance',
      clock: authored.clock as SimulatorClock,
      byMs: durationMilliseconds(
        authored.by,
        sourceFile,
        `${basePath}/${operation}/by`,
        'positive',
      ),
      ...(expect ? { expect } : {}),
    }
  }
  const authored = record(definition[operation])
  return {
    operation: 'resume',
    afterMs: durationMilliseconds(
      authored.after,
      sourceFile,
      `${basePath}/${operation}/after`,
      'positive',
    ),
    ...(expect ? { expect } : {}),
  }
}

function expectedDenial(step: DetectiveCaseTestStep): string | undefined {
  const result = step.expect?.result
  return result?.status === 'denied' ? result.code : undefined
}

function allowedFinalTargets(ir: CompiledCaseIR): Set<string> {
  const targets = new Set(ir.private.outcomes.flatMap((outcome) => outcome.finalTargets))
  for (const reaction of ir.private.reactions) {
    if (
      reaction.trigger.kind === 'action' &&
      reaction.trigger.verb === 'submit-conclusion' &&
      reaction.trigger.target
    ) {
      targets.add(reaction.trigger.target)
    }
  }
  return targets
}

function validateStepReferences(
  step: DetectiveCaseTestStep,
  index: number,
  sourceFile: string,
  known: {
    evidence: ReadonlyMap<string, CompiledCaseIR['evidence'][number]>
    observations: ReadonlySet<string>
    deductions: ReadonlySet<string>
    affordances: ReadonlySet<string>
    outcomes: ReadonlySet<string>
    finalTargets: ReadonlySet<string>
    actions: ReadonlySet<string>
    assetHandles: ReadonlySet<string>
  },
): void {
  const basePath = `/scenario/steps/${index}`
  const denied = expectedDenial(step)
  if (step.operation === 'observe' && !known.evidence.has(step.evidenceId) && denied !== 'unknown-evidence') {
    semanticError(sourceFile, `${basePath}/detective.observe`, `Unknown evidence '${step.evidenceId}'.`)
  }
  if (step.operation === 'deduce' && !known.deductions.has(step.deductionId) && denied !== 'unknown-deduction') {
    semanticError(sourceFile, `${basePath}/detective.deduce`, `Unknown deduction '${step.deductionId}'.`)
  }
  if (step.operation === 'conclude' && !known.finalTargets.has(step.target) && denied !== 'invalid-final-target') {
    semanticError(sourceFile, `${basePath}/detective.conclude`, `Unknown final target '${step.target}'.`)
  }
  if (step.operation === 'act') {
    if (!known.actions.has(step.action.action) && denied !== 'unsupported-action') {
      semanticError(sourceFile, `${basePath}/detective.act/action`, `Unsupported action '${step.action.action}'.`)
    }
    if (
      step.action.action === 'submit-conclusion' &&
      (!step.action.target || !known.finalTargets.has(step.action.target)) &&
      denied !== 'invalid-final-target'
    ) {
      semanticError(
        sourceFile,
        `${basePath}/detective.act/target`,
        `Unknown final target '${step.action.target ?? '<missing>'}'.`,
      )
    }
    if (
      step.action.evidence &&
      !known.evidence.has(step.action.evidence) &&
      denied !== 'evidence-not-observed'
    ) {
      semanticError(
        sourceFile,
        `${basePath}/detective.act/evidence`,
        `Unknown evidence '${step.action.evidence}'.`,
      )
    }
  }

  const state = step.expect?.state
  if (!state) return
  for (const affordanceId of Object.keys(state.affordances ?? {})) {
    if (!known.affordances.has(affordanceId)) {
      semanticError(
        sourceFile,
        `${basePath}/expect/state/affordances/${affordanceId}`,
        `Unknown affordance '${affordanceId}'.`,
      )
    }
  }
  for (const [evidenceId, expected] of Object.entries(state.evidence ?? {})) {
    const evidence = known.evidence.get(evidenceId)
    if (!evidence) {
      semanticError(sourceFile, `${basePath}/expect/state/evidence/${evidenceId}`, `Unknown evidence '${evidenceId}'.`)
    }
    if (expected.status === 'hidden' && expected.assets !== undefined) {
      semanticError(
        sourceFile,
        `${basePath}/expect/state/evidence/${evidenceId}/assets`,
        'Hidden evidence cannot expose asset handles.',
      )
    }
    for (const assetId of expected.assets ?? []) {
      if (!known.assetHandles.has(assetId)) {
        semanticError(
          sourceFile,
          `${basePath}/expect/state/evidence/${evidenceId}/assets`,
          `Unknown asset handle '${assetId}'.`,
        )
      }
      if (!evidence.assetIds.includes(assetId)) {
        semanticError(
          sourceFile,
          `${basePath}/expect/state/evidence/${evidenceId}/assets`,
          `Asset '${assetId}' does not belong to evidence '${evidenceId}'.`,
        )
      }
    }
  }
  for (const observationId of Object.keys(state.observations ?? {})) {
    if (!known.observations.has(observationId)) {
      semanticError(
        sourceFile,
        `${basePath}/expect/state/observations/${observationId}`,
        `Unknown observation '${observationId}'.`,
      )
    }
  }
  for (const observationId of state.unknownObservations ?? []) {
    if (!known.observations.has(observationId)) {
      semanticError(
        sourceFile,
        `${basePath}/expect/state/unknown_observations`,
        `Unknown observation '${observationId}'.`,
      )
    }
    if (state.observations && Object.hasOwn(state.observations, observationId)) {
      semanticError(
        sourceFile,
        `${basePath}/expect/state/unknown_observations`,
        `Observation '${observationId}' cannot be both known and unknown.`,
      )
    }
  }
  for (const deductionId of Object.keys(state.deductions ?? {})) {
    if (!known.deductions.has(deductionId)) {
      semanticError(
        sourceFile,
        `${basePath}/expect/state/deductions/${deductionId}`,
        `Unknown deduction '${deductionId}'.`,
      )
    }
  }
  if (state.finalConclusion !== undefined && state.finalConclusion !== null && !known.finalTargets.has(state.finalConclusion)) {
    semanticError(
      sourceFile,
      `${basePath}/expect/state/final_conclusion`,
      `Unknown final target '${state.finalConclusion}'.`,
    )
  }
  if (state.outcome !== undefined && state.outcome !== null && !known.outcomes.has(state.outcome)) {
    semanticError(sourceFile, `${basePath}/expect/state/outcome`, `Unknown outcome '${state.outcome}'.`)
  }

}

function validateReferences(
  scenario: DetectiveCaseTestScenario,
  ir: CompiledCaseIR,
): void {
  const manifests = ir.capabilityLocks.map((lock) => getCapabilityManifest(lock.specifier))
  if (manifests.some((manifest) => !manifest)) {
    semanticError(scenario.sourceFile, '/case', 'Compiled case contains an unknown capability lock.')
  }
  const known = {
    evidence: new Map(ir.evidence.map((item) => [item.id, item])),
    observations: new Set(ir.observations.map((item) => item.id)),
    deductions: new Set(ir.deductions.map((item) => item.id)),
    affordances: new Set(ir.affordances.map((item) => item.id)),
    outcomes: new Set(ir.private.outcomes.map((item) => item.id)),
    finalTargets: allowedFinalTargets(ir),
    actions: capabilityVocabulary(manifests.filter((manifest) => manifest !== undefined)).verbs,
    assetHandles: new Set(ir.assets.map((asset) => asset.handle.id)),
  }
  scenario.steps.forEach((step, index) =>
    validateStepReferences(step, index, scenario.sourceFile, known),
  )
}

export function parseCaseTestDocument(
  sourceText: string,
  options: ParseCaseTestDocumentOptions,
): DetectiveCaseTestScenario {
  const documents = parseAllDocuments(sourceText, {
    customTags: [],
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  if (documents.length !== 1) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_YAML',
      `Case test must contain exactly one YAML document; found ${documents.length}.`,
      options.fileName,
    )
  }
  const document = documents[0]!
  const yamlProblems = [...document.errors, ...document.warnings]
  if (yamlProblems.length > 0) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_YAML',
      `Invalid case test YAML: ${yamlProblems.map((problem) => problem.message).join('; ')}`,
      options.fileName,
    )
  }
  let hasAlias = false
  visit(document, {
    Alias() {
      hasAlias = true
      return visit.BREAK
    },
  })
  if (hasAlias) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_YAML',
      'YAML aliases are not allowed in case tests.',
      options.fileName,
    )
  }

  const source = document.toJS({ maxAliasCount: 0 }) as unknown
  if (!validateCaseTest(source)) {
    const detail = schemaMessage(validateCaseTest.errors ?? [])
    throw new CaseTestDocumentError(
      'E_CASE_TEST_SCHEMA',
      detail.message,
      options.fileName,
      detail.path,
    )
  }

  const root = source as AnyRecord
  const caseIdentity = record(root.case)
  const scenario = record(root.scenario)
  const scenarioId = String(scenario.id)
  const expectedScenarioId = options.expectedScenarioId ?? basename(options.fileName, extname(options.fileName))
  if (scenarioId !== expectedScenarioId) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_IDENTITY',
      `Scenario id '${scenarioId}' must match filename '${expectedScenarioId}.yml'.`,
      options.fileName,
      '/scenario/id',
    )
  }
  if (caseIdentity.id !== options.ir.case.id || caseIdentity.version !== options.ir.case.version) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_IDENTITY',
      `Case test targets ${String(caseIdentity.id)}@${String(caseIdentity.version)}, but the compiled case is ${options.ir.case.id}@${options.ir.case.version}.`,
      options.fileName,
      '/case',
    )
  }

  const normalized: DetectiveCaseTestScenario = {
    schema: 'case-test/v0.1',
    sourceFile: options.fileName,
    case: { id: options.ir.case.id, version: options.ir.case.version },
    id: scenarioId,
    perspective: 'detective',
    ...(typeof scenario.description === 'string' ? { description: scenario.description } : {}),
    steps: (scenario.steps as unknown[]).map((step, index) =>
      normalizeStep(step, options.fileName, index),
    ),
  }
  validateReferences(normalized, options.ir)
  return normalized
}

async function requireRealDirectory(path: string, label: string): Promise<string> {
  let stats
  try {
    stats = await lstat(path)
  } catch {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_DIRECTORY',
      `${label} is missing: ${path}`,
      path,
    )
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_DIRECTORY',
      `${label} must be a real directory, not a symbolic link: ${path}`,
      path,
    )
  }
  return realpath(path)
}

function assertAllowedDirectoryEntry(entry: Dirent, testsRoot: string): boolean {
  const path = join(testsRoot, entry.name)
  if (entry.isSymbolicLink()) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_ENTRY',
      `Symbolic links are not allowed in tests/: ${entry.name}`,
      path,
    )
  }
  if (entry.name === 'README.md') {
    if (!entry.isFile()) {
      throw new CaseTestDocumentError(
        'E_CASE_TEST_ENTRY',
        'tests/README.md must be a regular file.',
        path,
      )
    }
    return false
  }
  if (!entry.isFile()) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_ENTRY',
      `tests/ must be flat and may contain only scenario .yml files and README.md: ${entry.name}`,
      path,
    )
  }
  if (extname(entry.name) === '.yaml') {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_ENTRY',
      `Scenario files must use the .yml extension, not .yaml: ${entry.name}`,
      path,
    )
  }
  if (!CASE_TEST_FILE.test(entry.name)) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_ENTRY',
      `Unsupported tests/ entry '${entry.name}'; expected <scenario-id>.yml or README.md.`,
      path,
    )
  }
  return true
}

export async function discoverCaseTestFiles(
  packageDirectory: string,
): Promise<DiscoveredCaseTestFiles> {
  const requestedRoot = resolve(packageDirectory)
  const packageRoot = await requireRealDirectory(requestedRoot, 'Case package directory')
  const testsRoot = await requireRealDirectory(join(packageRoot, 'tests'), 'Case tests directory')
  const entries = (await readdir(testsRoot, { withFileTypes: true })).sort((left, right) =>
    compareRaw(left.name, right.name),
  )
  const files = entries
    .filter((entry) => assertAllowedDirectoryEntry(entry, testsRoot))
    .map((entry) => join(testsRoot, entry.name))
  if (files.length === 0) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_DIRECTORY',
      'Case tests directory must contain at least one <scenario-id>.yml file.',
      testsRoot,
    )
  }
  if (files.length > CASE_TEST_MAX_SCENARIOS) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_LIMIT',
      `Case tests directory contains ${files.length} scenarios; the limit is ${CASE_TEST_MAX_SCENARIOS}.`,
      testsRoot,
    )
  }
  return { packageRoot, testsRoot, entryNames: entries.map((entry) => entry.name), files }
}

async function readExactTestFile(path: string): Promise<Uint8Array> {
  let before
  try {
    before = await lstat(path)
  } catch {
    throw new CaseTestDocumentError('E_CASE_TEST_READ', `Case test disappeared before it could be read: ${path}`, path)
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new CaseTestDocumentError('E_CASE_TEST_ENTRY', `Case test must be a regular file: ${path}`, path)
  }
  if (before.size > CASE_TEST_MAX_FILE_BYTES) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_LIMIT',
      `Case test exceeds the ${CASE_TEST_MAX_FILE_BYTES}-byte file limit: ${path}`,
      path,
    )
  }

  let handle: FileHandle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_READ',
      `Case test could not be opened without following links: ${path}`,
      path,
    )
  }
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new CaseTestDocumentError(
        'E_CASE_TEST_READ',
        `Case test changed while it was being opened: ${path}`,
        path,
      )
    }
    const bytes = await handle.readFile()
    const after = await lstat(path)
    const afterOpen = await handle.stat()
    if (
      bytes.byteLength !== opened.size ||
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      afterOpen.size !== opened.size ||
      afterOpen.mtimeMs !== opened.mtimeMs
    ) {
      throw new CaseTestDocumentError(
        'E_CASE_TEST_READ',
        `Case test changed while it was being read: ${path}`,
        path,
      )
    }
    return bytes
  } finally {
    await handle.close()
  }
}

export async function loadCaseTestSuite(
  packageDirectory: string,
  ir: CompiledCaseIR,
): Promise<DetectiveCaseTestSuite> {
  const discovered = await discoverCaseTestFiles(packageDirectory)
  let totalBytes = 0
  const scenarios: DetectiveCaseTestScenario[] = []
  for (const file of discovered.files) {
    const bytes = await readExactTestFile(file)
    totalBytes += bytes.byteLength
    if (totalBytes > CASE_TEST_MAX_TOTAL_BYTES) {
      throw new CaseTestDocumentError(
        'E_CASE_TEST_LIMIT',
        `Case test suite exceeds the ${CASE_TEST_MAX_TOTAL_BYTES}-byte total limit.`,
        discovered.testsRoot,
      )
    }
    let sourceText: string
    try {
      sourceText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new CaseTestDocumentError(
        'E_CASE_TEST_UTF8',
        `Case test must be valid UTF-8: ${file}`,
        file,
      )
    }
    scenarios.push(
      parseCaseTestDocument(sourceText, {
        fileName: file,
        expectedScenarioId: basename(file, '.yml'),
        ir,
      }),
    )
  }

  const namesAfterRead = (await readdir(discovered.testsRoot, { withFileTypes: true }))
    .sort((left, right) => compareRaw(left.name, right.name))
    .map((entry) => entry.name)
  if (
    namesAfterRead.length !== discovered.entryNames.length ||
    namesAfterRead.some((name, index) => name !== discovered.entryNames[index])
  ) {
    throw new CaseTestDocumentError(
      'E_CASE_TEST_READ',
      'Case tests directory changed while the suite was being loaded.',
      discovered.testsRoot,
    )
  }

  return {
    packageRoot: discovered.packageRoot,
    testsRoot: discovered.testsRoot,
    digest: hashCanonical({
      schema: 'case-test-suite/v0.1',
      scenarios: scenarios.map(({ sourceFile, ...scenario }) => ({
        file: basename(sourceFile),
        ...scenario,
      })),
    }),
    scenarios,
  }
}
