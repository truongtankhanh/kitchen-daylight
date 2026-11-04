# Phase 4 smoke run: apps against the local stack

Owner checklist for task P4-T9. It runs the Phase 4 app shells against the real sibling Docker repository: the API's `migrate` CLI and `GET /api/health` on the host, the configuration guard, the OpenAPI drift check, the admin build, `expo-doctor` for the mobile app, and the first run of the Docker repository's `apps` profile with a real API image (P4-T5).

**Scope:** no step runs a test suite, no step changes a committed file except the temporary edit of step 8 (reverted in the same step), and no step deletes data. The only watcher is `pnpm dev:api` (steps 4 to 6), stopped with Ctrl-C before step 7.

## How to run

- Run one step at a time, from the repository root, in order. Paste the output into the empty block of the step and fill in the result.
- Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Before pasting, replace every password with `***`.** `pnpm dev:infra` prints `scripts/print-env.sh` output with the local placeholder credentials. Never paste the content of `.env`. Replace home paths with `<repo>`.
- Use Node 26.13.0 (`nvm use` once in each terminal).
- The command blocks hold no comment lines and no `<...>` placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- Exit codes: each command is followed by `echo "exit=$?"`.
- Peak memory and wall time (steps 1 and 9): from `/usr/bin/time -l`, record `real` (seconds) and `maximum resident set size` (bytes; the largest single process, not the sum), and `peak memory footprint` if printed.

## Run details

| Field | Value |
|---|---|
| Date | 2026-11-04 |
| Machine / OS / chip / RAM | Owner's MacBook, macOS 26.6.2, Apple Silicon (arm64), 18 GiB |
| Monorepo commit (`git rev-parse --short HEAD`) | `ba5fd8e`, plus this uncommitted sheet |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD`) | `91af754` (no tag) |
| Sibling `VERSION` | `0.0.0` |
| `docker-repo.version` | `0.0.0` |
| Node / pnpm (`node --version`, `pnpm --version`) | v26.13.0 (`nvm use`) / 12.16.1; the `pnpm` on `PATH` is the Corepack shim of the Node 24.21.0 install, run by Node 26 (see step 8) |

## Step 0. Stack healthy and `.env` in sync

```bash
nvm use
pnpm dev:infra; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
pnpm env:sync; echo "exit=$?"
```

If `pnpm env:sync` exits 3 because a root `.env` already exists, run `scripts/env-sync.sh --force; echo "exit=$?"` and say so in "Notes".

Expected: every service (postgres, mailpit, s3) running and healthy on its slot-2 port; `env:sync` writes `.env` with mode 600 (or `--force` replaces the `print-env.sh` block and keeps the monorepo block with `PORT` and `LOG_LEVEL`); every `exit=0`.

Result (pass / fail): **pass**

```text
Now using node v26.13.0 (npm v11.20.0)
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[+] Running 4/4
 ✔ Container kd-docker-mailpit-1   Started   0.2s
 ✔ Container kd-docker-s3-1        Healthy   5.6s
 ✔ Container kd-docker-postgres-1  Started   0.3s
 ✔ Container kd-docker-s3-init-1   Started   0.1s
[kd] all services ready
(print-env.sh output, passwords as ***)
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

Notes: the stack and its status pass. `env:sync` exited 3 because the root `.env` of the Phase 2 run exists; `--force` was not run, so `.env` was used unchanged (same slot-2 values, as steps 2 to 6 confirm).

## Step 1. Build the API (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/api build; echo "exit=$?"
```

Expected: `nest build` exits 0; `apps/api/dist/main.js`, `dist/cli.js` and `dist/openapi/generate.js` exist.

| Measure | Value |
|---|---|
| Wall time (`real`) | 1.67 s |
| Maximum resident set size | 372342784 bytes (~355 MiB) |
| Peak memory footprint | 20368048 bytes (~19 MiB) |

Result (pass / fail): **pass**

```text
$ nest build
        1.67 real         1.70 user         0.32 sys
           372342784  maximum resident set size
            20368048  peak memory footprint
exit=0
```

Notes: other `time -l` counters omitted.

## Step 2. `migrate` twice: preflight passes, nothing to apply

```bash
node apps/api/dist/cli.js migrate; echo "exit=$?"
node apps/api/dist/cli.js migrate; echo "exit=$?"
```

Expected: both runs print `migrate: nothing to apply` and `exit=0`. The preflight prints nothing when it passes; a failing preflight prints `migrate: preflight: ...` and exits 4. If the first run applies pending files (`migrate: applied ...`), write it in "Notes": the second run must still print `nothing to apply`.

Result (pass / fail): **pass**

```text
migrate: nothing to apply
exit=0
migrate: nothing to apply
exit=0
```

Notes: the preflight printed nothing (it passed) in both runs.

## Step 3. `migrate` with the stack stopped

```bash
pnpm dev:infra:down; echo "exit=$?"
node apps/api/dist/cli.js migrate; echo "exit=$?"
pnpm dev:infra; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
```

Expected:

- `migrate: cannot connect to 127.0.0.1:5452/kd_dev` followed by the driver code (for example `ECONNREFUSED`); `exit=1`.
- The output holds no user and no password (no `CHANGE_ME_LOCAL`; the target is host, port and database only).
- After the restart, every service is healthy again; `exit=0`.

Result (pass / fail): **pass**

```text
$ scripts/dev-infra.sh down
[kd] removing containers of project kd-docker:
[kd]   kd-docker-s3-init-1
[kd]   kd-docker-s3-1
[kd]   kd-docker-postgres-1
[kd]   kd-docker-mailpit-1
[kd] volumes are kept
[kd] stack is down
exit=0
migrate: cannot connect to 127.0.0.1:5452/kd_dev (ECONNREFUSED)
exit=1
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[kd] all services ready
(print-env.sh output, passwords as ***)
exit=0
$ scripts/dev-infra.sh status
[kd] s3-init    exited(0)    -          -
[kd] postgres   running      healthy    127.0.0.1:5452->5432/tcp
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
```

Notes: the failure line names host, port and database only: no user, no password, no driver message. Compose progress lines omitted.

## Step 4. `pnpm dev:api` (watcher)

Run in a **second terminal** and leave it running for steps 5 and 6.

```bash
nvm use
pnpm dev:api
```

Expected: `nest start --watch` compiles and the application starts on the `PORT` of `.env` (`3001`); no error and no value of a variable in the log.

Result (pass / fail): **pass**

```text
(output of the second terminal not pasted)
```

Notes: the watcher's log was not pasted. The application ran on port 3001: step 5 answered 200. The watcher was **not stopped** after step 6 (see steps 7 and the final check).

## Step 5. `GET /api/health` returns 200

In the first terminal.

```bash
curl -i http://127.0.0.1:3001/api/health; echo; echo "exit=$?"
```

Expected: `HTTP/1.1 200 OK`, `Cache-Control: no-store`, `Content-Type: application/json`, and the body `{"status":"ok","checks":{"database":"up"}}`.

Result (pass / fail): **pass**

```text
HTTP/1.1 200 OK
X-Powered-By: Express
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42
ETag: W/"2a-Tq9VPg/LVOfKgI9CZKtpRf5RxEk"
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok","checks":{"database":"up"}}
exit=0
```

Notes: `Date` header omitted. `X-Powered-By: Express` is sent; not in scope of this run (a hardening item for a later slice).

## Step 6. Database container stopped: 503, then 200 again

```bash
docker stop kd-docker-postgres-1; echo "exit=$?"
curl -i http://127.0.0.1:3001/api/health; echo; echo "exit=$?"
docker start kd-docker-postgres-1; echo "exit=$?"
pnpm dev:infra:status; echo "exit=$?"
curl -i http://127.0.0.1:3001/api/health; echo; echo "exit=$?"
```

Run the last `curl` once `dev:infra:status` shows postgres healthy.

Expected:

- With postgres stopped: `HTTP/1.1 503 Service Unavailable` within about one second (the check times out after 1000 ms) and the body `{"status":"error","checks":{"database":"down"}}`: no host, port, user, password or driver message.
- After the start: postgres healthy, and the health route answers 200 again without restarting the API.
- The watcher of step 4 logs no URL or password.

Then **stop the watcher of step 4 with Ctrl-C**.

Result (pass / fail): **pass**

```text
kd-docker-postgres-1
exit=0
HTTP/1.1 503 Service Unavailable
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 47

{"status":"error","checks":{"database":"down"}}
exit=0
kd-docker-postgres-1
exit=0
$ scripts/dev-infra.sh status
[kd] s3-init    exited(0)    -          -
[kd] postgres   running      starting   127.0.0.1:5452->5432/tcp
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42

{"status":"ok","checks":{"database":"up"}}
exit=0
```

Notes: the 503 came at once (06:34:57, the stop at 06:34:57) and its body has no host, port, user, password or driver message. The last `curl` ran while the container's health was still `starting`, about one second after the start, and already answered 200: PostgreSQL accepted connections before its health check passed, and the API reconnected without a restart. Other headers as in step 5.

## Step 7. `APP_ENV=prod` with a placeholder password: the API refuses to start

`CHANGE_ME_LOCAL` is the repository's local placeholder password (decision 0002, section 5), not a secret.

```bash
APP_ENV=prod DATABASE_URL_APP=postgres://kd_app:CHANGE_ME_LOCAL@127.0.0.1:5452/kd_dev node apps/api/dist/main.js; echo "exit=$?"
lsof -nP -sTCP:LISTEN -iTCP:3001
```

Expected: one line on stderr, `DATABASE_URL_APP: must not embed the placeholder password when APP_ENV is demo or prod`, naming the variable and no value (no URL, no `CHANGE_ME_LOCAL`); `exit=1`; the application never starts, so `lsof` prints nothing.

Result (pass / fail): **pass**

```text
DATABASE_URL_APP: must not embed the placeholder password when APP_ENV is demo or prod
exit=1
COMMAND   PID           USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    95833 <owner>   17u  IPv6 0xf62ccce800ec5c58      0t0  TCP *:3001 (LISTEN)
```

Notes: the refusal names the variable and no value, `exit=1`. The `lsof` line is the `pnpm dev:api` watcher of step 4, which was still running (its PID changes to 97520 in the final check, after the watcher restarted on the edit of step 8); `main.js` itself exited before Nest booted. Expected `lsof` to print nothing once the watcher is stopped.

## Step 8. `openapi:check` passes, fails after a DTO change, passes after the revert

```bash
pnpm openapi:check; echo "exit=$?"
perl -0pi -e 's/(  checks!: HealthChecksDto;\n)/$1  version!: string;\n/' apps/api/src/health/health-report.dto.ts
git diff --stat
pnpm openapi:check; echo "exit=$?"
git checkout -- apps/api/src/health/health-report.dto.ts
git status --short
pnpm openapi:check; echo "exit=$?"
```

Expected:

- First run: `openapi.json is up to date`, `openapi.ts is up to date`, then `breaking-change check inactive: no released snapshot yet`; `exit=0`. No database or network is needed (the API is built and the document is generated in preview mode).
- After the edit: `git diff --stat` shows one changed file, `health-report.dto.ts`. `@kd/api#openapi:check` fails with `differs from the generated document`, the first differing line (a `version` property in the `HealthReport` schema), the path of the kept temporary file and `run pnpm openapi:generate`; `exit` is not 0.
- After the revert: `git status --short` prints nothing and the last run passes again; `exit=0`.

Result (pass / fail): **pass**

```text
@kd/contracts:client:check: client:check: <repo>/packages/contracts/src/generated/openapi.ts is up to date
@kd/api:openapi:check: openapi:check: <repo>/packages/contracts/openapi.json is up to date
 Tasks:    4 successful, 4 total
Cached:    4 cached, 4 total
breaking-change check inactive: no released snapshot yet (packages/contracts/openapi.released.json)
exit=0
 apps/api/src/health/health-report.dto.ts | 1 +
 1 file changed, 1 insertion(+)
@kd/api:build: cache miss, executing 046516cffd8a0ad8
@kd/api:openapi:check: cache miss, executing 2e9bf4a7c1a631de
@kd/api:openapi:check: openapi:check: <repo>/packages/contracts/openapi.json differs from the generated document
@kd/api:openapi:check: first difference at line 49:
@kd/api:openapi:check:   committed:           }
@kd/api:openapi:check:   generated:           },
@kd/api:openapi:check: generated document kept at /tmp/kd-openapi-VOYaGa/openapi.json
@kd/api:openapi:check: run `pnpm openapi:generate` and commit the result
@kd/api#openapi:check:  ERROR  command (<repo>/apps/api) <home>/.nvm/versions/node/v24.21.0/bin/pnpm run openapi:check exited (1)
 Tasks:    3 successful, 4 total
Failed:    @kd/api#openapi:check
exit=1
?? docs/smoke-runs/foundation/phase4.md
 Tasks:    4 successful, 4 total
Cached:    4 cached, 4 total
breaking-change check inactive: no released snapshot yet (packages/contracts/openapi.released.json)
exit=0
```

Notes: the check fails on the DTO edit and passes after the revert (cache hits restore the committed state). The first difference is the line before the new property: keys are sorted, so `version` comes after `status`, whose closing brace gains a comma. The temporary file under `/tmp` is kept by design and can be deleted. The `pnpm` path in the turbo error is the Corepack shim of the Node 24.21.0 install: Node 26 ships no Corepack, so the 26.13.0 install has no `pnpm` and `PATH` falls through to the 24 install; the shim runs with `/usr/bin/env node`, which is Node 26 after `nvm use` (otherwise `engineStrict` would have refused). Not a fault, but it breaks if the Node 24 install is removed: follow-up, install pnpm 12.16.1 for Node 26.

## Step 9. Build the admin (peak memory and wall time)

```bash
/usr/bin/time -l pnpm --filter @kd/admin build; echo "exit=$?"
```

Expected: `ng build` exits 0 and prints the bundle sizes (P4-T6 recorded 388.81 kB raw, 89.08 kB transfer for the initial bundle; the typed client factory is not imported yet, so the size should not change).

| Measure | Value |
|---|---|
| Wall time (`real`) | 1.96 s |
| Maximum resident set size | 553566208 bytes (~528 MiB) |
| Peak memory footprint | 20499144 bytes (~20 MiB) |
| Initial bundle (raw / transfer) | 388.81 kB / 89.08 kB (unchanged from P4-T6) |

Result (pass / fail): **pass**

```text
$ ng build
Initial chunk files | Names         |  Raw size | Estimated transfer size
main-EDAKQILX.js    | main          | 384.59 kB |                88.24 kB
styles-ZL4FRN7Q.css | styles        |   4.22 kB |               841 bytes

                    | Initial total | 388.81 kB |                89.08 kB

Application bundle generation complete. [1.273 seconds]
Output location: <repo>/apps/admin/dist/admin
        1.96 real         2.46 user         0.56 sys
           553566208  maximum resident set size
            20499144  peak memory footprint
exit=0
```

Notes: other `time -l` counters omitted.

## Step 10. `expo-doctor` for the mobile app

`expo-doctor` is not a dependency of `@kd/mobile`, so `pnpm --filter @kd/mobile exec expo-doctor` finds no binary; it runs through `pnpm dlx` from `apps/mobile`. `app.config.ts` needs `KD_MOBILE_DEV_API_URL` (any URL ending in `/api`); the command builds it from the machine's LAN address.

```bash
cd apps/mobile
KD_MOBILE_DEV_API_URL="http://$(ipconfig getifaddr en0):3001/api" pnpm dlx expo-doctor@1.21.6; echo "exit=$?"
cd ../..
```

Expected: every check passes except, until the SDK 58 patch set moves to `expo` 58.0.23 (decision 0001, "Pending SDK 58 patch"), "Check that packages match versions required by installed Expo SDK", which lists the seven packages of that set. Any other failing check is unexpected.

Result (pass / fail / known failure only): **known failure only**

```text
19/20 checks passed. 1 checks failed. Possible issues detected:

✖ Check that packages match versions required by installed Expo SDK

⚠️ Minor version mismatches
package                         expected  found
react-native-safe-area-context  ~5.11.1   5.10.1

🔧 Patch version mismatches
package                         expected  found
@expo/metro-runtime             ~58.0.17  58.0.16
expo                            ~58.0.23  58.0.22
expo-constants                  ~58.0.15  58.0.14
expo-linking                    ~58.0.16  58.0.15
expo-router                     ~58.0.30  58.0.29
jest-expo                       ~58.0.14  58.0.13

7 packages out of date.
1 check failed, indicating possible issues with the project.
exit=1
```

Notes: exactly the seven packages of the pending SDK 58 patch set (decision 0001); every other check passes. It clears when the set moves to `expo` 58.0.23 after pnpm's `minimumReleaseAge` (about 2026-11-04 17:07Z).

## Step 11. The `apps` profile with the real API image

First run of the sibling's `compose.apps.yaml` with an image of `apps/api/Dockerfile` (P4-T5). The image is rebuilt first, because the API changed after P4-T5 (P4-T8).

How `API_TAG` reaches Compose: `scripts/up.sh` passes `versions.env` with `--env-file` (it does not `source` it) and sources only `.env`, which has no `API_TAG`. Compose gives a variable of the shell environment precedence over the `--env-file` files, so an `API_TAG` of `0.0.0-local` set for one command wins over the placeholder tag `0.0.0-unpublished` in `versions.env`, and `versions.env` stays unchanged. Compose pulls only missing images, so the local tag is used and nothing is pulled from GHCR.

`scripts/gen-dev-secrets.sh` (the sibling README's first step for `--apps`) is not needed for this run: the API reads none of the JWT or OTP variables yet (see the table below). Skip it unless the run fails without it, and say so in "Notes".

```bash
docker build -f apps/api/Dockerfile -t kd-api:local .; echo "exit=$?"
docker tag kd-api:local ghcr.io/truongtankhanh/kitchen-daylight-api:0.0.0-local; echo "exit=$?"
cd ../kitchen-daylight-docker
API_TAG=0.0.0-local scripts/up.sh --apps; echo "exit=$?"
scripts/status.sh; echo "exit=$?"
docker logs kd-docker-migrate-1; echo "exit=$?"
docker inspect --format '{{.State.ExitCode}}' kd-docker-migrate-1
docker inspect --format '{{.State.Health.Status}}' kd-docker-api-1
curl -i http://127.0.0.1:3020/api/health; echo; echo "exit=$?"
curl -i http://127.0.0.1:8020/api/health; echo; echo "exit=$?"
curl -i http://127.0.0.1:8020/; echo; echo "exit=$?"
git status --short
cd ../kitchen-daylight
```

Expected:

- The build exits 0; the tag exists (`docker images ghcr.io/truongtankhanh/kitchen-daylight-api` lists `0.0.0-local`).
- `up.sh --apps` starts `migrate`, `api` and `caddy` next to the dependencies; no pull error for the API image; `exit=0`.
- `migrate`: logs `migrate: nothing to apply` (or the applied files), exit code `0`.
- `api`: health `healthy`.
- `/api/health` answers 200 with `{"status":"ok","checks":{"database":"up"}}` on the slot port (3020) and through Caddy (8020), with the path unchanged.
- `curl http://127.0.0.1:8020/` answers with the placeholder admin page (`ADMIN_DIST` not set).
- The sibling's `git status --short` prints nothing: `versions.env` is unchanged.

Result (pass / fail): **pass**

```text
[+] Building 26.2s (21/21) FINISHED
 => [build 7/7] RUN pnpm install --offline --frozen-lockfile --filter "@kd/api..." && pnpm --filter "@kd/api..." run build && pnpm --filter @kd/api deploy --prod /prod/api   6.4s
 => => naming to docker.io/library/kd-api:local
exit=0
exit=0
[kd] starting the stack (up -d)
[+] Running 7/7
 ✔ Container kd-docker-s3-1        Healthy   1.2s
 ✔ Container kd-docker-postgres-1  Healthy   1.2s
 ✔ Container kd-docker-mailpit-1   Healthy   2.3s
 ✔ Container kd-docker-migrate-1   Exited    2.8s
 ✔ Container kd-docker-caddy-1     Started   1.4s
 ✔ Container kd-docker-api-1       Started   2.7s
 ✔ Container kd-docker-s3-init-1   Exited    1.1s
[kd] waiting for: api caddy
[kd] waiting for: api
[kd] all services ready
(print-env.sh output, passwords as ***)
exit=0
[kd] api        running      healthy    127.0.0.1:3020->3000/tcp
[kd] caddy      running      healthy    127.0.0.1:8020->80/tcp
[kd] migrate    exited(0)    -          -
[kd] s3-init    exited(0)    -          -
[kd] postgres   running      healthy    127.0.0.1:5452->5432/tcp
[kd] s3         running      healthy    127.0.0.1:9020->8333/tcp
[kd] mailpit    running      healthy    127.0.0.1:1045->1025/tcp 127.0.0.1:8045->8025/tcp
exit=0
migrate: nothing to apply
exit=0
0
healthy
HTTP/1.1 200 OK
X-Powered-By: Express
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 42

{"status":"ok","checks":{"database":"up"}}
exit=0
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Length: 42
Content-Type: application/json; charset=utf-8
Via: 1.1 Caddy
X-Powered-By: Express

{"status":"ok","checks":{"database":"up"}}
exit=0
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Server: Caddy

<title>Placeholder: admin build not mounted</title>
exit=0
```

Notes: first run of the `apps` profile with a real image: every expectation holds. `API_TAG=0.0.0-local` was used without a pull and without editing `versions.env` (the sibling's `git status --short` printed nothing). `scripts/gen-dev-secrets.sh` was not run, and the API still became healthy (see the table). The image is `linux/arm64` only (built on this machine); its build took 26.2 s with warm layers. Build log, `Date`, `ETag` headers and the placeholder page body shortened.

### Differences from the sibling's `docs/api-contract.md`

Every row of `api-contract.md` is "assumed, confirm with the monorepo". The middle column is what the monorepo does today (read from the code at P4-T8); the run fills in "Observed" and "Difference?". Copy each difference to the sibling repository as a follow-up (its page says "Any difference from this page is corrected here first").

| Contract item (`api-contract.md`) | Assumed by the Docker repository | Monorepo today | Observed in this run | Difference? |
|---|---|---|---|---|
| Image name | `ghcr.io/truongtankhanh/kitchen-daylight-api`, public package | Built locally as `kd-api:local` and tagged with this name; not published yet (no CI publish task so far) | The local tag was used by `migrate` and `api` with no pull | yes: not published yet; the CI publish task names the package |
| Tag convention | SemVer `X.Y.Z` without `v`, published by CI, never `latest` | `0.0.0-local` is a local tag for this run only; no published tag | `0.0.0-local` set for one run; `versions.env` unchanged | no (a run-only tag) |
| Platforms | `linux/amd64` and `linux/arm64` | Built and checked on `linux/arm64` only (P4-T5); amd64 not built | `linux/arm64` image, built and run on this machine | yes: amd64 not built yet |
| Contents | `node` on `PATH`, compiled app in the working directory, non-root user | `node:26.13.0-trixie-slim`, `/app` with `dist/`, `migrations/`, `node_modules`; user `node` (uid 1000); `CMD node dist/main.js` (P4-T5) | `migrate` and `api` ran; the `node` health check passed | no |
| `API_MIGRATE_CMD` | `node dist/cli.js migrate`, exit 0, idempotent | Same command; exit codes 0 ok, 1 failure, 2 usage, 3 config, 4 integrity | `migrate: nothing to apply`, exit code 0 | no |
| `API_SEED_CMD` | `node dist/cli.js seed reference\|business\|demo`, dry run unless `--commit` | **No `seed` command yet**: the CLI has `migrate` only, an unknown command exits 2 (usage) | not exercised | yes: no `seed` command until the seed slice |
| `migrate` environment | `APP_ENV` and `DATABASE_URL` only | Reads `APP_ENV` and `DATABASE_URL` (the container name; `DATABASE_URL_MIGRATOR` on the host) | Ran with the two variables only | no |
| Health path | `GET /api/health` on port 3000, 200 once the database is reachable | Same, version-neutral (outside `/api/v1`), `Cache-Control: no-store`; **503** with `{"status":"error","checks":{"database":"down"}}` when the database does not answer | 200 on 3020 with `{"status":"ok","checks":{"database":"up"}}` | addition: the 503 body and `Cache-Control: no-store` are not in the contract |
| Health check | `node -e "fetch(...)"` inside the container | Node 26 has `fetch`; no `curl` or `wget` in the image | `api` became `healthy` | no |
| Routing | Global prefix `/api`; Socket.IO on `/socket.io` | Prefix `api` and URI versioning `v1` (`configureApp`); **no Socket.IO gateway yet** | `/api/health` through Caddy (8020) answered 200, `Via: 1.1 Caddy`, path unchanged | yes for Socket.IO only: no gateway yet |
| `APP_ENV` | `dev` fixed; the API must refuse `prod` with an emulator adapter | Accepts `dev\|test\|demo\|prod`; refuses the placeholder password outside `dev` and `test`; **no adapter check yet** (no adapter exists) | `dev` (fixed by Compose); the `prod` refusal was checked on the host (step 7) | yes: no adapter check yet |
| `PORT` | `3000` | Default 3000, valid 1 to 65535 | Listened on 3000 (`3020->3000`) | no |
| `DATABASE_URL` | `api`: `kd_app`; `migrate`: `kd_migrator` | Same; setting both `DATABASE_URL` and the host name (`DATABASE_URL_APP` or `_MIGRATOR`) is refused as ambiguous | `migrate` and `api` connected | no |
| `LOG_LEVEL` | not listed | Read by the API (default `info`); not set by `compose.apps.yaml` | Not set; default `info` | addition: the contract does not list it |
| `MAIL_ADAPTER`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` | `smtp`, `mailpit`, `1025` | **Not read yet** (no mail module) | Set by Compose, ignored by the API | yes: not read yet |
| `STORAGE_ADAPTER`, `STORAGE_S3_*` | `s3`, `http://s3:8333`, buckets `kd-dev-media`, `kd-dev-private` | **Not read yet** (no storage module) | Set by Compose, ignored by the API | yes: not read yet |
| `GEOCODE_ADAPTER` | `fixture` | **Not read yet** | Set by Compose, ignored by the API | yes: not read yet |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID` | Written by `gen-dev-secrets.sh`; empty values make the API's startup validation fail fast | **Not read yet** (no auth module): empty values do not fail startup | Empty (`gen-dev-secrets.sh` not run); `api` still became healthy | yes: empty keys do not fail startup yet |
| `OTP_HMAC_SECRET` | 256 random bits, base64 | **Not read yet** | Placeholder value; ignored by the API | yes: not read yet |

Notes: the rows marked "yes" and "addition" go to the sibling's `docs/api-contract.md` as a follow-up in that repository: the image is not published, amd64 is not built, there is no `seed` command, no Socket.IO gateway and no adapter check, the mail, storage, geocode, JWT and OTP variables are not read yet (so empty JWT keys do not fail startup), and the 503 body, `Cache-Control: no-store` and `LOG_LEVEL` are not described.

## Final check: back to dependencies only

```bash
cd ../kitchen-daylight-docker
scripts/down.sh; echo "exit=$?"
cd ../kitchen-daylight
pnpm dev:infra; echo "exit=$?"
docker ps --format '{{.Names}}'
lsof -nP -sTCP:LISTEN -iTCP:3001 -iTCP:3020 -iTCP:8020
git status --short
```

Expected: `down.sh` removes the containers (volumes kept); `dev:infra` starts the dependencies only; `docker ps` lists no `api`, `migrate` or `caddy` container; nothing listens on 3001, 3020 or 8020; `git status --short` shows only this sheet (until it is committed).

Result (pass / fail): **pass with one deviation**

```text
[kd] removing containers of project kd-docker:
[kd]   kd-docker-api-1
[kd]   kd-docker-caddy-1
[kd]   kd-docker-migrate-1
[kd]   kd-docker-s3-init-1
[kd]   kd-docker-postgres-1
[kd]   kd-docker-s3-1
[kd]   kd-docker-mailpit-1
[kd] volumes are kept
[kd] stack is down
exit=0
$ scripts/dev-infra.sh up
[kd] Docker repository compatible: VERSION 0.0.0, required 0.0.0 (../kitchen-daylight-docker)
[kd] starting the stack (up -d)
[kd] all services ready
(print-env.sh output, passwords as ***)
exit=0
kd-docker-s3-1
kd-docker-postgres-1
kd-docker-mailpit-1
COMMAND   PID           USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    97520 <owner>   17u  IPv6 0x9110e4f52ebe45ee      0t0  TCP *:3001 (LISTEN)
?? docs/smoke-runs/foundation/phase4.md
```

Notes: `down.sh` also removes the `apps` containers; the volumes are kept; only the dependencies run afterwards; 3020 and 8020 are free. **Deviation:** port 3001 is still held by the `pnpm dev:api` watcher of step 4, never stopped with Ctrl-C (same process tree as in step 7). Stop it in the second terminal and confirm with `lsof -nP -sTCP:LISTEN -iTCP:3001` (no output).

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | yes, with one procedural deviation: the `dev:api` watcher was not stopped after step 6, so `lsof` showed it on 3001 in step 7 and in the final check |
| Failed or skipped steps | none failed; step 10 shows only the known SDK 58 patch mismatch; `env:sync` reused the existing `.env` (exit 3, no `--force`) |
| Peak memory / wall time, step 1 (API build) | ~355 MiB maximum RSS, 1.67 s |
| Peak memory / wall time, step 9 (admin build) | ~528 MiB maximum RSS, 1.96 s |
| Differences from `api-contract.md` to send to the Docker repository | image not published, amd64 not built; no `seed` command; no Socket.IO gateway; no adapter check for `prod`; mail, storage, geocode, JWT and OTP variables not read yet (empty JWT keys do not fail startup); 503 body, `Cache-Control: no-store` and `LOG_LEVEL` not described |
| Follow-up tasks opened | (1) update the sibling's `api-contract.md` with the differences above (sibling repository); (2) move the SDK 58 patch set to `expo` 58.0.23 after the release-age gate; (3) install pnpm 12.16.1 for Node 26 on the owner's machine, which today runs the Node 24 Corepack shim |
| Owner | `truongtankhanh` (repository owner) |
| Date | 2026-11-04 |
