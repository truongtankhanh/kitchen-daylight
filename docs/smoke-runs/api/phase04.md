# Phase A4 smoke run: settings, meta and reference seed

Owner checklist for task A4-T6. It runs the settings, meta and reference-seed slice of Phase A4 (A4-T1 to A4-T5) on the host against the local stack: the two new migrations, the `reference` seed (dry run, commit, re-run) and `verify reference`, the first admin created by the seed, `GET /admin/meta/config`, `GET` and `PUT /admin/app-settings` (row version, stale version, field paths, roles, the step-up of `payment`), the public `GET /meta/config`, the maintenance and minimum-version gates, the `config.changed` outbox rows, the current legal documents and a registration with them, the three test suites, the contract check and log hygiene.

**Scope:** steps 0 to 2 write to the local `kd_dev` database (the two Phase A4 migrations, eight `app_settings` rows, one placeholder Terms and one placeholder Privacy document, one `INVITED` admin `first.admin.smoke@kitchendaylight.example`); steps 3 to 10 sign that admin in, change four settings keys (`ordering`, `payment`, `maintenance`, `min_app_version`), write their audit and outbox rows and register one fictional customer. Steps 4 and 5 reuse the phase 03 accounts `staff.smoke@kitchendaylight.example` (STAFF) and `owner.smoke@kitchendaylight.example` (ADMIN, only as a mail recipient). No step changes a committed file and no step deletes data. The only long-running process is the API started in step 0 (`pnpm --filter @kd/api start`, no watcher), stopped in step 12.

## Deviations from the task text

- **Seed admin email.** The task sets `SEED_ADMIN_EMAIL=owner.smoke@kitchendaylight.example`, but that account already exists in `kd_dev` (`ACTIVE`, TOTP enrolled, its setup key and recovery codes deleted after the phase 03 run). The `first-admin` step never touches an existing user (`ON CONFLICT (email) DO NOTHING`), so step 3 could not run. The owner chose (2026-11-09) a new fictional email, `first.admin.smoke@kitchendaylight.example`. As a consequence `owner.smoke@...` is another `ACTIVE` admin, so step 5 expects **one** payment notice mail (to `owner.smoke@...`), not none.
- **`forgot` answers `202`**, not `204` (the controller's `@HttpCode(ACCEPTED)`, found by the phase 03 sheet, step 2).
- **Branches.** `kd_dev` keeps the throw-away branches `SA` and `SB` of the phase 03 sheet, so `GET /admin/meta/config` of an `ADMIN` lists those two; on a reset `kd_dev` the list is empty.
- **STAFF, not MANAGER, for `FORBIDDEN`.** The phase 03 manager had its second factor reset (phase 03 step 7, part 5) and cannot get an access token without enrolling again; the STAFF account signs in with its password alone.
- **Registration body.** Step 10 uses the `POST /auth/register` command of the phase 02 sheet (step 5) with a new email, a new password, no phone and the two placeholder document ids.
- **Gate statuses.** `MAINTENANCE` answers `503`; `UPGRADE_REQUIRED` answers `400`, not the brief's `426` (decision 0007 section 9, A4-T3 report).
- **Migrations already applied.** `kd_dev` already held `0011` and `0012` (applied 2026-11-08 23:18 UTC, while A4-T1 to A4-T5 were tested), so the first `migrate` of step 0 printed `nothing to apply` too.

## Placeholder legal text in `prod`: a go-live blocker, not a smoke failure

`seed reference` installs the committed **placeholder** Terms of Service and Privacy Policy (version `placeholder-1`, `vi`) in every tier, `prod` included, whenever no document of that type has text. In `prod`, `verify reference` **FAILs** the two `consent_documents` checks (exit 4) until the real text is published with `SEED_CONSENT_DOCUMENTS_FILE` (`tools/seed/README.md`, "Publishing the real Terms and Privacy"). **This is a go-live blocker, not a smoke failure.** This sheet runs in `dev`, where the same checks print `ok` with "(placeholder text, refused in prod)".

## How to run

- Run one step at a time, from the repository root, in order, in **terminal 1**. The API runs in **terminal 2** (step 0). Shell variables and helper functions set in terminal 1 are reused by later steps, so keep the same terminal open from start to finish.
- **Each command block can be pasted whole**, except the one-line `read` blocks: paste those alone, then type the 6-digit code shown by the authenticator app and press Enter. Run the block that follows a `read` at once (a code is valid for about 30 to 60 seconds). A helper that finds nothing prints `kdget: ...` or `kdlink: ...` on stderr and the following `echo "exit=$?"` shows a non-zero code: stop there.
- Paste the output into the empty block of the step and fill in the result. Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Secrets are never pasted into this sheet.** `kdcall` prints `***` in place of `accessToken`, `refreshToken`, `mfaToken`, `stepUpToken`, `secret`, `otpauthUri`, `recoveryCodes`, `token`, `password` and a non-null `accountNumber`; `kdcookie` prints the cookie value as `***`. The blocks marked **not pasted** print the authenticator-app secret and the recovery codes to the terminal so that you can save them: never paste their output, write "saved" instead. Replace the 6-digit codes you type with `***`. Never paste a token, a TOTP code, a recovery code, a password or the content of `.env`; the only lines this sheet reads from it are `MAIL_UI_URL`, `ADMIN_ORIGINS` and `DATABASE_URL_MIGRATOR` (step 0), and only `ADMIN_ORIGINS` (not a secret) is printed. `pnpm dev:infra` prints the `print-env.sh` block: replace it with `(print-env.sh output, passwords as ***)`. Replace home paths with `<repo>`.
- Use Node 26.13.0 (`nvm use` once in each terminal).
- The command blocks hold no comment lines and no angle-bracket placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- **Fictional values:** `PW_ADMIN` (step 0) is a throw-away password in the `CHANGE_ME_LOCAL` style (12 to 128 characters); `PW_STAFF2` is the phase 03 value of the STAFF account. `KD_ACCOUNT` is a fictional account number (its last five digits are `45678`); the bank name and holder are fictional too.
- **Authenticator app:** step 3 enrols one entry (the first admin) by typing the setup key by hand ("Enter a setup key", time based). It is a throw-away entry for `kd_dev`: delete it from the app after the sign-off.
- **Throttling:** the staff sign-in group (`/admin/auth/login`, `/admin/auth/mfa/verify`, `/admin/auth/step-up`) allows 10 per 5 minutes per IP; this sheet sends four. If any step answers `429 RATE_LIMITED`, restart the API (Ctrl-C in terminal 2, then the same `start` command; it appends to the same log) and repeat the step.
- **Admin calls** carry an `Origin` from `ADMIN_ORIGINS` and `X-Client: admin-web` (the CSRF check of decision 0008 section 10, required on every `POST /admin/auth/*`); `kdadm` adds both. The refresh token travels only in the `kd_refresh` cookie (`Path=/api/v1/admin/auth`), kept in one curl cookie jar per person (`-c` writes, `-b` sends). An access token lives 15 minutes, so every step from 4 on starts with a refresh from the jar.
- **Settings saves:** `PUT /admin/app-settings` takes `{ key, value, rowVersion }` with the **whole** camelCase value of the key. `kdput` reads the current settings first, merges the given JSON patch into the current value, sends the current `rowVersion` (or the one given) and prints the answer.
- **Resuming in a new terminal 1:** run the second block of step 0 (variables and helpers) first; later steps also need the tokens of earlier steps, so a resumed run restarts at the beginning of a step, and steps 4 to 10 need `JAR_ADMIN` to hold a live cookie (if the refresh answers `401`, sign in again with the `read` line, the login and the `mfa/verify` commands of the phase 03 sheet, step 4, block 4, with `E_ADMIN` and `PW_ADMIN` of this sheet).
- Exit codes: commands other than `curl` are followed by `echo "exit=$?"`.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-09 (00:33 to 00:40 UTC) |
| Machine / OS / chip / RAM | Owner's MacBook, macOS (Darwin 25.6.0) |
| Monorepo commit (`git rev-parse --short HEAD`) | `3d199d0`, plus this uncommitted sheet |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | `f9654b1` |
| Node / pnpm (`node --version`, `pnpm --version`) | v26.13.0 (`nvm use`) / 12.16.1 |

**Run log:** run by the coding agent on the owner's request (2026-11-09), one pass, no step repeated. Deviations from the sheet as written: (1) the two `SEED_ADMIN_*` lines were appended to the root `.env` by the agent (fictional values; `.env` is git-ignored and was never printed); (2) the TOTP codes were generated from the setup key with the `otpauth` package of `apps/api` instead of an authenticator app; the setup key, the recovery codes and the tokens stayed in a session-only scratch file, deleted after the run, and are not in this sheet; (3) the API ran as a background process with its output in `$TMPDIR/kd-api-a4.log` and was stopped with SIGINT; (4) each step ran in a fresh shell that re-read the helpers of step 0 and the saved values, so the outputs below are the step's commands without the `read` lines; (5) the step 12 checks were first written with the zsh forms `${(P)v}` and `${=RECOVERY}`, which the agent's command checker refused to parse; the sheet now uses the plain forms the run used.

## Step 0. Stack, `.env`, build, migrations and the API

Before this step, add two lines to the root `.env` by hand (fictional values only; never commit `.env`):

```text
SEED_ADMIN_EMAIL=first.admin.smoke@kitchendaylight.example
SEED_ADMIN_NAME="First Admin Smoke"
```

Terminal 1:

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
grep -c '^SEED_ADMIN_EMAIL=first\.admin\.smoke@kitchendaylight\.example$' .env; echo "exit=$?"
grep -c '^SEED_ADMIN_NAME=' .env; echo "exit=$?"
pnpm --filter "@kd/api..." build; echo "exit=$?"
pnpm --filter "@kd/seed..." build; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
pnpm --filter @kd/api migrate; echo "exit=$?"
```

Terminal 2 (stays open until step 12; `tee -a` keeps the log across a restart):

```bash
nvm use
: > "$TMPDIR/kd-api-a4.log"
pnpm --filter @kd/api start 2>&1 | tee -a "$TMPDIR/kd-api-a4.log"
```

Terminal 1, the variables and helpers used by every later step:

```bash
curl -sS -i http://127.0.0.1:3001/api/health; echo
API=http://127.0.0.1:3001/api/v1
MAIL_UI_URL="$(grep '^MAIL_UI_URL=' .env | cut -d= -f2- | tr -d '"')"
ORIGIN="$(grep '^ADMIN_ORIGINS=' .env | cut -d= -f2- | tr -d '"' | cut -d, -f1)"
ORIGIN="${ORIGIN:-http://localhost:4200}"
echo "ORIGIN=$ORIGIN"
KD_SQL_URL="$(grep '^DATABASE_URL_MIGRATOR=' .env | cut -d= -f2-)"
PW_ADMIN='CHANGE_ME_LOCAL_a4_admin_pw'
PW_STAFF2='CHANGE_ME_LOCAL_a3_staff_pw_two'
E_ADMIN=first.admin.smoke@kitchendaylight.example
E_OWNER3=owner.smoke@kitchendaylight.example
E_STAFF=staff.smoke@kitchendaylight.example
E_CUSTOMER=bao.a4.smoke@example.com
KD_ACCOUNT='000012345678'
KD_HEAD="$TMPDIR/kd-a4-head.txt"
KD_BODY="$TMPDIR/kd-a4-body.json"
KD_SETTINGS="$TMPDIR/kd-a4-settings.json"
JAR_ADMIN="$TMPDIR/kd-a4-admin.jar"
JAR_STAFF="$TMPDIR/kd-a4-staff.jar"
: > "$JAR_ADMIN"; : > "$JAR_STAFF"
kdsql() { docker exec -i kd-docker-postgres-1 psql "${KD_SQL_URL/127.0.0.1:5452/127.0.0.1:5432}" -v ON_ERROR_STOP=1 -X "$@"; }
kdshow() { node -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); if (t.trim() === "") { console.log(""); process.exit(0); } let v; try { v = JSON.parse(t); } catch { console.log(t); process.exit(0); } const hide = new Set(["accessToken", "refreshToken", "mfaToken", "stepUpToken", "secret", "otpauthUri", "recoveryCodes", "token", "password", "accountNumber"]); const m = (x) => Array.isArray(x) ? x.map(m) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, hide.has(k) && y !== null ? (Array.isArray(y) ? "*** (" + y.length + ")" : "***") : m(y)])) : x; console.log(JSON.stringify(m(v)))' "$KD_BODY"; }
kdq() { curl -sS -D "$KD_HEAD" -o "$KD_BODY" "$@"; head -n 1 "$KD_HEAD"; }
kdcall() { kdq "$@"; kdshow; }
kdadm() { kdcall -H "Origin: $ORIGIN" -H 'X-Client: admin-web' "$@"; }
kdget() { node -e 'const v = process.argv[2].split(".").reduce((o, k) => (o == null ? undefined : o[k]), JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))); if (typeof v !== "string" || v === "") { console.error("kdget: no " + process.argv[2] + " in the last body"); process.exit(1); } console.log(v)' "$KD_BODY" "$1"; }
kdcookie() { grep -i '^set-cookie:' "$KD_HEAD" | sed -E 's/(kd_refresh=)[^;]+/\1***/'; }
kdjar() { awk -F'\t' '$6 == "kd_refresh" { print $7 }' "$1"; }
kdlink() { node --input-type=module -e 'const [base, to] = process.argv.slice(1); const list = await (await fetch(base + "/api/v1/messages?limit=100")).json(); const m = list.messages.find((x) => (x.To ?? []).some((t) => t.Address.toLowerCase() === to.toLowerCase())); if (!m) { console.error("kdlink: no message to " + to); process.exit(1); } const full = await (await fetch(base + "/api/v1/message/" + m.ID)).json(); console.error("kdlink: to " + to + " | " + full.Subject); const hit = ((full.Text ?? "") + " " + (full.HTML ?? "")).match(/#token=([A-Za-z0-9_-]+)/); if (!hit) { console.error("kdlink: no #token= in the message"); process.exit(1); } console.log(hit[1])' "$MAIL_UI_URL" "$1"; }
kdmailsto() { node --input-type=module -e 'const [base, to] = process.argv.slice(1); const list = await (await fetch(base + "/api/v1/messages?limit=200")).json(); const mine = list.messages.filter((x) => (x.To ?? []).some((t) => t.Address.toLowerCase() === to.toLowerCase())); console.log(to + ": " + mine.length + " message(s), newest: " + (mine[0] ? mine[0].Subject : "none"))' "$MAIL_UI_URL" "$1"; }
kdmailgrep() { node --input-type=module -e 'const [base, to, needle] = process.argv.slice(1); const list = await (await fetch(base + "/api/v1/messages?limit=200")).json(); const m = list.messages.find((x) => (x.To ?? []).some((t) => t.Address.toLowerCase() === to.toLowerCase())); if (!m) { console.log("0 (no message)"); process.exit(0); } const full = await (await fetch(base + "/api/v1/message/" + m.ID)).json(); console.log(((full.Text ?? "") + " " + (full.HTML ?? "")).split(needle).length - 1)' "$MAIL_UI_URL" "$1" "$2"; }
kdload() { curl -sS -o "$KD_SETTINGS" "$API/admin/app-settings" -H "Authorization: Bearer $ACCESS_ADMIN"; }
kdsnap() { kdq "$API/admin/app-settings" -H "Authorization: Bearer $ACCESS_ADMIN"; cp "$KD_BODY" "$KD_SETTINGS"; node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); for (const [k, v] of Object.entries(r)) { if (k === "security") { console.log("security " + JSON.stringify(v)); } else if (v && typeof v === "object" && "rowVersion" in v) { console.log(k + " rowVersion=" + v.rowVersion + " updatedBy=" + (v.updatedBy ? v.updatedBy.name : "null") + " updatedAt=" + v.updatedAt); } else { console.log(k + " " + JSON.stringify(v)); } }' "$KD_SETTINGS"; }
kdval() { node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; const v = r && r.value; console.log(JSON.stringify(v && "accountNumber" in v && v.accountNumber !== null ? { ...v, accountNumber: "***" } : v))' "$KD_SETTINGS" "$1"; }
kdbody() { node -e 'const fs = require("fs"); const [file, key, patch, ver] = process.argv.slice(1); const all = JSON.parse(fs.readFileSync(file, "utf8")); const merge = (a, b) => b && typeof b === "object" && !Array.isArray(b) && a && typeof a === "object" ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, k in b ? merge(a[k], b[k]) : a[k]])) : b; console.log(JSON.stringify({ key, value: merge(all[key].value, JSON.parse(patch)), rowVersion: ver === undefined || ver === "" ? all[key].rowVersion : Number(ver) }))' "$KD_SETTINGS" "$@"; }
kdput() { local key="$1" patch="$2" ver="$3"; shift 3; kdload; kdadm -X PUT "$API/admin/app-settings" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' "$@" -d "$(kdbody "$key" "$patch" "$ver")"; }
kdrefresh() { kdadm -X POST "$API/admin/auth/refresh" -b "$JAR_ADMIN" -c "$JAR_ADMIN"; ACCESS_ADMIN="$(kdget accessToken)"; echo "exit=$?"; }
kddoc() { node -e 'const want = process.argv[2]; const out = []; const walk = (x) => { if (Array.isArray(x)) { x.forEach(walk); } else if (x && typeof x === "object") { if (typeof x.id === "string" && typeof x.type === "string") { out.push(x); } Object.values(x).forEach(walk); } }; walk(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))); if (want) { const d = out.find((x) => x.type === want); if (!d) { console.error("kddoc: no " + want); process.exit(1); } console.log(d.id); } else { for (const d of out) console.log(d.type, d.id, d.version, d.locale); }' "$KD_BODY" "$1"; }
```

- `kdcall` runs `curl` with the given arguments, saves the headers and the body, and prints the status line and the body with every secret field as `***`. `kdq` prints the status line only. `kdadm` is `kdcall` with the `Origin` and `X-Client: admin-web` headers. `kdsql` runs `psql` as `kd_migrator` inside the Postgres container (the URL is never printed), as in the phase 03 sheet.
- `kdget PATH` prints the string field `PATH` of the last body. `kdcookie` prints the `Set-Cookie` header of the last response with the value as `***`. `kdjar JAR` prints the `kd_refresh` value held in a cookie jar (used in variables, never printed). `kdrefresh` refreshes the admin's access token from `JAR_ADMIN`.
- `kdlink EMAIL` prints the token of the `#token=` link of the newest Mailpit message to `EMAIL` (its subject on stderr). `kdmailsto EMAIL` prints how many messages `EMAIL` has and the newest subject. `kdmailgrep EMAIL TEXT` counts `TEXT` in the newest message to `EMAIL`.
- `kdsnap` runs `GET /admin/app-settings` as the admin, keeps the body in `KD_SETTINGS`, and prints one line per key (`rowVersion`, `updatedBy` name, `updatedAt`) and the `security` block. `kdval KEY` prints the value of `KEY` from the last snapshot (a non-null `accountNumber` as `***`).
- `kdput KEY PATCH VERSION [curl args]` saves `KEY` with the current value merged with the JSON `PATCH`; `VERSION` `''` sends the current `rowVersion`, a number sends that one.
- `kddoc` prints `type id version locale` for each document of the last body; `kddoc TYPE` prints the id of that type.

Expected:

- Every service healthy; both `grep -c` print `1` (if not, fix the two `.env` lines and run again).
- Both builds exit 0.
- The first `migrate` applies the two Phase A4 migrations (`0011` and `0012`; phase 03 left ten applied) and exits 0, or prints `migrate: nothing to apply` when `kd_dev` already holds them (check `SELECT version, name FROM public.schema_migrations ORDER BY version DESC LIMIT 2` with `kdsql`); the second prints `migrate: nothing to apply` and `exit=0`.
- The API log ends with `Nest application successfully started` (it prints no "listening" line); `GET /api/health` answers `HTTP/1.1 200`; `ORIGIN=` shows one `http://` origin (`http://localhost:4200` when the root `.env` sets no `ADMIN_ORIGINS`). The other lines print nothing.

Result (pass / fail): **pass** (migrations already applied, see Notes)

```text
Now using node v26.13.0
$ scripts/dev-infra.sh up
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
$ tsc -p tsconfig.build.json
exit=0
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
$ node dist/cli.js migrate
migrate: nothing to apply
exit=0
12|consent_document_content|2026-11-08 23:18:55.635755+00
11|app_settings|2026-11-08 23:18:55.614259+00
{"level":30,...,"context":"NestApplication","msg":"Nest application successfully started"}
HTTP/1.1 200 OK
X-Request-Id: cde5c855-6ff7-46f1-b8c6-940f7d529574
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42
{"status":"ok","checks":{"database":"up"}}
ORIGIN=http://localhost:4200
```

Notes: `0011_app_settings` and `0012_consent_document_content` were already in `schema_migrations` of `kd_dev` (applied 2026-11-08 23:18 UTC while the A4 tasks were tested), so the first `migrate` also printed `nothing to apply`; the integration suite of step 11 applies all twelve to its scratch database. The root `.env` sets no `ADMIN_ORIGINS`.

## Step 1. Reference seed: dry run, commit, re-run

Before (read only):

```bash
kdsql -At -c 'SELECT count(*) FROM public.app_settings'; echo "exit=$?"
kdsql -At -c 'SELECT type, locale, version, published_at FROM public.consent_documents ORDER BY published_at, type' | tee "$TMPDIR/kd-a4-consent-before.txt"; echo "exit=$?"
kdsql -At -c "SELECT count(*) FROM public.users WHERE email = 'first.admin.smoke@kitchendaylight.example'"; echo "exit=$?"
```

Dry run, then the same reads:

```bash
pnpm --filter @kd/seed seed reference; echo "exit=$?"
kdsql -At -c 'SELECT count(*) FROM public.app_settings'; echo "exit=$?"
kdsql -At -c 'SELECT type, locale, version, published_at FROM public.consent_documents ORDER BY published_at, type' > "$TMPDIR/kd-a4-consent-dry.txt"; diff "$TMPDIR/kd-a4-consent-before.txt" "$TMPDIR/kd-a4-consent-dry.txt"; echo "consent diff exit=$?"
kdsql -At -c "SELECT count(*) FROM public.users WHERE email = 'first.admin.smoke@kitchendaylight.example'"; echo "exit=$?"
```

Commit, then the same command again:

```bash
pnpm --filter @kd/seed seed reference --commit; echo "exit=$?"
pnpm --filter @kd/seed seed reference --commit; echo "exit=$?"
kdsql -At -c 'SELECT count(*) FROM public.app_settings'; echo "exit=$?"
kdsql -At -c 'SELECT type, locale, version FROM public.consent_documents ORDER BY published_at, type'; echo "exit=$?"
kdsql -At -c "SELECT email, role, status, password_hash IS NULL FROM public.users WHERE email = 'first.admin.smoke@kitchendaylight.example'"; echo "exit=$?"
```

Expected:

- Before: `0` settings rows; the consent list holds only the throw-away rows of the earlier sheets (write how many in "Notes"); `0` users with the first-admin email.
- The dry run prints one line per step and table (`step  table  inserted N  updated N  unchanged N  stale N`) and `exit=0`: `geography` `inserted 0  updated 0` for `provinces` and `wards`; `app-settings` `app_settings` `inserted 8  updated 0`; `consent-documents` `consent_documents` `inserted 2` (one placeholder per type: the earlier rows predate migration 0012 and have no text, so they do not block; a type that already has text shows `inserted 0`); `first-admin` `users` `inserted 1`, naming the email domain only.
- After the dry run nothing changed: `0` settings rows, `consent diff exit=0` with no diff line, `0` users.
- The first `--commit` prints the same counts and `exit=0`. The second prints `inserted 0  updated 0` on every line and `exit=0`.
- After: `8`; the consent list ends with `TERMS_OF_SERVICE|vi|placeholder-1` and `PRIVACY_POLICY|vi|placeholder-1` (in either order); the user prints `first.admin.smoke@kitchendaylight.example|ADMIN|INVITED|t`.

Result (pass / fail): **pass**

```text
0
exit=0
TERMS_OF_SERVICE|vi|smoke-a2|2026-11-07 04:46:54.097146+00
PRIVACY_POLICY|vi|smoke-a2|2026-11-07 04:46:54.097146+00
exit=0
0
exit=0
$ node --env-file-if-exists=../../.env dist/cli.js reference
seed reference: dry run (rolled back at the end; --commit writes)
  geography  provinces  inserted 0  updated 0  unchanged 34  stale 0
  geography  wards  inserted 0  updated 0  unchanged 3321  stale 0
  app-settings  app_settings  inserted 8  updated 0  unchanged 0  stale 0
  consent-documents  consent_documents  inserted 2  updated 0  unchanged 0  stale 0  (placeholder text, not legal text)
  first-admin  users  inserted 1  updated 0  unchanged 0  stale 0  (ADMIN invited @kitchendaylight.example)
seed reference: rolled back (dry run)
exit=0
0
exit=0
consent diff exit=0
0
exit=0
$ node --env-file-if-exists=../../.env dist/cli.js reference --commit
seed reference: commit
  geography  provinces  inserted 0  updated 0  unchanged 34  stale 0
  geography  wards  inserted 0  updated 0  unchanged 3321  stale 0
  app-settings  app_settings  inserted 8  updated 0  unchanged 0  stale 0
  consent-documents  consent_documents  inserted 2  updated 0  unchanged 0  stale 0  (placeholder text, not legal text)
  first-admin  users  inserted 1  updated 0  unchanged 0  stale 0  (ADMIN invited @kitchendaylight.example)
seed reference: committed
exit=0
$ node --env-file-if-exists=../../.env dist/cli.js reference --commit
seed reference: commit
  geography  provinces  inserted 0  updated 0  unchanged 34  stale 0
  geography  wards  inserted 0  updated 0  unchanged 3321  stale 0
  app-settings  app_settings  inserted 0  updated 0  unchanged 8  stale 0
  consent-documents  consent_documents  inserted 0  updated 0  unchanged 2  stale 0
  first-admin  users  inserted 0  updated 0  unchanged 1  stale 0  (a user @kitchendaylight.example exists, left as it is)
seed reference: committed
exit=0
8
exit=0
TERMS_OF_SERVICE|vi|smoke-a2
PRIVACY_POLICY|vi|smoke-a2
TERMS_OF_SERVICE|vi|placeholder-1
PRIVACY_POLICY|vi|placeholder-1
exit=0
first.admin.smoke@kitchendaylight.example|ADMIN|INVITED|t
exit=0
```

Notes (number of earlier consent rows): two, the phase 02 `smoke-a2` rows (no text), still the only ones after the dry run. The placeholders were published after them, so they are current (the phase 02 follow-up on `published_at` holds).

## Step 2. `verify reference` and the `ordering` defaults

```bash
pnpm --filter @kd/seed seed verify reference; echo "exit=$?"
kdsql -At -c "SELECT value FROM public.app_settings WHERE key = 'ordering'"; echo "exit=$?"
```

Expected:

- One `ok` line per check (province and ward counts, wards have their province, the eight `app_settings` keys, `consent_documents TERMS_OF_SERVICE vi` and `PRIVACY_POLICY vi` with "(placeholder text, refused in prod)", `admin users`), then `verify reference: passed` and `exit=0`. No `FAIL` line. In `prod` the two `consent_documents` lines would FAIL: a go-live blocker, not a smoke failure (see the section above).
- The stored `ordering` value (snake_case) holds the WA16 figures: board thresholds `accept` warn `5` late `10`, `ready` warn `15` late `25`; ready-unserved warn `5` late `10`; board refetch `15` seconds; call hint `10` minutes; auto-cancel `null` (off). Write any other figure in "Notes".

Result (pass / fail): **pass**

```text
$ node --env-file-if-exists=../../.env dist/cli.js verify reference
verify reference: APP_ENV dev
  ok    provinces count
  ok    wards count
  ok    wards have their province
  ok    app_settings brand
  ok    app_settings reports
  ok    app_settings min_app_version
  ok    app_settings maintenance
  ok    app_settings feature_flags
  ok    app_settings payment
  ok    app_settings ordering
  ok    app_settings loyalty
  ok    consent_documents TERMS_OF_SERVICE vi (placeholder text, refused in prod)
  ok    consent_documents PRIVACY_POLICY vi (placeholder text, refused in prod)
  ok    admin users
verify reference: passed
exit=0
{"item_note_max": 200, "max_cart_lines": 30, "board_thresholds": {"ready": {"late": 25, "warn": 15}, "accept": {"late": 10, "warn": 5}}, "call_hint_minutes": 10, "max_item_quantity": 20, "review_window_days": 7, "list_max_range_days": 92, "board_refetch_seconds": 15, "schedule_max_days_ahead": 3, "schedule_min_lead_minutes": 30, "ready_unserved_late_minutes": 10, "ready_unserved_warn_minutes": 5, "auto_cancel_unaccepted_minutes": null}
exit=0
```

Notes: every WA16 figure matches (5 and 10, 15 and 25, ready-unserved 5 and 10, refetch 15, call hint 10, auto-cancel `null`).

## Step 3. The first admin: invitation, password, TOTP, meta config

Block 1 of 5, the invitation and the password:

```bash
kdmailsto "$E_ADMIN"
kdadm -X POST "$API/admin/auth/password/forgot" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\"}"
sleep 3
kdmailsto "$E_ADMIN"
LINK_ADMIN="$(kdlink "$E_ADMIN")"; echo "exit=$?"
kdadm -X POST "$API/admin/auth/password/set" -H 'Content-Type: application/json' -d "{\"token\":\"$LINK_ADMIN\",\"password\":\"$PW_ADMIN\"}"
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\",\"password\":\"$PW_ADMIN\",\"deviceLabel\":\"smoke-a4-admin\"}"
MFA_TOKEN="$(kdget mfaToken)"; echo "exit=$?"
kdcall -X POST "$API/me/mfa/setup" -H "Authorization: Bearer $MFA_TOKEN" -H 'X-Client: admin-web'
MFA_SECRET="$(kdget secret)"; echo "exit=$?"
```

Block 2 of 5, **not pasted**: prints the setup key. In the authenticator app choose "Enter a setup key", account `first.admin.smoke (kd_dev)`, this key, time based. Write "saved" in the result.

```bash
echo "$MFA_SECRET"
```

Block 3 of 5, alone, then type the current code of the new entry:

```bash
read "KD_TOTP?Authenticator code (first admin): "
```

Block 4 of 5, at once after block 3:

```bash
kdadm -X POST "$API/me/mfa/confirm" -H "Authorization: Bearer $MFA_TOKEN" -H 'Content-Type: application/json' -c "$JAR_ADMIN" -d "{\"code\":\"$KD_TOTP\"}"
kdcookie
RECOVERY="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).recoveryCodes.join(" "))' "$KD_BODY")"; echo "exit=$?"
ACCESS_ADMIN="$(kdget session.accessToken)"; echo "exit=$?"
ADMIN_ID="$(kdget session.user.id)"; echo "exit=$?"
kdcall "$API/admin/meta/config" -H "Authorization: Bearer $ACCESS_ADMIN"
```

Block 5 of 5, **not pasted**: print the ten recovery codes and save them in your password manager (write "saved" in the result):

```bash
echo "$RECOVERY" | tr ' ' '\n'
```

Expected:

- The mailbox of `first.admin.smoke@...` grows from `0` to `1` message; `forgot` answers `HTTP/1.1 202` with no body (the account is `INVITED`, so it receives a fresh invitation); `kdlink` prints the invitation subject ("Lời mời tham gia trang quản trị Kitchen Daylight") and `exit=0`.
- The password set answers `HTTP/1.1 204`.
- Login answers `HTTP/1.1 403`, `"code":"MFA_REQUIRED"`, `"mfaToken":"***"`, `"mfaEnrolled":false`, `expiresIn` about 600; setup answers `200` with `"otpauthUri":"***","secret":"***"`.
- Confirm answers `HTTP/1.1 200` with `"recoveryCodes":"*** (10)"` and `session` (`accessToken` `***`, `user` with `"role":"ADMIN"` and `"displayName":"First Admin Smoke"`), and `Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; ...; HttpOnly; SameSite=Strict`. Every `exit=0`.
- `GET /admin/meta/config` answers `HTTP/1.1 200` with `user` (`"role":"ADMIN"`, `"mfaEnabled":true`), `branches` with only the phase 03 throw-away `SA` and `SB` (empty on a reset `kd_dev`; no real branch yet), a non-empty `permissions` list, `features` with the eight flags (`ordering`, `delivery`, `reservations`, `loyalty`, `vouchers`, `promotions`, `charts`, `einvoice`), `ordering` with the step 2 board thresholds and `boardRefetchSeconds` 15, `payment` all `null`, `brand`, `reports` (`"businessDayStartsAt":"04:00"`), `maintenance` (`"enabled":false`) and `navCountsRefetchSeconds`.

Result (pass / fail): **pass**

```text
first.admin.smoke@kitchendaylight.example: 0 message(s), newest: none
HTTP/1.1 202 Accepted

first.admin.smoke@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
kdlink: to first.admin.smoke@kitchendaylight.example | Lời mời tham gia trang quản trị Kitchen Daylight
exit=0
HTTP/1.1 204 No Content

HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":false,"expiresIn":600,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
exit=0
HTTP/1.1 200 OK
{"otpauthUri":"***","secret":"***"}
exit=0
(setup key: saved)
HTTP/1.1 200 OK
{"recoveryCodes":"*** (10)","session":{"accessToken":"***","expiresIn":899,"user":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","displayName":"First Admin Smoke","role":"ADMIN"}}}
Set-Cookie: kd_refresh=***; Path=/api/v1/admin/auth; Max-Age=86399; HttpOnly; SameSite=Strict
exit=0
exit=0
exit=0
HTTP/1.1 200 OK
{"user":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","displayName":"First Admin Smoke","role":"ADMIN","mfaEnabled":true},"branches":[{"id":"01a1b5a2-9764-7b0c-91aa-b34451be9034","code":"SA","name":"Smoke A3 SA","status":"ACTIVE"},{"id":"01a1b5a2-976a-70bd-9f58-e8453bff462f","code":"SB","name":"Smoke A3 SB","status":"ACTIVE"}],"permissions":["orders.read","orders.write","menu.write","branches.write","reviews.read","reviews.moderate","reports.read","exports.read","promotions.write","admin.users","admin.settings","admin.email","admin.audit"],"features":{"ordering":true,"delivery":true,"reservations":false,"loyalty":false,"vouchers":false,"promotions":false,"charts":false,"einvoice":false},"ordering":{"boardThresholds":{"accept":{"warn":5,"late":10},"ready":{"warn":15,"late":25}},"boardRefetchSeconds":15},"payment":{"bankName":null,"accountNumber":null,"holder":null,"bankCode":null,"qrUrl":null},"brand":{"hotline":null,"receipt":{"paperWidth":80}},"reports":{"businessDayStartsAt":"04:00"},"maintenance":{"enabled":false,"message":null,"expectedBackAt":null,"since":null},"navCountsRefetchSeconds":30}
(recovery codes: saved)
```

Notes (setup key and recovery codes: "saved"; write the admin id): saved (session scratch file, deleted after the run; see "Run log"). Admin id `01a1bdbb-6875-70f3-af28-6ccc5ebe213a`. `permissions` has the thirteen `ADMIN` keys without `invoices.manage` (`einvoice` is off, D-112). `branches` lists only the phase 03 `SA` and `SB`.

## Step 4. `GET` and `PUT /admin/app-settings`: versions, stale, field path, roles

Block 1 of 2, the list and three saves:

```bash
kdrefresh
kdsnap
kdval ordering
kdput ordering '{"itemNoteMax":150}' ''
kdput ordering '{"itemNoteMax":140}' 1
kdput ordering '{"boardThresholds":{"accept":{"warn":12}}}' ''
kdsnap
```

Block 2 of 2, a STAFF token (the phase 03 account, password `PW_STAFF2`):

```bash
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -c "$JAR_STAFF" -d "{\"email\":\"$E_STAFF\",\"password\":\"$PW_STAFF2\",\"deviceLabel\":\"smoke-a4-staff\"}"
ACCESS_STAFF="$(kdget accessToken)"; echo "exit=$?"
kdcall "$API/admin/app-settings" -H "Authorization: Bearer $ACCESS_STAFF"
kdcall -X PUT "$API/admin/app-settings" -H "Authorization: Bearer $ACCESS_STAFF" -H 'Content-Type: application/json' -d "$(kdbody ordering '{"itemNoteMax":120}' '')"
```

Expected:

- The refresh answers `200` and `exit=0`.
- The first `kdsnap` answers `HTTP/1.1 200` and prints eight key lines (`brand`, `reports`, `minAppVersion`, `maintenance`, `featureFlags`, `payment`, `ordering`, `loyalty`), each `rowVersion=1 updatedBy=null` (written by the seed), and a `security` line (`totpRequiredRoles`, `staffPasswordMinLength`, `accessTokenMinutes`, `sessionIdleDays`, `sessionAbsoluteDays`, `inviteHours`, `resetMinutes`): read only, not a key a `PUT` accepts.
- `kdval ordering` shows the same figures as the stored value of step 2, in camelCase (`boardThresholds`, `boardRefetchSeconds` 15, `callHintMinutes` 10, `autoCancelUnacceptedMinutes` null, `itemNoteMax` 200). A difference is the seed and API copies drifting (api-divergences D-122): write it in "Notes".
- The valid save answers `HTTP/1.1 200` with `"key":"ordering"`, `"rowVersion":2`, `updatedBy` `{"id":"...","name":"First Admin Smoke"}`, `updatedAt` and the value with `"itemNoteMax":150`.
- The save with the old `rowVersion` 1 answers `HTTP/1.1 409`, `"code":"STALE_VERSION"`, with `current` holding `"rowVersion":2`, `updatedBy` naming `First Admin Smoke`, `updatedAt` and the value with `"itemNoteMax":150` (the value of the stale save is not stored).
- The board threshold with warn `12` above late `10` answers `HTTP/1.1 400`, `"code":"VALIDATION_FAILED"`, with an error `{"field":"ordering.boardThresholds.accept.warn","code":"MUST_BE_LESS_THAN_LATE",...}` (the full camelCase path).
- The second `kdsnap` shows `ordering rowVersion=2 updatedBy=First Admin Smoke` and every other key still `rowVersion=1`.
- Block 2: the STAFF login answers `HTTP/1.1 200` with `"role":"STAFF"` and `exit=0`; `GET` and `PUT` as STAFF each answer `HTTP/1.1 403`, `"code":"FORBIDDEN"`. If the STAFF login answers `401`, the phase 03 account is gone or its password changed: write it in "Notes" and skip block 2.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","displayName":"First Admin Smoke","role":"ADMIN"}}
exit=0
HTTP/1.1 200 OK
brand rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
reports rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
minAppVersion rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
maintenance rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
featureFlags rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
payment rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
ordering rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
loyalty rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
security {"totpRequiredRoles":["MANAGER","ADMIN"],"staffPasswordMinLength":12,"accessTokenMinutes":15,"sessionIdleDays":1,"sessionAbsoluteDays":7,"inviteHours":48,"resetMinutes":30}
{"maxItemQuantity":20,"maxCartLines":30,"itemNoteMax":200,"scheduleMinLeadMinutes":30,"scheduleMaxDaysAhead":3,"reviewWindowDays":7,"autoCancelUnacceptedMinutes":null,"boardThresholds":{"accept":{"warn":5,"late":10},"ready":{"warn":15,"late":25}},"boardRefetchSeconds":15,"readyUnservedWarnMinutes":5,"readyUnservedLateMinutes":10,"callHintMinutes":10,"listMaxRangeDays":92}
HTTP/1.1 200 OK
{"key":"ordering","value":{"maxItemQuantity":20,"maxCartLines":30,"itemNoteMax":150,...,"listMaxRangeDays":92},"rowVersion":2,"updatedBy":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","name":"First Admin Smoke"},"updatedAt":"2026-11-09T00:36:12.945Z"}
HTTP/1.1 409 Conflict
{"current":{"rowVersion":2,"updatedBy":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","name":"First Admin Smoke"},"updatedAt":"2026-11-09T00:36:12.945Z","value":{"maxItemQuantity":20,"maxCartLines":30,"itemNoteMax":150,...}},"type":"about:blank","title":"Conflict","status":409,"code":"STALE_VERSION","detail":"The setting was changed by someone else."}
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"code":"VALIDATION_FAILED","errors":[{"field":"ordering.boardThresholds.accept.warn","code":"MUST_BE_LESS_THAN_LATE","message":"must be less than the late threshold"}]}
HTTP/1.1 200 OK
brand rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
reports rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
minAppVersion rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
maintenance rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
featureFlags rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
payment rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
ordering rowVersion=2 updatedBy=First Admin Smoke updatedAt=2026-11-09T00:36:12.945Z
loyalty rowVersion=1 updatedBy=null updatedAt=2026-11-09T00:35:38.187Z
security {"totpRequiredRoles":["MANAGER","ADMIN"],"staffPasswordMinLength":12,"accessTokenMinutes":15,"sessionIdleDays":1,"sessionAbsoluteDays":7,"inviteHours":48,"resetMinutes":30}
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1b5a4-141b-7f01-9106-5dd22746ad35","displayName":"Staff Smoke","role":"STAFF"}}
exit=0
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN"}
```

Notes: the seeded rows carry `updatedAt` (the seed time) with `updatedBy` `null`. The camelCase `ordering` value of the API equals the snake_case row of step 2: no drift between the seed and API copies (D-122). The repeated `ordering` values are shortened with `...`.

## Step 5. `payment`: the step-up, the notice mail, the audit diff

Block 1 of 3, the save without a step-up token:

```bash
kdrefresh
PAY="{\"bankName\":\"Smoke Test Bank\",\"accountNumber\":\"$KD_ACCOUNT\",\"accountHolder\":\"KITCHEN DAYLIGHT SMOKE\",\"transferNoteRule\":\"Order number\"}"
kdmailsto "$E_OWNER3"
kdput payment "$PAY" ''
```

Block 2 of 3: wait until the app shows a code other than the one of step 3, paste this line alone and type it:

```bash
read "KD_TOTP?Authenticator code (first admin, a new one): "
```

Block 3 of 3, at once after block 2:

```bash
kdadm -X POST "$API/admin/auth/step-up" -H "Authorization: Bearer $ACCESS_ADMIN" -H 'Content-Type: application/json' -d "{\"code\":\"$KD_TOTP\",\"purpose\":\"settings.payment\"}"
STEP_UP="$(kdget stepUpToken)"; echo "exit=$?"
kdput payment "$PAY" '' -H "X-Step-Up-Token: $STEP_UP"
sleep 3
kdmailsto "$E_OWNER3"
kdmailsto "$E_ADMIN"
echo "full number in notice: $(kdmailgrep "$E_OWNER3" "$KD_ACCOUNT") | last 5 in notice: $(kdmailgrep "$E_OWNER3" 45678)"
kdsql -At -c "SELECT diff FROM audit_logs WHERE action = 'settings.change' ORDER BY created_at DESC LIMIT 1"; echo "exit=$?"
kdsql -At -c "SELECT count(*) FROM public.audit_logs WHERE strpos(diff::text, '$KD_ACCOUNT') > 0"; echo "exit=$?"
```

Expected:

- The refresh answers `200`. Without `X-Step-Up-Token`, `PUT payment` answers `HTTP/1.1 403`, `"code":"FORBIDDEN"` (detail "The payment key needs a step-up token."), and nothing is saved.
- The step-up answers `HTTP/1.1 200` with `"stepUpToken":"***"` and `expiresAt` about 5 minutes ahead; `exit=0`. If it answers `400 CODE_INVALID`, the code was already used: repeat blocks 2 and 3 with the next code and say so in "Notes".
- The save with the token answers `HTTP/1.1 200` with `"key":"payment"`, `"rowVersion":2` and the value with `"accountNumber":"***"` and the fictional bank name and holder.
- Mail: the mailbox of `owner.smoke@...` (the other `ACTIVE` admin, see "Deviations") grows by 1 and its newest subject is the payment settings notice; the actor `first.admin.smoke@...` gets no notice (its count stays `1`). With no other active admin in `kd_dev` the count would not change. `full number in notice: 0 | last 5 in notice: 1` (or more).
- The audit diff holds `rowVersion` `{"from": 1, "to": 2}` and `before` and `after`, where the account number shows only its last five digits (`45678`, under `accountNumberLast5` or as the sanitizer writes it) and never the full number; the count of rows holding the full number is `0`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","displayName":"First Admin Smoke","role":"ADMIN"}}
exit=0
owner.smoke@kitchendaylight.example: 0 message(s), newest: none
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"code":"FORBIDDEN","detail":"The payment key needs a step-up token."}
HTTP/1.1 200 OK
{"stepUpToken":"***","expiresAt":"2026-11-09T00:41:33.000Z"}
exit=0
HTTP/1.1 200 OK
{"key":"payment","value":{"bankName":"Smoke Test Bank","accountNumber":"***","accountHolder":"KITCHEN DAYLIGHT SMOKE","transferNoteRule":"Order number","bankCode":null,"qrMediaId":null},"rowVersion":2,"updatedBy":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","name":"First Admin Smoke"},"updatedAt":"2026-11-09T00:36:33.151Z"}
owner.smoke@kitchendaylight.example: 1 message(s), newest: Thông tin chuyển khoản của nhà hàng vừa được thay đổi
first.admin.smoke@kitchendaylight.example: 1 message(s), newest: Lời mời tham gia trang quản trị Kitchen Daylight
full number in notice: 0 | last 5 in notice: 1
{"after": {"bankCode": null, "bankName": "Smoke Test Bank", "qrMediaId": null, "accountHolder": "KITCHEN DAYLIGHT SMOKE", "transferNoteRule": "Order number", "accountNumberLast5": "45678"}, "before": {"bankCode": null, "bankName": null, "qrMediaId": null, "accountHolder": null, "transferNoteRule": null, "accountNumberLast5": null}, "rowVersion": {"to": 2, "from": 1}}
exit=0
0
exit=0
```

Notes (write the notice subject): "Thông tin chuyển khoản của nhà hàng vừa được thay đổi", to `owner.smoke@...` only. The `owner.smoke@...` mailbox held no earlier message (Mailpit no longer holds the phase 03 mails). The step-up code was the next 30-second step after the confirm of step 3.

## Step 6. Public `GET /meta/config`

```bash
kdcall "$API/meta/config"
grep -cE 'Smoke Test Bank|KITCHEN DAYLIGHT SMOKE|accountNumber|accountHolder|bankName|bankCode|transferNoteRule' "$KD_BODY"
grep -cF -- "$KD_ACCOUNT" "$KD_BODY"
```

Expected: `HTTP/1.1 200` without a token, with `brand`, `minAppVersion` (`0.0.0` both), `maintenance` (`"enabled":false`), `featureFlags` (four flags: `ordering`, `delivery`, `reservations`, `loyalty`), `ordering` (with `"itemNoteMax":150` of step 4), `payment` `{"bankTransferEnabled":true}` (the bank name, account number and holder are all filled), `loyalty` (all `null`), `"cdnBaseUrl":null`, `"mapStyleUrl":null` (expected for now) and `attributions` `[]`. Both counts `0`: no bank detail at all.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"brand":{"name":"Kitchen Daylight","logoUrl":null,"hotline":null},"minAppVersion":{"ios":"0.0.0","android":"0.0.0"},"maintenance":{"enabled":false,"message":null,"expectedBackAt":null,"since":null},"featureFlags":{"ordering":true,"delivery":true,"reservations":false,"loyalty":false},"ordering":{"maxItemQuantity":20,"maxCartLines":30,"itemNoteMax":150,"scheduleMinLeadMinutes":30,"scheduleMaxDaysAhead":3,"callHintMinutes":10,"reviewWindowDays":7},"payment":{"bankTransferEnabled":true},"loyalty":{"earnVndPerPoint":null,"redeemVndPerPoint":null,"minRedeemPoints":null,"expiryMonths":null},"cdnBaseUrl":null,"mapStyleUrl":null,"attributions":[]}
0
0
```

Notes: none.

## Step 7. Maintenance gate

Block 1 of 2, maintenance on, then the blocked and the exempt paths:

```bash
kdrefresh
kdput maintenance '{"enabled":true,"message":"Smoke A4 maintenance"}' ''
kdcall "$API/provinces"
kdcall "$API/legal/documents/current"
kdq "$API/meta/config"; node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).maintenance))' "$KD_BODY"
kdq http://127.0.0.1:3001/api/health
kdadm -X POST "$API/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$E_ADMIN\",\"password\":\"$PW_ADMIN\",\"deviceLabel\":\"smoke-a4-admin\"}"
kdq "$API/admin/app-settings" -H "Authorization: Bearer $ACCESS_ADMIN"
```

Block 2 of 2, maintenance off, then `/provinces` polled once a second for at most 5 seconds:

```bash
kdput maintenance '{"enabled":false,"message":null}' ''
for i in 1 2 3 4 5; do c="$(curl -sS -o /dev/null -w '%{http_code}' "$API/provinces")"; echo "t=${i}s status=$c"; [ "$c" = 200 ] && break; sleep 1; done
```

Expected:

- The save answers `HTTP/1.1 200`, `"key":"maintenance"`, `"rowVersion":2`, `"enabled":true`.
- `GET /provinces` and `GET /legal/documents/current` each answer `HTTP/1.1 503` with `"code":"MAINTENANCE"` and the message.
- `GET /meta/config` answers `HTTP/1.1 200` and prints the maintenance object with `"enabled":true` and the message; `/api/health` answers `HTTP/1.1 200`; the admin login answers `HTTP/1.1 403` `"code":"MFA_REQUIRED"` (the gate let it through: the sign-in stops at the second step, as expected); `GET /admin/app-settings` answers `HTTP/1.1 200`.
- Block 2: the save answers `200` with `"rowVersion":3` and `"enabled":false`; the loop prints `status=200` within 5 lines (normally `t=1s`).

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","displayName":"First Admin Smoke","role":"ADMIN"}}
exit=0
HTTP/1.1 200 OK
{"key":"maintenance","value":{"enabled":true,"message":"Smoke A4 maintenance","expectedBackAt":null,"since":null},"rowVersion":2,"updatedBy":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","name":"First Admin Smoke"},"updatedAt":"2026-11-09T00:36:50.511Z"}
HTTP/1.1 503 Service Unavailable
{"message":"Smoke A4 maintenance","expectedBackAt":null,"type":"about:blank","title":"Service Unavailable","status":503,"code":"MAINTENANCE","detail":"The service is under maintenance."}
HTTP/1.1 503 Service Unavailable
{"message":"Smoke A4 maintenance","expectedBackAt":null,"type":"about:blank","title":"Service Unavailable","status":503,"code":"MAINTENANCE","detail":"The service is under maintenance."}
HTTP/1.1 200 OK
{"enabled":true,"message":"Smoke A4 maintenance","expectedBackAt":null,"since":null}
HTTP/1.1 200 OK
HTTP/1.1 403 Forbidden
{"mfaToken":"***","mfaEnrolled":true,"expiresIn":300,"type":"about:blank","title":"Forbidden","status":403,"code":"MFA_REQUIRED"}
HTTP/1.1 200 OK
HTTP/1.1 200 OK
{"key":"maintenance","value":{"enabled":false,"message":null,"expectedBackAt":null,"since":null},"rowVersion":3,"updatedBy":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","name":"First Admin Smoke"},"updatedAt":"2026-11-09T00:36:50.818Z"}
t=1s status=200
```

Notes (status of `MAINTENANCE`): `503`. `since` stays `null` when maintenance is switched on: the server does not fill it, it stores what the admin sends (raised for the review). `/provinces` answered `200` on the first poll, because the save invalidates the gate snapshot.

## Step 8. Minimum app version gate

```bash
kdrefresh
kdput minAppVersion '{"ios":"9.0.0"}' ''
kdcall "$API/provinces" -H 'X-Client: mobile-ios' -H 'X-App-Version: 1.0.0'
kdq "$API/provinces" -H 'X-Client: mobile-ios' -H 'X-App-Version: 9.0.0'
kdq "$API/provinces" -H 'X-Client: mobile-android' -H 'X-App-Version: 1.0.0'
kdq "$API/provinces"
kdput minAppVersion '{"ios":"0.0.0"}' ''
kdq "$API/provinces" -H 'X-Client: mobile-ios' -H 'X-App-Version: 1.0.0'
```

No branch endpoint exists yet, so `GET /provinces` stands for a customer path.

Expected:

- The first save answers `200`, `"key":"minAppVersion"`, `"rowVersion":2`, `"ios":"9.0.0"`, `"android":"0.0.0"`.
- iOS `1.0.0` answers `HTTP/1.1 400` (not the brief's `426`: decision 0007 section 9) with `"code":"UPGRADE_REQUIRED"` and `storeUrl` `null`, or the URL of `APP_STORE_URL_IOS` when set.
- iOS `9.0.0`, Android `1.0.0` and no headers each answer `HTTP/1.1 200`.
- The restore answers `200` with `"rowVersion":3` and `"ios":"0.0.0"`; iOS `1.0.0` then answers `HTTP/1.1 200`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
{"accessToken":"***","expiresIn":899,"user":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","displayName":"First Admin Smoke","role":"ADMIN"}}
exit=0
HTTP/1.1 200 OK
{"key":"minAppVersion","value":{"ios":"9.0.0","android":"0.0.0"},"rowVersion":2,"updatedBy":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","name":"First Admin Smoke"},"updatedAt":"2026-11-09T00:36:58.512Z"}
HTTP/1.1 400 Bad Request
{"storeUrl":null,"type":"about:blank","title":"Bad Request","status":400,"code":"UPGRADE_REQUIRED","detail":"This version of the app is no longer supported; update it."}
HTTP/1.1 200 OK
HTTP/1.1 200 OK
HTTP/1.1 200 OK
HTTP/1.1 200 OK
{"key":"minAppVersion","value":{"ios":"0.0.0","android":"0.0.0"},"rowVersion":3,"updatedBy":{"id":"01a1bdbb-6875-70f3-af28-6ccc5ebe213a","name":"First Admin Smoke"},"updatedAt":"2026-11-09T00:36:58.768Z"}
HTTP/1.1 200 OK
```

Notes (status of `UPGRADE_REQUIRED`, `storeUrl`): `400`, `storeUrl` `null` (no `APP_STORE_URL_IOS` in `dev`).

## Step 9. `config.changed` outbox rows

```bash
kdsql -At -c 'SELECT type, entity_id, version, audience FROM outbox_events ORDER BY created_at'; echo "exit=$?"
```

Expected: among any rows of earlier phases, exactly six `config.changed` rows, one per successful save, in this order: `config.changed|ordering|2|PUBLIC`, `config.changed|payment|2|PUBLIC`, `config.changed|maintenance|2|PUBLIC`, `config.changed|maintenance|3|PUBLIC`, `config.changed|min_app_version|2|PUBLIC`, `config.changed|min_app_version|3|PUBLIC`. No row for the stale save, the invalid save, the payment save without a step-up token or the STAFF save of steps 4 and 5.

Result (pass / fail): **pass**

```text
session.revoked|01a1b5a4-147f-7439-b13c-326af5d7b29e||USER
session.revoked|01a1b5a4-147f-7439-b13c-326af5d7b29e||USER
session.revoked|01a1b5a4-147f-7439-b13c-326af5d7b29e||USER
config.changed|ordering|2|PUBLIC
config.changed|payment|2|PUBLIC
config.changed|maintenance|2|PUBLIC
config.changed|maintenance|3|PUBLIC
config.changed|min_app_version|2|PUBLIC
config.changed|min_app_version|3|PUBLIC
exit=0
```

Notes: the three `session.revoked` rows are the phase 03 manager's (role change and MFA reset), from before this run.

## Step 10. Current legal documents and a registration

```bash
kdq "$API/legal/documents/current"
grep -i '^etag:' "$KD_HEAD"
kddoc
DOC_TOS="$(kddoc TERMS_OF_SERVICE)"; echo "exit=$?"
DOC_PRIVACY="$(kddoc PRIVACY_POLICY)"; echo "exit=$?"
echo "DOC_TOS=$DOC_TOS DOC_PRIVACY=$DOC_PRIVACY E_CUSTOMER=$E_CUSTOMER"
```

Then the registration (the command of the phase 02 sheet, step 5, with a fresh fictional email, its own throw-away password and no phone) and the consent rows it wrote:

```bash
PW_CUSTOMER='CHANGE_ME_LOCAL_a4_customer_pw'
kdcall -X POST "$API/auth/register" -H 'Content-Type: application/json' -H 'X-Client: mobile-ios' -H 'X-App-Version: 1.0.0' -d "{\"email\":\"$E_CUSTOMER\",\"password\":\"$PW_CUSTOMER\",\"displayName\":\"Bao Smoke\",\"acceptedDocumentIds\":[\"$DOC_TOS\",\"$DOC_PRIVACY\"],\"deviceLabel\":\"smoke-a4-phone\"}"
ACCESS_CUSTOMER="$(kdget accessToken)"; echo "exit=$?"
CUSTOMER_ID="$(kdget user.id)"; echo "exit=$?"
kdsql -At -c "SELECT d.type, d.version, c.action FROM public.user_consents c JOIN public.consent_documents d ON d.id = c.document_id WHERE c.user_id = '$CUSTOMER_ID' ORDER BY d.type"; echo "exit=$?"
```

Expected:

- `HTTP/1.1 200` with an `ETag:` header; `kddoc` prints two lines, `TERMS_OF_SERVICE ... placeholder-1 vi` and `PRIVACY_POLICY ... placeholder-1 vi`; both ids set, both `exit=0`.
- The registration answers `HTTP/1.1 201` with `accessToken` and `refreshToken` `***` and `user` with `"email":"bao.a4.smoke@example.com"`; both `exit=0`; the consent query prints `PRIVACY_POLICY|placeholder-1|GRANTED` and `TERMS_OF_SERVICE|placeholder-1|GRANTED`. If the email exists from an earlier run, the registration is refused: use another fictional `example.com` address and say so in "Notes".

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
ETag: "pFKaYqgNiTr2l4fuLqRdwHWIqU0l6pl_VAag-Gg1nu0"
TERMS_OF_SERVICE 01a1bdbb-6873-7bdc-87be-4ad4e9e04ea7 placeholder-1 vi
PRIVACY_POLICY 01a1bdbb-6873-7d9e-9a13-bf8114c0b640 placeholder-1 vi
exit=0
exit=0
DOC_TOS=01a1bdbb-6873-7bdc-87be-4ad4e9e04ea7 DOC_PRIVACY=01a1bdbb-6873-7d9e-9a13-bf8114c0b640 E_CUSTOMER=bao.a4.smoke@example.com
HTTP/1.1 201 Created
{"accessToken":"***","refreshToken":"***","expiresIn":899,"user":{"id":"01a1bdbd-037f-7875-93cf-c3410cc82ad1","email":"bao.a4.smoke@example.com","displayName":"Bao Smoke","emailVerifiedAt":null}}
exit=0
exit=0
PRIVACY_POLICY|placeholder-1|GRANTED
TERMS_OF_SERVICE|placeholder-1|GRANTED
exit=0
```

Notes: customer id `01a1bdbd-037f-7875-93cf-c3410cc82ad1` (fictional, kept in `kd_dev`).

## Step 11. Test suites and the contract check

```bash
pnpm --filter @kd/api test 2>&1 | tee "$TMPDIR/kd-a4-test.txt"; echo "exit=${pipestatus[1]}"
pnpm --filter @kd/api test:int 2>&1 | tee "$TMPDIR/kd-a4-test-int.txt"; echo "exit=${pipestatus[1]}"
pnpm --filter @kd/seed test 2>&1 | tee "$TMPDIR/kd-a4-test-seed.txt"; echo "exit=${pipestatus[1]}"
pnpm openapi:check; echo "exit=$?"
```

Expected: the three suites pass (`Test Files  N passed`, no failure, no skip you did not expect) and each `exit=0`; the integration suite uses its own scratch database, not `kd_dev`, and its `migrate` line now counts twelve migrations. `openapi:check` reports `openapi.json` and `src/generated/openapi.ts` up to date and exits 0. Paste the summary lines of each run; shorten the rest.

Result (pass / fail): **pass**

```text
$ vitest run --maxWorkers=2
 Test Files  107 passed (107)
      Tests  1876 passed (1876)
   Duration  10.20s
exit=0
$ vitest run --config vitest.int.config.ts --maxWorkers=1 --no-file-parallelism
migrate: applied 0001_database_helpers.sql
...
migrate: applied 0011_app_settings.sql
migrate: applied 0012_consent_document_content.sql
migrate: 12 applied
 Test Files  29 passed (29)
      Tests  587 passed (587)
   Duration  41.58s
exit=0
$ vitest run --maxWorkers=2
 Test Files  9 passed (9)
      Tests  207 passed (207)
   Duration  415ms
exit=0
@kd/api:openapi:check: openapi:check: <repo>/packages/contracts/openapi.json is up to date
 Tasks:    4 successful, 4 total
$ scripts/openapi-breaking.sh
breaking-change check inactive: no released snapshot yet (packages/contracts/openapi.released.json)
exit=0
```

Notes: the API stayed up during the suites (the integration suite uses its own scratch database). No failure and no skip.

## Step 12. Log hygiene and stop

The API log, while the shell variables of the earlier steps still hold their values. Every one must be non-empty (an empty value matches every line), so the first line checks them all:

```bash
LOG="$TMPDIR/kd-api-a4.log"
[ -n "$PW_ADMIN" ] && [ -n "$PW_STAFF2" ] && [ -n "$LINK_ADMIN" ] && [ -n "$MFA_TOKEN" ] && [ -n "$MFA_SECRET" ] && [ -n "$ACCESS_ADMIN" ] && [ -n "$ACCESS_STAFF" ] && [ -n "$STEP_UP" ] && [ -n "$KD_ACCOUNT" ] && [ -n "$RECOVERY" ] && [ -n "$KD_TOTP" ]; echo "all set exit=$?"
for v in "$PW_ADMIN" "$PW_STAFF2" "$LINK_ADMIN" "$MFA_TOKEN" "$MFA_SECRET" "$ACCESS_ADMIN" "$ACCESS_STAFF" "$STEP_UP" "$KD_ACCOUNT"; do grep -cF -- "$v" "$LOG"; done | tr '\n' ' '; echo
echo "$RECOVERY" | tr ' ' '\n' | while read -r c; do grep -cF -- "$c" "$LOG"; done | sort | uniq -c
for j in "$JAR_ADMIN" "$JAR_STAFF"; do c="$(kdjar "$j")"; [ -n "$c" ] && grep -cF -- "$c" "$LOG"; done
grep -cE 'kd_refresh=[A-Za-z0-9_-]{20}' "$LOG"
grep -ciE 'x-step-up-token|stepUpToken' "$LOG"
grep -cF -- "$KD_TOTP" "$LOG"
grep -cE '(first\.admin|owner|staff)\.smoke@kitchendaylight\.example' "$LOG"
for v in "$PW_CUSTOMER" "$ACCESS_CUSTOMER" "$E_CUSTOMER"; do grep -cF -- "$v" "$LOG"; done | tr '\n' ' '; echo
grep -cE '"level":(40|50|60)' "$LOG"
```

Then stop the API in terminal 2 with Ctrl-C and confirm that nothing listens on 3001:

```bash
lsof -nP -sTCP:LISTEN -iTCP:3001; echo "exit=$?"
```

Only if you want the stack stopped: `pnpm dev:infra:down; echo "exit=$?"` (volumes are kept).

Expected:

- `all set exit=0`; nine `0` on one line (no password, invitation token, challenge, setup key, access token, step-up token or account number in the log); the recovery-code line is `10 0`; the current cookies of the admin and the staff `0`; the `kd_refresh=` pattern `0`; the step-up header pattern `0`.
- The last TOTP code: `0`. A 6-digit code can match an unrelated number (a timestamp or a duration); if it counts more than 0, run `grep -F -- "$KD_TOTP" "$TMPDIR/kd-api-a4.log"`, check that every hit is unrelated, and say so in "Notes" (paste the hits with the code replaced by `***`).
- The staff email count is `0` (log lines carry the user id only). Write any other count in "Notes".
- The customer's password, access token and email: `0 0 0`. Warning and error lines: `0`.
- `lsof` prints nothing (`exit=1`).

Result (pass / fail): **pass**

```text
all set exit=0
0 0 0 0 0 0 0 0 0
  10 0
0
0
0
0
0
0
0 0 0
0
(API stopped with SIGINT)
exit=1
```

Notes: the log has 145 lines. The last five digits `45678` also count `0`. The stack was left running.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes |
| Failed or skipped steps | none failed or skipped; step 0's first `migrate` found the A4 migrations already applied; TOTP codes generated from the setup key, not read from an app (see "Run log") |
| First admin id (step 3) | `01a1bdbb-6875-70f3-af28-6ccc5ebe213a` (`first.admin.smoke@kitchendaylight.example`, kept in `kd_dev`) |
| Authenticator entry and recovery codes | no app entry was made; the setup key and recovery codes lived in a session scratch file, deleted after the run. To sign in as `first.admin.smoke@...` again, reset its second factor or reset `kd_dev` |
| Settings left in `kd_dev` | `ordering.itemNoteMax` 150, `payment` complete (fictional), `maintenance` off, `minAppVersion` `0.0.0` both; customer `bao.a4.smoke@example.com` |
| Follow-up tasks opened | (1) `maintenance.since` is not filled by the server when maintenance is switched on (review); (2) the root `.env` now holds the two `SEED_ADMIN_*` lines of this run: remove them or keep them, they only matter to `seed reference --commit` |
| Owner | |
| Date | 2026-11-09 |

Phase A4 gate: run the review prompt
