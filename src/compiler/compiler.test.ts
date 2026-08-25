import { parse, stringify } from 'yaml'
import { describe, expect, it } from 'vitest'

import { canonicalize, compareCanonicalStrings } from './canonical'
import {
  auditPublicManifest,
  compileCaseSource,
  compileCaseSourceOrThrow,
} from './compiler'

const MINIMAL_SOURCE = `schema: case-source/v0.1
case:
  id: demo.minimal
  version: 0.1.0
  title: Minimal Case
  locale: tr
  duration: 30m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: 2026-10-17, timezone: Europe/Istanbul, starts_at: "21:35"}
  synopsis: Public setup only.
use: [investigation@1, artifacts@1, generic-actions@1]
cast:
  client: {name: Client, role: witness, client: true}
  suspect: {name: Suspect, role: suspect}
  protected_source: {name: Secret Person, role: source, protected: true}
conversations:
  client:
    initial: reachable
    states: {reachable: {can_talk: true}}
    channels: {interview: actor}
  suspect:
    initial: refusing
    states:
      refusing: {can_talk: false, reason: Declines contact.}
      reachable: {can_talk: true}
    channels: {interview: actor, apologize: target}
    allow_while_unavailable: [apologize]
places: {room: Room}
things: {device: {type: device, name: Device}}
truth:
  events:
    incident: {at: "21:40", type: device.used, actor: suspect, device: device, place: room}
  facts: {}
perspectives:
  suspect:
    knows: [incident]
    believes: [{relation: incident.caused-by, value: suspect}]
    says: {initial: [{relation: innocence, value: true, intent: deliberate-lie}]}
opening:
  call: {from: client, text: Please investigate.}
  grants: [clue]
  starts: [escape]
evidence:
  clue:
    tool: document
    at: start
    reports: {operator: suspect, secret_code: alpha}
  locked_clue:
    tool: log
    unlock: {after: observe, ref: clue.operator}
    reports: {device: device, hidden_value: omega}
deductions:
  culprit:
    conclude: {incident: incident, perpetrator: suspect}
    prove: {any: [[clue.operator, locked_clue.device]]}
flags: [fixture_preserved]
reactions:
  - on: {action: apologize, target: suspect}
    once: true
    do: [{conversation: [suspect, reachable]}]
  - on: {supported: culprit}
    once: true
    do: [{mark: fixture_preserved}]
deadlines:
  escape:
    clock: wall
    after: 10m
    offline: on-resume-once
    do: [{mark: fixture_preserved}]
objectives:
  solve: {supported: culprit}
outcomes:
  solved: {title: Solved, priority: 10, require: [solve]}
`

describe('case-source/v0.1 compiler', () => {
  it('compiles a private authored assessment with localized presentation handles', () => {
    const assessed = MINIMAL_SOURCE.replace(
      'cast:',
      `assessment:
  max_score: 100
  bands:
    - {min_score: 0, label: {$text: assessment.bands.developing}}
    - {min_score: 80, label: {$text: assessment.bands.strong}}
  categories:
    reasoning:
      label: {$text: assessment.categories.reasoning}
      criteria:
        supported_conclusion:
          points: 70
          when: {supported: culprit}
          met: {$text: assessment.criteria.supported.met}
          missed: {$text: assessment.criteria.supported.missed}
    case_control:
      label: {$text: assessment.categories.case_control}
      criteria:
        before_escape:
          points: 30
          when: {schedule-active: escape}
          met: {$text: assessment.criteria.escape.met}
          missed: {$text: assessment.criteria.escape.missed}
cast:`,
    )
    const keys = new Set([
      'assessment.bands.developing',
      'assessment.bands.strong',
      'assessment.categories.reasoning',
      'assessment.categories.case_control',
      'assessment.criteria.supported.met',
      'assessment.criteria.supported.missed',
      'assessment.criteria.escape.met',
      'assessment.criteria.escape.missed',
    ])
    const result = compileCaseSourceOrThrow(assessed, {
      localization: { defaultLocale: 'tr', availableKeys: keys },
    })

    expect(result.ir.private.assessment).toEqual({
      maxScore: 100,
      bands: [
        {minScore: 0, label: {$text: 'assessment.bands.developing'}},
        {minScore: 80, label: {$text: 'assessment.bands.strong'}},
      ],
      categories: [
        {
          id: 'case_control',
          label: {$text: 'assessment.categories.case_control'},
          criteria: [{
            id: 'before_escape',
            points: 30,
            when: {kind: 'schedule', scheduleId: 'escape', active: true},
            met: {$text: 'assessment.criteria.escape.met'},
            missed: {$text: 'assessment.criteria.escape.missed'},
          }],
        },
        {
          id: 'reasoning',
          label: {$text: 'assessment.categories.reasoning'},
          criteria: [{
            id: 'supported_conclusion',
            points: 70,
            when: {kind: 'supported', deductionId: 'culprit'},
            met: {$text: 'assessment.criteria.supported.met'},
            missed: {$text: 'assessment.criteria.supported.missed'},
          }],
        },
      ],
    })
    expect(result.ir.localization.references).toMatchObject({
      '/assessment/bands/0/label': 'assessment.bands.developing',
      '/assessment/categories/reasoning/label': 'assessment.categories.reasoning',
      '/assessment/categories/reasoning/criteria/supported_conclusion/met': 'assessment.criteria.supported.met',
    })
    expect(JSON.stringify(result.publicManifest)).not.toContain('assessment')
  })

  it('validates assessment totals, bands, condition shape and cross-references', () => {
    const invalid = MINIMAL_SOURCE.replace(
      'cast:',
      `assessment:
  max_score: 90
  bands:
    - {min_score: 10, label: Low}
    - {min_score: 10, label: Duplicate}
    - {min_score: 100, label: Out of range}
  categories:
    reasoning:
      label: Reasoning
      criteria:
        unknown:
          points: 50
          when: {supported: missing_deduction}
          met: Met
          missed: Missed
        malformed:
          points: 30
          when: {all: []}
          met: Met
          missed: Missed
cast:`,
    )
    const result = compileCaseSource(invalid)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_ASSESSMENT_POINTS',
      path: '/assessment/max_score',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_ASSESSMENT_BAND_DUPLICATE',
      path: '/assessment/bands/1/min_score',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_ASSESSMENT_BAND_RANGE',
      path: '/assessment/bands/2/min_score',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_ASSESSMENT_BAND_ZERO',
      path: '/assessment/bands',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_CONDITION_SHAPE',
      path: '/assessment/categories/reasoning/criteria/malformed/when/all',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_UNKNOWN_DEDUCTION',
      path: '/assessment/categories/reasoning/criteria/unknown/when/supported',
    }))
  })

  it('requires positive assessment criterion points', () => {
    const invalid = MINIMAL_SOURCE.replace(
      'cast:',
      `assessment:
  max_score: 1
  bands: [{min_score: 0, label: Low}]
  categories:
    reasoning:
      label: Reasoning
      criteria:
        empty:
          points: 0
          when: {supported: culprit}
          met: Met
          missed: Missed
cast:`,
    )

    expect(compileCaseSource(invalid).diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_SCHEMA',
      path: '/assessment/categories/reasoning/criteria/empty/points',
    }))
  })

  it('compiles generic actor conversation graphs and transition effects', () => {
    const ir = compileCaseSourceOrThrow(MINIMAL_SOURCE).ir

    expect(ir.private.conversations).toContainEqual({
      actorId: 'suspect',
      public: true,
      contactInitial: 'listed',
      presentation: { name: 'Suspect', role: 'suspect' },
      initialStateId: 'refusing',
      states: [
        { id: 'reachable', canTalk: true },
        { id: 'refusing', canTalk: false, reason: 'Declines contact.' },
      ],
      channels: { apologize: 'target', interview: 'actor' },
      allowWhileUnavailable: ['apologize'],
    })
    expect(ir.private.reactions.flatMap(({ effects }) => effects)).toContainEqual({
      kind: 'conversation',
      actorId: 'suspect',
      stateId: 'reachable',
    })
  })

  it('rejects missing conversation states and invalid transition targets', () => {
    const invalid = MINIMAL_SOURCE
      .replace('initial: refusing', 'initial: missing_state')
      .replace('[suspect, reachable]', '[suspect, absent_state]')
    const result = compileCaseSource(invalid)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_CONVERSATION_INITIAL',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_UNKNOWN_CONVERSATION_STATE',
    }))
  })

  it('compiles closed value-aware proof predicates while preserving list alternatives', () => {
    const predicateSource = MINIMAL_SOURCE
      .replace(
        'reports: {operator: suspect, secret_code: alpha}',
        'reports: {operator: suspect, secret_code: alpha, quiet: false, score: 12, tags: [alpha, beta], empty: [], started_at: "10:00", ended_at: "10:05"}',
      )
      .replace(
        '    prove: {any: [[clue.operator, locked_clue.device]]}',
        `    prove:
      any:
        - terms: [clue.quiet, clue.score, clue.tags, clue.empty,
                    clue.started_at, clue.ended_at, locked_clue.device]
          checks:
            - {ref: clue.quiet, equals: false}
            - {ref: clue.quiet, not_equals: true}
            - {ref: clue.score, greater_than: 10}
            - {ref: clue.score, less_than: 20}
            - {ref: clue.tags, contains: beta}
            - {ref: clue.empty, count: 0}
            - {ref: clue.started_at, before: {ref: clue.ended_at}}
            - {ref: clue.ended_at, after: {value: "09:59"}}`,
      )
    const result = compileCaseSourceOrThrow(predicateSource)

    expect(result.ir.deductions[0]?.proofAlternatives[0]?.checks).toEqual([
      { kind: 'equals', ref: 'clue.quiet', value: false },
      { kind: 'notEquals', ref: 'clue.quiet', value: true },
      { kind: 'numberGreaterThan', ref: 'clue.score', value: 10 },
      { kind: 'numberLessThan', ref: 'clue.score', value: 20 },
      { kind: 'arrayContains', ref: 'clue.tags', value: 'beta' },
      { kind: 'arrayCountEquals', ref: 'clue.empty', count: 0 },
      { kind: 'beforeRef', leftRef: 'clue.started_at', rightRef: 'clue.ended_at' },
      { kind: 'afterValue', leftRef: 'clue.ended_at', rightValue: '09:59' },
    ])
    expect(result.ir.deductions[0]?.proofAlternatives[0]?.terms).toContainEqual({
      kind: 'observation',
      ref: 'locked_clue.device',
    })
    // The established compact list remains valid and compiles without checks.
    expect(compileCaseSourceOrThrow(MINIMAL_SOURCE).ir.deductions[0]?.proofAlternatives[0]?.checks)
      .toEqual([])
  })

  it('rejects unknown, unprovenance-tracked, and type-invalid proof checks', () => {
    const base = MINIMAL_SOURCE.replace(
      'reports: {operator: suspect, secret_code: alpha}',
      'reports: {operator: suspect, secret_code: alpha, score: twelve, at: soon}',
    )
    const invalid = base.replace(
      '    prove: {any: [[clue.operator, locked_clue.device]]}',
      `    prove:
      any:
        - terms: [clue.operator, locked_clue.device]
          checks:
            - {ref: clue.secret_code, equals: alpha}
            - {ref: clue.missing, equals: alpha}
            - {ref: clue.score, greater_than: 10}
            - {ref: clue.at, before: {value: later}}`,
    )
    const result = compileCaseSource(invalid)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_PROOF_CHECK_TERM',
      path: '/deductions/culprit/prove/any/0/checks/0/ref',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_PROOF_CHECK_REF',
      path: '/deductions/culprit/prove/any/0/checks/1/ref',
    }))
    expect(result.diagnostics.filter(({ code }) => code === 'E_PROOF_CHECK_TYPE')).toHaveLength(3)
  })

  it('keeps the authored proof-check vocabulary closed', () => {
    const unknownOperator = MINIMAL_SOURCE.replace(
      '    prove: {any: [[clue.operator, locked_clue.device]]}',
      `    prove:
      any:
        - terms: [clue.operator, locked_clue.device]
          checks: [{ref: clue.operator, approximately: suspect}]`,
    )

    const result = compileCaseSource(unknownOperator)
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'E_SCHEMA' }))
  })

  it('preserves translation references as stable presentation handles', () => {
    const localized = MINIMAL_SOURCE
      .replace('title: Minimal Case', 'title: {$text: case.title}')
      .replace('synopsis: Public setup only.', 'synopsis: {$t: case.synopsis}')
      .replace('places: {room: Room}', 'places: {room: {$text: places.room.name}}')
      .replace('text: Please investigate.', 'text: {$text: opening.call}')
      .replace('title: Solved', 'title: {$text: outcomes.solved.title}')
    const result = compileCaseSourceOrThrow(localized, {
      localization: {
        defaultLocale: 'tr',
        availableKeys: new Set([
          'case.title',
          'case.synopsis',
          'places.room.name',
          'opening.call',
          'outcomes.solved.title',
        ]),
      },
    })

    expect(result.ir.case.title).toEqual({ $text: 'case.title' })
    expect(result.ir.case.synopsis).toEqual({ $text: 'case.synopsis' })
    expect(result.ir.entities.places.room).toEqual({ $text: 'places.room.name' })
    expect(result.publicManifest.places.room).toEqual({ $text: 'places.room.name' })
    expect(result.ir.opening.call).toMatchObject({
      text: { $text: 'opening.call' },
    })
    expect(result.ir.private.outcomes[0]?.title).toEqual({
      $text: 'outcomes.solved.title',
    })
    expect(result.ir.localization.references).toEqual({
      '/case/synopsis': 'case.synopsis',
      '/case/title': 'case.title',
      '/opening/call/text': 'opening.call',
      '/outcomes/solved/title': 'outcomes.solved.title',
      '/places/room': 'places.room.name',
    })
  })

  it('compiles localized evidence, deadline, and outcome presentation separately from report data', () => {
    const localized = MINIMAL_SOURCE
      .replace(
        '    tool: document\n    at: start',
        `    tool: document
    presentation:
      title: {$text: evidence.clue.title}
      description: {$text: evidence.clue.description}
      findings:
        operator: {$text: evidence.clue.findings.operator}
    at: start`,
      )
      .replace('  escape:\n    clock: wall', '  escape:\n    label: {$text: deadlines.escape.label}\n    clock: wall')
      .replace('solved: {title: Solved,', 'solved: {title: Solved, body: {$text: outcomes.solved.body},')
    const availableKeys = new Set([
      'evidence.clue.title',
      'evidence.clue.description',
      'evidence.clue.findings.operator',
      'deadlines.escape.label',
      'outcomes.solved.body',
    ])
    const result = compileCaseSourceOrThrow(localized, {
      localization: { defaultLocale: 'tr', availableKeys },
    })

    expect(result.ir.evidence.find(({id}) => id === 'clue')?.presentation).toEqual({
      title: {$text: 'evidence.clue.title'},
      description: {$text: 'evidence.clue.description'},
      findings: {operator: {$text: 'evidence.clue.findings.operator'}},
    })
    expect(result.ir.private.deadlines[0]?.label).toEqual({
      $text: 'deadlines.escape.label',
    })
    expect(result.ir.private.outcomes[0]?.body).toEqual({
      $text: 'outcomes.solved.body',
    })
    expect(result.ir.localization.references).toMatchObject({
      '/evidence/clue/presentation/title': 'evidence.clue.title',
      '/evidence/clue/presentation/description': 'evidence.clue.description',
      '/evidence/clue/presentation/findings/operator': 'evidence.clue.findings.operator',
      '/deadlines/escape/label': 'deadlines.escape.label',
      '/outcomes/solved/body': 'outcomes.solved.body',
    })

    const invalid = compileCaseSource(
      localized.replace(
        '        operator: {$text: evidence.clue.findings.operator}',
        '        missing_field: {$text: evidence.clue.findings.operator}',
      ),
      { localization: { defaultLocale: 'tr', availableKeys } },
    )
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_UNKNOWN_EVIDENCE_FINDING',
      path: '/evidence/clue/presentation/findings/missing_field',
    }))
  })

  it('rejects missing catalogs and translation handles in gameplay data', () => {
    const missingCatalog = compileCaseSource(
      MINIMAL_SOURCE.replace('title: Minimal Case', 'title: {$text: case.title}'),
    )
    expect(missingCatalog.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'E_I18N_CATALOG_REQUIRED', path: '/case/title' }),
    )

    const gameplayReference = compileCaseSource(
      MINIMAL_SOURCE.replace('operator: suspect', 'operator: {$text: evidence.operator}'),
      {
        localization: {
          defaultLocale: 'tr',
          availableKeys: new Set(['evidence.operator']),
        },
      },
    )
    expect(gameplayReference.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'E_I18N_REFERENCE_CONTEXT',
        path: '/evidence/clue/reports/operator',
      }),
    )

    const structuralPlaceField = compileCaseSource(
      MINIMAL_SOURCE.replace(
        'places: {room: Room}',
        'places: {room: {name: Room, floor: {$text: places.room.floor}}}',
      ),
      {
        localization: {
          defaultLocale: 'tr',
          availableKeys: new Set(['places.room.floor']),
        },
      },
    )
    expect(structuralPlaceField.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'E_I18N_REFERENCE_CONTEXT',
        path: '/places/room/floor',
      }),
    )
  })

  it('omits explicitly hidden place labels from the public manifest', () => {
    const localized = MINIMAL_SOURCE.replace(
      'places: {room: Room}',
      `places:
  room: {$text: places.room.name}
  sealed_room: {name: {$text: places.sealed_room.name}, hidden: true}`,
    )
    const result = compileCaseSourceOrThrow(localized, {
      localization: {
        defaultLocale: 'tr',
        availableKeys: new Set(['places.room.name', 'places.sealed_room.name']),
      },
    })

    expect(result.publicManifest.places).toEqual({
      room: { $text: 'places.room.name' },
    })
    expect(result.ir.localization.references).toMatchObject({
      '/places/room': 'places.room.name',
      '/places/sealed_room/name': 'places.sealed_room.name',
    })
  })

  it('expands evidence reports into deterministic dotted observations', () => {
    const result = compileCaseSourceOrThrow(MINIMAL_SOURCE, { fileName: 'minimal.case.yaml' })

    expect(result.ir.observations.map((observation) => observation.id)).toEqual([
      'clue.operator',
      'clue.secret_code',
      'locked_clue.device',
      'locked_clue.hidden_value',
    ])
    expect(result.ir.deductions[0]?.proofAlternatives).toEqual([
      {
        checks: [],
        terms: [
          { kind: 'observation', ref: 'clue.operator' },
          { kind: 'observation', ref: 'locked_clue.device' },
        ],
      },
    ])
    expect(result.ir.private.deadlines[0]).toMatchObject({
      id: 'escape',
      afterMinutes: 10,
      clock: 'wall',
    })
  })

  it('ships only opening evidence handles, never assertion values or private rules', () => {
    const result = compileCaseSourceOrThrow(MINIMAL_SOURCE)
    const serialized = result.canonicalPublicManifestJson

    expect(result.publicManifest.opening.evidence).toEqual([
      { id: 'clue', tool: 'document', assets: [] },
    ])
    expect(serialized).not.toContain('locked_clue')
    expect(serialized).not.toContain('secret_code')
    expect(serialized).not.toContain('alpha')
    expect(serialized).not.toContain('omega')
    expect(serialized).not.toContain('deliberate-lie')
    expect(serialized).not.toContain('Secret Person')
    expect(serialized).not.toContain('protected_source')
    expect(serialized).not.toContain('culprit')
    expect(serialized).not.toContain('outcomes')
    expect(serialized).not.toContain('reactions')
    expect(serialized).not.toContain('capabilityLocks')
    expect(auditPublicManifest(result.publicManifest)).toEqual([])
  })

  it('uses locale-independent raw lexical key ordering', () => {
    const keys = ['z', 'ä', 'a', 'İ', 'i', '😀']
    const ordered = [...keys].sort(compareCanonicalStrings)
    expect(ordered).toEqual(['a', 'i', 'z', 'ä', 'İ', '😀'])
    expect(Object.keys(canonicalize(Object.fromEntries(keys.map((key) => [key, key]))))).toEqual(
      ordered,
    )
  })

  it('emits stable semantic and capability digests', () => {
    const first = compileCaseSourceOrThrow(MINIMAL_SOURCE)
    const reordered = MINIMAL_SOURCE.replace(
      'use: [investigation@1, artifacts@1, generic-actions@1]',
      'use: [generic-actions@1, artifacts@1, investigation@1]',
    )
    const second = compileCaseSourceOrThrow(reordered)

    expect(first.ir.integrity.capabilities).toBe(second.ir.integrity.capabilities)
    expect(first.ir.capabilityLocks.map((lock) => lock.specifier)).toEqual([
      'artifacts@1',
      'generic-actions@1',
      'investigation@1',
    ])
    expect(first.ir.integrity.source).not.toBe(second.ir.integrity.source)
  })

  it('reports cross-reference failures at the YAML source location', () => {
    const broken = MINIMAL_SOURCE.replace('locked_clue.device]]', 'locked_clue.missing]]')
    const result = compileCaseSource(broken, { fileName: 'broken.case.yaml' })
    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === 'E_UNKNOWN_OBSERVATION',
    )

    expect(result.ok).toBe(false)
    expect(diagnostic).toMatchObject({
      path: '/deductions/culprit/prove/any/0/1',
      location: { file: 'broken.case.yaml' },
    })
    expect(diagnostic?.location?.line).toBeGreaterThan(1)
    expect(diagnostic?.location?.column).toBeGreaterThan(0)
  })

  it('rejects duplicate YAML keys before schema compilation', () => {
    const broken = MINIMAL_SOURCE.replace('  title: Minimal Case', '  title: Minimal Case\n  title: Duplicate')
    const result = compileCaseSource(broken)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('E_YAML_PARSE')
  })

  it('supports non-person event actors and evidence gated by a reachable deduction', () => {
    const source = MINIMAL_SOURCE
      .replace(
        'incident: {at: "21:40", type: device.used, actor: suspect, device: device, place: room}',
        'incident: {at: "21:40", type: device.used, actor: device, device: device, place: room}',
      )
      .replace(
        'unlock: {after: observe, ref: clue.operator}',
        'unlock: {after: supported, ref: root_fact}',
      )
      .replace(
        'deductions:\n  culprit:',
        `deductions:
  root_fact:
    conclude: {device: device, relevant: true}
    prove: {any: [[clue.operator]]}
  culprit:`,
      )

    const result = compileCaseSource(source)
    expect(result.ok, result.diagnostics.map((item) => item.message).join('\n')).toBe(true)
  })

  it('lowers unlock macros to a closed typed AST', () => {
    const result = compileCaseSourceOrThrow(MINIMAL_SOURCE)
    expect(result.ir.evidence.find(({ id }) => id === 'locked_clue')?.availability).toEqual({
      kind: 'unlock',
      condition: { kind: 'observed', ref: 'clue.operator' },
    })
  })

  it.each([
    {
      code: 'E_UNKNOWN_CAPABILITY',
      source: MINIMAL_SOURCE.replace('artifacts@1', 'untrusted-tools@1'),
    },
    {
      code: 'E_UNKNOWN_TOOL',
      source: MINIMAL_SOURCE.replace('tool: document', 'tool: quantum-scanner'),
    },
    {
      code: 'E_UNKNOWN_ACTION',
      source: MINIMAL_SOURCE.replace('on: {supported: culprit}', 'on: {action: teleport, target: suspect}'),
    },
    {
      code: 'E_UNKNOWN_TEMPLATE',
      source: MINIMAL_SOURCE.replace('  culprit:\n', '  culprit:\n    use: unknown.magic\n'),
    },
    {
      code: 'E_UNKNOWN_PROVIDER',
      source: MINIMAL_SOURCE.replace(
        'do: [{mark: fixture_preserved}]',
        'do: [{reroute: [locked_clue, archive-search]}]',
      ),
    },
  ])('rejects untrusted author vocabulary with $code', ({ source, code }) => {
    const result = compileCaseSource(source)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true)
  })

  it('keeps executable tests outside the playable case source', () => {
    const source = MINIMAL_SOURCE
      .replace(
        'flags: [fixture_preserved]',
        'tests: {solution: {prove: culprit}}\nflags: [fixture_preserved]',
      )
    const result = compileCaseSource(source)

    expect(result.ok).toBe(false)
    expect(result.diagnostics.some(({ path }) => path === '/tests')).toBe(true)
  })

  it('rejects authored invariants instead of retaining inert declarations', () => {
    const result = compileCaseSource(
      `${MINIMAL_SOURCE}invariants: [canonical-truth-is-immutable]\n`,
    )

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'E_SCHEMA', path: '/invariants' }),
    )
  })

  it('rejects emitted-event reaction cycles', () => {
    const cycle = MINIMAL_SOURCE.replace(
      '  - on: {supported: culprit}',
      `  - on: {event: alpha}
    do: [{emit: beta}]
    once: true
  - on: {event: beta}
    do: [{emit: alpha}]
    once: true
  - on: {supported: culprit}`,
    )
    const result = compileCaseSource(cycle)
    expect(result.diagnostics.some(({ code }) => code === 'E_EMITTED_EVENT_CYCLE')).toBe(true)
  })

  it('derives reaction identity and ordering from semantic content, not YAML order', () => {
    const parsed = parse(MINIMAL_SOURCE) as Record<string, unknown>
    parsed.reactions = [...(parsed.reactions as unknown[])].reverse()
    const first = compileCaseSourceOrThrow(MINIMAL_SOURCE)
    const second = compileCaseSourceOrThrow(stringify(parsed))

    expect(second.ir.private.reactions).toEqual(first.ir.private.reactions)
  })
})

describe('case-independent compiler behavior', () => {
  it('expands timestamp-offset templates and validates their arithmetic generically', () => {
    const source = MINIMAL_SOURCE
      .replace('use: [investigation@1, artifacts@1, generic-actions@1]', 'use: [investigation@1, artifacts@1, generic-actions@1, media-forensics@1]')
      .replace(
        '  culprit:\n',
        `  corrected_time:
    use: media.timestamp-offset
    with: {shown: clue.shown_at, offset: clue.clock_offset}
    conclude: {actor: suspect, exited_at: "10:00"}
    prove: {any: [[clue.shown_at, clue.clock_offset]]}
  culprit:
`,
      )
      .replace(
        'reports: {operator: suspect, secret_code: alpha}',
        'reports: {operator: suspect, secret_code: alpha, shown_at: "10:07", clock_offset: "+7m"}',
      )
    const compiled = compileCaseSourceOrThrow(source)
    const deduction = compiled.ir.deductions.find(({ id }) => id === 'corrected_time')

    expect(deduction?.proofAlternatives[0]?.checks).toContainEqual({
      kind: 'timeOffsetEquals',
      shownRef: 'clue.shown_at',
      offsetRef: 'clue.clock_offset',
      expected: '10:00',
    })
    const broken = compileCaseSource(source.replace('exited_at: "10:00"', 'exited_at: "10:01"'))
    expect(broken.diagnostics.some(({ code }) => code === 'E_TEMPLATE_TIME_ARITHMETIC')).toBe(true)
  })

  it('normalizes absolute case-time deadlines and rejects deadlines before case start', () => {
    const source = MINIMAL_SOURCE.replace(
      `  escape:
    clock: wall
    after: 10m
    offline: on-resume-once`,
      `  escape:
    clock: case-time
    at: "21:40"
    offline: pause`,
    )
    const result = compileCaseSourceOrThrow(source)
    expect(result.ir.private.deadlines.find(({ id }) => id === 'escape')).toMatchObject({
      afterMinutes: 5,
      timing: { kind: 'absolute-case-time', authoredAt: '21:40', dueAtMinute: 1300 },
    })

    const broken = compileCaseSource(source.replace(
      '    at: "21:40"\n    offline: pause',
      '    at: "21:34"\n    offline: pause',
    ))
    expect(broken.diagnostics.some(({ code }) => code === 'E_DEADLINE_BEFORE_START')).toBe(true)
  })
})
