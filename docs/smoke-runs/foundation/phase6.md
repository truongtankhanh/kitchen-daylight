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
| Date | |
| Machine / OS / chip / RAM | |
| Monorepo commit (`git rev-parse --short HEAD`) | |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | |
| `docker-repo.version` | |

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

Result (pass / fail): 

```text
```

Notes:

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

Result (pass / fail): 

```text
```

Notes:

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

Result (pass / fail): 

```text
```

Notes:

## Step 3. `GET /api/health` from the fresh clone

First terminal.

```bash
curl -i http://127.0.0.1:3001/api/health; echo; echo "exit=$?"
```

Expected: `HTTP/1.1 200 OK`, `Cache-Control: no-store`, body `{"status":"ok","checks":{"database":"up"}}`.

Result (pass / fail): 

```text
```

Notes:

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

Result (pass / fail): 

```text
```

Notes:

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

Result (pass / fail): 

```text
```

Notes:

## Final check and cleanup

```bash
lsof -nP -sTCP:LISTEN -iTCP:3001 -iTCP:4200 -iTCP:8081
cd "$HOME"
rm -rf "$SMOKE_ROOT" "$TMPDIR/kd-smoke-root"
```

Expected: `lsof` prints nothing (no API, admin or Metro process left). The local stack keeps running; stop it from the working copy with `pnpm dev:infra:down` if wanted.

Result (pass / fail): 

```text
```

Notes:

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | |
| Failed or skipped steps | |
| Follow-up tasks opened | |
| Owner | |
| Date | |
