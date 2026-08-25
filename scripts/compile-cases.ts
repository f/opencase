#!/usr/bin/env node

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { compileCasePackage, discoverCasePackageDirectories } from '../src/case-package'
import { compileToKernelIR } from '../src/case-runtime'
import { canonicalJson } from '../src/compiler'

interface CliOptions {
  inputs: string[]
  outputDirectory?: string
}

function usage(): never {
  process.stderr.write(
    'Usage: npx tsx scripts/compile-cases.ts [--out-dir DIR] CASE_PACKAGE_DIR [...]\n',
  )
  process.exit(2)
}

function parseArguments(args: string[]): CliOptions {
  const inputs: string[] = []
  let outputDirectory: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out-dir') {
      outputDirectory = args[index + 1]
      if (!outputDirectory) usage()
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      usage()
    } else if (argument.startsWith('-')) {
      process.stderr.write(`Unknown option: ${argument}\n`)
      usage()
    } else {
      inputs.push(argument)
    }
  }
  if (inputs.length === 0) usage()
  return { inputs, outputDirectory }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, contents, 'utf8')
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function compileOne(inputArgument: string, outputDirectory?: string): Promise<boolean> {
  const input = resolve(inputArgument)
  const compiled = await compileCasePackage(input)
  for (const diagnostic of compiled.result.diagnostics) {
    process.stdout.write(`${diagnostic.severity} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}\n`)
  }
  const stem = compiled.packageSlug
  const destination = resolve(outputDirectory ?? join(process.cwd(), '.build', 'cases'))
  await mkdir(destination, { recursive: true })
  const sourceIrPath = join(destination, `${stem}.source.ir.json`)
  const kernelIrPath = join(destination, `${stem}.kernel.ir.json`)
  const manifestPath = join(destination, `${stem}.public.json`)
  const kernelIr = compileToKernelIR(compiled.result.ir)
  await atomicWrite(sourceIrPath, compiled.result.canonicalIrJson)
  await atomicWrite(kernelIrPath, canonicalJson(kernelIr))
  await atomicWrite(manifestPath, compiled.result.canonicalPublicManifestJson)
  const localizedManifestPaths: string[] = []
  for (const locale of compiled.localization.locales) {
    const localizedPath = join(destination, `${stem}.${locale}.public.json`)
    await atomicWrite(
      localizedPath,
      compiled.canonicalLocalizedPublicManifestJson[locale]!,
    )
    localizedManifestPaths.push(localizedPath)
  }
  process.stdout.write(
    `${input} -> ${sourceIrPath}, ${kernelIrPath}, ${manifestPath}, ${localizedManifestPaths.join(', ')}\n`,
  )
  return true
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const packageDirectories = await discoverCasePackageDirectories(options.inputs)
  let failed = false
  for (const input of packageDirectories) {
    try {
      if (!(await compileOne(input, options.outputDirectory))) failed = true
    } catch (error) {
      failed = true
      process.stderr.write(`${resolve(input)}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  if (failed) process.exitCode = 1
}

await main()
