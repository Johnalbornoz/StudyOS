#!/bin/bash
# Question Bank Factory V1 -- migration certification for
# database/migrations/20261026_1000_track_b_question_bank_factory.sql against a
# REAL, EPHEMERAL, local-only Postgres (never Neon / DEV / Stage / Production).
#
# Proves: the migration applies twice on top of the full history (idempotent);
# existing items become version 1 of their own bank item with no content change
# (PUBLISHED -> ACTIVE, APPROVED -> VALIDATED, DRAFT untouched); an attempt
# response keeps resolving its exact item; one backfill audit event per item;
# the lifecycle / status consistency CHECK, the immutability / transition /
# no-delete triggers and the uniqueness rules (one open request per cell, one
# running run) hold; generated content is always STUDYUS_GENERATED; the
# documented rollback applies in a transaction. Then (CERT_INTEGRATION=1,
# default) the end-to-end factory integration runs on the same ephemeral DB.
#
# Usage: bash scripts/operations/track-b-question-bank-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C
export PGOPTIONS="-c client_min_messages=warning"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261026_1000_track_b_question_bank_factory.sql"
WORKDIR="$(mktemp -d /tmp/studyus-qb-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_qb_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then echo "KEEP_CERT_DB=1 -- leaving $WORKDIR"; return; fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Question Bank Factory -- local migration certification ==="
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

echo "--- [1/5] full history before $TARGET, with legacy bank content and an attempt ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
Q "INSERT INTO users (id, clerk_id, email, is_system) VALUES ('00000000-0000-0000-0000-0000000000e1', 'cert_editor', 'e@cert.invalid', true), ('00000000-0000-0000-0000-0000000000e2', 'cert_reviewer', 'r@cert.invalid', true)" >/dev/null
Q "INSERT INTO academic_organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Cert Org')" >/dev/null
Q "INSERT INTO academic_programmes (id, organization_id, name, programme_type) VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Cert', 'ADMISSION_EXAM')" >/dev/null
Q "INSERT INTO academic_subjects (id, programme_id, name) VALUES ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', 'Cert Math')" >/dev/null
Q "INSERT INTO structure_versions (id, academic_subject_id, version_label, status) VALUES ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a3', 'v1', 'PUBLISHED')" >/dev/null
Q "INSERT INTO structure_nodes (id, structure_version_id, node_type, source_label, code, order_index) VALUES ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a4', 'EXAM_SECTION', 'S', 'sec.s', 0)" >/dev/null
Q "INSERT INTO learning_objectives (id, structure_node_id, code, description) VALUES ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a5', 'cert.alg', 'Algebra')" >/dev/null
Q "INSERT INTO exam_definitions (id, name, exam_family, status) VALUES ('00000000-0000-0000-0000-0000000000d1', 'Cert PAA', 'PAA', 'ACTIVE')" >/dev/null
Q "INSERT INTO exam_versions (id, exam_definition_id, version_label, status) VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'v1', 'PUBLISHED')" >/dev/null
Q "INSERT INTO assessment_components (id, exam_version_id, name, component_type) VALUES ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d2', 'Math', 'SECTION')" >/dev/null
Q "INSERT INTO assessment_blueprints (id, exam_version_id, status) VALUES ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d2', 'PUBLISHED')" >/dev/null
Q "INSERT INTO blueprint_objective_targets (blueprint_id, learning_objective_id, assessment_component_id, target_item_count) VALUES ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000d3', 1)" >/dev/null
ITEM='{"key":"cert.alg.1","contentStatus":"DEV_CERT_FIXTURE","contentOrigin":"FIXTURE","language":"es","type":"multiple_choice","answerFormat":"single_choice","question":"Si x + 1 = 3, ¿cuánto vale x?","options":[{"id":"A","text":"2"},{"id":"B","text":"3"}],"correctAnswer":"A","explanation":"x = 2","difficulty":2}'
Q "INSERT INTO approved_items (id, learning_objective_id, question_type, content, created_by, status, content_origin) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a6', 'multiple_choice', '$ITEM', '00000000-0000-0000-0000-0000000000e1', 'PUBLISHED', 'FIXTURE'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a6', 'multiple_choice', jsonb_set('$ITEM'::jsonb, '{key}', '\"cert.alg.2\"'), '00000000-0000-0000-0000-0000000000e1', 'APPROVED', 'FIXTURE'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a6', 'multiple_choice', jsonb_set('$ITEM'::jsonb, '{key}', '\"cert.alg.3\"'), '00000000-0000-0000-0000-0000000000e1', 'DRAFT', NULL)" >/dev/null
Q "INSERT INTO students (id, clerk_id, email) VALUES ('00000000-0000-0000-0000-0000000000f1', 'cert:qb', 'qb@cert.invalid')" >/dev/null
Q "INSERT INTO student_exam_profiles (id, student_id, exam_definition_id, exam_version_id) VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2')" >/dev/null
Q "INSERT INTO exam_attempts (id, student_exam_profile_id, exam_version_id, frozen_configuration, status) VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '{}', 'COMPLETED')" >/dev/null
Q "INSERT INTO exam_attempt_item_responses (id, exam_attempt_id, assessment_component_id, approved_item_id, item_snapshot, raw_response, score, max_score) VALUES ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', '$ITEM', '\"A\"', 1, 1)" >/dev/null
HASH_BEFORE=$(Q "SELECT md5(string_agg(id::text || content::text || status, '|' ORDER BY id)) FROM approved_items")

echo "--- [2/5] $TARGET applied twice (idempotent) ---"
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
EXPECT "every legacy item has a bank identity (bank id = row id)" "$(Q "SELECT count(*) FROM approved_items WHERE bank_item_id = id AND version_number = 1")" "3"
EXPECT "no duplicate identities after two applications" "$(Q "SELECT count(*) FROM question_bank_items")" "3"
EXPECT "content / status untouched (no content loss, no rewrite)" "$(Q "SELECT md5(string_agg(id::text || content::text || status, '|' ORDER BY id)) FROM approved_items")" "$HASH_BEFORE"
EXPECT "PUBLISHED -> ACTIVE, APPROVED -> VALIDATED, DRAFT unmanaged" "$(Q "SELECT string_agg(coalesce(bank_lifecycle_status,'NULL'), ',' ORDER BY id) FROM approved_items")" "ACTIVE,VALIDATED,NULL"
EXPECT "fixture provenance kept" "$(Q "SELECT string_agg(provenance, ',' ORDER BY id) FROM question_bank_items")" "FIXTURE,FIXTURE,FIXTURE"
EXPECT "origin version recorded from the blueprint" "$(Q "SELECT count(*) FROM question_bank_items WHERE exam_version_id = '00000000-0000-0000-0000-0000000000d2'")" "3"
EXPECT "one backfill audit event per managed item (not two)" "$(Q "SELECT count(*) FROM question_bank_lifecycle_events WHERE reason = 'MIGRATION_BACKFILL'")" "2"
EXPECT "uncalibrated by default (no fabricated calibration)" "$(Q "SELECT count(*) FROM approved_items WHERE calibration_confidence = 'INSUFFICIENT_DATA' AND calibrated_difficulty IS NULL")" "3"
EXPECT "the attempt still resolves its exact item" "$(Q "SELECT r.approved_item_id = ai.id AND r.item_snapshot->>'question' = ai.content->>'question' FROM exam_attempt_item_responses r JOIN approved_items ai ON ai.id = r.approved_item_id WHERE r.id = '00000000-0000-0000-0000-0000000000f4'")" "t"

echo "--- [3/5] constraints and triggers ---"
REJECTS "content rewrite of a bank version" "UPDATE approved_items SET content = content || '{\"explanation\":\"x\"}' WHERE id = '00000000-0000-0000-0000-0000000000c1'"
REJECTS "deleting a bank version" "DELETE FROM approved_items WHERE id = '00000000-0000-0000-0000-0000000000c2'"
REJECTS "invalid transition ACTIVE -> DRAFT_AI" "UPDATE approved_items SET bank_lifecycle_status = 'DRAFT_AI', status = 'DRAFT' WHERE id = '00000000-0000-0000-0000-0000000000c1'"
REJECTS "lifecycle / delivery status disagreement (ACTIVE but not PUBLISHED)" "UPDATE approved_items SET status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-0000000000c1'"
REJECTS "RETIRED -> ACTIVE (no resurrection)" "BEGIN; UPDATE approved_items SET bank_lifecycle_status='RETIRED', status='RETIRED' WHERE id='00000000-0000-0000-0000-0000000000c2'; UPDATE approved_items SET bank_lifecycle_status='ACTIVE', status='PUBLISHED' WHERE id='00000000-0000-0000-0000-0000000000c2'; COMMIT;"
Q "UPDATE approved_items SET bank_lifecycle_status = 'PILOT', status = 'PUBLISHED' WHERE id = '00000000-0000-0000-0000-0000000000c2'" >/dev/null
EXPECT "VALIDATED -> PILOT allowed" "$(Q "SELECT bank_lifecycle_status FROM approved_items WHERE id = '00000000-0000-0000-0000-0000000000c2'")" "PILOT"
Q "INSERT INTO question_bank_generation_requests (id, exam_version_id, blueprint_id, cell_key, learning_objective_id, assessment_component_id, requested_count, priority, reason, language) VALUES ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d4', 'cell.a', '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000d3', 2, 'P1', 'FORM_BLOCKER', 'es')" >/dev/null
REJECTS "second open request for the same cell" "INSERT INTO question_bank_generation_requests (exam_version_id, blueprint_id, cell_key, learning_objective_id, assessment_component_id, requested_count, priority, reason, language) VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d4', 'cell.a', '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000d3', 1, 'P1', 'FORM_BLOCKER', 'es')"
REJECTS "unbounded batch (requested_count > 10)" "INSERT INTO question_bank_generation_requests (exam_version_id, blueprint_id, cell_key, learning_objective_id, assessment_component_id, requested_count, priority, reason, language) VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d4', 'cell.b', '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000d3', 500, 'P1', 'FORM_BLOCKER', 'es')"
REJECTS "infinite retry (attempt_count > max_attempts)" "UPDATE question_bank_generation_requests SET attempt_count = 9 WHERE id = '00000000-0000-0000-0000-00000000aa01'"
REJECTS "generated item that is not STUDYUS_GENERATED" "INSERT INTO question_bank_items (item_key, learning_objective_id, provenance, language, generation_request_id) VALUES ('gen.x', '00000000-0000-0000-0000-0000000000a6', 'OFFICIAL', 'es', '00000000-0000-0000-0000-00000000aa01')"
Q "INSERT INTO question_bank_factory_runs (trigger, status) VALUES ('CLI', 'RUNNING')" >/dev/null
REJECTS "two RUNNING factory runs" "INSERT INTO question_bank_factory_runs (trigger, status) VALUES ('CLI', 'RUNNING')"
REJECTS "ADMIN audit event without an admin user" "INSERT INTO question_bank_lifecycle_events (bank_item_id, approved_item_id, to_status, reason, actor_kind) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'RETIRED', 'x', 'ADMIN')"
Q "DELETE FROM question_bank_factory_runs; DELETE FROM question_bank_generation_requests;" >/dev/null

echo "--- [4/5] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY);
$(sed -n '/^-- Rollback/,/^-- ----/p' "$MIGRATIONS_DIR/$TARGET" | sed -e '1d;$d' -e 's/^--   //')
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "tables intact after ROLLBACK" "$(Q "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('question_bank_items','question_bank_lifecycle_events','question_bank_cell_targets','question_bank_generation_requests','question_bank_factory_runs','question_bank_health_snapshots','question_bank_item_stats')")" "7"

echo "--- [4b] later migrations on top (the code under test reads their columns) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  applied $(basename "$f")"
done

echo "--- [5/5] factory integration on the ephemeral DB (fake AI, no provider) ---"
if [ "${CERT_INTEGRATION:-1}" = "1" ]; then
  Q "DELETE FROM exam_attempt_item_responses; DELETE FROM exam_attempts; DELETE FROM student_exam_profiles; DELETE FROM students;" >/dev/null
  Q "ALTER TABLE approved_items DISABLE TRIGGER trg_question_bank_version_no_delete; DELETE FROM question_bank_lifecycle_events; UPDATE question_bank_items SET current_version_id = NULL; DELETE FROM approved_items; DELETE FROM question_bank_items; ALTER TABLE approved_items ENABLE TRIGGER trg_question_bank_version_no_delete;" >/dev/null
  Q "DELETE FROM blueprint_objective_targets; DELETE FROM assessment_blueprints; DELETE FROM assessment_components; DELETE FROM exam_versions; DELETE FROM exam_definitions;" >/dev/null
  export DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR"
  FP=$(node -e 'const c=require("crypto");const u=new URL(process.env.DATABASE_URL);console.log(c.createHash("sha256").update(u.hostname+"|"+u.pathname.slice(1)).digest("hex").slice(0,16))')
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" NODE_ENV=production npx tsx scripts/operations/track-b-question-bank-integration.ts) | tee "$WORKDIR/integration.log" | grep -v '^\[' || true
  if ! grep -q '"failed":0' "$WORKDIR/integration.log"; then echo "  FAIL -- integration checks failed"; exit 1; fi
  echo "  OK -- integration: $(grep -o '"checks":[0-9]*' "$WORKDIR/integration.log") checks, 0 failed"
else
  echo "  SKIPPED (CERT_INTEGRATION=0)"
fi

echo "--- [6/6] shadow readiness over EVERY governed configuration (fresh ephemeral DB) ---"
if [ "${CERT_SHADOW:-1}" = "1" ]; then
  SHADOW_DB="studyus_qb_shadow"
  "$PG_BIN/createdb" -h "$SOCKDIR" -U postgres "$SHADOW_DB"
  SP="$PG_BIN/psql -h $SOCKDIR -U postgres -v ON_ERROR_STOP=1 -q $SHADOW_DB"
  $SP -c 'DROP SCHEMA public CASCADE;' >/dev/null
  $SP -f "$TEST_SQL" >/dev/null
  for f in "$MIGRATIONS_DIR"/*.sql; do $SP -f "$f" >/dev/null; done
  $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "INSERT INTO users (clerk_id, email, is_system) VALUES ('cert_editor', 'e@cert.invalid', true), ('cert_reviewer', 'r@cert.invalid', true)" "$SHADOW_DB" >/dev/null
  export DATABASE_URL="postgresql://postgres@localhost/$SHADOW_DB?host=$SOCKDIR"
  FP=$(node -e 'const c=require("crypto");const u=new URL(process.env.DATABASE_URL);console.log(c.createHash("sha256").update(u.hostname+"|"+u.pathname.slice(1)).digest("hex").slice(0,16))')
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-v2-apply.ts --write) > "$WORKDIR/shadow-apply.log"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-question-bank.ts health --write) > "$WORKDIR/shadow-health.log"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-question-bank.ts shadow) > "$WORKDIR/shadow.json"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-question-bank.ts report) > "$WORKDIR/report.json"
  EXPECT "every item registered in the bank" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAq -c "SELECT count(*) FROM approved_items WHERE bank_item_id IS NULL" "$SHADOW_DB")" "0"
  EXPECT "one snapshot per published version" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAq -c "SELECT count(DISTINCT exam_version_id) = (SELECT count(*) FROM exam_versions v JOIN assessment_blueprints b ON b.exam_version_id = v.id WHERE v.status = 'PUBLISHED') FROM question_bank_health_snapshots" "$SHADOW_DB")" "t"
  DOWN=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.shadow.DOWNGRADE||0)' "$WORKDIR/shadow.json")
  UP=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.shadow.UPGRADE||0)' "$WORKDIR/shadow.json")
  echo "  shadow comparison: $(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify(s.shadow))' "$WORKDIR/shadow.json")"
  node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for (const d of s.differences.slice(0,40)) console.log("    diff", JSON.stringify(d))' "$WORKDIR/shadow.json"
  cp "$WORKDIR/shadow.json" "${CERT_OUT_DIR:-$WORKDIR}/qb-shadow.json" 2>/dev/null || true
  cp "$WORKDIR/report.json" "${CERT_OUT_DIR:-$WORKDIR}/qb-report.json" 2>/dev/null || true
  cp "$WORKDIR/shadow-health.log" "${CERT_OUT_DIR:-$WORKDIR}/qb-health.jsonl" 2>/dev/null || true
  EXPECT "PAA Full Mock (bank-calculated)" "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.PAA_FULL_MOCK_READY)' "$WORKDIR/report.json")" "NO"
  echo "  shadow: $UP upgrade(s), $DOWN downgrade(s) vs the persisted catalogue readiness"
else
  echo "  SKIPPED (CERT_SHADOW=0)"
fi

echo "--- [7] Question Bank V2 refinement (20261028_1000) on the fully configured DB ---"
if [ "${CERT_SHADOW:-1}" = "1" ] && [ "${CERT_QBV2:-1}" = "1" ]; then
  V2="20261028_1000_question_bank_quality_exposure_demand.sql"
  $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$V2" "$SHADOW_DB" >/dev/null
  EXPECT "20261028_1000 idempotent (re-applied)" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAq -c "SELECT count(*) FROM approved_items WHERE usage_eligibility IS NULL AND bank_item_id IS NOT NULL" "$SHADOW_DB")" "0"
  REJ() { if $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$2" "$SHADOW_DB" >/dev/null 2>&1; then echo "  FAIL -- accepted: $1"; exit 1; fi; echo "  OK -- rejected: $1"; }
  REJ "mock usage without mock-ready alignment" "UPDATE approved_items SET exam_alignment = 'EXAM_STYLE' WHERE id = (SELECT id FROM approved_items WHERE 'REDUCED_MOCK' = ANY(usage_eligibility) LIMIT 1)"
  REJ "OFFICIAL alignment on fixture content" "UPDATE approved_items SET exam_alignment = 'OFFICIAL' WHERE id = (SELECT ai.id FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.provenance = 'FIXTURE' LIMIT 1)"
  REJ "unknown usage type" "UPDATE approved_items SET usage_eligibility = ARRAY['EVERYTHING'] WHERE id = (SELECT id FROM approved_items LIMIT 1)"
  REJ "a rejection without notes" "INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) SELECT ai.id, ai.bank_item_id, 'REJECTED', (SELECT id FROM users LIMIT 1) FROM approved_items ai LIMIT 1"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" NODE_ENV=production npx tsx scripts/operations/qb-v2-integration.ts) | tee "$WORKDIR/qbv2.log" | grep -v '^\[' || true
  cp "$WORKDIR/qbv2.log" "${CERT_OUT_DIR:-$WORKDIR}/qb-v2-integration.log" 2>/dev/null || true
  if ! grep -q '"failed":0' "$WORKDIR/qbv2.log"; then echo "  FAIL -- V2 integration checks failed"; exit 1; fi
  echo "  OK -- V2 integration: $(grep -o '"checks":[0-9]*' "$WORKDIR/qbv2.log") checks, 0 failed"
else
  echo "  SKIPPED"
fi

echo "=== QUESTION_BANK_MIGRATION_CERT = PASS ==="
