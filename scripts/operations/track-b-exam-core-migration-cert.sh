#!/bin/bash
# Track B -- migration certification for
# database/migrations/20261019_1000_track_b_exam_core_verticals.sql against a
# REAL, EPHEMERAL, local-only Postgres instance (never Neon / DEV / Stage /
# Production). Mirrors the activity-delivery / f7 / f9 cert scripts.
#
# Proves:
#   1. baseline + the full history before the migration applies, and LEGACY
#      rows (a definition with a pre-taxonomy family label, a version, an
#      attempt and a response without target_index) are seeded first;
#   2. the migration applies; legacy rows survive unchanged; the migration is
#      idempotent (re-applied);
#   3. every new constraint / unique index enforces its rule;
#   4. the documented rollback applies inside a transaction (then rolled back);
#   5. optionally (CERT_APPLY_VERTICALS=1) the six vertical configurations
#      apply on the ephemeral DB and a second application is a no-op.
#
# Usage: bash scripts/operations/track-b-exam-core-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261019_1000_track_b_exam_core_verticals.sql"
WORKDIR="$(mktemp -d /tmp/studyus-track-b-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_track_b_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then
    echo "KEEP_CERT_DB=1 -- leaving $WORKDIR running (socket $SOCKDIR, db $DBNAME)"
    return
  fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Track B Exam Core -- local migration certification ==="
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
  if $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$2" "$DBNAME" >/dev/null 2>&1; then
    echo "  FAIL -- accepted: $1"; exit 1
  fi
  echo "  OK -- rejected: $1"
}
EXPECT() {
  if [ "$2" != "$3" ]; then echo "  FAIL -- $1: got '$2', expected '$3'"; exit 1; fi
  echo "  OK -- $1 = $2"
}

echo "--- [1/6] baseline + history before $TARGET ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
echo "  OK"

echo "--- [2/6] seeding LEGACY rows (pre-migration shape) ---"
Q "INSERT INTO students (id, clerk_id, email) VALUES ('00000000-0000-0000-0000-00000000000a', 'cert:legacy', 'legacy@cert.invalid')" >/dev/null
Q "INSERT INTO exam_definitions (id, name, exam_family, status) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Legacy exam', 'ADMISSION_EXAM', 'ACTIVE')" >/dev/null
Q "INSERT INTO exam_versions (id, exam_definition_id, version_label, status) VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'v1', 'PUBLISHED')" >/dev/null
Q "INSERT INTO assessment_components (id, exam_version_id, name, component_type) VALUES ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2', 'Legacy section', 'SECTION')" >/dev/null
Q "INSERT INTO student_exam_profiles (id, student_id, exam_definition_id) VALUES ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1')" >/dev/null
Q "INSERT INTO exam_attempts (id, student_exam_profile_id, exam_version_id, frozen_configuration) VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', '{}')" >/dev/null
Q "INSERT INTO exam_attempt_item_responses (id, exam_attempt_id, assessment_component_id, item_snapshot, score, max_score) VALUES ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e3', '{}', 1, 1)" >/dev/null
echo "  OK"

echo "--- [3/6] applying $TARGET (twice: idempotent) ---"
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
EXPECT "table exam_attempt_results" "$(Q "SELECT to_regclass('public.exam_attempt_results') IS NOT NULL")" "t"
for c in "exam_definitions.config_key" "exam_definitions.academic_subject_id" "exam_definitions.aggregation_group" "exam_versions.exam_year" "exam_versions.exam_session" "assessment_components.sequence_order" "assessment_components.section_key" "exam_attempt_item_responses.target_index" "exam_attempt_item_responses.item_source"; do
  t="${c%%.*}"; col="${c##*.}"
  EXPECT "column $c nullable" "$(Q "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='$t' AND column_name='$col'")" "YES"
done
EXPECT "legacy family row untouched" "$(Q "SELECT exam_family FROM exam_definitions WHERE id='00000000-0000-0000-0000-0000000000e1'")" "ADMISSION_EXAM"
EXPECT "no DB family constraint (taxonomy is app-enforced; shared DEV with Track A)" "$(Q "SELECT count(*) FROM pg_constraint WHERE conname='exam_definitions_family_check'")" "0"
EXPECT "legacy response target_index NULL" "$(Q "SELECT coalesce(target_index::text,'NULL') FROM exam_attempt_item_responses WHERE id='00000000-0000-0000-0000-0000000000e6'")" "NULL"
EXPECT "legacy version year/session NULL" "$(Q "SELECT coalesce(exam_year::text,'NULL')||'/'||coalesce(exam_session,'NULL') FROM exam_versions WHERE id='00000000-0000-0000-0000-0000000000e2'")" "NULL/NULL"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done

echo "--- [4/6] constraints ---"
for fam in PAA PISA IB CAMBRIDGE AICE ICFES; do
  Q "INSERT INTO exam_definitions (name, exam_family) VALUES ('ok $fam', '$fam')" >/dev/null
done
echo "  OK -- all six families accepted"
Q "INSERT INTO exam_definitions (name, exam_family, config_key) VALUES ('k1', 'PAA', 'dev-cert.k')" >/dev/null
REJECTS "duplicate config_key" "INSERT INTO exam_definitions (name, exam_family, config_key) VALUES ('k2', 'PAA', 'dev-cert.k')"
REJECTS "exam_year 1800" "UPDATE exam_versions SET exam_year = 1800 WHERE id='00000000-0000-0000-0000-0000000000e2'"
REJECTS "empty exam_session" "UPDATE exam_versions SET exam_session = '' WHERE id='00000000-0000-0000-0000-0000000000e2'"
Q "UPDATE exam_versions SET exam_year = 2027, exam_session = 'May' WHERE id='00000000-0000-0000-0000-0000000000e2'" >/dev/null
echo "  OK -- valid year/session accepted"
Q "UPDATE assessment_components SET section_key = 'sec_a' WHERE id='00000000-0000-0000-0000-0000000000e3'" >/dev/null
REJECTS "duplicate section_key within a version" "INSERT INTO assessment_components (exam_version_id, name, component_type, section_key) VALUES ('00000000-0000-0000-0000-0000000000e2', 'dup', 'SECTION', 'sec_a')"
RESP="INSERT INTO exam_attempt_item_responses (exam_attempt_id, assessment_component_id, item_snapshot, score, max_score, target_index, item_source) VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e3', '{}', 1, 1"
Q "$RESP, 0, 'APPROVED_BANK')" >/dev/null
REJECTS "second committed response for the same item" "$RESP, 0, 'APPROVED_BANK')"
REJECTS "unknown item_source" "$RESP, 1, 'CLIENT')"
RES="INSERT INTO exam_attempt_results (exam_attempt_id, student_id, exam_version_id, scoring_engine_version, scoring_status, raw_score, max_score, section_results, objective_results, provenance, response_set_hash"
Q "$RES) VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'exam-scoring-v1', 'SCORED', 2, 3, '[]', '[]', '{}', 'h')" >/dev/null
REJECTS "second result for the same attempt" "$RES) VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'exam-scoring-v1', 'SCORED', 2, 3, '[]', '[]', '{}', 'h')"
REJECTS "raw_score above max_score" "UPDATE exam_attempt_results SET raw_score = 4 WHERE exam_attempt_id='00000000-0000-0000-0000-0000000000e5'"
REJECTS "INVALIDATED without a reason" "UPDATE exam_attempt_results SET status = 'INVALIDATED', invalidated_at = now() WHERE exam_attempt_id='00000000-0000-0000-0000-0000000000e5'"
REJECTS "unknown scoring_status" "UPDATE exam_attempt_results SET scoring_status = 'GUESSED' WHERE exam_attempt_id='00000000-0000-0000-0000-0000000000e5'"
Q "UPDATE exam_attempt_results SET status = 'INVALIDATED', invalidated_at = now(), invalidation_reason = 'cert' WHERE exam_attempt_id='00000000-0000-0000-0000-0000000000e5'" >/dev/null
echo "  OK -- valid invalidation accepted"

echo "--- [5/6] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
DROP TABLE IF EXISTS public.exam_attempt_results;
DROP INDEX IF EXISTS public.idx_exam_attempt_item_responses_target;
ALTER TABLE public.exam_attempt_item_responses DROP COLUMN IF EXISTS item_source, DROP COLUMN IF EXISTS target_index;
DROP INDEX IF EXISTS public.idx_assessment_components_version_section_key;
ALTER TABLE public.assessment_components DROP COLUMN IF EXISTS section_key, DROP COLUMN IF EXISTS sequence_order;
ALTER TABLE public.exam_versions DROP CONSTRAINT IF EXISTS exam_versions_exam_year_check, DROP CONSTRAINT IF EXISTS exam_versions_exam_session_check, DROP COLUMN IF EXISTS exam_session, DROP COLUMN IF EXISTS exam_year;
DROP INDEX IF EXISTS public.idx_exam_definitions_config_key;
ALTER TABLE public.exam_definitions DROP COLUMN IF EXISTS aggregation_group, DROP COLUMN IF EXISTS academic_subject_id, DROP COLUMN IF EXISTS config_key;
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "schema intact after ROLLBACK" "$(Q "SELECT to_regclass('public.exam_attempt_results') IS NOT NULL")" "t"

echo "--- [6/6] vertical configurations on the ephemeral DB ---"
if [ "${CERT_APPLY_VERTICALS:-0}" = "1" ]; then
  # Clean slate for the catalog run (the constraint probes above are not catalog data).
  Q "DELETE FROM exam_attempt_results; DELETE FROM exam_attempt_item_responses; DELETE FROM exam_attempts; DELETE FROM student_exam_profiles; DELETE FROM assessment_components; DELETE FROM exam_versions; DELETE FROM exam_definitions;" >/dev/null
  Q "INSERT INTO users (clerk_id, email, is_system) VALUES ('cert_editor', 'editor@cert.invalid', true), ('cert_reviewer', 'reviewer@cert.invalid', true)" >/dev/null
  export DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR"
  FP=$(node -e 'const c=require("crypto");const u=new URL(process.env.DATABASE_URL);console.log(c.createHash("sha256").update(u.hostname+"|"+u.pathname.slice(1)).digest("hex").slice(0,16))')
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-apply-verticals.ts --write) | tee "$WORKDIR/apply1.log"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-apply-verticals.ts --write) | tee "$WORKDIR/apply2.log"
  EXPECT "first application created 8 configurations" "$(grep -c '"noop":false' "$WORKDIR/apply1.log")" "8"
  EXPECT "second application is a no-op" "$(grep -c '"noop":true' "$WORKDIR/apply2.log")" "8"
  EXPECT "published versions" "$(Q "SELECT count(*) FROM exam_versions WHERE status='PUBLISHED'")" "8"
  EXPECT "families" "$(Q "SELECT string_agg(DISTINCT exam_family, ',' ORDER BY exam_family) FROM exam_definitions")" "AICE,CAMBRIDGE,IB,ICFES,PAA,PISA"
  EXPECT "published bank items" "$(Q "SELECT count(*) FROM approved_items WHERE status='PUBLISHED' AND reviewed_by IS NOT NULL AND reviewed_by <> created_by")" "$(Q "SELECT count(*) FROM approved_items")"
else
  echo "  SKIPPED (set CERT_APPLY_VERTICALS=1)"
fi

echo "=== TRACK_B_MIGRATION_CERT = PASS ==="
