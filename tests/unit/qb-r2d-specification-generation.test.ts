/**
 * QB-R2D -- specification-driven generation, the constructed-response path, the independent validators and the
 * spend guard. NO NETWORK: every provider here is a recorded or a fake one, and every response is a FIXTURE
 * authored in this file (not a live recording; the live recording is replayed in qb-r2d-live-replay.test.ts).
 */
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import {
  assembleSpecificationBatch, generateFromSpecification, MALFORMED_RESPONSE_CODES, parseSpecificationResponse, renderSpecificationPrompt, selectSpecificationTemplate, SPECIFICATION_GENERATION_ERROR_CODES, SPECIFICATION_TEMPLATE_REGISTRY, SpecificationGenerationError,
  type SpecificationUnitResult,
} from '@/lib/exam-core/question-bank/production/generator/specification-generation';
import { constructVocabularyOf, MATH_CONSTRUCT_VOCABULARY } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import { ConstructedResponseSchema, SpecificationCandidateSchema, type SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import {
  classifyAnswers, deriveConstruct, detectLanguage, itemAnswerClass, NO_CALCULATOR_NUMBER_RULE, numbersInText, parseLinearFromText, parseQuadraticFromText, rootsStatedInText, SPECIFICATION_VALIDATORS_REVISION, statesAFactorisedEquation, validateAnswerKey, validateConstructPreservation, validateMachineRecomputation, validateProfileCompliance,
  validateSpecificationCandidate, validateSpecificationLineage, validateSpecificationOriginality, validateSpecificationStimulus, validateStructure,
} from '@/lib/exam-core/question-bank/production/specification-validators';
import { MATH_POC_FAMILIES } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { BudgetedLiveProvider, BudgetExceededError, costOf, GUARD_PRICE_BASIS, inputTokenUpperBound, QB_R2D_SPEND_CAP_USD, SpendLedger, type ModelTransport } from '../../scripts/operations/qb-r2d/budget';
import { malformedCodeOf, plannedUnits, policyFor, QB_R2D_BATCH_KEY } from '../../scripts/operations/qb-r2d/pipeline';
import { buildSelection, unitKeyOf } from '../../scripts/operations/qb-r2d/selection';

const ROOT = process.cwd();
const MODEL = 'fixture-model';
const NOW = '2026-10-11T12:00:00Z';
const SELECTION = buildSelection();
const specOf = (selectionKey: string): AdaptationSpecification => SELECTION.find((s) => s.selectionKey === selectionKey)!.specification;
const constructOf = (s: AdaptationSpecification) => (s.invariants.construct as { construct: string }).construct;

// ---- fixtures: responses authored here, in the shape a provider must return ------------------------------------
const NC = (reason: string) => ({ kind: 'NOT_MACHINE_CHECKABLE', reason });
const EXPR = (expression: string) => ({ kind: 'ARITHMETIC_EXPRESSION', expression });
const base = { credit: null, usesStimulusValues: null, proposedSupportingConceptStableIds: [] };
const FIX: Record<string, { stimulus: unknown; item: Record<string, unknown> }> = {
  '01.linear-model.paa': { stimulus: null, item: { ...base, stem: 'Un gimnasio cobra una inscripción de 20 dólares y, además, 15 dólares por cada mes de uso. ¿Cuánto paga en total una persona que usa el gimnasio durante 6 meses?', context: { kind: 'PERSONAL', description: 'Costo total de un gimnasio para una persona.' }, declaredModel: { construct: 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE', parameters: { b: 20, m: 15, x: 6 } }, numeric: null, constructed: null, rationale: 'El total es la inscripción más el pago mensual por el número de meses: 20 + 15 × 6 = 110.',
    selected: { options: [{ id: 'A', text: '110 dólares' }, { id: 'B', text: '135 dólares' }, { id: 'C', text: '90 dólares' }, { id: 'D', text: '35 dólares' }], answerKey: 'A', distractors: { B: { misconceptionModelId: 'swapped-parameters', rationale: 'Multiplica la inscripción por los meses y suma el pago mensual.' }, C: { misconceptionModelId: 'no-start', rationale: 'Olvida la inscripción.' }, D: { misconceptionModelId: 'slope-as-total', rationale: 'Suma los dos datos sin considerar los meses.' } }, target: { kind: 'QUANTITY', quantity: 'VALUE_AT_X' }, answerCheck: EXPR('20 + 15 * 6') } } },
  '02.linear-model.ib-p1': { stimulus: null, item: { ...base, stem: 'A tank contains 40 litres of water. Water is pumped into the tank at a constant rate of 3 litres per minute. Let V be the volume of water, in litres, t minutes after the pump starts.', context: { kind: 'SCIENTIFIC', description: 'A measured volume that grows at a constant rate.' }, declaredModel: { construct: 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE', parameters: { b: 40, m: 3, x: 12 } }, selected: null, numeric: null, rationale: 'The volume is the starting volume plus the rate times the time.',
    constructed: { totalMarks: 5, workingOutline: ['Identify the starting value 40 and the rate 3.', 'Write V = 40 + 3t.', 'Substitute t = 12 to get 76.', 'State that 3 is the litres added each minute.'], parts: [
      { label: 'a', prompt: 'Find an expression for V in terms of t.', marks: 2, markScheme: [{ kind: 'METHOD', marks: 1, criterion: 'Sets up a linear model with a starting value and a constant rate.' }, { kind: 'ACCURACY', marks: 1, criterion: 'V = 40 + 3t' }], finalAnswer: 'V = 40 + 3t', numericKey: null, target: NC('The answer is an algebraic expression, not a number of the vocabulary.'), answerCheck: { kind: 'NOT_COMPUTABLE', reason: 'The answer is an expression in t.' } },
      { label: 'b', prompt: 'Find the volume of water in the tank after 12 minutes.', marks: 2, markScheme: [{ kind: 'METHOD', marks: 1, criterion: 'Substitutes t = 12 into the model.' }, { kind: 'ACCURACY', marks: 1, criterion: '76 litres' }], finalAnswer: '76 litres', numericKey: { kind: 'NUMERIC', value: '76', equivalentFormsAllowed: true }, target: { kind: 'QUANTITY', quantity: 'VALUE_AT_X' }, answerCheck: EXPR('40 + 3 * 12') },
      { label: 'c', prompt: 'Interpret the value 3 in this context.', marks: 1, markScheme: [{ kind: 'REASONING', marks: 1, criterion: 'States that the volume increases by 3 litres every minute.' }], finalAnswer: 'The volume increases by 3 litres each minute.', numericKey: null, target: NC('An interpretation in words: no rule decides it.'), answerCheck: { kind: 'NOT_COMPUTABLE', reason: 'An interpretation in words.' } },
    ] } } },
  '05.linear-model.pisa': { stimulus: { parts: [], structured: { v: 1, tables: [{ tableKey: 'taxi', title: 'Costo de un viaje en taxi', columns: [{ key: 'km', label: 'Distancia', type: 'NUMBER', unit: 'km' }, { key: 'costo', label: 'Costo', type: 'NUMBER', unit: 'dólares' }], rows: [[0, 5], [1, 7], [2, 9], [3, 11]] }], dataSets: [], charts: [], figures: [] } }, item: { ...base, stem: 'La tabla muestra el costo de un viaje en taxi según la distancia recorrida. Si el costo sigue aumentando al mismo ritmo, ¿cuánto costará un viaje de 10 km?', context: { kind: 'PERSONAL', description: 'Una persona estima el costo de un viaje en taxi.' }, declaredModel: { construct: 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE', parameters: { b: 5, m: 2, x: 10 } }, numeric: null, constructed: null, rationale: 'El costo inicial es 5 y aumenta 2 por cada kilómetro: 5 + 2 × 10 = 25.', usesStimulusValues: [5, 7, 9, 11],
    credit: [{ code: 'FULL_CREDIT', description: 'Selecciona 25 dólares.' }, { code: 'NO_CREDIT', description: 'Cualquier otra opción o sin respuesta.' }],
    selected: { options: [{ id: 'A', text: '25 dólares' }, { id: 'B', text: '20 dólares' }, { id: 'C', text: '52 dólares' }, { id: 'D', text: '7 dólares' }], answerKey: 'A', distractors: { B: { misconceptionModelId: 'no-start', rationale: 'Omite el costo inicial.' }, C: { misconceptionModelId: 'swapped-parameters', rationale: 'Intercambia el costo inicial y la tasa.' }, D: { misconceptionModelId: 'slope-as-total', rationale: 'Toma el costo de un kilómetro como total.' } }, target: { kind: 'QUANTITY', quantity: 'VALUE_AT_X' }, answerCheck: EXPR('5 + 2 * 10') } } },
  '09.quadratic-factorising.paa': { stimulus: null, item: { ...base, stem: '¿Cuál es la mayor de las soluciones de la ecuación 2x² − 7x + 3 = 0?', context: { kind: 'ABSTRACT', description: 'Ecuación dada directamente.' }, declaredModel: { construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING', parameters: { a: 2, r1: 3, r2: 0.5 } }, selected: null, constructed: null, rationale: 'Se factoriza como (2x − 1)(x − 3) = 0; las soluciones son 1/2 y 3.',
    numeric: { numericKey: { kind: 'NUMERIC', value: '3', equivalentFormsAllowed: true }, target: { kind: 'QUANTITY', quantity: 'GREATER_ROOT' }, answerCheck: EXPR('(7 + sqrt(49 - 24)) / 4') } } },
  '16.approach.school.standard': { stimulus: null, item: { ...base, stem: 'Dos municipios publican cuántas toneladas de residuos reciclan. El municipio 1 recicla 120 toneladas con 40 centros de acopio; el municipio 2 recicla 150 toneladas con 60 centros. ¿Qué municipio recicla más toneladas por centro de acopio?', context: { kind: 'SOCIETAL', description: 'Comparación de dos servicios públicos por una tasa.' }, declaredModel: { construct: 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS', parameters: { p1: 40, q1: 120, p2: 60, q2: 150 } }, numeric: null, constructed: null, rationale: '120/40 = 3 y 150/60 = 2,5: el municipio 1 tiene la tasa mayor.',
    credit: [{ code: 'FULL_CREDIT', description: 'Elige el municipio 1.' }, { code: 'NO_CREDIT', description: 'Otra opción.' }],
    selected: { options: [{ id: 'A', text: 'El municipio 1, con 3 toneladas por centro.' }, { id: 'B', text: 'El municipio 2, porque recicla más toneladas en total.' }, { id: 'C', text: 'El municipio 2, con 0,4 centros por tonelada.' }, { id: 'D', text: 'Ninguno: la diferencia es de 30 toneladas.' }], answerKey: 'A', distractors: { B: { misconceptionModelId: 'one-quantity', rationale: 'Compara una sola cantidad.' }, C: { misconceptionModelId: 'inverted-rate', rationale: 'Invierte la tasa.' }, D: { misconceptionModelId: 'difference', rationale: 'Resta en lugar de dividir.' } }, target: { kind: 'VERDICT', verdict: 'OPTION_WITH_HIGHER_UNIT_RATE', value: 'OPTION_1' }, answerCheck: { kind: 'NOT_COMPUTABLE', reason: 'La respuesta es una elección entre dos opciones.' } } } },
};
const raw = (selectionKey: string, mutate?: (r: { stimulus: unknown; item: Record<string, unknown> }) => void): string => { const r = JSON.parse(JSON.stringify(FIX[selectionKey])); mutate?.(r); return JSON.stringify(r); };

async function generate(selectionKey: string, rawText = raw(selectionKey), attempt = 1): Promise<SpecificationUnitResult> {
  const specification = specOf(selectionKey);
  const unit = { unitKey: unitKeyOf(selectionKey, attempt), specification, attempt };
  const common = { unit, constructVocabulary: constructVocabularyOf(constructOf(specification)), policy: policyFor(MODEL, specification.variable.language), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY };
  const hash = renderSpecificationPrompt({ ...common, provider: new RecordedResponseProvider('recorded:fixture', MODEL, {}) }).promptHash;
  return generateFromSpecification({ ...common, provider: new RecordedResponseProvider('recorded:fixture', MODEL, { [hash]: rawText }), runId: 'fixture-run', batchKey: QB_R2D_BATCH_KEY, now: NOW });
}
const refusal = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'NO_ERROR'; } catch (e) { return e instanceof SpecificationGenerationError ? e.code : `OTHER:${(e as Error).message}`; } };
const validated = async (selectionKey: string, mutate?: Parameters<typeof raw>[1]) => { const r = await generate(selectionKey, raw(selectionKey, mutate)); return { r, s: specOf(selectionKey), v: validateSpecificationCandidate({ candidate: r.candidate, specification: specOf(selectionKey), stimulus: r.stimulus, siblings: [r.candidate] }) }; };

describe('the selection: twenty adaptation specifications, each chosen for a constraint', () => {
  it('covers five concepts, five systems, the three response kinds, both IB papers and a stimulus -- all DEV_TEST_CONTENT from draft families', () => {
    expect(SELECTION).toHaveLength(20);
    expect(new Set(SELECTION.map((s) => s.selectionKey)).size).toBe(20);
    expect([...new Set(SELECTION.map((s) => s.specification.primaryConcept.stableId))].sort()).toEqual(['math.alg.quadratics', 'math.fun.linear-functions-lines', 'math.num.ratio-proportion', 'math.prob.probability', 'math.stat.data-representation']);
    expect([...new Set(SELECTION.map((s) => s.specification.systemProfile.profileId))].sort()).toEqual(['CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA', 'SCHOOL_STEM_PERFORMANCE']);
    expect([...new Set(SELECTION.map((s) => s.specification.variable.responseFormat.format))].sort()).toEqual(['EXTENDED_RESPONSE', 'NUMERIC_ENTRY', 'SELECTED_RESPONSE', 'SHORT_RESPONSE']);
    expect(SELECTION.every((s) => s.specification.contentUseClass === 'DEV_TEST_CONTENT' && s.specification.taskFamily.lifecycle === 'DRAFT' && s.tests.length > 20)).toBe(true);
    expect(SELECTION.filter((s) => s.specification.variable.stimulus.mode !== 'NONE').length).toBeGreaterThanOrEqual(3);
    expect(new Set(['IB.MATH_AA_HL.P1', 'IB.MATH_AA_HL.P2'].map((t) => SELECTION.find((s) => s.targetId === t && s.familyId === 'tf.math.linear.constant-rate-model')!.specification.variable.toolPolicy.calculator)).size).toBe(2);
  });
  it('one family reaches all five systems with ONE invariant hash; STANDARD is recorded by absence, STEM_PLUS explicitly', () => {
    const same = SELECTION.filter((s) => s.group === 'SAME_FAMILY_ALL_SYSTEMS');
    expect(new Set(same.map((s) => s.specification.systemProfile.profileId)).size).toBe(5);
    expect(new Set(same.map((s) => s.specification.invariantHash)).size).toBe(1);
    const approach = SELECTION.filter((s) => s.group === 'LEARNING_APPROACH');
    expect(new Set(approach.map((s) => s.specification.invariantHash)).size).toBe(1);
    expect(approach.filter((s) => s.approach === 'STANDARD').every((s) => s.specification.learningApproach === undefined)).toBe(true);
    expect(approach.filter((s) => s.approach === 'STEM_PLUS').every((s) => s.specification.learningApproach?.approachId === 'STEM_PLUS')).toBe(true);
    // official constraints win on PAA and are recorded
    expect(specOf('19.approach.paa.stem-plus').learningApproach!.unmetPreferences.some((u) => u.overriddenBy.authority === 'OFFICIAL')).toBe(true);
  });
});

describe('templates and the strict response schema', () => {
  it('one template per elicitation format; a format without a template is refused by name', () => {
    expect(SPECIFICATION_TEMPLATE_REGISTRY.map((t) => `${t.id}@${t.version}`)).toEqual(['spec-selected-response@1', 'spec-numeric-entry@1', 'spec-constructed-response@1']);
    expect(selectSpecificationTemplate(SPECIFICATION_TEMPLATE_REGISTRY, specOf('02.linear-model.ib-p1')).id).toBe('spec-constructed-response');
    expect(selectSpecificationTemplate(SPECIFICATION_TEMPLATE_REGISTRY, specOf('17.approach.school.stem-plus')).id).toBe('spec-constructed-response');
    expect(selectSpecificationTemplate(SPECIFICATION_TEMPLATE_REGISTRY, specOf('09.quadratic-factorising.paa')).id).toBe('spec-numeric-entry');
    expect(() => selectSpecificationTemplate([], specOf('01.linear-model.paa'))).toThrow(/NO_TEMPLATE_FOR_SPECIFICATION/);
    // a template holds structure only: no number of a subject, no topic, no examination board
    for (const t of SPECIFICATION_TEMPLATE_REGISTRY) expect(t.task, t.id).not.toMatch(/\d{2,}|quadratic|probab|proportion|IB\b|Cambridge|PAA|PISA|Icfes/i);
  });
  it('the response is parsed strictly: not JSON, an unknown member, a missing member and a wrong type are named refusals', () => {
    expect(() => parseSpecificationResponse('not json')).toThrow(/PROVIDER_RESPONSE_NOT_JSON/);
    expect(() => parseSpecificationResponse(raw('01.linear-model.paa', (r) => { r.item.extra = 1; }))).toThrow(/PROVIDER_RESPONSE_SCHEMA_INVALID/);
    expect(() => parseSpecificationResponse(raw('01.linear-model.paa', (r) => { delete r.item.rationale; }))).toThrow(/PROVIDER_RESPONSE_SCHEMA_INVALID/);
    expect(() => parseSpecificationResponse(raw('02.linear-model.ib-p1', (r) => { (r.item.constructed as { totalMarks: number }).totalMarks = 6; }))).toThrow(/PART_MARKS_DO_NOT_SUM_TO_TOTAL/);
    expect(() => parseSpecificationResponse(raw('02.linear-model.ib-p1', (r) => { (r.item.constructed as { parts: Array<{ markScheme: Array<{ marks: number }> }> }).parts[0].markScheme[0].marks = 2; }))).toThrow(/MARK_POINTS_DO_NOT_SUM_TO_PART_MARKS/);
    expect(() => parseSpecificationResponse(raw('02.linear-model.ib-p1', (r) => { (r.item.constructed as { parts: Array<{ label: string }> }).parts[1].label = 'c'; }))).toThrow(/PART_LABELS_NOT_IN_ORDER/);
    expect(malformedCodeOf('{')).toBe('PROVIDER_RESPONSE_NOT_JSON');
    expect(malformedCodeOf(raw('01.linear-model.paa'))).toBeNull();
    expect(MALFORMED_RESPONSE_CODES).toEqual(['PROVIDER_RESPONSE_NOT_JSON', 'PROVIDER_RESPONSE_SCHEMA_INVALID']);
  });
  it('a constructed response: parts in order, marks per part summing to the total, typed mark points summing to the part', () => {
    const ok = ConstructedResponseSchema.safeParse(FIX['02.linear-model.ib-p1'].item.constructed);
    expect(ok.success).toBe(true);
    expect(ok.data!.parts.map((p) => [p.label, p.marks])).toEqual([['a', 2], ['b', 2], ['c', 1]]);
  });
  it('a response that does not fit the specification is refused by name and never repaired', async () => {
    expect(await refusal(generate('01.linear-model.paa', raw('02.linear-model.ib-p1')))).toBe('RESPONSE_MEMBER_IS_NOT_THE_FORMATS');
    expect(await refusal(generate('01.linear-model.paa', raw('01.linear-model.paa', (r) => { (r.item.selected as { options: unknown[] }).options.pop(); })))).toBe('RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE');
    expect(await refusal(generate('01.linear-model.paa', raw('01.linear-model.paa', (r) => { (r.item.selected as { answerKey: string }).answerKey = 'E'; })))).toBe('RESPONSE_KEY_IS_NOT_AN_OPTION');
    expect(await refusal(generate('01.linear-model.paa', raw('01.linear-model.paa', (r) => { delete (r.item.selected as { distractors: Record<string, unknown> }).distractors.D; })))).toBe('RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS');
    expect(await refusal(generate('01.linear-model.paa', raw('01.linear-model.paa', (r) => { r.stimulus = FIX['05.linear-model.pisa'].stimulus; })))).toBe('RESPONSE_UNEXPECTED_STIMULUS');
    expect(await refusal(generate('05.linear-model.pisa', raw('05.linear-model.pisa', (r) => { r.stimulus = null; })))).toBe('RESPONSE_STIMULUS_MISSING');
    expect(await refusal(generate('05.linear-model.pisa', raw('05.linear-model.pisa', (r) => { (r.stimulus as { structured: { tables: Array<{ rows: number[][] }> } }).structured.tables[0].rows[0] = [0]; })))).toBe('RESPONSE_STRUCTURED_STIMULUS_INVALID');
    expect(await refusal(generate('02.linear-model.ib-p1', raw('02.linear-model.ib-p1', (r) => { r.item.stem += ' Show your working.'; })))).toBe('RESPONSE_REPEATS_FIXED_INSTRUCTION');
  });
  it('refuses, by name, an input it must not generate from', async () => {
    const s = specOf('01.linear-model.paa');
    const common = { constructVocabulary: constructVocabularyOf(constructOf(s)), policy: policyFor(MODEL, 'es'), provider: new RecordedResponseProvider('recorded:fixture', MODEL, {}), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY };
    const code = (f: () => unknown) => { try { f(); return 'NO_ERROR'; } catch (e) { return (e as SpecificationGenerationError).code; } };
    expect(code(() => renderSpecificationPrompt({ ...common, unit: { unitKey: 'u', specification: { ...s, invariantHash: 'f'.repeat(64) }, attempt: 1 } }))).toBe('SPECIFICATION_INVALID');
    expect(code(() => renderSpecificationPrompt({ ...common, unit: { unitKey: 'u', specification: s, attempt: 0 } }))).toBe('ATTEMPT_INVALID');
    expect(code(() => renderSpecificationPrompt({ ...common, policy: policyFor(MODEL, 'en'), unit: { unitKey: 'u', specification: s, attempt: 1 } }))).toBe('POLICY_LANGUAGE_IS_NOT_THE_SPECIFICATIONS');
    expect(code(() => renderSpecificationPrompt({ ...common, policy: policyFor('other-model', 'es'), unit: { unitKey: 'u', specification: s, attempt: 1 } }))).toBe('POLICY_MODEL_IS_NOT_THE_PROVIDERS');
    expect(code(() => renderSpecificationPrompt({ ...common, constructVocabulary: null, unit: { unitKey: 'u', specification: s, attempt: 1 } }))).toBe('CONSTRUCT_VOCABULARY_MISSING');
    expect(code(() => renderSpecificationPrompt({ ...common, constructVocabulary: constructVocabularyOf('CLASSICAL_PROBABILITY_SINGLE_DRAW'), unit: { unitKey: 'u', specification: s, attempt: 1 } }))).toBe('CONSTRUCT_VOCABULARY_IS_FOR_ANOTHER_CONSTRUCT');
    expect(await refusal(generate('01.linear-model.paa', 'not json'))).toBe('PROVIDER_RESPONSE_NOT_JSON');
    expect(SPECIFICATION_GENERATION_ERROR_CODES).toContain('SPECIFICATION_IS_NOT_DEV_TEST_CONTENT');
  });
});

describe('specification-driven generation is deterministic and consumes the specification', () => {
  it('the prompt carries the specification -- invariants, every variable dimension, the parameter ranges -- and the construct vocabulary; an attempt is part of the hash', () => {
    const s = specOf('02.linear-model.ib-p1');
    const render = (attempt: number, spec = s) => renderSpecificationPrompt({ unit: { unitKey: 'u', specification: spec, attempt }, constructVocabulary: constructVocabularyOf(constructOf(spec)), policy: policyFor(MODEL, spec.variable.language), provider: new RecordedResponseProvider('r', MODEL, {}), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY });
    const p = render(1);
    expect(p.prompt.instruction.specification.specificationId).toBe(s.specificationId);
    expect(p.prompt.instruction.specification.invariants).toEqual(s.invariants);
    expect(p.prompt.instruction.specification.variable).toEqual(s.variable);
    expect(p.prompt.instruction.specification.parameterization).toEqual(s.parameterization);
    expect(p.prompt.instruction.specification.variable.commandTerm).toBe('find');
    expect(p.prompt.instruction.constructVocabulary.quantities.map((q) => q.code)).toContain('VALUE_AT_X');
    expect(render(1).promptHash).toBe(p.promptHash);
    expect(render(2).promptHash).not.toBe(p.promptHash);
    expect(render(1, specOf('03.linear-model.ib-p2')).promptHash).not.toBe(p.promptHash);
    // STANDARD is absent from the prompt as it is from the specification; STEM_PLUS is present with what was honoured and unmet
    expect('learningApproach' in render(1, specOf('18.approach.paa.standard')).prompt.instruction.specification).toBe(false);
    expect(render(1, specOf('19.approach.paa.stem-plus')).prompt.instruction.specification.learningApproach!.unmetPreferences.length).toBeGreaterThan(0);
  });
  it('the same inputs and the same recorded answer give the same candidate, byte for byte, with complete lineage', async () => {
    const a = await generate('02.linear-model.ib-p1');
    const b = await generate('02.linear-model.ib-p1');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = a.candidate;
    const s = specOf('02.linear-model.ib-p1');
    expect(SpecificationCandidateSchema.safeParse(c).success).toBe(true);
    expect([c.responseFormat, c.marks, c.contentUseClass, c.provenance, c.instruction]).toEqual(['SHORT_RESPONSE', 5, 'DEV_TEST_CONTENT', 'STUDYUS_GENERATED', 'Show your working.']);
    expect(c.lineage.taskFamily).toEqual({ id: s.taskFamily.familyId, version: s.taskFamily.version });
    expect(c.lineage.componentProfile).toEqual({ id: 'IB.MATH_AA_HL.P1', version: s.componentProfile!.version, versionBinding: s.componentProfile!.versionBinding });
    expect(c.lineage.componentProfile!.versionBinding!.targetType).toBe('EXAM_VERSION');
    expect(c.lineage.adaptationSpecification).toEqual({ id: s.specificationId, invariantHash: s.invariantHash });
    expect(c.lineage.learningApproach).toEqual({ recordedAs: 'STANDARD_BY_ABSENCE' });
    expect(c.lineage.generationRequest.promptHash).toBe(a.promptHash);
    expect(c.lineage.generationRequest.template).toEqual({ id: 'spec-constructed-response', version: '1' });
    expect(c.lineage.generationRun).toEqual({ runId: 'fixture-run', provider: 'recorded:fixture', model: MODEL, generatedAt: NOW });
    expect(validateSpecificationLineage(c, s).outcome).toBe('PASS');
    // the Cambridge system profile carries a binding of its own (a syllabus version)
    expect(specOf('04.linear-model.cambridge-p1').componentProfile!.versionBinding!.targetType).toBe('SYLLABUS_VERSION');
  });
  it('a stimulus is data first: its text parts and rendered assets are derived from the structured data', async () => {
    const r = await generate('05.linear-model.pisa');
    expect(r.stimulus!.kind).toBe('TABLE');
    expect(r.stimulus!.parts.map((p) => p.partKind)).toEqual(['TABLE']);
    expect(r.candidate.stimulusKey).toBe(r.stimulus!.stimulusKey);
    expect(validateSpecificationStimulus(r.candidate, specOf('05.linear-model.pisa'), r.stimulus).outcome).toBe('PASS');
  });
  it('a batch holds the candidates and the refusals of one run, and nothing of another', async () => {
    const a = await generate('01.linear-model.paa');
    const batch = assembleSpecificationBatch({ batchKey: QB_R2D_BATCH_KEY, now: NOW, runId: 'fixture-run', provider: { id: 'recorded:fixture', model: MODEL }, generationPolicy: { id: 'p', version: '1' }, results: [a], failures: [{ unitKey: 'x#a1', specificationId: 'a'.repeat(64), attempt: 1, promptHash: 'b'.repeat(64), code: 'RESPONSE_STIMULUS_MISSING', detail: '' }] });
    expect([batch.label, batch.candidates.length, batch.failures.length]).toEqual(['EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT', 1, 1]);
    expect(() => assembleSpecificationBatch({ batchKey: QB_R2D_BATCH_KEY, now: NOW, runId: 'another-run', provider: { id: 'recorded:fixture', model: MODEL }, generationPolicy: { id: 'p', version: '1' }, results: [a], failures: [] })).toThrow(/BATCH_INPUT_INVALID/);
  });
});

describe('the independent validators', () => {
  it('the construct vocabulary covers every construct of the ten draft families, and each quantity is recomputed here', () => {
    expect(MATH_CONSTRUCT_VOCABULARY.map((v) => v.construct).sort()).toEqual(MATH_POC_FAMILIES.map((f) => f.specialization.mathematicalStructure.construct).sort());
    expect(deriveConstruct('DIRECT_PROPORTION_MISSING_VALUE', { a: 4, b: 6, c: 10 }, null).quantities.MISSING_VALUE).toBe(15);
    expect(deriveConstruct('UNIT_RATE_COMPARISON_OF_TWO_OPTIONS', { p1: 40, q1: 120, p2: 60, q2: 150 }, null).verdicts).toEqual({ OPTION_WITH_HIGHER_UNIT_RATE: 'OPTION_1', OPTION_WITH_LOWER_UNIT_RATE: 'OPTION_2' });
    expect(deriveConstruct('LINE_THROUGH_TWO_POINTS', { x1: 1, y1: 2, x2: 3, y2: 8 }, null).quantities).toMatchObject({ SLOPE: 3, Y_INTERCEPT: -1 });
    expect(deriveConstruct('QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING', { a: 2, r1: 3, r2: 0.5 }, null).quantities).toMatchObject({ GREATER_ROOT: 3, COEFFICIENT_B: -7, COEFFICIENT_C: 3 });
    expect(deriveConstruct('QUADRATIC_MODEL_VERTEX_OPTIMUM', { p: 20, q: 1, r: 100, s: 2 }, null).quantities).toMatchObject({ MEASURE_AT_OPTIMUM: 15, OPTIMAL_VALUE: 2450 });
    expect(deriveConstruct('CLASSICAL_PROBABILITY_SINGLE_DRAW', { n: 20, k: 5 }, null).quantities.PROBABILITY).toBe(0.25);
    expect(deriveConstruct('COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES', { n1: 20, k1: 5, n2: 50, k2: 10 }, null).verdicts.OPTION_WITH_HIGHER_PROBABILITY).toBe('OPTION_1');
    expect(deriveConstruct('COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES', { n1: 20, k1: 5, n2: 20, k2: 5 }, null).parameterIssues).toEqual(['N1_EQUALS_N2', 'PROBABILITIES_DIFFER_BY_LESS_THAN_0_02']);
    expect(deriveConstruct('RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES', { vi: 200, vj: 250 }, { v: 1, tables: [], dataSets: [{ dataSetKey: 'd', title: 't', categories: null, series: [{ seriesKey: 's', label: 'l', unit: null, values: [200, 250, 300, 250] }] }], charts: [], figures: [] }).quantities).toMatchObject({ RELATIVE_CHANGE_PERCENT: 25, SHARE_PERCENT: 20 });
    expect(deriveConstruct('NOT_A_CONSTRUCT', {}, null).parameterIssues).toEqual(['CONSTRUCT_NOT_IN_VOCABULARY']);
  });
  it('reads numbers and an equation from the item\'s own text', () => {
    expect(numbersInText('cobra 20 dólares y 15 por mes; x2 y P1 no son números; 3/4')).toEqual(expect.arrayContaining([20, 15, 0.75, 3, 4]));
    expect(numbersInText('x2 y P1')).toEqual([]);
    expect(parseQuadraticFromText('la ecuación 2x² − 7x + 3 = 0')).toEqual({ A: 2, B: -7, C: 3 });
    expect(parseQuadraticFromText('Solve $x^{2} - 5x + 6 = 0$.')).toEqual({ A: 1, B: -5, C: 6 });
    expect(parseQuadraticFromText('Solve x^2 = 5x - 6')).toBeNull();
    expect([detectLanguage('¿Cuál es la mayor de las soluciones de la ecuación?'), detectLanguage('Find the volume of water in the tank.'), detectLanguage('2x + 3')]).toEqual(['es', 'en', 'UNKNOWN']);
  });
  it('a well-made item passes every check, and its keyed answers are classified without counting human review as verified', async () => {
    const mc = await validated('01.linear-model.paa');
    expect([mc.v.structural.outcome, mc.v.profileCompliance.outcome, mc.v.constructPreservation.outcome, mc.v.answerKey.outcome, mc.v.machineRecomputation.outcome, mc.v.stimulusIntegrity.outcome, mc.v.originality.outcome, mc.v.lineage.outcome, mc.v.automatedStatus]).toEqual(['PASS', 'PASS', 'WEAK', 'MACHINE_VERIFIED', 'PASS', 'NOT_APPLICABLE', 'PASS_LOW_SIMILARITY', 'PASS', 'AUTOMATED_CHECKS_PASSED_HUMAN_REVIEW_REQUIRED']);
    // WEAK, and only WEAK: the family's evidence target includes INTERPRET and this closed item asks for a value. The heuristic says so; it does not fail the item.
    expect(mc.v.constructPreservation.notes).toEqual(['HEURISTIC INTERPRET: no cue in the prompts and no keyed verdict']);
    expect(mc.v.constructPreservation.issues).toEqual([]);
    expect([mc.v.kind, mc.v.isHumanReview, mc.v.reviewStatus]).toEqual(['AUTOMATED_VALIDATION', false, 'BLOCKED_NO_QUALIFIED_REVIEWER']);
    const cr = await validated('02.linear-model.ib-p1');
    expect(cr.v.answerKey.units.map((u) => [u.label, u.class, u.basis])).toEqual([['a', 'DETERMINISTIC_RULE_VERIFIED', 'KEYED_TEXT_STRUCTURE'], ['b', 'MACHINE_VERIFIED', 'DECLARED_PARAMETERS_READABLE_IN_ITEM'], ['c', 'HUMAN_REVIEW_REQUIRED', 'NONE']]);
    // the item's class is its weakest answer: a constructed response with an unverifiable part is NOT verified
    expect([cr.v.answerKey.outcome, cr.v.machineRecomputation.outcome, cr.v.profileCompliance.outcome, cr.v.automatedStatus]).toEqual(['HUMAN_REVIEW_REQUIRED', 'PASS', 'PASS', 'AUTOMATED_CHECKS_PASSED_HUMAN_REVIEW_REQUIRED']);
    expect(itemAnswerClass(cr.v.answerKey.units)).toBe('HUMAN_REVIEW_REQUIRED');
    const ne = await validated('09.quadratic-factorising.paa');
    expect(ne.v.answerKey.units[0]).toMatchObject({ class: 'MACHINE_VERIFIED', basis: 'ITEM_TEXT_EQUATION', recomputed: 3 });
    expect(ne.v.constructPreservation.deterministic.join(' ')).toMatch(/equation read from the stem \(2, -7, 3\)/);
    const st = await validated('05.linear-model.pisa');
    expect([st.v.profileCompliance.outcome, st.v.stimulusIntegrity.outcome, st.v.answerKey.outcome, st.v.constructPreservation.issues.length]).toEqual(['PASS', 'PASS', 'MACHINE_VERIFIED', 0]);
    // a fully PASS construct reading: a SOLVE family with a keyed quantity read from the stem's own equation
    expect(ne.v.constructPreservation.outcome).toBe('PASS');
  });
  it('ANSWER: a wrong key, a second correct option, arithmetic that does not give the key and a wrong verdict all FAIL', async () => {
    const wrongKey = await validated('01.linear-model.paa', (r) => { const s = r.item.selected as { answerKey: string; distractors: Record<string, unknown> }; s.distractors.A = s.distractors.B; delete s.distractors.B; s.answerKey = 'B'; });
    expect([wrongKey.v.answerKey.outcome, wrongKey.v.machineRecomputation.outcome, wrongKey.v.automatedStatus]).toEqual(['FAILED', 'FAIL', 'AUTOMATED_CHECKS_FAILED']);
    expect(wrongKey.v.answerKey.issues.join(' ')).toMatch(/KEY_IS_NOT_THE_RECOMPUTED_VALUE:135\/110/);
    const twin = await validated('01.linear-model.paa', (r) => { (r.item.selected as { options: Array<{ text: string }> }).options[2].text = '110'; });
    expect(twin.v.answerKey.issues.join(' ')).toMatch(/ANOTHER_OPTION_ALSO_STATES_THE_RECOMPUTED_VALUE/);
    const arithmetic = await validated('09.quadratic-factorising.paa', (r) => { (r.item.numeric as { answerCheck: { expression: string } }).answerCheck.expression = '7 / 2'; });
    expect(arithmetic.v.answerKey.issues.join(' ')).toMatch(/DECLARED_ARITHMETIC_DOES_NOT_GIVE_THE_KEY/);
    const notARoot = await validated('09.quadratic-factorising.paa', (r) => { const n = r.item.numeric as { numericKey: { value: string }; answerCheck: { expression: string } }; n.numericKey.value = '6'; n.answerCheck.expression = '6'; });
    expect(notARoot.v.answerKey.issues.join(' ')).toMatch(/KEY_IS_NOT_THE_RECOMPUTED_VALUE:6\/3/);
    const verdict = await validated('16.approach.school.standard', (r) => { (r.item.selected as { target: { value: string } }).target.value = 'OPTION_2'; });
    expect(verdict.v.answerKey.issues.join(' ')).toMatch(/DECLARED_VERDICT_IS_NOT_THE_RECOMPUTED_ONE:OPTION_2\/OPTION_1/);
    // a correct verdict is a deterministic rule, not a machine verification of the key's wording
    expect((await validated('16.approach.school.standard')).v.answerKey.outcome).toBe('DETERMINISTIC_RULE_VERIFIED');
    // a quantity that is not of the construct, and a quantity target without a number
    const foreign = await validated('01.linear-model.paa', (r) => { (r.item.selected as { target: unknown }).target = { kind: 'QUANTITY', quantity: 'PROBABILITY' }; });
    expect([foreign.v.answerKey.outcome, foreign.v.constructPreservation.outcome]).toEqual(['FAILED', 'FAIL']);
  });
  it('ANSWER: parameters that are not readable in the item downgrade a matching key from machine-verified, and a comparison is checked on stimulus numbers only', async () => {
    const hidden = await validated('01.linear-model.paa', (r) => { r.item.stem = 'Un gimnasio cobra una inscripción y un pago por cada mes de uso. ¿Cuánto paga en total una persona que usa el gimnasio durante varios meses?'; });
    expect(hidden.v.answerKey.units[0]).toMatchObject({ class: 'DETERMINISTIC_RULE_VERIFIED', basis: 'DECLARED_PARAMETERS_NOT_READABLE_IN_ITEM' });
    expect(hidden.v.constructPreservation.outcome).toBe('WEAK');
    const r = await generate('05.linear-model.pisa');
    const withTarget = (target: unknown): SpecificationCandidate => ({ ...r.candidate, content: { ...r.candidate.content, selected: { ...r.candidate.content.selected!, target: target as never } } });
    const s = specOf('05.linear-model.pisa');
    expect(classifyAnswers(withTarget({ kind: 'COMPARISON', left: '11 - 9', operator: '=', right: '9 - 7', holds: true, verdict: 'SUPPORTED' }), s, r.stimulus)[0].class).toBe('DETERMINISTIC_RULE_VERIFIED');
    expect(classifyAnswers(withTarget({ kind: 'COMPARISON', left: '11 - 9', operator: '>', right: '9 - 7', holds: true, verdict: null }), s, r.stimulus)[0].issues.join(' ')).toMatch(/COMPARISON_DOES_NOT_GIVE_WHAT_THE_ITEM_SAYS/);
    expect(classifyAnswers(withTarget({ kind: 'COMPARISON', left: '40', operator: '>', right: '9', holds: true, verdict: null }), s, r.stimulus)[0].issues.join(' ')).toMatch(/COMPARISON_USES_NUMBERS_THAT_ARE_NOT_IN_THE_STIMULUS:40/);
    expect(classifyAnswers(withTarget({ kind: 'COMPARISON', left: '11', operator: '>', right: '9', holds: true, verdict: 'CONTRADICTED' }), s, r.stimulus)[0].issues.join(' ')).toMatch(/VERDICT_DISAGREES_WITH_THE_COMPARISON/);
    expect(validateMachineRecomputation(classifyAnswers(withTarget({ kind: 'NOT_MACHINE_CHECKABLE', reason: 'no rule decides this answer' }), s, r.stimulus)).outcome).toBe('NOT_APPLICABLE');
    expect(validateAnswerKey(classifyAnswers(withTarget({ kind: 'NOT_MACHINE_CHECKABLE', reason: 'no rule decides this answer' }), s, r.stimulus)).outcome).toBe('DETERMINISTIC_RULE_VERIFIED');
  });
  it('PROFILE COMPLIANCE: format, marks, rubric, command term, calculator rule, context, language, distractor models and parameter ranges', async () => {
    const issuesOf = async (key: string, mutate: Parameters<typeof raw>[1]) => (await validated(key, mutate)).v.profileCompliance.issues.join(' | ');
    expect(await issuesOf('02.linear-model.ib-p1', (r) => { const c = r.item.constructed as { parts: Array<{ prompt: string }> }; c.parts[0].prompt = 'Write an expression for V in terms of t.'; c.parts[1].prompt = 'Determine the volume of water in the tank after 12 minutes.'; })).toMatch(/COMMAND_TERM_ABSENT:find/);
    expect(await issuesOf('02.linear-model.ib-p1', (r) => { for (const p of (r.item.constructed as { parts: Array<{ markScheme: Array<{ kind: string }> }> }).parts) for (const m of p.markScheme) if (m.kind === 'ACCURACY') m.kind = 'METHOD'; })).toMatch(/RUBRIC_HAS_NO_ACCURACY_POINT/);
    expect(await issuesOf('02.linear-model.ib-p1', (r) => { r.item.credit = [{ code: 'FULL_CREDIT', description: 'x' }, { code: 'NO_CREDIT', description: 'y' }]; })).toMatch(/CODED_CREDIT_LEVELS_NOT_ASKED_FOR/);
    expect(await issuesOf('05.linear-model.pisa', (r) => { r.item.credit = null; })).toMatch(/CODED_CREDIT_LEVELS_MISSING/);
    // the no-calculator rule, as stated: a decimal of three places and a number above ten thousand
    expect(NO_CALCULATOR_NUMBER_RULE.rule).toMatch(/at most two places/);
    expect(await issuesOf('01.linear-model.paa', (r) => { r.item.stem = (r.item.stem as string).replace('15 dólares', '15,125 dólares'); })).toMatch(/NO_CALCULATOR_RULE_STATED_NUMBER:15.125/);
    expect(await issuesOf('01.linear-model.paa', (r) => { r.item.stem = (r.item.stem as string).replace('6 meses', '60000 meses'); })).toMatch(/NO_CALCULATOR_RULE_STATED_NUMBER/);
    expect((await validated('02.linear-model.ib-p1')).v.profileCompliance.notes.join(' ')).toMatch(/studyus-no-calculator-number-rule@2 applied/);
    expect(await issuesOf('01.linear-model.paa', (r) => { (r.item.context as { kind: string }).kind = 'ABSTRACT'; })).toMatch(/DECLARED_CONTEXT_IS_NOT_THE_SPECIFICATIONS:ABSTRACT\/PERSONAL/);
    expect(await issuesOf('01.linear-model.paa', (r) => { r.item.stem = 'A gym charges a joining fee of 20 dollars and then 15 dollars for each month of use. How much does a person pay in total for 6 months?'; })).toMatch(/LANGUAGE_HEURISTIC_READS_ANOTHER_LANGUAGE:en/);
    expect(await issuesOf('01.linear-model.paa', (r) => { (r.item.selected as { distractors: Record<string, { misconceptionModelId: string }> }).distractors.B.misconceptionModelId = 'invented-model'; })).toMatch(/DISTRACTOR_NOT_FROM_A_SPECIFIED_MISCONCEPTION_MODEL:B=invented-model/);
    expect(await issuesOf('01.linear-model.paa', (r) => { (r.item.declaredModel as { parameters: Record<string, number> }).parameters.m = 75; })).toMatch(/PARAMETER_OUT_OF_RANGE:m=75/);
    expect(await issuesOf('09.quadratic-factorising.paa', (r) => { (r.item.declaredModel as { parameters: Record<string, number> }).parameters.r2 = 0.25; })).toMatch(/PARAMETER_OFF_STEP:r2=0.25/);
    expect(await issuesOf('01.linear-model.paa', (r) => { delete (r.item.declaredModel as { parameters: Record<string, number> }).parameters.x; })).toMatch(/PARAMETER_MISSING:x/);
    expect(await issuesOf('01.linear-model.paa', (r) => { (r.item.declaredModel as { parameters: Record<string, number> }).parameters.z = 1; })).toMatch(/PARAMETER_NOT_OF_THE_CONSTRUCT:z/);
  });
  it('PROFILE COMPLIANCE: a mark structure a closed format cannot realise is reported as a property of the SPECIFICATION', async () => {
    const school = await validated('16.approach.school.standard');
    expect(school.v.profileCompliance.specificationLevelIssues).toEqual(['MARK_STRUCTURE_MULTI_MARK_PARTS_NOT_REALISABLE_BY_A_CLOSED_FORMAT']);
    expect(school.v.profileCompliance.issues).toEqual(['SPECIFICATION_LEVEL:MARK_STRUCTURE_MULTI_MARK_PARTS_NOT_REALISABLE_BY_A_CLOSED_FORMAT']);
    expect(school.v.profileCompliance.outcome).toBe('FAIL');
  });
  it('CONSTRUCT PRESERVATION: another construct, an equation without the declared roots and a table off the declared line FAIL; a missing cue is only WEAK', async () => {
    const other = await validated('01.linear-model.paa', (r) => { (r.item.declaredModel as { construct: string }).construct = 'DIRECT_PROPORTION_MISSING_VALUE'; });
    expect(other.v.constructPreservation.issues.join(' ')).toMatch(/DECLARED_CONSTRUCT_IS_NOT_THE_FAMILYS/);
    const roots = await validated('09.quadratic-factorising.paa', (r) => { r.item.stem = '¿Cuál es la mayor de las soluciones de la ecuación 2x² − 7x + 5 = 0?'; });
    expect([roots.v.constructPreservation.outcome, roots.v.answerKey.units[0].basis]).toEqual(['FAIL', 'DECLARED_PARAMETERS_NOT_READABLE_IN_ITEM']);
    expect(roots.v.constructPreservation.issues.join(' ')).toMatch(/STATED_EQUATION_DOES_NOT_HAVE_THE_DECLARED_ROOTS:2,-7,5/);
    const table = await validated('05.linear-model.pisa', (r) => { (r.stimulus as { structured: { tables: Array<{ rows: number[][] }> } }).structured.tables[0].rows[3] = [3, 12]; (r.item as { usesStimulusValues: number[] }).usesStimulusValues = [5, 7, 9, 12]; });
    expect(table.v.constructPreservation.issues.join(' ')).toMatch(/STIMULUS_TABLE_IS_NOT_THE_DECLARED_LINE:taxi:1 of 4 rows/);
    // the family's evidence target is FORMULATE + INTERPRET: an item that asks only for a value keeps the construct but loses a cue
    const noInterpret = await validated('02.linear-model.ib-p1', (r) => { const c = r.item.constructed as { parts: unknown[]; totalMarks: number }; c.parts.pop(); c.totalMarks = 4; });
    expect(noInterpret.v.constructPreservation.outcome).toBe('WEAK');
    expect(noInterpret.v.constructPreservation.notes.join(' ')).toMatch(/HEURISTIC INTERPRET/);
    expect((await validated('02.linear-model.ib-p1')).v.constructPreservation.heuristic.join(' ')).toMatch(/studyus-evidence-action-cue-heuristic@2/);
  });
  it('STRUCTURE, STIMULUS, ORIGINALITY and LINEAGE each fail on their own defect', async () => {
    const a = await generate('01.linear-model.paa');
    expect(validateStructure({ ...a.candidate, marks: 2 }, null).issues).toEqual(expect.arrayContaining(['CLOSED_ITEM_MARKS_NOT_ONE']));
    const dup = await validated('01.linear-model.paa', (r) => { const o = (r.item.selected as { options: Array<{ text: string }> }).options; o[3].text = o[2].text; });
    expect(dup.v.structural.issues).toContain('OPTION_TEXTS_NOT_DISTINCT');
    const st = await generate('05.linear-model.pisa');
    const s5 = specOf('05.linear-model.pisa');
    expect(validateSpecificationStimulus({ ...st.candidate, content: { ...st.candidate.content, usesStimulusValues: [5, 99] } }, s5, st.stimulus).issues).toEqual(['USED_VALUE_NOT_IN_STIMULUS:99']);
    expect(validateSpecificationStimulus({ ...st.candidate, content: { ...st.candidate.content, usesStimulusValues: null } }, s5, st.stimulus).issues).toEqual(['ITEM_DOES_NOT_SAY_WHICH_STIMULUS_VALUES_IT_USES']);
    expect(validateSpecificationStimulus(st.candidate, s5, { ...st.stimulus!, renderedAssets: [{ assetKey: 'x', assetKind: 'CHART', renderer: { id: 'r', version: '1' }, svg: '<svg>tampered tampered</svg>', altText: 'tampered text' }] }).issues).toContain('RENDERED_ASSETS_ARE_NOT_WHAT_THE_DATA_RENDERS_TO');
    expect(validateSpecificationStimulus(st.candidate, s5, null).outcome).toBe('FAIL');
    const copy: SpecificationCandidate = { ...a.candidate, candidateKey: 'cand|copy', unitKey: 'copy', specificationId: 'c'.repeat(64) };
    // an earlier attempt at the SAME specification is not a sibling: a regeneration replaces its predecessor
    expect(validateSpecificationOriginality(a.candidate, [a.candidate, { ...a.candidate, candidateKey: 'cand|earlier', unitKey: 'earlier' }]).outcome).toBe('PASS_LOW_SIMILARITY');
    expect(validateSpecificationOriginality(a.candidate, [a.candidate, copy]).outcome).toBe('REJECT_TEXTUAL_SIMILARITY');
    expect(validateSpecificationOriginality(a.candidate, [a.candidate], [{ source: 'GENERATION_BATCH_SIBLING', key: 'pilot:x', comparisonPermitted: true, text: a.candidate.content.stem }]).outcome).not.toBe('PASS_LOW_SIMILARITY');
    expect(validateSpecificationLineage(a.candidate, specOf('06.linear-model.icfes')).issues).toEqual(expect.arrayContaining(['LINEAGE_DISAGREES_WITH_SPECIFICATION:SYSTEM_PROFILE', 'LINEAGE_DISAGREES_WITH_SPECIFICATION:ADAPTATION_SPECIFICATION']));
    expect(validateSpecificationLineage({ ...a.candidate, lineage: { ...a.candidate.lineage, learningApproach: { recordedAs: 'EXPLICIT', id: 'STEM_PLUS', version: '1' } } }, specOf('01.linear-model.paa')).issues).toEqual(['LINEAGE_DISAGREES_WITH_SPECIFICATION:LEARNING_APPROACH']);
    expect(validateProfileCompliance(a.candidate, specOf('01.linear-model.paa'), null).outcome).toBe('PASS');
    expect(validateConstructPreservation(a.candidate, specOf('01.linear-model.paa'), null).issues).toEqual([]);
  });
});

describe('validators, revision 2: what the first replay of the live recording corrected and added', () => {
  it('is revision 2, and a written fraction is read as the integers it is written with (version 1 failed 12 / 84 and 1/3 for their decimal expansion)', async () => {
    expect([SPECIFICATION_VALIDATORS_REVISION, NO_CALCULATOR_NUMBER_RULE.version]).toEqual([2, '2']);
    expect(numbersInText('12 / 84 = 18 / x', 'PARTS_ONLY')).toEqual([12, 84, 18]);
    expect(numbersInText('1/3', 'VALUE_AND_PARTS')).toEqual(expect.arrayContaining([1, 3]));
    expect(numbersInText('1/3', 'PARTS_ONLY')).toEqual([1, 3]);
    const fractions = await validated('01.linear-model.paa', (r) => { r.item.stem = (r.item.stem as string).replace('durante 6 meses', 'durante 6 meses, es decir, 6/12 de un año'); });
    expect(fractions.v.profileCompliance.issues.filter((i) => i.startsWith('NO_CALCULATOR'))).toEqual([]);
    // the rule itself is unchanged: a decimal of three places still fails
    expect((await validated('01.linear-model.paa', (r) => { r.item.stem = (r.item.stem as string).replace('15 dólares', '15,125 dólares'); })).v.profileCompliance.issues.join(' ')).toMatch(/NO_CALCULATOR_RULE_STATED_NUMBER/);
  });
  it('STRUCTURAL holds the response contract: equal options, the fixed instruction in any case, specification vocabulary, a quantity without a key, an expression that does not evaluate', async () => {
    const structural = async (key: string, mutate: Parameters<typeof raw>[1]) => (await validated(key, mutate)).v.structural.issues;
    expect(await structural('01.linear-model.paa', (r) => { const o = (r.item.selected as { options: Array<{ text: string }> }).options; o[1].text = '270/2'; o[2].text = '135'; })).toEqual(['OPTIONS_STATE_THE_SAME_NUMBER:B,C']);
    // the harness refuses the exact sentence; the validator also finds it in another case and without its full stop
    expect(await structural('02.linear-model.ib-p1', (r) => { r.item.stem += ' Find the model and show your working'; })).toEqual(['ITEM_REPEATS_FIXED_INSTRUCTION']);
    expect(await structural('02.linear-model.ib-p1', (r) => { (r.item.constructed as { parts: Array<{ prompt: string }> }).parts[1].prompt = 'SOLVE: find the volume of water in the tank after 12 minutes.'; })).toEqual(['SPECIFICATION_VOCABULARY_IN_ITEM_TEXT:SOLVE']);
    expect(await structural('16.approach.school.standard', (r) => { r.item.stem = (r.item.stem as string).replace('El municipio 1 recicla 120 toneladas', 'El municipio 1 (q1 = 120) recicla 120 toneladas'); })).toEqual(['SPECIFICATION_VOCABULARY_IN_ITEM_TEXT:q1']);
    // a mark scheme and a rationale are not what a learner reads: codes there are not a leak
    expect(await structural('02.linear-model.ib-p1', (r) => { (r.item.constructed as { parts: Array<{ markScheme: Array<{ criterion: string }> }> }).parts[1].markScheme[0].criterion = 'SOLVE step: substitutes t = 12.'; })).toEqual([]);
    expect(await structural('02.linear-model.ib-p1', (r) => { (r.item.constructed as { parts: Array<{ numericKey: unknown }> }).parts[1].numericKey = null; })).toEqual(['PART_WITH_A_QUANTITY_TARGET_HAS_NO_NUMERIC_KEY:b']);
    expect(await structural('16.approach.school.standard', (r) => { (r.item.selected as { answerCheck: unknown }).answerCheck = { kind: 'ARITHMETIC_EXPRESSION', expression: '120/40 > 150/60' }; })).toEqual(['ANSWER_CHECK_EXPRESSION_DOES_NOT_EVALUATE:item']);
    // a note, never a failure: a key that is visibly unlike the other options
    expect((await validated('16.approach.school.standard')).v.structural.notes.join(' ')).toMatch(/studyus-key-stands-out-heuristic@1: KEY_DOES_NOT_STAND_OUT/);
    expect((await validated('16.approach.school.standard', (r) => { const o = (r.item.selected as { options: Array<{ text: string }> }).options; o[0].text = 'El municipio 1, porque 120/40 = 3 toneladas por centro y 150/60 = 2,5 toneladas por centro, de modo que su tasa es mayor.'; o[2].text = 'El municipio 2.'; })).v.structural.notes.join(' ')).toMatch(/: KEY_STANDS_OUT/);
  });
  it('CONTRACT and CORRECTNESS are separate: a quantity without a key fails STRUCTURAL, while the answer is classified from what the text states', async () => {
    const noKey = await validated('02.linear-model.ib-p1', (r) => { (r.item.constructed as { parts: Array<{ numericKey: unknown }> }).parts[1].numericKey = null; });
    expect(noKey.v.answerKey.units[1]).toMatchObject({ class: 'DETERMINISTIC_RULE_VERIFIED', failureKind: null, recomputed: 76 });
    expect([noKey.v.structural.outcome, noKey.v.automatedStatus]).toEqual(['FAIL', 'AUTOMATED_CHECKS_FAILED']);
    // ... and when the text states another number, the key is CONTRADICTED
    const wrong = await validated('02.linear-model.ib-p1', (r) => { const p = (r.item.constructed as { parts: Array<{ numericKey: unknown; finalAnswer: string; answerCheck: unknown }> }).parts[1]; p.numericKey = null; p.finalAnswer = '67 litres'; p.answerCheck = { kind: 'NOT_COMPUTABLE', reason: 'no arithmetic is declared here' }; });
    expect(wrong.v.answerKey.units[1]).toMatchObject({ class: 'FAILED', failureKind: 'KEY_CONTRADICTED' });
    expect(wrong.v.answerKey.units[1].issues).toEqual(['FINAL_ANSWER_DOES_NOT_STATE_THE_RECOMPUTED_VALUE:76']);
    // a sentence carries its sign in words: "decreases by 3.5" states a rate of -3.5
    const sign = await validated('02.linear-model.ib-p1', (r) => { r.item.stem = 'A tank contains 40 litres of water. Water drains from the tank at a constant rate, so that the volume decreases by 3 litres per minute. Let V be the volume of water, in litres, t minutes after the drain opens.'; (r.item.declaredModel as { parameters: Record<string, number> }).parameters = { b: 40, m: -3, x: 12 }; const parts = (r.item.constructed as { parts: Array<Record<string, unknown>> }).parts; parts[0].finalAnswer = 'V = 40 - 3t'; parts[1].finalAnswer = '4 litres'; parts[1].numericKey = { kind: 'NUMERIC', value: '4', equivalentFormsAllowed: true }; parts[1].answerCheck = { kind: 'ARITHMETIC_EXPRESSION', expression: '40 - 3 * 12' }; parts[2].target = { kind: 'QUANTITY', quantity: 'RATE' }; parts[2].finalAnswer = 'The volume decreases by 3 litres each minute.'; });
    expect(sign.v.answerKey.units.map((u) => [u.label, u.class, u.failureKind])).toEqual([['a', 'DETERMINISTIC_RULE_VERIFIED', null], ['b', 'MACHINE_VERIFIED', null], ['c', 'DETERMINISTIC_RULE_VERIFIED', null]]);
    // failure kinds: a wrong key is contradicted; a quantity that is not of the construct is an unusable declaration
    expect((await validated('01.linear-model.paa', (r) => { const s = r.item.selected as { answerKey: string; distractors: Record<string, unknown> }; s.distractors.A = s.distractors.B; delete s.distractors.B; s.answerKey = 'B'; })).v.answerKey.units[0].failureKind).toBe('KEY_CONTRADICTED');
    expect((await validated('01.linear-model.paa', (r) => { (r.item.selected as { target: unknown }).target = { kind: 'QUANTITY', quantity: 'PROBABILITY' }; })).v.answerKey.units[0].failureKind).toBe('DECLARATION_UNUSABLE');
  });
  it('reads a keyed equation and keyed roots: the right structure is a deterministic rule, the wrong one contradicts the key', async () => {
    expect(parseLinearFromText('y = 8x + 120; 8 representa el costo adicional')).toEqual({ m: 8, b: 120 });
    expect(parseLinearFromText('V = 40 + 3t')).toEqual({ m: 3, b: 40 });
    expect(parseLinearFromText('y = 120 - 8x')).toEqual({ m: -8, b: 120 });
    expect(parseLinearFromText('y = -3.5x + 240')).toEqual({ m: -3.5, b: 240 });
    expect(parseLinearFromText('y = 1,8x + 4,5')).toEqual({ m: 1.8, b: 4.5 });
    expect(parseLinearFromText('y = 8x; no hay costo fijo')).toEqual({ m: 8, b: 0 });
    expect(parseLinearFromText('El costo es de 110 dólares')).toBeNull();
    expect(rootsStatedInText('x = 3 or x = -0.5')).toEqual([3, -0.5]);
    expect(rootsStatedInText('(2x + 1)(x - 3) = 0')).toEqual([-0.5, 3]);
    expect(rootsStatedInText('2(x - 3)(x + 1) = 0')).toEqual([3, -1]);
    const wrongLine = await validated('02.linear-model.ib-p1', (r) => { (r.item.constructed as { parts: Array<{ finalAnswer: string }> }).parts[0].finalAnswer = 'V = 3 + 40t'; });
    expect(wrongLine.v.answerKey.units[0]).toMatchObject({ class: 'FAILED', failureKind: 'KEY_CONTRADICTED' });
    expect(wrongLine.v.answerKey.units[0].issues[0]).toMatch(/KEYED_EQUATION_IS_NOT_THE_DECLARED_LINE:40,3\/3,40/);
    // a quadratic keyed as both roots, in a constructed response written for this test from the numeric fixture
    const s = specOf('10.quadratic-factorising.ib-p1');
    const item = (roots: string) => JSON.stringify({ stimulus: null, item: { credit: null, usesStimulusValues: null, proposedSupportingConceptStableIds: [], stem: 'Solve the equation 2x^2 - 7x + 3 = 0.', context: { kind: 'ABSTRACT', description: 'An equation given directly.' }, declaredModel: { construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING', parameters: { a: 2, r1: 3, r2: 0.5 } }, selected: null, numeric: null, rationale: 'Factorise and use the zero-product property.',
      constructed: { totalMarks: 3, workingOutline: ['Factorise.', 'Set each factor to zero.'], parts: [{ label: 'a', prompt: 'Solve the equation by factorising.', marks: 3, markScheme: [{ kind: 'METHOD', marks: 2, criterion: 'Factorises as (2x - 1)(x - 3).' }, { kind: 'ACCURACY', marks: 1, criterion: 'Both roots.' }], finalAnswer: roots, numericKey: null, target: NC('Two roots are not one keyed number.'), answerCheck: { kind: 'NOT_COMPUTABLE', reason: 'Two roots are stated together.' } }] } } });
    const run = async (roots: string) => { const r = await generate('10.quadratic-factorising.ib-p1', item(roots)); return validateSpecificationCandidate({ candidate: r.candidate, specification: s, stimulus: null, siblings: [r.candidate] }); };
    expect((await run('x = 3 or x = 0.5')).answerKey.units[0]).toMatchObject({ class: 'DETERMINISTIC_RULE_VERIFIED', basis: 'ITEM_TEXT_EQUATION' });
    expect((await run('(2x - 1)(x - 3) = 0')).answerKey.units[0].class).toBe('DETERMINISTIC_RULE_VERIFIED');
    expect((await run('x = 3 or x = -0.5')).answerKey.units[0]).toMatchObject({ class: 'FAILED', failureKind: 'KEY_CONTRADICTED' });
    // SOLVE without a keyed quantity is WEAK (absence), not FAIL (contradiction) -- and the item is still not counted as verified by a machine
    expect((await run('x = 3 or x = 0.5')).constructPreservation).toMatchObject({ outcome: 'WEAK', issues: [] });
  });
  it('CONSTRUCT: an equation handed over already factorised is a contradiction; a verdict of the vocabulary evidences solving; a point of evaluation nobody asks about need not be stated', async () => {
    expect(statesAFactorisedEquation('Resuelve la ecuación 2(x+3.5)(x-4)=0 y escribe el mayor valor.')).toBe(true);
    expect(statesAFactorisedEquation('Resuelve 2x² − 7x + 3 = 0.')).toBe(false);
    const given = await validated('09.quadratic-factorising.paa', (r) => { r.item.stem = '¿Cuál es la mayor de las soluciones de la ecuación (2x − 1)(x − 3) = 0?'; });
    expect([given.v.constructPreservation.outcome, given.v.constructPreservation.issues]).toEqual(['FAIL', ['EQUATION_IS_GIVEN_ALREADY_FACTORISED']]);
    // the key of that item is still right, and is said to be: the two validators answer different questions
    expect(given.v.answerKey.units[0].class).toBe('MACHINE_VERIFIED');
    // a full stop after "= 0" does not hide the equation (version 1 of the reader did not see it)
    expect(parseQuadraticFromText('Resuelve mediante factorización la ecuación 4x^2 + 4x - 15 = 0. Escribe la raíz mayor.')).toEqual({ A: 4, B: 4, C: -15 });
    const verdict = await validated('16.approach.school.standard');
    expect(verdict.v.constructPreservation.notes.filter((n) => n.includes('SOLVE'))).toEqual([]);
    const unused = await validated('01.linear-model.paa', (r) => { r.item.stem = 'Un gimnasio cobra una inscripción de 20 dólares y, además, 15 dólares por cada mes de uso. Si x es el número de meses e y el pago total, ¿qué opción representa la relación?'; const sel = r.item.selected as { options: Array<{ text: string }>; target: unknown; answerCheck: unknown }; sel.options[0].text = 'y = 15x + 20'; sel.options[1].text = 'y = 20x + 15'; sel.options[2].text = 'y = 15x'; sel.options[3].text = 'y = 35x'; sel.target = NC('La respuesta es una ecuación, no una cantidad.'); sel.answerCheck = { kind: 'NOT_COMPUTABLE', reason: 'La respuesta es una ecuación.' }; });
    // x = 6 is declared and nowhere in the item: it is a point of evaluation and nothing is asked there
    expect(unused.v.constructPreservation.notes.filter((n) => n.includes('not readable'))).toEqual([]);
    expect(unused.v.answerKey.units[0]).toMatchObject({ class: 'DETERMINISTIC_RULE_VERIFIED', basis: 'KEYED_TEXT_STRUCTURE' });
    // a table whose every row is on the declared line states the rate and the start
    const table = await validated('05.linear-model.pisa', (r) => { (r.stimulus as { structured: { tables: Array<{ rows: number[][] }> } }).structured.tables[0].rows = [[0, 4.5], [5, 13.5], [8, 18.9]]; (r.item.declaredModel as { parameters: Record<string, number> }).parameters = { b: 4.5, m: 1.8, x: 10 }; (r.item as { usesStimulusValues: number[] }).usesStimulusValues = [4.5, 13.5, 18.9]; const sel = r.item.selected as { options: Array<{ text: string }>; answerCheck: unknown }; sel.options[0].text = '22.5 dólares'; sel.options[1].text = '18 dólares'; sel.options[2].text = '46.8 dólares'; sel.options[3].text = '13.5 dólares'; sel.answerCheck = EXPR('4.5 + 1.8 * 10'); });
    expect(table.v.constructPreservation.notes.filter((n) => n.includes('not readable'))).toEqual([]);
    expect(table.v.answerKey.units[0]).toMatchObject({ class: 'MACHINE_VERIFIED', recomputed: 22.5 });
  });
  it('ORIGINALITY: two instances of one construct with the same parameter values are sent to a person, whatever their wording', async () => {
    const a = await generate('16.approach.school.standard');
    const twin: SpecificationCandidate = { ...a.candidate, candidateKey: 'cand|twin', unitKey: 'twin', specificationId: 'd'.repeat(64), content: { ...a.candidate.content, stem: 'Una empresa compara dos proveedores de energía según los kilovatios entregados por cada panel instalado en su tejado, y quiere saber cuál rinde más.' } };
    const o = validateSpecificationOriginality(a.candidate, [a.candidate, twin]);
    expect([o.outcome, o.sameParametersAs, o.issues]).toEqual(['REVIEW_STRUCTURAL_SIMILARITY', ['cand|twin'], ['SAME_PARAMETER_VALUES_AS_A_SIBLING:cand|twin']]);
    const other: SpecificationCandidate = { ...twin, content: { ...twin.content, declaredModel: { ...twin.content.declaredModel, parameters: { p1: 40, q1: 120, p2: 60, q2: 180 } } } };
    expect(validateSpecificationOriginality(a.candidate, [a.candidate, other]).sameParametersAs).toEqual([]);
  });
});

describe('the spend guard: enforced in code, before every call', () => {
  const prompt = { prompt: { system: 'system text', instruction: { task: 'write' } }, promptHash: 'a'.repeat(64) };
  const transportOf = (answers: Array<string | Error>, usage = { inputTokens: 1000, outputTokens: 2000, reasoningTokens: 500, cachedInputTokens: 0 }) => {
    const calls: number[] = [];
    const transport: ModelTransport = { providerId: 'fake:transport', model: MODEL, complete: async (r) => { calls.push(r.maxOutputTokens); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; if (a instanceof Error) throw a; return { rawText: a, usage, servedModel: MODEL, responseId: `r${calls.length}`, finishReason: 'stop' }; } };
    return { transport, calls };
  };
  const providerOf = (transport: ModelTransport, ledger: SpendLedger, capUsd: number = QB_R2D_SPEND_CAP_USD) => new BudgetedLiveProvider({ transport, ledger, capUsd, guardPrice: GUARD_PRICE_BASIS, repoPrice: { id: 'repo', label: 'REPO_CONFIGURED', source: 'test', inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.2 }, maxOutputTokens: 6000, malformedCodeOf, unitKeyOf: () => 'unit#a1', now: () => NOW });
  const good = raw('01.linear-model.paa');

  it('the cap is USD 20 and the guard price is a labelled, deliberately high assumption', () => {
    expect(QB_R2D_SPEND_CAP_USD).toBe(20);
    expect([GUARD_PRICE_BASIS.label, GUARD_PRICE_BASIS.inputPerMillionUsd, GUARD_PRICE_BASIS.outputPerMillionUsd]).toEqual(['ASSUMED', 5, 30]);
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, GUARD_PRICE_BASIS)).toBe(35);
    expect(inputTokenUpperBound('x'.repeat(1000))).toBe(500);
  });
  it('a call is recorded with the provider\'s usage and both cost bases', async () => {
    const ledger = new SpendLedger();
    const { transport, calls } = transportOf([good]);
    const r = await providerOf(transport, ledger).generate(prompt);
    expect([r.rawText === good, r.promptHash, calls.length, ledger.entries.length]).toEqual([true, prompt.promptHash, 1, 1]);
    expect(ledger.entries[0]).toMatchObject({ seq: 1, try: 1, outcome: 'OK', usageSource: 'PROVIDER_USAGE_RESPONSE', usage: { inputTokens: 1000, outputTokens: 2000 }, unitKey: 'unit#a1' });
    expect(ledger.entries[0].costUsdGuardBasis).toBeCloseTo(0.005 + 0.06, 9);
    expect(ledger.entries[0].costUsdRepoBasis).toBeCloseTo(0.0002 + 0.0024, 9);
    expect(ledger.spentUsdGuardBasis()).toBeCloseTo(0.065, 9);
  });
  it('REFUSES a call whose worst case would take the spend past the cap -- and makes no call', async () => {
    const ledger = new SpendLedger();
    const { transport, calls } = transportOf([good]);
    // worst case of one call: a tiny input bound + 6000 output tokens at the guard price = a little over USD 0.18
    const tight = providerOf(transport, ledger, 0.1);
    await expect(tight.generate(prompt)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls.length).toBe(0);
    expect(ledger.entries.map((e) => [e.outcome, e.usageSource, e.costUsdGuardBasis])).toEqual([['REFUSED_BY_BUDGET', 'NO_CALL_MADE', 0]]);
    expect(ledger.calls()).toBe(0);
    // with what is already spent counted in
    const spent = new SpendLedger();
    const { transport: t2, calls: c2 } = transportOf([good]);
    const p2 = providerOf(t2, spent, 0.3);
    await p2.generate(prompt);
    await p2.generate(prompt);
    await expect(p2.generate(prompt)).rejects.toThrow(/BUDGET_WOULD_BE_EXCEEDED/);
    expect(c2.length).toBe(2);
    expect(spent.spentUsdGuardBasis()).toBeLessThanOrEqual(0.3);
  });
  it('at most ONE retry, and only for a transport failure or a malformed answer; a well-formed answer is never retried', async () => {
    const malformed = transportOf(['not json', good]);
    const l1 = new SpendLedger();
    const r1 = await providerOf(malformed.transport, l1).generate(prompt);
    expect([malformed.calls.length, r1.rawText === good, l1.entries.map((e) => `${e.try}:${e.outcome}`).join(',')]).toEqual([2, true, '1:MALFORMED_RESPONSE,2:OK']);
    const twice = transportOf(['not json', '{"also":"malformed"}', good]);
    const l2 = new SpendLedger();
    const r2 = await providerOf(twice.transport, l2).generate(prompt);
    // the second malformed answer is handed back as it is: the harness refuses it by name; there is no third call
    expect([twice.calls.length, r2.rawText]).toEqual([2, '{"also":"malformed"}']);
    const transport = transportOf([new Error('socket hang up'), good]);
    const l3 = new SpendLedger();
    await providerOf(transport.transport, l3).generate(prompt);
    expect(l3.entries.map((e) => [e.outcome, e.usageSource])).toEqual([['TRANSPORT_ERROR', 'NOT_REPORTED_CHARGED_AT_WORST_CASE'], ['OK', 'PROVIDER_USAGE_RESPONSE']]);
    // an unknown cost is charged at its worst case, never at zero
    expect(l3.entries[0].costUsdGuardBasis).toBe(l3.entries[0].worstCaseCostUsdGuardBasis);
    expect(l3.entries[0].costUsdGuardBasis).toBeGreaterThan(0.18);
    const dead = transportOf([new Error('down'), new Error('still down')]);
    await expect(providerOf(dead.transport, new SpendLedger()).generate(prompt)).rejects.toThrow(/still down/);
    expect(dead.calls.length).toBe(2);
    // content that is well-formed but wrong is a RESULT: one call, no retry
    const wrong = transportOf([raw('01.linear-model.paa', (r) => { (r.item.selected as { answerKey: string }).answerKey = 'E'; })]);
    await providerOf(wrong.transport, new SpendLedger()).generate(prompt);
    expect(wrong.calls.length).toBe(1);
  });
  it('every planned unit renders one prompt, and the units of a run are the selection plus its explicit regenerations', () => {
    const units = plannedUnits(MODEL);
    expect(units).toHaveLength(20);
    expect(new Set(units.map((u) => u.promptHash)).size).toBe(20);
    const withRegeneration = plannedUnits(MODEL, [{ selectionKey: '01.linear-model.paa', attempt: 2, reason: 'test' }]);
    expect(withRegeneration.map((u) => u.unitKey)).toContain('01.linear-model.paa#a2');
    expect(withRegeneration[20].promptHash).not.toBe(units[0].promptHash);
    expect(() => plannedUnits(MODEL, [{ selectionKey: 'nope', attempt: 2, reason: 'x' }])).toThrow(/REGENERATION_OF_AN_UNSELECTED_ADAPTATION/);
  });
});

describe('architecture: additive, pure, independent of the generator, and the live transport stays outside src', () => {
  const PROD = 'src/lib/exam-core/question-bank/production';
  const strip = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  const walk = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(`${d}/${e.name}`)) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const importsOf = (p: string): string[] => [...strip(p).matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
  const resolveImport = (from: string, spec: string): string | null => {
    const basePath = spec.startsWith('@/') ? join('src', spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
    if (basePath === null) return null;
    for (const candidate of [`${basePath}.ts`, `${basePath}.tsx`, join(basePath, 'index.ts')]) { try { readFileSync(join(ROOT, candidate)); return candidate.split('\\').join('/'); } catch { /* next */ } }
    return null;
  };
  const closure = (entry: string): { files: Set<string>; packages: Set<string> } => {
    const files = new Set<string>(); const packages = new Set<string>(); const queue = [entry];
    while (queue.length > 0) { const f = queue.pop()!; if (files.has(f)) continue; files.add(f); for (const spec of importsOf(f)) { const r = resolveImport(f, spec); if (r) queue.push(r); else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec); } }
    return { files, packages };
  };

  it('the validators and the contract import nothing of the generator; the generator imports no validator', () => {
    for (const f of ['specification-validators.ts', 'specification-candidate.ts', 'math-construct-registry.ts']) expect(strip(`${PROD}/${f}`), f).not.toMatch(/from '\.\/generator\//);
    expect(strip(`${PROD}/generator/specification-generation.ts`)).not.toMatch(/specification-validators|independent-validators|originality-gate|structural-validation|validated-candidate/);
    // the vocabulary the generator shows the provider computes nothing: no arithmetic operator on a parameter
    expect(strip(`${PROD}/math-construct-registry.ts`)).not.toMatch(/Math\.|=>\s*[^({'\s][^,]*[*/]/);
  });
  it('the new source files are pure: no network, no clock, no randomness, no environment, no database, no vendor', () => {
    for (const f of [`${PROD}/generator/specification-generation.ts`, `${PROD}/specification-validators.ts`, `${PROD}/specification-candidate.ts`, `${PROD}/math-construct-registry.ts`]) {
      expect(strip(f), f).not.toMatch(/fetch\(|process\.env|https?:\/\/|Date\.now\(|new Date\(|Math\.random\(|@\/lib\/db|@\/lib\/ai\/|from 'fs'|from 'pg'/);
      expect(strip(f), f).not.toMatch(/anthropic|openai|claude|gpt-|gemini/i);
    }
  });
  it('the cell-driven harness is untouched: its registry, its response schema and its provider list are what they were', () => {
    expect(strip(`${PROD}/generator/templates.ts`)).not.toMatch(/spec-/);
    expect(strip(`${PROD}/generator/generate-candidates.ts`)).not.toMatch(/specification-generation|specification-candidate/);
    expect(readdirSync(join(ROOT, PROD, 'generator')).sort()).toEqual(['generate-candidates.ts', 'provider.ts', 'response-schema.ts', 'specification-generation.ts', 'templates.ts']);
  });
  it('the live transport is outside src, and nothing in src imports the lane\'s scripts', () => {
    expect(readdirSync(join(ROOT, 'scripts/operations/qb-r2d')).sort()).toEqual(['budget.ts', 'live-provider.ts', 'pipeline.ts', 'prior-corpus.ts', 'run.ts', 'selection.ts']);
    for (const f of walk('src')) expect(readFileSync(join(ROOT, f), 'utf8'), f).not.toMatch(/scripts\/operations\/qb-r2d|qb-r2d\/live-provider/);
    // the only file of the lane that names a network endpoint or reads the key is the live transport
    for (const f of ['budget.ts', 'pipeline.ts', 'selection.ts', 'prior-corpus.ts']) expect(strip(`scripts/operations/qb-r2d/${f}`), f).not.toMatch(/fetch\(|https?:\/\/|process\.env/);
    expect(strip('scripts/operations/qb-r2d/run.ts')).not.toMatch(/fetch\(|https?:\/\//);
    const live = strip('scripts/operations/qb-r2d/live-provider.ts');
    expect(live).toMatch(/Authorization: `Bearer \$\{o\.apiKey\}`/);
    expect(live).not.toMatch(/console\.|writeFileSync|appendFileSync/);
  });
  it('NO database module is reachable from the live run: not directly, not transitively, and not the gateway', () => {
    const { files, packages } = closure('scripts/operations/qb-r2d/run.ts');
    expect(files.size).toBeGreaterThan(20);
    for (const f of files) {
      expect(f, f).not.toMatch(/^src\/lib\/db|\/db\/|\/gateway\.ts$|\/adapters\/|\.service\.ts$|\/repositories?\//);
      expect(strip(f), f).not.toMatch(/DATABASE_URL|from 'pg'|from 'postgres'|drizzle|@neondatabase|new Pool\(|@\/lib\/db/);
    }
    expect([...packages].sort()).toEqual(['crypto', 'fs', 'path', 'zod']);
    // of src/lib/ai only the routing table and the price table are read (and the type declarations the routing table names)
    expect([...files].filter((f) => f.startsWith('src/lib/ai/')).sort()).toEqual(['src/lib/ai/model-routing.ts', 'src/lib/ai/pricing.ts', 'src/lib/ai/types.ts']);
    expect(strip('src/lib/ai/model-routing.ts')).toMatch(/import type \{[^}]*\} from '\.\/types'/);
    expect(resolve(ROOT, 'scripts/operations/qb-r2d/live-provider.ts').includes(`${join('src', 'lib')}`)).toBe(false);
  });
});
