import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compileCaseSourceOrThrow } from '../compiler'
import {
  CASE_TEST_MAX_FILE_BYTES,
  discoverCaseTestFiles,
  loadCaseTestSuite,
  parseCaseTestDocument,
} from './case-test-documents'
import { CaseTestDocumentError } from './errors'

const roots: string[] = []

const GENERIC_SOURCE = `schema: case-source/v0.1
case:
  id: demo.document-fixture
  version: 0.1.0
  title: Document Fixture
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "10:00"}
  synopsis: A generic parser fixture.
use: [investigation@1, artifacts@1, generic-actions@1]
assets:
  public_image:
    kind: image
    source: {https: "https://assets.example.test/image.png"}
    mime_type: image/png
    visibility: public
    integrity: {sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
  private_provider_file:
    kind: file
    source: {provider: signed-media, ref: private-fixture-ref}
    mime_type: application/octet-stream
    visibility: private
    integrity: {sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
cast:
  observer: {name: Observer, role: witness, client: true}
  subject: {name: Subject, role: subject}
affordances:
  inspect_item:
    label: Inspect item
    surface: files
    initial: offered
    action: {action: preserve, target: item}
  test_hypothesis:
    label: Test the hypothesis
    surface: casebook
    initial: offered
    deduction: hypothesis
places: {site: Test Site}
things: {item: {type: object, name: Item}}
truth:
  events:
    incident: {at: "10:01", type: item.moved, actor: subject, object: item, place: site}
  facts: {}
perspectives: {}
opening:
  call: {from: observer, text: Inspect the record.}
  grants: [opening_record]
  starts: []
evidence:
  opening_record:
    tool: document
    at: start
    assets: [public_image, private_provider_file]
    reports: {value: clue_value, place: site}
  locked_record:
    tool: log
    unlock: {after: observe, ref: opening_record.value}
    reports: {detail: later_value}
deductions:
  hypothesis:
    conclude: {item: item, status: located}
    prove: {any: [[opening_record.value]]}
flags: []
reactions: []
deadlines: {}
objectives: {solve: {supported: hypothesis}}
outcomes: {resolved: {title: Resolved, priority: 10, require: [solve]}}
`

function genericIr() {
  return compileCaseSourceOrThrow(GENERIC_SOURCE, { fileName: 'document-fixture.case.yml' }).ir
}

async function packageFixture(): Promise<string> {
  const container = await mkdtemp(join(tmpdir(), 'detective-case-tests-'))
  roots.push(container)
  const packageRoot = join(container, 'fixture-case')
  await mkdir(join(packageRoot, 'tests'), { recursive: true })
  return packageRoot
}

function scenario(
  id: string,
  body = `  - detective.observe: opening_record
    expect:
      result: {status: accepted}
      state:
        evidence: {opening_record: observed}
        observations: {opening_record.place: site}
  - detective.deduce: hypothesis
    expect:
      result: {status: accepted}
      state:
        clocks: {wall: 1m, active: 1m, case-time: 1m}
        deductions: {hypothesis: supported}
        final_conclusion: null
        outcome: resolved`,
): string {
  return `schema: case-test/v0.1
case: {id: demo.document-fixture, version: 0.1.0}
scenario:
  id: ${id}
  perspective: detective
  description: A direct public contract test.
  steps:
${body}
`
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('external detective case test documents', () => {
  it('loads raw-sorted files, keeps a separate digest, and normalizes public grammar', async () => {
    const packageRoot = await packageFixture()
    await writeFile(join(packageRoot, 'tests', 'README.md'), '# Private case tests\n', 'utf8')
    await writeFile(join(packageRoot, 'tests', 'z_last.yml'), scenario('z_last'), 'utf8')
    await writeFile(join(packageRoot, 'tests', 'a_first.yml'), scenario('a_first'), 'utf8')

    const loaded = await loadCaseTestSuite(packageRoot, genericIr())

    expect(loaded.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(loaded.scenarios.map(({ id }) => id)).toEqual(['a_first', 'z_last'])
    expect(loaded.scenarios[0]).toMatchObject({
      schema: 'case-test/v0.1',
      case: { id: 'demo.document-fixture', version: '0.1.0' },
      perspective: 'detective',
      steps: [
        {
          operation: 'observe',
          evidenceId: 'opening_record',
          expect: {
            result: { status: 'accepted' },
            state: {
              evidence: { opening_record: { status: 'observed' } },
              observations: { 'opening_record.place': 'site' },
            },
          },
        },
        {
          operation: 'deduce',
          deductionId: 'hypothesis',
          expect: {
            state: {
              clocks: { wall: 60_000, active: 60_000, 'case-time': 60_000 },
              deductions: { hypothesis: 'supported' },
              finalConclusion: null,
              outcome: 'resolved',
            },
          },
        },
      ],
    })

    await writeFile(
      join(packageRoot, 'tests', 'a_first.yml'),
      scenario('a_first').replace(
        'A direct public contract test.',
        'A changed private test description.',
      ),
      'utf8',
    )
    const changed = await loadCaseTestSuite(packageRoot, genericIr())
    expect(changed.digest).not.toBe(loaded.digest)
  })

  it('normalizes actions, time operations, checkpoints, and every opaque asset handle', () => {
    const source = `schema: case-test/v0.1
case: {id: demo.document-fixture, version: 0.1.0}
scenario:
  id: all_steps
  perspective: detective
  steps:
    - detective.act: {action: observe, ref: opening_record}
      expect: {result: {status: accepted}}
    - detective.advance: {clock: case-time, by: 2m}
    - detective.resume: {after: 1h}
    - expect:
        state:
          status: active
          affordances: {inspect_item: offered}
          evidence:
            opening_record: {status: available, assets: [public_image, private_provider_file]}
          unknown_observations: [opening_record.value]
          deductions: {hypothesis: unknown}
`

    const parsed = parseCaseTestDocument(source, { fileName: 'all_steps.yml', ir: genericIr() })
    expect(parsed.steps).toEqual([
      {
        operation: 'act',
        action: { action: 'observe', ref: 'opening_record' },
        expect: { result: { status: 'accepted' } },
      },
      { operation: 'advance', clock: 'case-time', byMs: 120_000 },
      { operation: 'resume', afterMs: 3_600_000 },
      {
        operation: 'expect',
        expect: {
          state: {
            status: 'active',
            affordances: { inspect_item: 'offered' },
            evidence: {
              opening_record: {
                status: 'available',
                assets: ['public_image', 'private_provider_file'],
              },
            },
            unknownObservations: ['opening_record.value'],
            deductions: { hypothesis: 'unknown' },
          },
        },
      },
    ])
    expect(JSON.stringify(parsed)).not.toContain('private-fixture-ref')
    expect(JSON.stringify(parsed)).not.toContain('signed-media')
  })

  it('allows 0s elapsed clocks but requires positive operation durations', () => {
    const zeroClocks = scenario(
      'zero_clocks',
      `  - expect:
      state:
        clocks: {wall: 0s, active: 0s, case-time: 0s}`,
    )
    const parsed = parseCaseTestDocument(zeroClocks, {
      fileName: 'zero_clocks.yml',
      ir: genericIr(),
    })
    expect(parsed.steps[0]).toMatchObject({
      operation: 'expect',
      expect: { state: { clocks: { wall: 0, active: 0, 'case-time': 0 } } },
    })

    for (const [id, step] of [
      ['zero_advance', '  - detective.advance: {clock: active, by: 0s}'],
      ['zero_resume', '  - detective.resume: {after: 0s}'],
    ] as const) {
      expect(() =>
        parseCaseTestDocument(scenario(id, `${step}\n    expect: {state: {clocks: {wall: 0s}}}`), {
          fileName: `${id}.yml`,
          ir: genericIr(),
        }),
      ).toThrowError(/schema violation/i)
    }

    expect(() =>
      parseCaseTestDocument(
        scenario(
          'noncanonical_zero',
          '  - expect:\n      state:\n        clocks: {wall: 0m}',
        ),
        { fileName: 'noncanonical_zero.yml', ir: genericIr() },
      ),
    ).toThrowError(/schema violation/i)

    expect(() =>
      parseCaseTestDocument(
        scenario(
          'unsafe_elapsed',
          '  - expect:\n      state:\n        clocks: {wall: 9007199254741s}',
        ),
        { fileName: 'unsafe_elapsed.yml', ir: genericIr() },
      ),
    ).toThrowError(/safe millisecond range/i)
  })

  it('allows an unknown command reference only with its exact denial contract', () => {
    const denied = scenario(
      'denied_unknown',
      `  - detective.observe: invented_evidence
    expect: {result: {status: denied, code: unknown-evidence}}`,
    )
    expect(() =>
      parseCaseTestDocument(denied, { fileName: 'denied_unknown.yml', ir: genericIr() }),
    ).not.toThrow()

    expect(() =>
      parseCaseTestDocument(
        denied.replace('{status: denied, code: unknown-evidence}', '{status: accepted}'),
        { fileName: 'denied_unknown.yml', ir: genericIr() },
      ),
    ).toThrowError(/Unknown evidence 'invented_evidence'/)
  })

  it.each([
    ['truth', `state: {truth: {culprit: subject}}`],
    ['events', `state: {events: [case.evidence.observed]}`],
    ['schedules', `state: {schedules: {timeout: active}}`],
    ['flags', `state: {flags: {solved: true}}`],
  ])('rejects private %s expectations at the closed schema boundary', (_name, privateState) => {
    expect(() =>
      parseCaseTestDocument(scenario('private_field', `  - expect:\n      ${privateState}`), {
        fileName: 'private_field.yml',
        ir: genericIr(),
      }),
    ).toThrowError(CaseTestDocumentError)
  })

  it.each([
    [
      'duplicate keys',
      scenario('bad_yaml').replace(
        '  perspective: detective',
        '  perspective: detective\n  perspective: detective',
      ),
    ],
    [
      'aliases',
      scenario('bad_yaml')
        .replace(
          'description: A direct public contract test.',
          'description: &copy A direct public contract test.',
        )
        .replace('perspective: detective', 'perspective: *copy'),
    ],
    [
      'custom tags',
      scenario('bad_yaml').replace(
        'description: A direct public contract test.',
        'description: !private A direct public contract test.',
      ),
    ],
    ['multiple documents', `${scenario('bad_yaml')}---\nextra: document\n`],
  ])('rejects unsafe YAML: %s', (_name, source) => {
    expect(() =>
      parseCaseTestDocument(source, {
        fileName: 'bad_yaml.yml',
        ir: genericIr(),
        expectedScenarioId: 'bad_yaml',
      }),
    ).toThrowError(CaseTestDocumentError)
  })

  it('requires filename/case identity, known refs, and at least one expectation', () => {
    expect(() =>
      parseCaseTestDocument(scenario('inside'), {
        fileName: 'outside.yml',
        ir: genericIr(),
      }),
    ).toThrowError(/must match filename/)

    expect(() =>
      parseCaseTestDocument(scenario('identity').replace('version: 0.1.0', 'version: 9.9.9'), {
        fileName: 'identity.yml',
        ir: genericIr(),
      }),
    ).toThrowError(/but the compiled case is/)

    expect(() =>
      parseCaseTestDocument(
        scenario('bad_reference').replace(
          'opening_record.place: site',
          'opening_record.missing: site',
        ),
        { fileName: 'bad_reference.yml', ir: genericIr() },
      ),
    ).toThrowError(/Unknown observation 'opening_record.missing'/)

    expect(() =>
      parseCaseTestDocument(scenario('no_expect', '  - detective.observe: opening_record'), {
        fileName: 'no_expect.yml',
        ir: genericIr(),
      }),
    ).toThrowError(/schema violation/i)

    expect(() =>
      parseCaseTestDocument(
        scenario(
          'hidden_handle',
          `  - expect:
      state:
        evidence:
          locked_record: {status: hidden, assets: [private_provider_file]}`,
        ),
        { fileName: 'hidden_handle.yml', ir: genericIr() },
      ),
    ).toThrowError(/Hidden evidence cannot expose asset handles/)

    expect(() =>
      parseCaseTestDocument(
        scenario(
          'unknown_affordance',
          '  - expect:\n      state:\n        affordances: {absent_prompt: hidden}',
        ),
        { fileName: 'unknown_affordance.yml', ir: genericIr() },
      ),
    ).toThrowError(/Unknown affordance 'absent_prompt'/)
  })

  it('rejects nested, .yaml, symlink, invalid UTF-8, and oversized test entries', async () => {
    const nested = await packageFixture()
    await mkdir(join(nested, 'tests', 'nested'))
    await expect(discoverCaseTestFiles(nested)).rejects.toMatchObject({ code: 'E_CASE_TEST_ENTRY' })

    const yaml = await packageFixture()
    await writeFile(join(yaml, 'tests', 'scenario.yaml'), scenario('scenario'), 'utf8')
    await expect(discoverCaseTestFiles(yaml)).rejects.toMatchObject({ code: 'E_CASE_TEST_ENTRY' })

    const linked = await packageFixture()
    const target = join(linked, 'scenario.yml')
    await writeFile(target, scenario('scenario'), 'utf8')
    await symlink(target, join(linked, 'tests', 'scenario.yml'))
    await expect(discoverCaseTestFiles(linked)).rejects.toMatchObject({ code: 'E_CASE_TEST_ENTRY' })

    const invalidUtf8 = await packageFixture()
    await writeFile(join(invalidUtf8, 'tests', 'invalid.yml'), Uint8Array.from([0xc3, 0x28]))
    await expect(loadCaseTestSuite(invalidUtf8, genericIr())).rejects.toMatchObject({
      code: 'E_CASE_TEST_UTF8',
    })

    const oversized = await packageFixture()
    await writeFile(
      join(oversized, 'tests', 'oversized.yml'),
      `#${'x'.repeat(CASE_TEST_MAX_FILE_BYTES)}`,
      'utf8',
    )
    await expect(loadCaseTestSuite(oversized, genericIr())).rejects.toMatchObject({
      code: 'E_CASE_TEST_LIMIT',
    })
  })
})
