#!/bin/bash
# Exam Platform V2 integration -- full migration chain on an EPHEMERAL local Postgres (never Neon, never hosted).
#
#   baseline + ledger -> the REAL governed runner (scripts/db-migrate.ts) -> db-status (0 pending / 0 drift)
#   -> schema checks for 20261031 / 20261101 / 20261102 -> second db-migrate run (idempotent: nothing to apply)
#   -> exam-platform-v2-integration-cert.ts (Saber V2.1 apply, real formInputs OFF vs SHADOW, QB targeting)
#   -> Question Bank mock-certification CLI (read-only) for Saber.
#
# Usage: PG_BIN=/opt/homebrew/opt/postgresql@18/bin ./scripts/operations/exam-platform-v2-migration-chain-cert.sh [workdir]
# TCP on 127.0.0.1 (a long scratchpad path does not fit a unix socket). Prints no credential.

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKDIR="${1:-$(mktemp -d /tmp/studyus-exam-platform-cert.XXXXXX)}"
PORT="${PGPORT_CERT:-54391}"
PGDATA="$WORKDIR/pgdata"
DBNAME="studyus_exam_platform_cert"
export LC_ALL=C

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT

mkdir -p "$WORKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$WORKDIR/postgres.log" -o "-p $PORT -h 127.0.0.1 -k ''" start >/dev/null
sleep 1
PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$DBNAME"
"${PSQL[@]}" -c 'DROP SCHEMA public CASCADE;' "$DBNAME"

TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$TEST_SQL"
if ! "${PSQL[@]}" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$DBNAME" | grep -q 1; then
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
fi
echo "--- [1] baseline + ledger"
"${PSQL[@]}" -f "$TEST_SQL" "$DBNAME"
"${PSQL[@]}" -f "$REPO_ROOT/database/ledger/0000_baseline_ledger.sql" "$DBNAME"
SUM=$(shasum -a 256 "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" | awk '{print $1}')
"${PSQL[@]}" -c "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '$SUM')" "$DBNAME"
# Policy v1 row the schema-only baseline omits (the app refuses to run without it).
"${PSQL[@]}" -c "INSERT INTO mastery_policies (version, practice_threshold, prove_threshold, retain_threshold, transfer_threshold, mastery_threshold, require_transfer, min_days_between_attempts, max_attempts_per_day, retain_min_days, retain_window_days) SELECT 1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3 WHERE NOT EXISTS (SELECT 1 FROM mastery_policies)" "$DBNAME" 2>/dev/null || echo "  (mastery_policies seed skipped: schema differs; not needed by this cert)"

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/$DBNAME"
cd "$REPO_ROOT"
echo "--- [2] governed runner: db-migrate (all pending migrations)"
npx tsx scripts/db-migrate.ts 2>&1 | tail -6
echo "--- [3] db-status (expect 0 pending / 0 drift)"
npx tsx scripts/db-status.ts 2>&1 | tail -12
echo "--- [4] schema checks"
"${PSQL[@]}" -tAc "SELECT 'content_audience='||count(*) FROM information_schema.columns WHERE table_name='exam_instances' AND column_name='content_audience'" "$DBNAME"
"${PSQL[@]}" -tAc "SELECT 'constraints_col='||count(*) FROM information_schema.columns WHERE table_name='blueprint_objective_targets' AND column_name='constraints'" "$DBNAME"
"${PSQL[@]}" -tAc "SELECT 'constraints_check='||count(*) FROM pg_constraint WHERE conname='blueprint_objective_targets_constraints_check'" "$DBNAME"
"${PSQL[@]}" -tAc "SELECT 'ledger_rows='||count(*)||' last='||max(version) FROM schema_migrations" "$DBNAME"
echo "--- [5] second db-migrate run (idempotent)"
npx tsx scripts/db-migrate.ts 2>&1 | tail -3
echo "--- [6] integration cert (Saber V2.1 apply, real formInputs OFF vs SHADOW, QB targeting)"
npx tsx --tsconfig tsconfig.json scripts/operations/exam-platform-v2-integration-cert.ts
echo "--- [7] Question Bank mock certification (read-only) for Saber"
npx tsx --tsconfig tsconfig.json scripts/operations/qb-mock-certification.ts --exam v2.saber11.math 2>&1 | tail -25
echo "EXAM_PLATFORM_V2_MIGRATION_CHAIN_CERT = DONE"
