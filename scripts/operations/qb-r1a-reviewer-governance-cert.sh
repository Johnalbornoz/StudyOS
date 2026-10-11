#!/bin/bash
# QB-R1A -- reviewer governance on an EPHEMERAL local Postgres (never hosted).
#   baseline + every migration (governed runner) + seeds -> grant contract and approval path (rolled back)
#   -> operator script: list, refused grants, dry-run grant, real grant on this ephemeral database, revoke
#   -> the review service through its own path: an unqualified approval is refused by name
# Usage: PG_BIN=/opt/homebrew/opt/postgresql@18/bin ./scripts/operations/qb-r1a-reviewer-governance-cert.sh [workdir]
set -euo pipefail
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
WORKDIR="${1:-$(mktemp -d /tmp/studyus-qb-r1a-cert.XXXXXX)}"
PORT="${PGPORT_CERT:-54396}"
PGDATA="$WORKDIR/pgdata"
DB=qb_r1a_cert
export LC_ALL=C
cleanup() { "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$PGDATA"; }
trap cleanup EXIT
mkdir -p "$WORKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null 2>&1
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$WORKDIR/postgres.log" -o "-p $PORT -h 127.0.0.1 -k ''" start >/dev/null
sleep 1
PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
TSX=("$REPO_ROOT/node_modules/.bin/tsx" --tsconfig "$REPO_ROOT/tsconfig.json")
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$DB"
"${PSQL[@]}" -c 'DROP SCHEMA public CASCADE;' "$DB"
TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$TEST_SQL"
if ! "${PSQL[@]}" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$DB" | grep -q 1; then
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
  perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
fi
"${PSQL[@]}" -f "$TEST_SQL" "$DB" >/dev/null
"${PSQL[@]}" -f "$REPO_ROOT/database/ledger/0000_baseline_ledger.sql" "$DB"
SUM=$(shasum -a 256 "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" | awk '{print $1}')
"${PSQL[@]}" -c "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '$SUM')" "$DB"
"${PSQL[@]}" -c "INSERT INTO mastery_policies (version, minimum_understanding, minimum_independence, minimum_application, minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days) SELECT 1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14 WHERE NOT EXISTS (SELECT 1 FROM mastery_policies)" "$DB"
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/$DB"
FP=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(require('crypto').createHash('sha256').update(u.hostname+'|'+u.pathname.slice(1)).digest('hex').slice(0,16))")
cd "$REPO_ROOT"
echo "--- [1] full chain + seeds"
"${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1
"${PSQL[@]}" -c "INSERT INTO users (clerk_id, email, is_system) VALUES ('system:cert-editor', NULL, true), ('system:cert-reviewer', NULL, true) ON CONFLICT (clerk_id) DO NOTHING" "$DB"
TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-apply.ts --write >/dev/null 2>&1
TRACK_B_ALLOW_EPHEMERAL="$FP" "${TSX[@]}" scripts/operations/track-b-v2-learning-catalog.ts --write >/dev/null 2>&1
Q1() { "${PSQL[@]}" -tAc "$1" "$DB"; }
echo "qualifications_after_seeds=$(Q1 "SELECT count(*) FROM question_bank_reviewer_qualifications")"
echo "--- [2] grant contract and approval path (one transaction, rolled back)"
"${TSX[@]}" scripts/operations/qb-r1a/reviewer-governance-cert.ts
echo "qualifications_after_contract_cert=$(Q1 "SELECT count(*) FROM question_bank_reviewer_qualifications")"
echo "--- [3] operator script"
Q1 "INSERT INTO users (clerk_id, is_system) VALUES ('r1a:op-reviewer', false), ('r1a:op-grantor', false)" >/dev/null
Q1 "INSERT INTO user_roles (user_id, role, status, granted_via) SELECT id, 'STUDYUS_ADMIN', 'ACTIVE', 'INVITATION' FROM users WHERE clerk_id = 'r1a:op-grantor'" >/dev/null
REV=$(Q1 "SELECT id FROM users WHERE clerk_id = 'r1a:op-reviewer'"); GR=$(Q1 "SELECT id FROM users WHERE clerk_id = 'r1a:op-grantor'"); SYS=$(Q1 "SELECT id FROM users WHERE clerk_id = 'system:cert-reviewer'")
SUBJ=$(Q1 "SELECT id FROM canonical_subjects WHERE name = 'Lectura crítica'")
mode() { node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(o.mode + (o.refusals ? ' ' + o.refusals.join(',') : ''))"; }
OP=("${TSX[@]}" scripts/operations/qb-reviewer-qualification.ts)
echo "list: $("${OP[@]}" list | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(o.qualifications + ' qualifications')")"
echo "missing input: $("${OP[@]}" grant --reviewer "$REV" --subject "$SUBJ" --exam-family PAA --granted-by "$GR" 2>&1 | tail -1 | cut -c1-80)"
echo "wildcard subject: $("${OP[@]}" grant --reviewer "$REV" --subject ALL --exam-family PAA --granted-by "$GR" --valid-from 2026-10-11T00:00:00Z --write | mode || true)"
echo "system reviewer: $("${OP[@]}" grant --reviewer "$SYS" --subject "$SUBJ" --exam-family PAA --granted-by "$GR" --valid-from 2026-10-11T00:00:00Z --write | mode || true)"
echo "self grant: $("${OP[@]}" grant --reviewer "$GR" --subject "$SUBJ" --exam-family PAA --granted-by "$GR" --valid-from 2026-10-11T00:00:00Z --write | mode || true)"
echo "unauthorized grantor: $("${OP[@]}" grant --reviewer "$GR" --subject "$SUBJ" --exam-family PAA --granted-by "$REV" --valid-from 2026-10-11T00:00:00Z --write | mode || true)"
echo "dry run: $("${OP[@]}" grant --reviewer "$REV" --subject "$SUBJ" --exam-family PAA --granted-by "$GR" --valid-from 2026-10-10T00:00:00Z | mode)"
echo "qualifications_after_dry_run_and_refusals=$(Q1 "SELECT count(*) FROM question_bank_reviewer_qualifications")"
echo "write: $("${OP[@]}" grant --reviewer "$REV" --subject "$SUBJ" --exam-family PAA --granted-by "$GR" --valid-from 2026-10-10T00:00:00Z --notes 'ephemeral certification' --write | mode)"
QID=$(Q1 "SELECT id FROM question_bank_reviewer_qualifications")
echo "qualifications_after_write=$(Q1 "SELECT count(*) FROM question_bank_reviewer_qualifications")"
echo "--- [4] the review service: named refusals, then a governed approval"
"${TSX[@]}" scripts/operations/qb-r1a/review-service-cert.ts "$REV" "$GR" "$SYS"
echo "revoke: $("${OP[@]}" revoke --qualification "$QID" --revoked-by "$GR" --reason 'end of the ephemeral certification' --write | mode)"
echo "in_force_after_revoke=$(Q1 "SELECT count(*) FROM question_bank_reviewer_qualifications WHERE revoked_at IS NULL")"
echo "QB_R1A_REVIEWER_GOVERNANCE_CERT = DONE"
