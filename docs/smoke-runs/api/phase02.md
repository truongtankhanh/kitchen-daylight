# Phase A2 smoke run: customer accounts

Owner checklist for task A2-T7. It runs the customer-account slice of Phase A2 (A2-T1 to A2-T6) on the host against the local stack: migrations, both test suites, the `reference` seed (geography), the public geography endpoints, registration, the email code, sign-in, refresh rotation and its grace window, password reset, the session list, the address book and log hygiene. Social sign-in (A2-T6) needs real Google or Apple tokens and is covered by the integration suite only (step 13).

**Scope:** steps 1 and 3 write to the local `kd_dev` database (migrations, the geography seed, two throw-away consent documents); steps 5 to 11 create the fictional customer `ana.smoke@example.com` and its rows. No step changes a committed file and no step deletes data. The only long-running process is the API started in step 0 (`pnpm --filter @kd/api start`, no watcher), stopped with Ctrl-C in step 14.

## How to run

- Run one step at a time, from the repository root, in order, in **terminal 1**. The API runs in **terminal 2** (step 0). Shell variables and helper functions set in terminal 1 are reused by later steps, so keep the same terminal open from start to finish.
- **Each command block can be pasted whole.** No value is copied by hand: tokens, ids and codes are read from the last response (or from Mailpit, or from the database) by the helpers of step 0. A helper that finds nothing prints `kdget: ...` or `kdcode: ...` on stderr and the following `echo "exit=$?"` shows a non-zero code: stop there.
- Paste the output into the empty block of the step and fill in the result. Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Before pasting, replace every token, code and password with `***`**: `accessToken`, `refreshToken`, the 6-digit codes and the passwords. Never paste the content of `.env`; the only lines this sheet reads from it are `MAIL_UI_URL` (step 0) and `DATABASE_URL_MIGRATOR` (step 3), and neither is printed. `pnpm dev:infra` prints the `print-env.sh` block: replace it with `(print-env.sh output, passwords as ***)`. Replace home paths with `<repo>`.
- Use Node 26.13.0 (`nvm use` once in each terminal).
- The command blocks hold no comment lines and no angle-bracket placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- **Passwords:** `PW1`, `PW2` and `PW3` (step 0) are throw-away values in the `CHANGE_ME_LOCAL` style. Replace them with your own values of 10 to 128 characters if you like; the values as written also work. They are never real secrets.
- `jq` is not needed: the helpers use `node`.
- **Throttling:** the per-IP limits of decision 0008 section 7 hold in the API process. The sheet stays below them (sending a code or a reset: 4 of 5 per 15 minutes; code checks: 9 of 10 per 15 minutes). If a repeated step answers `429 RATE_LIMITED`, restart the API in terminal 2 (the counters live in memory) and repeat the step.
- **Resuming in a new terminal 1:** run the second block of step 0 (variables and helpers) and the first two lines of step 3 (`KD_SQL_URL`, `kdsql`) first; step 5 also needs `TERMS_ID` and `PRIVACY_ID` (the last block of step 3 sets them again without inserting).
- Exit codes: commands other than `curl` are followed by `echo "exit=$?"`.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-07 |
| Machine / OS / chip / RAM | Owner's MacBook, Apple Silicon |
| Monorepo commit (`git rev-parse --short HEAD`) | `3828398`, plus this uncommitted sheet |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | |
| Node / pnpm (`node --version`, `pnpm --version`) | v26.13.0 (`nvm use`) / |

**Run log:** a first attempt of steps 5 to 8 (04:37 to 04:38 UTC) used the first version of this sheet, whose `paste-...-here` lines were run unreplaced and whose consent insert (step 3) had not been run: no account was created, every later call answered `401`, and step 8 printed a false `same successor: true` (two error bodies, both without a token). Those outputs are discarded. The sheet now reads every value itself and checks that a token was issued; the API was restarted before the consent insert of step 3 so that the per-IP counters start empty. In the second pass (04:45 to 04:52 UTC), block 2 of steps 8 and 9 was skipped, so step 10 failed in chain (see its notes); steps 8, 9 and 10 now say "run both" and name their blocks. A third pass (04:50 to 04:54 UTC) ran block 2 of steps 8 and 9, step 10, step 12 again and the `lsof` check of step 14: all passed.

## Step 0. Stack, `.env`, build and the API

Terminal 1:

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
grep -c '^JWT_PRIVATE_KEY=' .env; echo "exit=$?"
grep -c '^MFA_ENCRYPTION_KEY=' .env; echo "exit=$?"
```

If either count is `0`, the root `.env` lacks the auth block: run `pnpm env:sync; echo "exit=$?"` (or `scripts/env-sync.sh --force` if it exits 3 because `.env` exists; the monorepo block is kept) and say so in "Notes". Then:

```bash
pnpm --filter "@kd/api..." build; echo "exit=$?"
```

Terminal 2 (stays open until step 14):

```bash
nvm use
pnpm --filter @kd/api start 2>&1 | tee "$TMPDIR/kd-api-a2.log"
```

Terminal 1, the variables and helpers used by every later step:

```bash
curl -sS -i http://127.0.0.1:3001/api/health; echo
API=http://127.0.0.1:3001/api/v1
MAIL_UI_URL="$(grep '^MAIL_UI_URL=' .env | cut -d= -f2-)"
PW1='CHANGE_ME_LOCAL_replace_pw_one'
PW2='CHANGE_ME_LOCAL_replace_pw_two'
PW3='CHANGE_ME_LOCAL_replace_pw_three'
KD_HEAD="$TMPDIR/kd-a2-head.txt"
KD_BODY="$TMPDIR/kd-a2-body.json"
kdcall() { curl -sS -D "$KD_HEAD" -o "$KD_BODY" "$@"; head -n 1 "$KD_HEAD"; cat "$KD_BODY"; echo; }
kdget() { node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (typeof v !== "string" || v === "") { console.error("kdget: no " + process.argv[2] + " in the last body"); process.exit(1); } console.log(v)' "$KD_BODY" "$1"; }
kdcode() { node --input-type=module -e 'const base = process.argv[1]; const list = await (await fetch(base + "/api/v1/messages?limit=1")).json(); const m = list.messages[0]; if (!m) { console.error("kdcode: no message"); process.exit(1); } const full = await (await fetch(base + "/api/v1/message/" + m.ID)).json(); const code = (full.Text.match(/\b\d{6}\b/) ?? [])[0]; console.error("kdcode: to " + full.To.map((t) => t.Address).join(",") + " | " + full.Subject + " | mailbox total " + list.total); if (!code) { console.error("kdcode: no 6-digit code in the text"); process.exit(1); } console.log(code)' "$MAIL_UI_URL"; }
kdmails() { node --input-type=module -e 'const r = await (await fetch(process.argv[1] + "/api/v1/messages?limit=1")).json(); console.log(r.total)' "$MAIL_UI_URL"; }
```

- `kdcall` runs `curl` with the given arguments, saves the headers and the body, and prints the status line and the body.
- `kdget NAME` prints the string field `NAME` of the last body (a token or an id).
- `kdcode` reads the newest Mailpit message, prints its recipient, subject and the mailbox total on stderr, and prints the 6-digit code of its text.
- `kdmails` prints the number of messages in Mailpit.

Expected: every service healthy; both `grep -c` print `1`; the build exits 0; the API logs that it listens on 3001; `GET /api/health` answers `HTTP/1.1 200`. The other lines print nothing.

Result (pass / fail): **pass**

```text
Now using node v26.13.0 (npm v11.20.0)
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
 ✔ Container kd-docker-mailpit-1   Running
 ✔ Container kd-docker-s3-1        Healthy
 ✔ Container kd-docker-postgres-1  Running
 ✔ Container kd-docker-s3-init-1   Started
[kd] all services ready
(print-env.sh output, passwords as ***)
exit=0
1
exit=0
1
exit=0
$ tsc -p tsconfig.json
$ nest build
exit=0
HTTP/1.1 200 OK
X-Request-Id: 2feb1175-13df-4d99-be0a-85a9a46858c6
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42
{"status":"ok","checks":{"database":"up"}}
```

Notes: the auth block was present; `env:sync` was not run. The helper lines were added to this block after the first attempt (see "Run log").

## Step 1. `migrate` twice

```bash
pnpm --filter @kd/api migrate; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
```

Expected: the first run applies any pending file of Phase A2 (`migrate: applied ...`, for example `0009` and `0010`) or prints `migrate: nothing to apply`; the second run prints `migrate: nothing to apply`; both `exit=0`.

Result (pass / fail): **pass**

```text
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
```

Notes: `0009` and `0010` were already applied to `kd_dev` by earlier development runs.

## Step 2. Unit and integration suites

```bash
pnpm --filter @kd/api test; echo "exit=$?"
pnpm --filter @kd/api test:int; echo "exit=$?"
```

Expected: both suites pass (`Test Files  N passed`, no failure, no skip you did not expect); both `exit=0`. The integration suite uses its own scratch database, not `kd_dev`, and does not disturb the running API.

Result (pass / fail): **pass**

```text
$ vitest run --maxWorkers=2
 Test Files  68 passed (68)
      Tests  1156 passed (1156)
   Duration  6.35s
exit=0
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism
migrate: applied 0001_database_helpers.sql
(0002 to 0009)
migrate: applied 0010_customer_addresses.sql
migrate: 10 applied
 ✓ test/integration/social.int-spec.ts (25 tests) 2364ms
 ✓ test/integration/auth-customer.int-spec.ts (26 tests) 1913ms
 ✓ test/integration/auth-codes.int-spec.ts (23 tests) 1640ms
 (15 more files, all passed)
 Test Files  18 passed (18)
      Tests  333 passed (333)
   Duration  25.20s
exit=0
```

Notes: the integration run prints the warning lines its cases provoke on purpose (`auth.social_refused` with reasons `nonce_reused`, `nonce_expired`, `nonce`, `audience`, `expired`; `auth.login_failed` up to the lock; `auth.refresh_reuse`; the `fixture failure` of the 500 case; `ECONNREFUSED` of the mail stub; the daily cap). None carries a token, a code, a password or an email.

## Step 3. Reference seed (geography) and two throw-away consent documents

`kdsql` runs `psql` inside the Postgres container as `kd_migrator`, with the URL of the root `.env` rewritten to the container port (5432). The URL is never printed.

```bash
KD_SQL_URL="$(grep '^DATABASE_URL_MIGRATOR=' .env | cut -d= -f2-)"
kdsql() { docker exec -i kd-docker-postgres-1 psql "${KD_SQL_URL/127.0.0.1:5452/127.0.0.1:5432}" -v ON_ERROR_STOP=1 -X "$@"; }
kdsql -At -c 'SELECT count(*) FROM public.provinces'; echo "exit=$?"
pnpm --filter "@kd/seed..." build; echo "exit=$?"
pnpm --filter @kd/seed seed reference; echo "exit=$?"
kdsql -At -c 'SELECT count(*) FROM public.provinces'; echo "exit=$?"
pnpm --filter @kd/seed seed reference --commit; echo "exit=$?"
pnpm --filter @kd/seed seed reference --commit; echo "exit=$?"
kdsql -At -c 'SELECT (SELECT count(*) FROM public.provinces), (SELECT count(*) FROM public.wards)'; echo "exit=$?"
```

Expected:

- The first count is `0`.
- The dry run prints `geography  provinces  inserted 34  updated 0  unchanged 0  stale 0` and `geography  wards  inserted 3321  updated 0  unchanged 0  stale 0`, exits 0, and the count after it is still `0` (rolled back).
- The first `--commit` prints the same counts and exits 0; the second prints `inserted 0  updated 0  unchanged 34` and `inserted 0  updated 0  unchanged 3321`.
- The last query prints `34|3321`.

If `docker exec` refuses the connection because the host of the URL is not `127.0.0.1:5452`, write the host and port shape (no password) in "Notes" and stop.

Result, geography (pass / fail): **pass**

```text
0
exit=0
$ tsc -p tsconfig.build.json
exit=0
$ node --env-file-if-exists=../../.env dist/cli.js reference
seed reference: dry run (rolled back at the end; --commit writes)
  geography  provinces  inserted 34  updated 0  unchanged 0  stale 0
  geography  wards  inserted 3321  updated 0  unchanged 0  stale 0
seed reference: rolled back (dry run)
exit=0
0
exit=0
$ node --env-file-if-exists=../../.env dist/cli.js reference --commit
seed reference: commit
  geography  provinces  inserted 34  updated 0  unchanged 0  stale 0
  geography  wards  inserted 3321  updated 0  unchanged 0  stale 0
seed reference: committed
exit=0
$ node --env-file-if-exists=../../.env dist/cli.js reference --commit
seed reference: commit
  geography  provinces  inserted 0  updated 0  unchanged 34  stale 0
  geography  wards  inserted 0  updated 0  unchanged 3321  stale 0
seed reference: committed
exit=0
34|3321
exit=0
```

Then the two consent documents. They stand in for the real Terms and Privacy Policy until A4-T5 seeds them; the columns and defaults are those of migration `0008_auth_tokens_identities_mfa_consent.sql` (`id` defaults to `uuidv7()`, `content_sha256` is 64 lower-case hex characters, `(type, version, locale)` is unique). **Before this block, restart the API in terminal 2** (Ctrl-C, then the same `start` command) so that the per-IP counters start empty for steps 5 to 11.

```bash
kdsql -At <<'SQL'
INSERT INTO public.consent_documents (type, version, locale, content_sha256, published_at)
VALUES ('TERMS_OF_SERVICE', 'smoke-a2', 'vi', repeat('a', 64), now()),
       ('PRIVACY_POLICY',   'smoke-a2', 'vi', repeat('b', 64), now())
RETURNING type, id;
SQL
echo "exit=$?"
```

Set the two ids (this block only reads; run it again whenever a new terminal resumes the sheet):

```bash
TERMS_ID="$(kdsql -At -c "SELECT id FROM public.consent_documents WHERE type = 'TERMS_OF_SERVICE' AND version = 'smoke-a2' AND locale = 'vi'")"
PRIVACY_ID="$(kdsql -At -c "SELECT id FROM public.consent_documents WHERE type = 'PRIVACY_POLICY' AND version = 'smoke-a2' AND locale = 'vi'")"
echo "TERMS_ID=$TERMS_ID PRIVACY_ID=$PRIVACY_ID"
```

Expected: the insert prints `TERMS_OF_SERVICE|...` and `PRIVACY_POLICY|...` with two UUIDs (psql may also print `INSERT 0 2`) and `exit=0`; the last line prints the same two UUIDs. Write both ids in "Notes". These rows stay in `kd_dev` (published text is immutable and the consents of step 5 reference them). A second run of the insert fails with the unique constraint `consent_documents_type_version_locale_unique`: skip it and run only the second block.

Result (pass / fail): **pass**

```text
TERMS_OF_SERVICE|01a1b454-ba97-7e3c-ad16-50637efb1fa2
PRIVACY_POLICY|01a1b454-ba9e-7028-a589-a968e0614248
INSERT 0 2
exit=0
TERMS_ID=01a1b454-ba97-7e3c-ad16-50637efb1fa2 PRIVACY_ID=01a1b454-ba9e-7028-a589-a968e0614248
```

Notes: the API was restarted before the insert. Consent document ids: Terms `01a1b454-ba97-7e3c-ad16-50637efb1fa2`, Privacy `01a1b454-ba9e-7028-a589-a968e0614248` (version `smoke-a2`, locale `vi`; they stay in `kd_dev`).

## Step 4. Geography endpoints

```bash
curl -sS -D "$TMPDIR/kd-a2-head.txt" -o "$TMPDIR/kd-a2-body.json" "$API/provinces"
grep -iE '^(HTTP|etag|cache-control)' "$TMPDIR/kd-a2-head.txt"
node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$TMPDIR/kd-a2-body.json"
curl -sS -D "$TMPDIR/kd-a2-head.txt" -o "$TMPDIR/kd-a2-body.json" "$API/wards?provinceCode=79"
grep -iE '^(HTTP|etag)' "$TMPDIR/kd-a2-head.txt"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(r.length, r[0].code)' "$TMPDIR/kd-a2-body.json"
curl -sS -o "$TMPDIR/kd-a2-body.json" "$API/wards?provinceCode=01"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(r.length, r[0].code)' "$TMPDIR/kd-a2-body.json"
curl -sS -i "$API/wards"; echo
```

Expected:

- `/provinces`: `HTTP/1.1 200`, an `ETag` and a `Cache-Control` header, and `34`.
- `/wards?provinceCode=79`: `HTTP/1.1 200`, an `ETag`, and `168` followed by a 5-digit ward code; `/wards?provinceCode=01` prints a count and a ward code of province 01.
- `/wards` without `provinceCode`: `HTTP/1.1 400`, `application/problem+json`, `"code":"VALIDATION_FAILED"` with an error on `provinceCode`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
Cache-Control: public, max-age=86400
ETag: "gh8fOMUUMk5ohh3mVDWBtCgloQAM42DjJMQLq5uVgPY"
34
HTTP/1.1 200 OK
ETag: "T4PtlqEl7D8QNn-bhCtDzTH8drpwcuXF0Fz2G7DfACs"
168 27316
126 09877
HTTP/1.1 400 Bad Request
X-RateLimit-Limit: 600
Content-Type: application/problem+json; charset=utf-8
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"provinceCode","code":"REQUIRED","message":"is required"}]}
```

Notes: province 01 has 126 wards. Step 11 reads the ward codes again itself.

## Step 5. Register

```bash
echo "TERMS_ID=$TERMS_ID PRIVACY_ID=$PRIVACY_ID"
kdcall -X POST "$API/auth/register" -H 'Content-Type: application/json' -H 'X-Client: mobile-ios' -H 'X-App-Version: 1.0.0' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW1\",\"displayName\":\"Ana Smoke\",\"phone\":\"0901234567\",\"acceptedDocumentIds\":[\"$TERMS_ID\",\"$PRIVACY_ID\"],\"deviceLabel\":\"smoke-phone\"}"
ACCESS="$(kdget accessToken)" && REFRESH="$(kdget refreshToken)"; echo "exit=$?"
kdcall "$API/me" -H "Authorization: Bearer $ACCESS"
kdcall -X POST "$API/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW1\",\"displayName\":\"Ana Smoke\"}"
```

Expected:

- The first line shows two UUIDs (if not, go back to the last block of step 3).
- The first register answers `HTTP/1.1 201` with `accessToken`, `refreshToken`, `expiresIn` (about 900) and `user { id, email: "ana.smoke@example.com", displayName: "Ana Smoke", emailVerifiedAt: null }`; `exit=0`.
- `GET /me` answers `200` with `"phone":"+84901234567"` and `"emailVerifiedAt":null`.
- The register without `acceptedDocumentIds` answers `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, with the error `REQUIRED` on `acceptedDocumentIds` (the body is validated before the email is looked up).

Result (pass / fail): **pass**

```text
TERMS_ID=01a1b454-ba97-7e3c-ad16-50637efb1fa2 PRIVACY_ID=01a1b454-ba9e-7028-a589-a968e0614248
HTTP/1.1 201 Created
{"accessToken":"***","refreshToken":"***","expiresIn":899,"user":{"id":"01a1b455-1369-7810-81e3-a9f4ae0bd52b","email":"ana.smoke@example.com","displayName":"Ana Smoke","emailVerifiedAt":null}}
exit=0
HTTP/1.1 200 OK
{"id":"01a1b455-1369-7810-81e3-a9f4ae0bd52b","email":"ana.smoke@example.com","emailVerifiedAt":null,"displayName":"Ana Smoke","phone":"+84901234567","avatarUrl":null,"preferredBranchId":null}
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"acceptedDocumentIds","code":"REQUIRED","message":"is required"}]}
```

Notes: user id `01a1b455-1369-7810-81e3-a9f4ae0bd52b`.

## Step 6. Email verification code

```bash
kdcall -X POST "$API/auth/email/send-code" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{}'
sleep 2
CODE="$(kdcode)"; echo "exit=$?"
WRONG=000000; [ "$CODE" = 000000 ] && WRONG=111111
kdcall -X POST "$API/auth/email/verify" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"code\":\"$WRONG\"}"
kdcall -X POST "$API/auth/email/verify" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}"
kdcall "$API/me" -H "Authorization: Bearer $ACCESS"
```

Expected:

- `send-code` answers `HTTP/1.1 202`.
- `kdcode` prints `to ana.smoke@example.com | ...` and `exit=0`.
- The wrong code answers `HTTP/1.1 400`, `"code":"CODE_INVALID"`; the right code answers `HTTP/1.1 204`.
- `GET /me` shows `emailVerifiedAt` set (an ISO instant).

Result (pass / fail): **pass**

```text
HTTP/1.1 202 Accepted

kdcode: to ana.smoke@example.com | Mã xác minh email của bạn | mailbox total 1
exit=0
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"CODE_INVALID"}
HTTP/1.1 204 No Content

HTTP/1.1 200 OK
{"id":"01a1b455-1369-7810-81e3-a9f4ae0bd52b","email":"ana.smoke@example.com","emailVerifiedAt":"2026-11-07T04:47:27.485Z","displayName":"Ana Smoke","phone":"+84901234567","avatarUrl":null,"preferredBranchId":null}
```

Notes: 

## Step 7. Sign-in: generic refusal, then success

```bash
curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"email":"ana.smoke@example.com","password":"CHANGE_ME_LOCAL_wrong_pw"}' -w '\nstatus=%{http_code}\n' | tee "$TMPDIR/kd-a2-wrong.txt"
curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"email":"nobody.smoke@example.com","password":"CHANGE_ME_LOCAL_wrong_pw"}' -w '\nstatus=%{http_code}\n' | tee "$TMPDIR/kd-a2-unknown.txt"
diff "$TMPDIR/kd-a2-wrong.txt" "$TMPDIR/kd-a2-unknown.txt"; echo "exit=$?"
kdcall -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW1\",\"deviceLabel\":\"smoke-phone\"}"
ACCESS="$(kdget accessToken)" && REFRESH="$(kdget refreshToken)"; echo "exit=$?"
```

Expected: both refusals answer `status=401` with the same body (`"code":"INVALID_CREDENTIALS"`, no detail on the cause); `diff` prints nothing and `exit=0`. The account exists since step 5, so the first refusal is a wrong password and the second an unknown email. The correct login answers `HTTP/1.1 200` with new tokens and `exit=0`.

Result (pass / fail): **pass**

```text
{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}
status=401
{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}
status=401
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","refreshToken":"***","expiresIn":899,"user":{"id":"01a1b455-1369-7810-81e3-a9f4ae0bd52b","email":"ana.smoke@example.com","displayName":"Ana Smoke","emailVerifiedAt":"2026-11-07T04:47:27.485Z"}}
exit=0
```

Notes: 

## Step 8. Refresh rotation, grace window and reuse

**This step has two blocks; run both.** Block 1 of 2, as one paste, so both refreshes fall within 10 seconds:

```bash
curl -sS -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" -o "$TMPDIR/kd-a2-r1.json" -w 'status=%{http_code}\n'
curl -sS -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" -o "$TMPDIR/kd-a2-r2.json" -w 'status=%{http_code}\n'
node -e 'const fs = require("fs"); const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8"))); const issued = typeof a.refreshToken === "string" && a.refreshToken !== ""; console.log("successor issued:", issued, "| same successor:", issued && a.refreshToken === b.refreshToken)' "$TMPDIR/kd-a2-r1.json" "$TMPDIR/kd-a2-r2.json"
```

Block 2 of 2 (the reuse check and a new login; step 9 needs its tokens):

```bash
SUCCESSOR="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).refreshToken)' "$TMPDIR/kd-a2-r1.json")"
sleep 11
kdcall -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}"
kdcall -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$SUCCESSOR\"}"
kdcall -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW1\",\"deviceLabel\":\"smoke-phone\"}"
ACCESS="$(kdget accessToken)" && REFRESH="$(kdget refreshToken)"; echo "exit=$?"
```

Expected:

- Both first refreshes answer `status=200`, and the check prints `successor issued: true | same successor: true` (the grace window returns the same successor). `successor issued: false` means the first refresh failed: stop.
- After 11 seconds, the old token answers `HTTP/1.1 401`, `"code":"UNAUTHENTICATED"` (reuse: the family is revoked), and the successor answers `401 UNAUTHENTICATED` too.
- The new login answers `200` and `exit=0`.

Result (pass / fail): **pass**

```text
status=200
status=200
successor issued: true | same successor: true
HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 200 OK
{"accessToken":"***","refreshToken":"***","expiresIn":899,"user":{"id":"01a1b455-1369-7810-81e3-a9f4ae0bd52b",...}}
exit=0
```

Notes: block 2 was skipped in the second pass and run in a third pass (04:50 UTC), long after the grace window; the old token and its successor were both refused (family revoked on reuse).

## Step 9. Password reset

**This step has two blocks; run both.** Block 1 of 2:

```bash
echo "mails before: $(kdmails)"
kdcall -X POST "$API/auth/password/forgot" -H 'Content-Type: application/json' -d '{"email":"ana.smoke@example.com"}'
kdcall -X POST "$API/auth/password/forgot" -H 'Content-Type: application/json' -d '{"email":"nobody.smoke@example.com"}'
sleep 3
echo "mails after: $(kdmails)"
CODE="$(kdcode)"; echo "exit=$?"
WRONG=000000; [ "$CODE" = 000000 ] && WRONG=111111
for i in 1 2 3 4 5; do curl -sS -X POST "$API/auth/password/reset" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"code\":\"$WRONG\",\"newPassword\":\"$PW2\"}" -w "  status=%{http_code}\n"; done
kdcall -X POST "$API/auth/password/reset" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"code\":\"$CODE\",\"newPassword\":\"$PW2\"}"
```

Expected:

- Both `forgot` calls answer `HTTP/1.1 202` with no body (the same answer for a known and an unknown email); `mails after` is `mails before` plus 1, and `kdcode` prints `to ana.smoke@example.com | ...`.
- Five `CODE_INVALID` answers with `status=400`, then the right code answers `HTTP/1.1 400`, `"code":"CODE_INVALID"` (the code is dead after 5 attempts).

Block 2 of 2: a new code (at least 60 seconds after the first `forgot`: one code per minute per user and type), then the reset. Step 10 needs `PW2` to be the password, so this block must run before it:

```bash
OLD_ACCESS="$ACCESS"
OLD_REFRESH="$REFRESH"
sleep 60
kdcall -X POST "$API/auth/password/forgot" -H 'Content-Type: application/json' -d '{"email":"ana.smoke@example.com"}'
sleep 3
CODE="$(kdcode)"; echo "exit=$?"
kdcall -X POST "$API/auth/password/reset" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"code\":\"$CODE\",\"newPassword\":\"$PW2\"}"
kdcall -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$OLD_REFRESH\"}"
kdcall "$API/me" -H "Authorization: Bearer $OLD_ACCESS"
kdcall -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW1\"}"
kdcall -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW2\",\"deviceLabel\":\"smoke-phone\"}"
ACCESS="$(kdget accessToken)" && REFRESH="$(kdget refreshToken)"; echo "exit=$?"
```

Expected:

- The new `forgot` answers `202` and `kdcode` reads a new code; the reset with it answers `HTTP/1.1 204`.
- The old refresh token answers `401 UNAUTHENTICATED`: a completed reset revokes every refresh-token family (ADR-0003).
- **The old access token still answers `200` on `GET /me` until it expires (at most 15 minutes after it was issued).** This is by design: access tokens are verified without a database read (ADR-0003; `AuthGuard`), so a revocation takes effect at the next refresh. A `401` here is also acceptable if the token was issued more than 15 minutes ago; write which one you saw.
- Login with `PW1` answers `HTTP/1.1 401`, `"code":"INVALID_CREDENTIALS"`; login with `PW2` answers `200` and `exit=0`.

Result (pass / fail): **pass**

```text
mails before: 1
HTTP/1.1 202 Accepted

HTTP/1.1 202 Accepted

mails after: 2
kdcode: to ana.smoke@example.com | Mã đặt lại mật khẩu của bạn | mailbox total 2
exit=0
{"type":"about:blank","title":"Bad Request","status":400,"code":"CODE_INVALID"}  status=400
(4 more identical lines)
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"CODE_INVALID"}
HTTP/1.1 202 Accepted

kdcode: to ana.smoke@example.com | Mã đặt lại mật khẩu của bạn | mailbox total 3
exit=0
HTTP/1.1 204 No Content

HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 200 OK
{"id":"01a1b455-1369-7810-81e3-a9f4ae0bd52b","email":"ana.smoke@example.com",...}
HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}
HTTP/1.1 200 OK
{"accessToken":"***","refreshToken":"***","expiresIn":899,"user":{...}}
exit=0
```

Notes: block 2 ran in the third pass. The unknown email sent no mail (mailbox 1 → 2 for two `forgot` calls). The old access token still answered `200` on `GET /me` (issued about a minute earlier), as designed: access tokens are not revoked before they expire; the old refresh token was refused.

## Step 10. Sessions, password change and sign-out everywhere

**This step has two blocks; run both.** It needs block 2 of steps 8 and 9 first. Block 1 of 2: session A is the login that closed step 9. Open session B, list, then change the password from A:

```bash
ACCESS_A="$ACCESS"
REFRESH_A="$REFRESH"
kdcall -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW2\",\"deviceLabel\":\"smoke-tablet\"}"
REFRESH_B="$(kdget refreshToken)"; echo "exit=$?"
kdcall "$API/me/sessions" -H "Authorization: Bearer $ACCESS_A"
kdcall -X POST "$API/me/password" -H "Authorization: Bearer $ACCESS_A" -H 'Content-Type: application/json' -d "{\"currentPassword\":\"$PW2\",\"newPassword\":\"$PW3\"}"
kdcall -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_B\"}"
kdcall -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_A\"}"
ACCESS_A="$(kdget accessToken)" && REFRESH_A="$(kdget refreshToken)"; echo "exit=$?"
```

Expected: `GET /me/sessions` answers `200` with `items` holding `smoke-phone` (`"isCurrent":true`) and `smoke-tablet`, `total` 2 (families revoked in steps 8 and 9 are not listed). `POST /me/password` answers `204`; session B's refresh token then answers `401 UNAUTHENTICATED`; session A's refreshes with `200` (the current session is kept) and the last `exit=0`.

Block 2 of 2: revoke one other session by id, then sign out everywhere:

```bash
kdcall -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW3\",\"deviceLabel\":\"smoke-laptop\"}"
REFRESH_C="$(kdget refreshToken)"; echo "exit=$?"
kdcall "$API/me/sessions" -H "Authorization: Bearer $ACCESS_A"
FAMILY_C="$(node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const s = (r.items ?? []).find((i) => i.deviceLabel === "smoke-laptop"); if (!s) { console.error("no smoke-laptop session"); process.exit(1); } console.log(s.id)' "$KD_BODY")"; echo "exit=$?"
kdcall -X DELETE "$API/me/sessions/$FAMILY_C" -H "Authorization: Bearer $ACCESS_A"
kdcall -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_C\"}"
kdcall -X POST "$API/auth/logout-all" -H "Authorization: Bearer $ACCESS_A"
kdcall -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_A\"}"
kdcall -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"ana.smoke@example.com\",\"password\":\"$PW3\",\"deviceLabel\":\"smoke-phone\"}"
ACCESS="$(kdget accessToken)"; echo "exit=$?"
```

Expected: the list shows `smoke-phone` (current) and `smoke-laptop`; `DELETE /me/sessions/{id}` answers `204` and session C's refresh then answers `401 UNAUTHENTICATED`; `logout-all` answers `204` and session A's refresh then answers `401 UNAUTHENTICATED`; the last login answers `200` and `exit=0` (its access token is used in step 11). As in step 9, revoked sessions keep their access tokens until they expire.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","refreshToken":"***",...}
exit=0
HTTP/1.1 200 OK
{"items":[{"id":"01a1b459-d492-745c-bd01-5cfc243c7d55","deviceLabel":"smoke-tablet",...,"isCurrent":false},{"id":"01a1b459-608e-7719-afb4-5459c7cf15a5","deviceLabel":"smoke-phone",...,"isCurrent":true}],"page":1,"pageSize":20,"total":2}
HTTP/1.1 204 No Content

HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 200 OK
{"accessToken":"***","refreshToken":"***",...}
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","refreshToken":"***",...}
exit=0
HTTP/1.1 200 OK
{"items":[{"id":"01a1b459-ee26-76a7-9886-b0ca457c0b38","deviceLabel":"smoke-laptop",...,"isCurrent":false},{"id":"01a1b459-608e-7719-afb4-5459c7cf15a5","deviceLabel":"smoke-phone",...,"isCurrent":true}],"page":1,"pageSize":20,"total":2}
exit=0
HTTP/1.1 204 No Content

HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 204 No Content

HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 200 OK
{"accessToken":"***","refreshToken":"***",...}
exit=0
```

Notes: run in the third pass, after block 2 of steps 8 and 9. Session A kept its family id (`01a1b459-608e-...`) across the refresh after the password change. An earlier run, made with block 2 of steps 8 and 9 skipped, signed in with `PW2` while the password was still `PW1` and failed in chain (`INVALID_CREDENTIALS`); its outputs are discarded.

## Step 11. Address book

```bash
WARD_79="$(curl -sS "$API/wards?provinceCode=79" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s)[0].code))')"
WARD_01="$(curl -sS "$API/wards?provinceCode=01" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s)[0].code))')"
echo "WARD_79=$WARD_79 WARD_01=$WARD_01"
kdcall -X POST "$API/me/addresses" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"label\":\"Nhà\",\"recipientName\":\"Ana Smoke\",\"phone\":\"0901234567\",\"addressLine\":\"1 Đường Mẫu\",\"provinceCode\":\"79\",\"wardCode\":\"$WARD_79\",\"location\":{\"lat\":10.7769,\"lng\":106.7009},\"isDefault\":true}"
ADDR_1="$(kdget id)"; echo "exit=$?"
kdcall -X POST "$API/me/addresses" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"label\":\"Công ty\",\"recipientName\":\"Ana Smoke\",\"phone\":\"0901234567\",\"addressLine\":\"2 Đường Mẫu\",\"provinceCode\":\"79\",\"wardCode\":\"$WARD_79\",\"location\":{\"lat\":10.78,\"lng\":106.7}}"
ADDR_2="$(kdget id)"; echo "exit=$?"
kdcall -X PATCH "$API/me/addresses/$ADDR_2" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"isDefault":true}'
kdcall "$API/me/addresses/$ADDR_1" -H "Authorization: Bearer $ACCESS"
kdcall -X PATCH "$API/me/addresses/$ADDR_1" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"deliveryNote":"Gọi trước khi giao"}'
kdcall "$API/me/addresses?pageSize=1" -H "Authorization: Bearer $ACCESS"
kdcall -X DELETE "$API/me/addresses/$ADDR_1" -H "Authorization: Bearer $ACCESS"
kdcall "$API/me/addresses/$ADDR_1" -H "Authorization: Bearer $ACCESS"
kdcall -X POST "$API/me/addresses" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"label\":\"Sai phường\",\"recipientName\":\"Ana Smoke\",\"phone\":\"0901234567\",\"addressLine\":\"3 Đường Mẫu\",\"provinceCode\":\"79\",\"wardCode\":\"$WARD_01\",\"location\":{\"lat\":10.77,\"lng\":106.7}}"
```

Expected:

- The ward codes print as in step 4 (`27316` and `09877` in this run).
- Both creates answer `HTTP/1.1 201`; the first has `"isDefault":true`, the phone as `+84901234567`; the second `"isDefault":false`; both `exit=0`.
- The `PATCH` of the second to `isDefault: true` answers `200` with `"isDefault":true`, and the first then reads `"isDefault":false`.
- The note `PATCH` answers `200` with `"deliveryNote":"Gọi trước khi giao"`.
- `GET ?pageSize=1` answers `200` with one item (the default, the second address), `"page":1`, `"pageSize":1`, `"total":2`.
- `DELETE` answers `204`; reading the deleted address answers `404`, `"code":"NOT_FOUND"`.
- A ward of province 01 with `provinceCode` 79 answers `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, with the field error `NOT_FOUND` on `wardCode`.

Result (pass / fail): **pass**

```text
WARD_79=27316 WARD_01=09877
HTTP/1.1 201 Created
{"id":"01a1b455-ec72-75dc-aba7-7d2fa437d981","label":"Nhà",...,"phone":"+84901234567",...,"isDefault":true,...}
exit=0
HTTP/1.1 201 Created
{"id":"01a1b455-ecb3-70cf-b37b-156327359ab7","label":"Công ty",...,"isDefault":false,...}
exit=0
HTTP/1.1 200 OK
{"id":"01a1b455-ecb3-70cf-b37b-156327359ab7",...,"isDefault":true,...}
HTTP/1.1 200 OK
{"id":"01a1b455-ec72-75dc-aba7-7d2fa437d981",...,"deliveryNote":null,"isDefault":false,...}
HTTP/1.1 200 OK
{"id":"01a1b455-ec72-75dc-aba7-7d2fa437d981",...,"deliveryNote":"Gọi trước khi giao","isDefault":false,...}
HTTP/1.1 200 OK
{"items":[{"id":"01a1b455-ecb3-70cf-b37b-156327359ab7","label":"Công ty",...,"isDefault":true,...}],"page":1,"pageSize":1,"total":2}
HTTP/1.1 204 No Content

HTTP/1.1 404 Not Found
{"type":"about:blank","title":"Not Found","status":404,"code":"NOT_FOUND"}
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"wardCode","code":"NOT_FOUND","message":"does not exist in this province"}]}
```

Notes: run with the access token of step 7 (before step 10 was complete); the result does not depend on it. Bodies shortened with `...`.

## Step 12. Log hygiene

Run in terminal 1 while the shell variables of the earlier steps still hold their values. Every one of them must be non-empty (an empty value matches every line); the first line prints nothing when all are set:

```bash
for v in PW1 PW2 PW3 CODE OLD_REFRESH REFRESH_A REFRESH_B REFRESH_C SUCCESSOR ACCESS; do [ -n "${(P)v}" ] || echo "empty: $v"; done
for v in "$PW1" "$PW2" "$PW3" "$CODE" "$OLD_REFRESH" "$REFRESH_A" "$REFRESH_B" "$REFRESH_C" "$SUCCESSOR" "$ACCESS"; do grep -cF -- "$v" "$TMPDIR/kd-api-a2.log"; done
grep -oE '"?(lat|lng|latitude|longitude)"?[:=]"?-?[0-9]+(\.[0-9]+)?' "$TMPDIR/kd-api-a2.log" | sort | uniq -c
grep -cE 'ana\.smoke@example\.com' "$TMPDIR/kd-api-a2.log"
```

Expected:

- Ten lines of `0`: no password, code, refresh token or access token value in the log. A 6-digit code can match an unrelated number (a timestamp or a duration); if `$CODE` counts more than 0, run `grep -F -- "$CODE" "$TMPDIR/kd-api-a2.log"`, check that every hit is unrelated, and say so in "Notes" (paste the hits with the code replaced by `***`).
- Coordinates: no output, or only values with at most two decimals (the address bodies are never logged; query parameters are rounded).
- The email count is `0` (the auth log lines carry the user id only). Write any other count in "Notes".

The log covers the run since the restart of the API in step 3.

Result (pass / fail): **pass**

```text
0
0
0
0
0
0
0
0
0
0
(no coordinate line)
0
```

Notes: re-run after step 10: no variable empty, every count `0`, no coordinate, email count `0`. A first run before step 10 printed `98` for the three variables still empty (an empty pattern matches every line), not a leak.

## Step 13. Social sign-in

Not exercised here: `POST /auth/social/google`, `/auth/social/apple` and `/me/identities/{provider}` need ID tokens signed by Google or Apple, which the smoke run does not have. With no `GOOGLE_CLIENT_IDS` or `APPLE_CLIENT_IDS` in the root `.env`, both providers are off and their sign-in routes answer `404 NOT_FOUND`. The flows are covered by `test/integration/social.int-spec.ts` (step 2) with the test verifier; the live check with real tokens is left to the mobile track.

```bash
kdcall -X POST "$API/auth/social/nonce"
kdcall -X POST "$API/auth/social/google" -H 'Content-Type: application/json' -d '{"idToken":"not-a-token","nonce":"not-a-nonce"}'
```

Expected: the nonce answers `HTTP/1.1 200` with `nonce` and `expiresAt` five minutes ahead; the Google sign-in answers `HTTP/1.1 404`, `"code":"NOT_FOUND"` (provider not configured). If the root `.env` sets `GOOGLE_CLIENT_IDS`, the second call answers `401 UNAUTHENTICATED` instead; write which one you saw.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"nonce":"***","expiresAt":"2026-11-07T04:53:25.463Z"}
HTTP/1.1 404 Not Found
{"type":"about:blank","title":"Not Found","status":404,"code":"NOT_FOUND"}
```

Notes: covered by the integration suite only; no real provider token was available. The root `.env` sets no social client id, so Google answers `NOT_FOUND`.

## Step 14. Contract check and stop

```bash
pnpm openapi:check; echo "exit=$?"
```

Then stop the API in terminal 2 with Ctrl-C and confirm that nothing listens on 3001:

```bash
lsof -nP -sTCP:LISTEN -iTCP:3001; echo "exit=$?"
```

Only if you want the stack stopped: `pnpm dev:infra:down; echo "exit=$?"` (volumes are kept).

Expected: `openapi:check` reports `openapi.json` and `src/generated/openapi.ts` up to date and exits 0; `lsof` prints nothing (`exit=1`).

Result (pass / fail): **pass**

```text
$ turbo run @kd/api#openapi:check @kd/contracts#client:check --concurrency=2 && pnpm openapi:breaking
@kd/contracts:client:check: client:check: <repo>/packages/contracts/src/generated/openapi.ts is up to date
@kd/api:openapi:check: openapi:check: <repo>/packages/contracts/openapi.json is up to date
 Tasks:    4 successful, 4 total
$ scripts/openapi-breaking.sh
breaking-change check inactive: no released snapshot yet (packages/contracts/openapi.released.json)
exit=0
(API stopped with Ctrl-C in terminal 2)
exit=1
```

Notes: `lsof` printed nothing; the stack was left running.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes, over three passes (see "Run log"): the first two passes were run-order problems of the sheet, not API faults |
| Failed or skipped steps | none in the final pass; social sign-in (step 13) checked only as "provider off" (`404`), the flows by the integration suite |
| Consent document ids of step 3 | Terms `01a1b454-ba97-7e3c-ad16-50637efb1fa2`, Privacy `01a1b454-ba9e-7028-a589-a968e0614248` (`smoke-a2`, `vi`, kept in `kd_dev`) |
| Follow-up tasks opened | (1) A4-T5 seeds the real consent documents with a `published_at` later than the `smoke-a2` rows, or `kd_dev` is reset first; (2) add `*.nonce` to the log redaction list (decision 0008, Consequences; noted at A2-T6): done in A2-T8 (D-074); (3) live Google and Apple sign-in with real tokens, mobile track |
| Owner | |
| Date | 2026-11-07 |

Phase A2 gate: run the review prompt.
