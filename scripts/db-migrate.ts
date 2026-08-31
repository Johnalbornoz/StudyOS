/**
 * StudyUs migration governance -- migrate.
 *
 * Applies every PENDING file in database/migrations/ (i.e. not yet
 * recorded in the schema_migrations ledger), each inside its own
 * transaction, recording it into the ledger only on success.
 *
 * This script is NEVER invoked automatically -- not from `npm run
 * build`, not from application startup, not from any deploy hook. It
 * is a deliberate, explicit, human-run operation only.
 *
 * It does NOT touch, know about, or replay migrations/001-030 (the
 * legacy, historically-unreliable migration files) -- it only reads
 * database/migrations/, a separate, newly-introduced directory that is
 * empty as of Phase 0D.
 *
 * Run with:
 *   npm run db:migrate              -- applies all pending migrations
 *   npm run db:migrate -- --dry-run -- shows what WOULD run, applies nothing
 *
 * (equivalent to: npx tsx --env-file=.env.local scripts/db-migrate.ts [--dry-run])
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';
import { sha256, parseMigrationFilename, diffMigrations } from '@/lib/migration-ledger';

const MIGRATIONS_DIR = join(process.cwd(), 'database', 'migrations');
const DRY_RUN = process.argv.includes('--dry-run');

function listMigrationFiles(): { version: string; name: string; checksum: string; sql: string }[] {
  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
  return files.map((f) => {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
    const { version, name } = parseMigrationFilename(f.replace(/\.sql$/, ''));
    return { version, name, checksum: sha256(sqlText), sql: sqlText };
  });
}

async function ledgerExists(): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations'`
  );
  return (r.rowCount ?? 0) > 0;
}

async function main() {
  console.log(`=== StudyUs DB migrate ${DRY_RUN ? '(DRY RUN -- nothing will be applied)' : ''} ===`);

  if (!(await ledgerExists())) {
    console.error('LEDGER = NOT_FOUND. Cannot proceed without schema_migrations. See database/README.md.');
    process.exitCode = 1;
    return;
  }

  const applied = (await db.query(`SELECT version, checksum FROM schema_migrations`)).rows as {
    version: string;
    checksum: string;
  }[];

  const files = listMigrationFiles();
  const { pending, drifted } = diffMigrations(files, applied);

  if (drifted.length > 0) {
    console.error('CHECKSUM DRIFT detected -- aborting before applying anything:');
    for (const d of drifted) {
      console.error(
        `  ${d.version}_${d.name}.sql was modified after being applied. Migrations are immutable once applied -- create a new corrective migration instead of editing this one.`
      );
    }
    process.exitCode = 2;
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to do -- no pending migrations.');
    return;
  }

  console.log(`Pending (${pending.length}):`);
  for (const p of pending) console.log(`  ${p.version}  ${p.name}`);

  if (DRY_RUN) {
    console.log('\nDry run -- stopping before applying anything.');
    return;
  }

  const bySql = new Map(files.map((f) => [f.version, f.sql]));

  for (const m of pending) {
    console.log(`\nApplying ${m.version}_${m.name}.sql ...`);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(bySql.get(m.version)!);
      await client.query(`INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`, [
        m.version,
        m.name,
        m.checksum,
      ]);
      await client.query('COMMIT');
      console.log('  OK -- recorded in ledger.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  FAILED -- rolled back. ${(err as Error).message}`);
      process.exitCode = 1;
      return; // stop on first failure -- do not attempt later migrations out of order
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. Applied ${pending.length} migration(s).`);
}

main()
  .catch((err) => {
    console.error('db:migrate failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end?.());
