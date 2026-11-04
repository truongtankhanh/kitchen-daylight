# Phase 2 smoke run: local environment

Owner checklist for task P2-T5. It exercises the four scripts of Phase 2 against the real sibling Docker repository: `scripts/bootstrap.sh`, `scripts/dev-infra.sh` (`pnpm dev:infra`, `dev:infra:status`, `dev:infra:down`), `scripts/check-docker-repo.sh` and `scripts/env-sync.sh` (`pnpm env:sync`).

**Scope:** dependencies only (PostgreSQL, Mailpit, S3 emulator). **No step starts the API, admin or mobile**, no step passes `--apps`, and no step runs a test suite or a watcher.

## How to run

- Run one step at a time, from the repository root, in order. Paste the output into the empty block of the step and fill in the result.
- Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Before pasting, replace every password with `***`.** `scripts/up.sh` prints `scripts/print-env.sh` output, whose `DATABASE_URL_*` and `STORAGE_S3_*_KEY` values hold the local placeholder credentials. Never paste the content of `.env`.
- The command blocks hold no comment lines: the interactive zsh of macOS does not treat `#` as a comment by default.
- Exit codes: each command is followed by `echo "exit=$?"`. pnpm passes a script's exit code through (confirmed in this run: steps 4 and 5 show `exit=3` and `exit=1`). Each `pnpm` script wraps `scripts/dev-infra.sh`, `scripts/env-sync.sh` or `scripts/bootstrap.sh`, which can also be run directly.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-04 |
| Machine / OS | Owner's MacBook, macOS 26.6.2 |
| Monorepo commit (`git rev-parse --short HEAD`) | `1d0f671`, plus the uncommitted Phase 2 changes (P2-T1 to P2-T5) |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | `91af754` (no tag) |
| Sibling `VERSION` | `0.0.0` |
| `docker-repo.version` | `0.0.0` |
| `KD_DOCKER_DIR` set? (value, or "default") | default (`../kitchen-daylight-docker`) |

## Step 0. Current state

Records what runs before the smoke run, so later steps can be compared with it.

```bash
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
lsof -nP -sTCP:LISTEN -iTCP:5452 -iTCP:1045 -iTCP:8045 -iTCP:9020 -iTCP:9021 -iTCP:3020 -iTCP:8020 \
  -iTCP:5457 -iTCP:1050 -iTCP:8050 -iTCP:9025 -iTCP:9026 -iTCP:3025 -iTCP:3001
ls -l .env 2>&1; ls -l ../kitchen-daylight-docker/.env 2>&1
```

Expected: a record only. The slot-2 ports are free or held by this project's own stack (`kd-docker`); nothing listens on 3001 (host API port).

Result (pass / fail): **pass**

```text
ls: .env: No such file or directory
-rw-------  1 <owner>  staff  1677 Oct 29 09:05 ../kitchen-daylight-docker/.env
```

Notes: no container running, no listener on any slot-2 port or on 3001 (both commands printed nothing). No root `.env` yet; the sibling's `.env` exists with mode 600.

## Step 1. `scripts/bootstrap.sh` (sibling and its `.env` present)

```bash
scripts/bootstrap.sh; echo "exit=$?"
git -C ../kitchen-daylight-docker status --short
```

Expected:

- `prerequisites ok` with the Docker Engine, Compose, bash, git and curl versions.
- `folder exists, not cloned` (no clone, the sibling stays on its current ref).
- `already initialised: .../.env exists` (`init-env.sh` not run, the sibling's `.env` not overwritten).
- `Docker repository compatible: VERSION ..., required ...`, then the sibling's `up.sh` output, ending healthy.
- `exit=0`. `git status --short` of the sibling shows no change made by the run.

Result (pass / fail): **pass**

```text
[kd] prerequisites ok: Docker Engine 28.3.2, Compose 2.38.2-desktop.1, bash 3.2.57(1)-release, git, curl
[kd] folder exists, not cloned: ../kitchen-daylight-docker (left on its current ref)
[kd] already initialised: ../kitchen-daylight-docker/.env exists
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[+] Running 5/5
 ✔ Network kd-docker_default       Created   0.1s
 ✔ Container kd-docker-postgres-1  Started   1.4s
 ✔ Container kd-docker-mailpit-1   Started   1.2s
 ✔ Container kd-docker-s3-1        Healthy   6.3s
 ✔ Container kd-docker-s3-init-1   Started   6.3s
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
```

Notes: the sibling's `git status --short` printed nothing (no change). The stack was down before the run, so `bootstrap.sh` started it (its last step is `dev-infra.sh up`).

## Step 2. `pnpm dev:infra:status`

Direct form: `scripts/dev-infra.sh status`.

```bash
pnpm dev:infra:status; echo "exit=$?"
```

Expected: one line per service (postgres, mailpit, s3), each running and healthy with its slot-2 port; `exit=0`. No `api`, `migrate` or `caddy` line.

Result (pass / fail): **pass**

```text
$ scripts/dev-infra.sh status
[kd] s3-init    exited(0)    -          -
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] postgres   running      healthy    127.0.0.1:5452->5432/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
```

Notes: the one-shot `s3-init` job is listed as `exited(0)`, as expected for a job. Every port is bound to `127.0.0.1`.

## Step 3. `pnpm dev:infra` (stack already running)

Direct form: `scripts/dev-infra.sh up`.

```bash
pnpm dev:infra; echo "exit=$?"
docker ps --format '{{.Names}}\t{{.Status}}'
```

Expected: the version check passes, `up.sh` runs with no flag, every service is healthy, nothing is recreated (a second `up` on a running stack changes nothing); `exit=0`. `docker ps` shows no `api`, `migrate` or `caddy` container.

Result (pass / fail): **pass**

```text
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[+] Running 4/4
 ✔ Container kd-docker-mailpit-1   Running   0.0s
 ✔ Container kd-docker-postgres-1  Running   0.0s
 ✔ Container kd-docker-s3-1        Healthy   0.5s
 ✔ Container kd-docker-s3-init-1   Started   0.1s
[kd] all services ready
(print-env.sh output identical to step 1, passwords as ***)
exit=0
kd-docker-s3-1          Up 37 seconds (healthy)
kd-docker-postgres-1    Up 37 seconds (healthy)
kd-docker-mailpit-1     Up 37 seconds (healthy)
```

Notes: the long-running services stay `Running` (not recreated). The one-shot `s3-init` job runs again (`Started`) and exits 0; it creates the buckets idempotently, so this is expected.

## Step 4. `pnpm env:sync`

If a root `.env` already exists, the first run exits 3: then run `scripts/env-sync.sh --force` instead and say so in "Notes". Direct form: `scripts/env-sync.sh`. On Linux replace the `stat` line with `stat -c 'mode=%a' .env`.

```bash
pnpm env:sync; echo "exit=$?"
stat -f 'mode=%Lp' .env
git check-ignore -v .env
scripts/env-sync.sh --print; echo "exit=$?"
pnpm env:sync; echo "exit=$?"
```

Expected:

- First run: `wrote .../.env (mode 600): ... monorepo block created`; `exit=0`.
- `mode=600`; `git check-ignore` names the `.gitignore` rule for `.env`.
- `--print`: the 12 contract names and `PORT`, `LOG_LEVEL`, names only, no value; `exit=0`.
- Second run: `.env exists ...; run again with --force`; `exit=3`; `.env` unchanged.

Result (pass / fail): **pass**

```text
$ scripts/env-sync.sh
[kd] wrote <repo>/.env (mode 600): print-env.sh block replaced, monorepo block created
exit=0
mode=600
.gitignore:156:.env     .env
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
exit=0
$ scripts/env-sync.sh
[kd] .env exists at <repo>; run again with --force to replace it (its monorepo block is kept)
[ELIFECYCLE] Command failed with exit code 3.
exit=3
```

Notes: `--print` reports the monorepo block as "kept from .env" because the first run had just written it. The first version of this sheet had a trailing `# Linux: ...` comment on the `stat` line; zsh passed it to `stat` as file names and printed five `No such file or directory` errors (removed from the output above, the command block is fixed).

## Step 5. Version mismatch makes `dev:infra` fail

Raises `docker-repo.version` one patch above the sibling's `VERSION` (example for `0.0.0`: `0.0.1`), runs `dev:infra`, then restores the file. Direct form: `scripts/dev-infra.sh up`.

```bash
cp docker-repo.version docker-repo.version.bak
printf '0.0.1\n' > docker-repo.version
pnpm dev:infra; echo "exit=$?"
mv docker-repo.version.bak docker-repo.version
cat docker-repo.version; git status --short docker-repo.version
```

Expected:

- `Docker repository too old: VERSION 0.0.0, required at least 0.0.1`, followed by `git -C "../kitchen-daylight-docker" fetch --tags` and the `checkout` line; `exit=1`.
- `up.sh` is not run (no `up.sh` output after the message).
- After the restore: the original value, and `git status` shows no change to `docker-repo.version`.

Result (pass / fail): **pass**

```text
$ scripts/dev-infra.sh up
[kd] Docker repository too old: VERSION 0.0.0, required at least 0.0.1
[kd] update: git -C "../kitchen-daylight-docker" fetch --tags
[kd]         git -C "../kitchen-daylight-docker" checkout <tag v0.x.y at least v0.0.1>
[ELIFECYCLE] Command failed with exit code 1.
exit=1
0.0.0
?? docker-repo.version
```

Notes: `?? docker-repo.version` only means the file was not committed yet at the time of the run (P2-T1 uncommitted); its content is restored to `0.0.0`.

## Step 6. `pnpm dev:infra:down` keeps the data

Direct form: `scripts/dev-infra.sh down`.

```bash
docker volume ls --format '{{.Name}}' | grep -E 'pgdata|s3data'
pnpm dev:infra:down; echo "exit=$?"
docker ps --format '{{.Names}}'
docker volume ls --format '{{.Name}}' | grep -E 'pgdata|s3data'
```

Expected: the containers of the stack are gone; the `pgdata` and `s3data` volumes are listed before and after, unchanged; `exit=0`.

Result (pass / fail): **pass**

```text
iot-telemetry-pipeline_pgdata
kd-docker_pgdata
kd-docker_s3data
ops-command-center_pgdata
$ scripts/dev-infra.sh down
[kd] removing containers of project kd-docker:
[kd]   kd-docker-s3-init-1
[kd]   kd-docker-s3-1
[kd]   kd-docker-postgres-1
[kd]   kd-docker-mailpit-1
[kd] volumes are kept
[+] Running 5/5
 ✔ Container kd-docker-postgres-1  Removed   0.2s
 ✔ Container kd-docker-mailpit-1   Removed   0.6s
 ✔ Container kd-docker-s3-init-1   Removed   0.0s
 ✔ Container kd-docker-s3-1        Removed   1.5s
 ✔ Network kd-docker_default       Removed   0.1s
[kd] stack is down
exit=0
iot-telemetry-pipeline_pgdata
kd-docker_pgdata
kd-docker_s3data
ops-command-center_pgdata
```

Notes: `docker ps` printed nothing after the down. The compose project is `kd-docker`; its volumes `kd-docker_pgdata` and `kd-docker_s3data` are kept. The volumes of the other projects on this machine are untouched.

## Step 7. `pnpm dev:infra` again

```bash
pnpm dev:infra; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
```

Expected: the stack starts from the kept volumes, every service healthy; both `exit=0`. The same volume names as in step 6.

Result (pass / fail): **pass**

```text
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[+] Running 5/5
 ✔ Network kd-docker_default       Created   0.0s
 ✔ Container kd-docker-s3-1        Healthy   6.3s
 ✔ Container kd-docker-mailpit-1   Started   1.2s
 ✔ Container kd-docker-postgres-1  Started   1.4s
 ✔ Container kd-docker-s3-init-1   Started   6.2s
[kd] all services ready
(print-env.sh output identical to step 1, passwords as ***)
exit=0
$ scripts/dev-infra.sh status
[kd] s3-init    exited(0)    -          -
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] postgres   running      healthy    127.0.0.1:5452->5432/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
```

Notes: no volume was created by the start (the compose output lists only the network and the containers).

## Step 8. Another slot running (only if the owner has a slot 0 or 1 stack)

Skip with "not applicable" when no other stack exists on this machine.

```bash
docker ps --format '{{.Names}}\t{{.Ports}}'
pnpm dev:infra:status; echo "exit=$?"
```

Expected: both stacks run at the same time; every published port of this stack is a slot-2 port bound to `127.0.0.1`, none shared with the other stack; `exit=0`.

Result (pass / fail / not applicable): **not applicable**

```text
kd-docker-s3-1          127.0.0.1:9020->8333/tcp
kd-docker-postgres-1    127.0.0.1:5452->5432/tcp
kd-docker-mailpit-1     127.0.0.1:1045->1025/tcp, 127.0.0.1:8045->8025/tcp
$ scripts/dev-infra.sh status
[kd] s3-init    exited(0)    -          -
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] postgres   running      healthy    127.0.0.1:5452->5432/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
```

Notes: no other stack was running during the run (only the `kd-docker` containers are listed). Other projects have volumes on this machine (step 6) but were stopped, so the clash check was not exercised. Repeat this step when a slot 0 or 1 stack runs.

## Final check: nothing but dependencies

```bash
lsof -nP -sTCP:LISTEN -iTCP:3001 -iTCP:3020 -iTCP:8020
docker ps --format '{{.Names}}'
```

Expected: no listener on 3001 (host API), 3020 (container API) or 8020 (Caddy); no `api`, `migrate` or `caddy` container.

Result (pass / fail): **pass**

```text
kd-docker-s3-1
kd-docker-postgres-1
kd-docker-mailpit-1
```

Notes: `lsof` printed nothing.

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes (steps 0 to 7 and the final check pass; step 8 not applicable) |
| Failed or skipped steps | step 8 skipped: no slot 0 or 1 stack running |
| Follow-up tasks opened | none; this sheet's command blocks were fixed for zsh (no `#` comment lines) |
| Owner | `truongtankhanh` (repository owner) |
| Date | 2026-11-04 |
