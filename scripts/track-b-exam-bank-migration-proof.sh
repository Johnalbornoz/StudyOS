#!/bin/bash
# TRACK B -- Exam Bank convergence: the integrated migration sequence against an EPHEMERAL, throwaway local Postgres.
#
# Never DEV, Stage, Production or any Neon database; never reads .env or DATABASE_URL. The cluster lives in a
# temporary directory, listens on 127.0.0.1 on a free port, and is destroyed on exit.
#
# Derived from scripts/qf-step4b-ephemeral-db-test.sh (QF V5.2 EXAM BANK SOURCE, kept as imported). What differs:
#   - every file is read from THIS worktree (Track B now holds all five);
#   - the QF V5.2 file is read from database/migrations once promoted, from the proposal directory before that;
#   - APPLY_ORDER chooses the order the five are applied in:
#       LEXICAL      87 88 89 90 91   a fresh database (the runner applies pending files in file-name order)
#       ENVIRONMENT  87 89 90 88 91   DEV and Preview: their ledger (89) already holds 87, 89 and 90, so the
#                                     runner applies 88 (QF V5.1) and then 91 (QF V5.2) on top of them
#   Both must pass: no collision, no object lost, no weaker eligibility view left standing.
set -uo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@14/bin}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME52="20261122_1200_qf52_exam_bank_certification_coverage.sql"
PROPOSAL="$REPO/database/migrations/$NAME52"
[ -e "$PROPOSAL" ] || PROPOSAL="$REPO/docs/exams/question-factory/v52/proposed/$NAME52"
APPLY_ORDER="${APPLY_ORDER:-LEXICAL}"
E87="87:20261121_1000_student_scheduled_assessments.sql:WORKTREE"; E88="88:20261121_1100_qf51_construct_core_lineage.sql:WORKTREE"
E89="89:20261122_1000_learner_concept_curriculum_provenance.sql:WORKTREE"; E90="90:20261122_1100_canonical_concept_reviewed_aliases.sql:WORKTREE"; E91="91:$NAME52:PROPOSAL"
case "$APPLY_ORDER" in
  LEXICAL) SEQ=("$E87" "$E88" "$E89" "$E90" "$E91") ;;
  ENVIRONMENT) SEQ=("$E87" "$E89" "$E90" "$E88" "$E91") ;;
  *) echo "APPLY_ORDER must be LEXICAL or ENVIRONMENT"; exit 1 ;;
esac
echo "APPLY_ORDER = $APPLY_ORDER   QF V5.2 file read from: ${PROPOSAL#$REPO/}"
LAST=91
W="$(mktemp -d /tmp/studyus-trackb.XXXXXX)"
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
DB="qf4b_throwaway"
cleanup() { "$PG_BIN/pg_ctl" -D "$W/d" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$W"; }
trap cleanup EXIT

"$PG_BIN/initdb" -D "$W/d" -U postgres --no-locale --encoding=UTF8 >/dev/null 2>&1
echo "listen_addresses = '127.0.0.1'" >> "$W/d/postgresql.conf"
echo "port = $PORT" >> "$W/d/postgresql.conf"
echo "unix_socket_directories = '$W'" >> "$W/d/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$W/d" -l "$W/log" start >/dev/null
sleep 1
P="$PG_BIN/psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
Q() { $P -At -c "$1" "$DB"; }

"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$DB"
$P -c 'DROP SCHEMA public CASCADE;' "$DB"
cp "$REPO/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$W/b.sql"
perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1/m; s/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1/m; s/^SET transaction_timeout = 0;$/-- skipped (PG17+)/m' "$W/b.sql"
$P -f "$W/b.sql" "$DB" >/dev/null 2>"$W/err" || { echo "BASELINE = FAIL"; head -5 "$W/err"; exit 1; }
$P -f "$REPO/database/ledger/0000_baseline_ledger.sql" "$DB" >/dev/null
n=0
for f in $(ls "$REPO"/database/migrations/*.sql | sort); do
  case "$(basename "$f")" in 20261121_*|20261122_*) continue ;; esac
  $P -1 -f "$f" "$DB" >/dev/null 2>"$W/err" || { echo "PRIOR_MIGRATION = FAIL $(basename "$f")"; head -3 "$W/err"; exit 1; }
  n=$((n + 1))
done
echo "baseline + $n prior migrations = OK"

# the ledger keys on the 13-character prefix: the five must be distinct and in ascending order
PREV=""; ORDER=""
for e in "${SEQ[@]}"; do
  IFS=: read -r k name src <<< "$e"
  pre="${name:0:13}"
  [ "$APPLY_ORDER" = "LEXICAL" ] && [ -n "$PREV" ] && { [ "$PREV" \< "$pre" ] || { echo "MIGRATION_PREFIX_ORDER = FAIL ($PREV / $pre)"; exit 1; }; }
  PREV="$pre"; ORDER="$ORDER $k=$pre"
  if [ "$src" = "WORKTREE" ]; then cp "$REPO/database/migrations/$name" "$W/m$k.sql"
  elif [ "$src" = "PROPOSAL" ]; then cp "$PROPOSAL" "$W/m$k.sql"
  else
    sha="$(git -C "$REPO" rev-parse --verify --quiet "$src^{commit}")" || { echo "MIGRATION_ORDER = NOT_VERIFIED: commit $src not found"; exit 1; }
    git -C "$REPO" show "$sha:database/migrations/$name" > "$W/m$k.sql" 2>"$W/err" || { echo "MIGRATION_ORDER = NOT_VERIFIED: $name is not in ${sha:0:7}"; exit 1; }
    echo "source $k: $name @ ${sha:0:7} sha256 $(shasum -a 256 "$W/m$k.sql" | cut -c1-12)"
  fi
done
[ "$(printf '%s\n' "${SEQ[@]}" | cut -d: -f2 | cut -c1-13 | sort -u | wc -l | tr -d ' ')" = "5" ] || { echo "MIGRATION_PREFIX_COLLISION = YES"; exit 1; }
echo "MIGRATION_PREFIXES_DISTINCT = OK   applied in: $ORDER"

objects() { Q "SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT 't:' || tablename AS x FROM pg_tables WHERE schemaname = 'public' UNION ALL SELECT 'v:' || viewname FROM pg_views WHERE schemaname = 'public' UNION ALL SELECT 'c:' || conrelid::regclass || '.' || conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace UNION ALL SELECT 'i:' || indexname FROM pg_indexes WHERE schemaname = 'public' UNION ALL SELECT 'col:' || table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public') s"; }
objects | tr ',' '\n' | sort > "$W/s86.txt"
prev=86
for e in "${SEQ[@]}"; do
  k="${e%%:*}"
  $P -1 -f "$W/m$k.sql" "$DB" >/dev/null 2>"$W/err" && echo "APPLY   $k = OK" || { echo "APPLY $k = FAIL"; head -8 "$W/err"; exit 1; }
  objects | tr ',' '\n' | sort > "$W/s$k.txt"
  comm -13 "$W/s$prev.txt" "$W/s$k.txt" > "$W/created$k.txt"
  prev="$k"
done
# A file is re-applied only by its own supported semantics. 87, 88 and the proposal are written to be re-applied.
# 89 and 90 are another line's files with a one-time ledger contract (plain CREATE TABLE): that is reported, not
# required. The proposal is re-applied LAST: 88 re-creates the Student supply view in its own, narrower terms.
for e in "${SEQ[@]}"; do
  k="${e%%:*}"
  if $P -1 -f "$W/m$k.sql" "$DB" >/dev/null 2>"$W/err"; then echo "REAPPLY $k = OK (idempotent)"
  elif [ "$k" = "89" ] || [ "$k" = "90" ]; then echo "REAPPLY $k = ONE_TIME (not this line's file; the ledger applies it once): $(head -1 "$W/err" | sed 's/^.*ERROR: *//')"
  else echo "REAPPLY $k = FAIL"; head -8 "$W/err"; exit 1; fi
done
objects | tr ',' '\n' | sort > "$W/final.txt"
ORDER_LOST=0
for e in "${SEQ[@]}"; do
  k="${e%%:*}"
  lost="$(comm -23 "$W/created$k.txt" "$W/final.txt" | wc -l | tr -d ' ')"
  echo "objects created by $k: $(wc -l < "$W/created$k.txt" | tr -d ' ') (tables: $(grep -c '^t:' "$W/created$k.txt"))   lost at the end: $lost"
  ORDER_LOST=$((ORDER_LOST + lost))
done
SHARED="$(cat "$W"/created*.txt | sort | uniq -d | wc -l | tr -d ' ')"
PRIOR_LOST="$(comm -23 "$W/s86.txt" "$W/final.txt" | wc -l | tr -d ' ')"
echo "earlier objects lost: $PRIOR_LOST   objects created by more than one of the five: $SHARED"
[ "$ORDER_LOST" = "0" ] && [ "$SHARED" = "0" ] && [ "$PRIOR_LOST" = "0" ] && echo "MIGRATION_SEQUENCE_$APPLY_ORDER = PASS" || { echo "MIGRATION_SEQUENCE_$APPLY_ORDER = FAIL"; exit 1; }

DRIFT="$(comm -3 "$W/s$LAST.txt" "$W/final.txt" | wc -l | tr -d ' ')"
NEW_TABLES="$(grep '^t:' "$W/created$LAST.txt" | sed 's/^t://' | tr '\n' ' ')"
INVALID="$(Q "SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated AND conrelid::regclass::text LIKE 'assessment_%'")"
ROWS="$(Q "SELECT (SELECT count(*) FROM assessment_reviewer_qualifications) + (SELECT count(*) FROM assessment_certifications) + (SELECT count(*) FROM assessment_blueprint_classifications) + (SELECT count(*) FROM assessment_renderer_envelopes) + (SELECT count(*) FROM assessment_certification_policies) + (SELECT count(*) FROM assessment_object_certifications) + (SELECT count(*) FROM assessment_coverage_snapshots)")"
echo "drift on re-application: $DRIFT   constraints left not valid: $INVALID   rows inserted by the proposal: $ROWS"
echo "new tables: $NEW_TABLES"
[ "$DRIFT" = "0" ] && [ "$INVALID" = "0" ] && [ "$ROWS" = "0" ] && echo "PROPOSAL_IS_ADDITIVE = PASS" || { echo "PROPOSAL_IS_ADDITIVE = FAIL"; exit 1; }

$P -f "$REPO/scripts/operations/qf-step4b/certification-model-assertions.sql" "$DB" 2>"$W/err" | grep -E '^(ok|FAIL) ' > "$W/assert.txt"
[ -s "$W/err" ] && { echo "ASSERTION_SCRIPT_ERROR"; head -8 "$W/err"; }
cat "$W/assert.txt"
OK="$(grep -c '^ok ' "$W/assert.txt")"; BAD="$(grep -c '^FAIL ' "$W/assert.txt")"
echo "assertions: $OK ok, $BAD failed"
[ "$BAD" = "0" ] && [ "$OK" = "58" ] && [ ! -s "$W/err" ] && echo "CERTIFICATION_MODEL_BEHAVIOUR = PASS" || { echo "CERTIFICATION_MODEL_BEHAVIOUR = FAIL"; exit 1; }

# POST-MIGRATION INVARIANT. Migration 88 re-creates the Student eligibility view in its own, weaker terms. Replayed
# alone after the proposal it must be DETECTED; with the proposal applied again the strongest view is left standing.
INV() { Q "SELECT COALESCE(public.assessment_supply_view_invariant(), 'OK')"; }
[ "$(INV)" = "OK" ] || { echo "VIEW_INVARIANT_AFTER_THE_PROPOSAL = FAIL ($(INV))"; exit 1; }
$P -1 -f "$W/m88.sql" "$DB" >/dev/null 2>"$W/err" || { echo "REPLAY 88 = FAIL"; head -5 "$W/err"; exit 1; }
WEAK="$(INV)"
[ "$WEAK" = "WEAKER_STUDENT_ELIGIBILITY_VIEW_IS_ACTIVE" ] || { echo "VIEW_INVARIANT_DETECTS_A_WEAKER_VIEW = FAIL (after replaying 88 alone it says: $WEAK)"; exit 1; }
$P -1 -f "$W/m$LAST.sql" "$DB" >/dev/null 2>"$W/err" || { echo "REAPPLY $LAST AFTER 88 = FAIL"; head -5 "$W/err"; exit 1; }
[ "$(INV)" = "OK" ] && echo "STRONGEST_ELIGIBILITY_VIEW_INVARIANT = PASS (88 replayed alone is detected: $WEAK; $LAST restores it)" || { echo "STRONGEST_ELIGIBILITY_VIEW_INVARIANT = FAIL ($(INV))"; exit 1; }
