/**
 * SCORER_PARITY: the same answer receives the same result at every stage that judges it --
 *   candidate validation  (Question Factory `evaluateResponse`)
 *   certification         (the certification gate calls that same `evaluateResponse`; asserted below)
 *   Exam Bank             (the canonical contract embedded in the projection-3 bank version)
 *   Exam Core             (`examItemFromApproved` + `gradeExamItem` on that bank version)
 * Pure: no database, no provider.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateResponse, EXACT_NUMERIC_POLICY, type ResponseEvaluationPolicy } from '@/lib/assessment-instance/response-evaluation';
import type { CertifiedInstance } from '@/lib/assessment-instance/v52';
import { evaluateCanonicalNumeric, evaluateOrderedParts, parseCanonicalNumber, policyIssues } from '@/lib/assessment-scoring/canonical-response';
import { scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');
const SUPPLY = JSON.parse(read('docs/exams/question-factory/v52/QF52_CERTIFIED_SUPPLY.json')) as { rows: any[] };
const base = SUPPLY.rows.find((r) => r.content.lineage.systemId !== 'IB');
/** A certified numeric instance of the given key and policy (the shape every stage reads). */
function instance(key: string, policy: ResponseEvaluationPolicy, system = 'IB'): CertifiedInstance {
  const c = base.content; const l = c.lineage;
  return {
    itemType: 'EXAM_BANK_ITEM', instanceId: 'a'.repeat(64), coreId: l.coreId, coreVersion: l.coreVersion, conceptId: base.primaryConceptStableId, canonicalSubject: base.canonicalSubject, systemId: system, systemVersionId: l.systemVersionId,
    adapterId: l.adapterId, adapterVersion: l.adapterVersion, blueprintId: l.blueprintId, blueprintVersion: l.blueprintVersion, blueprintClass: l.blueprintClass, bucketId: l.bucketId, rendererVersion: l.rendererVersion, envelopeHash: l.envelopeHash,
    seed: l.seed, recognitionId: 'rec', format: 'NUMERIC_ENTRY', language: 'en', marks: 1, itemDifficulty: c.difficulty, difficultyBand: c.difficultyBand,
    learner: { language: 'en', itemType: 'NUMERIC_ENTRY', stimulus: null, prompt: 'Find the value.', parts: [], options: [], marks: 1, conditions: { calculator: 'NONE', workingShown: false } },
    key: { answers: [key], correctOption: null, distractorRationales: {}, distractorLineage: {} }, rubric: [{ code: 'A1', kind: 'ANSWER', marks: 1, criterion: key }], responsePolicy: policy,
    rightsCategory: 'STUDYUS_ORIGINAL_DETERMINISTIC', certificationState: 'AUTOMATED_CERTIFIED_PILOT', certificationMode: 'INHERITED_DETERMINISTIC_CERTIFICATION', policyVersion: l.policyVersion, policyHash: l.policyHash,
    lineage: {} as never, lineageHash: l.digest, eligibilityScopes: ['PILOT_PREVIEW'], markedOnWorking: false,
  };
}
async function stages(i: CertifiedInstance, response: string) {
  const content = scoringBankContentOf(i);
  const contract = (content.math as any).responseContract;
  const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content });
  if (!item) throw new Error('not deliverable');
  const core = await gradeExamItem(item, response, 'es'); // the Student's language must not matter
  const coreEn = await gradeExamItem(item, response, 'en');
  return {
    validation: evaluateResponse(i.responsePolicy, i.key.answers, response).correct,
    certification: evaluateResponse(i.responsePolicy, i.key.answers, response).correct,
    bank: evaluateCanonicalNumeric(contract.policy, i.key.answers[0], response).correct,
    examCore: core.fraction === 1,
    examCoreOtherLanguage: coreEn.fraction === 1,
  };
}
const POLICY = (over: Partial<ResponseEvaluationPolicy> = {}): ResponseEvaluationPolicy => ({ ...EXACT_NUMERIC_POLICY, ...over });

describe('SCORER_PARITY', () => {
  it('certification judges responses with the same evaluator, which delegates to the canonical contract', () => {
    expect(read('src/lib/assessment-instance/v52/instance-certification.ts')).toMatch(/import \{ evaluateResponse \} from '\.\.\/response-evaluation'/);
    expect(read('src/lib/assessment-instance/response-evaluation.ts')).toMatch(/evaluateCanonicalNumeric\(policy/);
    expect(read('src/lib/exam-core/item-grading.ts')).toMatch(/if \(key\.responseContract && key\.kind === 'NUMBER'\) return gradeContractTarget/);
  });

  const CASES: Array<{ name: string; key: string; policy: ResponseEvaluationPolicy; responses: Array<[string, boolean]> }> = [
    { name: '2.625 (the reported disagreement): no grouping governed', key: '21/8', policy: POLICY(), responses: [['2.625', true], ['2,625', true], ['21/8', true], ['42/16', true], ['2.63', false], ['2625', false], ['2 625', false], ['2.6250', true]] },
    { name: 'grouping governed explicitly', key: '1250.5', policy: POLICY({ decimalSeparators: ['.'], groupingSeparators: [','] }), responses: [['1,250.5', true], ['1250.5', true], ['1250,5', false], ['12,50.5', false], ['1.250,5', false]] },
    { name: 'comma decimal, point grouping', key: '1250.5', policy: POLICY({ decimalSeparators: [','], groupingSeparators: ['.'] }), responses: [['1.250,5', true], ['1250,5', true], ['1250.5', false]] },
    { name: 'significant figures', key: '0.0668', policy: POLICY({ rounding: { kind: 'SIGNIFICANT_FIGURES', digits: 3 } }), responses: [['0.0668', true], ['0,0668', true], ['0.067', false], ['0.06681', false], ['0.0669', false]] },
    { name: 'decimal places', key: '2/3', policy: POLICY({ rounding: { kind: 'DECIMAL_PLACES', digits: 2 } }), responses: [['0.67', true], ['0,67', true], ['0.667', false], ['0.66', false]] },
    { name: 'absolute tolerance', key: '12.5', policy: POLICY({ tolerance: { kind: 'ABSOLUTE', value: 0.05 } }), responses: [['12.5', true], ['12.54', true], ['12.6', false]] },
    { name: 'relative tolerance', key: '200', policy: POLICY({ tolerance: { kind: 'RELATIVE', value: 0.01 } }), responses: [['201', true], ['203', false]] },
    { name: 'required unit', key: '57.9', policy: POLICY({ units: { accepted: ['cm'], required: true } }), responses: [['57.9 cm', true], ['57.9cm', true], ['57.9', false], ['57.9 m', false]] },
    { name: 'optional unit', key: '45', policy: POLICY({ units: { accepted: ['%'], required: false } }), responses: [['45 %', true], ['45', true], ['46%', false]] },
    { name: 'accepted forms', key: '3/4', policy: POLICY({ acceptedRepresentations: ['FRACTION'] }), responses: [['3/4', true], ['6/8', true], ['0.75', false]] },
    { name: 'negative and unicode minus', key: '-2.5', policy: POLICY(), responses: [['−2.5', true], ['-2,5', true], ['-5/2', true], ['2.5', false]] },
  ];
  for (const c of CASES) {
    it(`same verdict at every stage: ${c.name}`, async () => {
      for (const [response, expected] of c.responses) {
        const s = await stages(instance(c.key, c.policy), response);
        expect({ response, ...s }).toEqual({ response, validation: expected, certification: expected, bank: expected, examCore: expected, examCoreOtherLanguage: expected });
      }
    });
  }

  it('ordered parts: each part is judged against its own key at every stage, never as alternatives', async () => {
    const policy = POLICY();
    const scheme = { v: 1, structure: 'ORDERED_PARTS', order: 'ASCENDING', targets: [{ targetId: 'a', kind: 'NUMBER', value: '2', equivalents: [], answerPoints: [0], method: null }, { targetId: 'b', kind: 'NUMBER', value: '3.5', equivalents: [], answerPoints: [1], method: null }] };
    const i: CertifiedInstance = { ...instance('2', { ...policy, markScheme: scheme } as ResponseEvaluationPolicy), marks: 2, key: { ...instance('2', policy).key, answers: ['2', '3.5'] },
      learner: { ...instance('2', policy).learner, parts: [{ label: 'a', prompt: 'The smaller value.', marks: 1 }, { label: 'b', prompt: 'The larger value.', marks: 1 }], marks: 2 },
      rubric: [{ code: 'A1', kind: 'ANSWER', marks: 1, criterion: '2' }, { code: 'A1', kind: 'ANSWER', marks: 1, criterion: '3.5' }] };
    const content = scoringBankContentOf(i);
    const item = examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content })!;
    for (const [a, b, marks] of [['2', '3,5', 2], ['3.5', '2', 0], ['2', '2', 1], ['4/2', '7/2', 2]] as const) {
      const canonical = evaluateOrderedParts(policy, ['2', '3.5'], [a, b]).filter((x) => x.correct).length;
      const core = await gradeExamItem(item, JSON.stringify({ a, b }), 'es');
      expect({ a, b, canonical, core: core.evaluation.score }).toEqual({ a, b, canonical: marks, core: marks });
    }
  });

  it('a policy that makes one character both decimal and grouping judges nothing', () => {
    const bad = POLICY({ decimalSeparators: ['.', ','], groupingSeparators: [','] });
    expect(policyIssues(bad)).toHaveLength(1);
    expect(evaluateCanonicalNumeric(bad, '2', '2').code).toBe('POLICY_INVALID');
    expect(parseCanonicalNumber('1,234,567.5', POLICY({ decimalSeparators: ['.'], groupingSeparators: [','] }))).toMatchObject({ ok: true, n: { value: 1234567.5, grouped: true } });
  });
});
