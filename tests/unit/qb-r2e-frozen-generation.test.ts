/**
 * QB-R2E, phases 1 and 2 -- the five specification / generator fixes, the hardening, validators revision 3, the
 * pre-registered gate evaluator, the cumulative budget and the validator freeze. NO NETWORK and NO PROVIDER: every
 * response here is a synthetic fixture written in this file.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { adapt } from '@/lib/assessment-adaptation/adapt';
import { specificationIntegrityIssues, type AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { MATHEMATICS_ADAPTATION_POLICY, validateDisciplinePolicy } from '@/lib/assessment-adaptation/discipline-policy';
import { buildMathPocSpecifications } from '@/lib/assessment-adaptation/math-poc-matrix';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { SCHOOL_STEM_PERFORMANCE_PROFILE } from '@/lib/assessment-adaptation/school-stem-performance';
import { EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES } from '@/lib/assessment-adaptation/system-profiles';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { SPECIFICATION_TEMPLATE_REGISTRY } from '@/lib/exam-core/question-bank/production/generator/specification-generation';
import {
  generateFromSpecificationV2, ITEM_WRITING_RULES_V2, normalizeWireResponse, parseSpecificationWireResponse, renderSpecificationPromptV2, SPECIFICATION_PROVIDER_JSON_SCHEMA, SPECIFICATION_TEMPLATE_REGISTRY_V2, SpecificationGenerationV2Error,
  SpecificationWireResponseSchema, TEMPLATE_V2_CONSTRUCTED, TEMPLATE_V2_SELECTED,
} from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import { CONSTRUCT_INTEGRITY, constructIntegrityOf, constructVocabularyOf, MATH_CONSTRUCT_VOCABULARY } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { validateSpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-validators';
import { commandTermIssues, handedOverIssues, ITEM_WRITING_HEURISTIC, itemWritingFlags, LEAKAGE_RULE, leakedSpecificationVocabulary, marksIssues, validateSpecificationCandidateR3 } from '@/lib/exam-core/question-bank/production/specification-validators-r3';
import { mathPocFamilyEa1aOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families-ea1a';
import { GUARD_PRICE_BASIS } from '../../scripts/operations/qb-r2d/budget';
import { storedR2dSelection } from '../../scripts/operations/qb-r2d/stored-selection';
import { CumulativeBudgetExceededError, CumulativeBudgetProvider, R2D_R2E_CUMULATIVE_CAP_USD, R2E_MAX_CALLS, R2E_MAX_OUTPUT_TOKENS, R2eLedger, RequestRejectedError, worstCaseCallUsd, type R2eRecording, type R2eTransport } from '../../scripts/operations/qb-r2e/budget';
import { r2dCandidates, r2dParameterSets, r2dSpendUsdGuardBasis } from '../../scripts/operations/qb-r2e/evidence';
import { computeFreezeManifest, FREEZE_ENTRY_FILES, FREEZE_RUN_PARAMETERS, freezeVerdict, frozenSourceFiles, readStoredManifest, verifyFreeze, type FreezeManifest } from '../../scripts/operations/qb-r2e/freeze';
import { evaluateGates, finalAttemptOf, hasGateFail, isRegenerable, isStrictPass, PRE_REGISTRATION, type AdaptationResult, type AttemptResult } from '../../scripts/operations/qb-r2e/gates';
import { r2eRequestBody } from '../../scripts/operations/qb-r2e/live-provider';
import { planUnit, plannedFirstAttempts, QB_R2E_BATCH_KEY, r2eMalformedCodeOf, r2ePolicyFor, regenerationsDue, runQbR2e, type R2eEvidence, type R2eRecordingFile } from '../../scripts/operations/qb-r2e/pipeline';
import { loadEvidence, transportBehindTheFreeze } from '../../scripts/operations/qb-r2e/run';
import { buildR2eSelection, R2E_APPROACH_PAIRS, R2E_PROOF_FAMILY } from '../../scripts/operations/qb-r2e/selection';

import { movedFileReasons, MOVED_SINCE_QB_FREEZE, unmovedPart, unmovedPaths } from './qb-freeze-moved-files';
const ROOT = process.cwd();
const MODEL = 'fixture-model';
const NOW = '2026-10-12T09:00:00.000Z';
const SELECTION = buildR2eSelection();
const specOf = (key: string): AdaptationSpecification => SELECTION.find((s) => s.selectionKey === key)!.specification;
const EVIDENCE: R2eEvidence = loadEvidence(ROOT);
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ---- synthetic provider answers, in the flat strict shape ---------------------------------------------------------
const answer = (over: Record<string, unknown>) => ({ label: 'item', prompt: null, commandTerm: null, marks: 1, markPoints: [], finalAnswer: '', numericValue: null, decimalPlaces: null, targetKind: 'NOT_MACHINE_CHECKABLE', targetCode: null, verdictValue: null, comparisonLeft: null, comparisonOperator: null, comparisonRight: null, comparisonHolds: null, notCheckableReason: null, arithmeticExpression: null, ...over });
const WIRE: Record<string, { stimulus: unknown; item: Record<string, unknown> }> = {
  '01.rate-comparison.paa': { stimulus: null, item: {
    stem: 'Marta compara dos paquetes de arroz en el supermercado. El paquete 1 cuesta 6 dólares y contiene 15 porciones; el paquete 2 cuesta 9 dólares y contiene 18 porciones. ¿Cuál paquete ofrece más porciones por cada dólar?',
    contextKind: 'PERSONAL', contextDescription: 'Una persona elige entre dos paquetes de arroz en una tienda.', construct: 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS', parameters: [{ symbol: 'p1', value: 6 }, { symbol: 'q1', value: 15 }, { symbol: 'p2', value: 9 }, { symbol: 'q2', value: 18 }],
    responseKind: 'SELECTED', options: [{ id: 'A', text: 'El paquete 1' }, { id: 'B', text: 'El paquete 2' }, { id: 'C', text: 'Los dos por igual' }, { id: 'D', text: 'Ninguno de los dos' }], answerKey: 'A',
    distractors: [{ optionId: 'B', misconceptionModelId: 'one-quantity', rationale: 'Mira solo el número de porciones.' }, { optionId: 'C', misconceptionModelId: 'difference', rationale: 'Compara diferencias en lugar de razones.' }, { optionId: 'D', misconceptionModelId: 'inverted-rate', rationale: 'Invierte la razón y no logra decidir.' }],
    answers: [answer({ finalAnswer: 'El paquete 1', targetKind: 'VERDICT', targetCode: 'OPTION_WITH_HIGHER_UNIT_RATE', verdictValue: 'OPTION_1' })],
    workingOutline: [], creditLevels: [], rationale: '15/6 = 2,5 porciones por dólar y 18/9 = 2: el paquete 1 ofrece más.', usesStimulusValues: [], supportingConceptStableIds: [] } },
  '02.rate-comparison.ib-p1': { stimulus: null, item: {
    stem: 'A bakery can buy flour from two suppliers. Supplier 1 charges 24 dollars for 60 kilograms. Supplier 2 charges 35 dollars for 70 kilograms.',
    contextKind: 'OCCUPATIONAL', contextDescription: 'A bakery chooses between two flour suppliers.', construct: 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS', parameters: [{ symbol: 'p1', value: 24 }, { symbol: 'q1', value: 60 }, { symbol: 'p2', value: 35 }, { symbol: 'q2', value: 70 }],
    responseKind: 'CONSTRUCTED', options: [], answerKey: null, distractors: [],
    answers: [
      answer({ label: 'a', prompt: 'Calculate the number of kilograms of flour per dollar that Supplier 1 offers.', commandTerm: 'calculate', marks: 2, markPoints: [{ kind: 'METHOD', marks: 1, criterion: 'Forms the rate 60 / 24.' }, { kind: 'ACCURACY', marks: 1, criterion: '2.5 kilograms per dollar.' }], finalAnswer: '2.5 kilograms per dollar', numericValue: '2.5', targetKind: 'QUANTITY', targetCode: 'UNIT_RATE_1', arithmeticExpression: '60 / 24' }),
      answer({ label: 'b', prompt: 'Find the difference between the numbers of kilograms per dollar of the two suppliers.', commandTerm: 'find', marks: 2, markPoints: [{ kind: 'METHOD', marks: 1, criterion: 'Forms the rate 70 / 35 and subtracts.' }, { kind: 'ACCURACY', marks: 1, criterion: '0.5 kilograms per dollar.' }], finalAnswer: '0.5 kilograms per dollar', numericValue: '0.5', targetKind: 'QUANTITY', targetCode: 'UNIT_RATE_DIFFERENCE', arithmeticExpression: '60 / 24 - 70 / 35' }),
      answer({ label: 'c', prompt: 'Write down which supplier gives the bakery more flour for each dollar.', commandTerm: 'write down', marks: 1, markPoints: [{ kind: 'ACCURACY', marks: 1, criterion: 'Supplier 1.' }], finalAnswer: 'Supplier 1', targetKind: 'VERDICT', targetCode: 'OPTION_WITH_HIGHER_UNIT_RATE', verdictValue: 'OPTION_1' }),
    ],
    workingOutline: ['Divide kilograms by dollars for each supplier.', 'Subtract the two rates.', 'Choose the larger rate.'], creditLevels: [], rationale: 'Supplier 1 gives 2.5 kilograms per dollar and Supplier 2 gives 2.', usesStimulusValues: [], supportingConceptStableIds: [] } },
};
type Wire = { stimulus: unknown; item: Record<string, unknown> };
const raw = (key: string, mutate?: (w: Wire) => void): string => { const w = JSON.parse(JSON.stringify(WIRE[key])) as Wire; mutate?.(w); return JSON.stringify(w); };
const answersOf = (w: Wire) => w.item.answers as Array<Record<string, unknown>>;

const inputOf = (key: string, attempt: 1 | 2 = 1) => { const a = SELECTION.find((s) => s.selectionKey === key)!; const construct = (a.specification.invariants.construct as { construct: string }).construct; return { unit: { unitKey: `${key}#a${attempt}`, specification: a.specification, attempt, avoidParameterSets: EVIDENCE.avoidParameterSets[construct] ?? [] }, constructVocabulary: constructVocabularyOf(construct), constructIntegrity: constructIntegrityOf(construct), policy: r2ePolicyFor(MODEL, a.specification.variable.language), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V2 }; };
async function generate(key: string, rawText = raw(key)) {
  const input = inputOf(key);
  const hash = renderSpecificationPromptV2({ ...input, provider: new RecordedResponseProvider('recorded:fixture', MODEL, {}) }).promptHash;
  return generateFromSpecificationV2({ ...input, provider: new RecordedResponseProvider('recorded:fixture', MODEL, { [hash]: rawText }), runId: 'fixture-run', batchKey: QB_R2E_BATCH_KEY, now: NOW });
}
const refusal = async (key: string, mutate: (w: Wire) => void): Promise<string> => { try { await generate(key, raw(key, mutate)); return 'NO_ERROR'; } catch (e) { return e instanceof SpecificationGenerationV2Error ? e.code : `OTHER:${(e as Error).message}`; } };
const scored = async (key: string, mutate?: (w: Wire) => void) => { const r = await generate(key, raw(key, mutate)); return { r, v: validateSpecificationCandidateR3({ candidate: r.candidate, specification: specOf(key), stimulus: r.stimulus, siblings: [r.candidate] }) }; };

describe('FIX 3 -- a mark structure of marked parts is never paired with a closed response format', () => {
  const family = mathPocFamilyEa1aOf(R2E_PROOF_FAMILY)!;
  const school = (request: Record<string, unknown> = {}) => adapt({ family, profile: SCHOOL_STEM_PERFORMANCE_PROFILE, applicability: MATH_POC_APPLICABILITY, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', contentUseClass: 'DEV_TEST_CONTENT', language: 'es', ...request } });
  it('the STANDARD school specification is a constructed response; QB-R2D\'s stored one was SELECTED with MULTI_MARK_PARTS', () => {
    const now = school();
    expect(now.ok && [now.specification.variable.responseFormat.format, now.specification.variable.markStructure, now.specification.variable.marks!.scoredAs]).toEqual(['SHORT_RESPONSE', 'MULTI_MARK_PARTS', 'MARKED_PARTS']);
    const then = storedR2dSelection().find((s) => s.selectionKey === '16.approach.school.standard')!.specification;
    expect([then.variable.responseFormat.format, then.variable.markStructure]).toEqual(['SELECTED_RESPONSE', 'MULTI_MARK_PARTS']);
  });
  it('asking for the unrealisable combination is refused BY NAME, at the source', () => {
    for (const responseFormat of ['SELECTED_RESPONSE', 'NUMERIC_ENTRY']) { const r = school({ responseFormat }); expect(r.ok ? 'SPECIFICATION' : r.refusal.code, responseFormat).toBe('MARK_STRUCTURE_NOT_REALISABLE_BY_RESPONSE_FORMAT'); }
    expect(school({ responseFormat: 'EXTENDED_RESPONSE' }).ok).toBe(true);
  });
  it('no specification the engine produces has it: every EA-1 matrix specification and every QB-R2E adaptation', () => {
    const all = [...buildMathPocSpecifications().specifications.values(), ...SELECTION.map((s) => s.specification)];
    expect(all.length).toBeGreaterThan(100);
    for (const s of all) expect(s.variable.markStructure === 'MULTI_MARK_PARTS' && ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION'].includes(s.variable.responseFormat.format), s.specificationId).toBe(false);
  });
});

describe('FIX 4 and FIX 5 -- command terms per part and explicit marks, in the specification, with provenance and authority', () => {
  it('marks: scoring, total range, part range, mark-point kinds and credit levels, from the profile rule and the discipline policy', () => {
    expect(validateDisciplinePolicy(MATHEMATICS_ADAPTATION_POLICY).ok).toBe(true);
    expect(MATHEMATICS_ADAPTATION_POLICY.version).toBe('0.2.0-provisional');
    const ib = specOf('02.rate-comparison.ib-p1').variable.marks!;
    expect(ib).toMatchObject({ scoredAs: 'MARKED_PARTS', total: { min: 2, max: 8 }, parts: { min: 1, max: 4 }, markPointKinds: ['METHOD', 'ACCURACY', 'REASONING'], creditLevels: false });
    expect(ib.provenance.map((p) => `${p.origin}:${p.ref}:${p.authority}`)).toEqual(['SYSTEM_PROFILE_RULE:ib.marks:STUDYUS_POLICY', 'POLICY_RULE:studyus.adaptation.mathematics@0.2.0-provisional#marks.MULTI_MARK_PARTS:STUDYUS_POLICY', 'SYSTEM_PROFILE_RULE:ib.rubric:STUDYUS_POLICY']);
    expect(specOf('01.rate-comparison.paa').variable.marks).toMatchObject({ scoredAs: 'SINGLE_KEYED_UNIT', total: { min: 1, max: 1 }, parts: null, markPointKinds: [], creditLevels: false });
    expect(specOf('04.rate-comparison.pisa').variable.marks).toMatchObject({ scoredAs: 'SINGLE_CODED_UNIT', total: { min: 1, max: 1 }, creditLevels: true });
    expect(specOf('06.approach.school.standard').variable.marks).toMatchObject({ scoredAs: 'MARKED_PARTS', creditLevels: true });
    // no OFFICIAL total is claimed: the range is StudyUs policy and says so
    for (const a of SELECTION) expect(a.specification.variable.marks!.provenance.some((p) => p.origin === 'POLICY_RULE' && p.authority === 'STUDYUS_POLICY')).toBe(true);
  });
  it('command terms: the profile\'s own vocabulary, the lead term, and the terms that suit each action -- none invented', () => {
    const ib = specOf('02.rate-comparison.ib-p1').variable;
    expect(ib.commandTerm).toBe('find');
    expect(ib.commandTerms).toMatchObject({ lead: 'find', allowed: ['find', 'solve', 'show that', 'hence', 'write down', 'calculate'], perPart: 'EACH_PART_USES_ONE_ALLOWED_TERM', byEvidenceAction: { FORMULATE: ['find', 'show that'], SOLVE: ['solve', 'find', 'calculate'], INTERPRET: ['write down', 'find'] } });
    expect(ib.commandTerms!.provenance[0]).toEqual({ origin: 'COMPONENT_PROFILE_RULE', ref: 'ib.math-aa-hl.p1.command-terms', authority: 'OFFICIAL' });
    const cambridge = specOf('03.rate-comparison.cambridge-p1').variable.commandTerms!;
    expect(cambridge.allowed).toEqual(['work out', 'calculate', 'show that', 'write down']);
    for (const a of SELECTION) {
      const v = a.specification.variable;
      const profile = EA1_SYSTEM_PROFILES.find((p) => p.profileId === a.specification.systemProfile.profileId) ?? SCHOOL_STEM_PERFORMANCE_PROFILE;
      const component = EA1_COMPONENT_PROFILES.find((c) => c.componentId === a.targetId);
      const recorded = (component?.overrides as { commandTerms?: { value: { terms: string[] } } } | undefined)?.commandTerms?.value.terms ?? profile.rules.commandTerms.value.terms;
      // present exactly when the profile has a vocabulary; every term is one the profile records
      expect(v.commandTerms !== undefined, a.selectionKey).toBe(recorded.length > 0);
      if (v.commandTerms) { expect(v.commandTerms.allowed).toEqual(recorded); for (const terms of Object.values(v.commandTerms.byEvidenceAction)) for (const t of terms) expect(recorded).toContain(t); }
    }
  });
  it('the new members are OPTIONAL and additive: a QB-R2D specification made by engine 2 still verifies, with its old id', () => {
    for (const s of storedR2dSelection()) {
      expect(specificationIntegrityIssues(s.specification), s.selectionKey).toEqual([]);
      expect([s.specification.lineage.engine.version, s.specification.variable.marks, s.specification.variable.commandTerms]).toEqual(['2', undefined, undefined]);
    }
    expect(SELECTION.every((a) => a.specification.lineage.engine.version === '3' && specificationIntegrityIssues(a.specification).length === 0)).toBe(true);
    // none of the fresh specification ids existed in QB-R2D
    const old = new Set(storedR2dSelection().map((s) => s.specification.specificationId));
    expect(SELECTION.some((a) => old.has(a.specification.specificationId))).toBe(false);
    expect(specOf('02.rate-comparison.ib-p1').variable.context.situation).toMatch(/suppliers|work/i);
  });
});

describe('the QB-R2E selection: twenty new adaptations', () => {
  it('covers five concepts, five systems and the school profile, both approaches, three response kinds, both IB papers, stimuli', () => {
    expect(SELECTION).toHaveLength(20);
    expect([...new Set(SELECTION.map((a) => a.specification.primaryConcept.stableId))].sort()).toEqual(['math.alg.quadratics', 'math.fun.linear-functions-lines', 'math.num.ratio-proportion', 'math.prob.probability', 'math.stat.data-representation']);
    expect([...new Set(SELECTION.map((a) => a.specification.systemProfile.profileId))].sort()).toEqual(['CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA', 'SCHOOL_STEM_PERFORMANCE']);
    expect([...new Set(SELECTION.map((a) => a.specification.variable.responseFormat.format))].sort()).toEqual(['EXTENDED_RESPONSE', 'NUMERIC_ENTRY', 'SELECTED_RESPONSE', 'SHORT_RESPONSE']);
    expect([...new Set(SELECTION.filter((a) => a.targetId.startsWith('IB.')).map((a) => a.specification.variable.toolPolicy.calculator))].sort()).toEqual(['GDC_REQUIRED', 'NONE']);
    expect(SELECTION.filter((a) => a.specification.variable.stimulus.mode !== 'NONE').length).toBe(3);
    expect(SELECTION.filter((a) => a.approach === 'STEM_PLUS').length).toBe(3);
    expect(SELECTION.every((a) => a.specification.contentUseClass === 'DEV_TEST_CONTENT')).toBe(true);
  });
  it('one family on all five systems with one invariant hash; three approach pairs of that family', () => {
    const same = SELECTION.filter((a) => a.group === 'SAME_FAMILY_ALL_SYSTEMS');
    expect([same.length, new Set(same.map((a) => a.specification.systemProfile.profileId)).size, new Set(same.map((a) => a.specification.invariantHash)).size, new Set(same.map((a) => a.familyId)).size]).toEqual([5, 5, 1, 1]);
    for (const [base, stem] of R2E_APPROACH_PAIRS) { const a = specOf(base), b = specOf(stem); expect([a.invariantHash === b.invariantHash, a.learningApproach, b.learningApproach?.approachId]).toEqual([true, undefined, 'STEM_PLUS']); }
    expect(specOf('08.approach.paa.stem-plus').learningApproach!.unmetPreferences.some((u) => u.overriddenBy.authority === 'OFFICIAL')).toBe(true);
    expect([specOf('06.approach.school.standard').variable.responseFormat.format, specOf('07.approach.school.stem-plus').variable.responseFormat.format]).toEqual(['SHORT_RESPONSE', 'EXTENDED_RESPONSE']);
  });
  it('the prompts tell the provider which QB-R2D parameter sets not to reuse', () => {
    const sets = r2dParameterSets(ROOT);
    expect(sets.UNIT_RATE_COMPARISON_OF_TWO_OPTIONS).toContainEqual({ p1: 8, p2: 15, q1: 20, q2: 33 });
    const prompt = renderSpecificationPromptV2({ ...inputOf('01.rate-comparison.paa'), provider: new RecordedResponseProvider('r', MODEL, {}) }).prompt;
    expect(prompt.instruction.avoidParameterSets).toEqual(sets.UNIT_RATE_COMPARISON_OF_TWO_OPTIONS);
  });
});

describe('FIX 1 and FIX 2 -- generator version 2: no forbidden sentence, and ONE definition of the response for harness and provider', () => {
  it('FIX 1: a constructed response has no fixed instruction, so there is nothing to show and then forbid', () => {
    expect(TEMPLATE_V2_CONSTRUCTED.fixedInstruction).toEqual({});
    const p = renderSpecificationPromptV2({ ...inputOf('02.rate-comparison.ib-p1'), provider: new RecordedResponseProvider('r', MODEL, {}) }).prompt;
    expect(p.instruction.template.fixedInstruction).toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/Show your working|Muestra tu procedimiento/);
    // version 1, which QB-R2D was recorded against, is untouched
    expect(SPECIFICATION_TEMPLATE_REGISTRY.map((t) => `${t.id}@${t.version}`)).toEqual(['spec-selected-response@1', 'spec-numeric-entry@1', 'spec-constructed-response@1']);
    expect(SPECIFICATION_TEMPLATE_REGISTRY[2].fixedInstruction.en).toBe('Show your working.');
    expect(SPECIFICATION_TEMPLATE_REGISTRY_V2.map((t) => `${t.id}@${t.version}`)).toEqual(['spec-selected-response@2', 'spec-numeric-entry@2', 'spec-constructed-response@2']);
  });
  it('a candidate of a constructed response carries no instruction, and a stem may say what it likes about working', async () => {
    const { candidate } = await generate('02.rate-comparison.ib-p1', raw('02.rate-comparison.ib-p1', (w) => { w.item.stem += ' Show your working.'; }));
    expect(candidate.instruction).toBeNull();
    expect(candidate.lineage.generationRequest).toMatchObject({ template: { id: 'spec-constructed-response', version: '2' }, harness: { version: '2' }, responseSchema: { version: '2' }, attempt: 1 });
  });

  // a small JSON Schema checker for exactly the keywords the provider schema uses
  const jsonValid = (schema: Record<string, unknown>, value: unknown): boolean => {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    const typeOf = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
    if (!types.includes(typeOf) && !(typeOf === 'integer' && types.includes('number'))) return false;
    if (value === null) return true;
    if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) return false;
    if (typeOf === 'array') return (value as unknown[]).every((v) => jsonValid(schema.items as Record<string, unknown>, v));
    if (typeOf === 'object') {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      const keys = Object.keys(value as object);
      if ((schema.required as string[]).some((k) => !keys.includes(k)) || (schema.additionalProperties === false && keys.some((k) => !(k in props)))) return false;
      return keys.every((k) => jsonValid(props[k], (value as Record<string, unknown>)[k]));
    }
    return true;
  };
  it('FIX 2: the provider schema is STRICT -- every object closed, every member required -- and uses only plain keywords', () => {
    const walk = (s: Record<string, unknown>, path: string): void => {
      expect(Object.keys(s).every((k) => ['type', 'enum', 'properties', 'required', 'additionalProperties', 'items'].includes(k)), path).toBe(true);
      if ((Array.isArray(s.type) ? s.type : [s.type]).includes('object')) {
        expect(s.additionalProperties, path).toBe(false);
        expect([...(s.required as string[])].sort(), path).toEqual(Object.keys(s.properties as object).sort());
        for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
      }
      if (s.items) walk(s.items as Record<string, unknown>, `${path}[]`);
    };
    expect(SPECIFICATION_PROVIDER_JSON_SCHEMA.name).toBe('studyus_specification_item_v2');
    expect(SPECIFICATION_PROVIDER_JSON_SCHEMA.schema.type).toBe('object');
    walk(SPECIFICATION_PROVIDER_JSON_SCHEMA.schema, '$');
    // the request is shaped as the repository's own adapter shapes a strict request
    const body = r2eRequestBody({ model: 'm', jsonSchema: SPECIFICATION_PROVIDER_JSON_SCHEMA }, { system: 's', user: 'u', maxOutputTokens: 10 });
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'studyus_specification_item_v2', strict: true, schema: SPECIFICATION_PROVIDER_JSON_SCHEMA.schema } });
    expect(read('src/lib/ai/adapters/openai.ts')).toMatch(/response_format: \{ type: 'json_schema', json_schema: \{ name: params\.jsonSchema\.name, strict: true, schema: params\.jsonSchema\.schema \} \}/);
    expect([body.max_completion_tokens, body.reasoning_effort]).toEqual([10, 'low']);
  });
  it('FIX 2: the provider schema and the harness parser AGREE -- on valid answers and on every kind of invalid one', () => {
    const cases: Array<[string, unknown]> = [
      ['valid selected', JSON.parse(raw('01.rate-comparison.paa'))], ['valid constructed', JSON.parse(raw('02.rate-comparison.ib-p1'))],
      ['member missing', JSON.parse(raw('01.rate-comparison.paa', (w) => { delete w.item.rationale; }))],
      ['member added', JSON.parse(raw('01.rate-comparison.paa', (w) => { w.item.extra = 1; }))],
      ['nested member missing', JSON.parse(raw('02.rate-comparison.ib-p1', (w) => { delete answersOf(w)[0].commandTerm; }))],
      ['nested member added', JSON.parse(raw('02.rate-comparison.ib-p1', (w) => { answersOf(w)[1].hint = 'x'; }))],
      ['wrong type', JSON.parse(raw('01.rate-comparison.paa', (w) => { w.item.stem = 3; }))],
      ['number where integer', JSON.parse(raw('02.rate-comparison.ib-p1', (w) => { answersOf(w)[0].marks = 1.5; }))],
      ['null where not allowed', JSON.parse(raw('01.rate-comparison.paa', (w) => { w.item.options = null; }))],
      ['null where allowed', JSON.parse(raw('01.rate-comparison.paa', (w) => { w.item.answerKey = null; }))],
      ['value outside enum', JSON.parse(raw('01.rate-comparison.paa', (w) => { w.item.responseKind = 'ESSAY'; }))],
      ['nullable enum, bad value', JSON.parse(raw('02.rate-comparison.ib-p1', (w) => { answersOf(w)[0].comparisonOperator = '!='; }))],
      ['array where boolean', JSON.parse(raw('02.rate-comparison.ib-p1', (w) => { answersOf(w)[0].comparisonHolds = []; }))],
      ['stimulus object, valid', JSON.parse(raw('01.rate-comparison.paa', (w) => { w.stimulus = { text: null, tables: [{ tableKey: 't', title: 'T', columns: [{ key: 'a', label: 'A', type: 'NUMBER', unit: null }], rows: [[1], ['x']] }], dataSets: [], charts: [] }; }))],
      ['stimulus cell of a wrong type', JSON.parse(raw('01.rate-comparison.paa', (w) => { w.stimulus = { text: null, tables: [{ tableKey: 't', title: 'T', columns: [], rows: [[true]] }], dataSets: [], charts: [] }; }))],
      ['not an object', 'text'],
    ];
    for (const [name, value] of cases) expect(jsonValid(SPECIFICATION_PROVIDER_JSON_SCHEMA.schema, value), name).toBe(SpecificationWireResponseSchema.safeParse(value).success);
    expect(cases.filter(([, v]) => SpecificationWireResponseSchema.safeParse(v).success).map(([n]) => n)).toEqual(['valid selected', 'valid constructed', 'null where allowed', 'stimulus object, valid']);
    expect(() => parseSpecificationWireResponse('{')).toThrow(/PROVIDER_RESPONSE_NOT_JSON/);
    expect(r2eMalformedCodeOf(raw('01.rate-comparison.paa', (w) => { delete w.item.rationale; }))).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(r2eMalformedCodeOf(raw('01.rate-comparison.paa'))).toBeNull();
  });
  it('the flat answer is normalised into the same candidate contract, deterministically, with complete lineage', async () => {
    const a = await generate('02.rate-comparison.ib-p1');
    expect(JSON.stringify(await generate('02.rate-comparison.ib-p1'))).toBe(JSON.stringify(a));
    const c = a.candidate;
    expect([c.responseFormat, c.marks, c.content.constructed!.parts.map((p) => [p.label, p.commandTerm, p.marks])]).toEqual(['SHORT_RESPONSE', 5, [['a', 'calculate', 2], ['b', 'find', 2], ['c', 'write down', 1]]]);
    expect(c.content.constructed!.parts[0].numericKey).toEqual({ kind: 'NUMERIC', value: '2.5', equivalentFormsAllowed: true });
    expect(c.content.declaredModel.parameters).toEqual({ p1: 24, q1: 60, p2: 35, q2: 70 });
    expect(c.lineage.learningApproach).toEqual({ recordedAs: 'STANDARD_BY_ABSENCE' });
    expect(c.lineage.componentProfile!.versionBinding!.targetType).toBe('EXAM_VERSION');
    const sel = (await generate('01.rate-comparison.paa')).candidate;
    expect([sel.instruction, sel.content.selected!.answerKey, Object.keys(sel.content.selected!.distractors).sort()]).toEqual(['Selecciona la única opción correcta.', 'A', ['B', 'C', 'D']]);
    expect(() => normalizeWireResponse(parseSpecificationWireResponse(raw('01.rate-comparison.paa', (w) => { answersOf(w)[0].targetCode = null; })))).toThrow(/RESPONSE_WIRE_INCONSISTENT/);
  });
  it('generator-side refusals, each by name: marks, command terms, a quantity without its number, leaked vocabulary, a misfit', async () => {
    const K = '02.rate-comparison.ib-p1';
    expect(await refusal(K, (w) => { answersOf(w)[0].marks = 6; (answersOf(w)[0].markPoints as Array<{ marks: number }>)[0].marks = 5; })).toBe('RESPONSE_MARKS_OUTSIDE_SPECIFICATION');
    expect(await refusal(K, (w) => { w.item.answers = [answersOf(w)[2]].map((a) => ({ ...a, label: 'a' })); })).toBe('RESPONSE_MARKS_OUTSIDE_SPECIFICATION');
    expect(await refusal(K, (w) => { w.item.creditLevels = [{ code: 'FULL_CREDIT', description: 'x' }, { code: 'NO_CREDIT', description: 'y' }]; })).toBe('RESPONSE_MARKS_OUTSIDE_SPECIFICATION');
    expect(await refusal(K, (w) => { answersOf(w)[2].commandTerm = 'state'; })).toBe('RESPONSE_COMMAND_TERM_NOT_IN_SPECIFICATION');
    expect(await refusal(K, (w) => { answersOf(w)[2].commandTerm = null; })).toBe('RESPONSE_COMMAND_TERM_NOT_IN_SPECIFICATION');
    expect(await refusal(K, (w) => { answersOf(w)[0].numericValue = null; })).toBe('RESPONSE_QUANTITY_TARGET_WITHOUT_A_NUMERIC_VALUE');
    expect(await refusal(K, (w) => { answersOf(w)[1].prompt = 'Find the difference between the two rates, r1 - r2.'; })).toBe('RESPONSE_LEAKS_SPECIFICATION_VOCABULARY');
    expect(await refusal(K, (w) => { answersOf(w)[2].prompt = 'INTERPRET: write down which supplier is better.'; })).toBe('RESPONSE_LEAKS_SPECIFICATION_VOCABULARY');
    expect(await refusal(K, (w) => { answersOf(w)[0].label = 'c'; })).toBe('RESPONSE_CONTENT_INVALID');
    expect(await refusal('01.rate-comparison.paa', (w) => { w.item.answerKey = 'E'; })).toBe('RESPONSE_KEY_IS_NOT_AN_OPTION');
    expect(await refusal('01.rate-comparison.paa', (w) => { (w.item.distractors as unknown[]).pop(); })).toBe('RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS');
    expect(await refusal('01.rate-comparison.paa', (w) => { w.item.commandTermX = 1; })).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(await refusal('01.rate-comparison.paa', (w) => { w.stimulus = { text: 'x', tables: [], dataSets: [], charts: [] }; })).toBe('RESPONSE_UNEXPECTED_STIMULUS');
    expect(await refusal('01.rate-comparison.paa', (w) => { w.item.responseKind = 'NUMERIC'; w.item.options = []; w.item.distractors = []; w.item.answerKey = null; answersOf(w)[0].numericValue = '1'; })).toBe('RESPONSE_KIND_IS_NOT_THE_FORMATS');
  });
  it('version 2 generates only from a specification that states its marks, only twice, and only dev-test content', () => {
    const old = storedR2dSelection()[0].specification;
    const code = (f: () => unknown) => { try { f(); return 'NO_ERROR'; } catch (e) { return (e as SpecificationGenerationV2Error).code; } };
    const base = inputOf('01.rate-comparison.paa');
    const provider = new RecordedResponseProvider('r', MODEL, {});
    expect(code(() => renderSpecificationPromptV2({ ...base, unit: { ...base.unit, specification: old }, policy: r2ePolicyFor(MODEL, old.variable.language), constructVocabulary: constructVocabularyOf((old.invariants.construct as { construct: string }).construct), provider }))).toBe('SPECIFICATION_HAS_NO_MARKS');
    expect(code(() => renderSpecificationPromptV2({ ...base, unit: { ...base.unit, attempt: 3 }, provider }))).toBe('ATTEMPT_INVALID');
    expect(code(() => renderSpecificationPromptV2({ ...base, constructVocabulary: null, provider }))).toBe('CONSTRUCT_VOCABULARY_MISSING');
    expect(renderSpecificationPromptV2({ ...inputOf('01.rate-comparison.paa', 2), provider }).promptHash).not.toBe(renderSpecificationPromptV2({ ...base, provider }).promptHash);
  });
});

describe('HARDENING, at the template and specification layer', () => {
  it('the item-writing rules reach every prompt; the selected-response template asks for a result and parallel options', () => {
    expect(ITEM_WRITING_RULES_V2.map((r) => r.split('.')[0])).toEqual(['LEARNER TEXT', 'PLAUSIBLE SITUATION', 'NOTHING HANDED OVER', 'NEW NUMBERS']);
    expect(TEMPLATE_V2_SELECTED.task).toMatch(/RESULT or a DECISION/);
    expect(TEMPLATE_V2_SELECTED.task).toMatch(/PARALLEL/);
    expect(TEMPLATE_V2_SELECTED.task).toMatch(/no option shows working/);
    expect(TEMPLATE_V2_CONSTRUCTED.task).toMatch(/never forced onto a part it does not fit/);
    const p = renderSpecificationPromptV2({ ...inputOf('15.quadratic-optimum.ib-p1'), provider: new RecordedResponseProvider('r', MODEL, {}) }).prompt.instruction;
    expect(p.itemWritingRules).toEqual(ITEM_WRITING_RULES_V2);
    expect(p.constructIntegrity).toEqual(CONSTRUCT_INTEGRITY.QUADRATIC_MODEL_VERTEX_OPTIMUM);
    expect(p.constructIntegrity.join(' ')).toMatch(/two linear factors written as expressions/);
    // the family's own description of the situation is in the specification the provider reads
    expect((p.specification.variable as AdaptationSpecification['variable']).context.situation).toMatch(/measured quantity|rises and then falls/i);
    // a template holds structure only: no number of a subject, no topic, no examination board
    for (const t of SPECIFICATION_TEMPLATE_REGISTRY_V2) expect(t.task, t.id).not.toMatch(/\d{2,}|quadratic|probab|proportion|IB\b|Cambridge|PAA|PISA|Icfes/i);
  });
  it('every construct has its "must not be handed over" list', () => {
    expect(Object.keys(CONSTRUCT_INTEGRITY).sort()).toEqual(MATH_CONSTRUCT_VOCABULARY.map((v) => v.construct).sort());
    expect(Object.values(CONSTRUCT_INTEGRITY).every((l) => l.length >= 1)).toBe(true);
  });
});

describe('VALIDATORS REVISION 3 = revision 2, unrelaxed, plus additions', () => {
  it('a clean item passes every gate; revision 2\'s own result is carried inside, untouched', async () => {
    for (const key of ['01.rate-comparison.paa', '02.rate-comparison.ib-p1']) {
      const { r, v } = await scored(key);
      expect(v.gates, key).toEqual({ structural: 'PASS', profileCompliance: 'PASS', constructPreservation: 'PASS', answerKey: 'DETERMINISTIC_RULE_VERIFIED', machineRecomputation: key.startsWith('01') ? 'NOT_APPLICABLE' : 'PASS', stimulusIntegrity: 'NOT_APPLICABLE', originality: 'PASS_LOW_SIMILARITY', lineage: 'PASS', learnerTextLeakage: 'PASS', itemWriting: 'PASS' });
      expect(v.additions).toEqual({ marks: [], commandTerms: [], handedOver: [], leakage: [], itemWritingFlags: [] });
      expect(JSON.stringify(v.revision2)).toBe(JSON.stringify(validateSpecificationCandidate({ candidate: r.candidate, specification: specOf(key), stimulus: r.stimulus, siblings: [r.candidate] })));
      expect([v.validatorsRevision, v.kind, v.isHumanReview, v.reviewStatus]).toEqual([3, 'AUTOMATED_VALIDATION', false, 'BLOCKED_NO_QUALIFIED_REVIEWER']);
    }
  });
  it('NEVER BETTER than revision 2: every revision-2 failure is a revision-3 failure of the same gate', async () => {
    const cases: Array<[string, (w: Wire) => void]> = [
      ['01.rate-comparison.paa', (w) => { answersOf(w)[0].verdictValue = 'OPTION_2'; }],
      ['01.rate-comparison.paa', (w) => { (w.item.parameters as Array<{ value: number }>)[0].value = 900; }],
      ['01.rate-comparison.paa', (w) => { w.item.construct = 'DIRECT_PROPORTION_MISSING_VALUE'; }],
      ['02.rate-comparison.ib-p1', (w) => { answersOf(w)[0].numericValue = '3'; answersOf(w)[0].arithmeticExpression = '3'; }],
      ['02.rate-comparison.ib-p1', (w) => { answersOf(w)[0].arithmeticExpression = '60 / 24 > 2'; }],
    ];
    for (const [key, mutate] of cases) {
      const { v } = await scored(key, mutate);
      const r2 = v.revision2;
      if (r2.structural.outcome === 'FAIL') expect(v.gates.structural).toBe('FAIL');
      if (r2.profileCompliance.outcome === 'FAIL') expect(v.gates.profileCompliance).toBe('FAIL');
      if (r2.constructPreservation.outcome === 'FAIL') expect(v.gates.constructPreservation).toBe('FAIL');
      expect(v.gates.answerKey).toBe(r2.answerKey.outcome);
      expect([r2.structural.outcome, r2.profileCompliance.outcome, r2.constructPreservation.outcome, r2.answerKey.outcome].some((o) => o === 'FAIL' || o === 'FAILED'), key).toBe(true);
    }
  });
  const withParts = (c: SpecificationCandidate, f: (parts: NonNullable<SpecificationCandidate['content']['constructed']>['parts']) => void): SpecificationCandidate => { const copy = JSON.parse(JSON.stringify(c)) as SpecificationCandidate; f(copy.content.constructed!.parts); copy.content.constructed!.totalMarks = copy.content.constructed!.parts.reduce((n, p) => n + p.marks, 0); copy.marks = copy.content.constructed!.totalMarks; return copy; };
  it('MARKS against the specification: total, number of parts, scoring, kinds of mark point, credit levels', async () => {
    const c = (await generate('02.rate-comparison.ib-p1')).candidate;
    const s = specOf('02.rate-comparison.ib-p1');
    expect(marksIssues(c, s)).toEqual([]);
    expect(marksIssues(withParts(c, (p) => { p[0].marks = 7; }), s)).toEqual(['TOTAL_MARKS_OUTSIDE_SPECIFICATION:10 not in [2, 8]']);
    expect(marksIssues(withParts(c, (p) => { p.push({ ...p[2], label: 'd' }, { ...p[2], label: 'e' }); }), s)).toEqual(['PART_COUNT_OUTSIDE_SPECIFICATION:5 not in [1, 4]']);
    expect(marksIssues(withParts(c, (p) => { (p[0].markScheme[0] as { kind: string }).kind = 'CREDIT'; }), s)).toEqual(['MARK_POINT_KIND_NOT_IN_SPECIFICATION:CREDIT']);
    expect(marksIssues({ ...c, content: { ...c.content, credit: [{ code: 'FULL_CREDIT', description: 'x' }, { code: 'NO_CREDIT', description: 'y' }] } }, s)).toEqual(['CREDIT_LEVELS_NOT_IN_SPECIFICATION']);
    expect(marksIssues({ ...c, marks: 4 }, s)).toEqual(['MARKS_RESTATED_ARE_NOT_THE_ITEMS:4/5']);
    // a constructed item against a closed specification, and the reverse
    expect(marksIssues(c, specOf('01.rate-comparison.paa'))).toEqual(expect.arrayContaining(['TOTAL_MARKS_OUTSIDE_SPECIFICATION:5 not in [1, 1]', 'SCORING_IS_NOT_THE_SPECIFICATIONS:SINGLE_KEYED_UNIT']));
    const closed = (await generate('01.rate-comparison.paa')).candidate;
    expect(marksIssues(closed, s)).toEqual(expect.arrayContaining(['TOTAL_MARKS_OUTSIDE_SPECIFICATION:1 not in [2, 8]', 'SCORING_IS_NOT_THE_SPECIFICATIONS:MARKED_PARTS']));
    expect(marksIssues(closed, specOf('04.rate-comparison.pisa'))).toEqual(['CREDIT_LEVELS_REQUIRED_BY_SPECIFICATION_MISSING']);
    expect(marksIssues(closed, storedR2dSelection()[0].specification)).toEqual(['SPECIFICATION_STATES_NO_MARKS']);
    expect(validateSpecificationCandidateR3({ candidate: withParts(c, (p) => { p[0].marks = 7; (p[0].markScheme[0] as { marks: number }).marks = 6; }), specification: s, stimulus: null, siblings: [] }).gates.profileCompliance).toBe('FAIL');
  });
  it('COMMAND TERMS per part: present, allowed by the specification, and at the head of the part\'s prompt', async () => {
    const c = (await generate('02.rate-comparison.ib-p1')).candidate;
    const s = specOf('02.rate-comparison.ib-p1');
    expect(commandTermIssues(c, s)).toEqual([]);
    expect(commandTermIssues(withParts(c, (p) => { p[2].commandTerm = 'state'; }), s)).toEqual(['COMMAND_TERM_NOT_ALLOWED_BY_SPECIFICATION:c=state']);
    expect(commandTermIssues(withParts(c, (p) => { p[1].commandTerm = null; }), s)).toEqual(['PART_WITHOUT_A_COMMAND_TERM:b']);
    expect(commandTermIssues(withParts(c, (p) => { p[1].prompt = 'What is the difference between the two rates? Find it.'; }), s)).toEqual(['PART_PROMPT_DOES_NOT_BEGIN_WITH_ITS_COMMAND_TERM:b=find']);
    expect(commandTermIssues(withParts(c, (p) => { p[2].commandTerm = 'find'; }), s)).toEqual(['PART_PROMPT_DOES_NOT_BEGIN_WITH_ITS_COMMAND_TERM:c=find']);
    // a specification without a vocabulary: a part may not carry a term; a closed item has no parts and nothing to check
    expect(commandTermIssues(c, specOf('06.approach.school.standard'))).toEqual(['COMMAND_TERM_GIVEN_BUT_SPECIFICATION_HAS_NONE:a', 'COMMAND_TERM_GIVEN_BUT_SPECIFICATION_HAS_NONE:b', 'COMMAND_TERM_GIVEN_BUT_SPECIFICATION_HAS_NONE:c']);
    expect(commandTermIssues((await generate('01.rate-comparison.paa')).candidate, specOf('01.rate-comparison.paa'))).toEqual([]);
    expect(validateSpecificationCandidateR3({ candidate: withParts(c, (p) => { p[2].commandTerm = 'state'; }), specification: s, stimulus: null, siblings: [] }).gates.profileCompliance).toBe('FAIL');
  });
  it('LEARNER_TEXT_SPECIFICATION_LEAKAGE: codes, parameter symbols and internal phrases, in every text a learner reads', async () => {
    const c = (await generate('02.rate-comparison.ib-p1')).candidate;
    const s = specOf('02.rate-comparison.ib-p1');
    const stem = (text: string): SpecificationCandidate => ({ ...c, content: { ...c.content, stem: text } });
    expect(leakedSpecificationVocabulary(c, s, null)).toEqual([]);
    expect(leakedSpecificationVocabulary(stem(`${c.content.stem} Compare r1 and r2, where q1 = 60.`), s, null)).toEqual(['q1', 'r1', 'r2']);
    // r1 and r2 are not parameters of the vocabulary: they are symbols of the construct's own variables, and leak just the same
    expect(leakedSpecificationVocabulary(stem(`${c.content.stem} SOLVE and INTERPRET.`), s, null)).toEqual(['INTERPRET', 'SOLVE']);
    expect(leakedSpecificationVocabulary(stem(`${c.content.stem} The answer is OPTION_1 (UNIT_RATE_1).`), s, null)).toEqual(['OPTION_1', 'UNIT_RATE_1']);
    expect(leakedSpecificationVocabulary(stem('A scientific model has a free measure x.'), s, null)).toEqual(['free measure']);
    expect(leakedSpecificationVocabulary(stem('Consider the equation generated with parameters a = 2.'), s, null)).toEqual(['generated with parameters']);
    expect(LEAKAGE_RULE.internalPhrases).toContain('medida libre');
    // words that only look alike are not leaks: a Spanish word in capitals, a plain number, a one-letter symbol
    expect(leakedSpecificationVocabulary(stem('FORMULA una estrategia para elegir entre x = 3 y la opción 1.'), s, null)).toEqual([]);
    // the stimulus is learner text too (revision 2 did not look there)
    const stimulus = { stimulusKey: 's', kind: 'TABLE' as const, language: 'en', parts: [{ label: null, partKind: 'TEXT' as const, text: 'Values vi and vj are listed.' }], provenance: 'STUDYUS_GENERATED' as const, structured: { v: 1 as const, tables: [{ tableKey: 't', title: 'RELATIVE_CHANGE_PERCENT by year', columns: [{ key: 'y', label: 'Year', type: 'TEXT' as const, unit: null }], rows: [['2020']] }], dataSets: [], charts: [], figures: [] } };
    expect(leakedSpecificationVocabulary(c, specOf('20.data-relative-change.cambridge-p1'), stimulus)).toEqual(['RELATIVE_CHANGE_PERCENT', 'vi', 'vj']);
    // the mark scheme and the rationale are not learner text
    expect(leakedSpecificationVocabulary(withParts(c, (p) => { p[0].markScheme[0].criterion = 'Forms r1 = q1 / p1 (SOLVE).'; }), s, null)).toEqual([]);
    const v = validateSpecificationCandidateR3({ candidate: stem(`${c.content.stem} SOLVE it.`), specification: s, stimulus: null, siblings: [] });
    expect([v.gates.learnerTextLeakage, v.additions.leakage]).toEqual(['FAIL', ['SOLVE']]);
  });
  it('HANDED OVER: a root stated in the stem, both linear factors written out, the model to be formulated written out', () => {
    const quad = specOf('13.quadratic-factorising.cambridge-p1');
    const item = (specification: AdaptationSpecification, construct: string, parameters: Record<string, number>, stem: string, prompts: string[] = []): SpecificationCandidate => ({ content: { stem, declaredModel: { construct, parameters }, selected: null, numeric: null, constructed: prompts.length ? { parts: prompts.map((prompt, i) => ({ label: 'abc'[i], prompt, marks: 1, markScheme: [], finalAnswer: 'x', numericKey: null, target: { kind: 'NOT_MACHINE_CHECKABLE', reason: 'not relevant here' }, answerCheck: { kind: 'NOT_COMPUTABLE', reason: 'not relevant here' } })), totalMarks: prompts.length, workingOutline: ['x'] } : null }, specificationId: specification.specificationId } as unknown as SpecificationCandidate);
    const Q = 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING';
    expect(handedOverIssues(item(quad, Q, { a: 2, r1: 3, r2: -1 }, 'Consider 2x^2 - 4x - 6 = 0, one of whose solutions is x = 3.'), quad)).toEqual(['A_ROOT_IS_STATED_TO_THE_LEARNER']);
    expect(handedOverIssues(item(quad, Q, { a: 2, r1: 3, r2: -1 }, 'Work out the solutions of 2x^2 - 4x - 6 = 0.'), quad)).toEqual([]);
    expect(handedOverIssues(item(quad, Q, { a: 2, r1: 3, r2: -1 }, 'It is known that x = 5 is not a solution of 2x^2 - 4x - 6 = 0.'), quad)).toEqual([]);
    const opt = specOf('15.quadratic-optimum.ib-p1');
    const V = 'QUADRATIC_MODEL_VERTEX_OPTIMUM';
    expect(handedOverIssues(item(opt, V, { p: 20, q: 4, r: 100, s: 2 }, 'The two contributing factors are 20 + 4x and 100 - 2x.'), opt)).toEqual(['BOTH_LINEAR_FACTORS_ARE_WRITTEN_OUT_FOR_THE_LEARNER']);
    expect(handedOverIssues(item(opt, V, { p: 20, q: 4, r: 100, s: 2 }, 'A grower has 20 trees; each tree added lowers the yield of 100 fruit per tree by 2.', ['Find the number of trees to add.']), opt)).toEqual([]);
    expect(handedOverIssues(item(opt, V, { p: 20, q: 1, r: 100, s: 2 }, 'The yield is (20 + n)(100 - 2n).'), opt)).toEqual(['BOTH_LINEAR_FACTORS_ARE_WRITTEN_OUT_FOR_THE_LEARNER']);
    const lin = specOf('11.linear-model.ib-p2');
    const L = 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE';
    expect(handedOverIssues(item(lin, L, { b: 40, m: 3, x: 12 }, 'The volume is given by V = 40 + 3t.', ['Find V when t = 12.']), lin)).toEqual(['THE_MODEL_TO_BE_FORMULATED_IS_WRITTEN_OUT_FOR_THE_LEARNER']);
    expect(handedOverIssues(item(lin, L, { b: 40, m: 3, x: 12 }, 'A tank holds 40 litres and gains 3 litres per minute.', ['Find an expression for V in terms of t.']), lin)).toEqual([]);
  });
  it('ITEM_WRITING is a heuristic, named as one: an obvious key, options that are not parallel, a stem that asks which option is well formed', async () => {
    expect(ITEM_WRITING_HEURISTIC.rule).toMatch(/A flag is a reason for a person to look, not a verdict/);
    const c = (await generate('01.rate-comparison.paa')).candidate;
    const options = (texts: string[], stem = c.content.stem): SpecificationCandidate => ({ ...c, content: { ...c.content, stem, selected: { ...c.content.selected!, options: texts.map((text, i) => ({ id: 'ABCD'[i], text })) } } });
    expect(itemWritingFlags(c)).toEqual([]);
    expect(itemWritingFlags(options(['El paquete 1: 15/6 = 2,5 porciones por dólar frente a 2', 'El paquete 2', 'Los dos por igual', 'Ninguno de los dos']))).toEqual(['KEY_UNIQUELY_OBVIOUS', 'OPTIONS_NOT_PARALLEL']);
    expect(itemWritingFlags(options(['El paquete 1, que ofrece claramente más porciones por cada dólar gastado', 'El paquete 2', 'Los dos', 'Ninguno']))).toEqual(['KEY_UNIQUELY_OBVIOUS', 'OPTIONS_NOT_PARALLEL']);
    expect(itemWritingFlags(options(['2,5', '15/6 = 2', '3', '0,4']))).toEqual(['OPTIONS_NOT_PARALLEL']);
    expect(itemWritingFlags(options(['El paquete 1', 'El paquete 2', 'Los dos por igual', 'Ninguno de los dos'], '¿Qué opción formula correctamente la relación e interpreta sus parámetros?'))).toEqual(['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED']);
    expect(itemWritingFlags(options(['El paquete 1', 'El paquete 2', 'Los dos por igual', 'Ninguno de los dos'], '¿Qué comparación de proporcionalidad es correcta?'))).toEqual(['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED']);
    expect(itemWritingFlags(options(['Supplier 1', 'Supplier 2', 'Both', 'Neither'], 'Which option correctly compares the two unit rates?'))).toEqual(['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED']);
    // a constructed response has no options: nothing to flag
    expect(itemWritingFlags((await generate('02.rate-comparison.ib-p1')).candidate)).toEqual([]);
    const v = validateSpecificationCandidateR3({ candidate: options(['2,5', '15/6 = 2', '3', '0,4']), specification: specOf('01.rate-comparison.paa'), stimulus: null, siblings: [] });
    expect(v.gates.itemWriting).toBe('FLAGGED');
  });
  it('PINNED on the stored QB-R2D batch: the additions find exactly the defects the QB-R2D reading found, and nothing else moves', () => {
    const specs = new Map(storedR2dSelection().map((s) => [s.specification.specificationId, s.specification]));
    const batch = r2dCandidates(ROOT);
    expect(batch).toHaveLength(26);
    const by = (f: (c: SpecificationCandidate, s: AdaptationSpecification) => string[]) => Object.fromEntries(batch.map((c) => [c.unitKey, f(c, specs.get(c.specificationId)!)] as const).filter(([, v]) => v.length > 0));
    expect(by((c, s) => leakedSpecificationVocabulary(c, s, null))).toEqual({ '10.quadratic-factorising.ib-p1#a2': ['generated with parameters', 'r1', 'r2'], '11.quadratic-optimum.ib-p2#a2': ['free measure'], '15.data-relative-change.ib-p2#a1': ['vi', 'vj'], '15.data-relative-change.ib-p2#a2': ['vi', 'vj'], '17.approach.school.stem-plus#a1': ['INTERPRET', 'SOLVE'] });
    expect(by((c, s) => handedOverIssues(c, s))).toEqual({ '10.quadratic-factorising.ib-p1#a2': ['A_ROOT_IS_STATED_TO_THE_LEARNER'] });
    expect(by((c) => itemWritingFlags(c))).toEqual({
      '01.linear-model.paa#a1': ['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED'], '05.linear-model.pisa#a1': ['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED'], '06.linear-model.icfes#a1': ['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED'],
      '08.proportion-rate-comparison.pisa#a1': ['OPTIONS_NOT_PARALLEL'], '16.approach.school.standard#a1': ['OPTIONS_NOT_PARALLEL'], '18.approach.paa.standard#a1': ['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED'],
      '19.approach.paa.stem-plus#a1': ['KEY_UNIQUELY_OBVIOUS', 'OPTIONS_NOT_PARALLEL'], '20.approach.pisa.stem-plus#a2': ['STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED'],
    });
    // QB-R2D is NOT rescored as evidence: its stored report is revision 2's, and says so by having no revision-3 field
    expect(read('docs/exams/question-bank/pilots/qb-r2d/automated-validation-report.json')).not.toMatch(/validatorsRevision|learnerTextLeakage/);
  });
});

describe('the PRE-REGISTERED gates: definitions and evaluator', () => {
  const PASS = { structural: 'PASS', profileCompliance: 'PASS', constructPreservation: 'PASS', answerKey: 'MACHINE_VERIFIED', machineRecomputation: 'PASS', stimulusIntegrity: 'NOT_APPLICABLE', originality: 'PASS_LOW_SIMILARITY', lineage: 'PASS', learnerTextLeakage: 'PASS', itemWriting: 'PASS' } as const;
  type G = NonNullable<AttemptResult['gates']>;
  const cand = (over: Partial<G> = {}, attempt: 1 | 2 = 1): AttemptResult => ({ attempt, status: 'CANDIDATE', refusalCode: null, gates: { ...PASS, ...over } as G });
  const none = (status: AttemptResult['status'], attempt: 1 | 2 = 1, refusalCode: string | null = null): AttemptResult => ({ attempt, status, refusalCode, gates: null });
  const ad = (first: AttemptResult, second: AttemptResult | null = null, hasStimulus = false): AdaptationResult => ({ selectionKey: 'k', hasStimulus, first, second, finalGates: (second ?? first).gates });
  const evaluate = (adaptations: AdaptationResult[], over: Partial<Parameters<typeof evaluateGates>[0]> = {}) => evaluateGates({ adaptations, sameFamilyProof: 'PASS', approachProof: 'PASS', maxAttemptsObserved: adaptations.some((a) => a.second) ? 2 : 1, artifactsAreAReplay: true, runVoid: false, ...over });
  const twenty = (f: (i: number) => AdaptationResult) => Array.from({ length: 20 }, (_, i) => f(i));
  const of = (e: ReturnType<typeof evaluate>, c: string) => e.criteria.find((x) => x.criterion === c)!;

  it('the criteria are the Orchestrator\'s, with their thresholds, and every lane choice is listed', () => {
    expect(Object.fromEntries(Object.entries(PRE_REGISTRATION.criteria).map(([k, v]) => [k, `${v.comparator} ${v.threshold}${v.of === 20 ? '/20' : ''}`]))).toEqual({
      FIRST_ATTEMPT_STRICT_PASS: '>= 16/20', STRUCTURAL_COMPLIANCE: '= 20/20', PROFILE_COMPLIANCE: '= 20/20', ANSWER_VALIDATION_FAILURES: '= 0', CONSTRUCT_PRESERVATION_FAIL: '= 0/20', CONSTRUCT_PRESERVATION_WEAK: '<= 2/20', LINEAGE_COMPLETENESS: '= 20/20',
      STIMULUS_INTEGRITY: '= ALL_APPLICABLE', ORIGINALITY_MATERIAL_FAILURES: '= 0/20', MULTI_PROFILE_SAME_FAMILY_PROOF: '= PASS', STANDARD_VS_STEM_PLUS_PROOF: '= PASS', LEARNER_TEXT_SPECIFICATION_LEAKAGE: '= 0', MAX_REGENERATIONS_PER_ADAPTATION: '<= 1', NO_MANUAL_CONTENT_REPAIR: '= TRUE',
    });
    expect(Object.keys(PRE_REGISTRATION.definitions).sort()).toEqual(['ADAPTATION', 'ANSWER_FAILURE_COUNT', 'APPROACH_PROOF', 'ATTEMPT_1', 'ATTEMPT_2', 'CLEAN_ITEM_FOR_A_PROOF', 'FINAL_ATTEMPT', 'GATE_FAIL', 'LEAKAGE_COUNT', 'MATERIAL_ORIGINALITY_FAILURE', 'NO_CANDIDATE', 'NO_MANUAL_REPAIR', 'PER_ITEM_CRITERIA', 'REGENERABLE', 'REQUEST_REJECTED', 'SAME_FAMILY_PROOF', 'SIBLINGS_FOR_ORIGINALITY', 'STRICT_PASS']);
    expect(PRE_REGISTRATION.choices.length).toBe(10);
    expect(PRE_REGISTRATION.verdict).toMatch(/YES only when EVERY criterion above passes/);
  });
  it('STRICT_PASS, GATE_FAIL and REGENERABLE are what the definitions say', () => {
    expect(isStrictPass(cand())).toBe(true);
    expect(isStrictPass(cand({ answerKey: 'HUMAN_REVIEW_REQUIRED', machineRecomputation: 'NOT_APPLICABLE', stimulusIntegrity: 'PASS' }))).toBe(true);
    for (const over of [{ constructPreservation: 'WEAK' }, { itemWriting: 'FLAGGED' }, { structural: 'FAIL' }, { profileCompliance: 'FAIL' }, { answerKey: 'FAILED' }, { originality: 'REVIEW_STRUCTURAL_SIMILARITY' }, { learnerTextLeakage: 'FAIL' }, { lineage: 'FAIL' }, { stimulusIntegrity: 'FAIL' }, { machineRecomputation: 'FAIL' }] as Array<Partial<G>>) expect(isStrictPass(cand(over)), JSON.stringify(over)).toBe(false);
    expect(isStrictPass(none('MALFORMED'))).toBe(false);
    // WEAK and FLAGGED are results, not failures: they are NOT regenerated
    expect([isRegenerable(cand({ constructPreservation: 'WEAK' })), isRegenerable(cand({ itemWriting: 'FLAGGED' })), isRegenerable(cand({ answerKey: 'HUMAN_REVIEW_REQUIRED' }))]).toEqual([false, false, false]);
    expect([isRegenerable(cand({ structural: 'FAIL' })), isRegenerable(cand({ originality: 'REJECT_TEXTUAL_SIMILARITY' })), isRegenerable(none('NO_CONTENT_RECEIVED')), isRegenerable(none('MALFORMED')), isRegenerable(none('REFUSED_BY_HARNESS'))]).toEqual([true, true, true, true, true]);
    expect(hasGateFail({ ...PASS } as G)).toBe(false);
  });
  it('the FINAL attempt is the regeneration when one was due -- even when it is worse, and even when it was never run', () => {
    expect(finalAttemptOf(ad(cand())).attempt).toBe(1);
    expect(finalAttemptOf(ad(cand({ structural: 'FAIL' }), cand({}, 2))).attempt).toBe(2);
    expect(finalAttemptOf(ad(cand({ structural: 'FAIL' }), none('MALFORMED', 2))).status).toBe('MALFORMED');
    expect(finalAttemptOf(ad(cand({ structural: 'FAIL' }))).status).toBe('NOT_RUN');
  });
  it('twenty clean first attempts: every criterion passes and the verdict is YES', () => {
    const e = evaluate(twenty(() => ad(cand())));
    expect(e.criteria.every((c) => c.pass)).toBe(true);
    expect([e.GENERATOR_READY_FOR_DEV_SCALE, e.GENERATOR_READY_FOR_PILOT_CONTENT, e.READY_FOR_BANK_INGESTION, e.QUESTION_BANK_READY]).toEqual(['YES', 'NO', 'NO', 'FAIL']);
    expect(e.criteria.map((c) => c.criterion)).toEqual(Object.keys(PRE_REGISTRATION.criteria));
  });
  it('FIRST_ATTEMPT_STRICT_PASS counts first attempts only: 16 passes, 15 does not, and a successful regeneration does not buy one back', () => {
    const mk = (strict: number) => twenty((i) => (i < strict ? ad(cand()) : ad(cand({ structural: 'FAIL' }), cand({}, 2))));
    expect([of(evaluate(mk(16)), 'FIRST_ATTEMPT_STRICT_PASS').pass, of(evaluate(mk(16)), 'FIRST_ATTEMPT_STRICT_PASS').observed, evaluate(mk(16)).GENERATOR_READY_FOR_DEV_SCALE]).toEqual([true, '16/20', 'YES']);
    expect([of(evaluate(mk(15)), 'FIRST_ATTEMPT_STRICT_PASS').pass, of(evaluate(mk(15)), 'STRUCTURAL_COMPLIANCE').observed, evaluate(mk(15)).GENERATOR_READY_FOR_DEV_SCALE]).toEqual([false, '20/20', 'NO']);
    // a WEAK or FLAGGED first attempt is not strict and is not regenerated: it costs a strict pass and nothing else of these
    const weak = evaluate(twenty((i) => (i < 5 ? ad(cand({ itemWriting: 'FLAGGED' })) : ad(cand()))));
    expect([of(weak, 'FIRST_ATTEMPT_STRICT_PASS').observed, weak.GENERATOR_READY_FOR_DEV_SCALE]).toEqual(['15/20', 'NO']);
  });
  it('each per-item criterion is measured on the FINAL attempt, and an adaptation with no final candidate fails every one of them', () => {
    const e = evaluate(twenty((i) => (i === 0 ? ad(none('MALFORMED'), none('REFUSED_BY_HARNESS', 2, 'RESPONSE_MARKS_OUTSIDE_SPECIFICATION'), true) : ad(cand()))));
    expect(Object.fromEntries(e.criteria.map((c) => [c.criterion, `${c.observed} ${c.pass}`]))).toMatchObject({
      FIRST_ATTEMPT_STRICT_PASS: '19/20 true', STRUCTURAL_COMPLIANCE: '19/20 false', PROFILE_COMPLIANCE: '19/20 false', ANSWER_VALIDATION_FAILURES: '1 false', CONSTRUCT_PRESERVATION_FAIL: '1 false', LINEAGE_COMPLETENESS: '19/20 false', STIMULUS_INTEGRITY: '0/1 false', ORIGINALITY_MATERIAL_FAILURES: '1 false',
    });
    expect(e.GENERATOR_READY_FOR_DEV_SCALE).toBe('NO');
    // a regeneration that is due and was not run is no candidate
    expect(of(evaluate(twenty((i) => (i === 0 ? ad(cand({ profileCompliance: 'FAIL' })) : ad(cand())))), 'PROFILE_COMPLIANCE').observed).toBe('19/20');
  });
  it('CONSTRUCT: no FAIL, and at most two WEAK among final attempts', () => {
    const weak = (n: number) => evaluate(twenty((i) => (i < n ? ad(cand({ constructPreservation: 'WEAK' })) : ad(cand()))));
    expect([of(weak(2), 'CONSTRUCT_PRESERVATION_WEAK').pass, of(weak(3), 'CONSTRUCT_PRESERVATION_WEAK').pass, of(weak(3), 'CONSTRUCT_PRESERVATION_WEAK').observed]).toEqual([true, false, '3/20']);
    const fail = evaluate(twenty((i) => (i === 0 ? ad(cand({ constructPreservation: 'FAIL' }), cand({ constructPreservation: 'FAIL' }, 2)) : ad(cand()))));
    expect(of(fail, 'CONSTRUCT_PRESERVATION_FAIL')).toMatchObject({ observed: '1', pass: false });
  });
  it('ANSWER failures and LEAKAGE are counted over ALL attempts, a harness refusal for leakage included', () => {
    const answer1 = evaluate(twenty((i) => (i === 0 ? ad(cand({ answerKey: 'FAILED' }), cand({}, 2)) : ad(cand()))));
    expect(of(answer1, 'ANSWER_VALIDATION_FAILURES')).toMatchObject({ observed: '1', pass: false });
    const leak1 = evaluate(twenty((i) => (i === 0 ? ad(cand({ learnerTextLeakage: 'FAIL' }), cand({}, 2)) : ad(cand()))));
    expect(of(leak1, 'LEARNER_TEXT_SPECIFICATION_LEAKAGE')).toMatchObject({ observed: '1', pass: false });
    const refused = evaluate(twenty((i) => (i === 0 ? ad(none('REFUSED_BY_HARNESS', 1, 'RESPONSE_LEAKS_SPECIFICATION_VOCABULARY'), cand({}, 2)) : ad(cand()))));
    expect([of(refused, 'LEARNER_TEXT_SPECIFICATION_LEAKAGE').observed, of(refused, 'STRUCTURAL_COMPLIANCE').observed, refused.GENERATOR_READY_FOR_DEV_SCALE]).toEqual(['1', '20/20', 'NO']);
  });
  it('STIMULUS, ORIGINALITY, the two proofs, the regeneration limit and the replay requirement each decide on their own', () => {
    const clean = () => twenty(() => ad(cand()));
    expect(of(evaluate(twenty((i) => (i < 3 ? ad(cand({ stimulusIntegrity: 'PASS' }), null, true) : ad(cand())))), 'STIMULUS_INTEGRITY')).toMatchObject({ observed: '3/3', pass: true });
    expect(of(evaluate(twenty((i) => (i === 0 ? ad(cand({ stimulusIntegrity: 'NOT_APPLICABLE' }), null, true) : ad(cand())))), 'STIMULUS_INTEGRITY')).toMatchObject({ observed: '0/1', pass: false });
    expect(of(evaluate(twenty((i) => (i === 0 ? ad(cand({ originality: 'REVIEW_STRUCTURAL_SIMILARITY' }), cand({ originality: 'REVIEW_STRUCTURAL_SIMILARITY' }, 2)) : ad(cand())))), 'ORIGINALITY_MATERIAL_FAILURES')).toMatchObject({ observed: '1', pass: false });
    expect(evaluate(clean(), { sameFamilyProof: 'FAIL' }).GENERATOR_READY_FOR_DEV_SCALE).toBe('NO');
    expect(evaluate(clean(), { approachProof: 'FAIL' }).GENERATOR_READY_FOR_DEV_SCALE).toBe('NO');
    expect(of(evaluate(clean(), { maxAttemptsObserved: 3 }), 'MAX_REGENERATIONS_PER_ADAPTATION').pass).toBe(false);
    // a regeneration of an attempt that was not regenerable breaks the rule
    expect(of(evaluate(twenty((i) => (i === 0 ? ad(cand({ itemWriting: 'FLAGGED' }), cand({}, 2)) : ad(cand())))), 'MAX_REGENERATIONS_PER_ADAPTATION').pass).toBe(false);
    expect(evaluate(clean(), { artifactsAreAReplay: false }).GENERATOR_READY_FOR_DEV_SCALE).toBe('NO');
    expect(evaluate(clean(), { runVoid: true }).GENERATOR_READY_FOR_DEV_SCALE).toBe('NOT_EVALUATED_RUN_VOID');
    // fewer than twenty adaptations can never satisfy a 20/20 criterion
    expect(evaluate(Array.from({ length: 19 }, () => ad(cand()))).GENERATOR_READY_FOR_DEV_SCALE).toBe('NO');
  });
});

describe('the CUMULATIVE budget: QB-R2D + QB-R2E <= USD 5.00, one call per attempt, no retry', () => {
  const prompt = { prompt: { system: 'system', instruction: { task: 'write' } }, promptHash: 'a'.repeat(64) };
  const transportOf = (answers: Array<string | Error>) => { const calls: number[] = []; const transport: R2eTransport = { providerId: 'fake', model: MODEL, complete: async (r) => { calls.push(r.maxOutputTokens); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; if (a instanceof Error) throw a; return { rawText: a, usage: { inputTokens: 3000, outputTokens: 1200, reasoningTokens: 300, cachedInputTokens: 0 }, servedModel: MODEL, responseId: 'r', finishReason: 'stop' }; } }; return { transport, calls }; };
  const providerOf = (transport: R2eTransport, ledger: R2eLedger, recordings: R2eRecording[] = [], capUsd: number = R2D_R2E_CUMULATIVE_CAP_USD, maxCalls: number = R2E_MAX_CALLS) => new CumulativeBudgetProvider({ transport, ledger, capUsd, guardPrice: GUARD_PRICE_BASIS, repoPrice: null, maxOutputTokens: R2E_MAX_OUTPUT_TOKENS, maxCalls, malformedCodeOf: r2eMalformedCodeOf, unitKeyOf: () => 'u#a1', now: () => NOW, onRecording: (r) => recordings.push(r) });
  const good = raw('01.rate-comparison.paa');

  it('the QB-R2D spend is loaded from its ledger, and the worst case of the whole plan fits under the cap', () => {
    const prior = r2dSpendUsdGuardBasis(ROOT);
    expect(prior).toBeCloseTo(1.550575, 6);
    expect([R2D_R2E_CUMULATIVE_CAP_USD, R2E_MAX_CALLS, R2E_MAX_OUTPUT_TOKENS, FREEZE_RUN_PARAMETERS.retries]).toEqual([5, 40, 2150, 0]);
    const first = plannedFirstAttempts(FREEZE_RUN_PARAMETERS.model, EVIDENCE);
    const worstFirst = first.reduce((n, u) => n + worstCaseCallUsd(u.system.length + u.user.length), 0);
    // 20 first calls + at most 20 regenerations (the same prompt but for one digit), no retries
    expect(prior + 2 * worstFirst).toBeLessThanOrEqual(5);
    expect(prior + 2 * worstFirst).toBeGreaterThan(4.5);
  });
  it('REFUSES the call that would take the cumulative spend past the cap, and makes no call', async () => {
    const { transport, calls } = transportOf([good]);
    const ledger = new R2eLedger(4.95);
    await expect(providerOf(transport, ledger).generate(prompt)).rejects.toBeInstanceOf(CumulativeBudgetExceededError);
    expect([calls.length, ledger.entries.map((e) => e.outcome), ledger.calls(), ledger.cumulativeUsdGuardBasis()]).toEqual([0, ['REFUSED_BY_BUDGET'], 0, 4.95]);
    // with the real prior spend a call is allowed, and its real cost is added to the cumulative figure
    const real = new R2eLedger(1.550575);
    const t = transportOf([good]);
    await providerOf(t.transport, real).generate(prompt);
    expect(real.entries[0]).toMatchObject({ outcome: 'WELL_FORMED', usageSource: 'PROVIDER_USAGE_RESPONSE', maxOutputTokens: 2150 });
    expect(real.entries[0].costUsdGuardBasis).toBeCloseTo(0.015 + 0.036, 9);
    expect(real.entries[0].cumulativeAfterUsdGuardBasis).toBeCloseTo(1.550575 + 0.051, 9);
    // the planned number of calls is a limit too
    const capped = new R2eLedger(0);
    const t2 = transportOf([good]);
    const p2 = providerOf(t2.transport, capped, [], 5, 1);
    await p2.generate(prompt);
    await expect(p2.generate(prompt)).rejects.toThrow(/CUMULATIVE_BUDGET_WOULD_BE_EXCEEDED/);
    expect(t2.calls.length).toBe(1);
  });
  it('NO RETRY: a malformed answer and a transport failure are each ONE call and a failed attempt; an unknown cost is charged at its worst case', async () => {
    const recordings: R2eRecording[] = [];
    const malformed = transportOf(['{"not":"the schema"}', good]);
    const l1 = new R2eLedger(0);
    const r = await providerOf(malformed.transport, l1, recordings).generate(prompt);
    expect([malformed.calls.length, r.rawText, l1.entries[0].outcome, recordings[0].status, recordings[0].malformedCode]).toEqual([1, '{"not":"the schema"}', 'MALFORMED', 'MALFORMED', 'PROVIDER_RESPONSE_SCHEMA_INVALID']);
    const down = transportOf([new Error('socket hang up'), good]);
    const l2 = new R2eLedger(0);
    await expect(providerOf(down.transport, l2, recordings).generate(prompt)).rejects.toThrow(/socket hang up/);
    expect([down.calls.length, l2.entries[0].outcome, l2.entries[0].usageSource, recordings[1].status, recordings[1].rawText]).toEqual([1, 'TRANSPORT_ERROR', 'NOT_REPORTED_CHARGED_AT_WORST_CASE', 'TRANSPORT_ERROR', '']);
    expect(l2.entries[0].costUsdGuardBasis).toBe(l2.entries[0].worstCaseCostUsdGuardBasis);
    expect(l2.entries[0].costUsdGuardBasis).toBeGreaterThan(0.06);
    // a rejected request is neither: it is named, so that the run can be declared void
    const rejected = transportOf([new RequestRejectedError(400, 'invalid schema')]);
    const l3 = new R2eLedger(0);
    await expect(providerOf(rejected.transport, l3, recordings).generate(prompt)).rejects.toBeInstanceOf(RequestRejectedError);
    expect([l3.entries[0].outcome, recordings[2].status]).toEqual(['REQUEST_REJECTED', 'REQUEST_REJECTED']);
  });
});

describe('the pipeline replays a recording into artifacts and gates, and decides the regenerations mechanically', () => {
  const FREEZE = { freezeCommitSha: 'abc1234', manifestHash: 'f'.repeat(64) };
  const recordingOf = (answers: Record<string, string | 'TRANSPORT_ERROR' | 'REQUEST_REJECTED'>, attempt: 1 | 2 = 1, into?: R2eRecordingFile): R2eRecordingFile => {
    const file: R2eRecordingFile = into ?? { kind: 'QB_R2E_RECORDED_LIVE_RESPONSES', label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT', freeze: FREEZE, run: { runId: 'synthetic-run', startedAt: NOW, provider: 'recorded:synthetic', requestedModel: MODEL, requestedBy: 'test', reasoningEffort: 'low', maxOutputTokens: 2150, responseMode: 'STRICT_JSON_SCHEMA', gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' }, responses: [] };
    for (const a of SELECTION) {
      const text = answers[a.selectionKey] ?? '{"malformed":true}';
      const unit = planUnit(a, attempt, MODEL, EVIDENCE);
      const none = text === 'TRANSPORT_ERROR' || text === 'REQUEST_REJECTED';
      if (attempt === 2 && answers[a.selectionKey] === undefined) continue;
      file.responses.push({ promptHash: unit.promptHash, unitKey: unit.unitKey, status: none ? (text as 'TRANSPORT_ERROR') : r2eMalformedCodeOf(text) ? 'MALFORMED' : 'WELL_FORMED', malformedCode: none ? null : r2eMalformedCodeOf(text), provider: 'recorded:synthetic', requestedModel: MODEL, servedModel: MODEL, responseId: 'r', finishReason: 'stop', recordedAt: NOW, usage: null, rawText: none ? '' : text });
    }
    return file;
  };
  it('two clean first attempts, one refused, the rest malformed: the report, the regenerations due and the gates follow by rule', async () => {
    const recording = recordingOf({ '01.rate-comparison.paa': raw('01.rate-comparison.paa'), '02.rate-comparison.ib-p1': raw('02.rate-comparison.ib-p1'), '03.rate-comparison.cambridge-p1': 'TRANSPORT_ERROR' });
    const due = await regenerationsDue(recording, EVIDENCE);
    // every adaptation whose first attempt gave no candidate is due exactly one regeneration; the two clean ones are not
    expect(due.map((u) => u.unitKey)).toEqual(SELECTION.slice(2).map((a) => `${a.selectionKey}#a2`));
    const out = await runQbR2e(recording, EVIDENCE);
    const rows = (out.report as { rows: Array<{ selectionKey: string; firstAttempt: { status: string; strictPass: boolean; regenerable: boolean }; regeneration: { status: string } | null; finalAttempt: number; finalStatus: string }> }).rows;
    expect(rows.slice(0, 3).map((r) => [r.firstAttempt.status, r.firstAttempt.strictPass, r.firstAttempt.regenerable, r.regeneration?.status ?? null, r.finalAttempt, r.finalStatus])).toEqual([['CANDIDATE', true, false, null, 1, 'CANDIDATE'], ['CANDIDATE', true, false, null, 1, 'CANDIDATE'], ['NO_CONTENT_RECEIVED', false, true, 'NOT_RUN', 2, 'NOT_RUN']]);
    expect(rows[5].firstAttempt.status).toBe('MALFORMED');
    const e = out.gates.evaluation;
    expect(Object.fromEntries(e.criteria.map((c) => [c.criterion, c.observed]))).toMatchObject({ FIRST_ATTEMPT_STRICT_PASS: '2/20', STRUCTURAL_COMPLIANCE: '2/20', ANSWER_VALIDATION_FAILURES: '18', LEARNER_TEXT_SPECIFICATION_LEAKAGE: '0', MULTI_PROFILE_SAME_FAMILY_PROOF: 'FAIL', STANDARD_VS_STEM_PLUS_PROOF: 'FAIL' });
    expect([e.GENERATOR_READY_FOR_DEV_SCALE, e.runVoid]).toEqual(['NO', false]);
    // every artifact carries the freeze stamp of the recording
    for (const artifact of [out.selection, out.specifications, out.batch, out.report, out.gates, out.sameFamilyProof, out.approachProof, out.rights]) expect((artifact as { freeze: unknown }).freeze).toEqual(FREEZE);
    // the same recording gives the same output, byte for byte
    expect(JSON.stringify(await runQbR2e(recording, EVIDENCE))).toBe(JSON.stringify(out));
  });
  it('a regeneration REPLACES the first attempt; a regeneration that is not due is not even looked for', async () => {
    const first = recordingOf({ '01.rate-comparison.paa': raw('01.rate-comparison.paa', (w) => { answersOf(w)[0].verdictValue = 'OPTION_2'; }), '02.rate-comparison.ib-p1': raw('02.rate-comparison.ib-p1') });
    const both = recordingOf({ '01.rate-comparison.paa': raw('01.rate-comparison.paa'), '02.rate-comparison.ib-p1': raw('02.rate-comparison.ib-p1', (w) => { w.item.stem = 'garbage that would fail'; }) }, 2, first);
    const out = await runQbR2e(both, EVIDENCE);
    const rows = (out.report as { rows: Array<{ firstAttempt: { status: string; strictPass: boolean; validation: { gates: { answerKey: string } } }; regeneration: { status: string } | null; finalAttempt: number; finalValidation: { gates: { answerKey: string } } | null }> }).rows;
    // 01: a contradicted key on the first attempt, a clean regeneration -> final is attempt 2; the failure still counts
    expect([rows[0].firstAttempt.validation.gates.answerKey, rows[0].regeneration?.status, rows[0].finalAttempt, rows[0].finalValidation?.gates.answerKey]).toEqual(['FAILED', 'CANDIDATE', 2, 'DETERMINISTIC_RULE_VERIFIED']);
    // 02: the first attempt passed, so its (recorded, worse) attempt 2 does not exist for the pipeline
    expect([rows[1].firstAttempt.strictPass, rows[1].regeneration, rows[1].finalAttempt]).toEqual([true, null, 1]);
    expect(out.gates.evaluation.criteria.find((c) => c.criterion === 'FIRST_ATTEMPT_STRICT_PASS')!.observed).toBe('1/20');
    await expect(regenerationsDue(recordingOf({}, 1, { ...first, responses: first.responses.slice(0, 5) }), EVIDENCE)).resolves.toBeDefined();
  });
  it('a rejected request voids the run: no criterion is turned into a verdict', async () => {
    const out = await runQbR2e(recordingOf({ '01.rate-comparison.paa': 'REQUEST_REJECTED' }), EVIDENCE);
    expect([out.gates.evaluation.runVoid, out.gates.evaluation.GENERATOR_READY_FOR_DEV_SCALE, out.gates.evaluation.allHardCriteriaPass]).toEqual([true, 'NOT_EVALUATED_RUN_VOID', false]);
  });
  it('the fresh items are compared with QB-R2D: its wording and its parameter sets are siblings', async () => {
    const reused = recordingOf({ '01.rate-comparison.paa': raw('01.rate-comparison.paa', (w) => { w.item.parameters = [{ symbol: 'p1', value: 8 }, { symbol: 'q1', value: 20 }, { symbol: 'p2', value: 15 }, { symbol: 'q2', value: 33 }]; w.item.stem = 'Marta compara dos paquetes. El paquete 1 cuesta 8 dólares y contiene 20 porciones; el paquete 2 cuesta 15 dólares y contiene 33 porciones. ¿Cuál paquete ofrece más porciones por cada dólar?'; }) });
    const row = ((await runQbR2e(reused, EVIDENCE)).report as { rows: Array<{ firstAttempt: { regenerable: boolean; validation: { gates: { originality: string }; revision2: { originality: { sameParametersAs: string[] } } } } }> }).rows[0];
    expect(row.firstAttempt.validation.gates.originality).toBe('REVIEW_STRUCTURAL_SIMILARITY');
    expect(row.firstAttempt.validation.revision2.originality.sameParametersAs).toEqual(expect.arrayContaining(['cand|16.approach.school.standard#a1', 'cand|19.approach.paa.stem-plus#a1']));
    expect(row.firstAttempt.regenerable).toBe(true);
  });
});

describe('the VALIDATOR FREEZE', () => {
  const current = computeFreezeManifest(ROOT);
  const clean = { commitExists: true, diffIsClean: true, untracked: [] };
  it('the frozen list is the computed closure of the entry files and names every validator source', () => {
    const files = frozenSourceFiles(ROOT);
    expect(current.files.map((f) => f.path)).toEqual(files);
    for (const f of [
      'src/lib/exam-core/question-bank/production/specification-validators-r3.ts', 'src/lib/exam-core/question-bank/production/specification-validators.ts', 'src/lib/exam-core/question-bank/production/expression-evaluator.ts',
      'src/lib/exam-core/question-bank/production/answer-normalization.ts', 'src/lib/exam-core/question-bank/production/originality-gate.ts', 'src/lib/exam-core/question-bank/production/math-construct-registry.ts',
      'src/lib/exam-core/question-bank/production/specification-candidate.ts', 'src/lib/exam-core/question-bank/production/stimulus-spec.ts', 'src/lib/exam-core/question-bank/production/rights-gate.ts',
      'src/lib/exam-core/question-bank/production/generator/specification-generation-v2.ts', 'src/lib/assessment-adaptation/adapt.ts', 'src/lib/assessment-adaptation/adaptation-specification.ts', 'src/lib/assessment-adaptation/discipline-policy.ts',
      'src/lib/assessment-adaptation/system-profiles.ts', 'src/lib/assessment-adaptation/school-stem-performance.ts', 'src/lib/learning-approach/learning-approach-profile.ts', 'src/lib/exam-core/question-bank/task-families/math-poc-families.ts',
      'scripts/operations/qb-r2e/gates.ts', 'scripts/operations/qb-r2e/pipeline.ts', 'scripts/operations/qb-r2e/selection.ts', 'scripts/operations/qb-r2e/budget.ts', 'scripts/operations/qb-r2e/live-provider.ts', 'scripts/operations/qb-r2e/run.ts', 'scripts/operations/qb-r2e/freeze.ts', 'scripts/operations/qb-r2e/evidence.ts',
    ]) expect(files, f).toContain(f);
    expect(files.every((f) => f.startsWith('src/') || f.startsWith('scripts/operations/qb-r2'))).toBe(true);
    expect([...FREEZE_ENTRY_FILES].every((f) => files.includes(f))).toBe(true);
    expect(current.dataFiles.map((f) => f.path)).toEqual(['docs/exams/question-bank/pilots/qb-r2d/generated-batch.json', 'docs/exams/question-bank/pilots/qb-r2d/spend-ledger.json', 'docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json', 'docs/exams/question-bank/pilots/qb-r2c/pilot-v2-batch.json']);
    expect(current.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)) && /^[0-9a-f]{64}$/.test(current.manifestHash)).toBe(true);
    expect(computeFreezeManifest(ROOT)).toEqual(current);
  });
  it('the manifest carries the pre-registered criteria and the run parameters', () => {
    expect(current.preRegistration).toEqual(PRE_REGISTRATION);
    expect(current.runParameters).toEqual({ provider: 'openai', endpoint: 'chat completions', model: 'gpt-5.6-luna', responseMode: 'STRICT_JSON_SCHEMA', reasoningEffort: 'low', maxOutputTokens: 2150, maxCalls: 40, retries: 0, cumulativeCapUsdGuardBasis: 5 });
  });
  it('THE STORED MANIFEST IS THE WORKING TREE: validator-freeze.json hashes every frozen file as it is now', () => {
    const stored = readStoredManifest(ROOT);
    expect(stored, 'docs/exams/question-bank/pilots/qb-r2e/validator-freeze.json must exist').not.toBeNull();
    // the stored manifest is NOT re-stamped. Every frozen file is as it was, except the ones named (with their reason) in
    // qb-freeze-moved-files -- and for those the freeze refuses a re-run at HEAD, naming exactly them.
    expect(unmovedPart(stored!)).toEqual(unmovedPart(current));
    expect(freezeVerdict(stored, current, clean, 'abc1234')).toMatchObject({ ok: false, reasons: movedFileReasons() });
    expect(Object.keys(MOVED_SINCE_QB_FREEZE)).toEqual(['src/lib/catalog/concept-identity.ts']);
    expect(freezeVerdict(current, current, clean, 'abc1234')).toEqual({ ok: true, reasons: [], manifestHash: current.manifestHash });
  });
  it('REFUSES, naming every reason: a changed file, a file outside the freeze, a missing manifest or commit, a dirty or untracked tree', () => {
    const tampered: FreezeManifest = { ...current, files: current.files.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) };
    expect(freezeVerdict(tampered, current, clean, 'abc1234').reasons).toEqual(['MANIFEST_HASH_DOES_NOT_MATCH_ITS_CONTENT', `FROZEN_FILE_CHANGED:${current.files[0].path}`]);
    const shorter: FreezeManifest = { ...current, files: current.files.slice(1) };
    expect(freezeVerdict(shorter, current, clean, 'abc1234').reasons).toEqual(expect.arrayContaining([`FILE_NOT_IN_THE_FREEZE:${current.files[0].path}`]));
    const data: FreezeManifest = { ...current, dataFiles: current.dataFiles.map((f, i) => (i === 0 ? { ...f, sha256: '1'.repeat(64) } : f)) };
    expect(freezeVerdict(data, current, clean, 'abc1234').reasons).toEqual(expect.arrayContaining([`FROZEN_FILE_CHANGED:${current.dataFiles[0].path}`]));
    const criteria = { ...current, preRegistration: { ...current.preRegistration, version: '2' } } as unknown as FreezeManifest;
    expect(freezeVerdict(criteria, current, clean, 'abc1234').reasons).toEqual(expect.arrayContaining(['PRE_REGISTRATION_CHANGED']));
    const parameters = { ...current, runParameters: { ...current.runParameters, maxOutputTokens: 9000 } } as unknown as FreezeManifest;
    expect(freezeVerdict(parameters, current, clean, 'abc1234').reasons).toEqual(expect.arrayContaining(['RUN_PARAMETERS_CHANGED']));
    expect(freezeVerdict(null, current, clean, 'abc1234')).toEqual({ ok: false, reasons: ['FREEZE_MANIFEST_MISSING'], manifestHash: null });
    expect(freezeVerdict(current, current, clean, null).reasons).toEqual(['FREEZE_COMMIT_SHA_NOT_GIVEN']);
    expect(freezeVerdict(current, current, clean, 'not a sha').reasons).toEqual(['FREEZE_COMMIT_SHA_NOT_GIVEN']);
    expect(freezeVerdict(current, current, { commitExists: false, diffIsClean: false, untracked: [] }, 'abc1234').reasons).toEqual(['FREEZE_COMMIT_NOT_FOUND', 'WORKING_TREE_DIFFERS_FROM_THE_FREEZE_COMMIT']);
    expect(freezeVerdict(current, current, { commitExists: true, diffIsClean: true, untracked: ['scripts/operations/qb-r2e/gates.ts'] }, 'abc1234').reasons).toEqual(['FROZEN_FILE_NOT_TRACKED:scripts/operations/qb-r2e/gates.ts']);
  });
  it('a refused run NEVER builds a transport, so it cannot call the provider; against the real repository an unknown commit is refused', () => {
    let built = 0;
    const factory = (): R2eTransport => { built += 1; return { providerId: 'x', model: 'm', complete: async () => { throw new Error('must never be called'); } }; };
    const refused = freezeVerdict({ ...current, files: current.files.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) }, current, clean, 'abc1234');
    expect(() => transportBehindTheFreeze(refused, factory)).toThrow(/FREEZE_NOT_VERIFIED: MANIFEST_HASH_DOES_NOT_MATCH_ITS_CONTENT; FROZEN_FILE_CHANGED:/);
    expect(built).toBe(0);
    expect(transportBehindTheFreeze({ ok: true, reasons: [], manifestHash: current.manifestHash }, factory).providerId).toBe('x');
    expect(built).toBe(1);
    // real git, no network: a commit that does not exist, and no commit at all
    expect(verifyFreeze(ROOT, '0000000000000000000000000000000000000000').reasons).toEqual(expect.arrayContaining(['FREEZE_COMMIT_NOT_FOUND', 'WORKING_TREE_DIFFERS_FROM_THE_FREEZE_COMMIT']));
    expect(verifyFreeze(ROOT, null).ok).toBe(false);
    // in the run script the freeze is verified BEFORE the key is read and the transport created
    const run = read('scripts/operations/qb-r2e/run.ts');
    expect(run.indexOf('const verdict = verifyFreeze(ROOT, freezeSha);')).toBeGreaterThan(0);
    expect(run.indexOf('const verdict = verifyFreeze(ROOT, freezeSha);')).toBeLessThan(run.indexOf('requireLiveKey()'));
    expect(run.match(/createR2eLiveTransport\(/g)!.length).toBe(1);
    expect(run).toMatch(/transportBehindTheFreeze\(verdict, \(\) => \{/);
  });
});

describe('architecture: additive, pure, and the live transport stays outside src', () => {
  const PROD = 'src/lib/exam-core/question-bank/production';
  const strip = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  it('revision 2 of the validators and version 1 of the generator are not edited: their hashes are those of the QB-R2D commit', () => {
    // both files are frozen for QB-R2E too; here the point is that QB-R2D's scoring and prompts did not move
    const files = frozenSourceFiles(ROOT);
    expect(files).toContain(`${PROD}/specification-validators.ts`);
    expect(strip(`${PROD}/specification-validators.ts`)).not.toMatch(/specification-validators-r3|REVISION_3|commandTerms|variable\.marks/);
    expect(strip(`${PROD}/generator/specification-generation.ts`)).not.toMatch(/specification-generation-v2|commandTerms|variable\.marks/);
    expect(strip(`${PROD}/specification-validators-r3.ts`)).toMatch(/from '\.\/specification-validators'/);
  });
  it('the new source files are pure and name no vendor; the validators import nothing of the generator', () => {
    for (const f of [`${PROD}/generator/specification-generation-v2.ts`, `${PROD}/specification-validators-r3.ts`]) {
      expect(strip(f), f).not.toMatch(/fetch\(|process\.env|https?:\/\/|Date\.now\(|new Date\(|Math\.random\(|@\/lib\/db|@\/lib\/ai\/|from 'fs'|from 'pg'/);
      expect(strip(f), f).not.toMatch(/anthropic|openai|claude|gpt-|gemini/i);
    }
    expect(strip(`${PROD}/specification-validators-r3.ts`)).not.toMatch(/from '\.\/generator\//);
    expect(strip(`${PROD}/generator/specification-generation-v2.ts`)).not.toMatch(/specification-validators|independent-validators|originality-gate|structural-validation|validated-candidate/);
  });
  it('the lane\'s scripts: one network file, no database anywhere in what the run can reach, nothing in src imports them', () => {
    expect(readdirSync(join(ROOT, 'scripts/operations/qb-r2e')).sort()).toEqual(['budget.ts', 'evidence.ts', 'freeze.ts', 'gates.ts', 'live-provider.ts', 'pipeline.ts', 'run.ts', 'selection.ts']);
    for (const f of ['budget.ts', 'evidence.ts', 'freeze.ts', 'gates.ts', 'pipeline.ts', 'selection.ts', 'run.ts']) expect(strip(`scripts/operations/qb-r2e/${f}`), f).not.toMatch(/fetch\(|https?:\/\//);
    expect(strip('scripts/operations/qb-r2e/live-provider.ts')).not.toMatch(/console\.|writeFileSync|process\.env/);
    for (const f of frozenSourceFiles(ROOT)) {
      expect(f, f).not.toMatch(/^src\/lib\/db|\/db\/|\/gateway\.ts$|\/adapters\/|\.service\.ts$/);
      expect(strip(f), f).not.toMatch(/DATABASE_URL|from 'pg'|from 'postgres'|drizzle|@neondatabase|new Pool\(|@\/lib\/db/);
    }
    const walk = (d: string): string[] => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
    for (const f of walk('src')) expect(read(f), f).not.toMatch(/scripts\/operations\/qb-r2e/);
  });
});
