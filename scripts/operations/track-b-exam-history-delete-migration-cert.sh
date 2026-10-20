#!/bin/bash
# Exam history delete -- migration certification for
# database/migrations/20261022_1000_track_b_exam_history_delete.sql against a
# REAL, EPHEMERAL, local-only Postgres (never Neon / DEV / Stage / Production).
#
# Proves: history before the target + a LEGACY simulation attempt; the migration
# applies twice (idempotent) and leaves the legacy attempt visible (hidden_at
# NULL); the hidden_at / hidden_reason pairing is enforced; the documented
# rollback applies inside a transaction.
#
# Usage: bash scripts/operations/track-b-exam-history-delete-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C
export PGOPTIONS="-c client_min_messages=warning"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261022_1000_track_b_exam_history_delete.sql"
WORKDIR="$(mktemp -d /tmp/studyus-exam-hd-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_exam_hd_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then echo "KEEP_CERT_DB=1 -- leaving $WORKDIR"; return; fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Exam history delete -- local migration certification ==="
echo "Ephemeral instance: $WORKDIR (never Neon, never DEV/Stage/Production)"
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
Q() { $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$1" "$DBNAME"; }
REJECTS() {
  if $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$2" "$DBNAME" >/dev/null 2>&1; then echo "  FAIL -- accepted: $1"; exit 1; fi
  echo "  OK -- rejected: $1"
}
EXPECT() {
  if [ "$2" != "$3" ]; then echo "  FAIL -- $1: got '$2', expected '$3'"; exit 1; fi
  echo "  OK -- $1 = $2"
}

echo "--- [1/4] baseline + history before $TARGET, a legacy attempt ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
S=00000000-0000-0000-0000-00000000000a
Q "INSERT INTO students (id, clerk_id, email) VALUES ('$S', 'cert:legacy', 'legacy@cert.invalid')" >/dev/null
Q "INSERT INTO exam_definitions (id, name, exam_family, status) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Legacy exam', 'PAA', 'ACTIVE')" >/dev/null
Q "INSERT INTO exam_versions (id, exam_definition_id, version_label, status) VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'v1', 'PUBLISHED')" >/dev/null
Q "INSERT INTO student_exam_profiles (id, student_id, exam_definition_id) VALUES ('00000000-0000-0000-0000-0000000000e4', '$S', '00000000-0000-0000-0000-0000000000e1')" >/dev/null
Q "INSERT INTO exam_attempts (id, student_exam_profile_id, exam_version_id, frozen_configuration) VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', '{}')" >/dev/null
Q "INSERT INTO simulation_plans (id, student_id, exam_version_id, simulation_type, plan) VALUES ('00000000-0000-0000-0000-0000000000e7', '$S', '00000000-0000-0000-0000-0000000000e2', 'MINI_MOCK', '{}')" >/dev/null
Q "INSERT INTO simulation_attempts (id, exam_attempt_id, student_id, exam_profile_id, exam_version_id, simulation_type, simulation_plan_id, timing_mode, pause_allowed, status, language) VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e5', '$S', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', 'MINI_MOCK', '00000000-0000-0000-0000-0000000000e7', 'UNTIMED', true, 'COMPLETED', 'es')" >/dev/null
echo "  OK"

echo "--- [2/4] applying $TARGET (twice: idempotent) ---"
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
EXPECT "legacy attempt stays visible" "$(Q "SELECT hidden_at IS NULL AND hidden_reason IS NULL FROM simulation_attempts WHERE id='00000000-0000-0000-0000-0000000000f1'")" "t"
EXPECT "new columns are nullable" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_name='simulation_attempts' AND column_name IN ('hidden_at','hidden_reason') AND is_nullable='YES'")" "2"
EXPECT "partial index present" "$(Q "SELECT count(*) FROM pg_indexes WHERE indexname='idx_simulation_attempts_profile_visible'")" "1"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done

echo "--- [3/4] constraint ---"
REJECTS "hidden without a reason" "UPDATE simulation_attempts SET hidden_at = now() WHERE id='00000000-0000-0000-0000-0000000000f1'"
REJECTS "a reason without hidden_at" "UPDATE simulation_attempts SET hidden_reason = 'x' WHERE id='00000000-0000-0000-0000-0000000000f1'"
Q "UPDATE simulation_attempts SET hidden_at = now(), hidden_reason = 'STUDENT_REQUEST' WHERE id='00000000-0000-0000-0000-0000000000f1'" >/dev/null
EXPECT "soft hide keeps the attempt row and its status" "$(Q "SELECT status FROM simulation_attempts WHERE id='00000000-0000-0000-0000-0000000000f1'")" "COMPLETED"

echo "--- [4/4] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY);
$(sed -n '/^-- Rollback/,/^-- ----/p' "$MIGRATIONS_DIR/$TARGET" | sed -e '1d;$d' -e 's/^--   //')
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "columns intact after ROLLBACK" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_name='simulation_attempts' AND column_name IN ('hidden_at','hidden_reason')")" "2"

echo "=== EXAM_HISTORY_DELETE_MIGRATION_CERT = PASS ==="
