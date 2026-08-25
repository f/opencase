# Development and deployment

This document covers local setup, repository checks, generated files, and the
static deployment. For the runtime design, read [Architecture](architecture.md).

## Requirements

- A current Node.js release
- `npm`

The GitHub Pages workflow currently uses Node.js 22.

## Local development

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4173>. Vite first generates the built-in static case
files, then serves the same browser application produced by the release build.
Gameplay does not use a local API.

## Checks

Run the complete gate:

```bash
npm run check
```

The gate has two parts:

- `npm run engine:check` runs case-independent tests and type checking.
- `npm run content:check` checks engine/case decoupling, validates the AI
  authoring skill, compiles and tests examples and built-in cases, generates
  public data, and creates the production build.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Generate static case output and start the desktop |
| `npm test` | Run compiler, kernel, runtime, persistence, simulator, and package tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:host` | Test the optional legacy server-host adapters |
| `npm run cases:test` | Discover built-in packages and run their private scenarios |
| `npm run cases:compile` | Compile every built-in package |
| `npm run examples:test` | Run every teaching-case scenario |
| `npm run examples:compile` | Compile teaching packages into `.build/examples/` |
| `npm run skill:validate` | Validate the AI skill metadata |
| `npm run generate:public` | Generate public manifests, static runtime bundles, and local assets |
| `npm run typecheck` | Build the TypeScript project graph without starting the app |
| `npm run build` | Generate public data, type-check, and build `dist/` |
| `npm run engine:decoupling` | Reject case-owned content in engine code |
| `npm run engine:check` | Run the case-independent engine gate |
| `npm run content:check` | Run the content and integration gate |
| `npm run check` | Run all required checks |

## Work on one case

The package tools accept an exact package directory or a parent whose immediate
children are packages.

```bash
# One package
npx tsx scripts/compile-cases.ts cases/my-first-case
npx tsx src/simulator/cli.ts cases/my-first-case

# Every built-in package
npm run cases:compile
npm run cases:test
```

Discovery checks only immediate child directories with a regular `case.yml`,
sorts them deterministically, and ignores unrelated siblings. A new package
joins the gate without adding its slug to TypeScript or `package.json`.

Read the [case YAML reference](case-yaml-reference.md) and
[detective test reference](detective-tests.md) before changing a package.

## Generated output

`npm run cases:compile` writes debug artifacts to `.build/cases/`:

```text
.build/cases/<slug>.source.ir.json   # complete private source IR
.build/cases/<slug>.kernel.ir.json   # final deterministic kernel IR
.build/cases/<slug>.public.json      # sanitized bootstrap manifest
```

`.build/` is not copied to the web root.

`public/generated/` is replaced atomically after every built-in package passes.
It contains:

- the relative case index;
- localized public bootstrap manifests;
- complete static runtime bundles;
- asset delivery manifests;
- content-addressed local assets used during play.

Runtime bundles and later-game assets are inspectable and can reveal answers.
Do not apply a private-data search intended for public manifests to a runtime
bundle and expect it to pass.

`dist/` is the complete static production application.

## Static build

```bash
npm ci
npm run check
```

Vite uses a relative base. Generated indexes, manifests, runtime bundles, and
asset URLs are also relative to the files that reference them. The same `dist/`
can run at `/`, a repository path such as `/opencase/`, or another static mount.

The app needs no `/api/*` rewrite, Node.js production process, database, or
secret environment variable for normal gameplay.

## GitHub Pages

`.github/workflows/deploy-pages.yml` runs on pushes to `main` and can also be
started manually. It:

1. installs dependencies with `npm ci`;
2. runs `npm run check`;
3. uploads `dist/` as the Pages artifact;
4. deploys through GitHub Pages.

The repository must use GitHub Actions as its Pages source. Pages availability
for a private repository depends on the owner's GitHub plan and repository
settings.

The live target is [opencase.computer](https://opencase.computer).

## Browser imports

GitHub imports use the public GitHub REST API and immutable
`raw.githubusercontent.com` URLs. Direct YAML and remote authored assets work
only when the origin permits browser CORS.

The static application has no GitHub token, so GitHub's unauthenticated API
rate limit applies. An import can require another attempt after the reported
reset time. This does not affect built-in play after its static files load.

Read [Profiles and case library](player-profiles-and-case-library.md) for URL
formats, security limits, IndexedDB storage, and verification labels.

## Repository map

```text
cases/                       Built-in portable case packages
examples/cases/              Tiny teaching cases and walkthroughs
skills/write-detective-case/ AI case-authoring workflow
schema/                      JSON Schema for authored YAML and case tests
docs/                        Architecture, authoring, test, and deployment docs
scripts/                     Compiler and public-generation CLIs
src/capabilities/            Trusted vocabulary and capability digest locks
src/compiler/                YAML validation, semantic compiler, private/public IR
src/kernel/                  Event kernel, assertions, rules, and schedules
src/case-runtime/            Investigation adapter, projection, and controller
src/persistence/             Checksummed event-log saves and strict restore
src/simulator/               Case-test loader, runner, and replay checks
src/case-package/            Package and asset validation and public builds
src/browser-host/            Static runtimes, imports, saves, and IndexedDB library
src/shell/                   Desktop/window manager and player applications
src/settings/                Profiles, language, case library, and storage UI
server/                      Optional server-host compatibility implementations
```

## Contribution checklist

1. Keep case content in a package and reusable mechanics in generic engine
   vocabulary.
2. Add the smallest focused unit tests and package scenarios.
3. Run `npm run check`.
4. Review generated `*.public.json` files for hidden names, truth, locators,
   conditions, and outcome logic.
5. Treat a schema, capability digest, case version, or save change as a
   compatibility decision and document it.

opencase is licensed under `GPL-2.0-or-later`. Contributions are accepted under
the same license. Third-party assets keep the licenses documented in
[Third-party assets](THIRD_PARTY_ASSETS.md).
