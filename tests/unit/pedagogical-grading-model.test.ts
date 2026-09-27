/**
 * PEDAGOGICAL_GRADING_MODEL -- StudyUS grades like a teacher, not like a
 * string comparator. Mathematical correctness (notation-independent), task
 * completion (each requested component) and reasoning quality are judged
 * separately; one deterministic rule yields CORRECT / ALMOST / INCORRECT;
 * an omission is never a misconception.
 *
 * The E2E scenarios use the EXACT 10 questions of the real DEV Prove session
 * quiz-1790519535689-z1t5rj ("Regla de tres simple directa", 79%, six
 * INCOMPLETE errors). The learner's typed answers were never persisted, so
 * representative answers of each observed shape are used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const callModelMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }) }, query: vi.fn().mockResolvedValue({ rows: [] }) }));
vi.mock('@/lib/ai/adapters/call-model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/adapters/call-model')>()),
  callModel: (...a: any[]) => callModelMock(...a),
}));

import {
  normalizeMathText, extractFinalValue, finalValuesEquivalent, expressionsEquivalent, equationsEquivalent, isBareValue,
} from '@/lib/grading/math-equivalence';
import { deriveTaskRequirements } from '@/lib/grading/task-requirements';
import { composePedagogicalGrade, deterministicEvidence, isRecordableError, type GraderAssessment } from '@/lib/grading/pedagogical-grade';
import { pedagogicalFeedbackText } from '@/lib/grading/pedagogical-feedback';
import { gradeAnswer } from '@/services/quiz-generation.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

// --- the real Prove questions (DEV, read-only) ---
const Q1 = { type: 'error_detection', question: 'Un estudiante resuelve este problema: «Si 5 cuadernos cuestan 40 €, ¿cuánto cuestan 8 cuadernos?». Escribe: $x=\\frac{5\\times 40}{8}=25$ €, por lo tanto, 8 cuadernos cuestan 25 €. Identifica el error y corrige el resultado.', correctAnswer: 'El estudiante colocó las magnitudes de forma incorrecta en la proporción. El resultado correcto es 64 €: $x=\\frac{40\\times 8}{5}=64$.' };
const Q2 = { type: 'error_detection', question: 'Una estudiante plantea esta situación: «Si $4$ cuadernos cuestan $12$ euros, ¿cuánto cuestan $7$ cuadernos?». Escribe la proporción $\\frac{4}{12}=\\frac{x}{7}$ y obtiene $x=\\frac{12\\times7}{4}=21$. Identifica el error y escribe una proporción correcta para resolver el problema.', correctAnswer: 'El error es mezclar cantidades que no son correspondientes: relacionó cuadernos con euros en un lado y euros con cuadernos en el otro. Una proporción correcta es $\\frac{4}{7}=\\frac{12}{x}$, de la que resulta $x=21$ euros.' };
const Q3 = { type: 'numeric_problem', question: 'Para preparar $8$ vasos de limonada se usan $600\\,\\text{mL}$ de agua. Si se mantiene la misma cantidad de agua por vaso, ¿cuántos mililitros se necesitan para preparar $14$ vasos?', correctAnswer: '$1050\\,\\text{mL}$' };
const Q5 = { type: 'justification', question: 'Dos estudiantes analizan esta situación: una impresora imprime $45$ páginas en $3$ minutos, trabajando a ritmo constante. Para imprimir $90$ páginas, Ana afirma que necesitará el doble de tiempo. Bruno afirma que necesitarará la mitad de tiempo. ¿Quién tiene razón? Justifica usando la relación entre las magnitudes.', correctAnswer: 'Ana tiene razón. A ritmo constante, el número de páginas y el tiempo son directamente proporcionales: si las páginas pasan de $45$ a $90$, se duplican; por tanto, el tiempo también se duplica, de $3$ a $6$ minutos.' };
const Q6 = { type: 'error_detection', question: 'Un estudiante resuelve este problema: «$5$ cuadernos cuestan $18$ euros. ¿Cuánto cuestan $8$ cuadernos?». Escribe la proporción $\\frac{5}{18}=\\frac{x}{8}$ y obtiene $x=\\frac{5\\times8}{18}=\\frac{20}{9}$ euros. Identifica el error y corrígelo.', correctAnswer: 'El estudiante colocó magnitudes distintas en posiciones correspondientes: relacionó cuadernos con precio en un lado y precio con cuadernos en el otro. Una proporción correcta es $\\frac{5}{18}=\\frac{8}{x}$, o equivalentemente $\\frac{18}{5}=\\frac{x}{8}$. Por tanto, $x=\\frac{18\\times8}{5}=28{,}8$ euros.' };
const Q7 = { type: 'numeric_problem', question: 'Una máquina produce 84 piezas en 7 horas, trabajando siempre al mismo ritmo. ¿Cuántas piezas producirá en 12 horas? Plantea y resuelve una regla de tres simple directa.', correctAnswer: '144 piezas' };
const Q8 = { type: 'justification', question: 'Dos afirmaciones resuelven el siguiente problema: «Una máquina produce 120 piezas en 3 horas. ¿Cuántas piezas producirá en 7 horas si mantiene el mismo ritmo?». La afirmación A dice que producirá 280 piezas porque $120\\times\\frac{7}{3}=280$. La afirmación B dice que producirá aproximadamente 51 piezas porque $120\\div 7$. ¿Cuál es correcta y por qué?', correctAnswer: 'La afirmación A es correcta: producirá 280 piezas, porque la producción y el tiempo son magnitudes directamente proporcionales cuando el ritmo se mantiene constante.' };
const Q9 = { type: 'error_detection', question: 'Un estudiante resuelve este problema: “Si 5 cuadernos cuestan 40 €, ¿cuánto cuestan 8 cuadernos?” y escribe: $$x=\\frac{5\\times8}{40}=1,25\\text{ €}.$$ Identifica el error y proporciona el resultado correcto.', correctAnswer: 'El estudiante colocó incorrectamente los datos en la proporción. El precio de 8 cuadernos es $64\\text{ €}$, porque $x=\\frac{40\\times8}{5}=64$.' };

const grade = (q: { type: string; question: string; correctAnswer: string }, answer: string, ai: GraderAssessment = {}) =>
  composePedagogicalGrade(deterministicEvidence(q, answer, 'es'), ai);
const aiReply = (o: Record<string, unknown>) => ({
  text: JSON.stringify({ mathematical_correctness: 'CORRECT', requirements: [], reasoning_quality: 'ADEQUATE', conceptual_error: false, misconception: null, error_type: null, did_well: '', to_fix: '', confidence: 0.9, ...o }),
  raw: {}, provider: 'openai', model: 'gpt-5.6-terra',
});

beforeEach(() => callModelMock.mockReset());

describe('A. mathematical normalization (never string equality)', () => {
  it('× · * ÷ and implicit forms: 40 × 8 / 5 ≡ (40·8)/5 ≡ 8*40÷5 ≡ 64', () => {
    for (const s of ['40 × 8 / 5', '(40·8)/5', '8*40÷5', '64', '$\\frac{40\\times 8}{5}$', '40 ⋅ 8 : 5'.replace(':', '/')]) {
      expect(finalValuesEquivalent(s, '64').status, s).toBe('EQUIVALENT');
    }
  });

  it('"x" as multiplication between numbers', () => {
    expect(extractFinalValue('8 x 40 / 5')?.value).toBe(64);
    expect(extractFinalValue('40x8/5')?.value).toBe(64);
  });

  it('"x" as the unknown is preserved (solved, never read as ×)', () => {
    expect(normalizeMathText('x = 5 x 8')).toBe('x = 5*8');
    expect(extractFinalValue('5x = 320')?.value).toBeCloseTo(64, 9);
    expect(extractFinalValue('x = 64')?.value).toBe(64);
  });

  it('equivalent fractions and order of factors / terms', () => {
    expect(finalValuesEquivalent('40/18', '20/9').status).toBe('EQUIVALENT');
    expect(expressionsEquivalent('8*40/5', '40*8/5')).toBe('EQUIVALENT');
    expect(expressionsEquivalent('a*b + c', 'c + b*a')).toBe('EQUIVALENT');
    expect(expressionsEquivalent('3x + 2', '2 + x·3')).toBe('EQUIVALENT');
    expect(expressionsEquivalent('a*b + c', 'a + b*c')).toBe('DIFFERENT');
  });

  it('algebraically equivalent proportions (same solution) vs a wrong one', () => {
    expect(equationsEquivalent('4/7 = 12/x', '4/12 = 7/x')).toBe('EQUIVALENT');
    expect(equationsEquivalent('5/18 = 8/x', '18/5 = x/8')).toBe('EQUIVALENT');
    expect(equationsEquivalent('4/12 = x/7', '4/7 = 12/x')).toBe('DIFFERENT');
  });

  it('decimal comma vs decimal point (by language), and thousands', () => {
    expect(finalValuesEquivalent('28,8', '28.8', 'comma').status).toBe('EQUIVALENT');
    expect(finalValuesEquivalent('28.8 €', '$x=\\frac{18\\times8}{5}=28{,}8$ euros', 'comma').status).toBe('EQUIVALENT');
    expect(extractFinalValue('1.050 mL', 'comma')?.value).toBe(1050);
    expect(extractFinalValue('1,050 mL', 'point')?.value).toBe(1050);
  });

  it('equivalent units convert; a different dimension is a real difference; a missing unit is not', () => {
    const r = finalValuesEquivalent('1,05 L', '$1050\\,\\text{mL}$');
    expect(r).toMatchObject({ status: 'EQUIVALENT', unitStatus: 'CONVERTED' });
    expect(finalValuesEquivalent('1050 g', '1050 mL').status).toBe('DIFFERENT');
    expect(finalValuesEquivalent('1050', '1050 mL')).toMatchObject({ status: 'EQUIVALENT', unitStatus: 'MISSING' });
    expect(finalValuesEquivalent('144 piezas', '144 piezas').status).toBe('EQUIVALENT');
  });

  it('only a strict whitelist is ever evaluated (no free-text evaluation)', () => {
    expect(extractFinalValue('import("fs")')).toBeNull();
    expect(extractFinalValue('range(1, 1e9)')).toBeNull();
    expect(isBareValue('28,8 €', 'es')).toBe(true);
    expect(isBareValue('2+2=4', 'es')).toBe(false);
  });
});

describe('B. the task is decomposed into requested components', () => {
  it('"Identifica el error y corrige el resultado" -> identify_error + corrected_result', () => {
    expect(deriveTaskRequirements(Q1 as any).map((r) => r.id)).toEqual(['identify_error', 'corrected_result']);
  });
  it('"Identifica el error y escribe una proporción correcta" -> identify_error + correct_setup', () => {
    expect(deriveTaskRequirements(Q2 as any).map((r) => r.id)).toEqual(['identify_error', 'correct_setup']);
  });
  it('"¿Quién tiene razón? Justifica" -> choose_claim + justify; "Plantea y resuelve" -> final_result + show_setup', () => {
    expect(deriveTaskRequirements(Q5 as any).map((r) => r.id)).toEqual(['choose_claim', 'justify']);
    expect(deriveTaskRequirements(Q8 as any).map((r) => r.id)).toEqual(['choose_claim', 'justify']);
    expect(deriveTaskRequirements(Q7 as any).map((r) => r.id)).toEqual(['final_result', 'show_setup']);
    expect(deriveTaskRequirements(Q3 as any).map((r) => r.id)).toEqual(['final_result']);
  });
});

describe('C/D. structured verdict and learner-state separation (required cases)', () => {
  it('correct result WITHOUT identifying the error -> ALMOST, not mathematically wrong, not a misconception, not an error', () => {
    const g = grade(Q1, 'x = 40·8/5 = 64 €', { requirements: [{ id: 'identify_error', met: false }], mathematicalCorrectness: 'CORRECT' });
    expect(g).toMatchObject({ mathematicalCorrectness: 'CORRECT', taskCompletion: 'PARTIAL', finalJudgment: 'ALMOST', missingRequirements: ['identify_error'], misconception: null, learnerSignal: 'TASK_INCOMPLETE' });
    expect(isRecordableError(g)).toBe(false);
    expect(pedagogicalFeedbackText(g, 'es').combined).toBe('Tu cálculo y el resultado son correctos. Te falta explicar cuál fue el error en el planteamiento original.');
  });

  it('correct result WITHOUT explanation (justification) -> ALMOST', () => {
    const g = grade(Q5, 'Ana', { mathematicalCorrectness: 'NOT_APPLICABLE', requirements: [{ id: 'choose_claim', met: true }, { id: 'justify', met: false }], reasoningQuality: 'ABSENT' });
    expect(g).toMatchObject({ finalJudgment: 'ALMOST', missingRequirements: ['justify'], learnerSignal: 'TASK_INCOMPLETE' });
  });

  it('sound reasoning with a small arithmetic slip -> ALMOST (MINOR_SLIP), recorded as a slip, never a misconception', () => {
    const g = grade(Q1, 'x = 40·8/5 = 63', { mathematicalCorrectness: 'MINOR_SLIP', requirements: [{ id: 'identify_error', met: true }], errorType: 'ARITHMETIC' });
    expect(g).toMatchObject({ mathCheck: { result: 'DIFFERENT' }, finalJudgment: 'ALMOST', learnerSignal: 'MINOR_SLIP', errorType: 'ARITHMETIC', misconception: null });
    expect(pedagogicalFeedbackText(g, 'es').didWell).toBe('Tu razonamiento es correcto; revisa el cálculo final.');
  });

  it('right number reached by conceptually invalid reasoning -> INCORRECT + misconception', () => {
    const g = grade(Q1, '8 × 8 = 64', { mathematicalCorrectness: 'CORRECT', requirements: [{ id: 'identify_error', met: false }], reasoningQuality: 'INVALID', conceptualError: true, misconception: 'No relaciona las magnitudes correspondientes' });
    expect(g).toMatchObject({ mathematicalCorrectness: 'CORRECT', finalJudgment: 'INCORRECT', learnerSignal: 'MISCONCEPTION', errorType: 'CONCEPTUAL', misconception: 'No relaciona las magnitudes correspondientes' });
    expect(isRecordableError(g)).toBe(true);
  });

  it('a true conceptual error (inverted proportion) -> INCORRECT + misconception, recorded', () => {
    const g = grade(Q1, 'x = 5·8/40 = 1 €', { mathematicalCorrectness: 'INCORRECT', requirements: [{ id: 'identify_error', met: false }], conceptualError: true, misconception: 'Invierte la proporcionalidad directa', errorType: 'CONCEPTUAL' });
    expect(g).toMatchObject({ mathCheck: { result: 'DIFFERENT' }, finalJudgment: 'INCORRECT', learnerSignal: 'MISCONCEPTION' });
    expect(g.score).toBeLessThanOrEqual(0.5);
  });

  it('a pure-math wrong value can never be graded CORRECT by the AI; prose with a stray number is never a false negative', () => {
    expect(grade(Q3, '1000 mL', { mathematicalCorrectness: 'CORRECT' }).finalJudgment).toBe('INCORRECT');
    const prose = grade(Q9, 'El error fue poner los datos al revés: 8 cuadernos cuestan 64 € y no 1,25 €', { mathematicalCorrectness: 'CORRECT', requirements: [{ id: 'identify_error', met: true }, { id: 'corrected_result', met: true }] });
    expect(prose.finalJudgment).toBe('CORRECT');
  });

  it('partially complete (one of two components) -> ALMOST with partial credit; nothing met -> INCORRECT', () => {
    const almost = grade(Q9, '64 €', { requirements: [{ id: 'identify_error', met: false }] });
    expect(almost).toMatchObject({ finalJudgment: 'ALMOST', score: 0.5 });
    const none = grade(Q5, 'No sé', { mathematicalCorrectness: 'NOT_APPLICABLE', requirements: [{ id: 'choose_claim', met: false }, { id: 'justify', met: false }] });
    expect(none.finalJudgment).toBe('INCORRECT');
  });
});

describe('E2E revalidation -- the real Prove questions (79%, six INCOMPLETE)', () => {
  it('#1 corrected result, no error identified: before INCORRECT/INCOMPLETE -> now ALMOST, no error row', () => {
    expect(grade(Q1, 'x = 40·8/5 = 64 €', { requirements: [{ id: 'identify_error', met: false }] }).finalJudgment).toBe('ALMOST');
  });
  it('#2 an algebraically equivalent correct proportion (4/12 = 7/x) + error identified -> CORRECT (setup verified mathematically)', () => {
    const g = grade(Q2, 'El error es relacionar cuadernos con euros en un lado y euros con cuadernos en el otro. Correcto: 4/12 = 7/x, x = 21', { requirements: [{ id: 'identify_error', met: true }, { id: 'correct_setup', met: false }] });
    expect(g.requirements.find((r) => r.id === 'correct_setup')).toMatchObject({ met: true, source: 'MATH_CHECK' });
    expect(g.finalJudgment).toBe('CORRECT');
  });
  it('#3 "1,05 L" for 1050 mL -> CORRECT', () => {
    expect(grade(Q3, '1,05 L').finalJudgment).toBe('CORRECT');
  });
  it('#6 "28.8" written with a point for the key 28{,}8 -> result verified; error not explained -> ALMOST', () => {
    const g = grade(Q6, 'x = 18·8/5 = 28.8 €', { requirements: [{ id: 'identify_error', met: false }] });
    expect(g.requirements.find((r) => r.id === 'corrected_result')).toMatchObject({ met: true, source: 'MATH_CHECK' });
    expect(g.finalJudgment).toBe('ALMOST');
  });
  it('#7 setup shown and 144 piezas -> CORRECT; #8 "A, porque son directamente proporcionales" -> CORRECT', () => {
    expect(grade(Q7, '84/7 = 12 piezas por hora; 12 × 12 = 144 piezas', { requirements: [{ id: 'show_setup', met: true }] }).finalJudgment).toBe('CORRECT');
    expect(grade(Q8, 'La A, porque producción y tiempo son directamente proporcionales', { mathematicalCorrectness: 'NOT_APPLICABLE', requirements: [{ id: 'choose_claim', met: true }, { id: 'justify', met: true }] }).finalJudgment).toBe('CORRECT');
  });
});

describe('the grader end to end (AI mocked)', () => {
  it('a bare verified value needs no AI call', async () => {
    const r = await gradeAnswer({ ...Q3, conceptId: 'c', difficulty: 3 } as any, '1,05 L', 'es');
    expect(callModelMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ correct: true, score: 1 });
    expect(r.pedagogical?.finalJudgment).toBe('CORRECT');
  });

  it('the AI receives the requested components and the verified math fact, under a strict schema; the verdict is composed deterministically', async () => {
    callModelMock.mockResolvedValueOnce(aiReply({ mathematical_correctness: 'INCORRECT', requirements: [{ id: 'identify_error', met: false }, { id: 'corrected_result', met: false }], did_well: '', to_fix: 'Explica qué magnitudes se mezclaron.' }));
    const r = await gradeAnswer({ ...Q1, conceptId: 'c', difficulty: 3 } as any, 'x = (40 × 8) / 5 = 64', 'es');
    const call = callModelMock.mock.calls[0][0];
    expect(call.jsonSchema.name).toBe('pedagogical_grade');
    expect(call.user).toMatch(/- identify_error:/);
    expect(call.user).toMatch(/- corrected_result:/);
    expect(call.user).toMatch(/VERIFIED by the system: the student's final value is mathematically equal/);
    // the AI said INCORRECT/unmet, but the value is verified equal: notation never costs the result
    expect(r.pedagogical).toMatchObject({ mathematicalCorrectness: 'CORRECT', finalJudgment: 'ALMOST', missingRequirements: ['identify_error'] });
    expect(r.correct).toBe(false);
    expect(r.errorType).toBe('INCOMPLETE');
    expect(r.feedback).toMatch(/^Tu cálculo y el resultado son correctos\. Te falta explicar cuál fue el error/);
  });

  it('a legacy-shaped grader reply is still honored when nothing is mathematically verifiable', async () => {
    callModelMock.mockResolvedValueOnce({ text: JSON.stringify({ correct: false, score: 0.4, feedback: 'x', confidence: 0.8, errorType: 'CONCEPTUAL', reasoningValid: false }), raw: {}, provider: 'openai', model: 'm' });
    const r = await gradeAnswer({ type: 'short_answer', question: 'Define proporción directa', correctAnswer: 'Cuando una magnitud aumenta, la otra aumenta en la misma razón', conceptId: 'c', difficulty: 2 } as any, 'que suben las dos', 'es');
    expect(r).toMatchObject({ correct: false, score: 0.4, errorType: 'CONCEPTUAL' });
  });
});

describe('E. Prove stays independent; the final review explains pedagogically', () => {
  it('Prove never gets immediate feedback or hints (unchanged)', () => {
    expect(read('src/app/api/quizzes/session/[quizId]/check/route.ts')).toMatch(/error: 'FEEDBACK_DEFERRED'/);
    expect(read('src/app/api/learning/contextual-help/route.ts')).toMatch(/HELP_DISABLED_FOR_MODE/);
  });

  it('the review shows the teacher verdict (Casi as its own state) with what you did well / what was missing / what to correct', () => {
    const quiz = read('src/app/dashboard/quiz/page.tsx');
    expect(quiz).toMatch(/const judgment = r\.finalJudgment \?\?/);
    expect(quiz).toMatch(/judgment === 'ALMOST' \? 'chip-warn'/);
    for (const k of ['grading.section.didWell', 'grading.section.missing', 'grading.section.toFix']) expect(quiz).toContain(`at['${k}']`);
  });

  it('submission records only REAL errors and keeps the structured verdict in the evidence', () => {
    const route = read('src/app/api/quizzes/generate-and-take/route.ts');
    expect(route).toMatch(/return p \? isRecordableError\(p\) : true;/);
    expect(route).toMatch(/gradingModel: 'PEDAGOGICAL_V1', pedagogicalGrades: bucket\.pedagogicalGrades/);
    expect(route).toMatch(/feedbackParts: \{ didWell: text\.didWell, missing: text\.missing, toFix: text\.toFix \}/);
  });

  it('Prove thresholds are unchanged', async () => {
    const { CANONICAL_POLICY } = await import('@/lib/pedagogical-engine/policy');
    expect(CANONICAL_POLICY.prove).toMatchObject({ itemCount: 10, minimumScorePercent: 80, independenceRequired: true });
  });
});
