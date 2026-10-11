/**
 * QUESTION FACTORY CANARY 250 -- OFFLINE. NO NETWORK, NO PROVIDER.
 *
 * What is tested is what the canary will do, not what it found: no call has been made. The end-to-end tests drive
 * the frozen pipeline with a SYNTHETIC transport whose generator answers are recorded QB-R2E responses (used as
 * well-formed stand-ins, never as canary items) and whose reviewer answers are built here.
 */
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { adapt } from '@/lib/assessment-adaptation/adapt';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { SCHOOL_STEM_PERFORMANCE_PROFILE } from '@/lib/assessment-adaptation/school-stem-performance';
import { EA1_COMPONENT_PROFILES, EA1_SYSTEM_PROFILES } from '@/lib/assessment-adaptation/system-profiles';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { generateFromSpecificationV3, SPECIFICATION_TEMPLATE_REGISTRY_V3 } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v3';
import { constructIntegrityOf, constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import type { SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { STEM_PLUS_APPROACH } from '@/lib/learning-approach/learning-approach-profile';
import { storedR2dSelection } from '../../scripts/operations/qb-r2d/stored-selection';
import { RequestRejectedError, type R2eTransport } from '../../scripts/operations/qb-r2e/budget';
import { buildR2eSelection } from '../../scripts/operations/qb-r2e/selection';
import { computeR2fFreezeManifest, readStoredR2fManifest } from '../../scripts/operations/qb-r2f/freeze';
import { buildR2fSelection } from '../../scripts/operations/qb-r2f/selection';
import { budgetRefusalFor, CANARY_CUMULATIVE_CAP_USD, CANARY_GENERATION_MAX_OUTPUT_TOKENS, CANARY_GENERATION_PHASE_CAP_USD, CANARY_REVIEW_MAX_OUTPUT_TOKENS, generationWorstCaseUsd, GENERATOR_PRICE_BASIS, PROJECTION_ASSUMPTIONS, REVIEWER_PRICE_BASIS, reviewWorstCaseUsd } from '../../scripts/operations/qb-canary-250/budget';
import { agreementOf, CALIBRATION_NOT_FOR_RESCORING, CalibrationSetSchema, calibrationSetIssues, DEFECT_CLASS_VOCABULARY, emptyCalibrationSet, SEVERITY_VOCABULARY, type CalibrationSet } from '../../scripts/operations/qb-canary-250/calibration';
import { canaryManifest, loadCanaryEvidence } from '../../scripts/operations/qb-canary-250/evidence';
import { CANARY_FREEZE_ENTRY_FILES, CANARY_RUN_PARAMETERS, canaryFreezeVerdict, canaryFrozenSourceFiles, computeCanaryFreezeManifest, readStoredCanaryFreeze, verifyCanaryFreeze, type CanaryFreezeManifest } from '../../scripts/operations/qb-canary-250/freeze';
import { balanceOf, buildCanaryManifest, canaryFamilies, CANARY_FORMATS, CANARY_TARGET_QUOTAS, CANARY_UNSUPPLIED_STRATA, evidenceClassOf, SCENARIO_DOMAINS, SLOT_GUIDANCE_RULE, targetSequence, type CanarySlot } from '../../scripts/operations/qb-canary-250/manifest';
import { avoidListsOf, CANARY_BATCH_KEY, CANARY_VERSIONS, canaryPolicyFor, deriveGeneration, generationIsClosed, generationMalformedCodeOf, MAX_AUTOMATIC_REGENERATIONS, planGeneration, planReviews, ReplayMismatchError, unitKeyOf, validateBatch } from '../../scripts/operations/qb-canary-250/pipeline';
import { canaryProjection, standInReviewRequests } from '../../scripts/operations/qb-canary-250/projection';
import { CANARY_DIR, CANARY_FILES, deriveCanary, METRIC_DEFINITIONS, serializeCanaryArtifact } from '../../scripts/operations/qb-canary-250/report';
import {
  AI_REVIEW_LABEL, buildReviewInput, decide, DECISION_POLICY, DIMENSION_QUESTIONS, NO_REPAIR_HEURISTIC, parseReviewResponse, REDACTED_GENERATOR_FIELDS, REVIEW_DIMENSIONS, REVIEW_PROVIDER_JSON_SCHEMA, REVIEWER_RUN_PARAMETERS, REVIEWER_SYSTEM_TEXT, REVIEWER_VERSION, reviewRefusalCodeOf, ReviewRefusedError, validatorStrictPass, type ReviewResponse,
} from '../../scripts/operations/qb-canary-250/reviewer';
import { createReviewerLiveTransport, requireReviewerKey, reviewerRequestBody } from '../../scripts/operations/qb-canary-250/reviewer-transport';
import { calibrationTemplate, manifestArtifact, projectionArtifact, transportBehindTheFreeze } from '../../scripts/operations/qb-canary-250/run';
import { RunLog, RunLogError, SlotAlreadyCalledError, type RunHeaderLine, type RunLogLine } from '../../scripts/operations/qb-canary-250/run-log';
import { CANARY_MAX_CONCURRENCY, runPhase, type PlannedCall } from '../../scripts/operations/qb-canary-250/runner';
import { SAMPLE_BOUNDS, selectCalibrationSample, uncertaintyScore, type SampleCandidate } from '../../scripts/operations/qb-canary-250/sample';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const MODEL = 'gpt-5.6-luna';
const T0 = '2026-10-13T09:00:00.000Z';
const evidence = loadCanaryEvidence(ROOT);
const manifest = canaryManifest(ROOT);
const slots = manifest.slots;
const HEADER: RunHeaderLine = { type: 'RUN', kind: 'QB_CANARY_250_RUN_LOG', label: 'synthetic', runId: 'synthetic-run', startedAt: T0, freeze: { freezeCommitSha: 'abc1234', manifestHash: 'f'.repeat(64) }, parameters: {} };
const newLog = (lines: RunLogLine[] = []) => { const written: RunLogLine[] = []; const log = new RunLog(lines, (l) => written.push(l)); if (!log.header()) log.begin(HEADER); return { log, written }; };
const FIX = JSON.parse(read('tests/fixtures/qb-r2f/known-defects.json')) as { qbR2eRawResponses: Record<string, string> };
const STAND_IN_ANSWERS = Object.values(FIX.qbR2eRawResponses);

/** A recorded QB-R2E response the version-3 harness accepts for this slot, or text that is not JSON. A stand-in, not an item of the canary. */
const answerCache = new Map<string, string>();
async function standInAnswerFor(slot: CanarySlot): Promise<string> {
  const hit = answerCache.get(slot.slotId);
  if (hit !== undefined) return hit;
  const plan = planGeneration(slot, MODEL, evidence);
  let answer = 'this is not json';
  for (const raw of STAND_IN_ANSWERS) {
    try {
      await generateFromSpecificationV3({ unit: { unitKey: unitKeyOf(slot.slotId), specification: slot.specification, attempt: 1, avoid: plan.avoid }, constructVocabulary: constructVocabularyOf(slot.construct), constructIntegrity: constructIntegrityOf(slot.construct), policy: canaryPolicyFor(MODEL, slot.specification.variable.language), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V3, provider: new RecordedResponseProvider('t', MODEL, { [plan.promptHash]: raw }), runId: 't', batchKey: CANARY_BATCH_KEY, now: T0 });
      answer = raw; break;
    } catch { /* the harness refused this stand-in for this slot: try the next */ }
  }
  answerCache.set(slot.slotId, answer);
  return answer;
}
const USAGE = { inputTokens: 4000, outputTokens: 1000, reasoningTokens: null, cachedInputTokens: null };
interface FakeTransport extends R2eTransport { calls: string[]; inFlightMax: number }
function fakeTransport(answer: (request: { system: string; user: string }) => Promise<string> | string, o: { usage?: typeof USAGE | null; failAt?: (n: number) => Error | null; finishReason?: string } = {}): FakeTransport {
  let inFlight = 0;
  const t: FakeTransport = {
    providerId: 'fake', model: MODEL, calls: [], inFlightMax: 0,
    async complete(request) {
      t.calls.push(request.user);
      inFlight += 1; t.inFlightMax = Math.max(t.inFlightMax, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 1));
        const e = o.failAt?.(t.calls.length) ?? null;
        if (e) throw e;
        return { rawText: await answer(request), usage: o.usage === undefined ? USAGE : o.usage, servedModel: MODEL, responseId: `r${t.calls.length}`, finishReason: o.finishReason ?? 'stop' };
      } finally { inFlight -= 1; }
    },
  };
  return t;
}
const generationPlans = (): PlannedCall[] => slots.map((s) => { const p = planGeneration(s, MODEL, evidence); return { slotId: s.slotId, requestHash: p.requestHash, system: p.system, user: p.user }; });
const bySlotOfUser = (user: string): CanarySlot => slots.find((s) => unitKeyOf(s.slotId) === (JSON.parse(user) as { unit: { unitKey: string } }).unit.unitKey)!;
const clock = () => { let n = 0; return () => new Date(Date.parse(T0) + (n += 1) * 1000).toISOString(); };
const goodReview = (over: Partial<ReviewResponse> = {}, dims: Partial<Record<(typeof REVIEW_DIMENSIONS)[number], 'PASS' | 'CONCERN' | 'FAIL' | 'NOT_APPLICABLE'>> = {}): ReviewResponse => ({
  independentSolution: { worked: 'Solved from the stem alone.', answers: [{ label: 'item', answer: '5' }], agreesWithKey: 'AGREES', comparison: 'My answer equals the key.' },
  dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((d) => [d, { verdict: dims[d] ?? 'PASS', reason: `Checked ${d.toLowerCase()} against the item.` }])) as ReviewResponse['dimensions'],
  classification: 'APPROVED', reviewerQuestion: null, ...over,
});
const GATES_PASS: SpecificationItemValidationR4['gates'] = { structural: 'PASS', profileCompliance: 'PASS', constructPreservation: 'PASS', answerKey: 'MACHINE_VERIFIED', machineRecomputation: 'PASS', stimulusIntegrity: 'NOT_APPLICABLE', originality: 'PASS_LOW_SIMILARITY', lineage: 'PASS', learnerTextLeakage: 'PASS', itemWriting: 'PASS' } as SpecificationItemValidationR4['gates'];
const gates = (over: Partial<SpecificationItemValidationR4['gates']>) => ({ ...GATES_PASS, ...over }) as SpecificationItemValidationR4['gates'];

describe('1 -- the manifest: 250 stratified slots, every one a distinct specification adapt() accepts', () => {
  const balance = balanceOf(manifest);
  it('250 slots with stable ids, the stated quota per target, and any prefix spread over the systems', () => {
    expect(slots.map((s) => s.slotId)).toEqual(Array.from({ length: 250 }, (_, i) => `c250-${String(i + 1).padStart(3, '0')}`));
    expect(balance.byComponent).toEqual({ 'CAMBRIDGE.9709.P1': 45, 'IB.MATH_AA_HL.P1': 25, 'IB.MATH_AA_HL.P2': 25, 'ICFES.SABER11_MATEMATICAS': 40, 'PAA.MATEMATICAS': 45, 'PISA.MATHEMATICS': 45, SCHOOL_STEM_PERFORMANCE: 25 });
    expect(Object.values(CANARY_TARGET_QUOTAS).reduce((a, b) => a + b, 0)).toBe(250);
    expect(slots.map((s) => s.targetId)).toEqual(targetSequence());
    for (let start = 0; start < 250; start += 25) expect(new Set(slots.slice(start, start + 25).map((s) => s.targetId)).size, `slots ${start + 1}..`).toBe(7);
  });
  it('the balance, pinned: no system, family, response type, band or approach dominates', () => {
    expect(balance.bySystem).toEqual({ CAMBRIDGE: 45, IB: 50, ICFES: 40, PAA: 45, PISA: 45, SCHOOL_STEM_PERFORMANCE: 25 });
    expect(balance.byResponseType).toEqual({ CONSTRUCTED_RESPONSE: 120, NUMERIC_ENTRY: 46, SELECTED_RESPONSE: 84 });
    expect(balance.byResponseFormat).toEqual({ EXTENDED_RESPONSE: 51, NUMERIC_ENTRY: 46, SELECTED_RESPONSE: 84, SHORT_RESPONSE: 69 });
    expect(Object.keys(balance.byFamily)).toHaveLength(10);
    expect([Math.min(...Object.values(balance.byFamily)), Math.max(...Object.values(balance.byFamily))]).toEqual([24, 26]);
    expect(balance.byConcept).toEqual({ 'math.alg.quadratics': 49, 'math.fun.linear-functions-lines': 50, 'math.num.ratio-proportion': 50, 'math.prob.probability': 50, 'math.stat.data-representation': 51 });
    expect(balance.byApproach).toEqual({ STANDARD_BY_ABSENCE: 166, STEM_PLUS: 84 });
    expect(balance.byBand).toEqual({ CHALLENGE: 84, FOUNDATIONAL: 83, STANDARD: 83 });
    expect(balance.byCalculator).toEqual({ ALLOWED: 70, GDC_REQUIRED: 25, NONE: 110, SCIENTIFIC_REQUIRED: 45 });
    expect(balance.byEvidenceClass).toEqual({ DATA_INTERPRETATION: 25, MODELLING: 76, PROCEDURAL: 98, REASONING: 51 });
    expect(balance.byStimulus).toEqual({ NONE: 188, 'TABLE+GRAPH': 37, 'TABLE+GRAPH+DATA_SET': 25 });
    expect(balance.byContextKind).toEqual({ ABSTRACT: 72, OCCUPATIONAL: 42, PERSONAL: 60, SCIENTIFIC: 40, SOCIETAL: 36 });
    expect(balance.bySystemAndResponseType).toEqual({ 'CAMBRIDGE | CONSTRUCTED_RESPONSE': 45, 'IB | CONSTRUCTED_RESPONSE': 50, 'ICFES | SELECTED_RESPONSE': 40, 'PAA | NUMERIC_ENTRY': 24, 'PAA | SELECTED_RESPONSE': 21, 'PISA | NUMERIC_ENTRY': 22, 'PISA | SELECTED_RESPONSE': 23, 'SCHOOL_STEM_PERFORMANCE | CONSTRUCTED_RESPONSE': 25 });
    // said plainly: 250 distinct specifications, no slot shares one; ten invariant hashes (ten families, one construct each)
    expect([balance.distinctSpecifications, balance.slotsSharingASpecification, balance.distinctInvariantHashes, balance.spaceSize]).toEqual([250, 0, 10, 1317]);
  });
  it('every slot adapts: the engine, asked again with the slot\'s explicit request, returns the slot\'s specification -- nothing is forced', () => {
    const families = new Map(canaryFamilies().map((f) => [f.familyId, f]));
    for (const s of slots) {
      const component = EA1_COMPONENT_PROFILES.find((c) => c.componentId === s.targetId);
      const profile = s.targetId === SCHOOL_STEM_PERFORMANCE_PROFILE.profileId ? SCHOOL_STEM_PERFORMANCE_PROFILE : EA1_SYSTEM_PROFILES.find((p) => p.profileId === component!.systemProfileId)!;
      const r = adapt({ family: families.get(s.familyId)!, profile, component, applicability: MATH_POC_APPLICABILITY, ...(s.approach === 'STEM_PLUS' ? { learningApproach: STEM_PLUS_APPROACH } : {}), disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', contentUseClass: 'DEV_TEST_CONTENT', difficultyBand: s.request.difficultyBand, language: s.request.language, context: s.request.context, responseFormat: s.request.responseFormat } });
      expect(r.ok && r.specification.specificationId, s.slotId).toBe(s.specification.specificationId);
      expect(s.specification.contentUseClass).toBe('DEV_TEST_CONTENT');
      expect(CANARY_FORMATS as readonly string[]).toContain(s.specification.variable.responseFormat.format);
      expect((s.specification.learningApproach?.approachId ?? null) === 'STEM_PLUS').toBe(s.approach === 'STEM_PLUS');
    }
  });
  it('no specification of QB-R2D, QB-R2E or QB-R2F is used, and no pinned value repeats one an earlier run used or another slot has', () => {
    const used = new Set([...storedR2dSelection().map((s) => s.specification.specificationId), ...buildR2eSelection().map((s) => s.specification.specificationId), ...buildR2fSelection().map((s) => s.specification.specificationId)]);
    expect(used.size).toBe(60);
    expect(slots.filter((s) => used.has(s.specification.specificationId))).toEqual([]);
    const seen = new Set<string>();
    for (const s of slots) {
      if (s.guidance.claim) { expect(s.guidance.pinnedParameters).toEqual({}); expect(s.construct).toBe('CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY'); continue; }
      const entries = Object.entries(s.guidance.pinnedParameters);
      expect(entries.length, s.slotId).toBeGreaterThan(0);
      const key = `${s.construct}|${JSON.stringify(entries)}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      const [name, value] = entries[0];
      expect(evidence.priorCandidates.filter((c) => c.content.declaredModel.construct === s.construct && c.content.declaredModel.parameters[name] === value), `${s.slotId} ${name}=${value}`).toEqual([]);
      expect(constructVocabularyOf(s.construct)!.parameters).toEqual(expect.arrayContaining(entries.map(([k]) => k)));
    }
    // claim evaluation: the three verdicts in turn
    expect(Object.values(slots.filter((s) => s.guidance.claim).reduce<Record<string, number>>((m, s) => ({ ...m, [s.guidance.claim!.verdict]: (m[s.guidance.claim!.verdict] ?? 0) + 1 }), {})).sort()).toEqual([8, 9, 9]);
    // a scenario domain for every context that is a situation, never the same one twice in a family and context kind
    expect(balance.scenarioDomainReuseWithinFamilyAndContext).toBe(0);
    for (const s of slots) expect(s.guidance.scenarioDomain === null, s.slotId).toBe(s.request.context === 'ABSTRACT');
    expect(Object.values(SCENARIO_DOMAINS).every((d) => d.length === 14 && new Set(d).size === 14)).toBe(true);
  });
  it('is deterministic, and the stored manifest is the one the code builds', () => {
    expect(JSON.stringify(buildCanaryManifest(evidence.priorUse))).toBe(JSON.stringify(manifest));
    expect(read(`${CANARY_DIR}/${CANARY_FILES.manifest}`)).toBe(serializeCanaryArtifact(manifestArtifact(ROOT)));
  });
  it('what the architecture cannot supply is stated, not padded over', () => {
    expect(CANARY_UNSUPPLIED_STRATA.join(' ')).toMatch(/no science/);
    expect(CANARY_UNSUPPLIED_STRATA.join(' ')).toMatch(/ten families, all of lifecycle DRAFT/);
    expect(CANARY_UNSUPPLIED_STRATA.join(' ')).toMatch(/SCHOOL_STEM_PERFORMANCE/);
    expect(CANARY_UNSUPPLIED_STRATA.join(' ')).toMatch(/MULTI_SELECT and MATH_EXPRESSION/);
    expect(CANARY_UNSUPPLIED_STRATA).toHaveLength(12);
    expect([evidenceClassOf(['SOLVE']), evidenceClassOf(['FORMULATE', 'SOLVE', 'INTERPRET']), evidenceClassOf(['INTERPRET', 'EVALUATE']), evidenceClassOf(['INTERPRET', 'COMPUTE']), evidenceClassOf(['FORMULATE', 'COMPUTE', 'EVALUATE'])]).toEqual(['PROCEDURAL', 'MODELLING', 'REASONING', 'DATA_INTERPRETATION', 'REASONING']);
  });
});

describe('2 -- generation: generator version 3, one first attempt per slot, slot guidance, no regeneration', () => {
  it('the request is the version-3 prompt plus slotGuidance; both hashes are kept; requests are unique', () => {
    const plans = slots.map((s) => planGeneration(s, MODEL, evidence));
    expect(new Set(plans.map((p) => p.requestHash)).size).toBe(250);
    expect(new Set(plans.map((p) => p.promptHash)).size).toBe(250);
    const p = plans[2], i = JSON.parse(p.user) as { harness: { version: string }; unit: { unitKey: string; attempt: number }; slotGuidance: Record<string, unknown>; avoid: { parameterSets: unknown[]; scenarios: string[] }; specification: { specificationId: string } };
    expect(p.requestHash).not.toBe(p.promptHash);
    expect([i.harness.version, i.unit, i.specification.specificationId]).toEqual(['3', { unitKey: 'c250-003#a1', attempt: 1 }, slots[2].specification.specificationId]);
    expect(i.slotGuidance).toEqual({ id: 'qb-canary-250-slot-guidance', version: '1', scenarioDomain: 'a chemistry laboratory', pinnedParameters: { m: 2 }, claim: null, rule: SLOT_GUIDANCE_RULE });
    expect([MAX_AUTOMATIC_REGENERATIONS, CANARY_VERSIONS.generator.harness.version, CANARY_VERSIONS.validators.revision, CANARY_VERSIONS.reviewer.version]).toEqual([0, '3', 4, '1']);
  });
  it('a prompt does not depend on any other answer of the run, and carries no item text of an earlier run', () => {
    const avoid = avoidListsOf(slots[2], evidence);
    expect(avoid.scenarios.every((s) => s.length <= 120)).toBe(true);
    expect(avoid.parameterSets.length).toBeGreaterThan(0);
    const before = planGeneration(slots[40], MODEL, evidence).requestHash;
    const { log } = newLog();
    log.startCall({ phase: 'GENERATION', slotId: slots[0].slotId, requestHash: 'x', at: T0, provider: 'p', requestedModel: MODEL, maxOutputTokens: 1, inputTokenUpperBound: 1, worstCaseCostUsdAssumed: 0 });
    expect(planGeneration(slots[40], MODEL, evidence).requestHash).toBe(before);
    for (const s of [slots[0], slots[2], slots[9]]) { const user = planGeneration(s, MODEL, evidence).user; for (const c of evidence.priorCandidates) expect(user.includes(c.content.stem), `${s.slotId} / ${c.unitKey}`).toBe(false); }
  });
});

describe('3 -- the reviewer sees the item, not what the generator said about it', () => {
  const standIn = standInReviewRequests(ROOT);
  it('every member of the generator\'s own account is absent from the request; the item, the key and the mark scheme are there', async () => {
    const { log } = newLog();
    const target = slots.filter((s) => s.strata.responseType !== 'SELECTED_RESPONSE').slice(0, 30);
    const picked: CanarySlot[] = [];
    for (const s of [...slots.filter((x) => x.strata.responseType === 'SELECTED_RESPONSE').slice(0, 30), ...target]) if ((await standInAnswerFor(s)) !== 'this is not json') picked.push(s);
    expect(new Set(picked.map((s) => s.strata.responseType)).size).toBe(3);
    for (const s of picked) { const p = planGeneration(s, MODEL, evidence); log.startCall({ phase: 'GENERATION', slotId: s.slotId, requestHash: p.requestHash, at: T0, provider: 'p', requestedModel: MODEL, maxOutputTokens: 1, inputTokenUpperBound: 1, worstCaseCostUsdAssumed: 0 }); log.finishCall({ phase: 'GENERATION', slotId: s.slotId, requestHash: p.requestHash, at: T0, status: 'WELL_FORMED', detail: null, servedModel: null, responseId: null, finishReason: 'stop', usage: null, usageSource: 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdAssumed: 0, rawText: await standInAnswerFor(s) }); }
    const results = (await deriveGeneration({ ...manifest, slots: picked }, log, evidence, MODEL)).filter((r) => r.candidate);
    const validations = validateBatch(results, evidence);
    for (const r of results) {
      // sentinels in every redacted member
      const c = JSON.parse(JSON.stringify(r.candidate)) as SpecificationCandidate;
      c.content.rationale = 'SENTINEL_RATIONALE';
      c.content.context.description = 'SENTINEL_CONTEXT_DESCRIPTION';
      c.content.declaredModel.parameters = { sentinelParameter: 918273645 };
      c.content.usesStimulusValues = [564738291];
      c.content.proposedSupportingConceptStableIds = ['SENTINEL_SUPPORTING_CONCEPT'];
      if (c.content.selected) { for (const k of Object.keys(c.content.selected.distractors)) c.content.selected.distractors[k] = { misconceptionModelId: 'SENTINEL_MISCONCEPTION', rationale: 'SENTINEL_DISTRACTOR_RATIONALE' }; c.content.selected.target = { kind: 'NOT_MACHINE_CHECKABLE', reason: 'SENTINEL_TARGET_REASON' }; (c.content.selected.answerCheck as Record<string, unknown>).sentinel = 'SENTINEL_ANSWER_CHECK'; }
      if (c.content.numeric) { c.content.numeric.target = { kind: 'NOT_MACHINE_CHECKABLE', reason: 'SENTINEL_TARGET_REASON' }; (c.content.numeric.answerCheck as Record<string, unknown>).sentinel = 'SENTINEL_ANSWER_CHECK'; }
      if (c.content.constructed) { c.content.constructed.workingOutline = ['SENTINEL_WORKING_OUTLINE']; for (const p of c.content.constructed.parts) { p.target = { kind: 'NOT_MACHINE_CHECKABLE', reason: 'SENTINEL_TARGET_REASON' }; (p.answerCheck as Record<string, unknown>).sentinel = 'SENTINEL_ANSWER_CHECK'; } }
      const input = buildReviewInput({ slotId: r.slot.slotId, specification: r.slot.specification, candidate: c, stimulus: r.stimulus, validation: validations.get(r.slot.slotId)! });
      const text = JSON.stringify(input);
      expect(text, r.slot.slotId).not.toMatch(/SENTINEL|918273645|564738291|sentinelParameter/);
      expect(text).not.toMatch(/"(rationale|declaredModel|answerCheck|workingOutline|usesStimulusValues|misconceptionModelId|renderedAssets|proposedSupportingConceptStableIds)"/);
      // (the specification has a member called distractors -- its policy for them; the ITEM's distractor rationales are what must be absent)
      expect(JSON.stringify(input.item)).not.toMatch(/"(distractors|target|context)"/);
      expect(Object.keys(input.item).sort()).toEqual(['constructed', 'credit', 'difficultyBand', 'language', 'marks', 'numeric', 'responseFormat', 'selected', 'stem']);
      // what a marker needs IS there
      expect(input.item.stem).toBe(c.content.stem);
      if (c.content.selected) expect(input.item.selected).toEqual({ options: c.content.selected.options, answerKey: c.content.selected.answerKey });
      if (c.content.numeric) expect(input.item.numeric).toEqual({ numericKey: c.content.numeric.numericKey });
      if (c.content.constructed) { expect(Object.keys(input.item.constructed!.parts[0]).sort()).toEqual(['commandTerm', 'finalAnswer', 'label', 'markScheme', 'marks', 'numericKey', 'prompt']); expect(input.item.constructed!.parts.map((p) => p.finalAnswer)).toEqual(c.content.constructed.parts.map((p) => p.finalAnswer)); }
      // every input the reviewer must receive
      expect(Object.keys(input)).toEqual(['reviewer', 'slotId', 'canonicalConcept', 'evidenceTarget', 'assessmentProfile', 'assessmentComponent', 'taskFamily', 'learningApproach', 'adaptationSpecification', 'item', 'stimulus', 'lineage', 'deterministicValidatorResults', 'dimensions']);
      expect(Object.keys(input.deterministicValidatorResults)).toEqual(['validatorsRevision', 'gates', 'structuralIssues', 'profileIssues', 'constructIssues', 'constructWeak', 'answerUnits', 'batchDiversity', 'itemWritingFlags', 'learnerTextLeakage']);
      expect(JSON.stringify(input.adaptationSpecification)).not.toMatch(/"provenance"/);
    }
    expect(REDACTED_GENERATOR_FIELDS).toHaveLength(14);
  });
  it('the reviewer is told to solve first, to judge and not to repair, and that it approves nothing', () => {
    expect(REVIEWER_SYSTEM_TEXT).toMatch(/FIRST solve the item yourself/);
    expect(REVIEWER_SYSTEM_TEXT).toMatch(/You do NOT repair: never write a corrected stem, key, option, mark scheme or item/);
    expect(REVIEWER_SYSTEM_TEXT).toMatch(/not a human review and approves nothing for use/);
    expect(REVIEWER_SYSTEM_TEXT).toMatch(/exactly ONE precise question/);
    expect(Object.keys(DIMENSION_QUESTIONS)).toEqual(['ACADEMIC_CORRECTNESS', 'CONSTRUCT_VALIDITY', 'PROFILE_FIDELITY', 'RESPONSE_CONTRACT', 'DIFFICULTY', 'LEARNER_QUALITY', 'STIMULUS_INTEGRITY', 'ORIGINALITY', 'FAIRNESS_AMBIGUITY', 'LINEAGE_CONSISTENCY']);
    expect(standIn).toHaveLength(22);
    expect(standIn[0].user).not.toMatch(/"rationale"|"declaredModel"|"workingOutline"/);
  });
  it('the reviewer is another provider and another model than the generator, with a version', () => {
    expect([REVIEWER_RUN_PARAMETERS.provider, REVIEWER_RUN_PARAMETERS.model, CANARY_RUN_PARAMETERS.generator.provider, CANARY_RUN_PARAMETERS.generator.model]).toEqual(['anthropic', 'claude-sonnet-5-5', 'openai', 'gpt-5.6-luna']);
    expect(REVIEWER_VERSION).toEqual({ id: 'studyus-ai-item-reviewer', version: '1', promptVersion: '1', schemaVersion: '1', redactionVersion: '1', decisionPolicyVersion: '1' });
    expect(reviewerRequestBody({ system: 's', user: 'u', maxOutputTokens: 1600 })).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 1600, system: 's', messages: [{ role: 'user', content: 'u' }], thinking: { type: 'between_tools' }, output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_PROVIDER_JSON_SCHEMA } } });
    expect(AI_REVIEW_LABEL).toMatch(/NOT a human review; grants no approval; changes no lifecycle; review status stays BLOCKED_NO_QUALIFIED_REVIEWER/);
  });
});

describe('4 -- the review response: strict, and never a repair', () => {
  const ok = JSON.stringify(goodReview());
  const refusal = (v: unknown) => reviewRefusalCodeOf(typeof v === 'string' ? v : JSON.stringify(v));
  it('a well-formed review parses; anything else is refused by name -- and a refusal is a reviewer failure, never an approval', () => {
    expect(parseReviewResponse(ok)).toEqual(goodReview());
    expect(refusal('not json at all')).toBe('REVIEW_RESPONSE_NOT_JSON');
    expect(refusal('')).toBe('REVIEW_RESPONSE_NOT_JSON');
    expect(refusal({ ...goodReview(), confidence: 0.9 })).toBe('REVIEW_SCHEMA_INVALID');
    const noDim = goodReview() as unknown as { dimensions: Record<string, unknown> }; delete noDim.dimensions.ORIGINALITY;
    expect(refusal(noDim)).toBe('REVIEW_SCHEMA_INVALID');
    expect(refusal({ ...goodReview(), classification: 'ACCEPTED' })).toBe('REVIEW_SCHEMA_INVALID');
    expect(refusal(goodReview({}, {}) && { ...goodReview(), dimensions: { ...goodReview().dimensions, DIFFICULTY: { verdict: 'MAYBE', reason: 'x' } } })).toBe('REVIEW_SCHEMA_INVALID');
    expect(() => parseReviewResponse('{}')).toThrow(ReviewRefusedError);
  });
  it('exactly one question, when and only when the reviewer sends the item to a person', () => {
    expect(refusal(goodReview({ classification: 'NEEDS_HUMAN_REVIEW' }))).toBe('REVIEW_QUESTION_MISSING');
    expect(refusal(goodReview({ reviewerQuestion: 'Is the key of part b right?' }))).toBe('REVIEW_QUESTION_WITHOUT_NEEDS_HUMAN_REVIEW');
    expect(refusal(goodReview({ classification: 'NEEDS_HUMAN_REVIEW', reviewerQuestion: 'Is the key right? Is the stem clear?' }))).toBe('REVIEW_QUESTION_NOT_EXACTLY_ONE');
    expect(refusal(goodReview({ classification: 'NEEDS_HUMAN_REVIEW', reviewerQuestion: 'The key should be checked by someone.' }))).toBe('REVIEW_QUESTION_NOT_EXACTLY_ONE');
    expect(refusal(goodReview({ classification: 'NEEDS_HUMAN_REVIEW', reviewerQuestion: 'Does option C also satisfy the stem as written?' }))).toBeNull();
  });
  it('a response that carries a replacement item is refused whole', () => {
    for (const extra of [{ revisedStem: 'A better stem' }, { correctedKey: 'B' }, { suggested_options: [] }, { item: { stem: 'x' } }, { stem: 'x' }, { rewrittenItem: {} }, { newAnswerKey: 'C' }, { improvedWording: 'x' }]) expect(refusal({ ...goodReview(), ...extra }), JSON.stringify(extra)).toBe('REVIEW_CONTAINS_A_REPLACEMENT_ITEM');
    expect(refusal({ ...goodReview(), dimensions: { ...goodReview().dimensions, LEARNER_QUALITY: { verdict: 'CONCERN', reason: 'x', proposedStem: 'y' } } })).toBe('REVIEW_CONTAINS_A_REPLACEMENT_ITEM');
    for (const text of ['The stem is unclear. Corrected stem: "Find the rate."', 'It should read: how many litres are needed?', 'Rewrite the stem as: a tank holds 40 litres.', 'Suggested options: A 3, B 4.', 'Revised key: C']) expect(refusal({ ...goodReview({ classification: 'REJECTED' }, { LEARNER_QUALITY: 'FAIL' }), dimensions: { ...goodReview().dimensions, LEARNER_QUALITY: { verdict: 'FAIL', reason: text } } }), text).toBe('REVIEW_CONTAINS_A_REPLACEMENT_ITEM');
    // saying what is wrong, and the reviewer's own answer, are not a repair
    const judged = goodReview({ classification: 'REJECTED', independentSolution: { worked: 'Rate is 84 / 24 = 3.5 per unit.', answers: [{ label: 'item', answer: '3.5' }], agreesWithKey: 'DISAGREES', comparison: 'The key says 4; I get 3.5.' } }, { ACADEMIC_CORRECTNESS: 'FAIL' });
    expect(refusal(judged)).toBeNull();
    expect(NO_REPAIR_HEURISTIC.rule).toMatch(/A heuristic: it catches the forms named, not every paraphrase/);
  });
  it('the provider schema is closed everywhere and names the ten dimensions', () => {
    const walk = (s: unknown): void => { if (s && typeof s === 'object') { const o = s as Record<string, unknown>; if (o.type === 'object') { expect(o.additionalProperties).toBe(false); expect((o.required as string[]).sort()).toEqual(Object.keys(o.properties as object).sort()); } expect('minLength' in o || 'maxLength' in o).toBe(false); Object.values(o).forEach(walk); } };
    walk(REVIEW_PROVIDER_JSON_SCHEMA);
    expect(Object.keys(REVIEW_PROVIDER_JSON_SCHEMA.properties.dimensions.properties)).toEqual([...REVIEW_DIMENSIONS]);
    expect(Object.keys(REVIEW_PROVIDER_JSON_SCHEMA.properties)).toEqual(['independentSolution', 'dimensions', 'classification', 'reviewerQuestion']);
  });
});

describe('5 -- the decision policy: code decides, the model proposes, a validator failure is never overridden', () => {
  const d = (review: ReviewResponse, g = GATES_PASS) => { const x = decide(review, g); return `${x.classification}|${x.rule}|${x.disagreements.join('+')}`; };
  const nhr = (dims: Parameters<typeof goodReview>[1], over: Partial<ReviewResponse> = {}) => goodReview({ classification: 'NEEDS_HUMAN_REVIEW', reviewerQuestion: 'Is this acceptable as it stands?', ...over }, dims);
  const rej = (dims: Parameters<typeof goodReview>[1], over: Partial<ReviewResponse> = {}) => goodReview({ classification: 'REJECTED', ...over }, dims);
  const disagrees = { independentSolution: { ...goodReview().independentSolution, agreesWithKey: 'DISAGREES' as const } };
  it('each rule', () => {
    expect(d(goodReview())).toBe('APPROVED|R8|');
    // R1: a deterministic validator failure rejects, and the disagreement is recorded
    for (const g of [gates({ structural: 'FAIL' }), gates({ answerKey: 'FAILED' }), gates({ machineRecomputation: 'FAIL' }), gates({ lineage: 'FAIL' }), gates({ learnerTextLeakage: 'FAIL' })]) expect(d(goodReview(), g)).toBe('REJECTED|R1|VALIDATOR_FAIL_REVIEWER_PASS+REVIEWER_PROPOSAL_LAXER_THAN_POLICY');
    expect(d(rej({ ACADEMIC_CORRECTNESS: 'FAIL' }), gates({ answerKey: 'FAILED' }))).toBe('REJECTED|R1|');
    // R2
    for (const dim of ['CONSTRUCT_VALIDITY', 'RESPONSE_CONTRACT', 'STIMULUS_INTEGRITY', 'FAIRNESS_AMBIGUITY'] as const) expect(d(rej({ [dim]: 'FAIL' })), dim).toBe('REJECTED|R2|REVIEWER_FAIL_VALIDATOR_STRICT_PASS');
    expect(d(rej({ ACADEMIC_CORRECTNESS: 'FAIL' }), gates({ answerKey: 'HUMAN_REVIEW_REQUIRED' }))).toBe('REJECTED|R2|REVIEWER_FAIL_VALIDATOR_STRICT_PASS');
    // R3: the reviewer against a machine-verified key -> a person decides
    expect(d(rej({ ACADEMIC_CORRECTNESS: 'FAIL' }, disagrees))).toBe('REJECTED|R3+R9|REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY+REVIEWER_PROPOSAL_STRICTER_THAN_ITS_VERDICTS');
    expect(d(nhr({}, disagrees))).toBe('NEEDS_HUMAN_REVIEW|R3|REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY');
    // R4
    expect(d(rej({}, disagrees), gates({ answerKey: 'DETERMINISTIC_RULE_VERIFIED' }))).toBe('REJECTED|R4|REVIEWER_FAIL_VALIDATOR_STRICT_PASS');
    // R5: a disputable validator failure with a reviewer that saw nothing wrong
    for (const g of [gates({ profileCompliance: 'FAIL' }), gates({ constructPreservation: 'FAIL' }), gates({ stimulusIntegrity: 'FAIL' }), gates({ originality: 'REVIEW_STRUCTURAL_SIMILARITY' })]) expect(d(goodReview(), g)).toBe('NEEDS_HUMAN_REVIEW|R5|VALIDATOR_FAIL_REVIEWER_PASS+REVIEWER_PROPOSAL_LAXER_THAN_POLICY');
    // R6
    expect(d(nhr({ DIFFICULTY: 'CONCERN' }))).toBe('NEEDS_HUMAN_REVIEW|R6|');
    expect(d(nhr({ PROFILE_FIDELITY: 'FAIL' }))).toBe('NEEDS_HUMAN_REVIEW|R6|');
    expect(d(nhr({}, { independentSolution: { ...goodReview().independentSolution, agreesWithKey: 'CANNOT_DETERMINE' } }))).toBe('NEEDS_HUMAN_REVIEW|R6|');
    expect(d(goodReview({}, { LEARNER_QUALITY: 'CONCERN' }))).toBe('NEEDS_HUMAN_REVIEW|R6|REVIEWER_PROPOSAL_LAXER_THAN_POLICY');
    // R7: the validators doubt, the reviewer does not
    expect(d(goodReview(), gates({ constructPreservation: 'WEAK' }))).toBe('NEEDS_HUMAN_REVIEW|R7|VALIDATOR_DOUBT_REVIEWER_PASS+REVIEWER_PROPOSAL_LAXER_THAN_POLICY');
    expect(d(goodReview(), gates({ itemWriting: 'FLAGGED' }))).toBe('NEEDS_HUMAN_REVIEW|R7|VALIDATOR_DOUBT_REVIEWER_PASS+REVIEWER_PROPOSAL_LAXER_THAN_POLICY');
    // R8 holds with a key the validators could not verify themselves: that is what the reviewer's own solution is for
    expect(d(goodReview(), gates({ answerKey: 'HUMAN_REVIEW_REQUIRED' }))).toBe('APPROVED|R8|');
    // R9: the reviewer's proposal can only make it stricter
    expect(d(rej({}))).toBe('REJECTED|R8+R9|REVIEWER_PROPOSAL_STRICTER_THAN_ITS_VERDICTS');
    expect(d(nhr({}))).toBe('NEEDS_HUMAN_REVIEW|R8+R9|REVIEWER_PROPOSAL_STRICTER_THAN_ITS_VERDICTS');
  });
  it('APPROVED is impossible unless the validators strictly passed, every dimension passed, the solution agrees and the reviewer proposed it', () => {
    const variants: Array<SpecificationItemValidationR4['gates']> = [GATES_PASS, gates({ answerKey: 'HUMAN_REVIEW_REQUIRED' }), gates({ answerKey: 'DETERMINISTIC_RULE_VERIFIED' }), gates({ structural: 'FAIL' }), gates({ profileCompliance: 'FAIL' }), gates({ constructPreservation: 'FAIL' }), gates({ constructPreservation: 'WEAK' }), gates({ answerKey: 'FAILED' }), gates({ machineRecomputation: 'FAIL' }), gates({ stimulusIntegrity: 'FAIL' }), gates({ originality: 'REVIEW_STRUCTURAL_SIMILARITY' }), gates({ originality: 'REJECT_TEXTUAL_SIMILARITY' }), gates({ lineage: 'FAIL' }), gates({ learnerTextLeakage: 'FAIL' }), gates({ itemWriting: 'FLAGGED' })];
    const reviews: ReviewResponse[] = [goodReview(), ...REVIEW_DIMENSIONS.flatMap((dim) => [goodReview({}, { [dim]: 'CONCERN' }), goodReview({}, { [dim]: 'FAIL' }), goodReview({}, { [dim]: 'NOT_APPLICABLE' })]), goodReview(disagrees), goodReview({ independentSolution: { ...goodReview().independentSolution, agreesWithKey: 'CANNOT_DETERMINE' } }), rej({}), nhr({})];
    let approved = 0;
    for (const g of variants) for (const r of reviews) {
      const x = decide(r, g);
      expect([x.kind, x.isHumanReview, x.reviewStatus, x.policy]).toEqual(['AI_REVIEW', false, 'BLOCKED_NO_QUALIFIED_REVIEWER', { id: DECISION_POLICY.id, version: '1' }]);
      expect((x.reviewerQuestion !== null) === (x.classification === 'NEEDS_HUMAN_REVIEW')).toBe(true);
      if (x.reviewerQuestion) expect((x.reviewerQuestion.question.match(/\?/g) ?? []).length).toBe(1);
      if (x.classification !== 'APPROVED') continue;
      approved += 1;
      expect(validatorStrictPass(g)).toBe(true);
      expect(REVIEW_DIMENSIONS.every((dim) => ['PASS', 'NOT_APPLICABLE'].includes(r.dimensions[dim].verdict))).toBe(true);
      expect([r.independentSolution.agreesWithKey, r.classification]).toEqual(['AGREES', 'APPROVED']);
    }
    expect(approved).toBe(3 * 11);
    expect(DECISION_POLICY.rules).toHaveLength(11);
  });
  it('a policy-made NEEDS_HUMAN_REVIEW carries one question of the policy\'s own, marked as such', () => {
    const x = decide(goodReview(), gates({ profileCompliance: 'FAIL' }));
    expect(x.reviewerQuestion).toEqual({ question: 'The decision policy sent this item to a person by rule R5 (validator:profileCompliance): is the item correct and usable as it stands?', source: 'DECISION_POLICY' });
    expect(decide(nhr({ DIFFICULTY: 'CONCERN' }), GATES_PASS).reviewerQuestion).toEqual({ question: 'Is this acceptable as it stands?', source: 'AI_REVIEWER' });
  });
});

describe('6 -- the run log: one call per slot by construction, and a pre-stated rule for a crash', () => {
  const started = (slotId: string, phase: 'GENERATION' | 'REVIEW' = 'GENERATION', worst = 0.08) => ({ phase, slotId, requestHash: `h-${slotId}`, at: T0, provider: 'p', requestedModel: MODEL, maxOutputTokens: 2150, inputTokenUpperBound: 5000, worstCaseCostUsdAssumed: worst });
  const finished = (slotId: string, phase: 'GENERATION' | 'REVIEW' = 'GENERATION', cost = 0.05) => ({ phase, slotId, requestHash: `h-${slotId}`, at: T0, status: 'WELL_FORMED' as const, detail: null, servedModel: MODEL, responseId: 'r', finishReason: 'stop', usage: USAGE, usageSource: 'PROVIDER_USAGE_RESPONSE' as const, costUsdAssumed: cost, rawText: '{}' });
  it('a second call for a slot is impossible: any existing line for the slot and phase refuses it', () => {
    const { log } = newLog();
    log.startCall(started('c250-001'));
    expect(() => log.startCall(started('c250-001'))).toThrow(SlotAlreadyCalledError);
    log.finishCall(finished('c250-001'));
    expect(() => log.startCall(started('c250-001'))).toThrow(/SLOT_ALREADY_HAS_A_GENERATION_RECORD: c250-001 \(CALL_STARTED\+CALL_FINISHED\)/);
    expect(() => log.finishCall(finished('c250-001'))).toThrow(RunLogError);
    log.closeNotCalled({ phase: 'GENERATION', slotId: 'c250-002', at: T0, reason: 'BUDGET_STOP', detail: 'x' });
    expect(() => log.startCall(started('c250-002'))).toThrow(SlotAlreadyCalledError);
    expect(() => log.closeNotCalled({ phase: 'GENERATION', slotId: 'c250-001', at: T0, reason: 'BUDGET_STOP', detail: 'x' })).toThrow(SlotAlreadyCalledError);
    expect(() => log.finishCall(finished('c250-003'))).toThrow(/CALL_FINISHED_WITHOUT_ONE_CALL_STARTED/);
    log.startCall(started('c250-004'));
    expect(() => log.finishCall({ ...finished('c250-004'), requestHash: 'another' })).toThrow(/CALL_FINISHED_FOR_ANOTHER_REQUEST/);
    // the review of a slot is another call, also made once
    log.startCall(started('c250-001', 'REVIEW'));
    expect(() => log.startCall(started('c250-001', 'REVIEW'))).toThrow(SlotAlreadyCalledError);
  });
  it('the same holds for a log read back from disk, so a resumed process cannot call a slot again', () => {
    const { log, written } = newLog();
    log.startCall(started('c250-001')); log.finishCall(finished('c250-001')); log.startCall(started('c250-002'));
    const text = written.map((l) => RunLog.serializeLine(l)).join('');
    const resumed = new RunLog(RunLog.parse(text));
    expect(resumed.lines).toEqual(log.lines);
    expect(() => resumed.startCall(started('c250-001'))).toThrow(SlotAlreadyCalledError);
    expect(() => resumed.startCall(started('c250-002'))).toThrow(SlotAlreadyCalledError);
    // a log that itself holds two calls for a slot is refused when it is read
    expect(() => new RunLog([HEADER, { type: 'CALL_STARTED', ...started('c250-009') }, { type: 'CALL_STARTED', ...started('c250-009') }])).toThrow(SlotAlreadyCalledError);
    expect(() => new RunLog([{ type: 'CALL_STARTED', ...started('c250-009') }, HEADER])).toThrow(/RUN_HEADER_NOT_FIRST/);
  });
  it('a call started and never recorded is a provider failure, charged at its worst case, and not called again', () => {
    const { log } = newLog();
    log.startCall(started('c250-001', 'GENERATION', 0.08)); log.finishCall(finished('c250-001', 'GENERATION', 0.05));
    log.startCall(started('c250-002', 'GENERATION', 0.08));
    expect(log.outcomeOf('GENERATION', 'c250-002').state).toBe('NO_RESPONSE_RECORDED');
    expect(log.outcomeOf('GENERATION', 'c250-003').state).toBe('NOT_RUN');
    expect(log.spentUsd()).toBeCloseTo(0.05 + 0.08, 12);
    expect([log.callsOf('GENERATION'), log.callsOf('REVIEW'), log.spentUsdOf('REVIEW')]).toEqual([2, 0, 0]);
  });
});

describe('7 -- the runner: budget before every call, resumable, no retry, stop rules', () => {
  const plans = generationPlans();
  const worst = (p: PlannedCall) => generationWorstCaseUsd(p.system.length + p.user.length);
  it('250 slots, four at a time: every slot called exactly once; invoked again, nothing is called', async () => {
    const { log } = newLog();
    const t = fakeTransport(() => 'not json');
    const run = await runPhase({ phase: 'GENERATION', plans, log, transport: t, priorUsd: 0, concurrency: 4, now: clock(), malformedCodeOf: generationMalformedCodeOf, caps: { cumulative: 1000, generationPhase: 1000 } });
    expect([run.started, run.finished, run.closedByBudget, run.halted, t.calls.length]).toEqual([250, 250, 0, null, 250]);
    expect(new Set(t.calls).size).toBe(250);
    expect(t.inFlightMax).toBe(4);
    const again = await runPhase({ phase: 'GENERATION', plans, log, transport: t, priorUsd: 0, concurrency: 4, now: clock(), malformedCodeOf: generationMalformedCodeOf, caps: { cumulative: 1000, generationPhase: 1000 } });
    expect([again.started, t.calls.length]).toEqual([0, 250]);
    await expect(runPhase({ phase: 'GENERATION', plans, log, transport: t, priorUsd: 0, concurrency: CANARY_MAX_CONCURRENCY + 1, now: clock(), malformedCodeOf: generationMalformedCodeOf })).rejects.toThrow(/CONCURRENCY_OUT_OF_RANGE/);
  });
  it('RESUMABLE: stopped part-way and resumed from the log on disk, including a call that died mid-flight', async () => {
    const first = newLog();
    const t1 = fakeTransport(() => 'not json');
    await runPhase({ phase: 'GENERATION', plans: plans.slice(0, 60), log: first.log, transport: t1, priorUsd: 0, concurrency: 3, now: clock(), malformedCodeOf: generationMalformedCodeOf, caps: { cumulative: 1000, generationPhase: 1000 } });
    // the process dies while slot 61 is out: CALL_STARTED is on disk, nothing else
    first.log.startCall({ phase: 'GENERATION', slotId: plans[60].slotId, requestHash: plans[60].requestHash, at: T0, provider: 'fake', requestedModel: MODEL, maxOutputTokens: 2150, inputTokenUpperBound: 1, worstCaseCostUsdAssumed: worst(plans[60]) });
    const resumed = new RunLog(RunLog.parse(first.written.map((l) => RunLog.serializeLine(l)).join('')));
    const t2 = fakeTransport(() => 'not json');
    const run = await runPhase({ phase: 'GENERATION', plans, log: resumed, transport: t2, priorUsd: 0, concurrency: 4, now: clock(), malformedCodeOf: generationMalformedCodeOf, caps: { cumulative: 1000, generationPhase: 1000 } });
    expect([t1.calls.length, t2.calls.length, run.started]).toEqual([60, 189, 189]);
    const called = [...t1.calls, ...t2.calls].map((u) => bySlotOfUser(u).slotId);
    expect(new Set(called).size).toBe(249);
    expect(called).not.toContain(plans[60].slotId);
    const results = await deriveGeneration(manifest, resumed, evidence, MODEL);
    expect([results[60].state, results[60].code, generationIsClosed(results)]).toEqual(['NO_CONTENT', 'NO_RESPONSE_RECORDED', true]);
  });
  it('BUDGET: no call is made that could take the cumulative spend over USD 30, for either kind of call', async () => {
    expect([CANARY_CUMULATIVE_CAP_USD, CANARY_GENERATION_PHASE_CAP_USD, GENERATOR_PRICE_BASIS.inputPerMillionUsd, GENERATOR_PRICE_BASIS.outputPerMillionUsd, REVIEWER_PRICE_BASIS.inputPerMillionUsd, REVIEWER_PRICE_BASIS.outputPerMillionUsd, REVIEWER_PRICE_BASIS.label]).toEqual([30, 19, 5, 30, 5, 30, 'ASSUMED']);
    expect([budgetRefusalFor('GENERATION', 18.95, 0.06), budgetRefusalFor('GENERATION', 18.9, 0.06), budgetRefusalFor('REVIEW', 29.95, 0.06), budgetRefusalFor('REVIEW', 29.9, 0.06), budgetRefusalFor('REVIEW', 20, 0.06), budgetRefusalFor('GENERATION', 29.99, 0.06)]).toEqual(['GENERATION_PHASE_CAP', null, 'CUMULATIVE_CAP', null, null, 'CUMULATIVE_CAP']);
    for (const phase of ['GENERATION', 'REVIEW'] as const) {
      const { log } = newLog();
      const t = fakeTransport(() => 'x', { usage: null });
      const prior = phase === 'GENERATION' ? 18.75 : 29.75;
      const run = await runPhase({ phase, plans: plans.slice(0, 40), log, transport: t, priorUsd: prior, concurrency: 4, now: clock(), malformedCodeOf: () => 'X' });
      // usage unreported -> every call charged at its worst case; the cap is never passed, and the first refusal closes the rest in order
      expect(prior + log.spentUsd(), phase).toBeLessThanOrEqual(phase === 'GENERATION' ? 19 : 30);
      expect(run.started, phase).toBeGreaterThan(0);
      expect(run.started + run.closedByBudget).toBe(40);
      expect(t.calls.length).toBe(run.started);
      const states = plans.slice(0, 40).map((p) => log.outcomeOf(phase, p.slotId).state);
      expect(states.slice(0, run.started).every((s) => s === 'FINISHED')).toBe(true);
      expect(states.slice(run.started).every((s) => s === 'NOT_CALLED_BUDGET_STOP')).toBe(true);
      // closed slots are terminal: more money later does not reopen them
      const later = await runPhase({ phase, plans: plans.slice(0, 40), log, transport: t, priorUsd: 0, concurrency: 4, now: clock(), malformedCodeOf: () => 'X' });
      expect([later.started, t.calls.length]).toEqual([0, run.started]);
    }
    // nothing fits: no call at all
    const none = newLog();
    const t = fakeTransport(() => 'x');
    const run = await runPhase({ phase: 'REVIEW', plans: plans.slice(0, 5), log: none.log, transport: t, priorUsd: 29.999, concurrency: 2, now: clock(), malformedCodeOf: () => null });
    expect([run.started, run.closedByBudget, t.calls.length]).toEqual([0, 5, 0]);
  });
  it('calls in flight are counted at their worst case, so four at a time cannot overshoot together', async () => {
    const { log } = newLog();
    const four = plans.slice(0, 4);
    const room = worst(four[0]) + worst(four[1]) + 0.0001;
    const t = fakeTransport(() => 'x', { usage: { inputTokens: 10, outputTokens: 10, reasoningTokens: null, cachedInputTokens: null } });
    const run = await runPhase({ phase: 'GENERATION', plans: four, log, transport: t, priorUsd: 10, concurrency: 4, now: clock(), malformedCodeOf: () => null, caps: { cumulative: 10 + room, generationPhase: 10 + room } });
    expect([run.started, run.closedByBudget, t.inFlightMax]).toEqual([2, 2, 2]);
  });
  it('NO RETRY and the stop rules: a rejected request halts; five transport failures in a row halt; slots not reached stay NOT_RUN', async () => {
    const a = newLog();
    const rejected = fakeTransport(() => 'x', { failAt: (n) => (n === 3 ? new RequestRejectedError(400, 'bad parameter') : null) });
    const r1 = await runPhase({ phase: 'GENERATION', plans: plans.slice(0, 20), log: a.log, transport: rejected, priorUsd: 0, concurrency: 1, now: clock(), malformedCodeOf: () => null, caps: { cumulative: 1000, generationPhase: 1000 } });
    expect([r1.halted, r1.started, rejected.calls.length]).toEqual(['REQUEST_REJECTED', 3, 3]);
    expect(plans.slice(0, 5).map((p) => a.log.outcomeOf('GENERATION', p.slotId).state)).toEqual(['FINISHED', 'FINISHED', 'FINISHED', 'NOT_RUN', 'NOT_RUN']);
    const third = a.log.outcomeOf('GENERATION', plans[2].slotId);
    expect(third.state === 'FINISHED' && [third.finished.status, third.finished.usageSource, third.finished.costUsdAssumed === third.started.worstCaseCostUsdAssumed]).toEqual(['REQUEST_REJECTED', 'NOT_REPORTED_CHARGED_AT_WORST_CASE', true]);
    const b = newLog();
    const down = fakeTransport(() => 'x', { failAt: (n) => (n >= 4 ? new Error('ECONNRESET') : null) });
    const r2 = await runPhase({ phase: 'GENERATION', plans: plans.slice(0, 30), log: b.log, transport: down, priorUsd: 0, concurrency: 1, now: clock(), malformedCodeOf: () => null, caps: { cumulative: 1000, generationPhase: 1000 } });
    expect([r2.halted, down.calls.length]).toEqual(['CONSECUTIVE_TRANSPORT_FAILURES', 8]);
    // a failed slot is not tried again by a resumed run: the next call is for the next slot
    const up = fakeTransport(() => 'x');
    await runPhase({ phase: 'GENERATION', plans: plans.slice(0, 30), log: b.log, transport: up, priorUsd: 0, concurrency: 1, now: clock(), malformedCodeOf: () => null, caps: { cumulative: 1000, generationPhase: 1000 } });
    expect(bySlotOfUser(up.calls[0]).slotId).toBe(plans[8].slotId);
    expect(up.calls.length).toBe(22);
  });
});

describe('8 -- end to end on synthetic answers: generation, validation, review, metrics, replay', () => {
  const reviewAnswer = (user: string): string => {
    const n = Number((JSON.parse(user) as { slotId: string }).slotId.slice(-3));
    if (n % 17 === 0) return 'the reviewer wrote prose';
    if (n % 13 === 0) return JSON.stringify({ ...goodReview(), revisedStem: 'a replacement' });
    if (n % 7 === 0) return JSON.stringify(goodReview({ classification: 'REJECTED', independentSolution: { ...goodReview().independentSolution, agreesWithKey: 'DISAGREES' } }, { ACADEMIC_CORRECTNESS: 'FAIL' }));
    if (n % 5 === 0) return JSON.stringify(goodReview({ classification: 'NEEDS_HUMAN_REVIEW', reviewerQuestion: 'Is the demand right for this band?' }, { DIFFICULTY: 'CONCERN' }));
    return JSON.stringify(goodReview());
  };
  const build = async () => {
    const { log, written } = newLog();
    const gen = fakeTransport(async (r) => standInAnswerFor(bySlotOfUser(r.user)));
    await runPhase({ phase: 'GENERATION', plans: generationPlans(), log, transport: gen, priorUsd: evidence.priorSpendUsd.total, concurrency: 4, now: clock(), malformedCodeOf: generationMalformedCodeOf });
    return { log, written, gen };
  };
  it('no review is planned until generation is closed; then one review per candidate, once', async () => {
    const partial = newLog();
    const some = generationPlans().slice(0, 30);
    await runPhase({ phase: 'GENERATION', plans: some, log: partial.log, transport: fakeTransport(async (r) => standInAnswerFor(bySlotOfUser(r.user))), priorUsd: 0, concurrency: 4, now: clock(), malformedCodeOf: generationMalformedCodeOf });
    const early = await deriveGeneration(manifest, partial.log, evidence, MODEL);
    expect([generationIsClosed(early), planReviews(early, validateBatch(early, evidence)).length]).toEqual([false, 0]);

    const { log, written } = await build();
    const generation = await deriveGeneration(manifest, log, evidence, MODEL);
    expect(generationIsClosed(generation)).toBe(true);
    const candidates = generation.filter((g) => g.candidate);
    expect(candidates.length).toBeGreaterThan(150);
    const validations = validateBatch(generation, evidence);
    const reviewPlans = planReviews(generation, validations);
    expect(reviewPlans.map((p) => p.slotId)).toEqual(candidates.map((g) => g.slot.slotId));
    expect(new Set(reviewPlans.map((p) => p.requestHash)).size).toBe(reviewPlans.length);
    const rev = fakeTransport((r) => reviewAnswer(r.user), { usage: { inputTokens: 3700, outputTokens: 800, reasoningTokens: null, cachedInputTokens: null } });
    const run = await runPhase({ phase: 'REVIEW', plans: reviewPlans, log, transport: rev, priorUsd: evidence.priorSpendUsd.total, concurrency: 4, now: clock(), malformedCodeOf: reviewRefusalCodeOf });
    expect([run.started, rev.calls.length, run.halted]).toEqual([reviewPlans.length, reviewPlans.length, null]);

    const out = await deriveCanary(manifest, log, evidence, MODEL);
    const m = out.metrics;
    // every slot is accounted for exactly once
    expect(m.GENERATED.count + m.PROVIDER_FAILURES.count + m.HARNESS_REFUSALS.count + m.NOT_CALLED_BUDGET_STOP.generation + m.NOT_RUN.generation).toBe(250);
    expect([m.GENERATED.count, m.NOT_RUN, m.MAX_AUTOMATIC_REGENERATIONS]).toEqual([candidates.length, { generation: 0, review: 0 }, 0]);
    expect(m.APPROVED + m.NEEDS_HUMAN_REVIEW + m.REJECTED + m.REVIEWER_FAILURES.count + m.NOT_CALLED_BUDGET_STOP.review).toBe(candidates.length);
    expect(m.REVIEWED).toBe(m.APPROVED + m.NEEDS_HUMAN_REVIEW + m.REJECTED);
    expect(Object.keys(m.REVIEWER_FAILURES.byCode).sort()).toEqual(['REVIEW_CONTAINS_A_REPLACEMENT_ITEM', 'REVIEW_RESPONSE_NOT_JSON']);
    expect(m.REVIEWER_FAILURES.count).toBeGreaterThan(0);
    // a reviewer failure is never an approval, and no approval without a strict validator pass
    for (const r of out.rows) {
      if (r.review.state === 'REVIEWER_FAILURE') expect(r.review.decision).toBeNull();
      if (r.review.decision?.classification === 'APPROVED') expect(validatorStrictPass(r.validation!.gates), r.slot.slotId).toBe(true);
      expect([r.review.kind, r.review.isHumanReview, r.review.reviewStatus]).toEqual(['AI_REVIEW', false, 'BLOCKED_NO_QUALIFIED_REVIEWER']);
    }
    expect(Object.values(m.agreementMatrix.matrix).flatMap((row) => Object.values(row)).reduce((a, b) => a + b, 0)).toBe(candidates.length);
    for (const key of ['bySystem', 'byResponseType', 'byFamily', 'byApproach', 'byBand'] as const) expect(Object.values(m.breakdowns[key]).reduce((n, g) => n + g.slots, 0), key).toBe(250);
    expect(Object.keys(m.breakdowns.bySystem)).toEqual(['CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA', 'SCHOOL_STEM_PERFORMANCE']);
    expect(m.ASSUMED_CUMULATIVE_SPEND_USD.cumulative).toBeCloseTo(evidence.priorSpendUsd.total + log.spentUsd(), 9);
    expect(m.ASSUMED_CUMULATIVE_SPEND_USD.cumulative).toBeLessThanOrEqual(30);
    expect(Object.keys(METRIC_DEFINITIONS)).toEqual(['GENERATED', 'PROVIDER_FAILURES', 'HARNESS_REFUSALS', 'NOT_CALLED_BUDGET_STOP', 'VALIDATOR_STRICT_PASS', 'APPROVED', 'NEEDS_HUMAN_REVIEW', 'REJECTED', 'REVIEWER_FAILURES', 'ACADEMIC_FAILURES', 'ANSWER_KEY_FAILURES', 'CONSTRUCT_FAILURES', 'PROFILE_FAILURES', 'STRUCTURAL_FAILURES', 'MATERIAL_DUPLICATES', 'GUIDANCE_FOLLOWED', 'ASSUMED_CUMULATIVE_SPEND_USD', 'HUMAN_CALIBRATION_SAMPLE_PROPOSED']);
    for (const k of ['ACADEMIC_FAILURES', 'ANSWER_KEY_FAILURES', 'CONSTRUCT_FAILURES', 'PROFILE_FAILURES', 'STRUCTURAL_FAILURES'] as const) { const x = m[k]; expect(x.either, k).toBe(x.validator + x.aiReviewer - x.both); }

    // the artifacts: labelled for what they are
    const a = out.artifacts as Record<string, Record<string, unknown> & { items?: Array<Record<string, unknown>> }>;
    expect([a.aiReview.reviewKind, a.aiReview.isHumanReview, a.aiReview.reviewStatus, a.validation.isHumanReview, a.rights.rights, a.rights.ownership, a.candidates.contentUseClass]).toEqual(['AI_REVIEW', false, 'BLOCKED_NO_QUALIFIED_REVIEWER', false, 'RIGHTS_NOT_ESTABLISHED', 'NOT_CLAIMED', 'DEV_TEST_CONTENT']);
    for (const artifact of Object.values(a)) expect(artifact.freeze, String(artifact.kind)).toEqual(artifact.kind === 'STUDYUS_HUMAN_CALIBRATION_SET' ? undefined : HEADER.freeze);
    // the sample, the blind packet and the key
    const sample = a.sample as unknown as { status: string; counts: { total: number; blind: number }; entries: Array<{ slotId: string; blind: boolean; reasons: unknown[] }>; packetOrder: string[] };
    expect([sample.status, sample.counts.total, m.HUMAN_CALIBRATION_SAMPLE_PROPOSED]).toEqual(['PROPOSED', sample.entries.length, sample.entries.length]);
    expect(sample.counts.blind).toBeGreaterThan(0);
    const packet = a.packet.items!;
    expect(packet.map((i) => i.ITEM_ID)).toEqual(sample.packetOrder);
    for (const item of packet) {
      const entry = sample.entries.find((e) => e.slotId === item.ITEM_ID)!;
      expect(item.presentation).toBe(entry.blind ? 'BLIND' : 'WITH_AUTOMATED_RESULTS');
      if (entry.blind) expect(JSON.stringify(item)).not.toMatch(/aiReview|validatorGates|classification|APPROVED|REJECTED|reasons|"rule"/);
      expect(JSON.stringify(item)).not.toMatch(/"rationale"|"declaredModel"|"workingOutline"/);
    }
    expect((a.sampleKey.items as Array<{ ITEM_ID: string }>).map((i) => i.ITEM_ID).sort()).toEqual(sample.entries.map((e) => e.slotId).sort());
    expect(calibrationSetIssues(a.calibrationSet)).toEqual([]);
    expect((a.calibrationSet as unknown as CalibrationSet).rows.every((r) => r.HUMAN_DECISION === null)).toBe(true);

    // REPLAY: the same log gives the same bytes; so does the same log read back from disk in another order
    const again = await deriveCanary(manifest, new RunLog(RunLog.parse(written.map((l) => RunLog.serializeLine(l)).join(''))), evidence, MODEL);
    expect(serializeCanaryArtifact(again.artifacts)).toBe(serializeCanaryArtifact(out.artifacts));
    const header = written[0], rest = written.slice(1);
    const pairs = new Map<string, RunLogLine[]>();
    for (const l of rest) if (l.type !== 'RUN') pairs.set(`${l.phase}|${l.slotId}`, [...(pairs.get(`${l.phase}|${l.slotId}`) ?? []), l]);
    const reordered = [header, ...[...pairs.values()].reverse().flat()];
    const shuffled = await deriveCanary(manifest, new RunLog(reordered), evidence, MODEL);
    const { ledger: l1, ...rest1 } = shuffled.artifacts, { ledger: l2, ...rest2 } = out.artifacts;
    expect(serializeCanaryArtifact(rest1)).toBe(serializeCanaryArtifact(rest2));
    expect((l1 as { cumulativeUsd: number }).cumulativeUsd).toBeCloseTo((l2 as { cumulativeUsd: number }).cumulativeUsd, 9);
    // a recorded call that is not the planned request is refused on replay
    const tampered = written.map((l) => (l.type !== 'RUN' && l.slotId === 'c250-010' && l.phase === 'GENERATION' ? { ...l, requestHash: '0'.repeat(64) } : l));
    await expect(deriveCanary(manifest, new RunLog(tampered), evidence, MODEL)).rejects.toThrow(ReplayMismatchError);
  }, 120_000);
  it('a truncated review and a provider refusal are reviewer failures, whatever text came with them', async () => {
    const { log } = await build();
    const generation = await deriveGeneration(manifest, log, evidence, MODEL);
    const plans = planReviews(generation, validateBatch(generation, evidence)).slice(0, 4);
    await runPhase({ phase: 'REVIEW', plans: plans.slice(0, 2), log, transport: fakeTransport(() => JSON.stringify(goodReview()), { finishReason: 'max_tokens' }), priorUsd: 0, concurrency: 1, now: clock(), malformedCodeOf: reviewRefusalCodeOf });
    await runPhase({ phase: 'REVIEW', plans: plans.slice(2, 4), log, transport: fakeTransport(() => JSON.stringify(goodReview()), { finishReason: 'refusal' }), priorUsd: 0, concurrency: 1, now: clock(), malformedCodeOf: reviewRefusalCodeOf });
    const out = await deriveCanary(manifest, log, evidence, MODEL);
    const byId = new Map(out.rows.map((r) => [r.slot.slotId, r.review]));
    expect(plans.map((p) => `${byId.get(p.slotId)!.state}:${byId.get(p.slotId)!.code}`)).toEqual(['REVIEWER_FAILURE:REVIEW_TRUNCATED', 'REVIEWER_FAILURE:REVIEW_TRUNCATED', 'REVIEWER_FAILURE:REVIEWER_REFUSED_BY_PROVIDER', 'REVIEWER_FAILURE:REVIEWER_REFUSED_BY_PROVIDER']);
    expect([out.metrics.APPROVED, out.metrics.HUMAN_CALIBRATION_SAMPLE_PROPOSED, (out.artifacts.sample as { status: string }).status.slice(0, 16)]).toEqual([0, 0, 'NOT_YET_SELECTED']);
  }, 120_000);
});

describe('9 -- the human calibration sample: by uncertainty and information value, on synthetic batches', () => {
  const SYSTEMS = ['PAA', 'IB', 'CAMBRIDGE', 'PISA', 'ICFES', 'SCHOOL_STEM_PERFORMANCE'];
  const TYPES = ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'CONSTRUCTED_RESPONSE'];
  const population = (n: number, ai: (i: number) => SampleCandidate['ai'], more: (i: number, c: SampleCandidate) => Partial<SampleCandidate> = () => ({})): SampleCandidate[] => Array.from({ length: n }, (_, i) => { const c: SampleCandidate = { slotId: `c250-${String(i + 1).padStart(3, '0')}`, system: SYSTEMS[i % 6], responseType: TYPES[i % 3], ai: ai(i), rule: ai(i) === 'REJECTED' ? (i % 2 ? 'R2' : 'R1') : ai(i) === 'APPROVED' ? 'R8' : 'R6', disagreements: [], doubts: [], agreement: 'AGREES', answerKeyClass: 'MACHINE_VERIFIED' }; return { ...c, ...more(i, c) }; });
  const mostlyApproved = population(220, (i) => (i % 11 === 0 ? 'REJECTED' : i % 7 === 0 ? 'NEEDS_HUMAN_REVIEW' : 'APPROVED'), (i, c) => (c.ai === 'NEEDS_HUMAN_REVIEW' ? { doubts: i % 14 === 0 ? ['ACADEMIC_CORRECTNESS=CONCERN'] : ['LEARNER_QUALITY=CONCERN'], agreement: i % 28 === 0 ? 'CANNOT_DETERMINE' : 'AGREES' } : c.ai === 'REJECTED' && i % 22 === 0 ? { disagreements: ['VALIDATOR_FAIL_REVIEWER_PASS'] } : {}));
  it('every selected item carries its exact reasons; the procedure is deterministic and has no fixed size', () => {
    const s = selectCalibrationSample(mostlyApproved);
    expect(JSON.stringify(selectCalibrationSample([...mostlyApproved].reverse()))).toBe(JSON.stringify(s));
    expect(s.entries.every((e) => e.reasons.length > 0 && e.reasons.every((r) => r.detail.length > 0))).toBe(true);
    expect(s.population).toEqual({ APPROVED: 171, NEEDS_HUMAN_REVIEW: 29, REJECTED: 20 });
    // every contradiction is in, with its kind
    const contradictions = mostlyApproved.filter((c) => c.disagreements.length > 0);
    expect(contradictions.length).toBe(10);
    for (const c of contradictions) expect(s.entries.find((e) => e.slotId === c.slotId)!.reasons).toContainEqual({ reason: 'DISAGREEMENT', detail: 'VALIDATOR_FAIL_REVIEWER_PASS' });
    // the blind audit and the over-rejection check follow the size of their class, within their bounds
    expect([s.counts.byReason.BLIND_AUDIT_APPROVED, s.counts.byReason.OVER_REJECTION_CHECK]).toEqual([Math.ceil(Math.sqrt(171)), Math.ceil(Math.sqrt(20))]);
    // representation: every system and response type is there, the higher-risk systems more
    for (const system of SYSTEMS) expect(s.counts.bySystem[system], system).toBeGreaterThanOrEqual(system === 'IB' || system === 'CAMBRIDGE' ? 6 : 4);
    for (const type of TYPES) expect(s.counts.byResponseType[type], type).toBeGreaterThanOrEqual(5);
    expect(s.shortfalls).toEqual([]);
    // another batch, another size: nothing is a fixed number or share
    const troubled = population(220, (i) => (i % 3 === 0 ? 'REJECTED' : i % 3 === 1 ? 'NEEDS_HUMAN_REVIEW' : 'APPROVED'), (i, c) => (c.ai === 'NEEDS_HUMAN_REVIEW' ? { doubts: ['CONSTRUCT_VALIDITY=CONCERN'], disagreements: i % 4 === 1 ? ['REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY'] : [] } : {}));
    const t = selectCalibrationSample(troubled);
    expect(t.counts.total).not.toBe(s.counts.total);
    expect([s.counts.total, t.counts.total]).toEqual([45, 49]);
    expect([t.counts.byReason.DISAGREEMENT, t.counts.byReason.UNCERTAIN, t.counts.byReason.BLIND_AUDIT_APPROVED, t.counts.byReason.OVER_REJECTION_CHECK]).toEqual([19, SAMPLE_BOUNDS.uncertainMax, 9, 9]);
    expect(troubled.filter((c) => c.disagreements.length > 0)).toHaveLength(19);
    // more contradictions than the bound: the bound holds, spread over the systems
    const many = selectCalibrationSample(population(220, () => 'NEEDS_HUMAN_REVIEW', () => ({ disagreements: ['VALIDATOR_FAIL_REVIEWER_PASS'] })));
    expect([many.counts.byReason.DISAGREEMENT, new Set(many.entries.filter((e) => e.reasons.some((r) => r.reason === 'DISAGREEMENT')).map((e) => e.system)).size]).toEqual([SAMPLE_BOUNDS.disagreementMax, 6]);
  });
  it('uncertain items are taken by score, highest first, spread over systems; reviewer failures are sampled too', () => {
    const p = population(120, (i) => (i < 60 ? 'NEEDS_HUMAN_REVIEW' : i < 70 ? 'REVIEWER_FAILURE' : 'APPROVED'), (i, c) => (c.ai === 'NEEDS_HUMAN_REVIEW' ? { doubts: i % 2 ? ['ACADEMIC_CORRECTNESS=CONCERN'] : ['PROFILE_FIDELITY=CONCERN'], answerKeyClass: 'HUMAN_REVIEW_REQUIRED' } : {}));
    const s = selectCalibrationSample(p);
    const uncertain = s.entries.filter((e) => e.reasons.some((r) => r.reason === 'UNCERTAIN'));
    expect(uncertain).toHaveLength(15);
    expect(new Set(uncertain.map((e) => e.system)).size).toBe(6);
    // within each system the ones taken are that system's most uncertain
    for (const system of SYSTEMS) { const pool = p.filter((c) => c.system === system && c.ai === 'NEEDS_HUMAN_REVIEW').map(uncertaintyScore).sort((a, b) => b - a); const taken = uncertain.filter((e) => e.system === system).map((e) => e.uncertaintyScore).sort((a, b) => b - a); expect(taken).toEqual(pool.slice(0, taken.length)); }
    expect(s.counts.byReason.REVIEWER_FAILURE).toBe(5);
    expect([uncertaintyScore({ ...p[0], doubts: ['ACADEMIC_CORRECTNESS=FAIL'], agreement: 'DISAGREES', answerKeyClass: 'HUMAN_REVIEW_REQUIRED', system: 'IB' }), uncertaintyScore({ ...p[0], doubts: [], agreement: 'AGREES', answerKeyClass: 'MACHINE_VERIFIED', system: 'PAA' })]).toEqual([10, 0]);
  });
  it('BLIND: an approved or rejected item chosen only as an audit or a top-up; never an item that comes with a question or a contradiction', () => {
    const s = selectCalibrationSample(mostlyApproved);
    const ai = new Map(mostlyApproved.map((c) => [c.slotId, c.ai]));
    for (const e of s.entries) {
      const audit = e.reasons.every((r) => ['BLIND_AUDIT_APPROVED', 'OVER_REJECTION_CHECK', 'REPRESENTATION'].includes(r.reason));
      expect(e.blind, e.slotId).toBe(audit && ai.get(e.slotId) !== 'NEEDS_HUMAN_REVIEW');
    }
    expect(s.counts.blind).toBeGreaterThan(10);
    // the order a person receives them in is fixed, is not the slot order, and mixes the classes
    expect(s.packetOrder).not.toEqual([...s.packetOrder].sort());
    expect([...s.packetOrder].sort()).toEqual(s.entries.map((e) => e.slotId));
    const firstTen = s.packetOrder.slice(0, 10).map((id) => ai.get(id));
    expect(new Set(firstTen).size).toBeGreaterThan(1);
  });
  it('small and empty batches: everything there is, a shortfall said plainly, and nothing invented', () => {
    expect(selectCalibrationSample([]).counts.total).toBe(0);
    const tiny = population(9, (i) => (i < 3 ? 'APPROVED' : i < 5 ? 'REJECTED' : 'NOT_REVIEWED'));
    const s = selectCalibrationSample(tiny);
    expect([s.counts.total, s.counts.byReason.BLIND_AUDIT_APPROVED, s.counts.byReason.OVER_REJECTION_CHECK]).toEqual([5, 3, 2]);
    expect(s.entries.every((e) => tiny.find((c) => c.slotId === e.slotId)!.ai !== 'NOT_REVIEWED')).toBe(true);
    expect(s.shortfalls.length).toBeGreaterThan(0);
    expect(s.shortfalls[0]).toMatch(/the batch has no more reviewed items of it/);
  });
});

describe('10 -- STUDYUS_HUMAN_CALIBRATION_SET: a file, a schema, a validator', () => {
  const base = () => emptyCalibrationSet({ items: [{ slotId: 'c250-001', aiDecision: 'APPROVED' }, { slotId: 'c250-002', aiDecision: 'NEEDS_HUMAN_REVIEW' }], runId: 'r', freezeCommitSha: 'abc1234', freezeManifestHash: 'f'.repeat(64), sampleProcedure: { id: 'p', version: '1' }, reviewerVersion: 'studyus-ai-item-reviewer@1' });
  const decided = { HUMAN_DECISION: 'REJECTED' as const, AGREEMENT: 'AI_TOO_LENIENT' as const, HUMAN_REASON: 'The key is the complement of the asked probability.', DEFECT_CLASS: 'WRONG_KEY' as const, SEVERITY: 'CRITICAL' as const, DETERMINISTIC_RULE_CANDIDATE: 'Check the keyed probability against k/n, not 1 - k/n.', GENERATOR_RULE_CANDIDATE: null, REVIEWER_RULE_CANDIDATE: 'Ask for the event in words before the number.', REVIEWER_ID: 'reviewer-01', REVIEWER_QUALIFICATION: 'Mathematics teacher, upper secondary', REVIEWED_AT: '2026-10-20T10:00:00.000Z', REVIEWED_BLIND: true };
  it('the fields, the vocabularies and their versions', () => {
    const set = base();
    expect(Object.keys(set.rows[0])).toEqual(['ITEM_ID', 'AI_DECISION', 'HUMAN_DECISION', 'AGREEMENT', 'HUMAN_REASON', 'DEFECT_CLASS', 'SEVERITY', 'DETERMINISTIC_RULE_CANDIDATE', 'GENERATOR_RULE_CANDIDATE', 'REVIEWER_RULE_CANDIDATE', 'REVIEWER_ID', 'REVIEWER_QUALIFICATION', 'REVIEWED_AT', 'REVIEWED_BLIND']);
    expect([set.kind, set.version, set.vocabularies, DEFECT_CLASS_VOCABULARY.values.length, SEVERITY_VOCABULARY.values, DEFECT_CLASS_VOCABULARY.status]).toEqual(['STUDYUS_HUMAN_CALIBRATION_SET', '1', { defectClass: { id: 'studyus-calibration-defect-class', version: '1' }, severity: { id: 'studyus-calibration-severity', version: '1' } }, 18, ['NONE', 'MINOR', 'MAJOR', 'CRITICAL'], 'PROPOSED']);
    expect(calibrationSetIssues(set)).toEqual([]);
    expect(set.notForRescoring).toBe(CALIBRATION_NOT_FOR_RESCORING);
    expect(CALIBRATION_NOT_FOR_RESCORING).toMatch(/must not be used to silently rescore this same canary as independent certification evidence/);
  });
  it('the stored template is valid, empty, and is what the code writes', () => {
    const stored = JSON.parse(read(`${CANARY_DIR}/${CANARY_FILES.calibrationTemplate}`)) as CalibrationSet & { vocabularyValues: unknown };
    const { vocabularyValues, ...set } = stored;
    expect(set).toEqual(calibrationTemplate());
    expect([calibrationSetIssues(set), set.rows, vocabularyValues]).toEqual([[], [], { defectClass: JSON.parse(JSON.stringify(DEFECT_CLASS_VOCABULARY)), severity: JSON.parse(JSON.stringify(SEVERITY_VOCABULARY)) }]);
  });
  it('a decided row must be complete and consistent; AGREEMENT is computed, not chosen', () => {
    const set = base();
    set.rows[0] = { ...set.rows[0], ...decided };
    expect(calibrationSetIssues(set)).toEqual([]);
    expect([agreementOf('APPROVED', 'APPROVED'), agreementOf('REJECTED', 'REJECTED'), agreementOf('APPROVED', 'REJECTED'), agreementOf('REJECTED', 'APPROVED'), agreementOf('NEEDS_HUMAN_REVIEW', 'APPROVED'), agreementOf('REVIEWER_FAILURE', 'APPROVED'), agreementOf('APPROVED', 'CANNOT_JUDGE')]).toEqual(['AGREE', 'AGREE', 'AI_TOO_LENIENT', 'AI_TOO_STRICT', 'AI_DEFERRED', 'NOT_COMPARABLE', 'NOT_COMPARABLE']);
    const issue = (change: Partial<CalibrationSet['rows'][number]>) => { const s = base(); s.rows[0] = { ...s.rows[0], ...decided, ...change }; return calibrationSetIssues(s); };
    expect(issue({ AGREEMENT: 'AGREE' })).toEqual(['c250-001:AGREEMENT_IS_NOT_WHAT_THE_TWO_DECISIONS_GIVE:AI_TOO_LENIENT']);
    expect(issue({ HUMAN_REASON: null })).toEqual(['c250-001:HUMAN_REASON_MISSING']);
    expect(issue({ REVIEWER_ID: null })).toEqual(['c250-001:REVIEWER_IDENTITY_OR_DATE_MISSING']);
    expect(issue({ DEFECT_CLASS: 'NONE', SEVERITY: 'NONE' })).toEqual(['c250-001:REJECTED_WITHOUT_A_DEFECT_CLASS']);
    expect(issue({ SEVERITY: 'NONE' })).toEqual(['c250-001:DEFECT_CLASS_AND_SEVERITY_DISAGREE_ABOUT_NONE']);
    expect(issue({ HUMAN_DECISION: 'APPROVED', AGREEMENT: 'AGREE' })).toEqual(['c250-001:APPROVED_WITH_A_MAJOR_OR_CRITICAL_DEFECT']);
    expect(issue({ HUMAN_DECISION: null })).toEqual(['c250-001:HUMAN_FIELDS_WITHOUT_A_HUMAN_DECISION']);
    const twice = base(); twice.rows[1] = { ...twice.rows[1], ITEM_ID: 'c250-001' };
    expect(calibrationSetIssues(twice)).toEqual(['c250-001:ITEM_ID_REPEATED']);
    expect(calibrationSetIssues({ ...base(), notForRescoring: 'whatever' })).toEqual(['NOT_FOR_RESCORING_STATEMENT_MISSING']);
    expect(calibrationSetIssues({ ...base(), rows: [{ ...base().rows[0], DEFECT_CLASS: 'TYPO' }] })[0]).toMatch(/^SCHEMA:rows\.0\.DEFECT_CLASS/);
    expect(calibrationSetIssues({ ...base(), extra: 1 })[0]).toMatch(/^SCHEMA:/);
    expect(CalibrationSetSchema.safeParse(base()).success).toBe(true);
  });
});

describe('11 -- the spend projection: measured where it can be, assumed where it cannot, and said which', () => {
  const p = canaryProjection(ROOT, MODEL);
  it('generation prompts are rendered for all 250 slots; review sizes are measured on stand-ins; the assumptions carry their source', () => {
    expect([p.generation.calls, p.review.maxCalls, p.review.promptCharacters.measuredOn]).toEqual([250, 250, 'the 22 stored QB-R2E candidates (size measurement only)']);
    expect(p.priorUsd).toBeCloseTo(3.005135, 6);
    expect([PROJECTION_ASSUMPTIONS.generationOutputTokensPerCall.source.slice(0, 8), PROJECTION_ASSUMPTIONS.reviewOutputTokensPerCall.source.slice(0, 21), PROJECTION_ASSUMPTIONS.reviewCharactersPerInputToken.source.slice(0, 21)]).toEqual(['MEASURED', 'ASSUMED, NOT MEASURED', 'ASSUMED, NOT MEASURED']);
    expect([CANARY_GENERATION_MAX_OUTPUT_TOKENS, CANARY_REVIEW_MAX_OUTPUT_TOKENS]).toEqual([2150, 1600]);
    expect(reviewWorstCaseUsd(10000)).toBeCloseTo((5000 * 5 + 1600 * 30) / 1e6, 12);
    expect(generationWorstCaseUsd(10000)).toBeCloseTo((4000 * 5 + 2150 * 30) / 1e6, 12);
  });
  it('the EXPECTED total fits under USD 30 with headroom; the WORST CASE does not, which is what the per-call guard is for', () => {
    expect([p.expectedFits, p.worstCaseFits]).toEqual([true, false]);
    expect(p.expectedCumulativeUsd).toBeGreaterThan(25);
    expect(p.expectedCumulativeUsd).toBeLessThan(28);
    expect(p.expectedHeadroomUsd).toBeGreaterThan(2);
    expect(p.worstCaseCumulativeUsd).toBeGreaterThan(40);
    // expected generation ends under the generation-phase cap, which leaves the reviewer at least USD 11
    expect(p.priorUsd + p.generation.expectedUsd).toBeLessThan(CANARY_GENERATION_PHASE_CAP_USD);
    expect(CANARY_CUMULATIVE_CAP_USD - CANARY_GENERATION_PHASE_CAP_USD).toBeGreaterThan(p.review.expectedUsd);
    expect(JSON.parse(read(`${CANARY_DIR}/${CANARY_FILES.projection}`))).toEqual(JSON.parse(JSON.stringify(projectionArtifact(ROOT))));
  });
});

describe('12 -- the freeze, and the transports behind it', () => {
  const current = computeCanaryFreezeManifest(ROOT);
  const clean = { commitExists: true, diffIsClean: true, untracked: [] };
  it('the closure: generator 3, validators 4, the reviewer, the manifest, the budget, the sample procedure, the calibration schema, the run scripts', () => {
    const files = canaryFrozenSourceFiles(ROOT);
    expect(current.files.map((f) => f.path)).toEqual(files);
    for (const f of [...CANARY_FREEZE_ENTRY_FILES, 'src/lib/exam-core/question-bank/production/specification-validators-r3.ts', 'src/lib/exam-core/question-bank/production/specification-validators.ts', 'src/lib/exam-core/question-bank/production/generator/specification-generation-v2.ts', 'src/lib/assessment-adaptation/item-demand-policy.ts', 'src/lib/assessment-adaptation/adapt.ts', 'scripts/operations/qb-r2e/live-provider.ts', 'scripts/operations/qb-r2e/gates.ts', 'scripts/operations/qb-r2f/evidence.ts', 'scripts/operations/qb-r2f/selection.ts']) expect(files, f).toContain(f);
    expect(readdirSync(join(ROOT, 'scripts/operations/qb-canary-250')).sort().map((f) => `scripts/operations/qb-canary-250/${f}`).every((f) => files.includes(f))).toBe(true);
    expect(current.dataFiles.map((f) => f.path)).toContain(`${CANARY_DIR}/manifest.json`);
    expect(current.runParameters).toBe(CANARY_RUN_PARAMETERS);
    expect([CANARY_RUN_PARAMETERS.MAX_AUTOMATIC_REGENERATIONS, CANARY_RUN_PARAMETERS.retries, CANARY_RUN_PARAMETERS.slots, CANARY_RUN_PARAMETERS.spend.cumulativeCapUsdAssumed, CANARY_RUN_PARAMETERS.reviewer.model, CANARY_RUN_PARAMETERS.reviewer.maxOutputTokens, CANARY_RUN_PARAMETERS.supersedes]).toEqual([0, 0, 250, 30, 'claude-sonnet-5-5', 1600, 'R2F_20_ITEM_RUN = SUPERSEDED_BY_QUESTION_FACTORY_CANARY_250']);
  });
  it('the stored freeze is the working tree, and the verdict refuses on any mismatch', () => {
    const stored = readStoredCanaryFreeze(ROOT);
    expect(stored, `${CANARY_DIR}/freeze.json must exist`).not.toBeNull();
    expect(stored).toEqual(JSON.parse(JSON.stringify(current)));
    expect(canaryFreezeVerdict(stored, current, clean, 'abc1234')).toEqual({ ok: true, reasons: [], manifestHash: current.manifestHash });
    const tampered: CanaryFreezeManifest = { ...current, files: current.files.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) };
    expect(canaryFreezeVerdict(tampered, current, clean, 'abc1234').reasons).toEqual(['MANIFEST_HASH_DOES_NOT_MATCH_ITS_CONTENT', `FROZEN_FILE_CHANGED:${current.files[0].path}`]);
    expect(canaryFreezeVerdict(null, current, clean, 'abc1234').reasons).toEqual(['FREEZE_MANIFEST_MISSING']);
    expect(canaryFreezeVerdict(current, current, clean, null).reasons).toEqual(['FREEZE_COMMIT_SHA_NOT_GIVEN']);
    expect(canaryFreezeVerdict(current, current, { commitExists: false, diffIsClean: false, untracked: ['x'] }, 'abc1234').reasons).toEqual(['FREEZE_COMMIT_NOT_FOUND', 'WORKING_TREE_DIFFERS_FROM_THE_FREEZE_COMMIT', 'FROZEN_FILE_NOT_TRACKED:x']);
    expect(verifyCanaryFreeze(ROOT, '0000000000000000000000000000000000000000').ok).toBe(false);
  });
  it('a run whose freeze does not verify NEVER builds a transport, for either provider; keys are named, never read from a file', async () => {
    let built = 0;
    const factory = () => { built += 1; return fakeTransport(() => 'x'); };
    expect(() => transportBehindTheFreeze({ ok: false, reasons: ['FROZEN_FILE_CHANGED:x'], manifestHash: null }, factory)).toThrow(/FREEZE_NOT_VERIFIED: FROZEN_FILE_CHANGED:x/);
    expect(built).toBe(0);
    expect(transportBehindTheFreeze({ ok: true, reasons: [], manifestHash: 'f'.repeat(64) }, factory).providerId).toBe('fake');
    const run = read('scripts/operations/qb-canary-250/run.ts');
    expect(run.indexOf('const verdict = verifyCanaryFreeze(ROOT, freezeSha);')).toBeLessThan(run.indexOf('requireLiveKey()'));
    expect(run.indexOf('const verdict = verifyCanaryFreeze(ROOT, freezeSha);')).toBeLessThan(run.indexOf('requireReviewerKey()'));
    expect(run.match(/createR2eLiveTransport\(|createReviewerLiveTransport\(/g)!.length).toBe(2);
    expect(run).toMatch(/RUN_LOG_IS_OF_ANOTHER_FREEZE/);
    expect(() => requireReviewerKey({})).toThrow(/LIVE_REVIEWER_BLOCKED: environment variable ANTHROPIC_API_KEY is not set \(pass ONLY that variable/);
    // a rejected request: named, and the key never reaches the error text
    const secret = `sk-ant-${'a'.repeat(40)}`;
    const t = createReviewerLiveTransport({ apiKey: secret, fetchImpl: (async () => new Response(JSON.stringify({ error: { message: `invalid x-api-key: ${secret}` } }), { status: 401 })) as typeof fetch });
    const error = await t.complete({ system: 's', user: 'u', maxOutputTokens: 10 }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(RequestRejectedError);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).toMatch(/REQUEST_REJECTED_HTTP_401/);
    // a good answer: text blocks joined, the provider's own usage, the stop reason kept
    const ok = createReviewerLiveTransport({ apiKey: secret, fetchImpl: (async (_url: unknown, init?: { headers?: Record<string, string>; body?: string }) => { expect(init!.headers).toEqual({ 'Content-Type': 'application/json', 'x-api-key': secret, 'anthropic-version': '2023-06-01' }); expect(JSON.parse(init!.body!).model).toBe('claude-sonnet-5-5'); return new Response(JSON.stringify({ id: 'msg_1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 7 } }), { status: 200 }); }) as unknown as typeof fetch });
    expect(await ok.complete({ system: 's', user: 'u', maxOutputTokens: 10 })).toEqual({ rawText: '{"a":1}', usage: { inputTokens: 107, outputTokens: 20, reasoningTokens: null, cachedInputTokens: 7 }, servedModel: 'claude-sonnet-5-5', responseId: 'msg_1', finishReason: 'end_turn' });
  });
});

describe('13 -- nothing earlier moved, nothing is ingested, nothing in src knows the canary', () => {
  it('the frozen files of QB-R2F (and with them QB-R2D and QB-R2E) are byte-identical to the QB-R2F freeze commit', () => {
    const r2f = readStoredR2fManifest(ROOT)!;
    expect(computeR2fFreezeManifest(ROOT)).toEqual(r2f);
    expect(r2f.manifestHash).toBe('fe76a301e94a91e296e990e05a276574f8983602fb240e8ac36614600c3fdffa');
    const paths = [...r2f.files, ...r2f.dataFiles].map((f) => f.path);
    expect(() => execFileSync('git', ['diff', '--quiet', '738b0f5', '--', ...paths, 'docs/exams/question-bank/pilots/qb-r2d', 'docs/exams/question-bank/pilots/qb-r2e', 'docs/exams/question-bank/pilots/qb-r2f', 'tests/fixtures/qb-r2f', 'tests/unit/qb-r2d-live-replay.test.ts', 'tests/unit/qb-r2e-live-replay.test.ts', 'tests/unit/qb-r2f-offline-remediation.test.ts'], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
  });
  it('the canary is scripts and documents only: no file under src was added or changed, and nothing reaches a database', () => {
    // (post-canary work adds NEW versioned files; what must not move is the Canary's frozen closure)
    expect(() => execFileSync('git', ['diff', '--quiet', 'f445e7a', '--', ...canaryFrozenSourceFiles(ROOT)], { cwd: ROOT, stdio: 'ignore' })).not.toThrow();
    expect(execFileSync('git', ['status', '--porcelain', '--', 'prisma', 'drizzle', 'migrations'], { cwd: ROOT }).toString()).toBe('');
    const strip = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    const files = readdirSync(join(ROOT, 'scripts/operations/qb-canary-250')).sort();
    expect(files).toEqual(['budget.ts', 'calibration.ts', 'evidence.ts', 'freeze.ts', 'manifest.ts', 'pipeline.ts', 'projection.ts', 'report.ts', 'reviewer-transport.ts', 'reviewer.ts', 'run-log.ts', 'run.ts', 'runner.ts', 'sample.ts']);
    for (const f of files) {
      const source = strip(`scripts/operations/qb-canary-250/${f}`);
      expect(source, f).not.toMatch(/DATABASE_URL|from 'pg'|from 'postgres'|drizzle|@neondatabase|new Pool\(|@\/lib\/db|\.env\.|\.env['"`]|dotenv|--env-file/);
      // one file opens a network connection; one more reads the two key variables
      if (f !== 'reviewer-transport.ts') expect(source, f).not.toMatch(/fetch\(|https?:\/\//);
      if (!['reviewer-transport.ts', 'run.ts'].includes(f)) expect(source, f).not.toMatch(/process\.env/);
      // the pure modules read no clock and no randomness
      if (!['run.ts', 'reviewer-transport.ts'].includes(f)) expect(source, f).not.toMatch(/Date\.now\(|new Date\(|Math\.random\(/);
    }
    for (const f of canaryFrozenSourceFiles(ROOT)) expect(f, f).not.toMatch(/^src\/lib\/db|\/db\/|\/gateway\.ts$|\/adapters\/|\.service\.ts$/);
    // the canary's directory holds the preparation files, the run log and what is derived from it (qb-canary-250-replay.test.ts proves the derivation)
    expect(readdirSync(join(ROOT, CANARY_DIR)).every((f) => (Object.values(CANARY_FILES) as string[]).includes(f) || ['human-review', 'v5-offline-replay', 'spend-reconciliation.json'].includes(f))).toBe(true);
    expect(Object.values(CANARY_FILES).every((f) => !f.includes('/'))).toBe(true);
  });
});
