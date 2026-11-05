# ADR-0001: Tech stack for the VER.02 rebuild

- **Status:** Partially accepted. Items marked **[Accepted]** were confirmed by the project owner; items marked **[Proposed]** are recommendations awaiting review.
- **Date:** 2026-10-21
- **Product framing amended 2026-10-27 ([ADR-0009](0009-owner-business-pivot.md)):** VER.02 is the owner's own restaurant app (orders, reservations, loyalty, staff operations), not a venue directory. The stack decisions below are unchanged; where the text says "venue", "place" or "catalog" read "branch", "menu" and "order".
- **Context source:** analysis of `VER.01` (Android + PHP/MySQL, 2018 student project "Cẩm nang ẩm thực").

## Context

VER.01 is a food-venue discovery app: an Android client (Java, Volley, Firebase Auth, Google Maps) and a plain-PHP admin site that doubles as the mobile API (`src/libs/*.php`). The rebuild covers **admin web + mobile (iOS and Android)**.

Problems in VER.01 that constrain the new stack (all verified in source):

| Problem in VER.01 | Consequence for VER.02 |
|---|---|
| Like/history stored as global flags on venue rows | Needs a real per-user data model and a single user identity owned by the backend |
| SQL built by string concatenation, unauthenticated endpoints, MD5 passwords, permission checks only hide UI buttons | Parameterized queries, DTO validation, server-side authorization, modern password hashing from day one |
| "Nearby" computed client-side on 10 rows with raw lat/lng difference and per-item geocoding on the UI thread | Geo queries in the database; coordinates stored at write time |
| Prices/opening hours stored as display strings | Structured data |
| Images stored in a folder inside the server source tree | Object storage + CDN |
| API contract is implicit (PascalCase JSON, ad-hoc) | Explicit OpenAPI contract with generated clients |

## Decision

| Layer | Choice | Status |
|---|---|---|
| Mobile | **React Native with Expo**, TypeScript, Expo Router, TanStack Query | **[Accepted]** |
| Mobile platforms | **iOS and Android** | **[Accepted]** |
| Repo layout | Monorepo with **pnpm workspaces + Turborepo**: `apps/api`, `apps/admin`, `apps/mobile`, `packages/*`, `tools/*`, `infra/`, `docs/`, `designs/`; **plus a separate Docker repository used only for local development and tests** ([ADR-0010](0010-repository-layout-and-local-docker-repo.md), accepted 2026-10-28) | **[Accepted]** |
| Backend | NestJS + TypeScript | [Proposed] |
| Database | PostgreSQL with PostGIS, `unaccent`, `pg_trgm` | [Proposed] |
| ORM / migrations | **TypeORM**. Hand-written SQL migrations are the source of truth for the schema and `synchronize` stays off. Prisma was the alternative (see Alternatives) | **[Accepted]** |
| API style | REST + OpenAPI; typed clients generated for admin and mobile | [Proposed] |
| Auth | **Backend-owned in NestJS** (self-managed). Design in [ADR-0003](0003-authentication.md) | **[Accepted]** |
| Admin web | Angular (standalone components, signals) + PrimeNG | [Proposed] |
| Cloud | **AWS**. Design in [ADR-0004](0004-aws-hosting.md) | **[Accepted]** |
| Geocoding | Amazon Location Service (storage-permitted mode), pending a coverage spike. See [ADR-0005](0005-geocoding.md) | [Proposed] |
| Media | S3 + CloudFront, resize on upload, server-validated file type/size | [Proposed] |
| Delivery | Docker Compose in every tier (`dev`, `demo`, `prod`), GitHub Actions CI/CD | [Proposed] |
| Observability | Structured logs (pino) + Sentry; OpenTelemetry later if needed | [Proposed] |
| Testing | Jest/Vitest (unit), Playwright (admin e2e), Maestro (mobile e2e) | [Proposed] |

Version numbers are intentionally not pinned here. Pin them from the official docs when each app is scaffolded.

## Alternatives considered

**Mobile**
- *Flutter*: better rendering control and UI polish, but introduces Dart, so no shared types/validation with the TypeScript backend. Rejected for a small team that already works in TypeScript.
- *Ionic + Angular (Capacitor)*: reuses Angular skills, but weaker native feel, especially lists and maps. Rejected.
- *Native Kotlin + Swift*: double the implementation and maintenance cost for equivalent features. Rejected.

**Backend / API**
- *GraphQL*: no client has varied or deeply nested query needs; REST + OpenAPI is simpler and gives equally typed clients.
- *Firebase/Supabase as backend*: fastest start, but moves authorization into rules/RLS and ties the data model to a vendor. Admin RBAC and geo queries are easier to keep explicit in NestJS + Postgres.
- *Keep Firebase Auth only*: would remove password handling, but splits identity (Firebase UID) from the relational model that owns favorites/history/reviews. Backend-owned auth keeps one `users.id` as the FK target. Revisit if the team prefers not to own credential storage.

**ORM (TypeORM vs. Prisma)**

The data model ([ADR-0006](0006-database-redesign.md)) relies on database-specific objects: `geography` columns, GiST and unaccented trigram indexes, generated columns, `citext`, partial indexes, `CHECK` constraints, enums and role grants. With either ORM these are created by hand-written SQL migrations, so the ORM mainly maps tables and runs queries. That makes the choice less decisive than it first looked.

| | TypeORM | Prisma |
|---|---|---|
| Fit with the owner's existing work | Matches the NestJS + TypeORM conventions and tooling already in use | Used in other repos, but not the NestJS standard here |
| NestJS integration | `@nestjs/typeorm` | Community pattern, no official module |
| Type safety | Weaker (query builder strings, implicit relation loading) | Strongest, generated client |
| Spatial data | Spatial column types are available in entity definitions (from my knowledge, not verified in this session); raw SQL as escape hatch | Historically `Unsupported` plus raw SQL. Newer docs describe a geometry field type; I could not confirm it covers `geography` |
| Migrations | Auto-generation is unreliable with spatial objects, so it is not used | Good developer experience, but the same hand-written SQL is needed for the objects above |
| Project health | 1.0 released 2026-05-19 after new maintainers took over in late 2024 | Actively developed |

**Decision: TypeORM** (accepted by the owner, 2026-10-21), because it matches the owner's existing NestJS conventions and keeps the spatial and database-specific parts in plain SQL either way. Prisma remains a sound choice; it would win on type safety if the model had fewer database-specific features. Not evaluated: Kysely and Drizzle.

Verify before scaffolding: that `@nestjs/typeorm` supports TypeORM 1.0, and how `migration:generate` treats PostGIS columns (neither was confirmed). Sources: [TypeORM blog](https://typeorm.io/blog/archive), [Prisma geometry fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-geometry-fields), [Prisma ORM 8 notes](https://www.prisma.io/blog/prisma-orm-8-closes-330-most-requested-issues).

**Search**
- *Elasticsearch/Meilisearch*: unnecessary at this data size (hundreds of places). Postgres `unaccent` + trigram handles diacritic-insensitive Vietnamese search ("bo" matches "bò").

## Consequences

- One language (TypeScript) across API, admin and mobile; generated OpenAPI clients keep the three in sync.
- Offering Google sign-in on iOS requires also offering Sign in with Apple (App Store guideline 4.8). Facebook login from VER.01 is **dropped**: low value, heavy SDK.
- We own credential storage and token rotation. This needs its own ADR before implementation (refresh-token reuse detection, session revocation, rate limiting on login).
- PostGIS is an extension. Under the budget in ADR-0004 it runs in a container on EC2; managed RDS is the upgrade path.
- `unaccent` is not immutable, so an index on `unaccent(name)` needs an immutable wrapper function in a migration.
- Geocoding must happen when an admin saves an address. The geocoding provider and its key handling are open (see Open items).

## Open items

0. Open questions raised across the documents were resolved as a batch on 2026-10-27 in [ADR-0008](0008-open-items-resolution.md). Realtime transport (Socket.IO) is added to the stack by that ADR; items 1 to 4 below are unchanged.
1. Budget is fixed at about USD 50/month for three tiers ([ADR-0004](0004-aws-hosting.md)); expected traffic is still unknown.
2. Geocoding coverage spike result (ADR-0005).
3. ORM (TypeORM accepted): before scaffolding, verify `@nestjs/typeorm` compatibility with TypeORM 1.0 and the behaviour of `migration:generate` with PostGIS columns. If 1.0 is not yet supported by the Nest module, start on the latest 0.3.x and plan the upgrade.
4. The Google Maps and Facebook identifiers committed in VER.01 should be treated as exposed; revoke or rotate them if they are still active, and never reuse them in VER.02.
