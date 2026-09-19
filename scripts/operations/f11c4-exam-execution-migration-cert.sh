#!/bin/bash
# F11-C4 -- Exam Reinforcement Execution Orchestration certification
# against a REAL, EPHEMERAL, local-only Postgres instance (never Neon/
# Preview/Production). Applies the full existing migration ledger plus
# F11-C4's own new, additive migration, seeds F9's own real PAA/Cambridge
# fixture (f9-seed-pilot-dataset.ts -- the same fixture F9's own
# certification depends on, so PAA Full Mock is genuinely,
# non-fabricated NOT_READY), then runs the full Exam targeting +
# F7/F9 reuse + Full Mock Guard + framework isolation + adversarial +
# concurrency + failure-recovery certification.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-f11c4-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f11c4_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F11-C4 Exam Reinforcement Execution Orchestration — local migration + certification ==="
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

echo "--- applying full migration history (chronological, through F11-C4's own new migration) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F11-C4 migration a second time ---"
$PSQL -f "$MIGRATIONS_DIR/20261002_1000_f11c4_exam_reinforcement_execution.sql" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects exist ---"
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='teacher_interventions' AND column_name='exam_profile_id'" | grep -q exam_profile_id
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='teacher_interventions' AND column_name='simulation_type'" | grep -q simulation_type
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='teacher_interventions' AND column_name='academic_subject_id'" | grep -q academic_subject_id
$PSQL -tAc "SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'teacher_intervention_executions_execution_type_check'" | grep -q 1
echo "  OK -- teacher_interventions.exam_profile_id/simulation_type/academic_subject_id and the widened execution_type CHECK are all present"

echo "--- required base data: a mastery_policies row (updateMastery's real dependency) ---"
$PSQL -c "
  INSERT INTO mastery_policies (
    version, minimum_understanding, minimum_independence, minimum_application,
    minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions,
    minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days
  ) VALUES (1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14)
  ON CONFLICT (version) DO NOTHING;
" >/dev/null

echo "--- seeding F9's own real PAA (Math SUPPORTED, Reading genuinely UNSUPPORTED) + Cambridge fixture ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f9-seed-pilot-dataset.ts" >/dev/null

echo "--- running the F11-C4 exam execution certification ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f11c4-exam-execution-cert-runner.ts"

echo ""
echo "=== F11-C4 migration + certification: ALL CHECKS PASSED ==="
