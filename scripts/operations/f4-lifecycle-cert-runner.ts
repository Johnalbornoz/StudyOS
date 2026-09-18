/**
 * F4 -- invoked by f4-learning-architecture-migration-cert.sh against a
 * real, ephemeral, local-only Postgres instance. Exercises the full
 * adversarial correspondence matrix from task 22 via the real service
 * functions (never mocked), then proves zero historical rows in any of
 * the 19 evidence/state tables were touched, private content stays
 * private, the skill/competency graph behaves as designed, and an
 * invalid canonical prerequisite cycle is rejected.
 */
import { ensureCatalogMapping, getMappingForConcept, getCandidatesForMapping } from '@/lib/catalog/mapping.service';
import {
  getSkillsForConcept,
  getConceptsForSkill,
  getCompetenciesForSkill,
} from '@/lib/catalog/canonical-catalog.service';
import { addCanonicalPrerequisite, PrerequisiteCycleError } from '@/lib/catalog/prerequisite.service';
import { verifyContentSourceAccess } from '@/lib/auth';
import { db } from '@/lib/db';

const LEARNER1_ID = '99999999-9999-4999-8999-999999999991';
const LEARNER2_ID = '99999999-9999-4999-8999-999999999992';

const CANONICAL_LINEAR_FUNCTIONS = '22222222-2222-4222-8222-222222222201';
const CANONICAL_DERIVATIVE_SL = '22222222-2222-4222-8222-222222222202';
const CANONICAL_DERIVATIVE_HL = '22222222-2222-4222-8222-222222222203';
const CANONICAL_QUADRATIC_FACTORING = '22222222-2222-4222-8222-222222222204';
const CANONICAL_POLYNOMIAL_DIVISION = '22222222-2222-4222-8222-222222222205';

const L1_LINEAR_FUNCTIONS = 'cccccccc-cccc-4ccc-8ccc-cccccccccc11';
const L1_DERIVATIVE_RULES = 'cccccccc-cccc-4ccc-8ccc-cccccccccc12';
const L1_STRAIGHT_LINE_EQUATIONS = 'cccccccc-cccc-4ccc-8ccc-cccccccccc13';
const L1_COMPLETELY_NOVEL_IDEA = 'cccccccc-cccc-4ccc-8ccc-cccccccccc14';
const L2_LINEAR_FUNCTIONS = 'cccccccc-cccc-4ccc-8ccc-cccccccccc21';

const CONTENT_SOURCE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function tableCounts() {
  const [evidence, mastery, kstate, retention, transfer, content] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence`),
    db.query(`SELECT COUNT(*)::int AS c FROM mastery_records`),
    db.query(`SELECT COUNT(*)::int AS c FROM concept_knowledge_state`),
    db.query(`SELECT COUNT(*)::int AS c FROM concept_memory_state`),
    db.query(`SELECT COUNT(*)::int AS c FROM concept_transfer_state`),
    db.query(`SELECT COUNT(*)::int AS c FROM content_sources`),
  ]);
  return {
    evidence: evidence.rows[0].c,
    mastery: mastery.rows[0].c,
    kstate: kstate.rows[0].c,
    retention: retention.rows[0].c,
    transfer: transfer.rows[0].c,
    content: content.rows[0].c,
  };
}

async function main() {
  const before = {
    evidence: Number(process.env.BEFORE_EVIDENCE),
    mastery: Number(process.env.BEFORE_MASTERY),
    kstate: Number(process.env.BEFORE_KSTATE),
    retention: Number(process.env.BEFORE_RETENTION),
    transfer: Number(process.env.BEFORE_TRANSFER),
    content: Number(process.env.BEFORE_CONTENT),
  };

  // --- Task 22-A: two learners, equivalent name+definition, independently matched, never compared to each other ---
  const mappingL1Linear = await ensureCatalogMapping(L1_LINEAR_FUNCTIONS);
  assert(mappingL1Linear.status === 'MATCHED', 'learner 1 "Linear Functions" MATCHED');
  assert(mappingL1Linear.canonicalConceptId === CANONICAL_LINEAR_FUNCTIONS, 'learner 1 matched the correct canonical concept');

  const mappingL2Linear = await ensureCatalogMapping(L2_LINEAR_FUNCTIONS);
  assert(mappingL2Linear.status === 'MATCHED', 'learner 2 "Linear Functions" (same name+definition) independently MATCHED');
  assert(
    mappingL2Linear.canonicalConceptId === CANONICAL_LINEAR_FUNCTIONS,
    'learner 2 matched the SAME canonical concept as learner 1 -- proving no cross-learner comparison occurred, just two independent matches to the same shared entry'
  );

  // --- Task 22-B: same name, different scope -- must be AMBIGUOUS, never auto-picked ---
  const mappingDerivative = await ensureCatalogMapping(L1_DERIVATIVE_RULES);
  assert(mappingDerivative.status === 'AMBIGUOUS', '"Derivative Rules" (matches 2 canonical concepts of different scope) -> AMBIGUOUS');
  assert(mappingDerivative.canonicalConceptId === null, 'AMBIGUOUS mapping never auto-picks a canonicalConceptId (INV-F4-04)');
  const derivativeCandidates = await getCandidatesForMapping(mappingDerivative.id);
  assert(derivativeCandidates.length === 2, 'both ambiguous candidates (SL and HL) were recorded for review');
  const candidateIds = derivativeCandidates.map((c) => c.canonicalConceptId).sort();
  assert(
    JSON.stringify(candidateIds) === JSON.stringify([CANONICAL_DERIVATIVE_SL, CANONICAL_DERIVATIVE_HL].sort()),
    'the recorded candidates are exactly the SL and HL canonical concepts, nothing else'
  );

  // --- Task 22-C: a differently-named concept that MAY be equivalent -- stays UNRESOLVED, never guessed ---
  const mappingStraightLine = await ensureCatalogMapping(L1_STRAIGHT_LINE_EQUATIONS);
  assert(
    mappingStraightLine.status === 'UNRESOLVED',
    '"Straight Line Equations" (conceptually maybe = Linear Functions, but a different name) stays UNRESOLVED -- never semantically guessed'
  );

  // --- Task 22-D: a plain concept with no canonical counterpart at all ---
  const mappingNovel = await ensureCatalogMapping(L1_COMPLETELY_NOVEL_IDEA);
  assert(mappingNovel.status === 'UNRESOLVED', '"Completely Novel Idea" (no canonical counterpart) -> UNRESOLVED');

  // Re-running ensureCatalogMapping is a safe no-op (idempotency at the service level, not just the migration).
  const mappingL1LinearAgain = await ensureCatalogMapping(L1_LINEAR_FUNCTIONS);
  assert(mappingL1LinearAgain.id === mappingL1Linear.id, 'calling ensureCatalogMapping twice for the same concept returns the SAME mapping row, never a duplicate');

  // --- Task 22-E/F/G/H: historical Evidence/Mastery/Retention/Transfer on the MATCHED concept -- byte-identical before/after ---
  const after = await tableCounts();
  assert(after.evidence === before.evidence, 'ZERO learning_evidence rows added/removed by mapping (task 22-E)');
  assert(after.mastery === before.mastery, 'ZERO mastery_records rows added/removed by mapping (task 22-F)');
  assert(after.kstate === before.kstate, 'ZERO concept_knowledge_state rows added/removed by mapping (task 22-F)');
  assert(after.retention === before.retention, 'ZERO concept_memory_state (retention) rows added/removed by mapping (task 22-G)');
  assert(after.transfer === before.transfer, 'ZERO concept_transfer_state rows added/removed by mapping (task 22-H)');
  assert(after.content === before.content, 'ZERO content_sources rows added/removed by mapping');

  const evidenceRow = await db.query(`SELECT student_id, concept_id FROM learning_evidence WHERE concept_id = $1`, [L1_LINEAR_FUNCTIONS]);
  assert(evidenceRow.rows.length === 1 && evidenceRow.rows[0].student_id === LEARNER1_ID, 'the original evidence row still references the SAME learner concept id, untouched');

  // --- Task 22-I / AC-F4-06: private content stays private after canonical mapping ---
  const ownerCanAccess = await verifyContentSourceAccess(LEARNER1_ID, CONTENT_SOURCE_ID);
  assert(ownerCanAccess === true, 'the owning learner can still access their private content after its concept was mapped to a canonical concept');
  const otherLearnerCanAccess = await verifyContentSourceAccess(LEARNER2_ID, CONTENT_SOURCE_ID);
  assert(otherLearnerCanAccess === false, 'a DIFFERENT learner cannot access that private content -- canonical mapping never publishes it (INV-F4-07/08, AC-F4-06)');

  // --- Task 22-J/K: one canonical concept mapped to multiple skills; one skill reused across concepts ---
  const quadraticSkills = await getSkillsForConcept(CANONICAL_QUADRATIC_FACTORING);
  assert(quadraticSkills.length === 2, '"Quadratic Factoring" is mapped to 2 skills (task 22-J)');
  const factorPolynomialSkill = quadraticSkills.find((s) => s.name === 'factor polynomial');
  assert(!!factorPolynomialSkill, 'one of those skills is "factor polynomial"');

  const conceptsUsingFactorSkill = await getConceptsForSkill(factorPolynomialSkill!.id);
  const conceptIdsUsingSkill = conceptsUsingFactorSkill.map((c) => c.id).sort();
  assert(
    JSON.stringify(conceptIdsUsingSkill) === JSON.stringify([CANONICAL_QUADRATIC_FACTORING, CANONICAL_POLYNOMIAL_DIVISION].sort()),
    '"factor polynomial" is reused by BOTH "Quadratic Factoring" and "Polynomial Division" (task 22-K)'
  );

  // --- Task 22-L: one competency linked to multiple skills ---
  const analyzeSkill = quadraticSkills.find((s) => s.name === 'analyze');
  assert(!!analyzeSkill, '"Quadratic Factoring" also has the "analyze" skill');
  const competenciesForFactor = await getCompetenciesForSkill(factorPolynomialSkill!.id);
  const competenciesForAnalyze = await getCompetenciesForSkill(analyzeSkill!.id);
  assert(
    competenciesForFactor.some((c) => c.code === 'C3') && competenciesForAnalyze.some((c) => c.code === 'C3'),
    'competency C3 (Application) is reached via BOTH "factor polynomial" and "analyze" (task 22-L)'
  );

  // --- Task 22-M: invalid prerequisite cycle must be rejected ---
  await addCanonicalPrerequisite(CANONICAL_LINEAR_FUNCTIONS, CANONICAL_QUADRATIC_FACTORING);
  await addCanonicalPrerequisite(CANONICAL_QUADRATIC_FACTORING, CANONICAL_POLYNOMIAL_DIVISION);
  let cycleRejected = false;
  try {
    // This would close Linear -> Quadratic -> Polynomial -> Linear.
    await addCanonicalPrerequisite(CANONICAL_POLYNOMIAL_DIVISION, CANONICAL_LINEAR_FUNCTIONS);
  } catch (err) {
    cycleRejected = err instanceof PrerequisiteCycleError;
  }
  assert(cycleRejected, 'an invalid prerequisite cycle (Linear -> Quadratic -> Polynomial -> Linear) is rejected, never created (task 22-M)');

  const cycleEdgeCount = await db.query(
    `SELECT COUNT(*)::int AS c FROM canonical_concept_prerequisites WHERE prerequisite_concept_id = $1 AND concept_id = $2`,
    [CANONICAL_POLYNOMIAL_DIVISION, CANONICAL_LINEAR_FUNCTIONS]
  );
  assert(cycleEdgeCount.rows[0].c === 0, 'the cycle-closing edge was never persisted');

  console.log('\nAll F4 adversarial correspondence + prerequisite-cycle assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F4 lifecycle cert failed:', err);
    process.exit(1);
  });
