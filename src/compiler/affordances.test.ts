import { describe, expect, it } from 'vitest'

import { compileCaseSource } from './compiler'

const SOURCE = `schema: case-source/v0.1
case:
  id: demo.affordance-fixture
  version: 0.1.0
  title: Affordance Fixture
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time: {date: "2026-01-01", timezone: UTC, starts_at: "10:00"}
  synopsis: A synthetic public-command fixture.
use: [investigation@1, artifacts@1, generic-actions@1]
cast:
  caller: {name: Caller, role: client, client: true}
  private_contact: {name: Private Contact, role: source, protected: true}
places: {site: Test Site}
things: {item: {type: object, name: Item}}
truth:
  events:
    incident: {at: "10:01", type: item.moved, actor: caller, object: item, place: site}
  facts: {}
perspectives: {}
opening:
  call: {from: caller, text: Inspect the item.}
  grants: [seed]
  starts: []
evidence:
  seed:
    tool: document
    at: start
    reports: {value: clue}
deductions:
  located:
    conclude: {item: item, status: located}
    prove: {any: [[seed.value]]}
affordances:
  inspect_item:
    label: {$text: affordances.inspect_item.label}
    result: {$text: affordances.inspect_item.result}
    risk: consequential
    confirmation: {$text: affordances.inspect_item.confirmation}
    surface: files
    initial: offered
    action: {action: preserve, target: item}
    cost: {clock: case-time, by: 45s}
  later_search:
    label: Search the index
    surface: web
    initial: withdrawn
    action: {action: search, query: synthetic-query}
    exclusive: false
  test_location:
    label: Test the location theory
    surface: casebook
    initial: offered
    deduction: located
flags: []
reactions:
  - on: {observed: seed.value}
    once: true
    do: [{offer: later_search}]
  - on: {action: preserve, target: item}
    once: true
    do: [{offer: later_search}, {withdraw: inspect_item}]
deadlines: {}
objectives:
  solve: {supported: located}
outcomes:
  resolved: {title: Resolved, priority: 100, require: [solve], final_target: caller}
`

function compile(source = SOURCE) {
  return compileCaseSource(source, {
    fileName: 'affordance-fixture.case.yml',
    localization: {
      defaultLocale: 'en',
      availableKeys: new Set([
        'affordances.inspect_item.label',
        'affordances.inspect_item.result',
        'affordances.inspect_item.confirmation',
      ]),
    },
  })
}

describe('public affordance compilation', () => {
  it('compiles an explicit localized command surface without adding it to bootstrap data', () => {
    const result = compile()

    expect(result.ok, result.diagnostics.map(({ message }) => message).join('\n')).toBe(true)
    expect(result.ir?.affordances).toEqual([
      {
        id: 'inspect_item',
        label: {$text: 'affordances.inspect_item.label'},
        result: {$text: 'affordances.inspect_item.result'},
        risk: 'consequential',
        confirmation: {$text: 'affordances.inspect_item.confirmation'},
        surface: 'files',
        initial: 'offered',
        intent: {kind: 'action', action: {kind: 'action', verb: 'preserve', target: 'item'}},
        exclusive: true,
        cost: {clock: 'case-time', milliseconds: 45_000},
        once: true,
      },
      {
        id: 'later_search',
        label: 'Search the index',
        surface: 'web',
        initial: 'withdrawn',
        intent: {kind: 'action', action: {kind: 'action', verb: 'search', query: 'synthetic-query'}},
        exclusive: false,
        risk: 'normal',
        once: true,
      },
      {
        id: 'test_location',
        label: 'Test the location theory',
        surface: 'casebook',
        initial: 'offered',
        intent: {kind: 'deduce', deductionId: 'located'},
        exclusive: true,
        risk: 'normal',
        once: true,
      },
    ])
    expect(JSON.stringify(result.publicManifest)).not.toContain('inspect_item')
    expect(JSON.stringify(result.publicManifest)).not.toContain('synthetic-query')
    expect(result.ir?.private.reactions).toContainEqual(expect.objectContaining({
      trigger: {kind: 'observation-observed', observationId: 'seed.value'},
    }))
  })

  it('rejects duplicate commands and unknown affordance effects', () => {
    const duplicate = compile(SOURCE.replace(
      'action: {action: search, query: synthetic-query}',
      'action: {action: preserve, target: item}',
    ))
    expect(duplicate.ok).toBe(false)
    expect(duplicate.diagnostics.map(({ code }) => code)).toContain('E_DUPLICATE_AFFORDANCE_ACTION')

    const overlap = compile(SOURCE.replace(
      'action: {action: search, query: synthetic-query}',
      'action: {action: preserve, target: item, topic: follow-up}',
    ))
    expect(overlap.ok).toBe(false)
    expect(overlap.diagnostics.map(({ code }) => code)).toContain('E_OVERLAPPING_AFFORDANCE_ACTION')

    const duplicateDeduction = compile(SOURCE.replace(
      'action: {action: search, query: synthetic-query}',
      'deduction: located',
    ))
    expect(duplicateDeduction.ok).toBe(false)
    expect(duplicateDeduction.diagnostics.map(({ code }) => code)).toContain(
      'E_DUPLICATE_AFFORDANCE_COMMAND',
    )

    const unknownEffect = compile(SOURCE.replace('offer: later_search', 'offer: absent_prompt'))
    expect(unknownEffect.ok).toBe(false)
    expect(unknownEffect.diagnostics.map(({ code }) => code)).toContain('E_UNKNOWN_AFFORDANCE')
  })

  it('rejects public commands that identify a protected entity', () => {
    const result = compile(SOURCE.replace(
      'action: {action: preserve, target: item}',
      'action: {action: preserve, target: private_contact}',
    ))

    expect(result.ok).toBe(false)
    expect(result.diagnostics.map(({ code }) => code)).toContain('E_PUBLIC_AFFORDANCE_LEAK')
  })

  it('rejects an observed trigger that does not name a declared observation', () => {
    const result = compile(SOURCE.replace('observed: seed.value', 'observed: seed.absent'))

    expect(result.ok).toBe(false)
    expect(result.diagnostics.map(({ code }) => code)).toContain('E_UNKNOWN_OBSERVATION')
  })

  it('rejects an affordance cost outside the safe millisecond range', () => {
    const result = compile(SOURCE.replace('by: 45s', 'by: 999999999999999999999999999999d'))

    expect(result.ok).toBe(false)
    expect(result.diagnostics.map(({ code }) => code)).toContain('E_AFFORDANCE_COST')
  })

  it('rejects repeatable deduction affordances', () => {
    const result = compile(SOURCE.replace(
      '    deduction: located',
      '    deduction: located\n    once: false',
    ))

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_REPEATABLE_DEDUCTION_AFFORDANCE',
      path: '/affordances/test_location/once',
    }))
  })

  it('requires every deduction to have an affordance once the case declares any affordance', () => {
    const missing = compile(SOURCE.replace(
      /  test_location:\n    label: Test the location theory\n    surface: casebook\n    initial: offered\n    deduction: located\n/,
      '',
    ))
    expect(missing.ok).toBe(false)
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_MISSING_DEDUCTION_AFFORDANCE',
      path: '/deductions/located',
    }))

    const legacy = compile(
      SOURCE
        .replace(/affordances:\n[\s\S]*?\nflags: \[\]/, 'affordances: {}\nflags: []')
        .replace(/reactions:\n[\s\S]*?\ndeadlines: \{\}/, 'reactions: []\ndeadlines: {}'),
    )
    expect(legacy.ok, legacy.diagnostics.map(({ message }) => message).join('\n')).toBe(true)
  })

  it('rejects direct and nested self-reoffers of one-shot action affordances', () => {
    const direct = compile(SOURCE.replace('{withdraw: inspect_item}', '{offer: inspect_item}'))
    expect(direct.ok).toBe(false)
    expect(direct.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_AFFORDANCE_SELF_REOFFER',
      path: '/reactions/1/do/1/offer',
    }))

    const nested = compile(
      SOURCE
        .replace('flags: []', 'flags: [retry]')
        .replace(
          '{withdraw: inspect_item}',
          '{if-marked: retry, then: [{offer: inspect_item}]}',
        ),
    )
    expect(nested.ok).toBe(false)
    expect(nested.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_AFFORDANCE_SELF_REOFFER',
      path: '/reactions/1/do/1/then/0/offer',
    }))

    const repeatable = compile(
      SOURCE
        .replace('    cost: {clock: case-time, by: 45s}', '    cost: {clock: case-time, by: 45s}\n    once: false')
        .replace('{withdraw: inspect_item}', '{offer: inspect_item}'),
    )
    expect(repeatable.ok, repeatable.diagnostics.map(({ message }) => message).join('\n')).toBe(true)
  })
})
