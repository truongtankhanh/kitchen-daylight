#!/bin/sh
# Breaking-change check of the OpenAPI snapshot against the last released one (decision 0004
# section 3b). POSIX sh. Not a Turborepo task: the result depends on the oasdiff binary version.
set -eu

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
