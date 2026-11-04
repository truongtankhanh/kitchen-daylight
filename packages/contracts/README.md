# @kd/contracts

The API contract shared by `apps/api`, the admin and the mobile app (decisions 0003 and 0004). The package is private, ESM, compiled with `tsc`, and today has no runtime dependency. It depends on no other workspace package: `@kd/api` is forbidden by the boundary rules of decision 0003 (`no-restricted-imports`, `kd/no-relative-boundary`, manifest check).

## Today: hand-written types only

The root entry `@kd/contracts` exports:

| Export                 | File             | What it is                                                                                                                                      |
| ---------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProblemDetails<Code>` | `src/problem.ts` | The `application/problem+json` error body (RFC 9457 shape): `type`, `title`, `status`, `detail`, `code`, `errors[]`, plus code-specific members |
| `FieldError`           | `src/problem.ts` | One entry of `errors[]`: `{ field, code, message }`                                                                                             |
| `RealtimeEventMap`     | `src/events.ts`  | Map of realtime event name to payload. Empty                                                                                                    |

- **Error codes.** The `code` union is not written here. The slice that owns each code adds it through the `Code` parameter (decision 0004 section 7).
- **Realtime events.** The event names and payloads belong to the realtime slice. Nothing is invented here (decision 0004 section 6). The API gateway and both clients import them only from this package.
- **Root entry rule.** The root entry never imports `src/client.ts` or `src/generated/**`, so `@kd/api` never loads the client runtime (decision 0004 section 5).

## Added in P4-T8

These parts come in P4-T8, when the API can produce an OpenAPI document. No stub script exists before that.

- the committed snapshot `openapi.json` and the `./openapi.json` subpath;
- `openapi-typescript` and `openapi-fetch`, the generated `src/generated/openapi.ts` and the wrapper `src/client.ts`, behind the `./client` subpath (forbidden for `@kd/api`);
- the `isProblemDetails` runtime guard;
- the type-level test that checks `ProblemDetails` against the generated schema;
- the `client:generate` and `client:check` scripts, and the `.gitattributes` and ignore entries of decision 0004 section 2.

## Scripts

| Script      | What it does                                                  |
| ----------- | ------------------------------------------------------------- |
| `build`     | `tsc` into `dist/`                                            |
| `lint`      | ESLint with the shared rules and the `contracts` boundary row |
| `typecheck` | `tsc --noEmit`                                                |
