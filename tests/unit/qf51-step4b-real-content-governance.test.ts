/**
 * QF V5.1 / STEP 4B -- real content governance: the difficulty contract, certification by a person on the record,
 * inherited deterministic certification, the second renderer and the pilot slice.
 *
 * NOTHING REAL IS CERTIFIED BY THESE TESTS. Where a test needs a certified path it builds certification records
 * for a TEST reviewer in memory; those records exist nowhere else. The tests that read the real pilot slice assert
 * that it is NOT certified and NOT Student-eligible.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bandOf } from '@/lib/exam-core/question-bank/quality';
import {
  adapterById, adapterConflicts, authorityIsExternalAccreditation, blueprintGate, certificationStateOf, certifiedInstanceLineageOf, certifiedLineageIntact, classifyBlueprintSection, envelopeHashOf, inheritanceRefusals, instanceCertificationOf, instanceEnvelopeIssues,
  itemDifficultyOf, itemStructuresOf, lineageClassOf, rangesOutsideTheCore, reconcileAdapterDifferences, RendererEnvelopeSchema, REPLACEABLE_BY_INDIVIDUAL_REVIEW, responseRepresentationsOf, STUDYUS_ASSESSMENT_REGISTRY, studentBandsOf, studentSupplyDecision,
  type CertifiableObject, type CertificationRecord, type CertificationState, type InheritanceFacts, type ReviewerQualification,
} from '@/lib/assessment-instance';
import {
  PILOT_BLUEPRINT_IB, PILOT_BLUEPRINT_PAA, PILOT_CORE_PROPORTION, PILOT_CORE_QUADRATIC, PILOT_CORE_REASONING, PILOT_CORES, PILOT_ENVELOPE_PROPORTION, PILOT_ENVELOPE_QUADRATIC, PILOT_ENVELOPES, PILOT_IB, PILOT_PAA, PILOT_REVIEWER_SCOPES,
  PILOT_PROPORTION_CORE_VERSION, PILOT_QUADRATIC_CORE_VERSION, PILOT_TARGET_IB, PILOT_TARGET_PAA, pilotApplicability, pilotDecisionObjects, preparePilotInstances, renderPilotInstance, WITHDRAWN_CORE_VERSIONS,
} from '@/lib/assessment-instance/pilot/step4b-pilot-slice';
import { PROPORTION_BAND_LIMITS, PROPORTION_MISSING_VALUE_STRATEGY, proportionBandIssues, proportionInstanceCapacity, proportionMisconceptionAnswers, proportionParameterIssues, scaleFactorOf, type ProportionParameters } from '@/lib/assessment-instance/strategy-proportion-missing-value';
import { QUADRATIC_FACTORISING_STRATEGY, quadraticBandIssues } from '@/lib/assessment-instance/strategy-quadratic-factorising';
import { methodNeutralRubric, QUADRATIC_SOLVE_STRATEGY, QUADRATIC_SUPPORTED_REASONING_STRATEGIES } from '@/lib/assessment-instance/strategy-quadratic-solve';
import { mathPocFamilyOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families';
import { mathPocFamilyEa1aOf } from '@/lib/exam-core/question-bank/task-families/math-poc-families-ea1a';

const ROOT = process.cwd();
const BANDS = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const;
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const pilot = preparePilotInstances();
const supply = pilot.instances.filter((i) => i.role === 'STUDENT_SUPPLY_CANDIDATE');
const crossModel = pilot.instances.filter((i) => i.role === 'CROSS_MODEL_PROOF');

// ------------------------------------------------------------------------------------------- test reviewer
const GRANTED = '2026-10-01T00:00:00Z';
const DECIDED = '2026-10-12T12:00:00Z';
const qualification = (over: Partial<ReviewerQualification> = {}): ReviewerQualification => ({ v: 1, reviewerId: 'test-reviewer', authority: 'INTERNAL_PILOT_REVIEWER', scopes: [{ canonicalSubject: 'Mathematics', systemId: 'PAA' }, { canonicalSubject: 'Mathematics', systemId: 'IB' }], grantedBy: 'test-admin', grantedAt: GRANTED, revokedAt: null, ...over });
const approve = (o: CertifiableObject, over: Partial<CertificationRecord> = {}): CertificationRecord => ({ v: 1, reviewerId: 'test-reviewer', authority: 'INTERNAL_PILOT_REVIEWER', scope: o.scope, objectType: o.objectType, objectId: o.objectId, objectVersion: o.objectVersion, decision: 'APPROVE', decidedAt: DECIDED, evidenceHash: o.contentHash, notes: null, ...over });
const OBJECT: CertifiableObject = { objectType: 'CONSTRUCT_CORE', objectId: PILOT_CORE_QUADRATIC.constructFamilyId, objectVersion: PILOT_CORE_QUADRATIC.familyVersion, contentHash: PILOT_CORE_QUADRATIC.contentHash, scope: { canonicalSubject: 'Mathematics', systemId: 'PAA' } };

describe('Step 4B / Decision 1 -- a blueprint is classified by its structure, not by the content status of its items', () => {
  it('the classifier takes no content status; the two pilot blueprints are REDUCED on their recorded facts', () => {
    expect(PILOT_BLUEPRINT_PAA.facts).toMatchObject({ declaredFixture: false, officialItemCount: 55, governedSlots: 12 });
    expect(PILOT_BLUEPRINT_PAA.proposedClass).toBe('REDUCED');
    // IB Paper 1 is marks-based: no official item count exists, so a count of positions can never make it FULL
    expect(PILOT_BLUEPRINT_IB.facts).toMatchObject({ declaredFixture: false, officialItemCount: null, governedSlots: 5 });
    expect(PILOT_BLUEPRINT_IB.proposedClass).toBe('REDUCED');
  });
  it('PAA Matemáticas is not FULL because official totals exist: 12 of 55 governed is REDUCED, and it never serves a full mock', () => {
    expect(classifyBlueprintSection({ ...PILOT_BLUEPRINT_PAA.facts })).not.toBe('FULL');
    expect(blueprintGate('FULL_MOCK', PILOT_BLUEPRINT_PAA.proposedClass).ok).toBe(false);
    expect(blueprintGate('PRACTICE', PILOT_BLUEPRINT_PAA.proposedClass).ok).toBe(true);
    expect(blueprintGate('REDUCED_MOCK', PILOT_BLUEPRINT_IB.proposedClass).ok).toBe(true);
  });
  it('nothing is promoted automatically: both are PROPOSED, and an unclassified blueprint still satisfies nothing', () => {
    for (const b of [PILOT_BLUEPRINT_PAA, PILOT_BLUEPRINT_IB]) expect(b.status).toBe('PROPOSED');
    expect(blueprintGate('PRACTICE', undefined)).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_CLASSIFIED' });
  });
  it('each pilot bucket names the one canonical concept it places, for the adapter it belongs to', () => {
    expect(PILOT_BLUEPRINT_PAA.buckets.map((b) => [b.bucket.objectiveCode, b.bucket.primaryConceptStableIds])).toEqual([['paa.mat.algebra', ['math.alg.quadratics']], ['paa.mat.aritmetica', ['math.num.ratio-proportion']]]);
    expect(PILOT_BLUEPRINT_IB.buckets.map((b) => b.bucket.adapterId)).toEqual([PILOT_IB]);
  });
});

describe('Step 4B / cores -- a method-neutral quadratic core and a corrected proportion core, neither certified', () => {
  const spec = (c: typeof PILOT_CORE_QUADRATIC) => c.family.specialization as { mathematicalStructure: { construct: string; description: string }; relationships: string[]; parameterRanges: unknown; variables: unknown; validSolutionRules: string[]; misconceptionModels: { id: string; description: string }[]; numericalDifficultyLevers: Record<string, string>[] };
  const factorisingDraft = mathPocFamilyEa1aOf('tf.math.quadratic.solve-by-factorising')!;
  it('exactly two cores: a NEW quadratic identity and the proportion core at rc.2', () => {
    expect(PILOT_CORES.map((c) => `${c.constructFamilyId}@${c.familyVersion}`)).toEqual([`tf.math.quadratic.solve-rational-roots@${PILOT_QUADRATIC_CORE_VERSION}`, `tf.math.proportion.missing-value@${PILOT_PROPORTION_CORE_VERSION}`]);
    expect(PILOT_PROPORTION_CORE_VERSION).toBe('1.0.0-rc.2');
    for (const c of PILOT_CORES) expect(c).toMatchObject({ lifecycle: 'UNDER_REVIEW', certification: null });
  });
  it('the factorisation-specific core is NOT in the pilot, under any adapter; its draft is left as it was', () => {
    expect(PILOT_CORES.some((c) => c.constructFamilyId === 'tf.math.quadratic.solve-by-factorising')).toBe(false);
    expect(pilot.instances.some((i) => i.coreId === 'tf.math.quadratic.solve-by-factorising' || /factorising/.test(i.rendererVersion))).toBe(false);
    expect(pilotDecisionObjects().some((d) => /solve-by-factorising|quadratic-factorising/.test(d.objectId))).toBe(false);
    expect(WITHDRAWN_CORE_VERSIONS.map((w) => `${w.constructFamilyId}@${w.version}`)).toEqual(['tf.math.proportion.missing-value@1.0.0-rc.1', 'tf.math.quadratic.solve-by-factorising@1.0.0-rc.1']);
    // still available, unchanged and still a draft, for a manifestation whose working is observed
    expect(factorisingDraft).toMatchObject({ lifecycle: 'DRAFT', reviewStatus: 'UNREVIEWED' });
    expect(factorisingDraft.evidenceTarget.observablePerformance).toMatch(/factorises/);
    expect(QUADRATIC_FACTORISING_STRATEGY).toMatchObject({ status: 'PROVISIONAL', construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING' });
  });
  it('the quadratic core claims that the equation is solved, by any valid method: factorising is supported, never required', () => {
    const f = PILOT_CORE_QUADRATIC.family;
    expect(spec(PILOT_CORE_QUADRATIC).mathematicalStructure.construct).toBe('QUADRATIC_EQUATION_RATIONAL_ROOTS');
    expect(f.evidenceTarget.observablePerformance).toMatch(/any valid method/);
    // nothing in what the construct claims, or in how a response is judged valid, names factorising as required
    for (const text of [f.evidenceTarget.observablePerformance, f.evidenceTarget.object, spec(PILOT_CORE_QUADRATIC).mathematicalStructure.description, ...spec(PILOT_CORE_QUADRATIC).misconceptionModels.map((m) => m.description), ...f.commonMisconceptions]) expect(text).not.toMatch(/factoris/i);
    const r = PILOT_CORE_REASONING[PILOT_CORE_QUADRATIC.constructFamilyId];
    expect(r.requiredObservableMethod).toBeNull();
    expect(r.supportedStrategies).toEqual(QUADRATIC_SUPPORTED_REASONING_STRATEGIES);
    expect(r.supportedStrategies).toContain('FACTORISING');
    expect(r.minimumSuccessfulPath.join(' ')).not.toMatch(/factoris/i);
  });
  it('it keeps the draft\'s mathematics: variables, ranges, relationships and system support are unchanged', () => {
    const d = factorisingDraft.specialization as unknown as ReturnType<typeof spec>;
    expect(spec(PILOT_CORE_QUADRATIC).relationships).toEqual(d.relationships);
    expect(spec(PILOT_CORE_QUADRATIC).parameterRanges).toEqual(d.parameterRanges);
    expect(spec(PILOT_CORE_QUADRATIC).variables).toEqual(d.variables);
    expect(PILOT_CORE_QUADRATIC.family.profileSupport).toEqual(factorisingDraft.profileSupport);
    expect(PILOT_CORE_QUADRATIC.family.primaryConcepts).toEqual(factorisingDraft.primaryConcepts);
  });
  it('PAA construct necessity: an answer-only instance offers no candidate value, allows no calculator, and its key is a root', () => {
    expect(PILOT_CORE_QUADRATIC.shortcutConstraints.map((s) => s.id)).toEqual(['substitute-the-options', 'equation-solver']);
    expect(PILOT_CORE_QUADRATIC.shortcutConstraints.every((s) => s.instanceRule !== null)).toBe(true);
    expect(pilotApplicability(PILOT_CORE_QUADRATIC, PILOT_PAA)).toMatchObject({ status: 'CONDITIONAL', constraints: [{ kind: 'RESPONSE_FORMAT_ONLY', formats: ['NUMERIC_ENTRY'] }] });
    for (const adapterId of PILOT_ENVELOPE_QUADRATIC.adapterIds) expect(STUDYUS_ASSESSMENT_REGISTRY.adapter(adapterId)!.calculator).toEqual(['NONE']);
    for (const i of supply.filter((x) => x.coreId === PILOT_CORE_QUADRATIC.constructFamilyId)) {
      const p = i.rendered.parameterSet as { a: number; b: number; c: number };
      const x = i.answers[0].includes('/') ? Number(i.answers[0].split('/')[0]) / Number(i.answers[0].split('/')[1]) : Number(i.answers[0]);
      expect(p.a * x * x + p.b * x + p.c).toBe(0);
      expect(i.rendered.learner).toMatchObject({ itemType: 'NUMERIC_ENTRY', options: [], stimulus: null });
      expect(i.prompt).not.toMatch(/factor/i);
    }
  });
  it('the proportion core no longer states "two proportions applied in turn": its steps lever is the unit conversion the renderer guarantees', () => {
    const text = JSON.stringify(PILOT_CORE_PROPORTION.family);
    expect(text).not.toMatch(/two proportions|second proportion|composed-proportion/i);
    const levers = spec(PILOT_CORE_PROPORTION).numericalDifficultyLevers;
    expect(levers.map((l) => l.lever)).toEqual(['scale-factor', 'unit-conversion']);
    expect(levers[1]).toMatchObject({ kind: 'STEPS', STANDARD: 'One proportion after a unit conversion.', CHALLENGE: 'One proportion after a unit conversion.' });
    expect(levers[0].CHALLENGE).toMatch(/not a simple fraction/);
    expect(PILOT_CORE_PROPORTION.family.difficultyLevers.map((l) => l.lever)).toEqual(['scale-factor', 'unit-conversion']);
    // no variable was invented: the declared variables are the draft's four
    expect((spec(PILOT_CORE_PROPORTION).variables as { symbol: string }[]).map((v) => v.symbol)).toEqual(['a', 'b', 'c', 'x']);
    expect(spec(PILOT_CORE_PROPORTION).variables).toEqual((mathPocFamilyOf('tf.math.proportion.missing-value')!.specialization as unknown as ReturnType<typeof spec>).variables);
    expect(PILOT_ENVELOPE_PROPORTION.exclusions.join(' ')).not.toMatch(/two proportions applied in turn/);
  });
  it('a contract change is a new hash: nothing reviewed under the withdrawn wording carries over', () => {
    const WITHDRAWN_HASHES = ['21647cff9b6c7711eb3d8101f2e937413571212de34584', 'd32acfbbf0ad3d6d6bfc9061e7fa6c09172c4136325b93d64c0a27783'];
    for (const c of PILOT_CORES) for (const h of WITHDRAWN_HASHES) expect(c.contentHash.startsWith(h)).toBe(false);
    const stale = approve({ objectType: 'CONSTRUCT_CORE', objectId: PILOT_CORE_PROPORTION.constructFamilyId, objectVersion: '1.0.0-rc.1', contentHash: 'd'.repeat(64), scope: { canonicalSubject: 'Matemáticas', systemId: 'PAA' } });
    const now: CertifiableObject = { objectType: 'CONSTRUCT_CORE', objectId: PILOT_CORE_PROPORTION.constructFamilyId, objectVersion: PILOT_CORE_PROPORTION.familyVersion, contentHash: PILOT_CORE_PROPORTION.contentHash, scope: { canonicalSubject: 'Matemáticas', systemId: 'PAA' } };
    expect(certificationStateOf(now, stale, [qualification({ scopes: [...PILOT_REVIEWER_SCOPES] })])).toMatchObject({ certified: false, reason: 'RECORD_IS_OF_ANOTHER_OBJECT' });
  });
  it('the reviewer has three scopes; Mathematics and Matemáticas stay two subjects', () => {
    expect(PILOT_REVIEWER_SCOPES.map((s) => `${s.canonicalSubject} x ${s.systemId}`)).toEqual(['Mathematics x PAA', 'Mathematics x IB', 'Matemáticas x PAA']);
    expect(PILOT_CORE_QUADRATIC.canonicalSubject).toBe('Mathematics');
    expect(PILOT_CORE_PROPORTION.canonicalSubject).toBe('Matemáticas');
    expect(pilotDecisionObjects().every((d) => d.withinProposedScopes)).toBe(true);
    expect(pilotDecisionObjects().filter((d) => d.scope.canonicalSubject === 'Matemáticas').map((d) => d.objectType)).toEqual(['CONSTRUCT_CORE', 'RENDERER_ENVELOPE']);
  });
});

describe('Step 4B / Decision 4 -- IB adapter: structure, representation and command terms are separate things', () => {
  const ib = adapterById(PILOT_IB)!;
  const reading = reconcileAdapterDifferences(adapterConflicts().filter((c) => c.adapterId === PILOT_IB), adapterById);
  it('MULTI_PART is an item structure the adapter admits; MATH_EXPRESSION is a response representation it admits', () => {
    expect(itemStructuresOf(ib)).toEqual(['SINGLE_PART', 'MULTI_PART']);
    expect(responseRepresentationsOf(ib)).toEqual(['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE']);
    expect(responseRepresentationsOf(ib)).not.toContain('MULTI_PART');
    expect(itemStructuresOf(adapterById(PILOT_PAA)!)).toEqual(['SINGLE_PART']);
  });
  it('the difference with the generation profile is not a forced choice: a structure code, and a representation the generator never uses', () => {
    expect(reading.find((e) => e.kind === 'STRUCTURE_LISTED_AS_A_RESPONSE_FORMAT')).toMatchObject({ values: ['MULTI_PART'], structureAdmitted: true, adapterIsValidAsItIs: true });
    expect(reading.find((e) => e.kind === 'ADAPTER_GOVERNS_MORE_THAN_THE_PROFILE_USES' && e.dimension === 'responseFormats')).toMatchObject({ values: ['MATH_EXPRESSION'], adapterIsValidAsItIs: true });
    expect(reading.every((e) => e.adapterIsValidAsItIs)).toBe(true);
  });
  it('the adapter exposes the whole governed command-term set; the pilot renderer writes a subset; an unsourced list widens nothing', () => {
    expect(ib.commandTerms).toMatchObject({ use: 'CONTROLLED_VOCABULARY', terms: ['find', 'solve', 'show that', 'hence', 'write down', 'calculate'] });
    expect(PILOT_ENVELOPE_QUADRATIC.commandTerms).toEqual(['solve']);
    for (const t of PILOT_ENVELOPE_QUADRATIC.commandTerms) expect(ib.commandTerms.terms).toContain(t);
    const ungoverned = reading.find((e) => e.kind === 'PROFILE_USES_A_VALUE_THE_ADAPTER_DOES_NOT_GOVERN' && e.dimension === 'commandTerms')!;
    expect(ungoverned.values).toHaveLength(9);
    for (const t of ungoverned.values) expect(ib.commandTerms.terms).not.toContain(t);
    // the adapter was neither narrowed to the renderer nor widened to the generator
    expect(ib.commandTerms.terms.length).toBeGreaterThan(PILOT_ENVELOPE_QUADRATIC.commandTerms.length);
  });
  it('every IB instance uses a command term of the envelope; a term outside it puts the instance outside the envelope', () => {
    for (const i of crossModel) expect(i.prompt.startsWith('Solve ')).toBe(true);
    const i = crossModel[0];
    const ctx = { adapterId: PILOT_IB, language: 'en', responseFormat: 'SHORT_RESPONSE', planningBand: i.planningBand as string, commandTerm: 'prove' as string | null };
    expect(instanceEnvelopeIssues(PILOT_ENVELOPE_QUADRATIC, i.rendered, ctx, quadraticBandIssues).map((x) => x.code)).toEqual(['COMMAND_TERM_OUTSIDE_THE_ENVELOPE']);
    expect(instanceEnvelopeIssues(PILOT_ENVELOPE_QUADRATIC, i.rendered, { ...ctx, commandTerm: 'solve' }, quadraticBandIssues)).toEqual([]);
  });
  it('where working is marked, the method mark is open to any valid method', () => {
    for (const i of crossModel) {
      const method = i.rendered.rubric.filter((r) => r.kind === 'METHOD');
      expect(method.length).toBeGreaterThan(0);
      expect(method.some((r) => /^Factorises:/.test(r.criterion))).toBe(false);
      expect(method.some((r) => /Applies a valid method/.test(r.criterion) && /quadratic formula/.test(r.criterion))).toBe(true);
    }
    expect(methodNeutralRubric([{ code: 'M1', kind: 'METHOD', marks: 1, criterion: 'Factorises: (x − 1)(x − 6) = 0.' }])[0]).toMatchObject({ code: 'M1', marks: 1 });
  });
});

describe('Step 4B / difficulty contract -- planning band -> certified item difficulty 1..5 -> bandOf()', () => {
  it('every band of every pilot envelope carries an integer 1..5, and together they reach LOW, MEDIUM and HIGH', () => {
    for (const e of PILOT_ENVELOPES) {
      for (const b of e.bands) expect(Number.isInteger(b.itemDifficulty) && b.itemDifficulty >= 1 && b.itemDifficulty <= 5).toBe(true);
      expect(studentBandsOf(e)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    }
  });
  it('the Student band is bandOf(item difficulty) and nothing else: no planning label reaches the instance record', () => {
    for (const i of pilot.instances) {
      expect(i.difficultyBand).toBe(bandOf(i.itemDifficulty));
      expect(i.certifiedLineage.itemDifficulty).toBe(i.itemDifficulty);
      expect(JSON.stringify(i.certifiedLineage)).not.toMatch(/FOUNDATIONAL|STANDARD|CHALLENGE/);
    }
  });
  it('an envelope refuses a difficulty outside 1..5, a difficulty that falls as the band rises, and a drawn representation', () => {
    const bands = (d: number[]) => PILOT_ENVELOPE_QUADRATIC.bands.map((b, i) => ({ ...b, itemDifficulty: d[i] }));
    expect(RendererEnvelopeSchema.safeParse({ ...PILOT_ENVELOPE_QUADRATIC, bands: bands([2, 3, 6]) }).success).toBe(false);
    expect(RendererEnvelopeSchema.safeParse({ ...PILOT_ENVELOPE_QUADRATIC, bands: bands([0, 3, 4]) }).success).toBe(false);
    expect(RendererEnvelopeSchema.safeParse({ ...PILOT_ENVELOPE_QUADRATIC, bands: bands([3, 2, 4]) }).error?.issues[0].message).toBe('DIFFICULTY_DECREASES_AS_THE_BAND_RISES');
    expect(RendererEnvelopeSchema.safeParse({ ...PILOT_ENVELOPE_QUADRATIC, stimulusKinds: ['GRAPH'] }).success).toBe(false);
    expect(RendererEnvelopeSchema.safeParse({ ...PILOT_ENVELOPE_QUADRATIC, bands: bands([2, 3, 3]) }).success).toBe(true);
  });
  it('changing the difficulty mapping changes the envelope hash, the digest of every instance, and voids the certification', () => {
    const remapped = RendererEnvelopeSchema.parse({ ...PILOT_ENVELOPE_QUADRATIC, bands: PILOT_ENVELOPE_QUADRATIC.bands.map((b) => (b.planningBand === 'CHALLENGE' ? { ...b, itemDifficulty: 5 } : b)) });
    expect(envelopeHashOf(remapped)).not.toBe(envelopeHashOf(PILOT_ENVELOPE_QUADRATIC));
    const i = supply.find((x) => x.coreId === PILOT_CORE_QUADRATIC.constructFamilyId && x.planningBand === 'CHALLENGE')!;
    const again = certifiedInstanceLineageOf(remapped, i.rendered, 'CHALLENGE');
    expect(again.ok && again.value.itemDifficulty).toBe(5);
    expect(again.ok && again.value.digest).not.toBe(i.certifiedLineage.digest);
    const envelopeObject: CertifiableObject = { objectType: 'RENDERER_ENVELOPE', objectId: remapped.rendererVersion, objectVersion: remapped.constructFamilyVersion, contentHash: envelopeHashOf(remapped), scope: OBJECT.scope };
    const approvalOfTheOldEnvelope = approve({ ...envelopeObject, contentHash: envelopeHashOf(PILOT_ENVELOPE_QUADRATIC) });
    expect(certificationStateOf(envelopeObject, approvalOfTheOldEnvelope, [qualification()])).toMatchObject({ certified: false, reason: 'OBJECT_CHANGED_SINCE_REVIEW' });
  });
  it('a difficulty edited on a stored lineage is detected; a band the envelope does not cover has no difficulty at all', () => {
    const i = supply[0];
    expect(certifiedLineageIntact(i.certifiedLineage)).toBe(true);
    expect(certifiedLineageIntact({ ...i.certifiedLineage, itemDifficulty: i.itemDifficulty + 1 })).toBe(false);
    expect(itemDifficultyOf({ bands: PILOT_ENVELOPE_QUADRATIC.bands.slice(0, 2) }, 'CHALLENGE')).toBeNull();
    expect(certifiedInstanceLineageOf(RendererEnvelopeSchema.parse({ ...PILOT_ENVELOPE_QUADRATIC, bands: PILOT_ENVELOPE_QUADRATIC.bands.slice(0, 2) }), i.rendered, 'CHALLENGE')).toMatchObject({ ok: false, code: 'BAND_OUTSIDE_THE_ENVELOPE' });
  });
  it('no envelope reaches outside its core\'s own parameter ranges', () => {
    for (const e of PILOT_ENVELOPES) {
      const core = PILOT_CORES.find((c) => c.constructFamilyId === e.constructFamilyId)!;
      expect(rangesOutsideTheCore(e, (core.family.specialization as { parameterRanges: { symbol: string; min: number; max: number }[] }).parameterRanges)).toEqual([]);
    }
    expect(rangesOutsideTheCore({ parameterRanges: [{ symbol: 'a', min: 1, max: 7, step: 1 }] }, [{ symbol: 'a', min: 1, max: 6 }])).toHaveLength(1);
  });
});

describe('Step 4B / certification -- a decision of a qualified person, on the record, of exactly this content', () => {
  it('an APPROVE of this object at this content by a reviewer whose scope covers it certifies', () => {
    expect(certificationStateOf(OBJECT, approve(OBJECT), [qualification()])).toMatchObject({ certified: true });
  });
  it('no record, another object, changed content, a non-approval, an uncovered scope, no qualification: each fails by name', () => {
    const q = [qualification()];
    expect(certificationStateOf(OBJECT, null, q)).toMatchObject({ certified: false, reason: 'NO_CERTIFICATION_RECORD' });
    expect(certificationStateOf(OBJECT, approve(OBJECT, { objectVersion: '0.9.0' }), q)).toMatchObject({ reason: 'RECORD_IS_OF_ANOTHER_OBJECT' });
    expect(certificationStateOf({ ...OBJECT, contentHash: 'f'.repeat(64) }, approve(OBJECT), q)).toMatchObject({ reason: 'OBJECT_CHANGED_SINCE_REVIEW' });
    expect(certificationStateOf(OBJECT, approve(OBJECT, { decision: 'REJECT', notes: 'The reasoning path is wrong.' }), q)).toMatchObject({ reason: 'DECISION_IS_NOT_AN_APPROVAL' });
    expect(certificationStateOf(OBJECT, approve(OBJECT), [])).toMatchObject({ reason: 'REVIEWER_NOT_QUALIFIED' });
    expect(certificationStateOf(OBJECT, approve(OBJECT), [qualification({ scopes: [{ canonicalSubject: 'Mathematics', systemId: 'IB' }] })])).toMatchObject({ reason: 'REVIEWER_SCOPE_DOES_NOT_COVER' });
    expect(certificationStateOf(OBJECT, approve(OBJECT, { scope: { canonicalSubject: 'Mathematics', systemId: 'IB' } }), q)).toMatchObject({ reason: 'SCOPE_IS_NOT_THE_OBJECTS' });
  });
  it('APPROVE_WITH_CHANGES certifies nothing, and a decision other than APPROVE must say why', () => {
    expect(certificationStateOf(OBJECT, approve(OBJECT, { decision: 'APPROVE_WITH_CHANGES', notes: 'Reword the second shortcut constraint.' }), [qualification()])).toMatchObject({ certified: false, reason: 'DECISION_IS_NOT_AN_APPROVAL' });
    expect(certificationStateOf(OBJECT, approve(OBJECT, { decision: 'REJECT', notes: null }), [qualification()])).toMatchObject({ certified: false, reason: 'RECORD_INVALID' });
  });
  it('a qualification granted after the decision, or revoked before it, does not cover it', () => {
    expect(certificationStateOf(OBJECT, approve(OBJECT), [qualification({ grantedAt: '2026-10-13T00:00:00Z' })])).toMatchObject({ reason: 'DECIDED_BEFORE_THE_QUALIFICATION' });
    expect(certificationStateOf(OBJECT, approve(OBJECT), [qualification({ revokedAt: '2026-10-05T00:00:00Z' })])).toMatchObject({ reason: 'QUALIFICATION_REVOKED' });
  });
  it('Matemáticas is not inferred from Mathematics: a Mathematics scope does not certify the proportion core', () => {
    const proportion: CertifiableObject = { objectType: 'CONSTRUCT_CORE', objectId: PILOT_CORE_PROPORTION.constructFamilyId, objectVersion: PILOT_CORE_PROPORTION.familyVersion, contentHash: PILOT_CORE_PROPORTION.contentHash, scope: { canonicalSubject: PILOT_CORE_PROPORTION.canonicalSubject, systemId: 'PAA' } };
    expect(certificationStateOf(proportion, approve(proportion), [qualification()])).toMatchObject({ certified: false, reason: 'REVIEWER_SCOPE_DOES_NOT_COVER' });
    expect(certificationStateOf(proportion, approve(proportion), [qualification({ scopes: [{ canonicalSubject: 'Matemáticas', systemId: 'PAA' }] })])).toMatchObject({ certified: true });
  });
  it('the pilot authority is internal: it is never an external accreditation', () => {
    expect(authorityIsExternalAccreditation('INTERNAL_PILOT_REVIEWER')).toBe(false);
  });
});

describe('Step 4B / Decision 2 -- inherited deterministic certification, without weakening the per-item rule', () => {
  const YES: CertificationState = { certified: true, record: approve(OBJECT) };
  const NO: CertificationState = { certified: false, reason: 'NO_CERTIFICATION_RECORD', detail: '' };
  const facts = (over: Partial<InheritanceFacts> = {}): InheritanceFacts => ({
    core: YES, adapter: YES, rendererEnvelope: YES, blueprintClassification: YES, blueprintClass: 'REDUCED', applicability: { status: 'SUPPORTED', conditionalApproval: null }, strategy: 'PARAMETRIC_DETERMINISTIC', templateEnvelope: null, hasStimulus: false,
    envelopeIssues: [], rendererVersionIsTheCertifiedOne: true, contentIsTheRenderers: true, manuallyEdited: false, rights: { status: 'STUDYUS_OWNED', inForce: true }, lineageComplete: true, lineageIntact: true, itemDifficulty: 3, unsupportedRepresentations: [], ...over,
  });
  it('every condition met -> INHERITED_DETERMINISTIC_CERTIFICATION, with no individual review of the instance', () => {
    expect(instanceCertificationOf(facts(), NO)).toEqual({ certified: true, mode: 'INHERITED_DETERMINISTIC_CERTIFICATION', itemDifficulty: 3 });
  });
  it('each condition of the decision, unmet, refuses inheritance by its own name', () => {
    const cases: [Partial<InheritanceFacts>, string][] = [
      [{ core: NO }, 'CORE_NOT_CERTIFIED'], [{ adapter: NO }, 'ADAPTER_NOT_CERTIFIED'], [{ rendererEnvelope: NO }, 'RENDERER_ENVELOPE_NOT_CERTIFIED'], [{ blueprintClassification: NO }, 'BLUEPRINT_CLASSIFICATION_NOT_CERTIFIED'],
      [{ blueprintClass: 'DEMO' }, 'BLUEPRINT_CLASS_NOT_ELIGIBLE'], [{ blueprintClass: undefined }, 'BLUEPRINT_CLASS_NOT_ELIGIBLE'], [{ applicability: { status: 'NOT_APPLICABLE', conditionalApproval: null } }, 'APPLICABILITY_NOT_SUPPORTED'],
      [{ applicability: { status: null, conditionalApproval: null } }, 'APPLICABILITY_NOT_SUPPORTED'], [{ applicability: { status: 'CONDITIONAL', conditionalApproval: null } }, 'CONDITIONAL_APPLICABILITY_NOT_APPROVED'],
      [{ envelopeIssues: [{ code: 'PARAMETER_OUTSIDE_THE_ENVELOPE', detail: 'a = 7' }] }, 'OUTSIDE_THE_CERTIFIED_ENVELOPE'], [{ rendererVersionIsTheCertifiedOne: false }, 'RENDERER_VERSION_CHANGED'],
      [{ contentIsTheRenderers: false }, 'KEY_OR_RUBRIC_NOT_FROM_THE_RENDERER'], [{ manuallyEdited: true }, 'MANUALLY_EDITED'], [{ rights: { status: null, inForce: false } }, 'RIGHTS_NOT_VALID'],
      [{ rights: { status: 'PUBLICLY_ACCESSIBLE', inForce: true } }, 'RIGHTS_NOT_VALID'], [{ lineageComplete: false }, 'LINEAGE_INCOMPLETE'], [{ lineageIntact: false }, 'LINEAGE_ALTERED'], [{ itemDifficulty: null }, 'DIFFICULTY_NOT_RECORDED'],
      [{ itemDifficulty: 6 }, 'DIFFICULTY_NOT_RECORDED'], [{ unsupportedRepresentations: ['GRAPH'] }, 'UNSUPPORTED_REPRESENTATION'], [{ hasStimulus: true }, 'STIMULUS_OR_TEMPLATE_CONTENT_NEEDS_ITS_OWN_ENVELOPE'],
      [{ strategy: 'CERTIFIED_TEMPLATE_COMPOSITION' }, 'STIMULUS_OR_TEMPLATE_CONTENT_NEEDS_ITS_OWN_ENVELOPE'],
    ];
    for (const [over, refusal] of cases) expect(inheritanceRefusals(facts(over)), refusal).toContain(refusal);
  });
  it('a CONDITIONAL applicability inherits once its conditions are approved; composed content inherits inside its own template envelope', () => {
    expect(inheritanceRefusals(facts({ applicability: { status: 'CONDITIONAL', conditionalApproval: YES } }))).toEqual([]);
    expect(inheritanceRefusals(facts({ strategy: 'CERTIFIED_TEMPLATE_COMPOSITION', hasStimulus: true, templateEnvelope: YES }))).toEqual([]);
  });
  it('an individual review stands in for the envelope, and for nothing else', () => {
    for (const r of REPLACEABLE_BY_INDIVIDUAL_REVIEW) expect(['RENDERER_ENVELOPE_NOT_CERTIFIED', 'OUTSIDE_THE_CERTIFIED_ENVELOPE', 'RENDERER_VERSION_CHANGED', 'STIMULUS_OR_TEMPLATE_CONTENT_NEEDS_ITS_OWN_ENVELOPE', 'RENDERER_NOT_DETERMINISTIC', 'KEY_OR_RUBRIC_NOT_FROM_THE_RENDERER', 'MANUALLY_EDITED']).toContain(r);
    const outside = facts({ envelopeIssues: [{ code: 'PARAMETER_OUTSIDE_THE_ENVELOPE', detail: 'a = 7' }] });
    expect(instanceCertificationOf(outside, YES)).toMatchObject({ certified: true, mode: 'INDIVIDUAL_ITEM_REVIEW' });
    expect(instanceCertificationOf(facts({ manuallyEdited: true, contentIsTheRenderers: false }), YES)).toMatchObject({ certified: true, mode: 'INDIVIDUAL_ITEM_REVIEW' });
    // a review of one item never lifts a condition of delivery
    for (const over of [{ core: NO }, { adapter: NO }, { blueprintClass: 'DEMO' }, { rights: { status: null, inForce: false } }, { itemDifficulty: null }, { unsupportedRepresentations: ['FIGURE'] }, { lineageComplete: false }] as Partial<InheritanceFacts>[]) {
      expect(instanceCertificationOf(facts(over), YES)).toMatchObject({ certified: false, individualReview: 'CONDITION_AN_INDIVIDUAL_REVIEW_CANNOT_REPLACE' });
    }
  });
  it('fail closed: neither mode valid -> not certified, with both reasons', () => {
    expect(instanceCertificationOf(facts({ rendererEnvelope: NO }), NO)).toEqual({ certified: false, mode: null, inheritance: ['RENDERER_ENVELOPE_NOT_CERTIFIED'], individualReview: 'NO_CERTIFICATION_RECORD' });
  });
  it('the V5.1 supply policy is untouched: a legacy item, a fixture and an item with no rights are still refused', () => {
    const none = { core: () => null, adapter: () => null, applicability: () => null, renderer: () => null, bucketGoverned: () => false };
    expect(studentSupplyDecision({ itemId: 'x', lineage: null, origin: 'LEGACY_GENERATED', reviewed: true, rightsCleared: true }, none)).toMatchObject({ eligible: false, reasons: ['LEGACY_NO_CORE_LINEAGE'] });
    expect(studentSupplyDecision({ itemId: 'x', lineage: null, origin: 'FIXTURE', reviewed: true, rightsCleared: false }, none)).toMatchObject({ eligible: false });
  });
});

describe('Step 4B / renderer 2 -- proportion, missing value: parametric, deterministic, inside the family', () => {
  const ranges = (PILOT_CORE_PROPORTION.family.specialization as { parameterRanges: { symbol: string; min: number; max: number; step: number | null }[] }).parameterRanges;
  const params = (i: (typeof supply)[number]) => i.rendered.parameterSet as unknown as ProportionParameters;
  const render = (band: (typeof BANDS)[number], seed: string) => { const r = renderPilotInstance(PILOT_CORE_PROPORTION, PILOT_TARGET_PAA, band, seed, 'STUDENT_SUPPLY_CANDIDATE'); if (!r.ok) throw new Error(`${r.code} ${r.detail}`); return r.instance; };
  it('it is PROVISIONAL, parametric, imports no model client and reads no clock, environment or random source', () => {
    expect(PROPORTION_MISSING_VALUE_STRATEGY).toMatchObject({ kind: 'PARAMETRIC_DETERMINISTIC', status: 'PROVISIONAL', construct: 'DIRECT_PROPORTION_MISSING_VALUE' });
    const src = read('src/lib/assessment-instance/strategy-proportion-missing-value.ts');
    expect(src).not.toMatch(/openai|anthropic|ai-gateway|fetch\(|process\.env|Date\.now|new Date|Math\.random/);
  });
  it('the same seed gives the same instance; different seeds give different situations', () => {
    expect(render('STANDARD', 's-1').rendered).toEqual(render('STANDARD', 's-1').rendered);
    expect(new Set(Array.from({ length: 30 }, (_, n) => render('STANDARD', `s-${n}`).prompt)).size).toBeGreaterThan(20);
  });
  it('200 seeds per band: the relationship holds, the family\'s rules hold, the band\'s lever settings hold, the key is exact', () => {
    for (const band of BANDS) for (let n = 0; n < 200; n += 1) {
      const i = render(band, `validity-${n}`);
      const p = params(i);
      expect(p.x * p.a).toBeCloseTo(p.b * p.c, 6);
      expect(proportionParameterIssues(p, ranges)).toEqual([]);
      expect(proportionBandIssues(band, p)).toEqual([]);
      expect(Number(i.answers[0])).toBe(p.x);
      expect(i.envelopeIssues).toEqual([]);
      expect(i.rendered.learner).toMatchObject({ itemType: 'NUMERIC_ENTRY', language: 'es', stimulus: null, options: [] });
    }
  });
  it('the key is never the answer of a modelled misconception, and no unit rate is given away', () => {
    for (const band of BANDS) for (let n = 0; n < 200; n += 1) {
      const p = params(render(band, `misconception-${n}`));
      for (const m of proportionMisconceptionAnswers(p)) expect(m.value, m.id).not.toBe(p.x);
      expect(p.a).toBeGreaterThanOrEqual(2);
    }
    expect(proportionParameterIssues({ a: 4, b: 4, c: 8, x: 8, situation: 'COST', statedC: 8 }, ranges)).toContain('ANSWER_COINCIDES_WITH_A_MISCONCEPTION');
  });
  it('the bands are what the envelope says: whole multiple / simple fraction after a conversion / non-simple factor and a decimal', () => {
    for (let n = 0; n < 60; n += 1) {
      const f = params(render('FOUNDATIONAL', `band-${n}`)); const s = params(render('STANDARD', `band-${n}`)); const c = params(render('CHALLENGE', `band-${n}`));
      expect(scaleFactorOf(f.a, f.c).q).toBe(1); expect(f.statedC).toBe(f.c);
      expect(scaleFactorOf(s.a, s.c).q).toBeGreaterThanOrEqual(PROPORTION_BAND_LIMITS.STANDARD.denominatorMin); expect(scaleFactorOf(s.a, s.c).q).toBeLessThanOrEqual(PROPORTION_BAND_LIMITS.STANDARD.denominatorMax);
      expect(s.statedC).not.toBe(s.c); expect(Number.isInteger(s.x)).toBe(true);
      expect(scaleFactorOf(c.a, c.c).q).toBeGreaterThanOrEqual(PROPORTION_BAND_LIMITS.CHALLENGE.denominatorMin); expect(Number.isInteger(c.x)).toBe(false);
    }
  });
  it('a parameter set of another band is not accepted as this band\'s', () => {
    const f = params(render('FOUNDATIONAL', 'band-0'));
    expect(proportionBandIssues('STANDARD', f).length).toBeGreaterThan(0);
    expect(proportionBandIssues('CHALLENGE', f).length).toBeGreaterThan(0);
  });
  it('it refuses a format outside its envelope and has capacity far beyond the pilot in every band', () => {
    expect(renderPilotInstance(PILOT_CORE_PROPORTION, { ...PILOT_TARGET_PAA, responseFormat: 'SELECTED_RESPONSE' }, 'STANDARD', 's', 'STUDENT_SUPPLY_CANDIDATE')).toMatchObject({ ok: false });
    for (const band of BANDS) expect(proportionInstanceCapacity(band, ranges)).toBeGreaterThan(1000);
  });
  it('the envelope says in words what it leaves out: one proportion per instance, no selected response', () => {
    expect(PILOT_ENVELOPE_PROPORTION.exclusions.join(' ')).toMatch(/One proportion per instance/);
    expect(PILOT_ENVELOPE_PROPORTION.responseFormats).toEqual(['NUMERIC_ENTRY']);
  });
});

describe('Step 4B / renderer 1 -- quadratics, method-neutral: the envelope of its strategy', () => {
  it('the strategy is its own renderer version, PROVISIONAL, and calls no model', () => {
    expect(QUADRATIC_SOLVE_STRATEGY).toMatchObject({ kind: 'PARAMETRIC_DETERMINISTIC', status: 'PROVISIONAL', construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS', rendererVersion: PILOT_ENVELOPE_QUADRATIC.rendererVersion });
    expect(PILOT_ENVELOPE_QUADRATIC.rendererVersion).toBe('parametric.quadratic-solve@1.0.0');
    expect(read('src/lib/assessment-instance/strategy-quadratic-solve.ts')).not.toMatch(/openai|anthropic|ai-gateway|fetch\(|process\.env|Date\.now|new Date|Math\.random/);
  });
  it('200 seeds per band under each adapter are inside the envelope and carry their band\'s lever settings', () => {
    for (const target of [PILOT_TARGET_PAA, PILOT_TARGET_IB]) for (const band of BANDS) for (let n = 0; n < 200; n += 1) {
      const r = renderPilotInstance(PILOT_CORE_QUADRATIC, target, band, `q-${n}`, 'STUDENT_SUPPLY_CANDIDATE');
      if (!r.ok) throw new Error(`${r.code} ${r.detail}`);
      expect(r.instance.envelopeIssues).toEqual([]);
      expect(quadraticBandIssues(band, r.instance.rendered.parameterSet)).toEqual([]);
    }
  });
  it('an instance is outside the envelope when its parameters, band, adapter, language or format are not the certified ones', () => {
    const i = supply.find((x) => x.coreId === PILOT_CORE_QUADRATIC.constructFamilyId && x.planningBand === 'STANDARD')!;
    const ctx: { adapterId: string; language: string; responseFormat: string; planningBand: string; commandTerm: string | null } = { adapterId: PILOT_PAA, language: 'es', responseFormat: 'NUMERIC_ENTRY', planningBand: 'STANDARD', commandTerm: null };
    const codes = (instance: typeof i.rendered, c = ctx) => instanceEnvelopeIssues(PILOT_ENVELOPE_QUADRATIC, instance, c, quadraticBandIssues).map((x) => x.code);
    expect(codes(i.rendered)).toEqual([]);
    expect(codes({ ...i.rendered, parameterSet: { ...i.rendered.parameterSet, a: 3 } })).toContain('PARAMETER_OUTSIDE_THE_ENVELOPE');
    expect(codes({ ...i.rendered, parameterSet: { ...i.rendered.parameterSet, r1: 10 } })).toContain('PARAMETER_OUTSIDE_THE_ENVELOPE');
    expect(codes(i.rendered, { ...ctx, planningBand: 'CHALLENGE' })).toContain('PARAMETER_SET_IS_NOT_OF_ITS_BAND');
    expect(codes(i.rendered, { ...ctx, adapterId: 'CAMBRIDGE.9709.P1' })).toContain('ADAPTER_OUTSIDE_THE_ENVELOPE');
    expect(codes(i.rendered, { ...ctx, language: 'fr' })).toContain('LANGUAGE_OUTSIDE_THE_ENVELOPE');
    expect(codes(i.rendered, { ...ctx, responseFormat: 'SELECTED_RESPONSE' })).toContain('FORMAT_OUTSIDE_THE_ENVELOPE');
    expect(codes({ ...i.rendered, lineage: { ...i.rendered.lineage, rendererVersion: 'parametric.quadratic-solve@1.0.1' } })).toContain('RENDERER_VERSION_IS_NOT_THE_ENVELOPES');
    expect(codes({ ...i.rendered, learner: { ...i.rendered.learner, stimulus: 'A graph of the parabola.' } })).toContain('REPRESENTATION_OUTSIDE_THE_ENVELOPE');
  });
});

describe('Step 4B / pilot instances -- 18 deterministic supply candidates, none Student-eligible', () => {
  it('2 concepts x 3 bands x 3 instances under PAA, plus the 9 quadratic seeds again under IB', () => {
    expect(pilot.refusals).toEqual([]);
    expect(supply).toHaveLength(18);
    expect(crossModel).toHaveLength(9);
    for (const core of PILOT_CORES) for (const band of ['LOW', 'MEDIUM', 'HIGH']) expect(supply.filter((i) => i.coreId === core.constructFamilyId && i.difficultyBand === band), `${core.constructFamilyId} ${band}`).toHaveLength(3);
    expect(new Set(pilot.instances.map((i) => i.instanceId)).size).toBe(27);
    expect(new Set(supply.map((i) => i.certifiedLineage.lineage.parameterSetId)).size).toBe(18);
  });
  it('preparing them twice gives the same instances, byte for byte', () => {
    expect(JSON.stringify(preparePilotInstances().instances)).toBe(JSON.stringify(pilot.instances));
  });
  it('NOT ONE is certified or Student-eligible: no certification record exists for anything they depend on', () => {
    for (const i of pilot.instances) {
      expect(i.studentEligible).toBe(false);
      expect(i.certification).toMatchObject({ certified: false, mode: null, individualReview: 'NO_CERTIFICATION_RECORD' });
      const blockers = i.certification.certified ? [] : i.certification.inheritance;
      for (const b of ['CORE_NOT_CERTIFIED', 'ADAPTER_NOT_CERTIFIED', 'RENDERER_ENVELOPE_NOT_CERTIFIED', 'BLUEPRINT_CLASSIFICATION_NOT_CERTIFIED']) expect(blockers).toContain(b);
      // what is NOT blocking: the instance itself is complete -- inside its envelope, with lineage, difficulty and rights
      for (const b of ['OUTSIDE_THE_CERTIFIED_ENVELOPE', 'LINEAGE_INCOMPLETE', 'DIFFICULTY_NOT_RECORDED', 'RIGHTS_NOT_VALID', 'UNSUPPORTED_REPRESENTATION', 'BLUEPRINT_CLASS_NOT_ELIGIBLE']) expect(blockers).not.toContain(b);
      expect(i.certifiedLineage.lineage.certificationVersion).toBe('UNCERTIFIED-DEV-TEST');
    }
  });
  it('every instance carries complete V5.1 lineage to a registered system version, a governed bucket and its envelope', () => {
    for (const i of pilot.instances) {
      expect(lineageClassOf(i.certifiedLineage.lineage)).toBe('CORE_DERIVED');
      expect(i.certifiedLineage.lineage).toMatchObject({ constructFamilyId: i.coreId, constructFamilyVersion: PILOT_CORES.find((c) => c.constructFamilyId === i.coreId)!.familyVersion, primaryConceptId: i.conceptId, assessmentAdapterId: i.adapterId, blueprintBucketId: i.blueprintBucketId, seed: i.seed });
      expect(STUDYUS_ASSESSMENT_REGISTRY.version(i.systemId, i.certifiedLineage.lineage.assessmentSystemVersionId)?.lifecycle).toBe('ACTIVE');
      expect(i.certifiedLineage.envelopeHash).toBe(envelopeHashOf(PILOT_ENVELOPES.find((e) => e.constructFamilyId === i.coreId)!));
      expect(i.envelopeIssues).toEqual([]);
      expect(i.rendered.learner.stimulus).toBeNull();
    }
  });
  it('cross-model reuse is real: one seed is one piece of mathematics, asked the PAA way and the IB way', () => {
    for (const ib of crossModel) {
      const paa = supply.find((i) => i.seed === ib.seed)!;
      expect(ib.certifiedLineage.lineage.parameterSetId).toBe(paa.certifiedLineage.lineage.parameterSetId);
      expect(ib.coreId).toBe(paa.coreId);
      expect(ib.itemDifficulty).toBe(paa.itemDifficulty);
      expect([paa.systemId, ib.systemId]).toEqual(['PAA', 'IB']);
      expect(paa.rendered.learner).toMatchObject({ language: 'es', itemType: 'NUMERIC_ENTRY', marks: 1 });
      expect(ib.rendered.learner).toMatchObject({ language: 'en', itemType: 'SHORT_RESPONSE' });
      expect(ib.rendered.rubric.some((r) => r.kind === 'METHOD')).toBe(true);
      expect(ib.answers).toContain(paa.answers[0]);
    }
  });
  it('with a test reviewer holding the three scopes who approves every object, the same instances WOULD inherit; without the Matemáticas scope, proportion would not', () => {
    const objects = pilotDecisionObjects();
    const records = objects.map((o) => approve(o));
    const all = preparePilotInstances(records, [qualification({ scopes: [...PILOT_REVIEWER_SCOPES] })]).instances;
    expect(all.every((i) => i.certification.certified && i.certification.mode === 'INHERITED_DETERMINISTIC_CERTIFICATION')).toBe(true);
    const mathematicsOnly = preparePilotInstances(records, [qualification()]).instances;
    expect(mathematicsOnly.filter((i) => i.coreId === PILOT_CORE_QUADRATIC.constructFamilyId).every((i) => i.certification.certified)).toBe(true);
    expect(mathematicsOnly.filter((i) => i.coreId === PILOT_CORE_PROPORTION.constructFamilyId).every((i) => !i.certification.certified)).toBe(true);
    // one approval withdrawn -> the instances that depend on it stop inheriting
    const withoutEnvelope = preparePilotInstances(records.filter((r) => !(r.objectType === 'RENDERER_ENVELOPE' && r.objectId === PILOT_ENVELOPE_QUADRATIC.rendererVersion)), [qualification({ scopes: [...PILOT_REVIEWER_SCOPES] })]).instances;
    expect(withoutEnvelope.filter((i) => i.coreId === PILOT_CORE_QUADRATIC.constructFamilyId).every((i) => !i.certification.certified)).toBe(true);
    expect(withoutEnvelope.filter((i) => i.coreId === PILOT_CORE_PROPORTION.constructFamilyId).every((i) => i.certification.certified)).toBe(true);
    // approvals of the WITHDRAWN objects certify none of the current ones
    const staleRecords = records.map((r) => (r.objectType === 'CONSTRUCT_CORE' ? { ...r, evidenceHash: 'a'.repeat(64) } : r));
    expect(preparePilotInstances(staleRecords, [qualification({ scopes: [...PILOT_REVIEWER_SCOPES] })]).instances.some((i) => i.certification.certified)).toBe(false);
  });
});

describe('Step 4B / what this step did NOT do', () => {
  it('no real adapter, core or renderer became CERTIFIED', () => {
    for (const a of STUDYUS_ASSESSMENT_REGISTRY.adapters()) expect(a.status).toBe('PROVISIONAL');
    for (const s of [QUADRATIC_FACTORISING_STRATEGY, QUADRATIC_SOLVE_STRATEGY, PROPORTION_MISSING_VALUE_STRATEGY]) expect(s.status).toBe('PROVISIONAL');
    for (const c of PILOT_CORES) expect(c.lifecycle).not.toBe('CERTIFIED');
  });
  it('the persistence proposal (intent 90) is not a migration of this repository, and inserts no row', () => {
    // one proposal for the intent: the Step 4B file was renamed and extended into the V5.2 one
    const name = '20261122_1200_qf52_exam_bank_certification_coverage.sql';
    expect(existsSync(join(ROOT, 'docs/exams/question-factory/step4b/proposed'))).toBe(false);
    expect(readdirSync(join(ROOT, 'docs/exams/question-factory/v52/proposed'))).toEqual([name]);
    // Track B: the only 20261122 migrations are the two of the curriculum line; the proposal is not among them
    expect(readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.startsWith('20261122')).sort()).toEqual(['20261122_1000_learner_concept_curriculum_provenance.sql', '20261122_1100_canonical_concept_reviewed_aliases.sql']);
    const sql = read(`docs/exams/question-factory/v52/proposed/${name}`).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    // the per-item review rule is kept: the replaced guard still raises the same refusal
    expect(sql).toContain('QUESTION_BANK_HUMAN_APPROVAL_REQUIRED');
    expect(sql).toContain("r.decision = 'APPROVED'");
  });
  it('the review packet, the instance set and the decisions file are exactly what the sources produce, and no decision is filled in', () => {
    const out = execFileSync('npx', ['tsx', '--tsconfig', 'tsconfig.json', 'scripts/operations/qf-step4b/build-review-packet.ts', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('STEP4B_ARTEFACTS = CURRENT');
    const rows = read('docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_DECISIONS.csv').trim().split('\n');
    expect(rows).toHaveLength(12);
    for (const r of rows.slice(1)) expect(r.endsWith(',,,,')).toBe(true);
    const packet = read('docs/exams/question-factory/step4b/STEP4B_HUMAN_REVIEW_PACKET.md');
    expect(packet.match(/\[ \] APPROVE   \[ \] APPROVE_WITH_CHANGES   \[ \] REJECT/g)).toHaveLength(11);
    expect(packet).not.toMatch(/\[x\]/i);
    const instances = JSON.parse(read('docs/exams/question-factory/step4b/STEP4B_PILOT_INSTANCES.json')) as { counts: { total: number; studentEligible: number }; instances: { STUDENT_ELIGIBLE: boolean; DIFFICULTY_1_TO_5: number }[] };
    expect(instances.counts).toMatchObject({ total: 27, studentSupplyCandidates: 18, crossModelProof: 9, studentEligible: 0 });
    expect(instances.instances.every((i) => i.STUDENT_ELIGIBLE === false && [2, 3, 4].includes(i.DIFFICULTY_1_TO_5))).toBe(true);
  }, 120_000);
  it('generation stays frozen', () => {
    expect(existsSync(join(ROOT, 'docs/audits/qb_review/GENERATION_FREEZE.json'))).toBe(true);
  });
});

describe('Step 4B / recorded decisions -- the reviewer\'s eleven approvals, offline, bound to what he was shown', () => {
  const file = JSON.parse(read('docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json')) as {
    storage: string; persistedInAnyDatabase: boolean; authority: { reviewerId: string; reviewerName: string; externalAccreditation: boolean }; instruction: { verbatim: string; truncated: boolean };
    qualification: ReviewerQualification; evidence: Record<string, string>; records: { decisionId: string; record: CertificationRecord }[];
  };
  it('eleven records, each an APPROVE by the pilot reviewer with a timestamp, a scope and the evidence hash of the current object', () => {
    const objects = pilotDecisionObjects();
    expect(file.records.map((r) => r.decisionId)).toEqual(Array.from({ length: 11 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`));
    for (const o of objects) {
      const hit = file.records.find((r) => r.record.objectType === o.objectType && r.record.objectId === o.objectId && r.record.scope.systemId === o.scope.systemId)!;
      expect(hit.record).toMatchObject({ reviewerId: 'INTERNAL_PILOT_REVIEWER', authority: 'INTERNAL_PILOT_REVIEWER', decision: 'APPROVE', objectVersion: o.objectVersion, evidenceHash: o.contentHash, scope: o.scope });
      expect(hit.record.decidedAt).toMatch(/^2026-10-13T/);
      expect(certificationStateOf(o, hit.record, [file.qualification])).toMatchObject({ certified: true });
    }
  });
  it('the authority is internal, the three scopes are the ones stated, and the reviewer\'s own words are kept, cut where they were cut', () => {
    expect(file.authority).toMatchObject({ reviewerId: 'INTERNAL_PILOT_REVIEWER', reviewerName: 'John Albornoz', externalAccreditation: false });
    expect(file.qualification.scopes).toEqual([...PILOT_REVIEWER_SCOPES]);
    expect(file.instruction.verbatim.startsWith('Apruebo las 11 decisiones de Step 4B')).toBe(true);
    expect(file.instruction.verbatim.endsWith(', sin')).toBe(true);
    expect(file.instruction.truncated).toBe(true);
  });
  it('they are records in a file: in no database, and they make nothing Student-eligible by themselves', () => {
    expect(file).toMatchObject({ storage: 'OFFLINE_FILE_ONLY', persistedInAnyDatabase: false });
    // the slice as shipped still reads no record: nothing is certified until records are persisted and instances materialised
    expect(pilot.instances.every((i) => !i.studentEligible)).toBe(true);
    // Track B: the only 20261122 migrations are the two of the curriculum line; the proposal is not among them
    expect(readdirSync(join(ROOT, 'database/migrations')).filter((f) => f.startsWith('20261122')).sort()).toEqual(['20261122_1000_learner_concept_curriculum_provenance.sql', '20261122_1100_canonical_concept_reviewed_aliases.sql']);
    for (const c of PILOT_CORES) expect(c.lifecycle).toBe('UNDER_REVIEW');
  });
  it('read with these records, all 27 instances inherit their certification: 6 LOW, 6 MEDIUM, 6 HIGH supply candidates', () => {
    const with_ = preparePilotInstances(file.records.map((r) => r.record), [file.qualification]).instances;
    expect(with_.every((i) => i.certification.certified && i.certification.mode === 'INHERITED_DETERMINISTIC_CERTIFICATION')).toBe(true);
    for (const band of ['LOW', 'MEDIUM', 'HIGH']) expect(with_.filter((i) => i.role === 'STUDENT_SUPPLY_CANDIDATE' && i.difficultyBand === band)).toHaveLength(6);
    expect(with_.map((i) => i.itemDifficulty).every((d) => [2, 3, 4].includes(d))).toBe(true);
  });
  it('an object changed after the approval is no longer covered by it', () => {
    const core = file.records.find((r) => r.record.objectType === 'CONSTRUCT_CORE')!.record;
    const changed: CertifiableObject = { objectType: 'CONSTRUCT_CORE', objectId: core.objectId, objectVersion: core.objectVersion, contentHash: 'e'.repeat(64), scope: core.scope };
    expect(certificationStateOf(changed, core, [file.qualification])).toMatchObject({ certified: false, reason: 'OBJECT_CHANGED_SINCE_REVIEW' });
  });
});
