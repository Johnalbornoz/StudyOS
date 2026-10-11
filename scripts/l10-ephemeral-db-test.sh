#!/bin/bash
# L10 SHARED FOUNDATION -- migration series + guard integration test.
#
# Builds an EPHEMERAL, throwaway local Postgres (never DEV, Stage, Production
# or any Neon database; never reads .env or DATABASE_URL), then:
#   1. applies the baseline and every migration that precedes the L10 batch;
#   2. applies the L10 migrations (20261120_*) in order, each in its own
#      transaction, and applies them a second time to prove idempotency;
#   3. proves the SF-10 pre-check refuses to apply over a multi-persona account;
#   4. applies the same series through the governed runner (scripts/db-migrate.ts) and prints the
#      migration ledger before and after;
#   5. runs every SQL statement of the L5 preflight contract (read-only) before and after the batch;
#   6. runs scripts/operations/l10-foundation-integration.ts: the real guards
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
if $P -1 -f "$REPO/database/migrations/20261120_1200_sf10_single_persona_constraint.sql" l10pre >/dev/null 2>"$W/err"; then
  echo "SF10_PRECHECK = FAIL (applied over a multi-persona account)"; exit 1
elif grep -q SF10_MULTI_PERSONA_ACCOUNTS_EXIST "$W/err"; then
  echo "SF10_PRECHECK = OK (refused: $(grep -o 'SF10_MULTI_PERSONA_ACCOUNTS_EXIST: [0-9]* account' "$W/err"))"
  ROLES=$($P -tAc "SELECT count(*) FROM user_roles WHERE user_id = '00000000-0000-0000-0000-00000000aaaa'" l10pre)
  echo "SF10_PRECHECK left the legacy rows untouched: $ROLES role rows (expected 2)"
else
  echo "SF10_PRECHECK = FAIL (unexpected error)"; head -3 "$W/err"; exit 1
fi

echo ""
echo "=== 4. governed runner and ledger (scripts/db-migrate.ts, the path L5 / the operator uses) ==="
"$PG_BIN/createdb" -h "$SOCK" -U postgres l10ledger
$P -c 'DROP SCHEMA public CASCADE;' l10ledger
$P -f "$W/b.sql" l10ledger >/dev/null 2>"$W/err" || { echo "LEDGER_BASELINE = FAIL"; head -5 "$W/err"; exit 1; }
$P -f "$REPO/database/ledger/0000_baseline_ledger.sql" l10ledger >/dev/null
BASELINE_CHECKSUM=$(shasum -a 256 "$REPO/database/baseline/STUDYUS_BASELINE_2026_08.sql" | awk '{print $1}')
$P -c "INSERT INTO schema_migrations (version, name, checksum) VALUES ('STUDYUS_BASELINE_2026_08', 'Live schema baseline (pg_dump snapshot, Phase 0D)', '$BASELINE_CHECKSUM')" l10ledger
LEDGER_URL="postgresql://postgres@/l10ledger?host=$SOCK"
# Stop the governed runner just before the L10 batch, to read the "before" ledger exactly as a shared database has it.
mkdir -p "$W/hold" && mv "$REPO"/database/migrations/20261120_*.sql "$W/hold/"
restore_batch() { mv "$W/hold"/20261120_*.sql "$REPO/database/migrations/" 2>/dev/null || true; }
trap 'restore_batch; cleanup' EXIT
(cd "$REPO" && DATABASE_URL="$LEDGER_URL" npx tsx scripts/db-migrate.ts >"$W/migrate1.log" 2>&1) || { restore_batch; echo "GOVERNED_RUNNER (prior migrations) = FAIL"; tail -5 "$W/migrate1.log"; exit 1; }
restore_batch
echo "LEDGER_BEFORE: rows=$($P -tAc "SELECT count(*) FROM schema_migrations" l10ledger) last=$($P -tAc "SELECT max(version) FROM schema_migrations WHERE version ~ '^[0-9]'" l10ledger)"
(cd "$REPO" && DATABASE_URL="$LEDGER_URL" npx tsx scripts/db-migrate.ts --dry-run >"$W/dry.log" 2>&1); echo "DRY_RUN pending L10 files: $(grep -c '20261120_' "$W/dry.log")"
(cd "$REPO" && DATABASE_URL="$LEDGER_URL" npx tsx scripts/db-migrate.ts >"$W/migrate2.log" 2>&1) || { echo "GOVERNED_RUNNER (L10 batch) = FAIL"; tail -8 "$W/migrate2.log"; exit 1; }
echo "LEDGER_AFTER:  rows=$($P -tAc "SELECT count(*) FROM schema_migrations" l10ledger) last=$($P -tAc "SELECT max(version) FROM schema_migrations WHERE version ~ '^[0-9]'" l10ledger)"
echo "LEDGER_L10_VERSIONS: $($P -tAc "SELECT string_agg(version, ' ' ORDER BY version) FROM schema_migrations WHERE version LIKE '20261120_%'" l10ledger)"
(cd "$REPO" && DATABASE_URL="$LEDGER_URL" npx tsx scripts/db-migrate.ts --dry-run >"$W/dry2.log" 2>&1); echo "DRY_RUN after apply, pending L10 files: $(grep -c '20261120_' "$W/dry2.log")"

echo ""
echo "=== 5. the L5 preflight contract's SQL runs (docs/orchestration/L10_MIGRATION_PREFLIGHT.md) ==="
PREFLIGHT="$REPO/docs/orchestration/L10_MIGRATION_PREFLIGHT.md"
# Sections 0-4 are run BEFORE the batch (database l10pre: baseline + prior migrations only); section 5 AFTER it (database l10).
awk '/^## 5\./{exit} /^```sql/{f=1;next} /^```/{f=0} f' "$PREFLIGHT" > "$W/preflight-before.sql"
awk '/^## 5\./{s=1} s && /^```sql/{f=1;next} /^```/{f=0} s && f' "$PREFLIGHT" > "$W/preflight-after.sql"
$P -f "$W/preflight-before.sql" l10pre >"$W/pre.out" 2>"$W/err" && echo "PREFLIGHT_BEFORE_SQL = OK ($(grep -c ';' "$W/preflight-before.sql") statements, read-only)" || { echo "PREFLIGHT_BEFORE_SQL = FAIL"; head -5 "$W/err"; exit 1; }
$P -f "$W/preflight-after.sql" l10 >"$W/post.out" 2>"$W/err" && echo "PREFLIGHT_AFTER_SQL  = OK ($(grep -c ';' "$W/preflight-after.sql") statements, read-only)" || { echo "PREFLIGHT_AFTER_SQL = FAIL"; head -5 "$W/err"; exit 1; }
if grep -Eiq '^[[:space:]]*(insert|update|delete|alter|create|drop|truncate|grant)[[:space:]]' "$W/preflight-before.sql" "$W/preflight-after.sql"; then echo "PREFLIGHT_READ_ONLY = FAIL (a write statement is present)"; exit 1; else echo "PREFLIGHT_READ_ONLY = OK (SELECT only)"; fi
echo "PREFLIGHT 2.1 on the seeded multi-persona database: $($P -tAc "SELECT count(*) FROM (SELECT user_id FROM user_roles WHERE role IN ('STUDENT','PARENT','TEACHER') AND status = 'ACTIVE' GROUP BY user_id HAVING count(*) > 1) t" l10pre) account(s) (expected 1: the check finds what 20261120_1200 refuses)"

echo ""
echo "=== 6. guards + parent service against the migrated database ==="
cd "$REPO"
DATABASE_URL="postgresql://postgres@/l10?host=$SOCK" L10_EPHEMERAL=1 npx tsx scripts/operations/l10-foundation-integration.ts
