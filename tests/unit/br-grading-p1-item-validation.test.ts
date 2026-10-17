/**
 * BR GRADING -- Browser E2E P1 blockers (pilot candidate, QA Student A, "Ecuaciones lineales").
 *
 * P1-02: a correct algebra answer was graded "Casi" (ALMOST / MINOR_SLIP) -- the grader claimed the
 *        learner should have written 13(72,5) instead of 13(62,5), while its own correction confirmed
 *        13(72,5-10) = 13(62,5) = 812,5. Response 1b642854 / grade 6e792ab8, Prove quiz-1792262040211-a3cgw2 #3.
 *        Root cause: the deterministic final-value check took the LAST number written (the check value
 *        812,5) as the answer, so it said DIFFERENT -> UNDECIDABLE (prose) and the AI "slip" decided.
 * P1-03: a LEARN multiple-choice item had no correct option (x = 3 satisfies none of A-D), key A, and an
 *        explanation computing 2·3 + 1 = 7, not 8 (learn_guided session c3efd769, interaction #5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const callModelMock = vi.fn();
const dbQuery = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQuery(...a) }, query: (...a: any[]) => dbQuery(...a) }));
vi.mock('@/lib/ai/adapters/call-model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/adapters/call-model')>()),
  callModel: (...a: any[]) => callModelMock(...a),
}));

import { solvedWorkEquivalent, checkShownWork, extractSolutionCommitments, solveEquation, finalValuesEquivalent } from '@/lib/grading/math-equivalence';
import { composePedagogicalGrade, deterministicEvidence } from '@/lib/grading/pedagogical-grade';
import { gradeAnswer } from '@/services/quiz-generation.service';
import { validateChoiceItem } from '@/lib/lx/choice-item-validator';
import { checkQuestionQualityDeterministic } from '@/lib/lx/question-quality-contract';
import { toLearnQuestion } from '@/lib/learn-guided/policy';
import { assembleFromBank, type BankCandidate } from '@/lib/activity-delivery/assembly';
import { addValidatedCandidates } from '@/services/question-bank.service';
import { consumeCompatibleInventory } from '@/services/activity-inventory.service';
import { toClientQuestion, referencesOptionLetters } from '@/lib/quiz/client-question';
import { buildPlan } from '../../scripts/operations/pilot-qa-quarantine-items';

beforeEach(() => {
  callModelMock.mockReset();
  dbQuery.mockReset();
  dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// --- P1-02: the exact candidate item and learner answer ---
const P102_Q = {
  type: 'error_detection',
  question: 'Un estudiante resuelve la ecuación $13(x-10)=11x+15$ así:\n\n$$13x-10=11x+15$$\n$$2x=25$$\n$$x=12{,}5$$\n\nIdentifica el error y corrige la solución.',
  correctAnswer: 'El error está al distribuir el $13$: debe multiplicar tanto a $x$ como a $-10$. La solución correcta es $x=\\frac{145}{2}$ o $72{,}5$.',
};
const P102_A = 'El error esta en la distributiva: 13(x-10) = 13x - 130, no 13x - 10. Correccion: 13x - 130 = 11x + 15 -> 2x = 145 -> x = 72,5. Comprobacion: 13(62,5) = 812,5 y 11(72,5)+15 = 812,5.';
const P102_AI_SLIP = {
  mathematicalCorrectness: 'MINOR_SLIP' as const,
  requirements: [{ id: 'identify_error', met: true }, { id: 'corrected_result', met: true }],
  reasoningQuality: 'ADEQUATE' as const,
  errorType: 'CARELESS',
  didWell: 'Tu razonamiento es correcto; revisa el cálculo final.',
  toFix: 'En la comprobación escribiste 13(62,5) en vez de 13(72,5). La comprobación correcta es 13(72,5−10)=13(62,5)=812,5 y 11(72,5)+15=812,5.',
};

describe('P1-02 -- a deterministically correct answer can never be marked down by the AI', () => {
  it('root cause: the last number written (the check value 812,5) is not the learner answer', () => {
    expect(finalValuesEquivalent(P102_A, P102_Q.correctAnswer).status).toBe('DIFFERENT');
    expect(extractSolutionCommitments(P102_A)).toEqual([{ variable: 'x', value: 72.5, decimals: 1 }]);
  });

  it('13(x-10), x = 72,5 -> 812,5: every equality of the shown work is verified true at the solution', () => {
    expect(checkShownWork(P102_A, 'x', 72.5)).toEqual({ checked: 6, falseStatements: [] });
    expect(solvedWorkEquivalent(P102_A, P102_Q.correctAnswer).status).toBe('EQUIVALENT');
  });

  it('REGRESSION: learner work "13(62,5) = 812,5" -> CORRECT, even when the AI reports a slip', () => {
    const det = deterministicEvidence(P102_Q, P102_A, 'es');
    expect(det.result).toBe('EQUIVALENT');
    const g = composePedagogicalGrade(det, P102_AI_SLIP);
    expect(g).toMatchObject({ mathematicalCorrectness: 'CORRECT', finalJudgment: 'CORRECT', score: 1, learnerSignal: 'NONE', errorType: null });
    // the self-contradictory AI correction is not kept as feedback
    expect(g.feedback).toEqual({ didWell: null, missing: [], toFix: null });
  });

  it('end to end through the grader (AI mocked to say MINOR_SLIP): correct, score 1, the system tells the AI the value is verified', async () => {
    callModelMock.mockResolvedValueOnce({
      text: JSON.stringify({ mathematical_correctness: 'MINOR_SLIP', requirements: P102_AI_SLIP.requirements, reasoning_quality: 'ADEQUATE', conceptual_error: false, misconception: null, error_type: 'CARELESS', did_well: P102_AI_SLIP.didWell, to_fix: P102_AI_SLIP.toFix, confidence: 0.9 }),
      raw: {}, provider: 'openai', model: 'gpt-5.6-terra',
    });
    const r = await gradeAnswer({ ...P102_Q, conceptId: 'c', difficulty: 4 } as any, P102_A, 'es');
    expect(callModelMock.mock.calls[0][0].user).toMatch(/VERIFIED by the system/);
    expect(r).toMatchObject({ correct: true, score: 1 });
    expect(r.pedagogical?.finalJudgment).toBe('CORRECT');
    expect(r.feedback).not.toMatch(/13\(72,5\)/);
  });

  it('a real slip in the shown work is NOT upgraded (the AI still decides); a wrong solution is never verified', () => {
    const slip = P102_A.replace('13(62,5) = 812,5', '13(72,5) = 812,5');
    expect(solvedWorkEquivalent(slip, P102_Q.correctAnswer).status).toBe('UNDECIDABLE');
    expect(composePedagogicalGrade(deterministicEvidence(P102_Q, slip, 'es'), P102_AI_SLIP).finalJudgment).toBe('ALMOST');
    const wrong = 'El error es la distributiva. 13x - 10 = 11x + 15 -> 2x = 25 -> x = 12,5';
    expect(solvedWorkEquivalent(wrong, P102_Q.correctAnswer).status).toBe('DIFFERENT');
    // never verified EQUIVALENT (prose keeps the existing asymmetric authority: no false negative from prose)
    expect(deterministicEvidence(P102_Q, wrong, 'es').result).not.toBe('EQUIVALENT');
    expect(composePedagogicalGrade(deterministicEvidence(P102_Q, 'x = 12,5', 'es'), { mathematicalCorrectness: 'CORRECT', requirements: P102_AI_SLIP.requirements }).finalJudgment).toBe('INCORRECT');
  });

  it('accepts equivalent final forms with shown work (fraction, decimal point, unicode minus)', () => {
    for (const a of ['13x − 130 = 11x + 15, 2x = 145, x = 145/2', 'x = 72.5', 'Distribuyo: 13x-130=11x+15 => x = \\frac{145}{2}']) {
      expect(solvedWorkEquivalent(a, P102_Q.correctAnswer).status, a).toBe('EQUIVALENT');
    }
  });

  it('solveEquation never "solves" a diverging run and finds rational roots', () => {
    expect(solveEquation('2/(x-1) = 1', 'point')?.value).toBeCloseTo(3, 9);
    expect(solveEquation('1/x = 0', 'point')).toBeNull();
  });
});

// --- P1-03: the exact LEARN item ---
const P103_BAD = {
  type: 'multiple_choice', answerFormat: 'single_choice', correctAnswer: 'A', difficulty: 2, conceptId: 'c', id: 'x',
  question: '¿En cuál de las siguientes ecuaciones el valor x = 3 es una solución?',
  options: [{ id: 'A', text: '2x + 1 = 8' }, { id: 'B', text: '4x - 2 = 9' }, { id: 'C', text: 'x + 5 = 10' }, { id: 'D', text: '3x + 4 = 12' }],
  explanation: 'Al sustituir x = 3 en 2x + 1 = 8, resulta 2·3 + 1 = 7, no 8. Por tanto, revisa la sustitución para identificar correctamente la ecuación cuya igualdad se cumple.',
};
const P103_GOOD = {
  type: 'multiple_choice', answerFormat: 'single_choice', correctAnswer: 'B', difficulty: 2, conceptId: 'c', id: 'y',
  question: '¿Cuál es el valor de x en la ecuación 5x - 3 = 2x + 12?',
  options: [{ id: 'A', text: 'x = 3' }, { id: 'B', text: 'x = 5' }, { id: 'C', text: 'x = 9' }, { id: 'D', text: 'x = 15' }],
  explanation: 'Restamos 2x a ambos lados: 3x - 3 = 12. Sumamos 3: 3x = 15. Finalmente, dividimos entre 3 y obtenemos x = 5.',
};
const codes = (q: any) => validateChoiceItem(q).failures.map((f) => f.code);

describe('P1-03 -- an MCQ whose key is not the right option is never delivered', () => {
  it('the observed item: no option satisfies x = 3, and the explanation refutes the key', () => {
    expect(codes(P103_BAD)).toEqual(['MCQ_NO_OPTION_SATISFIES', 'EXPLANATION_REFUTES_KEY']);
  });

  it('a sound item passes; a wrong key / two right options / a negated stem', () => {
    expect(validateChoiceItem(P103_GOOD)).toMatchObject({ ok: true, family: 'EQUATION_HAS_VALUE', satisfyingOptionIds: ['B'] });
    expect(codes({ ...P103_GOOD, correctAnswer: 'A' })).toEqual(['MCQ_KEY_DOES_NOT_SATISFY']);
    const two = { ...P103_BAD, options: [{ id: 'A', text: '2x + 1 = 7' }, { id: 'B', text: 'x + 5 = 8' }, { id: 'C', text: 'x = 4' }, { id: 'D', text: '3x = 10' }], explanation: 'Sustituye x = 3.' };
    expect(codes(two)).toEqual(['MCQ_MULTIPLE_OPTIONS_SATISFY']);
    expect(validateChoiceItem({ ...P103_BAD, question: '¿En cuál de las ecuaciones x = 3 NO es una solución?', explanation: 'Comprueba cada una.' }).family).toBeNull();
  });

  it('key/explanation consistency: another letter named as the answer; letters only in capitals', () => {
    expect(codes({ ...P103_GOOD, explanation: `${P103_GOOD.explanation} Por eso la respuesta correcta es la C.` })).toEqual(['EXPLANATION_NAMES_OTHER_OPTION']);
    expect(codes({ ...P103_GOOD, explanation: 'Option D is correct because 3x = 15.' })).toEqual(['EXPLANATION_NAMES_OTHER_OPTION']);
    expect(codes({ ...P103_GOOD, explanation: 'La correcta es a partir de 3x = 15: x = 5. La opción B es correcta.' })).toEqual([]);
    // a non-math item is checked for consistency only
    const prose = { answerFormat: 'single_choice', correctAnswer: 'A', question: '¿Qué es una ecuación lineal?', options: [{ id: 'A', text: 'grado 1' }, { id: 'B', text: 'grado 2' }, { id: 'C', text: 'sin variable' }], explanation: 'La opción C es correcta.' };
    expect(codes(prose)).toEqual(['EXPLANATION_NAMES_OTHER_OPTION']);
  });

  it('a correct item whose explanation dismisses the OTHER options is not a false rejection', () => {
    const ok = { ...P103_BAD, options: [...P103_BAD.options.slice(0, 3), { id: 'D', text: '3x + 4 = 13' }], correctAnswer: 'D', explanation: 'Sustituyendo x = 3 en 3x + 4 = 13: 3·3 + 4 = 13, se cumple. En las demás no se cumple.' };
    expect(validateChoiceItem(ok)).toMatchObject({ ok: true, satisfyingOptionIds: ['D'] });
  });

  it('wired: live generation (Quality Gate) FAILs it', () => {
    const r = checkQuestionQualityDeterministic(P103_BAD as any, { conceptId: 'c' });
    expect(r.status).toBe('FAIL');
    expect(r.failures.map((f) => f.code)).toContain('MCQ_NO_OPTION_SATISFIES');
  });

  it('wired: a LEARN guided interaction is rejected (the turn is regenerated)', () => {
    const raw = { type: 'multiple_choice', question: P103_BAD.question, options: P103_BAD.options, correctAnswer: 'A', explanation: P103_BAD.explanation, difficulty: 2 };
    expect(toLearnQuestion(raw, 'c', 'id')).toBeNull();
    expect(toLearnQuestion({ ...raw, question: P103_GOOD.question, options: P103_GOOD.options, correctAnswer: 'B', explanation: P103_GOOD.explanation }, 'c', 'id')).not.toBeNull();
  });

  it('wired: bank assembly never serves it', () => {
    const cand = (id: string, question: any): BankCandidate => ({ id, question, difficulty: 2, contentFingerprint: id, transferDepth: null, usageCount: 0, delivered: false });
    const r = assembleFromBank([cand('bad', P103_BAD)], { activityType: 'PRACTICE', itemCount: 1, difficulty: { min: 1, max: 5, target: 2 }, language: 'es', excludeFingerprints: new Set(), reservedCandidateIds: new Set() });
    expect(r.status).toBe('SHORT');
    const ok = assembleFromBank([cand('bad', P103_BAD), cand('good', P103_GOOD)], { activityType: 'PRACTICE', itemCount: 1, difficulty: { min: 1, max: 5, target: 2 }, language: 'es', excludeFingerprints: new Set(), reservedCandidateIds: new Set() });
    expect(ok).toMatchObject({ status: 'ASSEMBLED', candidateIds: ['good'] });
  });

  it('wired: bank admission refuses it (no INSERT)', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'new' }] }) };
    const meta = { studentId: 's', conceptId: 'c', activityType: 'PRACTICE', language: 'es', academic: {} as any, generator: { provider: null, model: null, promptId: null, promptVersion: 'v', operationId: null } } as any;
    const r = await addValidatedCandidates([P103_BAD as any, P103_GOOD as any], meta, client as any);
    expect(r).toEqual({ inserted: 1, ids: [null, 'new'] });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('wired: a prepared inventory set holding it is invalidated, never served; quarantined candidates retire sets', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ retired: null, id: 'prep-1', questions: [P103_GOOD, P103_BAD], candidate_ids: ['a', 'b'] }] });
    const r = await consumeCompatibleInventory({ studentId: 's', conceptId: 'c', stage: 'PRACTICE', policyVersion: 'v' } as any, { contractFingerprint: 'f', learnerStateFingerprint: 'l', independent: false });
    expect(r).toBeNull();
    expect(dbQuery.mock.calls[1][0]).toMatch(/SET status = 'INVALIDATED', failure_reason = 'ITEM_INVALID'/);
    expect(dbQuery.mock.calls[0][0]).toMatch(/qc\.validation_status <> 'VALIDATED'[\s\S]*CANDIDATE_QUARANTINED/);
  });

  it('wired: the Prove pre-generated batch revalidation rejects it', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/canonical-prepared-activity.service.ts'), 'utf-8');
    expect(src).toMatch(/if \(!prepared\.questions\.every\(\(q\) => isDeliverableChoiceItem\(q\)\)\) \{\s*return \{ valid: false, reason: 'ITEM_INVALID' \};/);
  });
});

describe('P2 -- option letters stay the letters the explanation names', () => {
  it('an item whose explanation names "la opción C" keeps its canonical order (no re-lettering shuffle)', () => {
    const q = { ...P103_GOOD, explanation: 'La opción B es correcta: x = 5.' } as any;
    expect(referencesOptionLetters(q)).toBe(true);
    for (let i = 0; i < 10; i++) expect(toClientQuestion(q, 0).options!.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(referencesOptionLetters({ ...P103_GOOD, explanation: 'the answer a student gives' } as any)).toBe(false);
  });
});

describe('quarantine script -- plan is computed with the same validator', () => {
  it('rejects failing VALIDATED candidates, invalidates sets holding them, expires an active LEARN session pending on one, reports closed sessions as evidence only', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (/FROM question_bank_candidates/.test(sql)) return { rows: [{ id: 'cand-bad', student_id: 's', concept_id: 'c', activity_type: 'PRACTICE', question: P103_BAD }, { id: 'cand-ok', student_id: 's', concept_id: 'c', activity_type: 'PRACTICE', question: P103_GOOD }] };
        if (/FROM canonical_prepared_activity/.test(sql)) return { rows: [{ id: 'prep-1', stage: 'PRACTICE', status: 'READY', questions: [P103_GOOD], candidate_ids: ['cand-bad'] }, { id: 'prep-2', stage: 'PRACTICE', status: 'READY', questions: [P103_GOOD], candidate_ids: ['cand-ok'] }] };
        if (/FROM quiz_sessions/.test(sql)) return { rows: [
          { id: 'learn-active', status: 'active', quiz_mode: 'learn_guided', questions: [{ question: P103_GOOD, answer: 'B' }, { question: P103_BAD }] },
          { id: 'learn-done', status: 'completed', quiz_mode: 'learn_guided', questions: [{ question: P103_BAD, answer: 'A' }] },
        ] };
        return { rows: [] };
      }),
    };
    const p = await buildPlan(client as any);
    expect(p.candidates.map((c) => c.id)).toEqual(['cand-bad']);
    expect(p.preparedActivities).toEqual([{ id: 'prep-1', stage: 'PRACTICE', status: 'READY', reason: 'CANDIDATE_REJECTED:cand-bad' }]);
    expect(p.activeLearnSessions.map((s) => [s.id, s.pendingIndex])).toEqual([['learn-active', 1]]);
    expect(p.deliveredEvidence.map((e) => e.sessionId)).toEqual(['learn-done']);
  });

  it('is governed: candidate fingerprint guard, --apply + --expect, one transaction, fail-closed counts, audit, never DELETE', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/operations/pilot-qa-quarantine-items.ts'), 'utf-8');
    expect(src).toMatch(/CANDIDATE_FP = '4baac799b9bd2a6a'/);
    expect(src).toMatch(/if \(!apply\)/);
    expect(src).toMatch(/--apply needs --expect/);
    expect(src).toMatch(/BEGIN[\s\S]*COMMIT[\s\S]*ROLLBACK/);
    expect(src).toMatch(/FAIL-CLOSED/);
    expect(src).toMatch(/LEARNING_ITEM_QUARANTINED/);
    expect(src).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
