# Phase 6 smoke run: quick start on a fresh clone and the three dev servers

Owner checklist for the blockers of P6-T2. It closes the gaps that the README and [docs/architecture/foundation.md](../../architecture/foundation.md) still flag:

1. pnpm 12.16.1 installed for Node 26 itself (Node 26 ships no Corepack; [phase 4](phase4.md), step 8 notes).
2. The README quick start on a **fresh clone**, where no shared package is built yet.
3. `pnpm dev:admin` and `pnpm dev:mobile`, never run by a smoke sheet so far, and the admin shell rendered in a browser.

**Scope:** no step runs a test suite or `docker` directly, and no step changes a committed file of the working copy. Steps 1 to 5 run in a throw-away clone (`$SMOKE_ROOT/kd`). Step 0 changes the owner's machine (a global pnpm for Node 26).

**Watchers:** `pnpm dev:api` (steps 2 to 4), `pnpm dev:admin` (step 4), `pnpm dev:mobile` (step 5). Step 4 is the only step with two of them at once (the admin proxy needs the API). Each one is stopped with Ctrl-C where the step says so.

## How to run

- Run one step at a time, in order. Paste the output into the empty block of the step and fill in the result.
- Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Before pasting, replace every password with `***`** and home paths with `<repo>` or `$SMOKE_ROOT`. Never paste the content of `.env`.
- The command blocks hold no comment lines and no `<...>` placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- Exit codes: each command is followed by `echo "exit=$?"`.
- Before step 1, stop any `pnpm dev:api` still running from the working copy: port 3001 must be free.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-05 |
| Machine / OS / chip / RAM | Owner's MacBook, Apple Silicon (details as in the phase 4 sheet) |
| Monorepo commit (`git rev-parse --short HEAD`) | not recorded; the working copy's `main` was at `84ce318` |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | not recorded (`VERSION` 0.0.0) |
| `docker-repo.version` | `0.0.0` |

## Step 0. pnpm 12.16.1 for Node 26

From the root of the working copy.

```bash
nvm use
which -a pnpm
npm install -g pnpm@12.16.1; echo "exit=$?"
hash -r
which pnpm
pnpm --version
```

Expected: before the install, `which -a pnpm` lists only paths outside `v26.13.0` (or nothing). The install exits 0. After it, `which pnpm` prints a path under `.nvm/versions/node/v26.13.0/bin/` and `pnpm --version` prints `12.16.1`.

Result (pass / fail): **pass**

```text
Now using node v26.13.0 (npm v11.20.0)
<home>/.nvm/versions/node/v24.22.2/bin/pnpm
<home>/.nvm/versions/node/v24.22.2/bin/pnpm

added 2 packages in 2s
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   pnpm@12.16.1 (preinstall: node install.js; postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install -g --allow-scripts=pnpm` to allow these scripts once, or `npm config set allow-scripts=pnpm --location=user` to allow them for all global installs.
exit=0
<home>/.nvm/versions/node/v26.13.0/bin/pnpm
12.16.1
```

Notes: before the install `pnpm` resolved only to the Node 24.22.2 install; after it, to the Node 26.13.0 install, version 12.16.1. npm 11.20.0 did not run pnpm's `preinstall`/`postinstall` scripts (not covered by `allowScripts`); `pnpm --version` and every later step work without them, so they were not allowed. Closes the phase 4 follow-up 3.

## Step 1. Fresh clone: install, local stack, `.env`

From the root of the working copy. `KD_DOCKER_DIR` points the clone at the real sibling folder, so nothing is cloned again. The clone's path is saved to `$TMPDIR/kd-smoke-root` for the second terminal.

```bash
nvm use
export KD_DOCKER_DIR="$(pwd)/../kitchen-daylight-docker"
SMOKE_ROOT="$(mktemp -d)"
echo "$SMOKE_ROOT" > "$TMPDIR/kd-smoke-root"
git clone "$(git rev-parse --show-toplevel)" "$SMOKE_ROOT/kd"
cd "$SMOKE_ROOT/kd"
ls packages/contracts/dist; echo "exit=$?"
pnpm install --frozen-lockfile; echo "exit=$?"
scripts/bootstrap.sh; echo "exit=$?"
pnpm env:sync; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
```

Expected:

- `ls packages/contracts/dist` fails (`No such file or directory`, `exit=1`): the clone has no build output.
- The install exits 0 and the `prepare` script runs.
- `bootstrap.sh`: `prerequisites ok`, `folder exists, not cloned`, `already initialised`, the version check passes, every service healthy; `exit=0`.
- `env:sync`: `wrote $SMOKE_ROOT/kd/.env (mode 600)`; `exit=0`.
- `dev:infra:status`: postgres, mailpit and s3 healthy; `exit=0`.

Result (pass / fail): **pass**

```text
Now using node v26.13.0 (npm v11.20.0)
Cloning into '$SMOKE_ROOT/kd'...
done.
ls: packages/contracts/dist: No such file or directory
exit=1
Scope: all 10 workspace projects
✓ Lockfile passes supply-chain policies (verified 22h ago)
Lockfile is up to date, resolution step is skipped
Packages: +1254
Progress: resolved 1254, reused 1254, downloaded 0, added 1254, done
. prepare$ node .husky/install.mjs
└─ Done in 115ms
(devDependencies list as in the phase 1 sheet)
Done in 4.8s using pnpm v12.16.1
exit=0
[kd] prerequisites ok: Docker Engine 28.3.2, Compose 2.38.2-desktop.1, bash 3.2.57(1)-release, git, curl
[kd] folder exists, not cloned: <repo>/../kitchen-daylight-docker (left on its current ref)
[kd] already initialised: <repo>/../kitchen-daylight-docker/.env exists
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (<repo>/../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[+] Running 4/4
 ✔ Container kd-docker-postgres-1  Started   0.6s
 ✔ Container kd-docker-s3-1        Healthy  11.1s
 ✔ Container kd-docker-mailpit-1   Started   0.6s
 ✔ Container kd-docker-s3-init-1   Started   0.1s
[kd] all services ready
(print-env.sh output, passwords as ***)
exit=0
$ scripts/env-sync.sh
[kd] wrote $SMOKE_ROOT/kd/.env (mode 600): print-env.sh block replaced, monorepo block created
exit=0
$ scripts/dev-infra.sh status
[kd] s3-init    exited(0)    -          -
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] postgres   running      healthy    127.0.0.1:5452->5432/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
```

Notes: the clone had no build output; the install took 4.8 s with a warm store (1254 packages, all workspace projects). `KD_DOCKER_DIR` pointed `bootstrap.sh` at the existing sibling, as intended. The pasted `print-env.sh` lines held the local placeholder credentials; they are shown as `***` here.

## Step 2. Fresh clone: build the API with its dependencies, migrate, start

`pnpm --filter "@kd/api..." build` builds `@kd/api` and the workspace packages it depends on (`@kd/contracts`). The README used `pnpm --filter @kd/api build`, which fails on a fresh clone: `TS2307: Cannot find module '@kd/contracts'` (seen by the agent on a throw-away clone at `ba45b29`, 2026-11-05). The API image builds the same way (`apps/api/Dockerfile`, [phase 4](phase4.md), step 11 log).

First terminal:

```bash
cd "$SMOKE_ROOT/kd"
pnpm --filter "@kd/api..." build; echo "exit=$?"
node apps/api/dist/cli.js migrate; echo "exit=$?"
```

Then a **second terminal**, left running for steps 3 and 4:

```bash
nvm use
cd "$(cat "$TMPDIR/kd-smoke-root")/kd"
pnpm dev:api
```

Expected: the build exits 0 and prints `@kd/contracts` before `@kd/api`; `migrate` prints `migrate: nothing to apply` (the stack's database is shared with the working copy) and `exit=0`; `dev:api` starts on port 3001 with no error and no variable value in the log.

Result (pass / fail): **pass**

```text
$ tsc -p tsconfig.json
$ nest build
exit=0
migrate: nothing to apply
exit=0
(second terminal: `pnpm dev:api`, output not pasted)
```

Notes: `pnpm --filter "@kd/api..." build` built `@kd/contracts` (`tsc`) before `@kd/api` (`nest build`) on a clone with no `dist/`, the case where `--filter @kd/api` alone fails. The `dev:api` log was not pasted; the watcher served the requests of steps 3 and 4.

## Step 3. `GET /api/health` from the fresh clone

First terminal.

```bash
curl -i http://127.0.0.1:3001/api/health; echo; echo "exit=$?"
```

Expected: `HTTP/1.1 200 OK`, `Cache-Control: no-store`, body `{"status":"ok","checks":{"database":"up"}}`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
X-Powered-By: Express
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42

{"status":"ok","checks":{"database":"up"}}
exit=0
```

Notes: `ETag`, `Date` and connection headers omitted.

## Step 4. `pnpm dev:admin` and the admin shell in a browser

`ng serve` needs the built `@kd/contracts` and `@kd/design-tokens`. `"@kd/admin^..."` builds the packages the admin depends on, not the admin itself. Leave `pnpm dev:api` of step 2 running: the admin dev server proxies `/api` and `/socket.io` to `127.0.0.1:3001` (`apps/admin/proxy.conf.json`).

First terminal:

```bash
cd "$SMOKE_ROOT/kd"
pnpm --filter "@kd/admin^..." build; echo "exit=$?"
```

Then a **third terminal**:

```bash
nvm use
cd "$(cat "$TMPDIR/kd-smoke-root")/kd"
pnpm dev:admin
```

When it prints the local URL, in the first terminal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4200/; echo "exit=$?"
curl -i http://localhost:4200/api/health; echo; echo "exit=$?"
```

Then open `http://localhost:4200/` in a browser.

Expected:

- The dependency build exits 0 (`@kd/contracts` and `@kd/design-tokens`).
- `ng serve` compiles with no error and prints a local URL on port 4200.
- The page answers `200`; `/api/health` through the proxy answers `200` with the same body as step 3.
- The browser shows the admin shell with no error in the developer console. Note whether a PrimeNG license notice is shown (decision 0001: the key location is not decided yet).

Then **stop `pnpm dev:admin` (third terminal) and `pnpm dev:api` (second terminal) with Ctrl-C.**

Result (pass / fail): **pass for the HTTP checks; browser check not reported**

```text
packages/contracts build$ tsc -p tsconfig.json
└─ Done in 276ms
packages/design-tokens build$ node scripts/build.mjs && tsc -p tsconfig.json
│ wrote src/tokens.css
│ wrote src/index.ts
│ wrote src/primeng-preset.ts
│ wrote src/react-native.ts
└─ Done in 468ms
exit=0
(third terminal: `pnpm dev:admin`, output not pasted)
200
exit=0
HTTP/1.1 200 OK
Vary: Origin
x-powered-by: Express
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 42

{"status":"ok","checks":{"database":"up"}}
exit=0
```

Notes: `ng serve` answered on port 4200 and its proxy reached the API (`/api/health` 200 with the same body as step 3). **Not reported yet:** whether the browser showed the admin shell without a console error, and whether a PrimeNG license notice appeared. The `dev:admin` log was not pasted.

## Step 5. `pnpm dev:mobile`

`app.config.ts` needs `KD_MOBILE_DEV_API_URL` (a URL ending in `/api`) in `apps/mobile/.env.local`, which is git-ignored. The command writes it from the machine's LAN address. `"@kd/mobile^..."` builds `@kd/contracts`, `@kd/design-tokens` and `@kd/i18n`.

First terminal:

```bash
cd "$SMOKE_ROOT/kd"
printf 'KD_MOBILE_DEV_API_URL=http://%s:3001/api\n' "$(ipconfig getifaddr en0)" > apps/mobile/.env.local
git check-ignore -v apps/mobile/.env.local
pnpm --filter "@kd/mobile^..." build; echo "exit=$?"
pnpm dev:mobile
```

Expected:

- `git check-ignore` names the `.gitignore` rule for `.env.*`.
- The dependency build exits 0.
- `expo start` starts Metro and prints the QR code and the key menu, with no error. A warning that lists the seven packages of the pending SDK 58 patch set (decision 0001, [phase 4](phase4.md), step 10) is expected until that set moves to `expo` 58.0.23; any other warning goes into "Notes".
- Optional: open the app in Expo Go on a phone on the same network and note whether the shell renders.

Then **stop `pnpm dev:mobile` with Ctrl-C.**

Result (pass / fail): **pass**

```text
.gitignore:157:.env.*   apps/mobile/.env.local
packages/i18n build$ tsc -p tsconfig.json
└─ Done in 447ms
packages/contracts build$ tsc -p tsconfig.json
└─ Done in 334ms
packages/design-tokens build$ node scripts/build.mjs && tsc -p tsconfig.json
│ wrote src/tokens.css
│ wrote src/index.ts
│ wrote src/primeng-preset.ts
│ wrote src/react-native.ts
└─ Done in 356ms
exit=0
$ pnpm --filter @kd/mobile start

$ expo start
env: load .env.local
env: export KD_MOBILE_DEV_API_URL
Starting project at $SMOKE_ROOT/kd/apps/mobile
Expo Autolinking module resolution enabled
Starting Metro Bundler
(QR code omitted)
› Scan the QR code above to open in Expo Go.
› Metro: exp://<lan-ip>:8081
› Web: http://localhost:8081

› Using Expo Go (Press s to switch to development build)
› Press ? │ show all commands

Logs for your project will appear below. Press Ctrl+C to exit.
```

Notes: Expo loaded `KD_MOBILE_DEV_API_URL` from `apps/mobile/.env.local` and Metro started on 8081 with no error. **No warning about the pending SDK 58 patch set was printed** by `expo start` (`expo-doctor` reports it, phase 4 step 10). The app was not opened in Expo Go. The LAN address is replaced with `<lan-ip>`.

## Final check and cleanup

```bash
lsof -nP -sTCP:LISTEN -iTCP:3001 -iTCP:4200 -iTCP:8081
cd "$HOME"
rm -rf "$SMOKE_ROOT" "$TMPDIR/kd-smoke-root"
```

Expected: `lsof` prints nothing (no API, admin or Metro process left). The local stack keeps running; stop it from the working copy with `pnpm dev:infra:down` if wanted.

Result (pass / fail): **pass**

```text
(lsof printed nothing; cd and rm printed nothing)
```

Notes: no process listens on 3001, 4200 or 8081, so `dev:api`, `dev:admin` and `dev:mobile` were stopped. The throw-away clone and `$TMPDIR/kd-smoke-root` are removed. The local stack keeps running.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes: steps 0 to 5 and the final check pass; the browser check of step 4 is not reported yet |
| Failed or skipped steps | none failed; step 4 browser check (admin shell, console errors, PrimeNG license notice) pending |
| Follow-up tasks opened | none so far |
| Owner | `truongtankhanh` (repository owner) |
| Date | 2026-11-05 |
