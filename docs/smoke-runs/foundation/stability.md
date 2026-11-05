# Stability sweep and architecture gate (P6-T3)

Owner checklist for the end of the foundation. Every step runs on a **fresh clone in a new folder**, following only the [README](../../../README.md), and repeats what the [phase 1](phase1.md), [phase 2](phase2.md) and [phase 4](phase4.md) sheets proved once: install, the local stack, the Turborepo cache, the guards that must fail, CI on a pull request, and the Docker `apps` profile with the image that CI published. It ends with the architecture gate for the whole foundation.

**Scope:** no step runs a test suite or a dev server (the dev servers are in [phase 6](phase6.md)). Steps 4 and 5 make deliberate violations; each one is reverted or closed in the same step. Step 5 pushes five throw-away branches and opens five draft pull requests, all closed and deleted in the step. No step deletes a Docker volume.

## How to run

- Run one step at a time, in order. Paste the output into the empty block of the step and fill in the result.
- Stop at the first unexpected result, write it in "Notes" and share it in the session before going on.
- **Before pasting, replace every password with `***`** and home paths with `<repo>` or `$SMOKE_ROOT`. Never paste the content of `.env`.
- The command blocks hold no comment lines and no `<...>` placeholders: the interactive zsh of macOS does not treat `#` as a comment, and it reads `<` as a redirection.
- Exit codes: each command is followed by `echo "exit=$?"`.
- Wall time and peak memory: from `/usr/bin/time -l`, record `real` (seconds) and `maximum resident set size` (bytes; the largest single process, not the sum).
- Prerequisites as in the README, including pnpm 12.16.1 for Node 26 ([phase 6](phase6.md), step 0).

## Run details

| Field | Value |
|---|---|
| Date | |
| Machine / OS / chip / RAM | |
| Monorepo commit (`git rev-parse --short HEAD` in the clone) | |
| Sibling commit (`git -C ../kitchen-daylight-docker rev-parse --short HEAD` in the clone) | |
| `docker-repo.version` | |
| pnpm store warm or cold | |

## Step 0. Free the slot

The fresh clone gets its own sibling folder, so the stack of the working copy must be down first. From the root of the **working copy**:

```bash
nvm use
pnpm dev:infra:down; echo "exit=$?"
docker ps --format '{{.Names}}'
docker volume ls --format '{{.Name}}' | grep -E 'kd-docker_(pgdata|s3data)'
lsof -nP -sTCP:LISTEN -iTCP:3001 -iTCP:3020 -iTCP:8020
```

Expected: the stack is down (`exit=0`); `docker ps` lists no `kd-docker-*` container; the two volumes are listed (they are kept); nothing listens on 3001, 3020 or 8020.

Result (pass / fail): 

```text
```

Notes:

## Step 1. Fresh clone: `scripts/bootstrap.sh` and `pnpm install --frozen-lockfile`

From the root of the working copy. The clone comes from the GitHub remote, so steps 5 and 7 use the published repository. The clone's path is saved to `$TMPDIR/kd-stability-root` for a second terminal.

```bash
SMOKE_ROOT="$(mktemp -d)"
echo "$SMOKE_ROOT" > "$TMPDIR/kd-stability-root"
git clone "$(git remote get-url origin)" "$SMOKE_ROOT/kitchen-daylight"
cd "$SMOKE_ROOT/kitchen-daylight"
nvm use
git rev-parse --short HEAD
/usr/bin/time -l scripts/bootstrap.sh; echo "exit=$?"
/usr/bin/time -l pnpm install --frozen-lockfile; echo "exit=$?"
pnpm env:sync; echo "exit=$?"
git status --short
```

Expected:

- `bootstrap.sh`: `prerequisites ok`; the sibling is **cloned** into `$SMOKE_ROOT/kitchen-daylight-docker` and checked out at the tag of `docker-repo.version` (or the default branch with a warning when no tag matches); its `.env` is initialised for slot 2; the version check passes; every service healthy; `exit=0`. An exit 3 (port or slot in use) means step 0 left something running: stop and report.
- The new sibling uses the same Compose project, `kd-docker` (the default of `COMPOSE_PROJECT_NAME` in its `compose.yaml`), so it reuses the volumes `kd-docker_pgdata` and `kd-docker_s3data` of step 0. That is expected and safe: its `init-env.sh` writes `.env` from the same `.env.example`, so the placeholder credentials match the data already in the volumes. A database login error here means they do not: stop and report.
- The install exits 0 with no lockfile change, and the `prepare` script installs the hooks.
- `env:sync` writes `.env` with mode 600; `exit=0`.
- `git status --short` prints nothing.

| Measure | Value | Target (implementation-phases section 5) |
|---|---|---|
| `bootstrap.sh` wall time (`real`) | | under 1 min after the images are pulled (say whether they were) |
| `pnpm install --frozen-lockfile` wall time (`real`) | | under 60 s, warm store |
| `pnpm install` maximum resident set size | | recorded only |

Result (pass / fail): 

```text
```

Notes:

## Step 2. Three `dev:infra` / `dev:infra:down` cycles keep the data

The volume creation times prove the data volumes are the same ones after each cycle.

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
docker volume inspect --format '{{.Name}} {{.CreatedAt}}' kd-docker_pgdata kd-docker_s3data
for i in 1 2 3; do echo "== cycle $i"; pnpm dev:infra:down; echo "down exit=$?"; pnpm dev:infra; echo "up exit=$?"; pnpm dev:infra:status; echo "status exit=$?"; docker volume inspect --format '{{.Name}} {{.CreatedAt}}' kd-docker_pgdata kd-docker_s3data; done
```

Expected, identical in the three cycles:

- `down`: removes the containers, `volumes are kept`, `exit=0`.
- `up`: the version check passes, every service is ready, `exit=0`.
- `status`: postgres, mailpit and s3 `running healthy` on 5452, 1045/8045 and 9020, all bound to `127.0.0.1`; `s3-init exited(0)`; `exit=0`.
- The two volume lines are the same before the loop and after every cycle (same names, same `CreatedAt`).

Result (pass / fail): 

```text
```

Notes:

## Step 3. `lint typecheck build` twice: the second run is a cache hit

This runs `ng build` for the admin inside Turborepo (the owner runs it, not an agent).

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
/usr/bin/time -l pnpm turbo run lint typecheck build --concurrency=2; echo "exit=$?"
/usr/bin/time -l pnpm turbo run lint typecheck build --concurrency=2; echo "exit=$?"
git status --short
```

Expected: both runs exit 0. The first shows `0 cached`. The second shows `N cached, N total` and `>>> FULL TURBO`. `git status --short` prints nothing: the build writes only ignored outputs, and `@kd/design-tokens` regenerates its committed files byte for byte.

| Measure | First run (cold) | Second run (cached) | Target (section 5) |
|---|---|---|---|
| Wall time (`real`) | | | `lint typecheck` cold under 2 min, all cached under 10 s (this run adds `build`) |
| Maximum resident set size | | | workspace `build` with `--concurrency=2`: recorded, the owner sets the ceiling |
| Tasks / cached | | | all cached on the second run |

Result (pass / fail): 

```text
```

Notes:

## Step 4. Deliberate violations: each must fail locally, then be reverted

Run 4a to 4e in order. Each ends with `git status --short` printing nothing.

### 4a. One app imports another

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
printf "import '@kd/api';\n" >> apps/admin/src/app/app.ts
pnpm --filter @kd/admin lint; echo "exit=$?"
git checkout -- apps/admin/src/app/app.ts
git status --short
```

Expected: ESLint reports `no-restricted-imports` for `@kd/api` in `apps/admin/src/app/app.ts`; `exit` is not 0. After the revert, `git status --short` prints nothing.

Result (pass / fail): 

```text
```

### 4b. A health DTO change without regenerating the snapshot

The same edit as [phase 4](phase4.md), step 8.

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
perl -0pi -e 's/(  checks!: HealthChecksDto;\n)/$1  version!: string;\n/' apps/api/src/health/health-report.dto.ts
git diff --stat
pnpm openapi:check; echo "exit=$?"
git checkout -- apps/api/src/health/health-report.dto.ts
pnpm openapi:check; echo "exit=$?"
git status --short
```

Expected: `git diff --stat` shows one file. The first `openapi:check` fails with `differs from the generated document` and `run pnpm openapi:generate`; `exit` is not 0. After the revert it passes (`exit=0`) and `git status --short` prints nothing.

Result (pass / fail): 

```text
```

### 4c. A stale design-token output

As checked at the Phase 5 review (decision 0002, implementation notes).

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
printf '/* stale */\n' >> packages/design-tokens/src/tokens.css
pnpm --filter @kd/design-tokens tokens:check; echo "exit=$?"
git checkout -- packages/design-tokens/src/tokens.css
pnpm --filter @kd/design-tokens tokens:check; echo "exit=$?"
git status --short
```

Expected: the first check exits 1 and names `src/tokens.css`; after the revert it exits 0 and `git status --short` prints nothing.

Result (pass / fail): 

```text
```

### 4d. A staged fake secret

The same fake key as [phase 1](phase1.md), step 6, built at run time. The 16 characters after `AKIA` stay within `A-Z` and `2-7`, or the gitleaks AWS rule does not match.

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
printf 'aws_access_key_id=AKIA%s\n' 'QZ7XW4R3T5Y2UPKD' > smoke-leak-check.txt
git add smoke-leak-check.txt
git commit -m "chore: smoke leak check"; echo "exit=$?"
if [ "$(git log -1 --format=%s)" = "chore: smoke leak check" ]; then git reset --soft HEAD~1; fi
git restore --staged smoke-leak-check.txt
rm -f smoke-leak-check.txt
git status --short
```

Expected: the `pre-commit` hook reports `aws-access-token` and `leaks found: 1`; `exit` is not 0; the commit does not exist; `git status --short` prints nothing.

Result (pass / fail): 

```text
```

### 4e. A bad commit message

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
git commit --allow-empty -m "bad message"; echo "exit=$?"
git log -1 --format=%s
git status --short
```

Expected: commitlint rejects the message (`subject-empty`, `type-empty`); `exit=1`; `git log` shows the clone's `HEAD` subject, not `bad message`. If the commit went through, undo it with `git reset --soft HEAD~1` and report a fail.

Result (pass / fail): 

```text
```

Notes for step 4:

## Step 5. The same violations on pull requests: CI must go red

One draft pull request per violation, each on its own branch from `main`, so one failure cannot hide another: the CI `verify` job runs `tokens:check` before lint and `openapi:check`, and the gitleaks job scans the full history of the branch. Each commit uses `--no-verify`, because the local hooks of step 4 would stop it. Do not merge any of them.

**Why 5d uses a generic key, not the AWS one of 4d.** Push protection is on for this repository and non-provider patterns are off (`gh api repos/{owner}/{repo}`, read 2026-11-05). An AWS-shaped key could be refused at push time, so the CI gitleaks job would never run. 5d uses a random value under an `api_key` name: gitleaks 8.30.1 with `.gitleaks.toml` reports it as `generic-api-key` (checked on a scratch file, 2026-11-05), and GitHub does not scan that pattern, so the CI job is the check under test. The value is random and fake; it stays reachable through the pull request ref after the branch is deleted, which is harmless.

The five blocks share the same shape: create the branch, make the violation, push, open a draft pull request, wait for the checks, record them, close the pull request and delete the branch.

### 5a. App import

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
git switch main
git switch -c smoke/stability-app-import
printf "import '@kd/api';\n" >> apps/admin/src/app/app.ts
git commit --no-verify -am "test(admin): smoke violation, app imports the api"
git push -u origin smoke/stability-app-import; echo "exit=$?"
gh pr create --draft --title "smoke: app import violation (do not merge)" --body "Stability sweep P6-T3, step 5a. Must fail CI. Closed without merging."
gh pr checks --watch; echo "exit=$?"
gh pr close --delete-branch; echo "exit=$?"
git switch main
```

Expected: the `ci` workflow fails in its lint step on `no-restricted-imports`; `gh pr checks` exits non-zero. Record the failing job and step names.

Result (pass / fail): 

```text
```

### 5b. Health DTO without the snapshot

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
git switch main
git switch -c smoke/stability-openapi-drift
perl -0pi -e 's/(  checks!: HealthChecksDto;\n)/$1  version!: string;\n/' apps/api/src/health/health-report.dto.ts
git commit --no-verify -am "test(api): smoke violation, DTO change without the snapshot"
git push -u origin smoke/stability-openapi-drift; echo "exit=$?"
gh pr create --draft --title "smoke: OpenAPI drift violation (do not merge)" --body "Stability sweep P6-T3, step 5b. Must fail CI. Closed without merging."
gh pr checks --watch; echo "exit=$?"
gh pr close --delete-branch; echo "exit=$?"
git switch main
```

Expected: the `ci` workflow fails on `openapi:check` (`differs from the generated document`). Record the failing job and step names.

Result (pass / fail): 

```text
```

### 5c. Stale design-token output

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
git switch main
git switch -c smoke/stability-tokens-drift
printf '/* stale */\n' >> packages/design-tokens/src/tokens.css
git commit --no-verify -am "test(design-tokens): smoke violation, stale token output"
git push -u origin smoke/stability-tokens-drift; echo "exit=$?"
gh pr create --draft --title "smoke: design-token drift violation (do not merge)" --body "Stability sweep P6-T3, step 5c. Must fail CI. Closed without merging."
gh pr checks --watch; echo "exit=$?"
gh pr close --delete-branch; echo "exit=$?"
git switch main
```

Expected: the `ci` `verify` job fails on `tokens:check`. Record the failing job and step names.

Result (pass / fail): 

```text
```

### 5d. Fake secret

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
git switch main
git switch -c smoke/stability-secret
printf 'smoke_api_key = "%s%s"\n' 'Zq7Xw4R3t5Y2uPkD' 'm9Ln8Bv6Hc' > smoke-leak-check.txt
git add smoke-leak-check.txt
git commit --no-verify -m "test(repo): smoke violation, fake secret"
git push -u origin smoke/stability-secret; echo "exit=$?"
gh pr create --draft --title "smoke: secret violation (do not merge)" --body "Stability sweep P6-T3, step 5d. Must fail CI. Closed without merging."
gh pr checks --watch; echo "exit=$?"
gh pr close --delete-branch; echo "exit=$?"
git switch main
```

Expected: the push succeeds; the `security` workflow's gitleaks job fails with `generic-api-key` in `smoke-leak-check.txt`. If push protection refuses the push anyway, run `git switch main` and `git branch -D smoke/stability-secret`, record the refusal (it still counts as caught) and say in "Notes" that the CI job was not exercised.

Result (pass / fail): 

```text
```

### 5e. Bad commit message

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
git switch main
git switch -c smoke/stability-commit-message
git commit --no-verify --allow-empty -m "bad message"
git push -u origin smoke/stability-commit-message; echo "exit=$?"
gh pr create --draft --title "smoke: commit message violation (do not merge)" --body "Stability sweep P6-T3, step 5e. Closed without merging."
gh pr checks --watch; echo "exit=$?"
gh pr close --delete-branch; echo "exit=$?"
git switch main
```

Expected: the task requires CI to go red for 5a to 5d; for 5e, record whether the commit message check of the `ci` workflow fails (decision 0002, section 4: CI checks the commit messages of a pull request with the same config).

Result (pass / fail): 

```text
```

Notes for step 5 (failing check per pull request, links to the runs):

## Step 6. `git status` is clean after all of it

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
git status --short
git status --short --ignored | grep -v -E '(node_modules|dist|\.turbo|coverage)/$|^!! \.env$'
git branch --list 'smoke/*'
git ls-remote --heads origin 'smoke/*'
gh pr list --state open --search "smoke: in:title"
```

Expected: `git status --short` prints nothing (nothing generated and untracked). The second command prints only ignored build outputs that the first filter does not name; list each one in "Notes" (it is ignored, so it is not a failure, but it should be expected). No local or remote `smoke/*` branch, and no open smoke pull request.

Result (pass / fail): 

```text
```

Notes:

## Step 7. The Docker `apps` profile with the CI-published image

The same run as [phase 4](phase4.md), step 11, but with the tag that `publish-api-image` pushed to GitHub Container Registry (P5-T4) instead of a local build: nothing is built on this machine. A push to `main` is published as `sha-` followed by the first seven characters of the commit (the "Resolve the image tag" step of `.github/workflows/publish-api-image.yml`), so the tag comes from the newest successful publish run; no `read:packages` scope is needed.

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
gh run list --workflow publish-api-image.yml --branch main --status success --limit 1 --json headSha,displayTitle --jq '.[0] | "\(.headSha[:7]) \(.displayTitle)"'
API_TAG="sha-$(gh run list --workflow publish-api-image.yml --branch main --status success --limit 1 --json headSha --jq '.[0].headSha[:7]')"
echo "API_TAG=$API_TAG"
docker image ls ghcr.io/truongtankhanh/kitchen-daylight-api
cd ../kitchen-daylight-docker
API_TAG="$API_TAG" scripts/up.sh --apps; echo "exit=$?"
scripts/status.sh; echo "exit=$?"
docker inspect --format '{{.Config.Image}}' kd-docker-api-1
docker image inspect --format '{{index .RepoDigests 0}} {{.Architecture}}' "ghcr.io/truongtankhanh/kitchen-daylight-api:$API_TAG"
docker logs kd-docker-migrate-1; echo "exit=$?"
curl -i http://127.0.0.1:3020/api/health; echo; echo "exit=$?"
curl -i http://127.0.0.1:8020/api/health; echo; echo "exit=$?"
scripts/down.sh; echo "exit=$?"
git status --short
cd ../kitchen-daylight
```

Expected:

- `API_TAG` is `sha-` and seven hex characters, never `latest` and never `0.0.0-local`.
- `up.sh --apps` pulls that tag from `ghcr.io` (the image was not on this machine before, or it is listed with that tag only after the pull), starts `migrate`, `api` and `caddy`, and waits until they are ready; `exit=0`.
- `kd-docker-api-1` runs `ghcr.io/truongtankhanh/kitchen-daylight-api:` followed by that tag; the image architecture matches the machine (`arm64` here).
- `migrate`: `migrate: nothing to apply`; both `curl` calls answer `200` with `{"status":"ok","checks":{"database":"up"}}`.
- `down.sh` removes the containers and keeps the volumes; the sibling's `git status --short` prints nothing (`versions.env` unchanged).

Result (pass / fail): 

```text
```

Notes:

## Step 8. Figures against the targets

Fill in from steps 1 to 3, and from GitHub for the CI rows:

```bash
cd "$SMOKE_ROOT/kitchen-daylight"
gh run list --workflow ci.yml --branch main --limit 1 --json databaseId,headSha,conclusion
gh run view "$(gh run list --workflow ci.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --json jobs --jq '.jobs[] | "\(.name) \(.conclusion) \(.startedAt) \(.completedAt)"'
gh run view "$(gh run list --workflow api-image.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --json jobs --jq '.jobs[] | "\(.name) \(.conclusion) \(.startedAt) \(.completedAt)"'
```

If `api-image.yml` has no run of its own (it may only be called by another workflow), take the image build job from the latest `ci` or `publish-api-image` run and say which.

| Item | Target (implementation-phases section 5) | Measured | Met? |
|---|---|---|---|
| `pnpm install --frozen-lockfile`, warm store | under 60 s | | |
| `turbo run lint typecheck`, cold | under 2 min (step 3 measures `lint typecheck build`) | | |
| `turbo run lint typecheck`, all cached | under 10 s (step 3, second run) | | |
| Peak memory of a workspace `build` with `--concurrency=2` | recorded; the owner sets the ceiling | | ceiling: |
| `ci.yml` `verify` job | under 10 min | | |
| API image build in CI (amd64) | under 5 min; image size recorded | | |
| `scripts/bootstrap.sh` on a machine that has the sibling | under 1 min after the images are pulled | | |
| Effort, P0 to P6 | about 52 h in total | | |

Section 5 of `implementation-phases.md` is corrected from this table afterwards (it says so itself).

Notes:

## Cleanup

```bash
cd "$HOME"
rm -rf "$SMOKE_ROOT" "$TMPDIR/kd-stability-root"
```

Then bring the working copy's stack back if needed: from the working copy, `pnpm dev:infra`. The volumes were never removed.

## Architecture gate

After every step above passes, the owner runs the review prompt of `docs/implementation/foundation/implementation-phases.md` section 13 in a new Claude Code session, for the **whole foundation**:

- "Phase under review": `0 to 6 - foundation`.
- "Diff under review": the whole history of `main` up to the commit of this sheet, from the first commit (`git rev-list --max-parents=0 HEAD`) to `HEAD`.
- Paste this sheet's results into the session with the prompt.

| Field | Value |
|---|---|
| Review date | |
| Commit reviewed (`git rev-parse --short HEAD`) | |
| Decision (approve / request changes / block) | |
| Problems found (file:line) | |
| Required fixes, each with its task or pull request | |
| Optional improvements kept for later | |

## Sign-off

| Field | Value |
|---|---|
| All steps pass (yes / no) | |
| Failed or skipped steps | |
| Follow-up tasks opened | |
| Architecture gate | |
| Owner | |
| Date | |
