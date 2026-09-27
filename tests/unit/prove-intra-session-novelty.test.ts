/**
 * PROVE_INTRA_SESSION_NOVELTY -- a 10-question Prove must be 10 different
 * problems. Real DEV Prove quiz-1790519535689-z1t5rj (exact texts below):
 * #1 and #9 are the same problem (5 cuadernos / 40 € -> 8 cuadernos / 64 €)
 * and #0 / #4 the same recipe (4 personas / 300 g -> 10 personas); four
 * items share one template (cuadernos / € error detection). Exact-text
 * novelty accepted all of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chunkMock = vi.fn();
const recoveryMock = vi.fn();
vi.mock('@/services/gated-question-generation.service', () => ({
  generateConcurrentChunkedBatch: (...a: any[]) => chunkMock(...a),
  generateBoundedRecoveryBatch: (...a: any[]) => recoveryMock(...a),
}));
vi.mock('@/services/quiz-persistence.service', () => ({ loadPriorPracticeQuestionFingerprints: vi.fn().mockResolvedValue(new Set()) }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn() }, query: vi.fn() }));

import { questionSignature, compareQuestions, selectDiverse, diversityReport, leastSimilarFirst, TEMPLATE_CAP } from '@/lib/lx/question-diversity';
import { generateCanonicalProveQuestions, MAX_DIVERSITY_REGENERATIONS } from '@/services/canonical-prove-generation.service';

const q = (i: number, type: string, question: string, correctAnswer: string, questionIntent: string, expectedReasoningType: string): any =>
  ({ id: `q${i}`, conceptId: 'c', difficulty: 3, answerFormat: type === 'multiple_choice' ? 'single_choice' : 'text', type, question, correctAnswer, questionIntent, expectedReasoningType });

const REAL = [
  q(0, 'multiple_choice', 'Una receta para 4 personas necesita 300 g de arroz. Si se mantienen las mismas proporciones, ¿cuánto arroz se necesita para 10 personas?', 'C', 'CHECK_APPLICATION', 'PROCEDURAL'),
  q(1, 'error_detection', 'Un estudiante resuelve este problema: «Si 5 cuadernos cuestan 40 €, ¿cuánto cuestan 8 cuadernos?». Escribe: $x=\\frac{5\\times 40}{8}=25$ €, por lo tanto, 8 cuadernos cuestan 25 €. Identifica el error y corrige el resultado.', 'El estudiante colocó las magnitudes de forma incorrecta en la proporción. El resultado correcto es 64 €: $x=\\frac{40\\times 8}{5}=64$.', 'DIAGNOSTIC_PROBE', 'CONCEPTUAL'),
  q(2, 'error_detection', 'Una estudiante plantea esta situación: «Si $4$ cuadernos cuestan $12$ euros, ¿cuánto cuestan $7$ cuadernos?». Escribe la proporción $\\frac{4}{12}=\\frac{x}{7}$ y obtiene $x=\\frac{12\\times7}{4}=21$. Identifica el error y escribe una proporción correcta para resolver el problema.', 'El error es mezclar cantidades que no son correspondientes. Una proporción correcta es $\\frac{4}{7}=\\frac{12}{x}$, de la que resulta $x=21$ euros.', 'DIAGNOSTIC_PROBE', 'CONCEPTUAL'),
  q(3, 'numeric_problem', 'Para preparar $8$ vasos de limonada se usan $600\\,\\text{mL}$ de agua. Si se mantiene la misma cantidad de agua por vaso, ¿cuántos mililitros se necesitan para preparar $14$ vasos?', '$1050\\,\\text{mL}$', 'CHECK_APPLICATION', 'FACTUAL'),
  q(4, 'multiple_choice', 'Una receta para 4 personas requiere 300 g de arroz. Si se mantienen las mismas proporciones, ¿qué expresión representa correctamente la cantidad de arroz necesaria para 10 personas?', 'C', 'CHECK_APPLICATION', 'PROCEDURAL'),
  q(5, 'justification', 'Dos estudiantes analizan esta situación: una impresora imprime $45$ páginas en $3$ minutos, trabajando a ritmo constante. Para imprimir $90$ páginas, Ana afirma que necesitará el doble de tiempo. Bruno afirma que necesitarará la mitad de tiempo. ¿Quién tiene razón? Justifica usando la relación entre las magnitudes.', 'Ana tiene razón: el tiempo también se duplica, de $3$ a $6$ minutos.', 'CHECK_UNDERSTANDING', 'CONCEPTUAL'),
  q(6, 'error_detection', 'Un estudiante resuelve este problema: «$5$ cuadernos cuestan $18$ euros. ¿Cuánto cuestan $8$ cuadernos?». Escribe la proporción $\\frac{5}{18}=\\frac{x}{8}$ y obtiene $x=\\frac{5\\times8}{18}=\\frac{20}{9}$ euros. Identifica el error y corrígelo.', 'Por tanto, $x=\\frac{18\\times8}{5}=28{,}8$ euros.', 'DIAGNOSTIC_PROBE', 'CONCEPTUAL'),
  q(7, 'numeric_problem', 'Una máquina produce 84 piezas en 7 horas, trabajando siempre al mismo ritmo. ¿Cuántas piezas producirá en 12 horas? Plantea y resuelve una regla de tres simple directa.', '144 piezas', 'CHECK_APPLICATION', 'PROCEDURAL'),
  q(8, 'justification', 'Dos afirmaciones resuelven el siguiente problema: «Una máquina produce 120 piezas en 3 horas. ¿Cuántas piezas producirá en 7 horas si mantiene el mismo ritmo?». La afirmación A dice que producirá 280 piezas porque $120\\times\\frac{7}{3}=280$. La afirmación B dice que producirá aproximadamente 51 piezas porque $120\\div 7$. ¿Cuál es correcta y por qué?', 'La afirmación A es correcta: producirá 280 piezas.', 'CHECK_UNDERSTANDING', 'CONCEPTUAL'),
  q(9, 'error_detection', 'Un estudiante resuelve este problema: “Si 5 cuadernos cuestan 40 €, ¿cuánto cuestan 8 cuadernos?” y escribe: $$x=\\frac{5\\times8}{40}=1,25\\text{ €}.$$ Identifica el error y proporciona el resultado correcto.', 'El precio de 8 cuadernos es $64\\text{ €}$, porque $x=\\frac{40\\times8}{5}=64$.', 'DIAGNOSTIC_PROBE', 'CONCEPTUAL'),
];
const sig = (i: number) => questionSignature(REAL[i]);
const FRESH = [
  q(20, 'numeric_problem', 'Un grifo llena 30 litros en 6 minutos a caudal constante. ¿Cuántos litros llenará en 11 minutos?', '55 litros', 'CHECK_APPLICATION', 'PROCEDURAL'),
  q(21, 'error_detection', 'Un ciclista recorre 18 km en 45 minutos. Alguien calcula el tiempo para 30 km como 45·18/30 = 27 minutos. Identifica el error y corrige el resultado.', 'El resultado correcto es 75 minutos: 45·30/18 = 75.', 'DIAGNOSTIC_PROBE', 'CONCEPTUAL'),
  q(22, 'prediction', 'Si una fotocopiadora hace 50 copias en 2 minutos, predice sin calcular exactamente si 175 copias tardarán más o menos de 7 minutos y explica.', 'Exactamente 7 minutos.', 'CHECK_TRANSFER', 'PROCEDURAL'),
];

describe('the real #1 / #9 case', () => {
  it('#1 and #9 are the SAME numeric problem (same numbers and answer 64 €, same quantities)', () => {
    expect(sig(1)).toMatchObject({ roles: ['cuaderno', 'eur'], answerValue: 64 });
    expect(sig(9)).toMatchObject({ roles: ['cuaderno', 'eur'], answerValue: 64 });
    const c = compareQuestions(sig(1), sig(9));
    expect(c.verdict).toBe('NEAR_DUPLICATE');
    expect(c.reasons).toContain('SAME_NUMERIC_PROBLEM');
  });

  it('#0 and #4 are the same recipe problem asked two ways', () => {
    expect(compareQuestions(sig(0), sig(4))).toMatchObject({ verdict: 'NEAR_DUPLICATE', reasons: ['SAME_NUMBERS_SAME_QUANTITIES'] });
  });

  it('four cuadernos/€ error-detection items share one template; at most TEMPLATE_CAP may stay', () => {
    expect(compareQuestions(sig(1), sig(6)).verdict).toBe('SAME_TEMPLATE');
    expect(compareQuestions(sig(2), sig(6)).verdict).toBe('SAME_TEMPLATE');
    expect(TEMPLATE_CAP).toBe(2);
  });

  it('same concept, different problems are NOT flagged (e.g. limonada vs máquina vs impresora)', () => {
    for (const [a, b] of [[3, 7], [3, 5], [5, 8], [7, 8], [0, 3], [2, 3]]) expect(compareQuestions(sig(a), sig(b)).verdict, `#${a}~#${b}`).toBe('DISTINCT');
  });

  it('superficially changed numbers (a scaled copy) are still the same problem', () => {
    const scaled = q(30, 'error_detection', 'Una estudiante plantea: «Si 8 cuadernos cuestan 24 euros, ¿cuánto cuestan 14 cuadernos?». Escribe 8/24 = x/14 y obtiene x = 24·14/8 = 42. Identifica el error y escribe una proporción correcta.', 'Una proporción correcta es 8/14 = 24/x, x = 42 euros.', 'DIAGNOSTIC_PROBE', 'CONCEPTUAL');
    expect(compareQuestions(sig(2), questionSignature(scaled))).toMatchObject({ verdict: 'NEAR_DUPLICATE', reasons: ['SCALED_NUMBERS_SAME_QUANTITIES'] });
  });

  it('selection keeps 7 genuinely different problems and names exactly the 3 to replace (#4, #6, #9)', () => {
    const sel = selectDiverse(REAL, 10);
    expect(sel.kept.map((x: any) => x.id)).toEqual(['q0', 'q1', 'q2', 'q3', 'q5', 'q7', 'q8']);
    expect(sel.rejected.map((r) => [r.item.id, r.verdict])).toEqual([['q4', 'NEAR_DUPLICATE'], ['q6', 'SAME_TEMPLATE'], ['q9', 'NEAR_DUPLICATE']]);
  });

  it('set-level diversity report (type, context, skill, reasoning, level)', () => {
    const before = diversityReport(REAL);
    expect(before).toMatchObject({ size: 10, nearDuplicatePairs: 2, distinctTypes: 4 });
    const after = diversityReport([...selectDiverse(REAL, 10).kept, ...FRESH]);
    expect(after.nearDuplicatePairs).toBe(0);
    expect(after.distinctQuantityContexts).toBeGreaterThan(before.distinctQuantityContexts);
    expect(after.maxTemplateShare).toBeLessThanOrEqual(before.maxTemplateShare);
  });
});

describe('pipeline: regenerate only the rejected slots, bounded, never fewer than 10', () => {
  const base = { conceptId: 'c', studentId: 's', subjectId: 'sub', targetCount: 10, difficulty: 3, guidance: 'G', language: 'es', visualAidRate: 0, ibContext: null, activityType: 'SOLO_CHECK', quizMode: 'canonical_prove', parentOperationId: 'op' };
  const diag = { operationId: 'x' } as any;
  beforeEach(() => {
    chunkMock.mockReset();
    recoveryMock.mockReset();
    chunkMock.mockResolvedValue({ accepted: REAL, chunkPlan: [4, 3, 3], chunkDiagnostics: [diag, diag, diag] });
  });

  it('the real set: ONE targeted regeneration of exactly 3 questions, told what not to repeat; the whole quiz is not regenerated', async () => {
    recoveryMock.mockResolvedValueOnce({ accepted: FRESH, diagnostics: diag });
    const r = await generateCanonicalProveQuestions(base as any);
    expect(recoveryMock).toHaveBeenCalledTimes(1);
    const opts = recoveryMock.mock.calls[0][3];
    expect(opts.count).toBe(3);
    expect(opts.guidance).toMatch(/DIVERSITY: this assessment already contains/);
    expect(opts.guidance).toMatch(/error_detection about cuaderno\/eur/);
    expect(opts.guidance).not.toMatch(/64|Identifica el error y corrige/); // brief is answer-free, not the question texts
    expect(r.questions.map((x: any) => x.id)).toEqual(['q0', 'q1', 'q2', 'q3', 'q5', 'q7', 'q8', 'q20', 'q21', 'q22']);
    expect(r).toMatchObject({ finalQuestionCount: 10, diversityRejectedCount: 3, diversityRegenerations: 1, diversityDegraded: false });
    expect(r.diversity.nearDuplicatePairs).toBe(0);
    expect(r.invocations.map((i) => i.invocationType)).toEqual(['CHUNK', 'CHUNK', 'CHUNK', 'DIVERSITY_REGENERATION']);
  });

  it('retries are bounded; if the AI keeps repeating, a deterministic fallback keeps exactly 10 (least-similar first)', async () => {
    recoveryMock.mockResolvedValue({ accepted: [REAL[9], REAL[4]].map((x, i) => ({ ...x, id: `rep${i}`, question: `${x.question} ` })), diagnostics: diag });
    const r = await generateCanonicalProveQuestions(base as any);
    expect(recoveryMock).toHaveBeenCalledTimes(MAX_DIVERSITY_REGENERATIONS);
    expect(r.questions).toHaveLength(10);
    expect(r.diversityDegraded).toBe(true);
    // the fallback prefers the template-only item (#6) over exact-problem repeats
    expect(r.questions.map((x: any) => x.id)).toContain('q6');
  });

  it('an already diverse set is accepted untouched (no extra AI call)', async () => {
    chunkMock.mockResolvedValue({ accepted: [REAL[0], REAL[1], REAL[2], REAL[3], REAL[5], REAL[7], REAL[8], ...FRESH], chunkPlan: [4, 3, 3], chunkDiagnostics: [diag] });
    const r = await generateCanonicalProveQuestions(base as any);
    expect(recoveryMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ diversityRejectedCount: 0, diversityRegenerations: 0, finalQuestionCount: 10 });
  });

  it('least-similar-first is deterministic', () => {
    const kept = selectDiverse(REAL, 10).kept;
    // template-only (#6) < partial number overlap (#9: 60% of #1) < identical numbers (#4: 100% of #0)
    expect(leastSimilarFirst([REAL[9], REAL[6], REAL[4]], kept).map((x: any) => x.id)).toEqual(['q6', 'q9', 'q4']);
  });
});
