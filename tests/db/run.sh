#!/usr/bin/env bash
# Test del database: applica le migrazioni su un DB vuoto ed esegue i controlli di integrità.
# Uso: TEST_DATABASE_URL=postgres://user:pass@host/db_vuoto npm run test:db
set -euo pipefail
: "${TEST_DATABASE_URL:?Imposta TEST_DATABASE_URL (un database VUOTO dedicato ai test)}"
DIR="$(cd "$(dirname "$0")" && pwd)"
for f in "$DIR"/../../migrations/*.sql; do psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DIR/checks.sql"
echo "Test database: OK"
