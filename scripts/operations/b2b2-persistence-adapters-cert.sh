#!/bin/bash
# B2-B2 -- B2 persistence adapters and protected runtime on an EPHEMERAL local Postgres (never Neon, never hosted).
#
#   baseline + ledger -> governed runner applies EVERY migration -> seeds (V2 catalogue, learning catalogue)
#   -> adapters certification (fixture content, variant, frozen form: written and rolled back in ONE transaction)
#   -> the database is byte-for-byte what it was before the certification
#
# The database setup is the one of b2b1-persistence-schema-cert.sh (copied, not shared: that script stays as it is).
#
# Usage: PG_BIN=/opt/homebrew/opt/postgresql@18/bin ./scripts/operations/b2b2-persistence-adapters-cert.sh [workdir]

set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
WORKDIR="${1:-$(mktemp -d /tmp/studyus-b2b2-cert.XXXXXX)}"
PORT="${PGPORT_CERT:-54397}"
PGDATA="$WORKDIR/pgdata"
export LC_ALL=C

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
}
trap cleanup EXIT

mkdir -p "$WORKDIR"
"$PG_BIN/initdb" -D "$PGDATA" -U postgres --no-locale --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$WORKDIR/postgres.log" -o "-p $PORT -h 127.0.0.1 -k ''" start >/dev/null
sleep 1
PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
TSX=("$REPO_ROOT/node_modules/.bin/tsx" --tsconfig "$REPO_ROOT/tsconfig.json")

TEST_SQL="$WORKDIR/baseline-for-test.sql"
cp "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$TEST_SQL"
SUM=$(shasum -a 256 "$REPO_ROOT/database/baseline/STUDYUS_BASELINE_2026_08.sql" | awk '{print $1}')

new_db() {
  local db="$1"
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$db"
  "${PSQL[@]}" -c 'DROP SCHEMA public CASCADE;' "$db"
  if ! "${PSQL[@]}" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" "$db" | grep -q 1; then
    perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
    perl -0pi -e 's/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1  -- SKIPPED (pgvector not installed locally)/m' "$TEST_SQL"
  fi
  "${PSQL[@]}" -f "$TEST_SQL" "$db"
  "${PSQL[@]}" -f "$REPO_ROOT/database/ledger/0000_baseline_ledger.sql" "$db"
  "${PSQL[@]}" -c "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '$SUM')" "$db"
  "${PSQL[@]}" -c "INSERT INTO mastery_policies (version, minimum_understanding, minimum_independence, minimum_application, minimum_retention, minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count, minimum_independent_evidence_count, retention_min_gap_days, validation_window_days) SELECT 1, 80, 80, 75, 75, 70, true, 0, 3, 2, 3, 14 WHERE NOT EXISTS (SELECT 1 FROM mastery_policies)" "$db"
  export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/$db"
}
seed() {
  local db="$1" fp
  fp=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(require('crypto').createHash('sha256').update(u.hostname+'|'+u.pathname.slice(1)).digest('hex').slice(0,16))")
  "${PSQL[@]}" -c "INSERT INTO users (clerk_id, email, is_system) VALUES ('system:cert-editor', NULL, true), ('system:cert-reviewer', NULL, true) ON CONFLICT (clerk_id) DO NOTHING" "$db"
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$fp" "${TSX[@]}" scripts/operations/track-b-v2-apply.ts --write 2>&1 | tail -2 | cut -c1-240)
  (cd "$REPO_ROOT" && TRACK_B_ALLOW_EPHEMERAL="$fp" "${TSX[@]}" scripts/operations/track-b-v2-learning-catalog.ts --write 2>&1 | tail -1 | cut -c1-240)
}
# Everything the certification could have touched: it must come out of it untouched.
snapshot() {
  "${PSQL[@]}" -tA "$1" <<'SQL'
SELECT 'blueprints=' || count(*) || ' legacy=' || count(*) FILTER (WHERE purpose IS NULL) || ' md5=' || md5(string_agg(id::text || exam_version_id::text || status || coalesce(purpose, ''), ',' ORDER BY id)) FROM assessment_blueprints;
SELECT 'blueprint_targets=' || count(*) FROM blueprint_objective_targets;
SELECT 'b2_rows=' || ((SELECT count(*) FROM assessment_blueprint_requirements) + (SELECT count(*) FROM assessment_blueprint_requirement_sources) + (SELECT count(*) FROM assessment_frozen_forms) + (SELECT count(*) FROM assessment_frozen_form_positions));
SELECT 'qb_rows=' || ((SELECT count(*) FROM question_bank_content_rights) + (SELECT count(*) FROM question_bank_stimuli) + (SELECT count(*) FROM question_bank_item_stimulus) + (SELECT count(*) FROM question_bank_item_concepts) + (SELECT count(*) FROM question_bank_pool_memberships) + (SELECT count(*) FROM question_bank_reviewer_qualifications) + (SELECT count(*) FROM question_bank_reviews) + (SELECT count(*) FROM question_bank_stimulus_reviews));
SELECT 'bank_items=' || count(*) || ' versions=' || (SELECT count(*) FROM approved_items) || ' usage=' || (SELECT count(*) FROM exam_item_usage) || ' students=' || (SELECT count(*) FROM students) || ' users=' || (SELECT count(*) FROM users) FROM question_bank_items;
SELECT 'instances_with_frozen_form=' || count(*) FROM exam_instances WHERE frozen_form_id IS NOT NULL;
SQL
}

echo "=== B2-B2: from zero"
new_db b2b2_adapters
echo "--- [1] governed runner: every migration"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-migrate.ts 2>&1 | tail -1)
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/db-status.ts 2>&1 | tail -3)
echo "--- [2] seeds (V2 catalogue + fixtures, learning catalogue)"
seed b2b2_adapters
snapshot b2b2_adapters > "$WORKDIR/before"
cat "$WORKDIR/before"
echo "--- [3] adapters, carriers, units, protected selection, frozen form, legacy readers (one transaction, rolled back)"
(cd "$REPO_ROOT" && "${TSX[@]}" scripts/operations/b2b2/persistence-adapters-cert.ts)
snapshot b2b2_adapters | diff - "$WORKDIR/before" >/dev/null && echo "certification_left_no_trace=YES"
echo "--- [4] seeds again: the hardened catalogue writers still work and change nothing"
seed b2b2_adapters >/dev/null
snapshot b2b2_adapters | diff - "$WORKDIR/before" >/dev/null && echo "seed_rerun_changed_nothing=YES"
echo "B2B2_PERSISTENCE_ADAPTERS_CERT = DONE"
