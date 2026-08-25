import { gitBlobSha1 } from '../compiler/digests'

import { importError } from './import-errors'
import type { BrowserPackageFile, BrowserPackageFiles } from './import-types'
import {
  decodeUtf8,
  displayRemoteUrl,
  fetchRemote,
  readResponseBytes,
  safeRemoteUrl,
} from './remote-fetch'

const GITHUB_API = 'https://api.github.com/repos'
const API_HEADERS = Object.freeze({
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
})
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_API_BYTES = 7 * 1024 * 1024
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 1_024
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}$/
const COMMIT = /^[a-f0-9]{40}$/i

type JsonRecord = Record<string, unknown>

interface ParsedGithubUrl {
  readonly owner: string
  readonly repository: string
  readonly mode: 'repository' | 'tree' | 'blob'
  readonly tail: readonly string[]
  readonly displayUrl: string
}

interface GithubCommit {
  readonly sha: string
  readonly treeSha: string
}

interface GithubTarget extends GithubCommit {
  readonly owner: string
  readonly repository: string
  readonly packagePath: string
  readonly displayUrl: string
}

interface ContentEntry {
  readonly name: string
  readonly path: string
  readonly type: string
  readonly sha: string
  readonly size: number
}

interface TreeEntry {
  readonly path: string
  readonly type: string
  readonly mode: string
  readonly sha: string
  readonly size: number
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function githubSegments(input: string): ParsedGithubUrl {
  const authored = safeRemoteUrl(input)
  if (authored.hostname.toLowerCase() !== 'github.com' || authored.search) {
    throw importError(
      'github-url-unsupported',
      'GitHub imports require a public github.com repository, tree, or case.yml URL.',
    )
  }
  let segments: string[]
  try {
    segments = authored.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch (cause) {
    throw importError('github-url-unsupported', 'GitHub URL path is invalid.', 400, cause)
  }
  if (segments.length < 2) {
    throw importError('github-url-unsupported', 'GitHub URL must name a repository.')
  }
  const owner = segments[0]!
  const repository = segments[1]!.replace(/\.git$/i, '')
  if (!OWNER.test(owner) || !REPOSITORY.test(repository)) {
    throw importError('github-url-unsupported', 'GitHub owner or repository name is invalid.')
  }
  if (segments.length === 2) {
    return { owner, repository, mode: 'repository', tail: [], displayUrl: displayRemoteUrl(input) }
  }
  const mode = segments[2]
  if ((mode !== 'tree' && mode !== 'blob') || segments.length < 4) {
    throw importError('github-url-unsupported', 'GitHub URL must point to a repository, folder, or case.yml file.')
  }
  if (mode === 'blob' && segments.at(-1) !== 'case.yml') {
    throw importError('github-url-unsupported', 'A GitHub file import must point to case.yml.')
  }
  return {
    owner,
    repository,
    mode,
    tail: segments.slice(3),
    displayUrl: displayRemoteUrl(input),
  }
}

function apiUrl(owner: string, repository: string, suffix = ''): string {
  return `${GITHUB_API}/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${suffix ? `/${suffix}` : ''}`
}

async function apiJson(
  url: string,
  signal?: AbortSignal,
): Promise<{ response: Response; value?: unknown }> {
  const response = await fetchRemote(url, { headers: API_HEADERS }, signal)
  const bytes = await readResponseBytes(response, MAX_API_BYTES)
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if ((response.status === 403 || response.status === 429) && remaining === '0') {
      const reset = Number(response.headers.get('x-ratelimit-reset'))
      const suffix = Number.isFinite(reset)
        ? ` Try again after ${new Date(reset * 1_000).toLocaleTimeString()}.`
        : ''
      throw importError('github-rate-limited', `GitHub's public API limit was reached.${suffix}`, 429)
    }
    return { response }
  }
  try {
    return { response, value: JSON.parse(decodeUtf8(bytes, 'GitHub response')) as unknown }
  } catch (cause) {
    throw importError('remote-import-failed', 'GitHub returned malformed JSON.', 502, cause)
  }
}

async function resolveCommit(
  owner: string,
  repository: string,
  ref: string,
  signal?: AbortSignal,
): Promise<GithubCommit | undefined> {
  const { response, value } = await apiJson(
    apiUrl(owner, repository, `commits/${encodeURIComponent(ref)}`),
    signal,
  )
  if (response.status === 404 || response.status === 422) return undefined
  if (response.status !== 200) {
    throw importError('remote-import-failed', `GitHub could not resolve the requested revision (${response.status}).`, 502)
  }
  const input = record(value)
  const sha = String(input.sha ?? '')
  const treeSha = String(record(record(input.commit).tree).sha ?? '')
  if (!COMMIT.test(sha) || !COMMIT.test(treeSha)) {
    throw importError('remote-import-failed', 'GitHub returned an invalid commit identity.', 502)
  }
  return { sha: sha.toLowerCase(), treeSha: treeSha.toLowerCase() }
}

function normalizePath(path: string): string {
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || path.length > 2_048) {
    throw importError('github-package-invalid', 'Repository contains an unsafe path.')
  }
  if (path === '') return ''
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw importError('github-package-invalid', 'Repository contains path traversal.')
  }
  return parts.join('/')
}

function contentEntry(value: unknown): ContentEntry {
  const input = record(value)
  const entry: ContentEntry = {
    name: String(input.name ?? ''),
    path: normalizePath(String(input.path ?? '')),
    type: String(input.type ?? ''),
    sha: String(input.sha ?? '').toLowerCase(),
    size: Number(input.size ?? 0),
  }
  if (
    !entry.name || entry.path.split('/').at(-1) !== entry.name ||
    !['file', 'dir', 'symlink', 'submodule'].includes(entry.type) ||
    !COMMIT.test(entry.sha) || !Number.isSafeInteger(entry.size) || entry.size < 0
  ) {
    throw importError('github-package-invalid', 'GitHub returned an invalid package entry.', 502)
  }
  return entry
}

function treeEntry(value: unknown): TreeEntry {
  const input = record(value)
  const entry: TreeEntry = {
    path: normalizePath(String(input.path ?? '')),
    type: String(input.type ?? ''),
    mode: String(input.mode ?? ''),
    sha: String(input.sha ?? '').toLowerCase(),
    size: Number(input.size ?? 0),
  }
  if (
    !entry.path || !['blob', 'tree', 'commit'].includes(entry.type) || !COMMIT.test(entry.sha) ||
    !Number.isSafeInteger(entry.size) || entry.size < 0
  ) {
    throw importError('github-package-invalid', 'GitHub returned an invalid tree entry.', 502)
  }
  return entry
}

async function recursiveTree(
  owner: string,
  repository: string,
  sha: string,
  signal?: AbortSignal,
): Promise<TreeEntry[]> {
  const { response, value } = await apiJson(
    apiUrl(owner, repository, `git/trees/${sha}?recursive=1`),
    signal,
  )
  if (response.status !== 200) {
    throw importError('remote-import-failed', `GitHub could not list the case tree (${response.status}).`, 502)
  }
  const input = record(value)
  if (input.truncated === true) {
    throw importError('remote-import-too-large', 'GitHub truncated the repository tree. Import a smaller case folder.', 413)
  }
  if (!Array.isArray(input.tree)) {
    throw importError('github-package-invalid', 'GitHub returned an invalid repository tree.', 502)
  }
  return input.tree.map(treeEntry)
}

async function directoryContents(
  target: Pick<GithubTarget, 'owner' | 'repository' | 'sha'>,
  path: string,
  signal?: AbortSignal,
): Promise<ContentEntry[]> {
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  const suffix = encoded ? `contents/${encoded}?ref=${target.sha}` : `contents?ref=${target.sha}`
  const { response, value } = await apiJson(apiUrl(target.owner, target.repository, suffix), signal)
  if (response.status === 404) {
    throw importError('github-case-not-found', 'GitHub case folder was not found.', 404)
  }
  if (response.status !== 200 || !Array.isArray(value)) {
    throw importError('remote-import-failed', `GitHub could not list the case package (${response.status}).`, 502)
  }
  return value.map(contentEntry)
}

async function findPackagePath(
  target: Pick<GithubTarget, 'owner' | 'repository' | 'sha' | 'treeSha'>,
  signal?: AbortSignal,
): Promise<string> {
  const tree = await recursiveTree(target.owner, target.repository, target.treeSha, signal)
  const candidates = tree
    .filter(({ type, path }) => type === 'blob' && (path === 'case.yml' || /^[^/]+\/case\.yml$/.test(path)))
    .map(({ path }) => path === 'case.yml' ? '' : path.slice(0, -'/case.yml'.length))
  if (candidates.length !== 1) {
    throw importError(
      'github-case-not-found',
      candidates.length === 0
        ? 'No case.yml was found at the repository root or an immediate child.'
        : 'Repository contains multiple cases. Import a specific GitHub folder URL.',
      404,
    )
  }
  return candidates[0]!
}

async function resolveTarget(inputUrl: string, signal?: AbortSignal): Promise<GithubTarget> {
  const parsed = githubSegments(inputUrl)
  let commit: GithubCommit | undefined
  let packagePath = ''
  if (parsed.mode === 'repository') {
    const { response, value } = await apiJson(apiUrl(parsed.owner, parsed.repository), signal)
    if (response.status !== 200) {
      throw importError('remote-import-failed', `GitHub repository is unavailable (${response.status}).`, 502)
    }
    const defaultBranch = String(record(value).default_branch ?? '')
    if (!defaultBranch) throw importError('remote-import-failed', 'GitHub repository has no default branch.', 502)
    commit = await resolveCommit(parsed.owner, parsed.repository, defaultBranch, signal)
    if (!commit) throw importError('github-ref-not-found', 'Default branch was not found.', 404)
  } else if (COMMIT.test(parsed.tail[0] ?? '')) {
    commit = await resolveCommit(parsed.owner, parsed.repository, parsed.tail[0]!, signal)
    packagePath = normalizePath(parsed.tail.slice(1, parsed.mode === 'blob' ? -1 : undefined).join('/'))
  } else {
    const upper = parsed.mode === 'blob' ? parsed.tail.length - 1 : parsed.tail.length
    for (let split = upper; split >= 1; split -= 1) {
      const candidate = await resolveCommit(
        parsed.owner,
        parsed.repository,
        parsed.tail.slice(0, split).join('/'),
        signal,
      )
      if (!candidate) continue
      commit = candidate
      const remainder = parsed.tail.slice(split)
      if (parsed.mode === 'blob') remainder.pop()
      packagePath = normalizePath(remainder.join('/'))
      break
    }
  }
  if (!commit) throw importError('github-ref-not-found', 'GitHub branch or commit was not found.', 404)
  const base = {
    owner: parsed.owner,
    repository: parsed.repository,
    ...commit,
  }
  if (parsed.mode === 'repository' || (parsed.mode === 'tree' && packagePath === '')) {
    packagePath = await findPackagePath(base, signal)
  }
  return { ...base, packagePath, displayUrl: parsed.displayUrl }
}

function expectedPath(packagePath: string, relative: string): string {
  return [packagePath, relative].filter(Boolean).join('/')
}

function rawUrl(target: GithubTarget, relative: string): string {
  const path = expectedPath(target.packagePath, relative)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  return `https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/${target.sha}/${path}`
}

async function downloadFile(
  target: GithubTarget,
  file: { relativePath: string; sha: string; size: number },
  signal?: AbortSignal,
): Promise<BrowserPackageFile> {
  const response = await fetchRemote(rawUrl(target, file.relativePath), {}, signal)
  if (!response.ok) {
    throw importError('remote-import-failed', `GitHub could not download '${file.relativePath}' (${response.status}).`, 502)
  }
  const bytes = await readResponseBytes(response, Math.min(MAX_FILE_BYTES, file.size + 1))
  if (bytes.byteLength !== file.size || gitBlobSha1(bytes) !== file.sha) {
    throw importError('github-package-invalid', `GitHub content identity changed for '${file.relativePath}'.`, 409)
  }
  const lfsPrefix = 'version https://git-lfs.github.com/spec/'
  if (
    bytes.byteLength < 200 &&
    bytes.byteLength >= lfsPrefix.length &&
    [...lfsPrefix].every((character, index) => bytes[index] === character.charCodeAt(0))
  ) {
    throw importError('github-package-invalid', `Git LFS pointer '${file.relativePath}' is not a downloadable case asset.`)
  }
  return { path: file.relativePath, bytes }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= values.length) return
      result[index] = await operation(values[index]!)
    }
  })
  await Promise.all(workers)
  return result
}

export async function loadGithubCasePackage(
  inputUrl: string,
  signal?: AbortSignal,
): Promise<BrowserPackageFiles> {
  const target = await resolveTarget(inputUrl, signal)
  const root = await directoryContents(target, target.packagePath, signal)
  const collisionKeys = new Set<string>()
  for (const entry of root) {
    const key = entry.name.normalize('NFC').toLocaleLowerCase('en-US')
    if (collisionKeys.has(key)) throw importError('github-package-invalid', 'GitHub package contains colliding root names.')
    collisionKeys.add(key)
  }
  const byName = new Map(root.map((entry) => [entry.name, entry]))
  const caseSource = byName.get('case.yml')
  if (!caseSource || caseSource.type !== 'file') {
    throw importError('github-case-not-found', 'Selected GitHub folder has no case.yml.', 404)
  }
  if (caseSource.size > MAX_SOURCE_BYTES) {
    throw importError('remote-import-too-large', `Authored file 'case.yml' exceeds the ${MAX_SOURCE_BYTES}-byte limit.`, 413)
  }
  const requiredDirectories = ['assets', 'i18n', 'tests'] as const
  for (const name of requiredDirectories) {
    if (byName.get(name)?.type !== 'dir') {
      throw importError('github-package-invalid', `GitHub case package must contain a real ${name}/ directory.`)
    }
  }

  const downloads: Array<{ relativePath: string; sha: string; size: number }> = [{
    relativePath: 'case.yml',
    sha: caseSource.sha,
    size: caseSource.size,
  }]
  const seen = new Set<string>(['case.yml'])
  let entriesSeen = 1
  let totalBytes = caseSource.size
  for (const directory of requiredDirectories) {
    const rootEntry = byName.get(directory)!
    const tree = await recursiveTree(target.owner, target.repository, rootEntry.sha, signal)
    for (const entry of tree) {
      entriesSeen += 1
      if (entriesSeen > MAX_ENTRIES) {
        throw importError('remote-import-too-large', `GitHub package exceeds the ${MAX_ENTRIES}-entry limit.`, 413)
      }
      const relativePath = `${directory}/${entry.path}`
      const key = relativePath.normalize('NFC').toLocaleLowerCase('en-US')
      if (seen.has(key)) throw importError('github-package-invalid', `GitHub package path '${relativePath}' is duplicated.`)
      seen.add(key)
      if (entry.type === 'commit' || entry.mode === '160000') {
        throw importError('github-package-invalid', `GitHub package may not contain submodule '${relativePath}'.`)
      }
      if (entry.mode === '120000') {
        throw importError('github-package-invalid', `GitHub package may not contain symbolic link '${relativePath}'.`)
      }
      if (entry.type === 'tree') continue
      if (entry.type !== 'blob') throw importError('github-package-invalid', `Unsupported GitHub entry '${relativePath}'.`)
      if ((directory === 'i18n' || directory === 'tests') && entry.path.includes('/')) {
        throw importError('github-package-invalid', `${directory}/ must contain only flat files.`)
      }
      if ((relativePath === 'case.yml' || directory !== 'assets') && entry.size > MAX_SOURCE_BYTES) {
        throw importError('remote-import-too-large', `Authored file '${relativePath}' exceeds the ${MAX_SOURCE_BYTES}-byte limit.`, 413)
      }
      if (entry.size > MAX_FILE_BYTES) {
        throw importError('remote-import-too-large', `Case file '${relativePath}' exceeds the ${MAX_FILE_BYTES}-byte limit.`, 413)
      }
      totalBytes += entry.size
      if (totalBytes > MAX_PACKAGE_BYTES) {
        throw importError('remote-import-too-large', `GitHub package exceeds the ${MAX_PACKAGE_BYTES}-byte limit.`, 413)
      }
      downloads.push({ relativePath, sha: entry.sha, size: entry.size })
    }
  }
  const files = await mapConcurrent(downloads, 6, (file) => downloadFile(target, file, signal))
  return {
    files,
    directories: [...requiredDirectories],
    provenance: {
      kind: 'github',
      url: target.displayUrl,
      revision: target.sha,
      ...(target.packagePath ? { packagePath: target.packagePath } : {}),
    },
  }
}
