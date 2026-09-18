/**
 * F5 -- invoked by f5-learner-state-migration-cert.sh against a real,
 * ephemeral, local-only Postgres instance. Exercises the full adversarial
 * matrix from task 28 via the REAL updateMastery() production function
 * (never mocked), then proves zero Canonical-V2-owned rows were touched
 * and cross-learner isolation holds.
 */
import { updateMastery } from '@/services/mastery.service';
import { getConceptKnowledgeState } from '@/services/knowledge-state.service';
import { getSkillState, explainSkillState } from '@/lib/learner-state/skill-state.service';
import { getCompetencyState } from '@/lib/learner-state/competency-state.service';
import { getTransferAnalytics } from '@/lib/learner-state/transfer-analytics.service';
import { db } from '@/lib/db';

const L1 = '99999999-9999-4999-8999-999999999991';
const L2 = '99999999-9999-4999-8999-999999999992';
const L1_SUBJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const L2_SUBJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

const C1_LINEAR = 'cccccccc-cccc-4ccc-8ccc-cccccccccc11'; // L1, MATCHED
const C5_QUADRATIC = 'cccccccc-cccc-4ccc-8ccc-cccccccccc15'; // L1, UNRESOLVED
const C3_DERIVATIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccc13'; // L1, AMBIGUOUS
const C4_NOVEL = 'cccccccc-cccc-4ccc-8ccc-cccccccccc14'; // L1, UNRESOLVED
const C21_LINEAR_L2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc21'; // L2, MATCHED to the SAME canonical concept as C1

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  OK -- ${message}`);
}

async function skillIdByName(name: string): Promise<string> {
  const result = await db.query(`SELECT id FROM skills WHERE name = $1`, [name]);
  if (result.rows.length === 0) throw new Error(`skill not found: ${name}`);
  return result.rows[0].id;
}
async function competencyIdByCode(code: string): Promise<string> {
  const result = await db.query(`SELECT id FROM competencies WHERE code = $1`, [code]);
  if (result.rows.length === 0) throw new Error(`competency not found: ${code}`);
  return result.rows[0].id;
}

async function main() {
  const SK_FACTOR = await skillIdByName('factor polynomial');
  const SK_ANALYZE = await skillIdByName('analyze');
  const SK_COMPARE = await skillIdByName('compare');
  const COMPETENCY_C3 = await competencyIdByCode('C3');

  // Test-only fixture graph link (mirrors F4's own cert pattern): SK_FACTOR
  // is linked to COMPETENCY_C3 in the taxonomy graph. This is deliberately
  // NOT sufficient, alone, to produce Competency evidence (task 28-D).
  await db.query(
    `INSERT INTO canonical_concept_skills (canonical_concept_id, skill_id) SELECT id, $1 FROM canonical_concepts WHERE name = 'Linear Functions' LIMIT 1 ON CONFLICT DO NOTHING`,
    [SK_FACTOR]
  );
  await db.query(`INSERT INTO skill_competencies (skill_id, competency_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [SK_FACTOR, COMPETENCY_C3]);

  const before = {
    evidence: Number((await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence`)).rows[0].c),
    canonicalOwned: Number((await db.query(`SELECT COUNT(*)::int AS c FROM pedagogical_requirement_recognition`)).rows[0].c)
      + Number((await db.query(`SELECT COUNT(*)::int AS c FROM canonical_prepared_activity`)).rows[0].c),
  };

  // --- Task 28-A: knowledge-only evidence, no skill metadata ---
  await updateMastery({
    studentId: L1, conceptId: C1_LINEAR, subjectId: L1_SUBJECT,
    evidence: { result: 'correct', difficulty: 2, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
  });
  const skillStateAfterA = await getSkillState(L1, SK_FACTOR);
  assert(skillStateAfterA === null, 'task 28-A: knowledge-only evidence (no skillIds) never fabricates a Skill State row');
  const knowledgeStateAfterA = await getConceptKnowledgeState(L1, C1_LINEAR);
  assert(knowledgeStateAfterA !== null, 'task 28-A: Knowledge State IS possible from the same evidence (unchanged, existing authority)');

  // --- Task 28-B: explicit Skill evidence, 3x independent+correct ---
  for (let i = 0; i < 3; i++) {
    await updateMastery({
      studentId: L1, conceptId: C1_LINEAR, subjectId: L1_SUBJECT,
      evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
      metadata: { skillIds: [SK_FACTOR] },
    });
  }
  const skillStateAfterB = await getSkillState(L1, SK_FACTOR);
  assert(skillStateAfterB?.state === 'CONSISTENT_INDEPENDENT', 'task 28-B: explicit Skill evidence (3x independent+correct) derives CONSISTENT_INDEPENDENT');
  assert(skillStateAfterB?.evidenceCount === 3, 'task 28-B: evidence count reflects exactly the 3 tagged rows');

  // --- Task 28-C: the SAME skill, tagged on a DIFFERENT concept ---
  await updateMastery({
    studentId: L1, conceptId: C5_QUADRATIC, subjectId: L1_SUBJECT,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
    metadata: { skillIds: [SK_FACTOR] },
  });
  const skillStateAfterC = await getSkillState(L1, SK_FACTOR);
  assert(skillStateAfterC?.evidenceCount === 4, 'task 28-C: a shared skill across two concepts aggregates correctly (4 total), never duplicated or reset');
  assert(skillStateAfterC?.independentEvidenceCount === 4, 'task 28-C/28-G: all 4 qualifying rows are independent -- consistency information (independentEvidenceCount) is visible');

  // --- Task 28-D: Competency is NEVER inferred from skill evidence alone ---
  const competencyStateAfterD = await getCompetencyState(L1, COMPETENCY_C3);
  assert(
    competencyStateAfterD === null,
    'task 28-D/AC-F5-04: 4 qualifying evidence rows exist for a skill linked to this competency in the taxonomy graph, yet Competency State is still NO ROW -- never synthesized from skill evidence'
  );

  // --- Task 28-E/28-F: assisted-only evidence with mixed difficulty ---
  const difficulties = [2, 3, 4];
  for (const difficulty of difficulties) {
    await updateMastery({
      studentId: L1, conceptId: C1_LINEAR, subjectId: L1_SUBJECT,
      evidence: { result: 'correct', difficulty, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
      telemetry: { hintsUsed: 1 },
      metadata: { skillIds: [SK_ANALYZE] },
    });
  }
  const skillStateAnalyze = await getSkillState(L1, SK_ANALYZE);
  assert(skillStateAnalyze?.state === 'EMERGING', 'task 28-E: 3 assisted-but-correct rows meet the count but never reach CONSISTENT_INDEPENDENT');
  assert(skillStateAnalyze?.independentEvidenceCount === 0, 'task 28-E: independentEvidenceCount is 0 -- assisted correctness is never counted as independent');
  const explanation = await explainSkillState(L1, SK_ANALYZE);
  const explainedDifficulties = explanation.evidence.map((e) => e.difficulty).sort();
  assert(JSON.stringify(explainedDifficulties) === JSON.stringify([2, 3, 4]), 'task 28-F/AC-F5-07: difficulty is preserved and traceable in the explanation for every evidence row');

  // --- Task 28-H: context diversity ---
  await updateMastery({
    studentId: L1, conceptId: C1_LINEAR, subjectId: L1_SUBJECT,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
    metadata: { contextCode: 'FAMILIAR' },
  });
  await updateMastery({
    studentId: L1, conceptId: C1_LINEAR, subjectId: L1_SUBJECT,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
    metadata: { contextCode: 'FAMILIAR' },
  });
  await updateMastery({
    studentId: L1, conceptId: C1_LINEAR, subjectId: L1_SUBJECT,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
    metadata: { contextCode: 'UNFAMILIAR' },
  });
  const transferC1 = await getTransferAnalytics(L1, C1_LINEAR);
  assert(transferC1?.contextFamiliarCount === 2, 'task 28-H: 2 FAMILIAR-tagged evidence rows counted');
  assert(transferC1?.contextUnfamiliarCount === 1, 'task 28-H: 1 UNFAMILIAR-tagged evidence row counted');
  assert(transferC1?.distinctContextCount === 2, 'task 28-H: context diversity (2 distinct contexts) represented');
  assert(transferC1?.canonicalConceptId !== null, 'task 28-I precondition: C1 is MATCHED, so its canonical_concept_id IS populated');

  // --- Task 28-I: cross-learner isolation despite the SAME canonical concept ---
  const skillStateL2 = await getSkillState(L2, SK_FACTOR);
  assert(skillStateL2 === null, 'task 28-I: Learner 2 has zero Skill State for a skill Learner 1 has CONSISTENT_INDEPENDENT for -- complete isolation');
  await updateMastery({
    studentId: L2, conceptId: C21_LINEAR_L2, subjectId: L2_SUBJECT,
    evidence: { result: 'correct', difficulty: 2, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
  });
  const transferL2 = await getTransferAnalytics(L2, C21_LINEAR_L2);
  assert(transferL2 === null, 'task 28-I: Learner 2 has no context-tagged evidence and no Transfer analytics row, despite sharing a canonical concept with Learner 1');
  const knowledgeL1 = await getConceptKnowledgeState(L1, C1_LINEAR);
  const knowledgeL2 = await getConceptKnowledgeState(L2, C21_LINEAR_L2);
  assert(
    knowledgeL1!.evidenceCount !== knowledgeL2!.evidenceCount,
    'task 28-I: Knowledge State evidence counts differ between the two learners mapped to the same canonical concept -- no state was ever combined'
  );

  // --- Task 28-J: AMBIGUOUS canonical mapping never triggers guessed canonical aggregation ---
  await updateMastery({
    studentId: L1, conceptId: C3_DERIVATIVE, subjectId: L1_SUBJECT,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
    metadata: { contextCode: 'REAL_WORLD' },
  });
  const transferAmbiguous = await getTransferAnalytics(L1, C3_DERIVATIVE);
  assert(transferAmbiguous?.contextRealWorldCount === 1, 'task 28-J: context counting still works for an AMBIGUOUS concept');
  assert(transferAmbiguous?.canonicalConceptId === null, 'task 28-J/AC-F5-17: an AMBIGUOUS mapping never produces a guessed canonical_concept_id');

  // --- Task 28-K: UNRESOLVED canonical mapping -- learner-specific state remains fully functional ---
  await updateMastery({
    studentId: L1, conceptId: C4_NOVEL, subjectId: L1_SUBJECT,
    evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 100 },
    metadata: { skillIds: [SK_COMPARE] },
  });
  const skillStateCompare = await getSkillState(L1, SK_COMPARE);
  assert(skillStateCompare !== null, 'task 28-K/AC-F5-18: Skill State computes normally for a concept whose F4 catalog mapping is UNRESOLVED');
  const knowledgeC4 = await getConceptKnowledgeState(L1, C4_NOVEL);
  assert(knowledgeC4 !== null, 'task 28-K: Knowledge State also computes normally for the UNRESOLVED concept');

  // --- Task 28-L: historical Evidence referenced by existing Canonical V2 -- unchanged behavior ---
  const finalKnowledgeState = await getConceptKnowledgeState(L1, C1_LINEAR);
  assert(finalKnowledgeState !== null && typeof finalKnowledgeState.masteryState === 'string', 'task 28-L: the existing, unmodified Knowledge State authority still produces a valid MasteryState after all F5 activity');

  // --- Canonical V2 ownership boundary: zero rows in any Canonical-V2-owned table ---
  const after = {
    evidence: Number((await db.query(`SELECT COUNT(*)::int AS c FROM learning_evidence`)).rows[0].c),
    canonicalOwned: Number((await db.query(`SELECT COUNT(*)::int AS c FROM pedagogical_requirement_recognition`)).rows[0].c)
      + Number((await db.query(`SELECT COUNT(*)::int AS c FROM canonical_prepared_activity`)).rows[0].c),
  };
  assert(after.evidence > before.evidence, 'sanity: evidence rows were actually created by this certification run');
  assert(after.canonicalOwned === before.canonicalOwned && before.canonicalOwned === 0, 'F5 never wrote to any Canonical-V2-owned table (pedagogical_requirement_recognition, canonical_prepared_activity stay at 0)');

  console.log('\nAll F5 adversarial certification assertions passed against real PostgreSQL.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F5 lifecycle cert failed:', err);
    process.exit(1);
  });
