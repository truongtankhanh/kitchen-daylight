# 0002. Quality tooling: tests, lint, hooks, commits, secrets

Status: **accepted** (P0-T3, proposed 2026-11-03; accepted by the owner 2026-11-03, Phase 0 gate). Chooses the tools that P1-T3, P1-T4, P4-T1, P4-T6, P4-T7, P5-T1 and P5-T2 install. Versions are not pinned here: each tool is pinned by the task that adds it and recorded in [0001](0001-toolchain-versions.md).

## Context

- testing-strategy asks for "one runner for the repo, chosen at scaffolding". Its working rules say the owner runs tests, CI runs everything, runners are throttled and never default to watch mode, and no script launches the full suite implicitly.
- scaffold-plan section 2 asks for ESLint and Prettier with one shared config, and lint on staged files through a pre-commit hook. Section 8 asks for `lint`, `typecheck`, `test` and `openapi:check` on every pull request.
- ADR-0010 (public repositories, control 1): secrets never enter the repository, secret scanning with push protection is on, and a secret scanner runs in CI and in the pre-commit hook. Control 4: fork pull requests get no secrets and there is no `pull_request_target` on untrusted code, so every check below must work without secrets.
- The pins of 0001 bind every choice: Node 26.13.0, pnpm 12.16.1, NestJS 12, Angular 22.2, Expo SDK 58, ESLint 10.14.0, Prettier 3.9.10.

## Evidence

Every claim about a tool is either read from the source in this list on 2026-11-03 (cited as [S#]) or marked **not verified**. Registry reads are `npm view` (read-only). Versions marked "observed" are not pins.

| ID | Source |
|---|---|
| S1 | https://docs.nestjs.com/fundamentals/testing: "Newly generated projects use Vitest by default." |
| S2 | `@nestjs/schematics` 12.0.12 `dist/lib/application/schema.json` and `files/ts-esm/package.json.template` (via https://cdn.jsdelivr.net/npm/@nestjs/schematics@12.0.12/): module type `esm` is the default and labelled "with vitest" (`"test": "vitest run"`, `vitest ^4.1.2`); `cjs` is labelled "with jest" |
| S3 | https://angular.dev/guide/testing: "New projects include `vitest` and `jsdom` by default"; `ng test` watches by default; `--no-watch --no-progress` for a single run; `CI=true` gives a single run |
| S4 | https://docs.expo.dev/develop/unit-testing/: Jest with the `jest-expo` preset, installed with `npx expo install jest-expo jest @types/jest --dev`; recommended script `jest --watchAll`; a pnpm-specific `transformIgnorePatterns`; Vitest is not mentioned |
| S5 | `bundledNativeModules.json` of expo 58.0.22: `jest-expo ~58.0.13`; registry: `jest-expo` 58.0.13 peer `jest ^29.0.0 \|\| ^30.0.0` |
| S6 | https://vitest.dev/guide/cli: `vitest` watches in development and runs once in CI or a non-TTY; `vitest run` is a single run; `--maxWorkers <workers>` (number or percentage); `--no-file-parallelism` |
| S7 | https://jestjs.io/docs/cli: `--maxWorkers=<num>\|<string>` (for example `50%`); `--watch` and `--watchAll` are opt-in flags; `--ci` fails on a new snapshot instead of writing it |
| S8 | Registry: `@angular/build` 22.2.5 peer `vitest ^4.0.8 \|\| ^5.0.0`; vitest 5.1.0 (observed) engines `node ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; jest 30.5.2 (observed) engines `node ... >=24.0.0` |
| S9 | https://typicode.github.io/husky/how-to.html: `HUSKY=0` disables hooks for a command and is the documented way to skip install on CI; hook scripts "need to be POSIX compliant"; Husky does not install into a parent directory. Registry: husky 9.1.7 (observed), no dependencies' install script needed (it is wired through the root `prepare` script) |
| S10 | https://lefthook.dev/ and https://lefthook.dev/usage/envs/LEFTHOOK: hooks in `.git/hooks/` call `lefthook run <hook>`; `LEFTHOOK=0 git ...` disables it. Registry: lefthook 2.2.2 (observed) ships per-platform binaries as `optionalDependencies` and has a `postinstall` script |
| S11 | https://github.com/toplenboren/simple-git-hooks: config in `package.json`; "you should manually run `npx simple-git-hooks` every time you change a command"; `SKIP_SIMPLE_GIT_HOOKS` and `SKIP_INSTALL_SIMPLE_GIT_HOOKS`. Registry: simple-git-hooks 2.14.0 (observed) has a `postinstall` script |
| S12 | https://pnpm.io/settings/build: dependency build scripts not listed in `allowBuilds` are disallowed; `strictDepBuilds` defaults to `true` and makes install exit non-zero on unreviewed build scripts. Whether the root project's own `prepare` is affected is **not stated** |
| S13 | https://github.com/lint-staged/lint-staged: install at the monorepo root, one config per package, the closest config wins; staged paths passed as absolute arguments; `--concurrent false\|true\|<n>` (default `true`). Registry: lint-staged 17.6.0 (observed) engines `node >=22.22.1` |
| S14 | https://commitlint.js.org/reference/configuration.html: `@commitlint/config-conventional` is the official shareable config. Registry README of `@commitlint/config-pnpm-scopes` 21.2.2 (observed): "enforcing pnpm workspaces names as scopes" via `scope-enum`. `@commitlint/cli` 21.2.4 (observed) engines `node >=22.12.0` |
| S15 | https://github.com/gitleaks/gitleaks (README): "Gitleaks is feature complete … Future releases will be security patches only", the author moves to Betterleaks; installed by Homebrew, Docker, Go or release binaries; `[[allowlists]]` replaced `[allowlist]` in v8.25.0, with `regexes`, `paths`, `stopwords`, `condition`, `regexTarget`; `extend.useDefault = true`; inline `gitleaks:allow`. Latest release v8.30.1, 2026-03-21 (GitHub API) |
| S16 | https://github.com/gitleaks/gitleaks/blob/master/.pre-commit-hooks.yaml: `gitleaks git --pre-commit --redact --staged --verbose` |
| S17 | https://github.com/gitleaks/gitleaks-action: v3 (Node 24 runtime); no license key for repositories of a personal account, a free key for organisations |
| S18 | https://github.com/betterleaks/betterleaks: maintained by the Gitleaks authors; "Until the first stable v2 release, package managers and the Docker `latest` tag may still provide v1"; no GitHub Action and no `.gitleaks.toml` compatibility statement on the page |
| S19 | https://eslint.org/docs/latest/rules/no-restricted-imports (v10.14.0 listed): `patterns` with `group` or `regex` and a custom `message`; `allowTypeImports` for TypeScript. Matching of relative paths such as `../../apps/x` is **not stated** |
| S20 | Registry: eslint-plugin-boundaries 7.4.1 and dependency-cruiser 18.7.2 (observed); their behaviour was **not verified** beyond the package descriptions |
| S21 | https://pnpm.io/cli/audit: `--audit-level` (default `low`), `--prod`, `--dev`, `--ignore-unfixable`; exit code 1 when an advisory at or above the level remains |
| S22 | https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review and https://github.com/actions/dependency-review-action: the action "is available for … Public repositories"; v5 (Node 24); `fail-on-severity` (default `low`), `fail-on-scopes` (default `runtime`), `comment-summary-in-pr`, `allow-licenses`; needs the dependency graph |
| S23 | https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security: code scanning and secret scanning are enabled by default on public repositories; push protection is available on public repositories. **Conflict:** its table marks dependency review "No" for public repositories without GitHub Code Security, against S22 |
| S24 | https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/set-code-scanning-merge-protection: ruleset thresholds "Security alert severity" (None to All, including "High or higher") and "Alert severity". Availability on public repositories is **not stated** |

## Options, criteria, choice and reason per concern

### 1. Test runner

| Option | Serves api | Serves admin | Serves mobile | Notes |
|---|---|---|---|---|
| One runner: Vitest everywhere | yes, NestJS 12 default [S1, S2] | yes, Angular 22 default [S3, S8] | **no**: Expo documents only Jest + `jest-expo` [S4]; a Vitest setup for React Native is **not verified** | |
| One runner: Jest everywhere | yes, the `cjs` template [S2] | Angular's Jest support is **not verified** for 22.2; Vitest is the default [S3] | yes [S4, S5] | goes against two framework defaults |
| **One runner per app** | Vitest | Vitest | Jest + `jest-expo` | follows every framework's documented default |

**Choice: Vitest for `apps/api`, `apps/admin`, `packages/*` and `tools/*`; Jest with the `jest-expo` preset (`~58.0.13` per SDK 58 [S5]) for `apps/mobile`.** One Vitest version for the whole workspace, inside the `@angular/build` peer range `^4.0.8 || ^5.0.0` [S8], pinned in P4-T1 and recorded in 0001.

**Reason:** a single runner cannot serve all three apps without leaving a documented default, and the mobile case has no documented alternative. Two runners, each the framework default, is the least custom setup.

Coupling to flag for P0-T6: Vitest is the default of the NestJS **ESM** template [S2]. If P0-T6 chooses CommonJS for `apps/api`, the runner for the API is revisited in a new record (Vitest with CommonJS Nest is **not verified**).

**Sentence that amends testing-strategy** (Levels table, Unit row, "Tool" cell). The owner applies it in the design workspace:

> Vitest for `apps/api`, `apps/admin`, `packages/*` and `tools/*` (the NestJS 12 and Angular 22 default); Jest with the `jest-expo` preset for `apps/mobile` (the only runner Expo documents). One runner per app, decided in decision record 0002 of the monorepo.

The "API integration" row keeps "Same runner", which now means Vitest.

**Throttle flags** (written into each package's `test` script):

| Where | Command | Why |
|---|---|---|
| `apps/api`, `packages/*`, `tools/*` (unit) | `vitest run --maxWorkers=2` | single run, never watch [S6] |
| `apps/api` (integration, real PostgreSQL) | `vitest run --maxWorkers=1 --no-file-parallelism` | one shared database; no parallel files [S6] |
| `apps/admin` | `ng test --no-watch --no-progress` plus `maxWorkers: 2` in the Vitest runner config | `ng test` watches by default [S3]; passing the worker cap through `runnerConfig` was **not verified** in P0-T3; P4-T6 wired it (`runnerConfig: vitest.config.mts` with `maxWorkers: 2`) and `ng test` passes, but whether the cap reaches the workers was not measured |
| `apps/mobile` | `jest --maxWorkers=2` (and `--ci` in CI) | Expo's suggested `jest --watchAll` [S4] is rejected; Jest does not watch without the flag [S7] |
| Root | `turbo run test --concurrency=2` | Turborepo cap from testing-strategy rule 3 |

**No implicit run:** no `prepare`, `postinstall`, `pre*`/`post*` script, hook, `build`, `lint` or `dev` script starts a test run. Test runs only start from an explicit `test*` command, typed by the owner or run by CI. No `test:watch` script is added to any package.

### 2. Lint and format

| Option | Criteria: tools added, one shared config, ESLint 10 | Verdict |
|---|---|---|
| **ESLint flat config + Prettier as a separate tool** | ESLint 10.14.0 and Prettier 3.9.10 are already pinned (0001) | chosen |
| ESLint running Prettier as a rule (`eslint-plugin-prettier`) | one more plugin; formatting reported as lint errors; behaviour **not verified** | rejected |

**Choice:** `packages/eslint-config` (P1-T3) exports the shared flat config. Apps add their own layer in P4-T1, P4-T6 and P4-T7, such as Angular template rules and Expo rules (the plugins are chosen and verified there). The Prettier config lives in the same package. CI runs `eslint` with `--max-warnings 0` and `prettier --check`.

**lint-staged scope** (root config [S13], run with `--concurrent false` to stay light):

- `*.{ts,tsx,js,mjs,cjs}`: `eslint --fix --max-warnings 0`, then `prettier --write`
- `*.{json,md,yml,yaml,css,scss,html}`: `prettier --write`
- Type checking, builds and tests never run in the hook (they are `typecheck`, `build` and `test` in CI).

### 3. Git hooks

| Criterion | husky | lefthook | simple-git-hooks |
|---|---|---|---|
| No new global tool for a new developer | yes: dev dependency, wired by the root `prepare` script [S9] | yes: npm package with platform binaries in `optionalDependencies` [S10] | yes: dev dependency [S11] |
| Works with pnpm 12 defaults | no dependency build script to approve (whether pnpm 12 runs the root `prepare` is **not verified** [S12], to confirm in P1-T4) | its `postinstall` must be listed in `allowBuilds`, or install fails under `strictDepBuilds` [S10, S12] | same as lefthook [S11, S12] |
| bash 3.2 (macOS default) | hooks are POSIX shell scripts [S9]; running under bash 3.2 is **not verified** but POSIX `sh` needs no bash feature | the hook stub calls a Go binary [S10]; bash 3.2 is irrelevant once the binary runs (**not verified**) | the generated hook's shell is **not stated** [S11] |
| Skip in CI | `HUSKY=0`, documented for CI [S9] | `LEFTHOOK=0` [S10] | `SKIP_INSTALL_SIMPLE_GIT_HOOKS` [S11] |
| Config change takes effect | immediately (hooks are files in the repository) | **not verified** | requires re-running `npx simple-git-hooks` [S11] |

**Choice: husky.** **Reason:** it needs no native binary and no `allowBuilds` exception under pnpm 12. Its hooks are plain POSIX scripts in the repository, so they are reviewable and work with bash 3.2, and skipping in CI is documented. CI sets `HUSKY=0`.

**Hooks (P1-T4):**

- `pre-commit`: the secret scan (section 5), then `lint-staged`.
- `commit-msg`: `commitlint --edit "$1"`.
- No `pre-push` hook. **Hooks never run the test suite, a type check or a build.**

### 4. Commit convention

| Option | Verdict |
|---|---|
| **Conventional Commits checked by commitlint in `commit-msg`**, extending `@commitlint/config-conventional` and `@commitlint/config-pnpm-scopes` [S14] | chosen |
| Conventional Commits by convention only, no check | rejected: nothing catches a wrong type or scope before it lands on `main` |

**Choice:** the types of `config-conventional`. Scopes are the pnpm workspace names (`config-pnpm-scopes`) plus a short fixed list for non-package work: `deps`, `ci`, `docs`, `repo`. Exactly how the plugin derives a scope from a scoped package name is **not verified**, to confirm in P1-T4.

The scope is optional. The existing history uses scope-less messages such as `chore: …`, and this record does not make them invalid. **No ticket id is required.** CI checks the commit messages of a pull request with the same config (P5-T1).

### 5. Secret scanning

| Option | Criteria: stable today, pre-commit staged scan, CI without a key, allowlist by value | Verdict |
|---|---|---|
| **gitleaks 8.30.1** | stable, security patches only [S15]; `gitleaks git --pre-commit --redact --staged` [S16]; `[[allowlists]]` with `regexes` and `stopwords` [S15] | chosen |
| Betterleaks | same authors, but v2 is not yet stable and there is no GitHub Action [S18] | rejected for now (upgrade trigger below) |
| GitHub secret scanning and push protection only | GitHub side only; no local check before a push to a public repository | kept **in addition**, not instead (ADR-0010) |
| TruffleHog | **not verified** | not evaluated further |

**Choice:**

- **Pre-commit:** `gitleaks git --pre-commit --redact --staged --verbose` [S16], from the developer's own gitleaks 8.30.1 (installed with Homebrew or the release binary [S15]). Do not install the unofficial npm package named `gitleaks` (registry: an unrelated 1.0.0 package).
- **Binary missing on a developer machine: block.** The hook exits non-zero and prints how to install gitleaks. **Reason:** both repositories are public, so a pushed commit is published at once. Push protection only knows provider patterns, so the local hook is the last check before exposure. The only bypass is git's own `--no-verify`, and the CI scan still runs.
- **CI (P5-T2):** a blocking job runs the same pinned gitleaks 8.30.1 binary, downloaded from the release page with its checksum verified, over the pull request's commits. The binary is run directly, not through `gitleaks-action`: one version shared with the developers' machines, no license dependence if the repository moves to an organisation [S17], and no secret needed for fork pull requests.
- **Allowlist (`.gitleaks.toml`, P1-T4):** `[extend] useDefault = true` [S15], plus one `[[allowlists]]` entry matching **values**, not paths: `regexes` for the local placeholder prefix `CHANGE_ME_LOCAL` and the reserved example domains (`example.com`, `kitchendaylight.example`, ADR-0010 control 2). Allowlisting `.env.example` by path is forbidden, because a real secret pasted into it must still be caught. Any other placeholder pattern is added in P1-T4 with the file that uses it. Inline `gitleaks:allow` [S15] needs a reviewer's approval in the pull request.
- **Upgrade trigger:** a stable Betterleaks v2 release with a documented staged-scan command and a migration path for `.gitleaks.toml` leads to a new record.

### 6. Dependency boundary enforcement

| Option | Tools added | Verdict |
|---|---|---|
| **ESLint `no-restricted-imports` (core rule)** with `patterns` and `message` in each package's config layer [S19] | none (ESLint is pinned) | chosen |
| eslint-plugin-boundaries | one plugin plus an import resolver; **not verified** [S20] | rejected: more tools for the same rules |
| dependency-cruiser | a second analysis tool with its own config and CI step; **not verified** [S20] | rejected |

**Choice:** the rules of scaffold-plan section 1 are expressed as `no-restricted-imports` patterns in the config layer of each package:

- apps never import from each other;
- `packages/contracts` has no runtime import of `apps/api` (`allowTypeImports` stays `false` unless decided otherwise in P0-T4);
- `tools/*` import no app;
- nothing imports from `designs/`.

Both workspace package names and relative paths are restricted. Whether `patterns` match relative specifiers such as `../../apps/api/...` is **not stated** in the docs [S19], so the fixtures below prove it.

**Fixture that must fail (P1-T3):** each rule gets a deliberate violation in `packages/eslint-config/fixtures/boundaries/`. The normal `lint` ignores this folder. A `lint:boundaries` script runs ESLint on the fixtures with `--no-ignore --format json` and succeeds only if every fixture reports `no-restricted-imports`. The script fails if any fixture lints clean, so a rule that silently stops matching breaks CI. This is a lint run, not a test run, so it is allowed in the hook-free CI `lint` job and locally.

### 7. Dependency audit in CI

| Check | When | Blocking? | Reason |
|---|---|---|---|
| gitleaks (section 5) | every pull request and push to `main` | **blocking** | ADR-0010 control 1 |
| `actions/dependency-review-action@v5` [S22] | pull requests that change the lockfile | **blocking** at `fail-on-severity: high`, `fail-on-scopes: runtime, development` (dev tools run in CI and on the owner's machine) | judges only what the pull request adds, so it never fails on unrelated advisories |
| CodeQL default setup (JavaScript/TypeScript and Actions) | pull requests and `main` | **blocking for new alerts** at security severity "High or higher" through code scanning merge protection in the `main` ruleset [S24] (set in P5-T6); lower severities advisory | code scanning is enabled by default on public repositories [S23] |
| `pnpm audit --audit-level=high` [S21] | weekly schedule and pull requests, as a non-required job | **advisory** | a new advisory in an existing dependency would otherwise block unrelated pull requests; Dependabot security updates (P5-T2) fix them |

**Open point, to confirm in P5-T2:** S22 and S23 conflict on whether dependency review is available on a public repository without GitHub Code Security. If the first run of the action is refused, `pnpm audit --audit-level=high` becomes the **blocking** check for pull requests that change the lockfile, and this record is updated.

## Consequences

- P1-T3 adds `packages/eslint-config` (ESLint flat config, Prettier config, boundary fixtures and `lint:boundaries`).
- P1-T4 adds husky, lint-staged, commitlint (`config-conventional` and `config-pnpm-scopes`), the gitleaks hook and `.gitleaks.toml`, and pins each tool in 0001.
- P4-T1, P4-T6 and P4-T7 add the runners with the throttle flags above. P4-T6 confirms how the worker cap reaches Vitest under `ng test`.
- P5-T1 runs `lint`, `typecheck`, `test` and the commit message check with `HUSKY=0`. P5-T2 adds gitleaks, dependency review, CodeQL and `pnpm audit`. P5-T6 sets the merge protection.
- The testing-strategy sentence above is applied by the owner in the design workspace.
- Revisit triggers: P0-T6 chooses CommonJS for the API; Expo documents Vitest; Betterleaks v2 is stable; dependency review is refused on this repository.

## Implementation notes (Phase 1, 2026-11-03)

Recorded at the Phase 1 review, before this record was accepted. The choices above stand; these notes say how they were built.

- **Boundary enforcement (section 6).** Package-name imports use `no-restricted-imports` as chosen. Relative paths are checked by a local rule, `kd/no-relative-boundary`, defined inside `@kd/eslint-config` (no new tool or dependency): it resolves the specifier against the linted file and compares the result with the forbidden folders. A regex on the specifier, the first implementation, missed short paths between sibling folders such as `../../api/src/main.js` from `apps/admin/src`.
- **The boundary script** is not called `lint:boundaries`. The package `lint` script of `@kd/eslint-config` runs `eslint`, then `check-fixtures` (import fixtures) and `check-manifests` (manifest fixtures and every workspace `package.json`), so `turbo run lint` and the CI `lint` job always exercise them. Details in [0003](0003-workspace-packages-and-boundaries.md#implementation-notes-phase-1-2026-11-03).
- **Hook installation.** The root `prepare` script runs `.husky/install.mjs`: it skips without failing when husky is not installed (for example `pnpm install --prod`), and husky itself skips when `HUSKY=0`. Verified in the Phase 1 smoke sheet, step 7.
- **Commit scopes (section 4).** `config-pnpm-scopes` yields the workspace names without the `@kd/` prefix; its extra `global` scope is removed. Checked on 2026-11-03: `chore(eslint-config): …` and `docs(repo): …` pass, an unknown scope fails.
