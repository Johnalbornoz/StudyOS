/**
 * Question Bank Factory V1 -- automated validation, duplicate protection,
 * candidate transform, privacy of generation payloads, V1 calibration.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  runDeterministicValidation, validateNovelty, judgeValidatorVerdict, languageLooksLike, type CellSpec,
} from '@/lib/exam-core/question-bank/validation';
import {
  candidateToContent, assertPromptPrivacy, generationUserPrompt, generationSystemPrompt, validatorUserPrompt, parseGenerationOutput, PromptPrivacyError,
  type GeneratedCandidate, type GenerationContext,
} from '@/lib/exam-core/question-bank/prompts';
import { calibrateItem, calibrationDecision, confidenceFor, misconceptionSummary } from '@/lib/exam-core/question-bank/calibration';
import { ApprovedItemContentSchema, findAnswerKeyLeak, toExamClientItem, examItemFromApproved } from '@/lib/exam-core/items';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

const ROOT = join(__dirname, '../..');

const mathSpec: CellSpec = {
  cellKey: 'matematicas|paa.mat.algebra|*|*-*|*', learningObjectiveId: 'lo', questionType: null, difficultyRange: null, targetDifficulty: 3, cognitiveDemand: 'APPLICATION',
  language: 'es', answerFormats: ['single_choice'], optionCount: 4, domain: 'MATH', stimulusRequired: false, stimulusOnlyEvidence: false,
};
const readingSpec: CellSpec = { ...mathSpec, cellKey: 'lectura|paa.lect.inferencia|*|*-*|*', cognitiveDemand: 'ANALYSIS', domain: 'TEXT', stimulusRequired: true, stimulusOnlyEvidence: true };

const mathCandidate = (over: Partial<GeneratedCandidate> = {}): GeneratedCandidate => ({
  stimulusTitle: null, stimulusText: null,
  question: 'Si 3x + 5 = 20, ¿cuál es el valor de x?',
  options: ['5', '15', '25/3', '3'], correctIndex: 0,
  explanation: 'Se resta 5 y se divide entre 3: x = 5.',
  difficulty: 3, cognitiveDemand: 'APPLICATION', skill: 'Ecuaciones lineales',
  distractorRationales: ['', 'Olvida dividir entre 3.', 'Suma 5 en lugar de restarlo.', 'Divide solo el 5.'],
  distractorMisconceptions: [null, 'INVERSE_OPERATION_INCOMPLETE', 'SIGN_ERROR_TRANSPOSITION', null],
  evidenceQuote: null, verificationExpression: '(20-5)/3', ...over,
});
const PASSAGE = 'Los jardines urbanos ofrecen flores distintas durante casi todo el año, mientras que un monocultivo florece apenas unas semanas. Por eso, en muchas ciudades se observan más especies de abejas en los parques que en los campos cercanos.';
const readingCandidate = (over: Partial<GeneratedCandidate> = {}): GeneratedCandidate => ({
  stimulusTitle: 'Abejas en la ciudad', stimulusText: PASSAGE,
  question: '¿Por qué, según el texto, hay más especies de abejas en los parques urbanos?',
  options: ['Porque hay flores distintas casi todo el año', 'Porque el asfalto atrae a las abejas', 'Porque en el campo hace más frío', 'Porque los parques son más grandes'], correctIndex: 0,
  explanation: 'El texto lo atribuye a la variedad de flores durante el año.', difficulty: 3, cognitiveDemand: 'ANALYSIS', skill: 'Inferencia',
  distractorRationales: ['', 'Confunde el entorno con la causa.', 'Información ausente del texto.', 'Tamaño no mencionado.'], distractorMisconceptions: [null, null, null, null],
  evidenceQuote: 'ofrecen flores distintas durante casi todo el año', verificationExpression: null, ...over,
});
const toContent = (c: GeneratedCandidate, spec: CellSpec, key = 'qb.test.1') => candidateToContent(c, { itemKey: key, spec, stimulusKey: c.stimulusText ? 'qb.lectura.abc' : null, difficultyIndex: 1 });

describe('candidate -> immutable version content', () => {
  it('always StudyUs-generated (never official), schema-valid, key shuffled deterministically, rationale per distractor', () => {
    const { content, verification } = toContent(mathCandidate(), mathSpec);
    const parsed = ApprovedItemContentSchema.parse(content);
    expect(parsed.contentOrigin).toBe('GENERATED');
    expect(parsed.contentStatus).toBe('ORIGINAL');
    expect(parsed.options!.find((o) => o.id === parsed.correctAnswer)!.text).toBe('5');
    expect(Object.keys(parsed.distractorRationale!)).toHaveLength(3);
    expect(Object.values(parsed.distractorMisconceptions!)).toContain('INVERSE_OPERATION_INCOMPLETE');
    expect(verification.verificationExpression).toBe('(20-5)/3');
    expect(toContent(mathCandidate(), mathSpec).content).toEqual(content);
    // Over many keys the correct option is not always the same letter (no pattern leakage).
    const letters = new Set(Array.from({ length: 12 }, (_, i) => (toContent(mathCandidate(), mathSpec, `qb.k.${i}`).content as any).correctAnswer));
    expect(letters.size).toBeGreaterThan(1);
  });
  it('the Student-facing shape never carries the key, rationale or misconception mapping', () => {
    const { content } = toContent(mathCandidate(), mathSpec);
    const item = examItemFromApproved({ id: '00000000-0000-4000-8000-000000000001', learning_objective_id: '00000000-0000-4000-8000-000000000002', content })!;
    expect(findAnswerKeyLeak(toExamClientItem(item, 0))).toBeNull();
    expect(toExamClientItem(item, 0).originLabel).toBe('exv2.origin.generated');
  });
});

describe('deterministic validation pipeline', () => {
  it('a correct math item passes deterministically (key recomputed by the exam math engine) -- no AI validator needed', () => {
    const { content, verification } = toContent(mathCandidate(), mathSpec);
    const r = runDeterministicValidation(content, mathSpec, verification, []);
    expect(r.outcome).toBe('PASS');
    expect(r.deterministicallyVerified).toBe(true);
  });
  it('a wrong key is caught by recomputation (REPAIR), a distractor equivalent to the key too', () => {
    const wrongKey = toContent(mathCandidate({ correctIndex: 1 }), mathSpec);
    expect(runDeterministicValidation(wrongKey.content, mathSpec, wrongKey.verification, []).issues.map((i) => i.code)).toContain('KEY_NOT_VERIFIED');
    const twin = toContent(mathCandidate({ options: ['5', '10/2', '25/3', '3'] }), mathSpec);
    const r = runDeterministicValidation(twin.content, mathSpec, twin.verification, []);
    expect(r.outcome).toBe('REPAIR_REQUIRED');
    expect(r.issues.map((i) => i.code)).toContain('DISTRACTOR_EQUIVALENT_TO_KEY');
    const missing = toContent(mathCandidate({ verificationExpression: null }), mathSpec);
    expect(runDeterministicValidation(missing.content, mathSpec, missing.verification, []).issues.map((i) => i.code)).toContain('VERIFICATION_EXPRESSION_MISSING');
  });
  it('schema failure -> REJECTED; structural / blueprint problems -> REPAIR; wrong language -> REJECTED', () => {
    expect(runDeterministicValidation({ question: 'x' }, mathSpec, { verificationExpression: null, evidenceQuote: null }, []).outcome).toBe('REJECTED');
    const three = toContent(mathCandidate({ options: ['5', '15', '3'], distractorRationales: ['', 'a', 'b'] }), mathSpec);
    expect(runDeterministicValidation(three.content, mathSpec, three.verification, []).issues.map((i) => i.code)).toContain('OPTION_COUNT_MISMATCH');
    const demand = toContent(mathCandidate({ cognitiveDemand: 'RECALL' }), mathSpec);
    expect(runDeterministicValidation(demand.content, mathSpec, demand.verification, []).issues.map((i) => i.code)).toContain('COGNITIVE_DEMAND_MISMATCH');
    const en = toContent(mathCandidate(), { ...mathSpec, language: 'en' });
    expect(runDeterministicValidation({ ...en.content, language: 'es' }, { ...mathSpec, language: 'en' }, en.verification, []).outcome).toBe('REJECTED');
  });
  it('distractor quality: duplicates, "todas las anteriores", length clue, missing rationale', () => {
    const dup = toContent(mathCandidate({ options: ['5', '15', '15', '3'] }), mathSpec);
    expect(runDeterministicValidation(dup.content, mathSpec, dup.verification, []).issues.map((i) => i.code)).toContain('DUPLICATE_OPTIONS');
    const all = toContent(readingCandidate({ options: ['Porque hay flores distintas casi todo el año', 'Todas las anteriores', 'Porque en el campo hace más frío', 'Porque los parques son más grandes'] }), readingSpec);
    expect(runDeterministicValidation(all.content, readingSpec, all.verification, []).issues.map((i) => i.code)).toContain('ALL_NONE_OF_THE_ABOVE');
    const clue = toContent(readingCandidate({ options: ['Porque los jardines urbanos ofrecen flores distintas durante casi todo el año, a diferencia de los monocultivos', 'Asfalto', 'Frío', 'Tamaño'] }), readingSpec);
    expect(runDeterministicValidation(clue.content, readingSpec, clue.verification, []).issues.map((i) => i.code)).toContain('LENGTH_CLUE');
    const noRat = toContent(mathCandidate({ distractorRationales: ['', '', '', ''] }), mathSpec);
    expect(runDeterministicValidation(noRat.content, mathSpec, noRat.verification, []).issues.map((i) => i.code)).toContain('DISTRACTOR_RATIONALE_MISSING');
  });
  it('options that differ only by sign are NOT duplicates ("2" vs "-2"; found by the DB integration run)', () => {
    const c = toContent(mathCandidate({ question: 'Si f(x) = 2x^2 - 3x, ¿cuál es el valor de f(-2)?', options: ['14', '2', '-2', '10'], verificationExpression: '2*(-2)^2-3*(-2)' }), mathSpec);
    const r = runDeterministicValidation(c.content, mathSpec, c.verification, []);
    expect(r.issues.map((i) => i.code)).not.toContain('DUPLICATE_OPTIONS');
    expect(r.outcome).toBe('PASS');
  });
  it('reading: the evidence must be IN the passage; then the independent validator is still required', () => {
    const ok = toContent(readingCandidate(), readingSpec);
    expect(runDeterministicValidation(ok.content, readingSpec, ok.verification, []).outcome).toBe('NEEDS_AI_VALIDATION');
    const bad = toContent(readingCandidate({ evidenceQuote: 'las abejas prefieren el asfalto caliente' }), readingSpec);
    expect(runDeterministicValidation(bad.content, readingSpec, bad.verification, []).issues.map((i) => i.code)).toContain('EVIDENCE_NOT_IN_STIMULUS');
    const noPassage = toContent(readingCandidate({ stimulusText: null, stimulusTitle: null }), readingSpec);
    expect(runDeterministicValidation(noPassage.content, readingSpec, noPassage.verification, []).issues.map((i) => i.code)).toContain('STIMULUS_REQUIRED');
  });
  it('never claims to be official', () => {
    const c = toContent(mathCandidate({ question: 'Pregunta oficial de la PAA: si 3x + 5 = 20, ¿cuánto vale x?' }), mathSpec);
    expect(runDeterministicValidation(c.content, mathSpec, c.verification, []).issues.map((i) => i.code)).toContain('CLAIMS_OFFICIAL');
  });
});

describe('duplicate / novelty protection', () => {
  const content = toContent(mathCandidate(), mathSpec).content as any;
  const parsed = ApprovedItemContentSchema.parse(content);
  it('exact and normalized duplicates are rejected', () => {
    expect(validateNovelty(parsed, [{ versionId: 'x', question: 'si 3x + 5 = 20 ¿cual es el valor de x', stimulusText: null }]).map((i) => i.code)).toContain('DUPLICATE_NORMALIZED');
  });
  it('the same item with other numbers (template) is rejected', () => {
    expect(validateNovelty(parsed, [{ versionId: 'x', question: 'Si 7x + 2 = 30, ¿cuál es el valor de x?', stimulusText: null }]).map((i) => i.code)).toContain('DUPLICATE_TEMPLATE_OTHER_NUMBERS');
  });
  it('near duplicates are rejected / repaired by configurable thresholds; same numbers with cosmetic rewording is flagged', () => {
    const near = validateNovelty(parsed, [{ versionId: 'x', question: 'Si 3x + 5 = 20, entonces ¿cuál es el valor de la x?', stimulusText: null }]);
    expect(near.map((i) => i.code)).toContain('TOO_SIMILAR');
    expect(validateNovelty(parsed, [{ versionId: 'x', question: 'Si 3x + 5 = 20, entonces ¿cuál es el valor de la x?', stimulusText: null }], { nearDuplicateRejectAt: 0.8, nearDuplicateRepairAt: 0.7 }).map((i) => i.code)).toContain('NEAR_DUPLICATE');
    const cosmetic = validateNovelty(parsed, [{ versionId: 'x', question: 'Si 3x + 5 = 20, ¿qué valor tiene x?', stimulusText: null }], { nearDuplicateRejectAt: 0.99, nearDuplicateRepairAt: 0.98 });
    expect(cosmetic.map((i) => i.code)).toContain('SAME_NUMBERS_COSMETIC_REWORD');
    expect(validateNovelty(parsed, [{ versionId: 'y', question: 'En un triángulo rectángulo los catetos miden 6 y 8. ¿Cuánto mide la hipotenusa?', stimulusText: null }])).toEqual([]);
  });
});

describe('independent AI validator verdict -> deterministic judgement', () => {
  it('agreement with the key and no ambiguity -> PASS; confident disagreement -> REPAIR; low confidence escalates once, then REVIEW', () => {
    expect(judgeValidatorVerdict({ selectedOptionId: 'B', confidence: 0.9, alternativeDefensibleOptionIds: [], requiresOutsideInformation: false, implausibleDistractorIds: [] }, 'B', readingSpec, false).outcome).toBe('PASS');
    expect(judgeValidatorVerdict({ selectedOptionId: 'C', confidence: 0.9, alternativeDefensibleOptionIds: [], requiresOutsideInformation: false, implausibleDistractorIds: [] }, 'B', readingSpec, false).outcome).toBe('REPAIR_REQUIRED');
    expect(judgeValidatorVerdict({ selectedOptionId: 'B', confidence: 0.5, alternativeDefensibleOptionIds: [], requiresOutsideInformation: false, implausibleDistractorIds: [] }, 'B', readingSpec, false).outcome).toBe('ESCALATE');
    expect(judgeValidatorVerdict({ selectedOptionId: 'B', confidence: 0.5, alternativeDefensibleOptionIds: [], requiresOutsideInformation: false, implausibleDistractorIds: [] }, 'B', readingSpec, true).outcome).toBe('REVIEW_REQUIRED');
  });
  it('two defensible answers or information outside the passage -> REPAIR (never promoted)', () => {
    expect(judgeValidatorVerdict({ selectedOptionId: 'B', confidence: 0.9, alternativeDefensibleOptionIds: ['C'], requiresOutsideInformation: false, implausibleDistractorIds: [] }, 'B', readingSpec, false).outcome).toBe('REPAIR_REQUIRED');
    expect(judgeValidatorVerdict({ selectedOptionId: 'B', confidence: 0.9, alternativeDefensibleOptionIds: [], requiresOutsideInformation: true, implausibleDistractorIds: [] }, 'B', readingSpec, false).outcome).toBe('REPAIR_REQUIRED');
  });
  it('the validator never sees the key: its prompt has the options but no answer / explanation / rationale', () => {
    const { content } = toContent(readingCandidate(), readingSpec);
    const p = validatorUserPrompt(ApprovedItemContentSchema.parse(content));
    expect(p).toContain('OPTIONS');
    expect(p).not.toMatch(/correct|respuesta correcta|explanation|Confunde el entorno/i);
  });
});

describe('privacy: generation payloads carry no Student data', () => {
  const ctx: GenerationContext = {
    examLabel: 'PAA (Prueba de Aptitud Académica)', versionLabel: 'V2.1', componentName: 'Matemáticas', componentContract: 'Official item count: 55',
    objectiveCode: 'paa.mat.algebra', objectiveDescription: 'Álgebra: ecuaciones, sistemas, funciones, variación.', spec: mathSpec, count: 3, reason: 'FORM_BLOCKER',
    exemplars: [{ stimulusTitle: null, question: 'Si 2x - 4 = 10, ¿cuánto vale x?', options: ['7', '3', '14', '6'] }], avoidStems: ['Si 2x - 4 = 10, ¿cuánto vale x?'],
    aggregate: { summary: misconceptionSummary({ optionId: 'B', misconceptionCode: 'DISTRIBUTIVE_PROPERTY_PARTIAL_APPLICATION', share: 0.27, sampleSize: 140 }, '2x + 3'), sampleSize: 140, misconceptionCode: 'DISTRIBUTIVE_PROPERTY_PARTIAL_APPLICATION' },
  };
  it('the real prompt passes the guard and contains only aggregates ("27% ... n=140")', () => {
    const payload = generationSystemPrompt('es') + generationUserPrompt(ctx);
    expect(() => assertPromptPrivacy(payload)).not.toThrow();
    expect(payload).toMatch(/27% de las respuestas \(n=140\)/);
    expect(payload).not.toMatch(/@|student|estudiante [A-Z]|transcript|institution/i);
  });
  it('a name / email / id / transcript reaching a prompt is refused before any provider call', () => {
    expect(() => assertPromptPrivacy('Ana García (ana.garcia@colegio.edu) eligió B')).toThrow(PromptPrivacyError);
    expect(() => assertPromptPrivacy('student 4c1f9a3e-2b7d-4e8f-9a0b-1c2d3e4f5a6b chose B')).toThrow(PromptPrivacyError);
    expect(() => assertPromptPrivacy(JSON.stringify({ studentName: 'Ana', choice: 'B' }))).toThrow(PromptPrivacyError);
    expect(() => assertPromptPrivacy(JSON.stringify({ tutorTranscript: '...' }))).toThrow(PromptPrivacyError);
  });
  it('every factory AI call runs the guard; the factory modules never read Student identity tables', () => {
    const runner = readFileSync(join(ROOT, 'src/lib/exam-core/question-bank/ai-runner.ts'), 'utf8');
    expect(runner.match(/assertPromptPrivacy\(/g)?.length).toBe(3);
    for (const f of ['prompts.ts', 'ai-runner.ts', 'factory.service.ts', 'queue.service.ts', 'calibration.service.ts']) {
      const src = readFileSync(join(ROOT, 'src/lib/exam-core/question-bank', f), 'utf8');
      expect(src, f).not.toMatch(/FROM (students|users|parent_\w+|tutor_\w+|institution\w*)\b/);
    }
  });
  it('no claim of training a model: prompts are registered as generation / validation, never fine-tuning', () => {
    for (const id of ['question_bank.generate_items', 'question_bank.validate_item', 'question_bank.repair_item'] as const) {
      expect(PROMPT_REGISTRY[id]).toBeTruthy();
      expect(PROMPT_REGISTRY[id].description).not.toMatch(/train|fine-tun|entrena/i);
    }
  });
});

describe('generation output parsing', () => {
  it('structural parse only; content judged by the pipeline', () => {
    expect(parseGenerationOutput({ items: [mathCandidate()] }, { count: 3, optionCount: 4 }).value).toHaveLength(1);
    expect(parseGenerationOutput({}, { count: 3, optionCount: 4 }).errors).toEqual(['items missing']);
    expect(parseGenerationOutput({ items: [mathCandidate(), mathCandidate(), mathCandidate(), mathCandidate()] }, { count: 2, optionCount: 4 }).value).toHaveLength(2);
  });
  it('language heuristic', () => {
    expect(languageLooksLike('¿Cuál es el valor de x según la ecuación de la figura?', 'es')).toBe(true);
    expect(languageLooksLike('What is the value of x in the equation?', 'es')).toBe(false);
  });
});

describe('V1 calibration: transparent statistics, no fabricated precision', () => {
  const obs = (k: number, frac: (i: number) => number, opt: (i: number) => string, rest: (i: number) => number) => Array.from({ length: k }, (_, i) => ({ fraction: frac(i), optionId: opt(i), restFraction: rest(i) }));
  it('few responses -> INSUFFICIENT_DATA and no flag, no transition', () => {
    const c = calibrateItem(obs(10, () => 1, () => 'A', () => 0.5), { keyOptionId: 'A', optionIds: ['A', 'B', 'C', 'D'] });
    expect(c.confidence).toBe('INSUFFICIENT_DATA');
    expect(c.flags).toEqual([]);
    expect(calibrationDecision('PILOT', c)).toBeNull();
    expect([29, 30, 100, 300].map((x) => confidenceFor(x))).toEqual(['INSUFFICIENT_DATA', 'EARLY_SIGNAL', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE']);
  });
  it('a discriminating, healthy item with moderate evidence moves PILOT -> CALIBRATED', () => {
    const c = calibrateItem(obs(120, (i) => (i % 2 === 0 ? 1 : 0), (i) => (i % 2 === 0 ? 'A' : ['B', 'C', 'D'][i % 3]), (i) => (i % 2 === 0 ? 0.8 : 0.3)), { keyOptionId: 'A', optionIds: ['A', 'B', 'C', 'D'] });
    expect(c.empiricalDifficulty).toBeCloseTo(0.5);
    expect(c.discriminationProxy!).toBeGreaterThan(0.5);
    expect(c.flags).toEqual([]);
    expect(calibrationDecision('PILOT', c)).toEqual({ to: 'CALIBRATED', reason: 'CALIBRATION:MODERATE_CONFIDENCE:n=120' });
  });
  it('extreme ease / dead distractor -> REVIEW_REQUIRED; a recurring distractor becomes a misconception signal with its code', () => {
    const easy = calibrateItem(obs(150, () => 1, () => 'A', (i) => (i % 10) / 10), { keyOptionId: 'A', optionIds: ['A', 'B', 'C', 'D'] });
    expect(easy.flags).toEqual(expect.arrayContaining(['EXTREME_EASE', 'DEAD_DISTRACTOR']));
    expect(calibrationDecision('ACTIVE', easy)?.to).toBe('REVIEW_REQUIRED');
    const mis = calibrateItem(obs(140, (i) => (i < 60 ? 1 : 0), (i) => (i < 60 ? 'A' : i < 98 ? 'B' : i < 120 ? 'C' : 'D'), (i) => (i < 60 ? 0.8 : 0.4)), { keyOptionId: 'A', optionIds: ['A', 'B', 'C', 'D'], distractorMisconceptions: { B: 'DISTRIBUTIVE_PROPERTY_PARTIAL_APPLICATION' } });
    expect(mis.misconceptionSignals).toEqual([expect.objectContaining({ optionId: 'B', misconceptionCode: 'DISTRIBUTIVE_PROPERTY_PARTIAL_APPLICATION', sampleSize: 140 })]);
  });
});
