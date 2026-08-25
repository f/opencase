# Architecture

opencase has four layers: portable case packages, a deterministic engine, an
application host, and a replaceable player interface. The layers communicate
through explicit data contracts. Case content does not become app code, and UI
state does not become engine state.

For normative requirements, read the [engine contract](engine-contract.md).
This document explains how the pieces fit together.

## Design goals

1. **One source of case truth.** Story content and logic live in `case.yml`,
   not in TypeScript.
2. **Open-world investigation.** Missing evidence is unknown, not false.
   Canonical truth stays separate from what each person and player knows.
3. **Deterministic execution.** The same compiled case, capability locks,
   event log, IDs, and clock inputs rebuild the same state.
4. **Replaceable clients.** A desktop, mobile app, terminal, or test runner can
   use the same commands and player-safe projection.

## Data flow

```text
cases/<slug>/
├── case.yml + assets/ + i18n/ ──► private source IR ──► kernel IR
│                              │                         │
│                              └── sanitize ──► public manifest
│                                                        │
└── tests/*.yml ── ordered detective commands ──► player-safe state
                           │                         │
                           └────── public expectations ┘

kernel IR + presentations + content-addressed assets ──► static runtime bundle
                                                            │
browser session adapter ── generic commands ──► engine ── project ──► shell

event log ──► event-only replay ──► the same authoritative state
```

The compiler discovers packages below a parent folder. Neither the engine nor
the app contains a list of case IDs, character names, clue routes, or expected
answers.

`npm run engine:decoupling` enforces this. It derives authored tokens from real
and teaching packages, then rejects those tokens or playable-package imports in
engine TypeScript. Engine-owned capability vocabulary is excluded because
cases are allowed to reference that public vocabulary.

## Layer ownership

| Owner | State and behavior |
| --- | --- |
| Case package | Story, entities, truth, perspectives, evidence routes, outcomes, translations, media, and private scenarios |
| Engine controller | Case clocks, observations, deductions, conversation states, schedules, conclusion, capability state, and event log |
| Browser application host | Runtime loading, save location, autosave policy, profile-to-save-slot mapping, imports, verification, and asset resolution |
| Profile application | Local display name, interface locale, and selected case |
| Detective shell | Windows, focus, minimized state, active tool, cosmetic chat state, and case-board positions and links |

Moving a window cannot create a case event. Discovering evidence cannot be
implemented by adding it to a React array. The shell renders the current
projection and sends generic intent back to the controller.

## Compilation pipeline

### Package loading

A normal package is a real lowercase kebab-case directory with `case.yml`,
`assets/`, `i18n/`, and `tests/`. The loader uses regular files, UTF-8 input,
size limits, and no-follow file access. Symlinks and path traversal fail closed.
Private test documents are loaded by the conformance runner, not by the
playable case IR.

### Source validation

The compiler parses YAML with unique-key checking, validates the JSON schema,
and runs semantic checks for references, capability versions, unlock
reachability, deadlines, conversations, hidden-contact routes, reactions,
assets, and public-data safety. Diagnostics include a stable error code, YAML
path, and source location when available.

Unresolved tools, verbs, providers, templates, or references do not become a
partially working case.

### Private source IR

Successful compilation creates `case-ir/v0.2`. It contains complete authored
mechanics, canonical truth, perspectives, unlock graphs, reactions, outcome
rules, capability locks, and private asset locators. It does not contain
`tests/`.

The source IR is build input and is not copied to the web root.

### Kernel IR

`compileToKernelIR` lowers source data into the fixed kernel vocabulary:
entities, relations, assertion contexts, initial state, schedules, primitive
rules, and capability locks. Templates and YAML shorthand no longer exist at
this layer. The result gets a canonical digest that binds sessions, asset
requests, and saves to one exact build.

### Public manifest and static runtime

`case-public/v0.2` contains safe bootstrap data: public identity, sanitized
cast, player-safe place labels, opening call, opening evidence metadata, and
safe opening asset handles. It excludes truth, perspectives, hidden routes,
reactions, outcomes, tests, private locators, and provider references.

`npm run generate:public` emits the public manifests and a separate static
runtime bundle for every built-in case. The runtime bundle has complete kernel
IR and presentation catalogs so the game can run without a server. This makes
the bundle inspectable and means it can reveal answers. The public projection
is an application correctness boundary, not DRM.

## Commands, events, reducers, and rules

Every transition follows one path:

1. A command describes intent and carries a stable command ID.
2. The capability that owns it validates the pre-command state.
3. An accepted command creates an immutable event draft; a rejected command
   changes nothing.
4. The kernel stamps the event with sequence, capability lock, command
   metadata, IDs, and clock values.
5. Pure reducers apply the event.
6. Rules match the same immutable post-event snapshot.
7. Matching effects become one atomic batch. Conflicting writes fail instead
   of depending on source order.
8. Follow-up events enter the next deterministic FIFO queue.

Rules use descending priority and stable IDs. `once` rules are recorded after
they fire, and exclusive groups choose one deterministic winner. A cascade
limit catches accidental infinite chains.

Replay applies stored events through reducers. It does not re-run command
decisions or rule matching, so a later clock sample or code path cannot rewrite
history.

## Truth and knowledge

Claims are assertions with a relation, key, value, polarity, context, validity,
recording time, and optional confidence, visibility, and provenance.

Contexts are hard boundaries:

- `world` is private canonical truth;
- `source:*` is what an evidence source asserts;
- `perspective:*` is what a character knows, believes, or says;
- `player:observed` is what the detective has discovered;
- `player:hypothesized` is what the detective proposes.

Observing evidence copies its source assertions into player observations with
provenance. It does not expose the source context or canonical world.

Queries return `unknown`, `affirmed`, `denied`, or `conflicted`. Absence never
proves a negative. A deduction succeeds only when one authored proof branch is
supported by player-accessible state.

## Investigation contract

The runtime exposes three domain command families:

- `case.evidence.observe` records an available piece of evidence;
- `case.action.perform` runs an allowed interview, request, search,
  presentation, or conclusion action;
- `case.deduction.attempt` checks an authored proof alternative.

Player actions are published through top-level case `affordances`. Each one has
a localized label, target surface, exact intent, offer state, and optional cost,
risk, confirmation, and completion result. The UI never infers buttons from a
private unlock graph.

A normal route is progressive:

```text
minimal opening
  └─ affordance is offered
       └─ exact action succeeds and pays its cost
            └─ evidence becomes available
                 └─ detective observes it
                      └─ deduction affordance is offered
                           └─ supported deduction triggers a consequence
```

Evidence availability and evidence knowledge are separate. A card can be
available without its reports supporting a deduction until the detective opens
it.

### Contact discovery

Phone contacts are case state, not a copy of `cast`. A case can start an actor
with a hidden contact, mention them in public copy, and offer a
`locate-contact` affordance. Only an accepted runtime action plus its authored
reaction lists the contact.

The completed action projects the exact public contact delta. The Inbox and
Phone use that result; they do not guess a person from array order. Pending
messages, typing animation, and unread badges remain shell state and cannot
reveal an actor.

The compiler rejects hidden callable actors without a complete lookup route,
repeatable or conditional lookups that can break progression, and premature
Phone offers. Package scenarios assert the public note anchor and real
`hidden -> listed` transition.

## Clocks and schedules

The kernel tracks three independent clocks:

- **case time** is the fictional investigation timeline;
- **active time** moves while the player is engaged;
- **wall time** comes from an injected execution-adapter clock.

Schedules choose one clock and an absolute time or relative delay. Generation
tokens make cancelled, shifted, or stale delivery a safe no-op. Tests inject
clocks and IDs, and production adapters must do the same.

## Capabilities

Capabilities are trusted, versioned modules that own author-facing vocabulary
and runtime behavior. Interviews, artifacts, communications, media forensics,
access control, and the casebook are capability surfaces built on kernel
primitives.

Every `use` entry resolves against the installed catalog. The manifest digest
is locked into the compiled case and save. Changing owned vocabulary changes
that digest even when a human-readable version string was not changed.

Story-specific operators and case branches do not belong in a capability. If a
new mechanic is genuinely reusable, it should be expressed as generic
vocabulary and tested with synthetic cases.

## Runtime projection

The authoritative runtime contains private assertion contexts, schedules,
capability state, and the event log. A client never receives it.

`projectCaseState` creates `case-runtime/public-v1`, including only data the
player may currently know or use:

- public identity, current clocks, and lifecycle;
- currently listed conversations and supported verbs;
- offered affordances and their safe exact intent;
- completed public results;
- granted or observed evidence and observed-only findings;
- safe asset handles;
- active deadlines;
- player observations, hypotheses, and supported deductions;
- final conclusion and selected outcome when present.

Asset handles contain only `{id, kind, mimeType}`. They never contain a path,
URL, provider, or credential.

## Assets

An asset has a case-local ID, kind, MIME type, visibility, SHA-256 digest, and
one private source:

- a file under the package's `assets/` directory;
- an integrity-pinned HTTPS resource; or
- an opaque capability-owned provider reference.

Evidence refers to asset IDs, never paths. Local compilation checks traversal,
symlinks, file type, extension and MIME agreement, digest, byte limits,
executable formats, and active SVG content.

Built-in static generation accepts package-local assets. A browser GitHub
import can also download a CORS-readable, integrity-pinned HTTPS asset and store
verified bytes in IndexedDB. Provider assets need a trusted server adapter and
are not supported by the static host.

In the static build, every required local asset is copied to a
content-addressed file. The URL can be found by inspecting the runtime bundle,
so authored asset visibility is a gameplay rule, not confidentiality.

## Persistence and replay

`kernel-save@1` stores:

- exact case ID and version;
- exact kernel IR digest;
- exact capability ID, version, and digest locks;
- immutable event log;
- SHA-256 checksum over the canonical payload.

It does not store commands, state snapshots, private IR, window layout, or
implicit migrations. Restore checks the schema and checksum, verifies every
lock, rejects another case build, replays the log, and compares the rebuilt
session with the header.

`CaseSessionController` keeps `KernelSession` and its event log in a private
closure. The browser host calls `getSnapshot`, `dispatch`, and `serialize`.
`CaseSaveStorage` receives an exact `{saveId, caseId, caseVersion,
kernelIrDigest}` key and treats the serialized save as opaque.

The opening call is a pre-session app step. A valid save resumes directly; an
absent save lets the app ring before a controller exists. Accepting creates and
persists a fresh controller. A true restart deletes the exact engine save and
the separately scoped presentation sidecars, then returns to onboarding.

Published case logic changes should bump the case version. Existing saves stay
bound to their exact old build unless an explicit migration is designed and
tested.

## Related documents

- [Engine contract](engine-contract.md)
- [Case YAML reference](case-yaml-reference.md)
- [Detective case tests](detective-tests.md)
- [Profiles and case library](player-profiles-and-case-library.md)
- [Desktop shell contract](../src/shell/README.md)
- [Development and deployment](development.md)
