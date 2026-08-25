import { constants, type Dirent } from 'node:fs'
import { lstat, open, readdir, realpath, type FileHandle } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import type { CompiledCaseIR } from '../compiler'
import {
  CASE_TEST_MAX_FILE_BYTES,
  CASE_TEST_MAX_SCENARIOS,
  CASE_TEST_MAX_TOTAL_BYTES,
  createCaseTestSuite,
  parseCaseTestDocument,
} from './case-test-document-core'
import { CaseTestDocumentError } from './errors'
import type { DetectiveCaseTestScenario, DetectiveCaseTestSuite } from './types'

export * from './case-test-document-core'

const CASE_TEST_FILE = /^[a-z][a-z0-9_-]*\.yml$/

export interface DiscoveredCaseTestFiles {
  readonly packageRoot: string
  readonly testsRoot: string
  readonly entryNames: readonly string[]
  readonly files: readonly string[]
}

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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

/** Node filesystem adapter around the browser-safe case-test parser. */
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

  return createCaseTestSuite(scenarios, {
    packageRoot: discovered.packageRoot,
    testsRoot: discovered.testsRoot,
  })
}
