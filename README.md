# kitchen-daylight

Monorepo of the Kitchen Daylight restaurant app: API, admin web app, mobile app
and shared packages, managed with pnpm workspaces and Turborepo.

The repository is public for reference only. All rights reserved: see
[LICENSE](LICENSE).

## Status

Foundation in progress: no feature code yet. The phase plan is
[docs/implementation/foundation/implementation-phases.md](docs/implementation/foundation/implementation-phases.md)
(kept locally by the maintainer, not published).

## Related repository

Local development services (database, mail catcher, object storage) live in the
sibling repository
[kitchen-daylight-docker](https://github.com/truongtankhanh/kitchen-daylight-docker),
cloned next to this one.

> [!WARNING]
> Every credential in these repositories is a local placeholder. No real secret,
> key or password is ever committed. Never reuse a placeholder outside local
> development.

## Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
(for example `feat(api): ...`, `fix(admin): ...`, `chore: ...`).
