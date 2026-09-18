#!/bin/bash
# F8 -- Framework-Aware Teaching & Exam Skills migration + adversarial
# certification, against a REAL, EPHEMERAL, local-only Postgres
# instance (never Neon/Preview/Production -- per task §39, remote
# migration policy unchanged: never applied to remote Preview DB until
# isolation from Production is proven). Mirrors every prior phase's own
# cert script.
#
# Proves: the F8 migration applies cleanly on top of the full existing
# history (through F7), is idempotent, and -- exercised via real
# service calls, including the real F5 updateMastery() and real F2
# canAccessLearner() -- the full adversarial matrix from task §33 (A-Q)
# behaves exactly as designed.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
F8_MIGRATION="$MIGRATIONS_DIR/20260926_1000_f8_framework_aware_teaching_exam_skills.sql"
WORKDIR="$(mktemp -d /tmp/studyus-f8-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f8_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F8 Framework-Aware Teaching & Exam Skills — local migration + adversarial certification ==="
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

echo "--- applying full migration history (chronological, up to and including F8) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F8 migration a second time ---"
$PSQL -f "$F8_MIGRATION" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects and seeded policy versions exist ---"
for t in diagnostic_policy_versions learner_gap_diagnoses intervention_policy_versions intervention_sessions intervention_attempts command_term_interpretations; do
  $PSQL -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"
done
DIAG_POLICY_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM diagnostic_policy_versions WHERE status = 'ACTIVE'")
[ "$DIAG_POLICY_COUNT" -eq 1 ]
INTERVENTION_POLICY_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM intervention_policy_versions WHERE status = 'ACTIVE'")
[ "$INTERVENTION_POLICY_COUNT" -eq 1 ]
echo "  OK -- all F8 tables present; exactly 1 ACTIVE diagnostic policy and 1 ACTIVE intervention policy seeded"

echo "--- required base data: a mastery_policies row (updateMastery's real dependency, not seeded by any migration) ---"
$PSQL -c "
  INSERT INTO mastery_policies (
    version, minimum_understanding, minimum_independence, minimum_application,
    minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions,
    minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days
  ) VALUES (1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14);
" >/dev/null

echo "--- seeding the F4/F6/F7 fixture stack F8's own matrix needs (PAA + Cambridge contrast) ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f8-seed-pilot-dataset.ts"

echo "--- running the full F8 adversarial certification (task 33 A-Q) via real service calls ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f8-lifecycle-cert-runner.ts"

echo ""
echo "=== F8 migration + adversarial certification: ALL CHECKS PASSED ==="
