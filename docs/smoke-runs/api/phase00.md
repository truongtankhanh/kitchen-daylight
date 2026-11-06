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
| Date | 2026-11-06 |
| Machine / OS / chip / RAM | Owner's MacBook, macOS 26.6.2, Apple Silicon (arm64), 18 GiB |
| Monorepo commit (`git rev-parse --short HEAD`) | `f12f8f5` (#22: A0-T13 and this sheet) |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | `91af754` (no tag) |
| Sibling `VERSION` | `0.0.0` |
| `docker-repo.version` | `0.0.0` |
| Node / pnpm (`node --version`, `pnpm --version`) | v26.13.0 (`nvm use`) / 12.16.1 |

## Step 0. Stack healthy and `.env` in sync

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
pnpm env:sync; echo "exit=$?"
```

Expected: every service (postgres, mailpit, s3) running and healthy on its slot-2 port; `env:sync` writes `.env` with mode 600, or exits 3 because the root `.env` already exists (fine: the existing `.env` is used; say so in "Notes"). Every other command prints `exit=0`.

Result (pass / fail): **pass**

```text
Now using node v26.13.0 (npm v11.20.0)
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[+] Running 4/4
 ✔ Container kd-docker-s3-1        Healthy   0.6s
 ✔ Container kd-docker-postgres-1  Running   0.0s
 ✔ Container kd-docker-mailpit-1   Running   0.0s
 ✔ Container kd-docker-s3-init-1   Started   0.2s
[kd] all services ready
DATABASE_URL_MIGRATOR=postgres://kd_migrator:***@127.0.0.1:5452/kd_dev
DATABASE_URL_APP=postgres://kd_app:***@127.0.0.1:5452/kd_dev
MAIL_SMTP_HOST=127.0.0.1
MAIL_SMTP_PORT=1045
MAIL_UI_URL=http://127.0.0.1:8045
STORAGE_S3_ENDPOINT=http://127.0.0.1:9020
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_S3_ACCESS_KEY=***
STORAGE_S3_SECRET_KEY=***
STORAGE_S3_BUCKET_MEDIA=kd-dev-media
STORAGE_S3_BUCKET_PRIVATE=kd-dev-private
APP_ENV=dev
exit=0
$ scripts/dev-infra.sh status
[kd] s3-init    exited(0)    -          -
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] postgres   running      healthy    127.0.0.1:5452->5432/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
$ scripts/env-sync.sh
[kd] .env exists at <repo>; run again with --force to replace it (its monorepo block is kept)
[ELIFECYCLE] Command failed with exit code 3.
exit=3
```

Notes: the stack was already running and stays healthy on slot 2. `env:sync` exited 3 because the root `.env` exists; `--force` was not run, so the existing `.env` was used (steps 2 to 9 confirm the same slot-2 values).

## Step 1. Build the API and its workspace dependencies

```bash
pnpm --filter "@kd/api..." build; echo "exit=$?"
```

Expected: every package build exits 0 (`@kd/contracts`, then `@kd/api` with `nest build`); `apps/api/dist/main.js`, `dist/cli.js` and `dist/openapi/generate.js` exist; `exit=0`.

Result (pass / fail): **pass**

```text
$ tsc -p tsconfig.json
$ nest build
exit=0
```

Notes: `@kd/contracts` then `@kd/api`.

## Step 2. `migrate` twice: six migrations, then nothing

```bash
pnpm --filter @kd/api migrate; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
```

Expected: the first run prints `migrate: applied 0001_database_helpers.sql`, `0002_outbox_events.sql`, `0003_audit_logs.sql`, `0004_idempotency_keys.sql`, `0005_outbox_events_update_grant.sql`, `0006_audit_logs_created_at_milliseconds.sql` and `migrate: 6 applied` (if an earlier run already applied 0001 to 0004 to `kd_dev`, it applies only 0005 and 0006 and prints `migrate: 2 applied`: say which in "Notes"); the second run prints `migrate: nothing to apply`; the preflight prints nothing when it passes; both `exit=0`.

Result (pass / fail): **pass**

```text
$ node dist/cli.js migrate
migrate: applied 0005_outbox_events_update_grant.sql
migrate: applied 0006_audit_logs_created_at_milliseconds.sql
migrate: 2 applied
exit=0
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
```

Notes: `kd_dev` already had 0001 to 0004 from the earlier owner runs, so the first run applied only 0005 and 0006 (`migrate: 2 applied`); the second applied nothing. The preflight printed nothing.

## Step 3. Unit suite (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/api test; echo "exit=$?"
```

Expected: `vitest run --maxWorkers=2`; every file and test passes (34 files; A0-T9 had 512 tests, A0-T13 adds about 9); no database connection; `exit=0`.

| Measure | Value |
|---|---|
| Test files / tests | 34 / 521 |
| Wall time (`real`) | 3.12 s |
| Maximum resident set size | 167477248 bytes (~160 MiB) |
| Peak memory footprint | 17941056 bytes (~17 MiB) |

Result (pass / fail): **pass**

```text
$ vitest run --maxWorkers=2
 RUN  v5.1.0 <repo>/apps/api
 (34 files, each ✓)
 Test Files  34 passed (34)
      Tests  521 passed (521)
   Duration  2.77s (import 83%, transform 10%, tests 5%, worker 2%)
        3.12 real         5.29 user         1.43 sys
           167477248  maximum resident set size
            17941056  peak memory footprint
exit=0
```

Notes: the per-file lines and the other `time -l` counters are omitted. 521 = 512 of A0-T9 plus the 9 cases of A0-T13.

## Step 4. Integration suite against the scratch database (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/api test:int > /private/tmp/kd-a0-int.log 2>&1; echo "exit=$?"
cat /private/tmp/kd-a0-int.log
grep -c 'kd_dev' /private/tmp/kd-a0-int.log; echo "exit=$?"
```

Expected: `vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism`; the global setup applies the six migrations to the scratch database; 5 files pass (`health`, `database-helpers`, `outbox`, `audit`, `idempotency`), about 53 tests (45 in the CI run of 2026-11-05, plus the A0-T13 cases); first `exit=0`. A database named in the log is `host:port/database` of `kd_scratch` (for example `127.0.0.1:5452/kd_scratch`), never a URL, a role password or `kd_dev`: the `grep -c` prints `0` and `exit=1`.

| Measure | Value |
|---|---|
| Test files / tests | 5 / 53 |
| Wall time (`real`) | 2.75 s |
| Maximum resident set size | 186564608 bytes (~178 MiB) |
| Peak memory footprint | 18170432 bytes (~17 MiB) |

Result (pass / fail): **pass**

```text
exit=0
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism
 RUN  v5.1.0 <repo>/apps/api
migrate: applied 0001_database_helpers.sql
migrate: applied 0002_outbox_events.sql
migrate: applied 0003_audit_logs.sql
migrate: applied 0004_idempotency_keys.sql
migrate: applied 0005_outbox_events_update_grant.sql
migrate: applied 0006_audit_logs_created_at_milliseconds.sql
migrate: 6 applied
 ✓ test/integration/idempotency.int-spec.ts (9 tests) 365ms
 ✓ test/integration/outbox.int-spec.ts (20 tests) 324ms
 ✓ test/integration/audit.int-spec.ts (4 tests) 132ms
 ✓ test/integration/health.int-spec.ts (3 tests) 154ms
 ✓ test/integration/database-helpers.int-spec.ts (17 tests) 53ms
 Test Files  5 passed (5)
      Tests  53 passed (53)
   Duration  2.52s (tests 53%, import 40%, transform 7%)
        2.75 real         1.92 user         0.51 sys
           186564608  maximum resident set size
            18170432  peak memory footprint
0
exit=1
```

Notes: the global setup reset `kd_scratch` and applied the six migrations there. The log names no database at all (the target appears only in a refusal message), and `grep -c 'kd_dev'` printed `0`. Other `time -l` counters omitted.

## Step 5. Start the API in a second terminal (no watcher)

In a second terminal, from the repository root:

```bash
nvm use
lsof -i :3001; echo "exit=$?"
pnpm --filter @kd/api start 2>&1 | tee /private/tmp/kd-a0-api.log
```

Expected: `lsof` prints nothing and `exit=1` (port 3001 free before the start); `node dist/main.js` reads the root `.env`, logs JSON lines (pino) and listens on `127.0.0.1:3001` or all interfaces on port 3001. Leave it running until step 10. Paste the start-up lines only.

Result (pass / fail): **pass** (output taken from the log file; the `lsof` pre-check was not pasted)

```text
$ node dist/main.js
{"level":30,"context":"NestFactory","msg":"Starting Nest application..."}
{"level":30,"context":"InstanceLoader","msg":"AppConfigModule dependencies initialized"}
{"level":30,"context":"InstanceLoader","msg":"LoggingModule dependencies initialized"}
{"level":30,"context":"InstanceLoader","msg":"DatabaseModule dependencies initialized"}
{"level":30,"context":"InstanceLoader","msg":"TypeOrmModule dependencies initialized"}
{"level":30,"context":"InstanceLoader","msg":"LoggerModule dependencies initialized"}
{"level":30,"context":"InstanceLoader","msg":"AppModule dependencies initialized"}
{"level":30,"context":"InstanceLoader","msg":"TypeOrmCoreModule dependencies initialized"}
{"level":30,"context":"InstanceLoader","msg":"HealthModule dependencies initialized"}
{"level":30,"context":"RoutesResolver","msg":"HealthController {/api/health} (version: Neutral):"}
{"level":30,"context":"RouterExplorer","msg":"Mapped {/api/health, GET} (version: Neutral) route"}
{"level":30,"context":"NestApplication","msg":"Nest application successfully started"}
```

Notes: the start-up lines come from `/private/tmp/kd-a0-api.log`, read after the run; `time`, `pid` and `hostname` are left out. JSON lines from pino, no pretty transport; no watcher (`node dist/main.js`). The API answered on 3001 in steps 6 to 9.

## Step 6. Health check, no `X-Powered-By`

Back in the first terminal:

```bash
curl -i http://127.0.0.1:3001/api/health; echo "exit=$?"
```

Expected: `HTTP/1.1 200`; an `X-Request-Id` header with a UUID; **no** `X-Powered-By` header (decision 0007 row 5); `exit=0`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
X-Request-Id: fc58955c-8a6e-4439-813e-84df697316bb
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42
ETag: W/"2a-Tq9VPg/LVOfKgI9CZKtpRf5RxEk"
Date: Fri, 06 Nov 2026 01:14:36 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok","checks":{"database":"up"}}exit=0
```

Notes: no `X-Powered-By`; `X-Request-Id` is a new UUID.

## Step 7. Unknown route with fake credentials: 404 problem+json

```bash
fake_token=smoke-fake-token
curl -i -H "Authorization: Bearer $fake_token" -H 'Cookie: smoke=fake-cookie' -H 'X-Request-Id: 0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11' 'http://127.0.0.1:3001/api/v1/smoke/none?lat=10.77689&lng=106.70081&token=abc123&code=123456'; echo "exit=$?"
```

Expected: `HTTP/1.1 404`; `Content-Type: application/problem+json`; `X-Request-Id: 0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11` echoed (a UUID, decision 0007 section 4); no `X-Powered-By`; body with `type` `about:blank`, `title` `Not Found`, `status` `404`, `code` `NOT_FOUND` and a `detail` that repeats no value of the request (no path, query, token or cookie); `exit=0`.

Result (pass / fail): **pass**

```text
HTTP/1.1 404 Not Found
X-Request-Id: 0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11
Content-Type: application/problem+json; charset=utf-8
Content-Length: 74
ETag: W/"4a-waJf670VRAYwGgs33U5Y3YrC6Ak"
Date: Fri, 06 Nov 2026 01:14:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"type":"about:blank","title":"Not Found","status":404,"code":"NOT_FOUND"}exit=0
```

Notes: the incoming request id is echoed; no `detail`, so nothing of the path, query, token or cookie comes back; no `X-Powered-By`.

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

Result (pass / fail): **pass**

```text
{"level":30,"time":1793927685218,"pid":34333,"hostname":"Tans-MacBook-Pro.local","req":{"id":"0b1b6d0e-5c1d-4a7a-9b43-3f1a2c6d9e11","method":"GET","url":"/api/v1/smoke/none?lat=10.78&lng=106.7&token=[redacted]&code=[redacted]"},"res":{"statusCode":404},"responseTime":1,"msg":"request completed"}
exit=0
0
exit=1
```

Notes: one line: request id, method, `lat=10.78` and `lng=106.7`, `token` and `code` redacted, `statusCode` and `responseTime`; no headers, no body. The second grep finds none of the fake credentials or query values, and no `authorization` or `cookie` key.

## Step 9. Malformed JSON body: 400 problem+json; no health log line

```bash
curl -i -X POST -H 'Content-Type: application/json' -d '{bad' http://127.0.0.1:3001/api/v1/smoke/none; echo "exit=$?"
grep -c '/api/health' /private/tmp/kd-a0-api.log; echo "exit=$?"
grep -c '{bad' /private/tmp/kd-a0-api.log; echo "exit=$?"
```

Expected: `HTTP/1.1 400`; `Content-Type: application/problem+json`; `code` `VALIDATION_FAILED`; an `X-Request-Id` header with a UUID (set by the problem filter since A0-T13: the body parser fails before pino-http, so this request has no request-log line); `detail` does not repeat the body; first `exit=0`. **If the status or the `code` differs (for example `404 NOT_FOUND`, because the route does not exist, or `500 INTERNAL_ERROR`), write the observed result in "Findings": it is a finding, not a stop.** `grep -c '/api/health'` prints `0` and `exit=1` (`GET /api/health` of step 6 is excluded from the request log, decision 0005 section 11). `grep -c '{bad'` prints `0` and `exit=1` (no body in the log).

Result (pass / fail): **pass**, with a sheet defect in the health check (see Notes and Findings)

```text
HTTP/1.1 400 Bad Request
X-Request-Id: 7936ab35-10ef-4ed5-8da9-253d09da3582
Content-Type: application/problem+json; charset=utf-8
Content-Length: 96
ETag: W/"60-Ilpthq8vSTRMSQ+53brFJ3fek6s"
Date: Fri, 06 Nov 2026 01:15:01 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[]}exit=0
2
exit=0
0
exit=1
```

Notes: `400 VALIDATION_FAILED` with a UUID `X-Request-Id` (set by the problem filter since A0-T13; this request writes no request-log line, as expected). `grep -c '/api/health'` printed `2`, not `0`: both lines are start-up logs of step 5 (`RoutesResolver` "HealthController {/api/health}" and `RouterExplorer` "Mapped {/api/health, GET}"), not request logs. The log holds exactly one line with a `req` member, the step 7 request (checked by the agent on the same file, read-only), so `GET /api/health` of step 6 is excluded as decision 0005 section 11 requires. The sheet's pattern was too broad: the precise check is `grep -c '"url":"/api/health' /private/tmp/kd-a0-api.log` (expected `0`). `grep -c '{bad'` printed `0`.

## Step 10. Stop the API, port free

In the second terminal, press Ctrl-C. Then, in the first terminal:

```bash
lsof -i :3001; echo "exit=$?"
```

Expected: the API exits on Ctrl-C (a shutdown line in the second terminal, no stack trace); `lsof` prints nothing and `exit=1`.

Result (pass / fail): **pass** (second attempt)

```text
First attempt, before Ctrl-C:
COMMAND   PID           USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    34333 <owner>   15u  IPv6 0x78303a22b4d0407b      0t0  TCP *:redwood-broker (LISTEN)
exit=0
After Ctrl-C in the second terminal:
exit=1
```

Notes: the first `lsof` ran while the step 5 API (PID 34333) was still running (`redwood-broker` is lsof's name for port 3001). After Ctrl-C the port is free: no output, `exit=1`. The shutdown line of the second terminal was not pasted.

## Step 11. Lint and typecheck of the workspace

```bash
pnpm turbo run lint typecheck --concurrency=2; echo "exit=$?"
```

Expected: every `lint` and `typecheck` task succeeds (cache hits are fine); the `@kd/eslint-config` lint runs `check-fixtures` and `check-manifests`; `exit=0`.

Result (pass / fail): **pass**

```text
   • turbo 2.11.10
   • Packages in scope: @kd/admin, @kd/api, @kd/contracts, @kd/design-tokens, @kd/eslint-config, @kd/i18n, @kd/mobile, @kd/seed, @kd/seed-data, @kd/tsconfig
   • Running lint, typecheck in 10 packages
@kd/eslint-config:lint: check-fixtures: 13 files, 197 violations rejected as expected
@kd/eslint-config:lint: check-manifests: 10 workspace manifests clean, 4 fixtures with 6 rejections as expected
 Tasks:    19 successful, 19 total
Cached:    1 cached, 19 total
  Time:    5.28s
exit=0
```

Notes: the per-task lines are omitted. The `@kd/design-tokens` build ran as a dependency and rewrote its generated files with the same content (`git status` stays clean in the final check).

## Step 12. OpenAPI generate, then check: no drift

```bash
pnpm openapi:generate; echo "exit=$?"
pnpm openapi:check; echo "exit=$?"
git status --short packages/contracts; echo "exit=$?"
```

Expected: both OpenAPI commands exit 0; `openapi:check` reports no drift (and the breaking-change check inactive while no released snapshot exists); `git status --short packages/contracts` prints nothing and `exit=0`.

Result (pass / fail): **pass**

```text
$ turbo run @kd/api#openapi:generate --concurrency=2 && turbo run @kd/contracts#client:generate --concurrency=2
@kd/api:openapi:generate: openapi:generate: wrote <repo>/packages/contracts/openapi.json
@kd/contracts:client:generate: client:generate: wrote <repo>/packages/contracts/src/generated/openapi.ts
exit=0
$ turbo run @kd/api#openapi:check @kd/contracts#client:check --concurrency=2 && pnpm openapi:breaking
@kd/contracts:client:check: client:check: <repo>/packages/contracts/src/generated/openapi.ts is up to date
@kd/api:openapi:check: openapi:check: <repo>/packages/contracts/openapi.json is up to date
$ scripts/openapi-breaking.sh
breaking-change check inactive: no released snapshot yet (packages/contracts/openapi.released.json)
exit=0
exit=0
```

Notes: no drift; `git status --short packages/contracts` printed nothing.

## Final check

```bash
git status --short; echo "exit=$?"
```

Expected: only this sheet (`?? docs/smoke-runs/api/phase00.md`, until it is committed); `exit=0`.

Result (pass / fail): **pass**

```text
exit=0
```

Notes: the tree was clean: this sheet was already committed (#22) with empty results, and the run changed no committed file.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes, with one procedural deviation: step 10 needed a second `lsof` after Ctrl-C |
| Failed or skipped steps | none failed; step 5 pre-check `lsof` and the step 10 shutdown line not pasted; step 0 `env:sync` reused the existing `.env` (exit 3) |
| Peak memory / wall time, step 3 (unit suite) | ~160 MiB maximum RSS, 3.12 s |
| Peak memory / wall time, step 4 (integration suite) | ~178 MiB maximum RSS, 2.75 s |
| Step 9 observed status and `code` | `400` `VALIDATION_FAILED`, `errors: []`, with `X-Request-Id` |

## Findings

Write one item per finding: the step, what was expected, what was observed, and whether it blocks the gate.

```text
1. Step 9, sheet defect (not a code defect, does not block the gate).
   Expected: grep -c '/api/health' prints 0.
   Observed: 2. Both lines are Nest start-up logs (RoutesResolver, RouterExplorer) that name the
   route; the log holds no request line for GET /api/health. A later sheet greps
   '"url":"/api/health' instead.
2. Step 10, procedure (resolved, does not block).
   The first lsof ran while the step 5 API was still running (PID 34333 on 3001), as in the
   foundation phase 4 run. After Ctrl-C a second lsof printed nothing (exit=1).
3. Step 9, by design since A0-T13 (does not block).
   A malformed JSON body is answered with X-Request-Id but writes no request-log line: the body
   parser fails before pino-http runs. Logging such requests needs the parsers registered after
   pino-http (bodyParser: false); left for a later task if wanted.
```

Phase A0 gate: run the review prompt
