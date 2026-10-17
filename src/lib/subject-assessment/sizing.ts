/**
 * Subject-level internal assessments -- question count and distribution (pure, no IO).
 *
 * Operator decisions (overnight pilot policy, 2026-10-16):
 *   SUBJECT MOCK ("Simulacro por materia"): the count is automatic and representative (uniform), never chosen by the
 *     user and never concentrated on weak concepts:
 *       1 concept -> 5 | 2-5 -> ~2/concept, max 10 | 6-10 -> ~2/concept, max 20 | 11-15 -> ~2/concept, max 30
 *       ALL SUBJECT -> every eligible concept, ~2/concept where coverage allows, absolute max 50
 *       16+ manually selected concepts (not the whole subject) -> OVER_15_PARTIAL, APPROVED 2026-10-17: ~2/concept,
 *         absolute max 50 (18 -> 36, 22 -> 44, 30 -> 50); every concept gets 1 first, the remainder follows the
 *         uniform mock coverage (subject order)
 *   SUBJECT TEST ("Prueba por materia"): adaptive to the selected concept volume and the Knowledge State; minimum 4,
 *     absolute maximum 50; EVERY selected concept appears at least once; additional questions go to concepts whose
 *     Knowledge State shows need (weaker mastery, recent errors, IN PROCESS, insufficient evidence, need validation).
 *     The size of the additional allowance follows the existing governed BALANCED practice-depth preset
 *     (assessment-blueprint/policy/practice-depth.ts: opportunityFloor 1, opportunityCeiling 2): one question per
 *     selected concept, a second one for a concept with need.
 *   TEACHER group assignment: count and distribution are fixed for the whole group (never per-student Knowledge State).
 */

export const SUBJECT_ASSESSMENT_MAX_QUESTIONS = 50;
export const SUBJECT_TEST_MIN_QUESTIONS = 4;
/** BALANCED practice-depth preset: one question per concept, a second one for a concept with need. */
const TEST_PER_CONCEPT_BASE = 1;
const TEST_PER_CONCEPT_WITH_NEED = 2;

export type MockCountBand = 'ONE_CONCEPT' | 'UP_TO_5' | 'UP_TO_10' | 'UP_TO_15' | 'ALL_SUBJECT' | 'OVER_15_PARTIAL';

export interface CountDecision {
  questionCount: number;
  /** concept id -> questions, in the order given (every listed concept present with >= 1, unless `uncovered`). */
  distribution: Record<string, number>;
  /** concepts that could not get a question because of the absolute maximum (only possible beyond 50 concepts). */
  uncovered: string[];
  rule: string;
}

/** Spread `count` questions over `conceptIds` as evenly as possible, in order (first ones get the remainder). */
export function distributeUniform(conceptIds: readonly string[], count: number): CountDecision['distribution'] {
  const out: Record<string, number> = {};
  if (conceptIds.length === 0 || count <= 0) return out;
  const per = Math.floor(count / conceptIds.length);
  let rest = count % conceptIds.length;
  for (const id of conceptIds) {
    const n = per + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
    if (n > 0) out[id] = n;
  }
  return out;
}

/**
 * Mock count band (operator table). `allSubject` = the selection is every eligible concept of the subject.
 * 16+ concepts that are NOT the whole subject: OVER_15_PARTIAL (APPROVED 2026-10-17) = ~2/concept, absolute max 50.
 */
export function mockQuestionCount(selectedCount: number, allSubject: boolean): { count: number; band: MockCountBand } {
  const n = Math.max(0, Math.floor(selectedCount));
  if (n <= 0) return { count: 0, band: 'ONE_CONCEPT' };
  if (n === 1) return { count: 5, band: 'ONE_CONCEPT' };
  if (n <= 5) return { count: Math.min(2 * n, 10), band: 'UP_TO_5' };
  if (n <= 10) return { count: Math.min(2 * n, 20), band: 'UP_TO_10' };
  if (n <= 15) return { count: Math.min(2 * n, 30), band: 'UP_TO_15' };
  return { count: Math.min(2 * n, SUBJECT_ASSESSMENT_MAX_QUESTIONS), band: allSubject ? 'ALL_SUBJECT' : 'OVER_15_PARTIAL' };
}

/**
 * Representative mock: the operator count, spread uniformly (never weighted by weakness).
 * Up to 50 concepts: EVERY concept gets 1 question first; the remainder (count - concepts) follows the uniform mock
 * coverage, one more per concept in order (so ~2/concept, capped at 50 in total). Beyond 50 concepts the absolute
 * maximum cannot cover them all: the first 50 get one each and the rest are `uncovered` (the caller refuses).
 */
export function planSubjectMock(conceptIds: readonly string[], allSubject: boolean): CountDecision & { band: MockCountBand } {
  const { count, band } = mockQuestionCount(conceptIds.length, allSubject);
  const covered = conceptIds.slice(0, count);
  const distribution: Record<string, number> = {};
  for (const id of covered) distribution[id] = 1;
  const extra = distributeUniform(covered, count - covered.length);
  for (const [id, n] of Object.entries(extra)) distribution[id] += n;
  return { questionCount: count, distribution, uncovered: conceptIds.slice(covered.length), rule: `MOCK_${band}`, band };
}

export interface TestConceptSignal {
  conceptId: string;
  /** true when the Knowledge State shows need: weaker mastery, recent errors, IN PROCESS, insufficient evidence or validation needed. */
  needsReinforcement: boolean;
}

/**
 * Adaptive subject test: every selected concept once; a second question for a concept with need; at least 4 (extra
 * questions go to concepts with need first, then in order); never more than 50. More than 50 selected concepts cannot
 * all be covered once -> refused by the caller (`uncovered` non-empty).
 */
export function planSubjectTest(concepts: readonly TestConceptSignal[]): CountDecision {
  const distribution: Record<string, number> = {};
  if (concepts.length === 0) return { questionCount: 0, distribution, uncovered: [], rule: 'TEST_EMPTY' };
  if (concepts.length > SUBJECT_ASSESSMENT_MAX_QUESTIONS) {
    return { questionCount: 0, distribution, uncovered: concepts.slice(SUBJECT_ASSESSMENT_MAX_QUESTIONS).map((c) => c.conceptId), rule: 'TEST_TOO_MANY_CONCEPTS' };
  }
  for (const c of concepts) distribution[c.conceptId] = TEST_PER_CONCEPT_BASE;
  let total = concepts.length;
  for (const c of concepts) {
    if (total >= SUBJECT_ASSESSMENT_MAX_QUESTIONS) break;
    if (c.needsReinforcement && distribution[c.conceptId] < TEST_PER_CONCEPT_WITH_NEED) { distribution[c.conceptId]++; total++; }
  }
  // the minimum of 4: concepts with need first, then in order, round after round
  const order = [...concepts.filter((c) => c.needsReinforcement), ...concepts.filter((c) => !c.needsReinforcement)];
  let i = 0;
  while (total < SUBJECT_TEST_MIN_QUESTIONS) { distribution[order[i % order.length].conceptId]++; total++; i++; }
  return { questionCount: total, distribution, uncovered: [], rule: 'TEST_BALANCED_PRESET' };
}

/** Teacher group assignment: one fixed plan for every student (no per-student Knowledge State). */
export function planGroupAssessment(kind: 'TEST' | 'MOCK', conceptIds: readonly string[], allSubject: boolean): CountDecision {
  if (kind === 'MOCK') return planSubjectMock(conceptIds, allSubject);
  // group comparability: the test plan without per-student signals (one question per concept, minimum 4)
  return planSubjectTest(conceptIds.map((conceptId) => ({ conceptId, needsReinforcement: false })));
}

/** Score with UNANSWERED in the denominator: correct / total (operator rule: 14 correct, 2 wrong, 4 unanswered of 20 = 70%). */
export function subjectAssessmentScorePercent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
}

/** Test / Mock pass: >= 80% inclusive. */
export const SUBJECT_ASSESSMENT_PASS_PERCENT = 80;
export const subjectAssessmentPassed = (scorePercent: number): boolean => scorePercent >= SUBJECT_ASSESSMENT_PASS_PERCENT;
