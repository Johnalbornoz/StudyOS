#!/bin/bash
# Track A (Roles E2E) -- migration certification for
# database/migrations/20261018_1000_track_a_roles_e2e.sql against a REAL,
# EPHEMERAL, local-only Postgres instance (never Neon / Preview / Production).
# Proves: applies cleanly on top of the full history, is idempotent, the new
# constraints behave as designed, and the documented rollback restores the
# prior shape.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET_MIGRATION="$MIGRATIONS_DIR/20261018_1000_track_a_roles_e2e.sql"
WORKDIR="$(mktemp -d /tmp/studyus-track-a-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_track_a_cert"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Track A roles migration certification (ephemeral: $WORKDIR) ==="
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
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1/m' "$TEST_SQL"
fi

PSQL="$PG_BIN/psql -h $SOCKDIR -U postgres -v ON_ERROR_STOP=1 -q $DBNAME"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  $PSQL -f "$f" >/dev/null
done
echo "  OK -- baseline + full history (incl. target) applied"

$PSQL -f "$TARGET_MIGRATION" >/dev/null
echo "  OK -- idempotent (second application is a no-op)"

fail() { echo "  FAIL -- $1"; exit 1; }
expect_reject() { if $PSQL -c "$1" >/dev/null 2>&1; then fail "$2"; fi; echo "  OK -- rejected: $2"; }

$PSQL -c "
  INSERT INTO users (id, clerk_id, email) VALUES ('11111111-1111-4111-8111-111111111111', 'clerk_ta_t', 't@test.local');
  INSERT INTO students (id, clerk_id, email, name) VALUES ('22222222-2222-4222-8222-222222222222', 'clerk_ta_s', 's@test.local', 'S');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('22222222-2222-4222-8222-222222222222', 'student', 'S');
  INSERT INTO institutions (id, name) VALUES ('33333333-3333-4333-8333-333333333333', 'Inst');
  INSERT INTO classes (id, institution_id, name) VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'C');
  INSERT INTO institution_memberships (id, institution_id, user_id, membership_role, status)
    VALUES ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'TEACHER', 'APPROVED');
" >/dev/null

# notifications: legacy student row still valid; user-addressed row valid; neither -> rejected
$PSQL -c "INSERT INTO notifications (student_id, notification_type, title, message) VALUES ('22222222-2222-4222-8222-222222222222', 'X', 't', 'm')" >/dev/null
$PSQL -c "INSERT INTO notifications (recipient_user_id, workspace, notification_type, title, message) VALUES ('11111111-1111-4111-8111-111111111111', 'TEACHER', 'X', 't', 'm')" >/dev/null
echo "  OK -- legacy student-addressed and user-addressed notifications accepted"
expect_reject "INSERT INTO notifications (notification_type, title, message) VALUES ('X', 't', 'm')" "notification with no recipient"
expect_reject "INSERT INTO notifications (recipient_user_id, notification_type, title, message) VALUES ('11111111-1111-4111-8111-111111111111', 'X', 't', 'm')" "user-addressed notification without workspace"
expect_reject "INSERT INTO notifications (recipient_user_id, workspace, notification_type, title, message) VALUES ('11111111-1111-4111-8111-111111111111', 'NOPE', 'X', 't', 'm')" "unknown workspace"

# class_enrollments: PENDING / DECLINED accepted; garbage rejected
$PSQL -c "INSERT INTO class_enrollments (class_id, student_id, status, invited_by_user_id) VALUES ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'PENDING', '11111111-1111-4111-8111-111111111111')" >/dev/null
$PSQL -c "UPDATE class_enrollments SET status = 'DECLINED', responded_at = now()" >/dev/null
$PSQL -c "UPDATE class_enrollments SET status = 'ACTIVE'" >/dev/null
$PSQL -c "UPDATE class_enrollments SET status = 'ENDED', ended_at = now()" >/dev/null
echo "  OK -- enrollment PENDING -> DECLINED / ACTIVE -> ENDED"
expect_reject "UPDATE class_enrollments SET status = 'BOGUS'" "unknown enrollment status"

# teacher_assignments: scope must name a grade or a class
$PSQL -c "INSERT INTO teacher_assignments (institution_membership_id, class_id) VALUES ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444')" >/dev/null
echo "  OK -- class-scoped teacher assignment accepted"
expect_reject "INSERT INTO teacher_assignments (institution_membership_id) VALUES ('55555555-5555-4555-8555-555555555555')" "scope-less teacher assignment"

# teacher_interventions.assignment_group_id exists
$PSQL -tAc "SELECT 1 FROM information_schema.columns WHERE table_name='teacher_interventions' AND column_name='assignment_group_id'" | grep -q 1 || fail "assignment_group_id missing"
echo "  OK -- teacher_interventions.assignment_group_id present"

# Rollback (as documented in the migration header) restores the prior shape
ROLLBACK_SQL="$WORKDIR/rollback.sql"
{
  echo "BEGIN;"
  sed -n '/^-- Rollback/,/^-- DELETE FROM schema_migrations/p' "$TARGET_MIGRATION" | grep -E '^--   ' | sed 's/^--   //' | grep -v schema_migrations
  echo "COMMIT;"
} > "$ROLLBACK_SQL"
$PSQL -f "$ROLLBACK_SQL" >/dev/null
$PSQL -tAc "SELECT is_nullable FROM information_schema.columns WHERE table_name='notifications' AND column_name='student_id'" | grep -q NO || fail "rollback did not restore NOT NULL"
$PSQL -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='notifications' AND column_name IN ('recipient_user_id','workspace','payload','action_href')" | grep -qx 0 || fail "rollback left notification columns"
echo "  OK -- documented rollback restores the prior schema"
$PSQL -f "$TARGET_MIGRATION" >/dev/null
echo "  OK -- re-apply after rollback succeeds"

echo "=== Track A roles migration certification: ALL CHECKS PASSED ==="
