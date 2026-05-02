#!/usr/bin/env bash

set -euo pipefail

DB_BINDING="${DB_BINDING:-DCM_DB_BINDING}"
INPUT_FILE="${INPUT_FILE:-}"
PERSIST_TO="${PERSIST_TO:-}"
RESET_SQL_FILE="${RESET_SQL_FILE:-./tools/local/d1/sql/sample-data/reset.sql}"
SKIP_RESET="${SKIP_RESET:-0}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.dev.jsonc}"

usage() {
  cat <<'EOF'
Usage:
  ./tools/local/d1/restore.sh --file <snapshot.sql> [--persist-to <dir>] [--skip-reset] [--binding <name>]

Notes:
  - Expected input is data-only SQL exported with: ./tools/local/d1/snapshot.sh (default mode).
  - By default this script applies migrations and resets local data before restoring.
EOF
}

WRANGLER_LOCAL_FLAGS=(--local)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      INPUT_FILE="${2:-}"
      shift 2
      ;;
    --persist-to)
      PERSIST_TO="${2:-}"
      shift 2
      ;;
    --skip-reset)
      SKIP_RESET="1"
      shift
      ;;
    --binding)
      DB_BINDING="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$INPUT_FILE" ]]; then
  echo "--file is required." >&2
  usage
  exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Restore SQL file not found: $INPUT_FILE" >&2
  exit 1
fi

if [[ ! -f "$RESET_SQL_FILE" ]]; then
  echo "Reset SQL file not found: $RESET_SQL_FILE" >&2
  exit 1
fi

if [[ -n "$PERSIST_TO" ]]; then
  WRANGLER_LOCAL_FLAGS+=(--persist-to "$PERSIST_TO")
fi

echo "Applying local migrations..."
npx wrangler --config "$WRANGLER_CONFIG" d1 migrations apply "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}"

if [[ "$SKIP_RESET" == "0" ]]; then
  echo "Resetting local data..."
  npx wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}" --file "$RESET_SQL_FILE"
fi

echo "Restoring local snapshot from: $INPUT_FILE"
npx wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}" --file "$INPUT_FILE"

echo "Local D1 restore complete."
