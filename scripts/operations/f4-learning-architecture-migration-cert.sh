#!/bin/bash
# F4 -- Learning Architecture 2.0 migration + adversarial correspondence
# certification, against a REAL, EPHEMERAL, local-only Postgres instance
# (never Neon/Preview/Production -- per task 24, remote isolation could
# not be proven from this environment). Mirrors
# f1-identity-migration-cert.sh / f2-authorization-migration-cert.sh /
# f3-entitlement-migration-cert.sh.
#
# Proves: the F4 migration applies cleanly on top of the full existing
# history, is idempotent, its own SQL backfill correctly handles
# pre-existing concepts with no canonical catalog yet to match against,
# and -- exercised via the real ensureCatalogMapping service function
# against real Postgres, since the canonical catalog is necessarily empty
# at migration-apply time in any fresh environment -- the full adversarial
# mapping matrix from task 22 (equivalent names, same-name-different-scope,
# differently-named-but-maybe-equivalent, unresolved, evidence/mastery/
# retention/transfer preservation, private content isolation, skill/
# competency graph, prerequisite cycle rejection) behaves exactly as
# designed, with ZERO existing rows in any of the 19 evidence/state
# tables touched.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
F4_MIGRATION="$MIGRATIONS_DIR/20260922_1000_f4_learning_architecture_2.sql"
WORKDIR="$(mktemp -d /tmp/studyus-f4-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f4_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F4 Learning Architecture 2.0 — local migration + adversarial certification ==="
echo "Ephemeral instance: $WORKDIR (never production, never Neon, never Preview)"

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

echo "--- applying baseline schema ---"
$PSQL -f "$TEST_SQL" >/dev/null

echo "--- applying migration history up to (but not including) F4 ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  if [ "$f" = "$F4_MIGRATION" ]; then continue; fi
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- seeding TWO pre-existing concepts BEFORE F4's migration runs ---"
echo "    (proves the migration's own SQL backfill DO block handles concepts"
echo "     that already existed when the -- necessarily still empty -- canonical"
echo "     catalog is created in this same migration)"
$PSQL -c "
  INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999991', 'clerk_f4_legacy', 'f4legacy@test.local', 'F4 Legacy Learner');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999991', 'student', 'F4 Legacy Learner');
  INSERT INTO subjects (id, student_id, name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '99999999-9999-4999-8999-999999999991', 'Mathematics');

  -- Pre-existing concept with NO localization row at all -- tests the
  -- migration's 'no comparable label' -> UNRESOLVED branch directly.
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'LEGACY_NO_LABEL');

  -- Pre-existing concept WITH a label, but the canonical catalog does not
  -- exist yet at this point in history -- tests the 'zero candidates'
  -- branch of the migration's own SQL backfill.
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc02', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'LEGACY_WITH_LABEL');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc02', 'en', 'Some Legacy Concept');
" >/dev/null

echo "--- applying the F4 migration ---"
$PSQL -f "$F4_MIGRATION" >/dev/null

echo "--- idempotency check: re-applying the F4 migration a second time ---"
$PSQL -f "$F4_MIGRATION" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects and fixture taxonomy exist ---"
for t in canonical_subjects canonical_concepts skills competencies contexts canonical_concept_skills skill_competencies canonical_concept_competencies canonical_concept_prerequisites concept_catalog_mapping concept_catalog_mapping_candidates; do
  $PSQL -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"
done
SKILL_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM skills")
[ "$SKILL_COUNT" -eq 11 ]
COMPETENCY_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM competencies")
[ "$COMPETENCY_COUNT" -eq 10 ]
CONTEXT_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM contexts")
[ "$CONTEXT_COUNT" -eq 5 ]
echo "  OK -- all F4 tables present; fixture taxonomy seeded (11 skills, 10 competencies, 5 contexts)"

echo "--- verifying the migration's own SQL backfill handled BOTH pre-existing concepts ---"
NO_LABEL_STATUS=$($PSQL -tAc "SELECT status FROM concept_catalog_mapping WHERE learner_concept_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01'")
[ "$NO_LABEL_STATUS" = "UNRESOLVED" ]
WITH_LABEL_STATUS=$($PSQL -tAc "SELECT status FROM concept_catalog_mapping WHERE learner_concept_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02'")
[ "$WITH_LABEL_STATUS" = "UNRESOLVED" ]
echo "  OK -- no-label concept -> UNRESOLVED; labeled concept with empty catalog -> UNRESOLVED (task 22-D)"

echo "--- idempotency of the backfill itself: re-running the migration created no duplicate mapping rows ---"
MAPPING_COUNT_FOR_LEGACY=$($PSQL -tAc "SELECT COUNT(*) FROM concept_catalog_mapping WHERE learner_concept_id IN ('cccccccc-cccc-4ccc-8ccc-cccccccccc01','cccccccc-cccc-4ccc-8ccc-cccccccccc02')")
[ "$MAPPING_COUNT_FOR_LEGACY" -eq 2 ]
echo "  OK -- exactly one mapping row per concept even after re-applying the migration"

echo "--- seeding the adversarial post-migration dataset (task 22 A-M) + a second learner ---"
$PSQL -c "
  INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999992', 'clerk_f4_learner2', 'f4learner2@test.local', 'F4 Second Learner');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999992', 'student', 'F4 Second Learner');
  INSERT INTO subjects (id, student_id, name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '99999999-9999-4999-8999-999999999992', 'Mathematics');

  -- Canonical catalog fixture: ONE canonical subject, FIVE canonical concepts.
  INSERT INTO canonical_subjects (id, name) VALUES ('11111111-1111-4111-8111-111111111101', 'Mathematics');
  -- A: a single, unambiguous canonical concept both learners will independently match.
  INSERT INTO canonical_concepts (id, canonical_subject_id, name, description) VALUES
    ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'Linear Functions', 'Functions of the form f(x) = mx + b');
  -- B: SAME name, deliberately seeded twice with different scope -- must produce AMBIGUOUS, never an auto-pick.
  INSERT INTO canonical_concepts (id, canonical_subject_id, name, description, level) VALUES
    ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111101', 'Derivative Rules', 'Power/product/quotient rules', 'SL'),
    ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111101', 'Derivative Rules', 'Power/product/quotient/chain rules plus implicit differentiation', 'HL');
  -- J/K: skill graph fixture concepts.
  INSERT INTO canonical_concepts (id, canonical_subject_id, name) VALUES
    ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111101', 'Quadratic Factoring'),
    ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111101', 'Polynomial Division');

  -- J: one canonical concept mapped to multiple skills.
  INSERT INTO canonical_concept_skills (canonical_concept_id, skill_id)
    SELECT '22222222-2222-4222-8222-222222222204', id FROM skills WHERE name IN ('factor polynomial', 'analyze');
  -- K: that same skill reused by a second, different canonical concept.
  INSERT INTO canonical_concept_skills (canonical_concept_id, skill_id)
    SELECT '22222222-2222-4222-8222-222222222205', id FROM skills WHERE name = 'factor polynomial';
  -- L: one competency linked to multiple skills.
  INSERT INTO skill_competencies (skill_id, competency_id)
    SELECT s.id, c.id FROM skills s, competencies c WHERE s.name IN ('factor polynomial', 'analyze') AND c.code = 'C3';

  -- Learner 1's concepts (adversarial mapping targets):
  -- A (learner 1 side): label EXACTLY matches the one unambiguous canonical concept.
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'LINEAR_FUNCTIONS_L1');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'en', 'Linear Functions');
  -- B: label matches BOTH ambiguous canonical concepts.
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc12', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'DERIVATIVE_RULES_L1');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc12', 'en', 'Derivative Rules');
  -- C: a DIFFERENT name that may be conceptually equivalent to Linear Functions -- must stay UNRESOLVED, never guessed.
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc13', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'STRAIGHT_LINE_EQUATIONS');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc13', 'en', 'Straight Line Equations');
  -- D: a plain concept with genuinely no canonical counterpart.
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc14', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'COMPLETELY_NOVEL_IDEA');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc14', 'en', 'Completely Novel Idea');

  -- Learner 2's concept (A, other side): SAME label as learner 1's -- must independently match the SAME canonical concept, never compared to learner 1's row.
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc21', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'LINEAR_FUNCTIONS_L2');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc21', 'en', 'Linear Functions');

  -- E/F/G/H: historical data on learner 1's Linear Functions concept, to prove it is 100% untouched by mapping.
  INSERT INTO learning_evidence (student_id, concept_id, source_type, result, difficulty, subject_id)
    VALUES ('99999999-9999-4999-8999-999999999991', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'PRACTICE_QUESTION', 'correct', 2.0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  INSERT INTO mastery_records (student_id, concept_id, subject_id, mastery_score) VALUES ('99999999-9999-4999-8999-999999999991', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 82.0);
  INSERT INTO concept_knowledge_state (student_id, concept_id, subject_id, mastery_policy_version) VALUES ('99999999-9999-4999-8999-999999999991', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 1);
  INSERT INTO concept_memory_state (student_id, concept_id, policy_version, demonstrated_retention_score) VALUES ('99999999-9999-4999-8999-999999999991', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', 1, 70);
  INSERT INTO concept_transfer_state (student_id, concept_id, demonstrated_transfer_score, policy_version) VALUES ('99999999-9999-4999-8999-999999999991', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', 60, 1);

  -- I: private uploaded content referencing this same concept.
  INSERT INTO content_sources (id, student_id, subject_id, source_type, source_language, storage_path)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddd01', '99999999-9999-4999-8999-999999999991', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'upload', 'en', '/private/f4-cert/learner1-notes.pdf');
  INSERT INTO content_chunks (id, source_id, chunk_text, seq_order, concept_mappings)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', 'dddddddd-dddd-4ddd-8ddd-dddddddddd01', 'Linear functions notes', 0, ARRAY['cccccccc-cccc-4ccc-8ccc-cccccccccc11']::uuid[]);
" >/dev/null
echo "  seeded 2 learners, 5 canonical concepts, skill/competency graph fixtures, and full evidence/mastery/retention/transfer/private-content history on learner 1's concept"

echo "--- capturing evidence/state row counts BEFORE running any mapping logic ---"
BEFORE_EVIDENCE=$($PSQL -tAc "SELECT COUNT(*) FROM learning_evidence")
BEFORE_MASTERY=$($PSQL -tAc "SELECT COUNT(*) FROM mastery_records")
BEFORE_KSTATE=$($PSQL -tAc "SELECT COUNT(*) FROM concept_knowledge_state")
BEFORE_RETENTION=$($PSQL -tAc "SELECT COUNT(*) FROM concept_memory_state")
BEFORE_TRANSFER=$($PSQL -tAc "SELECT COUNT(*) FROM concept_transfer_state")
BEFORE_CONTENT=$($PSQL -tAc "SELECT COUNT(*) FROM content_sources")

echo "--- running the full F4 adversarial correspondence + prerequisite-cycle certification via real service calls ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  BEFORE_EVIDENCE="$BEFORE_EVIDENCE" BEFORE_MASTERY="$BEFORE_MASTERY" BEFORE_KSTATE="$BEFORE_KSTATE" \
  BEFORE_RETENTION="$BEFORE_RETENTION" BEFORE_TRANSFER="$BEFORE_TRANSFER" BEFORE_CONTENT="$BEFORE_CONTENT" \
  "$TSX" "$REPO_ROOT/scripts/operations/f4-lifecycle-cert-runner.ts"

echo ""
echo "=== F4 migration + adversarial certification: ALL CHECKS PASSED ==="
