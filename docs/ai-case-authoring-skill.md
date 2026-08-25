# AI case-authoring skill

This repository includes a reusable AI instruction package at
`skills/write-detective-case/`. Its job is to turn a mystery brief into a
portable `case.yml` + `assets/` + `i18n/` + `tests/` package, validate the evidence graph,
expose its progressive player actions explicitly, and run the compiler and
external detective scenarios before reporting success.

## Included files

```text
skills/write-detective-case/
├── SKILL.md
└── agents/
    └── openai.yaml
```

- `SKILL.md` contains the trigger description and the authoring workflow an AI
  must follow.
- `agents/openai.yaml` contains optional UI metadata such as the display name
  and starter prompt. It does not contain case logic.

The skill intentionally points to the canonical case-source reference,
detective-test reference, schemas, and examples in this repository instead of
copying their full grammar into its prompt. That keeps the AI instructions
small and prevents the skill from drifting away from the compiler or test
runner.

## Use it with Codex

The repository-local folder is the versioned source; Codex does not
automatically discover arbitrary project `skills/` directories. Install the
complete folder into the user's Codex skill directory while working with this
repository:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/write-detective-case "${CODEX_HOME:-$HOME/.codex}/skills/"
```

Restart or refresh the client after installing a skill. Keep the complete
folder together; `SKILL.md` alone works as instructions, but the UI metadata
will be missing. This skill is repository-specific because it deliberately
loads the canonical schema, documentation, examples, and validation commands
from opencase. If you move it to an unrelated project, bundle equivalent
references or update those paths first.

After installation, invoke it explicitly:

```text
Use $write-detective-case to create a five-minute case about a missing keycard.
```

Without installing it, tell the AI to read the exact repository path instead
of assuming `$write-detective-case` is discoverable.

## Use it with another AI system

Give the model:

1. `skills/write-detective-case/SKILL.md` as the operating instructions;
2. access to this repository;
3. `docs/case-yaml-reference.md`, `docs/detective-tests.md`, and the relevant
   complete package under `examples/cases/` when requested by the skill;
4. permission to run the compiler and simulator commands in a disposable or
   reviewed workspace.

The model must be able to read files and execute the validation commands for
the workflow to be reliable. A chat-only model can draft YAML, but it cannot
honestly claim that a package compiles or that its routes are playable.

## Write or adapt a case skill

Every compatible skill needs a folder whose name matches its lowercase,
hyphenated skill name and a `SKILL.md` with exactly these required frontmatter
fields:

```markdown
---
name: write-detective-case
description: Create, review, repair, and validate YAML detective-case packages. Use when an AI must author case.yml, localized affordances, assets, evidence routes, deductions, deadlines, or external detective tests.
---

# Write Detective Case

Read the canonical schema and examples, author the package, then run the
compiler and simulator before reporting success.
```

Put all trigger phrases and use cases in `description`; the AI sees that field
before it decides whether to load the body. Write the body as imperative,
step-by-step instructions. Prefer links to canonical repository documentation
over duplicating long field tables.

A robust case-authoring skill should require the AI to:

- preserve the requested truth and distinguish it from character beliefs;
- build legal evidence and deduction routes without reading private truth at
  play time;
- begin with an empty or minimal opening instead of bulk-granting investigative
  footage, notices, logs, statements, or other evidence the detective should
  obtain;
- declare every visible player move as a localized `affordances` entry and
  never ask a client to infer UI controls from private unlocks or reactions;
- keep non-caller Phone contacts hidden until authored story copy names them,
  then provide a localized one-shot Inbox lookup, an unconditional exact
  listing reaction, and a `state.contacts` scenario proving both its context
  note and contact path cannot be stranded;
- put every exact route argument, including `topic`, `query`, `tone`,
  `evidence`, and `ref`, in the public affordance command;
- keep action affordances exclusive by default so incomplete or altered
  actor-scoped commands cannot bypass the exact offer or its cost; use
  `exclusive: false` only for intentional free-form attempts with a separately
  authored cost or consequence, and test that the exact hidden or consumed
  command remains denied;
- model the normal gameplay loop as offered affordance, accepted exact command
  and case-time cost, available evidence, explicit observation, offered
  deduction, then an authored consequence;
- avoid case-specific engine code;
- rely on generic parent-directory discovery instead of registering package
  slugs in the engine or test runner;
- pin local and third-party media bytes and keep raw locators private;
- create real `i18n/` and `tests/` directories, bind catalogs to case identity,
  and keep translation handles out of gameplay/proof data;
- create one `case-test/v0.1` document per
  scenario;
- write every route as explicit ordered detective commands, never inline
  planner goals;
- assert `state.affordances` before and after route-changing actions and
  deductions, alongside the evidence transition from hidden to available to
  observed and the exact clock change;
- assert only public state, never truth, flags, trust, schedules, events,
  objective internals, or raw asset locators/source descriptors; media
  expectations use only opaque handles projected with granted evidence;
- keep test documents private and outside playable case/package/kernel/public
  digest inputs; recognize their separate private test-suite digest;
- cover success, denial, wrong-route, deadline, and offline behavior where
  relevant;
- compile and simulate the exact new package;
- report assumptions and intentionally missing media honestly.

The UI contract is intentionally one-way: the case offers a safe affordance and
the shell renders it on the authored surface. Private unlock expressions and
reactions decide consequences, but they are not a source of labels, search
queries, interview tones, request topics, or buttons. This keeps unreached
branches private and lets any generic shell play the same package without
case-specific tokens.

Optional `agents/openai.yaml` metadata uses quoted strings:

```yaml
interface:
  display_name: "Write Detective Cases"
  short_description: "Author and validate YAML detective cases"
  default_prompt: "Use $write-detective-case to create a small, testable YAML detective case package."
```

The default prompt must mention the skill as `$write-detective-case`. Do not
put secrets, provider credentials, case truth, test expectations, or mutable
runtime state in skill metadata.

## Validate changes to the skill

Run the repository validator after editing `SKILL.md` or its metadata. It uses
the already-installed Node `yaml` dependency and checks both files:

```bash
npm run skill:validate
```

Codex's `skill-creator` also provides `quick_validate.py` for `SKILL.md`
frontmatter and naming, but that Python script requires PyYAML in its own
environment and does not validate `agents/openai.yaml`.

Then forward-test it with a fresh AI context and a small request. The evaluator
should receive the skill and the user request, not a description of the answer
it is expected to produce. Finally compile and simulate the generated package
independently.

When the case-source or test contract changes, update the canonical reference,
schema, and examples first. Update the skill only when the authoring workflow
or validation commands change. Forward-testing must reject a generated package
that puts `tests:` inside `case.yml`, uses planner shorthand, or asserts private
state even if the story content otherwise compiles.
