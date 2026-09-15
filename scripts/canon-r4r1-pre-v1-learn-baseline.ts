/**
 * CANON-R4R1 -- Pre-v1 LEARN Baseline: population-scale dry-run / apply.
 *
 * READ-ONLY by default. `--apply` is the ONLY thing that writes
 * anything, and only after BOTH `--apply` AND `--confirm-preview` are
 * passed explicitly -- this script never inspects `DATABASE_URL` or any
 * other signal to guess whether it is pointed at Preview or Production
 * (Part 19's own instruction: the operator must know and assert it,
 * never the tool inferring it). Every write goes through
 * `applyRecognitions` (`src/lib/pedagogical-migration/recognition-persistence-adapter.ts`),
 * which independently re-checks `guard.environment === 'preview'` and
 * refuses otherwise.
 *
 * NOT EXECUTED in this environment (no live DB access here -- see
 * docs/CANON_R4R1_PRE_V1_LEARN_BASELINE.md's STATUS and PREVIEW
 * COMMANDS sections). Documented and type-checked so a future
 * Preview-connected session can run it verbatim:
 *
 *   # 1. MANDATORY first step -- dry run, zero writes:
 *   npx tsx --env-file=.env.local scripts/canon-r4r1-pre-v1-learn-baseline.ts \
 *     --migration-version studyus-canonical-v1-initial-migration \
 *     --cutover 2026-09-15T00:00:00.000Z
 *
 *   # 2. Only after reviewing the dry-run output above:
 *   npx tsx --env-file=.env.local scripts/canon-r4r1-pre-v1-learn-baseline.ts \
 *     --migration-version studyus-canonical-v1-initial-migration \
 *     --cutover 2026-09-15T00:00:00.000Z \
 *     --apply --confirm-preview
 *
 * Prints ONLY safe structural output: counts, reason codes, a small
 * SAMPLE of concept ids (never student names, never answers, never
 * question text).
 */
import { db } from '@/lib/db';
import { getConceptKnowledgeState, getActiveMasteryPolicy } from '@/services/knowledge-state.service';
import {
  buildPedagogicalMigrationBaseline,
  loadPreexistingLearnerConceptPairs,
  applyRecognitions,
  type PreexistingLearnerConceptPair,
} from '@/lib/pedagogical-migration';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SAMPLE_SIZE = 10;

async function loadExistingRecognitionKeys(migrationVersion: string): Promise<Set<string>> {
  const result = await db.query(
    `SELECT student_id, concept_id, requirement FROM pedagogical_requirement_recognition WHERE migration_version = $1`,
    [migrationVersion],
  );
  return new Set(result.rows.map((r: any) => `${r.student_id}:${r.concept_id}:${r.requirement}`));
}

async function main() {
  const migrationVersion = arg('--migration-version');
  const cutoverAt = arg('--cutover');
  const studentId = arg('--student');
  const apply = process.argv.includes('--apply');
  const confirmPreview = process.argv.includes('--confirm-preview');
  const now = new Date().toISOString();

  console.log(`\n=== CANON-R4R1 Pre-v1 LEARN Baseline [${apply ? 'APPLY' : 'DRY-RUN'}] ===`);

  if (!migrationVersion || !cutoverAt) {
    console.log('Usage: --migration-version <label> --cutover <iso-timestamp> [--student <uuid>] [--apply --confirm-preview]');
    return;
  }
  if (apply && !confirmPreview) {
    console.log('Refusing to apply: --apply requires --confirm-preview to be passed explicitly. This script NEVER infers Preview vs. Production on its own.');
    return;
  }

  console.log(`  cutoverAt          ${cutoverAt}`);
  console.log(`  migrationVersion   ${migrationVersion}`);

  const pairs: PreexistingLearnerConceptPair[] = await loadPreexistingLearnerConceptPairs(cutoverAt, studentId);
  console.log(`  preexistingPairs   ${pairs.length}`);

  const existingKeys = await loadExistingRecognitionKeys(migrationVersion);

  const masteryPolicy = await getActiveMasteryPolicy();

  let proposedLearnCount = 0;
  let alreadyExistingCount = 0;
  let duplicatesSkipped = 0;
  const higherLegacyCounts = { PRACTICE: 0, PROVE: 0, RETAIN: 0, TRANSFER: 0 };
  const sampleConceptIds: string[] = [];
  let inserted = 0;

  for (const pair of pairs) {
    const knowledgeState = await getConceptKnowledgeState(pair.studentId, pair.conceptId);
    const baseline = buildPedagogicalMigrationBaseline({
      conceptId: pair.conceptId,
      studentId: pair.studentId,
      knowledgeState,
      masteryPolicy,
      recognizedAtMigration: now,
      migrationVersion,
      isPreexistingLearnerConcept: true,
    });

    for (const r of baseline.recognizedRequirements) {
      const key = `${pair.studentId}:${pair.conceptId}:${r.requirement}`;
      if (r.requirement === 'LEARN') {
        if (existingKeys.has(key)) alreadyExistingCount++;
        else proposedLearnCount++;
      } else if (r.requirement in higherLegacyCounts) {
        higherLegacyCounts[r.requirement as keyof typeof higherLegacyCounts]++;
      }
    }

    if (sampleConceptIds.length < SAMPLE_SIZE && baseline.recognizedRequirements.length > 0) {
      sampleConceptIds.push(pair.conceptId);
    }

    if (apply) {
      const result = await applyRecognitions(
        baseline.recognizedRequirements,
        pair.studentId,
        pair.conceptId,
        migrationVersion,
        cutoverAt,
        { environment: 'preview' },
      );
      inserted += result.inserted;
      duplicatesSkipped += result.alreadyExisted;
    }
  }

  console.log(`  proposedLearnCount     ${proposedLearnCount}`);
  console.log(`  alreadyExistingCount   ${alreadyExistingCount}`);
  console.log(`  duplicatesSkipped      ${apply ? duplicatesSkipped : '(dry-run: not computed)'}`);
  console.log(`  higherLegacyCounts     ${JSON.stringify(higherLegacyCounts)}`);
  console.log(`  sampleAffectedConcepts ${JSON.stringify(sampleConceptIds)}`);
  if (apply) console.log(`  rowsInserted           ${inserted}`);
  console.log(apply ? '\n  >>> APPLY COMPLETE (Preview only).' : '\n  >>> DRY RUN ONLY -- zero writes performed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
