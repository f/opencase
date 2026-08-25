# Case package examples

This directory contains two different learning sets: three deliberately tiny
packages for learning one engine concept at a time, and five larger fictional
packages grounded in public real-world investigative mechanics.

## Tiny learning packages

Read these in order:

1. [`first-clue/case.yml`](first-clue/case.yml) — observe one deliberately
   minimal opening card, support one deduction, and reach one outcome.
2. [`ticking-clock/case.yml`](ticking-clock/case.yml) — start a case-time deadline and cancel it through an authored reaction.
3. [`evidence-image/case.yml`](evidence-image/case.yml) — attach a verified local image to evidence without exposing its file path to the player runtime.

These packages isolate one concept, so their single opening card is not a
pattern for preloading a larger investigation. In a multi-step case, start with
no investigative evidence when the detective can request, search for, or earn
the first clue. Otherwise grant only the one artifact needed to choose the
first move. Never put the whole case file, camera footage, sync notices, logs,
and interviews in `opening.grants` merely because the route eventually needs
them.

## Progressive case pattern

Build a playable route in this order:

```text
empty or minimal opening
  -> localized offered affordance
  -> exact accepted command and case-time cost
  -> evidence becomes available
  -> detective explicitly observes it
  -> localized deduction affordance is offered
  -> supported deduction causes an authored consequence
```

An affordance is the public move the shell may render. Give it a `$text` label,
a `phone`, `web`, `files`, or `casebook` surface, and the complete action or
deduction intent. If the private route requires a request `topic`, search
`query`, presentation `tone`, evidence ID, or `ref`, include that exact value in
the affordance. Do not expect a UI to inspect private unlock expressions or
reactions and invent a button from them. Use generic `offer` and `withdraw`
effects to reveal the next choice only when it is meaningful.

Evidence becoming available is not the same as observing it. The player must
explicitly observe the card before its report values become knowledge or can
support a deduction. An affordance `cost` advances case time only after its
matching command succeeds; denied actions and unproven deductions do not pay
that cost.

Leave action affordances `exclusive: true`, the default, for normal routes.
This prevents another command in the same actor/source/target/evidence family
from dropping or changing the required topic, query, tone, or other argument
to bypass the exact offer or its cost. Use `exclusive: false` only when wrong
free-form attempts are intentional, and give those attempts a broad reaction
that applies their time or story consequence. The exact authored command still
fails while its affordance is hidden or after a one-shot offer is consumed.

## Realistic research-backed packages

These cases are fictional composites, not recreations of real people or open
investigations. Read the [real-world source
ledger](../../docs/real-world-case-examples.md) for the authoritative sources,
the exact mechanic adapted from each source, and the boundary between research
and invented case content.

1. [`archive-substitution/`](archive-substitution/) — compare a returned rare
   item with its condition record, resolve an alias, and act before departure.
2. [`diverted-invoice/`](diverted-invoice/) — detect a lookalike email domain,
   verify changed payment instructions, and recall a diverted transfer.
3. [`yard-switch/`](yard-switch/) — align switch position, radio traffic,
   recorder times, and maintenance authority after a rail-yard collision.
4. [`olive-oil-lot/`](olive-oil-lot/) — reconcile a label claim, laboratory
   classification, and batch ledger in a food-fraud investigation.
5. [`silent-stable/`](silent-stable/) — reason from an expected guard-dog alert
   that did not happen, alongside route and stable records. Its first deduction
   demonstrates value-aware proof: the monitor must be observed reporting zero
   alerts, zero dropout, gate coverage, and a familiar-role array containing
   the visitor's role; merely observing those fields is not enough.

Every visual asset in these five realistic packages, plus
[`locker-note.png`](evidence-image/assets/locker-note.png), was generated with
the built-in ImageGen workflow and inspected before use. The images are
presentation evidence, not the authoritative source of exact playable facts.
Exact domains, times, account IDs, measurements, identities, and other proof
values remain structural fields under `evidence.*.reports` in `case.yml`; tests
assert those values and opaque asset handles rather than trying to read pixels.

## Package shape and tests

Each example is a complete package with the same shape as a full case:

```text
case-slug/
├── case.yml
├── assets/
├── i18n/
│   └── en.yml
└── tests/
    └── scenario_id.yml
```

`case.yml` contains only the case. Each file under `tests/` is one executable
scenario written from the detective's perspective. Keeping tests outside the
case source lets a package grow from one tiny route into a readable suite
without turning its story definition into a test script.

Run these commands from the repository root. The package CLIs discover every
case directly below the parent directory, so adding another example does not
require editing a hardcoded list:

```sh
npm run examples:compile
npm run examples:test
```

The equivalent direct commands compile and test the same discovered set:

```sh
npx tsx scripts/compile-cases.ts --out-dir .build/examples \
  examples/cases
```

Run every discovered package's headless detective scenarios:

```sh
npx tsx src/simulator/cli.ts examples/cases
```

The files under each package's `tests/` directory are executable documentation.
Copy the closest package, change the case ID and story IDs in both `case.yml`
and its test headers, then keep the first scenario passing while you add
mechanics.

Every package also has a strict case-bound default catalog under `i18n/`, even
when direct strings allow `messages: {}`. Rich examples use `$text` handles;
see [`docs/case-i18n.md`](../../docs/case-i18n.md).

A test file names its exact case revision and contains an ordered detective
script:

```yaml
schema: case-test/v0.1

case: {id: examples.first-clue, version: 0.1.0}

scenario:
  id: observe_and_deduce
  perspective: detective
  steps:
    - detective.observe: mug_photo
      expect:
        result: {status: accepted}
        state:
          evidence: {mug_photo: observed}
          observations: {mug_photo.place: hall}

    - detective.deduce: courier_stopped_in_hall
      expect:
        result: {status: accepted}
        state:
          deductions: {courier_stopped_in_hall: supported}
          outcome: clue_found
```

Observe, act, deduce, and conclude exercise the same public intent surface as a
player. Advance and resume are deterministic host controls for testing time. A
command's companion `expect.result` checks whether it was accepted or denied;
`expect.state` checks only public state such as clocks, visible evidence,
observations, supported deductions, the final conclusion, and the outcome.
Tests cannot name private truth, flags, schedules, trust, or raw asset paths.
For a progressive case, also assert the public choice set at route boundaries:

```yaml
- expect:
    state:
      affordances:
        request_recording: offered
        test_clock_theory: hidden
      evidence: {recording: hidden}

- detective.act:
    {action: request, from: dispatcher, topic: lobby-recording}
  expect:
    result: {status: accepted}
    state:
      clocks: {case-time: 2m}
      affordances: {request_recording: hidden}
      evidence: {recording: available}

- detective.observe: recording
  expect:
    result: {status: accepted}
    state:
      affordances: {test_clock_theory: offered}
      evidence: {recording: observed}
```

The IDs above are illustrative. Declare them in that package's `case.yml` and
use localized affordance labels in its bound `i18n/` catalogs. The full grammar
and lifecycle rules live in the [affordances
reference](../../docs/case-yaml-reference.md#affordances).

Use the image example for the asset boundary: its opening assertion can see the
opaque `locker-note` handle, but no filesystem locator or provider credential.

For a local asset, calculate the digest after placing the file under `assets/`:

```sh
shasum -a 256 examples/cases/evidence-image/assets/locker-note.png
```

Paste the resulting lowercase digest into `assets.<asset-id>.integrity.sha256`. If the bytes change, update the digest before compiling again.
