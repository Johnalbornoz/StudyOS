#!/bin/bash
# CR-L8-01 (assessment side, L2) -- subject-aware exam-gap aggregates on an EPHEMERAL local Postgres (never hosted).
#
#   baseline + ledger -> governed runner (every migration) -> catalogue seeds
#   -> two fixture Students with one scored PAA attempt each (a multi-subject exam)
#   -> the real examGapsFor: unscoped, per subject, multi-subject objective, unmapped objective, fail-closed scopes
#
# Usage: PG_BIN=/opt/homebrew/opt/postgresql@18/bin ./scripts/operations/l2-cr-l8-01-subject-gaps-cert.sh [workdir]

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
WORKDIR="${1:-$(mktemp -d /tmp/studyus-l2-cr-l8-01-cert.XXXXXX)}"
PORT="${PGPORT_CERT:-54411}"
PGDATA="$WORKDIR/pgdata"
DB=l2_cr_l8_01_cert
export LC_ALL=C

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT

mkdir -p "$WORKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null 2>&1
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$WORKDIR/postgres.log" -o "-p $PORT -h 127.0.0.1 -k ''" start >/dev/null
sleep 1
PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
TSX=("$REPO_ROOT/node_modules/.bin/tsx" --tsconfig "$REPO_ROOT/tsconfig.json")

"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$DB"
"${PSQL[@]}" -c 'DROP SCHEMA public CASCADE;' "$DB"
TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$TEST_SQL"
if ! "${PSQL[@]}" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$DB" | grep -q 1; then
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
fi
"${PSQL[@]}" -f "$TEST_SQL" "$DB" >/dev/null
"${PSQL[@]}" -f "$REPO_ROOT/database/ledger/0000_baseline_ledger.sql" "$DB"
SUM=$(shasum -a 256 "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" | awk '{print $1}')
"${PSQL[@]}" -c "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '$SUM')" "$DB"
"${PSQL[@]}" -c "INSERT INTO mastery_policies (version, minimum_understanding, minimum_independence, minimum_application, minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days) SELECT 1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14 WHERE NOT EXISTS (SELECT 1 FROM mastery_policies)" "$DB"
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/$DB"
FP=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(require('crypto').createHash('sha256').update(u.hostname+'|'+u.pathname.slice(1)).digest('hex').slice(0,16))")

echo "--- [1] schema: baseline + governed runner"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
echo "--- [2] catalogue seeds"
"${PSQL[@]}" -c "INSERT INTO users (clerk_id, email, is_system) VALUES ('system:cert-editor', NULL, true), ('system:cert-reviewer', NULL, true) ON CONFLICT (clerk_id) DO NOTHING" "$DB"
(cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-apply.ts --write 2>&1 | tail -1 | cut -c1-160)
(cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-learning-catalog.ts --write 2>&1 | tail -1 | cut -c1-160)
echo "--- [3] subject-aware exam gaps (real query)"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/l2-cr-l8-01/subject-gaps-cert.ts 2>&1 | grep -E "^(PASS|FAIL|L2_CR|Refusing)")
echo "L2_CR_L8_01_CERT = DONE"
