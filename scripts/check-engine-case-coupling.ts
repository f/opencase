#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

import ts from 'typescript'
import { parse } from 'yaml'

import { CAPABILITY_CATALOG } from '../src/capabilities/catalog'
import { discoverCasePackageDirectories } from '../src/case-package'

const projectRoot = resolve(import.meta.dirname, '..')
const caseRoots = [join(projectRoot, 'cases'), join(projectRoot, 'examples', 'cases')]
const scanRoots = [join(projectRoot, 'src'), join(projectRoot, 'scripts')]
const strictEnginePrefixes = [
  'src/capabilities/',
  'src/case-package/',
  'src/case-runtime/',
  'src/compiler/',
  'src/kernel/',
  'src/persistence/',
  'src/simulator/',
  'scripts/',
] as const
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

interface CaseTokenSets {
  readonly all: Set<string>
  readonly identities: Set<string>
}

async function caseTokens(): Promise<CaseTokenSets> {
  const all = new Set<string>()
  const identities = new Set<string>()
  const packages = await discoverCasePackageDirectories(caseRoots)
  for (const packageDirectory of packages) {
    const packageSlug = basename(packageDirectory)
    all.add(packageSlug)
    identities.add(packageSlug)
    const source = record(parse(await readFile(join(packageDirectory, 'case.yml'), 'utf8')))
    const identity = record(source.case)
    if (typeof identity.id === 'string') {
      all.add(identity.id)
      identities.add(identity.id)
    }
    for (const section of idSections) {
      for (const id of Object.keys(record(source[section]))) all.add(id)
    }
    const assessment = record(source.assessment)
    for (const [categoryId, categoryValue] of Object.entries(record(assessment.categories))) {
      all.add(categoryId)
      for (const criterionId of Object.keys(record(record(categoryValue).criteria))) {
        all.add(criterionId)
      }
    }
    const truth = record(source.truth)
    for (const section of ['events', 'facts'] as const) {
      for (const id of Object.keys(record(truth[section]))) all.add(id)
    }
    if (Array.isArray(source.flags)) {
      for (const flag of source.flags) if (typeof flag === 'string') all.add(flag)
    }
    if (Array.isArray(source.reactions)) {
      for (const reaction of source.reactions) {
        const authored = record(reaction)
        if (typeof authored.id === 'string') all.add(authored.id)
      }
    }
    collectRoutedTokens(source, all)

    const testsDirectory = join(packageDirectory, 'tests')
    for (const entry of await readdir(testsDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.yml')) continue
      const document = record(parse(await readFile(join(testsDirectory, entry.name), 'utf8')))
      const scenario = record(document.scenario)
      if (typeof scenario.id === 'string') all.add(scenario.id)
    }
  }
  for (const capability of CAPABILITY_CATALOG.values()) {
    all.delete(capability.specifier)
    for (const owned of [
      ...capability.tools,
      ...capability.verbs,
      ...capability.templates,
      ...capability.rerouteProviders,
      ...capability.assetProviders,
    ]) {
      all.delete(owned)
    }
  }
  for (const token of genericDslTokens) all.delete(token)
  return { all, identities }
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

function moduleSpecifiers(source: string, fileName: string): string[] {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const values: string[] = []
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      values.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      values.push(node.arguments[0]!.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return values
}

function usesPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => (
    path === prefix.slice(0, -1) || path.startsWith(prefix)
  ))
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
    const strictEngineFile = usesPrefix(sourcePath, strictEnginePrefixes)
    if (strictEngineFile) {
      for (const specifier of moduleSpecifiers(source, sourcePath)) {
        if (!specifier.startsWith('.')) continue
        const target = relative(projectRoot, resolve(dirname(file), specifier))
        const crossesIntoProjectCode = target.startsWith('src/') || target.startsWith('server/')
        if (crossesIntoProjectCode && !usesPrefix(target, strictEnginePrefixes)) {
          violations.push(`${sourcePath} imports application layer '${specifier}'`)
        }
      }
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
    for (const token of strictEngineFile ? tokens.all : tokens.identities) {
      if (literals.some((literal) => containsOwnedToken(literal, token))) {
        violations.push(`${sourcePath} contains case token '${token}'`)
      }
    }
  }
  const packageJson = await readFile(join(projectRoot, 'package.json'), 'utf8')
  for (const token of tokens.identities) {
    if (packageJson.includes(token)) violations.push(`package.json contains case token '${token}'`)
  }
  if (violations.length > 0) {
    throw new Error(`Engine/case coupling detected:\n${violations.sort().join('\n')}`)
  }
  process.stdout.write(
    `Engine coupling scan passed (${tokens.all.size} authored identifiers checked in engine layers; ${tokens.identities.size} case identities checked project-wide).\n`,
  )
}

await main()
