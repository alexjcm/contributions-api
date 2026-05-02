#!/usr/bin/env bash

set -euo pipefail

DB_BINDING="${DB_BINDING:-DCM_DB_BINDING}"
RESET_SQL_FILE="${RESET_SQL_FILE:-./tools/local/d1/sql/sample-data/reset.sql}"
PERSIST_TO="${PERSIST_TO:-}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.dev.jsonc}"

usage() {
  cat <<'EOF'
Usage:
  ./tools/local/d1/reset.sh [--persist-to <dir>] [--binding <name>] [--sql <file>]

Examples:
  ./tools/local/d1/reset.sh
  ./tools/local/d1/reset.sh --persist-to ./.wrangler/state/v3
EOF
}

WRANGLER_LOCAL_FLAGS=(--local)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --persist-to)
      PERSIST_TO="${2:-}"
      shift 2
      ;;
    --binding)
      DB_BINDING="${2:-}"
      shift 2
      ;;
    --sql)
      RESET_SQL_FILE="${2:-}"
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

if [[ -n "$PERSIST_TO" ]]; then
  WRANGLER_LOCAL_FLAGS+=(--persist-to "$PERSIST_TO")
fi

if [[ ! -f "$RESET_SQL_FILE" ]]; then
  echo "Reset SQL file not found: $RESET_SQL_FILE" >&2
  exit 1
fi

echo "Applying local migrations..."
npx wrangler --config "$WRANGLER_CONFIG" d1 migrations apply "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}"

echo "Resetting local data..."
npx wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}" --file "$RESET_SQL_FILE"

echo "Local D1 reset complete."
