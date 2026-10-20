/**
 * QF V5.1 -- construct core -> exam adapter -> runtime instance.
 *
 * FIXTURES. No construct core, adapter or renderer in this repository is certified by a human yet (the ten EA-1
 * families are DRAFT / UNREVIEWED, the profiles PROVISIONAL_ILLUSTRATIVE). The "certified" objects below are
 * TEST FIXTURES built from them, to exercise the certified path; they certify nothing. Tests that use the real
 * registry assert that Student delivery is refused.
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMBRIDGE_9709_P1_COMPONENT, CAMBRIDGE_SYSTEM_PROFILE, IB_MATH_AA_HL_P1_COMPONENT, IB_MATH_AA_HL_P2_COMPONENT, IB_SYSTEM_PROFILE, MATHEMATICS_ADAPTATION_POLICY, MATH_POC_APPLICABILITY,
  PAA_MATEMATICAS_COMPONENT, PAA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, PISA_SYSTEM_PROFILE, differingDimensions,
  type AssessmentComponentProfile, type AssessmentSystemProfile,
} from '@/lib/assessment-adaptation';
import { mathPocFamilyOf, MATH_POC_FAMILIES } from '@/lib/exam-core/question-bank/task-families';
import { GENERATION_PROFILES } from '@/lib/exam-core/question-bank/production/v5/generation-profile';
import { planSpecifications } from '@/lib/exam-core/question-bank/production/v5/plan';
import {
  ASSESSMENT_ADAPTERS, GENERATION_PROFILE_COMPONENT, LEGACY_PLAN_UNIT, PLAN_UNIT, QUADRATIC_FACTORISING_STRATEGY, adapterConflicts, adapterForGenerationProfile, adapterMayFeedStudentDelivery,
  adapterOfComponent, applicabilityGate, bucketIsScalable, canTransitionCore, composeAssessmentSpecification, constructCoreOf, coreContentIntact, coreMayFeedStudentDelivery, coreSemantics,
  createAssessmentInstanceRenderer, deriveCoreApplicability, itemTextSpecificationIsScalable, lineageClassOf, parameterIssues, planByCore, presentEquation, quadraticInstanceCapacity,
  studentSupplyDecision, supplyForStudent, templateCompositionStrategy,
  type AssessmentAdapter, type BlueprintBucketRef, type CertifiedRegistryView, type CertifiedTemplateSet, type ConstructCoreRecord, type CoreApplicabilityRecord, type QuadraticParameters,
  type RenderedInstance, type RenderingStrategy, type SupplyCandidate,
} from '@/lib/assessment-instance';
import { certifiedProfile, fixtureRegistry } from './qf51-fixtures';

const FAMILY_ID = 'tf.math.quadratic.solve-by-factorising';
const CONCEPT = 'math.alg.quadratics';
const SHORTCUTS = [{ id: 'substitute-the-options', bypass: 'With options to choose from, each one can be substituted into the equation instead of factorising it.', excludedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT'], instanceRule: 'A numeric response asks for one stated root, so the response has one value.' }];
const CERT = { certificationVersion: 'test-cert-1', certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00Z' };

const draftFamily = mathPocFamilyOf(FAMILY_ID)!;
const certifiedFamily = { ...draftFamily, version: '1.0.0-test-certified', lifecycle: 'CERTIFIED' as const, reviewStatus: 'REVIEWED' as const };
const built = (family: unknown, certification?: unknown) => constructCoreOf({ family, shortcutConstraints: SHORTCUTS, certification });
const core = (() => { const r = built(certifiedFamily, CERT); if (!r.ok) throw new Error(`${r.issue}: ${r.details.join('; ')}`); return r.core; })();
const draftCore = (() => { const r = built(draftFamily); if (!r.ok) throw new Error(r.issue); return r.core; })();

const TARGETS = {
  PAA: { system: certifiedProfile(PAA_SYSTEM_PROFILE), component: certifiedProfile(PAA_MATEMATICAS_COMPONENT), language: 'es', objective: 'paa.topic.040' },
  IB: { system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT), language: 'en', objective: 'aahl.p1.functions' },
  CAMBRIDGE: { system: certifiedProfile(CAMBRIDGE_SYSTEM_PROFILE), component: certifiedProfile(CAMBRIDGE_9709_P1_COMPONENT), language: 'en', objective: 'aice.9709.p1.quadratics' },
} as const satisfies Record<string, { system: AssessmentSystemProfile; component: AssessmentComponentProfile; language: string; objective: string }>;
type TargetKey = keyof typeof TARGETS;

// QF V5.1 registry: the three fixture systems are REGISTERED; an adapter is read from the registry, bound to its system version
const REGISTRY = fixtureRegistry(Object.values(TARGETS));
const adapterOf = (k: TargetKey): AssessmentAdapter => REGISTRY.adapter(TARGETS[k].component.componentId)!;
const applicabilityOf = (c: ConstructCoreRecord, k: TargetKey): CoreApplicabilityRecord => deriveCoreApplicability(c, { systemProfileId: TARGETS[k].system.profileId, componentId: TARGETS[k].component.componentId }, MATH_POC_APPLICABILITY);
const bucketOf = (k: TargetKey, over: Partial<BlueprintBucketRef> = {}): BlueprintBucketRef => ({
  bucketId: `test/${TARGETS[k].component.componentId}/${TARGETS[k].objective}#0`, configKey: 'test', sectionKey: TARGETS[k].component.componentId, adapterId: TARGETS[k].component.componentId,
  objectiveCode: TARGETS[k].objective, primaryConceptStableIds: [CONCEPT], responseFormat: null, blueprintClass: 'FULL', ...over,
});
const CERTIFIED_STRATEGY: RenderingStrategy = { ...QUADRATIC_FACTORISING_STRATEGY, status: 'CERTIFIED' };
const renderer = createAssessmentInstanceRenderer([CERTIFIED_STRATEGY]);

const compose = (k: TargetKey, band = 'STANDARD', over: { core?: ConstructCoreRecord; bucket?: BlueprintBucketRef; applicability?: CoreApplicabilityRecord[]; use?: 'STUDENT_DELIVERY' | 'DEV_TEST'; adapter?: AssessmentAdapter } = {}) => {
  const c = over.core ?? core;
  return composeAssessmentSpecification({
    registry: REGISTRY, use: over.use ?? 'STUDENT_DELIVERY', core: c, adapter: over.adapter ?? adapterOf(k), system: TARGETS[k].system, component: TARGETS[k].component,
    coreApplicability: over.applicability ?? [applicabilityOf(c, k)], applicabilityRegister: MATH_POC_APPLICABILITY, bucket: over.bucket ?? bucketOf(k), disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY,
    request: { purpose: 'PRACTICE', difficultyBand: band, language: TARGETS[k].language, contentUseClass: 'EVIDENCE_BEARING' },
  });
};
const render = (k: TargetKey, band = 'STANDARD', seed = 'seed-001'): RenderedInstance => {
  const spec = compose(k, band);
  if (!spec.ok) throw new Error(`${k} ${band}: ${spec.code} ${spec.detail}`);
  const r = renderer.render({ registry: REGISTRY, use: 'STUDENT_DELIVERY', core, adapter: adapterOf(k), applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed });
  if (!r.ok) throw new Error(`${k} ${band}: ${r.code} ${r.detail}`);
  return r.instance;
};

afterEach(() => vi.unstubAllGlobals());

describe('1-2. the construct core is the EA-1 task family, first-class', () => {
  it('wraps one family version verbatim: no second family model', () => {
    expect(core.family).toEqual(certifiedFamily);
    expect(core).toMatchObject({ constructFamilyId: FAMILY_ID, familyVersion: '1.0.0-test-certified', primaryConceptStableId: CONCEPT, lifecycle: 'CERTIFIED' });
    expect(core.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(coreContentIntact(core)).toBe(true);
    expect(coreContentIntact({ ...core, family: { ...core.family, commonMisconceptions: ['An edit made without a new version of the family.'] } })).toBe(false);
  });

  it('carries every required semantic, read from the family', () => {
    const s = coreSemantics(core);
    expect(s.stableFamilyId).toBe(FAMILY_ID);
    expect(s.primaryConcept.stableId).toBe(CONCEPT);
    expect(s.targetUnderstanding).toMatch(/factorises/);
    expect(s.observableEvidenceTarget).toMatch(/quadratic equation/i);
    expect(s.requiredActions).toEqual(['SOLVE']);
    expect(s.misconceptionModels.map((m) => m.id)).toEqual(['sign-of-roots', 'lost-root', 'non-zero-side']);
    expect(JSON.stringify(s.solutionInvariants)).toContain('a * (x - r1) * (x - r2) = 0');
    expect(s.constraints.length).toBeGreaterThan(0);
    expect(s.validSolutionRules.length).toBeGreaterThan(0);
    expect(JSON.stringify(s.parameterRanges)).toContain('"symbol":"r1"');
    expect(s.difficultyLevers.map((l) => l.lever)).toEqual(['leading-coefficient', 'root-signs', 'rearrangement']);
    expect(s.shortcutConstraints.map((c) => c.id)).toEqual(['substitute-the-options']);
    expect(s.provenance.authoredBy).toBe('STUDYUS');
    expect(s).toMatchObject({ lifecycle: 'CERTIFIED', certificationVersion: 'test-cert-1' });
  });

  it('a core holds no item text', () => {
    const text = JSON.stringify(core.family);
    expect(text).not.toMatch(/x² |¿cuál|Solve the equation|\[\d\]/);
  });

  it('lifecycle: DRAFT -> UNDER_REVIEW -> CERTIFIED -> RETIRED, nothing else', () => {
    expect(canTransitionCore('DRAFT', 'UNDER_REVIEW')).toBe(true);
    expect(canTransitionCore('UNDER_REVIEW', 'CERTIFIED')).toBe(true);
    expect(canTransitionCore('UNDER_REVIEW', 'DRAFT')).toBe(true);
    expect(canTransitionCore('CERTIFIED', 'RETIRED')).toBe(true);
    for (const [from, to] of [['DRAFT', 'CERTIFIED'], ['CERTIFIED', 'DRAFT'], ['CERTIFIED', 'UNDER_REVIEW'], ['RETIRED', 'CERTIFIED'], ['RETIRED', 'DRAFT']] as const) expect(canTransitionCore(from, to), `${from}->${to}`).toBe(false);
  });

  it('certification is explicit: a certified core needs a review, a certification and one primary concept', () => {
    expect(built(certifiedFamily)).toMatchObject({ ok: false, issue: 'CERTIFIED_CORE_NEEDS_A_CERTIFICATION' });
    expect(built({ ...certifiedFamily, reviewStatus: 'IN_REVIEW' }, CERT).ok).toBe(false);
    expect(built(draftFamily, CERT)).toMatchObject({ ok: false, issue: 'ONLY_A_CERTIFIED_CORE_CARRIES_A_CERTIFICATION' });
    expect(draftCore).toMatchObject({ lifecycle: 'DRAFT', certification: null });
    expect(constructCoreOf({ family: { ...draftFamily, lifecycle: 'IN_REVIEW' }, shortcutConstraints: SHORTCUTS })).toMatchObject({ ok: true, core: { lifecycle: 'UNDER_REVIEW' } });
  });

  it('only a CERTIFIED core may feed Student delivery -- and none of the real families is certified', () => {
    expect(coreMayFeedStudentDelivery(core)).toBe(true);
    expect(coreMayFeedStudentDelivery(draftCore)).toBe(false);
    for (const family of MATH_POC_FAMILIES) {
      const r = constructCoreOf({ family, shortcutConstraints: [] });
      expect(r.ok && coreMayFeedStudentDelivery(r.core), family.familyId).toBe(false);
    }
    expect(compose('IB', 'STANDARD', { core: draftCore })).toMatchObject({ ok: false, code: 'CORE_NOT_CERTIFIED' });
  });

  it('a shortcut cannot exclude a format the family allows', () => {
    expect(constructCoreOf({ family: draftFamily, shortcutConstraints: [{ ...SHORTCUTS[0], excludedFormats: ['NUMERIC_ENTRY'] }] })).toMatchObject({ ok: false, issue: 'FAMILY_ALLOWS_A_FORMAT_ITS_SHORTCUT_EXCLUDES' });
  });
});

describe('3. applicability is explicit, never inferred', () => {
  const of = (system: AssessmentSystemProfile, component: AssessmentComponentProfile) => deriveCoreApplicability(core, { systemProfileId: system.profileId, componentId: component.componentId }, MATH_POC_APPLICABILITY);

  it('the same core: PAA conditional, IB P1 and Cambridge P1 supported, PISA and IB P2 not applicable -- each with its reason', () => {
    expect(applicabilityOf(core, 'IB')).toMatchObject({ status: 'SUPPORTED', reason: null, constraints: [] });
    expect(applicabilityOf(core, 'CAMBRIDGE')).toMatchObject({ status: 'SUPPORTED' });
    const paa = applicabilityOf(core, 'PAA');
    expect(paa.status).toBe('CONDITIONAL');
    expect(paa.constraints).toEqual([expect.objectContaining({ kind: 'RESPONSE_FORMAT_ONLY', formats: ['NUMERIC_ENTRY'] })]);
    expect(paa.reason).toMatch(/options/);
    const pisa = of(PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT);
    expect(pisa).toMatchObject({ status: 'NOT_APPLICABLE', basis: { behaviourSupport: 'UNSUPPORTED' } });
    expect(pisa.reason).toMatch(/transfer/);
    // behaviour fits IB, but nothing records that Paper 2 assesses the concept: applicability is not borrowed from Paper 1
    expect(of(IB_SYSTEM_PROFILE, IB_MATH_AA_HL_P2_COMPONENT)).toMatchObject({ status: 'NOT_APPLICABLE', basis: { behaviourSupport: 'SUPPORTED', conceptApplicability: { status: 'NOT_ESTABLISHED' } } });
  });

  it('NOT_APPLICABLE is refused; a combination with no record is refused too', () => {
    const pisa = of(PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT);
    expect(applicabilityGate([pisa], core, 'PISA.MATHEMATICS')).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
    expect(applicabilityGate([], core, 'IB.MATH_AA_HL.P1')).toMatchObject({ ok: false, code: 'NO_EXPLICIT_APPLICABILITY' });
    expect(compose('IB', 'STANDARD', { applicability: [] })).toMatchObject({ ok: false, code: 'NO_EXPLICIT_APPLICABILITY' });
    // a record of another core version does not speak for this one
    expect(compose('IB', 'STANDARD', { applicability: [{ ...applicabilityOf(core, 'IB'), familyVersion: '0.9.0' }] })).toMatchObject({ ok: false, code: 'NO_EXPLICIT_APPLICABILITY' });
    const notApplicable = { ...applicabilityOf(core, 'IB'), status: 'NOT_APPLICABLE' as const, reason: 'Recorded as not applicable for this test.' };
    expect(compose('IB', 'STANDARD', { applicability: [notApplicable] })).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
  });
});

describe('4. one adapter system', () => {
  it('every adapter is defined once', () => {
    const ids = ASSESSMENT_ADAPTERS.map((a) => a.adapterId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ASSESSMENT_ADAPTERS.filter((a) => a.source === 'EA1_COMPONENT_PROFILE').map((a) => a.adapterId).sort()).toEqual(['CAMBRIDGE.9709.P1', 'CAMBRIDGE.9709.P2', 'CAMBRIDGE.9709.P4', 'CAMBRIDGE.9709.P5', 'IB.MATH_AA_HL.P1', 'IB.MATH_AA_HL.P2', 'IB.MATH_AA_HL.P3', 'ICFES.SABER11_MATEMATICAS', 'PAA.MATEMATICAS', 'PISA.MATHEMATICS']);
  });

  it('covers the twelve dimensions', () => {
    const a = adapterOf('IB');
    expect(a).toMatchObject({ examFamily: 'IB', subject: expect.any(String), component: expect.any(String), responseFormats: expect.arrayContaining(['SHORT_RESPONSE']), calculator: ['NONE'] });
    expect(a.commandTerms).toMatchObject({ use: 'CONTROLLED_VOCABULARY', terms: expect.arrayContaining(['solve']) });
    expect(a.marksRubric).toMatchObject({ markStructure: 'MULTI_MARK_PARTS', rubricStyle: 'METHOD_AND_ACCURACY' });
    expect(a.stimulusContext.contexts.length).toBeGreaterThan(0);
    expect(a.distractorPolicy).toMatch(/modelled error/);
    expect(a.authenticity).toMatchObject({ requirement: expect.any(String), transfer: expect.any(String) });
  });

  it('a V5 generation profile resolves to the EA-1 adapter of the same component, never to its own fields', () => {
    for (const [profileId, componentId] of Object.entries(GENERATION_PROFILE_COMPONENT)) {
      expect(GENERATION_PROFILES.some((p) => p.profileId === profileId), profileId).toBe(true);
      expect(adapterForGenerationProfile(profileId)).toMatchObject({ adapterId: componentId, source: 'EA1_COMPONENT_PROFILE' });
    }
  });

  it('where no EA-1 component exists yet the adapter is exposed as PROVISIONAL and can never feed Student delivery', () => {
    const derived = ASSESSMENT_ADAPTERS.filter((a) => a.source === 'V5_GENERATION_PROFILE');
    expect(derived).toHaveLength(GENERATION_PROFILES.length - Object.keys(GENERATION_PROFILE_COMPONENT).length);
    for (const a of derived) expect(a.status === 'PROVISIONAL' && !adapterMayFeedStudentDelivery(a), a.adapterId).toBe(true);
    // the real EA-1 adapters are not certified either: nothing reaches a Student yet
    expect(ASSESSMENT_ADAPTERS.some(adapterMayFeedStudentDelivery)).toBe(false);
  });

  it('disagreements between V5 fields and the adapter are listed, and the adapter is the answer', () => {
    const conflicts = adapterConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    for (const c of conflicts) expect(adapterForGenerationProfile(c.profileId)![c.dimension === 'commandTerms' ? 'commandTerms' : c.dimension]).toBeDefined();
    // today: IB Mathematics AA HL formats and command terms, and PISA Mathematics formats (the V5 profile is narrower
    // than the adapter: it never asks for MATH_EXPRESSION; the adapter itself is bound to v2.pisa.2022)
    expect(conflicts.map((c) => `${c.profileId}:${c.dimension}`).sort()).toEqual(['IB.MATH_AA.HL.P1:commandTerms', 'IB.MATH_AA.HL.P1:responseFormats', 'IB.MATH_AA.HL.P2:commandTerms', 'IB.MATH_AA.HL.P2:responseFormats', 'PISA.MATHEMATICS:responseFormats']);
    const ibTerms = conflicts.find((c) => c.profileId === 'IB.MATH_AA.HL.P1' && c.dimension === 'commandTerms')!;
    expect(ibTerms.adapter).toEqual(['find', 'solve', 'show that', 'hence', 'write down', 'calculate']);
    expect(ibTerms.generationProfile.length).toBeGreaterThan(ibTerms.adapter.length);
  });
});

describe('5. the blueprint places an instance; it does not define the construct', () => {
  it('core + applicability + adapter + bucket -> a specification that records the bucket', () => {
    const r = compose('IB');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.specification.blueprintRequirement).toEqual({ requirementCellKey: bucketOf('IB').bucketId });
    expect(r.specification.primaryConcept.stableId).toBe(CONCEPT);
    expect(r.specification.taskFamily).toMatchObject({ familyId: FAMILY_ID, lifecycle: 'CERTIFIED' });
  });

  it('a bucket with no primary-concept lineage is not scalable and takes nothing', () => {
    const bare = bucketOf('IB', { primaryConceptStableIds: [] });
    expect(bucketIsScalable(bare)).toBe(false);
    expect(compose('IB', 'STANDARD', { bucket: bare })).toMatchObject({ ok: false, code: 'BUCKET_HAS_NO_PRIMARY_CONCEPT_LINEAGE' });
  });

  it('refuses a bucket of another component, of another concept, or in a format the core or the adapter excludes', () => {
    expect(compose('IB', 'STANDARD', { bucket: bucketOf('CAMBRIDGE') })).toMatchObject({ ok: false, code: 'BUCKET_IS_OF_ANOTHER_COMPONENT' });
    expect(compose('IB', 'STANDARD', { bucket: bucketOf('IB', { primaryConceptStableIds: ['math.prob.probability'] }) })).toMatchObject({ ok: false, code: 'BUCKET_DOES_NOT_ASSESS_THE_CONCEPT' });
    expect(compose('PAA', 'STANDARD', { bucket: bucketOf('PAA', { responseFormat: 'SELECTED_RESPONSE' }) })).toMatchObject({ ok: false, code: 'BUCKET_FORMAT_EXCLUDED_BY_THE_CORE' });
    expect(compose('PAA', 'STANDARD', { bucket: bucketOf('PAA', { responseFormat: 'SHORT_RESPONSE' }) })).toMatchObject({ ok: false, code: 'BUCKET_FORMAT_NOT_OFFERED_BY_THE_ADAPTER' });
  });

  it('V5 item-text specifications carry no concept: none is scalable', () => {
    const specs = planSpecifications(
      [{ configKey: 'v2.paa', family: 'PAA', sectionKey: 'matematicas', componentType: 'WRITTEN', simulationCapable: true, officialItemCount: null, fullFormDocumented: false, buckets: [{ bucketKey: 'b1', objectiveCode: 'paa.topic.040', targetIndex: 0, required: 1, description: 'Ecuaciones cuadráticas', commandTerm: null, questionType: null }] }] as never,
      [{ bucket: 'b1', family: 'PAA', profileId: 'PAA.MATEMATICAS', required: 1, available: 0, toGenerate: 3, priority: 1 }],
    );
    expect(specs).toHaveLength(3);
    expect(specs.every((s) => s.conceptIds.length === 0 && !itemTextSpecificationIsScalable(s))).toBe(true);
  });
});

describe('6-9. one core, three systems: deterministic instances with lineage', () => {
  const paa = render('PAA');
  const ib = render('IB');
  const cambridge = render('CAMBRIDGE');

  it('PAA: a Spanish numeric-entry item, one mark, answer only, one stated root', () => {
    expect(paa.strategy).toBe('PARAMETRIC_DETERMINISTIC');
    expect(paa.learner).toMatchObject({ language: 'es', itemType: 'NUMERIC_ENTRY', marks: 1, options: [], conditions: { calculator: 'NONE', workingShown: false } });
    expect(paa.learner.prompt).toMatch(/^Si .+, ¿cuál es la mayor de las soluciones de la ecuación\?$/);
    expect(paa.key.answers).toHaveLength(1);
    expect(paa.rubric).toEqual([expect.objectContaining({ code: 'KEY', marks: 1 })]);
  });

  it('IB Mathematics AA HL Paper 1: an English constructed response under the command term "solve", marked for method and accuracy', () => {
    expect(ib.learner).toMatchObject({ language: 'en', itemType: 'SHORT_RESPONSE', conditions: { calculator: 'NONE', workingShown: true } });
    expect(ib.learner.prompt).toMatch(/^Solve the equation .+\. Show all necessary working\. \[\d\]$/);
    expect(ib.key.answers).toHaveLength(2);
    expect(ib.rubric.map((p) => p.kind)).toEqual(expect.arrayContaining(['METHOD', 'ACCURACY']));
    expect(ib.learner.marks).toBe(ib.rubric.reduce((n, p) => n + p.marks, 0));
    expect(ib.learner.marks).toBeGreaterThan(1);
  });

  it('Cambridge 9709 Paper 1: its own command term, same mark logic', () => {
    expect(cambridge.learner).toMatchObject({ language: 'en', itemType: 'SHORT_RESPONSE' });
    expect(cambridge.learner.prompt).toMatch(/^Work out the solutions of the equation .+\[\d\]$/);
  });

  it('the three are the SAME construct: one family, one concept, one invariant hash, one parameter set for one seed', () => {
    const specs = (['PAA', 'IB', 'CAMBRIDGE'] as const).map((k) => { const r = compose(k); if (!r.ok) throw new Error(r.code); return r.specification; });
    expect(new Set(specs.map((s) => s.invariantHash)).size).toBe(1);
    expect(new Set(specs.map((s) => s.specificationId)).size).toBe(3);
    for (const i of [paa, ib, cambridge]) expect(i.lineage).toMatchObject({ constructFamilyId: FAMILY_ID, constructFamilyVersion: '1.0.0-test-certified', primaryConceptId: CONCEPT, certificationVersion: 'test-cert-1' });
    expect(new Set([paa, ib, cambridge].map((i) => i.lineage.parameterSetId)).size).toBe(1);
    expect(ib.parameterSet).toEqual(paa.parameterSet);
    // the PAA key is the greater of the two roots the IB instance asks for
    expect(ib.key.answers).toContain(paa.key.answers[0]);
  });

  it('and they are asked differently: language, format, marks, working, command term', () => {
    expect(new Set([paa, ib, cambridge].map((i) => i.learner.prompt)).size).toBe(3);
    const [sPaa, sIb, sCam] = (['PAA', 'IB', 'CAMBRIDGE'] as const).map((k) => { const r = compose(k); if (!r.ok) throw new Error(r.code); return r.specification; });
    expect(differingDimensions(sPaa, sIb).length).toBeGreaterThanOrEqual(3);
    expect(differingDimensions(sPaa, sCam).length).toBeGreaterThanOrEqual(3);
    expect(differingDimensions(sIb, sCam)).toContain('commandTerm');
    expect(new Set([paa, ib, cambridge].map((i) => i.lineage.assessmentAdapterId))).toEqual(new Set(['PAA.MATEMATICAS', 'IB.MATH_AA_HL.P1', 'CAMBRIDGE.9709.P1']));
  });

  it('every instance carries the complete lineage', () => {
    for (const i of [paa, ib, cambridge]) {
      expect(lineageClassOf(i.lineage)).toBe('CORE_DERIVED');
      expect(Object.keys(i.lineage).sort()).toEqual(['adaptationSpecificationId', 'assessmentAdapterId', 'assessmentAdapterVersion', 'assessmentSystemId', 'assessmentSystemVersionId', 'blueprintBucketId', 'certificationVersion', 'constructFamilyId', 'constructFamilyVersion', 'parameterSetId', 'primaryConceptId', 'rendererVersion', 'seed']);
      expect(i.lineage.rendererVersion).toBe('parametric.quadratic-factorising@1.0.0');
      expect(i.lineage.seed).toBe('seed-001');
    }
    const { parameterSetId: _dropped, ...partial } = paa.lineage;
    expect(lineageClassOf(partial)).toBe('LEGACY');
    expect(lineageClassOf(null)).toBe('LEGACY');
  });

  it('seed reproducibility: the same seed is the same instance; another seed is another one', () => {
    for (const k of ['PAA', 'IB', 'CAMBRIDGE'] as const) expect(render(k, 'STANDARD', 'seed-001')).toEqual(render(k, 'STANDARD', 'seed-001'));
    const prompts = new Set(Array.from({ length: 40 }, (_, i) => render('IB', 'STANDARD', `seed-${i}`).learner.prompt));
    expect(prompts.size).toBeGreaterThan(15);
  });

  it('parameter validity: every drawn set satisfies the family ranges, relationships and constraints, and the key solves the equation', () => {
    const ranges = (core.family.specialization as { parameterRanges: { symbol: string; min: number; max: number; step: number | null }[] }).parameterRanges;
    for (const band of ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const) {
      for (let i = 0; i < 120; i += 1) {
        const inst = render('IB', band, `validity-${i}`);
        const p = inst.parameterSet as unknown as QuadraticParameters;
        expect(parameterIssues(p, ranges), `${band} ${JSON.stringify(p)}`).toEqual([]);
        for (const root of [p.r1, p.r2]) expect(p.a * root * root + p.b * root + p.c).toBe(0);
        expect(Number.isInteger(p.b) && Number.isInteger(p.c) && p.b !== 0 && p.c !== 0).toBe(true);
        expect(inst.learner.prompt).toContain(presentEquation(p));
      }
    }
  });

  it('the band moves the levers the family names', () => {
    const f = render('IB', 'FOUNDATIONAL').parameterSet as unknown as QuadraticParameters;
    const s = render('IB', 'STANDARD').parameterSet as unknown as QuadraticParameters;
    const c = render('IB', 'CHALLENGE').parameterSet as unknown as QuadraticParameters;
    expect(f).toMatchObject({ a: 1, presentation: 'STANDARD_FORM' });
    expect(Number.isInteger(f.r1) && Number.isInteger(f.r2)).toBe(true);
    expect(s).toMatchObject({ a: 1, presentation: 'TERMS_ON_BOTH_SIDES' });
    expect(Math.sign(s.r1)).not.toBe(Math.sign(s.r2));
    expect(c.a).toBeGreaterThan(1);
    expect(Number.isInteger(c.r1)).toBe(false);
    expect(render('IB', 'STANDARD').rubric.length).toBeGreaterThan(render('IB', 'FOUNDATIONAL').rubric.length);
  });

  it('shortcut constraints hold: no option list is ever written, and the numeric item names the root it asks for', () => {
    for (const k of ['PAA', 'IB', 'CAMBRIDGE'] as const) for (const band of ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE']) expect(render(k, band).learner.options).toEqual([]);
    for (let i = 0; i < 30; i += 1) {
      const inst = render('PAA', 'STANDARD', `one-root-${i}`);
      const p = inst.parameterSet as unknown as QuadraticParameters;
      expect(inst.key.answers).toEqual([String(Math.max(p.r1, p.r2))]);
    }
    // a specification in an excluded format is refused by the renderer itself, whatever produced it
    const spec = compose('IB');
    if (!spec.ok) throw new Error(spec.code);
    const forged = { ...spec.specification, variable: { ...spec.specification.variable, responseFormat: { format: 'SELECTED_RESPONSE' as const, productionFormat: null } } };
    expect(renderer.render({ registry: REGISTRY, use: 'STUDENT_DELIVERY', core, adapter: adapterOf('IB'), applicability: spec.applicability, specification: forged as never, bucket: spec.bucket, seed: 's' })).toMatchObject({ ok: false, code: 'SHORTCUT_FORMAT_EXCLUDED' });
  });

  it('a conditional applicability is enforced on the instance', () => {
    const spec = compose('IB');
    if (!spec.ok) throw new Error(spec.code);
    const conditional = { ...applicabilityOf(core, 'PAA'), componentId: 'IB.MATH_AA_HL.P1', systemProfileId: 'IB' };
    expect(renderer.render({ registry: REGISTRY, use: 'STUDENT_DELIVERY', core, adapter: adapterOf('IB'), applicability: conditional, specification: spec.specification, bucket: spec.bucket, seed: 's' })).toMatchObject({ ok: false, code: 'APPLICABILITY_CONSTRAINT_VIOLATED' });
  });

  it('Student delivery refuses an uncertified core, adapter or renderer; dev-test may still render', () => {
    const provisional = createAssessmentInstanceRenderer([QUADRATIC_FACTORISING_STRATEGY]);
    const spec = compose('IB');
    if (!spec.ok) throw new Error(spec.code);
    const base = { registry: REGISTRY, core, adapter: adapterOf('IB'), applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed: 's' };
    expect(provisional.render({ ...base, use: 'STUDENT_DELIVERY' })).toMatchObject({ ok: false, code: 'RENDERER_NOT_CERTIFIED' });
    expect(provisional.render({ ...base, use: 'DEV_TEST' }).ok).toBe(true);
    expect(renderer.render({ ...base, use: 'STUDENT_DELIVERY', adapter: { ...adapterOf('IB'), status: 'PROVISIONAL' } })).toMatchObject({ ok: false, code: 'ADAPTER_NOT_CERTIFIED' });
    expect(compose('IB', 'STANDARD', { adapter: { ...adapterOf('IB'), status: 'PROVISIONAL' } })).toMatchObject({ ok: false, code: 'ADAPTER_NOT_CERTIFIED' });
    expect(createAssessmentInstanceRenderer([]).render({ ...base, use: 'DEV_TEST' })).toMatchObject({ ok: false, code: 'NO_RENDERING_STRATEGY' });
  });
});

describe('8. CERTIFIED_TEMPLATE_COMPOSITION composes certified components only', () => {
  const set = (lifecycle: 'CERTIFIED' | 'DRAFT' = 'CERTIFIED'): CertifiedTemplateSet => ({
    construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING', setVersion: '0.0.1-test',
    components: [
      { kind: 'STEM', componentId: 'stem.en.1', version: '1', lifecycle: 'CERTIFIED', language: 'en', adapterIds: ['IB.MATH_AA_HL.P1'], text: 'Solve {{equation}}.' },
      { kind: 'DATA_BLOCK', componentId: 'data.1', version: '1', lifecycle, values: { equation: 'x² − 5x + 6 = 0' }, answer: '2, 3' },
      { kind: 'ERROR_MODEL', componentId: 'err.sign', version: '1', lifecycle: 'CERTIFIED', misconceptionId: 'sign-of-roots', wrongAnswerByDataBlock: { 'data.1': '−2, −3' }, rationale: 'Reads the factor constants as roots.' },
    ],
  });
  const spec = (() => { const r = compose('IB'); if (!r.ok) throw new Error(r.code); return r; })();
  const run = (s: CertifiedTemplateSet) => createAssessmentInstanceRenderer([templateCompositionStrategy(s, 'CERTIFIED')]).render({ registry: REGISTRY, use: 'STUDENT_DELIVERY', core, adapter: adapterOf('IB'), applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed: 't' });

  it('fills a certified stem from a certified data block', () => {
    const r = run(set());
    expect(r).toMatchObject({ ok: true, instance: { strategy: 'CERTIFIED_TEMPLATE_COMPOSITION', learner: { prompt: 'Solve x² − 5x + 6 = 0.' }, key: { answers: ['2, 3'] } } });
    if (r.ok) expect(r.instance.parameterSet).toMatchObject({ stem: 'stem.en.1@1', dataBlock: 'data.1@1' });
  });

  it('one uncertified component, a slot with no certified value, or no stem for the adapter: refused, never improvised', () => {
    expect(run(set('DRAFT'))).toMatchObject({ ok: false, code: 'STRATEGY_REFUSED', detail: expect.stringContaining('UNCERTIFIED_COMPONENT') });
    const missing = set();
    expect(run({ ...missing, components: missing.components.map((c) => (c.kind === 'STEM' ? { ...c, text: 'Solve {{equation}} for {{unknown}}.' } : c)) })).toMatchObject({ ok: false, detail: expect.stringContaining('SLOT_WITHOUT_A_CERTIFIED_VALUE: unknown') });
    expect(run({ ...missing, components: missing.components.map((c) => (c.kind === 'STEM' ? { ...c, adapterIds: ['PAA.MATEMATICAS'] } : c)) })).toMatchObject({ ok: false, detail: expect.stringContaining('NO_CERTIFIED_STEM_FOR_THE_ADAPTER') });
  });
});

describe('7. zero provider calls at runtime', () => {
  const DIR = path.resolve(__dirname, '../../src/lib/assessment-instance');
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

  it('nothing in the directory can reach a model, the network, the environment or a clock', () => {
    expect(files.length).toBeGreaterThanOrEqual(11);
    for (const f of files) {
      const src = readFileSync(path.join(DIR, f), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/@\/lib\/ai|openai|anthropic|executeAI|callModel|fetch\(|process\.env|Date\.now\(|Math\.random\(|generation-queue|generator\/provider'/);
    }
  });

  it('rendering makes no network call', () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call during render'); });
    vi.stubGlobal('fetch', fetchSpy);
    for (const k of ['PAA', 'IB', 'CAMBRIDGE'] as const) for (const band of ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE']) render(k, band, 'no-network');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('10. the one Student supply policy (OE-015)', () => {
  const instance = render('IB');
  const registry = (over: Partial<Record<'core' | 'adapter' | 'applicability' | 'renderer', string>> & { governed?: boolean } = {}): CertifiedRegistryView => ({
    core: () => ({ lifecycle: over.core ?? 'CERTIFIED', certificationVersion: 'test-cert-1' }),
    adapter: () => ({ status: over.adapter ?? 'CERTIFIED' }),
    applicability: () => ({ status: over.applicability ?? 'SUPPORTED' }),
    renderer: () => ({ status: over.renderer ?? 'CERTIFIED' }),
    bucketGoverned: () => over.governed ?? true,
  });
  const certified = (over: Partial<SupplyCandidate> = {}): SupplyCandidate => ({ itemId: 'i-1', lineage: instance.lineage, origin: 'CORE_RENDERED', reviewed: true, rightsCleared: true, ...over });

  it('certified global supply: an instance with complete certified lineage is eligible', () => {
    expect(studentSupplyDecision(certified(), registry())).toMatchObject({ eligible: true });
    expect(studentSupplyDecision(certified({ origin: 'CORE_MATERIALIZED' }), registry())).toMatchObject({ eligible: true });
  });

  it('legacy bank rejection: item text with no core lineage is never eligible, however reviewed it is', () => {
    for (const origin of ['LEGACY_GENERATED', 'AUTHORED_WITHOUT_CORE'] as const) {
      expect(studentSupplyDecision({ itemId: 'legacy', lineage: null, origin, reviewed: true, rightsCleared: true }, registry())).toEqual({ eligible: false, reasons: ['LEGACY_NO_CORE_LINEAGE'] });
    }
    // a legacy item cannot borrow a lineage: its origin still says what it is
    expect(studentSupplyDecision(certified({ origin: 'LEGACY_GENERATED' }), registry())).toMatchObject({ eligible: false, reasons: ['LEGACY_NO_CORE_LINEAGE'] });
  });

  it('per-Student inventory, unreviewed generated items, fixtures and missing rights are each refused by name', () => {
    expect(studentSupplyDecision({ itemId: 'x', lineage: null, origin: 'PER_STUDENT_GENERATED', reviewed: false, rightsCleared: true }, registry())).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['PER_STUDENT_GENERATED_INVENTORY', 'UNREVIEWED_GENERATED_ITEM', 'LEGACY_NO_CORE_LINEAGE']) });
    expect(studentSupplyDecision({ itemId: 'x', lineage: null, origin: 'FIXTURE', reviewed: true, rightsCleared: true }, registry())).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['FIXTURE']) });
    expect(studentSupplyDecision(certified({ rightsCleared: false }), registry())).toMatchObject({ eligible: false, reasons: ['RIGHTS_MISSING'] });
  });

  it('eligibility follows the CURRENT certified state of what the lineage points at', () => {
    expect(studentSupplyDecision(certified(), registry({ core: 'RETIRED' }))).toMatchObject({ eligible: false, reasons: ['CORE_NOT_CERTIFIED'] });
    expect(studentSupplyDecision(certified(), registry({ adapter: 'PROVISIONAL' }))).toMatchObject({ eligible: false, reasons: ['ADAPTER_NOT_CERTIFIED'] });
    expect(studentSupplyDecision(certified(), registry({ applicability: 'NOT_APPLICABLE' }))).toMatchObject({ eligible: false, reasons: ['APPLICABILITY_NOT_SUPPORTED'] });
    expect(studentSupplyDecision(certified(), registry({ renderer: 'PROVISIONAL' }))).toMatchObject({ eligible: false, reasons: ['RENDERER_NOT_CERTIFIED'] });
    expect(studentSupplyDecision(certified(), registry({ governed: false }))).toMatchObject({ eligible: false, reasons: ['BLUEPRINT_NOT_GOVERNED'] });
    expect(studentSupplyDecision(certified({ lineage: { ...instance.lineage, certificationVersion: 'older' } }), registry())).toMatchObject({ eligible: false, reasons: ['CERTIFICATION_VERSION_MISMATCH'] });
  });

  it('fresh Student supply: a Student with no history is supplied from the global certified instances; history only avoids repeats', () => {
    const pool: SupplyCandidate[] = [
      ...Array.from({ length: 5 }, (_, i) => certified({ itemId: `core-${i}`, lineage: render('IB', 'STANDARD', `pool-${i}`).lineage })),
      { itemId: 'legacy-a', lineage: null, origin: 'LEGACY_GENERATED', reviewed: true, rightsCleared: true },
      { itemId: 'mine', lineage: null, origin: 'PER_STUDENT_GENERATED', reviewed: false, rightsCleared: true },
    ];
    const fresh = supplyForStudent(pool, registry(), 3);
    expect(fresh).toMatchObject({ state: 'READY', eligible: 5 });
    expect(fresh.supplied.every((c) => c.itemId.startsWith('core-'))).toBe(true);
    // the same for any other fresh Student: supply is global
    expect(supplyForStudent(pool, registry(), 3).supplied.map((c) => c.itemId)).toEqual(fresh.supplied.map((c) => c.itemId));
    const seen = new Set(fresh.supplied.map((c) => (c.lineage as { parameterSetId: string }).parameterSetId));
    const next = supplyForStudent(pool, registry(), 2, seen);
    expect(next.state).toBe('READY');
    expect(next.supplied.some((c) => fresh.supplied.includes(c))).toBe(false);
    // not enough certified content: NOT_READY, never topped up from legacy or per-Student inventory
    expect(supplyForStudent(pool, registry(), 6)).toMatchObject({ state: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT', supplied: [] });
    expect(supplyForStudent(pool, registry({ core: 'DRAFT' }), 1)).toMatchObject({ state: 'NOT_READY', eligible: 0 });
  });
});

describe('12. the planning unit is certified core x applicable adapter x delivery depth', () => {
  const ranges = (core.family.specialization as { parameterRanges: { symbol: string; min: number; max: number; step: number | null }[] }).parameterRanges;
  const capacity = quadraticInstanceCapacity('STANDARD', ranges);
  const buckets = [
    { ...bucketOf('PAA'), requiredPerForm: 2 }, { ...bucketOf('IB'), requiredPerForm: 1 }, { ...bucketOf('CAMBRIDGE'), requiredPerForm: 1 },
    { ...bucketOf('IB', { bucketId: 'test/IB/unlinked#0', primaryConceptStableIds: [] }), requiredPerForm: 1 },
    { ...bucketOf('IB', { bucketId: 'test/IB/probability#0', primaryConceptStableIds: ['math.prob.probability'] }), requiredPerForm: 1 },
  ];
  const plan = planByCore({
    cores: [core, draftCore], adapters: (['PAA', 'IB', 'CAMBRIDGE'] as const).map(adapterOf), applicability: (['PAA', 'IB', 'CAMBRIDGE'] as const).map((k) => applicabilityOf(core, k)),
    buckets, requiredDepth: 4, capacityOf: () => capacity,
  });

  it('the unit changed', () => {
    expect(LEGACY_PLAN_UNIT).toBe('ITEM_TEXT');
    expect(plan.planUnit).toBe(PLAN_UNIT);
    expect(PLAN_UNIT).toBe('CERTIFIED_CORE_X_APPLICABLE_ADAPTER_X_DELIVERY_DEPTH');
  });

  it('one certified core plans three adapters; the draft core plans nothing', () => {
    expect(plan.units.map((u) => `${u.constructFamilyId}@${u.familyVersion} x ${u.adapterId}`)).toEqual(['PAA.MATEMATICAS', 'IB.MATH_AA_HL.P1', 'CAMBRIDGE.9709.P1'].map((a) => `${FAMILY_ID}@1.0.0-test-certified x ${a}`));
    expect(plan.refusals).toEqual([
      { bucketId: 'test/IB/unlinked#0', constructFamilyId: null, adapterId: 'IB.MATH_AA_HL.P1', code: 'BUCKET_HAS_NO_PRIMARY_CONCEPT_LINEAGE' },
      { bucketId: 'test/IB/probability#0', constructFamilyId: null, adapterId: 'IB.MATH_AA_HL.P1', code: 'NO_CERTIFIED_CORE_FOR_THE_BUCKET' },
    ]);
  });

  it('the five coverages are tracked separately and deliverable instances are derived', () => {
    expect(capacity).toBeGreaterThan(40);
    expect(plan.coverage.CORE_COVERAGE).toEqual({ conceptsRequired: 2, conceptsWithCertifiedCore: 1 });
    expect(plan.coverage.ADAPTER_COVERAGE).toEqual({ adaptersRequired: 3, adaptersCertified: 3 });
    expect(plan.coverage.BLUEPRINT_COVERAGE).toEqual({ buckets: 5, scalableBuckets: 4, bucketsWithAPlannableUnit: 3, bucketsMeetingDepth: 3 });
    expect(plan.coverage.INSTANCE_CAPACITY).toBe(capacity * 3);
    expect(plan.coverage.REPEATABILITY_DEPTH).toBe(Math.floor(capacity / 2));
    // 4 forms x (2 + 1 + 1) slots: derived from depth, not from a count of texts
    expect(plan.studentDeliverableInstances).toBe(16);
  });

  it('an adapter that is not certified, or a combination with no applicability record, plans nothing', () => {
    const provisional = planByCore({ cores: [core], adapters: [{ ...adapterOf('IB'), status: 'PROVISIONAL' }], applicability: [applicabilityOf(core, 'IB')], buckets: [{ ...bucketOf('IB'), requiredPerForm: 1 }], requiredDepth: 1, capacityOf: () => 10 });
    expect(provisional).toMatchObject({ units: [], refusals: [{ code: 'ADAPTER_NOT_CERTIFIED' }], studentDeliverableInstances: 0 });
    const unrecorded = planByCore({ cores: [core], adapters: [adapterOf('IB')], applicability: [], buckets: [{ ...bucketOf('IB'), requiredPerForm: 1 }], requiredDepth: 1, capacityOf: () => 10 });
    expect(unrecorded).toMatchObject({ units: [], refusals: [{ code: 'NO_EXPLICIT_APPLICABILITY' }] });
  });
});

describe('13. the migration is additive and classifies existing content as LEGACY', () => {
  const sql = readFileSync(path.resolve(__dirname, '../../database/migrations/20261121_1100_qf51_construct_core_lineage.sql'), 'utf-8');
  const statements = sql.replace(/^--.*$/gm, '');

  it('creates the eight tables and the Student supply view', () => {
    for (const t of ['assessment_systems', 'assessment_system_versions', 'assessment_system_nodes', 'assessment_construct_cores', 'assessment_adapters', 'assessment_construct_core_applicability', 'assessment_instance_renderers', 'assessment_item_instances']) expect(statements).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
    expect(statements).toContain('CREATE OR REPLACE VIEW public.student_eligible_item_instances');
    expect(statements).toMatch(/lifecycle IN \('DRAFT', 'UNDER_REVIEW', 'CERTIFIED', 'RETIRED'\)/);
    expect(statements).toMatch(/status IN \('SUPPORTED', 'CONDITIONAL', 'NOT_APPLICABLE'\)/);
  });

  it('does not destroy or rewrite existing question_bank_items', () => {
    expect(statements).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.question_bank|UPDATE question_bank/i);
    expect(statements).toMatch(/ADD COLUMN IF NOT EXISTS lineage_class text NOT NULL DEFAULT 'LEGACY'/);
    expect(statements).toMatch(/\(lineage_class = 'CORE_DERIVED'\) = \(item_instance_id IS NOT NULL\)/);
  });

  it('Student supply reads instances only, never the legacy item table', () => {
    const view = statements.slice(statements.indexOf('CREATE OR REPLACE VIEW public.student_eligible_item_instances'));
    expect(view).not.toContain('question_bank_items');
    for (const guard of ["c.lifecycle = 'CERTIFIED'", "a.status = 'CERTIFIED'", "r.status = 'CERTIFIED'", "p.status IN ('SUPPORTED', 'CONDITIONAL')"]) expect(view).toContain(guard);
  });
});
