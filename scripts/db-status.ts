/**
 * StudyUs migration governance -- status.
 *
 * Read-only. Reports which migrations in database/migrations/ have
 * been applied (per the schema_migrations ledger) and which are
 * pending. Never writes to the database, never prints DATABASE_URL or
 * any credential.
 *
 * Run with: npm run db:status
 * (equivalent to: npx tsx --env-file=.env.local scripts/db-status.ts)
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';
import { sha256, parseMigrationFilename, diffMigrations, type MigrationFile } from '@/lib/migration-ledger';

const MIGRATIONS_DIR = join(process.cwd(), 'database', 'migrations');

function listMigrationFiles(): MigrationFile[] {
  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
  return files.map((f) => {
    const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
    const { version, name } = parseMigrationFilename(f.replace(/\.sql$/, ''));
    return { version, name, checksum: sha256(content) };
  });
}

async function ledgerExists(): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations'`
  );
  return (r.rowCount ?? 0) > 0;
}

async function main() {
  console.log('=== StudyUs DB migration status ===');

  if (!(await ledgerExists())) {
    console.log('LEDGER = NOT_FOUND (run the ledger bootstrap first; see database/README.md)');
    process.exitCode = 1;
    return;
  }
  console.log('LEDGER = FOUND (schema_migrations)');

  const applied = (
    await db.query(`SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version`)
  ).rows as { version: string; name: string; checksum: string; applied_at: string }[];

  console.log(`\nApplied (${applied.length}):`);
  for (const a of applied) {
    console.log(`  [applied] ${a.version}  ${a.name}  (${new Date(a.applied_at).toISOString()})`);
  }

  const files = listMigrationFiles();
  const { pending, drifted } = diffMigrations(files, applied);

  console.log(`\nPending (${pending.length}):`);
  for (const p of pending) console.log(`  [pending] ${p.version}  ${p.name}`);

  if (drifted.length > 0) {
    console.log(
      `\nCHECKSUM DRIFT DETECTED (${drifted.length}) -- an already-applied migration file was modified after being applied. This must never happen (migrations are immutable once applied). Investigate before proceeding:`
    );
    for (const d of drifted) console.log(`  [DRIFT] ${d.version}  ${d.name}`);
  }

  console.log(`\nSUMMARY: ${applied.length} applied, ${pending.length} pending, ${drifted.length} drifted.`);
  if (drifted.length > 0) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error('db:status failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end?.());
