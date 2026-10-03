#!/bin/bash
# Cambridge AICE Diploma + exam-gap provenance -- migration certification for
# database/migrations/20261024_1000_track_b_aice_diploma_exam_gaps.sql against a
# REAL, EPHEMERAL, local-only Postgres (never Neon / DEV / Stage / Production).
#
# Proves: the migration applies twice on top of the full history (idempotent);
# one ACTIVE Diploma plan per Student; one entry per syllabus; the exam-series
# pair; grades valid per level (no A* at AS, no lower-case at A Level); results
# unique per series; thresholds only from cambridgeinternational.org and unique
# per series / option / grade; EXAM_GAP provenance unique per Student and
# concept; the documented rollback applies inside a transaction.
#
# Usage: bash scripts/operations/track-b-aice-diploma-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C
export PGOPTIONS="-c client_min_messages=warning"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261024_1000_track_b_aice_diploma_exam_gaps.sql"
WORKDIR="$(mktemp -d /tmp/studyus-aice-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_aice_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then echo "KEEP_CERT_DB=1 -- leaving $WORKDIR"; return; fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== AICE Diploma + exam gaps -- local migration certification ==="
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

S=00000000-0000-0000-0000-00000000000a
echo "--- [1/5] history before $TARGET, then $TARGET twice (idempotent) ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
Q "INSERT INTO students (id, clerk_id, email) VALUES ('$S', 'cert:aice', 'aice@cert.invalid')" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
for t in aice_diploma_plans aice_plan_entries cambridge_results cambridge_grade_thresholds exam_gap_concept_links; do
  EXPECT "table $t" "$(Q "SELECT to_regclass('public.$t') IS NOT NULL")" "t"
done
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done

echo "--- [2/5] Diploma plan ---"
P=$(Q "INSERT INTO aice_diploma_plans (student_id, policy_version) VALUES ('$S', 'AICE-DIPLOMA-2026-10') RETURNING id")
REJECTS "a second ACTIVE plan" "INSERT INTO aice_diploma_plans (student_id, policy_version) VALUES ('$S', 'AICE-DIPLOMA-2026-10')"
Q "INSERT INTO aice_plan_entries (plan_id, syllabus_code, level, counted_group, expected_series_year, expected_series_month) VALUES ('$P', '9709', 'A', 'GROUP_1', 2027, 6)" >/dev/null
REJECTS "the same syllabus twice in a plan" "INSERT INTO aice_plan_entries (plan_id, syllabus_code, level) VALUES ('$P', '9709', 'AS')"
REJECTS "a syllabus code that is not 4 digits" "INSERT INTO aice_plan_entries (plan_id, syllabus_code, level) VALUES ('$P', '97A9', 'AS')"
REJECTS "level A2 (not a qualification)" "INSERT INTO aice_plan_entries (plan_id, syllabus_code, level) VALUES ('$P', '9702', 'A2')"
REJECTS "a series month that does not exist (May)" "INSERT INTO aice_plan_entries (plan_id, syllabus_code, level, expected_series_year, expected_series_month) VALUES ('$P', '9702', 'AS', 2027, 5)"
REJECTS "a series year without a month" "INSERT INTO aice_plan_entries (plan_id, syllabus_code, level, expected_series_year) VALUES ('$P', '9702', 'AS', 2027)"
REJECTS "an unknown group" "INSERT INTO aice_plan_entries (plan_id, syllabus_code, level, counted_group) VALUES ('$P', '9702', 'AS', 'GROUP_5')"
Q "UPDATE aice_diploma_plans SET status = 'ARCHIVED' WHERE id = '$P'" >/dev/null
Q "INSERT INTO aice_diploma_plans (student_id, policy_version) VALUES ('$S', 'AICE-DIPLOMA-2026-10')" >/dev/null
echo "  OK -- a new plan after archiving the old one"

echo "--- [3/5] results and thresholds ---"
Q "INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source) VALUES ('$S', '9709', 'A', 2027, 6, 'A*', 'OFFICIAL_STATEMENT')" >/dev/null
Q "INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source) VALUES ('$S', '9702', 'AS', 2026, 11, 'a', 'COORDINATOR_VERIFIED')" >/dev/null
REJECTS "A* at AS Level" "INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source) VALUES ('$S', '9701', 'AS', 2027, 6, 'A*', 'OFFICIAL_STATEMENT')"
REJECTS "a lower-case grade at A Level" "INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source) VALUES ('$S', '9701', 'A', 2027, 6, 'a', 'OFFICIAL_STATEMENT')"
REJECTS "the same result twice in one series" "INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source) VALUES ('$S', '9709', 'A', 2027, 6, 'B', 'OFFICIAL_STATEMENT')"
REJECTS "an unknown source" "INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source) VALUES ('$S', '9700', 'A', 2027, 6, 'B', 'SELF_REPORTED')"
Q "INSERT INTO cambridge_results (student_id, syllabus_code, level, series_year, series_month, grade, source) VALUES ('$S', '9700', 'A', 2027, 6, 'U', 'OFFICIAL_STATEMENT')" >/dev/null
echo "  OK -- U accepted at A Level"
Q "INSERT INTO cambridge_grade_thresholds (syllabus_code, series_year, series_month, level, option_code, grade, min_mark, max_total, source_url, retrieved_at) VALUES ('9709', 2026, 6, 'A', 'AX', 'A', 180, 250, 'https://www.cambridgeinternational.org/x.pdf', now())" >/dev/null
REJECTS "a threshold from a non-Cambridge source" "INSERT INTO cambridge_grade_thresholds (syllabus_code, series_year, series_month, level, option_code, grade, min_mark, max_total, source_url, retrieved_at) VALUES ('9709', 2026, 6, 'A', 'AX', 'B', 150, 250, 'https://example.com/t.pdf', now())"
REJECTS "the same threshold twice for one series" "INSERT INTO cambridge_grade_thresholds (syllabus_code, series_year, series_month, level, option_code, grade, min_mark, max_total, source_url, retrieved_at) VALUES ('9709', 2026, 6, 'A', 'AX', 'A', 170, 250, 'https://www.cambridgeinternational.org/x.pdf', now())"
REJECTS "a minimum above the total" "INSERT INTO cambridge_grade_thresholds (syllabus_code, series_year, series_month, level, option_code, grade, min_mark, max_total, source_url, retrieved_at) VALUES ('9709', 2026, 11, 'A', 'AX', 'A', 300, 250, 'https://www.cambridgeinternational.org/x.pdf', now())"
REJECTS "A* threshold at AS" "INSERT INTO cambridge_grade_thresholds (syllabus_code, series_year, series_month, level, option_code, grade, min_mark, max_total, source_url, retrieved_at) VALUES ('9709', 2026, 6, 'AS', 'AX', 'A*', 100, 125, 'https://www.cambridgeinternational.org/x.pdf', now())"

echo "--- [4/5] exam-gap provenance ---"
EXPECT "provenance table has the one-per-concept constraint" "$(Q "SELECT count(*) FROM pg_constraint WHERE conname = 'exam_gap_concept_links_one_per_concept'")" "1"
EXPECT "source is always EXAM_GAP" "$(Q "SELECT pg_get_constraintdef(oid) LIKE '%EXAM_GAP%' FROM pg_constraint WHERE conrelid = 'public.exam_gap_concept_links'::regclass AND contype = 'c'")" "t"

echo "--- [5/5] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY);
$(sed -n '/^-- Rollback/,/^-- ----/p' "$MIGRATIONS_DIR/$TARGET" | sed -e '1d;$d' -e 's/^--   //')
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "tables intact after ROLLBACK" "$(Q "SELECT to_regclass('public.cambridge_results') IS NOT NULL")" "t"

echo "=== AICE_DIPLOMA_MIGRATION_CERT = PASS ==="
