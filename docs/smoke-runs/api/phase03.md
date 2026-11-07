# Phase A3 smoke run: staff access

Owner checklist for task A3-T7. It runs the staff-access slice of Phase A3 (A3-T1 to A3-T6) on the host against the local stack: the invitation link and password set, the staff sign-in with TOTP enrolment and the second step, the `kd_refresh` cookie with its CSRF checks, staff creation, the staff lockout, the admin user management under `/admin/users`, the step-up, both test suites, audit and log hygiene, and the contract check.

**Scope:** step 1 writes to the local `kd_dev` database (one `INVITED` admin and two throw-away branches `SA` and `SB`); steps 2 to 8 create the fictional staff accounts `owner.smoke@kitchendaylight.example` (ADMIN), `staff.smoke@kitchendaylight.example` (STAFF on `SA`) and `manager.smoke@kitchendaylight.example` (MANAGER on `SB`) and their rows; step 7 reads the phase 02 customer `ana.smoke@example.com`. No step changes a committed file and no step deletes data. The only long-running process is the API started in step 0 (`pnpm --filter @kd/api start`, no watcher), stopped with Ctrl-C in step 11.

## How to run

- Run one step at a time, from the repository root, in order, in **terminal 1**. The API runs in **terminal 2** (step 0). Shell variables and helper functions set in terminal 1 are reused by later steps, so keep the same terminal open from start to finish.
- **Each command block can be pasted whole**, except the one-line `read` blocks: paste those alone, then type the 6-digit code shown by the authenticator app and press Enter. Run the block that follows a `read` at once (a code is valid for about 30 to 60 seconds). A helper that finds nothing prints `kdget: ...` or `kdlink: ...` on stderr and the following `echo "exit=$?"` shows a non-zero code: stop there.
- Paste the output into the empty block of the step and fill in the result. Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Secrets are never pasted into this sheet.** `kdcall` already prints `***` in place of `accessToken`, `refreshToken`, `mfaToken`, `stepUpToken`, `secret`, `otpauthUri`, `recoveryCodes`, `token` and `password`, and `kdcookie` prints the cookie value as `***`. The blocks marked **not pasted** print the authenticator-app secret and the recovery codes to the terminal so that you can save them: never paste their output, write "saved" instead. Replace the 6-digit codes you type with `***`. Never paste a password or the content of `.env`; the only lines this sheet reads from it are `MAIL_UI_URL` and `ADMIN_ORIGINS` (step 0) and `DATABASE_URL_MIGRATOR` (step 1), and only `ADMIN_ORIGINS` (not a secret) is printed. `pnpm dev:infra` prints the `print-env.sh` block: replace it with `(print-env.sh output, passwords as ***)`. Replace home paths with `<repo>`.
- Use Node 26.13.0 (`nvm use` once in each terminal).
- The command blocks hold no comment lines and no angle-bracket placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- **Passwords:** `PW_ADMIN`, `PW_STAFF`, `PW_STAFF2` and `PW_MANAGER` (step 0) are throw-away values in the `CHANGE_ME_LOCAL` style, at least 12 characters (the staff minimum, decision 0008 section 4). Replace them with your own values of 12 to 128 characters if you like; the values as written also work.
- **Authenticator app:** steps 3 and 7 enrol two entries (the owner admin and the manager) by typing the setup key by hand ("Enter a setup key", time based). They are throw-away entries for `kd_dev`: delete them from the app after the sign-off.
- **Throttling:** the per-IP limits of decision 0008 section 7 hold in the API process; the staff sign-in group (`/admin/auth/login`, `/admin/auth/mfa/verify`, `/admin/auth/step-up`) allows only 10 per 5 minutes. Steps 6 and 7 start with a restart of the API so that their sign-ins start from empty counters. If any step answers `429 RATE_LIMITED`, restart the API and repeat the step. **Restart** means: Ctrl-C in terminal 2, then the same `start` command (it appends to the same log).
- **Admin calls** carry an `Origin` from `ADMIN_ORIGINS` and `X-Client: admin-web` (the CSRF check of decision 0008 section 10, required on every `POST /admin/auth/*`); `kdadm` adds both. The refresh token travels only in the `kd_refresh` cookie (`Path=/api/v1/admin/auth`), kept in one curl cookie jar per person (`-c` writes, `-b` sends).
- **Resuming in a new terminal 1:** run the second block of step 0 (variables and helpers) and the first two lines of step 1 (`KD_SQL_URL`, `kdsql`) and its last block (branch ids) first; later steps also need the ids and tokens of the earlier steps, so a resumed run restarts at the beginning of a step and re-signs in where the step says so.
- Exit codes: commands other than `curl` are followed by `echo "exit=$?"`.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-07 (10:51 to 11:00 UTC) |
| Machine / OS / chip / RAM | Owner's MacBook, macOS (Darwin 25.6.0) |
| Monorepo commit (`git rev-parse --short HEAD`) | `6591f9b`, plus this uncommitted sheet |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | `f9654b1` |
| Node / pnpm (`node --version`, `pnpm --version`) | v26.13.0 (`nvm use`) / 12.16.1 |

**Run log:** run by the coding agent on the owner's request (2026-11-07), one pass. Deviations from the sheet as written: (1) the TOTP codes were generated from the setup key with the `otpauth` package of `apps/api` instead of an authenticator app (no phone in the loop; the setup keys and recovery codes stayed in a session-only scratch file, deleted after the run, and are not in this sheet); (2) the API ran as a background process with its output appended to `$TMPDIR/kd-api-a3.log`, and each "restart" was a SIGINT to the process on 3001 followed by the same `start` command; (3) step 0 first failed on `grep -c '^ADMIN_ORIGINS=' .env` (`0`): `ADMIN_ORIGINS` is optional in `dev` (the API defaults to `http://localhost:4200`) and `env:sync` never writes it, so the sheet was corrected before going on (step 0 now checks `JWT_PRIVATE_KEY` and falls back to the default origin); (4) step 9's default reporter prints only the totals when not attached to a terminal, so the two named specs were re-run alone with `--reporter=verbose` (now part of step 9).

## Step 0. Stack, `.env`, build, migrations and the API

Terminal 1:

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
grep -c '^JWT_PRIVATE_KEY=' .env; echo "exit=$?"
grep -c '^MFA_ENCRYPTION_KEY=' .env; echo "exit=$?"
pnpm --filter "@kd/api..." build; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
```

If either count is `0`, the root `.env` lacks the auth block: run `pnpm env:sync; echo "exit=$?"` (or `scripts/env-sync.sh --force` if it exits 3 because `.env` exists; the monorepo block is kept) and say so in "Notes".

Terminal 2 (stays open until step 11; `tee -a` keeps the log across the restarts of steps 6 and 7):

```bash
nvm use
: > "$TMPDIR/kd-api-a3.log"
pnpm --filter @kd/api start 2>&1 | tee -a "$TMPDIR/kd-api-a3.log"
```

Terminal 1, the variables and helpers used by every later step:

```bash
curl -sS -i http://127.0.0.1:3001/api/health; echo
API=http://127.0.0.1:3001/api/v1
MAIL_UI_URL="$(grep '^MAIL_UI_URL=' .env | cut -d= -f2- | tr -d '"')"
ORIGIN="$(grep '^ADMIN_ORIGINS=' .env | cut -d= -f2- | tr -d '"' | cut -d, -f1)"
ORIGIN="${ORIGIN:-http://localhost:4200}"
echo "ORIGIN=$ORIGIN"
PW_ADMIN='CHANGE_ME_LOCAL_a3_admin_pw'
PW_STAFF='CHANGE_ME_LOCAL_a3_staff_pw'
PW_STAFF2='CHANGE_ME_LOCAL_a3_staff_pw_two'
PW_MANAGER='CHANGE_ME_LOCAL_a3_manager_pw'
E_ADMIN=owner.smoke@kitchendaylight.example
E_STAFF=staff.smoke@kitchendaylight.example
E_MANAGER=manager.smoke@kitchendaylight.example
KD_HEAD="$TMPDIR/kd-a3-head.txt"
KD_BODY="$TMPDIR/kd-a3-body.json"
JAR_ADMIN="$TMPDIR/kd-a3-admin.jar"
JAR_STAFF="$TMPDIR/kd-a3-staff.jar"
JAR_MANAGER="$TMPDIR/kd-a3-manager.jar"
: > "$JAR_ADMIN"; : > "$JAR_STAFF"; : > "$JAR_MANAGER"
kdshow() { node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); if (t.trim() === "") { console.log(""); process.exit(0); } let v; try { v = JSON.parse(t); } catch { console.log(t); process.exit(0); } const hide = new Set(["accessToken", "refreshToken", "mfaToken", "stepUpToken", "secret", "otpauthUri", "recoveryCodes", "token", "password"]); const m = (x) => Array.isArray(x) ? x.map(m) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, hide.has(k) ? (Array.isArray(y) ? "*** (" + y.length + ")" : "***") : m(y)])) : x; console.log(JSON.stringify(m(v)))' "$KD_BODY"; }
kdq() { curl -sS -D "$KD_HEAD" -o "$KD_BODY" "$@"; head -n 1 "$KD_HEAD"; }
kdcall() { kdq "$@"; kdshow; }
kdadm() { kdcall -H "Origin: $ORIGIN" -H 'X-Client: admin-web' "$@"; }
kdget() { node -e 'const v = process.argv[2].split(".").reduce((o, k) => (o == null ? undefined : o[k]), JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))); if (typeof v !== "string" || v === "") { console.error("kdget: no " + process.argv[2] + " in the last body"); process.exit(1); } console.log(v)' "$KD_BODY" "$1"; }
kdcookie() { grep -i '^set-cookie:' "$KD_HEAD" | sed -E 's/(kd_refresh=)[^;]+/\1***/'; }
kdjar() { awk -F'\t' '$6 == "kd_refresh" { print $7 }' "$1"; }
kdlink() { node --input-type=module -e 'const [base, to] = process.argv.slice(1); const list = await (await fetch(base + "/api/v1/messages?limit=100")).json(); const m = list.messages.find((x) => (x.To ?? []).some((t) => t.Address.toLowerCase() === to.toLowerCase())); if (!m) { console.error("kdlink: no message to " + to); process.exit(1); } const full = await (await fetch(base + "/api/v1/message/" + m.ID)).json(); console.error("kdlink: to " + to + " | " + full.Subject); const hit = ((full.Text ?? "") + " " + (full.HTML ?? "")).match(/#token=([A-Za-z0-9_-]+)/); if (!hit) { console.error("kdlink: no #token= in the message"); process.exit(1); } console.log(hit[1])' "$MAIL_UI_URL" "$1"; }
kdmailsto() { node --input-type=module -e 'const [base, to] = process.argv.slice(1); const list = await (await fetch(base + "/api/v1/messages?limit=200")).json(); const mine = list.messages.filter((x) => (x.To ?? []).some((t) => t.Address.toLowerCase() === to.toLowerCase())); console.log(to + ": " + mine.length + " message(s), newest: " + (mine[0] ? mine[0].Subject : "none"))' "$MAIL_UI_URL" "$1"; }
kdfail() { curl -sS -X POST "$API/admin/auth/login" -H "Origin: $ORIGIN" -H 'X-Client: admin-web' -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" -w '\nstatus=%{http_code}\n'; }
kdstaff() { node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("total " + r.total + " | activeAdminsWithMfa " + r.activeAdminsWithMfa); for (const u of r.items ?? []) console.log(u.email, u.role, u.status, JSON.stringify(u.mfa), (u.branches ?? []).map((b) => b.code).join(","))' "$KD_BODY"; }
```

- `kdcall` runs `curl` with the given arguments, saves the headers and the body, and prints the status line and the body with every secret field as `***`. `kdq` prints the status line only. `kdadm` is `kdcall` with the `Origin` and `X-Client: admin-web` headers.
- `kdget PATH` prints the string field `PATH` of the last body (`mfaToken`, `session.accessToken`, `user.id`).
- `kdcookie` prints the `Set-Cookie` header of the last response with the value as `***`. `kdjar JAR` prints the `kd_refresh` value held in a cookie jar (used in variables, never printed).
- `kdlink EMAIL` reads the newest Mailpit message to `EMAIL`, prints its subject on stderr, and prints the token of its `#token=` link. `kdmailsto EMAIL` prints how many messages `EMAIL` has and the newest subject.
- `kdfail EMAIL PASSWORD` sends one staff login and prints the body and `status=`; it is used only for refused logins (step 6).
- `kdstaff` prints one line per account of the last `GET /admin/users` body.

Expected: every service healthy; both `grep -c` print `1`; the build exits 0; `migrate` prints `migrate: nothing to apply` (Phase A3 adds no migration) and `exit=0`; the API logs that it listens on 3001; `GET /api/health` answers `HTTP/1.1 200`; `ORIGIN=` shows one `http://` origin: the first entry of `ADMIN_ORIGINS`, or `http://localhost:4200` when the root `.env` does not set it (the API's `dev` default, `DEFAULT_ADMIN_ORIGINS`; `env:sync` never writes this name, `.env.example`). The other lines print nothing.

Result (pass / fail): **pass**

```text
Now using node v26.13.0
$ scripts/dev-infra.sh up
 ✔ Container kd-docker-s3-1        Healthy
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
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
HTTP/1.1 200 OK
X-Request-Id: 32522bff-2a76-43e9-a2ef-bd5c9c04c26d
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42
{"status":"ok","checks":{"database":"up"}}
ORIGIN=http://localhost:4200
```

Notes: the root `.env` sets no `ADMIN_ORIGINS`, so the API uses its `dev` default `http://localhost:4200` (see "Run log", item 3). The auth block was present; `env:sync` was not run.

## Step 1. One `INVITED` admin and two throw-away branches

`kdsql` runs `psql` inside the Postgres container as `kd_migrator`, with the URL of the root `.env` rewritten to the container port (5432), as in the phase 02 sheet. The URL is never printed. If you use your own `psql` connection as the migration role instead, run the same SQL there and never paste the connection URL.

The columns are those of migrations `0007_users_branches_staff.sql` and `0009_geography.sql`: `users` needs `email`, `display_name`, `locale`, `role` and `status` (no password: `INVITED`, decision 0008 section 6); `branches` needs every `NOT NULL` column without a default, with `code` of 2 to 4 capitals, `phone` in E.164, `location` a point, the reservation figures inside their checks, and `province_code` an existing province (here the lowest code of `provinces`, loaded by the phase 02 reference seed). `ON CONFLICT DO NOTHING` makes a second run insert nothing.

```bash
KD_SQL_URL="$(grep '^DATABASE_URL_MIGRATOR=' .env | cut -d= -f2-)"
kdsql() { docker exec -i kd-docker-postgres-1 psql "${KD_SQL_URL/127.0.0.1:5452/127.0.0.1:5432}" -v ON_ERROR_STOP=1 -X "$@"; }
kdsql -At -c 'SELECT count(*), min(code) FROM public.provinces'; echo "exit=$?"
kdsql -At <<'SQL'
INSERT INTO public.users (email, display_name, locale, role, status)
VALUES ('owner.smoke@kitchendaylight.example', 'Owner Smoke', 'vi', 'ADMIN', 'INVITED')
ON CONFLICT DO NOTHING
RETURNING email, role, status;
INSERT INTO public.branches (
  code, slug, name, address_line, province_code, location, phone, status,
  accepts_pickup, accepts_delivery, accepts_reservations,
  default_prep_minutes, order_cutoff_minutes,
  reservation_slot_step_minutes, reservation_max_party, reservation_lead_minutes,
  reservation_max_days_ahead, sort_order
)
VALUES
  ('SA', 'smoke-a3-sa', 'Smoke A3 SA', '1 Smoke Street', (SELECT min(code) FROM public.provinces),
   'SRID=4326;POINT(106.7009 10.7769)', '+84900000101', 'ACTIVE',
   true, false, false, 15, 30, 30, 8, 60, 30, 901),
  ('SB', 'smoke-a3-sb', 'Smoke A3 SB', '2 Smoke Street', (SELECT min(code) FROM public.provinces),
   'SRID=4326;POINT(106.7100 10.7800)', '+84900000102', 'ACTIVE',
   true, false, false, 15, 30, 30, 8, 60, 30, 902)
ON CONFLICT DO NOTHING
RETURNING code, id, province_code;
SQL
echo "exit=$?"
```

Set the branch ids (this block only reads; run it again whenever a new terminal resumes the sheet):

```bash
BRANCH_SA="$(kdsql -At -c "SELECT id FROM public.branches WHERE code = 'SA'")"
BRANCH_SB="$(kdsql -At -c "SELECT id FROM public.branches WHERE code = 'SB'")"
echo "BRANCH_SA=$BRANCH_SA BRANCH_SB=$BRANCH_SB"
kdsql -At -c "SELECT email, role, status, password_hash IS NULL FROM public.users WHERE email = 'owner.smoke@kitchendaylight.example'"; echo "exit=$?"
```

Expected:

- The province query prints `34|01` (or the count and lowest code of your `provinces`); a count of `0` means the reference seed of phase 02 step 3 was not run: stop.
- The insert prints `owner.smoke@kitchendaylight.example|ADMIN|INVITED`, then `SA|...|01` and `SB|...|01` with two UUIDs (psql may also print `INSERT 0 1` and `INSERT 0 2`), and `exit=0`. A second run prints only `INSERT 0 0` lines.
- The last block prints the same two UUIDs and `owner.smoke@kitchendaylight.example|ADMIN|INVITED|t`.

Result (pass / fail): **pass**

```text
34|01
exit=0
owner.smoke@kitchendaylight.example|ADMIN|INVITED
INSERT 0 1
SA|01a1b5a2-9764-7b0c-91aa-b34451be9034|01
SB|01a1b5a2-976a-70bd-9f58-e8453bff462f|01
INSERT 0 2
exit=0
BRANCH_SA=01a1b5a2-9764-7b0c-91aa-b34451be9034 BRANCH_SB=01a1b5a2-976a-70bd-9f58-e8453bff462f
owner.smoke@kitchendaylight.example|ADMIN|INVITED|t
exit=0
```

Notes (write both branch ids): `SA` `01a1b5a2-9764-7b0c-91aa-b34451be9034`, `SB` `01a1b5a2-976a-70bd-9f58-e8453bff462f` (province `01`; both stay in `kd_dev`).

## Step 2. Invitation link and password set

```bash
kdmailsto "$E_ADMIN"
kdadm -X POST "$API/admin/auth/password/forgot" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\"}"
sleep 3
kdmailsto "$E_ADMIN"
LINK_ADMIN="$(kdlink "$E_ADMIN")"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_ADMIN\",\"password\":\"CHANGE_ME\"}"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_ADMIN\",\"password\":\"$PW_ADMIN\"}"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_ADMIN\",\"password\":\"$PW_ADMIN\"}"
kdsql -At -c "SELECT status, password_hash IS NOT NULL FROM public.users WHERE email = 'owner.smoke@kitchendaylight.example'"; echo "exit=$?"
```

Expected:

- `forgot` answers `HTTP/1.1 202` with no body: the account is `INVITED`, so it receives a fresh invitation (the same `202` answers an unknown email, decision 0008 section 5). The mailbox count of `owner.smoke@...` grows by 1, and `kdlink` prints the invitation subject and `exit=0`.
- The 9-character password answers `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, with an error on `password` (staff minimum 12).
- The valid password answers `HTTP/1.1 204`; the same token again answers `HTTP/1.1 400`, `"code":"CODE_INVALID"` (single use).
- The query prints `ACTIVE|t`.

Result (pass / fail): **pass**

```text
owner.smoke@kitchendaylight.example: 0 message(s), newest: none
HTTP/1.1 202 Accepted

owner.smoke@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
kdlink: to owner.smoke@kitchendaylight.example | Lời mời tham gia trang quản trị Kitchen Daylight
exit=0
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"password","code":"TOO_SHORT","message":"must be at least 12 characters"}]}
HTTP/1.1 204 No Content

HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"CODE_INVALID"}
ACTIVE|t
exit=0
```

Notes: `forgot` answers `202`, not `204` (the controller's `@HttpCode(ACCEPTED)`, decision 0008 section 5); the task text said `204`.

## Step 3. First sign-in: `MFA_REQUIRED`, TOTP enrolment, the cookie

Block 1 of 4, the password step and the setup:

```bash
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\",\"password\":\"$PW_ADMIN\",\"deviceLabel\":\"smoke-admin\"}"
kdcookie; echo "cookie lines: $(grep -ci '^set-cookie:' "$KD_HEAD")"
MFA_TOKEN="$(kdget mfaToken)"; echo "exit=$?"
kdcall -X POST "$API/me/mfa/setup" -H "Authorization: Bearer $MFA_TOKEN" -H 'X-Client: admin-web'
MFA_SECRET="$(kdget secret)"; echo "exit=$?"
```

Block 2 of 4, **not pasted**: prints the setup key. In the authenticator app choose "Enter a setup key", account `owner.smoke (kd_dev)`, this key, time based. Write "saved" in the result.

```bash
echo "$MFA_SECRET"
```

Block 3 of 4, alone, then type the current code of the new entry:

```bash
read "KD_TOTP?Authenticator code (owner): "
```

Block 4 of 4, at once after block 3:

```bash
kdadm -X POST "$API/me/mfa/confirm" -H "Authorization: Bearer $MFA_TOKEN" -H 'Content-Type: application/json' -c "$JAR_ADMIN" -d "{\"code\":\"$KD_TOTP\"}"
kdcookie
echo "refreshToken in body: $(grep -c refreshToken "$KD_BODY")"
RECOVERY="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).recoveryCodes.join(" "))' "$KD_BODY")"; echo "exit=$?"
ADMIN_ID="$(kdget session.user.id)"; echo "exit=$?"
```

Then, **not pasted**, print the ten recovery codes and save them in your password manager (write "saved" in the result):

```bash
echo "$RECOVERY" | tr ' ' '\n'
```

Expected:

- Login answers `HTTP/1.1 403` with `"code":"MFA_REQUIRED"`, `"mfaToken":"***"`, `"mfaEnrolled":false` and `expiresIn` (about 600); no `Set-Cookie` line (`cookie lines: 0`); `exit=0`.
- Setup answers `HTTP/1.1 200` with `"otpauthUri":"***","secret":"***"`; `exit=0`.
- Confirm answers `HTTP/1.1 200` with `"recoveryCodes":"*** (10)"` and `session` (`accessToken` `***`, `expiresIn` about 900, `user` with `"role":"ADMIN"` and `"displayName":"Owner Smoke"`): the sign-in completes.
- The cookie line reads `Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=...; HttpOnly; SameSite=Strict` with **no `Secure`** (the `dev` tier serves plain `http`) and `Max-Age` at most 86400 (24 hours idle, decision 0008 section 1).
- `refreshToken in body: 0`: the refresh token is only in the cookie. Both `exit=0`.

Result (pass / fail): **pass**

```text
HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":false,"expiresIn":600,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
cookie lines: 0
exit=0
HTTP/1.1 200 OK
{"otpauthUri":"***","secret":"***"}
exit=0
(setup key: saved)
HTTP/1.1 200 OK
{"recoveryCodes":"*** (10)","session":{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"}}}
Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=86399; HttpOnly; SameSite=Strict
refreshToken in body: 0
exit=0
exit=0
(recovery codes: saved)
```

Notes (setup key and recovery codes: "saved"): saved (session scratch file, deleted after the run; see "Run log"). Admin id `01a1b5a2-9718-78a4-8e45-36a1193c9e0d`. No `Secure` on the `dev` tier, as expected.

## Step 4. Cookie transport: the second step, refresh, CSRF and reuse

**This step has four blocks; run them in order.** Block 1 of 4: a new sign-in with the second step, so that the cookie jar holds a cookie set on the auth path. The code of step 3 is spent (one use per 30-second step): wait until the app shows a new one, then paste this line alone and type it:

```bash
read "KD_TOTP?Authenticator code (owner, a new one): "
```

Block 2 of 4, at once after block 1 (the challenge of an enrolled account lives 5 minutes, `expiresIn` 300; the code about 30 seconds):

```bash
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\",\"password\":\"$PW_ADMIN\",\"deviceLabel\":\"smoke-admin\"}"
MFA_TOKEN="$(kdget mfaToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/mfa/verify" -H 'Content-Type: application/json' -c "$JAR_ADMIN" -d "{\"challenge\":\"$MFA_TOKEN\",\"code\":\"$KD_TOTP\"}"
kdcookie
OLD_COOKIE="$(kdjar "$JAR_ADMIN")"; [ -n "$OLD_COOKIE" ]; echo "cookie in jar exit=$?"
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -c "$JAR_ADMIN"
kdcookie
NEW_COOKIE="$(kdjar "$JAR_ADMIN")"; [ -n "$NEW_COOKIE" ] && [ "$NEW_COOKIE" != "$OLD_COOKIE" ]; echo "rotated exit=$?"
kdcall -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -H "Origin: $ORIGIN"
kdcall -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -H 'Origin: https://attacker.invalid' -H 'X-Client: admin-web'
kdcall -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -H 'X-Client: admin-web'
```

Block 3 of 4: the old cookie value presented again more than 10 seconds after its rotation (reuse), then the current one:

```bash
sleep 11
kdadm -X POST "$API/admin/auth/refresh" -H "Cookie: kd_refresh=$OLD_COOKIE"
kdcookie
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN"
```

Block 4 of 4: sign in again (the family is revoked). Wait for a new code, paste the `read` line alone, then the rest at once:

```bash
read "KD_TOTP?Authenticator code (owner, a new one): "
```

```bash
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\",\"password\":\"$PW_ADMIN\",\"deviceLabel\":\"smoke-admin\"}"
MFA_TOKEN="$(kdget mfaToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/mfa/verify" -H 'Content-Type: application/json' -c "$JAR_ADMIN" -d "{\"challenge\":\"$MFA_TOKEN\",\"code\":\"$KD_TOTP\"}"
ACCESS_ADMIN="$(kdget accessToken)"; echo "exit=$?"
```

Expected:

- Each login answers `HTTP/1.1 403`, `"code":"MFA_REQUIRED"`, now with `"mfaEnrolled":true` and `"expiresIn":300`. Each `mfa/verify` answers `HTTP/1.1 200` with `accessToken` `***`, `user` `"role":"ADMIN"` and `"recoveryCodesLeft":10`, and a `Set-Cookie` as in step 3. If `mfa/verify` answers `400 CODE_INVALID`, the code was the one already used or had expired: repeat the block with a new code and say so in "Notes".
- `cookie in jar exit=0`. The refresh with the jar, `X-Client` and the good `Origin` answers `HTTP/1.1 200` with a new access token and a new `Set-Cookie`; `rotated exit=0`.
- Without `X-Client`, with the foreign `Origin` and without `Origin`: each `HTTP/1.1 403`, `"code":"FORBIDDEN"`.
- After 11 seconds, the old cookie answers `HTTP/1.1 401`, `"code":"UNAUTHENTICATED"` and clears the cookie (`Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=0; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 ...`; the value is empty); the current cookie then answers `401 UNAUTHENTICATED` too: the family is revoked.
- The last sign-in answers `200` and `exit=0` (its access token and cookie are used from step 5 on).

Result (pass / fail): **pass**

```text
HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":true,"expiresIn":300,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"},"recoveryCodesLeft":10}
Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=86399; HttpOnly; SameSite=Strict
cookie in jar exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"}}
Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=86399; HttpOnly; SameSite=Strict
rotated exit=0
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
Set-Cookie: kd_refresh=; Path=/api/v1/admin/auth; Max-Age=0; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT
HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":true,"expiresIn":300,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"},"recoveryCodesLeft":10}
exit=0
```

Notes: each `mfa/verify` used the code of the next 30-second step (the confirm of step 3 had used the previous one). The challenge of an enrolled account lives 300 s, not 10 minutes (the sheet's first text was corrected). `auth.refresh_reuse` is in the audit list of step 10.

## Step 5. Staff creation, passwords and the first sign-ins

```bash
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -c "$JAR_ADMIN"
ACCESS_ADMIN="$(kdget accessToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/users" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d "{\"displayName\":\"Staff Smoke\",\"email\":\"$E_STAFF\",\"role\":\"STAFF\",\"branchIds\":[\"$BRANCH_SA\"]}"
STAFF_ID="$(kdget id)"; echo "exit=$?"
kdadm -X POST "$API/admin/users" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d "{\"displayName\":\"Manager Smoke\",\"email\":\"$E_MANAGER\",\"role\":\"MANAGER\",\"branchIds\":[\"$BRANCH_SB\"]}"
MANAGER_ID="$(kdget id)"; echo "exit=$?"
sleep 3
kdmailsto "$E_STAFF"
kdmailsto "$E_MANAGER"
LINK_STAFF="$(kdlink "$E_STAFF")"; echo "exit=$?"
LINK_MANAGER="$(kdlink "$E_MANAGER")"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_STAFF\",\"password\":\"$PW_STAFF\"}"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_MANAGER\",\"password\":\"$PW_MANAGER\"}"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -c "$JAR_STAFF" -d "{\"email\":\"$E_STAFF\",\"password\":\"$PW_STAFF\",\"deviceLabel\":\"smoke-staff\"}"
kdcookie
ACCESS_STAFF="$(kdget accessToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_MANAGER\",\"password\":\"$PW_MANAGER\",\"deviceLabel\":\"smoke-manager\"}"
echo "STAFF_ID=$STAFF_ID MANAGER_ID=$MANAGER_ID"
```

Expected:

- The admin refresh answers `200` and `exit=0`.
- Each create answers `HTTP/1.1 201` with `"status":"INVITED"`, the role, `branches` holding `SA` (staff) or `SB` (manager), and `mfa` with `"required":false` (STAFF) or `"required":true` (MANAGER), `"enabled":false`; both `exit=0`.
- Each mailbox shows `1 message(s)` with the invitation subject; both `kdlink` `exit=0`.
- Both password sets answer `HTTP/1.1 204`.
- The STAFF login answers `HTTP/1.1 200` with `accessToken` `***` and `"role":"STAFF"`, no second step, and a `Set-Cookie` as in step 3; `exit=0`.
- The MANAGER login answers `HTTP/1.1 403`, `"code":"MFA_REQUIRED"`, `"mfaEnrolled":false`, and sets no cookie.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"}}
exit=0
HTTP/1.1 201 Created
{"id":"01a1b5a4-141b-7f01-9106-5dd22746ad35","displayName":"Staff Smoke","email":"staff.smoke@kitchendaylight.example","role":"STAFF","status":"INVITED","branches":[{"id":"01a1b5a2-9764-7b0c-91aa-b34451be9034","code":"SA"}],"mfa":{"required":false,"enabled":false,"enabledAt":null},"lastLoginAt":null}
exit=0
HTTP/1.1 201 Created
{"id":"01a1b5a4-147f-7439-b13c-326af5d7b29e","displayName":"Manager Smoke","email":"manager.smoke@kitchendaylight.example","role":"MANAGER","status":"INVITED","branches":[{"id":"01a1b5a2-976a-70bd-9f58-e8453bff462f","code":"SB"}],"mfa":{"required":true,"enabled":false,"enabledAt":null},"lastLoginAt":null}
exit=0
staff.smoke@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
manager.smoke@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
kdlink: to staff.smoke@kitchendaylight.example | Lời mời tham gia trang quản trị Kitchen Daylight
exit=0
kdlink: to manager.smoke@kitchendaylight.example | Lời mời tham gia trang quản trị Kitchen Daylight
exit=0
HTTP/1.1 204 No Content

HTTP/1.1 204 No Content

HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a4-141b-7f01-9106-5dd22746ad35","displayName":"Staff Smoke","role":"STAFF"}}
Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=86399; HttpOnly; SameSite=Strict
exit=0
HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":false,"expiresIn":600,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
cookie lines: 0
STAFF_ID=01a1b5a4-141b-7f01-9106-5dd22746ad35 MANAGER_ID=01a1b5a4-147f-7439-b13c-326af5d7b29e
```

Notes (write both ids): STAFF `01a1b5a4-141b-7f01-9106-5dd22746ad35`, MANAGER `01a1b5a4-147f-7439-b13c-326af5d7b29e`.

## Step 6. Staff lockout

**Before this step, restart the API in terminal 2** (the step sends 9 staff logins; the per-IP limit is 10 per 5 minutes).

**This step has two blocks; run both.** Block 1 of 2: five wrong passwords on the STAFF account (the fifth locks it, decision 0008 section 4: threshold 5 for staff, then 15 minutes), then the unknown email, a wrong password while locked and the right password while locked:

```bash
kdfail "$E_STAFF" 'CHANGE_ME_LOCAL_wrong_pw' | tee "$TMPDIR/kd-a3-wrong.txt"
for i in 2 3 4 5; do kdfail "$E_STAFF" 'CHANGE_ME_LOCAL_wrong_pw' | tail -n 1; done
kdsql -At -c "SELECT failed_login_count, locked_until > now() FROM public.users WHERE email = 'staff.smoke@kitchendaylight.example'"; echo "exit=$?"
kdfail 'nobody.smoke@kitchendaylight.example' 'CHANGE_ME_LOCAL_wrong_pw' | tee "$TMPDIR/kd-a3-unknown.txt"
kdfail "$E_STAFF" 'CHANGE_ME_LOCAL_wrong_pw' | tee "$TMPDIR/kd-a3-locked.txt"
kdfail "$E_STAFF" "$PW_STAFF" > "$TMPDIR/kd-a3-locked-right.txt"; cat "$TMPDIR/kd-a3-locked-right.txt"
for f in unknown locked locked-right; do diff <(sed -E 's/"instance":"[^"]*",?//' "$TMPDIR/kd-a3-wrong.txt") <(sed -E 's/"instance":"[^"]*",?//' "$TMPDIR/kd-a3-$f.txt"); echo "$f diff exit=$?"; done
kdsql -At -c "SELECT failed_login_count, locked_until > now() FROM public.users WHERE email = 'staff.smoke@kitchendaylight.example'"; echo "exit=$?"
```

Block 2 of 2: the unlock. Decision 0008 section 4 clears the counter and `locked_until` on a completed sign-in or a completed password reset by link ("a lock never blocks the reset flow"); the admin sends a reset link, the STAFF sets a new password and signs in:

```bash
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -c "$JAR_ADMIN"
ACCESS_ADMIN="$(kdget accessToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/users/$STAFF_ID/reset-password" -H "Authorization: Bearer $ACCESS_ADMIN"
sleep 3
LINK_STAFF2="$(kdlink "$E_STAFF")"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_STAFF2\",\"password\":\"$PW_STAFF2\"}"
kdsql -At -c "SELECT failed_login_count, locked_until IS NULL FROM public.users WHERE email = 'staff.smoke@kitchendaylight.example'"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -c "$JAR_STAFF" -d "{\"email\":\"$E_STAFF\",\"password\":\"$PW_STAFF2\",\"deviceLabel\":\"smoke-staff\"}"
ACCESS_STAFF="$(kdget accessToken)"; echo "exit=$?"
```

Expected:

- Every refused login prints `{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}` (or the same body with a `detail` and an `instance`) and `status=401`; the four loop lines are `status=401`.
- The first query prints `5|t` (locked).
- The three `diff` commands print nothing and `unknown diff exit=0`, `locked diff exit=0`, `locked-right diff exit=0`: the unknown email, the wrong password while locked and the right password while locked are byte-identical to the first wrong password, apart from `instance` (decision 0008 header row 9 and section 5). The second query still prints `5|t` (no increment while locked).
- Block 2: the refresh answers `200`; `reset-password` answers `HTTP/1.1 204`; `kdlink` prints the reset subject and `exit=0`; the set answers `204`; the query prints `0|t` (unlocked); the login with `PW_STAFF2` answers `HTTP/1.1 200` and `exit=0`.
- Alternative unlock, if you prefer to wait: 15 minutes after the fifth failure, the login with `PW_STAFF` answers `200` (write which one you ran).

Result (pass / fail): **pass**

```text
{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}
status=401
status=401
status=401
status=401
status=401
5|t
exit=0
{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}
status=401
{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}
status=401
{"type":"about:blank","title":"Unauthorized","status":401,"code":"INVALID_CREDENTIALS"}
status=401
unknown diff exit=0
locked diff exit=0
locked-right diff exit=0
5|t
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"}}
exit=0
HTTP/1.1 204 No Content

kdlink: to staff.smoke@kitchendaylight.example | Đặt lại mật khẩu trang quản trị Kitchen Daylight
exit=0
HTTP/1.1 204 No Content

0|t
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a4-141b-7f01-9106-5dd22746ad35","displayName":"Staff Smoke","role":"STAFF"}}
exit=0
```

Notes: the API was restarted before the step. Unlock by the admin's reset link (block 2), not by waiting. The bodies carry no `instance`, so the four refusals are byte-identical as they are.

## Step 7. Admin user management

**Before this step, restart the API in terminal 2.**

**This step has five parts; run them in order.** Part 1: the manager enrols, as a second entry in the authenticator app (needed for the role, the `FORBIDDEN` and the `mfa-reset` checks below):

```bash
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_MANAGER\",\"password\":\"$PW_MANAGER\",\"deviceLabel\":\"smoke-manager\"}"
MFA_TOKEN_M="$(kdget mfaToken)"; echo "exit=$?"
kdcall -X POST "$API/me/mfa/setup" -H "Authorization: Bearer $MFA_TOKEN_M" -H 'X-Client: admin-web'
MFA_SECRET_M="$(kdget secret)"; echo "exit=$?"
```

**Not pasted** (add the key to the app as account `manager.smoke (kd_dev)`; write "saved"):

```bash
echo "$MFA_SECRET_M"
```

Alone, then type the manager entry's code:

```bash
read "KD_TOTP?Authenticator code (manager): "
```

```bash
kdadm -X POST "$API/me/mfa/confirm" -H "Authorization: Bearer $MFA_TOKEN_M" -H 'Content-Type: application/json' -c "$JAR_MANAGER" -d "{\"code\":\"$KD_TOTP\"}"
RECOVERY_M="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).recoveryCodes.join(" "))' "$KD_BODY")"; echo "exit=$?"
ACCESS_MANAGER="$(kdget session.accessToken)"; echo "exit=$?"
```

The manager's recovery codes are throw-away and not needed later; they stay in the shell variable for the log check of step 10.

Part 2: who may list users:

```bash
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -c "$JAR_ADMIN"
ACCESS_ADMIN="$(kdget accessToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_STAFF" -c "$JAR_STAFF"
ACCESS_STAFF="$(kdget accessToken)"; echo "exit=$?"
kdcall "$API/admin/users" -H "Authorization: Bearer $ACCESS_STAFF"
kdcall "$API/admin/users" -H "Authorization: Bearer $ACCESS_MANAGER"
kdq "$API/admin/users?scope=staff" -H "Authorization: Bearer $ACCESS_ADMIN"; kdstaff
```

Part 3: reveal a customer's contact (the phase 02 customer) and its audit row:

```bash
CUSTOMER_ID="$(kdsql -At -c "SELECT id FROM public.users WHERE email = 'ana.smoke@example.com'")"; echo "CUSTOMER_ID=$CUSTOMER_ID"
kdadm -X POST "$API/admin/users/$CUSTOMER_ID/reveal-contact" -H "Authorization: Bearer $ACCESS_ADMIN"
kdsql -At -c "SELECT action, entity_type, entity_id = '$CUSTOMER_ID', actor_user_id = '$ADMIN_ID', diff::text ~ '@' FROM public.audit_logs WHERE action = 'order.contact_reveal' ORDER BY created_at DESC LIMIT 1"; echo "exit=$?"
```

Part 4: a role change ends the manager's session; the admin cannot change themself:

```bash
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_MANAGER" -c "$JAR_MANAGER"
kdadm -X PATCH "$API/admin/users/$MANAGER_ID" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d '{"role":"STAFF"}'
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_MANAGER"
kdadm -X PATCH "$API/admin/users/$MANAGER_ID" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d '{"role":"MANAGER"}'
kdadm -X PATCH "$API/admin/users/$ADMIN_ID" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d '{"role":"MANAGER"}'
kdadm -X PATCH "$API/admin/users/$ADMIN_ID" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d '{"status":"SUSPENDED"}'
```

Part 5: the MFA reset of the manager, and of oneself:

```bash
kdmailsto "$E_MANAGER"
kdadm -X POST "$API/admin/users/$MANAGER_ID/mfa-reset" -H "Authorization: Bearer $ACCESS_ADMIN"
sleep 3
kdmailsto "$E_MANAGER"
kdadm -X POST "$API/admin/users/$ADMIN_ID/mfa-reset" -H "Authorization: Bearer $ACCESS_ADMIN"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_MANAGER\",\"password\":\"$PW_MANAGER\",\"deviceLabel\":\"smoke-manager\"}"
kdq "$API/admin/users?scope=staff" -H "Authorization: Bearer $ACCESS_ADMIN"; kdstaff
```

Expected:

- Part 1: login `403 MFA_REQUIRED` with `"mfaEnrolled":false`; setup `200`; confirm `200` with `"recoveryCodes":"*** (10)"` and `session` with `"role":"MANAGER"`; every `exit=0`.
- Part 2: both refreshes answer `200`. `GET /admin/users` as STAFF and as MANAGER: each `HTTP/1.1 403`, `"code":"FORBIDDEN"`. As ADMIN: `HTTP/1.1 200`, then `total ... | activeAdminsWithMfa 1` (or more if `kd_dev` holds other enrolled admins) and one line per staff account, among them `owner.smoke@... ADMIN ACTIVE {"required":true,"enabled":true,...}`, `staff.smoke@... STAFF ACTIVE {"required":false,"enabled":false,...} SA` and `manager.smoke@... MANAGER ACTIVE {"required":true,"enabled":true,...} SB`.
- Part 3: a UUID for `CUSTOMER_ID` (empty means `kd_dev` lost the phase 02 customer: stop and say so); `reveal-contact` answers `HTTP/1.1 200` with `"email":"ana.smoke@example.com"` and `"phone":"+84901234567"` (fictional); the query prints `order.contact_reveal|USER|t|t|f` (the audit row names the customer and the acting admin, and its diff holds no email).
- Part 4: the manager's refresh answers `200`; `PATCH {"role":"STAFF"}` answers `HTTP/1.1 200` with `"role":"STAFF"`; the manager's refresh then answers `HTTP/1.1 401`, `"code":"UNAUTHENTICATED"` (a role change revokes every refresh token, brief E6); `PATCH {"role":"MANAGER"}` answers `200` with `"role":"MANAGER"`. Both changes of the admin's own role and own status answer with `"code":"SELF_CHANGE"` (write the status you saw).
- **`LAST_ADMIN` is not reachable here:** the service checks `SELF_CHANGE` before `LAST_ADMIN`, and the actor of every `PATCH` is itself an `ACTIVE` `ADMIN`, so with one admin the only admin can be suspended only by itself, which is `SELF_CHANGE`; with two admins, `LAST_ADMIN` applies only when they demote each other at the same time. That race is the integration case `keeps one ACTIVE admin when two admins demote each other at once (LAST_ADMIN)`, run in step 9.
- Part 5: the manager's mailbox grows by 1 and its newest subject is the MFA reset notice (`MFA_RESET_NOTICE` template); `mfa-reset` on the manager answers `HTTP/1.1 204`; on oneself `"code":"SELF_CHANGE"`; the manager's login answers `403 MFA_REQUIRED` with `"mfaEnrolled":false` (the manager must enrol again); the list shows the manager with `"enabled":false` and `activeAdminsWithMfa` unchanged.

Result (pass / fail): **pass**

```text
HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":false,"expiresIn":600,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
exit=0
HTTP/1.1 200 OK
{"otpauthUri":"***","secret":"***"}
exit=0
(setup key: saved)
HTTP/1.1 200 OK
{"recoveryCodes":"*** (10)","session":{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a4-147f-7439-b13c-326af5d7b29e","displayName":"Manager Smoke","role":"MANAGER"}}}
exit=0
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"}}
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a4-141b-7f01-9106-5dd22746ad35","displayName":"Staff Smoke","role":"STAFF"}}
exit=0
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
HTTP/1.1 200 OK
total 3 | activeAdminsWithMfa 1
manager.smoke@kitchendaylight.example MANAGER ACTIVE {"required":true,"enabled":true,"enabledAt":"2026-11-07T10:54:07.926Z"} SB
staff.smoke@kitchendaylight.example STAFF ACTIVE {"required":false,"enabled":false,"enabledAt":null} SA
owner.smoke@kitchendaylight.example ADMIN ACTIVE {"required":true,"enabled":true,"enabledAt":"2026-11-07T10:52:00.710Z"}
CUSTOMER_ID=01a1b455-1369-7810-81e3-a9f4ae0bd52b
HTTP/1.1 200 OK
{"email":"ana.smoke@example.com","phone":"+84901234567"}
order.contact_reveal|USER|t|t|f
exit=0
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a4-147f-7439-b13c-326af5d7b29e","displayName":"Manager Smoke","role":"MANAGER"}}
HTTP/1.1 200 OK
{"id":"01a1b5a4-147f-7439-b13c-326af5d7b29e","displayName":"Manager Smoke","email":"manager.smoke@kitchendaylight.example","role":"STAFF","status":"ACTIVE","branches":[{"id":"01a1b5a2-976a-70bd-9f58-e8453bff462f","code":"SB"}],"mfa":{"required":false,"enabled":true,"enabledAt":"2026-11-07T10:54:07.926Z"},"lastLoginAt":"2026-11-07T10:54:07.929Z"}
HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHENTICATED"}
HTTP/1.1 200 OK
{"id":"01a1b5a4-147f-7439-b13c-326af5d7b29e",...,"role":"MANAGER","status":"ACTIVE",...,"mfa":{"required":true,"enabled":true,...},...}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"SELF_CHANGE","detail":"An administrator cannot change their own role, status or branches."}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"SELF_CHANGE","detail":"An administrator cannot change their own role, status or branches."}
manager.smoke@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
HTTP/1.1 204 No Content

manager.smoke@kitchendaylight.example: 2 message(s), newest: Xác thực hai bước của bạn đã được đặt lại
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"SELF_CHANGE","detail":"An administrator cannot reset their own second factor."}
HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":false,"expiresIn":600,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
HTTP/1.1 200 OK
total 3 | activeAdminsWithMfa 1
manager.smoke@kitchendaylight.example MANAGER ACTIVE {"required":true,"enabled":false,"enabledAt":null} SB
staff.smoke@kitchendaylight.example STAFF ACTIVE {"required":false,"enabled":false,"enabledAt":null} SA
owner.smoke@kitchendaylight.example ADMIN ACTIVE {"required":true,"enabled":true,"enabledAt":"2026-11-07T10:52:00.710Z"}
```

Notes (manager setup key: "saved"; write `CUSTOMER_ID`): the API was restarted before the step. Manager setup key saved (session scratch file, deleted after the run). `CUSTOMER_ID` `01a1b455-1369-7810-81e3-a9f4ae0bd52b` (phase 02's `ana.smoke@example.com`; contact fictional). `SELF_CHANGE` answers `403` for the role, the status and the MFA reset of oneself. The role change kept the manager's second factor (`"enabled":true` while `STAFF`). The MFA reset notice subject is "Xác thực hai bước của bạn đã được đặt lại".

## Step 8. Step-up

Wait for a new code of the owner entry, then paste the `read` line alone:

```bash
read "KD_TOTP?Authenticator code (owner, a new one): "
```

```bash
kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -c "$JAR_ADMIN"
ACCESS_ADMIN="$(kdget accessToken)"; echo "exit=$?"
WRONG=000000; [ "$KD_TOTP" = 000000 ] && WRONG=111111
kdadm -X POST "$API/admin/auth/step-up" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d "{\"code\":\"$WRONG\",\"purpose\":\"settings.payment\"}"
kdadm -X POST "$API/admin/auth/step-up" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d "{\"code\":\"$KD_TOTP\",\"purpose\":\"settings.payment\"}"
STEP_UP="$(kdget stepUpToken)"; echo "exit=$?"
```

Expected: the refresh answers `200`; the wrong code answers `HTTP/1.1 400`, `"code":"CODE_INVALID"` (it counts toward the admin lockout: 1 of 5); the good code answers `HTTP/1.1 200` with `"stepUpToken":"***"` and `expiresAt` about 5 minutes ahead; `exit=0`. If the good code answers `CODE_INVALID`, it was the code of a step already used: repeat with the next code and say so in "Notes".

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a2-9718-78a4-8e45-36a1193c9e0d","displayName":"Owner Smoke","role":"ADMIN"}}
exit=0
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"CODE_INVALID"}
HTTP/1.1 200 OK
{"stepUpToken":"***","expiresAt":"2026-11-07T11:00:00.000Z"}
exit=0
```

Notes: granted at 10:55:00 UTC, `expiresAt` 5 minutes later.

## Step 9. Unit and integration suites

```bash
pnpm --filter @kd/api test 2>&1 | tee "$TMPDIR/kd-a3-test.txt"; echo "exit=${pipestatus[1]}"
pnpm --filter @kd/api test:int 2>&1 | tee "$TMPDIR/kd-a3-test-int.txt"; echo "exit=${pipestatus[1]}"
```

The default reporter prints only the totals when its output goes to a file, so the route-enumerating branch-scoping spec (A3-T5), the deny-by-default 401 spec and the `LAST_ADMIN` case are run again alone, verbose:

```bash
cd apps/api
pnpm exec vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose test/integration/branch-scoping.int-spec.ts test/integration/deny-by-default.int-spec.ts; echo "exit=$?"
pnpm exec vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose test/integration/admin-users.int-spec.ts -t 'LAST_ADMIN'; echo "exit=$?"
cd ../..
```

Expected: both suites pass (`Test Files  N passed`, no failure, no skip you did not expect); both `exit=0`. The verbose runs list every case of `branch-scoping.int-spec.ts` (the route table, the scoping matrix, the machinery) and `deny-by-default.int-spec.ts` (among them `answers 401 UNAUTHENTICATED without a token on every route not marked @Public()`) as passed, and the `LAST_ADMIN` case as passed (the others of its file skipped by `-t`). The integration suite uses its own scratch database, not `kd_dev`, and does not disturb the running API. Paste the summary lines and the verbose case lines; shorten the rest.

Result (pass / fail): **pass**

```text
$ vitest run --maxWorkers=2
 Test Files  88 passed (88)
      Tests  1575 passed (1575)
   Duration  7.86s
exit=0
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism
migrate: 10 applied
 Test Files  25 passed (25)
      Tests  486 passed (486)
   Duration  41.65s
exit=0
 ✓ branch-scoping.int-spec.ts > branch scoping (every route of the real app, real PostgreSQL) > the route table > is non-trivial and includes the probe routes
 ✓ ... > the route table > treats a staff-only route outside /api/v1/admin as a staff route
 ✓ ... > the route table > gives every staff route @BranchScoped, @NotBranchScoped(reason) or ADMIN only
 ✓ ... > the route table > reads every marker without a contradiction
 ✓ ... > the route table > keeps @BranchScoped to signed-in staff roles
 ✓ ... > the route table > has a scoping-matrix case for every @BranchScoped route, of the matching kind
 ✓ ... > the route table > has no scoping-matrix case for a route that is not @BranchScoped
 ✓ ... > GET /api/v1/admin/test-branch-scope/items > (7 cases: STAFF and MANAGER of A get NOT_FOUND for B and see only A; ADMIN sees A and B; customer FORBIDDEN; unknown id NOT_FOUND)
 ✓ ... > GET /api/v1/admin/test-branch-scope/branches/:id > (5 cases, same matrix)
 ✓ ... > machinery > (11 cases: staff_branches read on every request, branchIds validation, @NotBranchScoped, soft-deleted branch)
 ✓ deny-by-default.int-spec.ts > deny by default (every route of the real app) > enumerates a non-trivial route list
 ✓ ... > sets apart only wildcard middleware mounts, never an @All() endpoint
 ✓ ... > answers 401 UNAUTHENTICATED without a token on every route not marked @Public()
 ✓ ... > opens exactly the expected @Public() routes without a token
 ✓ ... > answers 401 UNAUTHENTICATED to a malformed header or a forged token
 ✓ ... > answers 401 TOKEN_EXPIRED to an authentic but expired token
 ✓ ... > sets the request user from the token only
 ✓ ... > validates the body only after the token is accepted
 ✓ ... > answers 403 FORBIDDEN on a role mismatch
 ✓ ... > refuses an admin route without @Roles to every role, whatever the case of the URL
 Test Files  2 passed (2)
      Tests  40 passed (40)
exit=0
 ✓ admin-users.int-spec.ts > admin users (kd_app, real PostgreSQL) > update > keeps one ACTIVE admin when two admins demote each other at once (LAST_ADMIN)
 Test Files  1 passed (1)
      Tests  1 passed | 26 skipped (27)
exit=0
```

Notes (name the scoping spec and the 401 spec as printed; say whether a `LAST_ADMIN` case is named): scoping spec `test/integration/branch-scoping.int-spec.ts` (30 cases); 401 spec `test/integration/deny-by-default.int-spec.ts` (10 cases); `LAST_ADMIN` case named and passed (`admin-users.int-spec.ts`). The integration run prints the warning lines its cases provoke on purpose (for example the `fixture failure` of the 500 case); none carries a token, a code or a password.

## Step 10. Audit and log hygiene

Audit rows:

```bash
kdsql -At -c 'SELECT action, count(*) FROM public.audit_logs GROUP BY action ORDER BY 1'; echo "exit=$?"
kdsql -At -c "SELECT count(*) FROM public.audit_logs WHERE diff::text ~* '(password|token|secret|recovery)'"; echo "exit=$?"
```

The API log, while the shell variables of the earlier steps still hold their values. Every one must be non-empty (an empty value matches every line); the first line prints nothing when all are set:

```bash
for v in PW_ADMIN PW_STAFF PW_STAFF2 PW_MANAGER LINK_ADMIN LINK_STAFF LINK_STAFF2 LINK_MANAGER MFA_TOKEN MFA_TOKEN_M MFA_SECRET MFA_SECRET_M OLD_COOKIE NEW_COOKIE ACCESS_ADMIN ACCESS_STAFF ACCESS_MANAGER STEP_UP RECOVERY RECOVERY_M KD_TOTP; do [ -n "${(P)v}" ] || echo "empty: $v"; done
for v in "$PW_ADMIN" "$PW_STAFF" "$PW_STAFF2" "$PW_MANAGER" "$LINK_ADMIN" "$LINK_STAFF" "$LINK_STAFF2" "$LINK_MANAGER" "$MFA_TOKEN" "$MFA_TOKEN_M" "$MFA_SECRET" "$MFA_SECRET_M" "$OLD_COOKIE" "$NEW_COOKIE" "$ACCESS_ADMIN" "$ACCESS_STAFF" "$ACCESS_MANAGER" "$STEP_UP"; do grep -cF -- "$v" "$TMPDIR/kd-api-a3.log"; done | tr '\n' ' '; echo
for c in ${=RECOVERY} ${=RECOVERY_M}; do grep -cF -- "$c" "$TMPDIR/kd-api-a3.log"; done | sort | uniq -c
for j in "$JAR_ADMIN" "$JAR_STAFF"; do c="$(kdjar "$j")"; [ -n "$c" ] && grep -cF -- "$c" "$TMPDIR/kd-api-a3.log"; done
grep -cE 'kd_refresh=[A-Za-z0-9_-]{20}' "$TMPDIR/kd-api-a3.log"
grep -cF -- "$KD_TOTP" "$TMPDIR/kd-api-a3.log"
grep -cE '(owner|staff|manager)\.smoke@kitchendaylight\.example' "$TMPDIR/kd-api-a3.log"
```

Expected:

- The audit list holds, among the phase 02 rows, the sign-in events (`auth.login_succeeded`, `auth.login_failed`, `auth.account_locked`), the second factor (`auth.mfa_enrolled`, `auth.mfa_succeeded`, `auth.mfa_failed` if a code was refused), the links and passwords (`auth.password_set`, `auth.password_reset_requested`), the step-up (`auth.step_up_failed`, `auth.step_up_succeeded`) and the user events (`user.create`, `user.role_change`, `user.mfa_reset`, `user.password_reset_send`, `order.contact_reveal`). Write any of these that is missing in "Notes".
- The diff count is `0`.
- No `empty:` line; eighteen `0` on one line (no password, link token, challenge, setup key, cookie value, access token or step-up token in the log); the recovery-code line is `20 0` (each of the twenty codes counted `0`); the current cookies of the admin and the staff `0`; the `kd_refresh=` pattern `0`.
- The last TOTP code: `0`. A 6-digit code can match an unrelated number (a timestamp or a duration); if it counts more than 0, run `grep -F -- "$KD_TOTP" "$TMPDIR/kd-api-a3.log"`, check that every hit is unrelated, and say so in "Notes" (paste the hits with the code replaced by `***`).
- The staff email count is `0` (the auth log lines carry the user id only). Write any other count in "Notes".

The log covers the whole run since step 0 (`tee -a` across the restarts).

Result (pass / fail): **pass for the log; the diff check as written returns 7, all false positives (see Notes)**

```text
auth.account_locked|1
auth.login_failed|7
auth.login_succeeded|6
auth.mfa_enrolled|2
auth.mfa_requested|6
auth.mfa_succeeded|2
auth.password_reset_completed|1
auth.password_reset_requested|1
auth.password_set|3
auth.refresh_reuse|2
auth.step_up_failed|1
auth.step_up_succeeded|1
order.contact_reveal|1
user.create|2
user.mfa_reset|1
user.password_reset_send|1
user.role_change|2
exit=0
7
exit=0
(no empty: line)
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  20 0
0
0
0
0
0
```

Notes: the 7 rows that match `(password|token|secret|recovery)` hold no secret value: five `auth.login_failed` diffs `{"reason": "WRONG_PASSWORD", "failedLoginCount": 1..5}` and two `auth.mfa_enrolled` diffs `{"recoveryCodesLeft": 10}`. The pattern matches an enum value and a key name. **Proposal for the review:** match values, not labels (for example the regex against `jsonb_each_text(diff)` values only, or a list of forbidden keys), or accept these 7 as known. No `auth.mfa_failed` row: no TOTP code was refused in this run (the refused step-up code is `auth.step_up_failed`). The log check ran with plain loops instead of `${(P)v}` and `${=VAR}` (same values); the manager's last TOTP code was counted too (`0`). The log has 340 lines across the three API starts.

## Step 11. Contract check and stop

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
(API stopped with SIGINT)
exit=1
```

Notes: `lsof` printed nothing; the stack was left running.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes, except the audit diff check of step 10 as written (7 false positives on the words `WRONG_PASSWORD` and `recoveryCodesLeft`, no secret value) |
| Failed or skipped steps | none skipped; step 0 needed a sheet fix (`ADMIN_ORIGINS` optional in `dev`); TOTP codes generated from the setup key, not read from an app (see "Run log") |
| Ids of step 1 and step 5 | admin `01a1b5a2-9718-78a4-8e45-36a1193c9e0d`; branches `SA` `01a1b5a2-9764-7b0c-91aa-b34451be9034`, `SB` `01a1b5a2-976a-70bd-9f58-e8453bff462f`; STAFF `01a1b5a4-141b-7f01-9106-5dd22746ad35`, MANAGER `01a1b5a4-147f-7439-b13c-326af5d7b29e` (all kept in `kd_dev`) |
| Authenticator entries and recovery codes | no app entry was made; the setup keys and recovery codes lived in a session scratch file, deleted after the run. To sign in as `owner.smoke@...` again, reset its second factor from another admin or reset `kd_dev` |
| Follow-up tasks opened | (1) the throw-away branches `SA` and `SB` and the three smoke staff accounts stay in `kd_dev`: a later branch seed must not reuse the codes `SA` or `SB`, or `kd_dev` is reset first; (2) the audit diff check of step 10 matches labels, not values: refine it at the review; (3) `forgot` answers `202`, not the `204` of the task text |
| Owner | |
| Date | 2026-11-07 |

Phase A3 gate: run the review prompt
