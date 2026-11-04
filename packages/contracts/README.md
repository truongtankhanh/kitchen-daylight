# @kd/contracts

The API contract shared by `apps/api`, the admin and the mobile app (decisions 0003 and 0004). The package is private, ESM and compiled with `tsc`. It depends on no other workspace package: `@kd/api` is forbidden by the boundary rules of decision 0003 (`no-restricted-imports`, `kd/no-relative-boundary`, manifest check).

## Entry points

| Subpath                      | Contents                                                                                                                  | Runtime imports | Who may import                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------ |
| `@kd/contracts`              | `ProblemDetails<Code>`, `FieldError`, `isProblemDetails` (`src/problem.ts`); `RealtimeEventMap` (`src/events.ts`)         | none            | api, admin, mobile                         |
| `@kd/contracts/client`       | `createApiClient`, `toClientBaseUrl`, `ApiClient`, the generated `paths`, `components` and `operations` (`src/client.ts`) | `openapi-fetch` | admin, mobile; **forbidden for `@kd/api`** |
| `@kd/contracts/openapi.json` | the committed snapshot                                                                                                    | none            | tooling                                    |

- **Error codes.** The `code` union is not written here. The slice that owns each code adds it through the `Code` parameter (decision 0004 section 7).
- **Realtime events.** The event names and payloads belong to the realtime slice. Nothing is invented here (decision 0004 section 6).
- **Root entry rule.** The root entry never imports `src/client.ts` or `src/generated/**`, so `@kd/api` never loads the client runtime (decision 0004 section 5).
- **Base URL.** The paths of the document already start with `/api`. The apps keep their API root (`/api`, `https://host/api`) in configuration and pass it through `toClientBaseUrl`, which strips that suffix.

## Generated files

- `openapi.json` is written by `@kd/api` (`pnpm openapi:generate`), never by hand. Keys are sorted; the file has no timestamp or environment value.
- `src/generated/openapi.ts` is generated from `openapi.json` by `scripts/client.mjs` with `openapi-typescript` (`alphabetize`, `emptyObjectsUnknown`). It is committed, so a fresh clone builds without the generator.
- Both are excluded from Prettier and ESLint and checked out with LF (`.gitattributes`).
- `test/problem-schema.type-test.ts` asserts that `ProblemDetails` and `FieldError` and their generated schemas are assignable both ways. It runs under `typecheck`.

## Scripts

| Script            | What it does                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `build`           | `tsc` into `dist/`                                                                              |
| `lint`            | ESLint with the shared rules and the `contracts` boundary row                                   |
| `typecheck`       | `tsc --noEmit` on the sources, then on the sources and the type-level test                      |
| `client:generate` | Writes `src/generated/openapi.ts` from `openapi.json`                                           |
| `client:check`    | Regenerates into a temporary file and fails on any byte difference, keeping the file for review |

From the repository root:

- `pnpm openapi:generate` writes `openapi.json`, then the client types.
- `pnpm openapi:check` runs both drift checks, then `openapi:breaking`. The breaking-change check (`oasdiff`) is inactive until `openapi.released.json` exists.
