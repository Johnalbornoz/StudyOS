/**
 * Question Factory V5 -- profiles, the eleven stages, triage, batch control and blueprint readiness.
 * Every model-backed stage is a stub here: no provider is called, no key is read.
 */
import { DETERMINISTIC_BANK_ONLY_CONFIG_KEYS } from '@/lib/exam-core/verticals/v2/cambridge-9709';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { RETIRED_V2_CONFIG_KEYS } from '@/lib/exam-core/verticals/v2/index';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { GENERATION_PROFILES, GENERATOR_PROFILE_VERSION, profileById, profilesByFamily, resolveProfile } from '@/lib/exam-core/question-bank/production/v5/generation-profile';
import { CandidateItemSchema, GenerationSpecificationSchema, learnerText, learnerView, specificationHash, type CandidateItem, type GenerationSpecification } from '@/lib/exam-core/question-bank/production/v5/item';
import { numericValue, algebraicallyEqual, compareAnswers, declaredArithmeticFindings, duplicateOf, keyPositionFinding, optionFindings, plausibilityFindings, structuralFindings, templateSkeleton } from '@/lib/exam-core/question-bank/production/v5/deterministic-stages';
import { decide, difficultyInput, runSpecification, solverInput, tierFit, validateCandidate, PIPELINE_STAGES, type StageProviders } from '@/lib/exam-core/question-bank/production/v5/pipeline';
import { auditPausesPromotion, auditSample, calibrationGate, checkpoint, completedBatchIds, cumulativeSpend, isStudentEligibleLifecycle, lifecycleAfter, maySpend, metricsBy, metricsOf, needsRevalidation, reviewQueue, stopCondition } from '@/lib/exam-core/question-bank/production/v5/batch-control';
import { blueprintSections, bucketKeyOf, familyReadiness, generationAllocation, globalReadiness, type BankItem } from '@/lib/exam-core/question-bank/production/v5/readiness';

const ROOT = join(__dirname, '..', '..');
const V5 = 'src/lib/exam-core/question-bank/production/v5';
const PAA_MATH = profileById('PAA.MATEMATICAS')!;
const IB_P1 = profileById('IB.MATH_AA.HL.P1')!;

const spec = (over: Partial<GenerationSpecification> = {}): GenerationSpecification => GenerationSpecificationSchema.parse({
  v: 1, slotKey: 'v2.paa/matematicas/paa.mat.algebra#0/001', profileId: PAA_MATH.profileId, profileVersion: GENERATOR_PROFILE_VERSION, family: 'PAA', configKey: 'v2.paa', sectionKey: 'matematicas',
  bucket: { objectiveCode: 'paa.mat.algebra', targetIndex: 0 }, conceptIds: ['c.linear'], objectiveIds: ['paa.mat.algebra'], skillIds: [], competencyIds: [],
  itemFormat: 'SELECTED_RESPONSE', intendedDifficulty: 'STANDARD', intendedMarks: 1, commandTerm: null, cognitiveTarget: 'compare two linear growth relations', contextRequirement: 'abstract or used', responseExpectation: 'one option', language: 'es', attempt: 0, ...over,
});
const mcq = (over: Partial<CandidateItem> = {}): CandidateItem => ({
  v: 1, itemId: 'qf5-0001', slotKey: spec().slotKey, itemType: 'SELECTED_RESPONSE', language: 'es', stimulus: null,
  fullLearnerPrompt: 'Dos planes de ahorro comienzan con 40 y 100 unidades y crecen 15 y 9 unidades por mes. ¿Después de cuántos meses el primer plan supera por primera vez al segundo?',
  parts: [], options: [{ label: 'A', text: '9' }, { label: 'B', text: '10' }, { label: 'C', text: '11' }, { label: 'D', text: '12' }],
  proposedAnswer: 'C', answerExpression: '(100-40)/(15-9)+1', acceptedUnits: [], solution: '40+15m > 100+9m, m > 10, primer entero 11.', rubric: [],
  distractorRationales: { A: 'resta mal las tasas', B: 'toma la igualdad como superar', D: 'suma un mes de más' }, marks: 1, commandTerm: null, provenance: 'ORIGINAL_STUDYUS', ...over,
});
const stages = (over: Partial<StageProviders> = {}): StageProviders => ({
  solve: async () => ({ independentAnswer: 'C', solution: 'm > 10', confidence: 'HIGH', ambiguityFlag: false, ambiguityNote: null }),
  judgeConstruct: async () => ({ constructFit: 'PASS', authenticity: 'HIGH', contextMaterial: true, languageQuality: 'PASS', plausibility: 'PASS', provenanceConcern: false, note: '' }),
  calibrateDifficulty: async () => ({ actualDifficulty: 'STANDARD', alsoPlausible: null, reasoningTransitions: 2, note: '' }),
  judgeDistractors: async () => ({ quality: 'PASS', defensibleOptions: ['C'], note: '' }),
  adjudicateEquivalence: async () => ({ verdict: 'UNSURE' }),
  ...over,
});
const run = (raw: unknown, s = spec(), p = PAA_MATH, st: Partial<StageProviders> = {}, corpus: Parameters<typeof duplicateOf>[1] = []) => validateCandidate(raw, s, p, { stages: stages(st), corpus });
const codes = (raw: unknown, s = spec(), p = PAA_MATH) => structuralFindings(raw, s, p).findings.map((f) => f.code);

describe('assessment authenticity profiles', () => {
  // the V5 generation scope: configurations supplied only by deterministic Exam Bank content are not generation targets
  const sections = allV2Configs().filter((c) => !RETIRED_V2_CONFIG_KEYS.includes(c.key) && !DETERMINISTIC_BANK_ONLY_CONFIG_KEYS.includes(c.key)).flatMap((c) => c.sections.map((s) => ({ configKey: c.key, family: c.family, sectionKey: s.key, componentType: s.componentType, simulationCapable: s.simulationCapable ?? true })));

  it('every active family has its own profiles; none is a shared prompt with the name substituted', () => {
    const by = profilesByFamily();
    for (const f of EXAM_FAMILIES) expect(by[f].length, f).toBeGreaterThan(0);
    expect(new Set(GENERATION_PROFILES.map((p) => p.profileId)).size).toBe(GENERATION_PROFILES.length);
    const signature = (id: string) => JSON.stringify([profileById(id)!.cognitiveModel.requiredMoves, profileById(id)!.contextPolicy, profileById(id)!.forbiddenPatterns]);
    expect(new Set(['PAA.MATEMATICAS', 'PISA.MATHEMATICS', 'IB.MATH_AA.HL.P1', 'CAMBRIDGE.0580.EXTENDED.P2', 'AICE.9709.PURE', 'ICFES.SABER11.MATEMATICAS'].map(signature)).size).toBe(6);
  });

  it('every simulation-capable, item-bankable blueprint section resolves to exactly one profile', () => {
    const unresolved = sections.filter((s) => s.simulationCapable).map((s) => ({ s, r: resolveProfile(s) })).filter((x) => x.r.kind === 'NO_PROFILE').map((x) => `${x.s.configKey}/${x.s.sectionKey}`);
    // 9709 Paper 2/3 exist only on one level each and Paper 3 of the A Level; IB Visual Arts is coursework
    expect(unresolved).toEqual([]);
    expect(resolveProfile({ configKey: 'v2.ib.visual-arts-sl', sectionKey: 'aip', componentType: 'COURSEWORK', simulationCapable: true }).kind).toBe('NOT_ITEM_BANKABLE');
    expect(resolveProfile({ configKey: 'v2.ib.s.history-sl', sectionKey: 'p1', componentType: 'PAPER', simulationCapable: false }).kind).toBe('NO_PROFILE');
  });

  it('states the locked rules: no inflated selected-response marks, HL demands more than SL, PISA context is material, Saber needs no story', () => {
    for (const p of GENERATION_PROFILES) expect(p.markPolicy.selectedResponseMarks, p.profileId).toBe(1);
    const t = (id: string) => profileById(id)!.cognitiveModel.minReasoningTransitions;
    expect(t('IB.MATH_AA.HL.P1').CHALLENGE).toBeGreaterThan(t('IB.MATH_AA.SL.P1').CHALLENGE);
    for (const p of profilesByFamily().PISA) expect(p.contextPolicy.requirement).toBe('MATERIAL_REQUIRED');
    expect(profileById('ICFES.SABER11.MATEMATICAS')!.contextPolicy.requirement).toBe('WHEN_PEDAGOGICALLY_APPROPRIATE');
    expect(profileById('IB.MATH_AA.HL.P1')!.calculator).toBe('NOT_ALLOWED');
    expect(profileById('IB.MATH_AA.HL.P2')!.calculator).toBe('REQUIRED');
    expect(profileById('IB.PHYSICS.HL.P1A')!.itemFormats).toEqual(['SELECTED_RESPONSE']);
    // essays and planning papers have no deterministic key: a person always certifies them
    expect(GENERATION_PROFILES.filter((p) => p.automation === 'HUMAN_REVIEW_ALWAYS').map((p) => p.profileId).sort()).toEqual(['AICE.9093.WRITTEN', 'AICE.9239.WRITTEN', 'AICE.9700.PLANNING', 'AICE.9701.PLANNING', 'AICE.9702.PLANNING', 'AICE.9708.WRITTEN']);
    for (const p of GENERATION_PROFILES) { expect(p.status).toBe('PROVISIONAL_STUDYUS_POLICY'); expect(p.authority).toBe('STUDYUS_POLICY'); }
  });
});

describe('stage 1-3: specification and structure', () => {
  it('the specification is immutable data with a stable hash and is never part of the learner view', () => {
    expect(specificationHash(spec())).toBe(specificationHash(spec()));
    expect(specificationHash(spec({ intendedDifficulty: 'CHALLENGE' }))).not.toBe(specificationHash(spec()));
    const view = JSON.stringify(learnerView(mcq()));
    for (const secret of ['STANDARD', 'paa.mat.algebra', 'compare two linear growth relations', 'resta mal', 'm > 10', 'proposedAnswer']) expect(view).not.toContain(secret);
  });
  it('a clean item has no finding; fullLearnerPrompt must exist and be complete', () => {
    expect(codes(mcq())).toEqual([]);
    expect(codes({ ...mcq(), fullLearnerPrompt: '' })).toEqual(['SCHEMA_INVALID']);
    expect(codes({ ...mcq(), extra: 1 })).toEqual(['SCHEMA_INVALID']);
    expect(codes('not json at all')).toEqual(['SCHEMA_INVALID']);
    expect(codes(mcq({ fullLearnerPrompt: 'Dos planes de ahorro comienzan con 40 y 100 unidades y crecen 15 y' }))).toContain('TRUNCATED');
    expect(codes(mcq({ fullLearnerPrompt: 'Calcula el valor de {{x}} en la expresión dada para los dos planes.' }))).toContain('TEMPLATE_RESIDUE');
  });
  it('ordinary mathematics is not residue or truncation: intervals, list labels, nested braces, units', () => {
    expect(codes(mcq({ fullLearnerPrompt: 'La función f está definida en el intervalo [2, 5) y toma valores en (−∞, 3]. ¿Cuál es el valor de f en el extremo incluido?' }))).toEqual([]);
    expect(codes(mcq({ fullLearnerPrompt: 'Considera las afirmaciones: a) el plan crece más rápido; b) el plan empieza con menos. ¿Cuántos meses pasan hasta que lo supera?' }))).toEqual([]);
    expect(codes(mcq({ fullLearnerPrompt: 'Si g(x) = e^{x^{2}} y h(x) = \\nu·x, ¿cuál de los valores siguientes corresponde al número de meses pedido?' }))).toEqual([]);
    expect(codes(mcq({ fullLearnerPrompt: 'Calcula el valor de f(2 en la expresión dada para los dos planes de ahorro descritos.' }))).toContain('TRUNCATED');
    expect([numericValue('12 cm'), numericValue('x = 3'), numericValue('$ 4.50'), numericValue('25 %'), numericValue('3/4'), numericValue('about twelve')]).toEqual([12, 3, 4.5, 25, 0.75, null]);
    // options with units still check against the declared arithmetic; unreadable options never produce a false failure
    const units = mcq({ options: [{ label: 'A', text: '9 meses' }, { label: 'B', text: '10 meses' }, { label: 'C', text: '11 meses' }, { label: 'D', text: '12 meses' }] });
    expect(declaredArithmeticFindings(units)).toEqual([]);
    // options with a unit may be in another unit than the arithmetic (A against mA): the check stands aside (found live, run qf5-live-002)
    expect(declaredArithmeticFindings({ ...units, proposedAnswer: 'B' })).toEqual([]);
    expect(declaredArithmeticFindings(mcq({ answerExpression: '9/15000', options: [{ label: 'A', text: '0.60 mA' }, { label: 'B', text: '0.90 mA' }, { label: 'C', text: '1.50 mA' }, { label: 'D', text: '1.80 mA' }], proposedAnswer: 'A' }))).toEqual([]);
    // the same number in opposite directions is two options, not one (found live)
    expect(optionFindings(mcq({ answerExpression: null, proposedAnswer: 'A', options: [{ label: 'A', text: '61.8 N upward' }, { label: 'B', text: '58.8 N upward' }, { label: 'C', text: '3.0 N upward' }, { label: 'D', text: '61.8 N downward' }] })).map((f) => f.code)).not.toContain('EQUIVALENT_OPTIONS');
    // text whose parentheses close as written is never "truncated", whatever labels or intervals it contains (found live: nine false rejections)
    expect(codes(mcq({ fullLearnerPrompt: 'Sea f(x) = (x − 1)(x + 2) para x en (0, 5). Indica: i) el valor de f(2) y ii) el mes en que el plan lo supera.' }))).toEqual([]);
    expect(declaredArithmeticFindings(mcq({ options: [{ label: 'A', text: 'nueve' }, { label: 'B', text: 'diez' }, { label: 'C', text: 'once' }, { label: 'D', text: 'doce' }] }))).toEqual([]);
  });
  it('the material is shown once: a prompt that repeats its stimulus is rejected', () => {
    const material = 'En un colegio se encuestó a estudiantes de dos grados sobre su preferencia por incluir fruta en el refrigerio escolar durante el año.';
    expect(codes(mcq({ stimulus: material }))).toEqual([]);
    expect(codes(mcq({ stimulus: material, fullLearnerPrompt: `${material} ¿Después de cuántos meses el primer plan supera al segundo?` }))).toEqual(['STIMULUS_REPEATED_IN_PROMPT']);
  });
  it('internal generation language never reaches the learner', () => {
    for (const leak of ['Target difficulty: hard. ¿Cuál es el valor de x en la ecuación?', 'Expected answer B. ¿Cuál es el valor de x en la ecuación?', 'Según el blueprint, ¿cuál es el valor de x en la ecuación?', 'Dificultad objetivo alta. ¿Cuál es el valor de x en 2x = 4?']) expect(codes(mcq({ fullLearnerPrompt: leak })), leak).toContain('SPEC_LEAKAGE');
    expect(codes(mcq({ options: [{ label: 'A', text: '9' }, { label: 'B', text: '10 (distractor)' }, { label: 'C', text: '11' }, { label: 'D', text: '12' }] }))).toContain('SPEC_LEAKAGE');
    // ordinary mathematics vocabulary is not leakage
    expect(codes(mcq({ fullLearnerPrompt: 'La función no está definida en x = 2. ¿Para qué valor estándar de m la recta y = mx corta a la curva?' }))).toEqual([]);
  });
  it('selected response: option shape, a key that is an option, a reason for every distractor, and never more than one mark', () => {
    expect(codes(mcq({ options: mcq().options.slice(0, 3) }))).toContain('OPTIONS_SHAPE');
    expect(codes(mcq({ proposedAnswer: 'E' }))).toContain('KEY_NOT_AN_OPTION');
    expect(codes(mcq({ distractorRationales: { A: 'x' } }))).toContain('DISTRACTOR_WITHOUT_RATIONALE');
    expect(codes(mcq({ marks: 2 }), spec({ intendedMarks: 2, intendedDifficulty: 'CHALLENGE' }))).toContain('SELECTED_RESPONSE_MARKS_INFLATED');
    expect(codes(mcq({ itemType: 'SHORT_RESPONSE' }))).toEqual(expect.arrayContaining(['FORMAT_NOT_REQUESTED', 'FORMAT_NOT_IN_PROFILE']));
    expect(codes(mcq({ language: 'en' }))).toContain('LANGUAGE_MISMATCH');
  });
  const ibSpec = spec({ slotKey: 'ib/p1/1', profileId: IB_P1.profileId, family: 'IB', configKey: 'v2.ib.math-aa-hl', sectionKey: 'p1', itemFormat: 'MULTI_PART', intendedMarks: 7, commandTerm: 'find', language: 'en' });
  const multi = (over: Partial<CandidateItem> = {}): CandidateItem => mcq({
    slotKey: 'ib/p1/1', itemType: 'MULTI_PART', language: 'en', options: [], distractorRationales: {}, proposedAnswer: 'k = 3', answerExpression: null, marks: 7, commandTerm: 'find',
    fullLearnerPrompt: 'The function f is defined by f(x) = x^3 - kx, where k is a positive constant.',
    parts: [{ label: '(a)', prompt: 'Find f\'(x).', marks: 2, commandTerm: 'find', canonicalAnswer: '3x^2 - k', dependsOn: [] }, { label: '(b)', prompt: 'Hence find the value of k for which the graph of f has a stationary point at x = 1.', marks: 5, commandTerm: 'find', canonicalAnswer: 'k = 3', dependsOn: ['(a)'] }],
    rubric: [{ marks: 2, criterion: 'M1 A1 differentiation' }, { marks: 5, criterion: 'M1 sets derivative to zero, A1 substitution, R1 reasoning, A2 k = 3' }], ...over,
  });
  it('multi-part: parts build forwards, marks sum, the rubric earns the marks, and the command term is really asked', () => {
    expect(codes(multi(), ibSpec, IB_P1)).toEqual([]);
    expect(codes(multi({ marks: 9 }), ibSpec, IB_P1)).toEqual(expect.arrayContaining(['PART_MARKS_DO_NOT_SUM', 'MARKS_NOT_EARNED_BY_RUBRIC']));
    const backwards = multi(); backwards.parts[0].dependsOn = ['(b)'];
    expect(codes(backwards, ibSpec, IB_P1)).toContain('PART_DEPENDS_ON_LATER_PART');
    const wrongTerm = multi(); wrongTerm.parts[1].commandTerm = 'prove';
    expect(codes(wrongTerm, ibSpec, IB_P1)).toContain('COMMAND_TERM_NOT_IN_PROMPT');
    const alien = multi(); alien.parts[0].commandTerm = 'ponder';
    expect(codes(alien, ibSpec, IB_P1)).toContain('COMMAND_TERM_NOT_IN_PROFILE');
    expect(codes(multi({ parts: multi().parts.slice(0, 1), marks: 2, rubric: [{ marks: 2, criterion: 'x' }] }), ibSpec, IB_P1)).toContain('MULTI_PART_TOO_FEW_PARTS');
  });
});

describe('stage 4 and 9: the generator\'s answer is never authoritative', () => {
  it('the solver and the difficulty calibrator are blind', () => {
    const s = JSON.stringify(solverInput(mcq()));
    for (const secret of ['proposedAnswer', 'solution', 'answerExpression', 'distractorRationales', 'resta mal', '(100-40)']) expect(s).not.toContain(secret);
    const d = JSON.stringify(difficultyInput(mcq(), PAA_MATH));
    for (const secret of ['STANDARD', 'FOUNDATIONAL', 'CHALLENGE', 'intended', 'proposedAnswer']) expect(d).not.toContain(secret);
  });
  it('compares by proof: option label, number, algebra at sample points, normalised text', () => {
    expect(compareAnswers(mcq(), '(c) 11').verdict).toBe('MATCH');
    expect(compareAnswers(mcq(), 'B').verdict).toBe('MISMATCH');
    expect(compareAnswers(mcq(), 'eleven months').verdict).toBe('UNDETERMINED');
    const numeric = mcq({ itemType: 'NUMERIC_ENTRY', options: [], proposedAnswer: '3/4' });
    expect(compareAnswers(numeric, '0.75')).toMatchObject({ verdict: 'MATCH', method: 'NUMERIC' });
    expect(compareAnswers(numeric, '0.7')).toMatchObject({ verdict: 'MISMATCH', method: 'NUMERIC' });
    const algebra = mcq({ itemType: 'SHORT_RESPONSE', options: [], proposedAnswer: '3(x+8)(x+4)' });
    expect(compareAnswers(algebra, '3x^2+36x+96')).toMatchObject({ verdict: 'MATCH', method: 'ALGEBRAIC' });
    expect(compareAnswers(algebra, '3x^2+36x+69')).toMatchObject({ verdict: 'MISMATCH', method: 'ALGEBRAIC' });
    expect(algebraicallyEqual('2ab+a', 'a(2b+1)')).toBe(true);
    expect(algebraicallyEqual('the mean rises', 'it increases')).toBe(null);
    expect(compareAnswers(mcq({ itemType: 'SHORT_RESPONSE', options: [], proposedAnswer: 'La media aumenta.' }), 'la  media aumenta').verdict).toBe('MATCH');
  });
  it('the declared arithmetic must give the key, and exactly one option', () => {
    expect(declaredArithmeticFindings(mcq())).toEqual([]);
    expect(declaredArithmeticFindings(mcq({ proposedAnswer: 'B' })).map((f) => f.code)).toEqual(['KEY_CONTRADICTS_DECLARED_ARITHMETIC']);
    expect(declaredArithmeticFindings(mcq({ answerExpression: '50' })).map((f) => f.code)).toEqual(['NO_OPTION_EQUALS_COMPUTED_ANSWER']);
    expect(optionFindings(mcq({ options: [{ label: 'A', text: '1/2' }, { label: 'B', text: '0.5' }, { label: 'C', text: '11' }, { label: 'D', text: '12' }] })).map((f) => f.code)).toContain('EQUIVALENT_OPTIONS');
  });
  it('a key the solver contradicts is rejected, and the remaining judges are not called', async () => {
    let judged = 0;
    const out = await run(mcq({ answerExpression: null }), spec(), PAA_MATH, { solve: async () => ({ independentAnswer: 'B', solution: '', confidence: 'HIGH', ambiguityFlag: false, ambiguityNote: null }), judgeConstruct: async () => { judged += 1; throw new Error('must not run'); } });
    expect(out.record).toMatchObject({ reviewDecision: 'AUTO_REJECT', answerMatch: 'MISMATCH', regenerable: true });
    expect(out.record.reviewReason).toMatch(/^ANSWER_MISMATCH/);
    expect(judged).toBe(0);
  });
  it('a malformed item is rejected before any model is asked', async () => {
    let calls = 0;
    const out = await run({ nope: true }, spec(), PAA_MATH, { solve: async () => { calls += 1; throw new Error('x'); } });
    expect(out.record.reviewDecision).toBe('AUTO_REJECT');
    expect(calls).toBe(0);
  });
});

describe('stages 5-7, 10, 11: construct, difficulty, distractors, triage', () => {
  it('auto-approves only when every gate passes, and records every stage', async () => {
    const out = await run(mcq());
    expect(out.record).toMatchObject({ reviewDecision: 'AUTO_APPROVE', answerMatch: 'CONFIRMED', answerMethod: 'OPTION_LABEL', tierFit: 'YES', direction: 'MATCH', constructFit: 'PASS', authenticity: 'HIGH', blueprintFit: 'PASS', originality: 'PASS', provenance: 'ORIGINAL_STUDYUS', reviewPriority: null });
    expect(out.record.stagesCompleted).toEqual([...PIPELINE_STAGES]);
  });
  const decision = async (st: Partial<StageProviders>, item = mcq(), s = spec(), p = PAA_MATH) => { const r = (await run(item, s, p, st)).record; return [r.reviewDecision, r.reviewPriority, r.reviewReason.split(':')[0]]; };
  const C = { constructFit: 'PASS', authenticity: 'HIGH', contextMaterial: true, languageQuality: 'PASS', plausibility: 'PASS', provenanceConcern: false, note: '' } as const;
  it('rejects obvious failures without sending them to a person', async () => {
    expect(await decision({ judgeConstruct: async () => ({ ...C, constructFit: 'FAIL' }) })).toEqual(['AUTO_REJECT', null, 'CONSTRUCT_FAIL']);
    expect(await decision({ judgeConstruct: async () => ({ ...C, authenticity: 'LOW' }) })).toEqual(['AUTO_REJECT', null, 'AUTHENTICITY_LOW']);
    expect(await decision({ judgeConstruct: async () => ({ ...C, provenanceConcern: true }) })).toEqual(['AUTO_REJECT', null, 'PROVENANCE_UNCLEAR']);
    expect(await decision({ judgeDistractors: async () => ({ quality: 'AMBIGUOUS', defensibleOptions: ['B', 'C'], note: '' }) })).toEqual(['AUTO_REJECT', null, 'MULTIPLE_DEFENSIBLE_ANSWERS']);
    expect(await decision({ calibrateDifficulty: async () => ({ actualDifficulty: 'FOUNDATIONAL', alsoPlausible: null, reasoningTransitions: 1, note: '' }) })).toEqual(['AUTO_REJECT', null, 'TIER_MISMATCH']);
    expect(await decision({ judgeConstruct: async () => { throw new Error('timeout'); } })).toEqual(['AUTO_REJECT', null, 'STAGE_NOT_COMPLETED']);
    // PISA: a context the reasoning never uses is decoration
    const pisa = profileById('PISA.MATHEMATICS')!;
    expect(await decision({ judgeConstruct: async () => ({ ...C, contextMaterial: false }) }, mcq(), spec({ profileId: pisa.profileId, family: 'PISA' }), pisa)).toEqual(['AUTO_REJECT', null, 'CONTEXT_DECORATIVE']);
  });
  it('sends only the grey zone to a person, ordered by risk', async () => {
    expect(await decision({ solve: async () => ({ independentAnswer: 'C', solution: '', confidence: 'HIGH', ambiguityFlag: true, ambiguityNote: 'two readings' }) })).toEqual(['HUMAN_REVIEW', 'P0', 'AMBIGUITY_FLAGGED']);
    expect(await decision({ solve: async () => ({ independentAnswer: 'C', solution: '', confidence: 'LOW', ambiguityFlag: false, ambiguityNote: null }) })).toEqual(['HUMAN_REVIEW', 'P0', 'SOLVER_LOW_CONFIDENCE']);
    expect(await decision({ judgeConstruct: async () => ({ ...C, constructFit: 'WEAK' }) })).toEqual(['HUMAN_REVIEW', 'P1', 'CONSTRUCT_WEAK']);
    expect(await decision({ judgeConstruct: async () => ({ ...C, authenticity: 'MEDIUM' }) })).toEqual(['HUMAN_REVIEW', 'P1', 'AUTHENTICITY_MEDIUM']);
    expect(await decision({ calibrateDifficulty: async () => ({ actualDifficulty: 'CHALLENGE', alsoPlausible: 'STANDARD', reasoningTransitions: 3, note: '' }) })).toEqual(['HUMAN_REVIEW', 'P2', 'TIER_BORDERLINE']);
    expect(await decision({ judgeDistractors: async () => ({ quality: 'WEAK', defensibleOptions: ['C'], note: '' }) })).toEqual(['HUMAN_REVIEW', 'P3', 'DISTRACTORS_WEAK']);
    // free text with no normaliser: equivalence must be established, a guess is not enough
    const text = mcq({ itemType: 'NUMERIC_ENTRY', options: [], distractorRationales: {}, proposedAnswer: 'once meses', answerExpression: null });
    expect(await decision({ solve: async () => ({ independentAnswer: '11 months', solution: '', confidence: 'HIGH', ambiguityFlag: false, ambiguityNote: null }) }, text, spec({ itemFormat: 'NUMERIC_ENTRY' }))).toEqual(['HUMAN_REVIEW', 'P0', 'ANSWER_UNCONFIRMED']);
  });
  it('difficulty is what the item demands, not what it was labelled or how long it is', () => {
    const d = (actualDifficulty: 'FOUNDATIONAL' | 'STANDARD' | 'CHALLENGE', reasoningTransitions: number, alsoPlausible: 'FOUNDATIONAL' | 'STANDARD' | 'CHALLENGE' | null = null) => ({ actualDifficulty, alsoPlausible, reasoningTransitions, note: '' });
    expect(tierFit('CHALLENGE', d('CHALLENGE', 3), PAA_MATH)).toEqual({ tierFit: 'YES', direction: 'MATCH' });
    // labelled CHALLENGE and judged CHALLENGE, but only one real reasoning transition: not certified as a match
    expect(tierFit('CHALLENGE', d('CHALLENGE', 1), PAA_MATH)).toEqual({ tierFit: 'BORDERLINE', direction: 'TOO_EASY' });
    expect(tierFit('CHALLENGE', d('FOUNDATIONAL', 1), PAA_MATH)).toEqual({ tierFit: 'NO', direction: 'TOO_EASY' });
    expect(tierFit('FOUNDATIONAL', d('STANDARD', 2, 'FOUNDATIONAL'), PAA_MATH)).toEqual({ tierFit: 'BORDERLINE', direction: 'TOO_HARD' });
    // HL asks for more transitions than SL at the same tier
    expect(tierFit('STANDARD', d('STANDARD', 2), profileById('IB.MATH_AA.SL.P1')!).tierFit).toBe('YES');
    expect(tierFit('STANDARD', d('STANDARD', 2), IB_P1).tierFit).toBe('BORDERLINE');
  });
  it('free-response components with no deterministic key are never auto-approved', async () => {
    const p = profileById('AICE.9708.WRITTEN')!;
    const essay = mcq({ itemType: 'EXTENDED_RESPONSE', language: 'en', options: [], distractorRationales: {}, answerExpression: null, marks: 8, commandTerm: 'explain', proposedAnswer: 'A rise in the interest rate raises the cost of borrowing.', fullLearnerPrompt: 'Explain two ways in which a rise in the central bank interest rate may reduce inflation in an economy.', rubric: [{ marks: 8, criterion: 'two developed chains of reasoning' }] });
    const s = spec({ profileId: p.profileId, family: 'AICE', itemFormat: 'EXTENDED_RESPONSE', intendedMarks: 8, commandTerm: 'explain', language: 'en' });
    const r = (await run(essay, s, p, { solve: async () => ({ independentAnswer: 'A rise in the interest rate raises the cost of borrowing.', solution: '', confidence: 'HIGH', ambiguityFlag: false, ambiguityNote: null }) })).record;
    expect([r.reviewDecision, r.reviewPriority, r.reviewReason.split(':')[0]]).toEqual(['HUMAN_REVIEW', 'P1', 'FREE_RESPONSE_RUBRIC']);
  });
  it('option clues and implausible magnitudes are flagged', () => {
    expect(optionFindings(mcq({ answerExpression: null, options: [{ label: 'A', text: 'sube' }, { label: 'B', text: 'baja' }, { label: 'C', text: 'aumenta porque la tasa mensual del primer plan es mayor que la del segundo' }, { label: 'D', text: 'igual' }] })).map((f) => f.code)).toContain('KEY_LENGTH_CLUE');
    expect(optionFindings(mcq({ options: [{ label: 'A', text: '9' }, { label: 'B', text: 'todas las anteriores' }, { label: 'C', text: '11' }, { label: 'D', text: '12' }] })).map((f) => f.code)).toContain('FORBIDDEN_OPTION_FORM');
    expect(plausibilityFindings(mcq({ fullLearnerPrompt: 'La probabilidad de lluvia es 1.4 y un ciclista viaja a 30 km/h durante dos horas. ¿Qué distancia recorre?' })).map((f) => f.code)).toContain('PROBABILITY_OVER_1');
    expect(plausibilityFindings(mcq({ fullLearnerPrompt: 'Un ciclista viaja a 4000 km/h durante dos horas por la ciudad. ¿Qué distancia recorre en total?' })).map((f) => f.code)).toContain('SPEED_IMPLAUSIBLE');
    expect(plausibilityFindings(mcq())).toEqual([]);
    const skew = [...Array(30).fill('A'), ...Array(4).fill('B'), ...Array(3).fill('C'), ...Array(3).fill('D')];
    expect(keyPositionFinding(skew, 4)?.code).toBe('KEY_POSITION_SKEW');
    expect(keyPositionFinding(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'B', 'C'], 4)).toBe(null);
  });
});

describe('stage 8: originality and duplicates', () => {
  const text = learnerText(mcq());
  it('exact, normalised, near and re-numbered-template duplicates are all caught', async () => {
    expect(duplicateOf(mcq(), [{ id: 'x', source: 'CURRENT_BANK', text }]).verdict).toBe('EXACT');
    expect(duplicateOf(mcq(), [{ id: 'x', source: 'THIS_BATCH', text: text.toUpperCase().replace(/\?/g, ' ? ') }]).verdict).toBe('NORMALISED');
    expect(duplicateOf(mcq(), [{ id: 'x', source: 'EARLIER_BATCH', text: text.replace('40', '55').replace('100', '130').replace('15', '18').replace(/\b9\b/g, '7') }]).verdict).toMatch(/NEAR|TEMPLATE/);
    expect(templateSkeleton('Si x = 12 y y = 7')).toBe(templateSkeleton('Si a = 3 y b = 91'));
    expect(duplicateOf(mcq(), [{ id: 'x', source: 'CURRENT_BANK', text: 'Un texto distinto sobre la fotosíntesis y la energía que captan las hojas durante el día.' }]).verdict).toBe('UNIQUE');
    const out = await run(mcq(), spec(), PAA_MATH, {}, [{ id: 'bank-7', source: 'CURRENT_BANK', text }]);
    expect(out.record).toMatchObject({ reviewDecision: 'AUTO_REJECT', originality: 'FAIL', duplicateOf: 'bank-7' });
  });
});

describe('regeneration, calibration, stop conditions, audit, spend, checkpoint', () => {
  const outcome = async (st: Partial<StageProviders> = {}, n = 0) => runSpecification(spec({ slotKey: `s${n}` }), PAA_MATH, async (s) => mcq({ itemId: `i${n}-${s.attempt}`, slotKey: s.slotKey, fullLearnerPrompt: `${mcq().fullLearnerPrompt} (caso ${n})`.replace(/ \(caso \d+\)$/, '') + ` Considera el caso ${n * 7 + 3}.` }), { stages: stages(st), corpus: [] });
  it('one automatic regeneration per specification, never more', async () => {
    let authored = 0;
    const always = await runSpecification(spec(), PAA_MATH, async () => { authored += 1; return mcq(); }, { stages: stages({ judgeConstruct: async () => ({ constructFit: 'FAIL', authenticity: 'LOW', contextMaterial: false, languageQuality: 'PASS', plausibility: 'PASS', provenanceConcern: false, note: '' }) }), corpus: [] });
    expect(authored).toBe(2);
    expect(always).toMatchObject({ regenerated: true, specificationIssue: true, firstAttemptPass: false });
    let n = 0;
    const second = await runSpecification(spec(), PAA_MATH, async () => { n += 1; return n === 1 ? { broken: true } : mcq(); }, { stages: stages(), corpus: [] });
    expect(second).toMatchObject({ regenerated: true, specificationIssue: false, firstAttemptPass: false });
    expect(second.final.record.reviewDecision).toBe('AUTO_APPROVE');
    expect(second.final.record.attempt).toBe(1);
    // a provenance concern is not a generation fault to retry
    let p = 0;
    const prov = await runSpecification(spec(), PAA_MATH, async () => { p += 1; return mcq(); }, { stages: stages({ judgeConstruct: async () => ({ constructFit: 'PASS', authenticity: 'HIGH', contextMaterial: true, languageQuality: 'PASS', plausibility: 'PASS', provenanceConcern: true, note: '' }) }), corpus: [] });
    expect(p).toBe(1);
    expect(prov.final.record.provenance).toBe('UNCLEAR');
  });
  it('calibration gates C1 and C2, and the dashboard cut by every dimension', async () => {
    const good = await Promise.all(Array.from({ length: 20 }, (_, i) => outcome({}, i)));
    expect(calibrationGate('C1', good)).toEqual({ phase: 'C1', pass: true, unmet: [] });
    expect(calibrationGate('C2', good).unmet).toEqual(['BATCH_TOO_SMALL: 20 of 50']);
    // an operator may authorise a smaller live sample; nothing else about the gate moves
    expect(calibrationGate('C1', good.slice(0, 8), 8).pass).toBe(true);
    expect(calibrationGate('C1', good.slice(0, 6), 8).unmet).toEqual(['BATCH_TOO_SMALL: 6 of 8']);
    const weak = await Promise.all(Array.from({ length: 20 }, (_, i) => outcome(i < 5 ? { judgeConstruct: async () => ({ constructFit: 'WEAK', authenticity: 'HIGH', contextMaterial: true, languageQuality: 'PASS', plausibility: 'PASS', provenanceConcern: false, note: '' }) } : {}, i)));
    expect(calibrationGate('C1', weak).unmet).toEqual(['FIRST_ATTEMPT_PASS 0.75 < 0.8', 'HUMAN_REVIEW 0.25 > 0.1']);
    const wrong = [...good.slice(1), await outcome({ solve: async () => ({ independentAnswer: 'A', solution: '', confidence: 'HIGH', ambiguityFlag: false, ambiguityNote: null }) }, 99)];
    expect(calibrationGate('C1', wrong).unmet.join(' ')).toMatch(/ANSWER_FAILURES = 1/);
    const m = metricsOf(weak);
    expect(m).toMatchObject({ specifications: 20, autoApproved: 15, humanReview: 5, autoRejected: 0, humanReviewRate: 0.25, firstAttemptPassRate: 0.75 });
    expect(Object.keys(metricsBy(weak, 'family'))).toEqual(['PAA']);
    expect(metricsBy(weak, 'intendedDifficulty').STANDARD.humanReview).toBe(5);
  });
  it('stops a profile on an answer error, on leakage, on a harness error, or on a review rate over 10 % twice running', async () => {
    const good = await Promise.all(Array.from({ length: 20 }, (_, i) => outcome({}, i)));
    expect(stopCondition([good])).toEqual({ stop: false, reasons: [], warnings: [] });
    const grey = await Promise.all(Array.from({ length: 20 }, (_, i) => outcome(i < 3 ? { judgeDistractors: async () => ({ quality: 'WEAK', defensibleOptions: [], note: '' }) } : {}, i)));
    expect(stopCondition([grey])).toMatchObject({ stop: false, warnings: ['HUMAN_REVIEW 0.15 > 0.1'] });
    expect(stopCondition([grey, grey]).reasons).toEqual(['HUMAN_REVIEW_OVER_0.1_TWICE']);
    const wrong = [...good, await outcome({ solve: async () => ({ independentAnswer: 'A', solution: '', confidence: 'HIGH', ambiguityFlag: false, ambiguityNote: null }) }, 77)];
    expect(stopCondition([wrong]).reasons).toContain('ANSWER_ERROR_IN_BATCH');
    const broken = [...good, await outcome({ calibrateDifficulty: async () => { throw new Error('502'); } }, 78)];
    expect(stopCondition([broken]).reasons).toContain('PROVIDER_OR_HARNESS_ERROR');
    const easy = await Promise.all(Array.from({ length: 12 }, (_, i) => outcome(i < 5 ? { calibrateDifficulty: async () => ({ actualDifficulty: 'FOUNDATIONAL', alsoPlausible: 'STANDARD', reasoningTransitions: 1, note: '' }) } : {}, i)));
    expect(stopCondition([easy]).reasons).toContain('DIFFICULTY_SYSTEMATICALLY_TOO_EASY');
  });
  it('audit sample: 2 % stratified, reproducible, at least one per stratum; more than 1 % material errors pauses promotion', async () => {
    const good = (await Promise.all(Array.from({ length: 120 }, (_, i) => outcome({}, i)))).map((o) => o.final.record);
    const a = auditSample(good, 'seed-1');
    expect(a.length).toBe(3);
    expect(auditSample(good, 'seed-1').map((r) => r.itemId)).toEqual(a.map((r) => r.itemId));
    expect(auditSample(good, 'seed-2').map((r) => r.itemId)).not.toEqual(a.map((r) => r.itemId));
    expect(auditSample([...good, { ...good[0], itemId: 'other', intendedDifficulty: 'CHALLENGE' }], 'seed-1').some((r) => r.itemId === 'other')).toBe(true);
    expect([auditPausesPromotion(100, 1), auditPausesPromotion(100, 2), auditPausesPromotion(0, 0)]).toEqual([false, true, false]);
  });
  it('no authorised budget means no provider call; an authorised budget is a hard ceiling', () => {
    expect(maySpend({ authorizedUsd: null, entries: [] }, 0.01)).toMatchObject({ allowed: false, code: 'BUDGET_NOT_AUTHORIZED' });
    expect(maySpend({ authorizedUsd: 0, entries: [] }, 0.01)).toMatchObject({ allowed: false, code: 'BUDGET_NOT_AUTHORIZED' });
    const ledger = { authorizedUsd: 10, entries: [{ batchId: 'b1', provider: 'p', model: 'm', purpose: 'GENERATION' as const, calls: 50, succeeded: 49, failed: 1, estimatedUsd: 6.5 }] };
    expect(cumulativeSpend(ledger)).toBe(6.5);
    expect(maySpend(ledger, 3.5)).toEqual({ allowed: true, remainingUsd: 0 });
    expect(maySpend(ledger, 3.51)).toMatchObject({ allowed: false, code: 'BUDGET_WOULD_BE_EXCEEDED' });
  });
  it('checkpoints make a run restartable, and a validator change invalidates what it scored', async () => {
    const batch = await Promise.all(Array.from({ length: 4 }, (_, i) => outcome({}, i)));
    const versions = { profileVersion: GENERATOR_PROFILE_VERSION, validatorVersion: batch[0].final.record.validatorVersion };
    const cp = checkpoint({ runId: 'r1', batchId: 'b1', phase: 'C1', profileId: PAA_MATH.profileId, ...versions, cumulativeSpendUsd: 0, timestamp: '2026-10-11T00:00:00Z', outcomes: batch });
    expect(cp.candidateIds.length).toBe(4);
    expect(cp.hash).toBe(checkpoint({ runId: 'r1', batchId: 'b1', phase: 'C1', profileId: PAA_MATH.profileId, ...versions, cumulativeSpendUsd: 0, timestamp: '2026-10-11T00:00:00Z', outcomes: batch }).hash);
    expect(completedBatchIds([cp], versions)).toEqual(['b1']);
    expect(completedBatchIds([cp], { ...versions, validatorVersion: 'next' })).toEqual([]);
    expect(needsRevalidation(batch.map((o) => o.final.record), 'next').length).toBe(4);
  });
  it('lifecycle: only an auto-approved item is certified; review and rejects are never Student eligible', async () => {
    const approved = (await outcome()).final.record;
    expect(lifecycleAfter(approved)).toBe('CERTIFIED');
    expect(lifecycleAfter({ ...approved, reviewDecision: 'HUMAN_REVIEW' })).toBe('REVIEW_REQUIRED');
    expect(lifecycleAfter({ ...approved, reviewDecision: 'AUTO_REJECT' })).toBe('AUTO_REJECTED');
    expect((['GENERATED', 'VALIDATING', 'AUTO_REJECTED', 'REVIEW_REQUIRED', 'CERTIFIED', 'PUBLISHED'] as const).filter(isStudentEligibleLifecycle)).toEqual(['CERTIFIED', 'PUBLISHED']);
    const q = reviewQueue([{ ...approved, itemId: 'c', reviewDecision: 'HUMAN_REVIEW', reviewPriority: 'P3' }, { ...approved, itemId: 'a', reviewDecision: 'HUMAN_REVIEW', reviewPriority: 'P0' }, approved, { ...approved, itemId: 'b', reviewDecision: 'HUMAN_REVIEW', reviewPriority: 'P1' }]);
    expect(q.map((r) => r.itemId)).toEqual(['a', 'b', 'c']);
  });
});

describe('blueprint readiness from the global certified bank', () => {
  const configs = allV2Configs().filter((c) => !RETIRED_V2_CONFIG_KEYS.includes(c.key) && !DETERMINISTIC_BANK_ONLY_CONFIG_KEYS.includes(c.key));
  const sections = blueprintSections(configs as never);
  const fill = (family: string, perBucket: (required: number) => number, eligible = true): BankItem[] => sections.filter((s) => s.family === family && resolveProfile(s).kind === 'PROFILE').flatMap((s) => s.buckets.flatMap((b) => Array.from({ length: perBucket(b.required) }, (_, i) => ({ itemId: `${b.bucketKey}:${i}`, bucketKey: b.bucketKey, difficulty: i % 3 === 2 ? 'CHALLENGE' as const : 'STANDARD' as const, itemType: 'SELECTED_RESPONSE', studentEligible: eligible }))));

  it('an empty bank is not "unavailable": every gate names its blocking buckets with required, available and gap', () => {
    const r = familyReadiness('ICFES', sections, []);
    expect(r).toMatchObject({ eligibleItems: 0, coveragePercent: 0, uniquePoolDepth: 0 });
    expect(r.practice.state).toBe('NOT_READY');
    expect(r.reducedMock.blockers.every((b) => b.code === 'BUCKET_BELOW_BLUEPRINT' && b.gap === b.required && b.available === 0)).toBe(true);
    expect(r.reducedMock.blockers.reduce((a, b) => a + (b.gap ?? 0), 0)).toBe(50);
    expect(globalReadiness(sections, []).map((x) => x.family)).toEqual([...EXAM_FAMILIES]);
  });
  it('a fresh Student needs nothing of their own: readiness takes blueprints and the global bank, and nothing else', () => {
    expect(familyReadiness.length).toBe(3);
    const bank = fill('ICFES', (r) => r);
    const r = familyReadiness('ICFES', sections, bank);
    expect([r.practice.state, r.reducedMock.state, r.eligibleItems, r.coveragePercent, r.uniquePoolDepth]).toEqual(['READY', 'READY', 50, 100, 1]);
  });
  it('items that are generated, in review or rejected never count', () => {
    const r = familyReadiness('ICFES', sections, fill('ICFES', (x) => x * 3, false));
    expect([r.eligibleItems, r.practice.state, r.coveragePercent]).toEqual([0, 'NOT_READY', 0]);
  });
  it('MINIMUM_READY and REPEATABLE_READY are different: three forms need three times the depth', () => {
    const one = familyReadiness('ICFES', sections, fill('ICFES', (r) => r));
    const three = familyReadiness('ICFES', sections, fill('ICFES', (r) => r * 3));
    expect(one.repeatableFullMock.blockers.some((b) => b.code === 'BUCKET_BELOW_REPEATABLE_DEPTH')).toBe(true);
    expect(three.repeatableFullMock.blockers.filter((b) => b.code === 'BUCKET_BELOW_REPEATABLE_DEPTH')).toEqual([]);
    expect(three.uniquePoolDepth).toBe(3);
  });
  it('a reduced blueprint never becomes a full mock, however deep the bank', () => {
    const r = familyReadiness('CAMBRIDGE', sections, fill('CAMBRIDGE', (x) => x * 5));
    expect([r.practice.state, r.reducedMock.state, r.fullMock.state]).toEqual(['READY', 'READY', 'NOT_READY']);
    expect([...new Set(r.fullMock.blockers.map((b) => b.code))]).toEqual(['FULL_FORM_BLUEPRINT_NOT_GOVERNED']);
  });
  it('a competency benchmark has practice and challenge but no mock', () => {
    const r = familyReadiness('PISA', sections, fill('PISA', (x) => x * 6));
    expect([r.practice.state, r.reducedMock.state, r.fullMock.state, r.repeatableFullMock.state, r.challenge.state]).toEqual(['READY', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'READY']);
  });
  it('challenge needs real CHALLENGE items in every section', () => {
    const none = fill('PISA', (x) => x * 6).map((i) => ({ ...i, difficulty: 'STANDARD' as const }));
    expect(familyReadiness('PISA', sections, none).challenge.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['CHALLENGE_POOL_TOO_SMALL', 'SECTION_WITHOUT_CHALLENGE_ITEM']));
  });
  it('allocation is coverage-driven: empty buckets first, sized by the gap and the expected yield, never an equal split', () => {
    const rows = generationAllocation(sections, fill('ICFES', (r) => r), 0.8);
    expect(rows[0].priority).toBe(1);
    expect(rows.filter((r) => r.family === 'ICFES').every((r) => r.priority === 3)).toBe(true);
    const k = bucketKeyOf('v2.cambridge.0580-extended', 'p2', sections.find((s) => s.configKey === 'v2.cambridge.0580-extended')!.buckets[0].objectiveCode, 0);
    expect(rows.find((r) => r.bucket === k)).toMatchObject({ available: 0, required: 3, toGenerate: 4, profileId: 'CAMBRIDGE.0580.EXTENDED.P2' });
    const byFamily = new Map<string, number>();
    for (const r of rows) byFamily.set(r.family, (byFamily.get(r.family) ?? 0) + r.toGenerate);
    expect(new Set(byFamily.values()).size).toBeGreaterThan(1);
  });
});

describe('the V5 modules are pure and exam-neutral in their control flow', () => {
  it('eight files, no database, environment, network, clock or randomness, and no branch on a family name', () => {
    const files = readdirSync(join(ROOT, V5)).sort();
    expect(files).toEqual(['batch-control.ts', 'deterministic-stages.ts', 'generation-profile.ts', 'item.ts', 'pipeline.ts', 'plan.ts', 'prompts.ts', 'readiness.ts']);
    for (const f of files) {
      const src = readFileSync(join(ROOT, V5, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/from '@\/lib\/db'|\bquery\(|INSERT INTO|process\.env|fetch\(|from '(node:)?fs'|from 'pg'|@\/lib\/ai\/|\bDate\.now\(|new Date\(|Math\.random\(|@\/lib\/assessment-blueprint/);
      expect(src, f).not.toMatch(/(===|case)\s*'(PAA|PISA|IB|CAMBRIDGE|AICE|ICFES)'/);
    }
    expect(CandidateItemSchema.shape.provenance.value).toBe('ORIGINAL_STUDYUS');
  });
});
