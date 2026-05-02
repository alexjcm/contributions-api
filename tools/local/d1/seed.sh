#!/usr/bin/env bash

set -euo pipefail

DB_BINDING="${DB_BINDING:-DCM_DB_BINDING}"
SEED_SQL_FILE="${SEED_SQL_FILE:-./tools/local/d1/sql/sample-data/seed.sql}"
PERSIST_TO="${PERSIST_TO:-}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.dev.jsonc}"

usage() {
  cat <<'EOF'
Usage:
  ./tools/local/d1/seed.sh [--skip-migrate] [--persist-to <dir>] [--binding <name>] [--sql <file>]

Examples:
  ./tools/local/d1/seed.sh
  ./tools/local/d1/seed.sh --skip-migrate
EOF
}

WRANGLER_LOCAL_FLAGS=(--local)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-migrate)
      SKIP_MIGRATE="1"
      shift
      ;;
    --persist-to)
      PERSIST_TO="${2:-}"
      shift 2
      ;;
    --binding)
      DB_BINDING="${2:-}"
      shift 2
      ;;
    --sql)
      SEED_SQL_FILE="${2:-}"
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

if [[ ! -f "$SEED_SQL_FILE" ]]; then
  echo "Seed SQL file not found: $SEED_SQL_FILE" >&2
  exit 1
fi

if [[ "$SKIP_MIGRATE" == "0" ]]; then
  echo "Applying local migrations..."
  npx wrangler --config "$WRANGLER_CONFIG" d1 migrations apply "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}"
fi

echo "Seeding local D1..."
npx wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}" --file "$SEED_SQL_FILE"

echo "Local D1 seed complete."
