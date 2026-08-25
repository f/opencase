# Case localization (`i18n/`)

Every portable case package has a real, non-symbolic-link `i18n/` directory:

```text
my-case/
  case.yml
  assets/
  i18n/
    en.yml
    tr.yml
  tests/
```

`case.locale` selects the required default catalog. A case whose default is
`en` must contain `i18n/en.yml`, even when the source currently uses only
direct strings; in that case `messages: {}` is valid.

## References in `case.yml`

Use the canonical `$text` form:

```yaml
case:
  title: {$text: case.title}
  locale: en
  synopsis: {$text: case.synopsis}

opening:
  call:
    from: client
    text: {$text: opening.call}

places:
  records_room: {$text: places.records_room.name}
  lobby: {name: {$text: places.lobby.name}, floor: ground}

cast:
  witness:
    name: Deniz Kaya
    role: {$text: cast.witness.role}
    contact_source: {$text: cast.witness.contact_source}

conversations:
  witness:
    initial: refusing
    channels: {interview: actor, apologize: target}
    allow_while_unavailable: [apologize]
    states:
      refusing:
        can_talk: false
        reason: {$text: conversations.witness.refusing.reason}
      available: {can_talk: true}

affordances:
  call_witness:
    label: {$text: affordances.call_witness.label}
    result: {$text: affordances.call_witness.result}
    risk: consequential
    confirmation: {$text: affordances.call_witness.confirmation}
    surface: phone
    initial: offered
    action: {action: interview, actor: witness}
  find_witness:
    label: {$text: affordances.find_witness.label}
    result: {$text: affordances.find_witness.result}
    surface: inbox
    initial: offered
    action: {action: locate-contact, target: witness}
    interaction:
      kind: async-message
      channel: forensics
      request: {$text: affordances.find_witness.request}

evidence:
  witness_note:
    tool: document
    presentation:
      title: {$text: evidence.witness_note.title}
      description: {$text: evidence.witness_note.description}
      findings:
        signed_by: {$text: evidence.witness_note.findings.signed_by}
    at: start
    reports: {signed_by: witness}

deadlines:
  archive_closes:
    label: {$text: deadlines.archive_closes.label}
    clock: case-time
    after: 20m
    offline: pause
    do: [{emit: archive-closed}]

outcomes:
  solved:
    title: {$text: outcomes.solved.title}
    body: {$text: outcomes.solved.body}
    priority: 100

assessment:
  max_score: 100
  bands:
    - {min_score: 0, label: {$text: assessment.bands.complete}}
  categories:
    reasoning:
      label: {$text: assessment.categories.reasoning}
      criteria:
        prove_route:
          points: 100
          when: {supported: route_proved}
          met: {$text: assessment.criteria.prove_route.met}
          missed: {$text: assessment.criteria.prove_route.missed}
```

`{$t: case.title}` is accepted as a compatibility alias and normalized to
`$text` by the compiler. New cases should use `$text`.

The first version deliberately allows references only in:

- `case.title`;
- `case.synopsis`;
- `opening.call.text`;
- `places.<place-id>` or the `name` / `display_name` field of an object-form place;
- `cast.<actor-id>.name`, `display_name`, `role`, `status`, `contact_source`, or `pronouns`;
- `conversations.<actor-id>.states.<state-id>.reason`;
- `evidence.<evidence-id>.presentation.title`;
- `evidence.<evidence-id>.presentation.description`;
- `evidence.<evidence-id>.presentation.findings.<report-field>`;
- `affordances.<affordance-id>.label`, `result`, or `confirmation`;
- `affordances.<affordance-id>.interaction.request`;
- `deadlines.<deadline-id>.label`;
- `assessment.bands.<index>.label`;
- `assessment.categories.<category-id>.label`;
- `assessment.categories.<category-id>.criteria.<criterion-id>.met` or `missed`;
- `outcomes.<outcome-id>.title` or `body`.

Do not put translation references in evidence reports, deductions, truth,
actions, IDs, non-display entity fields, asset metadata, or tests. Those values
can affect rules and proof equality. The compiler rejects such a reference with
`E_I18N_REFERENCE_CONTEXT`. Place and cast IDs stay stable across locales;
only their allowed player-facing presentation fields are resolved. Thing
labels and localized asset variants are not part of the v0.1 contract yet.

Direct strings remain valid. A direct string is identical in every locale.

## Catalog format

The filename, declared locale, case identity, and case version are bound:

```yaml
schema: case-i18n/v0.1
case: {id: examples.sample-case, version: 0.1.0}
locale: en
messages:
  case.title: "The Sample Case"
  case.synopsis: "A short, player-safe setup."
  opening.call: "Please inspect the first record."
  places.records_room.name: "Records room"
  places.lobby.name: "Lobby"
  cast.witness.role: "Independent witness"
  cast.witness.contact_source: "Forensics directory response"
  conversations.witness.refusing.reason: "The witness will not speak yet."
  evidence.witness_note.title: "Witness note"
  evidence.witness_note.description: "A signed note found in the archive."
  evidence.witness_note.findings.signed_by: "The witness signed the note."
  affordances.call_witness.label: "Call the witness"
  affordances.call_witness.result: "The witness answered."
  affordances.call_witness.confirmation: "Call the witness now?"
  affordances.find_witness.request: "Can you verify the witness's current contact record?"
  deadlines.archive_closes.label: "Archive closes"
  outcomes.solved.title: "Case solved"
  outcomes.solved.body: "The evidence supports your conclusion."
```

Keys are flat, dotted identifiers. Values are nonempty literal strings. v0.1
does not interpolate placeholders or evaluate markup. A message such as
`"Found {count}"` is delivered literally, braces included.

The default catalog must define every `$text` key referenced by `case.yml`.
Other catalogs may be partial. An absent secondary translation falls back to
the default message for that key.

## Locale selection

The host uses this deterministic order:

1. exact authored locale, such as `en-US`;
2. its base language, such as `en`, when that catalog exists;
3. `case.locale`.

Only authored catalogs receive generated locale manifests. A requested
`en-GB` locale can therefore select the authored `en` manifest, but the build
does not invent an `en-GB` file.

The local desktop requests the active player's preferred locale (`tr` or `en`)
and applies the same fallback order. That preference also selects application
interface copy, but interface labels do not belong in the case catalog. A case
may support only one of those languages; in that situation its authored copy
falls back to `case.locale` while the surrounding desktop stays in the player's
chosen interface language. Profile and language behavior is documented in
[Local player profiles and case library](player-profiles-and-case-library.md).

## Public and private boundaries

The build writes:

```text
<slug>.public.json             # default-locale compatibility path
<slug>.<locale>.public.json    # one per authored catalog
```

Each file contains resolved strings only, including its player-safe `places`
label map. It never contains a whole catalog,
`messages` mapping, private outcome copy, or unresolved `$text` object.
`cases.json` advertises the available locale URLs and their individual
manifest digests. The detective desktop negotiates the active profile's
preferred locale and loads the matching manifest.

Evidence presentation, affordance copy, deadline labels, and outcome copy stay
outside authoritative state and saves. The kernel stores only stable `$text`
keys. A host creates a presentation catalog with
`createCasePresentationCatalog(...)` and passes it to
`projectCaseState(session, presentation)`.

Evidence titles and descriptions resolve when a card is granted; its finding
messages resolve only after observation. Affordance risk and confirmation copy
resolve while the move is offered, but result copy resolves only in completed
action or deduction history. Deadline labels resolve only for authored
schedules present in runtime state. Outcome titles and bodies remain private
until an outcome is actually reached. Without a supplied catalog, each
translated field projects its matching key property instead of default catalog
copy.

Conversation reasons follow the same runtime-only presentation boundary. The
complete conversation graph is private and is not added to a localized public
manifest. When the current state belongs to a public actor, the runtime
projection includes the resolved `reason` only if the host supplies a
presentation catalog; otherwise it includes `reasonKey`. A direct-string
reason is projected unchanged. Protected and hidden actors are omitted
entirely, including their state and reason.

## Integrity and save compatibility

- Translation catalog content contributes to `packageDigest`.
- Each localized public manifest has its own digest.
- No translation message is placed in private IR, kernel IR, events, or saves.
- Editing default or secondary translation copy does **not** change
  `kernelDigest` and does not invalidate an existing save.
- Changing a `$text` key in `case.yml` changes IR and the kernel/save lock.
- External `tests/` remain outside both playable and localization digests.

## Loader limits and security

`i18n/` accepts only flat `<locale>.yml` regular files. It rejects symlinks,
subdirectories, unexpected files, invalid UTF-8, duplicate YAML keys, aliases,
explicit YAML tags, custom tags, and multi-document YAML. Current limits are
32 catalogs, 256 KiB per catalog, 4 MiB total, 2,048 messages per catalog, and
16 KiB per message.
