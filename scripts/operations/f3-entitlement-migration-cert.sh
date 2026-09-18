#!/bin/bash
# F3 -- Subscription & Entitlement Foundation migration + suspension/
# reactivation data-safety certification, against a REAL, EPHEMERAL,
# local-only Postgres instance (never Neon/Preview/Production -- per
# §21 Real Database Safety, remote isolation could not be proven from
# this environment). Mirrors f1-identity-migration-cert.sh /
# f2-authorization-migration-cert.sh.
#
# Proves: the F3 migration applies cleanly on top of the full existing
# history, is idempotent, and the full subscription lifecycle --
# unpaid -> active -> past_due -> suspended -> reactivated -> active,
# plus cancelled_at_period_end -> expired -- behaves exactly as
# designed against real Postgres, with ZERO learning-history rows lost
# at any point, including while suspended.

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
WORKDIR="$(mktemp -d /tmp/studyus-f3-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_f3_cert"
TSX="$REPO_ROOT/node_modules/.bin/tsx"

cleanup() {
  echo "--- tearing down ephemeral test instance ---"
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== F3 Subscription & Entitlement — local migration + lifecycle certification ==="
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

echo "--- applying full migration history (chronological, up to and including F3) ---"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  applying $(basename "$f")"
  $PSQL -f "$f" >/dev/null
done

echo "--- idempotency check: re-applying the F3 migration a second time ---"
$PSQL -f "$MIGRATIONS_DIR/20260921_1000_f3_subscription_entitlement_foundation.sql" >/dev/null
echo "  OK -- second application produced no error (idempotent)"

echo "--- verifying target schema objects exist ---"
for t in price_book payments; do
  $PSQL -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"
done
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='payer_user_id'" | grep -q payer_user_id
$PSQL -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='plan'" | grep -q plan
PRICE_ROWS=$($PSQL -tAc "SELECT COUNT(*) FROM price_book WHERE status='ACTIVE'")
[ "$PRICE_ROWS" -eq 4 ]
echo "  OK -- price_book, payments, subscriptions.payer_user_id/.plan present; 4 fixture prices seeded"

echo "--- seeding a learner with real learning-history rows to prove suspension preserves them ---"
$PSQL -c "
  INSERT INTO students (id, clerk_id, email, name) VALUES ('99999999-9999-4999-8999-999999999999', 'clerk_f3_learner', 'f3learner@test.local', 'F3 Learner');
  INSERT INTO profiles (id, user_type, full_name) VALUES ('99999999-9999-4999-8999-999999999999', 'student', 'F3 Learner');
  INSERT INTO users (id, clerk_id, email) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'clerk_f3_learner', 'f3learner@test.local');
  UPDATE students SET user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE id = '99999999-9999-4999-8999-999999999999';
  UPDATE profiles SET user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE id = '99999999-9999-4999-8999-999999999999';
  INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'STUDENT', 'ACTIVE', 'BACKFILL');

  INSERT INTO subjects (id, student_id, name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '99999999-9999-4999-8999-999999999999', 'Mathematics');
  INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'algebra-basics');
  INSERT INTO learning_evidence (student_id, concept_id, source_type, result, difficulty, subject_id)
  VALUES ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'PRACTICE_QUESTION', 'correct', 2.0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  INSERT INTO mastery_records (student_id, concept_id, subject_id, mastery_score) VALUES ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 75.0);

  INSERT INTO users (id, clerk_id, email) VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'clerk_f3_payer', 'f3payer@test.local');
" >/dev/null
echo "  seeded 1 learner with real subjects/concepts/learning_evidence/mastery_records + 1 separate payer identity"

echo "--- running the full F3 lifecycle via real service calls against this real database ---"
DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR" \
  "$TSX" "$REPO_ROOT/scripts/operations/f3-lifecycle-cert-runner.ts"

echo ""
echo "=== F3 migration + lifecycle certification: ALL CHECKS PASSED ==="
