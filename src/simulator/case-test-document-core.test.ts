import { describe, expect, it } from 'vitest'

import type { CompiledCaseIR } from '../compiler'
import {
  createCaseTestSuite,
  parseCaseTestDocument,
  parseCaseTestSuite,
} from './case-test-document-core'

const IR = {
  case: { id: 'demo.browser', version: '1.0.0' },
  capabilityLocks: [{ specifier: 'investigation@1' }],
  evidence: [],
  observations: [],
  deductions: [],
  affordances: [],
  assets: [],
  private: {
    conversations: [],
    reactions: [],
    outcomes: [],
  },
} as unknown as CompiledCaseIR

function scenario(id: string): string {
  return `schema: case-test/v0.1
case: {id: demo.browser, version: 1.0.0}
scenario:
  id: ${id}
  perspective: detective
  steps:
    - expect: {state: {status: active}}
`
}

describe('browser-safe case test document core', () => {
  it('sorts and digests an in-memory flat tests directory like the Node loader', () => {
    const suite = parseCaseTestSuite(
      [
        { fileName: 'z_last.yml', sourceText: scenario('z_last') },
        { fileName: 'README.md', sourceText: '# ignored' },
        { fileName: 'a_first.yml', sourceText: scenario('a_first') },
      ],
      IR,
      { packageRoot: 'memory://case', testsRoot: 'memory://case/tests' },
    )
    const direct = createCaseTestSuite([
      parseCaseTestDocument(scenario('a_first'), { fileName: 'a_first.yml', ir: IR }),
      parseCaseTestDocument(scenario('z_last'), { fileName: 'z_last.yml', ir: IR }),
    ], { packageRoot: 'memory://case', testsRoot: 'memory://case/tests' })

    expect(suite.scenarios.map(({ id }) => id)).toEqual(['a_first', 'z_last'])
    expect(suite.digest).toBe(direct.digest)
    expect(suite.packageRoot).toBe('memory://case')
  })

  it('rejects nested and noncanonical in-memory test filenames', () => {
    expect(() =>
      parseCaseTestSuite(
        [{ fileName: 'nested/scenario.yml', sourceText: scenario('scenario') }],
        IR,
      ),
    ).toThrowError(/must be flat/)
    expect(() =>
      parseCaseTestSuite(
        [{ fileName: 'scenario.yaml', sourceText: scenario('scenario') }],
        IR,
      ),
    ).toThrowError(/\.yml extension/)
  })
})
