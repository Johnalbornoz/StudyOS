#!/bin/bash
# Exam V2 -- migration certification for
# database/migrations/20261020_1000_track_b_exam_architecture_v2.sql against a
# REAL, EPHEMERAL, local-only Postgres (never Neon / DEV / Stage / Production).
#
# Proves:
#   1. baseline + full history before the migration applies; LEGACY rows
#      (definition, version, component, approved item, attempt, response) seeded;
#   2. the migration applies twice (idempotent); legacy rows untouched, every
#      new column on an existing table is nullable or has a safe default;
#   3. every new constraint enforces its rule;
#   4. the documented rollback applies inside a transaction (then rolled back);
#   5. optionally (CERT_APPLY_V2=1) the V2 verticals + structure catalogue apply
#      and a second application is a no-op.
#
# Usage: bash scripts/operations/track-b-exam-v2-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C
export PGOPTIONS="-c client_min_messages=warning"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261020_1000_track_b_exam_architecture_v2.sql"
WORKDIR="$(mktemp -d /tmp/studyus-exam-v2-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_exam_v2_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then echo "KEEP_CERT_DB=1 -- leaving $WORKDIR"; return; fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Exam V2 -- local migration certification ==="
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

echo "--- [1/5] baseline + history before $TARGET, legacy rows ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
S=00000000-0000-0000-0000-00000000000a
Q "INSERT INTO students (id, clerk_id, email) VALUES ('$S', 'cert:legacy', 'legacy@cert.invalid')" >/dev/null
Q "INSERT INTO users (id, clerk_id, email, is_system) VALUES ('00000000-0000-0000-0000-0000000000b1', 'cert_editor', 'e@cert.invalid', true)" >/dev/null
Q "INSERT INTO exam_definitions (id, name, exam_family, status) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Legacy exam', 'PAA', 'ACTIVE')" >/dev/null
Q "INSERT INTO exam_versions (id, exam_definition_id, version_label, status) VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'v1', 'PUBLISHED')" >/dev/null
Q "INSERT INTO assessment_components (id, exam_version_id, name, component_type) VALUES ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2', 'Legacy section', 'SECTION')" >/dev/null
Q "INSERT INTO student_exam_profiles (id, student_id, exam_definition_id) VALUES ('00000000-0000-0000-0000-0000000000e4', '$S', '00000000-0000-0000-0000-0000000000e1')" >/dev/null
Q "INSERT INTO exam_attempts (id, student_exam_profile_id, exam_version_id, frozen_configuration) VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', '{}')" >/dev/null
Q "INSERT INTO exam_attempt_item_responses (id, exam_attempt_id, assessment_component_id, item_snapshot, score, max_score) VALUES ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e3', '{}', 1, 1)" >/dev/null
echo "  OK"

echo "--- [2/5] applying $TARGET (twice: idempotent) ---"
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
for t in assessment_sources assessment_structure_nodes exam_instances exam_response_assessments exam_media_objects exam_submissions exam_submission_artifacts learning_concept_proposals learning_concept_proposal_requests exam_item_usage assessment_calibration_cases assessment_calibration_runs; do
  EXPECT "table $t" "$(Q "SELECT to_regclass('public.$t') IS NOT NULL")" "t"
done
EXPECT "every new column on an existing table is nullable or defaulted" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('exam_versions','assessment_components','approved_items','exam_attempt_item_responses','exam_attempt_results') AND column_name IN ('curriculum_version','first_assessment','last_assessment','syllabus_code','framework_version','source_ids','definition','max_marks','weighting_percent','calculator_policy','target_difficulty_index','content_origin','difficulty_index','semantic_fingerprint','template_fingerprint','reasoning_fingerprint','stimulus_fingerprint','normalized_response','grading_detail','review_status','scoring_strategy','strict_score','strict_readiness','review_required_count') AND is_nullable='NO' AND column_default IS NULL")" "0"
EXPECT "legacy response untouched" "$(Q "SELECT score||'/'||max_score||'/'||coalesce(review_status,'NULL') FROM exam_attempt_item_responses WHERE id='00000000-0000-0000-0000-0000000000e6'")" "1/1/NULL"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done

echo "--- [3/5] constraints ---"
REJECTS "unknown source confidence" "INSERT INTO assessment_sources (source_key, framework, title, confidence, license_status) VALUES ('x', 'IB', 't', 'SURE', 'PUBLIC')"
Q "INSERT INTO assessment_sources (source_key, framework, title, confidence, license_status) VALUES ('s1', 'IB', 't', 'HIGH', 'PUBLIC')" >/dev/null
REJECTS "duplicate source_key" "INSERT INTO assessment_sources (source_key, framework, title, confidence, license_status) VALUES ('s1', 'IB', 't', 'HIGH', 'PUBLIC')"
REJECTS "unknown node type" "INSERT INTO assessment_structure_nodes (family, node_key, node_type, label) VALUES ('IB', 'n0', 'UNIVERSE', 'x')"
Q "INSERT INTO assessment_structure_nodes (id, family, node_key, node_type, label) VALUES ('00000000-0000-0000-0000-0000000000f1', 'IB', 'ib.dp', 'PROGRAMME', 'DP')" >/dev/null
REJECTS "duplicate node key in a family" "INSERT INTO assessment_structure_nodes (family, node_key, node_type, label) VALUES ('IB', 'ib.dp', 'PROGRAMME', 'DP2')"
REJECTS "assessment window inverted" "INSERT INTO assessment_structure_nodes (family, node_key, node_type, label, first_assessment, last_assessment) VALUES ('IB', 'n1', 'SUBJECT', 'x', 2028, 2021)"
REJECTS "weighting above 100" "UPDATE assessment_components SET weighting_percent = 120 WHERE id='00000000-0000-0000-0000-0000000000e3'"
REJECTS "unknown calculator policy" "UPDATE assessment_components SET calculator_policy = 'ABACUS' WHERE id='00000000-0000-0000-0000-0000000000e3'"
EXPECT "content origin CHECK (OFFICIAL/LICENSED/GENERATED/FIXTURE)" "$(Q "SELECT pg_get_constraintdef(oid) LIKE '%FIXTURE%' AND pg_get_constraintdef(oid) NOT LIKE '%SCRAPED%' FROM pg_constraint WHERE conname='approved_items_content_origin_check'")" "t"
I="INSERT INTO exam_instances (student_id, exam_profile_id, exam_version_id, component_ids, mode, timing_mode, status"
V="'$S', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', ARRAY['00000000-0000-0000-0000-0000000000e3']::uuid[]"
REJECTS "unknown mode" "$I) VALUES ($V, 'EXAM', 'UNTIMED', 'DRAFT')"
REJECTS "a READY mock without a frozen form" "$I) VALUES ($V, 'MOCK', 'OFFICIAL_SIMULATION_TIMED', 'READY')"
REJECTS "no components" "$I) VALUES ('$S', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', ARRAY[]::uuid[], 'PRACTICE', 'UNTIMED', 'READY')"
REJECTS "DELETED without deleted_at" "$I) VALUES ($V, 'PRACTICE', 'UNTIMED', 'DELETED')"
Q "$I, form, form_frozen_at) VALUES ($V, 'MOCK', 'OFFICIAL_SIMULATION_TIMED', 'READY', '{}', now())" >/dev/null
Q "$I) VALUES ($V, 'PRACTICE', 'UNTIMED', 'READY')" >/dev/null
echo "  OK -- frozen mock + practice accepted"
INST=$(Q "SELECT id FROM exam_instances WHERE mode='MOCK' LIMIT 1")
REJECTS "media above 4 MB" "INSERT INTO exam_media_objects (owner_student_id, storage_backend, mime_type, size_bytes, sha256) VALUES ('$S', 'POSTGRES_DEV', 'image/png', 5000000, 'h')"
REJECTS "public storage backend" "INSERT INTO exam_media_objects (owner_student_id, storage_backend, mime_type, size_bytes, sha256) VALUES ('$S', 'PUBLIC_BUCKET', 'image/png', 10, 'h')"
MID=$(Q "INSERT INTO exam_media_objects (owner_student_id, storage_backend, bytes, mime_type, size_bytes, sha256, scan_status) VALUES ('$S', 'POSTGRES_DEV', '\x89504e47', 'image/png', 4, 'h', 'CLEAN') RETURNING id")
REJECTS "deleted media that keeps its bytes" "UPDATE exam_media_objects SET status='DELETED', deleted_at=now() WHERE id='$MID'"
Q "UPDATE exam_media_objects SET status='DELETED', deleted_at=now(), bytes=NULL, thumbnail=NULL WHERE id='$MID'" >/dev/null
echo "  OK -- purged deletion accepted"
Q "INSERT INTO exam_submissions (student_id, exam_instance_id, assessment_component_id, target_index) VALUES ('$S', '$INST', '00000000-0000-0000-0000-0000000000e3', 0)" >/dev/null
REJECTS "two submissions for one task" "INSERT INTO exam_submissions (student_id, exam_instance_id, assessment_component_id, target_index) VALUES ('$S', '$INST', '00000000-0000-0000-0000-0000000000e3', 0)"
REJECTS "artifact without payload" "INSERT INTO exam_submission_artifacts (submission_id, kind) SELECT id, 'IMAGE' FROM exam_submissions LIMIT 1"
REJECTS "assessment above its maximum" "INSERT INTO exam_response_assessments (response_id, role, criterion_scores, total, max_total) VALUES ('00000000-0000-0000-0000-0000000000e6', 'ASSESSOR_A', '[]', 9, 8)"
REJECTS "assessment with no target" "INSERT INTO exam_response_assessments (role, criterion_scores, total, max_total) VALUES ('ASSESSOR_A', '[]', 1, 8)"
REJECTS "unknown assessor role" "INSERT INTO exam_response_assessments (response_id, role, criterion_scores, total, max_total) VALUES ('00000000-0000-0000-0000-0000000000e6', 'ORACLE', '[]', 1, 8)"
REJECTS "unknown review status" "UPDATE exam_attempt_item_responses SET review_status='MAYBE' WHERE id='00000000-0000-0000-0000-0000000000e6'"
REJECTS "MAPPED_TO_EXISTING without a concept" "INSERT INTO learning_concept_proposals (proposal_key, proposed_title, status) VALUES ('p1', 't', 'MAPPED_TO_EXISTING')"
Q "INSERT INTO learning_concept_proposals (proposal_key, proposed_title) VALUES ('p1', 't')" >/dev/null
REJECTS "duplicate proposal key" "INSERT INTO learning_concept_proposals (proposal_key, proposed_title) VALUES ('p1', 't')"
REJECTS "calibration case expected above max" "INSERT INTO assessment_calibration_cases (case_key, framework, component_ref, origin, item_content, response, expected_marks, max_marks) VALUES ('c1', 'IB', 'p1', 'BENCHMARK_FIXTURE', '{}', '{}', 5, 4)"
REJECTS "unknown calibration origin" "INSERT INTO assessment_calibration_cases (case_key, framework, component_ref, origin, item_content, response, expected_marks, max_marks) VALUES ('c2', 'IB', 'p1', 'GUESS', '{}', '{}', 1, 4)"

echo "--- [4/5] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY); -- the governed runner's ledger (absent on a raw ephemeral DB)
$(sed -n '/^-- Rollback/,/^-- ----/p' "$MIGRATIONS_DIR/$TARGET" | sed -e '1d;$d' -e 's/^--   //' -e 's/^--     /  /')
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "schema intact after ROLLBACK" "$(Q "SELECT to_regclass('public.exam_instances') IS NOT NULL")" "t"

echo "--- [5/5] V2 verticals + structure catalogue on the ephemeral DB ---"
if [ "${CERT_APPLY_V2:-0}" = "1" ]; then
  Q "DELETE FROM learning_concept_proposals; DELETE FROM exam_response_assessments; DELETE FROM exam_submission_artifacts; DELETE FROM exam_submissions; DELETE FROM exam_media_objects; DELETE FROM exam_instances; DELETE FROM exam_attempt_item_responses; DELETE FROM exam_attempts; DELETE FROM student_exam_profiles; DELETE FROM assessment_components; DELETE FROM exam_versions; DELETE FROM exam_definitions; DELETE FROM assessment_structure_nodes; DELETE FROM assessment_sources;" >/dev/null
  Q "INSERT INTO users (clerk_id, email, is_system) VALUES ('cert_reviewer', 'r@cert.invalid', true)" >/dev/null
  export DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR"
  FP=$(node -e 'const c=require("crypto");const u=new URL(process.env.DATABASE_URL);console.log(c.createHash("sha256").update(u.hostname+"|"+u.pathname.slice(1)).digest("hex").slice(0,16))')
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-v2-apply.ts --write) | tee "$WORKDIR/apply1.log"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-v2-apply.ts --write) | tee "$WORKDIR/apply2.log"
  EXPECT "first application created 7 configurations" "$(grep -c '"noop":false' "$WORKDIR/apply1.log")" "7"
  EXPECT "second application is a no-op" "$(grep -c '"noop":true' "$WORKDIR/apply2.log")" "7"
  EXPECT "no unresolved bindings" "$(grep -o '"unresolvedBindings":\[\]' "$WORKDIR/apply2.log" | wc -l | tr -d ' ')" "1"
  EXPECT "component definitions stored (3+3+3+1+1+1+2)" "$(Q "SELECT count(*) FROM assessment_components WHERE definition IS NOT NULL")" "14"
  EXPECT "every V2 item has origin + fingerprints" "$(Q "SELECT count(*) FROM approved_items WHERE content_origin IS NULL OR template_fingerprint IS NULL")" "0"
  EXPECT "versions carry versioning + sources" "$(Q "SELECT count(*) FROM exam_versions WHERE first_assessment IS NOT NULL AND array_length(source_ids,1) >= 1")" "7"
else
  echo "  SKIPPED (set CERT_APPLY_V2=1)"
fi

echo "=== EXAM_V2_MIGRATION_CERT = PASS ==="
