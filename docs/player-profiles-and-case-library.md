# Local player profiles and static case library

The detective desktop supports multiple local player profiles, per-profile
progress, Turkish and English interface copy, and case installation from public
URLs. The production game is a fully static browser application. It does not
need a gameplay API, a local Node host, `.detective-data/`, or a server-side
database.

Profiles, imports, language selection, and windows are application concepts.
They do not add profile, GitHub, import, storage, or UI vocabulary to the case
engine. A case remains a portable data package, and the engine continues to run
generic kernel IR and generic commands.

This is local browser state, not authentication. There is no password, cloud
sync, multi-device account, or automatic recovery.

## Use the desktop

Install dependencies and start Vite:

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4173>, then open **Settings** from the desktop menu:

1. **Profile** creates, renames, selects, or deletes a local player. The final
   profile cannot be deleted.
2. **Language** selects Turkish or English for the active profile.
3. **Case Library** selects a built-in or imported case and can import a new
   one.
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

## Static distribution and spoilers

Built-in cases are compiled during `npm run generate:public`. Each case emits:

- localized, sanitized public bootstrap manifests;
- one integrity-bound static runtime bundle containing the complete kernel IR
  and presentation catalogs;
- content-addressed copies of every package-local asset needed during play.

The runtime bundle contains the answers and full case mechanics. A player who
opens developer tools or reads the deployed JSON can inspect them. That is an
intentional tradeoff for a game that can run entirely on GitHub Pages.

The UI boundary still matters. The browser session adapter keeps the active
`CaseSessionController` in its own closure, sends only generic commands to the
engine, and gives React only `case-runtime/public-v1` projections. Normal play
therefore reveals contacts, evidence, findings, deductions, deadlines, and
outcomes through the authored rules. This prevents application components from
accidentally bypassing the state machine, but it is not a security boundary
against inspection of downloaded static files.

## What is stored

| Owner | Browser data | Exact scope |
| --- | --- | --- |
| Profile application | Profile ID, display name, `tr`/`en` preference, selected case | Browser-local profile record |
| Browser session adapter | Opaque serialized `kernel-save@1` string | Profile/save ID + case ID + case version + kernel IR digest |
| Shell applications | Window layout, case-board positions and links, pending presentation state | Profile and case/run where applicable |
| Browser case library | Imported compiled runtime bundles, localized manifests, source metadata, verification result | Immutable case ID + version + content identity |
| Browser asset library | Verified imported asset blobs | Imported package identity + case digest + asset ID |
| Static deployment | Built-in manifests, runtime bundles, and content-addressed assets | Versioned files in the deployed `dist/` tree |
| Case package | Story, assets, translations, authored tests | Portable author-owned package, independent of every player |

The profile list and UI sidecars use namespaced browser storage. Engine progress
is written through the generic `CaseSaveStorage` port to `localStorage` as one
opaque save string. The application does not store a second evidence array,
projection snapshot, private runtime object, or mutable copy of engine state.

Imported packages and their asset blobs use IndexedDB because they can be much
larger than profile settings or saves. Asset blobs are exposed to the running
desktop through temporary browser object URLs only after the current projection
contains the matching asset handle.

Clearing site data removes profiles, saves, imported cases, imported assets,
and UI sidecars. Deleting a profile through Settings removes the profile record
and its actively managed presentation state; it should not be treated as a
general forensic erasure guarantee for browser storage. There is no
`.detective-data/` folder to back up or clean in the static architecture.

Restart is narrow: it deletes only the active profile's save for the selected
case ID, case version, and kernel digest, clears that run's presentation
sidecars, and returns to the opening call. It does not delete another profile's
progress or uninstall an imported case.

## Built-in case loading

The browser loads `generated/cases.json`, chooses the localized public manifest,
and fetches the selected case's static runtime bundle. Every URL in the index
is relative to the index itself. Asset URLs are relative to the runtime bundle.
This keeps the same build working at an origin root, a GitHub Pages repository
subpath, or another static mount point.

The browser checks the selected case/build identity and the runtime bundle's
canonical digest before creating a session. The bundle then supplies generic
kernel IR and presentations to the browser session adapter. There are no
case-specific imports or case IDs in the engine or application code.

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

The import runs in the browser:

1. It uses GitHub's public REST API to resolve the authored branch, tag, or
   commit to an exact 40-character commit ID.
2. It lists only `case.yml`, `assets/`, `i18n/`, and `tests/` below the selected
   package folder and rejects unsafe paths, symlinks, submodules, name
   collisions, and Git LFS pointer files.
3. It downloads files from immutable `raw.githubusercontent.com` URLs pinned to
   that commit and verifies each file against GitHub's Git blob SHA-1.
4. It parses and compiles the package with the normal engine capability locks,
   verifies declared asset SHA-256 digests and media bytes, and runs the
   included detective scenarios plus the contact-discovery audit.
5. It stores the compiled bundle, manifests, verification record, and verified
   asset blobs in IndexedDB.

Importing the same case ID and version with different compiled content is
rejected. Imported data cannot ship JavaScript, add an engine operator, or
register a new capability. Unknown capability vocabulary remains a compile
error.

The current limits are 1,024 package entries, 64 MiB per downloaded file, and
256 MiB for the package. Browser storage quota may impose a smaller practical
limit.

### GitHub network limits

The static app has no GitHub token. It uses GitHub's unauthenticated public API,
so GitHub's rate limit applies per public IP. The import UI reports a rate-limit
failure and, when GitHub supplies it, the reset time. Waiting for the reset or
importing less often is the recovery path. Private repositories are not
supported.

GitHub's REST API and raw-content hosts normally allow browser cross-origin
requests, but extensions, corporate networks, regional filtering, or a provider
change can still block them. A static app cannot proxy around that failure.

### Assets in GitHub packages

Package-local assets are the recommended portable form. A GitHub case may also
declare an integrity-pinned public HTTPS asset. The asset host must allow a
browser CORS request; the importer downloads the bytes and verifies their
declared digest before installation.

Provider/reference assets are unsupported in the static browser host because
they require a credentialed or custom server adapter. Built-in static generation
is stricter than browser import and accepts only package-local assets.

## Import one direct YAML file

Direct YAML is for small, self-contained cases without external files. Provide
a public HTTPS URL whose response is one UTF-8 YAML document, up to 2 MiB. The
origin must allow cross-origin browser reads.

A direct YAML case:

- must use literal player-facing text, not `$text` translation references;
- must not declare assets or attach asset IDs to evidence;
- may not use YAML aliases, explicit tags, custom tags, or multiple documents;
- must still satisfy the complete structural and semantic case compiler.

The browser creates empty `assets/` and `tests/` directories plus an empty
default-locale catalog in memory so the source can enter the normal compiler
pipeline. It then starts a safe opening session as a smoke check and stores the
compiled result in IndexedDB. Use a GitHub package as soon as a case needs
images, audio, multiple languages, or authored route tests.

## Browser network boundary

Both import modes accept public HTTPS URLs only. URLs with credentials,
fragments, non-HTTPS protocols, explicit non-443 ports, obvious local hostnames,
or literal private/link-local addresses are rejected. Requests omit credentials
and referrer data, enforce time and byte limits, and validate the final response
URL.

These checks do not turn a browser into a trusted download proxy. The app cannot
perform server-side DNS resolution on every redirect, hide an authorization
token, or read a response whose server does not allow CORS. A hostname that
resolves to an unusual destination is still subject to the browser and network's
own rules. Imports should therefore be treated as untrusted data and remain
inside the compiler, size, media, and digest checks.

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

The layers communicate only through public contracts:

```text
static files or IndexedDB package
              │ complete generic kernel IR + presentations
              ▼
browser application host ── generic command ──► case engine
       │             ▲                              │
       │ opaque save │                              │ projection
       ▼             │                              ▼
localStorage     CaseSaveStorage              detective shell

Settings/profile UI ── locale, selected case, opaque profile/save ID
```

- The **case** owns authored story data, supported locales, package assets, and
  private test scenarios. It does not know who plays it or which app renders it.
- The **engine** owns generic commands, events, rules, clocks, evidence state,
  deductions, outcomes, and deterministic saves. It receives an opaque
  `saveId`; it does not know that the value represents a profile.
- The **browser application host** owns static/IndexedDB runtime loading,
  controller lifetime, autosave, exact save-slot mapping, URL import,
  verification, and projected asset resolution. It has no case-specific route
  logic.
- The **application** owns profiles, language choice, case selection, import
  progress and errors, restart orchestration, and UI-only sidecars.
- The **shell** renders sanitized manifests and runtime projections. It does not
  parse `case.yml`, inspect the kernel IR, run authored tests, or infer hidden
  state from a runtime bundle.

The static bundle is physically readable by the player, but that does not merge
these software layers. The engine and application stay case-agnostic, and cases
stay replaceable data packages.

See the [engine contract](engine-contract.md#application-session-boundary),
[case localization contract](case-i18n.md), and
[desktop shell contract](../src/shell/README.md#state-boundary) for the
normative boundaries behind this flow.

## Static build and GitHub Pages

```bash
npm ci
npm run check
```

The production `dist/` directory is self-contained. Vite uses a relative base,
and generated index, manifest, runtime, and asset links remain relative. The
same output works below a repository path such as
`https://owner.github.io/opencase/` without hard-coded root URLs. The live
deployment is [opencase.computer](https://opencase.computer), and the repository
is [f/opencase](https://github.com/f/opencase).

The repository's `.github/workflows/deploy-pages.yml` workflow runs the complete
check, uploads `dist/`, and deploys it with GitHub Pages on a push to `main` or a
manual dispatch. GitHub Pages must be configured to use GitHub Actions. A
private repository also needs a GitHub plan and repository policy that allow
Pages.
