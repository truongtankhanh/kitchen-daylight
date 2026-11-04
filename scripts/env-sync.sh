#!/usr/bin/env bash
# Writes the repository-root .env for processes run on the host (apps/api,
# tools/seed) from the sibling Docker repository's scripts/print-env.sh,
# following docs/decisions/0005-api-foundation-conventions.md, sections 2-3.
#
# The .env has two blocks:
#   1. The print-env.sh output (the 12 names of the Docker contract, section
#      4.3), replaced on every sync. The names are kept as they are: ADR 0005
#      maps them inside apps/api's loadConfig (for example DATABASE_URL_APP ->
#      database.url of the server), never by renaming them here, and
#      DATABASE_URL is never set on the host.
#   2. The monorepo block between the markers below, created once and kept
#      across syncs (--force keeps it as it is). Today it holds only what the
#      code needs: PORT and LOG_LEVEL. The adapter, JWT and OTP variables are
#      added with the slices that read them.
#
# Keeping .env.example and the config schema in sync: the canonical list of
# names is the table of ADR 0005 section 2. .env.example lists every name of
# that table (names not read by any code yet are commented out). The
# validation schema of apps/api (P4-T2) validates a subset of the active
# names of .env.example. No automated check compares the two lists yet (a
# follow-up of the Phase 4 review); until then review enforces it: a new name
# lands in ADR 0005, .env.example and the schema in the same pull request.
#
# Never prints a value, never writes outside the repository root.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/env-sync.sh [--force] [--print]
       scripts/env-sync.sh --help

Writes the root .env (mode 600) from the Docker repository's
scripts/print-env.sh plus the monorepo block (PORT, LOG_LEVEL).

Options:
  --force  Replace an existing .env. The monorepo block of the existing file
           is kept as it is; the print-env.sh block is replaced.
  --print  Check the contract and print the names that would be written,
           without values. Writes nothing.

Environment:
  KD_DOCKER_DIR  Folder of the Docker repository, relative to the root of
                 this repository or absolute.
                 Default: ../kitchen-daylight-docker

Exit codes:
  0  Written (or printed with --print)
  1  Contract check failed: a name of the Docker contract is missing or
     empty, print-env.sh failed or printed an unexpected line, or the
     monorepo block of the existing .env is malformed
  2  Docker repository, its scripts/print-env.sh or its .env missing (run
     scripts/bootstrap.sh), or a bad argument
  3  .env exists: run again with --force to replace it
EOF
}

log() { printf '[kd] %s\n' "$*"; }
err() { printf '[kd] %s\n' "$*" >&2; }

# The 12 names of the Docker repository's contract (4-scripts-contract.md 4.3).
CONTRACT_NAMES="DATABASE_URL_MIGRATOR DATABASE_URL_APP MAIL_SMTP_HOST MAIL_SMTP_PORT MAIL_UI_URL STORAGE_S3_ENDPOINT STORAGE_S3_FORCE_PATH_STYLE STORAGE_S3_ACCESS_KEY STORAGE_S3_SECRET_KEY STORAGE_S3_BUCKET_MEDIA STORAGE_S3_BUCKET_PRIVATE APP_ENV"

BLOCK_START="# >>> kd monorepo (kept by env:sync)"
BLOCK_END="# <<< kd monorepo"
DEFAULT_BLOCK="$BLOCK_START
# API port on the host (ADR 0005 section 10; the container uses 3000).
PORT=3001
# pino level.
LOG_LEVEL=info
$BLOCK_END"

force=0
print_only=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --print) print_only=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      err "unknown argument: $arg (see --help)"
      exit 2
      ;;
  esac
done

cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077

KD_DOCKER_DIR="${KD_DOCKER_DIR:-../kitchen-daylight-docker}"
print_env="$KD_DOCKER_DIR/scripts/print-env.sh"

if [ ! -f "$print_env" ]; then
  err "Docker repository not usable: '$print_env' not found (looked in '$KD_DOCKER_DIR' from $(pwd)); run scripts/bootstrap.sh or set KD_DOCKER_DIR"
  exit 2
fi

if [ "$print_only" -eq 0 ] && [ -e .env ] && [ "$force" -eq 0 ]; then
  err ".env exists at $(pwd); run again with --force to replace it (its monorepo block is kept)"
  exit 3
fi

# Monorepo block: kept from the existing .env when present, else the default.
block="$DEFAULT_BLOCK"
block_source="created"
if [ -f .env ]; then
  starts="$(grep -c -x -F "$BLOCK_START" .env || true)"
  ends="$(grep -c -x -F "$BLOCK_END" .env || true)"
  if [ "$starts" -eq 1 ] && [ "$ends" -eq 1 ]; then
    block="$(awk -v s="$BLOCK_START" -v e="$BLOCK_END" '$0 == s { on = 1 } on { print } $0 == e { on = 0 }' .env)"
    block_source="kept"
  elif [ "$starts" -ne 0 ] || [ "$ends" -ne 0 ]; then
    err "malformed monorepo block in .env (expected one '$BLOCK_START' and one '$BLOCK_END' line); fix or remove it, then run again"
    exit 1
  fi
fi

# Contract output. stderr of print-env.sh passes through (it prints no value).
rc=0
contract="$(bash "$print_env")" || rc=$?
if [ "$rc" -eq 2 ]; then
  err "print-env.sh exited 2 (missing prerequisite, for example no .env in '$KD_DOCKER_DIR'); run scripts/bootstrap.sh"
  exit 2
elif [ "$rc" -ne 0 ]; then
  err "print-env.sh failed with exit $rc"
  exit 1
fi

# Every line must be NAME=value; the line itself is never printed.
line_no=0
bad=0
while IFS= read -r line || [ -n "$line" ]; do
  line_no=$((line_no + 1))
  if [ -z "$line" ]; then
    continue
  fi
  if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
    err "print-env.sh line $line_no is not NAME=value"
    bad=1
  fi
done <<<"$contract"

missing=""
for name in $CONTRACT_NAMES; do
  if ! printf '%s\n' "$contract" | grep -q "^${name}=."; then
    missing="$missing $name"
  fi
done
if [ -n "$missing" ]; then
  err "contract check failed: missing or empty in print-env.sh output:$missing"
  bad=1
fi
if [ "$bad" -ne 0 ]; then
  exit 1
fi

contract_lines="$(printf '%s\n' "$contract" | grep -v '^$')"

if [ "$print_only" -eq 1 ]; then
  log "names from print-env.sh (contract ok):"
  printf '%s\n' "$contract_lines" | sed 's/=.*//; s/^/  /'
  log "names of the monorepo block ($([ "$block_source" = kept ] && echo "kept from .env" || echo "default")):"
  printf '%s\n' "$block" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | sed 's/=.*//; s/^/  /'
  exit 0
fi

tmp=""
trap 'if [ -n "$tmp" ]; then rm -f "$tmp"; fi' EXIT
tmp="$(mktemp ./.env.sync.XXXXXX)"
{
  printf '%s\n' "# Generated by scripts/env-sync.sh (pnpm env:sync). Local only, never commit."
  printf '%s\n' "# >>> kd-docker print-env.sh (replaced by env:sync)"
  printf '%s\n' "$contract_lines"
  printf '%s\n' "# <<< kd-docker print-env.sh"
  printf '\n'
  printf '%s\n' "$block"
} >"$tmp"
chmod 600 "$tmp"
mv -f "$tmp" .env
tmp=""

log "wrote $(pwd)/.env (mode 600): print-env.sh block replaced, monorepo block $block_source"
