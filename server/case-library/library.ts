import { createHash, randomUUID } from 'node:crypto'
import { constants, type Dirent } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { parseAllDocuments, visit } from 'yaml'

import {
  compileCasePackage,
  type CompiledCasePackage,
} from '../../src/case-package'
import { CasePackageError } from '../../src/case-package/types'
import {
  compileToKernelIR,
  createCaseRuntime,
  createCaseSessionController,
} from '../../src/case-runtime'
import { hashCanonical, inspectCaseSourceLocalization } from '../../src/compiler'
import { runCasePackageConformance } from '../../src/simulator'
import type { DemoCaseRegistry } from '../demo-host/registry'

import { createSafeRemoteLoader, displaySafeUrl } from './remote-loader'
import {
  CaseImportError,
  type CaseImportDiagnostic,
  type CaseImportProvenance,
  type CaseImportRemoteLoader,
  type CaseImportRequest,
  type ImportedCase,
  type InstalledCaseLibraryRecord,
  type PublicCaseLibraryEntry,
  type RemoteLoadResponse,
} from './types'

const MAX_CASE_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_GITHUB_LIST_BYTES = 4 * 1024 * 1024
const MAX_GITHUB_FILE_BYTES = 64 * 1024 * 1024
const MAX_GITHUB_PACKAGE_BYTES = 256 * 1024 * 1024
const MAX_GITHUB_BLOB_RESPONSE_BYTES = MAX_GITHUB_FILE_BYTES * 2 + 1024 * 1024
const MAX_GITHUB_ENTRIES = 1_024
const MAX_REPOSITORY_PATH_BYTES = 1_024
const GITHUB_API_HEADERS = Object.freeze({
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
})
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]{1,100}$/
const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[a-f0-9]{64}$/
const GITHUB_COMMIT = /^[a-f0-9]{40}$/

type UnknownRecord = Record<string, unknown>

interface GithubTarget {
  readonly owner: string
  readonly repository: string
  readonly commit: string
  readonly packagePath: string
  readonly displayUrl: string
}

interface GithubContentEntry {
  readonly name: string
  readonly path: string
  readonly type: string
  readonly sha: string
  readonly size: number
  readonly gitUrl?: string
}

interface StagedImport {
  readonly packageRoot: string
  readonly provenance: CaseImportProvenance
  readonly verification: 'github' | 'yaml'
}

export interface CreateCaseLibraryOptions {
  readonly rootDirectory: string
  readonly remoteLoader?: CaseImportRemoteLoader
  readonly registry?: DemoCaseRegistry
  readonly now?: () => Date
  readonly nextInstallationId?: () => string
}

export interface CaseLibrary {
  importCase(userId: string, request: CaseImportRequest, signal?: AbortSignal): Promise<ImportedCase>
  list(userId: string): Promise<readonly PublicCaseLibraryEntry[]>
  resolve(userId: string, installationId: string): Promise<ImportedCase>
  /** Rehydrates a user's persisted packages into the live host registry. */
  registerInstalled(userId: string): Promise<readonly PublicCaseLibraryEntry[]>
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new CaseImportError(
      'remote-import-failed',
      `${label} must be valid UTF-8.`,
      [],
      error,
    )
  }
}

function safeYamlRoot(sourceText: string, label: string): UnknownRecord {
  const documents = parseAllDocuments(sourceText, {
    customTags: [],
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  if (documents.length !== 1) {
    throw new CaseImportError(
      'direct-yaml-invalid',
      `${label} must contain exactly one YAML document.`,
    )
  }
  const document = documents[0]!
  const problems = [...document.errors, ...document.warnings]
  let hasAlias = false
  let hasExplicitTag = false
  visit(document, {
    Alias() {
      hasAlias = true
    },
    Node(_key, node) {
      if ('tag' in node && typeof node.tag === 'string' && node.tag.length > 0) {
        hasExplicitTag = true
      }
    },
  })
  if (problems.length > 0 || hasAlias || hasExplicitTag) {
    const detail = problems.map(({ message }) => message).join('; ')
    throw new CaseImportError(
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
    throw new CaseImportError('direct-yaml-invalid', `${label} root must be a mapping.`)
  }
  return value as UnknownRecord
}

function exactRequest(request: CaseImportRequest): void {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new CaseImportError('invalid-import-request', 'Import request must be an object.')
  }
  const keys = Object.keys(request)
  if (
    keys.length !== 2 ||
    !keys.includes('kind') ||
    !keys.includes('url') ||
    (request.kind !== 'github' && request.kind !== 'yaml') ||
    typeof request.url !== 'string'
  ) {
    throw new CaseImportError(
      'invalid-import-request',
      "Import request must contain only 'kind' and 'url'.",
    )
  }
}

function exactUserId(userId: string): string {
  if (typeof userId !== 'string' || userId.trim().length === 0 || userId.length > 256) {
    throw new CaseImportError('invalid-import-request', 'A valid host-owned user is required.')
  }
  return userId
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stats = await lstat(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new CaseImportError(
      'case-library-storage',
      'Case library storage must use real private directories.',
    )
  }
  await chmod(path, 0o700)
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(value, 'utf8')
    await handle.sync()
    await handle.close()
    try {
      // Linking a fully synced private temporary file publishes the record in
      // one step and, unlike rename, never overwrites an existing install ID.
      await link(temporary, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CaseImportError(
          'case-library-storage',
          'Case installation ID already exists.',
          [],
          error,
        )
      }
      throw error
    }
  } finally {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}

function githubApiPath(...segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join('/')
}

async function remoteJson(
  loader: CaseImportRemoteLoader,
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ response: RemoteLoadResponse; value?: unknown }> {
  const response = await loader.load(url, {
    maxBytes,
    headers: GITHUB_API_HEADERS,
    signal,
  })
  if (response.body.byteLength > maxBytes) {
    throw new CaseImportError(
      'remote-import-too-large',
      `Remote response exceeds the ${maxBytes}-byte limit.`,
    )
  }
  if (response.status < 200 || response.status >= 300) return { response }
  try {
    return { response, value: JSON.parse(decodeUtf8(response.body, 'GitHub response')) }
  } catch (error) {
    if (error instanceof CaseImportError) throw error
    throw new CaseImportError(
      'remote-import-failed',
      'GitHub returned malformed JSON.',
      [],
      error,
    )
  }
}

function githubSegments(urlValue: string): {
  owner: string
  repository: string
  mode: 'repository' | 'tree' | 'blob'
  tail: string[]
  displayUrl: string
} {
  const url = new URL(displaySafeUrl(urlValue))
  const authoredUrl = new URL(urlValue)
  if (url.hostname.toLowerCase() !== 'github.com' || authoredUrl.search) {
    throw new CaseImportError(
      'github-url-unsupported',
      'GitHub imports require a public github.com repository, tree, or case.yml URL.',
    )
  }
  let segments: string[]
  try {
    segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch (error) {
    throw new CaseImportError('github-url-unsupported', 'GitHub URL path is invalid.', [], error)
  }
  if (segments.length < 2) {
    throw new CaseImportError('github-url-unsupported', 'GitHub URL must name a repository.')
  }
  const owner = segments[0]!
  const repository = segments[1]!.replace(/\.git$/i, '')
  if (!GITHUB_OWNER.test(owner) || !GITHUB_REPOSITORY.test(repository)) {
    throw new CaseImportError('github-url-unsupported', 'GitHub owner or repository name is invalid.')
  }
  if (segments.length === 2) {
    return { owner, repository, mode: 'repository', tail: [], displayUrl: url.toString() }
  }
  const mode = segments[2]
  if ((mode !== 'tree' && mode !== 'blob') || segments.length < 4) {
    throw new CaseImportError(
      'github-url-unsupported',
      'GitHub URL must point to a repository, folder, or case.yml file.',
    )
  }
  if (mode === 'blob' && segments.at(-1) !== 'case.yml') {
    throw new CaseImportError(
      'github-url-unsupported',
      'A GitHub file import must point to case.yml.',
    )
  }
  return {
    owner,
    repository,
    mode,
    tail: segments.slice(3),
    displayUrl: url.toString(),
  }
}

function githubUrl(owner: string, repository: string, suffix: string): string {
  return `https://api.github.com/repos/${githubApiPath(owner, repository)}/${suffix}`
}

async function githubCommit(
  loader: CaseImportRemoteLoader,
  owner: string,
  repository: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const { response, value } = await remoteJson(
    loader,
    githubUrl(owner, repository, `commits/${encodeURIComponent(ref)}`),
    2 * 1024 * 1024,
    signal,
  )
  if (response.status === 404 || response.status === 422) return undefined
  if (response.status !== 200) {
    throw new CaseImportError(
      'remote-import-failed',
      `GitHub could not resolve the requested revision (${response.status}).`,
    )
  }
  const sha = string(record(value).sha)
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
    throw new CaseImportError('remote-import-failed', 'GitHub returned an invalid commit identity.')
  }
  return sha.toLowerCase()
}

function normalizeRepositoryPath(value: string): string {
  if (
    value.includes('\\') ||
    value.includes('\0') ||
    isAbsolute(value) ||
    Buffer.byteLength(value, 'utf8') > MAX_REPOSITORY_PATH_BYTES
  ) {
    throw new CaseImportError('github-package-invalid', 'Repository contains an unsafe path.')
  }
  if (value === '') return ''
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new CaseImportError('github-package-invalid', 'Repository contains path traversal.')
  }
  return segments.join('/')
}

function contentEntry(value: unknown): GithubContentEntry {
  const input = record(value)
  const path = normalizeRepositoryPath(String(input.path ?? ''))
  const name = String(input.name ?? '')
  const type = String(input.type ?? '')
  const sha = String(input.sha ?? '')
  const size = Number(input.size ?? 0)
  if (
    !name ||
    basename(path) !== name ||
    !['file', 'dir', 'symlink', 'submodule'].includes(type) ||
    !/^[a-f0-9]{40}$/i.test(sha) ||
    !Number.isSafeInteger(size) ||
    size < 0
  ) {
    throw new CaseImportError('github-package-invalid', 'GitHub returned an invalid package entry.')
  }
  return {
    name,
    path,
    type,
    sha: sha.toLowerCase(),
    size,
    ...(typeof input.git_url === 'string' ? { gitUrl: input.git_url } : {}),
  }
}

async function githubDirectory(
  loader: CaseImportRemoteLoader,
  target: Pick<GithubTarget, 'owner' | 'repository' | 'commit'>,
  path: string,
  signal?: AbortSignal,
): Promise<GithubContentEntry[] | undefined> {
  const suffix = path
    ? `contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${target.commit}`
    : `contents?ref=${target.commit}`
  const { response, value } = await remoteJson(
    loader,
    githubUrl(target.owner, target.repository, suffix),
    MAX_GITHUB_LIST_BYTES,
    signal,
  )
  if (response.status === 404) return undefined
  if (response.status !== 200 || !Array.isArray(value)) {
    throw new CaseImportError(
      'remote-import-failed',
      `GitHub could not list the case package (${response.status}).`,
    )
  }
  return value.map(contentEntry)
}

async function findRepositoryPackagePath(
  loader: CaseImportRemoteLoader,
  target: Pick<GithubTarget, 'owner' | 'repository' | 'commit'>,
  signal?: AbortSignal,
): Promise<string> {
  const root = await githubDirectory(loader, target, '', signal)
  if (!root) throw new CaseImportError('github-case-not-found', 'Repository could not be read.')
  if (root.some(({ name, type }) => name === 'case.yml' && type === 'file')) return ''
  const children = root.filter(({ type }) => type === 'dir').slice(0, 33)
  if (children.length > 32) {
    throw new CaseImportError(
      'github-case-not-found',
      'Repository has too many folders to choose a case automatically. Use a folder URL.',
    )
  }
  const candidates: string[] = []
  for (const child of children) {
    const entries = await githubDirectory(loader, target, child.path, signal)
    if (entries?.some(({ name, type }) => name === 'case.yml' && type === 'file')) {
      candidates.push(child.path)
    }
  }
  if (candidates.length !== 1) {
    throw new CaseImportError(
      'github-case-not-found',
      candidates.length === 0
        ? 'No case.yml was found at the repository root or an immediate child.'
        : 'Repository contains multiple cases. Import a specific GitHub folder URL.',
    )
  }
  return candidates[0]!
}

async function resolveGithubTarget(
  loader: CaseImportRemoteLoader,
  inputUrl: string,
  signal?: AbortSignal,
): Promise<GithubTarget> {
  const parsed = githubSegments(inputUrl)
  let commit: string | undefined
  let packagePath = ''
  if (parsed.mode === 'repository') {
    const { response, value } = await remoteJson(
      loader,
      githubUrl(parsed.owner, parsed.repository, ''),
      2 * 1024 * 1024,
      signal,
    )
    if (response.status !== 200) {
      throw new CaseImportError(
        'remote-import-failed',
        `GitHub repository is unavailable (${response.status}).`,
      )
    }
    const defaultBranch = string(record(value).default_branch)
    if (!defaultBranch) {
      throw new CaseImportError('remote-import-failed', 'GitHub repository has no default branch.')
    }
    commit = await githubCommit(
      loader,
      parsed.owner,
      parsed.repository,
      defaultBranch,
      signal,
    )
    if (!commit) throw new CaseImportError('github-ref-not-found', 'Default branch was not found.')
    packagePath = await findRepositoryPackagePath(loader, {
      owner: parsed.owner,
      repository: parsed.repository,
      commit,
    }, signal)
  } else {
    for (let split = parsed.tail.length; split >= 1; split -= 1) {
      const candidateRef = parsed.tail.slice(0, split).join('/')
      const candidateCommit = await githubCommit(
        loader,
        parsed.owner,
        parsed.repository,
        candidateRef,
        signal,
      )
      if (!candidateCommit) continue
      const remainder = parsed.tail.slice(split)
      if (parsed.mode === 'blob') {
        if (remainder.at(-1) !== 'case.yml') continue
        remainder.pop()
      }
      commit = candidateCommit
      packagePath = normalizeRepositoryPath(remainder.join('/'))
      break
    }
    if (!commit) {
      throw new CaseImportError('github-ref-not-found', 'GitHub branch or commit was not found.')
    }
    if (parsed.mode === 'tree' && packagePath === '') {
      packagePath = await findRepositoryPackagePath(loader, {
        owner: parsed.owner,
        repository: parsed.repository,
        commit,
      }, signal)
    }
  }
  return {
    owner: parsed.owner,
    repository: parsed.repository,
    commit,
    packagePath,
    displayUrl: parsed.displayUrl,
  }
}

function expectedGithubPath(packagePath: string, relativePath: string): string {
  return [packagePath, relativePath].filter(Boolean).join('/')
}

function gitBlobDigest(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex')
}

async function githubBlob(
  loader: CaseImportRemoteLoader,
  target: GithubTarget,
  entry: GithubContentEntry,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (entry.size > MAX_GITHUB_FILE_BYTES) {
    throw new CaseImportError(
      'remote-import-too-large',
      `Case file '${entry.name}' exceeds the ${MAX_GITHUB_FILE_BYTES}-byte limit.`,
    )
  }
  const { response, value } = await remoteJson(
    loader,
    githubUrl(target.owner, target.repository, `git/blobs/${entry.sha}`),
    Math.min(MAX_GITHUB_BLOB_RESPONSE_BYTES, entry.size * 2 + 1024 * 1024),
    signal,
  )
  const blob = record(value)
  if (response.status !== 200 || blob.encoding !== 'base64' || typeof blob.content !== 'string') {
    throw new CaseImportError(
      'remote-import-failed',
      `GitHub could not download '${entry.name}' (${response.status}).`,
    )
  }
  const bytes = Buffer.from(blob.content.replace(/\s+/g, ''), 'base64')
  if (bytes.byteLength !== entry.size || gitBlobDigest(bytes) !== entry.sha) {
    throw new CaseImportError(
      'github-package-invalid',
      `GitHub content identity changed for '${entry.name}'.`,
    )
  }
  if (
    bytes.byteLength < 200 &&
    Buffer.from(bytes).toString('utf8').startsWith('version https://git-lfs.github.com/spec/')
  ) {
    throw new CaseImportError(
      'github-package-invalid',
      `Git LFS pointer '${entry.name}' is not a downloadable case asset.`,
    )
  }
  return bytes
}

async function writeStagedFile(packageRoot: string, relativePath: string, bytes: Uint8Array): Promise<void> {
  const normalized = normalizeRepositoryPath(relativePath)
  const destination = resolve(packageRoot, normalized)
  if (!isWithin(packageRoot, destination)) {
    throw new CaseImportError('github-package-invalid', 'Repository path escaped the case package.')
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  const handle = await open(destination, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function stageGithubPackage(
  loader: CaseImportRemoteLoader,
  inputUrl: string,
  packageRoot: string,
  signal?: AbortSignal,
): Promise<StagedImport> {
  const target = await resolveGithubTarget(loader, inputUrl, signal)
  const root = await githubDirectory(loader, target, target.packagePath, signal)
  if (!root) throw new CaseImportError('github-case-not-found', 'GitHub case folder was not found.')
  const rootNames = new Set<string>()
  for (const entry of root) {
    const collisionKey = entry.name.normalize('NFC').toLocaleLowerCase('en-US')
    if (rootNames.has(collisionKey)) {
      throw new CaseImportError('github-package-invalid', 'GitHub package contains colliding root names.')
    }
    rootNames.add(collisionKey)
  }
  const byName = new Map(root.map((entry) => [entry.name, entry]))
  const caseSource = byName.get('case.yml')
  if (!caseSource || caseSource.type !== 'file') {
    throw new CaseImportError('github-case-not-found', 'Selected GitHub folder has no case.yml.')
  }
  for (const directory of ['assets', 'i18n', 'tests']) {
    const entry = byName.get(directory)
    if (!entry || entry.type !== 'dir') {
      throw new CaseImportError(
        'github-package-invalid',
        `GitHub case package must contain a real ${directory}/ directory.`,
      )
    }
    await mkdir(join(packageRoot, directory), { recursive: true, mode: 0o700 })
  }

  let entriesSeen = 0
  let totalBytes = 0
  const seenPaths = new Set<string>()
  const include = async (entry: GithubContentEntry, relativePath: string): Promise<void> => {
    entriesSeen += 1
    if (entriesSeen > MAX_GITHUB_ENTRIES) {
      throw new CaseImportError(
        'remote-import-too-large',
        `GitHub package exceeds the ${MAX_GITHUB_ENTRIES}-entry limit.`,
      )
    }
    const collisionKey = relativePath.normalize('NFC').toLocaleLowerCase('en-US')
    if (seenPaths.has(collisionKey)) {
      throw new CaseImportError('github-package-invalid', `GitHub package path '${relativePath}' is duplicated.`)
    }
    seenPaths.add(collisionKey)
    const expected = expectedGithubPath(target.packagePath, relativePath)
    if (entry.path !== expected) {
      throw new CaseImportError('github-package-invalid', 'GitHub returned a mismatched package path.')
    }
    if (entry.type === 'symlink' || entry.type === 'submodule') {
      throw new CaseImportError(
        'github-package-invalid',
        `GitHub package may not contain ${entry.type} entry '${relativePath}'.`,
      )
    }
    if (entry.type === 'dir') {
      const children = await githubDirectory(loader, target, entry.path, signal)
      if (!children) {
        throw new CaseImportError('github-package-invalid', `GitHub folder '${relativePath}' disappeared.`)
      }
      await mkdir(join(packageRoot, relativePath), { recursive: true, mode: 0o700 })
      for (const child of children) {
        await include(child, `${relativePath}/${child.name}`)
      }
      return
    }
    if (entry.type !== 'file') {
      throw new CaseImportError('github-package-invalid', `Unsupported GitHub entry '${relativePath}'.`)
    }
    if (
      (relativePath === 'case.yml' || relativePath.startsWith('i18n/') || relativePath.startsWith('tests/')) &&
      entry.size > MAX_CASE_SOURCE_BYTES
    ) {
      throw new CaseImportError(
        'remote-import-too-large',
        `Authored YAML file '${relativePath}' exceeds the ${MAX_CASE_SOURCE_BYTES}-byte limit.`,
      )
    }
    totalBytes += entry.size
    if (totalBytes > MAX_GITHUB_PACKAGE_BYTES) {
      throw new CaseImportError(
        'remote-import-too-large',
        `GitHub package exceeds the ${MAX_GITHUB_PACKAGE_BYTES}-byte limit.`,
      )
    }
    const bytes = await githubBlob(loader, target, entry, signal)
    await writeStagedFile(packageRoot, relativePath, bytes)
  }

  await include(caseSource, 'case.yml')
  for (const directory of ['assets', 'i18n', 'tests']) {
    await include(byName.get(directory)!, directory)
  }
  const sourceText = decodeUtf8(await readFile(join(packageRoot, 'case.yml')), 'case.yml')
  safeYamlRoot(sourceText, 'case.yml')
  return {
    packageRoot,
    provenance: {
      kind: 'github',
      url: target.displayUrl,
      revision: target.commit,
      ...(target.packagePath ? { packagePath: target.packagePath } : {}),
    },
    verification: 'github',
  }
}

function assertDirectYamlContract(sourceText: string): {
  caseId: string
  caseVersion: string
  locale: string
} {
  const source = safeYamlRoot(sourceText, 'Direct case YAML')
  const assets = record(source.assets)
  if (Object.keys(assets).length > 0) {
    throw new CaseImportError(
      'direct-yaml-assets-unsupported',
      'Direct YAML imports cannot declare assets. Use a GitHub case package instead.',
    )
  }
  for (const evidence of Object.values(record(source.evidence))) {
    const assetIds = record(evidence).assets
    if (Array.isArray(assetIds) && assetIds.length > 0) {
      throw new CaseImportError(
        'direct-yaml-assets-unsupported',
        'Direct YAML evidence cannot reference assets. Use a GitHub case package instead.',
      )
    }
  }
  let inspection
  try {
    inspection = inspectCaseSourceLocalization(sourceText)
  } catch (error) {
    throw new CaseImportError('direct-yaml-invalid', 'Direct case YAML is invalid.', [], error)
  }
  if (inspection.referenceKeys.length > 0) {
    throw new CaseImportError(
      'direct-yaml-i18n-unsupported',
      'Direct YAML must use literal text because it has no translation catalogs.',
    )
  }
  if (!inspection.caseId || !inspection.caseVersion || !inspection.defaultLocale) {
    throw new CaseImportError('direct-yaml-invalid', 'Direct case YAML has no valid case identity.')
  }
  return {
    caseId: inspection.caseId,
    caseVersion: inspection.caseVersion,
    locale: inspection.defaultLocale,
  }
}

async function stageDirectYaml(
  loader: CaseImportRemoteLoader,
  inputUrl: string,
  packageRoot: string,
  signal?: AbortSignal,
): Promise<StagedImport> {
  const displayUrl = displaySafeUrl(inputUrl)
  const response = await loader.load(inputUrl, {
    maxBytes: MAX_CASE_SOURCE_BYTES,
    headers: { accept: 'application/yaml, text/yaml, text/plain; q=0.9' },
    signal,
  })
  if (response.body.byteLength > MAX_CASE_SOURCE_BYTES) {
    throw new CaseImportError(
      'remote-import-too-large',
      `Direct case YAML exceeds the ${MAX_CASE_SOURCE_BYTES}-byte limit.`,
    )
  }
  if (response.status !== 200) {
    throw new CaseImportError(
      'remote-import-failed',
      `Direct case YAML could not be downloaded (${response.status}).`,
    )
  }
  const contentType = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (
    contentType &&
    ![
      'application/octet-stream',
      'application/x-yaml',
      'application/yaml',
      'text/plain',
      'text/x-yaml',
      'text/yaml',
    ].includes(contentType)
  ) {
    throw new CaseImportError(
      'direct-yaml-invalid',
      `Direct case URL returned unsupported content type '${contentType}'.`,
    )
  }
  const sourceText = decodeUtf8(response.body, 'Direct case YAML')
  const identity = assertDirectYamlContract(sourceText)
  await mkdir(join(packageRoot, 'assets'), { recursive: true, mode: 0o700 })
  await mkdir(join(packageRoot, 'tests'), { recursive: true, mode: 0o700 })
  await mkdir(join(packageRoot, 'i18n'), { recursive: true, mode: 0o700 })
  await writeFile(join(packageRoot, 'case.yml'), sourceText, { encoding: 'utf8', mode: 0o600 })
  const catalog = [
    'schema: case-i18n/v0.1',
    `case: {id: ${JSON.stringify(identity.caseId)}, version: ${JSON.stringify(identity.caseVersion)}}`,
    `locale: ${JSON.stringify(identity.locale)}`,
    'messages: {}',
    '',
  ].join('\n')
  await writeFile(join(packageRoot, 'i18n', `${identity.locale}.yml`), catalog, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return {
    packageRoot,
    provenance: { kind: 'yaml', url: displayUrl },
    verification: 'yaml',
  }
}

async function bundleDigest(packageRoot: string): Promise<string> {
  const files: Array<{ path: string; size: number; digest: string }> = []
  const walk = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new CaseImportError('github-package-invalid', 'Staged package contains a symbolic link.')
      }
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) {
        throw new CaseImportError('github-package-invalid', 'Staged package contains a non-file entry.')
      }
      const bytes = await readFile(path)
      files.push({
        path: relative(packageRoot, path).split(sep).join('/'),
        size: bytes.byteLength,
        digest: createHash('sha256').update(bytes).digest('hex'),
      })
    }
  }
  await walk(packageRoot)
  return hashCanonical(files)
}

function packageDiagnostic(error: unknown, stageDirectory: string): CaseImportDiagnostic {
  if (error instanceof CasePackageError) {
    return {
      code: error.code,
      message: error.message.replaceAll(stageDirectory, 'case package'),
    }
  }
  return {
    code: 'E_CASE_IMPORT',
    message: error instanceof Error ? error.message.replaceAll(stageDirectory, 'case package') : 'Case validation failed.',
  }
}

async function validateStagedImport(staged: StagedImport, stageDirectory: string): Promise<{
  compiled: CompiledCasePackage
  verification: InstalledCaseLibraryRecord['verification']
}> {
  let compiled: CompiledCasePackage
  try {
    compiled = await compileCasePackage(staged.packageRoot, {
      maxAssetBytes: MAX_GITHUB_FILE_BYTES,
      maxTotalAssetBytes: MAX_GITHUB_PACKAGE_BYTES,
    })
  } catch (error) {
    throw new CaseImportError(
      'case-validation-failed',
      'The imported case did not pass package validation.',
      [packageDiagnostic(error, stageDirectory)],
      error,
    )
  }
  for (const asset of compiled.assets) {
    if (asset.descriptor.source.kind !== 'local' || !asset.absolutePath) continue
    const preview = await readFile(asset.absolutePath)
    const mimeType = asset.descriptor.mimeType
    const ascii = (start: number, length: number): string =>
      Buffer.from(preview.subarray(start, start + length)).toString('ascii')
    const starts = (...bytes: number[]): boolean =>
      bytes.every((byte, index) => preview[index] === byte)
    const invalid = (() => {
      switch (mimeType) {
        case 'image/png': return !starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        case 'image/jpeg': return !starts(0xff, 0xd8, 0xff)
        case 'image/gif': return !['GIF87a', 'GIF89a'].includes(ascii(0, 6))
        case 'image/webp': return ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP'
        case 'image/avif': return ascii(4, 4) !== 'ftyp' || !['avif', 'avis'].includes(ascii(8, 4))
        case 'audio/wav':
        case 'audio/wave':
        case 'audio/x-wav': return ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE'
        case 'audio/flac': return ascii(0, 4) !== 'fLaC'
        case 'audio/mpeg': return ascii(0, 3) !== 'ID3' && !(preview[0] === 0xff && preview[1] !== undefined && (preview[1] & 0xe0) === 0xe0)
        case 'application/pdf': return ascii(0, 5) !== '%PDF-'
        case 'application/zip':
        case 'application/epub+zip':
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return !starts(0x50, 0x4b)
        case 'video/webm':
        case 'audio/webm': return !starts(0x1a, 0x45, 0xdf, 0xa3)
        case 'video/mp4':
        case 'audio/mp4':
        case 'video/quicktime': return ascii(4, 4) !== 'ftyp'
        default: return false
      }
    })()
    if (invalid) {
      throw new CaseImportError(
        'case-validation-failed',
        `Imported asset '${asset.descriptor.id}' does not match its declared media type.`,
        [{ code: 'E_ASSET_CONTENT', message: `Declared MIME type '${mimeType}' does not match the file bytes.` }],
      )
    }
  }
  if (staged.verification === 'github') {
    let conformance
    try {
      conformance = await runCasePackageConformance(staged.packageRoot)
    } catch (error) {
      throw new CaseImportError(
        'case-tests-failed',
        'The imported case tests could not be loaded or executed.',
        [packageDiagnostic(error, stageDirectory)],
        error,
      )
    }
    if (!conformance.ok) {
      const diagnostics: CaseImportDiagnostic[] = conformance.tests
        .filter(({ ok }) => !ok)
        .flatMap((test) => test.failures.map((failure) => ({
          code: 'E_CASE_TEST_FAILED',
          path: `tests/${test.id}.yml`,
          message: `${failure.expectation}: ${failure.message}`,
        })))
      if (!conformance.contactDiscovery.ok) {
        diagnostics.push(...conformance.contactDiscovery.items
          .filter(({ ok }) => !ok)
          .map((item) => ({
            code: 'E_CONTACT_DISCOVERY_COVERAGE',
            message: item.message ?? `Contact route for '${item.actorId}' is not covered.`,
          })))
      }
      throw new CaseImportError(
        'case-tests-failed',
        'The imported case did not pass its authored detective tests.',
        diagnostics,
      )
    }
    return {
      compiled,
      verification: {
        level: 'conformance-passed',
        authoredTests: conformance.tests.length,
        testSuiteDigest: conformance.testSuiteDigest,
      },
    }
  }

  try {
    let id = 0
    const runtime = createCaseRuntime(compileToKernelIR(compiled.result.ir), {
      ids: {
        nextCommandId: () => `import-smoke-command-${++id}`,
        nextEventId: () => `import-smoke-event-${++id}`,
      },
      wallClock: { now: () => 0 },
    })
    const snapshot = createCaseSessionController(runtime).getSnapshot()
    if (snapshot.case.digest !== compiled.kernelDigest || snapshot.status !== 'active') {
      throw new Error('Imported case did not produce an active opening state.')
    }
  } catch (error) {
    throw new CaseImportError(
      'case-validation-failed',
      'Direct case YAML could not start a safe game session.',
      [{ code: 'E_CASE_RUNTIME_SMOKE', message: error instanceof Error ? error.message : 'Runtime smoke failed.' }],
      error,
    )
  }
  return {
    compiled,
    verification: { level: 'compiler-and-smoke', authoredTests: 0 },
  }
}

function metadataRelativePath(bundle: string): string {
  return join('bundles', bundle, 'case-package')
}

function entryFromRecord(record: InstalledCaseLibraryRecord): PublicCaseLibraryEntry {
  return {
    schema: record.schema,
    installationId: record.installationId,
    caseId: record.caseId,
    caseVersion: record.caseVersion,
    caseDigest: record.caseDigest,
    packageDigest: record.packageDigest,
    title: record.title,
    synopsis: record.synopsis,
    durationMinutes: record.durationMinutes,
    defaultLocale: record.defaultLocale,
    locales: record.locales,
    source: record.source,
    verification: record.verification,
    installedAt: record.installedAt,
  }
}

function validateRecord(value: unknown): InstalledCaseLibraryRecord {
  const input = record(value)
  const source = record(input.source)
  const verification = record(input.verification)
  const provenance = record(input.provenance)
  if (
    input.schema !== 'detective-case-library-entry/v1' ||
    typeof input.installationId !== 'string' ||
    !INSTALLATION_ID.test(input.installationId) ||
    typeof input.caseId !== 'string' ||
    typeof input.caseVersion !== 'string' ||
    typeof input.caseDigest !== 'string' || !SHA256.test(input.caseDigest) ||
    typeof input.packageDigest !== 'string' || !SHA256.test(input.packageDigest) ||
    typeof input.bundleDigest !== 'string' || !SHA256.test(input.bundleDigest) ||
    typeof input.packagePath !== 'string' ||
    typeof input.title !== 'string' ||
    typeof input.synopsis !== 'string' ||
    typeof input.durationMinutes !== 'number' ||
    !Number.isSafeInteger(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    typeof input.defaultLocale !== 'string' ||
    !Array.isArray(input.locales) ||
    input.locales.length === 0 ||
    input.locales.some((locale) => typeof locale !== 'string') ||
    new Set(input.locales).size !== input.locales.length ||
    !input.locales.includes(input.defaultLocale) ||
    typeof input.installedAt !== 'string' ||
    (source.kind !== 'github' && source.kind !== 'yaml') ||
    typeof source.url !== 'string' ||
    (source.revision !== undefined && typeof source.revision !== 'string') ||
    !['conformance-passed', 'compiler-and-smoke'].includes(String(verification.level)) ||
    !Number.isSafeInteger(verification.authoredTests) ||
    Number(verification.authoredTests) < 0 ||
    (verification.testSuiteDigest !== undefined && typeof verification.testSuiteDigest !== 'string') ||
    provenance.kind !== source.kind ||
    typeof provenance.url !== 'string' ||
    provenance.url !== source.url ||
    provenance.revision !== source.revision ||
    (source.kind === 'github' && (
      typeof source.revision !== 'string' ||
      !GITHUB_COMMIT.test(source.revision) ||
      verification.level !== 'conformance-passed'
    )) ||
    (source.kind === 'yaml' && (
      source.revision !== undefined ||
      provenance.packagePath !== undefined ||
      verification.level !== 'compiler-and-smoke' ||
      verification.authoredTests !== 0 ||
      verification.testSuiteDigest !== undefined
    )) ||
    (verification.testSuiteDigest !== undefined && !SHA256.test(String(verification.testSuiteDigest))) ||
    input.packagePath !== metadataRelativePath(String(input.bundleDigest)) ||
    (() => {
      try {
        return new Date(String(input.installedAt)).toISOString() !== input.installedAt
      } catch {
        return true
      }
    })()
  ) {
    throw new CaseImportError('case-library-storage', 'Stored case installation metadata is invalid.')
  }
  try {
    if (displaySafeUrl(source.url) !== source.url) {
      throw new Error('Stored import URL is not normalized.')
    }
    if (source.kind === 'github' && new URL(source.url).hostname.toLowerCase() !== 'github.com') {
      throw new Error('Stored GitHub import URL is not a GitHub URL.')
    }
    if (provenance.packagePath !== undefined) {
      if (
        typeof provenance.packagePath !== 'string' ||
        normalizeRepositoryPath(provenance.packagePath) !== provenance.packagePath
      ) {
        throw new Error('Stored repository package path is invalid.')
      }
    }
  } catch (error) {
    throw new CaseImportError(
      'case-library-storage',
      'Stored case installation metadata is invalid.',
      [],
      error,
    )
  }
  return input as unknown as InstalledCaseLibraryRecord
}

function userDirectoryName(userId: string): string {
  return createHash('sha256').update(userId).digest('hex')
}

async function readTextNoFollow(path: string, maximumBytes = 4 * 1024 * 1024): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > maximumBytes) {
      throw new CaseImportError('case-library-storage', 'Stored case metadata is not a valid file.')
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength !== stats.size || bytes.byteLength > maximumBytes) {
      throw new CaseImportError('case-library-storage', 'Stored case metadata changed while being read.')
    }
    return decodeUtf8(bytes, 'Stored case metadata')
  } finally {
    await handle.close()
  }
}

async function directoryEntries(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function createCaseLibrary(options: CreateCaseLibraryOptions): CaseLibrary {
  const rootDirectory = resolve(options.rootDirectory)
  const loader = options.remoteLoader ?? createSafeRemoteLoader()
  const now = options.now ?? (() => new Date())
  const nextInstallationId = options.nextInstallationId ?? randomUUID
  let operationTail = Promise.resolve()

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.catch(() => undefined).then(operation)
    operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  const installationsDirectory = (userId: string): string => join(
    rootDirectory,
    'users',
    userDirectoryName(exactUserId(userId)),
    'installations',
  )

  const records = async (userId: string): Promise<InstalledCaseLibraryRecord[]> => {
    const directory = installationsDirectory(userId)
    const entries = (await directoryEntries(directory))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    const output: InstalledCaseLibraryRecord[] = []
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith('.json')) {
        throw new CaseImportError('case-library-storage', 'Case installation directory contains an unsafe entry.')
      }
      const value = JSON.parse(await readTextNoFollow(join(directory, entry.name))) as unknown
      const record = validateRecord(value)
      if (`${record.installationId}.json` !== entry.name) {
        throw new CaseImportError('case-library-storage', 'Case installation filename does not match its identity.')
      }
      output.push(record)
    }
    return output
  }

  const compileRecord = async (record: InstalledCaseLibraryRecord): Promise<CompiledCasePackage> => {
    const packageRoot = resolve(rootDirectory, record.packagePath)
    if (!isWithin(rootDirectory, packageRoot)) {
      throw new CaseImportError('case-library-storage', 'Stored case path escaped the library.')
    }
    const compiled = await compileCasePackage(packageRoot, {
      maxAssetBytes: MAX_GITHUB_FILE_BYTES,
      maxTotalAssetBytes: MAX_GITHUB_PACKAGE_BYTES,
    })
    if (
      compiled.packageDigest !== record.packageDigest ||
      compiled.kernelDigest !== record.caseDigest ||
      compiled.result.ir.case.id !== record.caseId ||
      compiled.result.ir.case.version !== record.caseVersion
    ) {
      throw new CaseImportError('case-library-storage', 'Stored case package no longer matches its immutable metadata.')
    }
    return compiled
  }

  const resolveRecord = async (userId: string, installationId: string): Promise<InstalledCaseLibraryRecord> => {
    exactUserId(userId)
    if (!INSTALLATION_ID.test(installationId)) {
      throw new CaseImportError('case-library-storage', 'Case installation ID is invalid.')
    }
    const path = join(installationsDirectory(userId), `${installationId}.json`)
    let serializedRecord: string
    try {
      serializedRecord = await readTextNoFollow(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CaseImportError('case-library-storage', 'Case installation was not found.')
      }
      throw error
    }
    return validateRecord(JSON.parse(serializedRecord) as unknown)
  }

  return Object.freeze({
    importCase(userId: string, request: CaseImportRequest, signal?: AbortSignal): Promise<ImportedCase> {
      return serialized(async () => {
        exactUserId(userId)
        exactRequest(request)
        await ensurePrivateDirectory(rootDirectory)
        const stagingDirectory = join(rootDirectory, 'staging')
        await ensurePrivateDirectory(stagingDirectory)
        const stage = await mkdtemp(join(stagingDirectory, 'import-'))
        await chmod(stage, 0o700)
        const packageRoot = join(stage, 'case-package')
        await mkdir(packageRoot, { mode: 0o700 })
        try {
          const staged = request.kind === 'github'
            ? await stageGithubPackage(loader, request.url, packageRoot, signal)
            : await stageDirectYaml(loader, request.url, packageRoot, signal)
          const validated = await validateStagedImport(staged, stage)
          const digest = await bundleDigest(packageRoot)
          const existing = (await records(userId)).find((record) =>
            record.caseId === validated.compiled.result.ir.case.id &&
            record.caseVersion === validated.compiled.result.ir.case.version,
          )
          if (existing) {
            if (
              existing.bundleDigest === digest &&
              existing.packageDigest === validated.compiled.packageDigest &&
              existing.caseDigest === validated.compiled.kernelDigest
            ) {
              const compiled = await compileRecord(existing)
              options.registry?.add(compiled)
              return {
                entry: entryFromRecord(existing),
                compiled,
              }
            }
            throw new CaseImportError(
              'case-version-conflict',
              `Case ${existing.caseId}@${existing.caseVersion} is already installed with different content.`,
            )
          }

          const bundlesDirectory = join(rootDirectory, 'bundles')
          await ensurePrivateDirectory(bundlesDirectory)
          const destinationRoot = join(bundlesDirectory, digest)
          const destinationPackage = join(destinationRoot, 'case-package')
          try {
            const destinationStats = await lstat(destinationRoot)
            if (destinationStats.isSymbolicLink() || !destinationStats.isDirectory()) {
              throw new CaseImportError('case-library-storage', 'Case bundle destination is unsafe.')
            }
            await rm(packageRoot, { recursive: true, force: true })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              const temporaryBundle = join(bundlesDirectory, `.${digest}.${randomUUID()}.tmp`)
              await mkdir(temporaryBundle, { mode: 0o700 })
              try {
                await rename(packageRoot, join(temporaryBundle, 'case-package'))
                await rename(temporaryBundle, destinationRoot)
              } finally {
                await rm(temporaryBundle, { recursive: true, force: true }).catch(() => undefined)
              }
            } else if (error instanceof CaseImportError) {
              throw error
            } else {
              throw error
            }
          }

          let installedCompiled: CompiledCasePackage
          try {
            installedCompiled = await compileCasePackage(destinationPackage, {
              maxAssetBytes: MAX_GITHUB_FILE_BYTES,
              maxTotalAssetBytes: MAX_GITHUB_PACKAGE_BYTES,
            })
          } catch (error) {
            throw new CaseImportError(
              'case-library-storage',
              'Installed case package failed its immutable readback.',
              [packageDiagnostic(error, rootDirectory)],
              error,
            )
          }
          if (
            installedCompiled.packageDigest !== validated.compiled.packageDigest ||
            installedCompiled.kernelDigest !== validated.compiled.kernelDigest
          ) {
            throw new CaseImportError('case-library-storage', 'Installed case package changed during promotion.')
          }

          const installationId = nextInstallationId()
          if (!INSTALLATION_ID.test(installationId)) {
            throw new CaseImportError('case-library-storage', 'Installation ID generator returned an invalid ID.')
          }
          const manifest = installedCompiled.result.publicManifest
          const record: InstalledCaseLibraryRecord = {
            schema: 'detective-case-library-entry/v1',
            installationId,
            caseId: installedCompiled.result.ir.case.id,
            caseVersion: installedCompiled.result.ir.case.version,
            caseDigest: installedCompiled.kernelDigest,
            packageDigest: installedCompiled.packageDigest,
            bundleDigest: digest,
            packagePath: metadataRelativePath(digest),
            title: String(manifest.case.title),
            synopsis: String(manifest.case.synopsis),
            durationMinutes: manifest.case.durationMinutes,
            defaultLocale: installedCompiled.localization.defaultLocale,
            locales: [...installedCompiled.localization.locales],
            source: {
              kind: staged.provenance.kind,
              url: staged.provenance.url,
              ...(staged.provenance.revision ? { revision: staged.provenance.revision } : {}),
            },
            verification: validated.verification,
            installedAt: now().toISOString(),
            provenance: staged.provenance,
          }
          const directory = installationsDirectory(userId)
          await ensurePrivateDirectory(directory)
          const metadataPath = join(directory, `${installationId}.json`)
          await atomicWrite(metadataPath, JSON.stringify(record))
          try {
            options.registry?.add(installedCompiled)
          } catch (error) {
            await unlink(metadataPath).catch(() => undefined)
            throw new CaseImportError(
              'case-version-conflict',
              'The live host already has this case version with different content.',
              [],
              error,
            )
          }
          return { entry: entryFromRecord(record), compiled: installedCompiled }
        } finally {
          await rm(stage, { recursive: true, force: true }).catch(() => undefined)
        }
      })
    },

    async list(userId: string): Promise<readonly PublicCaseLibraryEntry[]> {
      return (await records(userId))
        .map(entryFromRecord)
        .sort((left, right) =>
          left.title.localeCompare(right.title) || left.caseVersion.localeCompare(right.caseVersion),
        )
    },

    async resolve(userId: string, installationId: string): Promise<ImportedCase> {
      const record = await resolveRecord(userId, installationId)
      const compiled = await compileRecord(record)
      return { entry: entryFromRecord(record), compiled }
    },

    async registerInstalled(userId: string): Promise<readonly PublicCaseLibraryEntry[]> {
      const installed = await records(userId)
      for (const record of installed) options.registry?.add(await compileRecord(record))
      return installed.map(entryFromRecord)
    },
  })
}
