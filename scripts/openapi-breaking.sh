#!/bin/sh
# Breaking-change check of the OpenAPI snapshot against the last released one (decision 0004
# section 3b). Not a Turborepo task: the result depends on the oasdiff binary version.
#
# POSIX sh, as decision 0004 section 3b requires, so `set -o pipefail` is not available; the
# script has no pipeline, so `set -eu` loses nothing.
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/openapi-breaking.sh
       scripts/openapi-breaking.sh --help

Compares packages/contracts/openapi.json with packages/contracts/openapi.released.json using
`oasdiff breaking --fail-on ERR` (WARN results are printed but do not fail). Exceptions come
from packages/contracts/openapi-breaking-ignore.txt when it exists.

Inactive (exit 0) until openapi.released.json exists. Without oasdiff on PATH it exits 0
locally and 1 when CI is set: CI is the gate.

Exit codes: 0 no breaking change, or the check is inactive; 1 a breaking change, or oasdiff
missing in CI; 2 usage error.
EOF
}

case "${1:-}" in
  '') ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "openapi:breaking: unknown argument: $1" >&2
    usage >&2
    exit 2
    ;;
esac

RELEASED=packages/contracts/openapi.released.json
CURRENT=packages/contracts/openapi.json
IGNORE=packages/contracts/openapi-breaking-ignore.txt

cd "$(dirname "$0")/.."

if [ ! -f "$RELEASED" ]; then
  echo "breaking-change check inactive: no released snapshot yet ($RELEASED)"
  exit 0
fi

if ! command -v oasdiff >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "openapi:breaking: oasdiff is not on PATH" >&2
    exit 1
  fi
  echo "openapi:breaking: oasdiff is not on PATH; the breaking-change check did not run (CI is the gate)"
  exit 0
fi

if [ -f "$IGNORE" ]; then
  exec oasdiff breaking "$RELEASED" "$CURRENT" --fail-on ERR --err-ignore "$IGNORE"
fi
exec oasdiff breaking "$RELEASED" "$CURRENT" --fail-on ERR
