/**
 * Proof harness only -- records already-applied migration files in the ledger of a THROWAWAY local Postgres, with
 * the runner's own version parsing and checksum, so that the real runner then sees exactly the pending files a
 * hosted database would. Refuses any host that is not 127.0.0.1 / localhost.
 *
 *   DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<db> npx tsx scripts/operations/exam-bank/throwaway-ledger-stamp.ts <file.sql> [...]
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { parseMigrationFilename } from '@/lib/migration-ledger';

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error(`REFUSING: ${url.hostname} is not a local throwaway database`);
  const { db } = await import('@/lib/db');
  for (const file of process.argv.slice(2)) {
    const { version, name } = parseMigrationFilename(basename(file).replace(/\.sql$/, ''));
    await db.query(`INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`, [version, name, createHash('sha256').update(readFileSync(file, 'utf-8')).digest('hex')]);
  }
  console.log(`ledger rows: ${(await db.query(`SELECT count(*)::int AS n FROM schema_migrations`)).rows[0].n}`);
  await db.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
