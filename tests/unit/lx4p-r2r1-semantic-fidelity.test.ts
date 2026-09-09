/**
 * LX-4P-R2R1 -- SEMANTIC FIDELITY GATE.
 *
 * Structural equality (numbers / formulas / option ids) cannot catch a
 * lost negation, a flipped comparison, a changed unit scale, or an
 * inverted causal/temporal relation. R2R1 adds unit-integrity checks
 * plus an INDEPENDENT semantic-equivalence verification AI call, and
 * fails closed: a localized presentation is used only if every gate
 * passes.
 *
 * The pure gates (unit integrity, verdict evaluation) are unit-tested
 * directly; the AI verification call and its wiring are
 * source/contract-checked. Runtime behaviour is HARNESS-verified in the
 * LX-4P-R2R1 report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  reconcileLocalization,
  evaluateVerdict,
  SEMANTIC_VERIFY_MIN_CONFIDENCE,
  type SemanticVerdict,
} from '@/services/question-localization.service';
import { PROMPT_REGISTRY } from '@/lib/ai';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const SERVICE = read('src/services/question-localization.service.ts');
const ROUTE = read('src/app/api/quizzes/localize-question/route.ts');

const base: GeneratedQuestion = {
  id: 'q-1',
  conceptId: 'c-1',
  type: 'numeric_problem',
  answerFormat: 'text',
  question: 'A car travels 5 m in 2 s at 20 °C. Compute its speed in m/s.',
  correctAnswer: '2.5 m/s',
  explanation: 'x ≤ y',
  difficulty: 2,
};
const faithfulEs = {
  question: 'Un coche recorre 5 m en 2 s a 20 °C. Calcula su rapidez en m/s.',
  explanation: 'x ≤ y',
};

/* ---------- R1: structural validator NOT weakened ---------- */
describe('LX-4P-R2R1 R1 -- every LX-4P-R2 structural check is still enforced', () => {
  it('still rejects numeric drift, formula drift, option drift, empty text', () => {
    expect(reconcileLocalization(base, { question: 'Un coche recorre 5 m en 3 s a 20 °C. Calcula su rapidez en m/s.', explanation: base.explanation })).toEqual(
      { ok: false, reason: 'NUMERIC_DRIFT' },
    );
    expect(reconcileLocalization(base, { question: faithfulEs.question, explanation: 'x ≥ y' })).toEqual({
      ok: false,
      reason: 'FORMULA_DRIFT',
    });
    expect(reconcileLocalization(base, { question: '   ' })).toEqual({ ok: false, reason: 'EMPTY_TEXT' });
    const mc: GeneratedQuestion = { ...base, type: 'multiple_choice', answerFormat: 'single_choice', options: [{ id: 'A', text: 'x' }, { id: 'B', text: 'y' }] };
    expect(reconcileLocalization(mc, { question: 'q', options: [{ id: 'A', text: 'x' }] })).toEqual({ ok: false, reason: 'OPTION_DRIFT' });
  });
  it('a faithful translation with identical units still passes the structural gate', () => {
    const r = reconcileLocalization(base, faithfulEs);
    expect(r.ok).toBe(true);
  });
});

/* ---------- R2: unit / scale integrity ---------- */
describe('LX-4P-R2R1 R2 -- unit and scale integrity', () => {
  it('rejects a length-scale change: 5 m -> 5 km', () => {
    expect(reconcileLocalization(base, { question: 'Un coche recorre 5 km en 2 s a 20 °C. Calcula su rapidez en m/s.', explanation: base.explanation })).toEqual(
      { ok: false, reason: 'UNIT_DRIFT' },
    );
  });
  it('rejects a temperature-scale change: 20 °C -> 20 °F', () => {
    expect(reconcileLocalization(base, { question: 'Un coche recorre 5 m en 2 s a 20 °F. Calcula su rapidez en m/s.', explanation: base.explanation })).toEqual(
      { ok: false, reason: 'UNIT_DRIFT' },
    );
  });
  it('rejects a speed-unit change: 4 m/s -> 4 km/h', () => {
    const q: GeneratedQuestion = { ...base, question: 'The ball moves at 4 m/s.', explanation: 'ok' };
    expect(reconcileLocalization(q, { question: 'La pelota se mueve a 4 km/h.', explanation: 'ok' })).toEqual({ ok: false, reason: 'UNIT_DRIFT' });
  });
  it('does NOT flag a bare English article "A" or a bare variable "m" as a unit', () => {
    const q: GeneratedQuestion = { ...base, question: 'A mass m rests on a table. What is m in kg if it weighs 9.8 N?', explanation: 'ok' };
    const r = reconcileLocalization(q, { question: 'Una masa m descansa sobre una mesa. ¿Cuánto vale m en kg si pesa 9.8 N?', explanation: 'ok' });
    expect(r.ok).toBe(true);
  });
});

/* ---------- R3/R4: verdict evaluation is fail-closed ---------- */
describe('LX-4P-R2R1 R3/R4 -- semantic verdict is evaluated fail-closed', () => {
  const good: SemanticVerdict = { equivalent: true, correctAnswerStillValid: true, semanticDifferences: [], confidence: 0.95 };

  it('passes only when equivalent AND correctAnswerStillValid AND confident', () => {
    expect(evaluateVerdict(good)).toEqual({ pass: true });
  });
  it('R7.1 lost negation -> verifier reports not equivalent -> REJECT', () => {
    expect(evaluateVerdict({ ...good, equivalent: false, semanticDifferences: ['negation "NOT" dropped'] })).toEqual({
      pass: false,
      reason: 'SEMANTIC_MISMATCH',
    });
  });
  it('R7.2/7.3 flipped comparison (increase<->decrease, greater<->less) -> REJECT', () => {
    expect(evaluateVerdict({ ...good, equivalent: false, semanticDifferences: ['"increases" became "decreases"'] }).pass).toBe(false);
    expect(evaluateVerdict({ ...good, equivalent: false, semanticDifferences: ['"greater than" became "less than"'] }).pass).toBe(false);
  });
  it('R7.6 correct option id kept but its meaning changed -> correctAnswerStillValid false -> REJECT', () => {
    expect(evaluateVerdict({ ...good, correctAnswerStillValid: false })).toEqual({ pass: false, reason: 'SEMANTIC_MISMATCH' });
  });
  it('low confidence -> REJECT (safety > convenience)', () => {
    expect(evaluateVerdict({ ...good, confidence: SEMANTIC_VERIFY_MIN_CONFIDENCE - 0.01 })).toEqual({
      pass: false,
      reason: 'SEMANTIC_LOW_CONFIDENCE',
    });
  });
  it('missing / malformed / null verdict -> REJECT (verifier error)', () => {
    expect(evaluateVerdict(null)).toEqual({ pass: false, reason: 'SEMANTIC_VERIFY_ERROR' });
    expect(evaluateVerdict({ equivalent: true } as any)).toEqual({ pass: false, reason: 'SEMANTIC_VERIFY_ERROR' });
    expect(evaluateVerdict({ ...good, confidence: NaN })).toEqual({ pass: false, reason: 'SEMANTIC_VERIFY_ERROR' });
  });
  it('R7.7 a genuinely equivalent translation -> PASS', () => {
    expect(evaluateVerdict({ equivalent: true, correctAnswerStillValid: true, semanticDifferences: [], confidence: 0.9 })).toEqual({ pass: true });
  });
});

/* ---------- R3: the verifier is an independent VERIFICATION call ---------- */
describe('LX-4P-R2R1 R3 -- independent semantic verification, not generation', () => {
  it('quiz.question_localization_verify is registered and is not a generation prompt', () => {
    expect(PROMPT_REGISTRY['quiz.question_localization_verify']).toBeTruthy();
    expect(PROMPT_REGISTRY['quiz.question_localization_verify'].capability).not.toBe('QUESTION_GENERATION');
    expect(PROMPT_REGISTRY['quiz.question_localization_verify'].capability).not.toBe('CONTENT_GENERATION');
  });
  it('the verify prompt tells the model to judge, never translate/rewrite/fix', () => {
    expect(SERVICE).toMatch(/You VERIFY whether a localized exam question still asks exactly the same thing/);
    expect(SERVICE).toMatch(/You do NOT translate, rewrite, improve or fix anything/);
    expect(SERVICE).toMatch(/negations preserved/i);
    expect(SERVICE).toMatch(/[Cc]omparisons preserved/);
    expect(SERVICE).toMatch(/units preserved/i);
    expect(SERVICE).toMatch(/is that answer STILL correct/);
  });
  it('the verifier compares the candidate against the CANONICAL source item + stored correctAnswer', () => {
    expect(SERVICE).toMatch(/correctAnswer: original\.correctAnswer/);
    expect(SERVICE).toMatch(/source: \{\s*\n?\s*question: original\.question/);
    expect(SERVICE).toMatch(/candidate: \{\s*\n?\s*question: candidate\.question/);
  });
  it('a verifier provider error resolves to null -> evaluateVerdict rejects (fail-closed)', () => {
    expect(SERVICE).toMatch(/\} catch \{\s*\n\s*return null;\s*\n\s*\}/); // verifyLocalizationEquivalence catch
  });
});

/* ---------- R4: localizeGeneratedQuestion runs all gates in order ---------- */
describe('LX-4P-R2R1 R4 -- localization succeeds only when every gate passes', () => {
  it('structural reconciliation runs first and short-circuits on failure', () => {
    expect(SERVICE).toMatch(/const structural = reconcileLocalization\(question, ai\);\s*\n\s*if \(!structural\.ok\) return structural;/);
  });
  it('the semantic verifier runs after reconciliation and gates the result', () => {
    expect(SERVICE).toMatch(/const verdict = await verifyLocalizationEquivalence\(\{\s*\n\s*original: question,\s*\n\s*candidate: structural\.question/);
    expect(SERVICE).toMatch(/const evaluated = evaluateVerdict\(verdict\);\s*\n\s*if \(!evaluated\.pass\) return \{ ok: false, reason: evaluated\.reason \};/);
  });
  it('all failure reasons are represented, incl. the new semantic ones', () => {
    for (const reason of ['UNIT_DRIFT', 'SEMANTIC_VERIFY_ERROR', 'SEMANTIC_MISMATCH', 'SEMANTIC_LOW_CONFIDENCE']) {
      expect(SERVICE).toContain(`'${reason}'`);
    }
  });
});

/* ---------- R5: source vs display language ---------- */
describe('LX-4P-R2R1 R5 -- source and display question language are distinct', () => {
  it('localizeGeneratedQuestion takes BOTH displayLanguage and sourceLanguage', () => {
    expect(SERVICE).toMatch(/displayLanguage: string;/);
    expect(SERVICE).toMatch(/sourceLanguage: string;/);
    expect(SERVICE).toMatch(/the stored session language\)\./); // doc: display != stored
  });
  it('the route passes session.language as sourceLanguage and never mutates it', () => {
    expect(ROUTE).toMatch(/displayLanguage: v\.targetLanguage/);
    expect(ROUTE).toMatch(/sourceLanguage: session\.language/);
    expect(ROUTE).not.toMatch(/UPDATE quiz_sessions|storeQuiz|session\.language\s*=\s*[^=]/);
  });
  it('the verifier is told both languages', () => {
    expect(SERVICE).toMatch(/sourceLanguage: sourceName/);
    expect(SERVICE).toMatch(/displayLanguage: displayName/);
  });
});

/* ---------- R8: evidence integrity ---------- */
describe('LX-4P-R2R1 R8 -- a localized presentation stands in only if the stored answer is still correct', () => {
  it('the gate is exactly correctAnswerStillValid (from the verifier) -- nothing else can override it', () => {
    // evaluateVerdict cannot pass while correctAnswerStillValid is false
    const v: SemanticVerdict = { equivalent: true, correctAnswerStillValid: false, semanticDifferences: [], confidence: 1 };
    expect(evaluateVerdict(v).pass).toBe(false);
  });
  it('the service writes no evidence / mastery / session row', () => {
    for (const src of [SERVICE, ROUTE]) {
      expect(src).not.toMatch(/updateMastery|learning_evidence|INSERT INTO|UPDATE quiz_sessions|storeQuiz/);
    }
  });
  it('the submit/grading path is untouched -- it still reads the stored original', () => {
    const GEN = read('src/app/api/quizzes/generate-and-take/route.ts');
    expect(GEN).toMatch(/const cachedQuestions = quizSession\.questions/);
    expect(GEN).toMatch(/const language = quizSession\.language/);
  });
});
