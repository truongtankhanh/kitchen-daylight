# Phase A5 smoke run: branches

Owner checklist for task A5-T7. It runs the branches slice of Phase A5 (A5-T1 to A5-T6) on the host against the local stack: migration `0013_branch_details.sql`, the admin branch CRUD, weekly hours and special days, `todayHours`, the delivery rings and the zone check, the delivery switch, the staff pause switch, the staff ward search, branch scoping for a manager, the soft delete and its refusals, the audit rows, and both test suites.

**Scope:** the API is at `http://127.0.0.1:3001/api/v1`. Every step writes to the local `kd_dev` database only. The sample data is fictional: branches `SM` and `SN` ("1 Duong Mau", coordinates 10.7769 and 106.7009, phone `+842800000000`), the staff accounts `staff.a5@kitchendaylight.example` (STAFF on `SM`) and `manager.a5@kitchendaylight.example` (MANAGER on `SN`), and, when step 0 needs one, the admin `owner.a5@kitchendaylight.example`. Step 11 soft-deletes `SM` and sets every other live branch except `SN` to `CLOSED` (the throw-away branches of earlier sheets, such as `SA` and `SB` of phase 03). The only long-running process is `pnpm dev:api` (a watcher) in terminal 2, stopped with Ctrl-C in step 13.

## How to run

- Run one step at a time, from the repository root, in order, in **terminal 1**. The API runs in **terminal 2** (step 0). Shell variables and helper functions set in terminal 1 are reused by later steps, so keep the same terminal open from start to finish.
- **Each command block can be pasted whole**, except the one-line `read` blocks: paste those alone, then type the 6-digit code shown by the authenticator app and press Enter. Run the block that follows a `read` at once (a code is valid for about 30 seconds).
- Paste the output into the empty block of the step and fill in the result. Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Secrets are never pasted into this sheet.** The admin access token lives only in the shell variable `ACCESS` (and the staff and manager tokens in `ACCESS_STAFF` and `ACCESS_MANAGER`): never `echo` them. `kdcall` and `kdadm` print `***` in place of `accessToken`, `refreshToken`, `mfaToken`, `stepUpToken`, `secret`, `otpauthUri`, `recoveryCodes`, `token` and `password`. The blocks marked **not pasted** print an authenticator setup key: never paste their output, write "saved" instead. Replace the 6-digit codes you type with `***`. Never paste a password or the content of `.env`. `pnpm dev:infra` prints the `print-env.sh` block: replace it with `(print-env.sh output, passwords as ***)`. Replace home paths with `<repo>`.
- Use Node 26.13.0 (`nvm use` once in each terminal).
- The command blocks hold no comment lines and no angle-bracket placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- `jq` is optional: the helpers of step 0 read the JSON bodies with `node`. If you prefer `jq`, `jq . "$KD_BODY"` shows the last body (mind the secrets above).
- **The access token lives about 15 minutes.** Every step that calls an admin route starts with `kdrefresh`, which refreshes `ACCESS` through the `kd_refresh` cookie of the admin jar. If a call still answers `401 TOKEN_EXPIRED`, run `kdrefresh` and repeat the call.
- **`pnpm dev:api` is a watcher:** it rebuilds and restarts when a source file changes. Do not edit files under `apps/api` during the run. Its output goes to `$TMPDIR/kd-api-a5.log` too (step 6 searches it).
- **Throttling:** the staff sign-in group (`/admin/auth/login`, `/admin/auth/mfa/verify`, `/admin/auth/step-up`) allows 10 calls per 5 minutes per IP; this sheet makes at most 4. If a step answers `429 RATE_LIMITED`, wait 5 minutes (or stop and restart `pnpm dev:api`) and repeat the step.
- **Admin calls** carry an `Origin` from `ADMIN_ORIGINS` and `X-Client: admin-web` (the CSRF check of decision 0008 section 10, required on every `POST /admin/auth/*`); `kdadm` adds both.
- **A second run** on the same `kd_dev` finds `SM` soft-deleted (its code stays taken) and `SN` in place: reset `kd_dev`, or replace the codes `SM` and `SN` and the two emails with unused ones and say so in "Notes".
- Exit codes: commands other than `curl` are followed by `echo "exit=$?"`.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-10 (03:19 to 03:25 UTC) |
| Machine / OS / chip / RAM | Owner's MacBook, macOS (Darwin 25.6.0) |
| Monorepo commit (`git rev-parse --short HEAD`) | `07f2adc`, plus this uncommitted sheet |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | `f9654b1` |
| Node / pnpm (`node --version`, `pnpm --version`) | v26.13.0 (`nvm use`) / 12.16.1 |

**Run log:** run by the coding agent on the owner's request (2026-11-10), one pass. Deviations from the sheet as written: (1) the TOTP codes of the admin (option B) and the manager were generated from the setup key with the `otpauth` package of `apps/api` instead of an authenticator app, as in the phase 03 run; the setup keys, tokens and passwords lived in a session-only scratch file, deleted after the run, and are not in this sheet; (2) `pnpm dev:api` ran as a background process with its output appended to `$TMPDIR/kd-api-a5.log`, stopped at the end of step 13; (3) each step ran in a fresh shell that re-read the variables and helpers of step 0, so the `read` lines were not used; (4) some long bodies are shortened in the pasted output (marked `...`).

## Step 0. Stack, build, migrations, the API and the admin sign-in

Terminal 1:

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
pnpm --filter @kd/api build; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
```

If the build fails on a missing `@kd/contracts` or `@kd/i18n` module (no `dist/` yet), run `pnpm --filter "@kd/api..." build; echo "exit=$?"` instead and say so in "Notes".

Terminal 2 (a watcher; stays open until step 13):

```bash
nvm use
: > "$TMPDIR/kd-api-a5.log"
pnpm dev:api 2>&1 | tee -a "$TMPDIR/kd-api-a5.log"
```

Terminal 1, the variables and helpers used by every later step:

```bash
curl -sS -i http://127.0.0.1:3001/api/health; echo
API=http://127.0.0.1:3001/api/v1
MAIL_UI_URL="$(grep '^MAIL_UI_URL=' .env | cut -d= -f2- | tr -d '"')"
ORIGIN="$(grep '^ADMIN_ORIGINS=' .env | cut -d= -f2- | tr -d '"' | cut -d, -f1)"
ORIGIN="${ORIGIN:-http://localhost:4200}"
echo "ORIGIN=$ORIGIN"
PW_STAFF='CHANGE_ME_LOCAL_a5_staff_pw'
PW_MANAGER='CHANGE_ME_LOCAL_a5_manager_pw'
E_STAFF=staff.a5@kitchendaylight.example
E_MANAGER=manager.a5@kitchendaylight.example
KD_HEAD="$TMPDIR/kd-a5-head.txt"
KD_BODY="$TMPDIR/kd-a5-body.json"
JAR_ADMIN="$TMPDIR/kd-a5-admin.jar"
JAR_STAFF="$TMPDIR/kd-a5-staff.jar"
JAR_MANAGER="$TMPDIR/kd-a5-manager.jar"
: > "$JAR_ADMIN"; : > "$JAR_STAFF"; : > "$JAR_MANAGER"
KD_SQL_URL="$(grep '^DATABASE_URL_MIGRATOR=' .env | cut -d= -f2-)"
kdsql() { docker exec -i kd-docker-postgres-1 psql "${KD_SQL_URL/127.0.0.1:5452/127.0.0.1:5432}" -v ON_ERROR_STOP=1 -X "$@"; }
kdshow() { node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); if (t.trim() === "") { console.log(""); process.exit(0); } let v; try { v = JSON.parse(t); } catch { console.log(t); process.exit(0); } const hide = new Set(["accessToken", "refreshToken", "mfaToken", "stepUpToken", "secret", "otpauthUri", "recoveryCodes", "token", "password"]); const m = (x) => Array.isArray(x) ? x.map(m) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, hide.has(k) ? (Array.isArray(y) ? "*** (" + y.length + ")" : "***") : m(y)])) : x; console.log(JSON.stringify(m(v)))' "$KD_BODY"; }
kdq() { curl -sS -D "$KD_HEAD" -o "$KD_BODY" "$@"; head -n 1 "$KD_HEAD"; }
kdcall() { kdq "$@"; kdshow; }
kdadm() { kdcall -H "Origin: $ORIGIN" -H 'X-Client: admin-web' "$@"; }
kdget() { node -e 'const v = process.argv[2].split(".").reduce((o, k) => (o == null ? undefined : o[k]), JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))); if (typeof v !== "string" || v === "") { console.error("kdget: no " + process.argv[2] + " in the last body"); process.exit(1); } console.log(v)' "$KD_BODY" "$1"; }
kdval() { node -e 'const v = process.argv[2].split(".").reduce((o, k) => (o == null ? undefined : o[k]), JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))); if (v === undefined || v === null || typeof v === "object") { console.error("kdval: no " + process.argv[2] + " in the last body"); process.exit(1); } console.log(String(v))' "$KD_BODY" "$1"; }
kdcookie() { grep -i '^set-cookie:' "$KD_HEAD" | sed -E 's/(kd_refresh=)[^;]+/\1***/'; }
kdlink() { node --input-type=module -e 'const [base, to] = process.argv.slice(1); const list = await (await fetch(base + "/api/v1/messages?limit=100")).json(); const m = list.messages.find((x) => (x.To ?? []).some((t) => t.Address.toLowerCase() === to.toLowerCase())); if (!m) { console.error("kdlink: no message to " + to); process.exit(1); } const full = await (await fetch(base + "/api/v1/message/" + m.ID)).json(); console.error("kdlink: to " + to + " | " + full.Subject); const hit = ((full.Text ?? "") + " " + (full.HTML ?? "")).match(/#token=([A-Za-z0-9_-]+)/); if (!hit) { console.error("kdlink: no #token= in the message"); process.exit(1); } console.log(hit[1])' "$MAIL_UI_URL" "$1"; }
kdmailsto() { node --input-type=module -e 'const [base, to] = process.argv.slice(1); const list = await (await fetch(base + "/api/v1/messages?limit=200")).json(); const mine = list.messages.filter((x) => (x.To ?? []).some((t) => t.Address.toLowerCase() === to.toLowerCase())); console.log(to + ": " + mine.length + " message(s), newest: " + (mine[0] ? mine[0].Subject : "none"))' "$MAIL_UI_URL" "$1"; }
kdrefresh() { kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -c "$JAR_ADMIN"; ACCESS="$(kdget accessToken)"; echo "refresh exit=$?"; }
kdbranches() { node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("total " + r.total); for (const b of r.items ?? []) console.log(b.code, b.status, "acceptsDelivery=" + b.acceptsDelivery, "activeZoneCount=" + b.activeZoneCount, "todayHours=" + JSON.stringify(b.todayHours))' "$KD_BODY"; }
kdbranchbody() { printf '%s' "{\"code\":\"$1\",\"name\":\"$2\",\"addressLine\":\"1 Duong Mau\",\"provinceCode\":\"$PROV\",\"wardCode\":\"$WARD\",\"location\":{\"lat\":10.7769,\"lng\":106.7009},\"phone\":\"+842800000000\",\"status\":\"ACTIVE\",\"acceptsPickup\":true,\"acceptsDelivery\":false,\"acceptsReservations\":false,\"defaultPrepMinutes\":15,\"orderCutoffMinutes\":30,\"reservationSlotStepMinutes\":30,\"reservationMaxParty\":8,\"reservationLeadMinutes\":60,\"reservationMaxDaysAhead\":30}"; }
RUN_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "RUN_START=$RUN_START"
TODAY="$(TZ=Asia/Ho_Chi_Minh date +%F)"; DOW="$(TZ=Asia/Ho_Chi_Minh date +%u)"; echo "TODAY=$TODAY DOW=$DOW"
```

- `kdcall`, `kdq`, `kdadm`, `kdget`, `kdcookie`, `kdlink`, `kdmailsto` and `kdsql` are the helpers of the phase 03 sheet, unchanged.
- `kdval PATH` prints any scalar field of the last body (a number such as `rowVersion`, a boolean or a string).
- `kdrefresh` refreshes the admin session from the admin cookie jar and sets `ACCESS` (it prints the status line and the body with the token as `***`).
- `kdbranches` prints one line per branch of the last `GET /admin/branches` body. `kdbranchbody CODE NAME` prints the create body of the sample branch (it reads `PROV` and `WARD` of step 1).
- `TODAY` and `DOW` are the Vietnam date and ISO weekday (1 Monday to 7 Sunday) used by step 4.

**The admin sign-in.** Use **option A** if you have an `ADMIN` of `kd_dev` whose authenticator entry you still hold; otherwise use **option B**, which creates the admin `owner.a5@kitchendaylight.example` exactly as the phase 03 sheet did in its steps 1 to 3 (the setup key of the phase 03 admin was not kept, see its sign-off).

Option A, first set the account (replace the email and the password with those of your admin; never paste the password):

```bash
E_ADMIN=owner.smoke@kitchendaylight.example
PW_ADMIN='CHANGE_ME_LOCAL_a3_admin_pw'
```

Option A, alone, then type the current code of that account:

```bash
read "KD_TOTP?Authenticator code (admin): "
```

Option A, at once after the `read`:

```bash
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\",\"password\":\"$PW_ADMIN\",\"deviceLabel\":\"smoke-admin\"}"
MFA_TOKEN="$(kdget mfaToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/mfa/verify" -H 'Content-Type: application/json' -c "$JAR_ADMIN" -d "{\"challenge\":\"$MFA_TOKEN\",\"code\":\"$KD_TOTP\"}"
ACCESS="$(kdget accessToken)"; echo "exit=$?"
```

Option B, block 1 of 3, the invited admin, the invitation link, the password and the setup:

```bash
E_ADMIN=owner.a5@kitchendaylight.example
PW_ADMIN='CHANGE_ME_LOCAL_a5_admin_pw'
kdsql -At <<'SQL'
INSERT INTO public.users (email, display_name, locale, role, status)
VALUES ('owner.a5@kitchendaylight.example', 'Owner A5 Smoke', 'vi', 'ADMIN', 'INVITED')
ON CONFLICT DO NOTHING
RETURNING email, role, status;
SQL
echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/forgot" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\"}"
sleep 3
LINK_ADMIN="$(kdlink "$E_ADMIN")"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_ADMIN\",\"password\":\"$PW_ADMIN\"}"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\",\"password\":\"$PW_ADMIN\",\"deviceLabel\":\"smoke-admin\"}"
MFA_TOKEN="$(kdget mfaToken)"; echo "exit=$?"
kdcall -X POST "$API/me/mfa/setup" -H "Authorization: Bearer $MFA_TOKEN" -H 'X-Client: admin-web'
MFA_SECRET="$(kdget secret)"; echo "exit=$?"
```

Option B, block 2 of 3, **not pasted**: prints the setup key. In the authenticator app choose "Enter a setup key", account `owner.a5 (kd_dev)`, this key, time based. Write "saved" in the result.

```bash
echo "$MFA_SECRET"
```

Option B, block 3 of 3: paste the `read` line alone, type the code of the new entry, then run the rest at once:

```bash
read "KD_TOTP?Authenticator code (owner.a5): "
```

```bash
kdadm -X POST "$API/me/mfa/confirm" -H "Authorization: Bearer $MFA_TOKEN" -H 'Content-Type: application/json' -c "$JAR_ADMIN" -d "{\"code\":\"$KD_TOTP\"}"
kdcookie
ACCESS="$(kdget session.accessToken)"; echo "exit=$?"
```

Expected:

- `pnpm dev:infra`: every service healthy, `exit=0`. The build exits 0.
- The first `migrate` applies the migrations `kd_dev` does not have yet, among them this phase's `0013_branch_details.sql` (`migrate: N applied`), or prints `migrate: nothing to apply` if an earlier run already applied it; `exit=0`. The second `migrate` prints `migrate: nothing to apply` and `exit=0`.
- Terminal 2 logs that the API listens on 3001. `GET /api/health` answers `HTTP/1.1 200` with `{"status":"ok","checks":{"database":"up"}}`. `ORIGIN=` shows one `http://` origin. `RUN_START=` and `TODAY= DOW=` print values.
- Option A: the login answers `HTTP/1.1 403`, `"code":"MFA_REQUIRED"`, `"mfaEnrolled":true`; `mfa/verify` answers `HTTP/1.1 200` with `"accessToken":"***"` and `"role":"ADMIN"`; both `exit=0`.
- Option B: the insert prints `owner.a5@kitchendaylight.example|ADMIN|INVITED` (nothing on a second run); `forgot` answers `HTTP/1.1 202`; `kdlink` prints the invitation subject and `exit=0`; `password/set` answers `HTTP/1.1 204`; the login answers `403 MFA_REQUIRED` with `"mfaEnrolled":false`; setup answers `200` with `"secret":"***"`; confirm answers `200` with `"recoveryCodes":"*** (10)"` and `session` (`"accessToken":"***"`, `"role":"ADMIN"`), and a `Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; ...` line; every `exit=0`. The recovery codes are not needed by this sheet.

Result (pass / fail): **pass**

```text
Now using node v26.13.0
$ scripts/dev-infra.sh up
 Container kd-docker-s3-init-1  Started
[kd] all services ready
(print-env.sh output, passwords as ***)
exit=0
$ tsc -p tsconfig.json
$ nest build
exit=0
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
HTTP/1.1 200 OK
X-Request-Id: 2fd6fd2b-71e5-4adf-8cb4-2b4ba4955e12
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42
{"status":"ok","checks":{"database":"up"}}
ORIGIN=http://localhost:4200
RUN_START=2026-11-10T03:19:46Z
TODAY=2026-11-10 DOW=2
owner.a5@kitchendaylight.example|ADMIN|INVITED
INSERT 0 1
exit=0
HTTP/1.1 202 Accepted

kdlink: to owner.a5@kitchendaylight.example | Lời mời tham gia trang quản trị Kitchen Daylight
exit=0
HTTP/1.1 204 No Content

HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":false,"expiresIn":600,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
exit=0
HTTP/1.1 200 OK
{"otpauthUri":"***","secret":"***"}
exit=0
(setup key: not printed, see "Run log")
HTTP/1.1 200 OK
{"recoveryCodes":"*** (10)","session":{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}}
Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=86399; HttpOnly; SameSite=Strict
exit=0
```

Notes (option A or B; the admin email; the setup key "saved" for option B): option B; admin `owner.a5@kitchendaylight.example`, id `01a1c378-0c60-7a27-ae27-a42aa3d685f5`. Both `migrate` runs print `nothing to apply`: `kd_dev` already had `0013_branch_details` (`schema_migrations` row 13, applied 2026-11-09 03:17 UTC), which the sheet allows. The API log line: `Found 0 errors. Watching for file changes.` and the health check answered on 3001. Setup key: not saved in an app (see "Run log").

## Step 1. A province and a ward

Public routes, no token. Province `79` is the one this sheet uses; if `kd_dev` has no `79`, set `PROV` to another code of the list and say so in "Notes". The ward is the first of the province whose name has a diacritic (step 9 types it without them).

```bash
kdq "$API/provinces"; node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(r.length + " provinces"); for (const p of r.filter((x) => x.code === "79")) console.log(p.code, p.name, p.type)' "$KD_BODY"
PROV=79
kdq "$API/wards?provinceCode=$PROV"; node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(r.length + " wards"); for (const w of r.slice(0, 3)) console.log(w.code, w.name, w.type)' "$KD_BODY"
read -r WARD WARD_NAME <<< "$(node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const plain = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D"); const w = r.find((x) => plain(x.name) !== x.name) ?? r[0]; console.log(w.code + " " + w.name)' "$KD_BODY")"
echo "PROV=$PROV WARD=$WARD WARD_NAME=$WARD_NAME"
```

Expected: `HTTP/1.1 200` twice; `34 provinces` (or the count of your reference seed) and the line `79 Hồ Chí Minh CITY`; a ward count above zero and three ward lines; `PROV=79`, a 5-digit `WARD` and its `WARD_NAME` with at least one diacritic.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
34 provinces
79 Hồ Chí Minh CITY
HTTP/1.1 200 OK
168 wards
27316 An Đông WARD
26878 An Hội Đông WARD
26882 An Hội Tây WARD
PROV=79 WARD=27316 WARD_NAME=An Đông
```

Notes (write `WARD` and `WARD_NAME`): `WARD=27316`, `WARD_NAME=An Đông`.

## Step 2. Create branch `SM`, then the same code again

```bash
kdrefresh
kdadm -X POST "$API/admin/branches" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "$(kdbranchbody SM 'Chi nhanh Mau SM')"
SM="$(kdget id)"; echo "exit=$?"
echo "rowVersion=$(kdval rowVersion)"
kdadm -X POST "$API/admin/branches" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "$(kdbranchbody SM 'Chi nhanh Mau SM khac')"
echo "SM=$SM"
```

Expected:

- `kdrefresh` answers `HTTP/1.1 200` and `refresh exit=0` (as at the start of every later step).
- The first create answers `HTTP/1.1 201` with `"code":"SM"`, `"slug":"chi-nhanh-mau-sm"`, `"status":"ACTIVE"`, `"acceptsDelivery":false`, `"wardCode"` the `WARD` of step 1, `"location":{"lat":10.7769,"lng":106.7009}`, `"phone":"+842800000000"`, `"codeLocked":false`, `"activeZoneCount":0`, `"todayHours":[]` and a `rowVersion`; `exit=0` and `rowVersion=1`.
- The second create (same code, another name, so another slug) answers `HTTP/1.1 409`, `"code":"ALREADY_EXISTS"`, `"detail":"The branch code is already in use."`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
HTTP/1.1 201 Created
{"id":"01a1c378-6d7b-7a95-a944-36090b581d60","code":"SM","slug":"chi-nhanh-mau-sm","name":"Chi nhanh Mau SM","addressLine":"1 Duong Mau","provinceCode":"79","wardCode":"27316","location":{"lat":10.7769,"lng":106.7009},"phone":"+842800000000","status":"ACTIVE","acceptsPickup":true,"acceptsDelivery":false,"acceptsReservations":false,"sortOrder":903,"staffCount":0,"ratingAverage":null,"reviewCount":0,"activeZoneCount":0,"codeLocked":false,"ordersToday":0,"activeOrders":0,"todayHours":[],"rowVersion":1,"description":null,"websiteUrl":null,"pauseMessage":null,"defaultPrepMinutes":15,"orderCutoffMinutes":30,"reservationDurationMinutes":90,"reservationSlotStepMinutes":30,"reservationMaxParty":8,"reservationLeadMinutes":60,"reservationMaxDaysAhead":30,"amenityIds":[],"updatedAt":"2026-11-10T03:20:11.858Z"}
exit=0
rowVersion=1
HTTP/1.1 409 Conflict
{"type":"about:blank","title":"Conflict","status":409,"code":"ALREADY_EXISTS","detail":"The branch code is already in use."}
SM=01a1c378-6d7b-7a95-a944-36090b581d60
```

Notes (write the id of `SM`): `SM` `01a1c378-6d7b-7a95-a944-36090b581d60`.

## Step 3. Weekly hours, then `OVERLAP` and `EQUAL_TIMES`

Monday to Sunday 10:00 to 22:00, plus a Saturday shift from 22:00 to 02:00 (it ends on Sunday; it touches the 10:00 to 22:00 shift without overlapping it).

```bash
kdrefresh
WEEK="$(node -e 'const p = []; for (let d = 1; d <= 7; d += 1) p.push({ service: "STORE", dayOfWeek: d, openTime: "10:00", closeTime: "22:00" }); p.push({ service: "STORE", dayOfWeek: 6, openTime: "22:00", closeTime: "02:00" }); console.log(JSON.stringify(p))')"
kdcall "$API/admin/branches/$SM/hours" -H "Authorization: Bearer $ACCESS"
HV="$(kdval rowVersion)"; echo "HV=$HV"
kdadm -X PUT "$API/admin/branches/$SM/hours" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$HV,\"periods\":$WEEK,\"special\":[]}"
HV="$(kdval rowVersion)"; echo "HV=$HV"
kdadm -X PUT "$API/admin/branches/$SM/hours" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$HV,\"periods\":[{\"service\":\"STORE\",\"dayOfWeek\":1,\"openTime\":\"10:00\",\"closeTime\":\"14:00\"},{\"service\":\"STORE\",\"dayOfWeek\":1,\"openTime\":\"13:00\",\"closeTime\":\"18:00\"}],\"special\":[]}"
kdadm -X PUT "$API/admin/branches/$SM/hours" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$HV,\"periods\":[{\"service\":\"STORE\",\"dayOfWeek\":1,\"openTime\":\"10:00\",\"closeTime\":\"10:00\"}],\"special\":[]}"
```

Expected:

- `GET` answers `HTTP/1.1 200` with `"periods":[]`, `"special":{"items":[],"page":1,"pageSize":20,"total":0}` and the branch `rowVersion` (`HV=1`).
- The week `PUT` answers `HTTP/1.1 200` with eight periods sorted by day and time; the Saturday (`"dayOfWeek":6`) shift `22:00` to `02:00` has `"closesNextDay":true`, every other `false`; `HV=` is one higher.
- The two Monday shifts answer `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, `"errors":[{"field":"periods[1].openTime","code":"OVERLAP","message":"overlaps another period"}]`.
- The equal times answer `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, `"errors":[{"field":"periods[0].closeTime","code":"EQUAL_TIMES","message":"must differ from the opening time"}]`.
- The two refused calls change nothing (step 4 reads the week again).

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
HTTP/1.1 200 OK
{"rowVersion":1,"periods":[],"special":{"items":[],"page":1,"pageSize":20,"total":0}}
HV=1
HTTP/1.1 200 OK
{"rowVersion":2,"periods":[{"service":"STORE","dayOfWeek":1,"openTime":"10:00","closeTime":"22:00","closesNextDay":false},{"service":"STORE","dayOfWeek":2,"openTime":"10:00","closeTime":"22:00","closesNextDay":false},{"service":"STORE","dayOfWeek":3,"openTime":"10:00","closeTime":"22:00","closesNextDay":false},{"service":"STORE","dayOfWeek":4,"openTime":"10:00","closeTime":"22:00","closesNextDay":false},{"service":"STORE","dayOfWeek":5,"openTime":"10:00","closeTime":"22:00","closesNextDay":false},{"service":"STORE","dayOfWeek":6,"openTime":"10:00","closeTime":"22:00","closesNextDay":false},{"service":"STORE","dayOfWeek":6,"openTime":"22:00","closeTime":"02:00","closesNextDay":true},{"service":"STORE","dayOfWeek":7,"openTime":"10:00","closeTime":"22:00","closesNextDay":false}],"special":{"items":[],"page":1,"pageSize":20,"total":0}}
HV=2
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"periods[1].openTime","code":"OVERLAP","message":"overlaps another period"}]}
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"periods[0].closeTime","code":"EQUAL_TIMES","message":"must differ from the opening time"}]}
```

Notes: none.

## Step 4. `todayHours`, with and without a closed special day today

```bash
kdrefresh
kdq "$API/admin/branches?pageSize=50" -H "Authorization: Bearer $ACCESS"; kdbranches
kdcall "$API/admin/branches/$SM/hours" -H "Authorization: Bearer $ACCESS" > /dev/null
HV="$(kdval rowVersion)"; echo "HV=$HV"
kdadm -X PUT "$API/admin/branches/$SM/hours" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$HV,\"periods\":$WEEK,\"special\":[{\"startsOn\":\"$TODAY\",\"endsOn\":\"$TODAY\",\"service\":\"STORE\",\"isClosed\":true,\"note\":\"Smoke closed day\"}]}"
HV="$(kdval rowVersion)"; echo "HV=$HV"
kdq "$API/admin/branches?pageSize=50" -H "Authorization: Bearer $ACCESS"; kdbranches
kdadm -X PUT "$API/admin/branches/$SM/hours" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$HV,\"periods\":$WEEK,\"special\":[]}"
kdq "$API/admin/branches?pageSize=50" -H "Authorization: Bearer $ACCESS"; kdbranches
```

Expected:

- The first list answers `HTTP/1.1 200`; the `SM` line reads `todayHours=[{"openTime":"10:00","closeTime":"22:00","closesNextDay":false}]`, plus `{"openTime":"22:00","closeTime":"02:00","closesNextDay":true}` when `DOW=6` (Saturday). Other branches of `kd_dev` (for example `SA`, `SB`) have their own lines.
- The `PUT` with today closed answers `HTTP/1.1 200` with one special item (`"startsOn"` and `"endsOn"` equal to `TODAY`, `"isClosed":true`, `"note":"Smoke closed day"`); the second list shows `SM` with `todayHours=[]`.
- The last `PUT` answers `HTTP/1.1 200` with `"special":{"items":[],...,"total":0}` (the special day is removed); the third list shows the `todayHours` of the first list again.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
HTTP/1.1 200 OK
total 3
SA ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SB ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SM ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[{"openTime":"10:00","closeTime":"22:00","closesNextDay":false}]
HV=2
HTTP/1.1 200 OK
{"rowVersion":3,"periods":[ ...the eight periods of step 3... ],"special":{"items":[{"startsOn":"2026-11-10","endsOn":"2026-11-10","service":"STORE","isClosed":true,"openTime":null,"closeTime":null,"closesNextDay":null,"note":"Smoke closed day","displayNote":null}],"page":1,"pageSize":20,"total":1}}
HV=3
HTTP/1.1 200 OK
total 3
SA ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SB ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SM ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
HTTP/1.1 200 OK
{"rowVersion":4,"periods":[ ...the eight periods... ],"special":{"items":[],"page":1,"pageSize":20,"total":0}}
HTTP/1.1 200 OK
total 3
SA ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SB ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SM ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[{"openTime":"10:00","closeTime":"22:00","closesNextDay":false}]
```

Notes: Run on a Tuesday (`DOW=2`), so `SM` has one session today. `SA` and `SB` (phase 03) have no hours, hence `todayHours=[]`. The periods of the two `PUT` bodies are shortened above.

## Step 5. Rings of 500, 1000 and 2000 m, then 800 m

```bash
kdrefresh
kdadm -X POST "$API/admin/branches/$SM/delivery-zones" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"name":"Vong 500 m","radiusM":500,"fee":15000,"minOrder":50000,"freeOver":300000,"etaMinutes":25,"isActive":true}'
Z500="$(kdget id)"; V500="$(kdval rowVersion)"; echo "Z500=$Z500 V500=$V500"
kdadm -X POST "$API/admin/branches/$SM/delivery-zones" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"name":"Vong 1000 m","radiusM":1000,"fee":20000,"minOrder":50000,"freeOver":300000,"etaMinutes":30,"isActive":true}'
Z1000="$(kdget id)"; V1000="$(kdval rowVersion)"; echo "Z1000=$Z1000 V1000=$V1000"
kdadm -X POST "$API/admin/branches/$SM/delivery-zones" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"name":"Vong 2000 m","radiusM":2000,"fee":30000,"minOrder":80000,"freeOver":400000,"etaMinutes":40,"isActive":true}'
Z2000="$(kdget id)"; V2000="$(kdval rowVersion)"; echo "Z2000=$Z2000 V2000=$V2000"
kdadm -X POST "$API/admin/branches/$SM/delivery-zones" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"name":"Vong 800 m","radiusM":800,"fee":18000,"minOrder":50000,"freeOver":300000,"etaMinutes":28,"isActive":true}'
kdcall "$API/admin/branches/$SM/delivery-zones" -H "Authorization: Bearer $ACCESS"
```

Expected:

- Each of the three creates answers `HTTP/1.1 201` with the zone (`id`, `name`, `radiusM`, `fee`, `minOrder`, `freeOver`, `etaMinutes`, `"isActive":true`, `rowVersion`, `updatedAt`); the three `echo` lines print an id and `V...=1`.
- The 800 m ring answers `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, `"errors":[{"field":"radiusM","code":"RADIUS_ORDER","message":"must keep the rings in order of radius"}]`.
- The list answers `HTTP/1.1 200` with the three rings in order of radius and `"total":3`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
HTTP/1.1 201 Created
{"id":"01a1c378-d847-712e-985b-9fb5f471e9d6","name":"Vong 500 m","radiusM":500,"fee":15000,"minOrder":50000,"freeOver":300000,"etaMinutes":25,"isActive":true,"rowVersion":1,"updatedAt":"2026-11-10T03:20:39.235Z"}
Z500=01a1c378-d847-712e-985b-9fb5f471e9d6 V500=1
HTTP/1.1 201 Created
{"id":"01a1c378-d8ad-77e3-bc39-2bb7f97177af","name":"Vong 1000 m","radiusM":1000,"fee":20000,"minOrder":50000,"freeOver":300000,"etaMinutes":30,"isActive":true,"rowVersion":1,"updatedAt":"2026-11-10T03:20:39.338Z"}
Z1000=01a1c378-d8ad-77e3-bc39-2bb7f97177af V1000=1
HTTP/1.1 201 Created
{"id":"01a1c378-d911-7c21-bdac-89d1ed0796fd","name":"Vong 2000 m","radiusM":2000,"fee":30000,"minOrder":80000,"freeOver":400000,"etaMinutes":40,"isActive":true,"rowVersion":1,"updatedAt":"2026-11-10T03:20:39.438Z"}
Z2000=01a1c378-d911-7c21-bdac-89d1ed0796fd V2000=1
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"radiusM","code":"RADIUS_ORDER","message":"must keep the rings in order of radius"}]}
HTTP/1.1 200 OK
{"items":[{"id":"01a1c378-d847-712e-985b-9fb5f471e9d6","name":"Vong 500 m","radiusM":500,...,"isActive":true,"rowVersion":1,...},{"id":"01a1c378-d8ad-77e3-bc39-2bb7f97177af","name":"Vong 1000 m","radiusM":1000,...},{"id":"01a1c378-d911-7c21-bdac-89d1ed0796fd","name":"Vong 2000 m","radiusM":2000,...}],"total":3}
```

Notes: The list body is shortened.

## Step 6. Zone check at about 400 m, 900 m and 3000 m, and the log

The three points share the branch latitude and lie east of the pin: longitude 106.704558 (about 400 m), 106.70913 (about 899 m) and 106.728333 (about 2997 m, on a sphere; the API measures on the spheroid, within a metre or two).

```bash
kdrefresh
kdadm -X POST "$API/admin/branches/$SM/delivery-zones/check" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"location":{"lat":10.7769,"lng":106.704558}}'
kdadm -X POST "$API/admin/branches/$SM/delivery-zones/check" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"location":{"lat":10.7769,"lng":106.70913}}'
kdadm -X POST "$API/admin/branches/$SM/delivery-zones/check" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"location":{"lat":10.7769,"lng":106.728333}}'
for lng in 106.704558 106.70913 106.728333; do grep -cF -- "$lng" "$TMPDIR/kd-api-a5.log"; done | tr '\n' ' '; echo
```

Expected:

- The first answers `HTTP/1.1 200` with `"distanceM"` about 400, `"zone"` the ring `"Vong 500 m"` and `"outOfZone":false`.
- The second answers `200` with `"distanceM"` about 899, `"zone"` the ring `"Vong 1000 m"` and `"outOfZone":false`.
- The third answers `200` with `"distanceM"` about 2997, `"zone":null` and `"outOfZone":true`.
- No body echoes the point. The log search prints `0 0 0`: the `pnpm dev:api` output holds none of the three longitudes (the request log keeps only the id, the method and the sanitized URL, A0-T2).

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
HTTP/1.1 200 OK
{"distanceM":400,"zone":{"id":"01a1c378-d847-712e-985b-9fb5f471e9d6","name":"Vong 500 m","radiusM":500,"fee":15000,"minOrder":50000,"freeOver":300000,"etaMinutes":25,"isActive":true,"rowVersion":1,"updatedAt":"2026-11-10T03:20:39.235Z"},"outOfZone":false}
HTTP/1.1 200 OK
{"distanceM":900,"zone":{"id":"01a1c378-d8ad-77e3-bc39-2bb7f97177af","name":"Vong 1000 m","radiusM":1000,"fee":20000,"minOrder":50000,"freeOver":300000,"etaMinutes":30,"isActive":true,"rowVersion":1,"updatedAt":"2026-11-10T03:20:39.338Z"},"outOfZone":false}
HTTP/1.1 200 OK
{"distanceM":3000,"zone":null,"outOfZone":true}
0 0 0
```

Notes: The spheroid distances round to 400, 900 and 3000 m (the sheet's sphere figures were 400, 899 and 2997).

## Step 7. Delivery on, rings off one by one, `LAST_ACTIVE_ZONE`, inner rings back on

```bash
kdrefresh
kdcall "$API/admin/branches/$SM" -H "Authorization: Bearer $ACCESS" > /dev/null
BV="$(kdval rowVersion)"; echo "BV=$BV"
kdadm -X PATCH "$API/admin/branches/$SM" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$BV,\"acceptsDelivery\":true}"
kdadm -X PATCH "$API/admin/branches/$SM/delivery-zones/$Z500" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$V500,\"isActive\":false}"
V500="$(kdval rowVersion)"; echo "V500=$V500"
kdadm -X PATCH "$API/admin/branches/$SM/delivery-zones/$Z1000" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$V1000,\"isActive\":false}"
V1000="$(kdval rowVersion)"; echo "V1000=$V1000"
kdadm -X PATCH "$API/admin/branches/$SM/delivery-zones/$Z2000" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$V2000,\"isActive\":false}"
kdadm -X PATCH "$API/admin/branches/$SM/delivery-zones/$Z500" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$V500,\"isActive\":true}"
kdadm -X PATCH "$API/admin/branches/$SM/delivery-zones/$Z1000" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$V1000,\"isActive\":true}"
kdcall "$API/admin/branches/$SM/delivery-zones" -H "Authorization: Bearer $ACCESS"
```

Expected:

- The branch `PATCH` answers `HTTP/1.1 200` with `"acceptsDelivery":true` and `"activeZoneCount":3`.
- Switching off the 500 m and the 1000 m rings answers `HTTP/1.1 200` each, with `"isActive":false`; `V500=2`, `V1000=2`.
- Switching off the 2000 m ring, the last active one while delivery is on, answers `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, with one error on `"field":"isActive"` and `"code":"LAST_ACTIVE_ZONE"`.
- Switching the 500 m and 1000 m rings back on answers `200` each with `"isActive":true`; the list shows the three rings active, `"total":3`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
BV=7
HTTP/1.1 200 OK
acceptsDelivery=true activeZoneCount=3 rowVersion=8
HTTP/1.1 200 OK
{"id":"01a1c378-d847-712e-985b-9fb5f471e9d6","name":"Vong 500 m","radiusM":500,"fee":15000,"minOrder":50000,"freeOver":300000,"etaMinutes":25,"isActive":false,"rowVersion":2,"updatedAt":"2026-11-10T03:20:58.022Z"}
V500=2
HTTP/1.1 200 OK
{"id":"01a1c378-d8ad-77e3-bc39-2bb7f97177af","name":"Vong 1000 m","radiusM":1000,"fee":20000,"minOrder":50000,"freeOver":300000,"etaMinutes":30,"isActive":false,"rowVersion":2,"updatedAt":"2026-11-10T03:20:58.092Z"}
V1000=2
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"isActive","code":"LAST_ACTIVE_ZONE","message":"is the last active zone of a branch that accepts delivery"}]}
HTTP/1.1 200 OK
{"id":"01a1c378-d847-712e-985b-9fb5f471e9d6","name":"Vong 500 m",...,"isActive":true,"rowVersion":3,"updatedAt":"2026-11-10T03:20:58.202Z"}
HTTP/1.1 200 OK
{"id":"01a1c378-d8ad-77e3-bc39-2bb7f97177af","name":"Vong 1000 m",...,"isActive":true,"rowVersion":3,"updatedAt":"2026-11-10T03:20:58.245Z"}
HTTP/1.1 200 OK
total 3 Vong 500 m=true, Vong 1000 m=true, Vong 2000 m=true
```

Notes: The branch `PATCH` body is summarised by one `node` line (`acceptsDelivery`, `activeZoneCount`, `rowVersion`); the list likewise. `BV=7`: the hours `PUT`s and the zone writes raise the branch `row_version` (brief C10).

## Step 8. A STAFF of `SM`: the pause switch, and no branch list

The invitation and the first sign-in are those of the phase 03 sheet (step 5): a STAFF account needs no second factor.

```bash
kdrefresh
kdadm -X POST "$API/admin/users" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"displayName\":\"Staff A5 Smoke\",\"email\":\"$E_STAFF\",\"role\":\"STAFF\",\"branchIds\":[\"$SM\"]}"
STAFF_ID="$(kdget id)"; echo "exit=$?"
sleep 3
kdmailsto "$E_STAFF"
LINK_STAFF="$(kdlink "$E_STAFF")"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_STAFF\",\"password\":\"$PW_STAFF\"}"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -c "$JAR_STAFF" -d "{\"email\":\"$E_STAFF\",\"password\":\"$PW_STAFF\",\"deviceLabel\":\"smoke-staff\"}"
ACCESS_STAFF="$(kdget accessToken)"; echo "exit=$?"
kdadm -X POST "$API/admin/branches/$SM/pause" -H "Authorization: Bearer $ACCESS_STAFF" -H 'Content-Type: application/json' -d '{"paused":true}'
kdadm -X POST "$API/admin/branches/$SM/pause" -H "Authorization: Bearer $ACCESS_STAFF" -H 'Content-Type: application/json' -d '{"paused":false}'
kdcall "$API/admin/branches" -H "Authorization: Bearer $ACCESS_STAFF"
echo "STAFF_ID=$STAFF_ID"
```

Expected:

- The create answers `HTTP/1.1 201` with `"role":"STAFF"`, `"status":"INVITED"` and `branches` holding `SM`; `exit=0`. The mailbox shows `1 message(s)` with the invitation subject; `kdlink` `exit=0`. `password/set` answers `HTTP/1.1 204`. The login answers `HTTP/1.1 200` with `"accessToken":"***"` and `"role":"STAFF"`; `exit=0`.
- `{"paused":true}` answers `HTTP/1.1 200` with `{"id":"...","status":"TEMPORARILY_CLOSED","rowVersion":...}` (the id of `SM`).
- `{"paused":false}` answers `HTTP/1.1 200` with `"status":"ACTIVE"` and a `rowVersion` one higher.
- `GET /admin/branches` answers `HTTP/1.1 403`, `"code":"FORBIDDEN"`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
HTTP/1.1 201 Created
{"id":"01a1c379-45ea-72a6-b408-7b75ba674300","displayName":"Staff A5 Smoke","email":"staff.a5@kitchendaylight.example","role":"STAFF","status":"INVITED","branches":[{"id":"01a1c378-6d7b-7a95-a944-36090b581d60","code":"SM"}],"mfa":{"required":false,"enabled":false,"enabledAt":null},"lastLoginAt":null}
exit=0
staff.a5@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
kdlink: to staff.a5@kitchendaylight.example | Lời mời tham gia trang quản trị Kitchen Daylight
exit=0
HTTP/1.1 204 No Content

HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c379-45ea-72a6-b408-7b75ba674300","displayName":"Staff A5 Smoke","role":"STAFF"}}
exit=0
HTTP/1.1 200 OK
{"id":"01a1c378-6d7b-7a95-a944-36090b581d60","status":"TEMPORARILY_CLOSED","rowVersion":13}
HTTP/1.1 200 OK
{"id":"01a1c378-6d7b-7a95-a944-36090b581d60","status":"ACTIVE","rowVersion":14}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
STAFF_ID=01a1c379-45ea-72a6-b408-7b75ba674300
```

Notes (write `STAFF_ID`): STAFF `01a1c379-45ea-72a6-b408-7b75ba674300`.

## Step 9. Ward search without diacritics

As the STAFF of step 8 (`GET /admin/wards` is a `staff` route).

```bash
Q="$(node -e 'console.log(encodeURIComponent(process.argv[1].normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D")))' "$WARD_NAME")"
echo "q=$Q"
kdcall "$API/admin/wards?provinceCode=$PROV&q=$Q" -H "Authorization: Bearer $ACCESS_STAFF"
```

Expected: `q=` shows the ward name of step 1 without diacritics (spaces as `%20`); the search answers `HTTP/1.1 200` with `{"items":[...]}`, and the first item is `{"code":"WARD of step 1","provinceCode":"79","name":"WARD_NAME of step 1","type":"..."}` (a name that starts with the typed text comes first; other wards whose names contain it may follow, at most 20).

Result (pass / fail): **pass**

```text
q=An%20Dong
HTTP/1.1 200 OK
{"items":[{"code":"27316","provinceCode":"79","name":"An Đông","type":"WARD"},{"code":"25945","provinceCode":"79","name":"Tân Đông Hiệp","type":"WARD"}]}
```

Notes: `Tân Đông Hiệp` also matches (`tan dong hiep` contains `an dong`) and comes after the prefix match, as expected.

## Step 10. Branch `SN` and a MANAGER of `SN` only

The invitation and the second-factor enrolment are those of the phase 03 sheet (steps 5 and 7): a MANAGER must enrol a second factor at the first sign-in.

Block 1 of 3, the branch, the account, the password and the setup:

```bash
kdrefresh
kdadm -X POST "$API/admin/branches" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "$(kdbranchbody SN 'Chi nhanh Mau SN')"
SN="$(kdget id)"; echo "exit=$?"
kdadm -X POST "$API/admin/users" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"displayName\":\"Manager A5 Smoke\",\"email\":\"$E_MANAGER\",\"role\":\"MANAGER\",\"branchIds\":[\"$SN\"]}"
MANAGER_ID="$(kdget id)"; echo "exit=$?"
sleep 3
kdmailsto "$E_MANAGER"
LINK_MANAGER="$(kdlink "$E_MANAGER")"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_MANAGER\",\"password\":\"$PW_MANAGER\"}"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_MANAGER\",\"password\":\"$PW_MANAGER\",\"deviceLabel\":\"smoke-manager\"}"
MFA_TOKEN_M="$(kdget mfaToken)"; echo "exit=$?"
kdcall -X POST "$API/me/mfa/setup" -H "Authorization: Bearer $MFA_TOKEN_M" -H 'X-Client: admin-web'
MFA_SECRET_M="$(kdget secret)"; echo "exit=$?"
```

Block 2 of 3, **not pasted** (add the key to the app as account `manager.a5 (kd_dev)`; write "saved"):

```bash
echo "$MFA_SECRET_M"
```

Block 3 of 3: paste the `read` line alone, type the manager entry's code, then run the rest at once:

```bash
read "KD_TOTP?Authenticator code (manager.a5): "
```

```bash
kdadm -X POST "$API/me/mfa/confirm" -H "Authorization: Bearer $MFA_TOKEN_M" -H 'Content-Type: application/json' -c "$JAR_MANAGER" -d "{\"code\":\"$KD_TOTP\"}"
ACCESS_MANAGER="$(kdget session.accessToken)"; echo "exit=$?"
kdcall "$API/admin/branches/$SM" -H "Authorization: Bearer $ACCESS_MANAGER"
kdq "$API/admin/branches" -H "Authorization: Bearer $ACCESS_MANAGER"; kdbranches
echo "SN=$SN MANAGER_ID=$MANAGER_ID"
```

Expected:

- The branch create answers `HTTP/1.1 201` with `"code":"SN"` and `"slug":"chi-nhanh-mau-sn"`; `exit=0`.
- The user create answers `HTTP/1.1 201` with `"role":"MANAGER"`, `branches` holding `SN` only, and `"mfa":{"required":true,"enabled":false,...}`; `exit=0`. The mailbox and `kdlink` as in step 8; `password/set` `HTTP/1.1 204`.
- The login answers `HTTP/1.1 403`, `"code":"MFA_REQUIRED"`, `"mfaEnrolled":false`; setup `200` with `"secret":"***"`; confirm `200` with `"recoveryCodes":"*** (10)"` and `session` (`"role":"MANAGER"`); every `exit=0`.
- The detail of `SM` answers `HTTP/1.1 404`, `"code":"NOT_FOUND"` (not `403`: nothing tells a branch outside the manager's list from a missing one).
- The list answers `HTTP/1.1 200`, `total 1` and one line `SN ACTIVE ...`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
HTTP/1.1 201 Created
{"id":"01a1c379-9a74-726e-a73d-2d4bf7964d2e","code":"SN","slug":"chi-nhanh-mau-sn","name":"Chi nhanh Mau SN",...}
exit=0
HTTP/1.1 201 Created
{"id":"01a1c379-9ac5-7b4c-a758-4d659a806dad","displayName":"Manager A5 Smoke","email":"manager.a5@kitchendaylight.example","role":"MANAGER","status":"INVITED","branches":[{"id":"01a1c379-9a74-726e-a73d-2d4bf7964d2e","code":"SN"}],"mfa":{"required":true,"enabled":false,"enabledAt":null},"lastLoginAt":null}
exit=0
manager.a5@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
kdlink: to manager.a5@kitchendaylight.example | Lời mời tham gia trang quản trị Kitchen Daylight
exit=0
HTTP/1.1 204 No Content

HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":false,"expiresIn":600,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
exit=0
HTTP/1.1 200 OK
{"otpauthUri":"***","secret":"***"}
exit=0
(setup key: not printed, see "Run log")
HTTP/1.1 200 OK
{"recoveryCodes":"*** (10)","session":{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c379-9ac5-7b4c-a758-4d659a806dad","displayName":"Manager A5 Smoke","role":"MANAGER"}}}
exit=0
HTTP/1.1 404 Not Found
{"type":"about:blank","title":"Not Found","status":404,"code":"NOT_FOUND"}
HTTP/1.1 200 OK
total 1
SN ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SN=01a1c379-9a74-726e-a73d-2d4bf7964d2e MANAGER_ID=01a1c379-9ac5-7b4c-a758-4d659a806dad
```

Notes (write `SN` and `MANAGER_ID`; the setup key "saved"): `SN` `01a1c379-9a74-726e-a73d-2d4bf7964d2e`, MANAGER `01a1c379-9ac5-7b4c-a758-4d659a806dad`. Setup key: not saved in an app (see "Run log").

## Step 11. Delete `SM` (stale, then right), then try to delete `SN`

`kd_dev` keeps the live branches of earlier sheets (for example `SA` and `SB` of phase 03), so `SN` is the last branch in operation only after every other one is `CLOSED`. Block 2 sets each live branch other than `SN` to `CLOSED` through `PATCH` (no audit row; they are throw-away smoke branches). Write their codes in "Notes".

Block 1 of 2, `SM`:

```bash
kdrefresh
kdcall "$API/admin/branches/$SM" -H "Authorization: Bearer $ACCESS" > /dev/null
BV="$(kdval rowVersion)"; echo "BV=$BV"
kdadm -X DELETE "$API/admin/branches/$SM?rowVersion=$((BV - 1))" -H "Authorization: Bearer $ACCESS"
kdadm -X DELETE "$API/admin/branches/$SM?rowVersion=$BV" -H "Authorization: Bearer $ACCESS"
kdcall "$API/admin/branches/$SM" -H "Authorization: Bearer $ACCESS"
```

Block 2 of 2, the last branch in operation:

```bash
kdq "$API/admin/branches?pageSize=50" -H "Authorization: Bearer $ACCESS"; kdbranches
OTHERS="$(node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(r.items.filter((b) => b.code !== "SN" && b.status !== "CLOSED").map((b) => b.id).join(" "))' "$KD_BODY")"; echo "OTHERS=$OTHERS"
for id in ${=OTHERS}; do kdq "$API/admin/branches/$id" -H "Authorization: Bearer $ACCESS" > /dev/null; V="$(kdval rowVersion)"; kdq -X PATCH "$API/admin/branches/$id" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "{\"rowVersion\":$V,\"status\":\"CLOSED\"}"; done
kdq "$API/admin/branches?pageSize=50" -H "Authorization: Bearer $ACCESS"; kdbranches
kdcall "$API/admin/branches/$SN" -H "Authorization: Bearer $ACCESS" > /dev/null
SNV="$(kdval rowVersion)"; echo "SNV=$SNV"
kdadm -X DELETE "$API/admin/branches/$SN?rowVersion=$SNV" -H "Authorization: Bearer $ACCESS"
```

Expected:

- Block 1: the stale `rowVersion` answers `HTTP/1.1 409`, `"code":"STALE_VERSION"` with `"current":{"rowVersion":BV,"updatedBy":...,"updatedAt":"..."}` (`updatedBy` the last editor of `SM`, the STAFF of step 8, by id and display name); the right one answers `HTTP/1.1 204` with no body (`SN` is still in operation, so `SM` is not the last one); the `GET` afterwards answers `HTTP/1.1 404`, `"code":"NOT_FOUND"`.
- Block 2: the first list shows `SN` and the other live branches (not `SM`); `OTHERS=` lists their ids (empty if `SN` is the only one); each `PATCH` prints `HTTP/1.1 200`; the second list shows every branch other than `SN` as `CLOSED`. The delete of `SN` answers `HTTP/1.1 409`, `"code":"INVALID_STATE"`, `"detail":"The last branch in operation cannot be deleted."` (api-divergences D-131).

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1c378-0c60-7a27-ae27-a42aa3d685f5","displayName":"Owner A5 Smoke","role":"ADMIN"}}
refresh exit=0
BV=14
HTTP/1.1 409 Conflict
{"current":{"rowVersion":14,"updatedBy":{"id":"01a1c379-45ea-72a6-b408-7b75ba674300","name":"Staff A5 Smoke"},"updatedAt":"2026-11-10T03:21:10.749Z"},"type":"about:blank","title":"Conflict","status":409,"code":"STALE_VERSION","detail":"The record was changed by someone else."}
HTTP/1.1 204 No Content

HTTP/1.1 404 Not Found
{"type":"about:blank","title":"Not Found","status":404,"code":"NOT_FOUND"}
HTTP/1.1 200 OK
total 3
SA ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SB ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SN ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
OTHERS=01a1b5a2-9764-7b0c-91aa-b34451be9034 01a1b5a2-976a-70bd-9f58-e8453bff462f
HTTP/1.1 200 OK
HTTP/1.1 200 OK
HTTP/1.1 200 OK
total 3
SA CLOSED acceptsDelivery=false activeZoneCount=0 todayHours=[]
SB CLOSED acceptsDelivery=false activeZoneCount=0 todayHours=[]
SN ACTIVE acceptsDelivery=false activeZoneCount=0 todayHours=[]
SNV=1
HTTP/1.1 409 Conflict
{"type":"about:blank","title":"Conflict","status":409,"code":"INVALID_STATE","detail":"The last branch in operation cannot be deleted."}
```

Notes (the codes set to `CLOSED`): `SA` and `SB` (phase 03) set to `CLOSED`. The three `200` lines after `OTHERS=` are the two `PATCH`es (the detail `GET` of each branch goes to `/dev/null`) and the second list.

## Step 12. Audit rows of steps 2, 5, 7, 8, 10 and 11

`kdsql` is the `psql` route of the phase 03 sheet (step 0 defines it). The rows are those written since `RUN_START`.

```bash
kdsql -At -c "SELECT action, count(*) FROM public.audit_logs WHERE created_at >= '$RUN_START' AND (action LIKE 'branch.%' OR action LIKE 'delivery_zone.%') GROUP BY action ORDER BY 1"; echo "exit=$?"
kdsql -At -c "SELECT action, entity_type, entity_label, branch_id IS NOT NULL, diff::text FROM public.audit_logs WHERE created_at >= '$RUN_START' AND (action LIKE 'branch.%' OR action LIKE 'delivery_zone.%') ORDER BY created_at, id"; echo "exit=$?"
kdsql -At -c "SELECT count(*) FROM public.audit_logs WHERE created_at >= '$RUN_START' AND diff::text ~ '(10\.77|106\.70|106\.72)'"; echo "exit=$?"
```

Expected:

- The counts: `branch.create|2` (steps 2 and 10; the refused create of step 2 writes none), `branch.delete|1` (step 11; the stale and the refused deletes write none), `branch.pause|2` (step 8), `delivery_zone.create|3` (step 5; the 800 m ring writes none), `delivery_zone.update|4` (step 7: two rings off, two back on; the refused one writes none). No `branch.location_confirm` (no `PATCH` sent `location`); the hours, the delivery switch and the `CLOSED` patches write no row.
- Every row has `branch_id IS NOT NULL` = `t`; `entity_label` is `Chi nhanh Mau SM` or `Chi nhanh Mau SN` for the branch rows and `Vong 500 m`, `Vong 1000 m` or `Vong 2000 m` for the zone rows. The diffs: `branch.create` `{branchCode, name, status}`, `branch.pause` `{"status":{"from":...,"to":...}}`, the zone rows the old and new zone values, `branch.delete` `{branchCode, deletedAt}`.
- The coordinate count is `0`: no diff holds the branch pin or a check point.

Result (pass / fail): **pass**

```text
branch.create|2
branch.delete|1
branch.pause|2
delivery_zone.create|3
delivery_zone.update|4
exit=0
branch.create|BRANCH|Chi nhanh Mau SM|t|{"name": {"to": "Chi nhanh Mau SM", "from": null}, "status": {"to": "ACTIVE", "from": null}, "branchCode": {"to": "SM", "from": null}}
delivery_zone.create|DELIVERY_ZONE|Vong 500 m|t|{"fee": {"to": 15000, "from": null}, "name": {"to": "Vong 500 m", "from": null}, "radiusM": {"to": 500, "from": null}, "freeOver": {"to": 300000, "from": null}, "isActive": {"to": true, "from": null}, "minOrder": {"to": 50000, "from": null}, "etaMinutes": {"to": 25, "from": null}}
delivery_zone.create|DELIVERY_ZONE|Vong 1000 m|t|{"fee": {"to": 20000, "from": null}, "name": {"to": "Vong 1000 m", "from": null}, "radiusM": {"to": 1000, "from": null}, ...}
delivery_zone.create|DELIVERY_ZONE|Vong 2000 m|t|{"fee": {"to": 30000, "from": null}, "name": {"to": "Vong 2000 m", "from": null}, "radiusM": {"to": 2000, "from": null}, ...}
delivery_zone.update|DELIVERY_ZONE|Vong 500 m|t|{"isActive": {"to": false, "from": true}}
delivery_zone.update|DELIVERY_ZONE|Vong 1000 m|t|{"isActive": {"to": false, "from": true}}
delivery_zone.update|DELIVERY_ZONE|Vong 500 m|t|{"isActive": {"to": true, "from": false}}
delivery_zone.update|DELIVERY_ZONE|Vong 1000 m|t|{"isActive": {"to": true, "from": false}}
branch.pause|BRANCH|Chi nhanh Mau SM|t|{"status": {"to": "TEMPORARILY_CLOSED", "from": "ACTIVE"}}
branch.pause|BRANCH|Chi nhanh Mau SM|t|{"status": {"to": "ACTIVE", "from": "TEMPORARILY_CLOSED"}}
branch.create|BRANCH|Chi nhanh Mau SN|t|{"name": {"to": "Chi nhanh Mau SN", "from": null}, "status": {"to": "ACTIVE", "from": null}, "branchCode": {"to": "SN", "from": null}}
branch.delete|BRANCH|Chi nhanh Mau SM|t|{"deletedAt": {"to": "2026-11-10T03:21:49.907Z", "from": null}, "branchCode": "SM"}
exit=0
0
exit=0
```

Notes (if `kdsql` is not available on this machine, write "not checked"): Twelve rows, every one with `branch_id`. Two zone diffs are shortened above.

## Step 13. Unit and integration suites, then stop the API

```bash
pnpm --filter @kd/api test 2>&1 | tee "$TMPDIR/kd-a5-test.txt"; echo "exit=${pipestatus[1]}"
pnpm --filter @kd/api test:int 2>&1 | tee "$TMPDIR/kd-a5-test-int.txt"; echo "exit=${pipestatus[1]}"
```

Then stop `pnpm dev:api` in terminal 2 with Ctrl-C and confirm that nothing listens on 3001:

```bash
lsof -nP -sTCP:LISTEN -iTCP:3001; echo "exit=$?"
```

Only if you want the stack stopped: `pnpm dev:infra:down; echo "exit=$?"` (volumes are kept).

Expected: both suites pass (`Test Files  N passed`, no failure); both `exit=0`. The integration suite uses its own scratch database, not `kd_dev`, and does not disturb the running API. `lsof` prints nothing (`exit=1`). Paste the summary lines only.

Result (pass / fail): **pass**

```text
$ vitest run --maxWorkers=2
 Test Files  114 passed (114)
      Tests  2054 passed (2054)
   Duration  10.74s
exit=0
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism
migrate: 13 applied
 Test Files  36 passed (36)
      Tests  809 passed (809)
   Duration  57.37s
exit=0
(API stopped)
exit=1
```

Notes: 114 unit files: one fewer than before A5-T5's fix (the removed `admin-wards.controller.spec.ts`). The stack was left running. Extra log check: the 12 secret values of the run (three passwords, two setup keys, three access tokens, two invitation tokens, two `mfaToken` challenges) each count `0` in `$TMPDIR/kd-api-a5.log` (197 lines), and the three smoke emails count `0`.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes |
| Failed or skipped steps | none |
| Ids (admin, `SM`, `SN`, STAFF, MANAGER) | admin `01a1c378-0c60-7a27-ae27-a42aa3d685f5`; `SM` `01a1c378-6d7b-7a95-a944-36090b581d60` (soft-deleted); `SN` `01a1c379-9a74-726e-a73d-2d4bf7964d2e`; STAFF `01a1c379-45ea-72a6-b408-7b75ba674300`; MANAGER `01a1c379-9ac5-7b4c-a758-4d659a806dad` (all kept in `kd_dev`) |
| Branches set to `CLOSED` in step 11 | `SA` `01a1b5a2-9764-7b0c-91aa-b34451be9034`, `SB` `01a1b5a2-976a-70bd-9f58-e8453bff462f` (phase 03 throw-away branches) |
| Authenticator entries | none in an app; the setup keys of `owner.a5` and `manager.a5` were used from a session scratch file, deleted after the run. To sign in as either again, reset its second factor from another admin or reset `kd_dev` |
| Follow-up tasks opened | (1) `kd_dev` now holds `SN` (ACTIVE, the only branch in operation), `SM` (soft-deleted, its code taken) and `SA`, `SB` (`CLOSED`): a later sheet or seed must not reuse these codes, or `kd_dev` is reset first; (2) the decisions still open from A5-T5 and A5-T6: `ids[]` on `GET /admin/wards` (D-146) and `@BranchScoped` for the branch routes (D-147) |
| Owner | |
| Date | 2026-11-10 |

Phase 5 gate: all steps pass, then run the review prompt
