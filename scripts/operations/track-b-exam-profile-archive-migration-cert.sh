#!/bin/bash
# Exam Prep profile remove / restart -- migration certification for
# database/migrations/20261023_1000_track_b_exam_profile_archive.sql against a
# REAL, EPHEMERAL, local-only Postgres (never Neon / DEV / Stage / Production).
#
# Proves: history before the target + LEGACY profiles (one ACTIVE, one ARCHIVED for
# the same exam); the migration applies twice (idempotent) and leaves them as they
# were; at most one non-archived profile per Student and exam is enforced while
# archived ones never count; the archive columns are constrained; the migration
# REFUSES when duplicates already exist; the documented rollback applies.
#
# Usage: bash scripts/operations/track-b-exam-profile-archive-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C
export PGOPTIONS="-c client_min_messages=warning"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261023_1000_track_b_exam_profile_archive.sql"
WORKDIR="$(mktemp -d /tmp/studyus-exam-pa-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_exam_pa_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then echo "KEEP_CERT_DB=1 -- leaving $WORKDIR"; return; fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Exam Prep profile archive -- local migration certification ==="
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
D=00000000-0000-0000-0000-0000000000e1
seed() {
  Q "INSERT INTO students (id, clerk_id, email) VALUES ('$S', 'cert:legacy', 'legacy@cert.invalid')" >/dev/null
  Q "INSERT INTO exam_definitions (id, name, exam_family, status) VALUES ('$D', 'Legacy exam', 'PAA', 'ACTIVE')" >/dev/null
}

echo "--- [1/5] duplicates present -> the migration refuses ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
seed
Q "INSERT INTO student_exam_profiles (student_id, exam_definition_id, status) VALUES ('$S', '$D', 'ACTIVE'), ('$S', '$D', 'ACTIVE')" >/dev/null
if $PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null 2>"$WORKDIR/refuse.err"; then echo "  FAIL -- applied over duplicates"; exit 1; fi
EXPECT "refusal names the problem" "$(grep -c 'more than one non-archived profile' "$WORKDIR/refuse.err")" "1"
Q "DELETE FROM student_exam_profiles" >/dev/null

echo "--- [2/5] legacy profiles, then $TARGET twice (idempotent) ---"
Q "INSERT INTO student_exam_profiles (id, student_id, exam_definition_id, status) VALUES ('00000000-0000-0000-0000-0000000000f1', '$S', '$D', 'ACTIVE'), ('00000000-0000-0000-0000-0000000000f2', '$S', '$D', 'ARCHIVED')" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
EXPECT "legacy rows unchanged" "$(Q "SELECT string_agg(status, ',' ORDER BY id) FROM student_exam_profiles")" "ACTIVE,ARCHIVED"
EXPECT "new columns nullable" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_name='student_exam_profiles' AND column_name IN ('archived_at','archive_reason','replaced_by_profile_id') AND is_nullable='YES'")" "3"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done

echo "--- [3/5] one active profile per Student and exam ---"
REJECTS "a second ACTIVE profile" "INSERT INTO student_exam_profiles (student_id, exam_definition_id, status) VALUES ('$S', '$D', 'ACTIVE')"
REJECTS "a second PAUSED (non-archived) profile" "INSERT INTO student_exam_profiles (student_id, exam_definition_id, status) VALUES ('$S', '$D', 'PAUSED')"
Q "INSERT INTO student_exam_profiles (student_id, exam_definition_id, status, archived_at) VALUES ('$S', '$D', 'ARCHIVED', now())" >/dev/null
echo "  OK -- any number of ARCHIVED profiles accepted"
EXPECT "ON CONFLICT returns nothing for a duplicate (service then reads the active one)" "$(Q "WITH i AS (INSERT INTO student_exam_profiles (student_id, exam_definition_id) VALUES ('$S', '$D') ON CONFLICT (student_id, exam_definition_id) WHERE status <> 'ARCHIVED' DO NOTHING RETURNING 1) SELECT count(*) FROM i")" "0"
Q "UPDATE student_exam_profiles SET status = 'ARCHIVED', archived_at = now(), archive_reason = 'STUDENT_REMOVED' WHERE id = '00000000-0000-0000-0000-0000000000f1'" >/dev/null
Q "INSERT INTO student_exam_profiles (id, student_id, exam_definition_id) VALUES ('00000000-0000-0000-0000-0000000000f3', '$S', '$D')" >/dev/null
echo "  OK -- after archiving, a new clean ACTIVE profile is accepted"

echo "--- [4/5] archive columns ---"
REJECTS "archived_at on an ACTIVE profile" "UPDATE student_exam_profiles SET archived_at = now() WHERE id = '00000000-0000-0000-0000-0000000000f3'"
REJECTS "replaced_by on an ACTIVE profile" "UPDATE student_exam_profiles SET replaced_by_profile_id = '00000000-0000-0000-0000-0000000000f1' WHERE id = '00000000-0000-0000-0000-0000000000f3'"
REJECTS "a profile replaced by itself" "UPDATE student_exam_profiles SET replaced_by_profile_id = id WHERE id = '00000000-0000-0000-0000-0000000000f1'"
REJECTS "replaced_by an unknown profile" "UPDATE student_exam_profiles SET replaced_by_profile_id = '00000000-0000-0000-0000-0000000000ff' WHERE id = '00000000-0000-0000-0000-0000000000f1'"
Q "UPDATE student_exam_profiles SET replaced_by_profile_id = '00000000-0000-0000-0000-0000000000f3' WHERE id = '00000000-0000-0000-0000-0000000000f1'" >/dev/null
echo "  OK -- archived profile linked to its replacement"

echo "--- [5/5] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY);
$(sed -n '/^-- Rollback/,/^-- ----/p' "$MIGRATIONS_DIR/$TARGET" | sed -e '1d;$d' -e 's/^--   //')
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "index intact after ROLLBACK" "$(Q "SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_student_exam_profiles_one_active'")" "1"

echo "=== EXAM_PROFILE_ARCHIVE_MIGRATION_CERT = PASS ==="
