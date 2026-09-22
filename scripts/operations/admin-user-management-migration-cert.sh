#!/bin/bash
# Fase 2A -- migration certification for
# database/migrations/20261011_1000_admin_user_management.sql, against
# a REAL, EPHEMERAL, local-only Postgres instance (never Neon/Preview/
# Production -- mirrors f2-authorization-migration-cert.sh's own
# pattern). Proves the migration applies cleanly on top of the full
# existing history, is idempotent, and the widened users.status
# constraint / new admin_audit_log table / user_roles audit columns
# behave as designed.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-admin2a-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_admin2a_cert"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Fase 2A -- admin user management migration certification ==="
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

TARGET_MIGRATION="$MIGRATIONS_DIR/20261011_1000_admin_user_management.sql"

echo "--- idempotency check: re-applying the target migration a second time ---"
$PSQL -f "$TARGET_MIGRATION" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects exist ---"
$PSQL -tAc "SELECT to_regclass('public.admin_audit_log')" | grep -q admin_audit_log
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='is_test'" | grep -q is_test
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='user_roles' AND column_name='revoked_at'" | grep -q revoked_at
echo "  OK -- admin_audit_log + users.is_test + user_roles.revoked_at present"

echo "--- functional smoke test: widened users.status accepts ARCHIVED ---"
$PSQL -c "
  INSERT INTO users (id, clerk_id, email, status) VALUES ('99999999-9999-4999-8999-999999999999', 'clerk_admin2a_test', 'admin2a@test.local', 'ARCHIVED');
" >/dev/null
echo "  OK -- ARCHIVED accepted by the widened constraint"

if $PSQL -c "UPDATE users SET status = 'NOT_A_REAL_STATUS' WHERE id = '99999999-9999-4999-8999-999999999999';" >/dev/null 2>&1; then
  echo "  FAIL -- an invalid status value was accepted"
  exit 1
fi
echo "  OK -- an invalid status value is still rejected"

echo "--- functional smoke test: admin_audit_log accepts a real row and enforces its result CHECK ---"
$PSQL -c "
  INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, result, environment)
  VALUES ('99999999-9999-4999-8999-999999999999', 'USER_SUSPENDED', 'USER', '99999999-9999-4999-8999-999999999999', 'SUCCESS', 'development');
" >/dev/null
if $PSQL -c "
  INSERT INTO admin_audit_log (actor_user_id, action, target_type, result, environment)
  VALUES ('99999999-9999-4999-8999-999999999999', 'X', 'USER', 'NOT_A_RESULT', 'development');
" >/dev/null 2>&1; then
  echo "  FAIL -- an invalid result value was accepted"
  exit 1
fi
echo "  OK -- admin_audit_log accepts valid rows and rejects an invalid result"

echo ""
echo "=== Fase 2A -- admin user management migration certification: ALL CHECKS PASSED ==="
