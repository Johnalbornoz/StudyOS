#!/bin/bash
# Exam preparation, objective first -- migration certification for
# database/migrations/20261025_1000_track_b_exam_objective_first.sql against a
# REAL, EPHEMERAL, local-only Postgres (never Neon / DEV / Stage / Production).
#
# Proves: the migration applies twice on top of the full history (idempotent);
# an existing (exam-definition) profile is untouched and still valid; a
# catalogue-only objective profile needs no exam definition; a profile needs an
# exam definition OR an objective; one active profile per Student and objective
# (and the old one-per-exam rule still holds); an archived objective can be
# chosen again; objective keys are safe identifiers; DIAGNOSTIC instances are
# practice only; preparation provenance (EXAM_PREPARATION) is accepted and still
# one per Student and concept; the documented rollback applies in a transaction.
#
# Usage: bash scripts/operations/track-b-exam-objective-first-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C
export PGOPTIONS="-c client_min_messages=warning"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261025_1000_track_b_exam_objective_first.sql"
WORKDIR="$(mktemp -d /tmp/studyus-objective-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_objective_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then echo "KEEP_CERT_DB=1 -- leaving $WORKDIR"; return; fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Exam objective first -- local migration certification ==="
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
echo "--- [1/5] history before $TARGET (with a legacy profile), then $TARGET twice ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
Q "INSERT INTO students (id, clerk_id, email) VALUES ('$S', 'cert:objective', 'objective@cert.invalid')" >/dev/null
D=$(Q "INSERT INTO exam_definitions (name, exam_family, status) VALUES ('PISA 2022', 'PISA', 'ACTIVE') RETURNING id")
LEGACY=$(Q "INSERT INTO student_exam_profiles (student_id, exam_definition_id) VALUES ('$S', '$D') RETURNING id")
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
EXPECT "legacy profile untouched (no objective, same exam)" "$(Q "SELECT objective_key IS NULL AND exam_definition_id = '$D' AND status = 'ACTIVE' FROM student_exam_profiles WHERE id = '$LEGACY'")" "t"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done

echo "--- [2/5] objective-first profiles ---"
Q "INSERT INTO student_exam_profiles (student_id, objective_key, objective_framework, source) VALUES ('$S', 'cie.asal.9093.a', 'CIE_AS_A', 'STUDENT')" >/dev/null
echo "  OK -- catalogue-only objective without an exam definition"
REJECTS "a profile with neither exam nor objective" "INSERT INTO student_exam_profiles (student_id) VALUES ('$S')"
REJECTS "a second active profile for the same objective" "INSERT INTO student_exam_profiles (student_id, objective_key) VALUES ('$S', 'cie.asal.9093.a')"
REJECTS "a second active profile for the same exam definition" "INSERT INTO student_exam_profiles (student_id, exam_definition_id, objective_key) VALUES ('$S', '$D', 'pisa.2022')"
REJECTS "an unsafe objective key" "INSERT INTO student_exam_profiles (student_id, objective_key) VALUES ('$S', 'Bad Key;')"
REJECTS "an unknown source" "INSERT INTO student_exam_profiles (student_id, objective_key, source) VALUES ('$S', 'ib.dp.physics.hl', 'TEACHER_FORCED')"
Q "UPDATE student_exam_profiles SET objective_key = 'pisa.2022' WHERE id = '$LEGACY'" >/dev/null
echo "  OK -- a legacy profile adopts its objective"
Q "UPDATE student_exam_profiles SET status = 'ARCHIVED', archived_at = now() WHERE objective_key = 'cie.asal.9093.a'" >/dev/null
Q "INSERT INTO student_exam_profiles (student_id, objective_key) VALUES ('$S', 'cie.asal.9093.a')" >/dev/null
echo "  OK -- the objective can be chosen again after removing it"

echo "--- [3/5] diagnostic instances ---"
EXPECT "purpose column" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_name = 'exam_instances' AND column_name = 'purpose'")" "1"
EXPECT "DIAGNOSTIC only with PRACTICE" "$(Q "SELECT pg_get_constraintdef(oid) LIKE '%DIAGNOSTIC%PRACTICE%' FROM pg_constraint WHERE conname = 'exam_instances_purpose_check'")" "t"

echo "--- [4/5] preparation provenance ---"
EXPECT "EXAM_PREPARATION accepted, EXAM_GAP kept" "$(Q "SELECT pg_get_constraintdef(oid) LIKE '%EXAM_GAP%EXAM_PREPARATION%' FROM pg_constraint WHERE conname = 'exam_gap_concept_links_source_check'")" "t"
EXPECT "one link per Student and concept still enforced" "$(Q "SELECT count(*) FROM pg_constraint WHERE conname = 'exam_gap_concept_links_one_per_concept'")" "1"
EXPECT "profile column on provenance" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_name = 'exam_gap_concept_links' AND column_name = 'exam_profile_id'")" "1"

echo "--- [5/5] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY);
DELETE FROM public.student_exam_profiles WHERE exam_definition_id IS NULL;
$(sed -n '/^-- Rollback/,/^-- ----/p' "$MIGRATIONS_DIR/$TARGET" | sed -e '1d;$d' -e 's/^--   //')
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "objective profiles intact after ROLLBACK" "$(Q "SELECT count(*) FROM student_exam_profiles WHERE objective_key IS NOT NULL AND exam_definition_id IS NULL")" "2"

echo "=== EXAM_OBJECTIVE_FIRST_MIGRATION_CERT = PASS ==="
