# Case engine contract v0.3

The engine consumes portable, author-owned packages. UI concepts are not
kernel primitives and TypeScript is not a second source of case truth.

```text
cases/<slug>/
  case.yml
  assets/
  i18n/
  tests/
        │ package load + YAML 1.2 parse
        │ schema + references + reachability + asset integrity
        ▼
private compiled IR ──► capability adapter ──► deterministic event kernel
        │
        └── sanitize ──► public manifest / safe asset handles ──► any client
```

## Kernel primitives

- Type, Entity, Relation, Context and Assertion
- State Slot
- Command, immutable Event and Reducer
- Rule and Schedule
- wall, active and case clocks

Artifacts, inboxes, interviews, phones, browsers and casebooks are capability
surfaces built from those primitives. They are not hard-coded into the kernel.

## Assertion semantics

Knowledge is open-world. The four query states are `unknown`, `affirmed`,
`denied` and `conflicted`; absence never means refutation. Assertion validity is
separate from `assertedAt`. Canonical world truth, source assertions, character
perspectives, player observations and player hypotheses occupy distinct
contexts. A discovered observation copies a source assertion with provenance;
it does not expose the source context itself.

## Deduction proof semantics

Direct proof branches are generic data, not case logic. A legacy branch is an
AND-list of observed observation IDs and already-supported deduction IDs.
Value-aware branches add a closed list of typed predicates over their listed
observation terms: JSON equality/inequality, finite-number less/greater,
array contains/exact count, and clock/timestamp before/after. Alternatives are
OR; terms and predicates inside one alternative are AND.

The compiler resolves every reference, requires checked observations to be
listed as proof terms, validates their authored report types, and lowers the
closed predicates into the private runtime catalog. The runtime evaluates only
player-observed assertions whose value still matches the compiled source
assertion. Missing, altered, wrongly typed, or unparsable values fail closed;
an observed `false`, zero, `null`, or empty array remains a real value rather
than being mistaken for absence. Proof evaluation never reads canonical truth
or private source assertions. Adding a story-specific operator requires no
exception path: it is unsupported and rejected by the source schema.

## Execution semantics

1. A command describes intent.
2. A locked capability validates it against the pre-command state.
3. Validation emits a self-contained immutable event or rejects the command.
4. A reducer is the only code that changes state.
5. Rules match the same post-event snapshot in deterministic order and apply
   one atomic effect batch.
6. Emitted follow-up events enter the next FIFO queue.
7. Replaying only the event log reconstructs the same state.

Rules never mutate state directly and replay never re-runs command deciders or
rule matching.

## Actor conversation contract

Conversation availability is a generic case-authored state machine, not a set
of story concepts built into the engine. A top-level `conversations` entry
binds one cast actor to:

- one declared initial state;
- a non-empty map of arbitrary case-owned state IDs, each with
  `can_talk: true|false` and optional localized `reason` copy;
- a non-empty `channels` map from selected action verbs to the action field
  (`actor`, `target`, or `from`) that carries the actor ID; and
- an optional `allow_while_unavailable` list of declared channel verbs that may
  still run while `can_talk` is false.

The engine does not recognize `dead`, `escaped`, `refusing`, `available`, or
any other narrative state token. It resolves the actor through the declared
channel, reads the current state, and applies the boolean gate. A permitted
reaction effect `{conversation: [actor_id, state_id]}` writes another declared
state through the normal deterministic rule pipeline. An allowed recovery verb
only bypasses the availability gate; all other action and evidence validation
still applies.

When at least one actor regulates an action, a missing actor field is rejected
as `actor-required`, contradictory actor fields as `actor-argument-conflict`,
and an unknown, hidden, protected, or unavailable actor as
`actor-unavailable`. The unavailable denial is deliberately identical and does
not echo the attempted actor, current state, or reason. A rejected command
emits no event and leaves the projection unchanged.

The private IR and runtime catalog retain the complete state graphs. The public
runtime projection contains only conversation entries for public cast actors:
the actor ID, current state ID, `canTalk`, sorted channel verbs, and the current
state's optional `reason` or `reasonKey`. Protected/hidden actors are omitted,
so guessing one through a command does not reveal whether that actor exists.

## Public affordance contract

Player prompts are explicit case data, never inferred from private unlock
graphs. Each affordance binds an opaque ID and localized label to one complete
action command or deduction command, one UI surface, an initial offered state,
optional deterministic case-time cost, and one-shot behavior. Generic
`offer`/`withdraw` effects change its runtime slot through logged rule effects.

The public projection contains only currently offered commands. A successful
matching action or supported deduction applies cost and withdrawal in the
same deterministic rule pipeline; rejected commands emit no event and spend
nothing. Supported deductions retain copy only when that copy came from an
explicit public deduction affordance. No future command, unlock predicate,
evidence ID, proof alternative, or private reaction is derived into the
projection.

## Portable asset contract

An authored asset has a stable case-local ID, media kind, MIME type, visibility
policy and one source descriptor:

- a package-local path below `assets/`;
- a pinned HTTPS resource; or
- an opaque reference owned by a trusted provider adapter.

Local assets are resolved relative to the package, may not traverse or escape
through symlinks, and become part of the case build digest. MIME/extension and
declared integrity mismatches fail compilation. Remote/provider identifiers
remain in private build data.

Evidence refers to asset IDs, never filesystem paths. Public bootstrap data and
runtime projection expose only assets the player may currently access, using
safe handles such as ID, media kind and MIME type. A trusted host resolves a
handle to bytes or a delivery URL after session authorization. Private assets
are never copied into the public static build.

The authoritative asset gateway binds every delivery request to the case ID,
case version and final kernel digest stored in the session/save, and accepts
only a handle found in the current runtime projection. Local and injected
HTTPS/provider streams are consumed exactly once into an engine-owned,
content-addressed cache; byte limits, declared SHA-256, static SVG policy and
MIME magic are checked before promotion. Cancellation propagates through the
adapter and materializer. The host serves only the verified cache file with
the exact MIME type, `nosniff`, the returned content disposition and Range
support where applicable.

There is deliberately no default network fetcher. A capability-locked host
adapter must enforce deadlines and size limits, resolve only public DNS, repeat
that check for every redirect and reject loopback, private and link-local
destinations. Raw locators and provider references remain host-only. Adapter
failures are wrapped without locators, and the HTTP boundary maps gateway
failures to a uniform response rather than serializing internal errors.

## Application session boundary

`CaseSessionController` is the generic bridge between a trusted application
host and any detective shell. The controller owns one authoritative
`KernelSession`; the session and event log are closure-private and are never
returned by its API.

- `getSnapshot(presentation?)` returns a frozen `case-runtime/public-v1`
  projection.
- `dispatch(command, presentation?)` accepts generic kernel/capability command
  intent and returns only the new public projection, or an unchanged projection
  plus a public error.
- `serialize()` creates canonical `kernel-save@1` bytes for a trusted storage
  adapter.
- `persist(storage, saveId)` captures one immutable revision and writes its
  opaque bytes under the exact case ID, version, kernel digest, and host save ID.
- `restoreCaseSessionController(...)` returns a controller only after strict
  save validation and reducer-only replay succeed.
- `restoreCaseSessionControllerFromStorage(...)` reads one exact build slot;
  absence returns no controller, while malformed or mismatched data fails.
- `deleteCaseSessionFromStorage(...)` deletes one exact case/build/save slot
  through the storage port and returns the key that was deleted.

Presentation copy is supplied for projection and is neither retained by the
controller nor written into events or saves. Window bounds, focus order,
minimized/open state, active panels, and locale choice are application state.
Evidence access, observations, hypotheses, actor conversation states, clocks,
deadlines, objectives, and the final conclusion are engine state. The shell
renders the former around the latter; it does not maintain a second gameplay
model.

`CaseSaveStorage` is infrastructure, not gameplay. An adapter may target a
file, database, native key-value store, account sync, or offline browser store,
and implements `read(key)`, `write(key, serializedSave)`, and `delete(key)` for
the exact `{saveId, caseId, caseVersion, kernelIrDigest}` key. It treats the
serialized value as opaque and never patches it. Browser
`localStorage`, when appropriate for a fully local trust model, contains only
that opaque string—not a projection or hand-maintained gameplay state. Hosted
builds that protect hidden information keep the controller, private IR, and
save adapter outside the browser bundle and expose projections plus command
callbacks to the desktop shell.

### Pre-session onboarding and true restart

The host first checks the exact case/build/save slot. A valid existing save is
restored and resumed directly; absence enters onboarding. The ringing-phone
screen then belongs to the application host before an authoritative case
session exists. It may use only sanitized public bootstrap data, especially
`opening.call`; displaying, dismissing, or re-showing it must not advance clocks
or append an event. Accepting the call creates and persists a fresh controller,
then mounts the gameplay desktop around its first public projection. A start
operation must fail rather than overwrite a slot that appeared concurrently.

A true restart crosses the same boundary in reverse:

1. stop using and discard the current controller;
2. call `deleteCaseSessionFromStorage(runtime, storage, saveId)` so
   `CaseSaveStorage.delete` removes the exact case/build/save key;
3. clear the separately scoped `detective-desktop-layout/v1` snapshot and any
   other non-authoritative per-session UI selection; and
4. return to phone onboarding, creating and persisting a new controller only
   after the player accepts again.

Do not model restart as a gameplay command or append a reset event to the old
log. Do not delete by case ID alone: versions and kernel digests intentionally
partition incompatible save slots. UI layout clearing by itself is only a
presentation reset, while save deletion by itself does not clear presentation
preferences.

## Private/public boundary

The private IR contains truth, perspectives, source assertions, asset source
descriptors, unlock graphs, complete conversation graphs, reactions,
objectives, outcomes and source maps. It is trusted server/build
input and is never sent wholesale to a player client.

The public manifest is bootstrap data only. It may contain safe case metadata,
public cast data, player-safe place labels, the opening call, opening evidence
handles and currently deliverable public asset handles. It must not contain private truth, intent,
locked observations, conditions, outcome rules, tests, raw paths, private URLs
or provider keys.

Translation references are stable presentation handles, not gameplay values.
Catalog copy stays outside IR, kernel state, events, and saves. The build
resolves only bootstrap-safe handles into per-locale public manifests; it does
not publish whole catalogs or private outcome messages. When an outcome is
revealed, the host may supply the selected presentation catalog to projection.
Place IDs are lowered into kernel entities without their display labels; any
explicit non-display place metadata remains mechanical kernel data.
Changing catalog copy changes package/public digests but not the kernel/save
digest. See [Case localization](case-i18n.md).

Save files are trusted/private storage because their initialization event can
reconstruct private derived runtime state. A save contains the exact case build
lock, exact capability locks and event log plus a checksum; no implicit
migration is allowed.

## Capability and determinism locks

Capabilities are trusted, versioned modules that own command schemas, deciders,
reducers, source vocabulary, template expansion and provider adapters. The
compiler resolves installed definitions and locks their canonical SHA-256
digests. Unknown tools, verbs, templates, reroute providers or asset providers
are compile errors.

Canonical raw-byte key ordering, injected IDs/clocks, generation-safe
schedules, atomic rule conflicts and content-addressed local assets keep builds
and replays deterministic.

## Gate before gameplay UI resumes

- Both package-local `case.yml` sources compile without case-specific JS.
- Every YAML-authored scenario runs through legal commands in the headless
  simulator.
- Local, HTTPS and provider assets validate; private assets never enter public
  output.
- Unproven deductions remain `unknown`.
- Conversation gates reject unavailable/protected actors generically, recovery
  verbs transition declared states, and only public actors are projected.
- Event-only replay is deterministic.
- Capability denial, rule ordering, three clocks, offline resume, deadline
  cancellation, package traversal and asset tamper checks are executable tests.
