#!/usr/bin/env bash
# Thin wrapper around the sibling Docker repository (kitchen-daylight-docker)
# for the local dependency stack: PostgreSQL, Mailpit and the S3 emulator.
#
# Dependencies only: never passes --apps, starts no watcher and no API, admin
# or mobile process. There is no reset wrapper on purpose: a reset needs the
# typed confirmation of the sibling's scripts/reset.sh, run it there by hand.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/dev-infra.sh up|down|status
       scripts/dev-infra.sh --help

Commands:
  up      Checks docker-repo.version (scripts/check-docker-repo.sh), then runs
          the sibling's scripts/up.sh with no flag (dependencies only).
  down    Runs the sibling's scripts/down.sh: stops the stack, keeps the data.
  status  Runs the sibling's scripts/status.sh: one line per service.

Environment:
  KD_DOCKER_DIR  Folder of the Docker repository, relative to the root of
                 this repository or absolute.
                 Default: ../kitchen-daylight-docker

Exit codes (passed through from the called script):
  0  Success
  1  The operation failed (a service unhealthy, a check failed) or the
     Docker repository version does not match docker-repo.version
  2  Missing prerequisite: the Docker repository folder or script, no .env
     in it (run its scripts/init-env.sh <slot>), Docker not running, or a
     bad argument
  3  Refused for safety: a port or slot is already in use by another stack.
     Read the message and fix the cause; do not retry blindly.
EOF
}

err() { printf '[kd] %s\n' "$*" >&2; }

case "${1:-}" in
  up) script="up.sh" ;;
  down) script="down.sh" ;;
  status) script="status.sh" ;;
  -h | --help)
    usage
    exit 0
    ;;
  "")
    err "missing command: up, down or status (see --help)"
    exit 2
    ;;
  *)
    err "unknown command: $1 (see --help)"
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  err "unexpected argument: $2 (see --help)"
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

KD_DOCKER_DIR="${KD_DOCKER_DIR:-../kitchen-daylight-docker}"
export KD_DOCKER_DIR

for required in "$KD_DOCKER_DIR/scripts/up.sh" "$KD_DOCKER_DIR/scripts/$script"; do
  if [ ! -f "$required" ]; then
    err "Docker repository not usable: '$required' not found (looked in '$KD_DOCKER_DIR' from $(pwd)); run scripts/bootstrap.sh or set KD_DOCKER_DIR"
    exit 2
  fi
done

if [ "$script" = "up.sh" ]; then
  scripts/check-docker-repo.sh
fi

exec bash "$KD_DOCKER_DIR/scripts/$script"
