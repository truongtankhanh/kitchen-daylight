# 0007. API platform libraries and rules

Status: **proposed** (A0-T1, 2026-11-05). The open questions and every row marked **owner** were answered on 2026-11-05: the owner delegated them to the recommendations, which section 11 records with the evidence behind each. Acceptance (the status change) stays with the owner. Fixes the libraries and the rules that every API slice builds on: logging and throttling packages, the integration HTTP client, the test-time rule for decorators, throttling placement and client IP, pagination and cursors, optimistic concurrency, ids, time, money and entity mapping, the error body and status table, idempotency, where the cross-cutting pieces live, and the rules of the API track. Records the 2026-11-05 amendment of decision 0005 section 8 (`seed demo`). Not done here: no package installed, [0001](0001-toolchain-versions.md) not edited, no code, no migration. The numbers of authentication (token lifetimes, lockout, throttle figures) belong to decision 0008 (A1-T1).

## Contradictions and tightenings

Each row names a document that this record contradicts (**C**) or makes stricter (**T**). The documents themselves are not edited by the API track: a row that is built logs a divergence in [api-divergences.md](api-divergences.md) (section 13). Rows marked **owner** needed an answer before acceptance; "answered" gives the date (section 11).

| # | Kind | Document | It says | This record says |
|---|---|---|---|---|
| 1 | T, **owner** (answered 2026-11-05) | [data-model.md](../data-model.md), "Rules enforced in the database", unique constraints; [api-outline.md](../api-outline.md), Conventions, "Idempotency" | idempotency is stored only as unique (`customer_id`, `idempotency_key`) and (`created_by`, `idempotency_key`) on `orders`; `POST /reservations`, `POST /admin/orders` and `POST /admin/users/{id}/points` take the header too, with no storage named (data-model open item M20) | One table `idempotency_keys` serves every operation (section 10). It is created by the first task that needs it. The `orders` unique constraints stay as the database backstop |
| 2 | T, **owner** (answered 2026-11-05) | api-outline, Conventions, "Idempotency" | a repeat "returns the original result (`200` with the same body)" | The stored response is a non-personal reference (resource type, id, status code). A repeat returns `200` with the resource **as it is now**, read under the caller's authorization, not a byte copy of the first body (section 10) |
| 3 | C, **owner** (answered 2026-11-05) | data-model, `outbox_events` row | columns `id`, `type`, `entity_type`, `entity_id`, `version`, `audience`, `branch_id`, `audience_user_id`, `created_at`, `published_at`; "no personal data or record content" | api-outline "Realtime" gives payloads (`{ orderId, status, rowVersion }`, `{ branchId, itemId, isAvailable, soldOut, stockQty?, rowVersion }`, `keys[]`, counts, actor ids). They need a `payload jsonb NOT NULL` column holding ids, statuses, versions and counts only, never a name, phone, address or free text. Added by the realtime slice's migration |
| 4 | T, **owner** (answered 2026-11-05) | data-model, `audit_logs` row | "`action` is a code from one catalogue of 21 codes shared by server and UI"; the 21 codes are never listed | The catalogue is the string-literal union `AuditAction` in `@kd/contracts`, `group.verb` lower case, grown by each slice that writes a row. The count of 21 is not a constraint |
| 5 | T | [foundation.md](../architecture/foundation.md), section 6.B | "`X-Powered-By: Express` is sent: a hardening item for a later slice" | Disabled in `configureApp` by the task that writes the cross-cutting pieces (A0-T3), so the integration app has it too (section 5; amended by A0-T13) |
| 6 | T, **owner** (answered 2026-11-05) | api-outline, Conventions, "Pagination" | cursor lists take `limit` "up to 50 (default 20; reviews 20, 50 or 100)" | The maximum is a per-list constant of the pagination helper: 50 by default, 100 for the review lists, as the design asks (brief V10). A list raises it only through a row of section 6 |
| 7 | T | api-outline, "Pagination" and field code `INVALID_CURSOR` | "a malformed or expired cursor" | Defined: a cursor is unsigned, versioned and bound to the list's filters. "Expired" means an unsupported version or a filter fingerprint that no longer matches (section 6) |
| 8 | T, **owner** (answered 2026-11-05) | api-outline, "Optimistic concurrency"; data-model, Conventions, "Optimistic concurrency" | `STALE_VERSION` carries `current { rowVersion, updatedBy { id, name }, updatedAt }`; `updated_by` exists only on `app_settings` and `email_templates` | Every table with `row_version` also gets `updated_by` (nullable reference to `users`, null for a system change), in the migration that creates the table. Without it `updatedBy` cannot be answered |
| 9 | T | data-model, Conventions, "Optimistic concurrency" | `row_version` on editable records; who increments it is not said | A `BEFORE UPDATE OF <editable columns>` trigger increments it (section 8). Entities never use TypeORM's `@VersionColumn` |
| 10 | T | data-model, Conventions, "Time zone" | `Asia/Ho_Chi_Minh` "as configuration, not a column" | One exported constant in code, not an environment variable (section 8) |
| 11 | T, **owner** (answered 2026-11-05) | api-outline, "Error code catalogue (stable)" | 18 codes "unchanged from v2" have no HTTP status | Status table in section 9 |
| 12 | T | api-outline, "Rate limits" | "`429` carries `Retry-After`" | `@nestjs/throttler` names the header `Retry-After-<name>` for a throttler not named `default` [S6]. The problem+json filter always sets plain `Retry-After` on `429` (section 5) |
| 13 | T, **owner** (answered 2026-11-05) | api-outline, "Errors" | `type`, `title`, `status`, `detail`, `code`, `errors[]` | `type` is `about:blank` and `title` the HTTP reason phrase [S9]; every response echoes `X-Request-Id` as a header (sections 4 and 9) |
| 14 | T, **owner** (answered 2026-11-05) | api-outline, "Error code catalogue", field-level codes | no code for a malformed header value | New field code `INVALID_FORMAT` for a malformed `Idempotency-Key` (section 10) |
| 15 | T | data-model, `email_tokens` row | columns end at `expires_at`, `used_at`; no `created_at` listed | The 60 s resend rule reads the issue time `created_at`, which the Conventions require on every mutable table (`attempts` is updated). The auth task creates the column (section 5) |
| 16 | T | data-model, Conventions, "Money" | "integer VND, never floating point" | PostgreSQL `integer` per stored amount; aggregates come back as `bigint` and go through one safe-integer helper (section 8) |
| 17 | T | [0001](0001-toolchain-versions.md), evidence table | `pino` 10.4.0 row only; [0005](0005-api-foundation-conventions.md) section 11 names `nestjs-pino` 5.3.1 and `pino-http` 11.0.0 | A0-T2 (the task that installs logging) adds rows for `nestjs-pino` and `pino-http` and closes the pino "Node 26 support" item; the throttling task adds `@nestjs/throttler` (section 1) |
| 18 | C (decided 2026-11-05, "OK all") | 0005 section 8; Docker repository `scripts/seed.sh` and `api-contract.md` | "`demo` refused unless `APP_ENV=dev`" | `seed demo` runs when `APP_ENV` is `dev`, `test` or `demo` and is refused in `prod` (section 12) |
| 19 | T, **owner** (answered 2026-11-05) | data-model, "Personal data lifecycle" (`audit_logs` 24 months); "Rules enforced in the database" | the application role has `INSERT` only on append-only tables | `kd_app` still gets no `DELETE`. The purge is a `SECURITY DEFINER` function owned by `kd_migrator` with the 24-month cutoff fixed inside it; `kd_app` may only `EXECUTE` it, from the nightly job. Built in A12-T1 (section 11, answer 5) |
| 20 | T | Docker repository `compose.apps.yaml` (`api` service) and `docs/api-contract.md` | no proxy setting; the `api` service sits behind Caddy (`reverse_proxy api:3000`) | The `api` service sets `TRUST_PROXY_HOPS: "1"` when the throttling task ships (section 5); text for the owner in section 5 |

## Context

- [0005](0005-api-foundation-conventions.md): ESM and the `tsc` builder, `Relation<T>` (section 0); `common/` for guards, decorators, filters, pipes and logging (section 6); one `DataSource`, hand-written SQL migrations, `kd_migrator` and `kd_app`, preflight with `uuidv7()` (section 7); `nestjs-pino` 5.3.1 with `pino-http` 11.0.0 and the request-id and redaction rules (section 11); a second API instance is a revisit trigger.
- [0001](0001-toolchain-versions.md): `pino` 10.4.0 with "Node 26 support: to confirm by the task that installs pino"; `vitest` 5.1.0 on `vite` 8.3.5; `class-validator` 0.15.1; `@nestjs/swagger` 12.1.0; NestJS 12.3.2; Node 26.13.0.
- [0004](0004-contract-and-client.md) sections 6 and 7: realtime event types and `ProblemDetails`/`FieldError` hand-written in `@kd/contracts`; the `code` union "is added by the error-handling slice".
- [ADR-0003](../adr/0003-authentication.md) "Abuse protection" and [ADR-0004](../adr/0004-aws-hosting.md) "Rate limiting": one API instance per tier, in-process throttling strict on auth paths plus per-account counters in PostgreSQL; a shared layer (AWS WAF or Redis) before a second instance.
- [api-outline.md](../api-outline.md) Conventions and the error catalogue; [data-model.md](../data-model.md) Conventions, "Rules enforced in the database", `outbox_events`, `audit_logs`; [testing-strategy.md](../testing-strategy.md) working rules and levels; [foundation.md](../architecture/foundation.md) section 5 ("Throttling: place not decided by a record").
- Code today: [health.controller.ts](../../apps/api/src/health/health.controller.ts) injects with `@Inject(HealthService)`; [configure-app.ts](../../apps/api/src/configure-app.ts) sets the prefix and URI versioning only.

## Evidence

Read on 2026-11-05. Registry data from read-only `npm view <pkg> version peerDependencies engines dependencies license time --json`. Claims are cited as [S#] or marked **not verified**.

| ID | Source |
|---|---|
| S1 | Registry: `nestjs-pino` 5.3.1 (published 2026-10-02), peers `@nestjs/common` and `@nestjs/core ^11.0.8 \|\| ^12.0.2`, `pino ^10.0.0`, `pino-http ^11.0.0`, `rxjs ^7.1.0`; engines `node >=22.12.0`; no dependencies; MIT. Registry `latest` on the day |
| S2 | Registry: `pino-http` 11.0.0 (published 2025-10-04), depends on `pino ^10.0.0`, `pino-std-serializers ^7.0.0`, `get-caller-file`, `process-warning`; **no `engines` field**, no peers; MIT. `pino` 10.4.0 (published 2026-10-02): **no `engines` field**, no peers; MIT. Both registry `latest` |
| S3 | https://github.com/iamolegga/nestjs-pino: v5 "requires NestJS 11.0.8+ or 12.0.2+, pino 10, pino-http 11, and Node.js >=22.12"; Node 26 not mentioned; `useLogger` before `init()`/`listen()`, and since NestJS 12.1.1 `init()` flushes the buffer; v5 ships behind an `exports` map (no deep imports). A response header for the request id is **not documented** |
| S4 | https://github.com/pinojs/pino README: "built to run on Node.js", no version list; `docs/lts.md` lists 9.x (Node 18, 20, 22) as newest and has **no 10.x row**. pino 10 on Node 26: **not verified** by any page |
| S5 | Registry: `@nestjs/throttler` 6.7.1 (published 2026-09-24), peers `@nestjs/common` and `@nestjs/core` `^7.0.0 … \|\| ^12.0.0` (12.3.2 satisfies), `reflect-metadata ^0.1.13 \|\| ^0.2.0` (0.2.2 satisfies); engines `node ^20.19.0 \|\| ^22.12.0 \|\| >=24.0.0` (26.13.0 satisfies); no dependencies; MIT |
| S6 | https://docs.nestjs.com/security/rate-limiting: named throttlers as an array of `{ name, ttl, limit }`; `@SkipThrottle()` and `@Throttle()` take objects keyed by throttler name (`default` when unnamed); custom tracker by overriding `getTracker()` in a `ThrottlerGuard` subclass or a `getTracker` option; "The built-in storage is an in-memory cache"; a custom `storage` implements `ThrottlerStorage`; `ttl` and `blockDuration` in milliseconds, `seconds()` etc. helpers; behind a proxy "configure the HTTP adapter to trust the proxy" (Express `trust proxy`). Source https://github.com/nestjs/throttler/blob/master/src/throttler.guard.ts: default tracker `normalizeIp(req.ip, this.ipv6SubnetPrefix)`; on block it sets `` `Retry-After${getThrottlerSuffix(name)}` ``, with suffix `''` for `default` and `-<name>` otherwise; `X-RateLimit-Limit`, `-Remaining`, `-Reset` only on allowed requests. The HTTP status of `ThrottlerException` is **not stated** on either page |
| S7 | https://expressjs.com/en/guide/behind-proxies.html: `trust proxy` default `false` ("the client's IP address is derived from `req.socket.remoteAddress`"); a number `n` means "the address that is at most `n` number of hops away", read from `X-Forwarded-For` right to left; `0` means no reverse proxy; `req.ip`/`req.ips` start "at the first untrusted address" |
| S8 | https://nodejs.org/api/globals.html (v26.13.0): `fetch` "No longer experimental" since v21.0.0; implementation "based upon undici". Registry: `supertest` 7.3.1 depends on `superagent ^10.3.0`, `methods`, `cookie-signature`; `@types/supertest` 7.2.1 depends on `@types/superagent`, `@types/methods` |
| S9 | https://www.rfc-editor.org/rfc/rfc9457.html: `type` absent "is assumed to be "about:blank""; "When "about:blank" is used, the title SHOULD be the same as the recommended HTTP status phrase for that code"; extension members allowed and "Clients … MUST ignore any such extensions that they don't recognize"; media type `application/problem+json` |
| S10 | https://vitest.dev/guide/, /guide/migration and /config/ (v5.1.0): **no statement** about the TypeScript transformer, decorators or `emitDecoratorMetadata`; "Since Vitest uses Vite config, you can also use any configuration option from Vite" |
| S11 | https://vite.dev/config/shared-options (v8.3.4): "transformation by Oxc is applied to `ts`, `jsx` and `tsx` files"; the `esbuild` option is "Deprecated … converted to `oxc` option internally". Whether tsconfig `experimentalDecorators`/`emitDecoratorMetadata` are read: **not stated** |
| S12 | https://oxc.rs/docs/guide/usage/transformer/typescript: legacy decorators with `decorator.legacy: true`, metadata with `decorator.emitDecoratorMetadata: true`; "Oxc transformer will fallback to `Object` type if it cannot calculate the type of the decorator metadata", and its output can differ from `tsc` |
| S13 | https://www.rfc-editor.org/rfc/rfc9110.txt, section 15.5.22: 426 means the server "refuses to perform the request using the current protocol but might be willing to do so after the client upgrades to a different protocol. The server MUST send an Upgrade header field in a 426 response to indicate the required protocol(s)". Section 10.2.3: the `Retry-After` value "can be either an HTTP-date or a number of seconds" |
| S14 | Local probe, 2026-11-05, on Node **26.13.0** (undici 8.12.2) and 24.22.2 (undici 7.30.1): a script started `node:http` on `127.0.0.1:0` and called it with the global `fetch`. The server received the `Origin`, `Cookie` and `X-Forwarded-For` headers the request set, and `response.headers.getSetCookie()` returned both `Set-Cookie` values, attributes included (`HttpOnly`, `Path`, `SameSite=Strict`). Nothing was installed |
| S15 | https://caddyserver.com/docs/caddyfile/directives/reverse_proxy, "Defaults": "It sets or augments the X-Forwarded-For header field"; "by default, the proxy will ignore their values from incoming requests, to prevent spoofing"; `trusted_proxies` is a server option, unset by default |
| S16 | Docker repository, read only on 2026-11-05: `caddy/Caddyfile.dev` proxies `/api/*` and `/socket.io/*` with `reverse_proxy api:3000` and sets no `trusted_proxies`; `compose.apps.yaml` runs `caddy` (published on `127.0.0.1:${CADDY_PORT}`) in front of `api`, and also publishes `api` on `127.0.0.1:${API_PORT}`; neither file sets a proxy-hop variable |

## 1. Logging and throttling packages

| Package | Version (registry `latest`, 2026-11-05) | Fit | Row in 0001 |
|---|---|---|---|
| `nestjs-pino` | 5.3.1 | peers accept NestJS 12.3.2, pino 10, pino-http 11; engines `>=22.12.0` [S1, S3] | **missing**: A0-T2 adds it |
| `pino-http` | 11.0.0 | depends on `pino ^10.0.0`; no engines [S2] | **missing**: A0-T2 adds it |
| `pino` | 10.4.0 | no engines; no page states Node 26 [S2, S4] | exists; A0-T2 closes "Node 26 support" with the owner's run (the first log line of `pnpm dev:api` on Node 26.13.0) |
| `@nestjs/throttler` | 6.7.1 | peers accept NestJS 12.3.2 and `reflect-metadata` 0.2.2; engines accept 26.13.0 [S5] | **missing**: the throttling task adds it |

- The versions above are what the registry showed today. The installing task re-reads them, installs exact pins and records them in 0001 with source and date (0001 "Choice"). Nothing is installed by this record.
- All four go into `apps/api` only (one workspace package, decision 0003 section 3).

## 2. Integration HTTP client and the test-time decorator rule

**Options:**

| | A. Global `fetch` of Node 26 | B. `supertest` 7.3.1 |
|---|---|---|
| New dependency | none; stable since Node 21 [S8] | `supertest`, `superagent` and `@types/supertest` [S8] |
| How the app is reached | `await app.listen(0, '127.0.0.1')`, port from `app.getHttpServer().address()`, `app.close()` in `afterAll` | `request(app.getHttpServer())`, no listen |
| What it proves | the real socket, the real headers | the same handlers through a bound server |
| Cookies, `Origin`, `X-Forwarded-For` | sets them and reads every `Set-Cookie` with `getSetCookie()` on Node 26.13.0 [S14] | supported |

**Choice: A, `fetch`** (CLAUDE.md: no new dependency when the runtime provides it; answered 2026-11-05). One helper `test/integration/support/http.ts` starts the app on an ephemeral loopback port and returns a typed `fetch` wrapper.

- The staff refresh-cookie and `Origin` checks of A1 are covered by what [S14] showed, so no fallback is planned. `supertest` comes back only through a new record, if a later test needs something `fetch` cannot do.
- Integration specs stay serial (`--maxWorkers=1 --no-file-parallelism`, CLAUDE.md), so ephemeral ports never race.

**Rule for code under test (decorator metadata).** Vitest 5 runs on Vite 8, which transforms TypeScript with Oxc [S10, S11]. Oxc emits decorator metadata only when configured, and falls back to `Object` when it cannot compute a type [S12]. Whether Vite passes tsconfig's decorator flags to Oxc is not stated [S11], and the Vitest pages say nothing about it [S10]. So no code may depend on emitted metadata:

- Every constructor parameter of a provider, controller or guard uses an explicit `@Inject(Token)`, as [health.controller.ts](../../apps/api/src/health/health.controller.ts) does.
- Every TypeORM column states `type` and `name` explicitly (section 8); every relation names its target with a function.
- Every DTO property that is not a string uses an explicit `@Type(() => Number | Boolean | Date | Class)` from `class-transformer`; `enableImplicitConversion` is not relied on, because it reads `design:type`.
- **Not verified:** the exact Oxc options in effect in `apps/api`'s Vitest config (the config was not in this task's reading). The rule above makes the answer irrelevant.

## 3. Placement of the cross-cutting pieces

| Piece | Location | Notes |
|---|---|---|
| Validation pipe, problem+json filter, `ApiError` | `apps/api/src/common/errors/` | registered as the global providers `APP_PIPE` and `APP_FILTER` of `AppModule`, so the filter injects the logger (amended by A0-T13); typed with `ProblemDetails` and `ErrorCode` from `@kd/contracts` |
| Logging (request serializer, redaction, request id) | `apps/api/src/common/logging/` | `LoggerModule` wired in `app.module.ts`; `bufferLogs` in `main.ts` (0005 section 11) |
| Pagination (offset and cursor helpers, `estimatedTotal`) | `apps/api/src/common/pagination/` | section 6 |
| Time (`BUSINESS_TIME_ZONE`, Vietnam-date helpers) | `apps/api/src/common/time/` | section 8 |
| Idempotency (`begin`, `complete`, header pipe) | `apps/api/src/common/idempotency/` | section 10; its table arrives with the first task that needs it |
| Auth guards and decorators (`@Public()`, roles, branch scoping) | `apps/api/src/common/auth/` | the `auth` module owns tokens and codes |
| Throttling (guard subclass with the tracker) | `apps/api/src/common/throttling/` | section 5 |
| Outbox writer, relay and Socket.IO gateway | `apps/api/src/modules/realtime/` | event types in `@kd/contracts` (0004 section 6) |
| Audit writer | `apps/api/src/modules/audit/` | `AuditAction` union in `@kd/contracts` (row 4) |

`common/` holds no entity and no migration; a table used by a `common/` piece (idempotency) is created by the slice that first needs it (section 13).

## 4. Logging rules added to 0005 section 11

- `X-Request-Id` is echoed on every response, with the id that `genReqId` chose (0005 section 11). It is a UUID, never personal data, and lets a user or a support message quote the failing request, which the log then finds by `req.id` (answered 2026-11-05). It is a response header, not a member of the problem body. An incoming `X-Request-Id` that is not a UUID is replaced, never echoed (0005 section 11).
- The packages and pins are those of section 1; the rest of 0005 section 11 stands.

## 5. Throttling

**Where it lives:** in-process, `@nestjs/throttler` with its built-in memory store [S6], one global guard (a `ThrottlerGuard` subclass in `common/throttling/`). Per-account counters live in PostgreSQL. This is valid only while each tier runs one API instance (ADR-0003, ADR-0004).

| Counter | Store | Key | Owner task |
|---|---|---|---|
| Request rate per client (all routes; strict on `/auth/*` and `/admin/auth/*`) | memory | client IP (`req.ip`, IPv6 normalised by the guard [S6]) | the throttling task; figures in 0008 |
| Business limits per user (order creation, voucher validation, reservation creation; `ordering` settings) | memory | acting user id from the token (`user:<sub>`), never a body field | the slice that owns each endpoint |
| Failed password attempts and lock | PostgreSQL | `users.failed_login_count`, `users.locked_until` | auth (A1) |
| Wrong email-code guesses | PostgreSQL | `email_tokens.attempts` against `max_attempts` | auth (A1) |
| Resend of a code or staff email, once per 60 s per person | PostgreSQL | issue time `created_at` of the newest `email_tokens` row of that user and type (row 15) | auth (A1) |

- **Named throttlers:** `default` (lenient, every route) and `auth` (strict, on the auth controllers through `@Throttle({ auth: … })`); the figures are 0008's. `ttl` and `blockDuration` are milliseconds, written with the `seconds()`/`minutes()` helpers [S6].
- **`429` body and header:** the problem+json filter maps `ThrottlerException` to `429 RATE_LIMITED` and sets plain `Retry-After` (delay-seconds) from the `Retry-After-<name>` header the guard set [S6]. The `X-RateLimit-*` headers stay at their defaults.
- **Restart:** a restart empties the memory counters. Accepted: the per-account counters that protect accounts are in PostgreSQL.

**Client IP behind Caddy:**

Answered 2026-11-05, from [S7], [S15] and [S16]:

- Express `trust proxy` is set from one integer variable, **`TRUST_PROXY_HOPS`**: `0` or `1`, any other value fails validation. With `0` (the Express default) `req.ip` is the socket address [S7].
  - `dev` and `test`: optional, default **0**. The process run on the host (`pnpm dev:api`, port 3001) has no proxy in front and uses 0.
  - `demo` and `prod`: **required**, like the `*_ADAPTER` variables (0005 section 2), so a tier can never start with a silent default. Both run Caddy as the only hop (ADR-0004 section 1), so the value is **1**.
  - Docker `apps` profile: **1**. Caddy is the only hop there [S16].
- **Why 1 is safe behind Caddy:** Caddy ignores the `X-Forwarded-For` a client sends and writes the address it saw [S15]. With one trusted hop, Express takes the right-most entry of that header [S7], which is the client address Caddy wrote. A value higher than the real hop count would let a client pick its own IP with a forged header and defeat the limiter, so 2 or more is refused.
- **Why the variable must stay 0 without Caddy:** with 1 and no proxy, a client's forged `X-Forwarded-For` would become `req.ip`. The `apps` profile also publishes the API directly on `127.0.0.1:${API_PORT}` [S16]; that path is loopback-only, so a forged header there can only come from the developer's own machine. In `demo` and `prod` the API port is never published: only Caddy listens (security group 80/443, ADR-0004).
- **Without the setting**, every request in the `apps` profile would carry Caddy's address, so one client hitting the auth limit would block everyone. The Docker change therefore ships together with the throttling task.
- The variable is validated by `loadConfig` and added to decision 0005's table, `.env.example` and the schema by the task whose code reads it (0005 section 4 scope rule). It is applied in `main.ts`, not in `configureApp`, because the OpenAPI generator needs no network setting. `X-Powered-By` is disabled in `configureApp` instead (row 5; amended by A0-T13): the integration test app is built with `configureApp` and not with `main.ts`, so it checks the real header.
- **Text for the owner to apply in the Docker repository** (not edited here; row 20):
  - `compose.apps.yaml`, `api` service, `environment`: `TRUST_PROXY_HOPS: "1"`, with the comment "One proxy hop (Caddy) in front of the API; the API reads the client IP from X-Forwarded-For (kitchen-daylight decision 0007, section 5)."
  - `docs/api-contract.md`, container environment table: "`TRUST_PROXY_HOPS`: `1` behind Caddy, `0` (default) with no proxy; required in `demo` and `prod`."

**Blocking condition for scaling out (restated):** before the API runs a second instance in any tier, rate limiting moves to a shared layer, AWS WAF rate-based rules or a Redis-backed `ThrottlerStorage` [S6]. The memory store is never used with two instances.

## 6. Pagination

**Offset lists:**

- Query `page` (integer 1 to 10,000, default 1) and `pageSize` (integer 1 to the list's maximum, default 20). Out of range → `400 VALIDATION_FAILED`, `errors[].code = OUT_OF_RANGE`. The page cap keeps `OFFSET` a safe integer (`?page=1e300` is an integer to the validator); a list read deeper than that is a cursor list (amended by A0-T13).

**Maximum page size per list** (row 6). The helper takes the maximum as a constant per list; a list not named here uses 50.

| List | Maximum | Allowed values | Source |
|---|---|---|---|
| every list by default | 50 | 1 to 50 | api-outline "Pagination" |
| review lists (admin moderation, branch reviews) | 100 | 20, 50 or 100 | api-outline "Pagination" (reviews 20, 50 or 100) |
| searchable selects (`q`, `limit`, `ids[]`) | 20 | 1 to 20 | api-outline "Pagination" |
- Response `{ items, page, pageSize, total }`. A page past the end returns `items: []` with the real `total`.

**Cursor lists (orders, audit log, reviews, customer orders):**

- Query `cursor` (optional) and `limit` (integer 1 to the list's maximum, default 20; the table above). The mandatory date range of api-outline stays.
- Response `{ items, nextCursor, prevCursor, estimatedTotal: { value, capped } }`. `nextCursor`/`prevCursor` are `null` at the ends.
- **Order:** every cursor list sorts by its key columns and ends with `id` (UUIDv7) as the tie-breaker, so the order is total. The page is read with a keyset condition (`(sort, id) < ($1, $2)`), never `OFFSET`.
- **Timestamp sort keys are `timestamptz(3)`** (section 8): the `pg` driver reads a `timestamptz` as a JavaScript `Date`, which holds milliseconds, and the cursor encodes that `Date`. With microseconds in the column, the keyset condition would skip the rest of the boundary millisecond (descending) or repeat the boundary row (ascending). Amended by A0-T13 after the Phase A0 review.
- **`estimatedTotal`:** `SELECT count(*) FROM (SELECT 1 FROM … WHERE <same filters> LIMIT 1001) s`; `value = min(count, 1000)`, `capped = count > 1000`.

**Cursor format:** `base64url(JSON)` of `{ "v": 1, "d": "n" | "p", "k": [<sort values>, <id>], "f": "<fingerprint>" }`.

- `d` is the direction (next or previous page); `k` the key values of the boundary row; `f` the first 16 hex characters of the SHA-256 of the list's canonical filters and sort.
- **Unsigned.** The cursor carries only sort-key values, used as bound parameters. Authorization, branch scoping and the acting user are always re-applied from the token and the request, never read from the cursor. A tampered cursor can only move to another position of a list the caller may already read, so a signature would add a secret and its rotation for no protection.
- **Invalid cursor → `400 VALIDATION_FAILED`, `errors[] = [{ field: 'cursor', code: 'INVALID_CURSOR' }]`** when it is longer than 512 characters, not base64url JSON, of an unknown `v`, of the wrong key arity or types, or when `f` does not match the current filters ("expired", row 7). The screen returns to page 1 (api-outline).

## 7. Optimistic concurrency

- Editable records carry `rowVersion` (integer). A write sends the version it read; the service updates with `WHERE id = $1 AND row_version = $2`.
- Zero rows updated → `409 STALE_VERSION` with the member `current { rowVersion, updatedBy: { id, name } | null, updatedAt }` (row 8). `name` is the display name, never an email; `updatedBy` is `null` for a system change. A settings key also carries `value` (api-outline).
- An explicit overwrite ("Ghi đè") sends the current version it was shown and is audited by its slice.

## 8. Ids, time, money and entities

- **Ids:** `id uuid PRIMARY KEY DEFAULT uuidv7()` in every migration; no application generator (0005 contradiction 7). Entity: `@PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })`, so inserts omit the id and read it back. That TypeORM 1.1.2 returns the database default on insert is **to confirm** in the integration spec of the first entity.
- **Time:** every timestamp is `timestamptz`; a timestamp that is a cursor sort key is `timestamptz(3)` (section 6; amended by A0-T13, migration `0006` for `audit_logs.created_at`; api-divergences D-024), and its entity column declares `precision: 3`. Every database session runs with `TimeZone = 'UTC'`. How the session setting is applied (connection options or a preflight check) is decided and tested by the task that writes it; the mechanism is **not verified** here. Dates with no time of day are `date`.
- **Business time zone: one exported constant**, `BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh'` in `common/time/`. Reason: the zone defines stored values (`business_date`, the date in `order_number`, report days). A per-tier variable could make `test` and `prod` disagree on those values, and a change would need a data migration anyway, never a redeploy with a new value. No environment variable is added. SQL that needs a Vietnam date receives the constant as a parameter (`AT TIME ZONE $n`).
- **`row_version`:** `integer NOT NULL DEFAULT 1`, incremented by one trigger function written in A0-T5 and attached per table by the migration that creates the table: `BEFORE UPDATE OF <editable columns> … FOR EACH ROW`. The column list leaves out counters changed in the background (for example the branch rating counters), so a recalculation never makes a staff edit stale. Entities map it as a plain `integer` column, never `@VersionColumn`.
- **Money:** PostgreSQL `integer` (up to 2,147,483,647 VND per stored amount) with `CHECK (… >= 0)`. TypeORM maps `integer` to `number`. `bigint` is not used for stored amounts, because the `pg` driver returns it as a string. Aggregates (`SUM` returns `bigint`) are read through one helper that converts the string and throws unless `Number.isSafeInteger`.
- **Column naming:** explicit `name: 'snake_case'` on every `@Column`, `@JoinColumn` and `@PrimaryColumn`, with explicit `type` (section 2). No naming-strategy class: the entity then reads like its migration, line for line.
- **Relations:** `Relation<T>` on every relation property (0005 section 0).

## 9. Errors

- **Catalogue:** `@kd/contracts` exports the string-literal unions `ErrorCode` (the `code` member) and `FieldErrorCode` (`errors[].code`) from `src/errors.ts`, with `ERROR_STATUS`; `ProblemDetails<ErrorCode>` (`src/problem.ts`) uses them (0004 section 7; file name amended by A0-T13). Each slice adds its codes there in the same pull request as the code that returns them. A name never changes inside `v1`.
- **Body:** `Content-Type: application/problem+json`; `type: "about:blank"`; `title` = the HTTP reason phrase of `status` [S9]; `status`; `detail` a short English sentence with no personal data, no secret and no value from the request; `code`; `errors[]` only for `VALIDATION_FAILED`; code-specific members as api-outline lists them. Clients branch on `code`, never on `title` or `detail`.
- **Unknown errors:** `500 INTERNAL_ERROR`, `detail` generic; the stack goes to the log only.

**Status of the 18 codes "unchanged from v2"** (answered 2026-11-05):

| `code` | Status | Note |
|---|---|---|
| `VALIDATION_FAILED` | 400 | with `errors[]` |
| `CODE_INVALID` | 400 | wrong or dead email code; same answer for every cause |
| `UNAUTHENTICATED` | 401 | no or invalid token |
| `TOKEN_EXPIRED` | 401 | expired access token; the client refreshes |
| `INVALID_CREDENTIALS` | 401 | also the answer for an unknown email and a locked account (ADR-0003; figures in 0008) |
| `FORBIDDEN` | 403 | role or revenue visibility; never for another branch's id (that is `404`) |
| `EMAIL_NOT_VERIFIED` | 403 | |
| `ACCOUNT_SUSPENDED` | 403 | |
| `NOT_FOUND` | 404 | also an id outside the caller's branches |
| `STALE_VERSION` | 409 | with `current` (section 7) |
| `ALREADY_EXISTS` | 409 | |
| `IN_USE` | 409 | with `usage` or `reservations` |
| `UPGRADE_REQUIRED` | 400 | not 426: HTTP 426 asks the client to switch **protocol** and "MUST send an Upgrade header field" [S13], which an app-version check cannot honour. The trigger is the request's `X-App-Version`, a client input, so 400; clients branch on `code` |
| `RATE_LIMITED` | 429 | with `Retry-After` (section 5) |
| `MAINTENANCE` | 503 | with `Retry-After` when `expected_back_at` is set |
| `LAST_ADMIN` | 409 | the state forbids the change |
| `SELF_CHANGE` | 403 | an action not allowed on oneself, whatever the state |
| `REVIEW_EXISTS` | 409 | |

Every other code takes the status of the api-outline catalogue table (`409`, `422`, `403 MFA_REQUIRED`, `413`, `415`, `500`); `IDEMPOTENCY_CONFLICT` is `409` (section 10).

## 10. Idempotency

- **Header:** `Idempotency-Key`, 8 to 128 characters of `A-Z`, `a-z`, `0-9`, `-` and `_` (a UUID fits). Missing where required → `400 VALIDATION_FAILED`, `errors[] = [{ field: 'Idempotency-Key', code: 'REQUIRED' }]`; malformed → the same with `INVALID_FORMAT` (row 14).
- **Scope:** (operation, acting user, key). The operation is a constant per endpoint (`orders.create`, `reservations.create`, `admin.orders.create`, `admin.points.adjust`); the user comes from the token. The same key on two operations, or from two users, never collides.
- **Store (row 1):** one table `idempotency_keys`: `user_id`, `operation`, `key`, `request_hash` (SHA-256 of the canonical body), `resource_type`, `resource_id`, `response_status`, `created_at`, `expires_at`; primary key (`user_id`, `operation`, `key`). It holds a **reference, never a copy of the response**: no name, phone, address, price list or note.
- **`begin` runs inside the business transaction**, first: it inserts the row. A concurrent request with the same key waits on the unique index until the first transaction ends, then either replays (same `request_hash`) or gets `409 IDEMPOTENCY_CONFLICT` (different hash). If the first transaction rolls back, its row disappears with it and the retry proceeds. `complete` writes the resource reference before commit. No "in progress" state exists.
- **Replay:** `200` with the referenced resource read now, under the caller's authorization (row 2).
- **Retention: 24 hours** (`expires_at = created_at + 24 h`), purged by the in-process jobs (answered 2026-11-05). A client retries within seconds or minutes (timeout, app resumed); a key older than a day is a new intent, and the cart may have changed. `kd_app` gets `SELECT, INSERT, UPDATE, DELETE` on this table (it is not append-only).

## 11. Owner answers (2026-11-05)

The owner asked for the best-supported recommendation on each open question and delegated the answers to it. Each answer below is the one this record applies.

| # | Question | Answer | Why |
|---|---|---|---|
| 1 | Integration client | Global `fetch` (section 2) | No dependency; cookies, `Origin` and `X-Forwarded-For` work on Node 26.13.0 [S14] |
| 2 | Proxy hops | `TRUST_PROXY_HOPS`: 0 on the host, 1 in the Docker `apps` profile, required (1) in `demo` and `prod`; only 0 or 1 allowed (section 5) | Caddy is the only hop and drops a client's `X-Forwarded-For` [S15, S16] |
| 3 | Echo `X-Request-Id` | Yes, on every response, as a header (section 4) | A UUID with no personal data; ties a user's report to the log line |
| 4a | Status of the 18 codes | The table of section 9, with `UPGRADE_REQUIRED` = 400 | 426 requires an `Upgrade` protocol header [S13] |
| 4b | Idempotency retention | 24 hours (section 10) | Retries come within minutes; a day-old key is a new intent |
| 5 | Purge of `audit_logs` after 24 months | A `SECURITY DEFINER` function, built in A12-T1 (below) | Keeps the purge automatic while `kd_app` still cannot delete a recent row |
| 6 | Row 1: one `idempotency_keys` table | Yes | Reservations, staff orders and points need a store too |
| 6 | Row 2: replay returns the current resource | Yes | A stored copy of an order would hold the customer's phone and address |
| 6 | Row 3: `outbox_events.payload jsonb` | Yes, ids, statuses, versions and counts only | The realtime payloads cannot be sent without it |
| 6 | Row 4: `AuditAction` union grown per slice | Yes; 21 is not a constraint | The 21 codes were never listed; each slice knows its own actions |
| 6 | Row 6: page size | Per-list maximum: 50, reviews 100, selects 20 (section 6) | Follows the design without lifting the limit for every list |
| 6 | Row 8: `updated_by` on every `row_version` table | Yes | `STALE_VERSION.current.updatedBy` cannot be answered otherwise |
| 6 | Row 11: status table | As answer 4a | |
| 6 | Row 13: `about:blank`, reason phrase, request-id echo | Yes | RFC 9457 [S9]; answer 3 |
| 6 | Row 14: field code `INVALID_FORMAT` | Yes | A malformed header is neither `REQUIRED` nor `TOO_LONG` |

**The `audit_logs` purge (answer 5).**

- **Options:** (a) an `ops` CLI command run as `kd_migrator`; (b) a `SECURITY DEFINER` function; (c) `DELETE` granted to `kd_app`.
- **Choice: (b).**
  - A migration creates `kd_purge_audit_logs()`, owned by `kd_migrator` (the table owner).
  - It is `SECURITY DEFINER` with `SET search_path = pg_catalog, public` and takes no argument.
  - It deletes only rows with `created_at < now() - interval '24 months'`, the cutoff written inside the function, and returns the count.
  - `REVOKE EXECUTE … FROM PUBLIC`, then `GRANT EXECUTE … TO kd_app`. The nightly job calls it.
- **Reason:**
  - Against (c): (c) breaks the append-only guarantee.
  - Against (a): (a) needs a person or a host scheduler, and ADR-0004 puts the nightly purge jobs in process; the deploy runs only `migrate`.
  - For (b): the application can delete only what the retention rule already allows, and the rule lives in the database, where a bug in the API cannot widen it.
- **Built in A12-T1**, with an integration spec. The spec proves three things: `kd_app` cannot `DELETE` directly; the function deletes only rows older than 24 months; `PUBLIC` cannot execute it.

## 12. Amendment of decision 0005 section 8 (decided 2026-11-05, "OK all")

- **Rule:** `seed demo` runs when `APP_ENV` is `dev`, `test` or `demo`, and is refused in `prod`. The Docker test stack runs it with `APP_ENV=test`. The rest of 0005 section 8 stands (dry run by default, `--commit`, run as `kd_migrator`, the URL rule, the exit-code table). This record supersedes only the sentence "`demo` refused unless `APP_ENV=dev`"; 0005 is not rewritten.
- It agrees with testing-strategy "Tools and data" (`seed demo` refuses to run with `APP_ENV=prod`).
- **Text for the owner to apply in the Docker repository** (not edited here):
  - `scripts/seed.sh`: "The `demo` mode is accepted when `APP_ENV` is `dev`, `test` or `demo`, and refused when it is `prod`. The seed tool itself enforces the rule; the script passes `APP_ENV` through unchanged."
  - `docs/api-contract.md`, seed command row: "`node seed/dist/cli.js <reference|business|demo> [--commit]`; `demo` is refused only in `prod` (kitchen-daylight decision 0007, section 12, amending decision 0005 section 8)."

## 13. Rules of the API track

Every later API prompt cites these by section number.

- **Divergence rule.** The API track never edits `docs/data-model.md` or `docs/api-outline.md`. When a task builds something that differs from them, it adds one row to [api-divergences.md](api-divergences.md) in the same change, with the columns: `id` (`D-NNN`), `task`, `document and section`, `what the document says`, `what was built`, `why`, `owner decision` (empty until answered). A later documentation task folds the answered rows into the documents.
- **Table creation rule.** A table is created by the first task that needs it, in one migration with its full column set, constraints, indexes, triggers (section 8) and `GRANT`s to `kd_app` (append-only tables `INSERT` only). A later task adds a table in a new migration or changes one with an `ALTER` migration. The file is `apps/api/migrations/NNNN_<description>.sql` with `NNNN` the next free number; an applied file is never edited (0005 section 7). Entities are registered explicitly in the `DataSource` options.
- **Test rule.** Pure logic gets a unit spec `<file>.spec.ts` next to the file. Anything that runs SQL gets an integration spec `test/integration/<feature>.int-spec.ts` against real PostgreSQL, run serially. Tests ship with the code; the agent writes them, the owner runs them ([testing-strategy.md](../testing-strategy.md), working rules; [CLAUDE.md](../../CLAUDE.md), test file conventions).
- **Contract rule.** Request and response classes live in `dto/*.dto.ts` (the only files the Swagger plugin reads); every success response is typed (`@ApiOkResponse({ type })` or the plugin's inferred return type); every error response is declared with `application/problem+json` and `ProblemDetailsDto`. After a controller or DTO change, `pnpm openapi:generate` runs and the regenerated `packages/contracts/openapi.json` and `src/generated/` are committed (0004).
- **Injection and mapping rule.** Section 2 (explicit `@Inject`, explicit column `type` and `name`, explicit `@Type`).

## Consequences

- **A0-T2 (logging):** installs `nestjs-pino`, `pino-http` and `pino` with exact pins, adds the two missing 0001 rows and closes the pino Node 26 item; wires section 4.
- **The throttling task:** installs `@nestjs/throttler` with its 0001 row; writes section 5, including `TRUST_PROXY_HOPS` with the env rule (`X-Powered-By` is already off since A0-T3, amended by A0-T13). In the same change, the owner applies the Docker repository text of section 5 (row 20).
- **A0-T5:** the `row_version` trigger function (section 8). **The task that writes `common/time/`:** `BUSINESS_TIME_ZONE`, the Vietnam-date helpers and the UTC session time zone; no environment variable is added for the zone.
- **The error-handling task:** `ErrorCode` and `FieldErrorCode` in `@kd/contracts` (with `INVALID_FORMAT`), the filter and the status table of section 9.
- **The first task that needs idempotency (ordering):** the `idempotency_keys` table and `common/idempotency/`.
- **The realtime slice:** `outbox_events.payload` (row 3). **Each slice with a `row_version` table:** `updated_by` (row 8).
- **A1-T1 (decision 0008):** token lifetimes, lockout, throttle figures; the email-token `created_at` (row 15).
- **A12-T1:** `kd_purge_audit_logs()` and its integration spec (section 11, answer 5).
- **Revisit triggers:** a second API instance (shared rate-limit store first, section 5); a second proxy hop in any tier, for example a CDN or load balancer in front of Caddy (`TRUST_PROXY_HOPS` and its 0-or-1 rule, section 5); a test that needs something Node's `fetch` cannot do (section 2); a stored amount near 2^31 VND (section 8); Vite or Vitest documenting decorator metadata (section 2).

## Amendments before acceptance (A0-T13, 2026-11-06)

The Phase A0 review compared this record with the code built on it. While the record is still proposed, the text above was aligned with the code, and two rules were tightened:

- **Section 3:** the validation pipe and the problem+json filter live in `common/errors/` and are the global providers `APP_PIPE` and `APP_FILTER` of `AppModule`, not `configure-app.ts` registrations: as a provider the filter injects the logger.
- **Section 5, row 5 and Consequences:** `X-Powered-By` is disabled in `configureApp` (A0-T3), not in `main.ts`, so the integration app checks the real header. The throttling task no longer owns it; `TRUST_PROXY_HOPS` stays in `main.ts`.
- **Section 9:** `ErrorCode` and `FieldErrorCode` live in `packages/contracts/src/errors.ts`.
- **Section 6 (tightened):** `page` is capped at 10,000.
- **Sections 6 and 8 (tightened):** a timestamp cursor sort key is `timestamptz(3)`; migration `0006_audit_logs_created_at_milliseconds.sql` applies it to `audit_logs.created_at` (api-divergences D-024).
