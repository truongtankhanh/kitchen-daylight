# GitHub settings of `truongtankhanh/kitchen-daylight`

The settings the owner applies by hand in the GitHub UI (P5-T6). The repository is public (ADR-0010), so every item below is a control against a stranger's pull request, a leaked secret or an unreviewed change on `main`. Tick each box once it is applied, in a pull request that changes only this file.

Sources: ADR-0010 "Public repositories" (controls 1, 4, 5 and 7), scaffold-plan section 8 ("AWS access"), decision 0002 (sections 4, 5 and 7).

## 1. Ruleset for `main`

Settings → Rules → Rulesets → New ruleset → New branch ruleset. Name `main`, enforcement **Active**, target **Include default branch**, bypass list **empty**.

A ruleset, not a classic branch protection rule: decision 0002 section 7 places the CodeQL merge protection in the `main` ruleset, and code scanning merge protection exists only in rulesets.

- [ ] **Restrict deletions.** `main` is the only source of published images (`publish-api-image.yml`) and, later, of deploys.
- [ ] **Block force pushes.** A rewritten `main` would change what a published `sha-<short>` tag points to in history and would bypass review (ADR-0010 control 4: branch protection on `main`).
- [ ] **Require a pull request before merging**, required approvals **0**. Every change goes through the pull-request checks. Zero approvals because the owner is the only maintainer and GitHub does not let an author approve their own pull request; raise it to 1 and turn on **Require review from Code Owners** (`.github/CODEOWNERS`) when a second maintainer joins.
- [ ] **Require status checks to pass**, with **Require branches to be up to date before merging** on. Source: GitHub Actions. Required checks:
  - `verify` (`ci.yml`): lint, format, typecheck, test, build, OpenAPI check, commit messages (decision 0002, P5-T1).
  - `gitleaks (full history, blocking)` (`security.yml`): decision 0002 section 7, ADR-0010 control 1.
  - `dependency review (blocking)` (`security.yml`): decision 0002 section 7.

  Up to date: a pull request is checked against the `main` it will land on, so two green pull requests cannot combine into a red `main`.

  Not required, because they run only on some paths and a required check that never starts blocks the pull request: `build` (`api-image.yml`) and `integration` (`docker-repo.yml`). `pnpm audit (advisory)` is advisory by decision 0002 section 7.
- [ ] **Require code scanning results**: tool **CodeQL**, security alerts **High or higher**, alerts **Errors**. Decision 0002 section 7: new CodeQL alerts at High or higher block the merge; lower severities stay advisory.
- [ ] **Require linear history: off.** Decision 0002 does not require it. Commits on `main` are checked by commitlint in the pull request, whatever the merge method.

## 2. Ruleset for release tags

Settings → Rules → Rulesets → New ruleset → New tag ruleset. Name `release-tags`, enforcement **Active**, target pattern `v*`, bypass list **empty**.

- [ ] **Restrict updates** and **Restrict deletions.** A release tag publishes the image `MAJOR.MINOR.PATCH` (`publish-api-image.yml`) and is a protected ref of the AWS trust policy (section 8); moving or deleting it would change what a released version means. The publish workflow also refuses a tag whose commit is not on `main`.

## 3. Actions

Settings → Actions → General.

- [ ] **Workflow permissions: Read repository contents and packages permissions**, and **Allow GitHub Actions to create and approve pull requests: off.** Every workflow declares `permissions: contents: read` and widens it per job only where needed (`packages: write` for the publish job); a read-only default means a workflow that forgets the block gets no write access.
- [ ] **Require actions to be pinned to a full-length commit SHA: on.** Decision 0001 pins every action by commit SHA; this makes GitHub refuse a workflow that does not.
- [ ] **Approval for running fork pull request workflows: Require approval for all external contributors.** A fork pull request runs untrusted code on GitHub's runners; the owner reads it before it runs (ADR-0010 control 4).
- [ ] **Runners: none.** Settings → Actions → Runners lists no self-hosted runner (see section 6).

## 4. Code security

Settings → Advanced Security (or Code security).

- [ ] **Private vulnerability reporting: on.** A stranger who finds a flaw reports it privately instead of in a public issue.
- [ ] **Dependency graph: on.** Needed by Dependabot and by `dependency review` (decision 0002 section 7).
- [ ] **Dependabot alerts: on.** Advisories for the lockfile, the actions and the API base image (`.github/dependabot.yml`).
- [ ] **Dependabot security updates: on.** They fix the advisories that the non-blocking `pnpm audit` reports (decision 0002 section 7).
- [ ] **Secret scanning: on** and **Push protection: on.** ADR-0010 control 1: a pushed commit is public at once; push protection rejects a known provider secret before it lands. gitleaks in the pre-commit hook and in CI covers the other patterns (decision 0002 section 5).
- [ ] **CodeQL analysis: Default setup**, languages JavaScript/TypeScript and Actions (decision 0002 section 7). No CodeQL workflow is committed; an advanced-setup workflow would conflict with it.

## 5. Package of the API image

Profile → Packages → `kitchen-daylight-api` → Package settings, after the first run of `publish-api-image.yml` on `main`.

- [ ] **Visibility: Public.** The Docker repository and its CI pull the image without credentials (Docker repository `monorepo-integration.md` M6). ADR-0010 control 5: the image holds no secret and no real data; the publish job fails if it finds a `.env` file.
- [ ] **Linked to `truongtankhanh/kitchen-daylight`**, and under Manage Actions access the repository has the **Write** role. The `GITHUB_TOKEN` of the publish job can then push new tags; no personal token is used.

## 6. Rules that no setting enforces

- [ ] **No self-hosted runner**, on this repository or the account. A fork pull request could run code on it, and the only candidate machine is the owner's (ADR-0010 control 4). Every job uses `runs-on: ubuntu-24.04`.
- [ ] **No `pull_request_target` on untrusted code.** It runs with the base repository's token and secrets while checking out the fork's code. Pull-request workflows use `pull_request` only, and fork pull requests get no secrets and no deploy. Check with `grep -rnE '^[[:space:]]*pull_request_target:' .github/workflows` (no output expected; comments that mention the name do not match).

## 7. Commit and license notes

- Conventional Commits, checked by commitlint in the `commit-msg` hook and in CI (decision 0002 section 4). When a pull request is squash-merged, its title becomes the commit on `main`: write the title as a Conventional Commit.
- ADR-0010 control 7: without a license the repository is source-visible with all rights reserved; the API image says so with the label `org.opencontainers.image.licenses=LicenseRef-AllRightsReserved`. A `LICENSE` file or a README statement is the owner's choice and is not part of this runbook.

## 8. Later: AWS role trust policy (when `infra/` exists)

Nothing is created in AWS now. When `infra/` adds the deploy, the IAM role that GitHub Actions assumes through OIDC (scaffold-plan section 8, ADR-0010 control 4) must have a trust policy with exactly these conditions:

- Principal: the account's OIDC provider `token.actions.githubusercontent.com`; no IAM user and no long-lived access key.
- `token.actions.githubusercontent.com:aud` **StringEquals** `sts.amazonaws.com`.
- `token.actions.githubusercontent.com:sub` limited to **this repository and protected refs only**, one of:
  - `repo:truongtankhanh/kitchen-daylight:ref:refs/heads/main` (StringEquals), for `demo`;
  - `repo:truongtankhanh/kitchen-daylight:ref:refs/tags/v*` (StringLike), release tags protected by the ruleset of section 2;
  - `repo:truongtankhanh/kitchen-daylight:environment:prod` (StringEquals), for `prod`, where the `prod` GitHub Environment has a required reviewer and deployment branches limited to `main` and `v*` tags.
- Never `repo:truongtankhanh/kitchen-daylight:*`, never a `pull_request` subject, never another repository.
- In the workflows, `id-token: write` only on the deploy job, and that job never runs on `pull_request`.
- The account id and the role ARN stay placeholders in the repository (`<AWS_ACCOUNT_ID>`); they are configured where the deploy slice decides, never committed with real values.

## Check after applying

The owner pastes the output of these read-only commands back into the session:

```sh
gh api repos/truongtankhanh/kitchen-daylight/rules/branches/main \
  --jq '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context'
gh api repos/truongtankhanh/kitchen-daylight/actions/permissions/workflow
gh api repos/truongtankhanh/kitchen-daylight --jq '.security_and_analysis'
```
