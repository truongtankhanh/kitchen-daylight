# Foundation architecture

How the monorepo is put together at the end of the foundation (Phases 0 to 5), how to extend it, and what slice 1 needs before it starts. Every statement cites a decision record (`decision NNNN` in [../decisions/](../decisions/README.md)), a project ADR ([../adr/](../adr/)), [scaffold-plan](../scaffold-plan.md), or a smoke sheet ([../smoke-runs/foundation/](../smoke-runs/foundation/)). Where a point is not settled, it says so.

## 1. Layout

Today's tree (top folders and the parts the foundation created):

```
apps/
  api/                 @kd/api      NestJS 12, ESM, nest build (tsc)          decision 0005
    src/
      main.ts          loadConfig -> guard -> NestFactory.create -> configureApp -> listen
      cli.ts, cli/     dist/cli.js migrate (exit codes 0 to 4)
      app.module.ts
      configure-app.ts prefix /api, URI versioning v1 (shared with the OpenAPI generator)
      config/          loadConfig and its validation
      database/        DataSource options, SQL migration runner, preflight
      health/          GET /api/health (200, or 503 when the database does not answer)
      openapi/         generate.ts (preview mode, no database or network)
    migrations/        NNNN_description.sql
    Dockerfile         node:26.13.0 slim image, non-root, CMD node dist/main.js
  admin/               @kd/admin    Angular 22 + PrimeNG 22 shell              decision 0006
    src/app/           app.ts, app.routes.ts, app.config.ts, api/
  mobile/              @kd/mobile   Expo SDK 58 + Expo Router shell            decision 0006
    app/               Expo Router routes
    src/api/
    app.config.ts      variant table dev | demo | prod, placeholder guard
packages/
  contracts/           @kd/contracts      openapi.json, generated client, ProblemDetails, events   decision 0004
  design-tokens/       @kd/design-tokens  tokens.json -> --kd-* CSS, PrimeNG preset object, TS constants
  i18n/                @kd/i18n           Vietnamese catalogues
  tsconfig/            @kd/tsconfig       base, node, web, react-native configs
  eslint-config/       @kd/eslint-config  flat config, Prettier config, boundary rules and fixtures
tools/
  seed-data/           @kd/seed-data      provinces and wards fixtures
scripts/               bootstrap.sh, env-sync.sh, dev-infra.sh, check-docker-repo.sh, openapi-breaking.sh
docs/, designs/        documentation and reference frames (not workspace packages)
```

Planned by scaffold-plan section 1 and not created yet: `tools/seed` (`@kd/seed`, seed slice) and `infra/` (AWS CDK, `demo` and `prod` Compose files, Caddyfile). Local services are not in this repository: they come from the sibling `kitchen-daylight-docker`, whose required version is in `docker-repo.version` ([ADR-0010](../adr/0010-repository-layout-and-local-docker-repo.md)).

```
 laptop
 ┌──────────────────────────────────────────┐     ┌───────────────────────────────────────┐
 │ kitchen-daylight (this repository)        │     │ ../kitchen-daylight-docker            │
 │  pnpm env:sync  ──reads print-env.sh──────┼────▶│  PostgreSQL 127.0.0.1:5452            │
 │  pnpm dev:infra ──runs up.sh──────────────┼────▶│  Mailpit    127.0.0.1:1045 / 8045     │
 │  pnpm dev:api   API on 127.0.0.1:3001 ────┼────▶│  S3         127.0.0.1:9020            │
 └──────────────────────────────────────────┘     └───────────────────────────────────────┘
```

Ports and behaviour from the phase 2 and phase 4 smoke sheets; host port 3001 from decision 0005, section 10.

## 2. Dependency matrix

Row imports column. `R` runtime import allowed, `C` config only (dev dependency), `✗` forbidden. Source of truth: decision 0003, section 6. A new edge changes that record first.

| Importer ↓ / Imported →             | api | admin | mobile | contracts                                         | design-tokens | i18n | tsconfig, eslint-config       | seed, seed-data | `designs/` |
| ----------------------------------- | --- | ----- | ------ | ------------------------------------------------- | ------------- | ---- | ----------------------------- | --------------- | ---------- |
| `@kd/api`                           |     | ✗     | ✗      | R (root entry only; `@kd/contracts/client` is ✗) | ✗             | R    | C                             | ✗               | ✗          |
| `@kd/admin`                         | ✗   |       | ✗      | R                                                 | R             | R    | C                             | ✗               | ✗          |
| `@kd/mobile`                        | ✗   | ✗     |        | R                                                 | R             | R    | C                             | ✗               | ✗          |
| `@kd/contracts`                     | ✗   | ✗     | ✗      |                                                   | ✗             | ✗    | C                             | ✗               | ✗          |
| `@kd/design-tokens`                 | ✗   | ✗     | ✗      | ✗                                                 |               | ✗    | C                             | ✗               | ✗          |
| `@kd/i18n`                          | ✗   | ✗     | ✗      | ✗                                                 | ✗             |      | C                             | ✗               | ✗          |
| `@kd/seed`                          | ✗   | ✗     | ✗      | ✗                                                 | ✗             | ✗    | C                             | R (`seed-data`) | ✗          |
| `@kd/seed-data`                     | ✗   | ✗     | ✗      | ✗                                                 | ✗             | ✗    | C                             |                 | ✗          |
| `@kd/tsconfig`, `@kd/eslint-config` | ✗   | ✗     | ✗      | ✗                                                 | ✗             | ✗    | eslint-config may extend tsconfig | ✗           | ✗          |

Enforcement (decision 0003, implementation notes): package names through `no-restricted-imports`, relative paths through the local rule `kd/no-relative-boundary`, manifests through `check-manifests`. The package `lint` script of `@kd/eslint-config` runs `check-fixtures` and `check-manifests`, so `turbo run lint` and CI always exercise them. The fixtures reject 181 imports as expected at commit `1851a22` (phase 1 smoke sheet, step 4; 197 after the Phase 1 review fix).

## 3. Task graph

Root `turbo.json`, default `concurrency` 2; the root scripts repeat `--concurrency=2`.

| Task                             | Depends on | Outputs                          | Notes                                                                   |
| -------------------------------- | ---------- | -------------------------------- | ----------------------------------------------------------------------- |
| `build`                          | `^build`   | `dist/**`                        | test files excluded from the inputs; `@kd/tsconfig` configs included   |
| `lint`                           | `^build`   | none                             | typed rules need the dependencies' `.d.ts`                              |
| `@kd/eslint-config#lint`         | `^build`   | none                             | every workspace `package.json` is an input (manifest check)            |
| `typecheck`                      | `^build`   | none                             |                                                                         |
| `test`                           | `^build`   | `coverage/**`                    | run by the owner or CI only                                             |
| `format:check`, `//#format:check:root` | none | none                             | Prettier; root files only for the root task                            |
| `@kd/api#openapi:generate`       | `build`    | `packages/contracts/openapi.json` |                                                                        |
| `@kd/api#openapi:check`          | `build`    | none                             | byte comparison with the committed snapshot                            |
| `@kd/contracts#client:generate`  | none       | `src/generated/**`               | `openapi-typescript`                                                    |
| `@kd/contracts#client:check`     | none       | none                             |                                                                         |

```
@kd/contracts#build                                     ──^build──▶ @kd/api#build
@kd/contracts#build, @kd/design-tokens#build            ──^build──▶ @kd/admin#build
@kd/contracts#build, @kd/design-tokens#build, @kd/i18n#build ──^build──▶ @kd/mobile lint, typecheck, test
@kd/api#build ──▶ @kd/api#openapi:generate ──writes──▶ packages/contracts/openapi.json
packages/contracts/openapi.json ──read by──▶ @kd/contracts#client:generate ──writes──▶ src/generated/
@kd/tsconfig, @kd/eslint-config: no build; their files are explicit inputs of the tasks that read them
```

The edges are today's `@kd/*` dependencies in each `package.json` (a subset of the matrix); `@kd/mobile` has no `build` task.

`@kd/contracts#build` reads the committed snapshot and does not depend on `openapi:generate` (that would be a cycle, decision 0003, section 5). `pnpm openapi:generate` runs the two generators in order; `pnpm openapi:check` runs both drift checks, then `scripts/openapi-breaking.sh`, inactive until `packages/contracts/openapi.released.json` exists (decision 0004, section 3; phase 4 smoke sheet, step 8). The persistent `dev:*` scripts are not Turborepo tasks.

## 4. How to add things

Each recipe ends with the checks that gate it. The owner runs the tests; CI runs lint, typecheck, test, the boundary checks and `openapi:check`.

### A NestJS module

1. Create `apps/api/src/modules/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts` (customer routes), `admin-<feature>.controller.ts` (`/admin` routes), `<feature>.service.ts`, `dto/<name>.dto.ts` and `entities/<name>.entity.ts` (decision 0005, section 6). Module names come from scaffold-plan section 4. Import it in `app.module.ts`.
2. Controllers declare no version: `configureApp` puts them under `/api/v1` (decision 0005, section 1).
3. Export services, never repositories; another module reads through the owning module's service.
4. Entities are listed explicitly in the `DataSource` options in `src/database/` (no glob, `synchronize: false`). Relations use `Relation<T>` (ESM).
5. Tables come from a new `apps/api/migrations/NNNN_description.sql` that also writes the table's `GRANT`s to `kd_app` (append-only tables get `INSERT` only). Never edit a merged migration (decision 0005, section 7).
6. A port is an interface plus an injection token in its owning module (`ports/`), adapters in `adapters/<adapter>/`, chosen by a factory provider from config. The first adapter brings the production guard and its test in the same commit (decision 0005, section 5).
7. New environment variables go into the table of decision 0005 section 2, `.env.example` and the config schema in the same pull request (`scripts/env-sync.sh` header).
8. Nothing runs I/O at import time (decision 0004, section 1).

Gate: `pnpm --filter @kd/api lint`, `pnpm --filter @kd/api typecheck`, `pnpm --filter "@kd/api..." build` (the API and the packages it depends on; `--filter @kd/api` alone fails on a fresh clone), then `pnpm openapi:generate` and a committed snapshot; `pnpm openapi:check` passes (it failed on a DTO change that was not regenerated, phase 4 smoke sheet, step 8). Unit tests `<file>.spec.ts` next to the file, integration tests in `test/integration/<feature>.int-spec.ts`, run by the owner.

### An admin feature folder

1. Scaffold-plan section 5 names the feature folders (`orders`, `menu`, `branches`, `reviews`, `users`, `dashboard`, `reports`, `settings`, `exports`, `email`, `audit`). **Not fixed by a decision record:** the folder path and the loading style. Proposed: `apps/admin/src/app/<feature>/`, registered in `src/app/app.routes.ts`. The first admin slice confirms or changes this, and writes it here.
2. Call the API through the typed client of `@kd/contracts/client` (`createApiClient`); the admin's client lives in `src/app/api/`. Never import `@kd/api` (matrix).
3. Styles use the `--kd-*` variables and the PrimeNG preset from `@kd/design-tokens`, never `--p-*` directly (decision 0006, item 7). Strings come from `@kd/i18n`.
4. The admin never reads the root `.env`; the dev server proxies `/api` and `/socket.io` to `127.0.0.1:3001` (decision 0005, sections 3 and 10).

Gate: `pnpm --filter @kd/admin lint`, `pnpm --filter @kd/admin typecheck`; the owner runs `pnpm --filter @kd/admin build` (phase 4 smoke sheet, step 9: 388.81 kB initial bundle at the shell) and `ng test`. Specs are `<file>.spec.ts` next to the file.

### A mobile route

1. Add the route file under `apps/mobile/app/` (Expo Router). The four tabs are a static list behind one `AppTabBar`; no screen measures the tab bar (decision 0006, item 5).
2. Server state through TanStack Query and the typed client of `@kd/contracts/client`; the API root comes from `extra.apiBaseUrl` (`app.config.ts`), never from the root `.env` (decision 0006, item 9).
3. No secret in `app.config.ts`, `extra` or `EXPO_PUBLIC_*`. Screens never import `socket.io-client` (one `RealtimeClient` module, decision 0006, item 3).
4. A native module that Expo Go lacks (MapLibre, embedded fonts) brings `expo-dev-client`, and from then on every developer needs a development build (decision 0006, item 2). Expo-managed packages move with `expo install --fix` (decision 0001).

Gate: `pnpm --filter @kd/mobile lint`, `pnpm --filter @kd/mobile typecheck`; the owner runs `expo-doctor` (phase 4 smoke sheet, step 10) and the Jest tests. The mobile app has no CI build (EAS later).

### A shared package

1. Decide the folder: `packages/<name>` only if two or more workspace packages need it; `tools/<name>` for a command-line tool (decision 0003, section 7).
2. `package.json`: `"name": "@kd/<folder>"`, `"private": true`, `"version": "0.0.0"`, `"type": "module"`, an `exports` map with `types` first and `default` in `dist/`, `@kd/tsconfig` and `@kd/eslint-config` as `workspace:*` dev dependencies, the applicable scripts with their throttle flags. No top-level `await`.
3. Add its row and column to the matrix in decision 0003 (a new record if an edge changes), its ESLint boundary layer, its import fixture in `packages/eslint-config/fixtures/boundaries/`, and its entry in `check-manifests`.
4. Pin any new external dependency from decision 0001 and record it there; one used by two packages moves to the `catalog`.

Gate: `pnpm --filter @kd/eslint-config check-fixtures` (phase 1 smoke sheet, step 4), `pnpm turbo run lint typecheck --concurrency=2` (phase 1, step 2), `pnpm --filter "@kd/<name>..." build`.

## 5. Cross-cutting items (scaffold-plan section 4)

Nothing below exists yet except where stated. `common/` is the folder decision 0005 section 6 reserves for guards, decorators, filters, pipes and logging.

| Item                                                      | Where it goes                                                                                                                                                                       | When                                                         | Source                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Global deny-by-default auth guard, `@Public()`, role guard | `apps/api/src/common/` (guards, decorators), registered globally; `auth` module owns tokens and codes                                                                              | slice 1                                                      | scaffold-plan 4; decision 0005, section 6      |
| Branch scoping                                            | one shared guard or helper in `common/`, reading `staff_branches` on each request, with a test that enumerates the endpoints                                                       | slice 1 (roles with `staff_branches`)                        | scaffold-plan 4 and 9                          |
| Validation pipe (whitelist, forbid unknown)               | `configure-app.ts`                                                                                                                                                                  | not scheduled by a record; due with the first endpoint that takes input | scaffold-plan 4; decision 0005, section 6      |
| problem+json exception filter                             | `common/` filter, registered in `configure-app.ts`; typed with `ProblemDetails` from `@kd/contracts`; the error `code` union arrives with the error-handling slice               | first endpoint that returns an error code                    | decision 0004, section 7                       |
| Throttling, strict on auth                                | **place not decided by a record**; a second API instance would need a shared store                                                                                                 | slice 1                                                      | scaffold-plan 4; decision 0005, consequences   |
| Logging                                                   | `nestjs-pino` with `bufferLogs` in `main.ts`, request serializer and redaction list in `common/`; **not installed yet** (`LOG_LEVEL` is validated only)                          | the task that installs pino, recorded in decision 0001       | decision 0005, section 11; decision 0001       |
| Ports and adapters                                        | `MailPort` in `mail`, `StoragePort` in `media`, `GeocodePort` in `geo`: `ports/` and `adapters/` of each module; `InvoicePort` designed, deferred                               | the slice that first sends mail or stores media              | scaffold-plan 4; decision 0005, section 6      |
| Production guard                                          | `apps/api/src/config/`, run after config validation and before `listen`; today only the placeholder-password refusal exists (phase 4 smoke sheet, step 7)                        | with the first adapter, in the same commit, with its test    | decision 0005, section 5                       |
| Scheduled jobs                                            | `jobs` module (one instance, one scheduler; an advisory lock if scaled out)                                                                                                         | slice 10 (operations)                                        | scaffold-plan 4 and 9                          |
| Realtime                                                  | `realtime` module (gateway on `/socket.io/`, outbox relay, branch-scoped audiences); event types in `packages/contracts/src/events.ts`; admin realtime service; mobile `RealtimeClient` | slice 6, mobile spike first                                  | decision 0004, section 6; decision 0005, section 1; decision 0006, item 3 |
| Config validation                                         | **exists**: `loadConfig` in `src/config/`, one stderr line per variable, no value printed                                                                                         | done (Phase 4)                                               | decision 0005, section 4                       |

## 6. Slice-1 entry checklist

Slice 1 is "Auth and users" (scaffold-plan section 9). It starts when every box of A is ticked or explicitly waived by the owner, and the items of B are planned into it.

### A. Slice 0 exit criteria (scaffold-plan section 9)

- [x] Workspace installs from the lockfile; lint and typecheck pass and replay from the cache (phase 1 smoke sheet, steps 1 to 3).
- [x] Hooks reject a bad commit message and a staged secret (phase 1, steps 5 and 6).
- [x] Dependency stack up, down and up again with data kept, version mismatch refused (phase 2, steps 1 to 7).
- [x] API `GET /api/health` returns 200, and 503 with the database stopped (phase 4, steps 5 and 6).
- [x] `migrate` passes its preflight, is idempotent, and fails cleanly without the database (phase 4, steps 2 and 3).
- [x] `APP_ENV=prod` with the placeholder password refuses to start (phase 4, step 7).
- [x] `openapi:check` catches a DTO change (phase 4, step 8).
- [x] The API image runs in the Docker repository's `apps` profile (phase 4, step 11).
- [x] The admin builds (phase 4, step 9). [ ] The admin renders in a browser: not checked yet (decision 0006, implementation notes).
- [ ] The mobile shell renders on a device or simulator: deferred to the mobile shell slice (decision 0006, implementation notes). `expo-doctor` shows only the known SDK 58 patch mismatch (phase 4, step 10).
- [ ] The tokens feed both themes: the PrimeNG preset is wired and builds (decision 0006, item 7 notes); rendering on web and the mobile theme are not checked yet.
- [x] CI green on `main`: `ci`, `security`, `docker-repo`, `publish-api-image` and CodeQL succeeded on `ba45b29` (2026-11-05, read with `gh run list`).
- [ ] Production guard test: not possible before an adapter exists; it moves into slice 1 (B below).

### B. Open follow-ups to clear or plan into slice 1

- [ ] Move the SDK 58 patch set to `expo` 58.0.23 with `expo install --fix` and update decision 0001 (phase 4, follow-up 2).
- [x] Install pnpm 12.16.1 for Node 26 on the owner's machine (phase 4, follow-up 3): done 2026-11-05, [phase 6 smoke sheet](../smoke-runs/foundation/phase6.md), step 0.
- [ ] Send the `api-contract.md` differences to the Docker repository (phase 4, follow-up 1) and fix the documents of decision 0005's contradictions table (P6-T4).
- [x] Run the quick start on a fresh clone, `pnpm dev:admin` and `pnpm dev:mobile`: done 2026-11-05 ([phase 6 smoke sheet](../smoke-runs/foundation/phase6.md), steps 1 to 5; `pnpm --filter "@kd/api..." build` passes on a clone with no `dist/`). Still to report: the admin shell in a browser (step 4).
- [ ] Decide where the PrimeNG license key is read, before the first admin release (decision 0001).
- [ ] `X-Powered-By: Express` is sent (phase 4, step 5 notes): a hardening item for a later slice.

### C. What slice 1 itself must bring (so it is not discovered mid-slice)

- [ ] ADR-0003 (authentication) and TOTP for manager and admin are accepted (scaffold-plan section 9, "Needs").
- [ ] `env:sync` writes the dev ES256 key pair, key id and `OTP_HMAC_SECRET` into the monorepo block, and the names land in decision 0005's table, `.env.example` and the schema in the same pull request (decision 0005, section 3; `scripts/env-sync.sh` header).
- [ ] The first mail adapter, if login codes are sent in slice 1, ships with the production guard and its per-tier test (decision 0005, section 5).
- [ ] The redaction list gains the auth field names, and logging is installed if slice 1 logs requests (decision 0005, section 11).
- [ ] The global auth guard, `@Public()`, the role guard, branch scoping with its endpoint-enumerating test, and throttling on auth routes, with the throttling location recorded (section 5 above).
- [ ] The problem+json filter and the auth error codes in the `ProblemDetails` `code` union (decision 0004, section 7).
- [ ] The first migration with its `GRANT`s to `kd_app` (decision 0005, section 7).
- [ ] Mobile: refresh token in `expo-secure-store` with `configureAndroidBackup` on and the iOS reinstall clean-up (decision 0006, item 2). Admin: access token in memory, refresh cookie, one silent refresh and retry (scaffold-plan section 5).
