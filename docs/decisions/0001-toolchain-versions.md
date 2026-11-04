# 0001. Toolchain versions and compatibility

Status: **accepted** (P0-T2, proposed 2026-11-03; accepted by the owner 2026-11-03, Phase 0 gate). Pins the versions that ADR-0001 and scaffold-plan section 2 left open, resolves scaffold-plan items 1 and 7 and ADR-0001 open item 3.

## Context

ADR-0001 fixes the stack (pnpm workspaces + Turborepo, NestJS + TypeORM + PostgreSQL/PostGIS, Angular + PrimeNG, Expo + Expo Router + TanStack Query, pino) but pins no version. Scaffold-plan section 2 asks for one Node version for the whole repository and one shared TypeScript configuration. Every later task installs only the versions recorded here.

Rule applied: the latest stable release on the day read, unless a peer or engine range of another pinned package forbids it. No version below was guessed; every value comes from the registry or an official page listed in its row.

## Options

Only three pins had a real alternative:

| Pin | Option kept | Option rejected | Why |
|---|---|---|---|
| TypeScript | 6.0.3 (latest 6.0.x) | 7.0.2 (registry `latest`) | `@angular/compiler-cli` and `@angular/build` 22.2.x require `typescript >=6.0 <6.1`; `typescript-eslint` 8.72.1 requires `<6.1.0` |
| TypeORM | 1.1.2 (latest) | 0.3.31 (latest 0.3.x) | `@nestjs/typeorm` 12.0.2 accepts 1.x (below) |
| Node | 26.13.0 (Active LTS "Lithium") | 24.22.2 (LTS "Krypton", in maintenance since 2026-10-20) | 26 is the current LTS, sits inside every engine range and ends a year later |

## Evidence

Collected 2026-11-03 with read-only `npm view <pkg>@<version> version peerDependencies engines --json` (source: `https://registry.npmjs.org/<pkg>`) and the pages named in the table. Nothing was installed.

| Package | Pinned version | Source URL | Date read | Peer or engine constraints | To confirm |
|---|---|---|---|---|---|
| Node | 26.13.0 | https://nodejs.org/dist/index.json, https://github.com/nodejs/Release/blob/main/schedule.json | 2026-11-03 | LTS "Lithium" since 2026-10-28; maintenance from 2027-10-20; **end of life 2029-04-30** | |
| pnpm | 12.16.1 | https://registry.npmjs.org/pnpm | 2026-11-03 | engines `node >=18` | |
| turbo | 2.11.10 | https://registry.npmjs.org/turbo, https://turborepo.com/docs/support-policy | 2026-11-03 | no `engines` field (native binary); support policy: "pnpm 8+ Stable" | to confirm in P1-T1 (first `turbo run` on a pnpm 12 lockfile; measured in P1-T5) |
| typescript | 6.0.3 | https://registry.npmjs.org/typescript | 2026-11-03 | engines `node >=16.20.0`; capped below 6.1 by Angular and `typescript-eslint`; `@nestjs/cli` 12.0.11 depends on `~6.0.2` | |
| @nestjs/core, @nestjs/common, @nestjs/platform-express | 12.3.2 | https://registry.npmjs.org/@nestjs/core | 2026-11-03 | core engines `node >= 20`; peers `rxjs ^7.1.0`, `reflect-metadata ^0.1.12 \|\| ^0.2.0`; common peers `class-validator >=0.13.2`, `class-transformer >=0.4.1` | |
| @nestjs/cli | 12.0.11 | https://registry.npmjs.org/@nestjs/cli | 2026-11-03 | engines `node >= 20.11`; webpack, SWC and Rspack peers apply only to the builder chosen | |
| @nestjs/typeorm | 12.0.2 | https://registry.npmjs.org/@nestjs/typeorm | 2026-11-03 | peers `typeorm ^0.3.0 \|\| ^1.0.0-dev`, `@nestjs/common` and `@nestjs/core ^10 \|\| ^11 \|\| ^12`, `rxjs ^7.2.0`; engines `node >=20.19.0`; its own devDependency is `typeorm 1.1.1` | runtime with PostGIS columns: to confirm in P4-T3 |
| typeorm | 1.1.2 | https://registry.npmjs.org/typeorm | 2026-11-03 | peer `pg ^8.5.1` (other drivers optional); engines `node ^20.19.0 \|\| ^22.13.0 \|\| >=24.11.0` | |
| pg | 8.23.1 | https://registry.npmjs.org/pg | 2026-11-03 | engines `node >= 16.0.0`; peer `pg-native` optional and not used | |
| @angular/core and the framework packages (incl. `@angular/compiler-cli`) | 22.2.4 | https://registry.npmjs.org/@angular/core | 2026-11-03 | peers `rxjs ^6.5.3 \|\| ^7.4.0`, `zone.js ~0.15.0 \|\| ~0.16.0` (optional); compiler-cli peer `typescript >=6.0 <6.1`; engines `node ^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` | |
| @angular/cli, @angular/build | 22.2.5 | https://registry.npmjs.org/@angular/cli | 2026-11-03 | engines `node ^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`; build peer `typescript >=6.0 <6.1` | |
| primeng | 22.1.4 | https://registry.npmjs.org/primeng, https://cdn.jsdelivr.net/npm/primeng@22.1.4/LICENSE.md | 2026-11-03 | peers `@angular/* ^22.1.0`, `@angular/cdk ^22.1.0`, `rxjs ^6.0.0 \|\| ^7.8.1`; **license: commercial "PrimeUI License", key required**; Community License chosen (see "PrimeNG license") | where the key is read: to confirm in P4-T6 |
| @primeuix/themes | 3.1.0 | https://registry.npmjs.org/@primeuix/themes | 2026-11-03 | depends on `@primeuix/styled ^1.2.0`, the same range as `primeng` 22.1.4; `@primeng/themes` is deprecated in its favour | preset generated in P3-T1; rendering to confirm in P4-T6 |
| rxjs | 7.8.2 | https://registry.npmjs.org/rxjs | 2026-11-03 | satisfies NestJS `^7.1.0`, `@nestjs/typeorm` `^7.2.0`, Angular `^7.4.0`, PrimeNG `^7.8.1`; 9.0.0-beta.1 is `next`, not stable | |
| expo (SDK 58) | 58.0.22 | https://registry.npmjs.org/expo, https://cdn.jsdelivr.net/npm/expo@58.0.22/bundledNativeModules.json | 2026-11-03 | engines `node ^22.13.0 \|\| ^24.3.0 \|\| ^26.0.0 \|\| >=27.0.0`; SDK 58.0.0 published 2026-09-29 | |
| react-native | 0.88.1 | bundledNativeModules.json of expo 58.0.22 | 2026-11-03 | set by SDK 58; peer `react ^19.3.0`; engines `node ^22.13.0 \|\| ^24.3.0 \|\| >= 26.0.0` | |
| react | 19.3.0 | bundledNativeModules.json of expo 58.0.22 | 2026-11-03 | SDK 58 pins exactly 19.3.0; the registry `latest` 19.3.1 is not used | |
| expo-router | 58.0.29 | bundledNativeModules.json of expo 58.0.22 | 2026-11-03 | SDK 58 `~58.0.29`; peers `react-native-screens ^4.30.1`, `react-native-safe-area-context >= 5.4.0` and others, installed with `expo install` | |
| metro (transitive, through `@expo/metro` 58.0.0) | 0.87.1 | https://registry.npmjs.org/@expo/metro, https://registry.npmjs.org/metro | 2026-11-03 | engines `node ^22.13.0 \|\| ^24.3.0 \|\| >= 26.0.0`; not pinned directly | |
| @tanstack/react-query | 5.105.3 | https://registry.npmjs.org/@tanstack/react-query | 2026-11-03 | peer `react ^18 \|\| ^19` | |
| eslint | 10.14.0 | https://registry.npmjs.org/eslint | 2026-11-03 | engines `node ^20.19.0 \|\| ^22.13.0 \|\| >=24`; `typescript-eslint` 8.72.1 accepts `eslint ^10.0.0` | |
| prettier | 3.9.10 | https://registry.npmjs.org/prettier | 2026-11-03 | engines `node >=14` | |
| pino | 10.4.0 | https://registry.npmjs.org/pino | 2026-11-03 | no `engines` field and no peers | Node 26 support: to confirm in P4-T1 |
| @eslint/js (P1-T3) | 10.0.1 | https://registry.npmjs.org/@eslint/js | 2026-11-03 | engines `node ^20.19.0 \|\| ^22.13.0 \|\| >=24`; peer `eslint ^10.0.0` | |
| typescript-eslint (P1-T3) | 8.72.1 | https://registry.npmjs.org/typescript-eslint | 2026-11-03 | engines `node ^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0`; peers `eslint ^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0`, `typescript >=4.8.4 <6.1.0` | |
| husky (P1-T4) | 9.1.7 | https://registry.npmjs.org/husky | 2026-11-03 | engines `node >=18`; no peers | |
| lint-staged (P1-T4) | 17.6.0 | https://registry.npmjs.org/lint-staged | 2026-11-03 | engines `node >=22.22.1`; no peers | |
| @commitlint/cli, @commitlint/config-conventional (P1-T4) | 21.2.4 | https://registry.npmjs.org/@commitlint/cli | 2026-11-03 | engines `node >=22.12.0`; no peers | |
| @commitlint/config-pnpm-scopes (P1-T4) | 21.2.2 | https://registry.npmjs.org/@commitlint/config-pnpm-scopes | 2026-11-03 | engines `node >=22.12.0`; no peers | |
| gitleaks (P1-T4, binary, not an npm package) | 8.30.1 | https://github.com/gitleaks/gitleaks/releases | 2026-11-03 | installed by each developer (Homebrew or release binary), decision 0002 section 5; the hook does not check the version | |
| reflect-metadata (P4-T1) | 0.2.2 | https://registry.npmjs.org/reflect-metadata | 2026-11-04 | no `engines` field and no peers; satisfies the `@nestjs/core` 12.3.2 peer `^0.1.12 \|\| ^0.2.0` | |
| @types/node (P4-T1) | 26.6.6 | https://registry.npmjs.org/@types/node | 2026-11-04 | no `engines` field and no peers; major matches the Node 26 pin; required by `types: ["node"]` in `@kd/tsconfig/node.json` | |
| vitest (P4-T1) | 5.1.0 | https://registry.npmjs.org/vitest | 2026-11-04 | engines `node ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; peers `vite ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0` (not optional), `@types/node ^22.0.0 \|\| >=24.0.0`; inside the `@angular/build` 22.2.5 peer `^4.0.8 \|\| ^5.0.0` (decision 0002) | |
| vite (P4-T1, required peer of vitest) | 8.3.5 | https://registry.npmjs.org/vite | 2026-11-04 | engines `node ^20.19.0 \|\| >=22.12.0`; every peer optional (`@types/node ^20.19.0 \|\| >=22.12.0` among them) | |
| class-validator (P4-T2) | 0.15.1 | https://registry.npmjs.org/class-validator | 2026-11-04 | no `engines` field and no peers; depends on `validator ^13.15.22`, `libphonenumber-js ^1.11.1`; satisfies the `@nestjs/common` 12.3.2 peer `>=0.13.2`; chosen in decision 0005 section 4 | |
| class-transformer (P4-T2) | 0.5.1 | https://registry.npmjs.org/class-transformer | 2026-11-04 | no `engines` field, no peers and no dependencies; satisfies the `@nestjs/common` 12.3.2 peer `>=0.4.1`; chosen in decision 0005 section 4 | |

Rows marked P1-T3 and P1-T4 were recorded at the Phase 1 review (2026-11-03); each was the registry `latest` on that day. Rows marked P4-T1 and P4-T2 were recorded on 2026-11-04, each the registry `latest` on that day; they are pinned in `apps/api` only until a second workspace package uses them, when they move to the catalog (decision 0003, section 3).

### Node range intersection

| Package | Node range |
|---|---|
| @nestjs/core 12.3.2 / @nestjs/cli 12.0.11 / @nestjs/typeorm 12.0.2 | `>= 20` / `>= 20.11` / `>=20.19.0` |
| @angular/cli 22.2.5 | `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` |
| expo 58.0.22 | `^22.13.0 \|\| ^24.3.0 \|\| ^26.0.0 \|\| >=27.0.0` |
| metro 0.87.1 (and react-native 0.88.1) | `^22.13.0 \|\| ^24.3.0 \|\| >= 26.0.0` |
| pnpm 12.16.1 | `>=18` |
| typeorm 1.1.2, eslint 10.14.0 (checked as well) | `^20.19.0 \|\| ^22.13.0 \|\| >=24.11.0`, `^20.19.0 \|\| ^22.13.0 \|\| >=24` |
| **Intersection** | **`^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`** (Angular CLI is the binding range) |

Checked with `semver.satisfies` against every range: 22.22.3, 24.15.0, 26.0.0 and 26.13.0 pass; 22.22.2 and 24.14.9 fail. The pin **26.13.0** sits inside the intersection.

## Choice

Install exactly the versions in the evidence table. The Node pin goes into `.nvmrc` and `engines`, the pnpm pin into `packageManager`, in P1-T1.

- **Scaffold-plan item 1 / ADR-0001 open item 3:** yes. `@nestjs/typeorm` 12.0.2 declares `typeorm ^0.3.0 || ^1.0.0-dev`, which 1.1.2 satisfies (checked with `semver`), and the package is developed against `typeorm` 1.1.1. Fallback: if P4-T3 finds a runtime incompatibility, pin `typeorm` 0.3.31 (latest 0.3.x). The trigger to move back to 1.x is a `@nestjs/typeorm` release that fixes the incompatibility.
- `migration:generate` stays unused, PostGIS or not: the schema is hand-written SQL migrations with `synchronize` off (ADR-0001).
- **Scaffold-plan item 7:** settled by `kitchen-daylight-docker` decision 0001 (PostgreSQL 18, which provides `uuidv7()`); no application-side UUIDv7 generator.

Packages not in the table (for example `reflect-metadata`, `class-validator`, `@angular/cdk`, `typescript-eslint`) are pinned by the task that adds them, with the same method, and recorded here.

## Reason

Latest stable everywhere except where a peer range forbids it: TypeScript is held at 6.0.x by Angular 22 and `typescript-eslint`, and React at 19.3.0 by Expo SDK 58. One Node line (26 LTS) is inside every engine range and is supported until 2029-04-30.

## Consequences

- **Exact pins.** Every `package.json` uses exact versions (no `^`, `~` or `latest`); the lockfile is committed.
- **Lockstep groups.** All `@angular/*` framework packages move together, as do `@angular/cli` with `@angular/build`, the NestJS core packages, and the Expo SDK with every package listed in its `bundledNativeModules.json` (updated with `expo install --fix`, never one by one).
- **Majors** (Node line, pnpm, TypeScript, NestJS, Angular, PrimeNG, Expo SDK, TypeORM, ESLint) each get their own pull request that also updates this record.
- **Minor and patch updates** arrive through grouped Dependabot pull requests; the grouping is written in P5-T2.
- **Approval.** The repository owner approves every pull request that changes a pin; a major also needs green CI.
- **Upgrade triggers.** TypeScript 7 once `@angular/compiler-cli` and `typescript-eslint` accept it. The Node pin moves to the next LTS line before 2029-04-30.

## PrimeNG license (decided by the owner, 2026-11-03)

`primeng` 22.0.0 and later (including 22.1.4) ship under the commercial **PrimeUI License**. A license key is required, and without one the library may display a license notice. The free Community License covers organisations under USD 1,000,000 annual revenue, with fewer than 5 developers and fewer than 10 employees, and must be renewed every year. `primeng` 21.1.10 and earlier ship under MIT, but they require Angular 21 (`@angular/core ^21.0.7`; latest 21.x is 21.2.26), whose LTS ends 2027-06 (https://angular.dev/reference/releases, read 2026-11-03).

Options considered:

1. Keep PrimeNG 22.1.4 under the Community License.
2. Stay on Angular 21.2.26 + PrimeNG 21.1.10 (MIT). Rejected: Angular 21 leaves LTS in 2027-06, and moving to Angular 22 or later meets the same license.
3. Replace PrimeNG. Rejected: it changes ADR-0001 and the PrimeNG preset generated in P3-T1, with no license gain for an organisation that qualifies for the Community License.

**Choice: option 1.** Consequences:

- The owner confirms Community License eligibility and renews it every year; a lapsed key may show a license notice in the admin app.
- The license key is configuration, never committed (the repository is public): a local env value and a CI secret. Where PrimeNG reads the key is to be confirmed in P4-T6.
- Upgrade trigger: if the organisation stops qualifying for the Community License, a commercial license or option 3 is decided in a new record.
