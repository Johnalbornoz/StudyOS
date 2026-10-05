/**
 * Curriculum catalogue classification (operator step, DEV first, then Preview).
 * Completes catalogue rows written after migration 20261018_1500 with the same
 * rules (see src/lib/curriculum/catalog-classification.service.ts). Idempotent;
 * dry run by default (--write commits). Never Production.
 *
 *   CURRICULUM_CATALOG_FP=<fp> npx tsx --env-file=<env> scripts/operations/curriculum-catalog-classify.ts [--write]
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { classifyCurriculumCatalog } from '@/lib/curriculum/catalog-classification.service';
import { listCurriculumSourceOptions } from '@/lib/institution/curriculum-management.service';

const ALLOWED = ['2a29b99ee14a22b4', '53d158d5811e7ee0'];

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function catalogueSummary() {
  const rows = await listCurriculumSourceOptions();
  const by = new Map<string, number>();
  for (const r of rows) by.set(`${r.scope} · ${r.country ?? '—'} · ${r.authority} · ${r.programme}`, (by.get(`${r.scope} · ${r.country ?? '—'} · ${r.authority} · ${r.programme}`) ?? 0) + 1);
  return Object.fromEntries([...by.entries()].sort());
}

async function main() {
  const fp = fingerprint();
  if (!ALLOWED.includes(fp) || process.env.CURRICULUM_CATALOG_FP !== fp) throw new Error(`REFUSING: database ${fp} (CURRICULUM_CATALOG_FP=${process.env.CURRICULUM_CATALOG_FP})`);
  const write = process.argv.includes('--write');
  console.log(JSON.stringify({ db: fp, write, before: await catalogueSummary() }, null, 1));
  console.log(JSON.stringify({ result: await classifyCurriculumCatalog({ write }) }));
  if (write) console.log(JSON.stringify({ after: await catalogueSummary() }, null, 1));
  await db.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});
