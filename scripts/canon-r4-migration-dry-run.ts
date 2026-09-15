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
 *     --student <uuid> --concept <uuid> --migration-version <label> --cutover <iso-timestamp>
 *
 *   npx tsx --env-file=.env.local scripts/canon-r4-migration-dry-run.ts \
 *     --student <uuid> --all-concepts --migration-version <label> --cutover <iso-timestamp>
 *
 * CANON-R4R1: `--migration-version` and `--cutover` are now required --
 * per-concept output additionally reflects the one-time automatic LEARN
 * baseline for preexisting learner-concept pairs. For the FULL
 * population-scale dry-run/apply workflow (counts, sampling, the actual
 * Preview write path), see scripts/canon-r4r1-pre-v1-learn-baseline.ts
 * instead -- this script remains for single-concept inspection.
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
import {
  buildPedagogicalMigrationBaseline,
  composeEffectiveMigratedDecision,
  isPreexistingLearnerConcept,
} from '@/lib/pedagogical-migration';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function dryRunOneConcept(studentId: string, conceptId: string, now: string, migrationVersion: string, cutoverAt: string) {
  // CANON-R4R1A: "loaded for this learner" is `concepts.created_at`
  // (via the concept's own owning subject -- see
  // preexisting-learner-concept.ts's module header for the full schema
  // grounding), NEVER `learning_evidence` -- a concept the student has
  // never attempted must still be found here.
  const [knowledgeState, masteryPolicy, loadedRow] = await Promise.all([
    getConceptKnowledgeState(studentId, conceptId),
    getActiveMasteryPolicy(),
    db.query(
      `SELECT c.created_at AS loaded_at FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1 AND s.student_id = $2`,
      [conceptId, studentId],
    ),
  ]);
  const loadedAt: string | null = loadedRow.rows[0]?.loaded_at ? new Date(loadedRow.rows[0].loaded_at).toISOString() : null;

  const baseline = buildPedagogicalMigrationBaseline({
    conceptId,
    studentId,
    knowledgeState,
    masteryPolicy,
    recognizedAtMigration: now,
    migrationVersion,
    isPreexistingLearnerConcept: isPreexistingLearnerConcept(loadedAt, cutoverAt),
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
  // CANON-R4R1 Part 4: the cutover timestamp is explicit configuration,
  // never implicit execution time. `now` (when this SNAPSHOT was taken,
  // for retention-window/waiting-state purposes) is separately allowed
  // to be the real execution moment -- only the CUTOVER boundary itself
  // must never be derived implicitly.
  const now = new Date().toISOString();
  const migrationVersion = arg('--migration-version');
  const cutoverAt = arg('--cutover');

  console.log('\n=== CANON-R4 Pedagogical Migration Dry-Run [READ-ONLY, NO WRITES] ===');

  if (!studentId || !migrationVersion || !cutoverAt) {
    console.log('Usage: --student <uuid> --concept <uuid> --migration-version <label> --cutover <iso-timestamp>  |  --student <uuid> --all-concepts --migration-version <label> --cutover <iso-timestamp>');
    return;
  }

  if (conceptId) {
    console.log(JSON.stringify(await dryRunOneConcept(studentId, conceptId, now, migrationVersion, cutoverAt), null, 2));
    return;
  }

  if (allConcepts) {
    // CANON-R4R1A: enumerate from `concepts JOIN subjects` (the real
    // loaded-for-learner population), NEVER from `learning_evidence` --
    // the old `DISTINCT concept_id FROM learning_evidence` enumeration
    // would silently skip every concept this student has loaded but
    // never attempted, exactly the bug this phase fixes.
    const concepts = await db.query(`SELECT c.id AS concept_id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [studentId]);
    const results = [];
    for (const row of concepts.rows) {
      results.push(await dryRunOneConcept(studentId, row.concept_id, now, migrationVersion, cutoverAt));
    }
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log('Usage: --student <uuid> --concept <uuid> --migration-version <label> --cutover <iso-timestamp>  |  --student <uuid> --all-concepts --migration-version <label> --cutover <iso-timestamp>');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
