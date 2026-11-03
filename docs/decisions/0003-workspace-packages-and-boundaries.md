# 0003. Workspace packages and dependency boundaries

Status: **proposed** (P0-T4, 2026-11-03). Fixes package names, how shared packages are built and consumed, the pnpm and TypeScript settings, the Turborepo task graph and the import rules. P1-T1 (root workspace), P1-T2 (`@kd/tsconfig`), P1-T3 (`@kd/eslint-config` and the boundary fixtures) and every later package follow it. Closes scaffold-plan open item 4.

## Context

- scaffold-plan section 1 fixes the layout: `apps/{api,admin,mobile}`, `packages/{contracts,design-tokens,i18n,tsconfig,eslint-config}`, `tools/{seed,seed-data}`, `infra/`, `docs/`, `designs/`. Its dependency rules are: apps never import from each other; `packages/contracts` has no runtime dependency on `apps/api`; `tools/*` reach the database through their own thin SQL unless a shared package is extracted later; nothing imports from `designs/`.
- scaffold-plan section 3: `apps/api` produces the OpenAPI document, `openapi:generate` writes the committed snapshot `packages/contracts/openapi.json`, and `openapi:check` fails CI on drift. The typed client and the hand-written realtime event types live in `packages/contracts` and are consumed by both clients and by the API gateway.
- ADR-0010 (Context table): `contracts` changes together with the API; tokens, i18n, tsconfig and eslint-config are shared by the three apps; `tools/seed` "uses the API's database objects".
- 0001 pins Node 26.13.0, pnpm 12.16.1, Turborepo 2.11.10, TypeScript 6.0.3, NestJS 12, Angular 22.2, Expo SDK 58 (Metro 0.87.1). 0002 chose ESLint `no-restricted-imports` with failing fixtures for the boundaries, and Vitest/Jest runners with their throttle flags.
- The three consumers of shared code differ: NestJS runs on Node after `nest build`; Angular builds with its esbuild-based builder; Expo bundles with Metro.

## Evidence

Read on 2026-11-03. Claims are cited as [S#] or marked **not verified**.

| ID | Source |
|---|---|
| S1 | https://turborepo.dev/docs/core-concepts/internal-packages: Just-in-Time packages need a consumer that compiles TypeScript, "cannot use the `compilerOptions.paths` configuration", and "Turborepo cannot cache a build for a Just-in-Time Package". Compiled packages build themselves, "should use `tsc`", and their outputs are cached once listed in `outputs` |
| S2 | https://turborepo.dev/docs/guides/tools/typescript: "We don't recommend using TypeScript Project References"; `paths` "can cause failed compilation"; use Node.js subpath imports (`#*`) instead; a shared tsconfig package that every `tsconfig.json` extends |
| S3 | https://turborepo.dev/docs/reference/configuration: `$TURBO_ROOT$` makes a glob relative to the repository root; `$TURBO_DEFAULT$` restores the default inputs; `concurrency` key (default `"10"`); outputs are relative to the package and "Turborepo will not cache outputs that escape the repository"; `globalDependencies`; `dependsOn` with `^` and `package#task`; `cache: false` |
| S4 | https://turborepo.dev/docs/crafting-your-repository/configuring-tasks: root tasks registered as `//#task` in the root `turbo.json`; `cache: false` for side-effect tasks such as deployments |
| S5 | https://turborepo.dev/docs/crafting-your-repository/caching: package hash inputs are the package's `turbo.json`, lockfile changes that affect it, its `package.json` and its source-controlled files. Whether an internal dependency with no task changes a dependant's hash is **not stated** |
| S6 | https://nodejs.org/api/typescript.html: "Node.js refuses to handle TypeScript files inside folders under a `node_modules` path"; `tsconfig` `paths` are unsupported; enums, parameter properties and decorators are unsupported by type stripping |
| S7 | https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require: `require()` of a synchronous ES module is on by default and "no longer experimental" since v25.4.0; a module graph with top-level `await` throws `ERR_REQUIRE_ASYNC_MODULE` |
| S8 | https://metrobundler.dev/docs/package-exports: package `exports` support "has been enabled by default in Metro since 0.82"; Metro asserts `import` or `require`, and `react-native` on Android and iOS. Handling of the `types` condition is **not stated** |
| S9 | https://docs.expo.dev/guides/monorepos/: "Starting with SDK 54, Expo supports isolated dependencies" (pnpm's default); `nodeLinker: hoisted` is the fallback "if isolated installs cause problems"; "Expo configures Metro automatically for monorepos" from SDK 52 (remove manual `watchFolders` and resolver overrides); duplicate React or React Native versions are not supported, found with `pnpm why --depth=10 react-native`; autolinking module resolution is automatic for monorepo apps from SDK 55. Consuming TypeScript source from workspace packages is **not stated** |
| S10 | https://pnpm.io/catalogs: `catalog` (default) and `catalogs` (named) in `pnpm-workspace.yaml`; the `catalog:` protocol; `catalogMode` `strict`, `prefer`, `manual` (default) |
| S11 | https://pnpm.io/settings/build: `onlyBuiltDependencies` was **removed in pnpm v11 and replaced by `allowBuilds`** (a map of package to `true`/`false`); unlisted packages are disallowed; `strictDepBuilds` defaults to `true` |
| S12 | https://pnpm.io/workspaces: with the `workspace:` protocol "pnpm will refuse to resolve to anything other than a local workspace package"; `workspace:*` references the local package |
| S13 | Registry, 2026-11-03: `npm view` of `@kd/tsconfig`, `@kd/eslint-config`, `@kd/design-tokens`, `@kd/i18n`, `@kd/contracts`, `@kd/api`, `@kd/admin`, `@kd/mobile`, `@kd/seed` and `@kd/seed-data` returns 404, and a registry search finds no package under `@kd/`. Who owns the `@kd` scope on npm is **not verified** |
| S14 | 0002, S4: Expo documents a pnpm-specific `transformIgnorePatterns` for `jest-expo` |

## 1. Package names

**Choice: the scope `@kd/`, every package `"private": true`, never published.**

| Folder | Name |
|---|---|
| `packages/tsconfig` | `@kd/tsconfig` |
| `packages/eslint-config` | `@kd/eslint-config` |
| `packages/design-tokens` | `@kd/design-tokens` |
| `packages/i18n` | `@kd/i18n` |
| `packages/contracts` | `@kd/contracts` |
| `apps/api` | `@kd/api` |
| `apps/admin` | `@kd/admin` |
| `apps/mobile` | `@kd/mobile` |
| `tools/seed` | `@kd/seed` (same rule, added in its slice) |
| `tools/seed-data` | `@kd/seed-data` (same rule, added in P3-T3) |

Rule: the name is `@kd/` followed by the folder name.

**Reason:** the names are short and read well in imports and commit scopes. 0002 takes the commit scopes from the workspace names; the exact scope derivation is confirmed in P1-T4.

Dependency confusion is closed two ways. `"private": true` prevents publishing, and the `workspace:` protocol never falls back to the registry [S12]. None of these names exists on npm today [S13], but the protection does not depend on that.

## 2. How shared packages are consumed

| Criterion | Compiled packages (`dist` + `exports` + `types`, `^build`) | TypeScript source consumed directly (Just-in-Time) |
|---|---|---|
| NestJS on Node | works: plain JavaScript under `node_modules` | **fails at runtime**: Node refuses TypeScript under `node_modules` [S6], and a workspace package is linked there. `nest build` compiling a sibling's source is **not verified** |
| Angular esbuild builder | works: plain ESM JavaScript (**not verified** against the Angular docs, confirmed in P4-T6) | compiling TypeScript from a linked package is **not verified** |
| Metro (Expo SDK 58) | works: `exports` is on by default since Metro 0.82 [S8]; SDK 58 ships Metro 0.87.1 (0001) | Metro transpiles with Babel; source from workspace packages is **not stated** by Expo [S9] |
| Turborepo cache | `build` outputs cached [S1] | "cannot cache a build" [S1] |
| `paths` aliases | not needed | not allowed [S1] |

**Choice: compiled packages.** Each runtime package builds itself with `tsc` into `dist/` [S1]. Consumers depend on `^build`.

**Reason:** it is the only option that works for all three consumers without depending on an unverified behaviour, and the build is cacheable.

**Export shape** for a runtime package (written in P3-T1 to P3-T4):

```json
{
  "name": "@kd/contracts",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./openapi.json": "./openapi.json"
  },
  "scripts": { "build": "tsc -p tsconfig.build.json", "lint": "eslint .", "typecheck": "tsc --noEmit", "test": "vitest run --maxWorkers=2" }
}
```

`types` points at `dist/*.d.ts`, not at `src`, so a consumer's `tsc` never pulls a sibling's source into its own program. The `types` condition comes first in each entry.

**Module format per package:**

| Package | Format | Build | Note |
|---|---|---|---|
| `@kd/tsconfig` | JSON only | none | `exports` maps the JSON configs |
| `@kd/eslint-config` | ESM JavaScript (flat config, Prettier config) | none | plain `.js` with `"type": "module"`, so ESLint needs no TypeScript config loader |
| `@kd/design-tokens` | ESM + generated CSS file | `tsc` and the token generator | `./css` subpath for the CSS variables |
| `@kd/i18n` | ESM | `tsc` | |
| `@kd/contracts` | ESM | `tsc` | `./openapi.json` subpath; client generator chosen in P0-T5 |
| `@kd/seed`, `@kd/seed-data` | ESM | `tsc` | run with `node dist/...` |
| `@kd/api` | decided in P0-T6 (ESM or CommonJS) | `nest build` | consumes ESM packages either way: `require()` of synchronous ESM is stable on Node 26 [S7] |
| `@kd/admin`, `@kd/mobile` | framework default | `ng build`, none in CI for mobile (EAS) | |

**Rule that keeps CommonJS consumers working:** shared packages contain no top-level `await` [S7]. This is checked by the API build in P4-T1.

## 3. pnpm settings (written in P1-T1)

- **Workspace globs:** `apps/*`, `packages/*`, `tools/*`. `infra/`, `docs/` and `designs/` are not workspace packages.
- **Internal dependencies:** always `workspace:*` [S12].
- **One place per version:**
  - Every external package used by two or more workspace packages comes from the default `catalog` in `pnpm-workspace.yaml` [S10]. Examples are `typescript`, `eslint`, `prettier`, `vitest`, `rxjs` and `@types/node`.
  - A package used by one workspace package only is pinned exactly in that package.
  - Every version comes from 0001. Exact versions only, in the catalog too.
  - `catalogMode` stays `manual` (the default) [S10]; review enforces the rule.
- **Expo-managed packages** (`expo`, `react`, `react-native`, `expo-router`, `jest-expo` and the rest of `bundledNativeModules.json`) stay pinned exactly in `apps/mobile/package.json`, because `expo install --fix` maintains them as one SDK set (0001). Whether `expo install` handles `catalog:` entries is **not verified**.
- **No `shamefully-hoist`, no `nodeLinker: hoisted`:** pnpm's isolated layout stays the default.
- **Lifecycle-script allowlist:** pnpm 12 has no `onlyBuiltDependencies`, because it was replaced by `allowBuilds` in pnpm 11 [S11]. `allowBuilds` starts empty. Each `true` entry is added by the task that needs it, with a one-line reason in the pull request; denied packages are listed as `false`. `strictDepBuilds` stays `true`, so an unreviewed build script fails the install [S11]. Husky needs no entry (0002).

**Expo and Metro exception: none planned.** SDK 58 is past SDK 54, which supports pnpm's isolated installs [S9], and Metro is configured automatically for monorepos [S9]. `apps/mobile` must not add manual `watchFolders` or resolver overrides [S9].

If P4-T7 finds that an isolated install breaks the mobile build, the fallback is scoped as narrowly as possible. First, hoist only the failing packages with pnpm's hoist patterns (behaviour **not verified**, confirmed in P4-T7). Only if that fails, use `nodeLinker: hoisted` [S9], which applies to the whole workspace and therefore needs a new record.

Two other mobile-only settings:
- Duplicate React or React Native versions are checked with `pnpm why --depth=10 react-native` in P4-T7 [S9]. An `overrides` entry is added only if a duplicate is found.
- The pnpm-specific `transformIgnorePatterns` for `jest-expo` [S14] lives in `apps/mobile` only.

## 4. TypeScript

- **No project references** [S2]: each package has its own `tsconfig.json` extending a base from `@kd/tsconfig` [S2]. Turborepo orders the builds.
- **No `paths` aliases** [S1, S2, S6]: packages are reached by their names through `exports`. If a package wants short internal imports, it uses Node.js subpath imports (`#*`) pointing at its own `src` or `dist` [S2].
- **Bases in `@kd/tsconfig` (P1-T2):**
  - `base.json`: strict, `target` and `lib` for Node 26.
  - `library.json`: `module`/`moduleResolution` `nodenext`, `declaration`, `outDir: dist`, for compiled packages.
  - Per-app bases for Nest, Angular and Expo, which extend their framework's own defaults where the framework requires them.

## 5. Turborepo task graph (written in P1-T1)

Root `turbo.json`, shape only (exact globs are written in P1-T1):

| Task | `dependsOn` | Inputs | Outputs | Cache |
|---|---|---|---|---|
| `build` | `^build` | `$TURBO_DEFAULT$`, minus test files; plus the `@kd/tsconfig` configs (via `$TURBO_ROOT$`) | `dist/**` | yes |
| `lint` | `^build` (typed rules need the dependencies' `.d.ts`) | `$TURBO_DEFAULT$` plus the `@kd/eslint-config` and `@kd/tsconfig` files | none | yes |
| `typecheck` | `^build` | `$TURBO_DEFAULT$` plus the `@kd/tsconfig` files | none | yes |
| `test` | `^build` | `$TURBO_DEFAULT$` plus the `@kd/tsconfig` files | `coverage/**` | yes |
| `format:check` | none | `$TURBO_DEFAULT$` plus the Prettier config in `@kd/eslint-config` | none | yes |
| `//#format:check` (root task [S4]) | none | root files only (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `*.md`, `.github/**`) | none | yes |
| `@kd/api#openapi:generate` | `build` | `$TURBO_DEFAULT$` of `apps/api` | `$TURBO_ROOT$/packages/contracts/openapi.json` [S3] | yes |
| `@kd/api#openapi:check` | `build` | `$TURBO_DEFAULT$` of `apps/api`, plus `$TURBO_ROOT$/packages/contracts/openapi.json` and the last released snapshot (a committed file, P0-T5) | none | yes |

- **Default concurrency:** `"concurrency": "2"` in `turbo.json` [S3], so a bare `turbo run` is already throttled (testing-strategy rule 3). `--concurrency=2` stays in the root scripts as well, to be explicit.
- **Config packages in the hash.** `@kd/tsconfig` and `@kd/eslint-config` have no `build` task, and the docs do not say whether a change in them reaches their dependants' hash [S5]. So their files are listed as explicit `$TURBO_ROOT$` inputs of the tasks that read them.
- **The snapshot is committed and generated explicitly.** `@kd/contracts#build` reads the committed snapshot. It does **not** depend on `@kd/api#openapi:generate`, because that would form a cycle: `api#build` → `^build` → `contracts#build` → `api#openapi:generate` → `api#build`. The developer runs `openapi:generate` and commits the result, and `openapi:check` in CI catches a forgotten run.
- **Tasks that must never be cached: none of the seven.** Each one is a pure function of its declared inputs: no network, no database and no clock. Two rules keep it that way:
  1. Generating the OpenAPI document must boot the API without a database or network connection (checked in P0-T5 and P4-T8).
  2. The "last released snapshot" that `openapi:check` compares against is a committed file, not a git tag lookup.

  Tasks outside this list that do have side effects are `cache: false` [S4]: the persistent `dev:*` tasks, a future integration-test task that runs against the Docker repository's database (whose state is not a declared input), and deploys.

## 6. Dependency rules

### Matrix (row imports column)

`R` = runtime import allowed, `T` = type-only import allowed, `C` = config only (`extends` or a config import, as a dev dependency), `✗` = forbidden.

| Importer ↓ / Imported → | api | admin | mobile | contracts | design-tokens | i18n | tsconfig, eslint-config | seed, seed-data | `designs/` |
|---|---|---|---|---|---|---|---|---|---|
| `@kd/api` | | ✗ | ✗ | R (realtime event types and shared constants; never the generated client) | ✗ | R | C | ✗ | ✗ |
| `@kd/admin` | ✗ | | ✗ | R | R | R | C | ✗ | ✗ |
| `@kd/mobile` | ✗ | ✗ | | R | R | R | C | ✗ | ✗ |
| `@kd/contracts` | ✗ (not even `T`) | ✗ | ✗ | | ✗ | ✗ | C | ✗ | ✗ |
| `@kd/design-tokens` | ✗ | ✗ | ✗ | ✗ | | ✗ | C | ✗ | ✗ |
| `@kd/i18n` | ✗ | ✗ | ✗ | ✗ | ✗ | | C | ✗ | ✗ |
| `@kd/seed` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | C | R (`seed-data` fixtures) | ✗ |
| `@kd/seed-data` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | C | | ✗ |
| `@kd/tsconfig`, `@kd/eslint-config` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | (eslint-config may extend tsconfig) | ✗ | ✗ |

Shared packages stay leaves: no shared package imports another, apart from the config packages. Any new edge needs a change to this record.

**Scaffold-plan open item 4: closed.** `tools/seed` reaches the database through its own thin SQL with `pg` (pinned in 0001) and imports nothing from `apps/api`. **Reason:**
- The schema's source of truth is the hand-written SQL migrations (ADR-0001), not the entities, so plain SQL against that schema loses nothing.
- Sharing entities would need a new package extracted from the API, which no slice needs yet.
- A tool importing an app would break the "nothing imports an app" rule.

If seed and API later need the same database code, a new `packages/` module is extracted and this matrix gets a new row and a new record.

### Expressing the rules so they can be tested

Each `✗` cell is checked twice:

1. **Import level (ESLint, 0002).** The importer's ESLint layer has a `no-restricted-imports` entry with `patterns`. Each entry forbids both the package name (for example `@kd/api`, `@kd/api/*`) and the relative path into the folder (a `regex` such as `^(\.\./)+apps/api(/|$)`). It also forbids any specifier that reaches `designs/`. The `T` versus `R` difference uses `allowTypeImports`; it is `false` everywhere today because no cell is `T`. The `@kd/api` → `@kd/contracts` cell forbids the generated-client subpath (exact name in P0-T5).
2. **Manifest level (no new tool).** The `lint:boundaries` script of `@kd/eslint-config` (P1-T3) reads every workspace `package.json` and fails if a `@kd/*` dependency is not an allowed cell of this matrix. This catches an edge before any import is written, and it keeps the Turborepo graph equal to the matrix.

### Failing fixtures (P1-T3)

`packages/eslint-config/fixtures/boundaries/` holds one folder per importer, each linted with that importer's real config layer:

- **Negative fixtures:** for every `✗` cell, one file with the package-name import and one with the relative-path import, for example `admin/imports-api-by-name.ts` with `import '@kd/api'` and `admin/imports-api-by-path.ts` with `import '../../../../apps/api/src/main'`. Plus one file per importer that reaches `designs/`.
- **Positive fixtures:** for every `R` cell, one allowed import that must lint clean. This catches patterns that are too broad.
- **Manifest fixtures:** a `package.json` with a forbidden `@kd/*` dependency, which the manifest check must reject.

The normal `lint` ignores the fixtures folder. `lint:boundaries` runs ESLint on it with `--no-ignore --format json` and passes only if every negative fixture reports `no-restricted-imports`, every positive fixture reports nothing, and every manifest fixture is rejected. Any other result fails, so a rule that silently stops matching breaks CI.

## 7. Folder rule for a new package

- **Where:**
  - `apps/<name>` for something deployed or shipped (a server, a web app, a mobile app).
  - `packages/<name>` for code or configuration shared by two or more workspace packages.
  - `tools/<name>` for a command-line tool run by a person or by CI.
  - Nothing is added anywhere else.
- **Its `package.json` must contain:**
  - `"name": "@kd/<folder>"`, `"private": true`, `"version": "0.0.0"`.
  - Libraries and tools: `"type": "module"` and an `exports` map with `types` first and `default` pointing into `dist/` (section 2).
  - Apps keep their framework's module setting and have no `exports`: nothing may import an app.
  - Internal dependencies as `workspace:*`, shared external dependencies as `catalog:`, other external dependencies pinned exactly from 0001.
  - `@kd/tsconfig` and `@kd/eslint-config` as `workspace:*` dev dependencies.
  - The scripts that apply, from `build`, `lint`, `typecheck`, `test` and `format:check`, with the throttle flags of 0002. Never a `watch`, `prepare` or `postinstall` script that runs a build or a test.
- **Alongside the package:**
  - A row and a column in the dependency matrix.
  - Its `no-restricted-imports` layer and its fixtures.
  - Its tasks covered by the root `turbo.json` (a package `turbo.json` only if it needs other outputs).

## Consequences

- P1-T1 writes `pnpm-workspace.yaml` (globs, catalog, `allowBuilds`), the root `package.json` and `turbo.json` from sections 3 and 5. P1-T2 writes the `@kd/tsconfig` bases. P1-T3 writes the boundary layers, the manifest check and the fixtures of section 6.
- P0-T5 must keep OpenAPI generation free of a database and network connection, name the generated-client subpath, and choose where the last released snapshot lives.
- P0-T6 chooses the API module system. ESM-only shared packages work with either choice [S7].
- P4-T7 confirms that Expo SDK 58 works with pnpm's isolated layout, and that there is no duplicate React or React Native.
- Revisit triggers: a slice needs shared database code (new package and new record); the mobile app needs hoisting; a framework stops consuming compiled ESM packages.
