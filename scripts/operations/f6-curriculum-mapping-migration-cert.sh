#!/bin/bash
# F6 -- Curriculum & Standards Mapping migration + pilot-dataset
# certification, against a REAL, EPHEMERAL, local-only Postgres instance
# (never Neon/Preview/Production -- per task 40, remote isolation could
# not be proven from this environment). Mirrors f1-f5's own cert scripts.
#
# Proves: the F6 migration applies cleanly on top of the full existing
# history, is idempotent, and -- exercised via real service calls --
# the full adversarial matrix from task 30 (shared canonical concept
# across PAA and Cambridge, version-scoped same-label nodes, PARTIAL
# never claims full coverage, duplicate resources never inflate
# coverage, self-approval denied, unpublished/retired exclusion,
# ambiguous correspondence never silently promoted, private content
# isolation, invalid structure cycle rejection, blueprint boundary,
# version change preserving history) behaves exactly as designed.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
F6_MIGRATION="$MIGRATIONS_DIR/20260924_1000_f6_curriculum_standards_mapping.sql"
WORKDIR="$(mktemp -d /tmp/studyus-f6-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f6_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F6 Curriculum & Standards Mapping — local migration + pilot-dataset certification ==="
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

echo "--- applying full migration history (chronological, up to and including F6) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F6 migration a second time ---"
$PSQL -f "$F6_MIGRATION" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects and fixture coverage policy exist ---"
for t in academic_organizations academic_programmes academic_qualifications academic_subjects structure_versions structure_nodes structure_node_localizations learning_objectives objective_concept_mappings objective_skill_mappings objective_competency_mappings academic_resources resource_objective_links curriculum_editorial_grants coverage_policy_versions; do
  $PSQL -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"
done
POLICY_COUNT=$($PSQL -tAc "SELECT COUNT(*) FROM coverage_policy_versions WHERE status='ACTIVE'")
[ "$POLICY_COUNT" -eq 1 ]
echo "  OK -- all F6 tables present; 1 ACTIVE coverage policy version seeded"

echo "--- seeding editors/reviewers/publishers and the pilot academic dataset (task 22) ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f6-seed-pilot-dataset.ts"

echo "--- running the full F6 adversarial certification (task 30 A-L) via real service calls ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f6-lifecycle-cert-runner.ts"

echo ""
echo "=== F6 migration + adversarial certification: ALL CHECKS PASSED ==="
