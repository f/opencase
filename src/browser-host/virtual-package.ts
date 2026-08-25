import { parseAllDocuments, visit } from 'yaml'

import {
  createCaseLocalizationBundle,
  createCasePresentationCatalog,
  localizePublicCaseManifest,
  parseCaseTranslationCatalog,
} from '../case-package/localization-core'
import type { CaseLocalizationBundle, CaseTranslationCatalog } from '../case-package/types'
import {
  compileToKernelIR,
  createCaseRuntime,
  createCaseSessionController,
} from '../case-runtime'
import {
  compileCaseSource,
  hashCanonical,
  inspectCaseSourceLocalization,
  type CompiledCaseIR,
  type PublicCaseManifest,
} from '../compiler'
import { sha256Bytes } from '../compiler/digests'
import {
  auditContactDiscoveryCoverage,
} from '../simulator/contact-discovery-audit'
import { parseCaseTestSuite } from '../simulator/case-test-document-core'
import { runDetectiveCaseTest } from '../simulator/detective-runner'
import type { ShellPublicCaseManifest } from '../shell/manifest-workspace'

import { verifiedAssetBytes } from './asset-validation'
import { BrowserCaseImportError, importError } from './import-errors'
import type { BrowserPackageFiles } from './import-types'
import type { StaticCaseRuntimeBundle, StaticCaseRuntimeBundleUnsigned } from './static-bundle'

const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_CATALOG_BYTES = 256 * 1024
const MAX_TOTAL_CATALOG_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 256 * 1024 * 1024
const CATALOG_FILE = /^[a-z]{2}(?:-[A-Z]{2})?\.yml$/

type UnknownRecord = Record<string, unknown>

export interface CompiledBrowserAsset {
  readonly id: string
  readonly kind: string
  readonly mimeType: string
  readonly sha256: string
  readonly bytes: Uint8Array
}

export interface CompiledBrowserCase {
  readonly bundle: StaticCaseRuntimeBundle
  readonly bundleDigest: string
  readonly manifests: Readonly<Record<string, ShellPublicCaseManifest>>
  readonly defaultLocale: string
  readonly locales: readonly string[]
  readonly assets: readonly CompiledBrowserAsset[]
  readonly provenance: BrowserPackageFiles['provenance']
  readonly verification: {
    readonly level: 'conformance-passed' | 'compiler-and-smoke'
    readonly authoredTests: number
    readonly testSuiteDigest?: string
  }
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function safeYamlRoot(sourceText: string, label: string): UnknownRecord {
  const documents = parseAllDocuments(sourceText, {
    customTags: [],
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  if (documents.length !== 1) {
    throw importError('direct-yaml-invalid', `${label} must contain exactly one YAML document.`)
  }
  const document = documents[0]!
  const problems = [...document.errors, ...document.warnings]
  let hasAlias = false
  let hasExplicitTag = false
  visit(document, {
    Alias() { hasAlias = true },
    Node(_key, node) {
      if ('tag' in node && typeof node.tag === 'string' && node.tag.length > 0) hasExplicitTag = true
    },
  })
  if (problems.length > 0 || hasAlias || hasExplicitTag) {
    const detail = problems.map(({ message }) => message).join('; ')
    throw importError(
      'direct-yaml-invalid',
      hasAlias
        ? `${label} may not use YAML aliases.`
        : hasExplicitTag
          ? `${label} may not use explicit YAML tags.`
          : `${label} is not valid YAML${detail ? `: ${detail}` : '.'}`,
    )
  }
  const value = document.toJS({ maxAliasCount: 0 }) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw importError('direct-yaml-invalid', `${label} root must be a mapping.`)
  }
  return value as UnknownRecord
}

function exactFiles(input: BrowserPackageFiles): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const collisionKeys = new Set<string>()
  for (const file of input.files) {
    if (
      !file.path || file.path.startsWith('/') || file.path.includes('\\') || file.path.includes('\0') ||
      file.path.split('/').some((part) => part === '' || part === '.' || part === '..')
    ) throw importError('github-package-invalid', `Unsafe package path '${file.path}'.`)
    const collision = file.path.normalize('NFC').toLocaleLowerCase('en-US')
    if (collisionKeys.has(collision)) {
      throw importError('github-package-invalid', `Package path '${file.path}' is duplicated.`)
    }
    collisionKeys.add(collision)
    files.set(file.path, file.bytes)
  }
  return files
}

function sourceText(files: ReadonlyMap<string, Uint8Array>): string {
  const bytes = files.get('case.yml')
  if (!bytes) throw importError('case-validation-failed', 'Case package has no case.yml.')
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw importError('remote-import-too-large', `case.yml exceeds the ${MAX_SOURCE_BYTES}-byte limit.`, 413)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw importError('case-validation-failed', 'case.yml must be valid UTF-8.', 400, cause)
  }
}

function decodeText(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw importError('case-validation-failed', `${path} must be valid UTF-8.`, 400, cause)
  }
}

function directYamlContract(source: UnknownRecord, sourceTextValue: string): {
  readonly caseId: string
  readonly caseVersion: string
  readonly locale: string
} {
  if (Object.keys(record(source.assets)).length > 0) {
    throw importError('direct-yaml-assets-unsupported', 'Direct YAML imports cannot declare assets. Use a GitHub case package instead.')
  }
  for (const evidence of Object.values(record(source.evidence))) {
    if (Array.isArray(record(evidence).assets) && (record(evidence).assets as unknown[]).length > 0) {
      throw importError('direct-yaml-assets-unsupported', 'Direct YAML evidence cannot reference assets. Use a GitHub case package instead.')
    }
  }
  let inspection
  try {
    inspection = inspectCaseSourceLocalization(sourceTextValue)
  } catch (cause) {
    throw importError('direct-yaml-invalid', 'Direct case YAML is invalid.', 400, cause)
  }
  if (inspection.referenceKeys.length > 0) {
    throw importError('direct-yaml-i18n-unsupported', 'Direct YAML must use literal text because it has no translation catalogs.')
  }
  if (!inspection.caseId || !inspection.caseVersion || !inspection.defaultLocale) {
    throw importError('direct-yaml-invalid', 'Direct case YAML has no valid case identity.')
  }
  return {
    caseId: inspection.caseId,
    caseVersion: inspection.caseVersion,
    locale: inspection.defaultLocale,
  }
}

function directLocalization(identity: {
  readonly caseId: string
  readonly caseVersion: string
  readonly locale: string
}): CaseLocalizationBundle {
  const normalized = {
    schema: 'case-i18n/v0.1' as const,
    case: { id: identity.caseId, version: identity.caseVersion },
    locale: identity.locale,
    messages: {},
  }
  const catalog: CaseTranslationCatalog = {
    ...normalized,
    sourcePath: `i18n/${identity.locale}.yml`,
    digest: hashCanonical(normalized),
  }
  return createCaseLocalizationBundle({
    caseId: identity.caseId,
    caseVersion: identity.caseVersion,
    defaultLocale: identity.locale,
    referenceKeys: [],
    catalogs: [catalog],
  })
}

function githubLocalization(
  files: ReadonlyMap<string, Uint8Array>,
  irInspection: ReturnType<typeof inspectCaseSourceLocalization>,
): CaseLocalizationBundle {
  if (!irInspection.caseId || !irInspection.caseVersion || !irInspection.defaultLocale) {
    throw importError('case-validation-failed', 'Case source has no valid localization identity.')
  }
  const entries = [...files.entries()]
    .filter(([path]) => path.startsWith('i18n/'))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  let totalBytes = 0
  const catalogs: CaseTranslationCatalog[] = []
  for (const [path, bytes] of entries) {
    const fileName = path.slice('i18n/'.length)
    if (fileName.includes('/') || !CATALOG_FILE.test(fileName)) {
      throw importError('case-validation-failed', `Unexpected i18n entry '${fileName}'; only flat <locale>.yml files are allowed.`)
    }
    if (bytes.byteLength > MAX_CATALOG_BYTES) {
      throw importError('remote-import-too-large', `Translation catalog '${fileName}' exceeds the ${MAX_CATALOG_BYTES}-byte limit.`, 413)
    }
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_TOTAL_CATALOG_BYTES) {
      throw importError('remote-import-too-large', `Translation catalogs exceed the ${MAX_TOTAL_CATALOG_BYTES}-byte package limit.`, 413)
    }
    catalogs.push(parseCaseTranslationCatalog(decodeText(bytes, path), {
      sourcePath: path,
      expectedLocale: fileName.slice(0, -4),
      caseId: irInspection.caseId,
      caseVersion: irInspection.caseVersion,
    }))
  }
  return createCaseLocalizationBundle({
    caseId: irInspection.caseId,
    caseVersion: irInspection.caseVersion,
    defaultLocale: irInspection.defaultLocale,
    referenceKeys: irInspection.referenceKeys,
    catalogs,
  })
}

function compileIr(source: string, localization: CaseLocalizationBundle): CompiledCaseIR {
  const defaultMessages = localization.catalogs[localization.defaultLocale]!.messages
  const result = compileCaseSource(source, {
    fileName: 'case.yml',
    localization: {
      defaultLocale: localization.defaultLocale,
      availableKeys: new Set(Object.keys(defaultMessages)),
    },
  })
  if (!result.ok || !result.ir || !result.publicManifest) {
    throw new BrowserCaseImportError(
      'case-validation-failed',
      'The imported case did not pass package validation.',
      result.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.path,
        ...(diagnostic.location ? {
          line: diagnostic.location.line,
          column: diagnostic.location.column,
        } : {}),
      })),
    )
  }
  return result.ir
}

function publicManifestFor(
  ir: CompiledCaseIR,
  source: string,
  localization: CaseLocalizationBundle,
): { source: PublicCaseManifest; localized: Record<string, ShellPublicCaseManifest> } {
  const defaultMessages = localization.catalogs[localization.defaultLocale]!.messages
  const result = compileCaseSource(source, {
    fileName: 'case.yml',
    localization: {
      defaultLocale: localization.defaultLocale,
      availableKeys: new Set(Object.keys(defaultMessages)),
    },
  })
  if (!result.publicManifest || result.ir?.integrity.privateIr !== ir.integrity.privateIr) {
    throw importError('case-validation-failed', 'Case compiler returned inconsistent package artifacts.')
  }
  const localized = Object.fromEntries(localization.locales.map((locale) => [
    locale,
    localizePublicCaseManifest(result.publicManifest!, localization, locale).manifest as unknown as ShellPublicCaseManifest,
  ]))
  return { source: result.publicManifest, localized }
}

function bundleFileDigest(files: ReadonlyMap<string, Uint8Array>): string {
  return hashCanonical([...files.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, bytes]) => ({ path, size: bytes.byteLength, digest: sha256Bytes(bytes) })))
}

async function compileAssets(
  ir: CompiledCaseIR,
  files: ReadonlyMap<string, Uint8Array>,
  signal?: AbortSignal,
): Promise<readonly CompiledBrowserAsset[]> {
  const output: CompiledBrowserAsset[] = []
  let totalBytes = 0
  for (const asset of ir.assets) {
    const bytes = await verifiedAssetBytes(asset, files, signal)
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_TOTAL_ASSET_BYTES) {
      throw importError('remote-import-too-large', `Case assets exceed the ${MAX_TOTAL_ASSET_BYTES}-byte limit.`, 413)
    }
    output.push({
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      sha256: asset.integrity.digest,
      bytes,
    })
  }
  return output
}

function verifyGithubTests(
  ir: CompiledCaseIR,
  files: ReadonlyMap<string, Uint8Array>,
): CompiledBrowserCase['verification'] {
  const sources = [...files.entries()]
    .filter(([path]) => path.startsWith('tests/'))
    .map(([path, bytes]) => ({ fileName: path.slice('tests/'.length), sourceText: decodeText(bytes, path) }))
  const suite = parseCaseTestSuite(sources, ir, { packageRoot: '.', testsRoot: 'tests' })
  const tests = suite.scenarios.map((scenario) => runDetectiveCaseTest(ir, scenario))
  const contactDiscovery = auditContactDiscoveryCoverage(ir, suite.scenarios, tests)
  if (tests.some(({ ok }) => !ok) || !contactDiscovery.ok) {
    const diagnostics = tests
      .filter(({ ok }) => !ok)
      .flatMap((test) => test.failures.map((failure) => ({
        code: 'E_CASE_TEST_FAILED',
        path: `tests/${test.id}.yml`,
        message: `${failure.expectation}: ${failure.message}`,
      })))
    diagnostics.push(...contactDiscovery.items
      .filter(({ ok }) => !ok)
      .map((item) => ({
        code: 'E_CONTACT_DISCOVERY_COVERAGE',
        path: 'tests/',
        message: item.message ?? `Contact route for '${item.actorId}' is not covered.`,
      })))
    throw new BrowserCaseImportError(
      'case-tests-failed',
      'The imported case did not pass its authored detective tests.',
      diagnostics,
    )
  }
  return {
    level: 'conformance-passed',
    authoredTests: tests.length,
    testSuiteDigest: suite.digest,
  }
}

function smoke(ir: CompiledCaseIR): void {
  const kernel = compileToKernelIR(ir)
  let id = 0
  const runtime = createCaseRuntime(kernel, {
    ids: {
      nextCommandId: () => `browser-import-command-${++id}`,
      nextEventId: () => `browser-import-event-${++id}`,
    },
    wallClock: { now: () => 0 },
  })
  const snapshot = createCaseSessionController(runtime).getSnapshot()
  if (snapshot.case.digest !== kernel.digest || snapshot.status !== 'active') {
    throw importError('case-validation-failed', 'Direct case YAML could not start a safe game session.')
  }
}

export async function compileBrowserCasePackage(
  input: BrowserPackageFiles,
  signal?: AbortSignal,
): Promise<CompiledBrowserCase> {
  for (const directory of ['assets', 'i18n', 'tests']) {
    if (!input.directories.includes(directory)) {
      throw importError('case-validation-failed', `Case package is missing ${directory}/.`)
    }
  }
  const files = exactFiles(input)
  const source = sourceText(files)
  const sourceRoot = safeYamlRoot(source, input.provenance.kind === 'yaml' ? 'Direct case YAML' : 'case.yml')
  const inspection = inspectCaseSourceLocalization(source)
  const localization = input.provenance.kind === 'yaml'
    ? directLocalization(directYamlContract(sourceRoot, source))
    : githubLocalization(files, inspection)
  const ir = compileIr(source, localization)
  const kernel = compileToKernelIR(ir)
  const manifests = publicManifestFor(ir, source, localization).localized
  const assets = await compileAssets(ir, files, signal)
  const packageDigest = hashCanonical({
    privateIr: ir.integrity.privateIr,
    localization: localization.digest,
    localAssets: ir.assets
      .filter((asset) => asset.source.kind === 'local')
      .map((asset) => ({
        id: asset.id,
        digest: asset.integrity.digest,
        sizeBytes: assets.find(({ id }) => id === asset.id)!.bytes.byteLength,
      })),
  })
  const unsigned: StaticCaseRuntimeBundleUnsigned = {
    schema: 'case-static-runtime/v1',
    case: {
      id: ir.case.id,
      version: ir.case.version,
      kernelDigest: kernel.digest,
      packageDigest,
      defaultLocale: localization.defaultLocale,
    },
    kernelIr: kernel,
    presentations: Object.fromEntries(localization.locales.map((locale) => [
      locale,
      createCasePresentationCatalog(localization, locale),
    ])),
    assets: assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind as typeof ir.assets[number]['kind'],
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      url: `assets/${encodeURIComponent(asset.id)}`,
    })),
  }
  const runtimeBundle: StaticCaseRuntimeBundle = {
    ...unsigned,
    integrity: { algorithm: 'sha256', bundle: hashCanonical(unsigned) },
  }
  const verification = input.provenance.kind === 'github'
    ? verifyGithubTests(ir, files)
    : (smoke(ir), { level: 'compiler-and-smoke' as const, authoredTests: 0 })
  return {
    bundle: runtimeBundle,
    bundleDigest: bundleFileDigest(files),
    manifests,
    defaultLocale: localization.defaultLocale,
    locales: localization.locales,
    assets,
    provenance: input.provenance,
    verification,
  }
}
