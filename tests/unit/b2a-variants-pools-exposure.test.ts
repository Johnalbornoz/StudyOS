/**
 * B2-A -- blueprint variants, authority tags, protected pools, hard item exposure, frozen forms and the
 * selection-unit contract. Everything here runs on in-memory fixtures: no real PAA form or item exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { coverageOfLearningCacheItem, coverageOfReviewedBankItem, type QuestionCoverage, type ReviewedBankItemRow } from '@/lib/assessment-foundation/question-coverage';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import type { FormFidelity } from '@/lib/exam-core/form-fidelity';
import {
  ANSWER_REVEAL_EXPOSURE, ATTEMPT_TYPE_OF_PURPOSE, FIXED_FORM_SUBJECT, BLUEPRINT_PURPOSES, LOGICAL_POOLS, PILOT_EXPOSURE_POLICY, PILOT_POOL_POLICY, PROTECTED_POOLS, Q1_DIAGNOSTIC_FULL_SEMANTICS, STIMULUS_GROUP_RUNTIME_SELECTION,
  assignmentViolations, blueprintKey, blueprintSetViolations, diagnosticTargetPlan, evaluateProtectedFeasibility, exposurePolicyViolations, exposureVerdict, freezeForm, frozenFormEligibility, frozenFormIntact,
  groupExposure, itemUnit, poolAssignmentViolations, poolForBlueprint, poolVerdict, publishedVariants, purposeFidelityViolations, requirementsByAuthority, sectionItemCounts, selectableItemRange,
  selectionUnitViolations, sharedItems, solveBlueprint, solveProtectedForm, specificationViolations, unservableUnitRequirements,
  type AuthorityTaggedRequirement, type BlueprintIdentity, type BlueprintSpecification, type LogicalPool, type PoolAssignments, type SelectionUnit,
} from '@/lib/assessment-blueprint';
import { eligibleSolverCandidates } from '@/lib/assessment-blueprint/pipeline';
import { loadReviewedBankExposure } from '@/lib/assessment-blueprint/assessment-blueprint.service';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'src/lib/assessment-blueprint/protected');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EV = 'ev-1';
function bank(id: string, objective: string, over: Partial<ReviewedBankItemRow> = {}): QuestionCoverage {
  return coverageOfReviewedBankItem({
    approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 1, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'GENERATED', sourceIds: null,
    bankItem: { provenance: 'STUDYUS_GENERATED', examVersionId: EV, assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' },
    sourceLicenses: [], itemRights: { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true }, humanReviewDecisions: 1, scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: [{ canonicalConceptId: `c-of-${objective}`, relationType: 'FULL' }], ...over,
  });
}
const cached = (id: string, concept: string): QuestionCoverage =>
  coverageOfLearningCacheItem({ candidateId: id, studentId: 'stu-1', learnerConceptId: `lc-${concept}`, activityType: 'PRACTICE', questionType: 'multiple_choice', difficulty: 3, language: 'es', validationStatus: 'VALIDATED', identity: { status: 'CANONICAL', learnerConceptId: `lc-${concept}`, canonicalConceptId: concept, basis: 'CREATED_FROM_CANONICAL' } } as Parameters<typeof coverageOfLearningCacheItem>[0]);
const K = (id: string) => `REVIEWED_EXAM_BANK:${id}`;
const position = (index: number, objective: string): FormPosition => ({ index, blueprintObjectiveTargetId: `t-${index}`, assessmentComponentId: 'comp-1', learningObjectiveId: objective, questionType: 'multiple_choice', difficultyRange: { min: 2, max: 4 } });
const POSITIONS = [position(0, 'lo-1'), position(1, 'lo-1'), position(2, 'lo-2')];
const id = (purpose: BlueprintIdentity['purpose'], form = 1, over: Partial<BlueprintIdentity> = {}): BlueprintIdentity => ({ examVersionId: EV, purpose, form, revision: 1, status: 'PUBLISHED', ...over });
const FULL: FormFidelity = { fidelity: 'FULL', reasons: [] };
const REDUCED: FormFidelity = { fidelity: 'REDUCED', reasons: ['BELOW_OFFICIAL_ITEM_COUNT'] };
const UNKNOWN: FormFidelity = { fidelity: 'UNKNOWN', reasons: ['FORM_NOT_FROZEN'] };

/** Three items per pool for lo-1 / lo-2: enough for one disjoint form in each protected pool. */
const POOLED: Array<[string, string, LogicalPool]> = [];
for (const pool of ['PRACTICE', 'FULL_MOCK_1', 'FULL_MOCK_2', 'REDUCED_MOCK'] as LogicalPool[]) for (const [n, lo] of [['a', 'lo-1'], ['b', 'lo-1'], ['c', 'lo-2']] as const) POOLED.push([`${pool.toLowerCase()}-${n}`, lo, pool]);
const BANK = POOLED.map(([i, lo]) => bank(i, lo));
const ASSIGN: PoolAssignments = new Map(POOLED.map(([i, , pool]) => [K(i), [pool]]));
const policyFor = (studentId: string = FIXED_FORM_SUBJECT) => ({ studentId, examTargetId: null, examVersionId: EV, blueprintId: null, positions: POSITIONS });
const base = (identity: BlueprintIdentity, fidelity: FormFidelity | null = FULL) => ({ identity, policy: policyFor(), coverages: BANK, poolAssignments: ASSIGN, fidelity, difficultyBandMet: true as boolean | null });

describe('B2-A blueprint purpose and identity', () => {
  it('purpose is first-class and distinct from fidelity and from the stored attempt type', () => {
    expect([...BLUEPRINT_PURPOSES]).toEqual(['FULL', 'REDUCED', 'DIAGNOSTIC']);
    expect(ATTEMPT_TYPE_OF_PURPOSE).toEqual({ FULL: 'FULL_MOCK', REDUCED: 'REDUCED_MOCK', DIAGNOSTIC: null });
    expect(blueprintKey(id('FULL', 2, { revision: 3 }))).toBe('ev-1:FULL:F2:R3');
  });

  it('G / H. one exam version holds Full form 1, Full form 2, Reduced and Diagnostic at once', () => {
    const set = [id('FULL', 1), id('FULL', 2), id('REDUCED', 1), id('DIAGNOSTIC', 1), id('FULL', 1, { revision: 2, status: 'DRAFT' }), id('FULL', 1, { examVersionId: 'ev-2' })];
    expect(blueprintSetViolations(set)).toEqual([]);
    expect(publishedVariants(set, EV).map(blueprintKey)).toEqual(['ev-1:DIAGNOSTIC:F1:R1', 'ev-1:FULL:F1:R1', 'ev-1:FULL:F2:R1', 'ev-1:REDUCED:F1:R1']);
    expect(publishedVariants(set, EV, 'FULL')).toHaveLength(2);
    expect(publishedVariants(set, EV, 'DIAGNOSTIC')).toHaveLength(1);
    expect(new Set(publishedVariants(set, EV).map(blueprintKey)).size).toBe(4);
  });

  it('refuses duplicate identities, malformed ones and two published revisions of one variant', () => {
    expect(blueprintSetViolations([id('FULL', 1), id('FULL', 1)]).map((v) => v.code)).toEqual(['DUPLICATE_IDENTITY', 'SEVERAL_PUBLISHED_REVISIONS']);
    expect(blueprintSetViolations([id('FULL', 1), id('FULL', 1, { revision: 2 })]).map((v) => v.code)).toEqual(['SEVERAL_PUBLISHED_REVISIONS']);
    expect(blueprintSetViolations([id('FULL', 0)]).map((v) => v.code)).toEqual(['INVALID_IDENTITY']);
  });

  it('F. purpose and fidelity cannot contradict each other', () => {
    expect(purposeFidelityViolations('FULL', FULL, { startable: true, type: 'FULL_MOCK' })).toEqual([]);
    expect(purposeFidelityViolations('REDUCED', REDUCED, { startable: true, type: 'REDUCED_MOCK' })).toEqual([]);
    // purpose FULL + verified reduced fidelity
    expect(purposeFidelityViolations('FULL', REDUCED, { startable: true, type: 'REDUCED_MOCK' })).toEqual(['FULL_PURPOSE_REQUIRES_FULL_FIDELITY', 'ATTEMPT_TYPE_CONTRADICTS_PURPOSE']);
    // purpose REDUCED + advertised Full execution
    expect(purposeFidelityViolations('REDUCED', FULL, { startable: true, type: 'FULL_MOCK' })).toEqual(['REDUCED_PURPOSE_REQUIRES_REDUCED_FIDELITY', 'ATTEMPT_TYPE_CONTRADICTS_PURPOSE']);
    expect(purposeFidelityViolations('REDUCED', REDUCED, { startable: true, type: 'FULL_MOCK' })).toEqual(['ATTEMPT_TYPE_CONTRADICTS_PURPOSE']);
    // unverifiable fidelity blocks a protected mock
    expect(purposeFidelityViolations('FULL', UNKNOWN, { startable: false, reason: 'FIDELITY_UNKNOWN', fidelityReasons: ['FORM_NOT_FROZEN'] })).toEqual(['FIDELITY_NOT_VERIFIED', 'ATTEMPT_NOT_STARTABLE']);
    expect(purposeFidelityViolations('REDUCED', null)).toEqual(['FIDELITY_NOT_VERIFIED']);
    // a full structure outside the official difficulty band is not startable either
    expect(purposeFidelityViolations('FULL', FULL, { startable: false, reason: 'OFFICIAL_DIFFICULTY_NOT_MET', fidelityReasons: [] })).toEqual(['ATTEMPT_NOT_STARTABLE']);
    // a Diagnostic is never a mock
    expect(purposeFidelityViolations('DIAGNOSTIC', null)).toEqual([]);
    expect(purposeFidelityViolations('DIAGNOSTIC', FULL, { startable: true, type: 'FULL_MOCK' })).toEqual(['DIAGNOSTIC_IS_NOT_A_MOCK']);
  });
});

describe('B2-A authority tags (PAA requirement FIXTURES -- not production blueprints)', () => {
  const official = (key: string, kind: AuthorityTaggedRequirement['kind'], subject: string | null, value: AuthorityTaggedRequirement['value']): AuthorityTaggedRequirement => ({ key, kind, subject, value, authority: 'OFFICIAL', sourceRefs: ['cb-paa-practice-test-2018'], policyRef: null });
  const policy = (key: string, kind: AuthorityTaggedRequirement['kind'], subject: string | null, value: AuthorityTaggedRequirement['value']): AuthorityTaggedRequirement => ({ key, kind, subject, value, authority: 'STUDYUS_POLICY', sourceRefs: [], policyRef: { id: 'q1-paa-planning', version: '1' } });
  const ORDER = ['lectura', 'redaccion', 'matematicas', 'ingles'];
  const sections = (counts: number[], tag: typeof official) => ORDER.map((s, i) => tag(`SECTION_ITEM_COUNT:${s}`, 'SECTION_ITEM_COUNT', s, counts[i]));
  const PAA_FULL: BlueprintSpecification = {
    identity: id('FULL', 1),
    requirements: [
      official('TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', null, 175), ...sections([45, 25, 55, 50], official), official('SECTION_ORDER', 'SECTION_ORDER', null, ORDER),
      ...ORDER.map((s, i) => official(`SECTION_SCORED_MINUTES:${s}`, 'SECTION_SCORED_MINUTES', s, [50, 30, 60, 40][i])), official('TOOL_POLICY:matematicas', 'TOOL_POLICY', 'matematicas', 'NO_CALCULATOR'),
      official('RESPONSE_FORMAT:matematicas', 'RESPONSE_FORMAT', 'matematicas', ['MULTIPLE_CHOICE', 'STUDENT_PRODUCED']),
      policy('DIFFICULTY_DISTRIBUTION', 'DIFFICULTY_DISTRIBUTION', null, { FOUNDATIONAL: 30, STANDARD: 50, CHALLENGE: 20 }), policy('DOMAIN_ALLOCATION:lectura', 'DOMAIN_ALLOCATION', 'lectura', { basis: 'REFERENCE_PATTERN' }),
      policy('POOL_POLICY', 'POOL_POLICY', null, 'ZERO_INTENTIONAL_OVERLAP'), policy('EXPOSURE_POLICY', 'EXPOSURE_POLICY', null, 'HARD_EXCLUDE_IF_EXPOSED'),
    ],
  };
  const PAA_REDUCED: BlueprintSpecification = {
    identity: id('REDUCED', 1),
    requirements: [policy('TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', null, 88), ...sections([23, 12, 28, 25], policy), official('SECTION_ORDER', 'SECTION_ORDER', null, ORDER), policy('REDUCED_SIZE', 'REDUCED_SIZE', null, { fractionOfFull: 0.5, items: 88 })],
  };

  it('a Full PAA specification: 175 = 45 + 25 + 55 + 50, official parts sourced, policy parts owned', () => {
    expect(specificationViolations(PAA_FULL)).toEqual([]);
    expect(sectionItemCounts(PAA_FULL)).toEqual([{ section: 'lectura', items: 45, authority: 'OFFICIAL' }, { section: 'redaccion', items: 25, authority: 'OFFICIAL' }, { section: 'matematicas', items: 55, authority: 'OFFICIAL' }, { section: 'ingles', items: 50, authority: 'OFFICIAL' }]);
    expect(requirementsByAuthority(PAA_FULL, 'STUDYUS_POLICY').map((r) => r.kind)).toEqual(['DIFFICULTY_DISTRIBUTION', 'DOMAIN_ALLOCATION', 'POOL_POLICY', 'EXPOSURE_POLICY']);
    expect(requirementsByAuthority(PAA_FULL, 'OFFICIAL').every((r) => r.sourceRefs.length > 0)).toBe(true);
  });

  it('a Reduced PAA specification: 88 = 23 + 12 + 28 + 25, its size is StudyUs policy and must be stated', () => {
    expect(specificationViolations(PAA_REDUCED)).toEqual([]);
    expect(sectionItemCounts(PAA_REDUCED).map((s) => s.items)).toEqual([23, 12, 28, 25]);
    expect(sectionItemCounts(PAA_REDUCED).every((s) => s.authority === 'STUDYUS_POLICY')).toBe(true);
    expect(specificationViolations({ ...PAA_REDUCED, requirements: PAA_REDUCED.requirements.filter((r) => r.kind !== 'REDUCED_SIZE') })).toEqual([{ code: 'REDUCED_WITHOUT_SIZE_POLICY', blueprint: 'ev-1:REDUCED:F1:R1' }]);
    expect(specificationViolations({ ...PAA_FULL, requirements: [...PAA_FULL.requirements, policy('REDUCED_SIZE', 'REDUCED_SIZE', null, 88)] })).toEqual([{ code: 'FULL_WITH_REDUCED_SIZE', blueprint: 'ev-1:FULL:F1:R1' }]);
  });

  it('StudyUs policy is never presented as official; every requirement states its authority and its basis', () => {
    const asOfficial = (kind: AuthorityTaggedRequirement['kind']) => specificationViolations({ identity: id('REDUCED', 1), requirements: [official(kind, kind, null, 1), policy('REDUCED_SIZE2', 'REDUCED_SIZE', null, 1)] }).map((v) => v.code);
    for (const kind of ['REDUCED_SIZE', 'POOL_POLICY', 'EXPOSURE_POLICY', 'DIAGNOSTIC_EVIDENCE_DEPTH'] as const) expect(asOfficial(kind), kind).toContain('POLICY_KIND_TAGGED_OFFICIAL');
    expect(specificationViolations({ identity: id('FULL', 1), requirements: [{ ...official('a', 'SECTION_ORDER', null, []), sourceRefs: [] }] })).toEqual([{ code: 'OFFICIAL_WITHOUT_SOURCE', key: 'a' }]);
    expect(specificationViolations({ identity: id('FULL', 1), requirements: [{ ...policy('a', 'DIFFICULTY_DISTRIBUTION', null, {}), policyRef: null }] })).toEqual([{ code: 'POLICY_WITHOUT_POLICY_REF', key: 'a' }]);
    expect(specificationViolations({ identity: id('FULL', 1), requirements: [{ ...official('a', 'SECTION_ORDER', null, []), authority: undefined as unknown as 'OFFICIAL' }] })).toEqual([{ code: 'AUTHORITY_MISSING', key: 'a' }]);
    expect(specificationViolations({ identity: id('FULL', 1), requirements: [official('TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', null, 175), ...sections([45, 25, 55, 49], official)] })).toEqual([{ code: 'SECTION_COUNTS_DO_NOT_SUM', total: 175, sum: 174 }]);
  });
});

describe('B2-A logical pools', () => {
  it('six pilot pools; a pool is a protection class, and every protected one is hard-excluding', () => {
    expect([...LOGICAL_POOLS]).toEqual(['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']);
    expect([...PROTECTED_POOLS].sort()).toEqual(['DIAGNOSTIC', 'FULL_MOCK_1', 'FULL_MOCK_2', 'REDUCED_MOCK', 'VERIFICATION']);
    expect(PILOT_POOL_POLICY.overlap).toBe('ZERO_INTENTIONAL_OVERLAP');
    expect(PILOT_EXPOSURE_POLICY.rules.PRACTICE).toBe('PREFER_UNSEEN');
    expect(exposurePolicyViolations(PILOT_EXPOSURE_POLICY)).toEqual([]);
    expect(exposurePolicyViolations({ ...PILOT_EXPOSURE_POLICY, rules: { ...PILOT_EXPOSURE_POLICY.rules, FULL_MOCK_2: 'PREFER_UNSEEN' } })).toEqual(['FULL_MOCK_2']);
  });

  it('each variant draws from its own pool; a variant with no configured pool has none', () => {
    expect([poolForBlueprint(id('FULL', 1)), poolForBlueprint(id('FULL', 2)), poolForBlueprint(id('REDUCED', 1)), poolForBlueprint(id('DIAGNOSTIC', 1))]).toEqual(['FULL_MOCK_1', 'FULL_MOCK_2', 'REDUCED_MOCK', 'DIAGNOSTIC']);
    expect([poolForBlueprint(id('FULL', 3)), poolForBlueprint(id('REDUCED', 2))]).toEqual([null, null]);
  });

  it('pilot policy: exactly one pool per item; sharing only when a policy names the pair', () => {
    expect(assignmentViolations('k', ['FULL_MOCK_1'])).toEqual([]);
    expect(assignmentViolations('k', []).map((v) => v.code)).toEqual(['NO_POOL']);
    expect(assignmentViolations('k', ['PRACTICE', 'FULL_MOCK_1']).map((v) => v.code)).toEqual(['OVERLAP_NOT_ALLOWED']);
    expect(assignmentViolations('k', ['PRACTICE', 'PRACTICE']).map((v) => v.code)).toEqual(['DUPLICATE_POOL']);
    const shared = { id: 'x', version: '1', overlap: 'EXPLICIT_SHARED' as const, shared: [['PRACTICE', 'DIAGNOSTIC']] as const };
    expect(assignmentViolations('k', ['PRACTICE', 'DIAGNOSTIC'], shared)).toEqual([]);
    expect(assignmentViolations('k', ['PRACTICE', 'FULL_MOCK_1'], shared).map((v) => v.code)).toEqual(['OVERLAP_NOT_ALLOWED']);
    expect(poolAssignmentViolations(ASSIGN)).toEqual([]);
  });

  it('A / B. a Practice item cannot enter Full Mock 1, and a Full Mock 1 item cannot enter Practice', () => {
    expect(poolVerdict(K('practice-a'), 'FULL_MOCK_1', ASSIGN)).toEqual({ allowed: false, reason: 'POOL_MISMATCH' });
    expect(poolVerdict(K('full_mock_1-a'), 'PRACTICE', ASSIGN)).toEqual({ allowed: false, reason: 'POOL_MISMATCH' });
    expect(poolVerdict(K('full_mock_1-a'), 'FULL_MOCK_1', ASSIGN)).toEqual({ allowed: true });
    expect(poolVerdict(K('unassigned'), 'FULL_MOCK_1', ASSIGN)).toEqual({ allowed: false, reason: 'POOL_UNASSIGNED' });
    expect(poolVerdict('k', 'PRACTICE', new Map([['k', ['PRACTICE', 'FULL_MOCK_1']]]))).toEqual({ allowed: false, reason: 'POOL_ASSIGNMENT_INVALID' });
  });
});

describe('B2-A protected selection: pool isolation, hard exposure, fidelity, frozen forms', () => {
  it('A. Full Mock 1 is filled only from its own pool -- never from Practice or another form', () => {
    const r = solveProtectedForm(base(id('FULL', 1)));
    expect(r).toMatchObject({ status: 'FORM_READY', pool: 'FULL_MOCK_1', causes: [], attempt: { startable: true, type: 'FULL_MOCK' } });
    expect(r.form!.positions.map((p) => p.key).sort()).toEqual([K('full_mock_1-a'), K('full_mock_1-b'), K('full_mock_1-c')]);
    expect(r.gate).toMatchObject({ offered: 12, eligible: 12, usable: 3, poolRejected: { POOL_MISMATCH: 9 } });
    // with its pool emptied, the Practice items that would fit are NOT used
    const noPool = solveProtectedForm({ ...base(id('FULL', 1)), poolAssignments: new Map([...ASSIGN].filter(([, p]) => p[0] !== 'FULL_MOCK_1')) });
    expect(noPool).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['POOL_SHORTAGE'], form: null });
    expect(noPool.solution!.outcome.selected).toEqual([]);
  });

  it('G. two Full forms coexist under one exam version and share no item; Reduced is a third, disjoint form', () => {
    const f1 = solveProtectedForm(base(id('FULL', 1))).form!;
    const f2 = solveProtectedForm(base(id('FULL', 2))).form!;
    const red = solveProtectedForm(base(id('REDUCED', 1), REDUCED)).form!;
    expect([f1.pool, f2.pool, red.pool]).toEqual(['FULL_MOCK_1', 'FULL_MOCK_2', 'REDUCED_MOCK']);
    expect([f1.identity.examVersionId, f2.identity.examVersionId, red.identity.examVersionId]).toEqual([EV, EV, EV]);
    expect(sharedItems(f1, f2)).toEqual([]);
    expect(sharedItems(f1, red)).toEqual([]);
    expect(sharedItems(f2, red)).toEqual([]);
    expect([f1.attemptType, f2.attemptType, red.attemptType]).toEqual(['FULL_MOCK', 'FULL_MOCK', 'REDUCED_MOCK']);
    expect(new Set([f1.formHash, f2.formHash, red.formHash]).size).toBe(3);
  });

  it('C / D. an item the Student was exposed to is hard-excluded from Full Mock 2; unseen items stay eligible', () => {
    const exposure = new Map([[K('full_mock_2-a'), { seen: true, recent: false }]]);
    const extra = [...BANK, bank('full_mock_2-d', 'lo-1')];
    const assign = new Map([...ASSIGN, [K('full_mock_2-d'), ['FULL_MOCK_2'] as LogicalPool[]]]);
    const r = solveProtectedForm({ ...base(id('FULL', 2)), policy: policyFor('stu-1'), coverages: extra, poolAssignments: assign, exposure });
    expect(r.status).toBe('FORM_READY');
    expect(r.gate.exposureRejected).toEqual({ EXPOSED_TO_STUDENT: 1 });
    const keys = r.form!.positions.map((p) => p.key);
    expect(keys).not.toContain(K('full_mock_2-a'));
    expect(keys.sort()).toEqual([K('full_mock_2-b'), K('full_mock_2-c'), K('full_mock_2-d')]);
    // no spare unseen item: the exposed one is NOT reused -- the shortage is named
    const short = solveProtectedForm({ ...base(id('FULL', 2)), policy: policyFor('stu-1'), exposure });
    expect(short).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['EXPOSURE_SHORTAGE'], form: null });
    expect(short.solution!.outcome.selected).toEqual([]);
    // the same exposure does not exclude under Practice's softer rule
    expect(exposureVerdict({ seen: true, recent: true }, PILOT_EXPOSURE_POLICY.rules.PRACTICE)).toEqual({ allowed: true });
    expect(exposureVerdict({ seen: true, recent: false }, 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ allowed: false, reason: 'EXPOSED_TO_STUDENT' });
    expect(exposureVerdict({ seen: false, recent: false }, 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ allowed: true });
    expect(exposureVerdict(undefined, 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ allowed: true });
  });

  it('answer-reveal exposure is an interface fact no source fills yet (DEFERRED), honoured when present', () => {
    expect(ANSWER_REVEAL_EXPOSURE).toBe('DEFERRED');
    expect(exposureVerdict({ seen: false, recent: false, answerRevealed: true }, 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ allowed: false, reason: 'ANSWER_REVEALED_TO_STUDENT' });
    expect(exposureVerdict({ seen: false, recent: false, answerRevealed: null }, 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ allowed: true });
  });

  it('E. a protected form never falls back to generated, cached, fixture or unreviewed content', () => {
    const thin = [bank('full_mock_1-a', 'lo-1'), bank('full_mock_1-c', 'lo-2'), cached('gen-1', 'c-of-lo-1'), bank('fixture-1', 'lo-1', { contentOrigin: 'FIXTURE' }), bank('pilot-1', 'lo-1', { bankLifecycleStatus: 'PILOT' })];
    const assign: PoolAssignments = new Map([...ASSIGN, ['LEARNING_ITEM_CACHE:gen-1', ['FULL_MOCK_1']], [K('fixture-1'), ['FULL_MOCK_1']], [K('pilot-1'), ['FULL_MOCK_1']]]);
    const r = solveProtectedForm({ ...base(id('FULL', 1)), coverages: thin, poolAssignments: assign });
    expect(r).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['INSUFFICIENT_ELIGIBLE_ITEMS'], form: null });
    expect(r.gate.eligible).toBe(2);
    expect(Object.values(r.gate.ineligible).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3);
    expect(r.solution!.outcome.selected).toEqual([]);
    expect(r.solution!.outcome.unmet.map((u) => u.cause)).toEqual(['NO_ITEM_FOR_SLOT']);
  });

  it('F. Full and Reduced cannot be confused: a contradiction yields no form, whatever was selected', () => {
    // a Full blueprint whose form is verifiably reduced
    expect(solveProtectedForm(base(id('FULL', 1), REDUCED))).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['FIDELITY_MISMATCH'], form: null, fidelityViolations: ['FULL_PURPOSE_REQUIRES_FULL_FIDELITY', 'ATTEMPT_TYPE_CONTRADICTS_PURPOSE'] });
    // a Reduced blueprint whose form would run as a full mock
    expect(solveProtectedForm(base(id('REDUCED', 1), FULL))).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['FIDELITY_MISMATCH'], form: null, fidelityViolations: ['REDUCED_PURPOSE_REQUIRES_REDUCED_FIDELITY', 'ATTEMPT_TYPE_CONTRADICTS_PURPOSE'] });
    // unverifiable fidelity blocks the protected mock
    expect(solveProtectedForm(base(id('FULL', 1), UNKNOWN))).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['FIDELITY_MISMATCH'], attempt: { startable: false, reason: 'FIDELITY_UNKNOWN' } });
    expect(solveProtectedForm(base(id('REDUCED', 1), null)).causes).toEqual(['FIDELITY_MISMATCH']);
    // a full structure outside the official difficulty band is not a Full mock
    expect(solveProtectedForm({ ...base(id('FULL', 1)), difficultyBandMet: false })).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['FIDELITY_MISMATCH'], fidelityViolations: ['ATTEMPT_NOT_STARTABLE'] });
    // a correct Reduced form is stored as REDUCED_MOCK
    expect(solveProtectedForm(base(id('REDUCED', 1), REDUCED))).toMatchObject({ status: 'FORM_READY', attempt: { startable: true, type: 'REDUCED_MOCK' }, form: { fidelity: 'REDUCED', attemptType: 'REDUCED_MOCK' } });
  });

  it('H. a Diagnostic is a distinct purpose: it has no fixed form and is never assembled as a mock', () => {
    expect(solveProtectedForm(base(id('DIAGNOSTIC', 1)))).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['BLUEPRINT_PURPOSE_MISMATCH'], pool: 'DIAGNOSTIC', solution: null });
    expect(solveProtectedForm(base(id('FULL', 3))).causes).toEqual(['BLUEPRINT_PURPOSE_MISMATCH']);
    expect(solveProtectedForm(base(id('FULL', 1, { status: 'DRAFT' }))).causes).toEqual(['BLUEPRINT_PURPOSE_MISMATCH']);
    expect(solveProtectedForm(base(id('FULL', 1, { examVersionId: 'ev-2' }))).causes).toEqual(['BLUEPRINT_PURPOSE_MISMATCH']);
  });

  it('frozen forms keep items, order, blueprint revision, purpose, pool and fidelity; any change is detected', () => {
    const r = solveProtectedForm(base(id('FULL', 1)));
    const form = r.form!;
    expect(form).toMatchObject({ v: 2, blueprintKey: 'ev-1:FULL:F1:R1', pool: 'FULL_MOCK_1', fidelity: 'FULL', attemptType: 'FULL_MOCK', identity: { purpose: 'FULL', form: 1, revision: 1 } });
    expect(form.positions.map((p) => p.slotIndex)).toEqual([0, 1, 2]);
    expect(frozenFormIntact(form)).toBe(true);
    expect(frozenFormIntact({ ...form, positions: [form.positions[1], form.positions[0], form.positions[2]] })).toBe(false);
    expect(frozenFormIntact({ ...form, positions: form.positions.map((p, i) => (i === 0 ? { ...p, key: K('practice-a') } : p)) })).toBe(false);
    expect(frozenFormIntact({ ...form, identity: { ...form.identity, revision: 2 } })).toBe(false);
    expect(frozenFormIntact({ ...form, pool: 'FULL_MOCK_2' })).toBe(false);
    expect(frozenFormIntact({ ...form, fidelity: 'REDUCED' })).toBe(false);
    // deterministic: the same inputs in another order freeze the same form
    expect(solveProtectedForm({ ...base(id('FULL', 1)), coverages: [...BANK].reverse() }).form!.formHash).toBe(form.formHash);
    // freezing refuses an incomplete selection, a Diagnostic, and items from outside the pool
    const outcome = r.solution!.outcome;
    const ok = { identity: id('FULL', 1), outcome, fidelity: FULL, decision: { startable: true as const, type: 'FULL_MOCK' as const }, poolAssignments: ASSIGN };
    expect(freezeForm({ ...ok, outcome: { ...outcome, status: 'INSUFFICIENT_COVERAGE', selected: [] } })).toEqual({ ok: false, violations: ['SELECTION_NOT_COMPLETE'] });
    expect(freezeForm({ ...ok, identity: id('DIAGNOSTIC', 1) })).toEqual({ ok: false, violations: ['PURPOSE_HAS_NO_FIXED_FORM'] });
    expect(freezeForm({ ...ok, identity: id('FULL', 2) })).toEqual({ ok: false, violations: ['ITEM_OUTSIDE_POOL'] });
    expect(freezeForm({ ...ok, identity: id('FULL', 1, { status: 'DRAFT' }) })).toEqual({ ok: false, violations: ['BLUEPRINT_NOT_PUBLISHED'] });
  });

  it('a fixed form is not repaired per Student: one exposed item makes the whole form ineligible for them', () => {
    const f1 = solveProtectedForm(base(id('FULL', 1))).form!;
    const f2 = solveProtectedForm(base(id('FULL', 2))).form!;
    const tookForm1 = new Map(f1.positions.map((p) => [p.key, { seen: true, recent: true }]));
    expect(frozenFormEligibility(f1, tookForm1, PILOT_EXPOSURE_POLICY.rules.FULL_MOCK_1)).toMatchObject({ eligible: false, reason: 'FORM_CONTAINS_EXPOSED_ITEMS' });
    expect(frozenFormEligibility(f2, tookForm1, PILOT_EXPOSURE_POLICY.rules.FULL_MOCK_2)).toEqual({ eligible: true });
    expect(frozenFormEligibility(f2, new Map([[f2.positions[1].key, { seen: true, recent: false }]]), 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ eligible: false, reason: 'FORM_CONTAINS_EXPOSED_ITEMS', exposedItems: [f2.positions[1].key] });
  });

  it('readiness names the binding cause and selects nothing', () => {
    expect(evaluateProtectedFeasibility(base(id('FULL', 1)))).toMatchObject({ ready: true, causes: [], positions: 3, unfillablePositions: 0 });
    const noItems = evaluateProtectedFeasibility({ ...base(id('FULL', 1)), coverages: [bank('full_mock_1-a', 'lo-1')] });
    expect(noItems).toMatchObject({ ready: false, causes: ['INSUFFICIENT_ELIGIBLE_ITEMS'], unfillablePositions: 2 });
    expect(evaluateProtectedFeasibility({ ...base(id('FULL', 1)), poolAssignments: new Map() })).toMatchObject({ ready: false, causes: ['POOL_SHORTAGE'], gate: { poolRejected: { POOL_UNASSIGNED: 12 } } });
    expect(evaluateProtectedFeasibility(base(id('FULL', 1), REDUCED)).causes).toEqual(['FIDELITY_MISMATCH']);
    expect(evaluateProtectedFeasibility(base(id('DIAGNOSTIC', 1))).causes).toEqual(['BLUEPRINT_PURPOSE_MISMATCH']);
    expect(JSON.stringify(evaluateProtectedFeasibility(base(id('FULL', 1))))).not.toMatch(/positions":\[|"selected"|formHash/);
  });
});

describe('B2-A selection-unit contract (interface only)', () => {
  const group: SelectionUnit = { unitId: 'g-1', type: 'STIMULUS_GROUP', itemCount: 3, memberKeys: [K('g1-q1'), K('g1-q2'), K('g1-q3')], stimulusSetId: 'stim-1', integrity: { kind: 'SUBSET', minItems: 2, maxItems: 3 }, contiguous: true, setKind: 'PAIRED_PASSAGE', pool: 'FULL_MOCK_1', exposure: { seen: false, recent: false } };

  it('an ITEM unit and a STIMULUS_GROUP unit declare id, type, members, stimulus set, integrity, pool and exposure', () => {
    const item = itemUnit({ key: K('i-1'), exposure: { seen: false, recent: false } }, 'PRACTICE');
    expect(item).toMatchObject({ unitId: K('i-1'), type: 'ITEM', itemCount: 1, memberKeys: [K('i-1')], stimulusSetId: null, integrity: { kind: 'WHOLE' }, pool: 'PRACTICE' });
    expect(selectionUnitViolations(item)).toEqual([]);
    expect(selectionUnitViolations(group)).toEqual([]);
    expect(selectableItemRange(group)).toEqual({ min: 2, max: 3 });
    expect(selectableItemRange({ ...group, integrity: { kind: 'WHOLE' } })).toEqual({ min: 3, max: 3 });
    expect(groupExposure([{ seen: false, recent: false }, { seen: true, recent: false }])).toEqual({ seen: true, recent: false });
  });

  it('rejects malformed units', () => {
    expect(selectionUnitViolations({ ...group, stimulusSetId: null })).toEqual(['GROUP_WITHOUT_STIMULUS']);
    expect(selectionUnitViolations({ ...group, contiguous: false })).toEqual(['GROUP_NOT_CONTIGUOUS']);
    expect(selectionUnitViolations({ ...group, itemCount: 2 })).toEqual(['ITEM_COUNT_MISMATCH']);
    expect(selectionUnitViolations({ ...group, integrity: { kind: 'SUBSET', minItems: 3, maxItems: 5 } })).toEqual(['INVALID_SUBSET_RANGE']);
    expect(selectionUnitViolations({ ...group, type: 'ITEM' })).toEqual(['ITEM_WITH_SEVERAL_MEMBERS', 'ITEM_WITH_STIMULUS']);
    expect(selectionUnitViolations({ ...group, memberKeys: [K('a'), K('a'), K('b')] })).toEqual(['DUPLICATE_MEMBER']);
  });

  it('a blueprint that needs a group the bank does not hold gets no form, never loose items (B2-B2: groups are selected as units)', () => {
    expect(STIMULUS_GROUP_RUNTIME_SELECTION).toBe('UNITS_FROM_QB_COVERAGE');
    const need = [{ type: 'STIMULUS_GROUP' as const, setKind: 'PAIRED_PASSAGE', units: 1, minItems: 3, maxItems: 13 }, { type: 'ITEM' as const, setKind: null, units: 2, minItems: 1, maxItems: 1 }];
    // well-formed requirements are servable; a malformed one is refused before anything is selected
    expect(unservableUnitRequirements(need)).toHaveLength(0);
    expect(unservableUnitRequirements([{ ...need[0], minItems: 5, maxItems: 3 }, { ...need[0], units: 0 }, { ...need[1], maxItems: 2 }])).toHaveLength(3);
    expect(solveProtectedForm({ ...base(id('FULL', 1)), unitRequirements: [{ ...need[0], units: 0 }] })).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['UNIT_REQUIREMENT_INVALID'], solution: null, form: null });
    // BANK holds standalone questions only: the paired passage cannot be served, and the 12 loose items are not offered instead
    const r = solveProtectedForm({ ...base(id('FULL', 1)), unitRequirements: need });
    expect(r).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['INSUFFICIENT_ELIGIBLE_ITEMS'], form: null, units: { groupUnits: 0, placed: [], shortfalls: [{ placed: 0 }] } });
    expect(r.outcome?.selected).toEqual([]);
    expect(evaluateProtectedFeasibility({ ...base(id('FULL', 1)), unitRequirements: need }).causes).toEqual(['INSUFFICIENT_ELIGIBLE_ITEMS']);
    // B2 holds no stimulus or asset content: only the facts above
    for (const f of readdirSync(DIR)) expect(strip(readFileSync(join(DIR, f), 'utf8')), f).not.toMatch(/CREATE TABLE|passageText|stimulusText|assetUrl|imageUrl|\bcontent\s*:/);
  });
});

describe('B2-A Diagnostic purpose (selection hook; full Q1 semantics deferred)', () => {
  const DEPTH = { directQuestionsPerTarget: 2, authority: 'STUDYUS_POLICY' as const, policyRef: { id: 'q1-diagnostic-depth', version: '1' } };

  it('asks for dedicated DIRECT questions per target and accepts nothing weaker', () => {
    const plan = diagnosticTargetPlan('OBJECTIVE', ['lo-2', 'lo-1', 'lo-1'], DEPTH);
    expect(plan).toMatchObject({ mode: 'TARGETS', family: 'EXAM_PREPARATION', accept: { supporting: false, derived: false } });
    expect(plan.targets.map((t) => [t.id, t.opportunities, t.directOpportunities, t.independentDemonstrations])).toEqual([['lo-1', 2, 2, 2], ['lo-2', 2, 2, 2]]);
    const { candidates } = eligibleSolverCandidates([bank('d1', 'lo-1'), bank('d2', 'lo-1'), bank('d3', 'lo-2'), bank('d4', 'lo-2')], { family: 'EXAM_PREPARATION', studentId: '', examVersionId: EV });
    const out = solveBlueprint(plan, candidates);
    expect(out.status).toBe('READY');
    expect(out.selected).toHaveLength(4);
    expect(new Set(out.selected.map((s) => s.dedicatedTo)).size).toBe(2);
    // one question short: honest, never a single-item claim presented as met
    const short = solveBlueprint(plan, candidates.filter((c) => c.key !== K('d4')));
    expect(short.status).not.toBe('READY');
    expect(short.unmet.some((u) => u.subject === 'OBJECTIVE:lo-2')).toBe(true);
  });

  it('does not claim Q1 Diagnostic readiness', () => {
    expect(Q1_DIAGNOSTIC_FULL_SEMANTICS).toBe('DEFERRED_TO_B3');
    expect(strip(readFileSync(join(DIR, 'diagnostic.ts'), 'utf8'))).not.toMatch(/independentEvidenceEligible|updateMastery|stimulus/i);
  });
});

describe('B2-A item-level exposure from the existing delivery ledger (read-only)', () => {
  it('any delivered version exposes the item; recency is against an explicit asOf; answer reveal is not invented', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'v-2', last_used_at: '2026-10-01T00:00:00.000Z' }, { id: 'v-9', last_used_at: '2026-06-01T00:00:00.000Z' }] });
    const exposure = await loadReviewedBankExposure('stu-1', '2026-10-10T00:00:00.000Z', { query } as never);
    expect([...exposure]).toEqual([[K('v-2'), { seen: true, recent: true }], [K('v-9'), { seen: true, recent: false }]]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/FROM exam_item_usage/);
    expect(sql).toMatch(/bank_item_id/);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
    expect(params).toEqual(['stu-1', '2026-10-10T00:00:00.000Z']);
    expect(JSON.stringify([...exposure])).not.toMatch(/answerRevealed/);
  });
});

describe('B2-A architecture', () => {
  // B2-B2 added ONE file with IO to this directory, the persistence adapter; its own rules are asserted in b2-readiness-architecture.
  const files = readdirSync(DIR).filter((f) => f !== 'blueprint-persistence.service.ts').map((f) => join(DIR, f));
  it('the persistence adapter is the only file here that is not pure', () => {
    expect(readdirSync(DIR).filter((f) => /@\/lib\/db|\.service'/.test(strip(readFileSync(join(DIR, f), 'utf8'))))).toEqual(['blueprint-persistence.service.ts']);
  });
  it('the new files are pure: no IO, no SQL, no flag, no mastery threshold, and they do not re-implement B1', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/@\/lib\/db|\.service'|process\.env|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/);
      expect(code, f).not.toMatch(/export function (evaluateQuestionEligibility|classifyExamFormFidelity|deriveInstanceAttemptType|isEligible)\b/);
      expect(code, f).not.toMatch(/PUBLIC|licen[cs]e|rightsHolder/i);
    }
  });

  it('solver semantics are preserved: one solver, untouched, and the protected path goes through the existing official pipeline', () => {
    const selection = strip(readFileSync(join(DIR, 'protected-selection.ts'), 'utf8'));
    expect(selection).toMatch(/solveOfficialBlueprint\(/);
    expect(selection).toMatch(/eligibleSolverCandidates\(/);
    expect(selection).toMatch(/officialAttemptDecision\(/);
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/solveBlueprint\(|weightedSum|score\s*\+=/);
    expect(strip(readFileSync(join(ROOT, 'src/lib/assessment-blueprint/pipeline.ts'), 'utf8')).match(/solveBlueprint\(/g)).toHaveLength(3);
  });
});
