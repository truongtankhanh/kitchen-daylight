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
| @nestjs/typeorm | 12.0.2 | https://registry.npmjs.org/@nestjs/typeorm | 2026-11-03 | peers `typeorm ^0.3.0 \|\| ^1.0.0-dev`, `@nestjs/common` and `@nestjs/core ^10 \|\| ^11 \|\| ^12`, `rxjs ^7.2.0`; engines `node >=20.19.0`; its own devDependency is `typeorm 1.1.1` | runtime without PostGIS columns confirmed in P4-T3 and P4-T9 (`migrate`, `GET /api/health` against PostgreSQL 18, smoke run 3); PostGIS columns: to confirm by the first slice that adds one |
| typeorm | 1.1.2 | https://registry.npmjs.org/typeorm | 2026-11-03 | peer `pg ^8.5.1` (other drivers optional); engines `node ^20.19.0 \|\| ^22.13.0 \|\| >=24.11.0` | |
| pg | 8.23.1 | https://registry.npmjs.org/pg | 2026-11-03 | engines `node >= 16.0.0`; peer `pg-native` optional and not used | |
| @angular/core and the framework packages (incl. `@angular/compiler-cli`) | 22.2.4 | https://registry.npmjs.org/@angular/core | 2026-11-03 | peers `rxjs ^6.5.3 \|\| ^7.4.0`, `zone.js ~0.15.0 \|\| ~0.16.0` (optional); compiler-cli peer `typescript >=6.0 <6.1`; engines `node ^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` | |
| @angular/cli, @angular/build | 22.2.5 | https://registry.npmjs.org/@angular/cli | 2026-11-03 | engines `node ^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`; build peer `typescript >=6.0 <6.1` | |
| primeng | 22.1.4 | https://registry.npmjs.org/primeng, https://cdn.jsdelivr.net/npm/primeng@22.1.4/LICENSE.md | 2026-11-03 | peers `@angular/* ^22.1.0`, `@angular/cdk ^22.1.0`, `rxjs ^6.0.0 \|\| ^7.8.1`; **license: commercial "PrimeUI License", key required**; Community License chosen (see "PrimeNG license") | where the key is read: **not decided** in P4-T6 (`apps/admin/src/app/app.config.ts` leaves `license` unset); to decide before the first admin release |
| @primeuix/themes | 3.1.0 | https://registry.npmjs.org/@primeuix/themes | 2026-11-03 | depends on `@primeuix/styled ^1.2.0`, the same range as `primeng` 22.1.4; `@primeng/themes` is deprecated in its favour | preset generated in P3-T1; wired in P4-T6 (`providePrimeNG` from `primeng/config`, `ng build` passes); rendering in a browser not checked yet: to confirm with the first admin screen |
| rxjs | 7.8.2 | https://registry.npmjs.org/rxjs | 2026-11-03 | satisfies NestJS `^7.1.0`, `@nestjs/typeorm` `^7.2.0`, Angular `^7.4.0`, PrimeNG `^7.8.1`; 9.0.0-beta.1 is `next`, not stable | |
| expo (SDK 58) | 58.0.22 | https://registry.npmjs.org/expo, https://cdn.jsdelivr.net/npm/expo@58.0.22/bundledNativeModules.json | 2026-11-03 | engines `node ^22.13.0 \|\| ^24.3.0 \|\| ^26.0.0 \|\| >=27.0.0`; SDK 58.0.0 published 2026-09-29 | |
| react-native | 0.88.1 | bundledNativeModules.json of expo 58.0.22 | 2026-11-03 | set by SDK 58; peer `react ^19.3.0`; engines `node ^22.13.0 \|\| ^24.3.0 \|\| >= 26.0.0` | |
| react | 19.3.0 | bundledNativeModules.json of expo 58.0.22 | 2026-11-03 | SDK 58 pins exactly 19.3.0; the registry `latest` 19.3.1 is not used | |
| expo-router | 58.0.29 | bundledNativeModules.json of expo 58.0.22 | 2026-11-03 | SDK 58 `~58.0.29`; peers `react-native-screens ^4.30.1`, `react-native-safe-area-context >= 5.4.0` and others, installed with `expo install` | |
| metro (transitive, through `@expo/metro` 58.0.0) | 0.87.1 | https://registry.npmjs.org/@expo/metro, https://registry.npmjs.org/metro | 2026-11-03 | engines `node ^22.13.0 \|\| ^24.3.0 \|\| >= 26.0.0`; not pinned directly | |
| @tanstack/react-query | 5.105.3 | https://registry.npmjs.org/@tanstack/react-query | 2026-11-03 | peer `react ^18 \|\| ^19` | |
| eslint | 10.14.0 | https://registry.npmjs.org/eslint | 2026-11-03 | engines `node ^20.19.0 \|\| ^22.13.0 \|\| >=24`; `typescript-eslint` 8.72.1 accepts `eslint ^10.0.0` | |
| prettier | 3.9.10 | https://registry.npmjs.org/prettier | 2026-11-03 | engines `node >=14` | |
| pino | 10.4.0 | https://registry.npmjs.org/pino | 2026-11-03 (re-read 2026-11-05, A0-T2) | no `engines` field and no peers; installed in `apps/api` by A0-T2 (decision 0007 section 1). **Node 26.13.0 confirmed 2026-11-05**: loaded from `apps/api` under Node 26.13.0, it wrote a JSON line with a `redact` path censored. No page states Node support for 10.x (pino `docs/lts.md` ends at 9.x, decision 0007 S4) | |
| @eslint/js (P1-T3) | 10.0.1 | https://registry.npmjs.org/@eslint/js | 2026-11-03 | engines `node ^20.19.0 \|\| ^22.13.0 \|\| >=24`; peer `eslint ^10.0.0` | |
| typescript-eslint (P1-T3) | 8.72.1 | https://registry.npmjs.org/typescript-eslint | 2026-11-03 | engines `node ^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0`; peers `eslint ^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0`, `typescript >=4.8.4 <6.1.0` | |
| husky (P1-T4) | 9.1.7 | https://registry.npmjs.org/husky | 2026-11-03 | engines `node >=18`; no peers | |
| lint-staged (P1-T4) | 17.6.0 | https://registry.npmjs.org/lint-staged | 2026-11-03 | engines `node >=22.22.1`; no peers | |
| @commitlint/cli, @commitlint/config-conventional (P1-T4) | 21.2.4 | https://registry.npmjs.org/@commitlint/cli | 2026-11-03 | engines `node >=22.12.0`; no peers | |
| @commitlint/config-pnpm-scopes (P1-T4) | 21.2.2 | https://registry.npmjs.org/@commitlint/config-pnpm-scopes | 2026-11-03 | engines `node >=22.12.0`; no peers | |
| gitleaks (P1-T4, binary, not an npm package) | 8.30.1 | https://github.com/gitleaks/gitleaks/releases | 2026-11-03 | installed by each developer (Homebrew or release binary), decision 0002 section 5; the hook does not check the version; CI (P5-T2, `security.yml`) downloads `gitleaks_8.30.1_linux_x64.tar.gz` and checks its SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (release checksums file) | |
| reflect-metadata (P4-T1) | 0.2.2 | https://registry.npmjs.org/reflect-metadata | 2026-11-04 | no `engines` field and no peers; satisfies the `@nestjs/core` 12.3.2 peer `^0.1.12 \|\| ^0.2.0` | |
| @types/node (P4-T1) | 26.6.6 | https://registry.npmjs.org/@types/node | 2026-11-04 | no `engines` field and no peers; major matches the Node 26 pin; required by `types: ["node"]` in `@kd/tsconfig/node.json` | |
| vitest (P4-T1) | 5.1.0 | https://registry.npmjs.org/vitest | 2026-11-04 | engines `node ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; peers `vite ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0` (not optional), `@types/node ^22.0.0 \|\| >=24.0.0`; inside the `@angular/build` 22.2.5 peer `^4.0.8 \|\| ^5.0.0` (decision 0002) | |
| vite (P4-T1, required peer of vitest) | 8.3.5 | https://registry.npmjs.org/vite | 2026-11-04 | engines `node ^20.19.0 \|\| >=22.12.0`; every peer optional (`@types/node ^20.19.0 \|\| >=22.12.0` among them) | |
| class-validator (P4-T2) | 0.15.1 | https://registry.npmjs.org/class-validator | 2026-11-04 | no `engines` field and no peers; depends on `validator ^13.15.22`, `libphonenumber-js ^1.11.1`; satisfies the `@nestjs/common` 12.3.2 peer `>=0.13.2`; chosen in decision 0005 section 4 | |
| class-transformer (P4-T2) | 0.5.1 | https://registry.npmjs.org/class-transformer | 2026-11-04 | no `engines` field, no peers and no dependencies; satisfies the `@nestjs/common` 12.3.2 peer `>=0.4.1`; chosen in decision 0005 section 4 | |
| @angular/cdk (P4-T6) | 22.2.5 | https://registry.npmjs.org/@angular/cdk | 2026-11-04 | peers `@angular/core`, `@angular/common`, `@angular/forms`, `@angular/platform-browser` `^22.0.0 \|\| ^23.0.0`, `rxjs ^6.5.3 \|\| ^7.4.0`; satisfies the `primeng` 22.1.4 peer `^22.1.0`; versioned apart from the framework lockstep group | |
| tslib (P4-T6) | 2.9.1 | https://registry.npmjs.org/tslib | 2026-11-04 | no `engines` field and no peers; satisfies the `@angular/core` 22.2.4 and `primeng` 22.1.4 range `^2.3.0`; needed by `importHelpers` in `@kd/tsconfig/web.json` | |
| jsdom (P4-T6) | 30.1.3 | https://registry.npmjs.org/jsdom | 2026-11-04 | engines `node ^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`; optional peer `canvas`, not installed; the Node test environment of `ng test` with Vitest (decision 0002) | |
| @expo/metro-runtime (P4-T7) | 58.0.16 | bundledNativeModules.json of expo 58.0.22 | 2026-11-04 | SDK 58 `~58.0.16`; required peer of `expo-router` 58.0.29; peers `react-dom` (not optional) and `@expo/log-box ^58.0.14` | |
| expo-constants (P4-T7) | 58.0.14 | bundledNativeModules.json of expo 58.0.22 | 2026-11-04 | SDK 58 `~58.0.14`; required peer of `expo-router`; reads `extra.apiBaseUrl` at runtime (decision 0006 item 9) | |
| expo-linking (P4-T7) | 58.0.15 | bundledNativeModules.json of expo 58.0.22 | 2026-11-04 | SDK 58 `~58.0.15`; required peer of `expo-router` | |
| react-native-screens (P4-T7) | 4.30.1 | bundledNativeModules.json of expo 58.0.22 | 2026-11-04 | SDK 58 `~4.30.1`; required peer of `expo-router`; peers `react`, `react-native` | |
| react-native-safe-area-context (P4-T7) | 5.10.1 | bundledNativeModules.json of expo 58.0.22 | 2026-11-04 | SDK 58 `~5.10.1`; required peer of `expo-router` (`>= 5.4.0`) | |
| react-dom (P4-T7) | 19.3.0 | bundledNativeModules.json of expo 58.0.22 | 2026-11-04 | SDK 58 pins exactly 19.3.0; required peer of `@expo/metro-runtime`. Pinned so pnpm does not auto-install the registry `latest` 19.3.1, whose peer `react ^19.3.1` the SDK's `react` 19.3.0 fails | |
| jest-expo (P4-T7) | 58.0.13 | bundledNativeModules.json of expo 58.0.22 | 2026-11-04 | SDK 58 `~58.0.13`; peers `jest ^29.0.0 \|\| ^30.0.0`, `@react-native/jest-preset ^0.88.1` (decision 0002) | |
| jest (P4-T7) | 30.5.2 | https://registry.npmjs.org/jest | 2026-11-04 | engines `node ^18.14.0 \|\| ^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0`; inside the `jest-expo` peer range | |
| @react-native/jest-preset (P4-T7) | 0.88.1 | https://registry.npmjs.org/@react-native/jest-preset | 2026-11-04 | required peer of `jest-expo` (`^0.88.1`); same version as `react-native`; engines `node >=22.13.0`; peer `react ^19.2.3` | |
| @types/react (P4-T7) | 19.3.0 | https://registry.npmjs.org/@types/react | 2026-11-04 | no `engines` field and no peers; registry `latest`, matches `react` 19.3.0 | |
| @nestjs/swagger (P4-T8) | 12.1.0 | https://registry.npmjs.org/@nestjs/swagger | 2026-11-04 | peers `@nestjs/common` and `@nestjs/core ^12.0.0`, `reflect-metadata ^0.1.12 \|\| ^0.2.0`; `typescript ^5.5.0 \|\| ^6.0.0`, `class-validator`, `class-transformer` and `@fastify/static` optional; engines `node ^20.19.0 \|\| >=22.12.0`; chosen in decision 0004 section 1. Its `swagger-ui-dist` pulls `@scarf/scarf`, whose install script is denied in `allowBuilds` | |
| openapi-typescript (P4-T8) | 7.13.0 | https://registry.npmjs.org/openapi-typescript | 2026-11-04 | **peer `typescript ^5.x`**, unmet by 6.0.3 and allowed by the scoped `peerDependencyRules` entry in `pnpm-workspace.yaml`; generation with TypeScript 6.0.3 works (P4-T8), so the decision 0004 section 4 fallback is not used; chosen in decision 0004 section 4 | |
| openapi-fetch (P4-T8) | 0.17.0 | https://registry.npmjs.org/openapi-fetch | 2026-11-04 | one dependency `openapi-typescript-helpers ^0.1.0`; no peers; chosen in decision 0004 section 4 | React Native 0.88.1 runtime: to confirm with the first call from the mobile app |
| oasdiff (P5-T1, binary, not an npm package) | 1.35.0 | https://github.com/oasdiff/oasdiff/releases/tag/v1.35.0 | 2026-11-04 | Go binary; CI downloads `oasdiff_1.35.0_linux_amd64.tar.gz` and checks its SHA-256 `a8023002fcb2eaa7f5758148a9303cb63d33b939886df312268bc0fc7b939140` (release `checksums.txt`); installed only once `packages/contracts/openapi.released.json` exists; chosen in decision 0004 section 3b | first real run: at the first release |
| actions/checkout (P5-T1, GitHub Action) | v7.0.1 | https://github.com/actions/checkout/releases | 2026-11-04 | pinned by commit `3d3c42e5aac5ba805825da76410c181273ba90b1`; runtime `node24` | |
| pnpm/action-setup (P5-T1, GitHub Action) | v6.1.1 | https://github.com/pnpm/action-setup/releases | 2026-11-04 | pinned by commit `73e46992e05b19abd31f2f3c20e0e7370d762115` (annotated tag dereferenced); reads `packageManager`; runtime `node24` | pnpm 12 store cache: to confirm with the first CI run |
| actions/setup-node (P5-T1, GitHub Action) | v7.1.0 | https://github.com/actions/setup-node/releases | 2026-11-04 | pinned by commit `949feb2413d6458794dcd2491c4babbbce0c15c1`; reads `.nvmrc`; runtime `node24` | |
| actions/cache (P5-T1, GitHub Action) | v6.1.0 | https://github.com/actions/cache/releases | 2026-11-04 | pinned by commit `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`; runtime `node24` | |
| actions/dependency-review-action (P5-T2, GitHub Action) | v5.0.0 | https://github.com/actions/dependency-review-action/releases | 2026-11-04 | pinned by commit `a1d282b36b6f3519aa1f3fc636f609c47dddb294` (lightweight tag); runtime `node24`; chosen in decision 0002 section 7 | reads the two-document pnpm 12 lockfile through the dependency graph, observed 2026-11-04 (decision 0002, implementation notes Phase 5) |
| docker/setup-buildx-action (P5-T3, GitHub Action) | v4.4.1 | https://github.com/docker/setup-buildx-action/releases | 2026-11-04 | pinned by commit `f87e5991a6d7451dcb8d9637bfbc97413f497069` (lightweight tag); runtime `node24`; default `docker-container` driver, needed for the `gha` layer cache | |
| docker/build-push-action (P5-T3, GitHub Action) | v7.4.0 | https://github.com/docker/build-push-action/releases | 2026-11-04 | pinned by commit `c3c9e263c25d99ce0380d002d59b67737d91b0dc` (lightweight tag); runtime `node24`; inputs `push`, `load`, `platforms`, `cache-from`, `cache-to` | |
| moby/buildkit (P5-T3, container image of the Buildx builder) | v0.34.2 | https://github.com/moby/buildkit/releases/tag/v0.34.2 | 2026-11-04 | pinned by multi-platform index digest `sha256:c5f8862f52499773af85bc07695b2379ef08e8002352b0df2c4864c91d78dabe` through `driver-opts` of `docker/setup-buildx-action`, instead of its moving `buildx-stable-1` default; released 2026-11-03 | |
| docker/setup-qemu-action (P5-T4, GitHub Action) | v4.4.0 | https://github.com/docker/setup-qemu-action/releases | 2026-11-04 | pinned by commit `99012661954931238ded8c8b007157a8430204e1` (lightweight tag); runtime `node24`; arm64 emulation for the publish build | |
| docker/login-action (P5-T4, GitHub Action) | v4.7.0 | https://github.com/docker/login-action/releases | 2026-11-04 | pinned by commit `81c6f93d4bc991e510b342a00b419b3bb4efc5c6` (lightweight tag); runtime `node24`; logs in to `ghcr.io` with the workflow's `GITHUB_TOKEN` | |
| tonistiigi/binfmt (P5-T4, container image of the QEMU setup) | qemu-v10.2.3 | https://hub.docker.com/r/tonistiigi/binfmt/tags | 2026-11-04 | pinned by multi-platform index digest `sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0` through the `image` input of `docker/setup-qemu-action`, instead of its moving `latest` default (the same digest as `latest` on that day) | |
| nestjs-pino (A0-T2) | 5.3.1 | https://registry.npmjs.org/nestjs-pino, https://github.com/iamolegga/nestjs-pino | 2026-11-05 | peers `@nestjs/common` and `@nestjs/core ^11.0.8 \|\| ^12.0.2` (12.3.2 satisfies), `pino ^10.0.0`, `pino-http ^11.0.0`, `rxjs ^7.1.0`; engines `node >=22.12.0`; no dependencies; ESM entry through its `exports` map; chosen in decision 0005 section 11 and decision 0007 section 1 | |
| pino-http (A0-T2) | 11.0.0 | https://registry.npmjs.org/pino-http | 2026-11-05 | no `engines` field and no peers; depends on `pino ^10.0.0` (10.4.0 satisfies) and `pino-std-serializers ^7.0.0`; required peer of `nestjs-pino`; chosen in decision 0005 section 11 and decision 0007 section 1 | |
| @nestjs/testing (A0-T9, dev dependency) | 12.3.2 | https://registry.npmjs.org/@nestjs/testing | 2026-11-05 | published 2026-10-27; peers `@nestjs/common` and `@nestjs/core ^12.0.0` (12.3.2 satisfies), `@nestjs/microservices` and `@nestjs/platform-express ^12.0.0` optional; depends on `tslib 2.8.1`; no `engines` field. Kept equal to `@nestjs/core` 12.3.2 rather than the registry `latest` 12.3.3, so the testing module builds the same container code as the server. Used only by `apps/api/test/support/create-test-app.ts` for `overrideProvider(Clock)` (owner answer, 2026-11-05) | |

Rows marked P1-T3 and P1-T4 were recorded at the Phase 1 review (2026-11-03); each was the registry `latest` on that day. Rows marked P4-T1, P4-T2 and P4-T6 were recorded on 2026-11-04, each the registry `latest` on that day; they are pinned in `apps/api` only until a second workspace package uses them, when they move to the catalog (decision 0003, section 3). Rows marked P4-T7 were recorded on 2026-11-04 from the `bundledNativeModules.json` of expo 58.0.22 (or the registry `latest` where the SDK names none); they stay pinned in `apps/mobile`, because `expo install --fix` maintains the Expo-managed set (decision 0003, section 3). Rows marked P4-T8 were recorded on 2026-11-04, each the registry `latest` on that day; each is used by one workspace package (`@kd/api` or `@kd/contracts`) and pinned there. Rows marked P5-T1 were recorded on 2026-11-04 from the GitHub releases API (`gh api`, read-only), each the latest release on that day; the actions are pinned by full commit SHA in `.github/workflows/ci.yml`, with the tag in a comment. The P5-T2 row was recorded the same way on 2026-11-04 and is pinned in `.github/workflows/security.yml`, which reuses the P5-T1 action pins. Rows marked P5-T3 were recorded on 2026-11-04 from the GitHub releases API (`gh api`, read-only) and `git ls-remote`, each the latest release on that day; the BuildKit digest was read from the Docker Hub registry manifest of the tag. They are pinned in `.github/workflows/api-image.yml`, for the publish workflow (P5-T4) to reuse. Rows marked P5-T4 were recorded the same way on 2026-11-04 (the binfmt digest from the Docker Hub registry manifest) and are pinned in `.github/workflows/publish-api-image.yml`, which reuses the P5-T1 and P5-T3 pins. Rows marked A0-T2 were recorded on 2026-11-05 with read-only `npm view <pkg> version peerDependencies engines dependencies --json`, each the registry `latest` on that day and the version decision 0007 named; `pino-pretty` is not installed (JSON to stdout in every tier, decision 0005 section 11). The three logging packages are pinned in `apps/api` only. The A0-T9 row was recorded on 2026-11-05 with read-only `npm view @nestjs/testing@12.3.2 version peerDependencies peerDependenciesMeta dependencies engines` and pinned exactly in `apps/api` (`devDependencies`).

**Pending SDK 58 patch (P4-T7, 2026-11-04).** `expo-doctor` expects the newer `expo` 58.0.23 set (published 2026-11-03 from 16:06Z to 17:06Z). It is not installed yet: pnpm's default `minimumReleaseAge` (one day) rejects it until about 2026-11-04 17:07Z, and adding `minimumReleaseAgeExclude` entries was rejected. After that time the whole set moves together (`expo`, `expo-router`, `@expo/metro-runtime`, `expo-constants`, `expo-linking`, `react-native-safe-area-context`, `jest-expo`), with no exclusion, and these rows are updated.

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
