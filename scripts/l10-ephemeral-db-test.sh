#!/bin/bash
# L10 SHARED FOUNDATION -- migration series + guard integration test.
#
# Builds an EPHEMERAL, throwaway local Postgres (never DEV, Stage, Production
# or any Neon database; never reads .env or DATABASE_URL), then:
#   1. applies the baseline and every migration that precedes the L10 batch;
#   2. applies the five L10 migrations (20261120_*) in order, each in its own
#      transaction, and applies them a second time to prove idempotency;
#   3. proves the SF-10 pre-check refuses to apply over a multi-persona account;
#   4. runs scripts/operations/l10-foundation-integration.ts: the real guards
#      and the real parent service against that database.
#
# Usage: ./scripts/l10-ephemeral-db-test.sh
# Requires a local postgres/initdb/psql toolchain (PG_BIN) and `npx tsx`.
# Same technique and same baseline substitutions as db-migration-test.sh.
set -uo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@14/bin}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d /tmp/studyus-l10.XXXXXX)"
SOCK="$W/s"
mkdir -p "$SOCK"
cleanup() { "$PG_BIN/pg_ctl" -D "$W/d" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$W"; }
trap cleanup EXIT

"$PG_BIN/initdb" -D "$W/d" -U postgres --no-locale --encoding=UTF8 >/dev/null 2>&1
echo "unix_socket_directories = '$SOCK'" >> "$W/d/postgresql.conf"
echo "listen_addresses = ''" >> "$W/d/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$W/d" -l "$W/log" -o "-h ''" start >/dev/null
sleep 1
P="$PG_BIN/psql -h $SOCK -U postgres -v ON_ERROR_STOP=1 -q"

build_db() { # $1 = database name; baseline + all pre-L10 migrations
  "$PG_BIN/createdb" -h "$SOCK" -U postgres "$1"
  $P -c 'DROP SCHEMA public CASCADE;' "$1"
  cp "$REPO/database/baseline/STUDYUS_BASELINE_2026_08.sql" "$W/b.sql"
  perl -0pi -e 's/^(    chunk_embedding public\.vector\(1536\),)$/    -- $1/m; s/^(CREATE INDEX content_chunks_embedding_idx.*)$/-- $1/m; s/^SET transaction_timeout = 0;$/-- skipped (PG17+)/m' "$W/b.sql"
  $P -f "$W/b.sql" "$1" >/dev/null 2>"$W/err" || { echo "BASELINE = FAIL"; head -5 "$W/err"; exit 1; }
  $P -f "$REPO/database/ledger/0000_baseline_ledger.sql" "$1" >/dev/null
  local n=0
  for f in $(ls "$REPO"/database/migrations/*.sql | sort); do
    case "$(basename "$f")" in 20261120_*) continue ;; esac
    $P -1 -f "$f" "$1" >/dev/null 2>"$W/err" || { echo "PRIOR_MIGRATION = FAIL $(basename "$f")"; head -3 "$W/err"; exit 1; }
    n=$((n + 1))
  done
  echo "[$1] baseline + $n prior migrations = OK"
}

echo "=== 1-2. L10 migration series ==="
build_db l10
for f in $(ls "$REPO"/database/migrations/20261120_*.sql | sort); do
  $P -1 -f "$f" l10 >/dev/null 2>"$W/err" && echo "APPLY   $(basename "$f") = OK" || { echo "APPLY   $(basename "$f") = FAIL"; head -3 "$W/err"; exit 1; }
done
for f in $(ls "$REPO"/database/migrations/20261120_*.sql | sort); do
  $P -1 -f "$f" l10 >/dev/null 2>"$W/err" && echo "REAPPLY $(basename "$f") = OK (idempotent)" || { echo "REAPPLY $(basename "$f") = FAIL"; head -3 "$W/err"; exit 1; }
done

echo ""
echo "=== 3. SF-10 pre-check over a legacy multi-persona account ==="
build_db l10pre
$P l10pre >/dev/null <<'SQL'
INSERT INTO users (id, clerk_id, email) VALUES ('00000000-0000-0000-0000-00000000aaaa', 'clerk_legacy', 'legacy@l10.test');
INSERT INTO user_roles (user_id, role, status, granted_via) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', 'STUDENT', 'ACTIVE', 'BACKFILL'),
  ('00000000-0000-0000-0000-00000000aaaa', 'PARENT', 'ACTIVE', 'BACKFILL');
SQL
if $P -1 -f "$REPO/database/migrations/20261120_1400_sf10_single_persona_constraint.sql" l10pre >/dev/null 2>"$W/err"; then
  echo "SF10_PRECHECK = FAIL (applied over a multi-persona account)"; exit 1
elif grep -q SF10_MULTI_PERSONA_ACCOUNTS_EXIST "$W/err"; then
  echo "SF10_PRECHECK = OK (refused: $(grep -o 'SF10_MULTI_PERSONA_ACCOUNTS_EXIST: [0-9]* account' "$W/err"))"
  ROLES=$($P -tAc "SELECT count(*) FROM user_roles WHERE user_id = '00000000-0000-0000-0000-00000000aaaa'" l10pre)
  echo "SF10_PRECHECK left the legacy rows untouched: $ROLES role rows (expected 2)"
else
  echo "SF10_PRECHECK = FAIL (unexpected error)"; head -3 "$W/err"; exit 1
fi

echo ""
echo "=== 4. guards + parent service against the migrated database ==="
cd "$REPO"
DATABASE_URL="postgresql://postgres@/l10?host=$SOCK" L10_EPHEMERAL=1 npx tsx scripts/operations/l10-foundation-integration.ts
