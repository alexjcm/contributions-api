#!/usr/bin/env bash

set -euo pipefail

DB_BINDING="${DB_BINDING:-DCM_DB_BINDING}"
ROW_LIMIT="${ROW_LIMIT:-20}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.dev.jsonc}"

usage() {
  cat <<'EOF'
Usage:
  ./tools/local/d1/inspect.sh [--limit <n>] [--binding <name>] [--persist-to <dir>]

Examples:
  ./tools/local/d1/inspect.sh
  ./tools/local/d1/inspect.sh --limit 10

Env vars (optional):
  DB_BINDING   D1 binding name (default: DCM_DB_BINDING)
  ROW_LIMIT    Max rows per sample query (default: 20)
  WRANGLER_CONFIG  Wrangler config file (default: wrangler.dev.jsonc)
EOF
}

WRANGLER_LOCAL_FLAGS=(--local)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      ROW_LIMIT="${2:-}"
      shift 2
      ;;
    --binding)
      DB_BINDING="${2:-}"
      shift 2
      ;;
    --persist-to)
      WRANGLER_LOCAL_FLAGS+=(--persist-to "${2:-}")
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

if ! [[ "$ROW_LIMIT" =~ ^[0-9]+$ ]] || [[ "$ROW_LIMIT" -lt 1 ]]; then
  echo "ROW_LIMIT must be a positive integer. Got: $ROW_LIMIT" >&2
  exit 1
fi

run_sql() {
  local sql="$1"
  echo
  echo "SQL> $sql"
  npx wrangler --config "$WRANGLER_CONFIG" d1 execute "$DB_BINDING" "${WRANGLER_LOCAL_FLAGS[@]}" --command "$sql"
}

echo "Inspecting local D1 database:"
echo "  binding: $DB_BINDING"
echo "  limit:   $ROW_LIMIT"

run_sql "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

run_sql "SELECT 'contributors' AS table_name, COUNT(*) AS total FROM contributors
UNION ALL SELECT 'contributions', COUNT(*) FROM contributions
UNION ALL SELECT 'settings', COUNT(*) FROM settings;"

run_sql "SELECT id, name, email, status, created_at, updated_at
FROM contributors
ORDER BY id DESC
LIMIT $ROW_LIMIT;"

run_sql "SELECT id, contributor_id, year, month, amount_cents, status, created_at, updated_at
FROM contributions
ORDER BY id DESC
LIMIT $ROW_LIMIT;"

run_sql "SELECT key, value, created_at, updated_at
FROM settings
ORDER BY key ASC
LIMIT $ROW_LIMIT;"
