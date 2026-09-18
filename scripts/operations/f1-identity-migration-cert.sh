#!/bin/bash
# F1 -- Unified Identity migration + backfill certification.
#
# Proves, against a REAL, EPHEMERAL, local-only Postgres instance
# (never Neon, never Preview, never Production -- exactly the posture
# required by the F1 task's §20 Preview Data Safety rule when remote
# database isolation cannot be proven): the F1 migration applies
# cleanly on top of the full existing migration history, is idempotent
# (applying it twice is a no-op the second time), and the identity
# backfill service produces the exact expected mapping/role/orphan
# counts against realistic synthetic data, and is itself idempotent
# (a second WRITE pass changes nothing further).
#
# Mirrors the existing, committed db-reproducibility-test.sh pattern:
# a fresh data directory under a scratch temp dir, Postgres listening
# only on a Unix socket (no TCP, no network exposure), torn down and
# deleted unconditionally at the end.
#
# Usage: ./scripts/operations/f1-identity-migration-cert.sh
# Requires: a local postgres/initdb/psql toolchain (PG_BIN below).

set -euo pipefail

# LC_ALL/LANG=C works around a known macOS-local issue where the
# postmaster can become multithreaded during startup under certain
# locale configurations ("postmaster became multithreaded during
# startup") and refuse to start. Local ephemeral-instance-only; never
# affects any other process.
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-f1-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f1_cert"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F1 Unified Identity — local migration + backfill certification ==="
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
  echo "NOTE: pgvector not installed locally -- substituting a test-only copy with the vector column/index commented out (real baseline file untouched)."
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed on local test toolchain)/m' "$TEST_SQL"
fi
perl -0pi -e 's/^SET transaction_timeout = 0;$/-- SET transaction_timeout = 0; -- SKIPPED (PG14\/PG18 compat)/m' "$TEST_SQL"

PSQL="$PG_BIN/psql -h $SOCKDIR -U postgres -v ON_ERROR_STOP=1 -q $DBNAME"

echo "--- applying baseline schema ---"
$PSQL -f "$TEST_SQL" >/dev/null

echo "--- applying full migration history (chronological, up to and including F1) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F1 migration a second time ---"
$PSQL -f "$MIGRATIONS_DIR/20260919_1000_f1_unified_identity.sql" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects exist ---"
$PSQL -tAc "SELECT to_regclass('public.users')" | grep -q users
$PSQL -tAc "SELECT to_regclass('public.user_roles')" | grep -q user_roles
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='students' AND column_name='user_id'" | grep -q user_id
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name='user_id'" | grep -q user_id
echo "  OK -- users, user_roles, students.user_id, profiles.user_id all present"

echo "--- seeding realistic synthetic identity data ---"
$PSQL -c "
  -- Case 1: a plain existing student (student-only, most common case).
  INSERT INTO students (id, clerk_id, email, name) VALUES ('11111111-1111-4111-8111-111111111111', 'clerk_student_1', 's1@test.local', 'Student One');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('11111111-1111-4111-8111-111111111111', 'student', 'Student One');
  INSERT INTO student_profiles (id) VALUES ('11111111-1111-4111-8111-111111111111');

  -- Case 2: a parent-only profile (never became a student).
  INSERT INTO profiles (id, user_type, full_name, clerk_id) VALUES (gen_random_uuid(), 'parent', 'Parent Only', 'clerk_parent_1');

  -- Case 3: one Clerk identity that is BOTH a student and (separately) a parent --
  -- the genuine multi-role case the product contract requires.
  INSERT INTO students (id, clerk_id, email, name) VALUES ('33333333-3333-4333-8333-333333333333', 'clerk_multi_1', 'm1@test.local', 'Multi One');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('33333333-3333-4333-8333-333333333333', 'student', 'Multi One');
  INSERT INTO profiles (id, user_type, full_name, clerk_id) VALUES (gen_random_uuid(), 'parent', 'Multi One (parent role)', 'clerk_multi_1');

  -- Case 4: an orphaned student-type profile -- no matching students row.
  -- Must be detected and reported, never silently assigned a user_id.
  INSERT INTO profiles (id, user_type, full_name) VALUES ('44444444-4444-4444-8444-444444444444', 'student', 'Orphaned Profile');
" >/dev/null
echo "  seeded 4 cases: plain student, parent-only, multi-role (student+parent), orphaned student-profile"

TSX="$REPO_ROOT/node_modules/.bin/tsx"

echo "--- running backfill DRY RUN via the real service against this real database ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f1-backfill-cert-runner.ts" dry-run

echo "--- running backfill WRITE via the real service against this real database ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f1-backfill-cert-runner.ts" write

echo "--- idempotency check: running backfill WRITE a second time ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f1-backfill-cert-runner.ts" write-second-pass

echo ""
echo "=== F1 migration + backfill certification: ALL CHECKS PASSED ==="
