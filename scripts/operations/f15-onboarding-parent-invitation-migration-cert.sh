#!/bin/bash
# Onboarding/authorization rework (2026-09-21) -- migration + basic
# functional certification for
# database/migrations/20260921_1100_student_initiated_parent_invitation.sql,
# against a REAL, EPHEMERAL, local-only Postgres instance (never Neon/
# Preview/Production -- mirrors f2-authorization-migration-cert.sh's
# own safety pattern). Proves the migration applies cleanly on top of
# the full existing history, is idempotent, and the resulting table
# behaves as designed (one-pending-invitation-per-student-per-email
# uniqueness) -- this is the "dry-run / prior inspection" this task's
# own Migration section requires before an operator applies it
# anywhere real.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/libpq/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-f15-onboarding-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f15_onboarding_cert"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Onboarding rework -- parent_invitations migration certification ==="
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

echo "--- applying full migration history in order, up to and including this one ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

TARGET_MIGRATION="$MIGRATIONS_DIR/20260921_1100_student_initiated_parent_invitation.sql"

echo "--- idempotency check: re-applying the target migration a second time ---"
$PSQL -f "$TARGET_MIGRATION" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects exist ---"
$PSQL -tAc "SELECT to_regclass('public.parent_invitations')" | grep -q parent_invitations
$PSQL -tAc "SELECT indexname FROM pg_indexes WHERE tablename='parent_invitations' AND indexname='idx_parent_invitations_one_pending'" | grep -q idx_parent_invitations_one_pending
$PSQL -tAc "SELECT indexname FROM pg_indexes WHERE tablename='parent_invitations' AND indexname='idx_parent_invitations_by_email'" | grep -q idx_parent_invitations_by_email
echo "  OK -- table + both indexes present"

echo "--- functional smoke test: one-pending-invitation-per-(student,email) uniqueness ---"
$PSQL -c "
  INSERT INTO students (id, clerk_id, email, name) VALUES ('88888888-8888-4888-8888-888888888888', 'clerk_learner_onb', 'learner_onb@test.local', 'Learner Onboarding');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('88888888-8888-4888-8888-888888888888', 'student', 'Learner Onboarding');
  INSERT INTO parent_invitations (student_id, invited_email, status) VALUES ('88888888-8888-4888-8888-888888888888', 'parent@test.local', 'pending');
" >/dev/null
echo "  seeded 1 student + 1 pending invitation"

if $PSQL -c "INSERT INTO parent_invitations (student_id, invited_email, status) VALUES ('88888888-8888-4888-8888-888888888888', 'Parent@Test.Local', 'pending');" >/dev/null 2>&1; then
  echo "  FAIL -- a second pending invitation to the same (case-insensitive) email was allowed"
  exit 1
fi
echo "  OK -- a second concurrent pending invitation to the same student+email is rejected by the unique index"

$PSQL -c "UPDATE parent_invitations SET status = 'declined', responded_at = NOW() WHERE student_id = '88888888-8888-4888-8888-888888888888';" >/dev/null
$PSQL -c "INSERT INTO parent_invitations (student_id, invited_email, status) VALUES ('88888888-8888-4888-8888-888888888888', 'parent@test.local', 'pending');" >/dev/null
echo "  OK -- re-inviting after decline is allowed (unique index is scoped to status='pending' only)"

echo ""
echo "=== Onboarding rework -- parent_invitations migration certification: ALL CHECKS PASSED ==="
