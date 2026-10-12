#!/bin/bash
# Curriculum convergence -- certification on an EPHEMERAL local Postgres (never hosted).
#
#   baseline + ledger -> governed runner up to 20261120_1200 (the ledger Preview holds) -> exam catalogue seeds
#   -> governed runner applies 20261122_1000 (Learn curriculum provenance) on populated data
#   -> convergence: dry run (no change) -> --write -> --write again (creates nothing: idempotent)
#   -> integrity gates -> runtime scenarios with the real services (PAA and IB / Cambridge):
#        fail-closed resolution (A selected without mappings, B larger: B never selected),
#        Learn provenance recorded / verified / immutable, grouping without a false "Sin clasificar"
#   -> rollback of 20261122_1000 (documented), then re-apply
#
# Usage: PG_BIN=/opt/homebrew/opt/postgresql@18/bin ./scripts/operations/curriculum-convergence-cert.sh [workdir]

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
WORKDIR="${1:-$(mktemp -d /tmp/studyus-curriculum-convergence-cert.XXXXXX)}"
PORT="${PGPORT_CERT:-54396}"
PGDATA="$WORKDIR/pgdata"
DB=curriculum_convergence_cert
MIGRATION="20261122_1000"
export LC_ALL=C
unset ANTHROPIC_API_KEY OPENAI_API_KEY

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

convergence() { (cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/curriculum-convergence.ts "$@" | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log([o.mode,'paa='+JSON.stringify(o.paa.created??o.paa),'aice_created='+o.aice.created,'aice_existing='+o.aice.existing,'subjects_mapped='+o.canonicalSubjects.mapped.length,'unmapped='+o.canonicalSubjects.unmappedBefore+'->'+o.canonicalSubjects.unmappedAfter,'zero_mapping_versions='+o.structureVersions.zeroMappingBefore+'->'+o.structureVersions.zeroMappingAfter,'paa_types='+JSON.stringify(o.paaNodeTypes.after),'broken='+o.gates.brokenBefore+'->'+o.gates.brokenAfter,'problems='+o.problems.length].join('  '))"); }
snapshot() {
  "${PSQL[@]}" -tA "$DB" <<'SQL'
SELECT 'nodes=' || count(*) || ' md5=' || md5(string_agg(id::text || node_type || coalesce(code, '') || source_label || coalesce(parent_id::text, '') || status, ',' ORDER BY id)) FROM structure_nodes;
SELECT 'objectives=' || count(*) || ' md5=' || md5(string_agg(id::text || structure_node_id::text || status, ',' ORDER BY id)) FROM learning_objectives;
SELECT 'mappings=' || count(*) || ' md5=' || md5(string_agg(id::text || learning_objective_id::text || canonical_concept_id::text || status, ',' ORDER BY id)) FROM objective_concept_mappings;
SELECT 'academic_subjects=' || count(*) || ' md5=' || md5(string_agg(id::text || coalesce(canonical_subject_id::text, ''), ',' ORDER BY id)) FROM academic_subjects;
SELECT 'canonical_concepts=' || count(*) FROM canonical_concepts;
SQL
}

PRE="$WORKDIR/pre"
mkdir -p "$PRE/database/migrations"
for f in "$REPO_ROOT"/database/migrations/*.sql; do
  [[ "$(basename "$f")" < "$MIGRATION" ]] && cp "$f" "$PRE/database/migrations/"
done
echo "--- [1] chain up to 20261120_1200 ($(ls "$PRE/database/migrations" | wc -l | tr -d ' ') files, the Preview ledger) + exam catalogue seeds"
(cd "$PRE" && "${TSX[@]}" "$REPO_ROOT/scripts/db-migrate.ts" 2>&1 | tail -1)
"${PSQL[@]}" -c "INSERT INTO users (clerk_id, email, is_system) VALUES ('system:cert-editor', NULL, true), ('system:cert-reviewer', NULL, true) ON CONFLICT (clerk_id) DO NOTHING" "$DB"
(cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-apply.ts --write 2>&1 | tail -1 | cut -c1-160)
(cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-learning-catalog.ts --write 2>&1 | tail -1 | cut -c1-160)
echo "--- [2] governed runner: $MIGRATION on populated data"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -1)
snapshot > "$WORKDIR/before"
cat "$WORKDIR/before"
echo "--- [3] convergence: dry run, write, write again"
convergence
snapshot | diff - "$WORKDIR/before" >/dev/null && echo "dry_run_changed_nothing=YES"
convergence --write --out "$WORKDIR/out"
snapshot > "$WORKDIR/after"
cat "$WORKDIR/after"
convergence --write
snapshot | diff - "$WORKDIR/after" >/dev/null && echo "second_write_changed_nothing=YES (idempotent)"
"${PSQL[@]}" -tA "$DB" <<'SQL'
SELECT 'orphan_nodes=' || count(*) FROM structure_nodes c WHERE c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM structure_nodes p WHERE p.id = c.parent_id AND p.structure_version_id = c.structure_version_id);
SELECT 'duplicate_node_codes=' || count(*) FROM (SELECT 1 FROM structure_nodes WHERE code IS NOT NULL GROUP BY structure_version_id, code HAVING count(*) > 1) d;
SELECT 'objectives_under_new_nodes=' || count(*) FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE n.node_type IN ('SECTION', 'DOMAIN', 'TOPIC') AND (n.code LIKE 'paa.%' OR n.code LIKE 'aice.%');
SELECT 'cross_subject_canonical_writes=' || count(*) FROM academic_subjects a WHERE a.canonical_subject_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM structure_versions sv JOIN structure_nodes n ON n.structure_version_id = sv.id JOIN learning_objectives lo ON lo.structure_node_id = n.id JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'
   WHERE sv.academic_subject_id = a.id AND sv.status = 'PUBLISHED')
  AND NOT EXISTS (
  SELECT 1 FROM structure_versions sv JOIN structure_nodes n ON n.structure_version_id = sv.id JOIN learning_objectives lo ON lo.structure_node_id = n.id JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'
    JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id WHERE sv.academic_subject_id = a.id AND sv.status = 'PUBLISHED' AND cc.canonical_subject_id = a.canonical_subject_id);
SQL
echo "--- [4] runtime scenarios (real services; fixtures removed)"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/curriculum-convergence-scenarios.ts)
snapshot | diff - "$WORKDIR/after" >/dev/null && echo "scenarios_left_no_trace=YES"
echo "--- [5] rollback of $MIGRATION (documented), then re-apply"
"${PSQL[@]}" "$DB" <<SQL
DROP TABLE public.learner_concept_curriculum_provenance;
DROP FUNCTION public.learner_concept_curriculum_provenance_guard();
DELETE FROM schema_migrations WHERE version = '$MIGRATION';
SQL
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -1)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -1)
echo "=== curriculum convergence certification finished ==="
