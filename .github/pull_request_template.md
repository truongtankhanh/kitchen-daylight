## What changed

<!-- The files or areas changed, in a few lines. -->

## Why

<!-- The task id (for example P5-T6) or the problem this solves. -->

## How it was checked

<!-- Commands run and their result (lint, typecheck, build of the touched package, shellcheck,
actionlint). Tests are run by the owner; paste or link their output. -->

## Checklist

- [ ] The title and every commit follow Conventional Commits (decision 0002 section 4).
- [ ] No feature code in a foundation task (no entity, migration, controller, screen, route, adapter or auth).
- [ ] No secret, key, token, real data or personal data, and no `.env` file; placeholders only (ADR-0010 controls 1 to 3).
- [ ] New versions come from decision 0001 and are exact pins; no `latest`; actions pinned by full commit SHA.
- [ ] The owner ran the tests and the output is attached or linked.
- [ ] If the API changed: the OpenAPI contract snapshot is updated and `pnpm openapi:check` passes.
- [ ] If a new item of the Docker repository's contract is used: `docker-repo.version` is bumped in this pull request.
