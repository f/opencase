#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

import ts from 'typescript'
import { parse } from 'yaml'

import { CAPABILITY_CATALOG } from '../src/capabilities/catalog'
import { discoverCasePackageDirectories } from '../src/case-package'

const projectRoot = resolve(import.meta.dirname, '..')
const caseRoots = [join(projectRoot, 'cases'), join(projectRoot, 'examples', 'cases')]
const scanRoots = [join(projectRoot, 'src'), join(projectRoot, 'scripts')]
const genericDslTokens = new Set(['can', 'intent'])
const idSections = [
  'assets',
  'cast',
  'places',
  'things',
  'evidence',
  'deductions',
  'deadlines',
  'objectives',
  'outcomes',
] as const
const routedTokenKeys = new Set(['cancel', 'emit', 'event', 'mark', 'reroute', 'shift'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

async function caseTokens(): Promise<Set<string>> {
  const result = new Set<string>()
  const packages = await discoverCasePackageDirectories(caseRoots)
  for (const packageDirectory of packages) {
    result.add(basename(packageDirectory))
    const source = record(parse(await readFile(join(packageDirectory, 'case.yml'), 'utf8')))
    const identity = record(source.case)
    if (typeof identity.id === 'string') result.add(identity.id)
    for (const section of idSections) {
      for (const id of Object.keys(record(source[section]))) result.add(id)
    }
    const assessment = record(source.assessment)
    for (const [categoryId, categoryValue] of Object.entries(record(assessment.categories))) {
      result.add(categoryId)
      for (const criterionId of Object.keys(record(record(categoryValue).criteria))) {
        result.add(criterionId)
      }
    }
    const truth = record(source.truth)
    for (const section of ['events', 'facts'] as const) {
      for (const id of Object.keys(record(truth[section]))) result.add(id)
    }
    if (Array.isArray(source.flags)) {
      for (const flag of source.flags) if (typeof flag === 'string') result.add(flag)
    }
    if (Array.isArray(source.reactions)) {
      for (const reaction of source.reactions) {
        const authored = record(reaction)
        if (typeof authored.id === 'string') result.add(authored.id)
      }
    }
    collectRoutedTokens(source, result)

    const testsDirectory = join(packageDirectory, 'tests')
    for (const entry of await readdir(testsDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.yml')) continue
      const document = record(parse(await readFile(join(testsDirectory, entry.name), 'utf8')))
      const scenario = record(document.scenario)
      if (typeof scenario.id === 'string') result.add(scenario.id)
    }
  }
  for (const capability of CAPABILITY_CATALOG.values()) {
    result.delete(capability.specifier)
    for (const owned of [
      ...capability.tools,
      ...capability.verbs,
      ...capability.templates,
      ...capability.rerouteProviders,
      ...capability.assetProviders,
    ]) {
      result.delete(owned)
    }
  }
  for (const token of genericDslTokens) result.delete(token)
  return result
}

function collectRoutedTokens(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRoutedTokens(item, into)
    return
  }
  const authored = record(value)
  for (const [key, child] of Object.entries(authored)) {
    if (routedTokenKeys.has(key)) {
      if (typeof child === 'string') into.add(child)
      if (Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === 'string' && /^[a-z][a-z0-9_-]*$/.test(item)) into.add(item)
        }
      }
    }
    collectRoutedTokens(child, into)
  }
}

function stringLiteralValues(source: string, fileName: string): string[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const values: string[] = []
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) values.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return values
}

function containsOwnedToken(literal: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:$|[^A-Za-z0-9_-])`).test(literal)
}

async function main(): Promise<void> {
  const tokens = await caseTokens()
  const rootFiles = (await readdir(projectRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => join(projectRoot, entry.name))
  const files = [...(await Promise.all(scanRoots.map(sourceFiles))).flat(), ...rootFiles]
  const violations: string[] = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const sourcePath = relative(projectRoot, file)
    const literals = stringLiteralValues(source, sourcePath)
    if (
      sourcePath.startsWith('src/') &&
      literals.some((literal) => /^(?:\.\.\/)*(?:cases|examples\/cases)\/?$/.test(literal))
    ) {
      violations.push(`${sourcePath} reaches into a repository case root`)
    }
    if (
      sourcePath.startsWith('src/') &&
      /(?:from\s*|import\s*\()\s*['"](?:\.\.\/)*(?:cases|examples\/cases)(?:\/|['"])/.test(
        source,
      )
    ) {
      violations.push(`${sourcePath} imports a playable case package`)
    }
    if (
      sourcePath.startsWith('src/') &&
      /(?:resolve|join)\s*\(\s*process\.cwd\(\)\s*,\s*['"](?:cases|examples\/cases)['"]/.test(
        source,
      )
    ) {
      violations.push(`${sourcePath} reaches into a repository case root`)
    }
    for (const token of tokens) {
      if (literals.some((literal) => containsOwnedToken(literal, token))) {
        violations.push(`${sourcePath} contains case token '${token}'`)
      }
    }
  }
  const packageJson = await readFile(join(projectRoot, 'package.json'), 'utf8')
  for (const token of tokens) {
    if (packageJson.includes(token)) violations.push(`package.json contains case token '${token}'`)
  }
  if (violations.length > 0) {
    throw new Error(`Engine/case coupling detected:\n${violations.sort().join('\n')}`)
  }
  process.stdout.write(
    `Engine coupling scan passed (${tokens.size} authored identifiers checked; engine-owned vocabulary excluded).\n`,
  )
}

await main()
