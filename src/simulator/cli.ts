import { resolve } from 'node:path'

import { discoverCasePackageDirectories } from '../case-package'
import { formatConformanceResult, runCasePackageConformance } from './runner'

async function main(arguments_: readonly string[]): Promise<void> {
  if (arguments_.length === 0) {
    throw new Error('Usage: tsx src/simulator/cli.ts <case-package> [case-package ...]')
  }
  let failed = false
  const packages = await discoverCasePackageDirectories(arguments_.map((argument) => resolve(argument)))
  for (const packageDirectory of packages) {
    const result = await runCasePackageConformance(packageDirectory)
    process.stdout.write(`${formatConformanceResult(result)}\n`)
    failed = failed || !result.ok
  }
  if (failed) process.exitCode = 1
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
