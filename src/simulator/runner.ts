import type { JsonValue } from '../compiler'
import { compileCasePackage } from '../case-package'

import { loadCaseTestSuite } from './case-test-documents'
import {
  runDetectiveCaseTest,
  type DetectiveCaseTestResult,
} from './detective-runner'

export interface DetectiveCaseConformanceResult {
  readonly sourceFile: string
  readonly testsRoot: string
  readonly testSuiteDigest: string
  readonly caseId: string
  readonly caseVersion: string
  readonly ok: boolean
  readonly tests: readonly DetectiveCaseTestResult[]
}

/**
 * Compiles one complete case package, validates every private tests/*.yml
 * document, and executes each scenario against a fresh deterministic runtime.
 * Tests are deliberately loaded outside the playable IR and package digest.
 */
export async function runCasePackageConformance(
  packageDirectory: string,
): Promise<DetectiveCaseConformanceResult> {
  const compiled = await compileCasePackage(packageDirectory)
  const suite = await loadCaseTestSuite(packageDirectory, compiled.result.ir)
  const tests = suite.scenarios.map((scenario) =>
    runDetectiveCaseTest(compiled.result.ir, scenario),
  )
  return {
    sourceFile: compiled.sourcePath,
    testsRoot: suite.testsRoot,
    testSuiteDigest: suite.digest,
    caseId: compiled.result.ir.case.id,
    caseVersion: compiled.result.ir.case.version,
    ok: tests.every(({ ok }) => ok),
    tests,
  }
}

export function formatConformanceResult(result: DetectiveCaseConformanceResult): string {
  const lines = [
    `${result.ok ? 'PASS' : 'FAIL'} ${result.caseId}@${result.caseVersion} (${result.tests.length} detective scenarios)`,
  ]
  for (const test of result.tests) {
    lines.push(
      `  ${test.ok ? 'PASS' : 'FAIL'} ${test.id} (${test.commandCount} commands, revision ${test.revision})`,
    )
    for (const item of test.failures) {
      lines.push(`    ${item.expectation}: ${item.message}`)
    }
  }
  return lines.join('\n')
}

export function conformanceSummaryValue(result: DetectiveCaseConformanceResult): JsonValue {
  return {
    caseId: result.caseId,
    ok: result.ok,
    passed: result.tests.filter(({ ok }) => ok).length,
    total: result.tests.length,
  }
}
