# CLAUDE.md

Repository facts for contributors and coding agents. The architecture behind them
is in [docs/architecture/foundation.md](docs/architecture/foundation.md); the
quick start is in [README.md](README.md). When this file and a decision record
disagree, the decision record wins: fix this file.

## Layout

- `apps/api` (`@kd/api`): NestJS 12, ESM, `nest build` with `tsc`. Source in
  `src/` (`main.ts`, `cli.ts`, `app.module.ts`, `configure-app.ts`, `config/`,
  `database/`, `health/`, `openapi/`, `cli/`), SQL migrations in `migrations/`.
- `apps/admin` (`@kd/admin`): Angular 22 with PrimeNG 22; source in `src/app/`.
- `apps/mobile` (`@kd/mobile`): Expo SDK 58 with Expo Router; routes in `app/`,
  other code in `src/`; configuration in `app.config.ts`.
- `packages/contracts`, `packages/design-tokens`, `packages/i18n`: compiled ESM
  libraries, consumed through `dist/` (`^build`).
- `packages/tsconfig`, `packages/eslint-config`: configuration only.
- `tools/seed-data`: provinces and wards fixtures. `tools/seed` is added by the
  seed slice.
- `scripts/`: shell scripts for the local stack and the OpenAPI breaking check.
- `docs/`, `designs/`: documentation and reference frames. Nothing imports from
  `designs/`.

## Commands

Light commands an agent may run:

- `pnpm --filter <package> lint` and `pnpm --filter <package> typecheck`, or
  `pnpm turbo run lint typecheck --concurrency=2` for the workspace.
- `pnpm --filter <package> build`, for the one package being changed (not
  `@kd/admin`: see below). On a clone where the shared packages have no `dist/`
  yet, use `pnpm --filter "<package>..." build`, which builds its workspace
  dependencies first.
- `pnpm --filter @kd/eslint-config check-fixtures` (boundary fixtures).
- `pnpm --filter @kd/design-tokens tokens:check`, `pnpm openapi:check`.
- `shellcheck` on `scripts/*.sh` and `.husky/*`, `actionlint` on
  `.github/workflows/*.yml`, `hadolint` on `apps/api/Dockerfile`.

Commands only the owner runs:

- `pnpm test` and every package `test` script.
- The watchers and long-running servers: `pnpm dev:api` (`nest start --watch`),
  `pnpm dev:admin` (`ng serve`), `pnpm dev:mobile` (`expo start`).
- `docker`, `scripts/bootstrap.sh`, `pnpm dev:infra*` (they start or stop
  containers), `ng build` (also through `pnpm --filter @kd/admin build`), any
  `expo` command.

Every runner is throttled: Turborepo `--concurrency=2` (also the default in
`turbo.json`), Vitest `--maxWorkers=2` (`--maxWorkers=1 --no-file-parallelism`
for the API integration tests), Jest `--maxWorkers=2`. Never add a watch mode,
`test:watch`, `prepare` or `postinstall` script that runs a build or a test.

## Naming

- Packages: `@kd/<folder>`, `"private": true`, version `0.0.0`.
- Internal dependencies `workspace:*`; an external package used by two or more
  packages comes from the `catalog` in `pnpm-workspace.yaml`; every other one is
  pinned exactly in its package. Versions only from
  [decision 0001](docs/decisions/0001-toolchain-versions.md): no `^`, `~` or
  `latest`. The Expo SDK set stays pinned in `apps/mobile` and moves with
  `expo install --fix`.
- API module files: `modules/<feature>/<feature>.module.ts`,
  `<feature>.controller.ts` (customer routes), `admin-<feature>.controller.ts`
  (`/admin` routes), `<feature>.service.ts`, `dto/<name>.dto.ts` (the only files
  the Swagger plugin reads), `entities/<name>.entity.ts`, `ports/<name>.port.ts`,
  `adapters/<adapter>/<name>.<adapter>.adapter.ts`
  ([decision 0005](docs/decisions/0005-api-foundation-conventions.md),
  section 6).
- Migrations: `apps/api/migrations/NNNN_description.sql` (four digits,
  `snake_case`), never edited after merge.
- Routes: feature endpoints under `/api/v1`; `/api/health`, `/api/docs` and
  `/socket.io/` are outside `v1`.
- Environment names: the table of decision 0005, section 2.

## Test file conventions

| Package                 | Runner                                                          | Files                                                                                                                      |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`              | Vitest (`vitest run --maxWorkers=2`)                            | `<file>.spec.ts` next to the file it tests; `test/integration/<feature>.int-spec.ts` against real PostgreSQL, run serially |
| `apps/admin`            | `ng test --no-watch --no-progress` with Vitest                  | `<file>.spec.ts` next to the file (for example `src/app/app.spec.ts`), compiled with `tsconfig.spec.json`                  |
| `apps/mobile`           | Jest with `jest-expo` (`--maxWorkers=2`)                        | no test file yet; the naming is set by the first mobile test                                                               |
| `packages/*`, `tools/*` | Vitest (`vitest run --maxWorkers=2`), added with the first test | no package has a `test` script yet; `packages/contracts` has a type-level test under `test/`, checked by `typecheck`       |

Source: [decision 0002](docs/decisions/0002-quality-tooling.md), section 1, and
decision 0005, section 6.

## Dependency matrix

Row imports column. `R` runtime, `C` config only (dev dependency), `✗` forbidden.
Source of truth: [decision 0003](docs/decisions/0003-workspace-packages-and-boundaries.md),
section 6; any new edge needs a change there first.

| Importer ↓ / Imported →         | api | admin | mobile | contracts                            | design-tokens | i18n | tsconfig, eslint-config | seed, seed-data | `designs/` |
| ------------------------------- | --- | ----- | ------ | ------------------------------------ | ------------- | ---- | ----------------------- | --------------- | ---------- |
| `@kd/api`                       |     | ✗     | ✗      | R (root entry only, never `/client`) | ✗             | R    | C                       | ✗               | ✗          |
| `@kd/admin`                     | ✗   |       | ✗      | R                                    | R             | R    | C                       | ✗               | ✗          |
| `@kd/mobile`                    | ✗   | ✗     |        | R                                    | R             | R    | C                       | ✗               | ✗          |
| `@kd/contracts`                 | ✗   | ✗     | ✗      |                                      | ✗             | ✗    | C                       | ✗               | ✗          |
| `@kd/design-tokens`, `@kd/i18n` | ✗   | ✗     | ✗      | ✗                                    | ✗             | ✗    | C                       | ✗               | ✗          |
| `@kd/seed`                      | ✗   | ✗     | ✗      | ✗                                    | ✗             | ✗    | C                       | R (`seed-data`) | ✗          |
| `@kd/seed-data`                 | ✗   | ✗     | ✗      | ✗                                    | ✗             | ✗    | C                       |                 | ✗          |

ESLint enforces it twice: `no-restricted-imports` plus the local rule
`kd/no-relative-boundary` for imports, and `check-manifests` for every
`package.json`. Both run in `@kd/eslint-config`'s `lint`.

## Rules of the plan

- **No feature code without its slice.** Entities, migrations, controllers,
  screens, routes, adapters and auth arrive with the slice that owns them
  ([scaffold-plan section 9](docs/scaffold-plan.md)).
- **The owner runs the tests** and shares the output; CI runs them on GitHub's
  runners. Hooks never run tests, a type check or a build.
- **Throttled commands only** (see Commands). Flag anything heavy before running it.
- **No commit and no push without an explicit request.**
- **Conventional Commits**, checked by commitlint: the types of
  `config-conventional`; scopes are the workspace names without `@kd/`, plus
  `deps`, `ci`, `docs`, `repo`; the scope is optional and no ticket id is needed.
- **No co-author or tool-attribution trailer** in commit messages.
- **The production guard** and its test ship in the first commit that binds a
  port to an adapter (decision 0005, section 5).
- **No I/O at import time in `apps/api`**: the OpenAPI generator boots the app
  without a database or network (decision 0004, section 1).
- After a change to a controller or DTO, run `pnpm openapi:generate` and commit
  `packages/contracts/openapi.json` and `src/generated/`; `openapi:check` fails CI
  otherwise.

## Where decisions live

- [docs/adr/](docs/adr/): product-wide architecture decisions, ADR-0001 to
  ADR-0010, indexed in [docs/README.md](docs/README.md).
- [docs/decisions/](docs/decisions/README.md): how this repository implements
  them (toolchain pins, quality tooling, packages and boundaries, contract,
  API conventions, admin and mobile platform facts). Cite them as "decision NNNN".
  An accepted record is not rewritten; a change is a new record.
- [docs/smoke-runs/foundation/](docs/smoke-runs/foundation/): what the owner ran
  and saw. A command in the README needs a passed smoke step.

## What is public-safe

Both repositories are public, and a pushed commit is published at once
([ADR-0010](docs/adr/0010-repository-layout-and-local-docker-repo.md)).

- Never commit `.env`, a key, a token or a real password. `.env.example` holds
  placeholders only; the local placeholder password is `CHANGE_ME_LOCAL`.
- Sample data is fictional: `example.com`, `kitchendaylight.example`,
  `com.example.kitchendaylight`, `*.invalid` URLs. No real person, address,
  phone number or bank detail; the restaurant's real data is supplied at deploy
  time, never committed.
- `apps/admin` and `apps/mobile` never read the root `.env`. Nothing secret goes
  into `app.config.ts`, `extra` or `EXPO_PUBLIC_*`: those ship in plain text.
- The PrimeNG license key is configuration, never committed.
- The `pre-commit` hook runs gitleaks 8.30.1 on the staged changes and blocks
  without the binary; CI scans the full history. Inline `gitleaks:allow` needs a
  reviewer's approval.
- `docs/` is public too, including the tax position and the open legal questions
  (the owner accepted this, ADR-0010).
