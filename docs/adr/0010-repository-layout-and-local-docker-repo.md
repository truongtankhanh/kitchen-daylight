# ADR-0010: Repository layout and a dedicated local Docker repository

- **Status:** **Accepted by the project owner on 2026-10-28: option A** (two repositories now: the monorepo and a dedicated local Docker repository), as proposed. It **amends** [ADR-0001](0001-tech-stack.md) (repo layout row), [ADR-0004](0004-aws-hosting.md) (the `dev` tier) and [scaffold-plan.md](../scaffold-plan.md) (sections 1, 2, 7, 8 and 10); those amendments are made. **Further owner answers (2026-10-28):** both repositories live on the owner's **personal GitHub account and are public**; the names are the proposed ones, `kitchen-daylight` and `kitchen-daylight-docker` (they may change when the restaurant's real name is chosen, `WA1`). Public visibility has consequences that are recorded below ("Public repositories"). **"Accept all" (2026-10-28) settled the remaining points as recommended:** (1) the license is "all rights reserved": each repository gets a short `LICENSE` file saying so and a README sentence (fonts keep their OFL texts); (2) `docs/` and `designs/` stay in the public monorepo (option A is kept; the owner accepts that the tax position and open legal questions are visible); (3) `data/poi-feasibility/` is **not carried into the new repository** (it is obsolete and holds the owner's personal email); the local folder is left untouched until the owner deletes it; (4) the optional `apps` profile stays **off by default** and is available on request. Nothing is open except the real restaurant name. The Docker repository itself has not been created.
- **Date:** 2026-10-28
- **Depends on:** ADR-0001, ADR-0004, [ADR-0009](0009-owner-business-pivot.md), [testing-strategy.md](../testing-strategy.md)

## Context

What has to live somewhere (from the accepted documents):

| Component | Lifecycle and consumers |
|---|---|
| `apps/api` (NestJS, migrations, seed entry point) | Deployed as a Docker image to `demo` and `prod` (ADR-0004) |
| `apps/admin` (Angular SPA, static files behind Caddy) | Deployed with the API host; needs the API contract |
| `apps/mobile` (Expo, EAS builds) | Store releases; needs the API contract and the tokens |
| `packages/contracts` (OpenAPI snapshot, generated TypeScript client, realtime event types) | Changes **together with** the API; consumed by admin and mobile; CI fails on drift (`openapi:check`) |
| `packages/design-tokens`, `i18n`, `tsconfig`, `eslint-config` | Shared by the three apps |
| `tools/seed`, `tools/seed-data` | Seed of the restaurant's real data (data plan); uses the API's database objects |
| `infra/` (AWS CDK, `demo` and `prod` Compose, Caddyfile, deploy scripts) | Changes rarely; needs AWS rights that app developers may not have |
| `docs/`, `designs/` | Decisions, specs and static frames |
| **Local development and test environment** (PostgreSQL with PostGIS, Mailpit, an S3-compatible emulator, init scripts, test orchestration) | Used by every developer and by CI for end-to-end tests; never deployed |

ADR-0001 accepted a **single monorepo** (pnpm workspaces + Turborepo) mainly so that the API, its contract and the two clients change in one commit and CI can check the contract. The owner now wants the Docker environment for local work in its own repository.

Facts that constrain the answer: the owner's machine has limited RAM and CPU (working rule: no full suites or watchers started implicitly); the team is small (the plan assumes at most 5 branches, 30 staff, 300 orders a day, one server); ADR-0004 says every tier runs "the same Compose topology and the same image".

## Options and the repository count

| Option | Repositories | Contents |
|---|---|---|
| **A. Monorepo + local Docker repo (recommended now)** | **2** | (1) `kitchen-daylight`: apps, packages, tools, `infra/` (AWS CDK, `demo` and `prod` Compose, Caddy, deploy), `docs/`, `designs/`. (2) `kitchen-daylight-docker`: local development and test only |
| B. A plus a separate infrastructure repository | 3 | (1) monorepo without `infra/`. (2) `kitchen-daylight-infra`: CDK, `demo` and `prod` Compose, Caddy, deploy workflows. (3) the Docker repo |
| C. B plus a separate documentation repository | 4 | adds `kitchen-daylight-docs` (`docs/` and `designs/`) |
| D. Full polyrepo | 7 | `api`, `admin`, `mobile`, `contracts` (published package), `infra`, `docs`, `docker` |

**Why A now.** The Docker repository is the owner's explicit requirement and costs little to separate: it is not code, it is consumed by everyone, and it has its own review rhythm. The remaining parts share a contract and a lockfile, which a monorepo handles for free. Option D would need the `contracts` and `design-tokens` packages published to a private registry (GitHub Packages) and version-bumped for every API change, would turn one atomic change (endpoint, DTO, generated client, screen) into three pull requests, and would lose the `openapi:check` gate in a single CI run. For one product, a handful of developers and one server, that is overhead without a benefit.

**When to move to B.** When the people who deploy to AWS differ from the people who write the apps, when infrastructure pull requests start to drown application ones, or when the owner wants the AWS credentials and the deploy workflows in a repository with tighter access. The cost of moving later is small because `infra/` has no dependency on the apps' source (it consumes image tags).

**When to leave the monorepo for D (do not plan for it).** A dedicated mobile team with its own release cadence, or a second product that reuses the API. Then publish `contracts` and `design-tokens` first.

**Documentation (C).** `docs/` and `designs/` stay in the monorepo for now: the contract workflow, the tokens and the ADRs reference each other by relative path, and the link check runs over both. Splitting them is a convenience for non-developers, not a need.

## Decision (proposed): option A

### The local Docker repository: `kitchen-daylight-docker`

**Purpose:** one command gives a developer or CI the services the applications depend on, in a known state. It contains no application code and no secrets, and is never used to deploy.

Proposed layout:

```
kitchen-daylight-docker/
  README.md                 how to use, ports, resource notes, troubleshooting
  versions.env              pinned image tags (Postgres+PostGIS, Mailpit, the S3 emulator, Caddy) and the API image tag
  .env.example              ports and passwords for local use only (the real .env is not committed)
  compose.yaml              dependencies: postgres (postgis), mailpit, the S3 emulator, a bucket-init job
  compose.apps.yaml         profile "apps": the API from its published image, Caddy with prod-like routing
  compose.test.yaml         end-to-end: throw-away database on tmpfs, API image, seed one-off job
  postgres/init/            extensions (postgis, pg_trgm, unaccent, citext), the migration role and the application role
  s3/init.sh                buckets per environment
  scripts/                  up, down, reset, seed, wait-healthy, status (no watch mode anywhere)
```

Rules for this repository:

1. **Default `up` starts dependencies only** (PostgreSQL with PostGIS, Mailpit, the S3 emulator). Developers run the API, admin and mobile on the host with hot reload (`pnpm dev:api`, `dev:admin`, `dev:mobile`), which is cheaper on RAM and CPU than containers. The API in a container, Caddy and the end-to-end stack are behind Compose **profiles** (`apps`, `test`) that must be asked for.
2. **Every service has a memory limit and a health check** (limits to be measured at scaffold time; first guess: PostgreSQL 512 MB, the S3 emulator 256 MB, Mailpit 64 MB). `scripts/up` waits for health, then prints the connection strings.
3. **Never production-like data or secrets.** `APP_ENV` is fixed to `dev` or `test`; credentials are local placeholders. The production guard of the API (refuse to boot in `prod` with an emulator adapter) stays in the API repo; this repository must not be able to start a `prod` configuration at all.
4. **Pinned versions** in `versions.env`, the same PostgreSQL, PostGIS, Caddy and API image tags that `infra/` uses for `demo` and `prod`. A CI check in the monorepo compares the two pin sets so topology cannot drift silently (the answer to ADR-0004's "same topology" rule).
5. **Seeding and migrations are not reimplemented here.** `scripts/seed` runs the `seed` command that ships inside the API image (`seed reference`, `seed business`, `seed demo`); migrations run as a one-off container from the same image, exactly as in `demo` and `prod`.
6. **Deterministic test stack.** `compose.test.yaml` gives Playwright and Maestro a clean database on every run, with the synthetic seed of the data plan, and tears it down afterwards. The owner runs it and shares the output (testing-strategy working rule); CI runs it on GitHub's runners.
7. **Reset is explicit.** `scripts/reset` deletes the local volumes after a confirmation line; nothing deletes data implicitly.

### How the two repositories find each other

- Sibling folders by convention (`../kitchen-daylight-docker`), overridable with `KD_DOCKER_DIR`. The monorepo's `pnpm dev:infra` becomes a thin wrapper that calls the Docker repo's `scripts/up` and fails with a clear message if the folder is missing. No git submodule (it adds friction for little gain at this size).
- The API image is built and pushed by the monorepo's CI (ECR for `demo` and `prod`; GitHub Container Registry or ECR for the tag that the Docker repo pulls). The Docker repo only **pulls** a tag named in `versions.env`.
- CI of the monorepo checks out the Docker repo (a read-only deploy key or the repository's default token if both live in the same organisation) to run the end-to-end job.

## Consequences

**Good**
- Everyone gets the same local services with one command; the monorepo stays free of Compose clutter for local work.
- The Docker repo can change (a new service, a version bump) without touching application history, and a bad change cannot break a release build.
- The default footprint is small, which respects the limits of the owner's machine.

**Costs and risks**
- A change that needs both an application change and a new local service (for example adding a cache) takes two pull requests. Mitigation: the Docker repo is versioned with tags, and the monorepo documents the minimum Docker repo version it needs (a `docker-repo.version` file).
- Topology drift between local and cloud. Mitigation: the pinned-version comparison in CI (rule 4) and the `apps` profile that reproduces the Caddy routing.
- One more clone for a new developer. Mitigation: a bootstrap script in the monorepo that clones the sibling and runs the first `up`.
- CI needs permission to read the second repository.

## Addendum (2026-10-28): findings while planning the implementation

The implementation plan lives in the Docker repository itself (`repos/kitchen-daylight-docker/docs/`). Planning it found three things that change earlier assumptions:

1. **MinIO community edition is no longer distributed.** Sources report that Docker Hub images and prebuilt binaries stopped in October 2025, that a `quay.io` mirror stays on a September 2025 release, and that the repository was archived in 2026. The scaffold plan, ADR-0004 and this ADR named MinIO for local object storage. They now say "S3-compatible emulator". Phase 0 of the Docker repository picks the product (candidates: SeaweedFS, Garage, S3Proxy) against fixed criteria, and records the result here.
2. **The official PostGIS image is amd64 only.** `postgis/postgis:18-3.6` has no arm64 manifest (checked with `docker manifest inspect`), and the owner's machine and the planned `t4g` servers are arm64. Phase 0 decides between a community multi-arch image and a thin own image; `infra/` must follow the same decision (scaffold-plan item 10). PostgreSQL 18 images also changed the data directory (`/var/lib/postgresql`, not `/var/lib/postgresql/data`).
3. **Ports follow the owner's existing slot scheme.** The owner already runs several local stacks from a shared `docker-local` folder, where each project gets a *slot* and every port is the base port plus `slot x 10` (slots 0 and 1 are taken). This repository takes **slot 2** by default and generates its `.env` from the slot, so it can run beside the other stacks. The owner adds the row to the registry of that other folder; this repository does not touch it.

## Public repositories (decided 2026-10-28): consequences and controls

Public hosting is free for GitHub Actions minutes, secret scanning and Dependabot, and lets CI check out the Docker repository without a key. It also exposes everything committed, forever (history included). Controls that follow:

1. **Secrets and keys never enter either repository.** `.env` is ignored, only `.env.example` with placeholders is committed; enable GitHub secret scanning with push protection, and run a secret scanner (for example gitleaks) in CI and in the pre-commit hook. The monorepo starts from a **fresh history**: nothing is imported from VER.01, whose Google Maps and Facebook identifiers were exposed (ADR-0001 open item 4).
2. **Personal data.** The workspace holds one known case: `data/poi-feasibility/osm_probe.sh` contains the owner's personal email in a User-Agent string. That folder is obsolete (ADR-0009) and must not be committed as it is; the owner decides whether to delete it or replace the address. Sample data stays fictional (`example.com`, `kitchendaylight.example`, fictional bank details).
3. **The restaurant's real data stays out.** The seed input files with the real menu, prices, photos, bank details and tax code are supplied from private storage at deploy time, not committed. The repository holds only synthetic examples and the templates of the data plan.
4. **AWS access from a public repository.** The OIDC role trust policy must be scoped to this repository **and** to protected refs (`main`, release tags) or a GitHub Environment with a required reviewer for `prod`; no workflow uses `pull_request_target` on untrusted code; pull requests from forks get no secrets and no deploy; **no self-hosted runner on the owner's machine** (a fork pull request could run code on it). Branch protection on `main`.
5. **Images.** The API image tag that the Docker repository pulls is published to GitHub Container Registry as a **public** package, so it must contain no secret and no real data (it carries the seed tool with synthetic data only). `demo` and `prod` pull from private ECR.
6. **Docker repository defaults are copied by strangers.** Every published port is bound to `127.0.0.1`, all passwords are local placeholders, and the README says the stack is for local use only.
7. **Legal.** A public repository without a license is source-visible with all rights reserved, which is probably what the owner wants for a restaurant's own app; an explicit `LICENSE` or a README statement should say so (the owner chooses). Fonts under the OFL (Nunito; Be Vietnam Pro to be verified, scaffold-plan item 5) need their license texts in the repository. The name "Kitchen Daylight" is public once the repository is, while its trademark status is unresolved (open items of the README).
8. **Business-sensitive documents.** `docs/` is public in this layout. It contains the owner's stated tax position (small household business, no e-invoice, ADR-0009 `WA17`, data model "Tax and invoice position"), risks and open legal questions. If the owner prefers these not to be public, the clean move is option C: keep `docs/` (and `designs/`) in a third, private repository. The owner should decide before the first push.

## Changes made on acceptance (2026-10-28)

1. ADR-0001 table row `Repo layout`: monorepo of `apps/*`, `packages/*`, `tools/*`, `infra/`, `docs/`, `designs/`, **plus** a separate Docker repository for local development and tests.
2. `scaffold-plan.md` section 1: remove `infra/compose.dev.yaml` from the monorepo; section 2 "Local services" row and the `dev:infra` script; section 7 "Environments" `dev` column points at the Docker repo; section 8 CI gets the second checkout and the pin comparison; section 10 "Verify before the first commit" gets two items (image registry for the API tag; the memory limits).
3. `testing-strategy.md` "Tools and data": end-to-end runs use `compose.test.yaml`.
4. ADR-0004: `dev` tier "Developer machine, Docker Compose" → "the Docker repository".
5. `README.md` ADR table.
6. Create the Docker repository from the layout above (a separate task after acceptance).

## Open questions for the owner

All answered on 2026-10-28:

1. Option A, B or other? **A.**
2. Where the repositories live and their visibility? **Personal GitHub account, public.**
3. Names? **`kitchen-daylight`, `kitchen-daylight-docker`** (may change with the real restaurant name, `WA1`).
4. The optional `apps` profile (Caddy with prod-like routing) on laptops? **Off by default.**
5. License? **All rights reserved** (`LICENSE` file and README sentence in each repository).
6. Keep `docs/` public or move the business-sensitive documents to a private repository? **Keep public** (option A); the owner accepts the visibility of the tax position and the open legal questions.
7. `data/poi-feasibility/`? **Not moved into the new repository;** the local folder stays until the owner deletes it.
8. Redis is not in the design (Socket.IO on one instance). If a second API instance is ever needed, a Redis service is added to the Docker repository then.
