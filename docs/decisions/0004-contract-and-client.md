# 0004. Contract workflow and client generator

Status: **accepted** (P0-T5, proposed 2026-11-03; accepted by the owner 2026-11-03, Phase 0 gate). Fixes how the OpenAPI document is produced, how the committed snapshot is kept deterministic, what `openapi:check` checks, which client generator `@kd/contracts` uses, where the generated client lives, and where the hand-written realtime event and error types live. Answers the three P0-T5 items left open by 0003 (generation without a database or network, the generated-client subpath, the location of the last released snapshot).

## Context

- ADR-0001 (API style row, proposed): REST + OpenAPI, typed clients generated for admin and mobile.
- scaffold-plan section 3: `apps/api` builds the document from decorated controllers and DTOs; `pnpm openapi:generate` writes the committed snapshot `packages/contracts/openapi.json`; `pnpm openapi:check` in CI fails on drift and on breaking changes against the last released snapshot; a typed client is generated from the snapshot into `packages/contracts`; realtime event types are hand-written once in `packages/contracts`. The client generator is chosen on three criteria: (1) works in Angular and React Native without Node-only APIs, (2) types `application/problem+json` errors, (3) no runtime dependency heavier than `fetch`. The candidates were not evaluated; the starting recommendation is a type-only generator.
- api-outline Conventions: base path `/api/v1`; JSON with `camelCase` keys; errors are `application/problem+json` (RFC 9457 shape) with `type`, `title`, `status`, `detail`, a stable `code` and `errors[]` of `{field, code, message}`; some codes carry extra members; "Additive changes only within `v1`".
- 0001: Node 26.13.0, pnpm 12.16.1, TypeScript 6.0.3 (held below 6.1 by Angular and `typescript-eslint`), NestJS 12.3.2, Angular 22.2.4, Expo SDK 58 / React Native 0.88.1. Packages not in its table are pinned by the task that adds them and recorded there.
- 0003: `@kd/contracts` is a compiled ESM package; `@kd/api` may import it at runtime for realtime event types and shared constants, never the generated client; `@kd/api#openapi:generate` and `#openapi:check` depend on `build` and must be pure functions of their inputs (no database, no network, no clock); the last released snapshot is a committed file, not a git tag lookup; `@kd/contracts#build` reads the committed snapshot and does not depend on `openapi:generate`.

## Evidence

Read on 2026-11-03. Registry data from read-only `npm view <pkg> version peerDependencies dependencies engines license time --json` (source `https://registry.npmjs.org/<pkg>`). Claims are cited as [S#] or marked **not verified**.

| ID | Source |
|---|---|
| S1 | https://docs.nestjs.com/openapi/cli-plugin: the plugin "enhances the TypeScript compilation process", annotates DTO properties with `@ApiProperty()` and infers `required`, `type` and `default`. Enabled in `nest-cli.json` `compilerOptions.plugins`. Options: `dtoFileNameSuffix` (default `['.dto.ts', '.entity.ts']`), `controllerFileNameSuffix` (`['.controller.ts']`), `classValidatorShim` (`true`), `introspectComments` (`false`), `esmCompatible` (detected per file). "using CLI plugins with the SWC builder requires type checking to be enabled"; monorepo + SWC uses a `generate-metadata.ts` file and `SwaggerModule#loadPluginMetadata()`. ts-jest "doesn't use the Nest CLI compiler, and it doesn't apply any plugins" |
| S2 | https://docs.nestjs.com/openapi/introduction: `SwaggerModule.createDocument` takes "an application instance and the base document configuration"; the result is "a serializable object" that can be saved "as a JSON or YAML file". Options include `operationIdFactory` (default `controllerKey_methodKey_version`), `autoTagControllers` and `excludeDynamicDefaults` (leaves out non-plain-object defaults so the document stays stable across restarts) |
| S3 | https://github.com/nestjs/nest/blob/master/packages/common/interfaces/nest-application-context-options.interface.ts: `preview?: boolean`, "In the preview mode, providers/controllers are not instantiated & resolved", default `false`; `abortOnError` (default `true`; `false` rethrows instead of exiting); `logger` (`false` turns logging off) |
| S4 | Registry, `@nestjs/swagger` 12.1.0: peers `typescript ^5.5.0 \|\| ^6.0.0`, `@nestjs/common` and `@nestjs/core ^12.0.0`, `reflect-metadata ^0.1.12 \|\| ^0.2.0`, `class-validator *`, `class-transformer *`, `@fastify/static ^8 \|\| ^9 \|\| ^10` (whether optional: **not verified**); engines `node ^20.19.0 \|\| >=22.12.0`; MIT |
| S5 | https://github.com/oasdiff/oasdiff: Go tool; installed with `go install`, Homebrew, a curl script, asdf, pre-built binaries or Docker; no npm package listed; Apache-2.0 |
| S6 | https://github.com/oasdiff/oasdiff/blob/main/docs/BREAKING-CHANGES.md: `oasdiff breaking <base> <revision>` reports `ERR` (breaking) and `WARN` (possibly breaking); `--fail-on ERR` exits 1 on `ERR`; accepted exceptions go in an `--err-ignore <file>` with one "method path description" line each |
| S7 | https://www.oasdiff.com/docs/breaking-changes: `response-media-type-removed` and `request-body-media-type-removed` are Breaking; `response-media-type-added` and `request-body-media-type-added` are Info. Schemas are compared per media type |
| S8 | https://api.github.com/repos/oasdiff/oasdiff/releases/latest: `v1.35.0`, published 2026-10-28; assets for darwin (universal), linux amd64/arm64, windows, plus `checksums.txt` |
| S9 | https://github.com/oasdiff/oasdiff-action: `breaking`, `changelog`, `diff`, `validate` actions; inputs `base`, `revision`, `fail-on`; examples use the moving tag `@v0`. Which oasdiff version a given action release runs: **not stated** |
| S10 | Registry, `openapi-diff` 0.24.1 (Atlassian): last modified 2025-08-06; dependencies include `axios`, `swagger-parser`, `json-schema-diff`; engines `node >=18`. Media-type handling: **not stated** |
| S11 | Registry, `@useoptic/optic` 1.0.9: dependencies include `@segment/analytics-node`, `@sentry/node`, `node-machine-id`, `mockttp`, `@octokit/rest` |
| S12 | https://openapi-ts.dev/introduction: `openapi-typescript` 7.x generates "runtime-free types" from OpenAPI 3.0 and 3.1; recommends `noUncheckedIndexedAccess` |
| S13 | Registry, `openapi-typescript`: `latest` 7.13.0, published 2026-02-11, no later version; `next` is the old 7.0.0-rc.1; **peer `typescript ^5.x`**; MIT |
| S14 | https://openapi-ts.dev/openapi-fetch/: `openapi-fetch` "weighs 6 kb"; methods are "thin wrappers around the native fetch API"; `data` only on 2XX, `error` only on 4XX/5XX; React Native is **not mentioned** |
| S15 | https://github.com/openapi-ts/openapi-typescript/blob/main/packages/openapi-fetch/src/index.d.ts: `createClient<Paths, Media extends MediaType = MediaType>`; the error branch is `error: ErrorResponse<ResponseObjectMap<T>, Media>`; `ClientOptions` has `baseUrl`, `fetch`, `Request`, `headers`, serializers |
| S16 | https://github.com/openapi-ts/openapi-typescript/blob/main/packages/openapi-typescript-helpers/src/index.ts: ``MediaType = `${string}/${string}` ``, so the default `Media` matches `application/problem+json`. The `JSONLike`, `SuccessResponseJSON` and `ErrorResponseJSON` helpers filter on `` `${string}/json` ``, which does **not** match `application/problem+json` |
| S17 | https://github.com/openapi-ts/openapi-typescript/blob/main/packages/openapi-fetch/src/index.js: no `node:` import and no `Buffer`; uses `Request`, `Headers`, and `URLSearchParams` (form body serializer only); `process` only behind a `typeof` guard; a non-2xx body is read as text and `JSON.parse`d without checking `Content-Type`; 204 and `Content-Length: 0` skip parsing |
| S18 | https://openapi-ts.dev/openapi-fetch/api: `fetch` option (default `globalThis.fetch`); middleware with `onRequest`, `onResponse`, `onError` |
| S19 | Registry, `openapi-fetch` 0.17.0 (2026-02-11): one dependency, `openapi-typescript-helpers ^0.1.0`; no peers; MIT |
| S20 | https://heyapi.dev/openapi-ts/get-started: "This package is in initial development. Please pin an exact version"; "runs in any Node.js 22+ environment" |
| S21 | Registry, `@hey-api/openapi-ts` 0.99.0: peer `typescript >=5.5.3 \|\| >=6.0.0`; engines `node >=22.18.0`; `@hey-api/client-fetch` is deprecated: "Starting with v0.73.0, this package is bundled directly inside @hey-api/openapi-ts" |
| S22 | https://github.com/hey-api/openapi-ts/blob/main/packages/openapi-ts/src/plugins/@hey-api/client-fetch/bundle/client.ts: web APIs only (`Request`, `Response`, `FormData`, `globalThis.fetch`), no `fs`, `process` or `Buffer`; error body parsed as JSON without checking `Content-Type`. How error types are chosen per media type: **not verified** |
| S23 | Registry, `orval` 8.46.0: dependencies include `@orval/angular`, `@orval/query`, `@orval/zod`, `@orval/mock`, `@orval/mcp`, `chokidar`, `execa`; engines `node >=22.18.0`. Its fetch output's runtime dependencies and error typing: **not verified** |
| S24 | Registry, `@openapitools/openapi-generator-cli` 2.42.0: an npm wrapper whose dependencies include `@nestjs/core` 11.2.3, `axios` and `proxy-agent`. It wraps the Java OpenAPI Generator; the Java runtime requirement is **not re-verified** here |

## 1. Producing the OpenAPI document

**Options:**

| Option | Notes |
|---|---|
| A. `@nestjs/swagger` with explicit decorators only | Every DTO property needs `@ApiProperty()`; the document drifts from the TypeScript types whenever a decorator is forgotten |
| B. `@nestjs/swagger` with its CLI plugin | Optionality, types and `class-validator` constraints are read from the code at compile time [S1]; explicit decorators remain for what the compiler cannot see (error responses, media types) |
| C. Another source (hand-written spec, Zod-first) | Contradicts scaffold-plan section 3 (the document comes from controllers and DTOs) |

**Choice: B.** `@nestjs/swagger` 12.1.0 (peers accept NestJS 12 and TypeScript 6 [S4]) with the CLI plugin in `apps/api/nest-cli.json`:

- `dtoFileNameSuffix: ['.dto.ts']`: entities are not DTOs and never reach the contract (the default also scans `.entity.ts` [S1]).
- `classValidatorShim: true` (default) and `introspectComments: true`, so DTO doc comments become descriptions.
- If P0-T6 picks the SWC builder, type checking is on and plugin metadata goes through `generate-metadata.ts` and `loadPluginMetadata()` [S1]. With the `tsc` builder, nothing extra is needed.

**Reason:** B is the option where the document follows the TypeScript types without a second hand-maintained description, and it is the documented NestJS path.

### The generator, without a database or network

- **Entry:** `apps/api/src/openapi/generate.ts`, compiled by `nest build` and run as `node dist/openapi/generate.js --out <path>`. 0003 already makes `openapi:generate` depend on `build`, so the plugin output is always in place, and no TypeScript runner is needed.
- **Environment first:** before it loads `AppModule` (with a dynamic `import()`, so that the assignment runs first), the script sets a placeholder for every variable that configuration validation requires. The database URL points at `127.0.0.1:1`, so any connection attempt fails at once instead of hanging. No secret and no real host is ever needed.
- **Application context:** `NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false })`. In preview mode, providers and controllers are not instantiated [S3]. So the TypeORM `DataSource` factory, the mail and S3 clients and every other provider factory never run, and nothing connects. `abortOnError: false` turns a bootstrap failure into a thrown error with a non-zero exit, instead of a silent exit [S3]. The script never calls `app.init()` or `app.listen()`.
- **Same routes as production:** `main.ts` and the generator both call one shared `configureApp(app)` function (global prefix `api`, URI versioning `v1`), so the paths in the document are the real paths.
- **Document:** `SwaggerModule.createDocument(app, config, { excludeDynamicDefaults: true })` [S2], with a fixed `DocumentBuilder` config: title, `info.version` from a constant in code, no `servers` entry and no environment-derived values. Default `operationId`s are kept [S2].
- **Not verified:** that `SwaggerModule` reads every route and DTO from an application created in preview mode. To confirm in P4-T8. **Fallback** if it does not: a normal `NestFactory.create` (still without `init` or `listen`), with the TypeORM options set to `manualInitialization: true` when the generator runs, so the `DataSource` is never initialised. P4-T8 records which path is used.
- **Remaining risk:** code that does I/O at module load (top level of a file, or inside a module decorator) bypasses preview mode. Rule: no I/O at import time in `apps/api`. Proof: the CI job that runs `openapi:check` has no database service and no secrets (P4-T8).

## 2. Snapshot: `packages/contracts/openapi.json`

- **Deterministic content:** no timestamps, git SHAs, build numbers, host names or environment values in the document (section 1).
- **Key order:** before writing, object keys are sorted recursively in code-point order, and array order is kept. Diffs then do not depend on module import order or decorator order. Property order in the generated types becomes alphabetical, which is accepted.
- **Serialization:** `JSON.stringify(doc, null, 2)` plus one trailing `\n`, UTF-8 without BOM, LF line endings.
- **Repository attributes (written by the task that adds the file, outside this record):**
  - `.gitattributes`: `packages/contracts/openapi*.json text eol=lf` and `packages/contracts/src/generated/** text eol=lf linguist-generated=true`, so checkouts with `core.autocrlf` cannot create drift.
  - Both paths are in `.prettierignore` and the ESLint ignores: the generator owns their format.

## 3. `openapi:check`

Root `pnpm openapi:check` runs two checks in order. The first must pass before the second runs.

### 3a. Drift (Turborepo task `@kd/api#openapi:check`)

- Regenerates into a temporary file (`os.tmpdir()`) and compares it byte for byte with `packages/contracts/openapi.json`. Any difference fails the check, prints the first differing line, keeps the temporary file and its path for inspection, and asks for `pnpm openapi:generate`.
- Node only, no new tool. It stays a cached Turborepo task as in 0003; its inputs are the `apps/api` sources and `openapi.json`. The released snapshot is **not** one of its inputs (see 3b), which narrows the row in 0003 section 5.

### 3b. Breaking changes against the last released snapshot

**Options:**

| Criterion | `oasdiff` (Go binary) | `openapi-diff` (npm) | `@useoptic/optic` (npm) |
|---|---|---|---|
| New tool for the developer | yes: Homebrew or a binary [S5]; only needed after the first release | no: a dev dependency | no: a dev dependency |
| bash 3.2 (macOS default) | a static binary; our wrapper is POSIX `sh` | Node | Node |
| CI availability | release tarballs with `checksums.txt` for linux amd64/arm64 [S8]; an official action [S9] | `pnpm install` | `pnpm install` |
| problem+json awareness | compares per media type; removing a response media type is Breaking [S7] | **not stated** [S10] | not evaluated further |
| Breaking/non-breaking levels, CI exit code, reviewed exceptions | `ERR`/`WARN`, `--fail-on ERR`, `--err-ignore` file [S6] | breaking classification exists; exceptions **not verified** | yes, but analytics and Sentry dependencies [S11] |
| Maintenance | v1.35.0, 2026-10-28 [S8] | last change 2025-08-06 [S10] | n/a |

**Choice: `oasdiff` 1.35.0** [S8].

- **Released snapshot:** `packages/contracts/openapi.released.json`, a committed file (0003 rule 2). It is not in the package `exports`.
- **Command:** root script `openapi:breaking`, in POSIX `sh` (no bash 4 features):
  ```sh
  oasdiff breaking packages/contracts/openapi.released.json packages/contracts/openapi.json --fail-on ERR
  ```
  `WARN` results are printed but do not fail the check.
- **Not a Turborepo task:** the result depends on the `oasdiff` binary version, which is not a Turborepo input, so caching it could replay a stale pass.
- **CI:** downloads `oasdiff_1.35.0_linux_amd64.tar.gz`, checks it against `checksums.txt` [S8] and runs `pnpm openapi:breaking`. The marketplace action is not used, because the oasdiff version it runs is not stated [S9]. The version pin goes into 0001 when the CI task adds it.
- **Local:** if `oasdiff` is not on `PATH`, the script fails when `CI` is set; otherwise it prints that the breaking check did not run and exits 0. CI is the gate.
- **Exceptions:** `packages/contracts/openapi-breaking-ignore.txt` through `--err-ignore` [S6]. Each line needs owner approval in the pull request. Within `v1` it should stay empty ("additive changes only").
- **Before the first release:** `openapi.released.json` does not exist. The script prints `breaking-change check inactive: no released snapshot` and exits 0. The CI step is skipped with `if: hashFiles('packages/contracts/openapi.released.json') != ''` and writes the same line to the job summary. Until then, breaking changes are free, which matches a draft api-outline.
- **At a release:** the release pull request copies `openapi.json` to `openapi.released.json`. The release workflow is written with the CI/CD tasks.

**Reason:** `oasdiff` is the only candidate that documents media-type-aware breaking checks [S7], a CI exit-code contract and a reviewed exception file [S6], and it is actively released [S8]. The new-tool cost applies only after the first release, and only to developers who want the check locally.

## 4. Client generator

**Options**, against the three criteria of scaffold-plan section 3:

| | A. `openapi-typescript` + `openapi-fetch` (type-only) | B. `@hey-api/openapi-ts` with its bundled Fetch client | C. `orval` | D. OpenAPI Generator (`typescript-fetch` / `typescript-angular`) |
|---|---|---|---|---|
| 1. No Node-only APIs | yes: `fetch`, `Request`, `Headers`; `process` guarded [S17] | yes [S22] | **not verified** | **not verified** |
| 2. `application/problem+json` errors typed | yes: `error` takes every error media type, `problem+json` included [S15, S16]; the body is parsed as JSON whatever the `Content-Type` [S17] | runtime yes [S22]; the type per media type is **not verified** | **not verified** | **not verified** |
| 3. Runtime heavier than `fetch` | no: 6 kB plus a helper-types package [S14, S19] | no: the client is copied into the output [S21] | **not verified**; Angular output targets `HttpClient` | **not verified** |
| Generated code | one types file | types, an SDK function per operation, client code | hooks, clients, mocks, Zod [S23] | full SDK |
| Fit with 0001 | **peer `typescript ^5.x`** vs 6.0.3; no release since 2026-02-11 [S13] | accepts TypeScript 6; "initial development" [S20, S21] | large dependency tree [S23] | Java toolchain [S24] |

React Native: neither A nor B documents it [S14, S22]. Both use only `fetch`, `Request` and `Headers`, which are not Node-only APIs. Confirmed on React Native 0.88.1 in P4-T7.

**Choice: A.** `openapi-typescript` 7.13.0 (dev dependency) and `openapi-fetch` 0.17.0 (runtime dependency), both pinned exactly in `packages/contracts/package.json` (used by one workspace package only, 0003 section 3). 0001 is updated by the task that installs them.

**Reason:**

- It meets all three criteria with documented evidence. B leaves criterion 2 unverified, and C and D leave most criteria unverified.
- It adds the least code to two very different runtimes: one type file and one 6 kB wrapper.
- Its client is keyed by path, so renaming a controller method does not rename client calls.

**Conditions and fallback:**

- **TypeScript peer.**
  - Risk: `openapi-typescript` 7.13.0 declares `typescript ^5.x` [S13], and the repository pins 6.0.3.
  - How it is checked: the task that creates `@kd/contracts` generates the types with TypeScript 6.0.3 and runs `typecheck`. A scoped peer exception for `openapi-typescript>typescript` is acceptable if generation works; where pnpm 12 reads that rule is **not verified**.
  - Fallback: if generation fails on TypeScript 6, use B, pinned exactly [S20], with its bundled Fetch client. The contract snapshot, the subpaths and the wrapper interface stay the same.
- **Typing rule.** Use the `error` union of `openapi-fetch`, not the `*JSON` helpers of `openapi-typescript-helpers`, because those helpers drop `+json` media types [S16].
- **Errors the document does not list.** A status the document does not declare (for example a proxy 502) has no typed `error`. The wrapper exposes `isProblemDetails(value: unknown): value is ProblemDetails` as a runtime guard. Network failures still throw [S18].
- **Revisit triggers:**
  - `openapi-typescript` declares TypeScript 6 support: the peer exception is removed.
  - It publishes no release for 12 months after 2026-02-11.
  - TypeScript 7 lands (0001), and the generator does not support it.

## 5. Where the generated client lives

**Choice: committed** in `packages/contracts/src/generated/openapi.ts` (the `paths` and `components` types), next to the hand-written thin wrapper `packages/contracts/src/client.ts`.

The wrapper is `createApiClient({ baseUrl, fetch?, headers? })`:
- It returns an `openapi-fetch` client typed with `paths` [S15].
- It registers middleware [S18]; what each middleware sends (auth, `X-Client`, `X-App-Version`, `Accept-Language`) belongs to the slices that need it.

**Reason over generating at build time:**

- `@kd/contracts#build` stays plain `tsc` (0003) with no generator in the build graph.
- Reviewers see contract changes as type diffs in the pull request.
- A fresh clone builds without running the generator.

**Turborepo tasks added** (new rows for 0003 section 5; 0003 is not edited here):

| Task | `dependsOn` | Inputs | Outputs | Cache |
|---|---|---|---|---|
| `@kd/contracts#client:generate` | none | `openapi.json`, the generator config | `src/generated/**` | yes |
| `@kd/contracts#client:check` | none | `openapi.json`, `src/generated/**`, the generator config | none | yes |

- **Drift detection:** `client:check` regenerates into a temporary file and compares bytes, as in 3a.
- **Root scripts:**
  - `pnpm openapi:generate` runs `@kd/api#openapi:generate` and then `@kd/contracts#client:generate`.
  - `pnpm openapi:check` runs `@kd/api#openapi:check` and `@kd/contracts#client:check`, then `openapi:breaking` (3b).

### `@kd/contracts` entry points (names the subpath that 0003 left open)

| Subpath | Contents | Runtime imports | Who may import |
|---|---|---|---|
| `@kd/contracts` | `ProblemDetails`, `FieldError`, `isProblemDetails`, realtime event types (`src/events.ts`), shared constants | none outside the package | api, admin, mobile |
| `@kd/contracts/client` | `createApiClient`, the generated `paths` and `components` types | `openapi-fetch` | admin, mobile; **forbidden for `@kd/api`** |
| `@kd/contracts/openapi.json` | the snapshot (0003) | none | tooling |

- The root entry must not import `src/client.ts` or `src/generated/**`, so the API never loads `openapi-fetch`.
- The `@kd/api` ESLint layer of P1-T3 forbids `@kd/contracts/client` and any relative path into `packages/contracts/src/{client.ts,generated}`, with a negative fixture for each.

## 6. Realtime event types

- **Location:** hand-written in `packages/contracts/src/events.ts`, exported from the root entry `@kd/contracts`.
- **Import rule:**
  - The gateway in `apps/api` and both clients import event names and payload types only from `@kd/contracts`; nobody redeclares them locally.
  - `events.ts` imports nothing from `src/generated/**` or `src/client.ts` (section 5).
- **Scope:** the event list and payloads belong to the realtime slice; this record fixes only the location and the import rule.

## 7. `ProblemDetails` and `FieldError`

**Choice: hand-written** in `packages/contracts/src/problem.ts`, exported from the root entry.

```ts
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface ProblemDetails<Code extends string = string> {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: Code;
  errors?: FieldError[];
  [member: string]: unknown; // code-specific members (api-outline "Payloads added to existing codes")
}
```

- Required members follow the api-outline Conventions row. `errors` is present for `VALIDATION_FAILED`. The `code` union of the catalogue is added by the error-handling slice through the `Code` parameter.
- **API side:**
  - The exception filter types its output with `ProblemDetails`. This is a type import from the root entry, allowed by 0003.
  - The Swagger schema comes from a DTO class in `apps/api` that `implements ProblemDetails`, so `tsc` catches a mismatch.
  - Error responses are declared with the `application/problem+json` media type.
- **Drift between the hand-written type and the document:** a type-level test in `@kd/contracts` asserts that `components['schemas']['ProblemDetails']` and `ProblemDetails` are assignable both ways. It runs under `typecheck`.
- **Reason:** the shape is a convention of the whole API, needed before any endpoint exists and by code that never sees a generated type (the API filter, the clients' error handling). Hand-writing it once, and checking it against the generated schema, avoids two diverging definitions.

## Consequences

- **The task that creates `@kd/contracts`:**
  - installs `openapi-typescript` 7.13.0 and `openapi-fetch` 0.17.0 and records them in 0001;
  - proves generation with TypeScript 6.0.3, or switches to the fallback in section 4;
  - writes `problem.ts`, `events.ts` (empty list), `client.ts` and the exports of section 5, the `.gitattributes` lines and the ignore entries of section 2.
- **The API scaffold and P4-T8:**
  - install `@nestjs/swagger` 12.1.0 and record it in 0001;
  - write `configureApp` and `generate.ts`;
  - confirm that preview mode works, or switch to the fallback in section 1;
  - run `openapi:check` in a CI job with no database service and no secrets.
- **P0-T6:** if the SWC builder is chosen, the plugin needs type checking and `loadPluginMetadata()` [S1]. If a test reads the generated document, the API's test runner must apply the plugin transformer [S1].
- **P1-T3:** the `@kd/api` boundary rule for `@kd/contracts/client` and its fixtures.
- **CI/CD tasks:** the `oasdiff` 1.35.0 download with checksum, the `hashFiles` condition, the release step that writes `openapi.released.json`, and the `oasdiff` pin in 0001.
- **Angular impact:** the admin app calls the API through `fetch`, not `HttpClient`. Angular HTTP interceptors do not apply to these calls, so cross-cutting concerns (token refresh, headers) live in `openapi-fetch` middleware [S18], shared by admin and mobile.
- **0003 section 5 changes:**
  - the released snapshot is no longer an input of `@kd/api#openapi:check`;
  - the two `@kd/contracts` tasks are added.
  0003 is still `proposed`, so the owner folds these in when accepting it.
- **Revisit triggers:**
  - the generator triggers in section 4;
  - preview mode stops covering every route;
  - a `v2` of the API, which needs a second released snapshot.

## Implementation notes (P4-T8, 2026-11-04)

Recorded when the contract was wired. The sections above keep their wording; where the implementation differs, this section is the reference.

- **Preview mode works (section 1).** `SwaggerModule.createDocument` reads every route and DTO from `NestFactory.create(AppModule.forRoot(config), { preview: true, logger: false, abortOnError: false })`. The `manualInitialization` fallback is not used.
- **No environment assignment (section 1).** `AppModule.forRoot` takes the validated config as an argument, so the generator passes `loadConfig` a placeholder object (`APP_ENV=test`, a database URL on `127.0.0.1:1`) and neither reads nor writes `process.env`. No dynamic `import()` is needed.
- **Files.** `apps/api/src/configure-app.ts` (shared by `main.ts` and the generator), `apps/api/src/openapi/document.ts` and `generate.ts` (`--out` and `--check`), `packages/contracts/scripts/client.mjs` (`generate` and `check`), `scripts/openapi-breaking.sh`.
- **Shared schemas (section 7).** `ProblemDetailsDto` and `FieldErrorDto` in `apps/api/src/openapi/problem-details.dto.ts` implement the contract types and are listed through `extraModels`, so `components.schemas` holds them before any route declares an error. The type-level test is `packages/contracts/test/problem-schema.type-test.ts`, checked by `tsconfig.test.json` under `typecheck`. The index signature of `ProblemDetails` is not represented in the schema.
- **TypeScript peer (section 4).** Generation and `typecheck` pass with TypeScript 6.0.3. The scoped exception is `peerDependencyRules.allowedVersions` `'openapi-typescript>typescript': 6.0.3` in `pnpm-workspace.yaml`; pnpm 12 reads it there (`pnpm peers check` is clean for `@kd/contracts`).
- **Client base URL (section 5).** The paths of the document carry the global prefix (`/api/health`). The apps keep their API root ending in `/api` (admin `environment.apiBaseUrl`, mobile `extra.apiBaseUrl`, decision 0006 item 9), and `toClientBaseUrl` in `@kd/contracts/client` strips that suffix. `apps/mobile/app.config.ts` rejects an API root that does not end with `/api`.
- **Before the first release (section 3b).** `scripts/openapi-breaking.sh` prints `breaking-change check inactive: no released snapshot yet`.
- **Still open:** the CI job that runs `openapi:check` without a database service or secrets (CI/CD tasks).
