#!/bin/bash
# TRACK B -- the Exam Bank loader against an EPHEMERAL, throwaway local Postgres.
#
# Never DEV, Stage, Production or any Neon database; never reads .env. The cluster lives in a temporary directory,
# listens on 127.0.0.1 on a free port, and is destroyed on exit.
#
#   1. baseline + every migration the hosted DEV database already holds (ledger 89), recorded in the ledger;
#   2. the reference exam verticals (the PAA structure the bank rows attach to) and two technical identities;
#   3. the three pending migrations, applied by the REAL runner (scripts/db-migrate.ts), exactly as on DEV:
#        20261121_1100 QF V5.1   20261122_1200 QF V5.2   20261123_1000 core-derived authorship
#   4. loader DRY RUN (must keep nothing), APPLY, APPLY again (must write nothing);
#   5. provenance, idempotency and tamper checks, read from the database.
set -uo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@14/bin}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PENDING=("20261121_1100_qf51_construct_core_lineage.sql" "20261122_1200_qf52_exam_bank_certification_coverage.sql" "20261123_1000_exam_bank_core_derived_authorship.sql")
W="$(mktemp -d /tmp/studyus-exambank.XXXXXX)"
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
DB="exam_bank_throwaway"
cleanup() { "$PG_BIN/pg_ctl" -D "$W/d" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$W"; }
trap cleanup EXIT
fail() { echo "$1 = FAIL"; [ -n "${2:-}" ] && echo "$2"; exit 1; }

"$PG_BIN/initdb" -D "$W/d" -U postgres --no-locale --encoding=UTF8 >/dev/null 2>&1
{ echo "listen_addresses = '127.0.0.1'"; echo "port = $PORT"; echo "unix_socket_directories = '$W'"; } >> "$W/d/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$W/d" -l "$W/log" start >/dev/null
sleep 1
P="$PG_BIN/psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
Q() { $P -At -c "$1" "$DB"; }
export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/$DB"
FP="$(node -e 'const c=require("crypto");const u=new URL(process.env.DATABASE_URL);console.log(c.createHash("sha256").update(u.hostname+"|"+u.pathname.slice(1)).digest("hex").slice(0,16))')"
cd "$REPO"

"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$DB"
$P -c 'DROP SCHEMA public CASCADE;' "$DB"
cp "$REPO/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$W/b.sql"
perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1/m; s/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1/m; s/^SET transaction_timeout = 0;$/-- skipped (PG17+)/m' "$W/b.sql"
$P -f "$W/b.sql" "$DB" >/dev/null 2>"$W/err" || fail BASELINE "$(head -5 "$W/err")"
$P -f "$REPO/database/ledger/0000_baseline_ledger.sql" "$DB" >/dev/null
Q "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'baseline', 'throwaway')" >/dev/null
APPLIED=()
for f in $(ls "$REPO"/database/migrations/*.sql | sort); do
  skip=0; for p in "${PENDING[@]}"; do [ "$(basename "$f")" = "$p" ] && skip=1; done
  [ "$skip" = "1" ] && continue
  $P -1 -f "$f" "$DB" >/dev/null 2>"$W/err" || fail "PRIOR_MIGRATION $(basename "$f")" "$(head -3 "$W/err")"
  APPLIED+=("$f")
done
npx tsx scripts/operations/exam-bank/throwaway-ledger-stamp.ts "${APPLIED[@]}" > "$W/stamp" 2>&1 || fail LEDGER_STAMP "$(tail -3 "$W/stamp")"
echo "DEV-equivalent state: baseline + ${#APPLIED[@]} migrations ($(cat "$W/stamp"))"

Q "INSERT INTO users (clerk_id, email, is_system) VALUES ('system:proof-editor', NULL, true), ('system:proof-reviewer', NULL, true), ('proof:a-person', NULL, false)" >/dev/null || fail TECHNICAL_IDENTITIES
TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-v2-apply.ts --write > "$W/verticals" 2>&1 || fail EXAM_VERTICALS "$(tail -5 "$W/verticals")"
echo "exam verticals applied: PAA Matemáticas targets = $(Q "SELECT count(*) FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id JOIN assessment_components c ON c.exam_version_id = v.id AND c.section_key = 'matematicas' JOIN blueprint_objective_targets t ON t.assessment_component_id = c.id WHERE d.config_key = 'v2.paa'")"

# the loader refuses a database that does not hold the model yet
EXAM_BANK_PUBLICATION_FP="$FP" npx tsx scripts/operations/exam-bank/publish-certified-supply.ts > "$W/early" 2>&1
grep -q "MIGRATION_NOT_APPLIED:20261121_1100" "$W/early" && echo "REFUSES_WITHOUT_THE_MIGRATIONS = PASS" || fail REFUSES_WITHOUT_THE_MIGRATIONS "$(tail -3 "$W/early")"

npx tsx scripts/db-migrate.ts > "$W/migrate" 2>&1 || fail REAL_RUNNER "$(tail -8 "$W/migrate")"
grep -E "^  2026|Applied|Pending" "$W/migrate"
[ "$(Q "SELECT count(*) FROM schema_migrations")" = "$(( ${#APPLIED[@]} + 4 ))" ] && echo "LEDGER_AFTER = $(Q "SELECT count(*) FROM schema_migrations") (PASS)" || fail LEDGER_AFTER

counts() { Q "SELECT (SELECT count(*) FROM assessment_item_instances) || '/' || (SELECT count(*) FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED') || '/' || (SELECT count(*) FROM assessment_certifications) || '/' || (SELECT count(*) FROM assessment_object_certifications) || '/' || (SELECT count(*) FROM assessment_construct_cores)"; }
run() { EXAM_BANK_PUBLICATION_FP="$FP" npx tsx scripts/operations/exam-bank/publish-certified-supply.ts "$@" > "$W/run" 2>&1; local rc=$?; grep -E "^(exam bank|PLAN|DRY_RUN|APPLY|ROWS|  [a-z_]+ [0-9]+|SKIPPED|MATERIALIZED|BLOCKED|CONFLICTS|VERIFICATION|REFUS|CONFLICT|FAILED)" "$W/run" | cut -c1-1400; return $rc; }

# a bank row never guesses its concept: without the certified concept catalogue nothing is materialised
run >/dev/null 2>&1
grep -q '"EXAM_BANK_ROW:CANONICAL_CONCEPT_NOT_RESOLVED":296' "$W/run" && grep -q '"planned":0' "$W/run" && echo "BLOCKS_WITHOUT_THE_CERTIFIED_CONCEPTS = PASS (296 rows blocked, 0 materialised)" || fail BLOCKS_WITHOUT_THE_CERTIFIED_CONCEPTS "$(grep -E '^(BLOCKED|MATERIALIZED)' "$W/run")"
npx tsx scripts/operations/exam-bank/throwaway-paa-catalogue.ts > "$W/catalogue" 2>&1 || fail CERTIFIED_PAA_CATALOGUE "$(tail -4 "$W/catalogue")"
tail -1 "$W/catalogue"

echo; echo "---- DRY RUN"
run || fail LOADER_DRY_RUN "$(tail -5 "$W/run")"
DRY_ROWS="$(grep -E "^ROWS" "$W/run" | grep -o '[0-9]*$')"
[ "$(counts)" = "0/0/0/0/0" ] && [ "${DRY_ROWS:-0}" -gt 0 ] && echo "LOADER_DRY_RUN = PASS (reported $DRY_ROWS rows, kept $(counts))" || fail LOADER_DRY_RUN "kept $(counts)"

echo; echo "---- FIRST APPLY"
run --apply || fail FIRST_APPLY "$(tail -5 "$W/run")"
FIRST_ROWS="$(grep -E "^ROWS" "$W/run" | grep -o '[0-9]*$')"
AFTER_FIRST="$(counts)"
[ "$FIRST_ROWS" = "$DRY_ROWS" ] && [ "$(Q "SELECT count(*) FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED'")" = "296" ] && echo "FIRST_APPLY = PASS (wrote $FIRST_ROWS rows, as the dry run said; instances/bank rows/human decisions/object certifications/cores = $AFTER_FIRST)" || fail FIRST_APPLY "dry run $DRY_ROWS, apply $FIRST_ROWS"

echo; echo "---- SECOND APPLY"
run --apply || fail SECOND_APPLY "$(tail -5 "$W/run")"
SECOND_ROWS="$(grep -E "^ROWS" "$W/run" | grep -o '[0-9]*$')"
[ "$SECOND_ROWS" = "0" ] && [ "$(counts)" = "$AFTER_FIRST" ] && echo "SECOND_APPLY = PASS   SECOND_APPLY_NEW_ROWS = 0" || fail SECOND_APPLY "new rows $SECOND_ROWS; $(counts) vs $AFTER_FIRST"

echo; echo "---- provenance and integrity, read from the database"
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && echo "ok   $name = $got" || { echo "FAIL $name = $got (want $want)"; BAD=1; }; }
BAD=0
check "human decisions persisted (the recorded file has 11)" "$(Q "SELECT count(*) FROM assessment_certifications")" 11
check "human decisions by the recorded reviewer identity, at the recorded moment" "$(Q "SELECT count(*) FROM assessment_certifications WHERE reviewer_id = 'INTERNAL_PILOT_REVIEWER' AND decided_at = '2026-10-13T12:11:00Z'")" 11
check "human decisions whose hash is not in the recorded file" "$(node -e 'const f=require(process.argv[1]);console.log(f.records.map(r=>r.record.evidenceHash).join(","))' "$REPO/docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json" | { IFS= read -r hs; Q "SELECT count(*) FROM assessment_certifications WHERE NOT (evidence_hash = ANY (string_to_array('$hs', ',')))"; })" 0
check "HUMAN_CERTIFIED objects (2 cores, 2 adapters, 2 envelopes, 1 blueprint)" "$(Q "SELECT count(*) FROM assessment_object_certifications WHERE state = 'HUMAN_CERTIFIED'")" 7
check "HUMAN_CERTIFIED cores" "$(Q "SELECT string_agg(object_id, ',' ORDER BY object_id) FROM assessment_object_certifications WHERE state = 'HUMAN_CERTIFIED' AND object_type = 'CONSTRUCT_CORE'")" "tf.math.proportion.missing-value,tf.math.quadratic.solve-rational-roots"
check "AUTOMATED cores that remain automated, decided by the policy" "$(Q "SELECT count(*) FROM assessment_construct_cores c JOIN assessment_object_certifications o ON o.object_type = 'CONSTRUCT_CORE' AND o.object_id = c.construct_family_id WHERE o.state = 'AUTOMATED_CERTIFIED_PILOT' AND o.human_certification_id IS NULL AND o.decided_by = 'policy:HUMAN50_POLICY_V1' AND c.certified_by = 'policy:HUMAN50_POLICY_V1' AND c.certification_version = 'HUMAN50_POLICY_V1:AUTOMATED_CERTIFIED_PILOT'")" 8
check "automated decisions attributed to a person" "$(Q "SELECT count(*) FROM assessment_object_certifications WHERE state = 'AUTOMATED_CERTIFIED_PILOT' AND (human_certification_id IS NOT NULL OR decided_by = 'INTERNAL_PILOT_REVIEWER')")" 0
check "instances certified by anything but inherited deterministic certification" "$(Q "SELECT count(*) FROM assessment_item_instances WHERE certification_mode <> 'INHERITED_DETERMINISTIC_CERTIFICATION' OR certification_state <> 'AUTOMATED_CERTIFIED_PILOT'")" 0
check "individual human reviews of an instance (none exists; none may be invented)" "$(Q "SELECT count(*) FROM assessment_certifications WHERE object_type = 'ITEM_INSTANCE'")" 0
check "instances eligible for PRODUCTION" "$(Q "SELECT count(*) FROM student_eligible_item_instances_production")" 0
check "bank rows with no eligible certified instance" "$(Q "SELECT count(*) FROM question_bank_items qi WHERE qi.lineage_class = 'CORE_DERIVED' AND NOT EXISTS (SELECT 1 FROM student_eligible_item_instances_pilot i WHERE i.id = qi.item_instance_id)")" 0
check "bank rows authored by a person" "$(Q "SELECT count(*) FROM question_bank_items qi JOIN approved_items ai ON ai.bank_item_id = qi.id JOIN users u ON u.id = ai.created_by WHERE qi.lineage_class = 'CORE_DERIVED' AND u.is_system IS DISTINCT FROM true")" 0
check "bank rows that resolve to instance, core, adapter, blueprint, renderer, seed, concept, difficulty, policy and digest" "$(Q "SELECT count(*) FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id JOIN assessment_item_instances i ON i.id = qi.item_instance_id JOIN assessment_construct_cores c ON c.id = i.core_id WHERE qi.lineage_class = 'CORE_DERIVED' AND ai.content->'lineage'->>'digest' = i.certification_digest AND ai.content->'lineage'->>'coreId' = c.construct_family_id AND ai.content->'lineage'->>'coreVersion' = c.family_version AND ai.content->'lineage'->>'adapterId' = i.adapter_id AND ai.content->'lineage'->>'adapterVersion' = i.adapter_version AND ai.content->'lineage'->>'systemId' = i.system_id AND ai.content->'lineage'->>'bucketId' = i.blueprint_bucket_id AND ai.content->'lineage'->>'rendererVersion' = i.renderer_version AND ai.content->'lineage'->>'seed' = i.seed AND ai.content->'lineage'->>'envelopeHash' = i.envelope_hash AND ai.content->'lineage'->>'policyHash' = i.policy_hash AND ai.content->'certified'->>'primaryConceptStableId' = i.primary_concept_stable_id AND (ai.content->>'difficulty')::int = i.item_difficulty AND ai.content->>'difficultyBand' IN ('LOW', 'MEDIUM', 'HIGH') AND ai.content->'response'->'policy'->>'kind' = i.response_policy->>'kind' AND ai.content->'rights'->>'category' = i.rights_category AND ai.content->'certified'->>'itemType' = 'EXAM_BANK_ITEM' AND 'PILOT_PREVIEW' = ANY (i.eligibility_scopes)")" "$(Q "SELECT count(*) FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED'")"
check "bank rows whose one PRIMARY concept is not the certified concept of their instance" "$(Q "SELECT count(*) FROM question_bank_items qi JOIN assessment_item_instances i ON i.id = qi.item_instance_id WHERE qi.lineage_class = 'CORE_DERIVED' AND (SELECT count(*) FROM question_bank_item_concepts ic JOIN canonical_concepts cc ON cc.id = ic.canonical_concept_id WHERE ic.approved_item_id = qi.current_version_id AND ic.role = 'PRIMARY' AND cc.status = 'ACTIVE') <> 1")" 0
check "bank rows without an established StudyUs-owned reuse right" "$(Q "SELECT count(*) FROM question_bank_items qi WHERE qi.lineage_class = 'CORE_DERIVED' AND NOT EXISTS (SELECT 1 FROM question_bank_content_rights r WHERE r.content_type = 'ITEM_VERSION' AND r.content_id = qi.current_version_id AND r.superseded_at IS NULL AND r.reuse_rights = 'STUDYUS_OWNED')")" 0
check "bank rows that are ACTIVE and PUBLISHED" "$(Q "SELECT count(*) FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id WHERE qi.lineage_class = 'CORE_DERIVED' AND ai.bank_lifecycle_status = 'ACTIVE' AND ai.status = 'PUBLISHED'")" 296
check "fixtures, generated or rights-unknown content among the bank rows" "$(Q "SELECT count(*) FROM question_bank_items qi JOIN approved_items ai ON ai.id = qi.current_version_id JOIN assessment_item_instances i ON i.id = qi.item_instance_id WHERE qi.lineage_class = 'CORE_DERIVED' AND (qi.provenance <> 'STUDYUS_AUTHORED' OR ai.content_origin <> 'AUTHORED' OR ai.content->>'contentStatus' <> 'ORIGINAL' OR i.rights_category <> 'STUDYUS_ORIGINAL_DETERMINISTIC')")" 0
check "duplicate instances / bank rows / human decisions / object certifications" "$(Q "SELECT (SELECT count(*) FROM (SELECT 1 FROM assessment_item_instances GROUP BY certification_digest HAVING count(*) > 1) a) + (SELECT count(*) FROM (SELECT 1 FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED' GROUP BY item_instance_id, learning_objective_id HAVING count(*) > 1) b) + (SELECT count(*) FROM (SELECT 1 FROM assessment_certifications GROUP BY reviewer_id, object_type, object_id, object_version, system_id, canonical_subject HAVING count(*) > 1) c) + (SELECT count(*) FROM (SELECT 1 FROM assessment_object_certifications GROUP BY object_type, object_id, object_version HAVING count(*) > 1) d)")" 0
check "eligibility view invariant" "$(Q "SELECT COALESCE(public.assessment_supply_view_invariant(), 'OK')")" OK

echo; echo "---- fail-closed: a conflicting immutable identity stops the run, and nothing is written"
# a core of the same identity with other content: stored by hand, the way a divergent environment would hold it
Q "ALTER TABLE assessment_object_certifications DISABLE TRIGGER trg_assessment_object_certification_guard" >/dev/null
Q "UPDATE assessment_object_certifications SET content_hash = repeat('0', 64) WHERE object_type = 'BLUEPRINT_CLASSIFICATION' AND object_id = 'v2.paa/matematicas'" >/dev/null
Q "ALTER TABLE assessment_object_certifications ENABLE TRIGGER trg_assessment_object_certification_guard" >/dev/null
BEFORE="$(counts)"
run --apply; RC=$?
[ "$RC" != "0" ] && grep -q "CONFLICT (nothing written)" "$W/run" && [ "$(counts)" = "$BEFORE" ] && echo "ok   a different content under the same identity = CONFLICT, nothing written" || { echo "FAIL conflict not detected (rc $RC)"; BAD=1; }
# and a person may not be recorded as the author of a core-derived version, nor may a version that is not its instance be stored
R1="$(Q "INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, bank_item_id, version_number, bank_lifecycle_status) SELECT ai.learning_objective_id, ai.question_type, ai.content, (SELECT id FROM users WHERE clerk_id = 'proof:a-person'), 'PUBLISHED', ai.bank_item_id, 2, 'ACTIVE' FROM approved_items ai JOIN question_bank_items qi ON qi.current_version_id = ai.id AND qi.lineage_class = 'CORE_DERIVED' LIMIT 1" 2>&1)"
echo "$R1" | grep -q "QUESTION_BANK_CORE_DERIVED_IS_NOT_AUTHORED_BY_A_PERSON" && echo "ok   a core-derived version authored by a person is refused" || { echo "FAIL human author accepted: $R1"; BAD=1; }
R2="$(Q "INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, bank_item_id, version_number, bank_lifecycle_status) SELECT ai.learning_objective_id, ai.question_type, jsonb_set(ai.content, '{difficulty}', '5'), ai.created_by, 'PUBLISHED', ai.bank_item_id, 2, 'ACTIVE' FROM approved_items ai JOIN question_bank_items qi ON qi.current_version_id = ai.id AND qi.lineage_class = 'CORE_DERIVED' WHERE (ai.content->>'difficulty')::int <> 5 LIMIT 1" 2>&1)"
echo "$R2" | grep -q "QUESTION_BANK_CORE_DERIVED_IS_NOT_ITS_CERTIFIED_INSTANCE" && echo "ok   a core-derived version that is not its instance (difficulty edited) is refused" || { echo "FAIL altered version accepted: $R2"; BAD=1; }

[ "$BAD" = "0" ] && echo && echo "EXAM_BANK_PUBLICATION_PROOF = PASS" || { echo; echo "EXAM_BANK_PUBLICATION_PROOF = FAIL"; exit 1; }
