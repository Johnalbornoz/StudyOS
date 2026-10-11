#!/bin/bash
# CURR-PAA -- certified PAA curriculum hierarchy + item traceability on an EPHEMERAL local Postgres (never hosted).
#
#   baseline + ledger -> governed runner up to 20261110_1700 -> seeds (the DEV-equivalent state before this phase)
#   -> snapshot of everything that must not change
#   -> governed runner applies 20261111_1000 (item version -> curriculum node)
#   -> hierarchy: dry run (no change) -> --write (4 Sections / 17 Domains / 84 Topics) -> second --write (creates nothing)
#   -> snapshot unchanged (objectives not moved, other frameworks' nodes untouched) -> traceability invariants
#   -> seeds again on the new state (no change)
#   -> governed objective re-parenting: 19 objectives move under their Domain, ids unchanged, cohesion stays
#   -> seeds again: the bootstrap finds the moved objectives and creates no twin
#   -> rollback of 20261111_1000 (documented), then re-apply
#
# Usage: PG_BIN=/opt/homebrew/opt/postgresql@18/bin ./scripts/operations/curr-paa-hierarchy-cert.sh [workdir]

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
WORKDIR="${1:-$(mktemp -d /tmp/studyus-curr-paa-cert.XXXXXX)}"
PORT="${PGPORT_CERT:-54395}"
PGDATA="$WORKDIR/pgdata"
DB=curr_paa_cert
MIGRATION="20261111_1000"
export LC_ALL=C

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA" "$WORKDIR/pre"
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

seed() {
  "${PSQL[@]}" -c "INSERT INTO users (clerk_id, email, is_system) VALUES ('system:cert-editor', NULL, true), ('system:cert-reviewer', NULL, true) ON CONFLICT (clerk_id) DO NOTHING" "$DB"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-apply.ts --write 2>&1 | tail -1 | cut -c1-160)
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-learning-catalog.ts --write 2>&1 | tail -1 | cut -c1-160)
}
# Everything outside the new hierarchy. `$1` = also hash where each objective hangs (off once objectives are moved on purpose).
snapshot() {
  "${PSQL[@]}" -tA -v placement="$1" "$DB" <<'SQL'
SELECT 'objectives=' || count(*) || ' md5=' || md5(string_agg(id::text || coalesce(code, '') || description || status || CASE WHEN :placement = 1 THEN structure_node_id::text ELSE '' END, ',' ORDER BY id)) FROM learning_objectives;
SELECT 'nodes_outside_hierarchy=' || count(*) || ' md5=' || md5(string_agg(n.id::text || n.node_type || coalesce(n.code, '') || n.source_label || coalesce(n.parent_id::text, '') || n.status, ',' ORDER BY n.id)) FROM structure_nodes n WHERE n.code IS NULL OR n.code NOT LIKE 'paa.%';
SELECT 'nodes_by_framework ' || coalesce(sv.source_locator, 'none') || '=' || count(*) FROM structure_nodes n JOIN structure_versions sv ON sv.id = n.structure_version_id WHERE sv.source_locator NOT LIKE '%:v2.paa' GROUP BY sv.source_locator ORDER BY 1;
SELECT 'structure_versions=' || count(*) || ' md5=' || md5(string_agg(id::text || status || version_label, ',' ORDER BY id)) FROM structure_versions;
SELECT 'mappings=' || count(*) || ' md5=' || md5(string_agg(id::text || learning_objective_id::text || canonical_concept_id::text || status, ',' ORDER BY id)) FROM objective_concept_mappings;
SELECT 'concepts=' || count(*) || ' md5=' || md5(string_agg(id::text || name || status, ',' ORDER BY id)) FROM canonical_concepts;
SELECT 'items=' || count(*) || ' versions=' || (SELECT count(*) FROM approved_items) || ' md5=' || md5(string_agg(id::text || learning_objective_id::text || provenance, ',' ORDER BY id)) FROM question_bank_items;
SELECT 'blueprint_targets=' || count(*) || ' md5=' || md5(string_agg(id::text || learning_objective_id::text, ',' ORDER BY id)) FROM blueprint_objective_targets;
SELECT 'blueprints=' || count(*) FROM assessment_blueprints;
SQL
}
hierarchy() { (cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/curr-paa-hierarchy.ts "$@" | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log([o.mode,'created='+JSON.stringify(o.created),'existing='+JSON.stringify(o.existing),'state='+o.state.sections+'/'+o.state.domains+'/'+o.state.topics,'authority='+JSON.stringify(o.state.topicsByAuthority),'objectives='+JSON.stringify(o.objectivePlacements),'withoutDomain='+o.objectivesWithoutDomain.join('+'),'nodes='+o.structureNodes.before+'->'+o.structureNodes.after,'problems='+o.problems.length].join('  '))"); }

PRE="$WORKDIR/pre"
mkdir -p "$PRE/database/migrations"
for f in "$REPO_ROOT"/database/migrations/*.sql; do
  [[ "$(basename "$f")" < "$MIGRATION" ]] && cp "$f" "$PRE/database/migrations/"
done
echo "--- [1] chain up to 20261110_1700 ($(ls "$PRE/database/migrations" | wc -l | tr -d ' ') files) + seeds: the state before this phase"
(cd "$PRE" && "${TSX[@]}" "$REPO_ROOT/scripts/db-migrate.ts" 2>&1 | tail -1)
seed
snapshot 1 > "$WORKDIR/before"
snapshot 0 > "$WORKDIR/before0"
grep -v "^nodes_by_framework" "$WORKDIR/before"; echo "frameworks_outside_v2.paa=$(grep -c "^nodes_by_framework" "$WORKDIR/before")"
echo "--- [2] governed runner: 20261111_1000 on populated data"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -1)
echo "--- [3] hierarchy: dry run, write, write again"
hierarchy
"${PSQL[@]}" -tAc "SELECT 'paa_nodes_after_dry_run=' || count(*) FROM structure_nodes WHERE code LIKE 'paa.sec.%' OR code LIKE 'paa.dom.%' OR code LIKE 'paa.topic.%'" "$DB"
hierarchy --write
hierarchy --write
"${PSQL[@]}" -tA "$DB" <<'SQL'
SELECT 'hierarchy ' || s.source_label || ': domains=' || count(DISTINCT d.id) || ' topics=' || count(t.id) || ' version=' || sv.status FROM structure_nodes s JOIN structure_versions sv ON sv.id = s.structure_version_id JOIN structure_nodes d ON d.parent_id = s.id AND d.node_type = 'DOMAIN' LEFT JOIN structure_nodes t ON t.parent_id = d.id AND t.node_type = 'TOPIC' WHERE s.node_type = 'SECTION' GROUP BY s.source_label, s.order_index, sv.status ORDER BY s.order_index;
SELECT 'topics_without_domain=' || count(*) FROM structure_nodes t WHERE t.code LIKE 'paa.topic.%' AND NOT EXISTS (SELECT 1 FROM structure_nodes d WHERE d.id = t.parent_id AND d.node_type = 'DOMAIN');
SELECT 'objectives_under_hierarchy_nodes=' || count(*) FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE n.node_type IN ('SECTION', 'DOMAIN', 'TOPIC') AND n.code LIKE 'paa.%';
SELECT 'item_links=' || count(*) FROM question_bank_item_curriculum_nodes;
SQL
snapshot 1 | diff - "$WORKDIR/before" && echo "everything_outside_the_hierarchy_unchanged=YES"
echo "--- [4] traceability invariants"
"${PSQL[@]}" -f "$REPO_ROOT/scripts/operations/curr-paa/traceability-invariants.sql" "$DB" | grep -v '^$'
snapshot 1 | diff - "$WORKDIR/before" >/dev/null && echo "invariants_left_no_trace=YES"
echo "--- [5] traceability reader + condition 5 through the application (rolled back)"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/curr-paa/traceability-cert.ts)
echo "--- [6] seeds on the new state"
seed >/dev/null
snapshot 1 | diff - "$WORKDIR/before" >/dev/null && echo "seed_rerun_changed_nothing=YES"
echo "--- [7] governed objective re-parenting (dry run, then write)"
hierarchy --reparent-objectives
snapshot 1 | diff - "$WORKDIR/before" >/dev/null && echo "dry_run_moved_nothing=YES"
hierarchy --write --reparent-objectives
hierarchy --write --reparent-objectives
snapshot 0 > "$WORKDIR/after-reparent"
"${PSQL[@]}" -tA "$DB" <<'SQL'
SELECT 'objectives_under_domains=' || count(*) || ' distinct_domains=' || count(DISTINCT n.id) FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE n.node_type = 'DOMAIN' AND n.code LIKE 'paa.dom.%';
SELECT 'cohesion_still_under=' || string_agg(DISTINCT n.node_type, ',') FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id JOIN structure_versions sv ON sv.id = n.structure_version_id WHERE lo.code = 'paa.red.cohesion' AND sv.source_locator LIKE '%:v2.paa';
SELECT 'other_paa_configs_untouched=' || count(*) FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id JOIN structure_versions sv ON sv.id = n.structure_version_id WHERE lo.code LIKE 'paa.%' AND sv.source_locator NOT LIKE '%:v2.paa' AND n.node_type <> 'EXAM_SECTION';
SQL
# ids, codes, descriptions, mappings, items and blueprint targets are what they were; only where 19 objectives hang differs
diff "$WORKDIR/before0" "$WORKDIR/after-reparent" && echo "only_objective_placement_changed=YES"
echo "--- [8] seeds after re-parenting: the bootstrap finds the moved objectives (no twin)"
seed >/dev/null
diff <(snapshot 0) "$WORKDIR/after-reparent" && echo "seed_after_reparent_changed_nothing=YES"
"${PSQL[@]}" -tAc "SELECT 'duplicate_objective_codes_per_version=' || count(*) FROM (SELECT 1 FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE lo.code IS NOT NULL GROUP BY n.structure_version_id, lo.code HAVING count(*) > 1) x" "$DB"
echo "--- [9] rollback of 20261111_1000 (documented), then re-apply"
"${PSQL[@]}" -c "DROP TRIGGER trg_structure_node_traced_guard ON public.structure_nodes; DROP FUNCTION public.structure_node_traced_guard(); DROP TABLE public.question_bank_item_curriculum_nodes; DROP FUNCTION public.question_bank_item_curriculum_node_guard(); DELETE FROM schema_migrations WHERE version = '20261111_1000';" "$DB"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -1)
echo "CURR_PAA_HIERARCHY_CERT = DONE"
