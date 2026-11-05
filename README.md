# kitchen-daylight

Monorepo of the Kitchen Daylight restaurant app: the API (NestJS), the admin web
app (Angular), the customer mobile app (Expo) and their shared packages, managed
with pnpm workspaces and Turborepo.

The repository is public for reference only. All rights reserved: see
[LICENSE](LICENSE).

## Status

Foundation done, no feature code yet. The API serves `GET /api/health` and runs
its migrations; the admin and mobile apps are empty shells. Features arrive as
vertical slices ([scaffold-plan section 9](docs/scaffold-plan.md)); the
architecture of the foundation is in
[docs/architecture/foundation.md](docs/architecture/foundation.md).

> [!WARNING]
> Every credential in these repositories is a local placeholder. No real secret,
> key or password is ever committed. Never reuse a placeholder outside local
> development.

## Prerequisites

| Tool                           | Version                     | Source                                                                                                       |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Node.js                        | 26.13.0 exactly             | `.nvmrc`, `engines` (strict), [decision 0001](docs/decisions/0001-toolchain-versions.md)                     |
| pnpm                           | 12.16.1                     | `packageManager`, decision 0001                                                                              |
| gitleaks                       | 8.30.1                      | the `pre-commit` hook blocks without it ([decision 0002](docs/decisions/0002-quality-tooling.md), section 5) |
| Docker Engine / Docker Compose | 20.10.23 / 2.24.1 or newer  | minimums of the Docker repository, checked by `scripts/bootstrap.sh`                                         |
| bash / curl / git              | 3.2 / 7.75.0 or newer / any | same check                                                                                                   |

Node 26 ships no Corepack ([phase 4 smoke sheet](docs/smoke-runs/foundation/phase4.md),
step 8 notes), so install pnpm 12.16.1 for Node 26 itself, once
([phase 6 smoke sheet](docs/smoke-runs/foundation/phase6.md), step 0):

```sh
nvm use
npm install -g pnpm@12.16.1
```

The smoke runs use `nvm` to select the Node version.

Local development services (PostgreSQL, Mailpit, an S3 emulator) live in the
sibling repository
[kitchen-daylight-docker](https://github.com/truongtankhanh/kitchen-daylight-docker),
cloned next to this one by `scripts/bootstrap.sh`.

## Quick start

Run from the root of a clone, one command at a time. The block has no comment
lines on purpose: the interactive zsh of macOS does not treat `#` as a comment.

```sh
nvm use
pnpm install --frozen-lockfile
scripts/bootstrap.sh
pnpm env:sync
pnpm dev:infra
pnpm dev:infra:status
pnpm --filter "@kd/api..." build
node apps/api/dist/cli.js migrate
pnpm dev:api
```

`"@kd/api..."` also builds the workspace packages the API depends on; on a fresh
clone `pnpm --filter @kd/api build` alone fails, because `@kd/contracts` has no
`dist/` yet.

Then, in a second terminal: `curl -i http://127.0.0.1:3001/api/health` answers
`200` with `{"status":"ok","checks":{"database":"up"}}`.

Every command comes from a passed smoke sheet:

| Command                                    | Smoke sheet                                                         |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `nvm use`                                  | phase 1, step 0; phase 4, step 0; phase 6, step 1                   |
| `pnpm install --frozen-lockfile`           | phase 1, step 1 (also installs the Git hooks); phase 6, step 1      |
| `scripts/bootstrap.sh`                     | phase 2, step 1 (clones the Docker repository, starts its services) |
| `pnpm env:sync`                            | phase 2, step 4 (writes `.env` with mode 600); phase 6, step 1      |
| `pnpm dev:infra`, `pnpm dev:infra:status`  | phase 2, steps 2, 3 and 7                                           |
| `pnpm --filter "@kd/api..." build`         | phase 6, step 2 (fresh clone)                                       |
| `node apps/api/dist/cli.js migrate`        | phase 4, step 2; phase 6, step 2                                    |
| `pnpm dev:api`                             | phase 4, step 4; phase 6, step 2 (watcher: its own terminal)        |
| `curl -i http://127.0.0.1:3001/api/health` | phase 4, step 5; phase 6, step 3                                    |

- `scripts/bootstrap.sh` is safe to run twice: it never overwrites the sibling
  folder or its `.env`, and it ends by starting the dependencies.
- A second `pnpm env:sync` exits 3 and leaves `.env` unchanged (phase 2, step 4).

### Admin and mobile dev servers

Start each one in its own terminal and stop it with Ctrl-C. The admin dev server
proxies `/api` and `/socket.io` to `127.0.0.1:3001`, so keep `pnpm dev:api`
running next to it.

```sh
pnpm --filter "@kd/admin^..." build
pnpm dev:admin
```

`"@kd/admin^..."` builds the packages the admin depends on, not the admin itself.
The shell is served on `http://localhost:4200/` (phase 6, step 4).

```sh
printf 'KD_MOBILE_DEV_API_URL=http://%s:3001/api\n' "$(ipconfig getifaddr en0)" > apps/mobile/.env.local
pnpm --filter "@kd/mobile^..." build
pnpm dev:mobile
```

`apps/mobile/.env.local` is git-ignored and holds the machine's LAN URL of the
API, which `app.config.ts` requires (phase 6, step 5).

Stop the dependencies with `pnpm dev:infra:down` (phase 2, step 6); their data
volumes are kept.

## Root scripts

| Script                                               | What it does                                                                                                         | Smoke sheet                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `prepare`                                            | Installs the Git hooks (`.husky/install.mjs`); skips without failing when husky is absent                            | phase 1, steps 1 and 7                                                                                               |
| `bootstrap`                                          | `scripts/bootstrap.sh`: prerequisites, clone of the Docker repository, its `.env`, then `dev:infra`                  | phase 2, step 1 (script run directly)                                                                                |
| `env:sync`                                           | `scripts/env-sync.sh`: writes the root `.env` from the Docker repository's `print-env.sh` plus a kept monorepo block | phase 2, step 4                                                                                                      |
| `dev:infra`, `dev:infra:status`, `dev:infra:down`    | `scripts/dev-infra.sh up\|status\|down`: version check, then the dependencies only (never the apps)                  | phase 2, steps 2, 3, 5, 6, 7                                                                                         |
| `dev:api`                                            | `nest start --watch` in `@kd/api` (**watcher**)                                                                      | phase 4, step 4                                                                                                      |
| `dev:admin`                                          | `ng serve` in `@kd/admin` (**watcher**)                                                                              | phase 6, step 4                                                                                                      |
| `dev:mobile`                                         | `expo start` in `@kd/mobile` (**long-running**)                                                                      | phase 6, step 5                                                                                                      |
| `build`, `lint`, `typecheck`, `test`, `format:check` | `turbo run <task> --concurrency=2` over the workspace                                                                | `lint` and `typecheck` through `pnpm turbo run lint typecheck --concurrency=2` (phase 1, step 2); the others not run |
| `openapi:generate`                                   | Regenerates `packages/contracts/openapi.json` and the typed client; commit the result                                | not run yet                                                                                                          |
| `openapi:check`                                      | Drift checks of the snapshot and the client, then `openapi:breaking`                                                 | phase 4, step 8                                                                                                      |
| `openapi:breaking`                                   | `scripts/openapi-breaking.sh`: `oasdiff` against the released snapshot; inactive until the first release             | phase 4, step 8 (inactive)                                                                                           |
| `format:check:root`                                  | Prettier check of the root files                                                                                     | not run yet                                                                                                          |

**Who runs tests:** the owner, or CI. `pnpm test` and the package `test` scripts
are never started by a hook, a build or an agent
([decision 0002](docs/decisions/0002-quality-tooling.md), section 1); every
runner is throttled (`--maxWorkers=2`, Turborepo `--concurrency=2`).

## Repository map

```
apps/
  api/            NestJS API: health, config, migrations CLI, OpenAPI generator
  admin/          Angular admin web app (PrimeNG)
  mobile/         Expo customer app (Expo Router)
packages/
  contracts/      OpenAPI snapshot, generated client, ProblemDetails, realtime event types
  design-tokens/  tokens.json -> CSS variables, PrimeNG preset, React Native theme
  i18n/           Vietnamese string catalogues
  tsconfig/       shared TypeScript bases
  eslint-config/  shared ESLint and Prettier config, dependency-boundary checks
tools/
  seed-data/      provinces and wards fixtures with their fetch and verify scripts
scripts/          bootstrap, env-sync, dev-infra, Docker repository version check, OpenAPI breaking check
docs/             product docs, ADRs, decision records, smoke sheets, runbooks
designs/          reference HTML frames and brand assets (never imported, never built)
```

## Links

- Contributor and agent guide: [CLAUDE.md](CLAUDE.md)
- Foundation architecture: [docs/architecture/foundation.md](docs/architecture/foundation.md)
- Product docs and ADRs: [docs/README.md](docs/README.md), [docs/adr/](docs/adr/)
- Decision records of this repository: [docs/decisions/](docs/decisions/README.md)
- Smoke sheets: [docs/smoke-runs/foundation/](docs/smoke-runs/foundation/)
- Release process: [docs/release-process.md](docs/release-process.md)
- GitHub settings: [docs/runbooks/github-settings.md](docs/runbooks/github-settings.md)

## Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
checked by commitlint in the `commit-msg` hook (for example `feat(api): ...`,
`fix(admin): ...`, `docs(repo): ...`). Scopes are the workspace names without
`@kd/`, plus `deps`, `ci`, `docs` and `repo`.
