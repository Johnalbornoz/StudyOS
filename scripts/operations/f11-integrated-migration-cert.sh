#!/bin/bash
# F11 -- INTEGRATED CERTIFICATION GATE, against a REAL, EPHEMERAL,
# local-only Postgres instance (never Neon/Preview/Production). Applies
# the full existing migration ledger (through F11-C4's own migration --
# no new migration in this gate), seeds F9's own real PAA/Cambridge
# fixture, then runs the full integrated certification: F9 Student
# self-service non-regression, one integrated Teacher flow exercising
# all four intervention types, joint Evidence semantics, the full
# authorization matrix, PAA Full Mock convergence, joint concurrency,
# and the two coexisting entry points.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-f11int-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f11int_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F11 Integrated Certification Gate — local migration + certification ==="
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

echo "--- applying full migration history (chronological, through F11-C4) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

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

echo "--- running the F11 INTEGRATED certification ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f11-integrated-cert-runner.ts"

echo ""
echo "=== F11 integrated migration + certification: ALL CHECKS PASSED ==="
