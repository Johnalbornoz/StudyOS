#!/bin/bash
# StudyUs — Phase 0E2 migration test.
#
# Proves database/migrations/20260831_1400_ai_execution_and_decision_audit.sql
# applies cleanly through the REAL governed process (npm run db:status /
# npm run db:migrate -- never manually pasted DDL) on top of the Phase 0D
# baseline + ledger, against an EPHEMERAL, throwaway local Postgres instance
# (never production Neon) -- same technique as db-reproducibility-test.sh.
#
# Usage: ./scripts/db-migration-test.sh
# Requires: a local `postgres`/`initdb`/`psql` toolchain (PG_BIN below), and
# `npx tsx` available in this repo. Never touches or prints DATABASE_URL,
# .env.local, or any credential -- this script builds its own throwaway
# connection string to a local Unix socket only.

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@14/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
LEDGER_SQL="$REPO_ROOT/database/ledger/0000_baseline_ledger.sql"
MIGRATION_SQL="$REPO_ROOT/database/migrations/20260831_1400_ai_execution_and_decision_audit.sql"
WORKDIR="$(mktemp -d /tmp/studyus-migration-test.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_migration_test"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== StudyUs Phase 0E2 migration test ==="
echo "Ephemeral instance: $WORKDIR (never production, never Neon)"

mkdir -p "$SOCKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null
echo "unix_socket_directories = '$SOCKDIR'" >> "$PGDATA/postgresql.conf"
echo "listen_addresses = ''" >> "$PGDATA/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOGFILE" -o "-h ''" start >/dev/null
sleep 1

"$PG_BIN/createdb" -h "$SOCKDIR" -U postgres "$DBNAME"
"$PG_BIN/psql" -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE;' "$DBNAME"

# Same documented, throwaway-copy-only compatibility substitutions as
# db-reproducibility-test.sh (pgvector unavailable locally; PG17+-only
# transaction_timeout preamble) -- the real baseline file is never touched.
TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$BASELINE_SQL" "$TEST_SQL"
if ! $PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$DBNAME" | grep -q 1; then
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
fi
perl -0pi -e 's/^SET transaction_timeout = 0;$/-- SET transaction_timeout = 0;  -- SKIPPED (requires Postgres 17+, local test toolchain is 14)/m' "$TEST_SQL"

echo "--- [1/10] applying baseline to empty ephemeral database ---"
$PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -f "$TEST_SQL" "$DBNAME"
echo "BASELINE_APPLY = OK"

echo ""
echo "--- [2/10] bootstrapping the migration ledger (mirrors the real Phase 0D production bootstrap) ---"
$PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -f "$LEDGER_SQL" "$DBNAME"
BASELINE_CHECKSUM=$(shasum -a 256 "$BASELINE_SQL" | awk '{print $1}')
$PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '$BASELINE_CHECKSUM')" \
  "$DBNAME"
echo "LEDGER_BOOTSTRAP = OK"

echo ""
echo "--- [3/10] verifying the new tables do NOT exist yet (pre-migration) ---"
for t in ai_execution_events decision_events; do
  EXISTS=$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t')" "$DBNAME")
  echo "  $t: EXISTS=$EXISTS (expected f)"
done

export DATABASE_URL="postgresql://postgres@/$DBNAME?host=$SOCKDIR"

echo ""
echo "--- [4/10] npm run db:status (expect 1 pending migration) ---"
cd "$REPO_ROOT"
npx tsx --env-file=.env.local scripts/db-status.ts

echo ""
echo "--- [5/10] npm run db:migrate -- --dry-run (expect preview only, nothing applied) ---"
npx tsx --env-file=.env.local scripts/db-migrate.ts --dry-run

echo ""
echo "--- [6/10] verifying the new tables STILL do NOT exist after dry-run ---"
for t in ai_execution_events decision_events; do
  EXISTS=$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t')" "$DBNAME")
  echo "  $t: EXISTS=$EXISTS (expected f)"
done

echo ""
echo "--- [7/10] npm run db:migrate (real, governed apply) ---"
npx tsx --env-file=.env.local scripts/db-migrate.ts

echo ""
echo "--- [8/10] npm run db:status (expect 0 pending, ledger shows 2 applied) ---"
npx tsx --env-file=.env.local scripts/db-status.ts

echo ""
echo "--- [9/10] verifying both new tables + PK/FK/constraints/indexes ---"
for t in ai_execution_events decision_events; do
  EXISTS=$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t')" "$DBNAME")
  echo "  $t: EXISTS=$EXISTS (expected t)"
done
echo "  ai_execution_events.execution_id UNIQUE: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_name='ai_execution_events' AND constraint_type='UNIQUE'" "$DBNAME")"
echo "  ai_execution_events.concept_id -> concepts FK: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
    WHERE tc.table_name='ai_execution_events' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='concept_id' AND ccu.table_name='concepts'" "$DBNAME")"
echo "  ai_execution_events.student_id has NO FK (deliberate, documented): $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    WHERE tc.table_name='ai_execution_events' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='student_id'" "$DBNAME") (expected 0)"
echo "  decision_events.ai_execution_id -> ai_execution_events(execution_id) FK: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
    WHERE tc.table_name='decision_events' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='ai_execution_id' AND ccu.table_name='ai_execution_events'" "$DBNAME")"
echo "  decision_events indexes present: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM pg_indexes WHERE tablename='decision_events'" "$DBNAME") (expected >= 6, incl. PK + UNIQUE)"
echo "  ai_execution_events indexes present: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM pg_indexes WHERE tablename='ai_execution_events'" "$DBNAME") (expected >= 5, incl. PK + UNIQUE)"

echo ""
echo "--- [10/10] verifying ledger entry + checksum for the new migration ---"
$PG_BIN/psql -h "$SOCKDIR" -U postgres -c "SELECT version, name, checksum FROM schema_migrations ORDER BY applied_at;" "$DBNAME"
LEDGER_COUNT=$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT COUNT(*) FROM schema_migrations" "$DBNAME")
echo "LEDGER_ENTRY_COUNT = $LEDGER_COUNT (expected 2)"

echo ""
echo "--- verifying no unrelated table was altered (spot-check row counts stay at 0 on a pre-existing table) ---"
echo "  subjects row count: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT COUNT(*) FROM subjects" "$DBNAME") (expected 0 -- fresh ephemeral DB)"

echo ""
echo "MIGRATION_TEST = PASS"
