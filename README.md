# dedektif — detective case engine and desktop shell

dedektif is an engine for writing deterministic investigation cases as
portable YAML packages. A case author describes the world, what each character
knows or says, the evidence routes, deductions, timed pressure, reactions,
actor conversation states, explicit player-visible affordances, objectives,
endings, and assets. Companion
`tests/*.yml` files describe
executable detective-perspective scenarios. The engine validates the package,
compiles case source into private runtime data, and exposes only a sanitized
projection to a player client. The trusted test harness constructs that same
runtime from private compiled data, but author-written expectations are
evaluated only against the sanitized player projection.

This repository remains **engine-first**, but now includes a working
macOS-inspired detective desktop: draggable and resizable application
windows, menu bar, Dock, casebook, case board, inbox, phone, files, research, and
case-scoped layout persistence. Local player profiles keep separate progress
and language preferences. The production game is fully static: a browser
application host loads built-in runtime bundles, runs the generic
`CaseSessionController`, stores opaque `kernel-save@1` strings, and can install
complete public GitHub case folders or small direct YAML cases without a game
server. The shell still receives only sanitized manifests and runtime
projections. Case semantics live in YAML and fixed engine capabilities, not in
case-specific React or TypeScript code.

This distribution makes a deliberate game-oriented tradeoff. A built-in static
runtime bundle contains the complete lowered case mechanics, so a person who
inspects downloaded JSON or JavaScript can find spoilers. The projection
boundary remains an application correctness boundary—normal UI flow reveals
only earned state—but it is not a secrecy boundary in the static build.

## Start here

Requirements: a current Node.js release with `npm`.

```bash
npm install
npm run check
npm run dev
```

The detective desktop runs at <http://127.0.0.1:4173>. Vite serves the same
static browser application that the production build emits; gameplay does not
depend on a local API. `npm run engine:check` is the case-independent synthetic
engine gate. `npm run check` is the complete repository gate: engine tests,
external detective scenarios, private case compilation, static runtime and
manifest generation, type checking, and the production build.

If you want to author a case rather than study the engine, continue with:

- [YAML case reference](docs/case-yaml-reference.md) for every supported field
  and expression;
- [detective test reference](docs/detective-tests.md) for the external
  `tests/*.yml` contract, commands, public expectations, and diagnostics;
- [case examples](examples/cases/README.md) for tiny lessons and realistic,
  copyable research-backed packages;
- [real-world example source ledger](docs/real-world-case-examples.md) for the
  public sources and fictionalization boundary behind the realistic packages;
- [AI case-authoring skill](docs/ai-case-authoring-skill.md) for installing,
  invoking, or adapting the included `$write-detective-case` workflow;
- [engine contract](docs/engine-contract.md) for the normative kernel and
  trust-boundary rules;
- [local profiles and case library](docs/player-profiles-and-case-library.md)
  for language switching, per-profile saves, URL imports, safety limits, and
  verification labels;
- [desktop shell contract](src/shell/README.md) for window behavior and the
  strict split between engine saves and UI layout persistence.

This README explains how the pieces fit together. It intentionally does not
repeat the complete YAML field reference.

## The core idea

A case is an authored story graph, not a script that edits game state directly.
Authors declare facts and routes. Players submit commands. Trusted capabilities
decide whether a command is legal and emit immutable events. Pure reducers and
deterministic rules turn those events into the next state. The public UI reads a
safe projection of that state.

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

The case compiler and test engine are uncoupled from authored content. Neither
contains a list of case IDs or clue routes: the CLI discovers packages under a
parent directory, compiles each `case.yml`, then loads that package's private
test documents.

`npm run engine:decoupling` enforces that boundary. It derives package slugs,
case/entity/asset/evidence/deduction/deadline/objective/outcome IDs, flags,
authored route tokens, and scenario IDs from every real and teaching package,
then rejects those tokens or playable-package imports in engine TypeScript.
Versioned capability vocabulary is excluded because it is owned by the engine
and referenced by cases, never the other way around.

Three properties guide the design:

1. **One source of case truth.** A case's content and logic are authored in
   `case.yml`; TypeScript is not a second copy of its story.
2. **Open-world investigation.** Missing evidence is unknown, not false, and
   canonical truth is kept separate from every observer's knowledge.
3. **Deterministic execution.** The same compiled case, capability locks, event
   log, IDs, and clock inputs reconstruct the same state.

## Portable case packages

Every case is a self-contained, lowercase kebab-case directory:

```text
cases/
└── my-first-case/
    ├── case.yml
    ├── assets/
    │   ├── room-photo.webp
    │   └── emergency-call.mp3
    ├── i18n/
    │   ├── en.yml
    │   └── tr.yml
    └── tests/
        ├── shortest-solution.yml
        └── deadline-failure.yml
```

The real `assets/`, `i18n/`, and `tests/` directories are required. `assets/` may
be empty; a normal authored or GitHub package's `tests/` must contain at least
one `<scenario-id>.yml`. The direct-YAML importer is the deliberate exception:
it creates an empty wrapper package and reports the weaker compiler-and-smoke
verification level. A complete folder can travel as one unit, be validated in
CI, and be compiled and tested without case-specific source code.

The current source schema is `case-source/v0.1`. At a high level, a case can
declare:

- identity, locale, duration, clock policy, and conclusion policy;
- the versioned engine capabilities it uses;
- cast, places, things, canonical truth, and character perspectives;
- the opening call, minimal initial evidence, explicit public affordances,
  unlockable evidence, and attached assets;
- deductions with explicit proof alternatives and primitive checks;
- reactions, flags, deadlines, objectives, and outcomes.

Executable scenarios are separate `case-test/v0.1` documents under `tests/`.
They are private development artifacts, are not part of any case or public
digest, and assert only the public detective projection. The loader computes a
separate private test-suite digest for CI/cache identity; that digest is never
used as a playable case build lock. See the
[detective test reference](docs/detective-tests.md).

See the [YAML case reference](docs/case-yaml-reference.md) for exact keys,
shorthand forms, validation rules, and examples.
See [case localization](docs/case-i18n.md) for `$text` references, strict
catalogs, locale fallback, public manifests, and save-compatible digests.

## Local players and installed cases

Settings manages browser-local detective profiles. Each profile stores only a
display name, Turkish or English preference, and selected case. The profile ID
is passed to the browser session adapter as an opaque save slot, so progress
and shell sidecars remain separate for every profile and exact case build.
Profiles are not accounts: there is no password, cloud sync, or automatic
recovery.

The local case library accepts either a complete public GitHub package or one
public direct YAML file. GitHub imports support `assets/`, `i18n/`, and authored
`tests/`; the browser resolves the source to an exact commit, validates every
downloaded Git blob, compiles the package, and runs its scenarios. Direct YAML
imports must be self-contained, use literal text, and declare no assets; they
receive compiler and runtime-smoke verification only. Both paths fail closed
before installation and cannot add executable engine code. Installed package
bundles and asset blobs are stored in IndexedDB.

See [Local player profiles and case library](docs/player-profiles-and-case-library.md)
for the player flow, accepted URL forms, storage model, network limits, and the
meaning of each verification level.

## Compilation pipeline

### 1. Secure package loading

The package loader requires a real case directory, a regular UTF-8 `case.yml`,
and real `assets/`, `i18n/`, and `tests/` directories. The case source is capped at 2 MiB
and is read through a no-follow file handle so a symlink or a file replaced
during the read cannot silently change the build input. Scenario contents are
loaded separately by the private conformance runner, never by the playable IR.

### 2. Source validation

The compiler parses YAML with unique-key checking, validates the JSON schema,
and then performs semantic validation that a structural schema cannot express.
This includes:

- capability vocabulary and exact capability versions;
- cross-references between entities, evidence, observations, deductions,
  affordances, reactions, objectives, outcomes, and schedules;
- unlock reachability and deadline timing;
- hidden-contact lookup structure, reveal reactions, and premature phone offers;
- template expansion and emitted-event cycle checks;
- asset source, media type, extension, integrity, and visibility checks;
- a final audit that rejects private data in the public manifest.

Diagnostics contain a stable error code, YAML path, and source location where
available. Compilation fails closed: unresolved tools, verbs, providers,
templates, references, or unsafe assets do not become partially working cases.

### 3. Private compiled source IR

Successful source compilation produces `case-ir/v0.2`. This canonical artifact
contains the complete story, including truth, perspectives, source assertions,
unlock graphs, reactions, outcome rules, capability locks, and private asset
locators. It does not contain `tests/`. It carries hashes of the source,
capability set, assets, and private IR.

This source-level artifact is build input and is not copied to `dist/`. The
fully static distribution does publish the lowered kernel IR, complete
presentation catalogs, and all required local asset bytes in a separate
runtime bundle. That bundle is intentionally inspectable. Do not pass either
artifact to shell components as state; the browser session adapter keeps the
active controller in a closure and gives the shell only projections.

### 4. Final kernel IR

`compileToKernelIR` lowers the source IR into the fixed kernel vocabulary:
types, entities, relations, assertion contexts, initial state, schedules, and
primitive rules. Templates and YAML shortcuts no longer exist at this layer.
The final kernel IR receives its own canonical digest; authoritative sessions,
asset requests, and saves bind to that exact digest.

### 5. Public bootstrap manifest

The compiler independently creates `case-public/v0.2`. It contains only safe
metadata, a sanitized public cast, localized player-safe place labels, the opening call, opening evidence metadata,
and safe handles for public assets that are reachable at the opening. It does
not contain canonical truth, perspectives, hidden observations, unlock
conditions, reactions, outcomes, tests, capability locks, filesystem paths,
private URLs, or provider references.

`npm run generate:public` discovers kebab-case directories below `cases/`,
builds them in a staging directory, rejects duplicate case IDs, and atomically
replaces `public/generated/` only after the entire set succeeds. Alongside the
localized public manifests it emits one integrity-bound static runtime bundle
per case and copies every required local asset to a content-addressed relative
URL. The generated index itself uses relative URLs so the same directory works
at an origin root or a GitHub Pages repository subpath.

### Contact discovery is case state

Phone contacts are not a static copy of `cast`. A case may start a public
conversation actor with `contact: {initial: hidden}`, mention that person in
localized story copy, and offer an Inbox `locate-contact` affordance anchored
to the note containing the mention. The desktop sends the authored request to
Forensics; only the accepted runtime action and its `{contact: [actor, listed]}`
reaction make the contact public and persist it in the case save.

The accepted command also projects its exact public contact delta. The app
uses that opaque completion result to label the Forensics reply and Phone CTA;
it does not inspect case action fields or infer the person from array order.
Cosmetic chat history is scoped to the session adapter's opaque run ID, while contact
visibility itself remains authoritative runtime state.

The compiler rejects a hidden callable actor with no complete lookup/reveal
route, a repeatable or conditional lookup, a lookup that reveals another
person, or an initially offered Phone action. Case scenarios then assert the
visible note anchor and actual `hidden -> listed` progression with
`state.contacts`. The shell stores only pending chat animation and unread
badges; it cannot reveal a contact by editing local UI state.

## Truth, knowledge, and assertions

The kernel represents claims as assertions. An assertion has:

- a relation and structured key identifying what is being claimed;
- a JSON value;
- `affirm` or `deny` polarity;
- a context that owns the claim;
- validity describing when the claim is about;
- `assertedAt` describing when the claim was recorded;
- optional confidence, visibility, and provenance.

Contexts are hard boundaries, not labels on a shared truth table. Important
contexts include:

- `world`: canonical private case truth;
- `source:*`: what an evidence source asserts;
- `perspective:*`: what a character knows, believes, or says;
- `player:observed`: claims the player has actually discovered;
- `player:hypothesized`: claims proposed by the player.

Observing evidence copies the corresponding source assertions into the player
observation context with provenance. It does not reveal the source context or
the canonical world.

Queries have four possible results:

| Status | Meaning |
| --- | --- |
| `unknown` | No matching affirmation or denial is present in this context. |
| `affirmed` | At least one matching affirmation is present and no denial conflicts. |
| `denied` | At least one matching denial is present and no affirmation conflicts. |
| `conflicted` | Matching affirmations and denials are both present. |

Therefore absence never proves a negative. A deduction remains unsupported
until its authored proof terms and checks are satisfied in player-accessible
state, even when the conclusion happens to match private world truth.

## Investigation flow

The case runtime exposes three domain commands:

- `case.evidence.observe` records an available piece of evidence and copies its
  observations into player knowledge;
- `case.action.perform` executes an allowed authored action, such as an
  interview, request, search, presentation, or conclusion submission;
- `case.deduction.attempt` checks one deduction's authored proof alternatives
  against current player knowledge.

Case authors normally exercise these through YAML test steps. A host can call
the typed helpers `observeEvidence`, `performAction`, and `attemptDeduction` in
`src/case-runtime/session.ts`.

A useful authored route is deliberately progressive:

```text
empty or minimal opening
  └─ localized authored affordance is offered
       └─ exact action succeeds and pays its case-time cost
            └─ evidence becomes available
                 └─ detective explicitly observes it
                      └─ localized deduction affordance is offered
                           └─ supported deduction triggers a consequence
```

The opening should establish the problem, not hand the detective a complete
case file. Grant no investigative evidence at opening when the first move can
be an authored request, interview, or search; otherwise grant only the one
artifact needed to make that first decision. Do not bulk-grant camera footage,
sync notices, logs, witness statements, or other clues that the detective is
supposed to obtain.

Top-level `affordances` are the public command contract between a case and any
shell. Each entry supplies a localized label, a target surface (`phone`,
`web`, `files`, or `casebook`), an exact action or deduction intent, an initial
offered/withdrawn state, and an optional case-time cost. Authors can also add a
localized successful `result`, a `normal`, `consequential`, or `terminal`
`risk`, and localized `confirmation` copy. Risk and confirmation tell the shell
how to present the choice; result copy is revealed only after that action or
deduction succeeds. Costs and reactions still define what the choice actually
does. Reactions use generic `offer` and `withdraw` effects to expose the next
meaningful choice. A successful matching command consumes its cost atomically;
a denied action or unsupported deduction costs nothing.

Evidence copy is authored separately from structural reports. Its title and
optional description appear when the card is granted; authored findings appear
only after observation. Finding keys must match report fields:

```yaml
evidence:
  lobby_video:
    tool: video
    presentation:
      title: {$text: evidence.lobby_video.title}
      findings:
        screen_exit_at: {$text: evidence.lobby_video.findings.screen_exit_at}
    at: start
    reports: {screen_exit_at: "21:04"}
```

Deadlines may carry a localized `label`, and outcomes may carry a localized
`body`. The runtime reveals only the presentation data appropriate for the
current state. See the [YAML case reference](docs/case-yaml-reference.md) for
the complete field rules and examples.

Action affordances are `exclusive: true` by default. In that mode, another
command in the same routed family cannot omit or alter an authored topic,
query, tone, or other argument to bypass the offer lifecycle or its cost. Keep
that default for normal investigation moves. Set `exclusive: false` only when
the case intentionally accepts free-form wrong attempts and accounts for their
time or other consequence through a broad authored reaction. Even then, the
exact affordance command is denied while its offer is hidden or after it has
been consumed; non-exclusive does not make a withdrawn button callable.

The engine never derives UI buttons from private evidence unlocks or reaction
conditions. If progression depends on `topic`, `query`, `tone`, `evidence`,
`ref`, or another exact action field, the case must expose that complete command
through an affordance. This keeps later search terms and solution branches
private until the author intentionally offers them. Evidence access is still
separate from knowledge: making a card available does not observe it. The
detective must explicitly open or observe the card before its reports can
support a deduction.

Actor availability is also case data. An optional top-level `conversations`
map gives each participating cast actor an initial state, a closed state map,
and action channels. A channel maps an action verb to the `actor`, `target`, or
`from` field that carries that actor's ID. Each state supplies only generic
`can_talk` availability and optional presentation copy; state IDs such as
`available`, `refusing`, `escaped`, or `dead` belong to the case and have no
special meaning in the engine. `allow_while_unavailable` can admit a recovery
verb, such as an apology, while normal conversation actions remain blocked.
Reactions change state with `{conversation: [actor_id, state_id]}`.

An unavailable, protected, hidden, or guessed actor is rejected with the same
generic `actor-unavailable` result. The denial does not echo an actor ID, state
ID, or case-authored reason. This prevents the command surface from becoming
an oracle for private story data. See the
[YAML conversation contract](docs/case-yaml-reference.md#conversations).

Unlocks describe availability, not truth. Reactions describe deterministic
consequences of events. Objectives are boolean conditions over observed facts,
supported deductions, flags, and active schedules. Outcomes are selected by
priority after checking required/excluded objectives, permitted final targets,
and flags. The highest-priority eligible outcome closes the case; later
commands return `case-ended` without changing its save. The case's
`final_conclusion` policy controls whether a submitted target can be replaced
only while no outcome is eligible.

## Commands, events, reducers, and rules

Every state transition follows the same boundary:

1. A command describes intent and carries a stable command ID.
2. The capability that owns the command validates it against the pre-command
   state and returns an accepted event draft or a structured rejection.
3. The kernel stamps accepted drafts with a unique event ID, sequence,
   capability lock, command metadata, and all three clock values.
4. A pure core/capability reducer applies each immutable event.
5. Rules are matched against the same immutable post-event snapshot.
6. Matching effects are combined into one atomic batch. Conflicting writes,
   incompatible schedule operations, or unsafe paths fail rather than depending
   on source order.
7. Follow-up events enter the next deterministic FIFO queue.

Rules are ordered by descending priority and then stable ID. `once` rules are
recorded after they fire. Exclusive reaction groups select one deterministic
winner. A dispatch has an event-cascade limit to catch accidental infinite
reaction chains.

Replay is deliberately simpler: it applies the stored events through reducers
without re-running command decisions or matching rules. This prevents a later
code path, clock sample, or external service from changing history.

## Three clocks and schedules

The kernel tracks independent clocks because “time passed” has different game
meanings:

- **case time** advances the fictional investigation timeline;
- **active time** advances while the player is actively engaged;
- **wall time** is sampled from the execution adapter's injected clock and supports offline
  or real-world deadlines.

Schedules choose one clock and an absolute due time or relative delay. They can
deliver immediately or, for wall-clock schedules, once on resume. Optional
maximum lateness can turn overdue delivery into a missed event. Every scheduled
delivery includes a generation token, so a cancelled, shifted, or stale
delivery safely reduces to a no-op.

The runtime exposes explicit helpers to advance case time, advance active time,
observe wall time, and resume a case. Tests inject clocks and IDs; production
adapters must do the same through runtime dependencies.

## Versioned capabilities

Capabilities are trusted, versioned modules that own author-facing vocabulary
and runtime behavior. Examples include interviews, artifacts, communications,
media forensics, access control, and the casebook. A capability manifest can
declare tools, verbs, templates, reroute providers, and asset providers.

During compilation, every `use` entry is resolved against the installed
catalog. The canonical manifest digest is locked into the case. At runtime, the
engine requires the same capability ID, version, and digest. Changing owned
vocabulary changes the digest even if the human-readable version string was not
changed, so a build cannot silently run against different behavior.

Artifacts, phones, browsers, inboxes, interviews, or future mechanics should be
implemented as capability surfaces built on kernel primitives. They are not
new special cases in the deterministic kernel.

## Runtime state and the client boundary

The authoritative runtime holds private capability state, generic slots,
assertion contexts, schedules, capability locks, clocks, and the full event log.
A client must never receive that object.

`projectCaseState` creates `case-runtime/public-v1`, containing only:

- public case identity and the final kernel digest;
- current clocks and lifecycle status;
- current conversation state, `canTalk`, supported channel verbs, and an
  optional localized reason for each public actor with a conversation graph;
- currently offered case-authored affordances, including localized labels,
  risk/confirmation metadata, safe exact intents, target surfaces, and
  optional case-time costs;
- completed action and deduction affordances with their safe authored result and completion
  time;
- evidence currently granted to the player or previously observed, including
  authored titles/descriptions and observed-only findings;
- safe asset handles attached to those projected evidence cards;
- authored active deadlines with their label, clock, due time, remaining time,
  and status;
- player observations and hypotheses;
- supported deductions retained through their previously public affordance
  labels, without enumerating unsupported private deductions;
- the submitted conclusion and selected outcome title/body, when present.

An asset handle contains only `{ id, kind, mimeType }`. It never contains a
path, URL, signed token, provider name, or provider reference. A gameplay UI
should render only this projection and send intent back as commands.

Revoking evidence blocks unobserved access. It does not make the player forget
an artifact already observed: that card and its safe handles remain in the
projection. The browser asset resolver follows this projection policy and binds
its lookup to the exact runtime bundle and final kernel digest. In a fully
static deployment that is a gameplay gate, not protection against somebody
who inspects or downloads the generated files directly.

## Assets: authoring, validation, and delivery

An asset has a stable case-local ID, media kind (`image`, `audio`, `video`,
`document`, or `file`), MIME type, `public` or `private` visibility, SHA-256
digest, and exactly one private source descriptor:

- a local file below the package's `assets/` directory;
- an HTTPS URL pinned to authored content integrity; or
- an opaque provider/reference pair owned by a capability-locked adapter.

Evidence links to asset IDs; it never embeds paths. `visibility: public` means
the asset may be referenced by the static opening bootstrap when its evidence
is also an opening grant. It does not bypass runtime evidence access in the
normal UI. Because later evidence must work without a server, the fully static
build copies both opening and unlockable local assets to content-addressed
files. Their URLs are discoverable in the runtime bundle, so asset visibility
is not a confidentiality promise in this deployment mode.

Local compilation rejects traversal, absolute paths, symlinks, non-files,
extension/MIME mismatches, digest mismatches, oversized payloads, executable
formats, and active SVG content. Defaults are 512 MiB per local asset, 2 GiB
across a package, and 5 MiB for the conservative static SVG subset.

Built-in static generation accepts package-local assets only. It validates
their path, bytes, declared MIME type, size, and SHA-256 digest before copying
them beside the runtime bundles. Remote HTTPS and provider-backed assets are
rejected for built-in cases because a reproducible static build cannot depend
on a runtime delivery service.

The browser GitHub importer can install package-local assets and explicitly
authored HTTPS assets whose servers allow cross-origin browser requests. It
downloads and verifies those bytes before placing them in IndexedDB; play uses
browser object URLs for the stored blobs. Provider assets remain unsupported
because they require credentials or a server adapter. The direct-YAML importer
does not accept assets at all.

`createCaseAssetGateway` remains available for a different deployment that has
a trusted server and needs authorized streaming or provider adapters. It is not
part of the fully static game's normal asset path.

## Persistence and replay

`kernel-save@1` stores only what is required to reconstruct an authoritative
session:

- exact case ID, version, and final kernel IR digest;
- exact capability ID/version/digest locks, including the built-in kernel;
- the immutable event log;
- a SHA-256 checksum over the canonical save payload.

Commands, state snapshots, private IR, and implicit migrations are not stored.
Restore validates the schema and checksum, verifies every event and lock,
rejects a different case build, replays the event log, and confirms the rebuilt
session matches the save header. Persistence ships with no automatic migration;
a host may inject only an explicit, audited migration.

When published case logic changes, bump the case version and treat existing
saves as belonging to their exact old build unless a real migration has been
designed and tested.

The application integration point is `CaseSessionController`. It keeps the
authoritative `KernelSession` and event log in a private closure. A detective
shell calls `getSnapshot(...)`, sends generic command intent through
`dispatch(...)`, and receives only `case-runtime/public-v1`. The browser session
adapter calls `serialize()` and places the resulting opaque `kernel-save@1`
string in `localStorage`. Restore creates a new controller only after the
checksum, case build, capability locks, and complete event log have passed
validation.

For direct persistence, implement the generic `CaseSaveStorage` port. Its
`read`, `write`, and `delete` methods receive an exact `{saveId, caseId,
caseVersion, kernelIrDigest}` key, while the value is an opaque serialized
save. The controller's `persist(...)` method captures and writes one immutable revision;
`restoreCaseSessionControllerFromStorage(...)` reads the exact build slot and
then performs the normal strict restore. For a true restart,
`deleteCaseSessionFromStorage(runtime, storage, saveId)` deletes exactly that
case/build/save slot. The adapter must then discard the old controller and
create a new one; a restart is not a synthetic reset event appended to the old
case.

The opening phone call is a pre-session application step. The browser session
adapter first checks the exact profile/case/version/kernel-digest slot: a valid
existing save restores and resumes its desktop, while an absent slot lets the
application ring from a sanitized public manifest before any controller is
created. No case clock, event, or detective decision is recorded merely because
that call screen is visible. Accepting the call creates and persists a fresh
controller; it must not overwrite an existing slot.
Restart returns to that onboarding boundary after deleting both the exact
engine save and the separately scoped desktop-layout snapshot. Clearing only
window layout does not restart a case; deleting only the engine save is also
insufficient for a true UI reset because stale presentation selections remain.

This boundary deliberately assigns different state to different owners:

| Owner | State |
| --- | --- |
| Engine controller | Case clocks, observations, deductions, actor conversation states, schedules, conclusion, private capability state, event log |
| Browser application host | Runtime loading, save location, autosave policy, profile-to-save-slot mapping, import and verification |
| Profile application | Local display name, preferred interface locale, selected case |
| Detective shell | Open windows, bounds, focus order, minimized state, active tool, selected locale, case-board card positions and player-drawn links |

Moving, minimizing, or reopening a desktop window must therefore never create
a case event or change save bytes. Conversely, the shell must not keep a
parallel evidence list or deduction state that can drift from the projection.
The Vaka Panosu follows the same rule: its person and photo cards are rebuilt
from the current public Phone and Finder models. Its separate sidecar stores
only opaque card IDs, normalized coordinates, and connection endpoints. It
never stores names, findings, authored asset locators, delivery URLs, or engine
commands, and stale IDs are removed when they are no longer public.
The static game stores only the opaque serialized save string through the
`CaseSaveStorage` browser adapter—not projections, mutable evidence arrays, or
private runtime objects. Imported runtime bundles and verified asset blobs use
IndexedDB instead. A different hosted deployment that must protect hidden case
information would need to keep the controller, private IR, and save storage out
of the browser entirely and pass only projections and command callbacks to the
shell; the GitHub Pages build intentionally does not provide that secrecy.

## Authoring workflow

1. Choose the smallest matching package in the
   [tiny examples](examples/cases/README.md) and copy its directory.
   An AI author can follow the same gated process through the included
   [`$write-detective-case` skill](skills/write-detective-case/SKILL.md).
2. Rename the folder to a lowercase kebab-case slug. Keep `case.yml` and
   the real `assets/`, `i18n/`, and `tests/` directories, even when `assets/` is empty.
3. Give the case a globally stable ID and a semantic version. Select only the
   capabilities whose tools, verbs, templates, or providers the case uses.
4. Write an empty or minimal opening and one complete progressive path first:
   localized affordance, exact action, successful time cost, available
   evidence, explicit observation, deduction affordance, and consequence. Keep
   world truth, source reports, perspectives, and player deductions separate.
   Give player-facing evidence an explicit localized title and findings instead
   of displaying report keys or raw values. Add affordance result/risk/
   confirmation copy, deadline labels, and outcome bodies where they help the
   player understand a choice or consequence.
   Never expect a client to infer a button from private unlock or reaction
   data; expose every required exact `topic`, `query`, `tone`, `evidence`, or
   `ref` value in the authored affordance. Keep the default `exclusive: true`
   unless intentionally modeling free-form failed attempts with their own
   authored cost or consequence.
5. Add one explicit ordered scenario per `tests/<scenario-id>.yml`. Assert
   `state.affordances` before and after route-changing commands, then assert the
   evidence transition from hidden to available to observed. Cover the
   successful route and important failures: inaccessible evidence, unsupported
   deductions, deadlines, misleading statements, and final outcomes. Never
   put tests inside `case.yml` and never assert private flags, schedules,
   truth, trust, or events.
6. Compile the package and run its scenarios directly:

   ```bash
   npx tsx scripts/compile-cases.ts cases/my-first-case
   npx tsx src/simulator/cli.ts cases/my-first-case
   ```

7. Generate and inspect the sanitized `*.public.json` manifests. Search those
   manifests for private names, truth, locators, conditions, and outcome logic
   before publishing. Do not apply that secrecy check to `*.runtime.json`:
   static runtime bundles intentionally contain the complete game mechanics.

   ```bash
   npm run generate:public
   ```

8. Run `npm run check` before integrating the case into a release.

The package-specific commands accept an exact package or a parent directory.
Discovery checks immediate child directories for a regular `case.yml`, sorts
them deterministically, and ignores unrelated siblings. The convenience
scripts point at `cases/` and `examples/cases/`, so a new package joins the
corresponding gate without adding its slug to TypeScript or `package.json`.

## Commands and generated output

| Command | Purpose |
| --- | --- |
| `npm run dev` | Generate static case output and start the local detective desktop. |
| `npm test` | Run compiler, kernel, runtime, persistence, simulator, and package tests. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:host` | Run tests for the optional legacy server-host adapters. The static desktop does not require them. |
| `npm run cases:test` | Discover packages below `cases/` and execute all private detective scenarios. |
| `npm run cases:compile` | Discover and compile every package below `cases/`. |
| `npm run examples:test` | Discover teaching packages and execute every detective scenario. |
| `npm run examples:compile` | Discover and compile teaching packages into `.build/examples/`. |
| `npm run skill:validate` | Validate the AI skill frontmatter and UI metadata. |
| `npm run generate:public` | Atomically generate sanitized manifests, inspectable static runtime bundles, and content-addressed local assets. |
| `npm run typecheck` | Build the TypeScript project graph without starting the app. |
| `npm run build` | Generate public data, type-check, and create the Vite production build. |
| `npm run engine:check` | Run only case-independent synthetic engine tests and type checking. |
| `npm run content:check` | Check engine/content decoupling, skills, all YAML packages/scenarios, and the case-backed production build. |
| `npm run check` | Run both the independent engine gate and the complete content/integration gate. |

`npm run cases:compile` writes to `.build/cases/`:

```text
.build/cases/<slug>.source.ir.json   # complete private compiled source IR
.build/cases/<slug>.kernel.ir.json   # final deterministic kernel IR
.build/cases/<slug>.public.json      # sanitized bootstrap manifest
```

`.build/` is compiler/debug output and is not copied to the web root.
`public/generated/` contains the atomically generated case index, sanitized
bootstrap manifests, asset delivery manifests, complete static runtime bundles,
and every local asset required during play. Runtime bundles and later-game
assets are inspectable and can reveal answers. `dist/` is the complete static
detective-desktop build.

## Static build and GitHub Pages

```bash
npm ci
npm run check
```

The Vite build uses a relative base, and generated case manifests, runtime
bundles, and asset URLs are relative to the files that reference them. The
resulting `dist/` directory can therefore be served from `/`, a repository
subpath such as `/dedektif/`, or another static mount point. No rewrite to
`/api/*`, Node process, database service, or secret environment variable is
needed for gameplay.

`.github/workflows/deploy-pages.yml` checks and builds the project on pushes to
`main`, uploads `dist/`, and deploys it with GitHub Pages' Actions workflow. The
same workflow can be started manually. Repository Pages still has to allow
GitHub Actions as its source, and availability for a private repository depends
on the repository owner's GitHub plan and Pages settings.

Browser URL imports have a separate network boundary. GitHub imports use the
public GitHub REST API and immutable `raw.githubusercontent.com` URLs, and
direct YAML or authored HTTPS assets are readable only when the remote server
allows browser CORS. GitHub's unauthenticated API rate limit applies, so an
import may need to be retried after its reset time. Built-in play remains local
to the deployed static files after they load.

## Repository map

```text
cases/                    Built-in portable case packages
examples/cases/           Tiny teaching cases and their walkthroughs
skills/write-detective-case/ Reusable AI case-authoring workflow
schema/                   Structural JSON Schema for authored YAML
docs/                     YAML reference and normative engine contract
scripts/                  Package compiler and public-manifest generator CLIs
src/capabilities/         Trusted authoring vocabulary and digest locks
src/compiler/             YAML validation, semantic compiler, private/public IR
src/kernel/               Pure event kernel, assertions, rules, and schedules
src/case-runtime/         Adapter, investigation capability, projection, session controller
src/persistence/          Checksummed event-log saves and strict restore
src/simulator/            External detective-test loader, runner, and replay checks
src/case-package/         Package/asset validation, public build, asset gateway
src/browser-host/         Static runtime/session adapter, browser imports and IndexedDB library
src/shell/                Generic desktop/window manager and sanitized detective apps
src/settings/             Profile, language, case-library, and storage workspace
src/player-profiles.ts    Browser-local profile store; no engine or case imports
src/assets/shell/         ImageGen-created application icon assets
server/case-library/      Optional server-host import implementation and compatibility tests
server/demo-host/         Optional server-host session/asset adapter and compatibility tests
src/App.tsx               Public-manifest desktop composition and case selector
```

## Current scope

The completion gate covers both the generic engine and the presentation shell:

- cases compile without case-specific JavaScript;
- external YAML scenarios run only their explicit legal commands and assert
  only player-safe state;
- unproven deductions remain unknown;
- event-only replay is deterministic;
- case, active, and wall clocks behave independently;
- capability, build, save, and asset digests are exact locks;
- sanitized manifests and shell projections exclude private mechanics, while
  the static runtime bundle intentionally remains inspectable;
- traversal, tampering, stale schedules, invalid saves, and unsafe media fail
  closed;
- profile IDs partition exact save and presentation slots without becoming an
  engine concept;
- imported packages compile and pass either full authored conformance or the
  explicitly weaker direct-YAML runtime smoke before they enter the library;
- shell layout state contains only geometry, focus, open/minimized state, and
  z-order, while gameplay state remains in the engine event log;
- the browser application host owns the controller, opaque saves, imports, and
  asset resolution rather than duplicating gameplay state in React.

The next gameplay UI should be a replaceable adapter over public manifests,
runtime projections, commands, and projected asset handles. It should not add
new case truth or bypass the engine's state machine.
