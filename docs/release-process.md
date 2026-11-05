# Release process

How the owner releases this monorepo and hands the API image to the Docker repository (P5-T7). The owner tags; nothing else tags or pushes. Sources: the Docker repository's `docs/release-process.md` and `docs/monorepo-integration.md` (M3 bump rule, M6 tags), decision 0005 section 9 (container contract), decision 0004 section 3b (released OpenAPI snapshot).

Out of scope here:

- The `demo` and `prod` deployment (ECR, Systems Manager, approvals) belongs to the `infra/` slice and is described there.
- The mobile release (EAS Build and Submit) belongs to the mobile release slice.

## Version source

- **One version for the whole monorepo:** the `version` field of the root `package.json`, in SemVer `MAJOR.MINOR.PATCH`. Workspace packages are private and are not released on their own; a release does not change their `version` fields.
- It is `0.0.0` until the first release, as the Docker repository's `VERSION` is until its `0.1.0`.
- **Release tag:** `vMAJOR.MINOR.PATCH` on the release commit of `main` (an annotated tag).
- **API image tags** (`publish-api-image.yml`, P5-T4): `MAJOR.MINOR.PATCH`, the release tag without its `v`, for a release; `sha-<short commit>` for every push to `main`. Never `latest`.

## Which number to bump

The OpenAPI snapshot is the API contract. Once a release exists, its snapshot (`packages/contracts/openapi.released.json`) is the baseline of the breaking-change check in CI (`pnpm openapi:check`, oasdiff).

| Bump | When |
|---|---|
| Major | Once a release exists: a breaking change in the OpenAPI snapshot (the oasdiff check fails against the released snapshot), or a breaking change in the container contract of decision 0005 section 9 (port, user, working directory, commands, CLI subcommands or exit codes, a renamed or newly required environment variable) |
| Minor | A backward-compatible addition: a new endpoint or optional field, a new CLI subcommand, a new environment variable with a default, a new feature of an app |
| Patch | A fix, a documentation change, or a dependency or pin update that changes no behaviour |

Before the first release there is no baseline, so no change counts as breaking.

## Steps

Do them in this order. Do not start a step until the check of the one before it passes.

### 1. Release pull request

On a branch from an up-to-date `main` (for example `release/vX.Y.Z`):

1. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, drop its empty sections, and add a new `## [Unreleased]` above it with the empty sections Added, Changed, Fixed, Removed and Security. Each entry is one line and names the contract it changes, if any.
2. Set `"version": "X.Y.Z"` in the root `package.json` (no `v`).
3. Copy the current snapshot to the released one (decision 0004 section 3b), so every later pull request is checked against this release:
   ```sh
   cp packages/contracts/openapi.json packages/contracts/openapi.released.json
   ```
   After the first release this turns on the oasdiff step of `ci.yml`, which is skipped while the file does not exist. Exceptions go in `packages/contracts/openapi-breaking-ignore.txt`, one line each, approved by the owner in the pull request; within `v1` it stays empty.
4. Title the pull request `chore: release vX.Y.Z`, without a scope: commitlint accepts only workspace names as scopes (decision 0002 section 4).

**Check before merging:** the bump matches the table above (the CHANGELOG entries justify it); the required checks of the `main` ruleset are green (`verify`, `gitleaks (full history, blocking)`, `dependency review (blocking)`; `docs/runbooks/github-settings.md`); the owner ran the tests and attached the output.

### 2. Merge to `main`

Squash-merge the pull request.

**Check:** the `ci` and `publish-api-image` runs of the merge commit on `main` are green. The second one publishes `sha-<short commit>`; a red run here means the tag would fail too.

### 3. Tag the release commit

```sh
git switch main
git pull --ff-only
git log -1 --format='%h %s'                     # the squash commit "chore: release vX.Y.Z"
node -p 'require("./package.json").version'     # X.Y.Z
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

**Check:** both printed values match before tagging. Never move or delete a pushed tag (the `release-tags` ruleset blocks it); a mistake is fixed by the next patch release.

### 4. Wait for `publish-api-image.yml` on the tag

The run checks that the tag is `vMAJOR.MINOR.PATCH` and that its commit is on `main`, fails if the image contains a `.env` file, then pushes `ghcr.io/truongtankhanh/kitchen-daylight-api:X.Y.Z` for `linux/amd64` and `linux/arm64`.

**Check:** the run is green and its job summary shows the tag `X.Y.Z`. Do not re-run it once the digest is recorded: a rebuild pushes the same tag with a new digest.

### 5. Record the digest

Copy the pin `ghcr.io/truongtankhanh/kitchen-daylight-api:X.Y.Z@sha256:<digest>` from the job summary into the GitHub release of `vX.Y.Z` (release notes: the CHANGELOG section of `X.Y.Z` plus the pin). The `sha-<short commit>` image of step 2 is a separate build of the same commit and may have another digest; the Docker repository uses the `X.Y.Z` one.

**Check:** `docker manifest inspect ghcr.io/truongtankhanh/kitchen-daylight-api:X.Y.Z` lists `linux/amd64` and `linux/arm64` (entries `unknown/unknown` are build attestations); the package is public (`docs/runbooks/github-settings.md` section 5).

### 6. Raise `API_TAG` in the Docker repository

In `kitchen-daylight-docker`, by a pull request there (never a direct push), following that repository's `docs/release-process.md`:

1. Set `API_TAG` in `versions.env` to `X.Y.Z` (one tag, no `v`, never `latest`), and put the pin of step 5 in the description.
2. Its bump: a **patch** release of the Docker repository, or a **minor** one if the Docker repository's own contract changes with it (for example a new variable the API now needs in `compose.apps.yaml`).
3. Run `scripts/check-parity.sh <monorepo>/infra` in the same change window and paste its table.

**Check:** its `lint`, `smoke` and `secrets` checks are green; the owner then tags the Docker repository's release as its process says.

### 7. Keep `docker-repo.version` consistent

`docker-repo.version` names the lowest Docker repository release this monorepo needs (M3). A new release alone never forces a change.

- Raise it only in the pull request of this monorepo that starts to use something from a newer Docker repository release (a new variable, a changed script option, the new `API_TAG` for the end-to-end tests), never ahead of that release's tag.
- That pull request runs `docker-repo.yml`: the Docker repository is checked out at the tag named in the file, then `scripts/check-docker-repo.sh` and `check-parity.sh` run.

**Check:** `docker-repo.yml` is green on that pull request, and the tag it checked out is the one named in `docker-repo.version` (not the fallback to `main`).
