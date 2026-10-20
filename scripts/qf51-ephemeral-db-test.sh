#!/bin/bash
# QF V5.1 -- migration order and persistence tests against an EPHEMERAL, throwaway local Postgres.
#
# Never DEV, Stage, Production or any Neon database; never reads .env or DATABASE_URL. The cluster lives in a
# temporary directory, listens on 127.0.0.1 on a free port, and is destroyed on exit.
#   1. baseline + every earlier migration;
#   2. migration 87, AD_HOC concept exams (20261121_1000_student_scheduled_assessments), read from the frozen
#      AD_HOC integration commit (ADHOC_REF) -- it is another line's file and is not copied into this worktree.
#      That file includes the Student's chosen difficulty (difficulty_band + its CHECK); the test requires both;
#   3. migration 88, QF V5.1 (20261121_1100_qf51_construct_core_lineage);
#   4. both again (re-application must be safe), then: no AD_HOC object removed, no QF object missing, every
#      constraint valid;
#   5. tests/unit/qf51-construct-core-persistence.test.ts against that database (QF51_TEST_DATABASE_URL).
#
# Usage: ./scripts/qf51-ephemeral-db-test.sh        Requires a local postgres toolchain (PG_BIN) and npx.
#   ADHOC_REF   the frozen AD_HOC integration commit whose migration 87 is the input. The default is pinned to the
#               full SHA of that commit, so the input is exact; a moved or shortened ref is resolved and printed.
set -uo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@14/bin}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADHOC_REF="${ADHOC_REF:-557707fa6ae55990972c4336506a323167a0a86a}"
ADHOC_NAME="20261121_1000_student_scheduled_assessments.sql"
QF_NAME="20261121_1100_qf51_construct_core_lineage.sql"
W="$(mktemp -d /tmp/studyus-qf51.XXXXXX)"
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
DB="qf51_throwaway"
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
  case "$(basename "$f")" in 20261121_*) continue ;; esac
  $P -1 -f "$f" "$DB" >/dev/null 2>"$W/err" || { echo "PRIOR_MIGRATION = FAIL $(basename "$f")"; head -3 "$W/err"; exit 1; }
  n=$((n + 1))
done
echo "baseline + $n prior migrations = OK"

# the two migrations may not share a file name prefix: the ledger keys on it
A_PREFIX="${ADHOC_NAME:0:13}"; Q_PREFIX="${QF_NAME:0:13}"
[ "$A_PREFIX" != "$Q_PREFIX" ] && [ "$A_PREFIX" \< "$Q_PREFIX" ] && echo "MIGRATION_COLLISION = NO ($A_PREFIX < $Q_PREFIX)" || { echo "MIGRATION_COLLISION = YES ($A_PREFIX / $Q_PREFIX)"; exit 1; }
[ -e "$REPO/database/migrations/20261121_1000_qf51_construct_core_lineage.sql" ] && { echo "OLD_QF51_FILENAME_STILL_PRESENT"; exit 1; }

ADHOC_SHA="$(git -C "$REPO" rev-parse --verify --quiet "$ADHOC_REF^{commit}")" || { echo "MIGRATION_ORDER = NOT_VERIFIED: $ADHOC_REF is not a commit of this repository"; exit 1; }
echo "AD_HOC_SOURCE_COMMIT = $ADHOC_SHA   migration sha256 = $(git -C "$REPO" show "$ADHOC_SHA:database/migrations/$ADHOC_NAME" | shasum -a 256 | cut -c1-16)"
git -C "$REPO" show "$ADHOC_SHA:database/migrations/$ADHOC_NAME" > "$W/adhoc.sql" 2>"$W/err" || { echo "MIGRATION_ORDER = NOT_VERIFIED: $ADHOC_NAME is not in $ADHOC_REF"; head -2 "$W/err"; exit 1; }
M="$REPO/database/migrations/$QF_NAME"
objects() { Q "SELECT string_agg(x, ',' ORDER BY x) FROM (SELECT 't:' || tablename AS x FROM pg_tables WHERE schemaname = 'public' UNION ALL SELECT 'v:' || viewname FROM pg_views WHERE schemaname = 'public' UNION ALL SELECT 'c:' || conrelid::regclass || '.' || conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace UNION ALL SELECT 'i:' || indexname FROM pg_indexes WHERE schemaname = 'public' UNION ALL SELECT 'col:' || table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public') s"; }
objects | tr ',' '\n' | sort > "$W/before.txt"
invalid() { Q "SELECT conrelid::regclass || '.' || conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated ORDER BY 1"; }
invalid > "$W/invalid-before.txt"

$P -1 -f "$W/adhoc.sql" "$DB" >/dev/null 2>"$W/err" && echo "APPLY   87 $ADHOC_NAME (${ADHOC_SHA:0:7}) = OK" || { echo "APPLY 87 = FAIL"; head -5 "$W/err"; exit 1; }
objects | tr ',' '\n' | sort > "$W/after87.txt"
comm -13 "$W/before.txt" "$W/after87.txt" > "$W/adhoc-objects.txt"
$P -1 -f "$M" "$DB" >/dev/null 2>"$W/err" && echo "APPLY   88 $QF_NAME = OK" || { echo "APPLY 88 = FAIL"; head -5 "$W/err"; exit 1; }
objects | tr ',' '\n' | sort > "$W/after88.txt"
comm -13 "$W/after87.txt" "$W/after88.txt" > "$W/qf-objects.txt"
$P -1 -f "$W/adhoc.sql" "$DB" >/dev/null 2>"$W/err" && echo "REAPPLY 87 = OK (idempotent)" || { echo "REAPPLY 87 = FAIL"; head -5 "$W/err"; exit 1; }
$P -1 -f "$M" "$DB" >/dev/null 2>"$W/err" && echo "REAPPLY 88 = OK (idempotent)" || { echo "REAPPLY 88 = FAIL"; head -5 "$W/err"; exit 1; }
objects | tr ',' '\n' | sort > "$W/final.txt"

LOST_ADHOC="$(comm -23 "$W/adhoc-objects.txt" "$W/final.txt" | wc -l | tr -d ' ')"
LOST_QF="$(comm -23 "$W/qf-objects.txt" "$W/final.txt" | wc -l | tr -d ' ')"
LOST_PRIOR="$(comm -23 "$W/before.txt" "$W/final.txt" | wc -l | tr -d ' ')"
SHARED="$(comm -12 "$W/adhoc-objects.txt" "$W/qf-objects.txt" | wc -l | tr -d ' ')"
invalid > "$W/invalid-final.txt"
# constraints an EARLIER migration left NOT VALID on purpose are not this pair's doing: only new ones count
INVALID="$(comm -13 "$W/invalid-before.txt" "$W/invalid-final.txt" | wc -l | tr -d ' ')"
echo "NOT VALID before 87: $(tr '\n' ' ' < "$W/invalid-before.txt")"
echo "AD_HOC objects created: $(wc -l < "$W/adhoc-objects.txt" | tr -d ' ') (tables: $(grep -c '^t:' "$W/adhoc-objects.txt"))   lost after 88 and re-application: $LOST_ADHOC"
echo "QF V5.1 objects created: $(wc -l < "$W/qf-objects.txt" | tr -d ' ') (tables: $(grep -c '^t:' "$W/qf-objects.txt"))   lost after re-application: $LOST_QF"
echo "earlier objects lost: $LOST_PRIOR   objects created by both: $SHARED   constraints left not valid by 87/88: $INVALID"
# the AD_HOC difficulty (added to migration 87 after its first version) must be there, and still there at the end
DIFF_COL="$(grep -c '^col:student_scheduled_assessments.difficulty_band$' "$W/final.txt")"
DIFF_CHECK="$(Q "SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.student_scheduled_assessments'::regclass AND conname = 'student_scheduled_assessments_difficulty_check' AND contype = 'c' AND convalidated")"
echo "AD_HOC difficulty_band column: $DIFF_COL   difficulty CHECK (validated): $DIFF_CHECK   $(Q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'student_scheduled_assessments_difficulty_check'" | cut -c1-140)"
echo "QF tables: $(grep '^t:' "$W/qf-objects.txt" | sed 's/^t://' | tr '\n' ' ')"
if [ "$LOST_ADHOC" = "0" ] && [ "$LOST_QF" = "0" ] && [ "$LOST_PRIOR" = "0" ] && [ "$SHARED" = "0" ] && [ "$INVALID" = "0" ] && [ "$(grep -c '^t:' "$W/qf-objects.txt")" = "8" ] && [ "$(grep -c '^t:' "$W/adhoc-objects.txt")" -ge 1 ] && [ "$DIFF_COL" = "1" ] && [ "$DIFF_CHECK" = "1" ]; then echo "MIGRATION_ORDER_TEST = PASS"; else echo "MIGRATION_ORDER_TEST = FAIL"; exit 1; fi

cd "$REPO" && QF51_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/$DB" npx vitest run tests/unit/qf51-construct-core-persistence.test.ts 2>&1 | grep -E "✓|×|Test Files|Tests |Error|expected|Received|rejects" | cut -c1-260
exit "${PIPESTATUS[0]}"
