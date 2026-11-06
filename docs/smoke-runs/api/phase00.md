# Phase A0 smoke run: platform base

Owner checklist for task A0-T12. It runs the Phase A0 platform pieces against the real sibling Docker repository: the build, the six migrations of A0-T5 to A0-T8 and A0-T13 (database helpers, outbox, audit, idempotency, the outbox `UPDATE` grant, millisecond `audit_logs.created_at`), the unit and integration suites, the request logging and problem+json rules of decision 0005 section 11 and decision 0007 (sections 4 and 9) on a running API, then lint, typecheck and the OpenAPI drift check.

**Scope:** steps 3 and 4 run the test suites; step 4 empties and migrates the scratch database only (`kd_scratch`), never `kd_dev`. Step 2 migrates `kd_dev`. No step changes a committed file and no step deletes data in `kd_dev`. The only long-running process is the API of step 5, in a second terminal, with no watcher; it is stopped with Ctrl-C in step 10.

## How to run

- Run one step at a time, from the repository root, in order. Paste the output into the empty block of the step and fill in the result.
- Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Before pasting, replace every password with `***`.** `pnpm dev:infra` prints `scripts/print-env.sh` output with the local placeholder credentials. Never paste the content of `.env`. Replace home paths with `<repo>`.
- Use Node 26.13.0 (`nvm use` once in each terminal, the second terminal of step 5 included).
- The command blocks hold no comment lines and no `<...>` placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- Exit codes: each command is followed by `echo "exit=$?"`.
- Peak memory and wall time (steps 3 and 4): from `/usr/bin/time -l`, record `real` (seconds) and `maximum resident set size` (bytes; the largest single process, not the sum), and `peak memory footprint` if printed.
- The only credentials in this sheet are the fake ones of step 7: the token `smoke-fake-token` (set in a shell variable first, so the secret scan does not read the line as a real `curl` credential), the cookie `smoke=fake-cookie`, the query values `token=abc123` and `code=123456`, and the request id `0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11`. None is real.

## Run details

| Field | Value |
|---|---|
| Date | |
| Machine / OS / chip / RAM | |
| Monorepo commit (`git rev-parse --short HEAD`) | |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | |
| Sibling `VERSION` | |
| `docker-repo.version` | |
| Node / pnpm (`node --version`, `pnpm --version`) | |

## Step 0. Stack healthy and `.env` in sync

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
pnpm env:sync; echo "exit=$?"
```

Expected: every service (postgres, mailpit, s3) running and healthy on its slot-2 port; `env:sync` writes `.env` with mode 600, or exits 3 because the root `.env` already exists (fine: the existing `.env` is used; say so in "Notes"). Every other command prints `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Step 1. Build the API and its workspace dependencies

```bash
pnpm --filter "@kd/api..." build; echo "exit=$?"
```

Expected: every package build exits 0 (`@kd/contracts`, then `@kd/api` with `nest build`); `apps/api/dist/main.js`, `dist/cli.js` and `dist/openapi/generate.js` exist; `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Step 2. `migrate` twice: six migrations, then nothing

```bash
pnpm --filter @kd/api migrate; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
```

Expected: the first run prints `migrate: applied 0001_database_helpers.sql`, `0002_outbox_events.sql`, `0003_audit_logs.sql`, `0004_idempotency_keys.sql`, `0005_outbox_events_update_grant.sql`, `0006_audit_logs_created_at_milliseconds.sql` and `migrate: 6 applied` (if an earlier run already applied 0001 to 0004 to `kd_dev`, it applies only 0005 and 0006 and prints `migrate: 2 applied`: say which in "Notes"); the second run prints `migrate: nothing to apply`; the preflight prints nothing when it passes; both `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Step 3. Unit suite (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/api test; echo "exit=$?"
```

Expected: `vitest run --maxWorkers=2`; every file and test passes (34 files; A0-T9 had 512 tests, A0-T13 adds about 9); no database connection; `exit=0`.

| Measure | Value |
|---|---|
| Test files / tests | |
| Wall time (`real`) | |
| Maximum resident set size | |
| Peak memory footprint | |

Result (pass / fail):

```text
```

Notes:

## Step 4. Integration suite against the scratch database (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/api test:int > /private/tmp/kd-a0-int.log 2>&1; echo "exit=$?"
cat /private/tmp/kd-a0-int.log
grep -c 'kd_dev' /private/tmp/kd-a0-int.log; echo "exit=$?"
```

Expected: `vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism`; the global setup applies the six migrations to the scratch database; 5 files pass (`health`, `database-helpers`, `outbox`, `audit`, `idempotency`), about 53 tests (45 in the CI run of 2026-11-05, plus the A0-T13 cases); first `exit=0`. A database named in the log is `host:port/database` of `kd_scratch` (for example `127.0.0.1:5452/kd_scratch`), never a URL, a role password or `kd_dev`: the `grep -c` prints `0` and `exit=1`.

| Measure | Value |
|---|---|
| Test files / tests | |
| Wall time (`real`) | |
| Maximum resident set size | |
| Peak memory footprint | |

Result (pass / fail):

```text
```

Notes:

## Step 5. Start the API in a second terminal (no watcher)

In a second terminal, from the repository root:

```bash
nvm use
lsof -i :3001; echo "exit=$?"
pnpm --filter @kd/api start 2>&1 | tee /private/tmp/kd-a0-api.log
```

Expected: `lsof` prints nothing and `exit=1` (port 3001 free before the start); `node dist/main.js` reads the root `.env`, logs JSON lines (pino) and listens on `127.0.0.1:3001` or all interfaces on port 3001. Leave it running until step 10. Paste the start-up lines only.

Result (pass / fail):

```text
```

Notes:

## Step 6. Health check, no `X-Powered-By`

Back in the first terminal:

```bash
curl -i http://127.0.0.1:3001/api/health; echo "exit=$?"
```

Expected: `HTTP/1.1 200`; an `X-Request-Id` header with a UUID; **no** `X-Powered-By` header (decision 0007 row 5); `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Step 7. Unknown route with fake credentials: 404 problem+json

```bash
fake_token=smoke-fake-token
curl -i -H "Authorization: Bearer $fake_token" -H 'Cookie: smoke=fake-cookie' -H 'X-Request-Id: 0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11' 'http://127.0.0.1:3001/api/v1/smoke/none?lat=10.77689&lng=106.70081&token=abc123&code=123456'; echo "exit=$?"
```

Expected: `HTTP/1.1 404`; `Content-Type: application/problem+json`; `X-Request-Id: 0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11` echoed (a UUID, decision 0007 section 4); no `X-Powered-By`; body with `type` `about:blank`, `title` `Not Found`, `status` `404`, `code` `NOT_FOUND` and a `detail` that repeats no value of the request (no path, query, token or cookie); `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Step 8. The request log of step 7

```bash
grep smoke /private/tmp/kd-a0-api.log; echo "exit=$?"
grep -c -i -e 'smoke-fake-token' -e 'fake-cookie' -e 'token=abc123' -e 'code=123456' -e 'authorization' -e '"cookie"' /private/tmp/kd-a0-api.log; echo "exit=$?"
```

Expected, first command: exactly one JSON line, `exit=0`, with:

- `req.id` `0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11`, `req.method` `GET`;
- `req.url` with `lat=10.78` and `lng=106.7` (or `106.70`), rounded to 2 decimals;
- `token` and `code` replaced by `[redacted]` (possibly URL-encoded as `%5Bredacted%5D`);
- `res.statusCode` `404` and a `responseTime`;
- no `headers`, no `authorization`, no `cookie`, no body.

Second command: `0` and `exit=1` (no fake credential, no unredacted `token` or `code` value, and no `authorization` or `cookie` key anywhere in the log).

Result (pass / fail):

```text
```

Notes:

## Step 9. Malformed JSON body: 400 problem+json; no health log line

```bash
curl -i -X POST -H 'Content-Type: application/json' -d '{bad' http://127.0.0.1:3001/api/v1/smoke/none; echo "exit=$?"
grep -c '/api/health' /private/tmp/kd-a0-api.log; echo "exit=$?"
grep -c '{bad' /private/tmp/kd-a0-api.log; echo "exit=$?"
```

Expected: `HTTP/1.1 400`; `Content-Type: application/problem+json`; `code` `VALIDATION_FAILED`; an `X-Request-Id` header with a UUID (set by the problem filter since A0-T13: the body parser fails before pino-http, so this request has no request-log line); `detail` does not repeat the body; first `exit=0`. **If the status or the `code` differs (for example `404 NOT_FOUND`, because the route does not exist, or `500 INTERNAL_ERROR`), write the observed result in "Findings": it is a finding, not a stop.** `grep -c '/api/health'` prints `0` and `exit=1` (`GET /api/health` of step 6 is excluded from the request log, decision 0005 section 11). `grep -c '{bad'` prints `0` and `exit=1` (no body in the log).

Result (pass / fail):

```text
```

Notes:

## Step 10. Stop the API, port free

In the second terminal, press Ctrl-C. Then, in the first terminal:

```bash
lsof -i :3001; echo "exit=$?"
```

Expected: the API exits on Ctrl-C (a shutdown line in the second terminal, no stack trace); `lsof` prints nothing and `exit=1`.

Result (pass / fail):

```text
```

Notes:

## Step 11. Lint and typecheck of the workspace

```bash
pnpm turbo run lint typecheck --concurrency=2; echo "exit=$?"
```

Expected: every `lint` and `typecheck` task succeeds (cache hits are fine); the `@kd/eslint-config` lint runs `check-fixtures` and `check-manifests`; `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Step 12. OpenAPI generate, then check: no drift

```bash
pnpm openapi:generate; echo "exit=$?"
pnpm openapi:check; echo "exit=$?"
git status --short packages/contracts; echo "exit=$?"
```

Expected: both OpenAPI commands exit 0; `openapi:check` reports no drift (and the breaking-change check inactive while no released snapshot exists); `git status --short packages/contracts` prints nothing and `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Final check

```bash
git status --short; echo "exit=$?"
```

Expected: only this sheet (`?? docs/smoke-runs/api/phase00.md`, until it is committed); `exit=0`.

Result (pass / fail):

```text
```

Notes:

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | |
| Failed or skipped steps | |
| Peak memory / wall time, step 3 (unit suite) | |
| Peak memory / wall time, step 4 (integration suite) | |
| Step 9 observed status and `code` | |

## Findings

Write one item per finding: the step, what was expected, what was observed, and whether it blocks the gate.

```text
```

Phase A0 gate: run the review prompt
