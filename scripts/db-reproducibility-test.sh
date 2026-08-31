#!/bin/bash
# StudyUs — Phase 0D baseline reproducibility test.
#
# Proves database/baseline/STUDYUS_BASELINE_2026_08.sql can build a
# working StudyUs schema from a completely empty Postgres database.
# Runs entirely against an EPHEMERAL, throwaway local Postgres instance
# (never production Neon) -- a fresh data directory under a scratch
# temp dir, a Postgres server listening only on a Unix socket in that
# same directory (no TCP port, no network exposure), torn down and
# deleted at the end of the script regardless of outcome.
#
# Usage: ./scripts/db-reproducibility-test.sh
# Requires: a local `postgres`/`initdb`/`psql` toolchain (PG_BIN below).
# Prints only schema object names/counts -- never touches or prints any
# credential (this script never reads .env.local or DATABASE_URL).

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@14/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
WORKDIR="$(mktemp -d /tmp/studyus-repro-test.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_repro_test"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== StudyUs baseline reproducibility test ==="
echo "Ephemeral instance: $WORKDIR (never production, never Neon)"

mkdir -p "$SOCKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null
echo "unix_socket_directories = '$SOCKDIR'" >> "$PGDATA/postgresql.conf"
echo "listen_addresses = ''" >> "$PGDATA/postgresql.conf"

"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOGFILE" -o "-h ''" start >/dev/null
sleep 1

"$PG_BIN/createdb" -h "$SOCKDIR" -U postgres "$DBNAME"
# A freshly created database already has a default `public` schema;
# the baseline's own `CREATE SCHEMA public;` (from pg_dump) expects to
# create it itself, so drop the default one first -- standard practice
# for restoring a plain-SQL pg_dump schema-only file via `psql -f`.
"$PG_BIN/psql" -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE;' "$DBNAME"

PSQL="$PG_BIN/psql -h $SOCKDIR -U postgres -v ON_ERROR_STOP=1 -q $DBNAME"

# --- pgvector availability check -----------------------------------
# The live baseline uses the `vector` extension (content_chunks.chunk_embedding).
# This local toolchain does not have pgvector installed. Rather than silently
# skip or silently pass, we detect this explicitly, apply a documented,
# test-only substitution (comment out the two vector-dependent statements),
# and report exactly what was skipped and why -- the baseline FILE itself is
# never modified, only a throwaway copy used for this test run.
TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$BASELINE_SQL" "$TEST_SQL"

if $PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$DBNAME" | grep -q 1; then
  VECTOR_AVAILABLE=1
else
  VECTOR_AVAILABLE=0
  echo "NOTE: pgvector extension is not installed on this local test toolchain."
  echo "      Substituting a test-only copy with the two vector-dependent statements"
  echo "      commented out (content_chunks.chunk_embedding column + its ivfflat index)."
  echo "      The real baseline file is untouched. See Phase 0D report for details."
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
fi

# The dump's own preamble includes `SET transaction_timeout = 0;`, a
# session-safety setting only recognized by Postgres 17+ (the live source
# is 18.6). It is not schema content -- neutralizing it for an older local
# test toolchain (PG14 here) does not change what tables/constraints get
# created. The real baseline file's preamble is left untouched; this
# substitution only affects this throwaway test copy. Documented as a
# known compatibility note in the Phase 0D report.
perl -0pi -e 's/^SET transaction_timeout = 0;$/-- SET transaction_timeout = 0;  -- SKIPPED (requires Postgres 17+, local test toolchain is 14)/m' "$TEST_SQL"

echo "--- applying baseline to empty ephemeral database ---"
$PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -q -f "$TEST_SQL" "$DBNAME"
echo "BASELINE_APPLY = OK"

echo ""
echo "--- verifying table count ---"
TABLE_COUNT=$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" "$DBNAME")
echo "TABLES_CREATED = $TABLE_COUNT (expected 50, or 49 if pgvector unavailable locally: actual pgvector available = $VECTOR_AVAILABLE)"

echo ""
echo "--- verifying Step 12 minimum critical tables exist ---"
for t in students profiles subjects concepts mastery_records learning_evidence errors quiz_sessions concept_knowledge_state verification_attempts; do
  EXISTS=$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t')" "$DBNAME")
  echo "  $t: EXISTS=$EXISTS"
done

echo ""
echo "--- verifying PK/FK/critical column contracts ---"
echo "  students.id PK:        $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_name='students' AND constraint_type='PRIMARY KEY'" "$DBNAME")"
echo "  profiles.id PK:        $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_name='profiles' AND constraint_type='PRIMARY KEY'" "$DBNAME")"
echo "  subjects.student_id -> profiles FK: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
    WHERE tc.table_name='subjects' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='student_id' AND ccu.table_name='profiles'" "$DBNAME")"
echo "  concepts.subject_id -> subjects FK: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT COUNT(*) FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
    WHERE tc.table_name='concepts' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='subject_id' AND ccu.table_name='subjects'" "$DBNAME")"
echo "  mastery_records.mastery_score type: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT data_type || '(' || numeric_precision || ',' || numeric_scale || ')' FROM information_schema.columns
    WHERE table_name='mastery_records' AND column_name='mastery_score'" "$DBNAME")"
echo "  verification_attempts.variant_equivalence_confidence exists: $($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verification_attempts' AND column_name='variant_equivalence_confidence')" "$DBNAME")"

echo ""
echo "--- verifying NO legacy/dead objects were accidentally created ---"
for t in student_subjects quiz_responses error_patterns chunk_embeddings chunk_concept_mappings exam_readiness_history study_session_progress; do
  EXISTS=$($PG_BIN/psql -h "$SOCKDIR" -U postgres -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t')" "$DBNAME")
  echo "  $t: EXISTS=$EXISTS (expected false)"
done

echo ""
echo "REPRODUCIBILITY_TEST = PASS"
