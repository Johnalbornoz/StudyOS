/**
 * Exam V2 -- applies the CURATED DEV learning catalogue (canonical concepts,
 * skills, competencies; reviewed in the repo, labelled DEV_FIXTURE /
 * NON_OFFICIAL) and then the exam-objective -> learning links (PUBLISHED
 * mappings to rows that exist; never creates a target). DEV ONLY (fingerprint
 * guard). Dry run by default; --write commits. Idempotent. Run after
 * track-b-v2-apply.ts --write (links need the published objectives).
 *
 *   npx tsx --env-file=.env.neon-dev scripts/operations/track-b-v2-learning-catalog.ts [--write]
 */
import { db } from '@/lib/db';
import { applyDevLearningCatalog, applyObjectiveLearningLinks } from '@/lib/exam-core/catalog/learning-links.service';

const WRITE = process.argv.includes('--write');

async function main() {
  console.log(`track-b V2 learning catalogue -- ${WRITE ? 'WRITE' : 'DRY RUN'}`);
  console.log(JSON.stringify({ catalogue: await applyDevLearningCatalog({ write: WRITE, confirm: 'APPLY-DEV-LEARNING-CATALOG' }) }));
  const links = await applyObjectiveLearningLinks({ write: WRITE });
  console.log(JSON.stringify({ links }));
  await db.end();
  if (WRITE && links.missingTargets.length) process.exit(2);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});
