#!/bin/bash
# F9 -- Exam Readiness & Simulation migration + adversarial
# certification, against a REAL, EPHEMERAL, local-only Postgres
# instance (never Neon/Preview/Production -- per task §57, remote
# migration policy unchanged). Mirrors every prior phase's own cert
# script.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
F9_MIGRATION="$MIGRATIONS_DIR/20260927_1000_f9_exam_readiness_simulation.sql"
WORKDIR="$(mktemp -d /tmp/studyus-f9-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f9_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F9 Exam Readiness & Simulation — local migration + adversarial certification ==="
echo "Ephemeral instance: $WORKDIR (never production, never Neon, never Preview)"

mkdir -p "$SOCKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null
echo "unix_socket_directories = '$SOCKDIR'" >> "$PGDATA/postgresql.conf"
echo "listen_addresses = ''" >> "$PGDATA/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOGFILE" -o "-h ''" start >/dev/null
sleep 1
"$PG_BIN/createdb" -h "$SOCKDIR" -U postgres "$DBNAME"
"$PG_BIN/psql" -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE;' "$DBNAME"

TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$BASELINE_SQL" "$TEST_SQL"
if ! "$PG_BIN/psql" -h "$SOCKDIR" -U postgres -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$DBNAME" | grep -q 1; then
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
fi
perl -0pi -e 's/^SET transaction_timeout = 0;$/-- SET transaction_timeout = 0; -- SKIPPED (PG14\/PG18 compat)/m' "$TEST_SQL"

PSQL="$PG_BIN/psql -h $SOCKDIR -U postgres -v ON_ERROR_STOP=1 -q $DBNAME"

echo "--- applying baseline schema ---"
$PSQL -f "$TEST_SQL" >/dev/null

echo "--- applying full migration history (chronological, up to and including F9) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F9 migration a second time ---"
$PSQL -f "$F9_MIGRATION" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects and seeded policy versions exist ---"
for t in readiness_policy_versions readiness_snapshots score_conversion_models simulation_plans simulation_attempts; do
  $PSQL -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"
done
READINESS_POLICY_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM readiness_policy_versions WHERE status = 'ACTIVE'")
[ "$READINESS_POLICY_COUNT" -eq 1 ]
SCORE_MODEL_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM score_conversion_models")
[ "$SCORE_MODEL_COUNT" -eq 0 ]
echo "  OK -- all F9 tables present; exactly 1 ACTIVE readiness policy seeded; ZERO score_conversion_models rows (no fabricated calibration)"

echo "--- required base data: a mastery_policies row (updateMastery's real dependency, not seeded by any migration) ---"
$PSQL -c "
  INSERT INTO mastery_policies (
    version, minimum_understanding, minimum_independence, minimum_application,
    minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions,
    minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days
  ) VALUES (1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14);
" >/dev/null

echo "--- seeding the F4/F6/F7/F8-shaped fixture stack F9's own matrix needs (PAA 2-domain + Cambridge contrast) ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f9-seed-pilot-dataset.ts"

echo "--- running the full F9 adversarial certification (task §45 A-X) via real service calls ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f9-lifecycle-cert-runner.ts"

echo ""
echo "=== F9 migration + adversarial certification: ALL CHECKS PASSED ==="
