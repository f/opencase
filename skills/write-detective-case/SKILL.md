---
name: write-detective-case
description: Create, extend, review, repair, or validate dedektif case packages written as case.yml plus assets/, i18n/, and tests/. Use when an AI must turn a mystery brief into a playable YAML case, add evidence or media, localize presentation copy, design progressive affordances, deductions, or deadlines, write external detective-perspective scenarios, diagnose compiler/test failures, or migrate case-specific code into the generic package format.
---

# Write Detective Case

Author portable case packages without adding case-specific branches to the
engine. Keep canonical truth private, make every conclusion earnable through a
legal evidence route, and prove the package through explicit public commands
in its own `tests/*.yml` files.

## Load the contract

1. Find the repository root containing `package.json`, `schema/`, and `cases/`.
2. Read `docs/case-yaml-reference.md`, `docs/case-i18n.md`, and
   `docs/detective-tests.md` completely
   before editing YAML.
3. Read `examples/cases/README.md`, then inspect the complete smallest package
   matching the requested mechanic, including its `tests/` directory.
4. Inspect `schema/case-source.v0.1.schema.json` and
   `schema/case-test.v0.1.schema.json`. Inspect
   `src/capabilities/catalog.ts` when using an unfamiliar field, tool,
   template, command, or asset provider. Do not invent vocabulary that the
   installed capability registry does not own.
5. Inspect an existing full case only for advanced patterns. Do not copy its
   story, IDs, hidden truth, or unnecessary complexity.

Treat the schema, compiler, capability registry, and runtime tests as
authoritative when prose documentation and code differ.

## Build the case in this order

### 1. Preserve the brief

- Extract the incident, culprit or explanation, motive, timeline, places,
  objects, witnesses, deadline, and desired tone.
- Separate facts supplied by the user from creative assumptions.
- Ask only when a missing choice would materially change the mystery. Make
  small reversible assumptions otherwise and record them in the handoff.
- Never silently change the requested solution to make authoring easier.

### 2. Create a portable package

Use this shape:

```text
cases/<lowercase-kebab-slug>/
  case.yml
  assets/
  i18n/
    <case.locale>.yml
  tests/
    <scenario-id>.yml
```

Create real `assets/`, `i18n/`, and `tests/` directories. Bind every catalog
to the exact case ID and version. The default catalog must cover every `$text`
reference; never put `$text` in gameplay data. Keep at least one scenario in
`tests/`; never add a `tests:` key to `case.yml`. Use stable lowercase IDs.
Keep the case ID namespaced, for example `community.author.case-name`, and bump
the semantic version whenever compiled behavior or pinned content changes.
Do not register the slug in engine code; the CLIs discover packages from their
parent directory.

### 3. Model knowledge before gameplay

- Write immutable canonical events and facts under `truth`.
- Put each actor's knowledge, beliefs, statements, omissions, and lies under
  `perspectives`; do not rewrite a belief as world truth.
- Remember that absence means `unknown`, not false. Express denial with an
  explicit negative polarity.
- Keep event time/validity separate from when a claim or observation is made.
- Check that chronology is physically possible before building clues.

### 4. Design progressive evidence and affordances

- Start with no investigative evidence when an authored first action can obtain
  it. Otherwise grant only the single opening artifact needed to choose that
  action. Never bulk-grant footage, logs, notices, interviews, or other clues
  the detective should earn.
- Define every player-visible move under `affordances` with a localized label,
  surface, lifecycle state, and exact action or deduction intent. Add a
  case-time `cost` when the move should consume time. Use localized `result`
  copy for the successful effect, classify `risk` as `normal`,
  `consequential`, or `terminal`, and add localized `confirmation` copy when a
  shell should ask before dispatch. Result copy is revealed only after the move
  succeeds. These presentation fields never apply the consequence by
  themselves; model it with cost and reactions.
- Include every route-critical `topic`, `query`, `tone`, `evidence`, `ref`, or
  routed actor field in the affordance command. Never derive or expect the UI
  to derive a move from private unlocks, reactions, truth, or tests.
- Keep action affordances `exclusive: true` by default so omitted or altered
  arguments cannot bypass their offer state or cost. Set `exclusive: false`
  only for intentional free-form attempts, model their cost or consequence
  through a broad reaction, and keep the exact hidden or consumed command
  denied.
- Unlock later evidence through typed legal routes such as observation,
  interview, search, trust, action, or supported deduction. Offer and withdraw
  the corresponding public affordances through authored effects.
- Give every report field a stable observation ID of
  `<evidence-id>.<report-field>`.
- Give player-facing evidence an explicit `presentation`. Its localized
  `title` and optional `description` are visible when granted. Its localized
  `findings` appear only after observation. Every finding key must match a
  field in that evidence card's `reports`; write readable findings for every
  report fact the player needs to understand.
- Keep evidence availability separate from observation. Require an explicit
  detective observation before a report can support a deduction.
- Make misleading evidence explainably unreliable; do not make it arbitrarily
  wrong.
- Demonstrate each required clue's legal route with explicit detective
  commands without relying on private truth or automatic planning.
- Provide at least one recovery route after any intentionally premature or
  costly action unless the brief explicitly requires a hard failure.
- Keep callable non-caller contacts hidden until localized story copy actually
  names them. Author an Inbox `locate-contact` affordance anchored to that
  opening/evidence/completed-action note, then list the actor and offer their
  Phone action unconditionally in the exact matching one-shot reaction. One
  lookup must list only its own target. Never infer a name from prose.
- Add a scenario that asserts `contacts: {actor: hidden}`, the offered lookup,
  and its visible context note, then the accepted zero-cost lookup,
  `contacts: {actor: listed}`, and the callable affordance. For evidence
  anchors, assert the evidence is available or observed. For completed-action
  anchors, explicitly complete the referenced affordance first. The compiler
  proves route structure; the scenario proves the mention path cannot strand
  the player.

Use case-specific IDs and copy, but keep this separation:

```yaml
evidence:
  access_log:
    tool: log
    presentation:
      title: {$text: evidence.access_log.title}
      findings:
        entry_time: {$text: evidence.access_log.findings.entry_time}
    unlock: {request: access-log}
    reports: {entry_time: "21:04"}

affordances:
  request_access_log:
    label: {$text: affordances.request_access_log.label}
    result: {$text: affordances.request_access_log.result}
    risk: normal
    confirmation: {$text: affordances.request_access_log.confirmation}
    surface: phone
    initial: offered
    action: {action: request, topic: access-log}
```

### 5. Make deductions explicit

- Define the conclusion independently from its proof.
- Express alternative proof routes as DNF: every inner list is an AND route;
  the outer `any` list is OR.
- Use a legacy term list only when observation presence is genuinely enough.
  When a value matters, use an object alternative with `terms` and closed
  `checks` such as `equals`, `not_equals`, numeric bounds, array membership or
  count, and `before`/`after`. Include every checked reference in `terms`.
- Treat observed `false`, `0`, `null`, and an empty array as real values;
  never confuse them with an unobserved field. Value checks fail closed when a
  referenced observation is missing or has the wrong type.
- Require only observations or supported deductions the player can legally
  obtain.
- Expose each playable theory as a localized deduction affordance only when the
  detective has reached the point where testing it is meaningful.
- Avoid deductions that assert more than their evidence establishes.
- Keep the final conclusion separate from intermediate deductions.

### 6. Add reactions, time, and endings

- Trigger reactions only from supported deductions, authored actions/decisions,
  or emitted events; guard them with supported/observed/flag/schedule
  conditions. Trust can gate evidence unlocks or change as an effect, but it is
  not a reaction trigger or condition in v0.1.
- Keep reaction effects declarative. Do not mutate runtime state directly.
- Use generic `offer` and `withdraw` effects to advance the public choice set.
  Verify that successful affordance commands pay their authored case-time cost
  and that denied or unproven commands pay nothing.
- Choose the clock intentionally: wall time continues in the real world,
  active time advances during play, and case time represents the fiction.
- Give player-relevant deadlines a localized `label`. It is presentation copy,
  while `clock`, `after`/`at`, `offline`, and `do` remain the schedule logic.
- Make schedule cancellation and shifts idempotent where late evidence may
  arrive.
- Write every objective value as a condition mapping; v0.1 can silently omit a
  scalar objective.
- Give outcomes explicit priorities and objective requirements. Add a
  localized `body` when the ending needs more explanation than its title.
- When the case needs a scored result, add one generic top-level `assessment`
  rubric. Score only facts the case state can prove. Use localized category,
  band, `met`, and `missed` copy. Make all criterion points add up exactly to
  `max_score`; include a zero score band. Never make the shell infer score from
  outcome IDs, translated titles, or private flags.
- Treat every eligible outcome as terminal. If a `replaceable` premature
  conclusion should remain recoverable, make sure it does not match an outcome;
  later commands are rejected with `case-ended` after any outcome is eligible.
- Cover success, plausible failure, wrong conclusion, and deadline behavior
  when those routes exist.

```yaml
deadlines:
  archive_closes:
    label: {$text: deadlines.archive_closes.label}
    clock: case-time
    after: 20m
    offline: pause
    do: [{emit: archive-closed}]

assessment:
  max_score: 100
  bands:
    - {min_score: 80, label: {$text: assessment.bands.strong}}
    - {min_score: 0, label: {$text: assessment.bands.review}}
  categories:
    reasoning:
      label: {$text: assessment.categories.reasoning}
      criteria:
        identify_source:
          points: 100
          when: {supported: source_identified}
          met: {$text: assessment.criteria.identify_source.met}
          missed: {$text: assessment.criteria.identify_source.missed}

outcomes:
  solved:
    title: {$text: outcomes.solved.title}
    body: {$text: outcomes.solved.body}
    priority: 100
    require: [identify_source]
```

### 7. Add assets safely

- Put local media below the package's `assets/` directory.
- Declare its kind, exact MIME type, visibility, source, and lowercase SHA-256.
- Attach assets to evidence by asset ID, never by filesystem path or URL.
- When the brief requests raster evidence, use the built-in ImageGen workflow.
  Generate each distinct asset with a purpose-specific prompt, inspect the
  result, and iterate when it contains misleading details, unsafe branding, or
  visual defects.
- Store the selected project asset under `assets/` as PNG or WebP before
  referencing it. Do not leave a case dependency only in ImageGen's generated
  output directory.
- Keep every exact playable fact structural under `evidence.*.reports` and use
  the generated image only as its visual presentation. Do not make a domain,
  time, account ID, measurement, identity, or proof term depend on generated
  pixels.
- Never substitute a crude placeholder SVG for requested raster evidence. Use
  SVG only when the user explicitly requests vector artwork or the asset is
  genuinely better represented as deterministic vector data.
- Use HTTPS or a registered provider only when the host has the corresponding
  trusted adapter. Keep locators private and pin the exact delivered bytes.
- Generate images or sounds only when requested or required by the brief. Do
  not fabricate evidence media merely to fill the folder.
- Recompute the digest after every byte change.

### 8. Author executable scenarios

- Put one `case-test/v0.1` scenario in each
  `tests/<scenario-id>.yml`. Match `scenario.id` to the filename stem and match
  the exact case ID/version.
- Keep tests private and external to playable case/package/kernel/public IR and
  digest inputs. Their only digest is the separate private test-suite digest.
  Never copy them into generated public output.
- Write the route in order with `detective.observe`, `detective.act`,
  `detective.deduce`, `detective.conclude`, `detective.advance`, and
  `detective.resume`. Never use inline tests, planner goals, `prove`, `use`,
  `use_route`, `omit`, `reachable`, or `solvable` test shorthand.
- Add an explicit `expect.result` to every important command. Pair intentional
  denials with the exact code, such as `evidence-locked` or
  `deduction-unproven`.
- Assert only public `state`: lifecycle status, elapsed clocks, offered/hidden
  affordances, hidden/available/observed evidence, opaque asset handle IDs,
  exact observations, unknown observations, supported/unknown deductions,
  final conclusion, and outcome.
- Never assert truth, perspectives, flags, trust, metrics, schedules, events,
  objectives, capability state, or raw asset locators/source descriptors.
  Assert media only by the opaque handle ID projected with granted evidence;
  static asset `visibility` is not a locator-privacy classification.
- Include the shortest complete solution and every materially different proof
  route. Add locked evidence, unproven deduction, exact/wrong action,
  deadline, offline/resume, optional evidence, early accusation, and wrong
  conclusion scenarios when those mechanics exist.
- Make every unlock happen through its actual preceding command. Never let a
  test engine invent an event, auto-observe evidence, or auto-prove a
  deduction.
- Assert `state.affordances` before and after every route-changing action or
  deduction. Prove the complete loop: minimal opening, offered localized move,
  accepted exact command and time cost, available evidence, explicit observe,
  offered deduction, and authored consequence.
- When using `exclusive: false`, test a permitted alternate attempt and prove
  that the exact authored command still returns `affordance-unavailable` while
  hidden or after one-shot consumption.

## Validate before handing off

Run the package compiler and simulator directly so only the target package is
selected:

```bash
npx tsx scripts/compile-cases.ts cases/<slug>
npx tsx src/simulator/cli.ts cases/<slug>
```

For a package under `examples/cases/`, pass that path instead. If engine,
compiler, capability, package, persistence, or public-build code changed, also
run:

```bash
npm run check
```

Review the generated public manifest and verify that it contains no canonical
truth, private perspectives, unlock conditions, raw asset locators, test
documents, or locked evidence. Confirm that test-only edits do not change case
or public digests. Treat any leak as a blocker.

Do not report success until every external scenario passes through its exact
public command sequence and event-only replay remains deterministic.

## Handoff

Report:

- the package path and case version;
- the truth/evidence/deduction shape in a few sentences without spoiling more
  than the user requested;
- asset files or external adapters added;
- compiler and detective-test commands run, including exact scenario counts;
- assumptions, intentionally omitted media, and any remaining design choice.

Do not claim the gameplay UI is complete when only the package or headless
engine was changed.
