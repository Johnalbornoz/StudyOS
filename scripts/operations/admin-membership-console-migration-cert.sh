#!/bin/bash
# Professional Admin Console -- migration certification for
# database/migrations/20261012_1000_admin_membership_console.sql,
# against a REAL, EPHEMERAL, local-only Postgres instance.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-admin-console-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_admin_console_cert"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Admin Console -- migration certification ==="

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
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED/m' "$TEST_SQL"
fi
perl -0pi -e 's/^SET transaction_timeout = 0;$/-- SET transaction_timeout = 0; -- SKIPPED/m' "$TEST_SQL"

PSQL="$PG_BIN/psql -h $SOCKDIR -U postgres -v ON_ERROR_STOP=1 -q $DBNAME"

echo "--- applying baseline schema ---"
$PSQL -f "$TEST_SQL" >/dev/null

echo "--- applying full migration history in order ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

TARGET="$MIGRATIONS_DIR/20261012_1000_admin_membership_console.sql"

echo "--- idempotency check ---"
$PSQL -f "$TARGET" >/dev/null
echo "  OK -- second application produced no error"

echo "--- verifying target schema objects exist ---"
$PSQL -tAc "SELECT to_regclass('public.subscription_events')" | grep -q subscription_events
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='grant_expires_at'" | grep -q grant_expires_at
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='payments' AND column_name='approved_by_user_id'" | grep -q approved_by_user_id
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='password_change_required'" | grep -q password_change_required
echo "  OK -- subscription_events + grant fields + approval fields + password_change_required present"

echo "--- functional smoke test: password_change_required defaults to false, is settable ---"
$PSQL -c "
  INSERT INTO users (id, clerk_id, email) VALUES ('88888888-8888-4888-8888-888888888888', 'clerk_pwd_test', 'pwd_test@test.local');
" >/dev/null
DEFAULT_VAL=$($PSQL -tAc "SELECT password_change_required FROM users WHERE id = '88888888-8888-4888-8888-888888888888'")
if [ "$(echo "$DEFAULT_VAL" | tr -d '[:space:]')" != "f" ]; then
  echo "  FAIL -- password_change_required did not default to false"
  exit 1
fi
$PSQL -c "UPDATE users SET password_change_required = true, password_change_required_at = now() WHERE id = '88888888-8888-4888-8888-888888888888';" >/dev/null
echo "  OK -- password_change_required defaults false and is settable"

echo "--- functional smoke test: widened statuses accepted, invalid still rejected ---"
$PSQL -c "
  INSERT INTO students (id, clerk_id, email, name) VALUES ('77777777-7777-4777-8777-777777777777', 'clerk_console_test', 'console_test@test.local', 'Console Test');
  INSERT INTO subscriptions (student_id, status, source) VALUES ('77777777-7777-4777-8777-777777777777', 'disputed', 'INDIVIDUAL_PAYMENT');
" >/dev/null
echo "  OK -- 'disputed' status + source accepted"

if $PSQL -c "UPDATE subscriptions SET status = 'not_a_real_status' WHERE student_id = '77777777-7777-4777-8777-777777777777';" >/dev/null 2>&1; then
  echo "  FAIL -- invalid status accepted"
  exit 1
fi
echo "  OK -- invalid status still rejected"

if $PSQL -c "UPDATE subscriptions SET source = 'NOT_A_REAL_SOURCE' WHERE student_id = '77777777-7777-4777-8777-777777777777';" >/dev/null 2>&1; then
  echo "  FAIL -- invalid source accepted"
  exit 1
fi
echo "  OK -- invalid source still rejected"

SUB_ID=$($PSQL -tAc "SELECT id FROM subscriptions WHERE student_id = '77777777-7777-4777-8777-777777777777'")
$PSQL -c "INSERT INTO subscription_events (subscription_id, event_type, new_status) VALUES ('$SUB_ID', 'CREATED', 'disputed');" >/dev/null
if $PSQL -c "INSERT INTO subscription_events (subscription_id, event_type, new_status) VALUES ('$SUB_ID', 'NOT_A_REAL_EVENT', 'x');" >/dev/null 2>&1; then
  echo "  FAIL -- invalid event_type accepted"
  exit 1
fi
echo "  OK -- subscription_events timeline works and rejects invalid event types"

echo ""
echo "=== Admin Console migration certification: ALL CHECKS PASSED ==="
