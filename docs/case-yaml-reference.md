# Case YAML authoring reference

This document is the author-facing reference for `case-source/v0.1`. It
describes the grammar accepted by the current schema, compiler, package loader,
and runtime adapter. Detective scenarios use the separate
[`case-test/v0.1` contract](detective-tests.md). Where the JSON Schema permits
free-form narrative data but the runtime recognizes a smaller vocabulary, that
difference is called out explicitly.

The YAML file is the only authored source of case behavior. Do not duplicate a
case in TypeScript. A normal package is:

```text
cases/<package-slug>/
  case.yml
  assets/
  i18n/
    <locale>.yml
  tests/
    <scenario-id>.yml
```

`<package-slug>` must match `[a-z0-9][a-z0-9-]*`. The package directory,
`case.yml`, `assets/`, `i18n/`, and `tests/` must be real filesystem entries rather than
symbolic links. `case.yml` must be valid UTF-8 and at most 2 MiB. `assets/` may
be empty; `tests/` must contain at least one external scenario for the
conformance runner.

For executable learning packages, follow the progression in
[`examples/cases/README.md`](../examples/cases/README.md). For AI-assisted
authoring, use the repository's
[`$write-detective-case` skill](../skills/write-detective-case/SKILL.md).

## Contents

- [Compilation model](#compilation-model)
- [Complete minimal case](#complete-minimal-case)
- [Top-level map](#top-level-map)
- [Identifiers and references](#identifiers-and-references)
- [`schema`](#schema)
- [`case`](#case)
- [`i18n/` and `$text`](case-i18n.md)
- [Durations, clock times, and clocks](#durations-clock-times-and-clocks)
- [`use` and the capability vocabulary](#use-and-the-capability-vocabulary)
- [`authoring`](#authoring)
- [`cast`, `places`, and `things`](#cast-places-and-things)
- [`conversations`](#conversations)
- [`affordances`](#affordances)
- [`assets`](#assets)
- [`truth`](#truth)
- [`perspectives`](#perspectives)
- [`opening`](#opening)
- [`evidence` and unlock expressions](#evidence)
- [`deductions` and proof templates](#deductions)
- [`flags` and conditions](#flags)
- [`reactions`, triggers, and effects](#reactions)
- [`deadlines`](#deadlines)
- [`objectives`](#objectives)
- [`assessment`](#assessment)
- [`outcomes`](#outcomes)
- [External detective tests](#external-detective-tests)
- [Defaults summary](#defaults-summary)
- [Diagnostics and common failures](#diagnostics-and-common-failures)
- [Authoring and verification workflow](#authoring-and-verification-workflow)

## Compilation model

```text
case.yml + assets/ + i18n/
        │ YAML parse and JSON Schema validation
        │ capability, expression, reference, reachability, and asset checks
        ▼
private source IR
        │ capability adapter
        ▼
final deterministic kernel IR
        │
        └── sanitized public manifest and opaque asset handles
```

The private IR contains canonical truth, perspectives, all observation values,
unlock routes, deductions, reactions, deadlines, outcomes, and raw asset
locators. External `tests/*.yml` documents are not compiled into this IR and do
not affect its digest. The IR is trusted build/server input and must never be
sent wholesale to a player.

The public manifest contains only safe case metadata, a filtered public cast,
the opening call, opening evidence metadata, and public assets attached to
opening evidence. Runtime projections reveal safe asset handles only after the
associated evidence is granted. A handle contains only `id`, `kind`, and
`mimeType`.

## Complete minimal case

This is a complete, intentionally tiny case. It has one actor, place, thing,
truth event, opening evidence card, deduction, objective, outcome, and a
companion external test.

```yaml
schema: case-source/v0.1

case:
  id: community.example.tiny-note
  version: 0.1.0
  title: The Tiny Note
  locale: en
  duration: 5m
  mode: elastic
  final_conclusion: first-write-wins
  time:
    date: "2026-08-16"
    timezone: Europe/Istanbul
    starts_at: "12:00"
  synopsis: A note explains a very small mystery.

use: [investigation@1, artifacts@1]

cast:
  alex: {name: Alex, role: client, client: true}

places:
  office: The office

things:
  note: {type: document, name: Folded note}

truth:
  events:
    note_written:
      {at: "11:55", type: document.written, actor: alex,
       object: note, place: office}
  facts: {}

perspectives:
  alex:
    knows: [note_written]
    believes: []
    says: {initial: []}

opening:
  call:
    from: alex
    text: I found a note. What does it mean?
  grants: [note_card]
  starts: []

evidence:
  note_card:
    tool: document
    presentation:
      title: Folded Note
      description: A short handwritten note found in the office.
      findings:
        message: The meeting time was moved.
    at: start
    reports:
      message: meeting-moved

deductions:
  note_explained:
    conclude: {incident: tiny-mystery, explanation: meeting-moved}
    prove:
      any:
        - [note_card.message]

flags: []
reactions: []
deadlines: {}

objectives:
  explain_note: {supported: note_explained}

outcomes:
  solved:
    title: Note Explained
    body: You identified what the note means.
    priority: 100
    require: [explain_note]
```

An `assets:` section is optional. The `assets/` directory itself is mandatory
for a package, even when it is empty. Put the executable route in
`tests/basic_solution.yml`; see [External detective tests](#external-detective-tests).
Because this example uses direct presentation strings, its required
`i18n/en.yml` can bind the case with `messages: {}`. Replace supported
presentation fields with `$text` references and add messages when localization
is needed; see [Case localization](case-i18n.md).

## Top-level map

Unknown top-level keys are rejected. The sections marked “required” must be
present even when their grammar permits an empty list or map.

| Key | Required | Purpose |
| --- | --- | --- |
| `schema` | yes | Source format discriminator. |
| `case` | yes | Identity, presentation metadata, and case clock origin. |
| `use` | yes | Versioned capability/profile selection. |
| `authoring` | no | Arbitrary private author/tool metadata. |
| `assets` | no | Media and file descriptors. |
| `cast` | yes | Actor entities; at least one. |
| `conversations` | no | Generic actor availability state machines and action channels. |
| `affordances` | no | Explicit player-visible commands and theory buttons with lifecycle and cost. |
| `places` | yes | Place entities; at least one. |
| `things` | yes | Object/device/document/etc. entities; at least one. |
| `truth` | yes | Private canonical events and facts. |
| `perspectives` | yes | Private actor knowledge, beliefs, and statements. |
| `opening` | yes | Public call, opening evidence, and schedules to start. |
| `evidence` | yes | Evidence cards and generated source observations; at least one. |
| `deductions` | yes | Player-provable conclusions; at least one. |
| `flags` | yes | Declared boolean state slots; may be empty. |
| `reactions` | yes | Event-driven rules; may be empty. |
| `deadlines` | yes | Named schedules; may be empty. |
| `objectives` | yes | Named completion conditions; at least one. |
| `assessment` | no | Private post-case scoring rubric resolved only after an outcome. |
| `outcomes` | yes | Prioritized endings; at least one. |

## Identifiers and references

Use case-local IDs matching:

```text
[a-z][a-z0-9_-]*
```

Examples: `nihan`, `red_file`, `stage-left`, `camera_time_corrected`.
Identifiers are case-sensitive. Lowercase IDs are required by the contract and
avoid unsafe runtime state paths. The v0.1 JSON Schema applies this pattern
directly to named entity maps, assets, flags, reaction IDs, and many reference
lists; authors should use it consistently for evidence, deductions, deadlines,
objectives, outcomes, and truth events as well. External scenario IDs follow
the same pattern and must match their `.yml` filename stem.

`case.id` is different: it is a lowercase, dot-namespaced ID with at least two
segments, for example `community.example.tiny-note` or
`official.son-prova`. Each segment begins with a letter and may contain digits
or hyphens.

The most important generated reference is an observation ID:

```text
<evidence-id>.<reports-field>
```

For example, this report:

```yaml
evidence:
  camera_notice:
    tool: email
    at: start
    reports:
      clock_offset: "+7m"
```

creates the observation reference `camera_notice.clock_offset`. Unlocks,
deduction proofs, conditions, and external detective expectations refer to
that dotted ID. Refer to an evidence card by its bare ID only where the grammar
explicitly accepts an evidence ID.

The compiler checks references by category:

- actor IDs come from `cast`;
- place IDs come from `places`;
- thing IDs come from `things`;
- observation IDs come from `evidence.<id>.reports`;
- deduction, flag, deadline, objective, outcome, and asset references come
  from their respective sections;
- truth-event IDs come from `truth.events`;
- final decision targets normally come from cast, things, or places, and can
  additionally be introduced by a `submit-conclusion` reaction trigger.

Unknown typed references are compile errors. Deduction cycles, emitted-event
cycles, and evidence/deduction graphs with no structural entry route are also
compile errors. Raw authored-event, action, and trust gates are treated as
potential entry points; compilation does not prove that their triggers can
actually occur. Exercise every important route in an external detective
scenario.

## `schema`

The only accepted value is:

```yaml
schema: case-source/v0.1
```

## `case`

All fields are required and unknown fields are rejected.

```yaml
case:
  id: community.example.case-name
  version: 1.2.0-beta.1
  title: Human-readable title
  locale: en-US
  duration: 45m
  mode: elastic
  final_conclusion: first-write-wins
  time:
    date: "2026-08-16"
    timezone: Europe/Istanbul
    starts_at: "21:10"
  synopsis: A private-authoring-safe summary shown in public metadata.
```

| Field | Grammar and behavior |
| --- | --- |
| `id` | Dot-namespaced lowercase case ID. |
| `version` | `major.minor.patch`, optionally followed by `-prerelease`; build metadata with `+` is not accepted. |
| `title` | Non-empty direct string or `{$text: key}`. See [case localization](case-i18n.md). |
| `locale` | Two lowercase letters, optionally `-` plus two uppercase letters, such as `tr` or `en-US`. |
| `duration` | Positive duration. Compiled to minutes and currently used as metadata; it does not automatically create a deadline. |
| `mode` | `elastic` or `strict`. It is carried into compiled metadata; the current runtime does not impose extra behavior from it. |
| `final_conclusion` | `first-write-wins` locks the first submitted target. `replaceable` permits a later valid target to replace it. |
| `time.date` | `YYYY-MM-DD`. Calendar validity is not separately checked. |
| `time.timezone` | Non-empty string. Use an IANA zone; v0.1 does not validate the zone database. |
| `time.starts_at` | `HH:MM` or `HH:MM:SS`, used as minute zero for absolute case-time deadlines. |
| `synopsis` | Non-empty direct string or `{$text: key}` and part of public metadata. Do not put spoilers in it. |

## Durations, clock times, and clocks

Case duration and deadline duration strings use a positive integer followed by
one unit:

```text
15s  10m  2h  1d
```

The units are seconds, minutes, hours, and days. Seconds are allowed and may
compile to fractional minutes. Do not add whitespace or combine units such as
`1h30m`.

Clock values should use `HH:MM` or `HH:MM:SS` in the 24-hour range. The schema
enforces that range for `case.time.starts_at` and deadline `at`. An absolute
deadline is on the same authored case date; the compiler does not wrap an `at`
time into the following day.

The kernel owns three clocks:

- `wall`: elapsed real wall time;
- `active`: time while the case is active;
- `case-time`: authored investigation time advanced by game actions or the
  host.

Deadline clock/offline behavior is documented under `deadlines`. Truth event
fields such as `at`, `from`, and `to` are private narrative values and are not
globally parsed by the source schema. Time-sensitive template compilation
currently performs arithmetic without fully enforcing the 00:00-23:59 range;
the runtime rejects out-of-range values. Use valid clocks and exercise every
time-based template with explicit observe and deduce steps in an external
scenario.

## `use` and the capability vocabulary

`use` is a non-empty, duplicate-free list of exact `<id>@<positive-version>`
specifiers. The selected manifests contribute the allowed evidence tools,
action verbs, deduction templates, reroute providers, and asset providers. The
compiler locks the full manifest digest, not just its name.

The runtime requires `investigation@1`. Include only the additional
capabilities the case actually uses.

| Specifier | Tools | Verbs | Templates/providers |
| --- | --- | --- | --- |
| `investigation@1` | — | `observe`, `preserve`, `report-suspect`, `submit-conclusion` | templates `investigation.composite-culprit`, `investigation.composite-explanation`; reroute `granted` |
| `artifacts@1` | `document`, `image`, `log` | `observe`, `open`, `preserve` | asset provider `signed-media` |
| `comms@1` | `email`, `message`, `phone-export` | `request` | — |
| `virtual-web@1` | `browser` | `open`, `search` | — |
| `casebook@1` | — | `report-suspect`, `submit-conclusion` | — |
| `interview@1` | `interview` | `apologize`, `interview`, `present` | — |
| `media-forensics@1` | `metadata`, `video` | `observe`, `open` | templates `media.prerecorded-alibi`, `media.timestamp-offset` |
| `stage-automation@1` | `log` | `request` | template `safety.intentional-disable-and-command`; reroute `security-export` |
| `finance@1` | `account-history` | `search` | reroute `archive-search` |
| `access-control@1` | `log` | `request` | reroute `security-export` |
| `facility-logistics@1` | `physical-evidence` | `request`, `search` | reroute `confidential-blue-route` |
| `generic-actions@1` | — | all built-in general action verbs | — |

The vocabulary is the union of the selected manifests. Unknown specifiers,
tools, verbs, templates, reroute providers, and asset providers fail
compilation.

## `authoring`

`authoring` is an optional arbitrary mapping retained in the private IR. It has
no built-in runtime semantics. Use it for authoring-tool hints, policy notes,
or generator provenance that must stay private.

```yaml
authoring:
  evidence_source_policy: implicit-per-evidence
  require_public_route_tests: true
```

When omitted, it compiles as an empty map.

## `cast`, `places`, and `things`

Each section is a non-empty map keyed by a case-local ID. Values may be a
non-empty string or a non-empty mapping. Object form is recommended for cast
and things because the runtime derives actor and thing entities from object
entries.

```yaml
cast:
  leyla: {name: Leyla Erdem, role: editor, client: true}
  can: {name: Can Koral, role: confidential-source, protected: true}

places:
  newsroom: {$text: places.newsroom.name}
  lobby: {name: {$text: places.lobby.name}, floor: ground}

things:
  red_file: {type: document, name: Red file}
  cam_l01: {type: device, name: Lobby camera}
```

Thing `type` values create thing subtypes in the kernel. Other entity fields
are preserved as JSON data.

Place IDs are mechanical and must never be translated. A scalar place label,
or an object-form place's `name` / `display_name`, may be a `$text` reference.
Localized public manifests resolve these player-safe labels while truth,
evidence reports, rules, tests, and saves continue to use the same stable ID.

The public cast is deliberately filtered. String entries pass through. Object
entries expose only `name`, `role`, `status`, `client`, `display_name`, and
`pronouns`. An entry is omitted from the public manifest if it has
`protected: true`, `hidden: true`, `public: false`, or `visibility` equal to
`private` or `hidden`. Do not rely on that filtering as permission to put
secrets in public-facing fields.

## `conversations`

`conversations` is an optional map of case-owned actor availability state
machines. Each key must name an actor from `cast`. Define an entry for every
actor/action pair whose contactability the runtime should enforce.

```yaml
conversations:
  witness:
    initial: available
    channels:
      interview: actor
      present: target
      request: from
      apologize: target
    allow_while_unavailable: [apologize]
    states:
      available:
        can_talk: true
      refusing:
        can_talk: false
        reason: {$text: conversations.witness.refusing.reason}
      unreachable:
        can_talk: false
        reason: The witness cannot be contacted.
```

Every actor definition is closed and accepts exactly these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `initial` | yes | A state ID declared in this actor's `states` map. |
| `states` | yes | Non-empty state map. Each state requires `can_talk: boolean` and may contain only an optional `reason`. |
| `channels` | yes | Non-empty map from a selected action verb to `actor`, `target`, or `from`. |
| `allow_while_unavailable` | no | Duplicate-free action list; every verb must also occur in this actor's `channels`. Defaults to empty. |

State IDs are arbitrary case-local IDs. The engine does not recognize special
tokens for dead, escaped, refusing, available, or any other story condition;
those meanings belong to the case. `can_talk` is the only availability bit the
generic action gate reads. `reason` is presentation copy and may be a direct
string or a `$text` reference at
`conversations.<actor>.states.<state>.reason`.

Each channel says where that verb carries the actor ID in a
`case.action.perform` payload:

- `interview: actor` reads `actor: witness`;
- `present: target` reads `target: witness`;
- `request: from` reads `from: witness`.

Every channel verb and every `allow_while_unavailable` verb must be supplied by
a capability selected in `use`. An allowed-while-unavailable verb bypasses only
the conversation availability gate; evidence requirements, action shape, and
all other validation still apply. This is useful for recovery actions: a
refusing actor can accept an apology whose reaction transitions them back to an
available state.

When at least one conversation entry declares a verb, that verb is regulated.
Omitting the routed actor field produces `actor-required`; identifying more
than one matching actor through different routed fields produces
`actor-argument-conflict`. An unknown, protected, hidden, or currently blocked
actor produces the same `actor-unavailable` denial. That error does not echo
the attempted actor, current state, or reason and emits no event. If no
conversation entry declares a verb, this contract adds no actor availability
gate to that verb.

The complete graph remains private. `case-runtime/public-v1` projects only
actors whose cast entries are public, and only their current state ID,
`canTalk`, sorted channel verbs, and current optional localized reason. Actors
marked `protected`, `hidden`, `public: false`, or private/hidden visibility are
omitted, so probing a guessed ID cannot confirm that it exists.

## `affordances`

`affordances` is the explicit public command surface. The runtime never turns
private unlock conditions or reactions into hints. It projects only entries
whose state is currently `offered`, so authors control what the detective can
see without revealing later evidence, search terms, or solution routes.

```yaml
affordances:
  request_camera_export:
    label: {$text: affordances.request_camera_export.label}
    result: {$text: affordances.request_camera_export.result}
    risk: consequential
    confirmation: {$text: affordances.request_camera_export.confirmation}
    surface: phone
    initial: offered
    action: {action: request, from: client, topic: camera-export}
    cost: {clock: case-time, by: 2m}

  search_archive:
    label: Search the archive
    surface: web
    initial: offered
    action: {action: search, query: exact-known-query}
    exclusive: false

  test_clock_theory:
    label: {$text: affordances.test_clock_theory.label}
    result: {$text: affordances.test_clock_theory.result}
    surface: casebook
    initial: withdrawn
    deduction: camera_clock_offset
```

Each entry requires `label`, `surface`, `initial`, and exactly one of `action`
or `deduction`. `surface` is `phone`, `web`, `files`, or `casebook`; it is a
presentation routing hint, not authorization. `initial` is `offered` or
`withdrawn`. `action` is a complete `CaseAction` mapping. `deduction` names a
declared deduction and creates a theory button.

`result` is optional localized copy describing the successful result of the
authored move. `risk` is `normal` (the default), `consequential`, or
`terminal`. `confirmation` is an optional localized question a shell can show
before dispatching the move. These fields are presentation metadata. They do
not spend time, end the case, or apply consequences by themselves; author the
actual cost and reactions separately. Completed action and deduction
affordances retain their safe label, result, risk, intent, cost, and completion
time in the public runtime projection.
Result copy is never projected while the affordance is merely offered.
Confirmation copy is only needed before dispatch.

For a deduction affordance, write `result` as the concrete conclusion the
player just proved, not another status message. For example: “The camera was
seven minutes fast. The corrected exit time is 20:57.” Player shells can then
show the verified theory and its answer without exposing proof fields or
case-internal identifiers.

`once` defaults to `true`; an accepted matching action or successfully
supported deduction withdraws it.
Action affordances may explicitly set `once: false`; deduction affordances
cannot, because a deduction can only transition to supported once.
`cost` is optional and currently accepts `{clock: case-time, by: <duration>}`.
The engine applies that cost atomically only after success, then deterministically
delivers any deadline made due by the advance. Denied or unproven commands cost
nothing and leave the offer intact.

Once a case declares any affordance, every declared deduction must have
exactly one deduction affordance. The compiler rejects missing or duplicate
coverage, and the runtime fails closed if older compiled content violates that
contract. A case with `affordances: {}` retains the legacy direct-deduction
behavior for compatibility with small examples; it has no player-visible
command lifecycle and should not be used for new interactive cases.

Action affordances are `exclusive: true` by default. While exclusive, an
alternate command in the same routed family—same verb and the same `actor`,
`from`, `target`, `evidence`, or `ref` identity—must match the authored command
exactly. This prevents omitting or changing a required topic, query, tone, or
other argument to bypass the offer lifecycle or its cost. An action without a
routed identity, such as `search`, closes that verb-wide family.

Set `exclusive: false` only when alternate commands are intentional, such as a
wrong free-form search or an unsuccessful presentation that should still
consume time through a broad reaction. The exact authored command remains
canonical and is still denied while withdrawn or after one-shot consumption;
`exclusive: false` does not make a hidden affordance callable.

Use `{offer: id}` and `{withdraw: id}` effects to change availability. Action
commands must be canonical: appending undeclared fields is rejected. The
compiler rejects duplicate or overlapping commands. A public action that
names a protected/private entity is also rejected. If `action.evidence` or an
evidence-valued `action.ref` names a card, the offer remains out of the public
projection until that card has been observed.

A reaction triggered by the exact action of a one-shot affordance cannot offer
that same affordance, including from a nested conditional effect. Such a rule
would conflict atomically with the engine's implicit withdrawal, so the
compiler rejects it instead of leaving a visible command that always fails.

After a public deduction succeeds, its safe localized label remains available
in `supportedDeductions`; unsupported private deduction definitions are never
enumerated.

## `assets`

`assets` is optional and maps stable case-local asset IDs to closed
descriptors. Every descriptor requires all five fields:

```yaml
assets:
  lobby-still:
    kind: image
    source: {local: assets/lobby-still.webp}
    mime_type: image/webp
    visibility: private
    integrity:
      sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### Asset fields

| Field | Accepted value |
| --- | --- |
| `kind` | `image`, `audio`, `video`, `document`, or `file`. |
| `source` | Exactly one local, HTTPS, or provider source form below. |
| `mime_type` | Lowercase MIME type matching the kind and, for local files, extension. Parameters such as `; charset=utf-8` are not accepted. |
| `visibility` | `public` or `private`. This controls static/bootstrap publication, not runtime authorization. |
| `integrity.sha256` | Exactly 64 lowercase hexadecimal characters for the exact delivered bytes. |

### Source forms

Local package file:

```yaml
source: {local: assets/interview.mp3}
```

The path must be normalized, use `/`, begin with `assets/`, contain no empty,
`.` or `..` segment, and remain inside the real package `assets/` directory.
Absolute paths, backslashes, NULs, symlinks, and directory traversal are
rejected.

Pinned HTTPS resource:

```yaml
source: {https: "https://media.example.org/cases/interview.mp3"}
```

It must use a public DNS hostname over HTTPS and contain no URL credentials or
fragment. Literal IP addresses, localhost, and `.localhost`, `.local`,
`.internal`, and `.localdomain` hosts are rejected. The compiler does not fetch
the URL. At delivery time the host's explicitly injected adapter must enforce
timeouts and re-check public DNS for the initial URL and every redirect.

Opaque provider reference:

```yaml
source:
  provider: signed-media
  ref: calls/emergency-21-13
```

The provider ID must be contributed by a selected capability. Currently
`signed-media` is supplied by `artifacts@1`. `ref` is a non-empty opaque string
of at most 1024 characters and remains host-only.

### Kind, MIME, and extension checks

`image`, `audio`, and `video` require a MIME type beginning with their matching
prefix. `document` accepts:

```text
application/epub+zip
application/json
application/msword
application/pdf
application/rtf
application/vnd.ms-excel
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
application/vnd.openxmlformats-officedocument.wordprocessingml.document
text/csv
text/markdown
text/plain
```

`file` accepts:

```text
application/json
application/octet-stream
application/zip
text/csv
text/markdown
text/plain
```

Local asset extensions and accepted MIME types are:

| Extensions | MIME type(s) |
| --- | --- |
| `.avif` | `image/avif` |
| `.bin` | `application/octet-stream` |
| `.csv` | `text/csv` |
| `.doc` | `application/msword` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `.epub` | `application/epub+zip` |
| `.flac` | `audio/flac` |
| `.gif` | `image/gif` |
| `.jpeg`, `.jpg` | `image/jpeg` |
| `.json` | `application/json` |
| `.m4a` | `audio/mp4` |
| `.md` | `text/markdown` |
| `.mov` | `video/quicktime` |
| `.mp3` | `audio/mpeg` |
| `.mp4` | `audio/mp4` or `video/mp4` |
| `.oga` | `audio/ogg` |
| `.ogg` | `audio/ogg` or `video/ogg` |
| `.pdf` | `application/pdf` |
| `.png` | `image/png` |
| `.rtf` | `application/rtf` |
| `.svg` | `image/svg+xml` |
| `.txt` | `text/plain` |
| `.wav` | `audio/wav`, `audio/wave`, or `audio/x-wav` |
| `.webm` | `audio/webm` or `video/webm` |
| `.webp` | `image/webp` |
| `.xls` | `application/vnd.ms-excel` |
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `.zip` | `application/zip` |

Executable/script, HTML, XHTML, XML, and WebAssembly extensions are explicitly
forbidden. Unknown local extensions are rejected.

### Asset integrity and publication

Local bytes are hashed during package compilation. The default limit is 512
MiB per local asset and 2 GiB for all local assets in one package. Static SVG
has a 5 MiB limit and a conservative policy that rejects scripts, active or
external elements, namespace tricks, event attributes, links, inline styles,
CSS imports/URLs, DTDs, entities, and CDATA.

HTTPS/provider bytes are read exactly once into the engine-owned cache during
delivery. The gateway checks the byte limit, SHA-256, static SVG policy, and
known media magic before the cache file becomes servable. There is no default
network fetcher and no digest-free remote mode.

`visibility: public` means an asset may enter the static public build only when
it is attached to evidence listed in `opening.grants`. A public asset attached
only to locked evidence is not copied into bootstrap output. A private asset
never enters the static build. At runtime, a handle first appears when its
evidence is granted. If the card is observed and later revoked, the card and
handle remain projected because learned artifacts are not forgotten; an
unobserved revoked card disappears. The host authorizer must implement this
projection policy and bind the request to the case ID, version, and final
kernel digest.

## `truth`

`truth` is private and requires `events` and `facts` maps. `events` must contain
at least one entry; `facts` may be empty.

```yaml
truth:
  events:
    file_taken:
      at: "21:04:01"
      type: object.taken
      actor: nihan
      object: red_file
      place: newsroom
  facts:
    camera_offset:
      relation: device.clock-offset
      device: cam_l01
      value: "+7m"
```

Truth event and fact bodies are intentionally free-form JSON mappings. The
runtime stores each event as a hidden `world.event` assertion. `at`, `from`,
and `to`, when present, become assertion validity metadata. A fact's
`relation` selects its relation, `value` is its value (default `true`), and all
other fields form the assertion key.

The compiler cross-checks these conventional truth-event fields when present:

- `actor` and every member of `actors`: a cast or thing ID;
- `place`: a place ID;
- `object`, `device`, `account`, `part`, `session`: a thing ID;
- `target`: a thing ID or another truth-event ID.

Other narrative fields remain private but are not reference-checked in v0.1.
Do not use canonical truth as a shortcut for player knowledge: players learn
through evidence observations and hypotheses only.

## `perspectives`

`perspectives` is a private mapping keyed by cast ID. It may be empty. The
runtime recognizes `knows`, `believes`, and `says`:

```yaml
perspectives:
  nihan:
    knows: [file_taken]
    believes:
      - relation: person.endangered-by
        actor: can
        object: interview_draft
        value: true
        confidence: 1.0
        reason: The unredacted draft names the source.
    says:
      initial:
        - relation: object.taken-by
          object: red_file
          value: nihan
          polarity: deny
          intent: concealment
      trusted:
        - relation: object.taken-by
          object: red_file
          value: nihan
          intent: confession
```

- `knows` is a truth-event ID list. Known events are copied into the actor's
  hidden perspective context with provenance.
- `believes` is a list of claim mappings.
- `says` maps an arbitrary stage name such as `initial` or `trusted` to a list
  of claims. The special string `same-as-belief` copies all authored beliefs
  into that statement stage.
- Interviewing an actor reveals the `initial` statement stage once.
- A reaction effect such as `{reveal: nihan.says.trusted}` reveals another
  exact stage. The path must exist.

For a claim, `relation` defaults to `statement.claim`; `value` defaults to
`true`; `polarity: deny` creates a denial and every other/missing polarity is
affirmative. `confidence` is retained when numeric. `at`, `from`, `to`, and
`during` become validity metadata. A belief's `reason` and a statement's
`intent` become private provenance. Remaining fields form the claim's
assertion key.

Knowledge, belief, statement, source observation, canonical truth, and player
hypothesis remain separate contexts.

## `opening`

All three fields are required and unknown fields are rejected.

```yaml
opening:
  call:
    from: leyla
    text: The file is missing. Please investigate.
  grants: [lobby_video, printer_log]
  starts: [document_pickup]
```

- `call.from` must be a cast ID; `call.text` is a non-empty public string.
- `grants` is a duplicate-free evidence ID list.
- `starts` is a duplicate-free deadline ID list.

`opening.grants` and evidence declared with `at: start` must match in both
directions. Granting locked evidence is an error, and forgetting to grant an
`at: start` card is an error. Only deadlines listed in `opening.starts` are
scheduled when a case session begins.

## `evidence`

`evidence` is a non-empty mapping. Every evidence card requires `tool`, exactly
one availability form (`at: start` or `unlock`), and a non-empty `reports` map.
Unknown fields are rejected.

```yaml
evidence:
  lobby_video:
    tool: video
    presentation:
      title: {$text: evidence.lobby_video.title}
      description: {$text: evidence.lobby_video.description}
      findings:
        actor: {$text: evidence.lobby_video.findings.actor}
        screen_exit_at: {$text: evidence.lobby_video.findings.screen_exit_at}
    at: start
    assets: [lobby-recording]
    reports:
      actor: mert
      screen_exit_at: "21:04"
    omits: [actual-time]
    reliability: misleading-clock

  corrected_export:
    tool: log
    unlock: {after: supported, ref: camera_time_corrected}
    expires_with: export_deletion
    reports:
      actual_exit_at: "20:57"
```

| Field | Required | Meaning/default |
| --- | --- | --- |
| `tool` | yes | Non-empty tool name supplied by a selected capability. |
| `presentation` | no | Player-safe copy. When present, it requires localized `title` and a non-empty `findings` map; localized `description` is optional. |
| `at` | one of | The only accepted value is `start`. |
| `unlock` | one of | Closed unlock expression described below. |
| `expires_with` | no | Deadline ID; the card is revoked when that deadline fires. |
| `reports` | yes | Non-empty free-form map. Each field becomes one source observation. |
| `assets` | no | Duplicate-free asset ID list; defaults to empty. |
| `omits` | no | Private free-form string list documenting omissions. |
| `reliability` | no | Private non-empty reliability annotation. |

An evidence card becomes visible when access is granted. Observing it records
its generated observations in the player's observed context. Granting access
does not copy canonical truth.

Presentation copy has a separate reveal boundary. `title` and `description`
are projected when the card is granted. A `findings` entry is projected only
after the detective observes the card. Every finding key must exactly match a
field under the same card's `reports`; an unknown key is rejected with
`E_UNKNOWN_EVIDENCE_FINDING`. The finding text is what the player reads, while
the report value remains structural proof data. Never turn a report ID or raw
value into UI copy automatically.

### Unlock expressions

An unlock is exactly one of the following forms.

An authored event type:

```yaml
unlock: workspace-files-deleted
```

The event must actually be emitted; the simulator will not invent it.

Boolean composition:

```yaml
unlock:
  any:
    - {trust: [baran, 1]}
    - {search: "PROD-TAB-03 remote pairing"}
```

```yaml
unlock:
  all:
    - {after: supported, ref: camera_time_corrected}
    - {after: observe, ref: printer_log.completed_at}
```

`any` and `all` each require a non-empty list of unlock expressions.

Trust threshold:

```yaml
unlock: {trust: [baran, 2]}
```

The first value is a cast ID and the second is a numeric minimum.

Search/request shorthands:

```yaml
unlock: {search: "Orhan production audit"}
```

```yaml
unlock: {request: security-export}
```

The corresponding verb must come from the selected capabilities.

Observation or supported-deduction gates:

```yaml
unlock: {after: observe, ref: audit_draft.payments_diverted_to}
```

```yaml
unlock: {after: supported, ref: motive_found}
```

These forms require exactly `after` and `ref`. `observe` may refer to an
observation/evidence reference; `supported` must refer to a deduction.

Full action gate:

```yaml
unlock:
  after: present
  target: nihan
  evidence: interview_draft
  tone: empathetic
```

`after` is an allowed selected action verb. The only action argument fields are
`target`, `actor`, `from`, `topic`, `evidence`, `tone`, `query`, and `ref`, and
every supplied value must be a string. The action must match every supplied
argument. If an action carries an `evidence` argument at runtime, that evidence
must already have been observed.

One compatibility rule is worth making explicit: `{after: open, ref: ...}` is
lowered by the current adapter to “the referenced evidence/observation has been
observed.” It does not require a second, separately recorded `open` action.

The compiler verifies that every evidence card has a structural route from
opening evidence, another reachable observation/deduction, a trust gate, an
action gate, or an authored event gate. Purely circular evidence routes are
rejected. An arbitrary raw event/action/trust gate is considered a possible
entry point even when no reachable reaction emits or performs it, so only an
external scenario that explicitly performs the route and observes the card
proves it is executable.

## `deductions`

`deductions` is a non-empty mapping. Every entry requires a non-empty
`conclude` mapping and at least one proof source: a `use`+`with` pair, `prove`,
or `require`. Unknown fields are rejected.

### Direct proof alternatives

```yaml
deductions:
  nihan_took_file:
    conclude: {object: red_file, taken_by: nihan}
    prove:
      any:
        - [access_log.entered_at, desk_camera.file_removed_at]
        - [nihan_confession.took]
```

`prove.any` is a non-empty list of alternatives. The outer list is OR. The
compact alternative above remains supported: every term in its non-empty list
is AND. A term may be a dotted observation ID or another deduction ID. All
observation terms must actually be observed and all deduction terms supported.
A branch establishes availability, not merely a hint to the UI.

Use an object alternative when the observed value matters, including a
meaningful `false`, `0`, or empty array:

```yaml
deductions:
  entry_was_quiet:
    conclude: {entry: quiet}
    prove:
      any:
        - terms: [monitor.alerts, monitor.dropout_seconds, monitor.signal_strength,
                  access.roles, access.opened_at, access.closed_at]
          checks:
            - {ref: monitor.alerts, equals: 0}
            - {ref: monitor.dropout_seconds, not_equals: 4}
            - {ref: monitor.dropout_seconds, less_than: 1}
            - {ref: monitor.signal_strength, greater_than: 0}
            - {ref: access.roles, contains: staff}
            - {ref: monitor.error_codes, count: 0}
            - {ref: access.opened_at, before: {ref: access.closed_at}}
            - {ref: access.closed_at, after: {value: "20:00"}}
```

An object alternative has exactly two fields: a non-empty, duplicate-free
`terms` list and a non-empty `checks` list. Its terms and checks are AND. The
closed check vocabulary is:

| Check | Required reported value | Meaning |
| --- | --- | --- |
| `{ref: x, equals: value}` | Same JSON type as `value` | Deep canonical equality. |
| `{ref: x, not_equals: value}` | Same JSON type as `value` | Deep canonical inequality. |
| `{ref: x, less_than: number}` | Finite number | Strictly less than the literal. |
| `{ref: x, greater_than: number}` | Finite number | Strictly greater than the literal. |
| `{ref: x, contains: value}` | Array | At least one element is deeply equal to `value`. |
| `{ref: x, count: integer}` | Array | Array length equals the non-negative integer. |
| `{ref: x, before: {ref: y}}` | Clock time or timestamp | `x` is strictly earlier than observed `y`. |
| `{ref: x, before: {value: time}}` | Clock time or timestamp | `x` is strictly earlier than the literal. |
| `{ref: x, after: {ref: y}}` | Clock time or timestamp | `x` is strictly later than observed `y`. |
| `{ref: x, after: {value: time}}` | Clock time or timestamp | `x` is strictly later than the literal. |

Clock values accept `HH:MM`, `HH:MM:SS`, or a JavaScript-parseable absolute
timestamp. Compare like with like: clock times with clock times and absolute
timestamps with absolute timestamps. Equality is JSON-aware, so `false`, `0`,
`null`, strings, arrays, and objects remain distinct.

Every check `ref`, including the right side of a `{ref: ...}` time comparison,
must name a known observation and must also appear in that alternative's
`terms`. Checks cannot read truth, source assertions, or an unlisted value. The
compiler validates reference and report types. At runtime, a missing,
unobserved, altered, wrongly typed, unparsable, or non-matching value makes the
check false. In particular, `not_equals` does not turn an absent observation
into proof. Unknown operators and extra fields are schema errors.

### Required deductions

```yaml
deductions:
  full_explanation:
    use: investigation.composite-explanation
    conclude: {incident: red-file-missing, explanation: source-protection}
    require: [mert_no_opportunity, nihan_took_file, file_in_b17]
```

`require` is a duplicate-free deduction ID list. Every dependency must already
be supported. A deduction may combine `require` with explicit proof
alternatives. Self-dependencies and direct or indirect cycles are rejected.

### Built-in templates

Templates add typed, bounded checks rather than arbitrary executable code.

`safety.intentional-disable-and-command`:

```yaml
death_not_accident:
  use: safety.intentional-disable-and-command
  with:
    failure: safety_report.failure_mode
    damage: safety_report.pin_damaged
    command: automation_log.action
    victim_positioned: positioning_message.sent_by
  conclude: {incident: victim_death, intentional: true}
```

It requires all four observation bindings. The bound values must report
`safety-pin-removed`, `false`, and `open` for `failure`, `damage`, and
`command`, and the conclusion must include `incident` plus
`intentional: true`.

`media.timestamp-offset`:

```yaml
camera_time_corrected:
  use: media.timestamp-offset
  with:
    shown: lobby_video.screen_exit_at
    offset: camera_sync_notice.clock_offset
  conclude: {actor: mert, exited_at: "20:57"}
  prove:
    any:
      - [lobby_video.screen_exit_at, camera_sync_notice.clock_offset]
```

`shown` and `conclude.exited_at` must be valid 24-hour clock times. `offset`
must be a signed duration using `+` or `-` and `s`, `m`, or `h`, such as
`+7m`. The compiler checks `shown - offset = exited_at`, and at least one proof
branch must contain both bindings. The v0.1 compiler arithmetic accepts some
out-of-range strings such as `24:00`, while the runtime proof correctly rejects
them; always cover this deduction with explicit observe and deduce steps.

`media.prerecorded-alibi`:

```yaml
alibi_false:
  use: media.prerecorded-alibi
  conclude: {actor: selin, alibi_for: victim_death, valid: false}
  prove:
    any:
      - [livestream_metadata.recorded_at, livestream_history.delivery]
```

The conclusion requires `actor`, a truth-event ID in `alibi_for`, and
`valid: false`. Every proof branch needs at least two observations: one whose
authored value is `scheduled` and another clock timestamp earlier than the
referenced incident's truth-event `at` value. As with `media.timestamp-offset`,
use valid 24-hour/timestamp values and run an external detective scenario
because compile-time range checking is incomplete.

`investigation.composite-culprit` requires a non-empty `require` list and a
conclusion with string `incident` and `perpetrator` fields.

`investigation.composite-explanation` requires a non-empty `require` list and a
conclusion with string `incident` and `explanation` fields.

When `with` is present and `prove` is absent, the compiler can infer one proof
branch. Known template binding order is used; otherwise binding keys are sorted
canonically. Explicit `prove.any` replaces that inferred branch. Some template
validators still require an explicit branch: `media.timestamp-offset` and
`media.prerecorded-alibi` do, while the safety template can use its inferred
branch. Template names must come from a selected capability.

The compiler requires a structurally reachable proof graph. A reference can be
spelled correctly yet still fail with `E_DEDUCTION_UNREACHABLE` if all proof
routes depend on locked/circular sources. Conversely, raw event/action/trust
gates are optimistic roots; add an external scenario that explicitly performs
the route, observes its evidence, and attempts every critical deduction.

## `flags`

`flags` is a duplicate-free list of declared case-local IDs. It may be empty.
Every flag begins as `false`.

```yaml
flags: [file_recovered, source_protected, deadline_expired]
```

Conditions, effects, outcomes, and deadlines may only refer to declared flags.
External detective tests intentionally cannot inspect flags; assert their
public evidence, clock, conclusion, status, or outcome consequences instead.

## Conditions

Conditions are used by reaction `when`/`unless` clauses and objectives. Every
condition mapping contains exactly one operator:

```yaml
all:
  - {observed: evidence_id.field}
  - {supported: deduction_id}
  - {marked: flag_id}
  - {not-marked: another_flag_id}
  - {schedule-active: deadline_id}
  - {unless: {marked: blocking_flag_id}}
  - {any: [{marked: first_flag}, {marked: second_flag}]}
```

`all` and `any` require non-empty condition lists. Condition-level `unless` is
logical NOT. A reaction's top-level `unless` is also negated before the rule
fires.

## `reactions`

`reactions` is a list of deterministic event-driven rules and may be empty.
Each reaction requires `on` and `do`.

```yaml
reactions:
  - id: recover_file
    priority: 100
    on: {action: submit-conclusion, target: mediate}
    when:
      all:
        - {supported: file_in_b17}
        - {schedule-active: document_pickup}
    unless: {marked: file_recovered}
    once: true
    do:
      - {cancel: document_pickup}
      - {mark: file_recovered}
```

### Reaction defaults and ordering

- `id` is optional. If omitted, a stable `reaction_<digest-prefix>` ID is
  derived from semantic content.
- `priority` is optional. If omitted, a stable integer is derived from the same
  digest.
- `once` defaults to `false`; write `once: true` for one-shot story effects.
- `when` and `unless` are optional.
- Higher priorities run first; ties are ordered by reaction ID.
- Rules evaluate deterministically from event/state snapshots and apply an
  atomic effect batch. They do not mutate state directly.

### Reaction triggers

An action trigger:

```yaml
on: {action: present, target: nihan, evidence: interview_draft, tone: empathetic}
```

`action` must be a selected verb. It accepts the same optional argument fields
as unlock actions: `target`, `actor`, `from`, `topic`, `evidence`, `tone`,
`query`, and `ref`.

A supported deduction trigger:

```yaml
on: {supported: nihan_took_file}
```

An exact player-observation trigger:

```yaml
on: {observed: lobby_video.screen_exit_at}
```

This fires only when that declared report field enters the detective's
observed assertion context. It can progressively offer the next affordance
without publishing that later command early.

An authored event trigger:

```yaml
on: {event: workspace-deletion-attempted}
```

`observed`, `supported`, and `event` trigger objects must contain exactly that
one field.
Emitted-event cycles among event-triggered reactions are rejected.

`submit` is an authoring alias for the `submit-conclusion` verb. Prefer the
full verb in reactions. External tests use `detective.conclude: <target>`.

### Effects

Every normal effect mapping contains exactly one operator:

| Form | Effect |
| --- | --- |
| `{trust: [actor_id, 2]}` | Add a numeric trust delta. |
| `{mark: flag_id}` | Set a flag to `true`. |
| `{unmark: flag_id}` | Set a flag to `false`. |
| `{grant: evidence_id}` | Grant evidence access. |
| `{revoke: evidence_id}` | Revoke evidence access. |
| `{reroute: [evidence_id, provider]}` | Grant evidence and record the selected reroute provider. |
| `{spend: [case-time, 10m]}` | Advance authored case time. |
| `{cancel: deadline_id}` | Cancel a scheduled deadline. |
| `{bring-forward-by: [deadline_id, 20m]}` | Shift an active schedule earlier. |
| `{emit: event-type}` | Emit an authored follow-up event. |
| `{reveal: actor_id.says.stage}` | Copy that statement stage into player-observed assertions. |
| `{conversation: [actor_id, state_id]}` | Move a declared actor conversation graph to a declared state. |
| `{offer: affordance_id}` | Make a declared public affordance available. |
| `{withdraw: affordance_id}` | Hide a declared public affordance. |
| `{adjust: [metric_id, actor_id, 3]}` | Add a numeric metric delta for a cast actor. Use it in reactions; see the limitation below. |

Although the source shape recognizes `wall`, `active`, and `case-time` in a
`spend` tuple, the current case runtime adapter implements rule-driven spend
only for `case-time`. Author `case-time` until another clock-spend adapter is
implemented.

The current adapter initializes metric slots by scanning reaction effects.
An `adjust` that appears only in a deadline `do` compiles but fails when the
deadline fires because its metric slot does not exist. Keep `adjust` effects in
reactions; do not rely on a deadline-only metric declaration.

The one two-field conditional effect is:

```yaml
- if-marked: baran_detained
  then:
    - {unmark: baran_detained}
    - {mark: baran_released}
```

`then` is a list of effects. It runs only when the declared flag is marked.
No other fields are allowed beside `if-marked` and `then`.

Reroute providers must come from selected capabilities. A `reveal` path must
start with a known actor ID and must exactly match an authored `says` stage;
otherwise runtime compilation fails. A `conversation` effect must name a cast
actor with a `conversations` entry and one of that entry's declared states.
Metric and event names should use safe case-local/token-style IDs even where
the v0.1 schema leaves them open.

## `deadlines`

`deadlines` maps deadline IDs to closed schedule definitions. It may be empty.
Every deadline requires `clock`, `offline`, `do`, and exactly one of `after` or
`at`.

Relative deadline:

```yaml
workspace_deletion:
  label: {$text: deadlines.workspace_deletion.label}
  clock: wall
  after: 55m
  offline: on-resume-once
  cancel_on: financial_backup
  do:
    - {mark: financial_files_deleted}
    - {emit: workspace-files-deleted}
```

Absolute case-time deadline:

```yaml
document_pickup:
  clock: case-time
  at: "21:40"
  offline: pause
  do: [{mark: deadline_expired}]
```

| Field | Grammar and behavior |
| --- | --- |
| `label` | Optional localized player-facing deadline title. |
| `clock` | `wall` or `case-time`. |
| `after` | Positive duration relative to session start. Mutually exclusive with `at`. |
| `at` | Clock time converted to an offset from `case.time.starts_at`. Only legal with `clock: case-time`; it may not be earlier than the start. |
| `offline` | `on-resume-once`, `pause`, or `continue`. |
| `cancel_on` | Optional flag ID. Marking it cancels the active schedule; deadline effects are also guarded against that flag. |
| `do` | Non-empty effect list using the reaction effect grammar. Avoid deadline-only `adjust`; the current adapter does not initialize that metric slot. |

Current runtime scheduling semantics are:

- `case-time` deadlines use the case clock and fire when that clock advances to
  the due point;
- `clock: wall` plus `offline: pause` is backed by the active clock, so it does
  not advance while suspended;
- `clock: wall` plus `offline: on-resume-once` uses wall time and emits one
  missed delivery on resume;
- `clock: wall` plus `offline: continue` uses wall time and immediate delivery
  when the host observes/advances it.

Declaring a deadline does not start it. Put its ID in `opening.starts`.
`bring-forward-by` and `cancel` have an effect only on an active schedule.
When an authored deadline is scheduled, its safe label, clock, due time,
remaining time, and status are available in the public runtime projection.

## `objectives`

`objectives` is intended to be a non-empty mapping from objective ID to one
condition expression:

```yaml
objectives:
  identify_nihan: {supported: nihan_took_file}
  recover_file: {marked: file_recovered}
  clean_resolution:
    all:
      - {supported: full_explanation}
      - {not-marked: false_accusation}
```

Always use a condition mapping as the value. The v0.1 JSON Schema is broader
than the runtime here: a scalar such as `locate: typo-not-a-condition` can pass
source compilation and is silently omitted from kernel objectives. Reference
the objective from an outcome and exercise that outcome in a scenario; do not
treat compilation alone as validation of a scalar objective.

Objective state is derived from current evidence, deductions, flags, and
schedules; it is not an independently mutable slot.

## `assessment`

`assessment` is an optional private rubric for the post-case method report. It
uses the same condition language as objectives. The runtime evaluates every
criterion against authoritative case state only after an outcome closes the
case. Before then, the rubric, its conditions, and its copy are not part of the
public manifest or runtime projection.

```yaml
assessment:
  max_score: 100
  bands:
    - {min_score: 90, label: {$text: assessment.bands.exemplary}}
    - {min_score: 60, label: {$text: assessment.bands.mixed}}
    - {min_score: 0, label: {$text: assessment.bands.weak}}
  categories:
    evidence_reasoning:
      label: {$text: assessment.categories.evidence_reasoning}
      criteria:
        establish_timeline:
          points: 30
          when: {supported: corrected_timeline}
          met: {$text: assessment.criteria.establish_timeline.met}
          missed: {$text: assessment.criteria.establish_timeline.missed}
    procedure_people:
      label: {$text: assessment.categories.procedure_people}
      criteria:
        avoid_early_accusation:
          points: 20
          when: {not-marked: false_accusation}
          met: {$text: assessment.criteria.avoid_early_accusation.met}
          missed: {$text: assessment.criteria.avoid_early_accusation.missed}
```

| Field | Meaning |
| --- | --- |
| `max_score` | Positive integer. The sum of every criterion's `points` must match it exactly. |
| `bands` | Score labels. Thresholds must be unique, within `0..max_score`, and include `0`. The highest matching threshold wins. |
| `categories` | One or more report sections. IDs are private and category labels are localized. |
| `criteria` | One or more scored checks inside a category. |
| `points` | Positive integer awarded when `when` is true; otherwise zero. |
| `when` | A valid `observed`, `supported`, flag, schedule, `all`, `any`, or `unless` condition. |
| `met` / `missed` | Localized factual report sentence selected from the resolved result. |

The public result contains only the final score, maximum score, selected band
label, category totals, and one resolved sentence per criterion. It does not
contain rubric IDs, flags, objective names, conditions, or the unused branch of
criterion copy. This lets a case explain behavior without teaching the UI any
case-specific tokens.

## `outcomes`

`outcomes` is a non-empty mapping. `title` and numeric `priority` are required;
all gates are optional.

```yaml
outcomes:
  all_protected:
    title: Everyone Protected
    body: The file was recovered without exposing the source.
    priority: 100
    require: [explain, recover_file, protect_source]
    unless: [false_accusation]
    final_target: mediate
    when_marked: source_protected

  compromise:
    title: A Costly Result
    priority: 70
    final_target: [security, mediate]
    when_any_marked: [nihan_suspended, false_accusation]
```

| Field | Meaning/default |
| --- | --- |
| `title` | Non-empty public outcome title. |
| `body` | Optional localized player-facing outcome detail. It is revealed only with the selected outcome. |
| `priority` | Number; higher eligible outcome wins, then ID ascending for a tie. |
| `require` | Duplicate-free list of objectives that must all be true; defaults empty. |
| `unless` | Duplicate-free list of objectives; the outcome is excluded when any is true; defaults empty. |
| `final_target` | One decision target ID or a duplicate-free list; defaults empty/no target requirement. |
| `when_marked` | One flag that must be true. |
| `when_any_marked` | At least one flag in this list must be true; defaults empty. |

An outcome with no gates is eligible immediately, so use at least one gate
unless that is intentional. The highest-priority eligible outcome closes the
case. Its public status becomes `ended`, and every later command is rejected
with `case-ended` without changing the saved state.

`first-write-wins` or `replaceable` controls the submitted final target before
an outcome closes the case, not outcome priority. With `replaceable`, a valid
submitted target that does not make any outcome eligible may be replaced by a
later valid target. Once an outcome is eligible, it cannot be replaced because
the case is already terminal.

A `final_target` normally names a cast, thing, or place. Abstract targets such
as `mediate` or `security` become valid when a reaction has a matching
`on: {action: submit-conclusion, target: ...}` trigger.

## External detective tests

`case-source/v0.1` has no top-level `tests` field. Unknown top-level fields are
rejected, so never place acceptance scenarios inside `case.yml`.

Put one ordered public-perspective scenario in each
`tests/<scenario-id>.yml`:

```yaml
schema: case-test/v0.1
case: {id: community.example.tiny-note, version: 0.1.0}

scenario:
  id: basic_solution
  perspective: detective
  steps:
    - detective.observe: note_card
      expect:
        result: {status: accepted}
        state:
          observations: {note_card.message: meeting-moved}

    - detective.deduce: note_explained
      expect:
        result: {status: accepted}
        state:
          deductions: {note_explained: supported}
          outcome: solved
```

The runner executes only the commands written in `steps`; it does not plan a
route, auto-observe evidence, or infer a missing action. Expectations can
inspect only the public lifecycle status, elapsed clocks, projected evidence
and opaque asset IDs, offered/hidden affordances, observations,
supported/unknown deductions, final
conclusion, and outcome. They cannot inspect private truth, flags, trust,
schedules, events, objectives, capability state, or raw asset locators.

The test files are private CI/authoring artifacts. They are parsed only by the
test runner and do not enter source IR, kernel IR, build digests, public
manifests, or generated assets. See the complete
[`case-test/v0.1` reference](detective-tests.md) for package discovery, secure
loading, operations, expectations, denial codes, examples, and diagnostics.

## Defaults summary

| Location | Default when omitted |
| --- | --- |
| top-level `authoring` | Empty private map. |
| top-level `assets` | No assets. |
| top-level `conversations` | No actor availability graphs or conversation-gated verbs. |
| top-level `affordances` | No explicit public command prompts. |
| top-level `assessment` | No post-case score or method report. |
| conversation `allow_while_unavailable` | Empty list. |
| affordance `once` | `true`. |
| affordance `cost` | No clock cost. |
| affordance `risk` | `normal`. |
| affordance `result`, `confirmation` | No additional presentation copy. |
| evidence `assets` | Empty list. |
| evidence `presentation` | No authored player-facing title, description, or findings. |
| deadline `label` | No player-facing deadline title. |
| reaction `id` | Stable digest-derived ID. |
| reaction `priority` | Stable digest-derived integer. |
| reaction `once` | `false`. |
| deduction proof | Inferred from `with` only when explicit `prove.any` is absent. |
| flags | Every declared flag begins `false`. |
| trust | Every cast actor begins at `0`. |
| metrics | Metrics referenced by reaction `adjust` effects begin at `0` for every cast actor. Deadline-only references are not initialized. |
| outcome `require`, `unless`, `final_target`, `when_any_marked` | Empty lists/no gate. |
| outcome `body` | No outcome detail beyond its title. |
| fact `relation` | `world.fact`. |
| fact/claim `value` | `true`. |
| claim `relation` | `statement.claim`. |
| claim `polarity` | Affirm unless exactly `deny`. |

Required top-level sections have no implicit source-level default: write them
even when an empty list/map is allowed.

## Diagnostics and common failures

Compiler diagnostics include the source file, line, column, severity, error
code, JSON-pointer path, and message. Duplicate YAML mapping keys and malformed
YAML produce `E_YAML_PARSE`. Unknown or missing closed-schema fields produce
`E_SCHEMA`. Semantic checks run only after schema validation succeeds.

Common diagnostic groups:

| Codes | What to fix |
| --- | --- |
| `E_YAML_PARSE`, `E_SOURCE_ROOT`, `E_SCHEMA` | YAML syntax, duplicate keys, root mapping, required/unknown fields, enum/pattern/shape violations. |
| `E_UNKNOWN_CAPABILITY`, `E_UNKNOWN_TOOL`, `E_UNKNOWN_ACTION`, `E_UNKNOWN_TEMPLATE`, `E_UNKNOWN_PROVIDER`, `E_UNKNOWN_ASSET_PROVIDER` | Add the correct capability or correct the vocabulary token. |
| `E_ACTION_SHAPE`, `E_ACTION_ARGUMENT`, `E_UNLOCK_SHAPE`, `E_TRIGGER_SHAPE`, `E_CONDITION_SHAPE`, `E_UNKNOWN_CONDITION`, `E_EFFECT_SHAPE`, `E_UNKNOWN_EFFECT` | Use one of the closed action/expression forms in this document. |
| `E_CONVERSATION_SHAPE`, `E_CONVERSATION_INITIAL`, `E_UNKNOWN_CONVERSATION_STATE` | Close the conversation definition, declare its initial/transition states, route selected verbs through `actor`/`target`/`from`, and keep unavailable exceptions in those channels. |
| `E_AFFORDANCE_COST`, `E_DUPLICATE_AFFORDANCE_ACTION`, `E_OVERLAPPING_AFFORDANCE_ACTION`, `E_DUPLICATE_AFFORDANCE_COMMAND`, `E_PUBLIC_AFFORDANCE_LEAK`, `E_UNKNOWN_AFFORDANCE` | Correct the explicit public command, safe cost, lifecycle reference, or private entity leak. |
| `E_UNKNOWN_ACTOR`, `E_UNKNOWN_ENTITY`, `E_UNKNOWN_PLACE`, `E_UNKNOWN_THING`, `E_UNKNOWN_TARGET` | Correct a cast/place/thing/truth-event reference. |
| `E_UNKNOWN_EVIDENCE`, `E_UNKNOWN_EVIDENCE_FINDING`, `E_UNKNOWN_OBSERVATION`, `E_UNKNOWN_DEDUCTION`, `E_UNKNOWN_FLAG`, `E_UNKNOWN_DEADLINE`, `E_UNKNOWN_OBJECTIVE`, `E_UNKNOWN_OUTCOME`, `E_UNKNOWN_DECISION_TARGET`, `E_UNKNOWN_ASSET`, `E_UNKNOWN_TRUTH_EVENT` | Correct a typed cross-reference, match a presentation finding to its report field, or declare the missing ID. |
| `E_LOCKED_EVIDENCE_GRANTED`, `E_INITIAL_EVIDENCE_NOT_GRANTED` | Make `opening.grants` exactly match cards with `at: start`. |
| `E_EVIDENCE_UNREACHABLE`, `E_DEDUCTION_UNREACHABLE` | Add a structural route; spelling a reference is not enough. Then exercise event/action/trust-gated routes in an external scenario. |
| `E_DEDUCTION_CYCLE`, `E_EMITTED_EVENT_CYCLE` | Break circular deduction or emitted-event dependencies. |
| `E_TEMPLATE_*` | Correct required bindings, conclusion shape, proof branch, authored values, or time arithmetic. |
| `E_ABSOLUTE_WALL_DEADLINE`, `E_DEADLINE_BEFORE_START` | Use `case-time` for `at` and keep it at/after `case.time.starts_at`. |
| `E_I18N_REFERENCE_SHAPE`, `E_I18N_REFERENCE_CONTEXT`, `E_I18N_CATALOG_REQUIRED`, `E_I18N_MISSING_MESSAGE`, `E_I18N_DEFAULT_LOCALE` | Correct the `$text` handle, keep it in a supported presentation field, and bind it in the default catalog. |
| `E_ASSET_MIME_KIND`, `E_ASSET_LOCAL_PATH`, `E_ASSET_EXTENSION`, `E_ASSET_EXTENSION_MIME`, `E_ASSET_HTTPS_URL` | Correct the authored asset descriptor. |
| `E_PUBLIC_DATA_LEAK` | The sanitized public manifest contains a forbidden private/raw-locator field. Treat this as a build-stopping security error. |

Package and delivery checks can additionally report:

- package/source errors: `E_CASE_PACKAGE_PATH`, `E_CASE_PACKAGE_ASSETS`,
  `E_CASE_PACKAGE_I18N`, `E_CASE_PACKAGE_TESTS`, `E_CASE_SOURCE_MISSING`,
  `E_CASE_SOURCE_INVALID`;
- catalog errors: `E_I18N_FILE`, `E_I18N_YAML`, `E_I18N_SCHEMA`,
  `E_I18N_IDENTITY`, `E_I18N_MISSING_MESSAGE`;
- local file errors: `E_ASSET_MISSING`, `E_ASSET_NOT_FILE`,
  `E_ASSET_SYMLINK`, `E_ASSET_ESCAPE`, `E_ASSET_TOO_LARGE`,
  `E_ASSET_DIGEST`, `E_ASSET_UNSAFE_SVG`, `E_ASSET_CONTENT`;
- delivery errors: `E_ASSET_UNAUTHORIZED`, `E_ASSET_ADAPTER`,
  `E_ASSET_CONTENT`, `E_ASSET_DIGEST`, `E_ASSET_TOO_LARGE`.

External test loading uses the separate `E_CASE_TEST_*` diagnostic family;
see [Load and document error codes](detective-tests.md#load-and-document-error-codes).

Never work around an asset or public-data diagnostic by weakening integrity or
copying a private asset directly into the web root.

## Authoring and verification workflow

1. Create `cases/<slug>/case.yml` plus real `assets/`, `i18n/`, and `tests/` directories.
2. Start with the complete minimal case and keep `investigation@1` in `use`.
3. Add entities and canonical private truth.
4. Add opening evidence, then one legal unlock route at a time.
5. Add deductions and immediately add an explicit `tests/<scenario-id>.yml`
   route for each critical proof.
6. Add reactions/deadlines only after the basic solution path passes.
7. Add local assets last, compute SHA-256 over the final exact bytes, and keep
   raw locators private.
8. Run all checks before considering the package playable.

```bash
npm run cases:test
npm run cases:compile
npm run check
```

To compile and test a selected package directly:

```bash
npx tsx scripts/compile-cases.ts cases/my-case
npx tsx src/simulator/cli.ts cases/my-case
```

Both CLIs also accept a parent directory such as `cases/` and discover every
immediate package child without hard-coded slugs.

Successful package compilation verifies YAML, semantic references, structural
reachability, capability locks, local asset identity/digests, and
public/private sanitization. Only external detective scenarios demonstrate
that selected routes execute through legal public commands; the suite also
verifies that event-only replay recreates the same authoritative state.
