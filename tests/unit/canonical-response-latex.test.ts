/**
 * F1 (Candidate #1 browser smoke): the math keyboard writes TeX (\frac{975}{4}); the ONE canonical contract reads it
 * as the same written number at every layer -- canonical contract, Question Factory validation / certification
 * (evaluateResponse), Exam Bank projection 3 and Exam Core runtime scoring. Nothing else is interpreted; malformed
 * fractions fail closed; other TeX keeps its previous verdict.
 */
import { describe, expect, it } from 'vitest';
import { evaluateCanonicalNumeric, parseCanonicalNumber, type CanonicalNumericPolicy } from '@/lib/assessment-scoring/canonical-response';
import { EXACT_NUMERIC_POLICY, evaluateResponse } from '@/lib/assessment-instance/response-evaluation';
import { LIBRARY_EXTENSION_BATCHES, PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { PLANNING_BANDS } from '@/lib/assessment-instance/library/parametric';
import { certifyCell, governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { scoringBankContentOf } from '@/lib/exam-bank/scoring-projection';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';

const POLICY: CanonicalNumericPolicy = { acceptedRepresentations: ['INTEGER', 'DECIMAL', 'FRACTION'], decimalSeparators: ['.', ','], groupingSeparators: [], units: { accepted: [], required: false }, rounding: null, tolerance: null };
const CASES: [key: string, response: string, verdict: string][] = [
  ['975/4', '975/4', 'CORRECT'],
  ['975/4', '\\frac{975}{4}', 'CORRECT'],
  ['975/4', ' \\frac { 975 } { 4 } ', 'CORRECT'],
  ['975/4', '\\dfrac{975}{4}', 'CORRECT'],
  ['975/4', '243.75', 'CORRECT'],
  ['975/4', '243,75', 'CORRECT'],
  ['975/4', '243{,}75', 'CORRECT'],
  ['975/4', '\\frac{974}{4}', 'INCORRECT'],
  ['-3/2', '-\\frac{3}{2}', 'CORRECT'],
  ['-3/2', '\\frac{-3}{2}', 'CORRECT'],
  ['3/2', '-\\frac{3}{2}', 'INCORRECT'],
  ['7/2', '\\frac72', 'CORRECT'],
  ['975/4', '\\frac{975}', 'MALFORMED_NUMBER'],
  ['975/4', '\\frac{a}{b}', 'MALFORMED_NUMBER'],
  ['1/2', '\\frac123', 'MALFORMED_NUMBER'],
  ['7/2', '\\frac{7}{2}5', 'MALFORMED_NUMBER'],
  ['3/2', '\\frac{1.5}{1}', 'MALFORMED_NUMBER'],
  ['1/2', '\\frac{1}{0}', 'MALFORMED_NUMBER'],
  ['5', '\\sqrt{25}', 'NOT_A_NUMBER'],
];

describe('LATEX_FRACTION_NORMALIZATION (canonical contract)', () => {
  it.each(CASES)('key %s, response %j -> %s', (key, response, verdict) => {
    expect(evaluateCanonicalNumeric(POLICY, key, response).code).toBe(verdict);
  });
  it('the policy still decides: a FRACTION not accepted stays NOT_IN_AN_ACCEPTED_FORM; a decimal separator not allowed stays refused; units, rounding and tolerance are unchanged', () => {
    expect(evaluateCanonicalNumeric({ ...POLICY, acceptedRepresentations: ['INTEGER', 'DECIMAL'] }, '975/4', '\\frac{975}{4}').code).toBe('NOT_IN_AN_ACCEPTED_FORM');
    expect(evaluateCanonicalNumeric({ ...POLICY, decimalSeparators: ['.'] }, '975/4', '243{,}75').code).toBe('DECIMAL_SEPARATOR_NOT_ACCEPTED');
    expect(evaluateCanonicalNumeric({ ...POLICY, units: { accepted: ['cm'], required: true } }, '3/2', '\\frac{3}{2} cm').code).toBe('CORRECT');
    expect(evaluateCanonicalNumeric({ ...POLICY, rounding: { kind: 'SIGNIFICANT_FIGURES', digits: 3 } }, '975/4', '\\frac{975}{4}').code).toBe('CORRECT');
    expect(parseCanonicalNumber('\\frac{975}{4}', POLICY)).toMatchObject({ ok: true, n: { representation: 'FRACTION', value: 243.75 } });
  });
});

// the exact certified items: Cambridge 9709 P1 definite integral (key 975/4, failed in the Candidate #1 browser) and IB 83/4
const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
const certifiedOf = (batchId: string) => { const b = LIBRARY_EXTENSION_BATCHES.find((x) => x.batchId === batchId)!; return b.entries.flatMap((e) => PLANNING_BANDS.flatMap((band) => certifyCell(e, e.targets[0], band, 10, g, b.batchId).certified)); };
const cambridge = certifiedOf('CIE-9709-P1-A1').find((i) => i.key.answers[0] === '975/4')!;
const ib = certifiedOf('CF-IB-AAHL-01').find((i) => i.key.answers[0] === '83/4')!;

describe('CANONICAL_SCORER_PARITY: Question Factory / certification, Exam Bank projection, Exam Core runtime', () => {
  it('the exact failing Cambridge item and the IB SHORT_RESPONSE item are the certified ones', () => {
    expect(cambridge.learner.prompt).toBe('Evaluate ∫₁⁴ (x³ + 6x² + 6x + 3) dx, giving your answer as an exact value.');
    expect({ format: cambridge.format, system: cambridge.systemId }).toEqual({ format: 'SHORT_RESPONSE', system: 'CAMBRIDGE' });
    expect({ format: ib.format, system: ib.systemId }).toEqual({ format: 'SHORT_RESPONSE', system: 'IB' });
  });
  const layered: [string, () => typeof cambridge, string, boolean][] = [
    ['Cambridge', () => cambridge, '975/4', true], ['Cambridge', () => cambridge, '\\frac{975}{4}', true], ['Cambridge', () => cambridge, '243.75', true], ['Cambridge', () => cambridge, '\\frac{974}{4}', false], ['Cambridge', () => cambridge, '\\frac{975}', false],
    ['IB', () => ib, '83/4', true], ['IB', () => ib, '\\frac{83}{4}', true], ['IB', () => ib, '20{,}75', true], ['IB', () => ib, '\\frac{84}{4}', false], ['IB', () => ib, '\\frac83', false],
  ];
  it.each(layered)('%s %j: every layer gives the same verdict', async (_s, item, response, correct) => {
    const i = item();
    // Question Factory validation + certification judge through evaluateResponse
    expect(evaluateResponse(i.responsePolicy as typeof EXACT_NUMERIC_POLICY, i.key.answers, response).correct, 'evaluateResponse').toBe(correct);
    // the Exam Bank version carries the contract; the Exam Core scores it
    const content = scoringBankContentOf(i);
    expect((content as any).math.responseContract.version).toBe('canonical-response-1');
    const graded = await gradeExamItem(examItemFromApproved({ id: 'v', learning_objective_id: 'lo', content })!, response, 'en');
    expect({ score: graded.evaluation.score === i.marks, contract: (graded as any).evaluation?.gradingDetail?.contract ?? 'canonical-response-1' }, 'Exam Core').toEqual({ score: correct, contract: 'canonical-response-1' });
  });
});
