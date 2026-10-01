/**
 * Exam V2 -- applies the V2 reference verticals and then the assessment
 * structure catalogue (sources + nodes + bindings). DEV ONLY: refuses unless
 * the database fingerprint is the official DEV one (or an explicitly allowed
 * ephemeral DB). Dry run by default; --write commits. Idempotent.
 *
 *   npx tsx --env-file=.env.neon-dev scripts/operations/track-b-v2-apply.ts [--write]
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { applyExamVerticalConfig } from '@/lib/exam-core/apply-vertical-config.service';
import { V2_VERTICALS } from '@/lib/exam-core/verticals/v2';
import { applyAssessmentStructure } from '@/lib/exam-core/catalog/structure.service';

const DEV_FP = '2a29b99ee14a22b4';
const WRITE = process.argv.includes('--write');

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function main() {
  const fp = fingerprint();
  if (fp !== DEV_FP && process.env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new Error(`REFUSING: not the DEV database (${fp})`);
  console.log(`track-b V2 apply -- db ${fp} -- ${WRITE ? 'WRITE' : 'DRY RUN'}`);
  for (const config of V2_VERTICALS) {
    const r = await applyExamVerticalConfig(config, { write: WRITE });
    console.log(JSON.stringify({ key: r.key, family: r.family, noop: r.noop, write: r.write, versionId: r.versionId, sections: Object.keys(r.componentIdsBySection).length, objectives: Object.keys(r.objectiveIdsByCode).length, items: Object.keys(r.itemIdsByKey).length }));
  }
  // The structure binds to PUBLISHED versions: in a dry run the verticals above were rolled back, so bindings resolve only after --write.
  const s = await applyAssessmentStructure({ write: WRITE });
  console.log(JSON.stringify({ structure: s }));
  await db.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});
