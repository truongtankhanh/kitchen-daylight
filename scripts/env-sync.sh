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
#      across syncs. It holds PORT, LOG_LEVEL and the dev-only auth secrets of
#      decision 0008, section 12: JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_KEY_ID,
#      OTP_HMAC_SECRET and MFA_ENCRYPTION_KEY. The adapter variables are added
#      with the slices that read them.
#
# Change of behaviour (A1-T2, 2026-11-06): until then the existing block was
# kept exactly as it was. Now env:sync (with --force when .env exists) also
# ADDS the auth names the block lacks, generated with node:crypto. It never
# changes a value that is already set; a line whose value is empty or the
# CHANGE_ME_LOCAL placeholder counts as missing and is replaced. The three
# JWT names are one key set: if only some of them are set, env:sync refuses
# (exit 1) instead of pairing a new key with an old one.
#
# Value formats are those of the Docker repository's gen-dev-secrets.sh, so
# both stacks accept each other's tokens: the base64 (one line) of a PKCS#8
# and an SPKI PEM on curve P-256, a kid of "kd-dev-" plus the first 16 hex
# digits of the SHA-256 of the SPKI DER, and 32 random bytes in base64 for
# each secret. The values travel only through a pipe from node to this script
# and into the file: never printed, never an argument of an external command.
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
scripts/print-env.sh plus the monorepo block (PORT, LOG_LEVEL and the dev
auth secrets JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_KEY_ID, OTP_HMAC_SECRET,
MFA_ENCRYPTION_KEY, generated with node:crypto; values never shown).

Options:
  --force  Replace an existing .env. The print-env.sh block is replaced. The
           monorepo block is kept: no value that is set changes, and the auth
           names it lacks (or holds empty or CHANGE_ME_LOCAL) are generated
           and added.
  --print  Check the contract and print the names that would be written,
           without values, marking the ones that would be generated. Writes
           nothing and generates nothing.

Environment:
  KD_DOCKER_DIR  Folder of the Docker repository, relative to the root of
                 this repository or absolute.
                 Default: ../kitchen-daylight-docker

Exit codes:
  0  Written (or printed with --print)
  1  Contract check failed: a name of the Docker contract is missing or
     empty, print-env.sh failed or printed an unexpected line, the monorepo
     block of the existing .env is malformed or holds only part of the JWT
     key set, or generating the auth secrets failed
  2  Docker repository, its scripts/print-env.sh or its .env missing (run
     scripts/bootstrap.sh), node not found, or a bad argument
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

# Auth names generated into the monorepo block (decision 0008, section 12).
# The JWT names are one key set. The optional previous-key variables are
# never generated.
JWT_NAMES="JWT_PRIVATE_KEY JWT_PUBLIC_KEY JWT_KEY_ID"
GENERATED_NAMES="$JWT_NAMES OTP_HMAC_SECRET MFA_ENCRYPTION_KEY"
GENERATED_COMMENT="# Dev-only auth secrets (decision 0008), generated by env:sync with node:crypto."
PLACEHOLDER="CHANGE_ME_LOCAL"

# Prints NAME=value lines for the requested groups (jwt, otp, mfa) on stdout.
# The program comes from stdin and the groups are its only arguments, so no
# value appears in an argument list.
GENERATOR='
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
const want = new Set(process.argv.filter((arg) => ["jwt", "otp", "mfa"].includes(arg)));
const base64 = (text) => Buffer.from(text).toString("base64");
const lines = [];
if (want.has("jwt")) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const der = publicKey.export({ type: "spki", format: "der" });
  const kid = "kd-dev-" + createHash("sha256").update(der).digest("hex").slice(0, 16);
  lines.push("JWT_PRIVATE_KEY=" + base64(privateKey.export({ type: "pkcs8", format: "pem" })));
  lines.push("JWT_PUBLIC_KEY=" + base64(publicKey.export({ type: "spki", format: "pem" })));
  lines.push("JWT_KEY_ID=" + kid);
}
if (want.has("otp")) lines.push("OTP_HMAC_SECRET=" + randomBytes(32).toString("base64"));
if (want.has("mfa")) lines.push("MFA_ENCRYPTION_KEY=" + randomBytes(32).toString("base64"));
process.stdout.write(lines.join("\n") + "\n");
'

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

# A generated name is set when the block has its line with a value that is
# neither empty nor the placeholder. Only names are compared and reported.
is_set() {
  local line
  while IFS= read -r line; do
    case "$line" in
      "$1=" | "$1=$PLACEHOLDER") ;;
      "$1="*) return 0 ;;
    esac
  done <<<"$block"
  return 1
}

missing_names=""
jwt_set=0
for name in $GENERATED_NAMES; do
  if is_set "$name"; then
    case " $JWT_NAMES " in *" $name "*) jwt_set=$((jwt_set + 1)) ;; esac
  else
    missing_names="$missing_names $name"
  fi
done
missing_names="${missing_names# }"
if [ "$jwt_set" -ne 0 ] && [ "$jwt_set" -ne 3 ]; then
  err "the monorepo block of .env holds only part of the JWT key set ($JWT_NAMES); remove those lines, then run again to generate a new pair"
  exit 1
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
  printf '%s\n' "$block" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | sed 's/=.*//' | while IFS= read -r name; do
    case " $missing_names " in
      *" $name "*) ;;
      *) printf '  %s\n' "$name" ;;
    esac
  done
  for name in $missing_names; do
    printf '  %s (would be generated)\n' "$name"
  done
  exit 0
fi

# Generate only the missing groups; the values stay in this shell's memory.
generated=""
if [ -n "$missing_names" ]; then
  if ! command -v node >/dev/null 2>&1; then
    err "node not found on PATH; it generates the auth secrets ($missing_names)"
    exit 2
  fi
  groups=""
  case " $missing_names " in *" JWT_PRIVATE_KEY "*) groups="$groups jwt" ;; esac
  case " $missing_names " in *" OTP_HMAC_SECRET "*) groups="$groups otp" ;; esac
  case " $missing_names " in *" MFA_ENCRYPTION_KEY "*) groups="$groups mfa" ;; esac
  # shellcheck disable=SC2086 # the group words are split on purpose
  generated="$(node --input-type=module - $groups <<<"$GENERATOR")" || {
    err "generating the auth secrets with node:crypto failed"
    exit 1
  }
  for name in $missing_names; do
    if ! printf '%s\n' "$generated" | grep -q "^${name}=."; then
      err "generating the auth secrets returned no value for $name"
      exit 1
    fi
  done
fi

# The block with the missing names: their empty or placeholder lines are
# dropped and the generated lines go just before the end marker.
new_block=""
while IFS= read -r line || [ -n "$line" ]; do
  name="${line%%=*}"
  if [ "$name" != "$line" ] && [[ " $missing_names " == *" $name "* ]]; then
    continue
  fi
  if [ "$line" = "$BLOCK_END" ] && [ -n "$generated" ]; then
    new_block="$new_block$GENERATED_COMMENT"$'\n'"$generated"$'\n'
  fi
  new_block="$new_block$line"$'\n'
done <<<"$block"
block="${new_block%$'\n'}"

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
if [ -n "$missing_names" ]; then
  log "generated in the monorepo block (values not shown): $missing_names"
fi
