#!/bin/bash
# B2-B1 -- Question Bank & B2 persistence schema on an EPHEMERAL local Postgres (never Neon, never hosted).
#
#   Phase A (from zero):        baseline + ledger -> governed runner applies EVERY migration -> db-status
#                               -> seeds (V2 catalogue, learning catalogue) -> schema invariants
#   Both phases also run the two read-only loaders (coverage, pools) against the real database.
#   Phase B (DEV-equivalent):   baseline + ledger -> governed runner applies the chain up to 20261109_1000
#                               -> seeds (fixtures, blueprints, concepts) -> legacy snapshot
#                               -> governed runner applies the eight 20261110_* migrations ON POPULATED DATA
#                               -> legacy snapshot unchanged -> schema invariants -> idempotent re-run
#                               -> documented rollback of the eight, in reverse -> re-apply -> 0 pending
#
# Usage: PG_BIN=/opt/homebrew/opt/postgresql@18/bin ./scripts/operations/b2b1-persistence-schema-cert.sh [workdir]

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
WORKDIR="${1:-$(mktemp -d /tmp/studyus-b2b1-cert.XXXXXX)}"
PORT="${PGPORT_CERT:-54393}"
PGDATA="$WORKDIR/pgdata"
FIRST_NEW="20261110_1000"
export LC_ALL=C

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA" "$WORKDIR/pre"
}
trap cleanup EXIT

mkdir -p "$WORKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$WORKDIR/postgres.log" -o "-p $PORT -h 127.0.0.1 -k ''" start >/dev/null
sleep 1
PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
TSX=("$REPO_ROOT/node_modules/.bin/tsx" --tsconfig "$REPO_ROOT/tsconfig.json")

TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$TEST_SQL"
SUM=$(shasum -a 256 "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" | awk '{print $1}')

new_db() {
  local db="$1"
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$db"
  "${PSQL[@]}" -c 'DROP SCHEMA public CASCADE;' "$db"
  if ! "${PSQL[@]}" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$db" | grep -q 1; then
    perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
    perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
  fi
  "${PSQL[@]}" -f "$TEST_SQL" "$db"
  "${PSQL[@]}" -f "$REPO_ROOT/database/ledger/0000_baseline_ledger.sql" "$db"
  "${PSQL[@]}" -c "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '$SUM')" "$db"
  "${PSQL[@]}" -c "INSERT INTO mastery_policies (version, minimum_understanding, minimum_independence, minimum_application, minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days) SELECT 1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14 WHERE NOT EXISTS (SELECT 1 FROM mastery_policies)" "$db"
  export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/$db"
}
seed() {
  local db="$1" fp
  fp=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(require('crypto').createHash('sha256').update(u.hostname+'|'+u.pathname.slice(1)).digest('hex').slice(0,16))")
  "${PSQL[@]}" -c "INSERT INTO users (clerk_id, email, is_system) VALUES ('system:cert-editor', NULL, true), ('system:cert-reviewer', NULL, true) ON CONFLICT (clerk_id) DO NOTHING" "$db"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$fp" "${TSX[@]}" scripts/operations/track-b-v2-apply.ts --write 2>&1 | tail -2 | cut -c1-240)
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$fp" "${TSX[@]}" scripts/operations/track-b-v2-learning-catalog.ts --write 2>&1 | tail -1 | cut -c1-240)
}
# Everything that existed before the new migrations and must come out of them untouched.
legacy_snapshot() {
  "${PSQL[@]}" -tA "$1" <<'SQL'
SELECT 'bank_items=' || count(*) || ' md5=' || md5(string_agg(id::text || provenance || coalesce(generation_request_id::text, '') || coalesce(current_version_id::text, ''), ',' ORDER BY id)) FROM question_bank_items;
SELECT 'provenance ' || provenance || '=' || count(*) FROM question_bank_items GROUP BY provenance ORDER BY provenance;
SELECT 'versions=' || count(*) || ' md5=' || md5(string_agg(id::text || coalesce(bank_lifecycle_status, '') || status || coalesce(content_hash, '') || md5(content::text) || coalesce(content_origin, ''), ',' ORDER BY id)) FROM approved_items;
SELECT 'reviews=' || count(*) FROM question_bank_reviews;
SELECT 'blueprints=' || count(*) || ' md5=' || md5(string_agg(id::text || exam_version_id::text || status, ',' ORDER BY id)) FROM assessment_blueprints;
SELECT 'blueprint_targets=' || count(*) FROM blueprint_objective_targets;
SELECT 'concepts=' || count(*) || ' md5=' || md5(string_agg(id::text || name || status, ',' ORDER BY id)) FROM canonical_concepts;
SELECT 'mappings=' || count(*) || ' md5=' || md5(string_agg(id::text || status, ',' ORDER BY id)) FROM objective_concept_mappings;
SELECT 'sources=' || count(*) || ' md5=' || md5(string_agg(id::text || source_key || license_status, ',' ORDER BY id)) FROM assessment_sources;
SELECT 'exam_instances=' || count(*) || ' attempts=' || (SELECT count(*) FROM exam_attempts) || ' simulation_attempts=' || (SELECT count(*) FROM simulation_attempts) FROM exam_instances;
SQL
}
new_schema_summary() {
  "${PSQL[@]}" -tA "$1" <<'SQL'
SELECT 'new_tables=' || count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('question_bank_content_rights', 'question_bank_content_sources', 'question_bank_assets', 'question_bank_item_assets', 'question_bank_stimuli', 'question_bank_stimulus_versions', 'question_bank_stimulus_parts', 'question_bank_item_stimulus', 'question_bank_item_concepts', 'question_bank_item_context_tags', 'question_bank_pool_memberships', 'question_bank_reviewer_qualifications', 'question_bank_stimulus_reviews', 'question_bank_originality_checks', 'assessment_blueprint_requirements', 'assessment_blueprint_requirement_sources', 'assessment_frozen_forms', 'assessment_frozen_form_positions');
SELECT 'new_columns=' || count(*) FROM information_schema.columns WHERE (table_name, column_name) IN (('assessment_sources', 'source_access'), ('question_bank_reviews', 'checklist_key'), ('question_bank_reviews', 'checklist_version'), ('question_bank_reviews', 'reviewer_qualification_id'), ('assessment_blueprints', 'purpose'), ('assessment_blueprints', 'form_number'), ('assessment_blueprints', 'revision'), ('assessment_blueprints', 'pool'), ('exam_instances', 'frozen_form_id'));
SELECT 'deferred_tables=' || count(*) FROM information_schema.tables WHERE table_name IN ('exam_answer_reveals', 'question_bank_item_curriculum_nodes');
SELECT 'rows_in_new_tables=' || ((SELECT count(*) FROM question_bank_content_rights) + (SELECT count(*) FROM question_bank_assets) + (SELECT count(*) FROM question_bank_stimuli) + (SELECT count(*) FROM question_bank_item_concepts) + (SELECT count(*) FROM question_bank_pool_memberships) + (SELECT count(*) FROM question_bank_reviewer_qualifications) + (SELECT count(*) FROM question_bank_originality_checks) + (SELECT count(*) FROM assessment_blueprint_requirements) + (SELECT count(*) FROM assessment_frozen_forms));
SELECT 'source_access ' || license_status || ' -> ' || source_access || '=' || count(*) FROM assessment_sources GROUP BY license_status, source_access ORDER BY 1;
SELECT 'legacy_blueprints_classified=' || count(*) FROM assessment_blueprints WHERE purpose IS NOT NULL;
SELECT 'instances_with_frozen_form=' || count(*) FROM exam_instances WHERE frozen_form_id IS NOT NULL;
SELECT 'not_valid_constraints=' || count(*) || ' (' || coalesce(string_agg(conname, ', ' ORDER BY conname), '') || ')' FROM pg_constraint WHERE NOT convalidated;
SELECT 'ledger_rows=' || count(*) || ' last=' || max(version) FROM schema_migrations;
SQL
}

echo "=== PHASE A: from zero"
new_db b2b1_from_zero
echo "--- [A1] governed runner: every migration"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -3)
echo "--- [A2] db-status"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -6)
echo "--- [A3] seeds on the new schema (V2 catalogue + fixtures, learning catalogue)"
seed b2b1_from_zero
echo "--- [A4] new schema summary"
new_schema_summary b2b1_from_zero
echo "--- [A5] schema invariants"
"${PSQL[@]}" -f "$REPO_ROOT/scripts/operations/b2b1/schema-invariants.sql" b2b1_from_zero | grep -v '^$'
legacy_snapshot b2b1_from_zero > "$WORKDIR/zero.after-invariants"
echo "--- [A6] seeds again (idempotent on the new schema)"
seed b2b1_from_zero >/dev/null
legacy_snapshot b2b1_from_zero | diff - "$WORKDIR/zero.after-invariants" >/dev/null && echo "seed_rerun_changed_nothing=YES"

echo "=== PHASE B: DEV-equivalent (populated before the new migrations)"
new_db b2b1_dev_equivalent
PRE="$WORKDIR/pre"
mkdir -p "$PRE/database/migrations"
for f in "$REPO_ROOT"/database/migrations/*.sql; do
  [[ "$(basename "$f")" < "$FIRST_NEW" ]] && cp "$f" "$PRE/database/migrations/"
done
echo "--- [B1] chain up to 20261109_1000 ($(ls "$PRE/database/migrations" | wc -l | tr -d ' ') files)"
(cd "$PRE" && "${TSX[@]}" "$REPO_ROOT/scripts/db-migrate.ts" 2>&1 | tail -2)
"${PSQL[@]}" -tAc "SELECT 'ledger_rows='||count(*)||' last='||max(version) FROM schema_migrations" b2b1_dev_equivalent
echo "--- [B2] seeds on the OLD schema"
seed b2b1_dev_equivalent
legacy_snapshot b2b1_dev_equivalent > "$WORKDIR/dev.before"
cat "$WORKDIR/dev.before"
echo "--- [B2b] the read-only loaders on a database WITHOUT the new schema"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/b2b1/loaders-cert.ts absent)
echo "--- [B3] governed runner: the eight new migrations, on populated data"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | grep -vE "^\s*$|OK -- recorded" | tail -11)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -4)
legacy_snapshot b2b1_dev_equivalent > "$WORKDIR/dev.after"
diff "$WORKDIR/dev.before" "$WORKDIR/dev.after" && echo "legacy_rows_unchanged=YES"
new_schema_summary b2b1_dev_equivalent
echo "--- [B4] schema invariants on the migrated, populated database"
"${PSQL[@]}" -f "$REPO_ROOT/scripts/operations/b2b1/schema-invariants.sql" b2b1_dev_equivalent | grep -v '^$'
legacy_snapshot b2b1_dev_equivalent | diff - "$WORKDIR/dev.after" >/dev/null && echo "invariants_left_no_trace=YES"
echo "--- [B4b] the read-only loaders on the new schema (content written and rolled back in one transaction)"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/b2b1/loaders-cert.ts present)
legacy_snapshot b2b1_dev_equivalent | diff - "$WORKDIR/dev.after" >/dev/null && echo "loaders_left_no_trace=YES"
echo "--- [B5] second db-migrate run (idempotent)"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
echo "--- [B6] seeds on the NEW schema (existing writers still work)"
seed b2b1_dev_equivalent >/dev/null
legacy_snapshot b2b1_dev_equivalent | diff - "$WORKDIR/dev.after" >/dev/null && echo "seed_rerun_changed_nothing=YES"
echo "--- [B7] documented rollback of the eight (reverse order), then re-apply"
"${PSQL[@]}" -f "$REPO_ROOT/scripts/operations/b2b1/rollback.sql" b2b1_dev_equivalent
"${PSQL[@]}" -tAc "SELECT 'ledger_after_rollback='||count(*)||' last='||max(version) FROM schema_migrations" b2b1_dev_equivalent
"${PSQL[@]}" -tAc "SELECT 'b2b1_objects_after_rollback='||((SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'question_bank_%' AND table_name IN ('question_bank_content_rights','question_bank_assets','question_bank_stimuli','question_bank_item_concepts','question_bank_pool_memberships','question_bank_reviewer_qualifications','question_bank_originality_checks')) + (SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'assessment_frozen%' OR table_name LIKE 'assessment_blueprint_requirement%') + (SELECT count(*) FROM information_schema.columns WHERE (table_name, column_name) IN (('assessment_sources','source_access'),('assessment_blueprints','purpose'),('exam_instances','frozen_form_id'),('question_bank_reviews','checklist_key'))) + (SELECT count(*) FROM pg_proc WHERE proname LIKE 'question\_bank\_%' AND proname IN ('question_bank_content_exists','question_bank_review_authority_guard','question_bank_item_provenance_guard')))" b2b1_dev_equivalent
"${PSQL[@]}" -tAc "SELECT 'legacy_unique_restored='||count(*) FROM pg_constraint WHERE conname='assessment_blueprints_exam_version_id_key'" b2b1_dev_equivalent
legacy_snapshot b2b1_dev_equivalent | diff - "$WORKDIR/dev.before" >/dev/null && echo "rollback_restored_legacy_state=YES"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -3)
echo "B2B1_PERSISTENCE_SCHEMA_CERT = DONE"
