/**
 * POST-CANARY -- WHY FOUR FAMILIES HAD NO APPROVED ITEM (pure). A classification by rule of every slot of those
 * families from what the Canary recorded: the generation outcome, the revision-4 and revision-5 results and the
 * FROZEN AI review. One primary cause per slot, by the first rule that applies. Nothing is regenerated or rescored.
 */
import type { GatesR5, SpecificationItemValidationR5 } from './validators-r5';

export const ZERO_APPROVAL_FAMILIES = ['tf.math.proportion.rate-comparison-model', 'tf.math.linear.line-through-two-points', 'tf.math.quadratic.solve-by-factorising', 'tf.math.quadratic.optimum-of-a-model'] as const;
export type Cause = 'PARAMETER_POLICY' | 'GENERATOR_PROMPT' | 'TASK_FAMILY_SPEC' | 'DIFFICULTY_PROFILE' | 'VALIDATOR' | 'OTHER';
export const CAUSE_RULES: ReadonlyArray<{ cause: Cause; code: string; when: string }> = [
  { cause: 'OTHER', code: 'PROVIDER_TIMEOUT', when: 'no candidate: the generation call timed out' },
  { cause: 'GENERATOR_PROMPT', code: 'HARNESS_REFUSAL', when: 'no candidate: the harness refused the answer (roots or symbols written into the item, malformed stimulus)' },
  { cause: 'PARAMETER_POLICY', code: 'WRONG_KEY_ON_A_NON_CLEAN_PINNED_CASE', when: 'a wrong key (revision 5 KEY_CONTRADICTED, or the AI reviewer\'s own solution disagrees) where the pinned parameter left a vertex that is not a whole number or a half' },
  { cause: 'GENERATOR_PROMPT', code: 'WRONG_KEY', when: 'a wrong key on a clean case: the provider\'s arithmetic or expansion is wrong' },
  { cause: 'GENERATOR_PROMPT', code: 'CONSTRUCT_GIVEN_AWAY', when: 'the item hands over what it should ask for: the equation already factorised, both linear factors written out, the division named (validator construct FAIL, or AI CONSTRUCT_VALIDITY FAIL)' },
  { cause: 'TASK_FAMILY_SPEC', code: 'ASKS_A_QUANTITY_OUTSIDE_THE_CONSTRUCT', when: 'a line item that asks for y at a stated x: the family\'s evidence target allows it, the construct\'s vocabulary has no such quantity, so the item cannot be keyed or checked in the family\'s terms' },
  { cause: 'GENERATOR_PROMPT', code: 'ITEM_QUALITY', when: 'the AI reviewer failed or doubted response contract, learner quality, fairness, stimulus or construct (ambiguous stems, duplicated options, scaffolding that gives the method away)' },
  { cause: 'DIFFICULTY_PROFILE', code: 'BAND_NOT_REALISED', when: 'the only doubt of the AI reviewer is DIFFICULTY or PROFILE_FIDELITY: a correct item below its band or its paper' },
  { cause: 'VALIDATOR', code: 'VALIDATOR_ONLY', when: 'the AI reviewer passed every dimension and its solution agrees; the item was held back only by revision-4 findings (declaration quality, scenario similarity, a false key failure)' },
  { cause: 'OTHER', code: 'NOT_REVIEWED', when: 'a candidate the budget closed before review, with no finding above' },
];
export interface FamilySlot { slotId: string; familyId: string; generationState: string; generationCode: string | null; v4StrictPass: boolean | null; v5: SpecificationItemValidationR5 | null; v5Gates: GatesR5 | null; ai: { classification: string | null; agreesWithKey: string | null; verdicts: Record<string, string> } | null; nonCleanVertex: boolean; asksValueAtX: boolean }
export function causeOf(s: FamilySlot): { cause: Cause; code: string } {
  const pick = (code: string) => ({ cause: CAUSE_RULES.find((r) => r.code === code)!.cause, code });
  if (s.generationState === 'NO_CONTENT') return pick('PROVIDER_TIMEOUT');
  if (s.generationState !== 'CANDIDATE') return pick('HARNESS_REFUSAL');
  const v = s.ai?.verdicts ?? {};
  const wrongKey = s.v5Gates?.answerKey === 'KEY_CONTRADICTED' || s.ai?.agreesWithKey === 'DISAGREES';
  if (wrongKey) return pick(s.nonCleanVertex ? 'WRONG_KEY_ON_A_NON_CLEAN_PINNED_CASE' : 'WRONG_KEY');
  if (s.v5Gates?.constructPreservation === 'FAIL' || v.CONSTRUCT_VALIDITY === 'FAIL') return pick('CONSTRUCT_GIVEN_AWAY');
  if (s.asksValueAtX) return pick('ASKS_A_QUANTITY_OUTSIDE_THE_CONSTRUCT');
  const doubted = (d: string) => v[d] === 'FAIL' || v[d] === 'CONCERN';
  if (['RESPONSE_CONTRACT', 'LEARNER_QUALITY', 'FAIRNESS_AMBIGUITY', 'STIMULUS_INTEGRITY', 'CONSTRUCT_VALIDITY', 'ACADEMIC_CORRECTNESS'].some(doubted)) return pick('ITEM_QUALITY');
  if (doubted('DIFFICULTY') || doubted('PROFILE_FIDELITY')) return pick('BAND_NOT_REALISED');
  if (s.ai && s.ai.classification !== null) return pick('VALIDATOR_ONLY');
  return pick('NOT_REVIEWED');
}
export function analyseFamilies(slots: readonly FamilySlot[]) {
  return ZERO_APPROVAL_FAMILIES.map((familyId) => {
    const mine = slots.filter((s) => s.familyId === familyId).map((s) => ({ ...s, ...causeOf(s) }));
    const count = <K extends string>(key: (s: (typeof mine)[number]) => K) => { const m: Record<string, number> = {}; for (const s of mine) m[key(s)] = (m[key(s)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))); };
    const byCause = count((s) => s.cause);
    const candidates = mine.filter((s) => s.generationState === 'CANDIDATE');
    return {
      familyId, slots: mine.length, candidates: candidates.length, primaryCause: Object.keys(byCause)[0] ?? null, byCause, byCode: count((s) => s.code),
      whatRevision5AloneChanges: { v4StrictPass: candidates.filter((s) => s.v4StrictPass).length, v5StrictPass: candidates.filter((s) => s.v5Gates && s.v5Gates.structural === 'PASS' && s.v5Gates.profileCompliance === 'PASS' && s.v5Gates.constructPreservation === 'PASS' && s.v5Gates.answerKey !== 'KEY_CONTRADICTED' && s.v5Gates.stimulusIntegrity !== 'FAIL' && s.v5Gates.originality === 'PASS' && s.v5Gates.itemWriting === 'PASS').length, v5KeyIndependentlyVerified: candidates.filter((s) => s.v5Gates?.answerKey === 'INDEPENDENTLY_VERIFIED').length, v5KeyContradicted: candidates.filter((s) => s.v5Gates?.answerKey === 'KEY_CONTRADICTED').length },
      examples: Object.fromEntries(Object.keys(count((s) => s.code)).map((code) => [code, mine.filter((s) => s.code === code).slice(0, 3).map((s) => s.slotId)])),
      perSlot: mine.map((s) => ({ slotId: s.slotId, cause: s.cause, code: s.code })),
    };
  });
}
