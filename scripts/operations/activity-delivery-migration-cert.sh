#!/bin/bash
# LEARNING_ACTIVITY_DELIVERY -- migration certification for
# database/migrations/20261016_1000_activity_delivery.sql against a REAL,
# EPHEMERAL, local-only Postgres instance (never Neon / DEV / Stage /
# Production). Mirrors the f6/f7 cert scripts.
#
# Proves:
#   1. baseline + the full history up to (excluding) the delivery migration
#      applies; a LEGACY row shape (PROVE prepared activity + quiz session)
#      is seeded BEFORE the migration;
#   2. the migration applies on top of it, legacy rows survive unchanged
#      (source defaults to 'AI', slot 0, delivery_source NULL), and every
#      later migration still applies on top;
#   3. every new constraint / unique index enforces its rule;
#   4. the documented rollback (schema) applies inside a transaction.
#
# Usage: bash scripts/operations/activity-delivery-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261016_1000_activity_delivery.sql"
WORKDIR="$(mktemp -d /tmp/studyus-activity-delivery-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_activity_delivery_cert"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== LEARNING_ACTIVITY_DELIVERY — local migration certification ==="
echo "Ephemeral instance: $WORKDIR (never Neon, never DEV/Stage/Production)"

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
Q() { $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$1" "$DBNAME"; }
# expects the statement to be REJECTED (constraint / unique violation)
REJECTS() {
  if $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$2" "$DBNAME" >/dev/null 2>&1; then
    echo "  FAIL -- accepted: $1"; exit 1
  fi
  echo "  OK -- rejected: $1"
}
EXPECT() {
  if [ "$2" != "$3" ]; then echo "  FAIL -- $1: got '$2', expected '$3'"; exit 1; fi
  echo "  OK -- $1 = $2"
}

echo "--- [1/5] baseline + history before $TARGET ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
echo "  OK"

echo "--- [2/5] seeding LEGACY rows (pre-migration shape) ---"
Q "INSERT INTO students (id, clerk_id, email) VALUES ('00000000-0000-0000-0000-00000000000a', 'cert:legacy', 'legacy@cert.invalid')" >/dev/null
Q "INSERT INTO profiles (id, user_type, full_name, clerk_id) VALUES ('00000000-0000-0000-0000-00000000000a', 'student', 'cert', 'cert:legacy')" >/dev/null
Q "INSERT INTO subjects (id, student_id, name) VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', 'cert')" >/dev/null
Q "INSERT INTO concepts (id, subject_id, canonical_id) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'cert-concept')" >/dev/null
Q "INSERT INTO quiz_sessions (id, student_id, subject_id, questions, expires_at) VALUES ('quiz-legacy', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', '[]', now() + interval '1 hour')" >/dev/null
Q "INSERT INTO canonical_prepared_activity (id, student_id, concept_id, stage, pedagogical_policy_version, canonical_revision, activity_contract, status, questions)
   VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'PROVE', 'v1', 'r', '{}', 'READY', '[]')" >/dev/null
echo "  OK"

echo "--- [3/5] applying $TARGET ---"
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
for t in question_bank_candidates question_bank_deliveries generation_jobs; do
  EXPECT "table $t" "$(Q "SELECT to_regclass('public.$t') IS NOT NULL")" "t"
done
EXPECT "legacy prepared row kept" "$(Q "SELECT stage||'/'||status||'/'||source||'/'||slot||'/'||coalesce(contract_fingerprint,'NULL') FROM canonical_prepared_activity WHERE id='00000000-0000-0000-0000-0000000000d1'")" "PROVE/READY/AI/0/NULL"
EXPECT "legacy session delivery_source" "$(Q "SELECT coalesce(delivery_source,'NULL') FROM quiz_sessions WHERE id='quiz-legacy'")" "NULL"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done
EXPECT "legacy rows intact after the full chain" "$(Q "SELECT count(*) FROM canonical_prepared_activity WHERE id='00000000-0000-0000-0000-0000000000d1'")" "1"

echo "--- [4/5] constraints ---"
S="'00000000-0000-0000-0000-00000000000a'"; C="'00000000-0000-0000-0000-0000000000c1'"
CAND="INSERT INTO question_bank_candidates (student_id, concept_id, activity_type, language, academic_context, academic_context_fingerprint, difficulty, question_type, answer_format, question, content_fingerprint, template_signature, generator_prompt_version)"
Q "$CAND VALUES ($S, $C, 'PROVE', 'es', '{}', 'a', 3, 'short_answer', 'text', '{}', 'fp1', '{}', 'v1')" >/dev/null
echo "  OK -- valid candidate accepted"
REJECTS "duplicate content per concept/type/language" "$CAND VALUES ($S, $C, 'PROVE', 'es', '{}', 'a', 3, 'short_answer', 'text', '{}', 'fp1', '{}', 'v1')"
REJECTS "unknown activity_type" "$CAND VALUES ($S, $C, 'QUIZ', 'es', '{}', 'a', 3, 'short_answer', 'text', '{}', 'fp2', '{}', 'v1')"
REJECTS "difficulty 6" "$CAND VALUES ($S, $C, 'PROVE', 'es', '{}', 'a', 6, 'short_answer', 'text', '{}', 'fp3', '{}', 'v1')"
REJECTS "unknown transfer_depth" "INSERT INTO question_bank_candidates (student_id, concept_id, activity_type, language, academic_context, academic_context_fingerprint, difficulty, question_type, answer_format, question, content_fingerprint, template_signature, generator_prompt_version, transfer_depth) VALUES ($S, $C, 'TRANSFER', 'es', '{}', 'a', 4, 'scenario', 'text', '{}', 'fp4', '{}', 'v1', 'FAR')"
REJECTS "missing generator_prompt_version" "INSERT INTO question_bank_candidates (student_id, concept_id, activity_type, language, academic_context, academic_context_fingerprint, difficulty, question_type, answer_format, question, content_fingerprint, template_signature) VALUES ($S, $C, 'PROVE', 'es', '{}', 'a', 3, 'short_answer', 'text', '{}', 'fp5', '{}')"
REJECTS "delivery to an unknown session" "INSERT INTO question_bank_deliveries (candidate_id, quiz_session_id, student_id) SELECT id, 'quiz-missing', $S FROM question_bank_candidates LIMIT 1"
Q "INSERT INTO question_bank_deliveries (candidate_id, quiz_session_id, student_id) SELECT id, 'quiz-legacy', $S FROM question_bank_candidates LIMIT 1" >/dev/null
REJECTS "same candidate delivered twice to one session" "INSERT INTO question_bank_deliveries (candidate_id, quiz_session_id, student_id) SELECT id, 'quiz-legacy', $S FROM question_bank_candidates LIMIT 1"

PREP="INSERT INTO canonical_prepared_activity (student_id, concept_id, stage, pedagogical_policy_version, canonical_revision, activity_contract, status, source, slot)"
Q "$PREP VALUES ($S, $C, 'PRACTICE', 'v1', 'r', '{}', 'READY', 'BANK', 0)" >/dev/null
Q "$PREP VALUES ($S, $C, 'PRACTICE', 'v1', 'r', '{}', 'READY', 'BANK', 1)" >/dev/null
echo "  OK -- PRACTICE keeps two READY slots"
REJECTS "second open row in the same slot" "$PREP VALUES ($S, $C, 'PRACTICE', 'v1', 'r', '{}', 'PREPARING', 'BANK', 1)"
Q "$PREP VALUES ($S, $C, 'PRACTICE', 'v1', 'r', '{}', 'CONSUMED', 'BANK', 1)" >/dev/null
echo "  OK -- closed rows do not occupy a slot"
REJECTS "unknown stage" "$PREP VALUES ($S, $C, 'EXAM', 'v1', 'r', '{}', 'READY', 'BANK', 0)"
REJECTS "unknown source" "$PREP VALUES ($S, $C, 'LEARN', 'v1', 'r', '{}', 'READY', 'CACHE', 0)"
Q "UPDATE canonical_prepared_activity SET status = 'EXPIRED' WHERE id = '00000000-0000-0000-0000-0000000000d1'" >/dev/null
echo "  OK -- EXPIRED is a valid status"

JOB="INSERT INTO generation_jobs (kind, dedup_key, payload)"
Q "$JOB VALUES ('PREPARE_INVENTORY', 'k1', '{}')" >/dev/null
REJECTS "second open job for one dedup key" "$JOB VALUES ('PREPARE_INVENTORY', 'k1', '{}')"
Q "UPDATE generation_jobs SET status = 'SUCCEEDED' WHERE dedup_key = 'k1'" >/dev/null
Q "$JOB VALUES ('PREPARE_INVENTORY', 'k1', '{}')" >/dev/null
echo "  OK -- a key can be re-queued once its job is closed"
REJECTS "unknown job kind" "$JOB VALUES ('SEND_EMAIL', 'k2', '{}')"
REJECTS "max_attempts 11" "INSERT INTO generation_jobs (kind, dedup_key, payload, max_attempts) VALUES ('BANK_REPLENISH', 'k3', '{}', 11)"
REJECTS "unknown delivery_source" "UPDATE quiz_sessions SET delivery_source = 'CACHE' WHERE id = 'quiz-legacy'"
Q "UPDATE quiz_sessions SET delivery_source = 'EMERGENCY_AI' WHERE id = 'quiz-legacy'" >/dev/null
echo "  OK -- EMERGENCY_AI accepted"

echo "--- [5/5] documented schema rollback applies (inside a transaction, rolled back) ---"
$PSQL -c "BEGIN;
  UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = 'ROLLBACK' WHERE status IN ('PREPARING', 'READY');
  DROP TABLE generation_jobs; DROP TABLE question_bank_deliveries; DROP TABLE question_bank_candidates;
  ALTER TABLE quiz_sessions DROP COLUMN delivery_source;
  ROLLBACK;" >/dev/null
echo "  OK"

echo ""
echo "ACTIVITY_DELIVERY_MIGRATION_CERT = PASS"
