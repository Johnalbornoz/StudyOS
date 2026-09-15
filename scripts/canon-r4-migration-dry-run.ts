/**
 * CANON-R4 -- Pedagogical Migration Dry-Run CLI.
 *
 * READ-ONLY. There is NO write/apply mode in this phase (Part 33: "No
 * writes in dry-run"; Part 50 test 36: "migration apply path, if built,
 * is explicitly gated and not executed" -- no apply path is built at
 * all here). Every query is a plain SELECT via already-existing,
 * read-only services (`getConceptKnowledgeState`, `getActiveMasteryPolicy`).
 *
 * NOT EXECUTED in this environment (no live DB access here -- see
 * docs/CANON_R4_LEGACY_COMPATIBILITY_AND_V1_EVIDENCE.md's STATUS and
 * PREVIEW COMMANDS sections). Documented and type-checked so a future
 * Preview-connected session can run it verbatim:
 *
 *   npx tsx --env-file=.env.local scripts/canon-r4-migration-dry-run.ts \
 *     --student <uuid> --concept <uuid>
 *
 *   npx tsx --env-file=.env.local scripts/canon-r4-migration-dry-run.ts \
 *     --student <uuid> --all-concepts
 *
 * For each concept, prints: OLD canonical state, the proposed
 * LEARN/PRACTICE/PROVE/RETENTION/TRANSFER migration recognitions, the
 * resulting effective v1 starting state, and any warnings -- all safe,
 * structural output only (ids, stages, scores, reason codes -- never
 * learner answer text, question text, or names).
 */
import { db } from '@/lib/db';
import { getConceptKnowledgeState, getActiveMasteryPolicy } from '@/services/knowledge-state.service';
import { evaluateCanonicalLearningState } from '@/lib/pedagogical-engine';
import { buildPedagogicalMigrationBaseline, composeEffectiveMigratedDecision } from '@/lib/pedagogical-migration';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function dryRunOneConcept(studentId: string, conceptId: string, now: string) {
  const [knowledgeState, masteryPolicy] = await Promise.all([
    getConceptKnowledgeState(studentId, conceptId),
    getActiveMasteryPolicy(),
  ]);

  const baseline = buildPedagogicalMigrationBaseline({
    conceptId,
    knowledgeState,
    masteryPolicy,
    recognizedAtMigration: now,
  });

  // No real v1-qualifying evidence is fabricated or assumed here -- an
  // empty ledger is the honest starting point until a real v1-compatible
  // evidence adapter run (CANON-R3) supplies actual qualifying rows for
  // this concept.
  const engineDecision = evaluateCanonicalLearningState({
    conceptId,
    studentId,
    now,
    evidence: [],
    activeCriticalMisconception: (knowledgeState?.criticalMisconceptionCount ?? 0) > 0,
  });

  const effective = composeEffectiveMigratedDecision({
    conceptId,
    studentId,
    engineDecision,
    migrationBaseline: baseline,
    activeCriticalMisconception: (knowledgeState?.criticalMisconceptionCount ?? 0) > 0,
  });

  return {
    conceptId,
    old: {
      masteryState: knowledgeState?.masteryState ?? null,
      validationReadiness: knowledgeState?.validationReadiness ?? null,
    },
    proposedRecognitions: baseline.recognizedRequirements.map((r) => ({ requirement: r.requirement, reasonCode: r.reasonCode })),
    migrationCategory: baseline.category,
    effectiveV1StartingState: effective.effectiveStage,
    perRequirement: effective.perRequirement,
    warnings: baseline.warnings,
  };
}

async function main() {
  const studentId = arg('--student');
  const conceptId = arg('--concept');
  const allConcepts = process.argv.includes('--all-concepts');
  const now = new Date().toISOString();

  console.log('\n=== CANON-R4 Pedagogical Migration Dry-Run [READ-ONLY, NO WRITES] ===');

  if (!studentId) {
    console.log('Usage: --student <uuid> --concept <uuid>  |  --student <uuid> --all-concepts');
    return;
  }

  if (conceptId) {
    console.log(JSON.stringify(await dryRunOneConcept(studentId, conceptId, now), null, 2));
    return;
  }

  if (allConcepts) {
    const concepts = await db.query(`SELECT DISTINCT concept_id FROM learning_evidence WHERE student_id = $1`, [studentId]);
    const results = [];
    for (const row of concepts.rows) {
      results.push(await dryRunOneConcept(studentId, row.concept_id, now));
    }
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log('Usage: --student <uuid> --concept <uuid>  |  --student <uuid> --all-concepts');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
