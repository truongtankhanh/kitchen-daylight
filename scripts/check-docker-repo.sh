#!/usr/bin/env bash
# Checks that the sibling Docker repository (kitchen-daylight-docker) is
# compatible with the version this monorepo needs (docker-repo.version).
#
# Bump rule: raise docker-repo.version in the same pull request that starts
# to use a new item of the Docker repository's contract (a new variable, a
# changed script option).
#
# Pure bash 3.2, no network, no dependency beyond coreutils.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/check-docker-repo.sh [--help]

Compares the sibling Docker repository's VERSION with docker-repo.version
at the root of this repository. Compatible when the sibling's version is at
least the required one and has the same major. A leading "v" in the
sibling's VERSION is ignored; docker-repo.version must be MAJOR.MINOR.PATCH.

Environment:
  KD_DOCKER_DIR  Folder of the Docker repository, relative to the root of
                 this repository or absolute.
                 Default: ../kitchen-daylight-docker

Exit codes:
  0  Compatible
  1  Version mismatch (older, or another major)
  2  Folder, VERSION or docker-repo.version missing or malformed, or a bad
     argument
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
REQUIRED_FILE="docker-repo.version"
SIBLING_FILE="$KD_DOCKER_DIR/VERSION"

# Prints the first line of a file without surrounding whitespace or CR.
read_first_line() {
  local line=""
  IFS= read -r line <"$1" || true
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  printf '%s' "$line"
}

is_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

if [ ! -f "$REQUIRED_FILE" ]; then
  err "missing $REQUIRED_FILE at the repository root ($(pwd))"
  exit 2
fi
required="$(read_first_line "$REQUIRED_FILE")"
if ! is_semver "$required"; then
  err "malformed $REQUIRED_FILE: '$required' (expected MAJOR.MINOR.PATCH, no leading v)"
  exit 2
fi

if [ ! -d "$KD_DOCKER_DIR" ]; then
  err "Docker repository not found at '$KD_DOCKER_DIR' (resolved from $(pwd)); run bootstrap or set KD_DOCKER_DIR"
  exit 2
fi
if [ ! -f "$SIBLING_FILE" ]; then
  err "missing VERSION in '$KD_DOCKER_DIR'; run bootstrap or set KD_DOCKER_DIR"
  exit 2
fi
sibling_raw="$(read_first_line "$SIBLING_FILE")"
sibling="${sibling_raw#v}"
if ! is_semver "$sibling"; then
  err "malformed VERSION in '$KD_DOCKER_DIR': '$sibling_raw' (expected [v]MAJOR.MINOR.PATCH)"
  exit 2
fi

IFS=. read -r req_major req_minor req_patch <<<"$required"
IFS=. read -r sib_major sib_minor sib_patch <<<"$sibling"
# Force base 10 so a leading zero is not read as octal.
req_major=$((10#$req_major)) req_minor=$((10#$req_minor)) req_patch=$((10#$req_patch))
sib_major=$((10#$sib_major)) sib_minor=$((10#$sib_minor)) sib_patch=$((10#$sib_patch))

update_hint() {
  err "update: git -C \"$KD_DOCKER_DIR\" fetch --tags"
  err "        git -C \"$KD_DOCKER_DIR\" checkout <tag v${req_major}.x.y at least v${required}>"
}

if [ "$sib_major" -ne "$req_major" ]; then
  err "incompatible Docker repository: VERSION $sibling, required $required (major $sib_major differs from $req_major)"
  update_hint
  exit 1
fi

too_old=0
if [ "$sib_minor" -lt "$req_minor" ]; then
  too_old=1
elif [ "$sib_minor" -eq "$req_minor" ] && [ "$sib_patch" -lt "$req_patch" ]; then
  too_old=1
fi

if [ "$too_old" -eq 1 ]; then
  err "Docker repository too old: VERSION $sibling, required at least $required"
  update_hint
  exit 1
fi

log "Docker repository compatible: VERSION $sibling, required $required ($KD_DOCKER_DIR)"
