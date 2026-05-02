#!/usr/bin/env bash

set -euo pipefail

DB_NAME="${DB_NAME:-contributions-db-local}"
OUTPUT_PATH="${OUTPUT_PATH:-./.wrangler/d1-snapshots/local-$(date +%Y%m%d-%H%M%S).sql}"
PERSIST_TO="${PERSIST_TO:-}"
INCLUDE_SCHEMA="${INCLUDE_SCHEMA:-0}"
EXPORT_ALL_TABLES="${EXPORT_ALL_TABLES:-0}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.dev.jsonc}"
TABLES=("contributors" "contributions" "settings")

usage() {
  cat <<'EOF'
Usage:
  ./tools/local/d1/snapshot.sh [--output <file>] [--persist-to <dir>] [--with-schema] [--all-tables] [--table <name>] [--db <name>]

Examples:
  ./tools/local/d1/snapshot.sh
  ./tools/local/d1/snapshot.sh --output ./.wrangler/d1-snapshots/pre-refactor.sql
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    --persist-to)
      PERSIST_TO="${2:-}"
      shift 2
      ;;
    --with-schema)
      INCLUDE_SCHEMA="1"
      shift
      ;;
    --all-tables)
      EXPORT_ALL_TABLES="1"
      shift
      ;;
    --table)
      TABLES+=("${2:-}")
      shift 2
      ;;
    --db)
      DB_NAME="${2:-}"
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

mkdir -p "$(dirname "$OUTPUT_PATH")"

WRANGLER_FLAGS=(--local --output "$OUTPUT_PATH")
if [[ -n "$PERSIST_TO" ]]; then
  WRANGLER_FLAGS+=(--persist-to "$PERSIST_TO")
fi
if [[ "$INCLUDE_SCHEMA" == "0" ]]; then
  WRANGLER_FLAGS+=(--no-schema)
fi
if [[ "$EXPORT_ALL_TABLES" == "0" ]]; then
  for table in "${TABLES[@]}"; do
    WRANGLER_FLAGS+=(--table "$table")
  done
fi

echo "Exporting local D1 snapshot..."
npx wrangler --config "$WRANGLER_CONFIG" d1 export "$DB_NAME" "${WRANGLER_FLAGS[@]}"

echo "Snapshot written to: $OUTPUT_PATH"
