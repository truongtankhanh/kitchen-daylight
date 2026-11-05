# Monorepo scaffold plan (and its companion Docker repository)

Status: **draft for review** (2026-10-27, revised the same day for [ADR-0009](adr/0009-owner-business-pivot.md): the app is now the owner's own restaurant). Turns [ADR-0001](adr/0001-tech-stack.md), [ADR-0004](adr/0004-aws-hosting.md), [ADR-0008](adr/0008-open-items-resolution.md) and ADR-0009 into a concrete layout, build order and a checklist of facts to verify before the first commit. No code exists yet (`apps/`, `packages/`, `infra/` and `tools/` are not created).

Version numbers are intentionally not pinned here (ADR-0001). Pin Node, pnpm, NestJS, Angular, PrimeNG, Expo and TypeORM from their official documentation on the day each app is scaffolded.

## 1. Layout

```
/
  apps/
    api/              NestJS API (REST + Socket.IO gateway)
    admin/            Angular admin SPA (standalone components, signals, PrimeNG)
    mobile/           Expo React Native app (Expo Router, TanStack Query)
  packages/
    contracts/        OpenAPI snapshot, generated TypeScript client, realtime event types
    design-tokens/    tokens.json -> CSS variables, PrimeNG preset, React Native theme
    i18n/             Vietnamese string catalogues (English added later)
    tsconfig/         Shared TypeScript base configs
    eslint-config/    Shared lint rules
  tools/
    seed/             Seed tool for the restaurant's real data (migration-plan.md, now the data plan)
    seed-data/        provinces/wards fixtures and fetch/verify scripts (moved from data/admin-units)
  infra/              AWS CDK app, `demo` and `prod` Compose files, Caddyfile, deploy scripts (no local-development Compose: that lives in the Docker repository)
  docs/               This documentation
  designs/            Reference HTML frames and brand assets (not built)
```

Moves from today's tree: `docs/ui/tokens/` becomes `packages/design-tokens/` (its `tokens.json` comment already says so); `data/admin-units/` becomes `tools/seed-data/`; `data/poi-feasibility/` is no longer needed (the open-data import was dropped, ADR-0009); it is **not copied into the new repository** (it contains the owner's personal email, ADR-0010) and the owner may delete the local folder. Each repository carries a `LICENSE` file stating "all rights reserved" (ADR-0010). `designs/` and `docs/` do not move.

**Dependency rules** (enforced by lint): apps never import from each other; `packages/contracts` has no runtime dependency on `apps/api`; `tools/*` may import the API's entities through a shared `packages/` module only if one is extracted later, otherwise they talk to the database through their own thin SQL; nothing imports from `designs/`.

## 2. Tooling

| Concern | Choice | Notes |
|---|---|---|
| Workspace | pnpm workspaces + Turborepo | ADR-0001 (accepted). Tasks: `build`, `lint`, `typecheck`, `test`, `openapi:generate`, `openapi:check`. Cache enabled. |
| Language | TypeScript everywhere, strict | Shared base config. |
| Node | One version for the whole repo, pinned in `.nvmrc` and `engines` | Pick the current LTS from the official release page at scaffold time. |
| Lint and format | ESLint + Prettier, one shared config | Lint runs on staged files through a pre-commit hook. |
| Commits | Follow the convention already chosen for the repo (Conventional Commits unless the owner says otherwise) | Decided at the first commit. |
| Local services | The **separate Docker repository** `kitchen-daylight-docker` ([ADR-0010](adr/0010-repository-layout-and-local-docker-repo.md)): PostgreSQL + PostGIS, Mailpit, an S3-compatible emulator (MinIO is no longer distributed; the product is chosen in the Docker repository's phase 0), with profiles `apps` (API image, Caddy) and `test` (throw-away stack for end-to-end) | Same ports as the `*Port` interfaces expect; no cloud account needed for `dev`. Sibling folder by convention or `KD_DOCKER_DIR`; the monorepo records the minimum Docker repository version it needs in `docker-repo.version`. |

Resource caution on the owner's machine: root scripts must not start API, admin, mobile and Compose watchers together by default. Provide `pnpm dev:api`, `dev:admin`, `dev:mobile` separately and a `dev:infra` that only calls the Docker repository's `scripts/up` (dependencies only; it fails with a clear message if the sibling folder is missing), plus a `bootstrap` script that clones the sibling and runs the first `up`; test and build tasks take a concurrency limit (`--concurrency=2`).

## 3. Contract workflow (ADR-0001, api-outline.md)

1. `apps/api` builds the OpenAPI document from decorated controllers and DTOs.
2. `pnpm openapi:generate` writes it to `packages/contracts/openapi.json` (the snapshot, committed).
3. `pnpm openapi:check` in CI regenerates and fails on any diff, and on breaking changes against the last released snapshot.
4. A typed client is generated from the snapshot into `packages/contracts` and consumed by `admin` and `mobile`.
5. Realtime event types (`order.placed`, `order.status_changed`, `menu.availability_changed` and the rest of api-outline "Realtime") are hand-written once in `packages/contracts` and imported by the gateway and both clients.

Client generator: choose at scaffold time between a type-only generator with a thin `fetch` wrapper and a full code generator. Criteria: works in Angular and React Native without Node-only APIs, supports `application/problem+json` error typing, no runtime dependency heavier than `fetch`. I have not evaluated the candidates in this session. Recommendation to start from: the type-only option, since it adds the least code to two very different runtimes.

## 4. `apps/api` structure

Modules (NestJS), each with its own controller, service, DTOs and entities:

`auth` (tokens, codes, social, guards, optional MFA), `users` (customers, staff, `staff_branches`, addresses), `branches` (hours, delivery zones, tables), `menu` (categories, items, options, tags, per-branch availability, stock and movements), `ordering` (quote, order creation, status machine, cancellation), `reservations`, `loyalty` (points ledger, vouchers, promotions), `reviews` (with owner reply) and `review-reports`, `reporting` (revenue and top items, read-only over orders; the `REVENUE` Excel workbook is built from the same queries), `receipts` (the print-ready receipt data of an order), `jobs` (the scheduler, below), `geo` (provinces, wards, delivery-distance check, optional geocode), `media` (upload, resize, blurhash), `exports`, `mail`, `realtime` (gateway, outbox relay, branch-scoped audiences), `settings` (`app_settings`, `/meta/config`), `audit`, `health`. **Branch scoping** is one shared guard/helper that every staff query goes through, with a test that enumerates the endpoints; it reads `staff_branches` from the database on each request (not from token claims), so a revoked branch takes effect at once.

**Scheduled jobs** (`jobs` module, one instance means one scheduler; if the API is ever scaled out the jobs take a PostgreSQL advisory lock): nightly reconciliation of `branch_menu_items.stock_qty` against `stock_movements`, of `loyalty_accounts` against the ledger, of `vouchers.redeemed_count` and of the branch rating counters; the purges of the retention table in the data model; points expiry when enabled; auto-cancel of unconfirmed orders when `ordering.auto_cancel_unaccepted_minutes` is set (cancelled by `SYSTEM`, with an event); expiry of unused invitation links is handled by the token lifetime and needs no job.

Cross-cutting: global deny-by-default auth guard with `@Public()`; role guard; validation pipe with whitelist and forbid-unknown; a problem+json exception filter that emits the code catalogue of api-outline; throttling with strict limits on auth; pino logging that rounds or drops coordinates; config module that validates environment variables at startup and fails fast.

Ports and adapters (ADR-0004): `MailPort` (Mailpit/SMTP, SES), `StoragePort` (S3-compatible emulator locally, S3), `GeocodePort` (fixture, Amazon Location; optional, only to propose coordinates for a delivery address). Adapters are chosen by configuration. **Production guard:** the API refuses to boot when `APP_ENV=prod` and any port is bound to an emulator or fixture adapter; this ships in the first commit that has a port, with a test.

**Deferred port (designed, not built):** `InvoicePort` (`issue`, `issueSummary`, `cancel`, `lookup`; see the data model, "E-invoices (designed, deferred)") with a `manual` adapter (a real adapter, allowed in `prod`), a `fixture` adapter (dev and tests; the production guard refuses it) and one adapter per provider. The `invoices` module, its two tables and its screens are added in a slice of their own when the owner enables e-invoices; nothing in phase 1 depends on it.

Database: hand-written SQL migrations are the source of truth, `synchronize` off (ADR-0001). Two roles: a migration role (DDL) and the application role (no DDL; `INSERT`-only on the append-only tables `audit_logs`, `order_status_events`, `stock_movements`, `loyalty_ledger`, `user_consents`; no `DELETE` on orders and their children). Entities map tables; spatial and database-specific objects live only in SQL.

## 5. `apps/admin` structure

Feature folders per screen group: `orders` (live board, detail with receipt and kitchen ticket, list), `menu` (items and the item editor with router-driven tabs, categories and tags, availability and stock), `branches` (list, editor, hours, delivery zones, media), `reviews`, `users`, `dashboard`, `reports` (the Excel statistics page first, charts in phase 3), `settings`, `exports`, `email`, `audit`; phase 2 adds `reservations`, `tables` and `promotions`. Printing uses the browser print dialog with two print stylesheets (kitchen ticket, customer receipt at 58 or 80 mm). PrimeNG theme preset generated from `design-tokens`. Auth: access token in memory, refresh cookie handled by the browser, an interceptor that refreshes silently and retries once. A realtime service exposes connection state as a signal and a version-aware invalidation helper (the "Tải lại" bar). MapLibre GL JS component for the branch address pin and the delivery-zone preview, tile URL from `/meta/config`. The board reads its thresholds and refresh interval from `GET /admin/meta/config`. Fonts self-hosted.

## 6. `apps/mobile` structure

Expo Router with the four tabs behind one `AppTabBar` component (native tabs on iOS 26, JavaScript fallback elsewhere; style-direction risk 3). TanStack Query for server state with infinite queries for lists. `expo-secure-store` for the refresh token; access token in memory. `i18n` strings from `packages/i18n`. Theme from `design-tokens`. Location behind the priming screen; coordinates only as query parameters. One realtime client that opens in the foreground, exposes connection state and invalidates queries. Build profiles `dev`, `demo`, `prod` select the API base URL and bundle identifiers (separate identifiers per tier so they can coexist on one phone; names to be decided with the store accounts).

## 7. Environments and configuration

| Setting | `dev` | `demo` | `prod` |
|---|---|---|---|
| `APP_ENV` | `dev` | `demo` | `prod` |
| Mail / storage / geocode adapter | Mailpit / S3-compatible emulator / fixture (from the Docker repository) | SES (sandbox) / S3 / Amazon Location | SES / S3 / Amazon Location |
| Secrets | local `.env` (never committed; `.env.example` is) | SSM Parameter Store | SSM Parameter Store |
| Data | `seed reference` + `seed business` + `seed demo` (synthetic orders) | the owner's real menu and branches + synthetic orders | the owner's real menu and branches, real orders |
| Mobile build | `dev` profile, API on the LAN | `demo` profile | `prod` profile |

No secret is hardcoded. The Google Maps and Facebook identifiers committed in VER.01 are exposed and must never be reused (ADR-0001 open item 4).

## 8. CI/CD (GitHub Actions, ADR-0004)

- Pull request: install with the lockfile, `lint`, `typecheck`, `test`, `openapi:check`, build the API image.
- `main`: push the image to ECR, deploy to `demo` through Systems Manager Run Command (migrations as a one-off container, then `docker compose pull && up -d`).
- Release tag: manual approval, then the same for `prod`, after a snapshot and `pg_dump`.
- AWS access by OIDC role assumption, no long-lived keys. **Repositories are public (ADR-0010):** the role's trust policy is scoped to this repository and to `main`, release tags or a protected GitHub Environment with a required reviewer; no `pull_request_target` on untrusted code; fork pull requests get no secrets and no deploy; no self-hosted runner on the owner's machine; secret scanning with push protection plus a scanner in CI. Mobile: EAS Build/Submit, or local builds as the fallback (EAS free-plan limits unverified).
- **Docker repository:** the pull-request job checks out `kitchen-daylight-docker` (both repositories are public, so no key is needed) to run the end-to-end stack with `compose.test.yaml`, and a check compares the pinned image versions of `versions.env` with those of `infra/` (PostgreSQL, PostGIS, Caddy, API tag) so the local and cloud topologies cannot drift apart. The API image tag that the Docker repository pulls is published by this repository's CI.
- CI runs the test suites on GitHub's runners; on the owner's machine the owner runs tests and shares the output (working rule), so no script here should launch the full suite implicitly.

## 9. Build order (vertical slices, phases of ADR-0009)

Each slice ends with something demonstrable in `dev`. Phase 1 is the smallest thing that lets the restaurant sell; later phases build on orders.

| # | Phase | Slice | Exit criteria | Needs |
|---|---|---|---|---|
| 0 | 1 | Skeleton | Workspace builds; Compose up; API `/health`; admin and mobile shells render; tokens package feeds both themes; CI green; production guard test | Verify list below |
| 1 | 1 | Auth and users | Customer register/login/refresh/logout with codes; staff login and invitation; roles with `staff_branches`; guards; lockout; auth tests | ADR-0003; TOTP for manager and admin (accepted) |
| 2 | 1 | Branches and menu (admin) | Branches with pin, hours and delivery zones; categories, items, options, tags, photos; per-branch availability, price override and stock; audit | Slice 1 |
| 3 | 1 | Menu browse (mobile) | Branch picker, menu, item with options, search; map with a configured tile URL | Slice 2; tile source open |
| 4 | 1 | Ordering | Quote and order creation (idempotent, server-priced, stock decrement), cart and checkout, status machine, customer tracking and cancel, order history and reorder | Slices 1 to 3 |
| 5 | 1 | Staff orders board | Live board with realtime, order detail and transitions, courier dialog, payment confirmation and refund marking, cancel with the stock choice, printed receipt and kitchen ticket, sold-out toggle, pause switch, connection state and refetch fallback | Slices 2, 4; realtime |
| 6 | 1 | Realtime | Outbox, gateway, branch-scoped audiences, every-write-emits test | Slice 4 |
| 7 | 1 | Reviews and account | Review of a completed order, owner reply, account deletion with order retention rules, consent | Slices 1, 4; legal answer on order data |
| 8 | 2 | Reservations | Slots, requests, staff calendar and table assignment | Slices 2, 6 |
| 9 | 2 | Loyalty and promotions | Vouchers, points ledger, banners, redemption inside the order transaction | Slice 4 |
| 10 | 1/2 | Operations | Export (including the `REVENUE` Excel statistics, phase 1), the scheduled jobs, system email log and templates, SES callbacks, app settings, maintenance and forced-update screens, audit view | Slices 1 to 6 |
| 11 | 3 | Reports | Revenue charts, top items, order summary (the Excel statistics export is built in slice 10) | Slice 4 with real orders |
| 12 | 1 | Data and release | `seed` on `dev` then `demo` with the owner's real menu and branches; backup and restore test, alarms, store listings, privacy labels, terms and policy text, accessibility pass on devices | Owner's data; legal items |

## 10. Verify before the first commit

None of these was verified in the documentation pass:

1. `@nestjs/typeorm` supports the TypeORM version to be used (ADR-0001 item 3) and how `migration:generate` treats PostGIS columns (not used for the schema either way).
2. Socket.IO client behaviour in React Native on the chosen Expo SDK (ADR-0008 #7).
3. A MapLibre binding for React Native that works with the chosen Expo SDK (and with development builds, since it is a native module).
4. Expo Router native tabs maturity and Android rendering (fallback exists).
5. Be Vietnam Pro license text and React Native font packaging; Inter as fallback.
6. EAS Build/Submit free-plan limits.
7. PostgreSQL version available as a PostGIS container image with `uuidv7()` (PostgreSQL 18); otherwise generate UUIDv7 in the application (data model conventions).
8. Excel's handling of the CSV the export writes with Vietnamese regional settings (ADR-0008 #33). The `REVENUE` statistics report is XLSX, which avoids the CSV encoding problem; the library that writes it (streaming, Vietnamese text, number and date formats) is still to be chosen and checked.
9. (ADR-0010) Which registry holds the API image tag that the Docker repository pulls (decided: GitHub Container Registry as a public package for the tag the Docker repository pulls; private ECR for `demo` and `prod`), and the real memory limits of PostgreSQL, MinIO and Mailpit on the owner's machine (first guess in the ADR: 512 MB, 256 MB, 64 MB).
10. (ADR-0010 addendum) **ARM64 PostGIS.** The official `postgis/postgis:18-3.6` image has only an amd64 manifest (checked 2026-10-28 with `docker manifest inspect`), while the owner's machine is arm64 and ADR-0004 picks ARM EC2 (`t4g`) for `demo` and `prod`. The Docker repository's phase 0 decides between a community multi-arch image (`imresamu/postgis:18-3.6` showed amd64 and arm64) and a thin own image built from the official `postgres:18` plus the PGDG PostGIS package; `infra/` must use the same answer.

## Open items

1. Client generator (section 3).
2. Names and bundle identifiers per tier, Apple and Google developer accounts (costs are outside the USD 50 budget).
3. Branch and release naming; commit convention (section 2).
4. Whether `tools/*` share entities with the API or use plain SQL (section 1).
