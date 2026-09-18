#!/bin/bash
# F5 -- Evidence & Learner State 2.0 migration + adversarial certification,
# against a REAL, EPHEMERAL, local-only Postgres instance (never Neon/
# Preview/Production -- per task 37, remote isolation could not be proven
# from this environment). Mirrors f1/f2/f3/f4's own cert scripts.
#
# Proves: the F5 migration applies cleanly on top of the full existing
# history, is idempotent, and -- exercised via the REAL updateMastery()
# production function (never mocked) -- the full adversarial matrix from
# task 28 (knowledge-only evidence never fabricates skill state, explicit
# skill evidence produces real state, a shared skill across concepts
# attributes without duplication, competency is never inferred from
# single-skill evidence, assisted evidence never reads as independent,
# difficulty/consistency/context stay traceable, cross-learner isolation,
# and AMBIGUOUS/UNRESOLVED canonical mappings never leak a guessed
# canonical id) behaves exactly as designed, with ZERO existing rows in
# any Canonical-V2-owned table touched.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
F5_MIGRATION="$MIGRATIONS_DIR/20260923_1000_f5_evidence_learner_state_2.sql"
WORKDIR="$(mktemp -d /tmp/studyus-f5-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f5_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F5 Evidence & Learner State 2.0 — local migration + adversarial certification ==="
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

echo "--- applying full migration history (chronological, up to and including F5) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F5 migration a second time ---"
$PSQL -f "$F5_MIGRATION" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects and fixture policy versions exist ---"
for t in aggregation_policy_versions learner_skill_state learner_competency_state learner_transfer_analytics; do
  $PSQL -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"
done
POLICY_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM aggregation_policy_versions WHERE status='ACTIVE'")
[ "$POLICY_COUNT" -eq 3 ]
echo "  OK -- all F5 tables present; 3 ACTIVE policy versions seeded (SKILL, COMPETENCY, TRANSFER_ANALYTICS)"

echo "--- required base data: a mastery_policies row (updateMastery's real dependency, not seeded by any migration) ---"
$PSQL -c "
  INSERT INTO mastery_policies (
    version, minimum_understanding, minimum_independence, minimum_application,
    minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions,
    minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days
  ) VALUES (1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14);
" >/dev/null

echo "--- seeding two learners, the canonical catalog fixture, and per-student concepts (task 28 fixture) ---"
$PSQL -c "
  -- Learner 1
  INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999991', 'clerk_f5_l1', 'f5l1@test.local', 'F5 Learner One');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999991', 'student', 'F5 Learner One');
  INSERT INTO subjects (id, student_id, name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '99999999-9999-4999-8999-999999999991', 'Mathematics');
  -- Learner 2
  INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999992', 'clerk_f5_l2', 'f5l2@test.local', 'F5 Learner Two');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999992', 'student', 'F5 Learner Two');
  INSERT INTO subjects (id, student_id, name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '99999999-9999-4999-8999-999999999992', 'Mathematics');

  -- Canonical catalog fixture (test-only, mirrors F4's own cert pattern)
  INSERT INTO canonical_subjects (id, name) VALUES ('11111111-1111-4111-8111-111111111105', 'Mathematics');
  INSERT INTO canonical_concepts (id, canonical_subject_id, name) VALUES ('22222222-2222-4222-8222-222222222210', '11111111-1111-4111-8111-111111111105', 'Linear Functions');
  -- Deliberately ambiguous: same name, two canonical concepts.
  INSERT INTO canonical_concepts (id, canonical_subject_id, name, level) VALUES
    ('22222222-2222-4222-8222-222222222211', '11111111-1111-4111-8111-111111111105', 'Derivative Rules', 'SL'),
    ('22222222-2222-4222-8222-222222222212', '11111111-1111-4111-8111-111111111105', 'Derivative Rules', 'HL');

  -- Learner 1's concepts:
  -- C1: matches the unambiguous canonical concept (task 28-I, learner side 1)
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'L1_LINEAR_FUNCTIONS');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'en', 'Linear Functions');
  -- C5: a second concept for L1, used to prove a shared skill across concepts attributes correctly (task 28-C)
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc15', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'L1_QUADRATIC_FACTORING');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc15', 'en', 'Quadratic Factoring');
  -- C3: ambiguous mapping target (task 28-J)
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc13', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'L1_DERIVATIVE_RULES');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc13', 'en', 'Derivative Rules');
  -- C4: unresolved mapping target (task 28-K)
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc14', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'L1_NOVEL_CONCEPT');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc14', 'en', 'A Genuinely Novel Concept');

  -- Learner 2's concept: matches the SAME unambiguous canonical concept as L1's C1 (task 28-I, learner side 2)
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc21', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'L2_LINEAR_FUNCTIONS');
  INSERT INTO concept_localizations (concept_id, language, label) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc21', 'en', 'Linear Functions');
" >/dev/null
echo "  seeded 2 learners, 3 canonical concepts (1 unambiguous + 2 same-name), and 5 per-student concepts"

echo "--- resolving F4 catalog mappings for the seeded concepts (real service call) ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f5-resolve-mappings.ts"

echo "--- running the full F5 adversarial evidence + Learner State certification via real updateMastery() calls ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f5-lifecycle-cert-runner.ts"

echo ""
echo "=== F5 migration + adversarial certification: ALL CHECKS PASSED ==="
