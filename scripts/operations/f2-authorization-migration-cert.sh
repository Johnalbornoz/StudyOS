#!/bin/bash
# F2 -- Institutions, Relationships & Permissions migration + data-
# safety certification, against a REAL, EPHEMERAL, local-only Postgres
# instance (never Neon/Preview/Production -- per the task's §27
# Preview Database Safety rule, remote isolation could not be proven
# from this environment). Mirrors f1-identity-migration-cert.sh.
#
# Proves: the F2 migration applies cleanly on top of the full existing
# history (including F1's), is idempotent, and the full
# institution/membership/assignment/relationship lifecycle -- request,
# approve, assign, revoke -- behaves exactly as designed against real
# Postgres, with zero data loss on revocation.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-f2-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f2_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F2 Institutions/Relationships/Permissions — local migration + lifecycle certification ==="
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

echo "--- applying full migration history (chronological, up to and including F2) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F2 migration a second time ---"
$PSQL -f "$MIGRATIONS_DIR/20260920_1000_f2_institutions_relationships_permissions.sql" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects exist ---"
for t in institutions institution_memberships grades classes class_enrollments teacher_assignments; do
  $PSQL -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"
done
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='parent_student_relationships' AND column_name='relationship_type'" | grep -q relationship_type
echo "  OK -- all 6 new tables + relationship_type column present"

echo "--- seeding an F1 identity to build the F2 lifecycle on top of ---"
$PSQL -c "
  INSERT INTO students (id, clerk_id, email, name) VALUES ('55555555-5555-4555-8555-555555555555', 'clerk_learner_1', 'learner1@test.local', 'Learner One');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('55555555-5555-4555-8555-555555555555', 'student', 'Learner One');
  INSERT INTO users (id, clerk_id, email) VALUES ('66666666-6666-4666-8666-666666666666', 'clerk_learner_1', 'learner1@test.local');
  UPDATE students SET user_id = '66666666-6666-4666-8666-666666666666' WHERE id = '55555555-5555-4555-8555-555555555555';
  UPDATE profiles SET user_id = '66666666-6666-4666-8666-666666666666' WHERE id = '55555555-5555-4555-8555-555555555555';
  INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ('66666666-6666-4666-8666-666666666666', 'STUDENT', 'ACTIVE', 'BACKFILL');

  INSERT INTO users (id, clerk_id, email) VALUES ('77777777-7777-4777-8777-777777777777', 'clerk_teacher_1', 'teacher1@test.local');
  INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ('77777777-7777-4777-8777-777777777777', 'TEACHER', 'ACTIVE', 'SELF_REGISTRATION');
" >/dev/null
echo "  seeded 1 learner (with F1 identity fully backfilled) + 1 teacher identity"

echo "--- running the full F2 lifecycle via real service calls against this real database ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f2-lifecycle-cert-runner.ts"

echo ""
echo "=== F2 migration + lifecycle certification: ALL CHECKS PASSED ==="
