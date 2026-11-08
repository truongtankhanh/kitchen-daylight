# syntax=docker/dockerfile:1
#
# Image of @kd/api, pulled by the Docker repository (decision 0005, section 9).
# Build from the repository root:  docker build -f apps/api/Dockerfile -t kd-api:local .
# Platforms: linux/amd64 and linux/arm64. No step depends on the architecture.
# Public image (ADR-0010): no .env, no key, no real data; build arguments carry no secret.
#
# Base: the official Node 26.13.0 image (decision 0001) on Debian slim, which has no curl
# and no wget. Digest resolved by the first green build (2026-11-04, multi-platform index):
#   node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39

# --- build: install with the lockfile, compile the API, the seed tool and their workspace
# dependencies ---
FROM node:26.13.0-trixie-slim AS build

# CI=true: non-interactive pnpm. HUSKY=0: no git hooks in the image (decision 0002).
ENV CI=true \
    HUSKY=0

# Node 26 ships no Corepack; pnpm is pinned to the root packageManager (decision 0001).
RUN npm install --global pnpm@12.16.1

WORKDIR /repo

# The store depends on the lockfile only, so this layer survives source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
# deploy is not --offline: it checks the lockfile it writes against the supply-chain
# policies, which needs registry metadata that `pnpm fetch` does not store.
# @kd/seed ships in the same image (decision 0005, contradiction 6 and section 9).
RUN pnpm install --offline --frozen-lockfile --filter "@kd/api..." --filter "@kd/seed..." \
    && pnpm --filter "@kd/api..." --filter "@kd/seed..." run build \
    && pnpm --filter @kd/api deploy --prod /prod/api \
    && pnpm --filter @kd/seed deploy --prod /prod/seed

# --- runtime: production dependencies and compiled output only ---
FROM node:26.13.0-trixie-slim AS runtime

ENV NODE_ENV=production

# /app holds dist/, migrations/, package.json and node_modules, so `node dist/cli.js migrate`
# works from here. Files stay owned by root: the runtime user cannot modify them.
WORKDIR /app
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
# /app/seed holds the seed tool with the @kd/seed-data fixtures in its node_modules, so
# `node seed/dist/cli.js <mode> [--commit]` works from /app (the API_SEED_CMD default).
COPY --from=build /prod/seed/package.json ./seed/package.json
COPY --from=build /prod/seed/node_modules ./seed/node_modules
COPY --from=build /repo/tools/seed/dist ./seed/dist
# The seed's own data files (A4-T5): default settings and placeholder consent documents, read from
# dist/steps/ as ../../data/. Fictional or placeholder content only.
COPY --from=build /repo/tools/seed/data ./seed/data

# The non-root `node` user of the official image (uid and gid 1000), written numerically so a
# runtime can verify it is not root before starting the container (hadolint DL3066).
USER 1000:1000

EXPOSE 3000

# No HEALTHCHECK: Compose defines it (`node -e "fetch(...)"` on /api/health).
CMD ["node", "dist/main.js"]
