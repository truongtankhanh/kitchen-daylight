# Phase A1 smoke run: identity foundations

Owner checklist for task A1-T9. It runs the Phase A1 identity pieces against the real sibling Docker repository: the build, the two migrations of A1-T3 and A1-T4 (`0007_users_branches_staff.sql`, `0008_auth_tokens_identities_mfa_consent.sql`), the unit and integration suites, focused re-runs of the deny-by-default walk, the refresh-token rotation and the throttling (A1-T6, A1-T7), one message through `MailPort` to Mailpit (A1-T8), the production guard at boot (decision 0005 section 5), then lint, typecheck and the OpenAPI drift check.

**Scope:** steps 3 to 8 run the test suites; steps 4 to 8 empty and migrate the scratch database only (`kd_scratch`), never `kd_dev`. Step 2 migrates `kd_dev`. Step 8 sends one message to the local Mailpit and deletes only that message. No step changes a committed file and no step deletes data in `kd_dev`. No watcher and no long-running process: the API of step 10 refuses to boot and exits by itself.

## How to run

- Run one step at a time, from the repository root, in order. Paste the output into the empty block of the step and fill in the result.
- Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Before pasting, replace every password with `***`.** `pnpm dev:infra` prints `scripts/print-env.sh` output with the local placeholder credentials. Never paste the content of `.env`; step 9 reads one name from it with `grep` into a shell variable. Replace home paths with `<repo>`.
- Use Node 26.13.0 (`nvm use` once in the terminal).
- The command blocks hold no comment lines and no `<...>` placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- Exit codes: each command is followed by `echo "exit=$?"`.
- Peak memory and wall time (steps 3 and 4): from `/usr/bin/time -l`, record `real` (seconds) and `maximum resident set size` (bytes; the largest single process, not the sum), and `peak memory footprint` if printed.
- No credential appears in this sheet. Step 10 passes a database URL without a password (`postgres://kd_app@127.0.0.1:5452/kd_dev`): the server refuses to boot before it connects, so no password is needed.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-06 |
| Machine / OS / chip / RAM | Owner's MacBook, Apple Silicon (arm64), as in the A0 sheet (not re-read in this run) |
| Monorepo commit (`git rev-parse --short HEAD`) | `df03235` (A1-T8), plus this uncommitted sheet |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | `f9654b1` (no tag) |
| Sibling `VERSION` | `0.0.0` |
| `docker-repo.version` | `0.0.0` |
| Node / pnpm (`node --version`, `pnpm --version`) | v26.13.0 (`nvm use`) / 12.16.1 |

## Step 0. Stack healthy, `.env` names and mode

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
scripts/env-sync.sh --print; echo "exit=$?"
stat -f %Lp .env; echo "exit=$?"
```

Expected: every service (postgres, mailpit, s3) running and healthy on its slot-2 port. `env-sync.sh --print` prints names only, no value: the 12 names of `print-env.sh` (`MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` and `MAIL_UI_URL` among them), then the monorepo block kept from `.env` with `PORT`, `LOG_LEVEL` and the auth names `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID`, `OTP_HMAC_SECRET`, `MFA_ENCRYPTION_KEY`, none of them marked as to be generated; it writes nothing. `stat` prints `600`. Every command prints `exit=0`.

Result (pass / fail): **pass**

```text
Now using node v26.13.0 (npm v11.20.0)
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[+] Running 4/4
 ✔ Container kd-docker-mailpit-1   Running   0.0s
 ✔ Container kd-docker-s3-1        Healthy   0.5s
 ✔ Container kd-docker-postgres-1  Running   0.0s
 ✔ Container kd-docker-s3-init-1   Started   0.4s
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
[kd] names from print-env.sh (contract ok):
  DATABASE_URL_MIGRATOR
  DATABASE_URL_APP
  MAIL_SMTP_HOST
  MAIL_SMTP_PORT
  MAIL_UI_URL
  STORAGE_S3_ENDPOINT
  STORAGE_S3_FORCE_PATH_STYLE
  STORAGE_S3_ACCESS_KEY
  STORAGE_S3_SECRET_KEY
  STORAGE_S3_BUCKET_MEDIA
  STORAGE_S3_BUCKET_PRIVATE
  APP_ENV
[kd] names of the monorepo block (kept from .env):
  PORT
  LOG_LEVEL
  JWT_PRIVATE_KEY
  JWT_PUBLIC_KEY
  JWT_KEY_ID
  OTP_HMAC_SECRET
  MFA_ENCRYPTION_KEY
exit=0
600
exit=0
```

Notes: the stack was already running and stays healthy on slot 2. `--print` listed names only: the 12 contract names and the monorepo block kept from `.env` with the five auth names, none marked as to be generated. `.env` has mode 600. The placeholder credentials of `print-env.sh` are replaced with `***`.

## Step 1. Build the API and its workspace dependencies

```bash
pnpm --filter "@kd/api..." build; echo "exit=$?"
```

Expected: every package build exits 0 (`@kd/contracts`, then `@kd/api` with `nest build`); `exit=0`.

Result (pass / fail): **pass**

```text
$ tsc -p tsconfig.json
$ nest build
exit=0
```

Notes: `@kd/contracts` then `@kd/api`.

## Step 2. `migrate` twice: the two identity migrations, then nothing

```bash
pnpm --filter @kd/api migrate; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
```

Expected: the first run prints `migrate: applied 0007_users_branches_staff.sql`, `migrate: applied 0008_auth_tokens_identities_mfa_consent.sql` and `migrate: 2 applied` (if an earlier run already applied one of them to `kd_dev`, it applies only the other: say which in "Notes"); the second run prints `migrate: nothing to apply`; the preflight prints nothing when it passes; both `exit=0`.

Result (pass / fail): **pass**, with the identity migrations already in `kd_dev` (see Findings)

```text
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
```

Notes: `kd_dev` already held `0007_users_branches_staff.sql` and `0008_auth_tokens_identities_mfa_consent.sql` from earlier owner runs of A1-T3 and A1-T4, so both runs applied nothing; the preflight printed nothing. Applying the two files from a clean database is shown by the global setup of steps 4 to 8 (`migrate: 8 applied` on `kd_scratch`).

## Step 3. Unit suite (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/api test; echo "exit=$?"
```

Expected: `vitest run --maxWorkers=2`; every file and test passes (57 files and 903 tests in the owner run of 2026-11-06 after A1-T8); no database connection; `exit=0`.

| Measure | Value |
|---|---|
| Test files / tests | 57 / 903 |
| Wall time (`real`) | 5.35 s |
| Maximum resident set size | 152338432 bytes (~145 MiB) |
| Peak memory footprint | 17990232 bytes (~17 MiB) |

Result (pass / fail): **pass**

```text
$ vitest run --maxWorkers=2
 RUN  v5.1.0 <repo>/apps/api
 (57 files, each ✓, among them production-guard.spec.ts (22 tests), smtp-mail.adapter.spec.ts (8),
 mail-adapter.factory.spec.ts (4), verify-email-code.template.spec.ts (12), mail.service.spec.ts (3),
 load-config.spec.ts (115))
 Test Files  57 passed (57)
      Tests  903 passed (903)
   Duration  5.05s (import 85%, tests 10%, transform 3%, worker 2%)
        5.35 real         9.78 user         2.48 sys
           152338432  maximum resident set size
            17990232  peak memory footprint
exit=0
```

Notes: the per-file lines, the Vitest isolate hint and the other `time -l` counters are omitted.

## Step 4. Integration suite against the scratch database (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/api test:int > /private/tmp/kd-a1-int.log 2>&1; echo "exit=$?"
cat /private/tmp/kd-a1-int.log
grep -c 'kd_dev' /private/tmp/kd-a1-int.log; echo "exit=$?"
```

Expected: `vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism`; the global setup resets `kd_scratch` and applies the eight migrations `0001` to `0008` there (`migrate: 8 applied`); 12 files and 199 tests pass (owner run of 2026-11-06 after A1-T8), among them `deny-by-default`, `refresh-tokens`, `throttling` and `mail-smtp`; first `exit=0`. The log names no URL, no role password and no `kd_dev`: the `grep -c` prints `0` and `exit=1`.

| Measure | Value |
|---|---|
| Test files / tests | 12 / 199 |
| Wall time (`real`) | 9.65 s |
| Maximum resident set size | 208404480 bytes (~199 MiB) |
| Peak memory footprint | 18350680 bytes (~18 MiB) |

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
migrate: applied 0007_users_branches_staff.sql
migrate: applied 0008_auth_tokens_identities_mfa_consent.sql
migrate: 8 applied
 ✓ test/integration/users-branches.int-spec.ts (63 tests) 1436ms
 ✓ test/integration/auth-tables.int-spec.ts (36 tests) 987ms
 ✓ test/integration/users-credentials.int-spec.ts (12 tests) 621ms
 ✓ test/integration/outbox.int-spec.ts (20 tests) 1001ms
 ✓ test/integration/refresh-tokens.int-spec.ts (16 tests) 615ms
 ✓ test/integration/mail-smtp.int-spec.ts (1 test) 253ms
 ✓ test/integration/audit.int-spec.ts (4 tests) 237ms
 ✓ test/integration/throttling.int-spec.ts (8 tests) 291ms
 ✓ test/integration/idempotency.int-spec.ts (9 tests) 367ms
 ✓ test/integration/deny-by-default.int-spec.ts (10 tests) 135ms
 ✓ test/integration/health.int-spec.ts (3 tests) 111ms
 ✓ test/integration/database-helpers.int-spec.ts (17 tests) 59ms
 Test Files  12 passed (12)
      Tests  199 passed (199)
   Duration  9.43s (tests 73%, import 26%, transform 1%)
        9.65 real         4.93 user         1.11 sys
           208404480  maximum resident set size
            18350680  peak memory footprint
0
exit=1
```

Notes: the global setup reset `kd_scratch` and applied the eight migrations there; `grep -c 'kd_dev'` printed `0`. The Vitest import hint and the other `time -l` counters are omitted.

## Step 5. Deny by default: every route without `@Public()` answers 401

```bash
pnpm --filter @kd/api test:int deny-by-default; echo "exit=$?"
```

Expected: 1 file and 10 tests pass, among them "answers 401 UNAUTHENTICATED without a token on every route not marked @Public()", "opens exactly the expected @Public() routes without a token", "answers 401 TOKEN_EXPIRED to an authentic but expired token" and "answers 403 FORBIDDEN on a role mismatch"; `exit=0`. The global setup resets and migrates `kd_scratch` again (`migrate: 8 applied`).

Result (pass / fail): **pass**

```text
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism deny-by-default
 RUN  v5.1.0 <repo>/apps/api
migrate: 8 applied
 ✓ test/integration/deny-by-default.int-spec.ts (10 tests) 144ms
   ✓ deny by default (every route of the real app) (10)
     ✓ enumerates a non-trivial route list 1ms
     ✓ sets apart only wildcard middleware mounts, never an @All() endpoint 0ms
     ✓ answers 401 UNAUTHENTICATED without a token on every route not marked @Public() 25ms
     ✓ opens exactly the expected @Public() routes without a token 6ms
     ✓ answers 401 UNAUTHENTICATED to a malformed header or a forged token 3ms
     ✓ answers 401 TOKEN_EXPIRED to an authentic but expired token 2ms
     ✓ sets the request user from the token only 1ms
     ✓ validates the body only after the token is accepted 1ms
     ✓ answers 403 FORBIDDEN on a role mismatch 5ms
     ✓ refuses an admin route without @Roles to every role, whatever the case of the URL 6ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
exit=0
```

Notes: the eight `migrate: applied` lines before `migrate: 8 applied` are omitted (the same as step 4).

## Step 6. Refresh tokens: rotation, reuse, grace window, concurrent rotation

```bash
pnpm --filter @kd/api test:int refresh-tokens; echo "exit=$?"
```

Expected: 1 file and 16 tests pass, among them "follows a rotation chain in one family", "treats a used token outside the window as reuse: revokes the whole family and audits", "returns the same successor within 10 s and revokes nothing" and "gives two concurrent rotations the same successor and keeps the family alive"; `exit=0`.

Result (pass / fail): **pass**

```text
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism refresh-tokens
 RUN  v5.1.0 <repo>/apps/api
migrate: 8 applied
 ✓ test/integration/refresh-tokens.int-spec.ts (16 tests) 673ms
   ✓ RefreshTokenService (kd_app, real PostgreSQL) (16)
     ✓ issue (3)
       ✓ opens a customer family: 30 days idle, 90 absolute, only the hash stored 52ms
       ✓ opens a staff family: 24 hours idle, 7 days absolute 39ms
       ✓ starts a new family at each sign-in 45ms
     ✓ rotate (10)
       ✓ follows a rotation chain in one family: idle expiry moves, absolute does not 45ms
       ✓ treats a used token outside the window as reuse: revokes the whole family and audits 44ms
       ✓ returns the same successor within 10 s and revokes nothing 36ms
       ✓ gives two concurrent rotations the same successor and keeps the family alive 39ms
       ✓ treats the old token as reuse once its successor was used, even within the window 46ms
       ✓ refuses without revoking a used token inside the window after a restart 34ms
       ✓ refuses a token after its idle expiry, without revoking 31ms
       ✓ refuses a family after its absolute expiry, however recently it rotated 50ms
       ✓ refuses a revoked and an unknown token 42ms
       ✓ refuses a grace answer once the family was revoked 29ms
     ✓ revocation (3)
       ✓ revokes every family of one user and nothing of another (revokeAllForUser) 41ms
       ✓ revokes the family of a presented token, and ignores an unknown one (revokeByToken) 30ms
       ✓ fills the A1-T5 hook: a suspension revokes the sessions in the same transaction 32ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
exit=0
```

Notes: rotation, reuse, the 10 s grace window and the concurrent rotation all pass; the `migrate: applied` lines are omitted.

## Step 7. Throttling: per-IP limits and the per-account reads

```bash
pnpm --filter @kd/api test:int throttling; echo "exit=$?"
```

Expected: 1 file and 8 tests pass (the strict auth limit on both auth prefixes, a lenient route still open, the health check never throttled, then `AccountThrottleService` on `users.locked_until` and the 60 s resend rule); `exit=0`.

Result (pass / fail): **pass**

```text
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism throttling
 RUN  v5.1.0 <repo>/apps/api
migrate: 8 applied
 ✓ test/integration/throttling.int-spec.ts (8 tests) 341ms
   ✓ per-IP throttling (in-process memory store) (4)
     ✓ limits /api/v1/auth/test-throttle by its URL prefix, then answers 429 RATE_LIMITED with Retry-After 19ms
     ✓ limits /api/v1/admin/auth/test-throttle by its URL prefix, then answers 429 RATE_LIMITED with Retry-After 4ms
     ✓ keeps a lenient route open after the strict limits are reached 10ms
     ✓ never throttles the health check 11ms
   ✓ AccountThrottleService (kd_app, real PostgreSQL) (4)
     ✓ reads the lock from users.locked_until, locked only while it is in the future 46ms
     ✓ allows a resend when no email token was ever issued 26ms
     ✓ refuses a resend within 60 s of the newest token of the same user and type 30ms
     ✓ allows a resend from exactly 60 s after the newest token 57ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
exit=0
```

Notes: the `migrate: applied` lines are omitted.

## Step 8. One message through `MailPort` to Mailpit

```bash
pnpm --filter @kd/api test:int mail-smtp; echo "exit=$?"
```

Expected: 1 file and 1 test pass, "delivers one plain-text VERIFY_EMAIL_CODE message that Mailpit stores": the SMTP adapter sends to a fictional `mail-smtp-…@example.com` address, the spec finds the message through Mailpit's REST API by its Message-ID, checks the Vietnamese subject `Mã xác minh email của bạn`, the one recipient, an empty HTML part and the code once in the text, then deletes that message by its ID only; `exit=0`. If Mailpit is down the spec fails with "Mailpit is not reachable at MAIL_UI_URL", it never skips.

Result (pass / fail): **pass**

```text
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism mail-smtp
 RUN  v5.1.0 <repo>/apps/api
migrate: 8 applied
 ✓ test/integration/mail-smtp.int-spec.ts (1 test) 400ms
   ✓ MailPort over SMTP to Mailpit (1)
     ✓ delivers one plain-text VERIFY_EMAIL_CODE message that Mailpit stores 297ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
exit=0
```

Notes: the message went through `MailPort` (SMTP adapter, real `MailModule` wiring) and was found in Mailpit with the Vietnamese subject, one `@example.com` recipient, no HTML part and the code once; the `migrate: applied` lines are omitted.

## Step 9. Mailpit after the spec: its message is gone, the server accepted it

```bash
mail_ui=$(grep '^MAIL_UI_URL=' .env | cut -d= -f2-)
echo "$mail_ui"
curl -s "$mail_ui/api/v1/search?query=to:mail-smtp-"; echo "exit=$?"
curl -s "$mail_ui/api/v1/info"; echo "exit=$?"
```

Expected: `echo` prints the slot-2 Mailpit address (`http://127.0.0.1:8045`); only that one line of `.env` is read. The search prints JSON with `"messages":[]` and `"messages_count":0`: the spec of step 8 deleted its own message, so no `mail-smtp-…@example.com` message is left (other messages of the inbox, if any, are untouched). The info prints JSON whose `RuntimeStats` holds `SMTPAccepted` and `MessagesDeleted` of at least 1 each (counted since Mailpit started, so earlier runs add to them). Mailpit prints no trailing newline, so each JSON body ends with `exit=0` on the same line, as in the A0 sheet. The received message and its Vietnamese subject are proven by the assertions of step 8, which pass only after Mailpit returned that message; this step shows the clean-up.

Result (pass / fail): **pass**

```text
http://127.0.0.1:8045
{"total":0,"unread":0,"count":0,"messages_count":0,"messages_unread":0,"start":0,"tags":[],"messages":[]}
exit=0
{"Version":"v1.32.0","LatestVersion":"v1.33.0","Database":"/tmp/mailpit-1793924681029052762.db","DatabaseSize":90112,"Messages":0,"Unread":0,"Tags":{},"RuntimeStats":{"Uptime":23231,"Memory":15956232,"MessagesDeleted":3,"SMTPAccepted":3,"SMTPAcceptedSize":3429,"SMTPRejected":0,"SMTPIgnored":0}}
exit=0
```

Notes: no `mail-smtp-…` message is left and the inbox is empty (`Messages: 0`). `SMTPAccepted: 3` and `MessagesDeleted: 3` since Mailpit started: the three `mail-smtp` runs (the A1-T8 owner run, step 4 and step 8) each sent one message and deleted exactly that one; nothing was rejected. The received message and its subject are proven by the assertions of step 8.

## Step 10. Production guard at boot: `prod` with the SMTP adapter is refused

```bash
APP_ENV=prod TRUST_PROXY_HOPS=1 MAIL_ADAPTER=smtp MAIL_FROM=ops@example.com DATABASE_URL_APP=postgres://kd_app@127.0.0.1:5452/kd_dev pnpm --filter @kd/api start; echo "exit=$?"
lsof -nP -sTCP:LISTEN -iTCP:3001; echo "exit=$?"
```

Expected: `node dist/main.js` reads `.env` (the values above win over it), the configuration is valid, and the guard refuses before Nest boots with exactly one stderr line, `MailPort: adapter smtp (emulator) is refused when APP_ENV=prod`, naming the port, the adapter, its kind and `APP_ENV` and no value (no URL, no host, no address); pnpm then reports the failed command and the line ends with `exit=1`. No pino line is printed, because Nest never starts: no database connection and no listening port, so `lsof` prints nothing and `exit=1`. `TRUST_PROXY_HOPS=1` is set because `prod` requires it (decision 0007 section 5); without it the refusal would be the configuration line `TRUST_PROXY_HOPS: required` instead of the guard.

Result (pass / fail): **pass**

```text
$ node dist/main.js
MailPort: adapter smtp (emulator) is refused when APP_ENV=prod
[ELIFECYCLE] Command failed with exit code 1.
Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

  × "pnpm recursive run" failed in <repo>/apps/api

exit=1
exit=1
```

Notes: exactly one guard line, naming the port, the adapter, its kind and `APP_ENV`, and no value; `main.js` exited 1 before Nest booted (no pino line, so no database connection). The lines after it are pnpm's own report of the failed script. `lsof` printed nothing (`exit=1`): no listening port.

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
  Time:    6.372s
exit=0
```

Notes: the per-task lines are omitted. The `@kd/design-tokens` build ran as a dependency and rewrote its generated files with the same content (the final check stays clean).

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

Notes: no drift (turbo cache hits); `git status --short packages/contracts` printed nothing.

## Final check

```bash
git status --short; echo "exit=$?"
```

Expected: only this sheet (` M docs/smoke-runs/api/phase01.md` once its results are filled in, or `??` before it is first committed); `exit=0`.

Result (pass / fail): **pass**

```text
?? docs/smoke-runs/api/phase01.md
exit=0
```

Notes: run by the agent (read-only) on the same tree right after step 12: only this sheet, not yet committed.

## Closing note

No endpoint exists yet beyond `GET /api/health`: Phase A1 ships the identity foundations (tables, password hashing, tokens, guards, throttling, mail port) without a sign-in route, so there is no login to try by hand. The first customer login is the smoke run of A2-T7.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes |
| Failed or skipped steps | none failed or skipped; step 2 applied nothing because `kd_dev` already held 0007 and 0008 (Findings 1); the final check was run by the agent |
| Peak memory / wall time, step 3 (unit suite) | ~145 MiB maximum RSS, 5.35 s |
| Peak memory / wall time, step 4 (integration suite) | ~199 MiB maximum RSS, 9.65 s |
| Step 10 stderr line | `MailPort: adapter smtp (emulator) is refused when APP_ENV=prod`, exit 1 |

## Findings

Write one item per finding: the step, what was expected, what was observed, and whether it blocks the gate.

```text
1. Step 2, environment state (does not block the gate).
   Expected: the first migrate applies 0007 and 0008 to kd_dev (migrate: 2 applied).
   Observed: migrate: nothing to apply twice; kd_dev already held both files from the owner runs
   of A1-T3 and A1-T4. The checksum guard accepted them, so the files are unchanged since then.
   Applying them from a clean database is shown on kd_scratch in steps 4 to 8 (8 applied).
2. Step 10, sheet versus task prompt (resolved in the sheet, does not block).
   The task prompt's command had no TRUST_PROXY_HOPS and a database URL with a throw-away
   password. prod requires TRUST_PROXY_HOPS (decision 0007 section 5), so the sheet sets 1;
   without it the refusal is the configuration line, not the guard. The URL carries no password,
   since the server exits before it connects. The prompt named the port "mail"; the guard names
   it MailPort, as the code of A1-T8 does.
3. Step 9, observation (does not block).
   Mailpit reports Version v1.32.0 and LatestVersion v1.33.0. The image is pinned by the Docker
   repository; an update is its own task there.
```

Phase A1 gate: run the review prompt
