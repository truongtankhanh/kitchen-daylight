# Follow-ups for other documents and slice 1 readiness (P6-T4)

Paste-ready text for the owner. This repository does not edit the Docker repository or the design workspace; each section names the target file and gives the text to apply there. Facts were read on 2026-11-05 and cite a smoke sheet ([../smoke-runs/foundation/](../smoke-runs/foundation/)), a decision record of this repository (`decision NNNN`) or [STATUS.md](../implementation/foundation/STATUS.md) of the foundation track (kept locally).

Since P6-T1 the design documents (`scaffold-plan.md`, the ADRs) also exist in this repository under `docs/`. **The owner decided on 2026-11-05 that this repository's `docs/` is the source from now on**; the design workspace (`VER.02/docs`) is an archive. Sections (b) to (d) and the annex therefore apply to `docs/` here, through a pull request.

## (a) `kitchen-daylight-docker`

### a1. `docs/api-contract.md`: the "assumed" rows

Evidence: [phase 4 sheet](../smoke-runs/foundation/phase4.md), step 11 (first run of the `apps` profile with a real image, 2026-11-04) and its differences table; decision 0005, contradictions 3, 6, 8 and 10; STATUS row P5-T4 (registry check, 2026-11-05); `.github/workflows/publish-api-image.yml` ("Resolve the image tag").

Replace the opening sentence ("None of the items below is agreed yet ...") with:

> The monorepo's foundation confirmed or changed every row below on 2026-11-04 and 2026-11-05 (its decision 0005 and its phase 4 smoke sheet, step 11). A row that the monorepo does not implement yet says which slice brings it. When the monorepo changes a row, it is changed here first.

Set each row's status as follows:

| Row | New status | New or confirmed value |
|---|---|---|
| Image name | confirmed | `ghcr.io/truongtankhanh/kitchen-daylight-api`, public package (anonymous registry read, 2026-11-05) |
| Tag convention | **changed** | A release tag `vX.Y.Z` of the monorepo publishes `X.Y.Z`; every push to `main` publishes `sha-` plus the first 7 characters of the commit. Never `latest`. Pull requests are never pushed. `API_TAG` names exactly one of these tags |
| Platforms | confirmed | `linux/amd64` and `linux/arm64`, published by CI (2026-11-05); the local check of 2026-11-04 was arm64 only |
| Contents | confirmed, tightened | `node` **and `sh`** on `PATH`, no `curl` or `wget`; base `node:26.13.0-trixie-slim`; working directory `/app` with `dist/`, `migrations/`, `package.json`, production `node_modules`; user `node` (uid 1000); `CMD node dist/main.js`. `/app/seed/` is added by the seed slice |
| `API_MIGRATE_CMD` | confirmed | `node dist/cli.js migrate`; idempotent (`migrate: nothing to apply`, exit 0). Exit codes: 0 success, 1 runtime failure, 2 usage, 3 configuration invalid, 4 preflight or integrity check failed |
| `API_SEED_CMD` | **changed**, not available yet | Default becomes `node seed/dist/cli.js`; the mode and `--commit` are appended (`reference`, `business`, `demo`; dry run without `--commit`; `demo` refused unless `APP_ENV=dev`). The API image has no `seed` command until the seed slice; `dist/cli.js seed` exits 2 (usage) |
| Health path | confirmed, extended | `GET /api/health` on port 3000, outside `/api/v1`, `Cache-Control: no-store`: `200` `{"status":"ok","checks":{"database":"up"}}`, or `503` `{"status":"error","checks":{"database":"down"}}` when the database does not answer within 1000 ms |
| Health check | confirmed | the `node -e "fetch(...)"` check made `api` healthy |
| Routing through Caddy | confirmed for `/api` | global prefix `/api`, feature routes under `/api/v1`; the path is unchanged through Caddy (`Via: 1.1 Caddy`). `/socket.io/` stays outside `/api`; **no gateway until the realtime slice** |
| `APP_ENV` | confirmed, tightened, partly pending | `dev` here. The API accepts `dev`, `test`, `demo`, `prod` and today refuses a placeholder password outside `dev` and `test`. The adapter guard (refuse `prod` with an emulator or fixture adapter, `test` with a real adapter, `prod` with an S3 endpoint or static S3 keys) ships with the first adapter |
| `PORT` | confirmed | `3000` in the container. The API run on the host listens on `3001` |
| `DATABASE_URL` | confirmed, tightened | `api` as `kd_app`, `migrate` as `kd_migrator`. A process that also sees its host name (`DATABASE_URL_APP` or `DATABASE_URL_MIGRATOR`) refuses to start as ambiguous |
| `MAIL_ADAPTER`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` | accepted, **not read yet** | read from the mail slice; `MAIL_UI_URL` is never read by the API |
| `STORAGE_ADAPTER`, `STORAGE_S3_*` | accepted, **not read yet** | read from the media slice; `STORAGE_S3_FORCE_PATH_STYLE` must reach the S3 client then |
| `GEOCODE_ADAPTER` | accepted, **not read yet** | read from the geo slice |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID`, `OTP_HMAC_SECRET` | accepted, **not read yet** | read from the auth slice; until then empty values do **not** fail startup |
| `LOG_LEVEL` (new row) | added | optional, a pino level, default `info`; not set by `compose.apps.yaml` |

Replace "Status of the runtime check" with:

> **Passed with a local image** on 2026-11-04 (monorepo phase 4 sheet, step 11): `API_TAG=0.0.0-local scripts/up.sh --apps`, `migrate` exit 0, `api` healthy, `/api/health` 200 on 3020 and through Caddy on 8020, `versions.env` unchanged. The run with a CI-published tag is step 7 of the monorepo's stability sheet.

### a2. `docs/monorepo-integration.md`: M1 to M6

Tick the items marked **done**; replace the text of items marked **amend**; leave the others open with the note given. Evidence: [phase 2 sheet](../smoke-runs/foundation/phase2.md), decision 0005, STATUS rows P2-T1 to P2-T4, P5-T4, P5-T5, the Phase 2 and Phase 5 gates.

| Item | State | Note |
|---|---|---|
| M1.1 folder `${KD_DOCKER_DIR:-../kitchen-daylight-docker}` | done | phase 2, run details |
| M1.2 missing folder or script: one line, exit non-zero | done | `scripts/dev-infra.sh` exit 2; implemented, not exercised by a smoke sheet |
| M1.3 version check, then `up.sh` with no flag | done | phase 2, steps 3, 5 and final check |
| M1.4 exit codes passed through | done | phase 2, steps 4 and 5 (`exit=3`, `exit=1`) |
| M1.5 `dev:infra:down`, `dev:infra:status`; no reset wrapper | done | phase 2, steps 2 and 6 |
| M2.1 clone, check out the tag | done | `scripts/bootstrap.sh`; the clone path is exercised by the stability sheet, step 1. **Amend:** drop "it was still private on 2026-10-30": the repository is public since 2026-11-04 |
| M2.2 `init-env.sh` 2 then `up.sh`; exit 3 on an existing `.env` is "already initialised" | done | phase 2, step 1 |
| M2.3 prerequisites of decision 0003 | done | phase 2, step 1 (`prerequisites ok`) |
| M2.4 safe to run twice | done | phase 2, step 1 |
| M3.1 `docker-repo.version` | done | **Amend** the open point: stored as `MAJOR.MINOR.PATCH`; a leading `v` of `VERSION` is stripped |
| M3.2 the check | done | phase 2, step 5 |
| M3.3 in `dev:infra`, `bootstrap` and CI | done | phase 2, steps 1 and 3; CI job `docker-repo` (P5-T5) |
| M3.4 bump rule | done | written in the header of `scripts/check-docker-repo.sh` |
| M4.1 configuration names | **amend**, done | "The configuration module **maps** these names, never renames them. The API never reads `MAIL_UI_URL`. A name is validated only once code uses it." (decision 0005, contradiction 4) |
| M4.2 `.env` from `print-env.sh` | **amend**, done | "The monorepo's root `.env` holds the `print-env.sh` output plus a monorepo-owned block (`PORT`, later the dev-only JWT and OTP secrets) generated by `env:sync`. Nothing is copied by hand." (contradiction 9; phase 2, step 4) |
| M4.3 `APP_ENV` selects the adapters | **amend**, open | "An explicit `*_ADAPTER` wins; the `APP_ENV` default applies only in `dev` and `test` and only when unset; `demo` and `prod` name every adapter." (contradiction 5) Open until the first adapter |
| M4.4 `STORAGE_S3_FORCE_PATH_STYLE` reaches the S3 client | open | media slice |
| M4.5 commands | open | `API_MIGRATE_CMD` done; `API_SEED_CMD` changed (a1) and waits for the seed slice |
| M4.6 mapping of the monorepo's own names | done | decision 0005, section 2 |
| M5.1 checkout pinned by SHA, `ref` = tag of `docker-repo.version` | done, with a fallback | falls back to `main` with a warning while no tag exists; remove the fallback at `0.1.0` (a3) |
| M5.2 build the image in the job, `API_TAG=... scripts/test-up.sh` | open | needs the seed command and the first end-to-end tests |
| M5.3 `test-up.sh`, Playwright, Maestro, `test-down.sh` | open | same |
| M5.4 logs on failure | open | with M5.3 |
| M5.5 parity, `check-parity.sh` | done | run by the `docker-repo` job; exits 0 with a note while `infra/` does not exist |
| M5.6 no `pull_request_target`, no self-hosted runner, no secrets on forks | done | Phase 5 gate |
| M6.1 publish job on `main` and release tags, `packages: write` on that job only | done | P5-T4; Phase 5 gate |
| M6.2 package public | done | 2026-11-05 |
| M6.3 tags | **amend**, done | the proposal is now the rule (a1, "Tag convention") |
| M6.4 pull-request builds not pushed | done | the publish workflow triggers on `main` and `v*.*.*` tags only |
| M6.5 update `API_TAG` after publishing | open | procedure in a3 |
| M6.6 ECR versus GHCR | open, handed over | text for ADR-0004 in the annex (A4) |

### a3. The new `API_TAG` procedure (add to `docs/release-process.md` or `versions.env` comments)

> 1. The monorepo publishes `ghcr.io/truongtankhanh/kitchen-daylight-api:<tag>`: `X.Y.Z` for a release tag `vX.Y.Z`, `sha-<7 characters>` for each push to `main`. Its workflow summary prints `image:tag@digest`.
> 2. For a one-off local run, override the tag for one command; `versions.env` stays unchanged, because a shell variable wins over `--env-file`: `API_TAG=sha-1234567 scripts/up.sh --apps`.
> 3. To change the default, open a pull request here that sets `API_TAG` in `versions.env` to a **release** tag (`X.Y.Z`), never `latest` and never a `sha-` tag. `check-parity.sh` must pass in the same pull request. It is a patch release of this repository, or a minor one when the API contract changes.

### a4. Release `0.1.0`

> 1. Here: set `VERSION` to `0.1.0`, move the `Unreleased` entries of `CHANGELOG.md` under `0.1.0`, merge, then tag the merge commit `v0.1.0` and push the tag.
> 2. In the monorepo, one pull request: `docker-repo.version` → `0.1.0`, and remove the "no tag yet, fall back to `main`" branch of `.github/workflows/docker-repo.yml` (its comment names this day).

Today: `VERSION` is `0.0.0` and there is no tag (read 2026-11-05).

### a5. `docs/implementation/STATUS.md` of that repository

Every task of phases 4 to 6 still shows `todo` (read 2026-11-05), while the repository already has `test-up.sh`, `check-parity.sh`, its workflows and a README. Set each task to its real state from that repository's own history; this repository cannot judge it.

### a6. Files to touch there

`docs/api-contract.md`, `docs/monorepo-integration.md`, `docs/4-scripts-contract.md` (section 4.3: the monorepo block of the root `.env`, contradiction 9), `scripts/seed.sh` (`API_SEED_CMD` default), `versions.env` (procedure a3), `VERSION`, `CHANGELOG.md`, `docs/release-process.md`, `docs/implementation/STATUS.md`.

## (b) `scaffold-plan.md`

### b1. Section 9, slice 0 (append under the table)

> **Slice 0 status (2026-11-05):** done except where noted. Workspace installs and builds, lint and typecheck cache (monorepo phase 1 sheet); the dependency stack runs (phase 2 sheet); `GET /api/health` 200 and 503, `migrate` and its preflight, the placeholder-password refusal, the OpenAPI drift check and the `apps` profile with the API image (phase 4 sheet); the admin builds (phase 4, step 9); CI is green on `main`. Open: the admin shell in a browser and `dev:mobile` (monorepo phase 6 sheet); the mobile shell on a device (mobile shell slice); the mobile theme from the tokens (first mobile UI slice). The production guard test is deferred on purpose to the first commit that binds an adapter (section 4 and monorepo decision 0005, section 5).

### b2. Section 10, results (append one "Result" line under each item)

> 1. **Result:** `typeorm` 1.1.2 with `@nestjs/typeorm` 12.0.2 (monorepo decision 0001); runtime confirmed without PostGIS columns (`migrate` and `GET /api/health` against PostgreSQL 18, phase 4 sheet, steps 2 and 5). PostGIS columns: confirmed by the first slice that adds one. `migration:generate` stays unused.
> 2. **Result:** not confirmed. `socket.io-client` 4.8.4 is the planned version; the runtime spike (connect, reconnect, background, token refresh, on one iOS and one Android device) belongs to the realtime slice. The app reaches the socket through one `RealtimeClient` module (decision 0006, item 3).
> 3. **Result:** `@maplibre/maplibre-react-native` 11.5.1 fits Expo SDK 58 on paper (peer ranges); needs a development build. Runtime check in the map slice (decision 0006, item 4).
> 4. **Result:** native tabs import from `expo-router/native-tabs` in SDK 58; at most 5 tabs on Android, no brand colour under Liquid Glass. Android rendering is checked in the mobile shell slice; JavaScript tabs are the fallback (decision 0006, item 5).
> 5. **Result:** Be Vietnam Pro and Inter are OFL; each app ships its font files with `OFL.txt` in its first slice that styles text; `@kd/design-tokens` holds no font files (decision 0006, item 6).
> 7. **Result:** PostgreSQL 18 provides `uuidv7()` (Docker repository decision 0001); `migrate` refuses to run without it, and the preflight passed (phase 4 sheet, step 2). No application-side generator.
> 9. **Result:** registry decided and implemented: the public GitHub Container Registry package `ghcr.io/truongtankhanh/kitchen-daylight-api`, `linux/amd64` and `linux/arm64`, tags `X.Y.Z` and `sha-<short commit>`, never `latest` (monorepo P5-T4). Private ECR for `demo` and `prod` belongs to the `infra/` slice. The memory limits of PostgreSQL, the S3 emulator and Mailpit on the owner's machine were **not measured**: still open.

### b3. Items that stay open

Item 6 (EAS free-plan limits, release slice), item 8 (Excel with Vietnamese settings and the XLSX library, operations slice), item 10 (arm64 PostGIS: decided in the Docker repository; `infra/` must follow it when it is written), and the open parts of items 1 to 5 and 9 named above.

## (c) ADR-0010, a short addendum

> ## Addendum (2026-11-05): implemented in the monorepo foundation
>
> 1. **Registry decided and implemented.** The API image the Docker repository pulls is the public GitHub Container Registry package `ghcr.io/truongtankhanh/kitchen-daylight-api`, published by the monorepo's `publish-api-image` workflow on pushes to `main` (`sha-<short commit>`) and on release tags `vX.Y.Z` (`X.Y.Z`), for `linux/amd64` and `linux/arm64`, never `latest`, with `packages: write` on that job only. Pull requests build the image without pushing it. `demo` and `prod` still pull from private ECR (the `infra/` slice).
> 2. **Bootstrap.** `scripts/bootstrap.sh` checks the prerequisites of the Docker repository, clones it next to the monorepo when the folder is absent, initialises its `.env` for slot 2 and starts the dependencies; `pnpm dev:infra`, `dev:infra:status` and `dev:infra:down` wrap its scripts, dependencies only; `pnpm env:sync` writes the monorepo's root `.env` from `print-env.sh`. Both are safe to run twice (monorepo phase 2 sheet).
> 3. **The check job.** `docker-repo.version` names the lowest compatible version of the Docker repository; `scripts/check-docker-repo.sh` enforces it in `dev:infra`, `bootstrap` and the CI job `docker-repo`, which checks out the Docker repository at that tag (falling back to `main` with a warning until `0.1.0` exists) and runs its `check-parity.sh`. The end-to-end part waits for the seed command.
> 4. **Both repositories are public** since 2026-11-04, with secret scanning and push protection on.

## (d) ADR-0001 and ADR-0003: only what a decision record changed

### d1. ADR-0001 (append a "Notes from the monorepo decision records" section)

> - **Versions:** exact pins live in the monorepo's decision 0001: Node 26.13.0, pnpm 12.16.1, TypeScript 6.0.3 (held below 6.1 by Angular 22 and `typescript-eslint`), NestJS 12.3.2, TypeORM 1.1.2, Angular 22.2.4, PrimeNG 22.1.4, Expo SDK 58 (58.0.22), React 19.3.0. Open item 3 (`@nestjs/typeorm` with the TypeORM version) is **closed**: 1.1.2 with `@nestjs/typeorm` 12.0.2.
> - **PrimeNG license:** 22.x ships under the commercial PrimeUI License; the owner chose the free Community License (decision 0001). The key is configuration, never committed.
> - **Tests:** Vitest for the API, the admin, the packages and the tools; Jest with `jest-expo` for mobile (decision 0002).
> - **API style:** the OpenAPI document comes from `@nestjs/swagger` with its CLI plugin; the committed snapshot feeds a type-only client, `openapi-typescript` with `openapi-fetch`; breaking changes are checked with `oasdiff` against the last released snapshot (decision 0004).
> - **API runtime:** ESM with the `tsc` builder; configuration validated by one `loadConfig` function, no `@nestjs/config`; logging through `nestjs-pino`, installed by a later task (decision 0005).

### d2. ADR-0003 (append the same kind of section)

> - **Signing keys and code secret in development:** `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID` (ES256) and `OTP_HMAC_SECRET` (256 bits, base64) are generated locally into the monorepo block of the root `.env` by `env:sync`, and in the Docker repository by `gen-dev-secrets.sh`; in `demo` and `prod` they come from SSM (decision 0005, sections 2 and 3). Not read by any code until the auth slice.
> - **Logs:** authorization headers, cookies, `set-cookie` and every token, password, OTP and secret field are redacted; `token` and `code` query values are replaced with `[redacted]` (decision 0005, section 11).
> - **Mobile refresh token:** in `expo-secure-store` with `configureAndroidBackup` on; cleared on the first launch after an iOS reinstall, because keychain items survive uninstall (decision 0006, item 2).

## (e) Slice 1 readiness

Slice 1 (auth and users) starts only when every box is ticked. The fuller checklist, with the slice 0 criteria, is section 6 of [../architecture/foundation.md](../architecture/foundation.md).

- [ ] **Foundation gate approved:** the architecture gate at the end of the [stability sheet](../smoke-runs/foundation/stability.md) records "approve". The sheet and the [phase 6 sheet](../smoke-runs/foundation/phase6.md) are not run yet.
- [ ] **ADR-0003 open choices decided** in a new decision record of this repository, with the pins added to decision 0001: the access-token and refresh-token lifetimes, and the TOTP library for manager and admin (TOTP itself is accepted, scaffold-plan section 9).
- [ ] **Seed command planned.** The Docker `test` stack and every end-to-end job need `seed reference`, `seed business` and `seed demo`. Decision 0005, section 8, fixes the command line (`node seed/dist/cli.js <mode> [--commit]`), the exit codes and the database URL rule; decision 0003 gives `@kd/seed` its row (it reads `@kd/seed-data`). Decide in which slice it lands: scaffold-plan section 9 runs the seed on `dev` and `demo` only in slice 12, which is too late for end-to-end tests of slice 1.
- [ ] **Production guard rule restated in the slice plan:** the first adapter (the mail adapter, if login codes are sent in slice 1) ships with the guard and its per-tier test in the same commit (decision 0005, section 5).
- [ ] **Data model gaps that slice 1 touches** (users, roles, `staff_branches`, codes, consents) are folded in by the design process, not here: the `(mobile G#)` proposals in `data-model.md` and `api-outline.md` still wait for the owner's and the engineers' confirmation (`docs/README.md`, "Next" item 2).
- [ ] **Repository settings applied** (`docs/runbooks/github-settings.md`): no ruleset exists on 2026-11-05, so `main` has no required checks and accepts direct pushes.

## Annex: other documents named by decision 0005's contradictions table

Not in sections (a) to (d), but decision 0005 says P6-T4 hands them over. Each is one sentence to add where the document states the old rule.

- **A1. `api-outline.md`, Conventions, "Base path"** (contradiction 1): "`/api/v1` is the base path of feature endpoints only; `/api/health`, `/api/docs`, `/api/docs-json` and `/socket.io/` are outside `v1`."
- **A2. ADR-0004, section 1 diagram and section 3 "Realtime"** (contradiction 2): "Socket.IO uses its default path `/socket.io/`, outside `/api`; every Caddyfile proxies `/socket.io/*` to the API as well as `/api/*`."
- **A3. `data-model.md`, Conventions, "Primary keys"** (contradiction 7): replace "otherwise the application generates UUIDv7" with "`migrate` refuses to run on a server without `uuidv7()`; there is no application-side fallback."
- **A4. ADR-0004, "Production safety guard"**, and **scaffold-plan section 4** (contradiction 8): "The API also refuses `APP_ENV=test` with a real adapter, and `APP_ENV=prod` with `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY` or `STORAGE_S3_SECRET_KEY` set." ADR-0004, registry note (Docker repository M6.6): "The local stack pulls the API image from the public GitHub Container Registry (published by the monorepo since 2026-11-04); `demo` and `prod` pull from private ECR, whose publishing job belongs to the `infra/` slice and does not exist yet."

## Open for the owner

- Apply (b) to (d) and the annex to this repository's `docs/` in one pull request (decided 2026-11-05: `docs/` here is the source). Mark the design workspace's README as an archive that points here.
- Apply the rulesets of `docs/runbooks/github-settings.md` in the GitHub settings (the owner does it in the web interface) and paste the three `gh api` outputs at the end of that runbook into the session.
- Apply section (a) in `kitchen-daylight-docker`, then cut `0.1.0` (a4).
- Decide whether slice 1 starts once section (e) is all ticked.
