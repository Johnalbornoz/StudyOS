/**
 * Track B -- applies the DEV certification vertical configurations
 * (src/lib/exam-core/verticals) to the DEV database. DEV ONLY: refuses unless
 * the database fingerprint is the official DEV one. Dry run by default; pass
 * --write to commit. Idempotent: re-running changes nothing.
 *
 *   npx tsx --env-file=.env.neon-dev scripts/operations/track-b-apply-verticals.ts [--write]
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { applyExamVerticalConfig } from '@/lib/exam-core/apply-vertical-config.service';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';

const DEV_FP = '2a29b99ee14a22b4';
const WRITE = process.argv.includes('--write');

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function main() {
  const fp = fingerprint();
  if (fp !== DEV_FP && process.env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new Error(`REFUSING: not the DEV database (${fp})`);
  console.log(`track-b apply verticals -- db ${fp} -- ${WRITE ? 'WRITE' : 'DRY RUN'}`);
  for (const config of DEV_CERT_VERTICALS) {
    const r = await applyExamVerticalConfig(config, { write: WRITE });
    console.log(JSON.stringify({ key: r.key, family: r.family, noop: r.noop, write: r.write, definitionId: r.definitionId, versionId: r.versionId, sections: Object.keys(r.componentIdsBySection).length, objectives: Object.keys(r.objectiveIdsByCode).length, items: Object.keys(r.itemIdsByKey).length }));
  }
  await db.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});
