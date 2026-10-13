/**
 * Proof harness only -- loads the certified PAA concept catalogue into a THROWAWAY local Postgres, with the same
 * governed loader the hosted databases were loaded with. Refuses any host that is not 127.0.0.1 / localhost.
 */
import { applyPaaCertifiedCatalog, readPaaCertifiedCatalog } from '@/lib/curriculum/paa/paa-certified-catalog.service';
import { PAA_CERTIFIED_CONCEPTS } from '@/lib/curriculum/paa/paa-certified-concepts';

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error(`REFUSING: ${url.hostname} is not a local throwaway database`);
  const { db } = await import('@/lib/db');
  // the canonical subjects the catalogue names exist on every hosted database; a throwaway one starts without them
  for (const name of [...new Set(PAA_CERTIFIED_CONCEPTS.map((c) => c.canonicalSubject))]) await db.query(`INSERT INTO canonical_subjects (name) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM canonical_subjects WHERE lower(name) = lower($1))`, [name]);
  const ledger = await applyPaaCertifiedCatalog(db);
  const read = await readPaaCertifiedCatalog(db);
  console.log(`certified PAA concepts present: ${read.present}/${read.certified}${ledger.problems.length ? ' problems: ' + ledger.problems.slice(0, 3).join('; ') : ''}`);
  await db.end();
  if (read.present !== read.certified) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
