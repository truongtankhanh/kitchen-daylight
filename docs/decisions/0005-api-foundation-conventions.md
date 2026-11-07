# 0005. API foundation conventions

Status: **accepted** (P0-T6, proposed 2026-11-03; accepted by the owner 2026-11-03, Phase 0 gate). Fixes the API's routing, environment variables, env file, config validation, `APP_ENV` and production guard, module layout, logging, database access and migrations, CLI, container contract and host dev port. Also takes the two choices that earlier records left to P0-T6: the API module system (0003) and the Nest builder (0004).

## Contradictions and tightenings (for P6-T4)

Each row names a document that this record contradicts (**C**) or makes stricter (**T**). P6-T4 updates the documents once the owner has answered. Rows marked **owner** need a decision before acceptance.

| # | Kind | Document | It says | This record says |
|---|---|---|---|---|
| 1 | T | `docs/api-outline.md`, Conventions, "Base path" | `/api/v1` | `/api/v1` is the base path of **feature** endpoints only. `/api/health`, `/api/docs`, `/api/docs-json` and `/socket.io/` are outside `v1` (section 1) |
| 2 | C | `docs/adr/0004-aws-hosting.md`, section 1 diagram and section 3 "Realtime" row | the API is reached at `/api`; "Caddy must pass WebSocket upgrades on `/api`" | Socket.IO stays on its default path `/socket.io/`, outside `/api`. Every Caddyfile proxies `/socket.io/*` to the API as well, as the Docker repository's `Caddyfile.dev` already does (section 1) |
| 3 | T | `kitchen-daylight-docker/docs/api-contract.md`, all rows "assumed" | image contents, health, routing, commands, env names are assumptions | Confirmed: port 3000, non-root, `node` on `PATH`, no `curl`/`wget`, `/api/health`, prefix `/api`, `/socket.io`, `API_MIGRATE_CMD`, the container env names. Tightened: `sh` is on `PATH` too; health returns `503` when the database is unreachable; exit codes of section 8 |
| 4 | T | `kitchen-daylight-docker/docs/monorepo-integration.md`, M4 first item | the config module "reads exactly these names" (12 names) | The 12 names are **mapped**, never renamed (section 2). The API never reads `MAIL_UI_URL` (for people and e2e tests only). A name is validated only once code uses it (section 4) |
| 5 | T | same, M4 third item | "`APP_ENV=dev` selects the Mailpit, S3-emulator and fixture adapters" | An explicit `*_ADAPTER` variable wins. The `APP_ENV` default applies only in `dev` and `test` and only when the variable is unset. `demo` and `prod` require every `*_ADAPTER` explicitly (section 2) |
| 6 | C (owner chose (b), 2026-11-03) | `api-contract.md` "Commands" and `scripts/seed.sh` (`API_SEED_CMD` default `node dist/cli.js seed`); this repository's 0003 (seeding is `tools/seed` = `@kd/seed`, own SQL through `pg`; `@kd/api` may not import `@kd/seed` or `@kd/seed-data`) | the seed runs from the API image's `dist/cli.js` | Seeding stays in `tools/seed`, so 0003 is unchanged. The API image also ships the `@kd/seed` build at `/app/seed/`. The `API_SEED_CMD` default becomes **`node seed/dist/cli.js`**, a one-line change in the Docker repository allowed by its "Commands" note. `dist/cli.js` has no `seed` subcommand (sections 8 and 9). Rejected: (a) moving the seed into `apps/api`, which would reopen 0003 open item 4 |
| 7 | C | `docs/data-model.md`, Conventions, "Primary keys" | "otherwise the application generates UUIDv7" | No application-side fallback: `migrate` refuses to run without `uuidv7()` (section 7; same as 0001, scaffold-plan item 7) |
| 8 | T | `api-contract.md`, `APP_ENV` row; ADR-0004 "Production safety guard"; scaffold-plan section 4 | the API refuses `prod` with an emulator or fixture adapter | It also refuses `test` with a real adapter, and `prod` with an S3 endpoint override or static S3 keys (section 3) |
| 9 | T | `kitchen-daylight-docker/docs/4-scripts-contract.md` 4.3 and M4 second item | the host `.env` is the output of `print-env.sh`; no credential is copied by hand | The root `.env` holds the `print-env.sh` output plus a monorepo-owned block (`PORT` and the dev-only JWT and OTP secrets), generated locally by `env:sync` and kept across syncs. Nothing is copied by hand, and the Docker repository changes nothing (section 2) |
| 10 | T | `api-contract.md`, "Status of the runtime check" | `curl -fsS http://127.0.0.1:3020/api/health` | Path confirmed. The API run on the host (outside Docker) listens on **3001** (section 10) |
| 11 | closes | this repository's 0002 (Vitest coupling), 0003 (API module format), 0004 (SWC branch) | left to P0-T6 | ESM and the `tsc` builder (section 0) |

## Context

- api-outline Conventions: base path `/api/v1`; errors as `application/problem+json`; offset and cursor pagination; `Idempotency-Key` on order and reservation creation.
- ADR-0004:
  - One host per tier, admin at `/`, API at `/api`, behind Caddy.
  - Socket.IO gateway in the API container.
  - In-process background work (outbox relay, export queue, nightly jobs), one API instance per tier.
  - Secrets in SSM Parameter Store; no long-lived AWS keys on the host.
  - Production guard on `APP_ENV=prod`.
- ADR-0001: pino + Sentry; TypeORM with hand-written SQL migrations as the source of truth and `synchronize` off.
- data-model Conventions: `uuid` primary keys with `uuidv7()` (PostgreSQL 18), `snake_case`, `citext` for email.
- scaffold-plan section 4:
  - Cross-cutting: deny-by-default auth guard, validation pipe, problem+json filter, throttling, pino that rounds or drops coordinates, config validated at startup and failing fast.
  - Ports `MailPort`, `StoragePort`, `GeocodePort` chosen by configuration, with the production guard.
  - Database: two roles; the application role has no DDL.
- Docker repository:
  - `api-contract.md`: image, `API_MIGRATE_CMD`, `API_SEED_CMD`, `/api/health`, Caddy routing, container env names.
  - M4: the config module reads the `print-env.sh` names and maps them, never renames them.
  - 4.3: the 12 stable names.
- 0001 to 0004 of this repository: versions; Vitest for the API; compiled ESM shared packages; the OpenAPI generator and `configureApp`.

## Evidence

Read on 2026-11-03. Registry data from read-only `npm view <pkg> version peerDependencies dependencies engines license --json`. Claims are cited as [S#] or marked **not verified**.

| ID | Source |
|---|---|
| S1 | https://docs.nestjs.com/techniques/versioning: `app.enableVersioning({ type: VersioningType.URI })`; the version "is automatically prefixed with `v`"; `defaultVersion` applies to "every controller or route that doesn't specify one"; "a `VERSION_NEUTRAL` resource does not have the version in its URI"; "the version is automatically added to the URI after the global path prefix" |
| S2 | https://docs.nestjs.com/openapi/introduction: `SwaggerModule.setup(path, ...)` mounts the UI at `path`; the JSON defaults to `<path>-json`; `useGlobalPrefix` defaults to `false`; `ui: false` stops serving the UI |
| S3 | https://docs.nestjs.com/websockets/gateways: "By default, each gateway listens on the same port as the HTTP server"; the second decorator argument passes server options to the socket server. Whether `setGlobalPrefix` affects gateways is **not stated** |
| S4 | https://nodejs.org/api/cli.html: `--env-file` and `--env-file-if-exists` "no longer experimental" since v24.10.0; "If the same variable is defined in the environment and in the file, the value from the environment takes precedence"; `--env-file-if-exists` does not throw when the file is missing; paths are relative to the current directory |
| S5 | https://nodejs.org/api/util.html: `util.parseArgs` "no longer experimental" since v20.0.0; `strict` (default `true`) throws on unknown arguments; `allowPositionals` |
| S6 | https://docs.nestjs.com/techniques/configuration: "You can write such a module yourself", `@nestjs/config` is a convenience; the custom `validate` example uses `class-transformer` `plainToInstance(..., { enableImplicitConversion: true })` and `class-validator` `validateSync(..., { skipMissingProperties: false })`; a throwing `validate` stops the bootstrap |
| S7 | https://github.com/iamolegga/nestjs-pino: pino and pino-http options go in `pinoHttp` (`redact`, `serializers`, `autoLogging`, `genReqId`); `NestFactory.create(AppModule, { bufferLogs: true })` then `app.useLogger(app.get(Logger))` before `init()`/`listen()`. Query strings and privacy are **not covered** |
| S8 | Registry: `nestjs-pino` 5.3.1, peers `@nestjs/common` and `@nestjs/core ^11.0.8 \|\| ^12.0.2`, `pino ^10.0.0`, `pino-http ^11.0.0`, `rxjs ^7.1.0`, engines `node >=22.12.0`; `pino-http` 11.0.0 depends on `pino ^10.0.0`; MIT |
| S9 | Registry: `class-validator` 0.15.1 (depends on `validator`, `libphonenumber-js`), `class-transformer` 0.5.1, `reflect-metadata` 0.2.2 (peer range of NestJS 12, 0001) |
| S10 | Registry: `@nestjs/platform-socket.io` 12.3.2 depends on `socket.io` 4.8.4. Socket.IO's default server `path` is `/socket.io` (Socket.IO server option; **not re-read** today) |
| S11 | TypeORM ESM support: `Relation<T>` wrapper for relation properties in ESM projects with circular imports (https://github.com/typeorm/typeorm/pull/8536; https://app.unpkg.com/typeorm@0.3.28/files/browser/common/RelationType.d.ts). Unchanged in 1.x: **not verified** |
| S12 | This repository's 0002 S2: the NestJS 12 schematics default to ESM "with vitest"; `cjs` is "with jest" |

## 0. Module system and builder

**Choice: ESM** (`"type": "module"`, `module`/`moduleResolution` `nodenext`) **and the default `tsc` builder** of `nest build`.

**Reason:**
- ESM is the NestJS 12 default and the one 0002's Vitest choice was made for [S12].
- It matches the shared packages (0003).
- The Swagger plugin detects ESM by itself (0004 S1).
- `tsc` needs no extra plugin wiring, while SWC does (0004).

**Rule:** entity relation properties use TypeORM's `Relation<T>` wrapper, so circular entity imports do not break under ESM [S11].

## 1. Routing

| Surface | Path | How |
|---|---|---|
| Feature endpoints | `/api/v1/...` | `app.setGlobalPrefix('api')` and `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })` [S1]. Controllers declare no version |
| Health | `/api/health` | `@Controller({ path: 'health', version: VERSION_NEUTRAL })` [S1]. `200` when the application can serve and the database answers, `503` otherwise. Written in P4-T4. Excluded from request logs |
| Swagger UI and JSON | `/api/docs`, `/api/docs-json` | `SwaggerModule.setup('api/docs', ...)` with `useGlobalPrefix: false` [S2]. Served when `APP_ENV` is `dev`, `test` or `demo`, not in `prod`. The contract itself is the committed snapshot (0004) |
| Socket.IO | `/socket.io/` | the default Socket.IO path [S10], on the HTTP port [S3]. No `path` override. Not under `/api`: the global prefix is not relied on for gateways [S3] |

- Both the Docker repository's assumption (prefix `/api`, health at `/api/health`) and api-outline's `/api/v1` hold. No Caddyfile change is needed (contradictions 1 and 2).
- `configureApp(app)` (0004) applies the prefix and the versioning, so the OpenAPI document and the running server share one definition.
- A future `v2` is added per controller with `version: '2'`.

## 2. Environment variables: one canonical set

**Rules:**
- The 12 names of Docker 4.3 are a stable contract. They are mapped inside the config module and never renamed in the Docker repository (M4).
- Containers in every tier (Docker `apps` profile, `demo`, `prod`) use the container names. In `demo` and `prod`, the values come from SSM (ADR-0004).
- A process run on the host reads the root `.env` (section 3).

| Name | Used by | Host (root `.env`) | Container | Mapping rule |
|---|---|---|---|---|
| `APP_ENV` | server, CLI | from `print-env.sh` | set by compose or the tier | required, one of `dev\|test\|demo\|prod` (section 4) |
| `DATABASE_URL` | server (as `kd_app`), CLI (as `kd_migrator`) | **never set** | `api`: `kd_app` URL; `migrate`: `kd_migrator` URL | when set, it is the URL of the current process |
| `DATABASE_URL_APP` | server on the host | from `print-env.sh` | not set | → `database.url` of the server when `DATABASE_URL` is unset |
| `DATABASE_URL_MIGRATOR` | CLI on the host | from `print-env.sh` | not set | → `database.url` of the CLI when `DATABASE_URL` is unset |
| `PORT` | server | `3001`, written by `env:sync` (section 10) | `3000` | optional, integer; default `3000` |
| `MAIL_ADAPTER` | server; mail module (A1-T8) | not printed → default from `APP_ENV` | `smtp` | one of `smtp\|ses`; `dev`/`test`: default `smtp`; `demo`/`prod`: required (`ses`). `ses` is accepted by the config but refused by the adapter factory as "not available yet" until A12-T4; kinds `smtp` emulator, `ses` real (section 5) |
| `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` | `smtp` adapter (A1-T8) | from `print-env.sh` | `mailpit`, `1025` | read only when the adapter is `smtp`, and then both required: a host name or IPv4 address, an integer from 1 to 65535 |
| `MAIL_FROM` | server; mail module (A1-T8) | not printed → default in `dev`/`test` | not set → default in `dev`/`test` | sender address, a valid email address; `dev`/`test`: default `no-reply@kitchendaylight.example`; `demo`/`prod`: required |
| `MAIL_UI_URL` | people, e2e tests | from `print-env.sh` | not set | **never read by the API** |
| `STORAGE_ADAPTER` | media slice | not printed → default from `APP_ENV` | `s3` | `dev`/`test`: default `s3`; `demo`/`prod`: required |
| `STORAGE_S3_ENDPOINT`, `STORAGE_S3_FORCE_PATH_STYLE` | `s3` adapter | from `print-env.sh` | `http://s3:8333`, `true` | must reach the S3 client (M4); **must be unset in `prod`** (guard) |
| `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY` | `s3` adapter | from `print-env.sh` | from the Docker `.env` | **must be unset in `demo` and `prod`** (instance profile, ADR-0004) |
| `STORAGE_S3_BUCKET_MEDIA`, `STORAGE_S3_BUCKET_PRIVATE` | `s3` adapter | from `print-env.sh` | `kd-dev-media`, `kd-dev-private` | required by the adapter |
| `STORAGE_S3_REGION` | `s3` adapter | not printed | `us-east-1` | `dev`/`test`: default `us-east-1`; `demo`/`prod`: required |
| `GEOCODE_ADAPTER` | geo slice | not printed → default from `APP_ENV` | `fixture` | `dev`/`test`: default `fixture`; `demo`/`prod`: required |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID` | server (the CLI never reads them); token service (A1-T6) | generated by `env:sync` (monorepo block) | from `gen-dev-secrets.sh` | required in every tier, formats as in `api-contract.md`: each key the base64 of a one-line PEM, EC on `prime256v1`, private PKCS#8, public SPKI and derived from the private key; `JWT_KEY_ID` matches `^[A-Za-z0-9._-]{1,64}$`; a value containing `CHANGE_ME_LOCAL` is refused in `demo` and `prod` (decision 0008, section 12; A1-T2) |
| `JWT_PREVIOUS_PUBLIC_KEYS` | server; token service (A1-T6) | not set | not set | optional, key rotation only: comma-separated `<kid>:<base64 SPKI PEM>`, P-256, each `kid` unique and different from `JWT_KEY_ID`; accepted for verification only (decision 0008, section 9) |
| `OTP_HMAC_SECRET` | server; email codes | generated by `env:sync` (monorepo block) | from `gen-dev-secrets.sh` | required in every tier; base64 of at least 32 bytes; placeholder refused in `demo` and `prod` |
| `MFA_ENCRYPTION_KEY` | server; TOTP secret encryption (AES-256-GCM) | generated by `env:sync` (monorepo block) | **not yet**: `gen-dev-secrets.sh` does not write it (Docker repository follow-up) | required in every tier; base64 of exactly 32 bytes; placeholder refused in `demo` and `prod` (decision 0008, section 8) |
| `MFA_ENCRYPTION_PREVIOUS_KEYS` | server; TOTP secret encryption | not set | not set | optional, decrypt only: comma-separated base64 keys of exactly 32 bytes, each different from `MFA_ENCRYPTION_KEY` (decision 0008, section 8) |
| `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` | server; social sign-in (A2-T6) | not set (`env:sync` never writes them: not secrets) | not set | optional in every tier (api-divergences D-068): comma-separated client ids, each `^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$` and unique; the `aud` allow-list of the provider; an unset or empty list disables the provider, whose routes answer `NOT_FOUND` (decision 0008, section 11) |
| `LOG_LEVEL` | logging | optional | optional | pino level, default `info` |
| `TRUST_PROXY_HOPS` | server (Express `trust proxy`, applied in `main.ts`); throttling (A1-T7) | not set → default `0` (no proxy in front of `pnpm dev:api`) | `1` in the Docker `apps` profile (Caddy), set by `compose.apps.yaml` | `0` or `1`, any other value refused; `dev`/`test`: optional, default `0`; `demo`/`prod`: required (`1`, Caddy the only hop) (decision 0007, section 5) |
| `TEST_DATABASE_NAME` | API integration tests only (A0-T9), **not read by `loadConfig`** | optional, not printed → default `kd_scratch` | not set | replaces the database name of `DATABASE_URL_MIGRATOR` and `DATABASE_URL_APP`; must start with `kd_`, contain `scratch` or `test`, and differ from the database of those two URLs; the suite refuses to run unless `APP_ENV` is `dev` or `test` |

**Database URL rule:** a process that sees both `DATABASE_URL` and its host-side name (`DATABASE_URL_APP` for the server, `DATABASE_URL_MIGRATOR` for the CLI) fails as ambiguous, so it can never connect with the wrong role by accident.

## 3. The env file

- **Location and mode:** one file, the repository root `.env`, mode `600`, git-ignored, written by root `pnpm env:sync` under `umask 077`.
- **Content:** two blocks.
  1. The output of the Docker repository's `scripts/print-env.sh`, replaced on every sync. How the Docker repository is located follows M1/M2.
  2. A block between the markers `# >>> kd monorepo (kept by env:sync)` and `# <<< kd monorepo`, created once and kept across syncs: `PORT=3001`, a dev-only ES256 key pair and key id, and an `OTP_HMAC_SECRET`. They are generated with `node:crypto`.
  - `env:sync` is written by the bootstrap task, not here.
- **How each consumer finds it:**
  - `apps/api` scripts: `node --env-file-if-exists=../../.env dist/main.js` and `node --env-file-if-exists=../../.env dist/cli.js <cmd>`. pnpm runs scripts from the package folder, and the path is relative to the current directory [S4].
  - Environment variables already set win over the file [S4], so CI and one-off overrides need no file edit.
  - The image's own commands (`node dist/main.js`, `node dist/cli.js migrate`) pass no `--env-file`: the image has no `.env` (section 9).
  - `tools/seed` and the API integration tests use the same flag or `process.loadEnvFile`, from their own folder.
  - **`apps/admin` and `apps/mobile` never read the root `.env`:** it holds server secrets, and anything a client bundle reads is public. Client configuration per tier is decided in their own slices.

## 4. Config validation

- **No `@nestjs/config`** [S6]. One pure function, `loadConfig(env, process: 'server' | 'cli')` in `apps/api/src/config/`:
  - applies the mapping rules of section 2;
  - validates with `class-validator` and `class-transformer` (`plainToInstance` with `enableImplicitConversion`, `validateSync` with `skipMissingProperties: false`) [S6];
  - returns a frozen, typed object, which Nest receives as a provider.
  - The CLI calls the same function without booting Nest.
  - The two libraries are needed by the validation pipe anyway [S9]: no new dependency for config.
- **Failure:** validation runs before `NestFactory.create`. On failure the process:
  - writes one line per offending variable to stderr (the name and the rule broken, for example `DATABASE_URL_APP: required`);
  - **never prints a value**, not even a partial or masked one;
  - exits with code 1 (server) or 3 (CLI, section 8).
  - The config object is never logged.
- **Scope rule:** validate only what code uses today. P4-T1 validates `APP_ENV`, the database URL and `PORT` (plus `LOG_LEVEL`); the CLI validates `APP_ENV` and the database URL. Each slice adds its own variables with the code that reads them. A variable in `.env` that no code reads is ignored, not rejected.
- **Pins** (recorded in 0001 by P4-T1): `class-validator` 0.15.1, `class-transformer` 0.5.1, `reflect-metadata` 0.2.2 [S9].

## 5. `APP_ENV` and the production guard

- **Values:** `dev`, `test`, `demo`, `prod`. Required, no default. `NODE_ENV` is not used to choose behaviour.
- **Each adapter declares its kind:** `real` (SES, AWS S3, Amazon Location; the deferred `manual` invoice adapter), `emulator` (SMTP to Mailpit, S3 with an endpoint override) or `fixture`.
- **Guard rules**, checked after config validation and before the server listens:
  - `APP_ENV=prod` and any port bound to an `emulator` or `fixture` adapter → refuse to boot (ADR-0004).
  - `APP_ENV=prod` with `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY` or `STORAGE_S3_SECRET_KEY` set → refuse to boot.
  - `APP_ENV=test` and any port bound to a `real` adapter → refuse to boot (M4: `test` only with emulators).
  - `demo` and `prod` accept only adapters named explicitly (section 2).
- **Production-guard rule:** the guard and its test ship **in the first commit that binds a port to an adapter** (slice 1 or earlier). The test asserts that every adapter kind is refused or accepted per tier. Until then no adapter exists, and no task under this record may bind one.

## 6. Module layout (layout only, no code now)

```
apps/api/
  src/
    main.ts                    # loadConfig → guard → NestFactory.create → configureApp → listen
    cli.ts                     # → dist/cli.js (section 8)
    app.module.ts
    configure-app.ts           # prefix, versioning, pipes, filters (0004)
    config/                    # loadConfig, env classes, production guard
    database/                  # data-source.ts, migration runner, preflight (section 7)
    openapi/generate.ts        # 0004
    common/                    # cross-cutting: guards, decorators, filters, pipes, logging
    modules/<feature>/
      <feature>.module.ts
      <feature>.controller.ts  # customer routes; admin-<feature>.controller.ts for /admin routes
      <feature>.service.ts
      dto/<name>.dto.ts        # the only files the Swagger plugin scans (0004)
      entities/<name>.entity.ts
      ports/<name>.port.ts               # only in modules that own a port: mail, media, geo
      adapters/<adapter>/<name>.<adapter>.adapter.ts
      <file>.spec.ts           # unit test next to the file it tests
  test/integration/<feature>.int-spec.ts  # real PostgreSQL, run serially (0002)
  migrations/NNNN_description.sql
```

- **Ports:**
  - A port is an interface plus an injection token in the owning module (`MailPort` in `mail`, `StoragePort` in `media`, `GeocodePort` in `geo`).
  - The module exports the token, and other modules inject the token, never an adapter class.
  - The module picks the adapter from config with a factory provider, and records the adapter's kind for the guard (section 5).
- **Feature module rules:**
  - A feature module exports services, never repositories.
  - Cross-module reads go through the owning module's service.
  - Module names follow scaffold-plan section 4.

## 7. Database access and migrations

- **One `DataSource` definition:** `apps/api/src/database/data-source.ts` exports `createDataSourceOptions(config)`.
  - The server uses it through `TypeOrmModule.forRootAsync`; the CLI builds a `DataSource` from the same function.
  - `synchronize: false`, `migrationsRun: false`, no `migrations` entries. Entities are listed explicitly, not globbed.
- **Migration format: plain `.sql` files with a small runner** that runs on the shared `DataSource`'s `QueryRunner`.
  - Rejected: TypeORM migration classes that wrap `.sql` files. They add one class per file, a second tracking convention and a loader that depends on the build output, and give nothing that the hand-written SQL needs.
- **Files:**
  - `apps/api/migrations/NNNN_description.sql`: four digits, `snake_case` description (for example `0001_initial_schema.sql`).
  - Copied into the image next to `dist/`.
  - Never edited after merge; a fix is a new file.
- **Runner:**
  - Takes a session advisory lock, so a second runner waits and then finds nothing to do.
  - Records `(version, name, sha256, applied_at)` in `public.schema_migrations`.
  - Refuses (exit 4) when an applied file's checksum changed, when an applied file is missing, or when a pending file sorts below the last applied one.
  - Runs each pending file in its own transaction. A file whose first line is `-- kd:no-transaction` runs outside a transaction (for `CREATE INDEX CONCURRENTLY`).
- **Roles:**
  - `kd_migrator` runs migrations and is the only role with DDL.
  - `kd_app` never runs DDL.
  - Each migration that creates a table writes that table's `GRANT`s to `kd_app` explicitly (append-only tables get `INSERT` only; data-model Conventions).
- **Preflight, run by `migrate` before anything else** (exit 4 on failure, one line per failed check):
  1. `current_user` is `kd_migrator`.
  2. Server major version 18 (`server_version_num` in `[180000, 190000)`).
  3. The extensions `postgis`, `pg_trgm`, `unaccent` and `citext` are installed in schema `public`. The four names come from ADR-0001 and data-model Conventions; creating them stays with the database provisioning (the Docker repository and the cloud tier), **not verified** against the Docker repository's init scripts here.
  4. `to_regprocedure('uuidv7()')` is not null.

## 8. CLI: `dist/cli.js`

- **Parser:** `node:util` `parseArgs` with `strict: true` and `allowPositionals: true` [S5]. It is the smallest option and adds no dependency.
- **Subcommands:**
  - `migrate` (now).
  - `ops` (later; the operational commands of later slices).
  - No `seed`: seeding belongs to `@kd/seed` (contradiction 6).
  - The CLI never boots the Nest application.
- **`API_MIGRATE_CMD` default confirmed:** `node dist/cli.js migrate`. Idempotent: a second run applies nothing and exits 0.
- **`API_SEED_CMD` default changed** to `node seed/dist/cli.js`, run from `/app`. The Docker repository appends the mode and `--commit`, so the seed tool's command line is `<reference|business|demo> [--commit]`.
  - It keeps the Docker contract: a dry run by default; `demo` refused unless `APP_ENV=dev`; run as `kd_migrator` in the `migrate` service.
  - It applies the database URL rule of section 2 itself (`DATABASE_URL` in a container, `DATABASE_URL_MIGRATOR` on the host, both set → error), because 0003 forbids importing the API's `loadConfig`.
  - It uses the exit codes of the table below.
  - The seed slice implements it.
- **Exit codes:**

| Code | Meaning |
|---|---|
| 0 | success, including "nothing to apply" |
| 1 | runtime failure: connection lost, SQL error (the failing file's transaction is rolled back), unexpected error |
| 2 | usage: unknown subcommand, option or argument |
| 3 | configuration invalid (section 4) |
| 4 | preflight or integrity check failed (section 7) |

How these codes line up with the Docker repository's own script exit codes (its 4.1) is **not verified** (not in this task's reading list).

## 9. Container contract of the API image

- **Port:** listens on `0.0.0.0:3000` (`PORT` default).
- **User:** runs as a non-root user (the `node` user of the official image); no write access to the application files.
- **Tools:** `node` and `sh` on the `PATH`; **no `curl` and no `wget`**. The health check uses `node -e "fetch(...)"` (`api-contract.md`). Base image: a Debian `-slim` variant of the official Node 26.13.0 image, because Alpine's BusyBox provides `wget`. The exact tag, and the absence of `curl`/`wget` in it, are confirmed in the Dockerfile task with `hadolint` (**not verified**).
- **Working directory:** `/app`, holding `dist/`, `migrations/`, `package.json` and production `node_modules`, plus `seed/` (the `@kd/seed` build with the `@kd/seed-data` fixtures it reads and their production dependencies; contradiction 6).
  - The same image runs in every tier (ADR-0004), so the seed fixtures ship to `prod` as well. They must hold no personal data, and `demo` stays refused outside `dev`.
- **Commands:** `CMD ["node", "dist/main.js"]`; migrations with `node dist/cli.js migrate`; seeding with `node seed/dist/cli.js <mode> [--commit]`.
- **Health:** `GET /api/health` (section 1).
- **Shutdown:** `enableShutdownHooks()`; SIGTERM closes the HTTP server, the gateway and the `DataSource`.
- **No secrets inside:** no `.env` and no secret in the image. `.dockerignore` excludes `.env*`; configuration comes only from the environment.
- **Platforms:** `linux/amd64` and `linux/arm64` (`api-contract.md`).

## 10. API dev port on the host

**Choice: `3001`**, written to the root `.env` by `env:sync`.

- It is not one of the slot-2 ports (3020, 3025, 8020, 8045, 8050, 9020, 9025, 1045, 1050, 5452, 5457), nor the container port 3000.
- Every port in that list ends in 0 or 5. If other slots follow the same pattern (**not verified**; the slot scheme was not in this task's reading), a port ending in 1 cannot collide with any slot.
- The admin dev server proxies `/api` and `/socket.io` to `http://127.0.0.1:3001` (written in its own slice).

## 11. Logging

- **Integration:** `nestjs-pino` 5.3.1 with `pino-http` 11.0.0 and `pino` 10.4.0 (0001) [S8]. `NestFactory.create(..., { bufferLogs: true })`, then `app.useLogger(app.get(Logger))` before `listen()` [S7]. JSON to stdout in every tier; no pretty transport in the image.
- **Request log rule:**
  - A custom `req` serializer logs only `id`, `method` and a sanitized `url` [S7]. No headers and no bodies are logged.
  - In the query string, `lat` and `lng` (and `latitude`, `longitude`) are rounded to 2 decimals (about 1 km), and `token` and `code` values are replaced with `[redacted]`.
  - Application code that logs coordinates follows the same rounding.
  - The response logs `statusCode` and `responseTime`.
  - `GET /api/health` is excluded through `autoLogging` [S7].
  - The request id comes from `genReqId`: an incoming `X-Request-Id` if it is a UUID, otherwise a new UUID.
- **Redaction list** (pino `redact`, censor `[redacted]`):
  - headers: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`;
  - fields: `*.password`, `*.currentPassword`, `*.newPassword`, `*.passwordHash`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.idToken`, `*.secret`, `*.privateKey`, `*.apiKey`, `*.otp`, `*.databaseUrl`.
  - `*.` matches one level, so application logs pass flat objects.
  - Each slice adds the names it introduces (for example the email-code field of auth).
- **Sentry** (ADR-0001) is added by its own task and applies the same scrubbing in `beforeSend`.
- **Pins** (recorded in 0001 by P4-T1): `nestjs-pino` 5.3.1, `pino-http` 11.0.0.

## Consequences

- **P4-T1 (API scaffold):**
  - ESM and the `tsc` builder (section 0);
  - `main.ts`, `cli.ts` with `migrate`, `configure-app.ts`;
  - `loadConfig` with the minimal variables;
  - the `DataSource` options, the migration runner and the preflight;
  - logging;
  - the pins of sections 4 and 11 recorded in 0001.
  No adapter and no port binding.
- **P4-T4:** the health controller of section 1.
- **Bootstrap task (M2):** `env:sync` with the two blocks, `umask 077`, and the generated dev secrets.
- **Dockerfile task:** the contract of section 9, including `/app/seed/`, checked with `hadolint`.
- **Seed slice:** `node seed/dist/cli.js` with the command line, exit codes and URL rule of section 8.
- **Docker repository (through P6-T4):** the `API_SEED_CMD` default in `scripts/seed.sh` and `api-contract.md` changes to `node seed/dist/cli.js`.
- **Slice 1, or the first commit that binds a port:** the production guard and its test (section 5).
- **P6-T4:** fixes the documents in the table at the top, after the owner's answers.
- **Revisit triggers:**
  - a second API instance (the advisory lock and in-process jobs stay valid, but throttling and Socket.IO need a shared store, ADR-0004);
  - seeding needs code from `apps/api` (then option (a) of contradiction 6 is reconsidered in a new record);
  - the Docker repository changing a 4.3 name (a major version bump there, and a mapping change here only).
