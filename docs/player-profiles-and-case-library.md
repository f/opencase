# Local player profiles and case library

The desktop supports multiple local detective profiles, per-profile progress,
Turkish and English interface copy, and case installation from public URLs.
These are application and trusted-host features. They do not add profile,
GitHub, import, window, or language-switch concepts to the case engine.

This is a local workspace system, not authentication. Profiles are available
only in the current browser and there is no password, cloud sync, or account
recovery.

## Use the desktop

Start the trusted local host and open <http://127.0.0.1:4173>:

```bash
npm install
npm run dev
```

Open **Settings** from the desktop menu:

1. **Profile** creates, renames, selects, or deletes a local player. The final
   profile cannot be deleted.
2. **Language** selects Turkish or English for the active profile.
3. **Case Library** selects an installed case or imports a new one.
4. **Storage** shows the active case state and offers an explicit restart.

Selecting another profile switches to that profile's preferred language,
selected case, save slot, desktop layout, case board, and other scoped UI
sidecars. It does not copy progress from the previous profile. Selecting a case
resumes that profile's valid save for the exact case build; if no save exists,
the opening call starts a new session.

Language changes affect application labels and request the matching localized
case presentation. Case locale negotiation tries the exact locale, then its
base language, then the case's `case.locale` default. Changing presentation
copy does not append an event or modify a save.

## What is stored

| Owner | Local data | Scope |
| --- | --- | --- |
| Profile application | Profile ID, display name, `tr`/`en` preference, selected case | Browser-local profile record |
| Trusted host | Opaque `kernel-save@1` bytes | Exact profile ID + case ID + case version + kernel digest |
| Shell applications | Window layout, case-board positions/links, pending presentation state | Exact profile and case/run where applicable |
| Trusted case library | Immutable package bundles, safe source metadata, verification result | Shared by the profiles in this local desktop |
| Case package | Story, assets, translations, authored tests | Portable package, independent of every player |

The local host keeps private saves, verified asset cache, and installed packages
below `.detective-data/`. This directory is ignored by Git and denied to the
Vite file server. Do not publish it: saves can reconstruct private case state.

The profile list itself uses the schema-tagged browser key
`dedektif:player-profiles:v1`. Invalid stored profile data fails closed and
recovers to one default profile. Clearing browser storage removes that local
profile list, but does not erase host-side saves or installed packages. Likewise,
deleting a profile record is not a data-erasure operation for orphaned host
files.

Restart is narrower: it deletes only the active profile's save for the selected
case build, clears that run's presentation sidecars, and returns to the opening
call. It does not delete another profile's progress or uninstall the case.

## Import a complete GitHub package

Use GitHub import when a case has assets, translations, or authored tests. The
URL must point to a public repository, a case folder, or its `case.yml`:

```text
https://github.com/owner/repository
https://github.com/owner/repository/tree/main/path/to/my-case
https://github.com/owner/repository/blob/main/path/to/my-case/case.yml
```

The selected folder must contain the normal package shape:

```text
my-case/
  case.yml
  assets/
  i18n/
  tests/
```

For a repository URL, the importer accepts `case.yml` at the root or in exactly
one immediate child directory. If the repository contains several cases, use a
specific folder URL.

The host resolves the branch or tag to an exact 40-character commit, fetches
only `case.yml`, `assets/`, `i18n/`, and `tests/` through GitHub APIs, verifies
Git blob identities, compiles the package, and runs its authored detective
tests. A successful package is promoted to an immutable content-addressed
bundle. Importing the same bytes again reuses the installation; using the same
case ID and version for different bytes is rejected.

GitHub packages are limited to 1,024 entries, 64 MiB per file, and 256 MiB in
total. Symlinks, submodules, Git LFS pointer files, unsafe paths, colliding
names, invalid media bytes, and failed tests are rejected. Package-local assets
are the portable choice; remote or provider assets still need a separately
configured trusted delivery adapter.

## Import one direct YAML file

Direct YAML is for small, self-contained cases without external files. Provide
a public HTTPS URL whose response is one UTF-8 YAML document, up to 2 MiB.

A direct YAML case:

- must use literal player-facing text, not `$text` translation references;
- must not declare assets or attach asset IDs to evidence;
- may not use YAML aliases, explicit tags, custom tags, or multiple documents;
- must still satisfy the complete structural and semantic case compiler.

The host creates empty `assets/` and `tests/` directories plus an empty default
locale catalog so the result can enter the normal package pipeline. Use a
GitHub package as soon as the case needs images, audio, multiple languages, or
authored route tests.

## Import network boundary

Both modes accept only public HTTPS URLs. URLs with credentials, fragments,
custom ports, or local/private/link-local destinations are rejected. The host
checks DNS before each request and redirect, caps redirects, enforces request
timeouts and byte limits, and rejects compressed responses. Query parameters
are removed from stored display URLs so tokens cannot appear in library
metadata. Private GitHub repositories are not supported by this local flow.

An imported package is data, not a plugin. It cannot ship JavaScript, add an
engine operator, or register a new capability. Unknown capability vocabulary
is a compile error.

## Verification levels

The library shows what was actually checked:

| Label | Meaning |
| --- | --- |
| **Built in** | Shipped with the repository and covered by the repository's normal content gate. |
| **Conformance passed** | A complete GitHub package compiled successfully and all included `tests/*.yml` scenarios plus package audits passed. The UI may show the authored test count. |
| **Compiler and smoke** | A direct YAML file compiled and produced a safe active opening session. It has no authored scenario coverage. |

Verification is compatibility and reproducibility evidence. It is not a claim
that the story is factually true, that every route is well designed, or that a
third-party author is trusted. `compiler-and-smoke` is intentionally weaker
than `conformance-passed`.

## Strict ownership boundary

The layers may communicate only through their public contracts:

```text
profile + Settings UI
        │ locale, selected case, opaque profile/save ID
        ▼
trusted host ── import/compile/register ──► trusted compiled case
        │                                     │
        │ public manifest + projection        │ generic kernel IR
        ▼                                     ▼
detective shell ◄──── command results ─── case engine
```

- The **case** owns authored story data, supported locales, package assets, and
  private test scenarios. It does not know who plays it or which app renders it.
- The **engine** owns generic commands, events, rules, clocks, evidence state,
  deductions, outcomes, and deterministic saves. It receives an opaque
  `saveId`; it does not know that the value represents a profile.
- The **trusted host** owns URL fetching, import limits, private package paths,
  package verification, save storage, and authorized asset delivery.
- The **application** owns profiles, language choice, case selection, import
  progress/errors, restart orchestration, and UI-only sidecars.
- The **shell** renders sanitized manifests and runtime projections. It never
  loads `case.yml`, private IR, authored tests, filesystem paths, or truth.

See the [engine contract](engine-contract.md#application-session-boundary),
[case localization contract](case-i18n.md), and
[desktop shell contract](../src/shell/README.md#state-boundary) for the
normative boundaries behind this flow.
