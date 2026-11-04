#!/usr/bin/env bash
# First-time setup of the local dependency stack from the sibling Docker
# repository (kitchen-daylight-docker): checks the prerequisites, clones the
# sibling when its folder does not exist, initialises its .env for slot 2 and
# starts the dependencies through scripts/dev-infra.sh up.
#
# Safe to run twice: an existing folder is never overwritten or switched to
# another ref, and an existing .env is kept. Asks no question.
set -euo pipefail

# Minimums from the Docker repository's decision 0003 (prerequisites).
MIN_DOCKER_ENGINE="20.10.23"
MIN_DOCKER_COMPOSE="2.24.1"
MIN_BASH="3.2.0"
MIN_CURL="7.75.0"
# git: any version.

SLOT="2"
DEFAULT_REPO_URL="https://github.com/truongtankhanh/kitchen-daylight-docker.git"

usage() {
  cat <<'EOF'
Usage: scripts/bootstrap.sh [--help]

Steps:
  1. Checks the prerequisites: Docker Engine 20.10.23, Docker Compose
     2.24.1, bash 3.2, curl 7.75.0 (or newer) and git.
  2. Clones the Docker repository into KD_DOCKER_DIR when that folder does
     not exist, and checks out the tag named in docker-repo.version (vX.Y.Z
     or X.Y.Z). Without a matching tag it stays on the default branch and
     warns. An existing folder is left as it is.
  3. Runs the sibling's scripts/init-env.sh 2 unless its .env exists.
  4. Runs scripts/dev-infra.sh up (version check, then dependencies only).

Environment:
  KD_DOCKER_DIR       Folder of the Docker repository, relative to the root
                      of this repository or absolute.
                      Default: ../kitchen-daylight-docker
  KD_DOCKER_REPO_URL  Clone URL (for example an SSH URL).
                      Default: https://github.com/truongtankhanh/kitchen-daylight-docker.git

Exit codes:
  0  Success
  1  The operation failed (from dev-infra.sh up: a service unhealthy, or
     the Docker repository version does not match docker-repo.version)
  2  Missing prerequisite, clone failed (private or unreachable
     repository), missing file, or a bad argument
  3  A port or slot is already in use: read the message, do not retry
EOF
}

log() { printf '[kd] %s\n' "$*"; }
err() { printf '[kd] %s\n' "$*" >&2; }

case "${1:-}" in
  "") ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    err "unknown argument: $1 (see --help)"
    exit 2
    ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/.."

KD_DOCKER_DIR="${KD_DOCKER_DIR:-../kitchen-daylight-docker}"
KD_DOCKER_REPO_URL="${KD_DOCKER_REPO_URL:-$DEFAULT_REPO_URL}"
export KD_DOCKER_DIR

# Prints MAJOR.MINOR.PATCH from a version string such as v2.38.2-desktop.1,
# 20.10.23+dfsg1 or 3.2; prints nothing when no number is found.
normalize_version() {
  local v="${1#v}" major minor patch
  v="${v%%[-+ ]*}"
  IFS=. read -r major minor patch _ <<<"$v"
  major="${major:-}" minor="${minor:-0}" patch="${patch:-0}"
  if [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]]; then
    printf '%s.%s.%s' "$((10#$major))" "$((10#$minor))" "$((10#$patch))"
  fi
}

# version_ge HAVE MIN: true when HAVE >= MIN (both MAJOR.MINOR.PATCH).
version_ge() {
  local a1 a2 a3 b1 b2 b3
  IFS=. read -r a1 a2 a3 <<<"$1"
  IFS=. read -r b1 b2 b3 <<<"$2"
  if [ "$a1" -ne "$b1" ]; then
    [ "$a1" -gt "$b1" ]
    return
  fi
  if [ "$a2" -ne "$b2" ]; then
    [ "$a2" -gt "$b2" ]
    return
  fi
  [ "$a3" -ge "$b3" ]
}

# require_version NAME RAW MIN HINT
require_version() {
  local have
  have="$(normalize_version "$2")"
  if [ -z "$have" ]; then
    err "cannot read the $1 version from '$2'; $4"
    exit 2
  fi
  if ! version_ge "$have" "$3"; then
    err "$1 $have is older than the minimum $3; $4"
    exit 2
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "missing prerequisite: $1 not found on PATH; $2"
    exit 2
  fi
}

HINT_DOCKER="install or update Docker Desktop (macOS) or Docker Engine with the Compose v2 plugin: https://docs.docker.com/get-docker/"
HINT_CURL="install a newer curl with your package manager (for example: brew install curl)"
HINT_GIT="install git (macOS: xcode-select --install, or brew install git)"
HINT_BASH="run the script with bash 3.2 or newer"

# 1. Prerequisites.
require_version "bash" "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}.${BASH_VERSINFO[2]}" "$MIN_BASH" "$HINT_BASH"
require_command git "$HINT_GIT"
require_command curl "$HINT_CURL"
require_version "curl" "$(curl --version 2>/dev/null | awk 'NR == 1 { print $2 }')" "$MIN_CURL" "$HINT_CURL"
require_command docker "$HINT_DOCKER"
engine="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
if [ -z "$engine" ]; then
  err "Docker Engine not reachable: start Docker Desktop (or the Docker service) and run again"
  exit 2
fi
require_version "Docker Engine" "$engine" "$MIN_DOCKER_ENGINE" "$HINT_DOCKER"
compose="$(docker compose version --short 2>/dev/null || true)"
if [ -z "$compose" ]; then
  err "missing prerequisite: the Docker Compose v2 plugin (docker compose); $HINT_DOCKER"
  exit 2
fi
require_version "Docker Compose" "$compose" "$MIN_DOCKER_COMPOSE" "$HINT_DOCKER"
log "prerequisites ok: Docker Engine $engine, Compose $compose, bash $BASH_VERSION, git, curl"

# 2. Clone the sibling when its folder does not exist.
if [ -e "$KD_DOCKER_DIR" ]; then
  log "folder exists, not cloned: $KD_DOCKER_DIR (left on its current ref)"
else
  if [ ! -f docker-repo.version ]; then
    err "missing docker-repo.version at the repository root ($(pwd))"
    exit 2
  fi
  required=""
  IFS= read -r required <docker-repo.version || true
  required="${required%$'\r'}"

  log "cloning $KD_DOCKER_REPO_URL into $KD_DOCKER_DIR"
  # No credential or host-key prompt: fail instead of asking.
  if ! GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}" \
    git clone --quiet "$KD_DOCKER_REPO_URL" "$KD_DOCKER_DIR"; then
    err "clone failed: $KD_DOCKER_REPO_URL is private or unreachable (no network, no access)."
    err "fix: log in to GitHub (credential helper or token), or set KD_DOCKER_REPO_URL to an SSH URL you can read, then run again"
    exit 2
  fi

  tag=""
  for candidate in "v$required" "$required"; do
    if git -C "$KD_DOCKER_DIR" rev-parse --quiet --verify "refs/tags/$candidate" >/dev/null; then
      tag="$candidate"
      break
    fi
  done
  if [ -n "$tag" ]; then
    git -C "$KD_DOCKER_DIR" -c advice.detachedHead=false checkout --quiet "$tag"
    log "checked out tag $tag"
  else
    err "warning: no tag v$required or $required in the Docker repository; staying on the default branch (the version check still applies)"
  fi
fi

# 3. First start: .env for slot 2.
init_env="$KD_DOCKER_DIR/scripts/init-env.sh"
if [ -f "$KD_DOCKER_DIR/.env" ]; then
  log "already initialised: $KD_DOCKER_DIR/.env exists"
else
  if [ ! -f "$init_env" ]; then
    err "Docker repository not usable: '$init_env' not found; run scripts/bootstrap.sh again after fixing KD_DOCKER_DIR"
    exit 2
  fi
  rc=0
  bash "$init_env" "$SLOT" || rc=$?
  if [ "$rc" -eq 3 ]; then
    # Exit 3 means an existing .env or a busy port/slot; only the first is safe.
    if [ -f "$KD_DOCKER_DIR/.env" ]; then
      log "already initialised: $KD_DOCKER_DIR/.env exists"
    else
      err "init-env.sh refused slot $SLOT (port or slot in use): read the message above, do not retry"
      exit 3
    fi
  elif [ "$rc" -ne 0 ]; then
    exit "$rc"
  fi
fi

# 4. Start the dependencies (runs the version check first).
exec scripts/dev-infra.sh up
