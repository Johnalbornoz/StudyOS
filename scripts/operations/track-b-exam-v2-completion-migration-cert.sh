#!/bin/bash
# Exam V2 completion block -- migration certification for
# database/migrations/20261021_1000_track_b_exam_v2_completion.sql against a
# REAL, EPHEMERAL, local-only Postgres (never Neon / DEV / Stage / Production).
#
# Proves:
#   1. baseline + full history (incl. 20261020_1000, unedited) before the target;
#      a LEGACY exam instance seeded;
#   2. the migration applies twice (idempotent); the legacy instance gets '{}';
#   3. the column is NOT NULL with a safe default and accepts a focus list;
#   4. the documented rollback applies inside a transaction (then rolled back);
#   5. optionally (CERT_APPLY_V2=1) every V2 configuration (full + structure-only)
#      and the structure catalogue apply, a second application is a no-op, and
#      structure-only definitions stay DRAFT.
#
# Usage: bash scripts/operations/track-b-exam-v2-completion-migration-cert.sh

set -euo pipefail
export LC_ALL=C
export LANG=C
export PGOPTIONS="-c client_min_messages=warning"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE_SQL="$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql"
MIGRATIONS_DIR="$REPO_ROOT/database/migrations"
TARGET="20261021_1000_track_b_exam_v2_completion.sql"
WORKDIR="$(mktemp -d /tmp/studyus-exam-v2c-cert.XXXXXX)"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
LOGFILE="$WORKDIR/postgres.log"
DBNAME="studyus_exam_v2c_cert"

cleanup() {
  if [ "${KEEP_CERT_DB:-0}" = "1" ]; then echo "KEEP_CERT_DB=1 -- leaving $WORKDIR"; return; fi
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "=== Exam V2 completion -- local migration certification ==="
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
REJECTS() {
  if $PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$2" "$DBNAME" >/dev/null 2>&1; then echo "  FAIL -- accepted: $1"; exit 1; fi
  echo "  OK -- rejected: $1"
}
EXPECT() {
  if [ "$2" != "$3" ]; then echo "  FAIL -- $1: got '$2', expected '$3'"; exit 1; fi
  echo "  OK -- $1 = $2"
}

echo "--- [1/5] baseline + history before $TARGET, legacy instance ---"
$PSQL -f "$TEST_SQL" >/dev/null
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \< "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
done
S=00000000-0000-0000-0000-00000000000a
Q "INSERT INTO students (id, clerk_id, email) VALUES ('$S', 'cert:legacy', 'legacy@cert.invalid')" >/dev/null
Q "INSERT INTO exam_definitions (id, name, exam_family, status) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Legacy exam', 'PAA', 'ACTIVE')" >/dev/null
Q "INSERT INTO exam_versions (id, exam_definition_id, version_label, status) VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'v1', 'PUBLISHED')" >/dev/null
Q "INSERT INTO assessment_components (id, exam_version_id, name, component_type) VALUES ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2', 'Legacy section', 'SECTION')" >/dev/null
Q "INSERT INTO student_exam_profiles (id, student_id, exam_definition_id) VALUES ('00000000-0000-0000-0000-0000000000e4', '$S', '00000000-0000-0000-0000-0000000000e1')" >/dev/null
I="INSERT INTO exam_instances (id, student_id, exam_profile_id, exam_version_id, component_ids, mode, timing_mode, status)"
V="'$S', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', ARRAY['00000000-0000-0000-0000-0000000000e3']::uuid[]"
Q "$I VALUES ('00000000-0000-0000-0000-0000000000f1', $V, 'PRACTICE', 'UNTIMED', 'READY')" >/dev/null
echo "  OK"

echo "--- [2/5] applying $TARGET (twice: idempotent) ---"
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
$PSQL -f "$MIGRATIONS_DIR/$TARGET" >/dev/null
EXPECT "legacy instance focus is empty" "$(Q "SELECT focus_objective_ids = '{}'::uuid[] FROM exam_instances WHERE id='00000000-0000-0000-0000-0000000000f1'")" "t"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ "$(basename "$f")" \> "$TARGET" ] || continue
  $PSQL -f "$f" >/dev/null
  echo "  OK -- later migration $(basename "$f") applies on top"
done

echo "--- [3/5] column contract ---"
EXPECT "focus_objective_ids NOT NULL with default" "$(Q "SELECT is_nullable||'|'||(column_default IS NOT NULL) FROM information_schema.columns WHERE table_name='exam_instances' AND column_name='focus_objective_ids'")" "NO|true"
REJECTS "NULL focus list" "UPDATE exam_instances SET focus_objective_ids = NULL WHERE id='00000000-0000-0000-0000-0000000000f1'"
Q "UPDATE exam_instances SET focus_objective_ids = ARRAY['00000000-0000-0000-0000-0000000000aa']::uuid[] WHERE id='00000000-0000-0000-0000-0000000000f1'" >/dev/null
EXPECT "focus list stored" "$(Q "SELECT cardinality(focus_objective_ids) FROM exam_instances WHERE id='00000000-0000-0000-0000-0000000000f1'")" "1"

echo "--- [4/5] documented rollback (inside a transaction, then ROLLBACK) ---"
ROLLBACK_SQL="BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY);
$(sed -n '/^-- Rollback/,/^-- ----/p' "$MIGRATIONS_DIR/$TARGET" | sed -e '1d;$d' -e 's/^--   //')
SELECT 'rollback-ok';
ROLLBACK;"
EXPECT "rollback statements apply" "$($PG_BIN/psql -h "$SOCKDIR" -U postgres -v ON_ERROR_STOP=1 -tAq -c "$ROLLBACK_SQL" "$DBNAME" | grep -c rollback-ok)" "1"
EXPECT "column intact after ROLLBACK" "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_name='exam_instances' AND column_name='focus_objective_ids'")" "1"

echo "--- [5/5] every V2 configuration + structure catalogue on the ephemeral DB ---"
if [ "${CERT_APPLY_V2:-0}" = "1" ]; then
  Q "DELETE FROM exam_instances; DELETE FROM student_exam_profiles; DELETE FROM assessment_components; DELETE FROM exam_versions; DELETE FROM exam_definitions;" >/dev/null
  Q "INSERT INTO users (clerk_id, email, is_system) VALUES ('cert_editor', 'e@cert.invalid', true), ('cert_reviewer', 'r@cert.invalid', true)" >/dev/null
  export DATABASE_URL="postgresql://postgres@localhost/$DBNAME?host=$SOCKDIR"
  FP=$(node -e 'const c=require("crypto");const u=new URL(process.env.DATABASE_URL);console.log(c.createHash("sha256").update(u.hostname+"|"+u.pathname.slice(1)).digest("hex").slice(0,16))')
  N=$(cd "$REPO_ROOT" && npx tsx -e 'import("@/lib/exam-core/verticals/v2/all").then(m => console.log(m.allV2Configs().length))' 2>/dev/null | tail -1)
  NS=$(cd "$REPO_ROOT" && npx tsx -e 'import("@/lib/exam-core/verticals/v2/all").then(m => console.log(m.allV2Configs().filter(c => c.structureOnly).length))' 2>/dev/null | tail -1)
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-v2-apply.ts --write) > "$WORKDIR/apply1.log"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$FP" npx tsx scripts/operations/track-b-v2-apply.ts --write) > "$WORKDIR/apply2.log"
  EXPECT "first application created every configuration" "$(grep -c '"noop":false' "$WORKDIR/apply1.log")" "$N"
  EXPECT "second application is a no-op" "$(grep -c '"noop":true' "$WORKDIR/apply2.log")" "$N"
  EXPECT "no unresolved bindings" "$(grep -o '"unresolvedBindings":\[\]' "$WORKDIR/apply2.log" | wc -l | tr -d ' ')" "1"
  EXPECT "structure-only definitions are DRAFT (never in a learner catalogue)" "$(Q "SELECT count(*) FROM exam_definitions WHERE status='DRAFT'")" "$NS"
  EXPECT "readiness stored on bound nodes (none missing)" "$(Q "SELECT count(*) FROM assessment_structure_nodes WHERE exam_version_id IS NOT NULL AND NOT (metadata ? 'readiness')")" "0"
  EXPECT "PAA full test is FULL_MOCK_READY" "$(Q "SELECT metadata->'readiness'->>'state' FROM assessment_structure_nodes WHERE node_key='paa.full'")" "FULL_MOCK_READY"
  EXPECT "a structure-only subject is STRUCTURE_READY" "$(Q "SELECT metadata->'readiness'->>'state' FROM assessment_structure_nodes WHERE node_key='ib.dp.economics.hl'")" "STRUCTURE_READY"
  EXPECT "CAS is not examinable" "$(Q "SELECT coalesce(metadata->>'notExaminable','false') FROM assessment_structure_nodes WHERE node_key='ib.dp.cas'")" "true"
  echo "  configurations: $N ($NS structure-only)"
else
  echo "  SKIPPED (set CERT_APPLY_V2=1)"
fi

echo "=== EXAM_V2_COMPLETION_MIGRATION_CERT = PASS ==="
