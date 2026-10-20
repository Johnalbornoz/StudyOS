/**
 * QB-R2C -- the repeatable generation harness and the Reference Intelligence Pack v2.
 *   unit + cells + pack v2 + policy -> template -> prompt + promptHash -> GenerationProvider -> strict parse -> batch with lineage
 * Same inputs, same bytes. The provider is an interface; no live provider exists in the production directory.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConceptProfileSchema, generationReadyPackIssues, ReferenceIntelligencePackV2Schema, toReferencePackV1 } from '@/lib/exam-core/question-bank/production/concept-profile';
import { GenerationBatchSchema, GenerationRequestSchema, lineageGaps, REPEATABLE_LINEAGE_FIELDS } from '@/lib/exam-core/question-bank/production/generation-contract';
import { generateCandidates, GENERATION_SYSTEM_TEXT, mergeGenerationBatches, renderGenerationPrompt, type GenerateCandidatesInput } from '@/lib/exam-core/question-bank/production/generator/generate-candidates';
import { canonicalJson, GenerationError, RecordedResponseProvider, sha256OfCanonicalJson, type GenerationProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { GenerationResponseSchema, parseGenerationResponse } from '@/lib/exam-core/question-bank/production/generator/response-schema';
import { DEFAULT_TEMPLATE_REGISTRY, selectTemplate, TEMPLATE_STANDALONE_MCQ, templateSelectionKeyOf, type GenerationTemplate } from '@/lib/exam-core/question-bank/production/generator/templates';
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';
import { PAA_CONCEPT_IDENTITIES } from '@/lib/exam-core/question-bank/production/paa-concept-identity';
import { paaConceptProfileOf, paaGenerationReadyPack, PAA_CATALOGUE_SOURCE_KEY, PAA_CONCEPT_PROFILE_COVERAGE, PAA_CONCEPT_PROFILES } from '@/lib/exam-core/question-bank/production/paa-concept-profiles';
import { buildPaaGenerationPlan } from '@/lib/exam-core/question-bank/production/paa-generation-plan';
import { ReferenceIntelligencePackSchema } from '@/lib/exam-core/question-bank/production/reference-pack';
import type { RequirementCell } from '@/lib/exam-core/question-bank/production/requirement-cell';
import { slotsOfUnit, type GenerationUnit } from '@/lib/exam-core/question-bank/production/stimulus-plan';

const ROOT = join(__dirname, '..', '..');
const PROD = 'src/lib/exam-core/question-bank/production';
const NOW = '2026-10-11T12:00:00Z';
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CELLS = resolvePaaRequirementCells();
const PLAN = buildPaaGenerationPlan(CELLS);
const unitOf = (key: string): GenerationUnit => PLAN.units.find((u) => u.unitKey === key)!;
const cellsOf = (unit: GenerationUnit): RequirementCell[] => slotsOfUnit(unit).map((s) => CELLS.find((c) => c.cellKey === s.cellKey)!);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const PERCENT = unitOf('SU|DIAGNOSTIC|029|math.num.percent|MULTIPLE_CHOICE|STANDARD#1');
const RATIO = unitOf('SU|FULL_MOCK_1|028|math.num.ratio-proportion|STUDENT_PRODUCED|STANDARD#1');
const TRIANGLE = unitOf('SP|PRACTICE|matematicas|FIGURE|07');
const MEAN = unitOf('SU|PRACTICE|063|math.stat.central-tendency|MULTIPLE_CHOICE|FOUNDATIONAL#1');
const MODEL = 'test-model-1';
const policy = (over: Record<string, unknown> = {}) => ({ policyId: 'test-generation', policyVersion: '1', author: { kind: 'MODEL', model: MODEL, promptVersion: 'registry/1', requestedBy: 'operator' }, language: 'es', copyReferenceExpression: false, ...over });
const mcqItem = (unit: GenerationUnit, over: Record<string, unknown> = {}) => ({
  slotKey: slotsOfUnit(unit)[0].slotKey, stem: 'Un abrigo cuesta $ 60 y se rebaja un 25 %. ¿Cuánto se paga?', options: [{ id: 'A', text: '$ 15' }, { id: 'B', text: '$ 35' }, { id: 'C', text: '$ 45' }, { id: 'D', text: '$ 75' }], answerKey: 'C',
  rationale: 'El descuento es el 25 por ciento de 60, que es 15; se paga 45.', distractorRationales: { A: 'Da el descuento.', B: 'Resta 25 como cantidad.', D: 'Suma el descuento.' }, proposedSupportingConceptStableIds: [],
  answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '60 * (1 - 25 / 100)' }, numericKey: null, usesStimulusValues: null, ...over,
});
const response = (unit: GenerationUnit, over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({ stimulus: null, items: [mcqItem(unit, item)], ...over });
const base = (unit: GenerationUnit = PERCENT, over: Partial<GenerateCandidatesInput> = {}): Omit<GenerateCandidatesInput, 'provider'> => {
  const cells = cellsOf(unit);
  return { unit, cells, packs: Object.fromEntries(cells.map((c) => [c.primaryConcept.stableId, paaGenerationReadyPack(c.primaryConcept.stableId, NOW)])), policy: policy(), templateRegistry: DEFAULT_TEMPLATE_REGISTRY, runId: 'run-1', batchKey: 'batch-1', now: NOW, options: { allowUnboundCells: true }, ...over };
};
/** A provider that answers the prompt it is given with a fixed payload: what a recording does, without the hash lookup. */
const answering = (payload: unknown, model = MODEL): GenerationProvider => ({ id: 'test:fixed', model, generate: async (p) => ({ providerId: 'test:fixed', model, promptHash: p.promptHash, rawText: typeof payload === 'string' ? payload : JSON.stringify(payload) }) });
const hashOf = (input: Omit<GenerateCandidatesInput, 'provider'>) => renderGenerationPrompt({ ...input, provider: answering(null) }).promptHash;
const codeOf = async (run: () => Promise<unknown>): Promise<string> => { try { await run(); return 'NO_ERROR'; } catch (e) { return e instanceof GenerationError ? e.code : `OTHER:${(e as Error).message}`; } };

describe('Reference Intelligence Pack v2 -- sources + facts + the PRIMARY concept\'s profile', () => {
  it('COVERAGE: profiles are authored for the concepts the pilot generates for, not for all 61', () => {
    expect(PAA_CONCEPT_PROFILE_COVERAGE.total).toBe(61);
    expect(PAA_CONCEPT_PROFILE_COVERAGE.authored).toBe(23);
    expect(PAA_CONCEPT_PROFILE_COVERAGE.missingConceptStableIds).toHaveLength(38);
    expect(new Set(PAA_CONCEPT_PROFILE_COVERAGE.authoredConceptStableIds).size).toBe(23);
    console.info(`QB-R2C concept-profile coverage: ${PAA_CONCEPT_PROFILE_COVERAGE.authored} of ${PAA_CONCEPT_PROFILE_COVERAGE.total}; working definitions: ${PAA_CONCEPT_PROFILE_COVERAGE.workingDefinitions.join(', ')}`);
  });

  it('every profile is a valid, StudyUs-authored, versioned statement of a certified concept, restating the internal catalogue only', () => {
    for (const p of PAA_CONCEPT_PROFILES) {
      expect(ConceptProfileSchema.safeParse(p).success, p.conceptStableId).toBe(true);
      const identity = PAA_CONCEPT_IDENTITIES.find((c) => c.stableId === p.conceptStableId)!;
      expect(p).toMatchObject({ authoredBy: 'STUDYUS', packVersion: 'q1-paa-concept-profiles/1', canonicalLabel: identity.canonicalName, restatedInOwnWords: true, sourceKeys: [PAA_CATALOGUE_SOURCE_KEY] });
      expect(p.difficultyGuidance.basis).toBe('EDITORIAL_ESTIMATE');
      expect(p.language).toBe(p.conceptStableId.startsWith('efl.') ? 'en' : 'es');
    }
  });

  it('the five Redacción operations are WORKING definitions, each with a note that it awaits the official guide', () => {
    expect([...PAA_CONCEPT_PROFILE_COVERAGE.workingDefinitions].sort()).toEqual(['write.concision-elision', 'write.generalization', 'write.global-synthesis', 'write.indirect-expression', 'write.stylistic-addition']);
    for (const p of PAA_CONCEPT_PROFILES) {
      if (p.conceptStableId.startsWith('write.')) expect(p.definitionNote, p.conceptStableId).toMatch(/pendiente de confirmación contra la guía oficial/);
      else expect(p).toMatchObject({ definitionConfidence: 'ESTABLISHED', definitionNote: null });
    }
    const p = paaConceptProfileOf('write.generalization')!;
    expect(ConceptProfileSchema.safeParse({ ...p, definitionNote: null }).success).toBe(false);
    expect(ConceptProfileSchema.safeParse({ ...paaConceptProfileOf('math.num.percent')!, definitionNote: 'una nota que no corresponde' }).success).toBe(false);
  });

  it('a generation-ready pack is refused without a profile or with another concept\'s profile', () => {
    const cell = CELLS.find((c) => c.primaryConcept.stableId === 'math.num.percent')!;
    const pack = paaGenerationReadyPack('math.num.percent', NOW);
    expect(ReferenceIntelligencePackV2Schema.safeParse(pack).success).toBe(true);
    expect(generationReadyPackIssues(pack, cell)).toEqual([]);
    expect(generationReadyPackIssues(toReferencePackV1(pack), cell)).toEqual(['CONCEPT_PROFILE_MISSING']);
    expect(generationReadyPackIssues({ ...pack, conceptProfile: null }, cell)).toEqual(['CONCEPT_PROFILE_MISSING']);
    expect(generationReadyPackIssues(undefined, cell)).toEqual(['CONCEPT_PROFILE_MISSING']);
    expect(generationReadyPackIssues(paaGenerationReadyPack('math.num.ratio-proportion', NOW), cell)).toEqual(['CONCEPT_PROFILE_IS_FOR_ANOTHER_CONCEPT']);
    expect(generationReadyPackIssues({ ...pack, conceptProfile: { ...pack.conceptProfile, sourceKeys: ['some.other.source'] } }, cell)).toEqual(['PROFILE_SOURCE_NOT_IN_PACK']);
    expect(generationReadyPackIssues({ ...pack, conceptProfile: { ...pack.conceptProfile, authoredBy: 'SOMEONE_ELSE' } }, cell)).toEqual(['PACK_SCHEMA_INVALID']);
    expect(() => paaGenerationReadyPack('math.alg.quadratics', NOW)).toThrow(/CONCEPT_PROFILE_NOT_AUTHORED/);
    // the v1 view keeps what the existing contracts read, and v1 itself is unchanged
    expect(ReferenceIntelligencePackSchema.safeParse(toReferencePackV1(pack)).success).toBe(true);
    expect(pack.sources.map((s) => s.sourceType)).toEqual(['STUDYUS_INTERNAL']);
  });
});

describe('templates control structure, never content', () => {
  it('seven templates, each with an id and a version, and none carries subject matter', () => {
    expect(DEFAULT_TEMPLATE_REGISTRY.map((t) => `${t.id}@${t.version}`)).toEqual(['mcq-standalone@1', 'mcq-own-stimulus@1', 'spr-math@1', 'text-passage-set@1', 'editing-writing-set@1', 'data-interpretation-set@1', 'figure-geometry@1']);
    for (const t of DEFAULT_TEMPLATE_REGISTRY) {
      expect(Object.keys(t).sort()).toEqual(['appliesTo', 'constraints', 'fixedInstruction', 'id', 'purpose', 'task', 'version']);
      expect(t.constraints.optionIds).toEqual(['A', 'B', 'C', 'D']);
      expect(Object.keys(t.fixedInstruction).sort()).toEqual(['en', 'es']);
    }
  });

  it('SELECTION TABLE: by unit type, stimulus kind and response format', () => {
    const pick = (unitKey: string, attach = false) => { const u = unitOf(unitKey); return selectTemplate(DEFAULT_TEMPLATE_REGISTRY, templateSelectionKeyOf(u, cellsOf(u), attach)).id; };
    expect(pick('SU|DIAGNOSTIC|029|math.num.percent|MULTIPLE_CHOICE|STANDARD#1')).toBe('mcq-standalone');
    expect(pick('SU|FULL_MOCK_1|028|math.num.ratio-proportion|STUDENT_PRODUCED|STANDARD#1')).toBe('spr-math');
    // a cell whose stimulus is OPTIONAL: standalone by default, a stimulus of its own only when asked for
    expect(pick('SU|PRACTICE|063|math.stat.central-tendency|MULTIPLE_CHOICE|FOUNDATIONAL#1')).toBe('mcq-standalone');
    expect(pick('SU|PRACTICE|063|math.stat.central-tendency|MULTIPLE_CHOICE|FOUNDATIONAL#1', true)).toBe('mcq-own-stimulus');
    // asking for a stimulus on a cell that requires none changes nothing
    expect(pick('SU|DIAGNOSTIC|029|math.num.percent|MULTIPLE_CHOICE|STANDARD#1', true)).toBe('mcq-standalone');
    expect(pick('SP|PRACTICE|lectura|PASSAGE|02')).toBe('text-passage-set');
    expect(pick('SP|PRACTICE|lectura|POEM|01')).toBe('text-passage-set');
    expect(pick('SP|PRACTICE|lectura|PAIRED_PASSAGE|01')).toBe('text-passage-set');
    expect(pick('SP|REDUCED_MOCK|redaccion|NUMBERED_TEXT|01')).toBe('editing-writing-set');
    expect(pick('SP|DIAGNOSTIC|ingles|DRAFT_PARAGRAPH|01')).toBe('editing-writing-set');
    expect(pick('SP|PRACTICE|lectura|COMPOSITE|01')).toBe('data-interpretation-set');
    expect(pick('SP|FULL_MOCK_1|matematicas|TABLE|01')).toBe('data-interpretation-set');
    expect(pick('SP|PRACTICE|matematicas|GRAPH|01')).toBe('data-interpretation-set');
    expect(pick('SP|PRACTICE|matematicas|DATA_SET|01')).toBe('data-interpretation-set');
    expect(pick('SP|PRACTICE|matematicas|FIGURE|07')).toBe('figure-geometry');
    // every unit of the 865-item plan has exactly one template
    for (const u of PLAN.units) expect(() => selectTemplate(DEFAULT_TEMPLATE_REGISTRY, templateSelectionKeyOf(u, cellsOf(u), false)), u.unitKey).not.toThrow();
  });

  it('no template, or two, is a named error: a template is never guessed', () => {
    const key = templateSelectionKeyOf(PERCENT, cellsOf(PERCENT), false);
    expect(() => selectTemplate([], key)).toThrow(/NO_TEMPLATE_FOR_UNIT/);
    expect(() => selectTemplate([TEMPLATE_STANDALONE_MCQ, { ...TEMPLATE_STANDALONE_MCQ, id: 'twin' }], key)).toThrow(/NO_TEMPLATE_FOR_UNIT: 2 templates/);
  });
});

describe('the prompt is deterministic and provider-neutral', () => {
  it('renders a system text and a structured instruction from cell + profile + template + policy, and says copyReferenceExpression is false', () => {
    const { prompt, promptHash, template } = renderGenerationPrompt({ ...base(), provider: answering(null) });
    expect(template).toEqual({ id: 'mcq-standalone', version: '1' });
    expect(promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(promptHash).toBe(sha256OfCanonicalJson(prompt));
    expect(prompt.system).toBe(GENERATION_SYSTEM_TEXT);
    expect(prompt.system).toMatch(/copyReferenceExpression is false/);
    expect(prompt.instruction.policy).toEqual({ id: 'test-generation', version: '1', language: 'es', copyReferenceExpression: false });
    expect(prompt.instruction.slots).toHaveLength(1);
    expect(prompt.instruction.slots[0]).toMatchObject({ primaryConcept: { stableId: 'math.num.percent' }, responseFormat: 'MULTIPLE_CHOICE', difficultyBand: 'STANDARD', difficultyBasis: 'EDITORIAL_ESTIMATE', topicNodeCode: 'paa.topic.029' });
    expect(prompt.instruction.conceptProfiles.map((p) => p.conceptStableId)).toEqual(['math.num.percent']);
    expect(prompt.instruction.template.fixedInstruction).toEqual({ MULTIPLE_CHOICE: 'Selecciona la única opción correcta.', STUDENT_PRODUCED: 'Escribe tu respuesta como un número.' });
    expect(prompt.instruction.unit.stimulus).toBeNull();
    // no vendor, no model name, no clock in the prompt
    expect(JSON.stringify(prompt)).not.toMatch(new RegExp(`${MODEL}|run-1|${NOW}`));
  });

  it('a stimulus unit\'s prompt carries the stimulus plan and one slot per member, each with its own concept profile', () => {
    const unit = unitOf('SP|PRACTICE|lectura|PASSAGE|02');
    const { prompt } = renderGenerationPrompt({ ...base(unit), provider: answering(null) });
    expect(prompt.instruction.unit).toEqual({ unitKey: 'SP|PRACTICE|lectura|PASSAGE|02', type: 'STIMULUS', stimulus: { stimulusPlanId: 'SP|PRACTICE|lectura|PASSAGE|02', kind: 'PASSAGE', language: 'es', questionCount: 5, integrity: { rule: 'SUBSET', min: 1, max: 5 } } });
    expect(prompt.instruction.slots).toHaveLength(5);
    expect(prompt.instruction.conceptProfiles.map((p) => p.conceptStableId)).toEqual(['lit.narrative-elements', 'read.central-idea', 'read.explicit-information', 'read.textual-evidence', 'read.vocabulary-in-context']);
  });

  it('SAME inputs give the SAME hash; changing the cell, the profile, the template version or the policy changes it', () => {
    const h = hashOf(base());
    expect(hashOf(base())).toBe(h);
    expect(hashOf(clone(base()))).toBe(h);
    // run id, batch key and clock are not part of the prompt
    expect(hashOf(base(PERCENT, { runId: 'run-2', batchKey: 'batch-2', now: '2027-01-01T00:00:00Z' }))).toBe(h);
    const seen = new Set([h]);
    const differs = (label: string, input: Omit<GenerateCandidatesInput, 'provider'>) => { const x = hashOf(input); expect(seen.has(x), label).toBe(false); seen.add(x); };
    // the cell
    const cell = cellsOf(PERCENT)[0];
    differs('cell band', base(PERCENT, { cells: [{ ...cell, difficultyBand: 'CHALLENGE' }] }));
    differs('cell topic', base(PERCENT, { cells: [{ ...cell, topicNodeCode: 'paa.topic.028' }] }));
    differs('another unit', base(RATIO));
    // the profile
    const pack = paaGenerationReadyPack('math.num.percent', NOW);
    differs('profile definition', base(PERCENT, { packs: { 'math.num.percent': { ...pack, conceptProfile: { ...pack.conceptProfile, definition: `${pack.conceptProfile.definition} Incluye el cálculo del total.` } } } }));
    differs('profile pack version', base(PERCENT, { packs: { 'math.num.percent': { ...pack, conceptProfile: { ...pack.conceptProfile, packVersion: 'q1-paa-concept-profiles/2' } } } }));
    // the template version
    differs('template version', base(PERCENT, { templateRegistry: DEFAULT_TEMPLATE_REGISTRY.map((t) => (t.id === 'mcq-standalone' ? { ...t, version: '2' } : t)) }));
    differs('template task', base(PERCENT, { templateRegistry: DEFAULT_TEMPLATE_REGISTRY.map((t) => (t.id === 'mcq-standalone' ? { ...t, task: `${t.task} Use everyday contexts.` } : t)) }));
    // the policy
    differs('policy version', base(PERCENT, { policy: policy({ policyVersion: '2' }) }));
    differs('policy id', base(PERCENT, { policy: policy({ policyId: 'other-generation' }) }));
    differs('topic label', base(PERCENT, { labels: { topics: { 'paa.topic.029': 'Porcentaje' } } }));
  });

  it('canonical JSON: key order does not matter, value order does', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(sha256OfCanonicalJson({ a: 1, b: 2 })).toBe(sha256OfCanonicalJson({ b: 2, a: 1 }));
    expect(sha256OfCanonicalJson({ a: [1, 2] })).not.toBe(sha256OfCanonicalJson({ a: [2, 1] }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('generateCandidates -- repeatable, with lineage', () => {
  const recorded = (unit: GenerationUnit, payload: unknown, input = base(unit)) => new RecordedResponseProvider('recorded:test', MODEL, { [hashOf(input)]: JSON.stringify(payload) });

  it('same inputs -> the identical batch, deep-equal and byte for byte', async () => {
    const run = () => generateCandidates({ ...base(), provider: recorded(PERCENT, response(PERCENT)) });
    const [a, b] = [await run(), await run()];
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(GenerationBatchSchema.safeParse(a).success).toBe(true);
    expect(a.candidates).toHaveLength(1);
    expect(a.stimuli).toEqual([]);
    expect(a.generatedAt).toBe(NOW);
  });

  it('the plan decides everything but the content: cell, concept, band, format, language, marks, provenance come from the cell', async () => {
    const batch = await generateCandidates({ ...base(), provider: recorded(PERCENT, response(PERCENT)) });
    const c = batch.candidates[0];
    const cell = cellsOf(PERCENT)[0];
    expect(c).toMatchObject({ candidateKey: `cand|${cell.cellKey}#1`, cellKey: cell.cellKey, slotKey: `${cell.cellKey}#1`, batchKey: 'batch-1', primaryConceptStableId: 'math.num.percent', difficultyBand: 'STANDARD', responseFormat: 'MULTIPLE_CHOICE', language: 'es', marks: 1, provenance: 'STUDYUS_GENERATED', stimulusKey: null, stimulusPlanId: null });
    // the template's fixed sentence is kept apart from the stem
    expect(c.instruction).toBe('Selecciona la única opción correcta.');
    expect(c.stem).not.toContain(c.instruction!);
    // a response cannot set what the plan decided: the response schema has no field for it
    for (const f of ['primaryConceptStableId', 'difficultyBand', 'cellKey', 'provenance', 'language', 'lineage', 'intendedPool']) expect(GenerationResponseSchema.safeParse(response(PERCENT, {}, { [f]: 'x' })).success, f).toBe(false);
  });

  it('LINEAGE on every candidate and on the batch: provider, model, policy, template, prompt hash, run, cell, pack and profile version, timestamp', async () => {
    const input = base();
    const batch = await generateCandidates({ ...input, provider: recorded(PERCENT, response(PERCENT)) });
    const hash = hashOf(input);
    expect(batch.candidates[0].lineage).toEqual({
      kind: 'MODEL', model: MODEL, promptVersion: 'mcq-standalone@1', runId: 'run-1', requestedBy: 'operator', generatedAt: NOW, humanEdits: [], provider: 'recorded:test', generationPolicy: { id: 'test-generation', version: '1' }, template: { id: 'mcq-standalone', version: '1' },
      promptHash: hash, generationUnitKey: PERCENT.unitKey, requirementCellKey: cellsOf(PERCENT)[0].cellKey, referencePack: { version: 2, conceptProfileVersion: 1, conceptProfilePackVersion: 'q1-paa-concept-profiles/1' },
    });
    expect(lineageGaps(batch.candidates[0].lineage)).toEqual([]);
    expect(batch.lineage).toEqual({ runId: 'run-1', provider: 'recorded:test', model: MODEL, generationPolicy: { id: 'test-generation', version: '1' }, generatedAt: NOW, units: [{ generationUnitKey: PERCENT.unitKey, template: { id: 'mcq-standalone', version: '1' }, promptHash: hash, candidates: 1 }] });
    // a draft written before the harness lacks every one of the new fields, and is reported as such
    expect(lineageGaps({ kind: 'MODEL', model: 'm', promptVersion: '1', runId: 'r', requestedBy: 'o', generatedAt: NOW, humanEdits: [] })).toEqual([...REPEATABLE_LINEAGE_FIELDS]);
    expect(lineageGaps({ kind: 'HUMAN', authorUserId: U(1), writtenAt: NOW })).toEqual(['NOT_A_MODEL_LINEAGE']);
  });

  it('a recording answers ONE prompt: an unknown hash is a named error, never an approximate match', async () => {
    const provider = recorded(PERCENT, response(PERCENT));
    // the same unit under a different policy version renders another prompt: the recording does not apply
    expect(await codeOf(() => generateCandidates({ ...base(PERCENT, { policy: policy({ policyVersion: '2' }) }), provider }))).toBe('RECORDED_RESPONSE_NOT_FOUND');
    expect(await codeOf(() => generateCandidates({ ...base(RATIO), provider }))).toBe('RECORDED_RESPONSE_NOT_FOUND');
    expect(await codeOf(() => generateCandidates({ ...base(), provider: new RecordedResponseProvider('recorded:test', MODEL, new Map()) }))).toBe('RECORDED_RESPONSE_NOT_FOUND');
    await expect(new RecordedResponseProvider('r', MODEL, {}).generate({ prompt: {}, promptHash: 'f'.repeat(64) })).rejects.toThrow(/RECORDED_RESPONSE_NOT_FOUND: f{64}/);
  });

  it('the provider is an interface: a second, trivial provider works, and the harness never branches on which one it is', async () => {
    const fake = await generateCandidates({ ...base(), provider: answering(response(PERCENT)) });
    const rec = await generateCandidates({ ...base(), provider: recorded(PERCENT, response(PERCENT)) });
    expect(fake.candidates[0].lineage).toMatchObject({ provider: 'test:fixed', model: MODEL });
    // the content is the same; only the provider's identity differs
    const strip = (b: typeof fake) => JSON.parse(JSON.stringify(b).replace(/test:fixed|recorded:test/g, 'P'));
    expect(strip(fake)).toEqual(strip(rec));
    expect(await codeOf(() => generateCandidates({ ...base(), provider: answering(response(PERCENT), 'another-model') }))).toBe('POLICY_MODEL_IS_NOT_THE_PROVIDERS');
    const wrongHash: GenerationProvider = { id: 'test:wrong', model: MODEL, generate: async () => ({ providerId: 'test:wrong', model: MODEL, promptHash: '0'.repeat(64), rawText: JSON.stringify(response(PERCENT)) }) };
    expect(await codeOf(() => generateCandidates({ ...base(), provider: wrongHash }))).toBe('PROVIDER_ANSWERED_ANOTHER_PROMPT');
  });

  it('MALFORMED output is rejected by name and never repaired', async () => {
    const run = (payload: unknown, unit: GenerationUnit = PERCENT, over: Partial<GenerateCandidatesInput> = {}) => codeOf(() => generateCandidates({ ...base(unit, over), provider: answering(payload) }));
    expect(await run('Here is your question: {')).toBe('PROVIDER_RESPONSE_NOT_JSON');
    expect(await run('```json\n{}\n```')).toBe('PROVIDER_RESPONSE_NOT_JSON');
    expect(await run({})).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(await run(response(PERCENT, { note: 'extra field' }))).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(await run(response(PERCENT, {}, { rationale: undefined }))).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(await run(response(PERCENT, {}, { stem: '   ' }))).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(await run(response(PERCENT, { items: [] }))).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(await run(response(PERCENT, {}, { slotKey: 'PRACTICE|029|math.num.percent|MULTIPLE_CHOICE|STANDARD#1' }))).toBe('RESPONSE_SLOTS_DO_NOT_MATCH_UNIT');
    expect(await run({ stimulus: null, items: [mcqItem(PERCENT), mcqItem(PERCENT)] })).toBe('RESPONSE_SLOTS_DO_NOT_MATCH_UNIT');
    expect(await run(response(PERCENT, {}, { options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '3' }] }))).toBe('RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE');
    expect(await run(response(PERCENT, {}, { options: [{ id: '1', text: 'a' }, { id: '2', text: 'b' }, { id: '3', text: 'c' }, { id: '4', text: 'd' }] }))).toBe('RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE');
    expect(await run(response(PERCENT, {}, { answerKey: 'E' }))).toBe('RESPONSE_KEY_IS_NOT_AN_OPTION');
    expect(await run(response(PERCENT, {}, { answerKey: '$ 45' }))).toBe('RESPONSE_KEY_IS_NOT_AN_OPTION');
    expect(await run(response(PERCENT, {}, { numericKey: { kind: 'NUMERIC', value: '45', equivalentFormsAllowed: true } }))).toBe('RESPONSE_FORMAT_IS_NOT_THE_SLOTS');
    expect(await run(response(PERCENT, {}, { stem: 'Selecciona la única opción correcta. Un abrigo cuesta $ 60 y se rebaja un 25 %. ¿Cuánto se paga?' }))).toBe('RESPONSE_REPEATS_FIXED_INSTRUCTION');
    expect(await run(response(PERCENT, { stimulus: { parts: [{ label: '1', partKind: 'TEXT', text: 'Un texto que nadie pidió.' }], structured: null } }))).toBe('RESPONSE_UNEXPECTED_STIMULUS');
    // student-produced: no options, and a NUMERIC key whose value the answer key restates
    const spr = { options: [], distractorRationales: {}, answerKey: '15', numericKey: { kind: 'NUMERIC', value: '15', equivalentFormsAllowed: true } };
    expect(await run(response(RATIO, {}, spr), RATIO)).toBe('NO_ERROR');
    expect(await run(response(RATIO, {}, { ...spr, numericKey: null }), RATIO)).toBe('RESPONSE_NUMERIC_KEY_MISSING');
    expect(await run(response(RATIO, {}, { ...spr, answerKey: '16' }), RATIO)).toBe('RESPONSE_NUMERIC_KEY_MISSING');
    expect(await run(response(RATIO, {}, { ...spr, numericKey: { kind: 'NUMERIC', value: '15,0', equivalentFormsAllowed: true } }), RATIO)).toBe('PROVIDER_RESPONSE_SCHEMA_INVALID');
    expect(await run(response(RATIO, {}, { answerKey: 'C' }), RATIO)).toBe('RESPONSE_FORMAT_IS_NOT_THE_SLOTS');
    expect(() => parseGenerationResponse('not json')).toThrow(GenerationError);
  });

  it('a figure unit: the specification is validated, the SVG and the alt text are derived by the harness, never taken from the provider', async () => {
    const figure = (a: number | null, b: number, c: number) => ({ parts: [], structured: { v: 1, tables: [], dataSets: [], charts: [], figures: [{ figureKey: 'tri', shape: 'RIGHT_TRIANGLE', unit: 'cm', legA: { label: 'x', value: a }, legB: { label: 'b', value: b }, hypotenuse: { label: 'c', value: c } }] } });
    const item = { stem: 'En el triángulo rectángulo de la figura, la hipotenusa mide 13 cm y un cateto mide 12 cm. ¿Cuánto mide el otro cateto?', options: [{ id: 'A', text: '1 cm' }, { id: 'B', text: '5 cm' }, { id: 'C', text: '25 cm' }, { id: 'D', text: '17,7 cm' }], answerKey: 'B', answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: 'sqrt(13^2 - 12^2)' }, usesStimulusValues: [12, 13], distractorRationales: { A: 'Resta los lados.', C: 'No extrae la raíz.', D: 'Suma los cuadrados.' }, rationale: 'El cateto es la raíz de 169 menos 144, que es 5.' };
    const batch = await generateCandidates({ ...base(TRIANGLE), provider: answering(response(TRIANGLE, { stimulus: figure(null, 12, 13) }, item)) });
    const st = batch.stimuli[0];
    expect(st).toMatchObject({ stimulusKey: `stim|${TRIANGLE.unitKey}`, kind: 'FIGURE', language: 'es', stimulusPlanId: TRIANGLE.unitKey, generationUnitKey: TRIANGLE.unitKey, provenance: 'STUDYUS_GENERATED' });
    expect(st.renderedAssets).toHaveLength(1);
    expect(st.renderedAssets![0].svg).toMatch(/^<svg .*<\/svg>$/);
    expect(st.parts).toEqual([{ label: 'tri', partKind: 'FIGURE', text: 'Triángulo rectángulo. Cateto: desconocido, marcado x. Cateto: 12 cm. Hipotenusa: 13 cm.' }]);
    expect(batch.candidates[0]).toMatchObject({ stimulusKey: st.stimulusKey, stimulusPlanId: TRIANGLE.unitKey, usesStimulusValues: [12, 13], instruction: 'Observa la figura y selecciona la única opción correcta.' });
    // a provider cannot hand in a picture: the response schema has no field for an SVG
    expect(GenerationResponseSchema.safeParse(response(TRIANGLE, { stimulus: { ...figure(null, 12, 13), renderedAssets: [] } }, item)).success).toBe(false);
    const run = (stimulus: unknown) => codeOf(() => generateCandidates({ ...base(TRIANGLE), provider: answering(response(TRIANGLE, { stimulus }, item)) }));
    expect(await run(figure(5, 12, 14))).toBe('RESPONSE_STRUCTURED_STIMULUS_INVALID');
    expect(await run(null)).toBe('RESPONSE_STIMULUS_MISSING');
    expect(await run({ parts: [], structured: null })).toBe('RESPONSE_STIMULUS_HAS_NO_CONTENT');
    expect(await run({ parts: [{ label: '1', partKind: 'TEXT', text: 'Una descripción de la figura en lugar de su especificación.' }], structured: null })).toBe('RESPONSE_STIMULUS_HAS_NO_CONTENT');
  });

  it('an optional stimulus of a standalone question belongs to that question alone: no stimulus plan, the item\'s own pool', async () => {
    const data = { parts: [], structured: { v: 1, tables: [], dataSets: [{ dataSetKey: 'd', title: 'Goles por partido', categories: null, series: [{ seriesKey: 'g', label: 'Goles', unit: null, values: [1, 2, 2, 3, 7] }] }], charts: [], figures: [] } };
    const item = { stem: 'Los datos muestran los goles de un equipo en cinco partidos. ¿Cuál es la media?', options: [{ id: 'A', text: '2' }, { id: 'B', text: '3' }, { id: 'C', text: '7' }, { id: 'D', text: '15' }], answerKey: 'B', answerCheck: { kind: 'ARITHMETIC_EXPRESSION', expression: '(1 + 2 + 2 + 3 + 7) / 5' }, usesStimulusValues: [1, 2, 3, 7] };
    const batch = await generateCandidates({ ...base(MEAN, { options: { allowUnboundCells: true, attachOptionalStimulus: true } }), provider: answering(response(MEAN, { stimulus: data }, item)) });
    expect(batch.stimuli[0]).toMatchObject({ kind: 'DATA_SET', stimulusPlanId: null });
    expect(batch.candidates[0]).toMatchObject({ stimulusPlanId: null, stimulusKey: batch.stimuli[0].stimulusKey });
    expect((batch.candidates[0].lineage as { template: { id: string } }).template.id).toBe('mcq-own-stimulus');
  });

  it('refuses before calling the provider: an unbound cell without the explicit option, a pack that is not generation-ready, a human policy, the wrong language', async () => {
    let called = 0;
    const counting: GenerationProvider = { id: 'test:count', model: MODEL, generate: async (p) => { called += 1; return { providerId: 'test:count', model: MODEL, promptHash: p.promptHash, rawText: JSON.stringify(response(PERCENT)) }; } };
    const run = (over: Partial<GenerateCandidatesInput>, unit: GenerationUnit = PERCENT) => codeOf(() => generateCandidates({ ...base(unit, over), provider: counting }));
    expect(await run({ options: {} })).toBe('CELL_NOT_BOUND');
    expect(await run({ options: undefined })).toBe('CELL_NOT_BOUND');
    expect(await run({ packs: {} })).toBe('PACK_NOT_GENERATION_READY');
    expect(await run({ packs: { 'math.num.percent': paaGenerationReadyPack('math.num.ratio-proportion', NOW) } })).toBe('PACK_NOT_GENERATION_READY');
    expect(await run({ policy: policy({ author: { kind: 'HUMAN', authorUserId: U(9) } }) })).toBe('POLICY_AUTHOR_IS_NOT_A_MODEL');
    expect(await run({ policy: policy({ copyReferenceExpression: true }) })).toBe('POLICY_INVALID');
    expect(await run({ policy: policy({ language: 'en' }) }, TRIANGLE)).toBe('POLICY_LANGUAGE_IS_NOT_THE_UNITS');
    expect(await run({ cells: [] })).toBe('UNKNOWN_CELL');
    expect(await run({ unit: { type: 'STANDALONE', unitKey: 'x', slot: { slotKey: 'wrong', cellKey: 'c', index: 1, intendedPool: 'PRACTICE' } } as GenerationUnit })).toBe('UNIT_INVALID');
    expect(called).toBe(0);
    // a BOUND cell needs no option; and a real GenerationRequest still refuses an unbound cell
    const cell = cellsOf(PERCENT)[0];
    const bound = { ...cell, binding: { environmentFingerprint: 'test', examVersionId: U(1), topicNodeId: U(2), domainNodeId: U(3), primaryConceptId: U(4) } };
    expect(await run({ cells: [bound], options: {} })).toBe('NO_ERROR');
    expect(called).toBe(1);
    const request = (c: RequirementCell) => GenerationRequestSchema.safeParse({ v: 2, cell: c, references: toReferencePackV1(paaGenerationReadyPack('math.num.percent', NOW)), policy: policy(), desiredCount: 1 });
    expect(request(bound).success).toBe(true);
    expect(request(cell).success).toBe(false);
  });

  it('the unit batches of one run merge into one batch; batches of different runs do not', async () => {
    const a = await generateCandidates({ ...base(PERCENT), provider: answering(response(PERCENT)) });
    const spr = { options: [], distractorRationales: {}, answerKey: '15', numericKey: { kind: 'NUMERIC', value: '15', equivalentFormsAllowed: true } };
    const b = await generateCandidates({ ...base(RATIO), provider: answering(response(RATIO, {}, spr)) });
    const merged = mergeGenerationBatches([a, b]);
    expect(merged.candidates.map((c) => c.cellKey)).toEqual([a.candidates[0].cellKey, b.candidates[0].cellKey]);
    expect(merged.lineage!.units.map((u) => u.generationUnitKey)).toEqual([PERCENT.unitKey, RATIO.unitKey]);
    const other = await generateCandidates({ ...base(RATIO, { runId: 'run-2' }), provider: answering(response(RATIO, {}, spr)) });
    expect(() => mergeGenerationBatches([a, other])).toThrow(/BATCHES_NOT_OF_ONE_RUN/);
    expect(() => mergeGenerationBatches([])).toThrow(/BATCHES_NOT_OF_ONE_RUN/);
    // the same slot generated twice cannot sit in one batch
    expect(() => mergeGenerationBatches([a, a])).toThrow();
  });
});

describe('architecture: the generator is pure, names no provider, and is independent of its validators', () => {
  const files = readdirSync(join(ROOT, PROD, 'generator')).map((f) => `${PROD}/generator/${f}`);
  const code = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

  it('the generator does not import the independent validators, and they do not import the generator', () => {
    for (const f of files) expect(code(f), f).not.toMatch(/independent-validators|originality-gate|structural-validation|validated-candidate/);
    const validators = code(`${PROD}/independent-validators.ts`);
    expect(validators).not.toMatch(/from '\.\/generator\//);
    expect(validators).not.toMatch(/templates'|generate-candidates'|provider'/);
  });

  it('no live provider and no vendor: no network, no gateway, no clock, no randomness, no provider or model name in the harness', () => {
    for (const f of files) {
      expect(code(f), f).not.toMatch(/fetch\(|@\/lib\/ai\/|gateway|process\.env|https?:\/\/|Date\.now\(|new Date\(|Math\.random\(/);
      expect(code(f), f).not.toMatch(/anthropic|openai|claude|gpt-|gemini/i);
    }
    // the only provider implementation in the directory is the recorded one
    expect(files.flatMap((f) => [...code(f).matchAll(/class (\w+) implements GenerationProvider/g)].map((m) => m[1]))).toEqual(['RecordedResponseProvider']);
  });

  it('a template holds structure only: its text names no number of the subject matter and no topic', () => {
    for (const t of DEFAULT_TEMPLATE_REGISTRY as readonly GenerationTemplate[]) {
      expect(t.task, t.id).not.toMatch(/\d{2,}|porcentaje|percent|Pitágoras|triangle rectangle/i);
      for (const byFormat of Object.values(t.fixedInstruction)) for (const s of Object.values(byFormat)) expect(s.length, t.id).toBeLessThan(90);
    }
  });
});
