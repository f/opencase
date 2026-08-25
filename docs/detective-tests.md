# Detective case tests

dedektif case tests are ordered, executable scripts written from the
detective's perspective. Observe, act, deduce, and conclude use the same public
intent surface available to a player. Advance and resume are deterministic
host controls for testing time. Every authored expectation asserts only the
projected state a player may observe.

The test engine is generic. It does not contain case IDs, package slugs, clue
routes, expected endings, or imports from `cases/`. A case supplies all of
those details through its own `case.yml` and `tests/*.yml` files. Adding a case
therefore extends the test suite without adding case-specific TypeScript.

The current test document schema is
[`case-test/v0.1`](../schema/case-test.v0.1.schema.json).

## Package layout

Every playable package has this shape:

```text
<parent-directory>/
└── <lowercase-kebab-package-slug>/
    ├── case.yml
    ├── assets/
    │   └── ...
    └── tests/
        ├── README.md                 # optional
        ├── shortest_solution.yml
        └── locked_evidence.yml
```

`case.yml` defines the case. `assets/` contains package media. `i18n/` contains
strict case-bound presentation catalogs. `tests/`
contains private authoring and CI artifacts, with one scenario per `.yml`
file. Do not put a `tests:` key in `case.yml`.

Test files are deliberately outside the case source:

- they are not part of `case-source/v0.1`;
- they are not copied into private source IR or final kernel IR;
- they do not affect source, capability, asset, private-IR, kernel, or public
  manifest digests;
- they are never included in the public bootstrap or asset manifests;
- they can inspect only `case-runtime/public-v1`, even though the files
  themselves remain private package/CI material.

The loader gives the normalized external suite its own private
`case-test-suite/v0.1` digest. It is useful for CI/cache identity and changes
when a scenario filename or normalized semantic content changes. Comments,
formatting, and mapping-key order do not change it. It is not a playable case,
package, kernel, asset, or public-manifest build lock.

Changing only a test does not require a case version bump. Changing case
behavior or pinned asset bytes does.

## Package discovery

The simulator CLI accepts either an exact package directory or a parent
directory containing packages:

```bash
# One package
npx tsx src/simulator/cli.ts cases/my-case

# Every immediate case-package child below cases/
npx tsx src/simulator/cli.ts cases

# Multiple independent roots or packages
npx tsx src/simulator/cli.ts cases examples/cases/my-example
```

Discovery is shallow, deterministic, and case-agnostic. An input containing a
regular `case.yml` is treated as one package. Otherwise, immediate real
directory children containing a regular `case.yml` are selected. Unrelated
siblings are ignored. Package paths are de-duplicated and sorted by raw string
order before execution.

The convenience commands use that same generic discovery:

```bash
npm run cases:test       # discovers every package directly below cases/
npm run examples:test    # discovers every package below examples/cases/
```

No script needs a list of known case names.

## Secure test-suite loading

The complete suite is discovered, read, decoded, parsed, schema-validated, and
cross-reference-validated before the first scenario executes. A malformed
later file cannot leave the suite partially executed.

The `tests/` boundary is intentionally strict:

- `tests/` must be a real directory, not a symbolic link;
- it must contain at least one scenario;
- scenarios must be flat regular files named `<scenario-id>.yml`;
- `.yaml`, nested directories, symbolic links, and unrelated files are
  rejected;
- one regular `README.md` is the only non-scenario entry allowed;
- the filename stem must exactly equal `scenario.id`;
- at most 256 scenarios are allowed;
- each scenario is limited to 256 KiB;
- all scenario files together are limited to 8 MiB;
- files are opened without following the final path component and are checked
  for identity, size, and modification during the read;
- bytes must decode as fatal UTF-8;
- duplicate YAML keys, aliases, custom tags, warnings, and multiple YAML
  documents are rejected;
- files execute in deterministic raw filename order.

Use `.yml` exactly. `full_solution.yaml` is not a compatible alias.

## Document envelope

Every file has exactly three root keys:

```yaml
schema: case-test/v0.1

case:
  id: community.example.my-case
  version: 0.1.0

scenario:
  id: shortest_solution
  perspective: detective
  description: Optional non-empty explanation of the behavior under test.
  steps:
    - expect:
        state:
          outcome: null
```

The fields are closed; unknown keys are errors.

| Path | Requirement |
| --- | --- |
| `schema` | Exactly `case-test/v0.1`. |
| `case.id` | Exact ID of the compiled case. |
| `case.version` | Exact semantic version of the compiled case. |
| `scenario.id` | Lowercase case-local ID matching the filename stem. |
| `scenario.perspective` | Exactly `detective`. |
| `scenario.description` | Optional non-empty string. |
| `scenario.steps` | Non-empty ordered list with at least one `expect`. |

A stale case ID or version fails before execution. This prevents a copied test
from silently running against a different case revision.

## Step model

A step is one of:

1. exactly one `detective.*` operation, optionally followed by `expect`; or
2. an `expect`-only public-state checkpoint.

```yaml
- detective.observe: lobby_video
  expect:
    result: {status: accepted}
    state:
      evidence: {lobby_video: observed}

- expect:
    state:
      outcome: null
```

No step may contain two operations. `expect`-only steps may assert `state` but
not a command `result` because they dispatch no command.

When a command step omits `expect.result`, acceptance is the default. Writing
the result explicitly is recommended: it makes denial tests obvious and
prevents a future reader from mistaking an omitted assertion for intentional
leniency.

## Detective operations

### `detective.observe`

Observe one evidence card by ID:

```yaml
- detective.observe: lobby_video
  expect:
    result: {status: accepted}
```

The card must exist, be granted, and not already have been observed. An
accepted observation makes its source observations available in the public
projection.

Expected denials include:

```yaml
- detective.observe: locked_archive
  expect:
    result: {status: denied, code: evidence-locked}
    state:
      evidence: {locked_archive: hidden}
```

### `detective.act`

Perform one capability-owned action. The mapping accepts exactly the public
`CaseAction` fields:

```yaml
- detective.act:
    action: present
    target: witness
    evidence: interview_draft
    tone: empathetic
  expect:
    result: {status: accepted}
```

| Field | Meaning |
| --- | --- |
| `action` | Required verb contributed by a capability selected in `case.yml`. |
| `target` | Optional target actor, thing, place, or authored action token. |
| `actor` | Optional actor performing or involved in the action. |
| `from` | Optional source actor/value used by request-like actions. |
| `topic` | Optional interview/request topic. |
| `evidence` | Optional evidence ID; that evidence must already be observed. |
| `tone` | Optional presentation/interview tone. |
| `query` | Optional exact search text. |
| `ref` | Optional evidence or observation reference for open/observe routes. |

Every field required by a reaction or unlock must match. A route requiring
`tone: empathetic` does not match `tone: accusatory`. Additional allowed action
fields are preserved in the event; do not rely on an extra field to prevent a
route whose required fields already match. A supported verb may still be
accepted when no reaction matches it; acceptance means the command was legal,
not that it unlocked the intended clue. Pair route-critical actions with a
public-state expectation for the evidence or outcome they must produce.

### `detective.deduce`

Attempt one deduction by ID:

```yaml
- detective.deduce: camera_time_corrected
  expect:
    result: {status: accepted}
    state:
      deductions: {camera_time_corrected: supported}
```

The engine evaluates the deduction against observations and previously
supported deductions already available to the player. The test runner never
fills in a proof route or reads canonical truth for the detective.

### `detective.conclude`

Submit one valid final target:

```yaml
- detective.conclude: selin
  expect:
    result: {status: accepted}
    state:
      final_conclusion: selin
      outcome: full_curtain
```

This is the test DSL shorthand for `submit-conclusion` with the given target.
The target must be allowed by the compiled case. The case's
`final_conclusion` policy still controls whether a later conclusion may
replace it while no outcome is eligible. An eligible outcome closes the case,
so every later test command must expect `{status: denied, code: case-ended}`.

### `detective.advance`

Advance exactly one clock by a positive duration:

```yaml
- detective.advance: {clock: case-time, by: 30m}
  expect:
    result: {status: accepted}
    state:
      clocks: {case-time: 30m}
      outcome: deadline_result
```

Accepted clocks are `wall`, `active`, and `case-time`. `wall` advances the
injected deterministic wall clock and observes it; the other two dispatch
their corresponding kernel commands.

### `detective.resume`

Simulate elapsed offline wall time and resume the case:

```yaml
- detective.resume: {after: 12h}
  expect:
    result: {status: accepted}
    state:
      clocks: {wall: 12h}
      evidence: {workspace_admin_log: available}
```

This advances the deterministic wall clock by `after` and dispatches resume.
Use it for `on-resume-once` consequences and offline behavior. It does not
invent a private schedule event; the runtime decides which overdue work is
delivered.

### Durations

Advance/resume operations use a positive integer followed by one unit:

```text
15s   2m   12h   1d
```

Clock expectations use the same form but also allow exactly `0s`, so a scenario
can prove that advancing one clock left another unchanged. `0m`, other zero
forms, decimals, whitespace, compound durations such as `1h30m`, and missing
units are rejected. Converted milliseconds must fit in JavaScript's safe
integer range.

## Expectations

`expect` has a closed public contract:

```yaml
expect:
  result: {status: accepted}
  state:
    status: active
    clocks: {case-time: 10m}
    evidence:
      clue: {status: observed, assets: [clue-image]}
      later_card: available
      secret_card: hidden
    observations:
      clue.location: archive
      clue.count: 2
    unknown_observations: [later_card.message]
    deductions:
      first_theory: supported
      final_theory: unknown
    final_conclusion: null
    outcome: null
```

An operation step may contain `result`, `state`, or both. An expect-only step
contains `state` only. Every supplied value is exact; omitted fields are not
asserted.

### Command result

Accepted command:

```yaml
result: {status: accepted}
```

Denied command with exact stable code:

```yaml
result: {status: denied, code: deduction-unproven}
```

The runner checks that a denied command leaves the authoritative session
unchanged. It then evaluates any companion public-state expectation against
that unchanged projection.

Common detective-command denial codes are:

`case-ended` may be returned by any operation after an outcome closes the
case. The command leaves clocks and all other authoritative state unchanged.

| Operation | Codes |
| --- | --- |
| observe | `unknown-evidence`, `evidence-locked`, `evidence-already-observed`, `invalid-observation` |
| act | `unsupported-action`, `affordance-unavailable`, `affordance-command-mismatch`, `evidence-not-observed`, `invalid-final-target`, `final-conclusion-locked`, `invalid-action` |
| deduce | `unknown-deduction`, `affordance-unavailable`, `deduction-already-supported`, `deduction-requires-support`, `deduction-unproven`, `invalid-deduction` |

Tests normally reference declared IDs. A deliberately invalid command
reference is accepted by semantic validation only when paired on that same
step with its exact expected denial: `unknown-evidence`, `unknown-deduction`,
`invalid-final-target`, `unsupported-action`, or `evidence-not-observed`, as
appropriate.

### Lifecycle status

```yaml
state: {status: active}
```

Accepted values are `active` and `ended`.

### Clocks

```yaml
state:
  clocks:
    wall: 12h
    active: 4m
    case-time: 10m
```

Clock assertions are elapsed values relative to that scenario's initial
public projection, not absolute epoch or story-clock timestamps. Each supplied
value must match exactly.

### Public affordances

Assert an explicit player-visible command by opaque affordance ID:

```yaml
state:
  affordances:
    request_camera_export: offered
    test_clock_theory: hidden
```

`offered` means the ID occurs in the sanitized runtime projection. `hidden`
means it does not. Tests cannot inspect future labels, commands, costs, or the
private rule that may offer an affordance later.

### Evidence and assets

The compact form asserts only evidence status:

```yaml
state:
  evidence:
    access_log: hidden
    lobby_video: available
    note_scan: observed
```

Statuses map directly to the public projection:

| Status | Public meaning |
| --- | --- |
| `hidden` | No projected evidence card exists. |
| `available` | A projected card exists and has not been observed. |
| `observed` | A projected card exists and was observed. |

The object form can also assert the exact set of public opaque asset IDs:

```yaml
state:
  evidence:
    note_scan:
      status: observed
      assets: [locker-note]
```

Assets are compared as an order-independent exact set. The test document may
name any declared opaque handle attached to that evidence, including a
runtime-delivered handle whose source is not statically public. Asset
`visibility` controls static/bootstrap publication; it does not expose or hide
raw source locators through the handle. `hidden` evidence cannot assert asset
handles. Paths, URLs, providers, source references, and tokens are outside this
contract.

### Observations

Assert exact player-observed JSON values by generated observation ID:

```yaml
state:
  observations:
    lobby_video.screen_exit_at: "21:04"
    access_log.opened: true
    report.tags: [urgent, internal]
```

JSON objects are compared structurally with canonical key ordering; authoring
the same keys in a different order does not change the result. Array order,
value types, and values remain significant.

Assert that known case observations have not entered the public projection:

```yaml
state:
  unknown_observations:
    - locked_archive.owner
    - locked_archive.message
```

An observation cannot appear in both `observations` and
`unknown_observations` in one checkpoint. `unknown_observations` means a real
case observation remains unknown to this detective; it is not a way to name an
invented observation.

### Deductions

```yaml
state:
  deductions:
    camera_time_corrected: supported
    full_explanation: unknown
```

`supported` means a public player hypothesis exists. `unknown` means it does
not. There is no test-only shortcut for structural reachability, solvability,
or automatic proof planning.

### Final conclusion and outcome

```yaml
state:
  final_conclusion: mediate
  outcome: all_protected
```

Use `null` to assert absence:

```yaml
state:
  final_conclusion: null
  outcome: null
```

Non-null values must be valid compiled final targets and outcome IDs.

An ended case can also assert the resolved post-case assessment without
accessing its private rubric:

```yaml
expect:
  state:
    outcome: solved
    assessment: {score: 85, max_score: 100}
```

`assessment` accepts `score`, `max_score`, and an optional resolved
`band_label`. Use `assessment: null` to prove that no rubric was projected.
Conditions, criterion IDs, flags, and the unused report-copy branch remain
private and cannot be asserted.

## What tests cannot assert

Detective case tests cannot name or inspect:

- canonical `truth` or source assertion stores;
- actor `perspectives`, beliefs, omissions, or hidden statements;
- private flags, trust values, metrics, route tokens, or capability slots;
- schedules, deadline IDs/status, or raw event-log entries;
- objective internals or private outcome conditions;
- local paths, remote URLs, provider names/references, source descriptors, or
  credentials (only opaque asset handle IDs may be asserted);
- private compiled IR or the authoritative session object.

Test public consequences instead. For example, do not assert that a deadline
flag was set or an event fired; advance the relevant clock and assert the
public evidence, conclusion, outcome, or lifecycle status that the detective
can observe.

The old inline planner vocabulary (`tests:`, `prove`, `use`, `use_route`,
`omit`, `reachable`, `solvable`, `marked`, `event_once`, and similar private or
optimistic assertions) is not part of `case-test/v0.1`. Do not use it.

## Validation and execution semantics

For each package, the conformance command:

1. securely compiles `case.yml`, verifies local asset bytes, and validates
   external asset descriptors;
2. discovers and validates every `tests/*.yml` document;
3. cross-checks case identity, action vocabulary, final targets, evidence,
   observations, deductions, outcomes, and public asset references;
4. starts one fresh deterministic runtime session per scenario;
5. executes the authored steps strictly in file order, without planning or
   inserting commands;
6. defaults a command without `expect.result` to accepted;
7. checks the exact command result and then the public projection;
8. checks denial atomicity;
9. replays the immutable event log after every command and at scenario end,
   requiring the authoritative replayed state to match;
10. reports every failed expectation with its scenario and step path.

The runner never asks private truth how to solve the case. If an authored route
omits the action that grants a clue, the following observation is denied and
the scenario fails. That is the point of the contract.

## Complete example

```yaml
schema: case-test/v0.1

case:
  id: community.example.missing-note
  version: 0.1.0

scenario:
  id: recover_note
  perspective: detective
  description: Follow the exact public route and recover the note before time expires.
  steps:
    - expect:
        state:
          evidence:
            lobby_photo: available
            archive_note: hidden
          unknown_observations: [archive_note.message]
          deductions:
            note_is_in_archive: unknown
          final_conclusion: null
          outcome: null

    - detective.observe: lobby_photo
      expect:
        result: {status: accepted}
        state:
          evidence: {lobby_photo: observed}
          observations: {lobby_photo.room: archive}

    - detective.act: {action: search, query: "blue note in archive"}
      expect:
        result: {status: accepted}
        state:
          evidence: {archive_note: available}

    - detective.observe: archive_note
      expect:
        result: {status: accepted}
        state:
          observations: {archive_note.message: meeting-moved}

    - detective.deduce: note_is_in_archive
      expect:
        result: {status: accepted}
        state:
          deductions: {note_is_in_archive: supported}

    - detective.conclude: archive
      expect:
        result: {status: accepted}
        state:
          final_conclusion: archive
          outcome: note_recovered
```

## Authoring coverage

Prefer several small scenarios over one route that tries to prove everything.
Useful coverage includes:

- shortest successful solution;
- each materially different proof or evidence route;
- opening evidence and opaque projected asset handles;
- a locked-evidence denial before the legal unlock;
- an unproven deduction denial;
- the exact action/query/tone route and a plausible wrong variant;
- an already-observed or already-supported denial;
- each meaningful final target and wrong conclusion;
- deadline success, deadline failure, cancellation, and offline resume;
- optional evidence omitted from a complete solution;
- recovery after a costly or premature action.

Every command that matters should have an explicit result expectation. Every
route-critical action should assert its public consequence immediately.

## Commands

Run one package:

```bash
npx tsx src/simulator/cli.ts cases/my-case
```

Run all packages directly below a parent directory:

```bash
npx tsx src/simulator/cli.ts cases
```

Run the repository groups:

```bash
npm run cases:test
npm run examples:test
```

Compile and test one package while authoring:

```bash
npx tsx scripts/compile-cases.ts cases/my-case
npx tsx src/simulator/cli.ts cases/my-case
```

Run the complete repository gate before integration:

```bash
npm run check
```

## Load and document error codes

Test-suite loading fails closed with these codes:

| Code | Meaning |
| --- | --- |
| `E_CASE_PACKAGE_TESTS` | Package compilation could not establish the required real `tests/` directory. This occurs before test-document loading. |
| `E_CASE_TEST_DIRECTORY` | Package/tests directory is missing, not real, or has no scenarios. |
| `E_CASE_TEST_ENTRY` | A nested, linked, misnamed, `.yaml`, or unrelated entry was found. |
| `E_CASE_TEST_LIMIT` | Scenario count, file size, or total byte limit was exceeded. |
| `E_CASE_TEST_READ` | A file or directory changed or could not be read safely. |
| `E_CASE_TEST_UTF8` | A scenario is not valid UTF-8. |
| `E_CASE_TEST_YAML` | YAML is malformed, duplicated, aliased, custom-tagged, warned, or multi-document. |
| `E_CASE_TEST_SCHEMA` | The closed `case-test/v0.1` shape or value grammar is invalid. |
| `E_CASE_TEST_IDENTITY` | Filename/scenario ID or case ID/version does not match. |
| `E_CASE_TEST_REFERENCE` | A typed case/action/public-state reference is unknown or contradictory. |

These are loader/document errors, separate from the command denial codes used
inside `expect.result`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A legal action is accepted but nothing unlocks | Compare every action field with the exact reaction/unlock trigger; remove unintended extras. |
| An observation is `evidence-locked` | Add the preceding public action or supported deduction that grants it. |
| A deduction is `deduction-unproven` | Observe every term in one complete proof alternative and support required deductions first. |
| An expected evidence card is `hidden` | The granting reaction did not run, was guarded, or a deadline revoked the card. |
| A clock assertion is wrong | Assert elapsed time from scenario start and use the clock actually owned by the deadline. |
| Resume has no effect | Verify the deadline uses wall time with `on-resume-once` and was started in `opening.starts`. |
| An asset expectation is rejected | Use a public asset ID attached to that evidence; never use its filename or locator. |
| A copied test fails identity validation | Update both `case.id`/`version` and the filename-matching `scenario.id`. |
| A private assertion is rejected | Replace it with the public evidence, observation, deduction, conclusion, outcome, clock, or status consequence. |

For small, copyable packages, see
[`examples/cases/README.md`](../examples/cases/README.md). For the case-source
language itself, see [`case-yaml-reference.md`](case-yaml-reference.md).
