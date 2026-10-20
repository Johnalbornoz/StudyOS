/**
 * B2-B2 -- selection units at runtime, protected pools, hard exposure (items and stimulus groups), frozen
 * forms with group positions, and the rule that rights are B1's alone. In-memory FIXTURES only: no real
 * PAA form, variant, stimulus or item exists here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { coverageOfReviewedBankItem, type QuestionCoverage, type ReviewedBankItemRow, type RightsRecord } from '@/lib/assessment-foundation/question-coverage';
import { evaluateQuestionEligibility } from '@/lib/assessment-foundation/question-eligibility';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import type { FormFidelity } from '@/lib/exam-core/form-fidelity';
import {
  ANSWER_REVEAL_EXPOSURE, FIXED_FORM_SUBJECT, FROZEN_FORM_VERSION, LOGICAL_POOLS, PILOT_EXPOSURE_POLICY, PILOT_POOL_POLICY, PROTECTED_POOLS, Q1_DIAGNOSTIC_FULL_SEMANTICS, REQUIREMENT_KINDS, STIMULUS_GROUP_RUNTIME_SELECTION,
  assembleProtectedForm, deriveSelectionUnits, evaluateProtectedFeasibility, exposurePolicyViolations, freezeForm, frozenFormEligibility, frozenFormHash, frozenFormIntact, groupPositionViolations, poolAssignmentViolations,
  protectedDiagnosticSelection, selectionUnitViolations, sharedItems, sharedStimulusVersions, solveBlueprint, solveProtectedForm, specificationViolations, stimulusSetRequirements, stimulusSetValue, stimulusUnitId,
  unitPick, unitRequirementsOf, variantRefusals,
  type AuthorityTaggedRequirement, type BlueprintIdentity, type FrozenForm, type LogicalPool, type PersistedVariant, type PoolAssignments, type ProtectedFormInput, type ProtectedSelectionFacts, type SelectionUnitRequirement,
} from '@/lib/assessment-blueprint';
import { eligibleSolverCandidates } from '@/lib/assessment-blueprint/pipeline';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'src/lib/assessment-blueprint/protected');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EV = 'ev-1';
const OWNED: RightsRecord = { sourceAccess: 'NOT_APPLICABLE', reuseRights: 'STUDYUS_OWNED', inForce: true };
const PUBLIC_ONLY: RightsRecord = { sourceAccess: 'PUBLICLY_ACCESSIBLE', reuseRights: 'UNKNOWN', inForce: true };
const K = (id: string) => `REVIEWED_EXAM_BANK:${id}`;

function bank(id: string, objective: string, over: Partial<ReviewedBankItemRow> = {}): QuestionCoverage {
  return coverageOfReviewedBankItem({
    approvedItemId: id, learningObjectiveId: objective, questionType: 'multiple_choice', content: { difficulty: 3, marks: 1, language: 'es' }, status: 'PUBLISHED', bankLifecycleStatus: 'ACTIVE',
    usageEligibility: ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'], examAlignment: 'MOCK_READY', calibrationConfidence: 'INSUFFICIENT_DATA', contentOrigin: 'AUTHORED', sourceIds: null,
    bankItem: { provenance: 'STUDYUS_AUTHORED', examVersionId: EV, assessmentComponentId: 'comp-1', currentVersionId: id, retired: false, language: 'es' },
    sourceLicenses: [], itemRights: OWNED, humanReviewDecisions: 1, scope: { structureVersionId: 'sv-1', academicSubjectId: 'subj-1' }, objectiveConcepts: [{ canonicalConceptId: `c-of-${objective}`, relationType: 'FULL' }], ...over,
  });
}
type Stim = NonNullable<ReviewedBankItemRow['stimulus']>;
const stim = (stimulusId: string, position: number, over: Partial<Stim> = {}): Stim => ({ stimulusId, stimulusVersionId: `${stimulusId}-v1`, position, lifecycle: 'ACTIVE', humanApproved: true, isCurrentVersion: true, retired: false, kind: 'PASSAGE', selection: null, rights: OWNED, ...over });
/** A question of a group. Ids are chosen so that key order is NOT group order. */
const member = (id: string, stimulusId: string, position: number, objective = 'lo-1', over: Partial<Stim> = {}, row: Partial<ReviewedBankItemRow> = {}) => bank(id, objective, { stimulus: stim(stimulusId, position, over), ...row });

const position = (index: number, objective = 'lo-1', component = 'comp-1'): FormPosition => ({ index, blueprintObjectiveTargetId: `t-${index}`, assessmentComponentId: component, learningObjectiveId: objective, questionType: 'multiple_choice', difficultyRange: { min: 2, max: 4 } });
const id = (purpose: BlueprintIdentity['purpose'], form = 1, over: Partial<BlueprintIdentity> = {}): BlueprintIdentity => ({ examVersionId: EV, purpose, form, revision: 1, status: 'PUBLISHED', ...over });
const FULL: FormFidelity = { fidelity: 'FULL', reasons: [] };
const assign = (pool: LogicalPool, ...ids: string[]): Array<[string, LogicalPool[]]> => ids.map((i) => [K(i), [pool]]);
const PASSAGE: SelectionUnitRequirement = { type: 'STIMULUS_GROUP', setKind: 'PASSAGE', units: 1, minItems: 3, maxItems: 3 };

/** One passage (questions g-c, g-a, g-b in that order) and two standalone questions, all in Full Mock 1. */
const GROUP = [member('g-a', 'st-1', 2), member('g-b', 'st-1', 3), member('g-c', 'st-1', 1)];
const ITEMS = [bank('i-1', 'lo-1'), bank('i-2', 'lo-1')];
const BANK = [...ITEMS, ...GROUP];
const ASSIGN: PoolAssignments = new Map(assign('FULL_MOCK_1', 'i-1', 'i-2', 'g-a', 'g-b', 'g-c'));
const input = (over: Partial<ProtectedFormInput> = {}): ProtectedFormInput => ({
  identity: id('FULL', 1), policy: { studentId: FIXED_FORM_SUBJECT, examTargetId: null, examVersionId: EV, blueprintId: null, positions: [0, 1, 2, 3, 4].map((i) => position(i)) },
  coverages: BANK, poolAssignments: ASSIGN, fidelity: FULL, difficultyBandMet: true, unitRequirements: [PASSAGE], ...over,
});
const keysOf = (c: readonly QuestionCoverage[]) => new Set(c.map((x) => K(x.ref.id)));

describe('B2-B2 units derived from Question Bank coverage', () => {
  it('a standalone question is an ITEM; the current questions of one stimulus are ONE group, in position order, in the stimulus pool', () => {
    expect(STIMULUS_GROUP_RUNTIME_SELECTION).toBe('UNITS_FROM_QB_COVERAGE');
    const { units, unusableGroups } = deriveSelectionUnits({ coverages: BANK, usableKeys: keysOf(BANK), poolAssignments: ASSIGN });
    expect(unusableGroups).toEqual([]);
    expect(units.map((u) => [u.unitId, u.type, u.itemCount])).toEqual([[K('i-1'), 'ITEM', 1], [K('i-2'), 'ITEM', 1], [stimulusUnitId('st-1'), 'STIMULUS_GROUP', 3]]);
    const group = units[2];
    expect(group).toMatchObject({ stimulusSetId: 'st-1', stimulusVersionId: 'st-1-v1', setKind: 'PASSAGE', integrity: { kind: 'WHOLE' }, contiguous: true, pool: 'FULL_MOCK_1', exposure: { seen: false, recent: false } });
    expect(group.memberKeys).toEqual([K('g-c'), K('g-a'), K('g-b')]);
    expect(group.memberPositions).toEqual([1, 2, 3]);
    for (const u of units) expect(selectionUnitViolations(u)).toEqual([]);
    // order of the input does not matter
    expect(deriveSelectionUnits({ coverages: [...BANK].reverse(), usableKeys: keysOf(BANK), poolAssignments: ASSIGN }).units).toEqual(units);
  });

  it('WHOLE: one member that is not usable makes the group unusable -- and its other questions never become loose items', () => {
    const usable = keysOf(BANK);
    usable.delete(K('g-a'));
    const r = deriveSelectionUnits({ coverages: BANK, usableKeys: usable, poolAssignments: ASSIGN });
    expect(r.units.map((u) => u.unitId)).toEqual([K('i-1'), K('i-2')]);
    expect(r.unusableGroups).toEqual([{ unitId: stimulusUnitId('st-1'), stimulusSetId: 'st-1', reason: 'MEMBER_NOT_USABLE', unusableMembers: [K('g-a')] }]);
  });

  it('SUBSET: the unit holds the usable members in order, is usable while at least the minimum remain, and never claims more than remain', () => {
    const rule = { selection: { minItems: 2, maxItems: 4 } };
    const four = [member('s-d', 'st-2', 1, 'lo-1', rule), member('s-c', 'st-2', 2, 'lo-1', rule), member('s-b', 'st-2', 3, 'lo-1', rule), member('s-a', 'st-2', 4, 'lo-1', rule)];
    const pools: PoolAssignments = new Map(assign('FULL_MOCK_1', 's-a', 's-b', 's-c', 's-d'));
    const all = deriveSelectionUnits({ coverages: four, usableKeys: keysOf(four), poolAssignments: pools }).units[0];
    expect(all).toMatchObject({ itemCount: 4, integrity: { kind: 'SUBSET', minItems: 2, maxItems: 4 }, memberKeys: [K('s-d'), K('s-c'), K('s-b'), K('s-a')] });
    const usable = keysOf(four);
    usable.delete(K('s-c'));
    const three = deriveSelectionUnits({ coverages: four, usableKeys: usable, poolAssignments: pools }).units[0];
    expect(three).toMatchObject({ itemCount: 3, integrity: { kind: 'SUBSET', minItems: 2, maxItems: 3 }, memberKeys: [K('s-d'), K('s-b'), K('s-a')], memberPositions: [1, 3, 4] });
    expect(selectionUnitViolations(three)).toEqual([]);
    // the subset is a PREFIX of the usable members, in group order -- never a choice among them
    expect(unitPick(three, 2)).toEqual({ memberKeys: [K('s-d'), K('s-b')], memberPositions: [1, 3] });
    expect(unitPick(three, 1)).toBeNull();
    expect(unitPick(three, 4)).toBeNull();
    expect(unitPick(all, 4)?.memberKeys).toHaveLength(4);
    const one = deriveSelectionUnits({ coverages: four, usableKeys: new Set([K('s-d')]), poolAssignments: pools });
    expect(one.units).toEqual([]);
    expect(one.unusableGroups).toMatchObject([{ reason: 'BELOW_SUBSET_MINIMUM', unusableMembers: [K('s-c'), K('s-b'), K('s-a')] }]);
    // a WHOLE group is all or nothing
    const whole = deriveSelectionUnits({ coverages: BANK, usableKeys: keysOf(BANK), poolAssignments: ASSIGN }).units[2];
    expect(unitPick(whole, 2)).toBeNull();
    expect(unitPick(whole, 3)?.memberKeys).toEqual([K('g-c'), K('g-a'), K('g-b')]);
  });

  it('only current versions on both sides are members; facts that do not describe a unit are refused, not repaired', () => {
    const stale = member('g-old', 'st-1', 4, 'lo-1', { isCurrentVersion: false, stimulusVersionId: 'st-1-v0' });
    const r = deriveSelectionUnits({ coverages: [...BANK, stale], usableKeys: keysOf([...BANK, stale]), poolAssignments: ASSIGN });
    expect(r.units[2].memberKeys).toEqual([K('g-c'), K('g-a'), K('g-b')]);
    expect(r.units.some((u) => u.unitId === K('g-old'))).toBe(false);
    const clash = [member('x-1', 'st-9', 1), member('x-2', 'st-9', 1)];
    expect(deriveSelectionUnits({ coverages: clash, usableKeys: keysOf(clash), poolAssignments: new Map() }).unusableGroups).toMatchObject([{ reason: 'INVALID_UNIT' }]);
    const inverted = [member('y-1', 'st-8', 1, 'lo-1', { selection: { minItems: 3, maxItems: 2 } })];
    expect(deriveSelectionUnits({ coverages: inverted, usableKeys: keysOf(inverted), poolAssignments: new Map() }).unusableGroups).toMatchObject([{ reason: 'INVALID_UNIT' }]);
  });

  it('group exposure: any question of the group seen, or the stimulus met through a question that is no longer a member', () => {
    const base = { coverages: BANK, usableKeys: keysOf(BANK), poolAssignments: ASSIGN };
    expect(deriveSelectionUnits({ ...base, exposure: new Map([[K('g-b'), { seen: true, recent: true }]]) }).units[2].exposure).toEqual({ seen: true, recent: true });
    expect(deriveSelectionUnits({ ...base, exposedStimulusIds: new Set(['st-1']) }).units[2].exposure).toEqual({ seen: true, recent: false });
    expect(deriveSelectionUnits({ ...base, exposedStimulusIds: new Set(['st-other']) }).units[2].exposure).toEqual({ seen: false, recent: false });
    // an unusable member's exposure still exposes the group
    const usable = keysOf(BANK);
    const subset = [member('s-1', 'st-2', 1, 'lo-1', { selection: { minItems: 1, maxItems: 2 } }), member('s-2', 'st-2', 2, 'lo-1', { selection: { minItems: 1, maxItems: 2 } })];
    expect(deriveSelectionUnits({ coverages: subset, usableKeys: new Set([K('s-1')]), poolAssignments: new Map(), exposure: new Map([[K('s-2'), { seen: true, recent: false }]]) }).units[0].exposure.seen).toBe(true);
    expect(usable.size).toBe(5);
  });
});

describe('B2-B2 STIMULUS_SET requirement', () => {
  const req = (value: AuthorityTaggedRequirement['value'], over: Partial<AuthorityTaggedRequirement> = {}): AuthorityTaggedRequirement => ({ key: 'STIMULUS_SET:lectura', kind: 'STIMULUS_SET', subject: 'lectura', value, authority: 'STUDYUS_POLICY', sourceRefs: [], policyRef: { id: 'fixture-policy', version: '1' }, ...over });
  const variant = (requirements: AuthorityTaggedRequirement[], over: Partial<PersistedVariant> = {}): PersistedVariant => ({ blueprintId: 'bp-1', identity: id('FULL', 1), pool: 'FULL_MOCK_1', specification: { identity: id('FULL', 1), requirements }, componentIdBySubject: { lectura: 'comp-1' }, ...over });

  it('is a requirement kind of the contract and of migration 7, with a strict value', () => {
    expect(REQUIREMENT_KINDS).toContain('STIMULUS_SET');
    expect(readFileSync(join(ROOT, 'database/migrations/20261110_1600_assessment_blueprint_variants.sql'), 'utf8')).toContain(`'STIMULUS_SET'`);
    expect(stimulusSetValue({ kind: 'PAIRED_PASSAGE', sets: 2, minItems: 3, maxItems: 13 })).toEqual({ kind: 'PAIRED_PASSAGE', sets: 2, minItems: 3, maxItems: 13 });
    expect(stimulusSetValue({ kind: null, sets: 1, minItems: 1, maxItems: 1 })).toMatchObject({ kind: null });
    for (const bad of [{ kind: 'PASSAGE', sets: 0, minItems: 1, maxItems: 1 }, { kind: 'PASSAGE', sets: 1, minItems: 3, maxItems: 2 }, { kind: 'PASSAGE', sets: 1, minItems: 1 }, { kind: '', sets: 1, minItems: 1, maxItems: 1 }, { kind: 'PASSAGE', sets: 1.5, minItems: 1, maxItems: 1 }, 3, 'PASSAGE', null, [1]] as AuthorityTaggedRequirement['value'][]) {
      expect(stimulusSetValue(bad), JSON.stringify(bad)).toBeNull();
      expect(specificationViolations({ identity: id('FULL', 1), requirements: [req(bad)] })).toEqual([{ code: 'STIMULUS_SET_INVALID', key: 'STIMULUS_SET:lectura' }]);
    }
    expect(specificationViolations({ identity: id('FULL', 1), requirements: [req({ kind: 'PASSAGE', sets: 1, minItems: 3, maxItems: 3 })] })).toEqual([]);
    // an OFFICIAL stimulus-set requirement still needs its source
    expect(specificationViolations({ identity: id('FULL', 1), requirements: [req({ kind: 'PASSAGE', sets: 1, minItems: 3, maxItems: 3 }, { authority: 'OFFICIAL', policyRef: null })] })).toEqual([{ code: 'OFFICIAL_WITHOUT_SOURCE', key: 'STIMULUS_SET:lectura' }]);
  });

  it('becomes a unit requirement about its section; a variant that is not what it claims is refused before any question is read', () => {
    const v = variant([req({ kind: 'PASSAGE', sets: 1, minItems: 3, maxItems: 3 }), req({ kind: null, sets: 2, minItems: 1, maxItems: 2 }, { key: 'STIMULUS_SET:any', subject: null })]);
    expect(stimulusSetRequirements(v.specification).map((r) => r.key)).toEqual(['STIMULUS_SET:any', 'STIMULUS_SET:lectura']);
    expect(unitRequirementsOf(v)).toEqual([{ type: 'STIMULUS_GROUP', setKind: null, units: 2, minItems: 1, maxItems: 2, assessmentComponentId: null }, { type: 'STIMULUS_GROUP', setKind: 'PASSAGE', units: 1, minItems: 3, maxItems: 3, assessmentComponentId: 'comp-1' }]);
    expect(variantRefusals(v, EV)).toEqual([]);
    expect(variantRefusals(variant([], { identity: id('FULL', 1, { status: 'DRAFT' }) }), EV).map((r) => r.code)).toEqual(['VARIANT_NOT_PUBLISHED']);
    expect(variantRefusals(v, 'ev-2').map((r) => r.code)).toEqual(['VARIANT_OF_ANOTHER_EXAM_VERSION']);
    expect(variantRefusals(variant([], { pool: 'FULL_MOCK_2' }), EV)).toEqual([{ code: 'VARIANT_POOL_MISMATCH', stored: 'FULL_MOCK_2', expected: 'FULL_MOCK_1' }]);
    expect(variantRefusals(variant([], { pool: null }), EV).map((r) => r.code)).toEqual(['VARIANT_POOL_MISMATCH']);
    expect(variantRefusals(variant([req({ kind: 'PASSAGE', sets: 0, minItems: 1, maxItems: 1 })]), EV).map((r) => r.code)).toEqual(['SPECIFICATION_INVALID']);
    expect(variantRefusals(variant([req({ kind: 'PASSAGE', sets: 1, minItems: 1, maxItems: 1 }, { subject: 'ingles' })]), EV)).toEqual([{ code: 'STIMULUS_SET_SECTION_UNKNOWN', key: 'STIMULUS_SET:lectura' }]);
  });
});

describe('B2-B2 protected selection on units', () => {
  it('a group is taken whole, in its own order, in adjacent positions; the shared solver fills the rest with standalone questions', () => {
    const r = solveProtectedForm(input());
    expect(r.status).toBe('FORM_READY');
    expect(r.units).toMatchObject({ itemUnits: 2, groupUnits: 1, groupBoundQuestions: 3, unusableGroups: [], shortfalls: [] });
    expect(r.units.placed).toEqual([{ unitId: stimulusUnitId('st-1'), stimulusSetId: 'st-1', stimulusVersionId: 'st-1-v1', setKind: 'PASSAGE', slotIndexes: [0, 1, 2], memberKeys: [K('g-c'), K('g-a'), K('g-b')] }]);
    const form = r.form as FrozenForm;
    expect(form.positions.map((p) => [p.slotIndex, p.key, p.stimulusVersionId, p.unitPosition])).toEqual([[0, K('g-c'), 'st-1-v1', 1], [1, K('g-a'), 'st-1-v1', 2], [2, K('g-b'), 'st-1-v1', 3], [3, K('i-1'), null, null], [4, K('i-2'), null, null]]);
    // the solver was given the two positions the group did not take, and only standalone questions
    expect(r.solution?.plan.mode === 'SLOTS' && r.solution.plan.slots.map((s) => s.index)).toEqual([3, 4]);
    expect(r.solution?.eligibility.total).toBe(2);
    expect(r.outcome).toMatchObject({ status: 'READY', marks: 5, estimatedSeconds: null, diagnostics: { mode: 'SLOTS', selectedCount: 5, unmetCount: 0 } });
    expect(r.outcome?.selected.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
    expect(r.gate).toMatchObject({ offered: 5, eligible: 5, usable: 5 });
    // deterministic: any input order gives the same form
    expect(solveProtectedForm(input({ coverages: [...BANK].reverse() })).form?.formHash).toBe(form.formHash);
  });

  it('a stimulus-bound question never competes as a loose item: without a group requirement the group is simply not used', () => {
    const r = solveProtectedForm(input({ unitRequirements: [] }));
    expect(r).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['INSUFFICIENT_ELIGIBLE_ITEMS'], form: null, units: { groupBoundQuestions: 3, placed: [] } });
    // three positions for three eligible group questions and nothing else: still no form
    expect(solveProtectedForm(input({ unitRequirements: [], coverages: GROUP, policy: { ...input().policy, positions: [0, 1, 2].map((i) => position(i)) } })).status).toBe('NOT_AVAILABLE');
    // two positions, two standalone questions: the form holds no group question
    const two = solveProtectedForm(input({ unitRequirements: [], policy: { ...input().policy, positions: [0, 1].map((i) => position(i)) } }));
    expect(two.form?.positions.map((p) => p.key)).toEqual([K('i-1'), K('i-2')]);
  });

  it('WHOLE with an ineligible member: no form, no partial group, no substitute', () => {
    const noRights = [GROUP[0], member('g-b', 'st-1', 3, 'lo-1', {}, { itemRights: null }), GROUP[2]];
    const r = solveProtectedForm(input({ coverages: [...ITEMS, ...noRights] }));
    expect(r).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['INSUFFICIENT_ELIGIBLE_ITEMS'], form: null, gate: { eligible: 4, ineligible: { REUSE_RIGHTS_NOT_ESTABLISHED: 1 } } });
    expect(r.units.unusableGroups).toEqual([{ unitId: stimulusUnitId('st-1'), stimulusSetId: 'st-1', reason: 'MEMBER_NOT_USABLE', unusableMembers: [K('g-b')] }]);
    expect(r.units.shortfalls).toMatchObject([{ placed: 0 }]);
    expect(r.outcome?.selected).toEqual([]);
  });

  it('SUBSET: the first questions of the group, as many as the group rule, the requirement and the positions allow', () => {
    const rule = { selection: { minItems: 2, maxItems: 4 } };
    const four = [member('s-d', 'st-2', 1, 'lo-1', rule), member('s-c', 'st-2', 2, 'lo-1', rule), member('s-b', 'st-2', 3, 'lo-1', rule), member('s-a', 'st-2', 4, 'lo-1', rule)];
    const pools: PoolAssignments = new Map(assign('FULL_MOCK_1', 'i-1', 'i-2', 's-a', 's-b', 's-c', 's-d'));
    const need = (minItems: number, maxItems: number) => [{ ...PASSAGE, minItems, maxItems }];
    const three = solveProtectedForm(input({ coverages: [...ITEMS, ...four], poolAssignments: pools, unitRequirements: need(2, 3) }));
    expect(three.units.placed[0]).toMatchObject({ slotIndexes: [0, 1, 2], memberKeys: [K('s-d'), K('s-c'), K('s-b')] });
    expect(three.form?.positions.map((p) => p.unitPosition)).toEqual([1, 2, 3, null, null]);
    // an ineligible member in the middle: the usable ones are still taken in order, and the form says which places they hold
    const gap = [four[0], member('s-c', 'st-2', 2, 'lo-1', rule, { bankLifecycleStatus: 'SUSPENDED' }), four[2], four[3]];
    const skipped = solveProtectedForm(input({ coverages: [...ITEMS, ...gap], poolAssignments: pools, unitRequirements: need(2, 3) }));
    expect(skipped.form?.positions.slice(0, 3).map((p) => [p.key, p.unitPosition])).toEqual([[K('s-d'), 1], [K('s-b'), 3], [K('s-a'), 4]]);
    // the requirement wants more than the group may give: not served, nothing smaller offered
    expect(solveProtectedForm(input({ coverages: [...ITEMS, ...four], poolAssignments: pools, unitRequirements: need(5, 5) }))).toMatchObject({ status: 'NOT_AVAILABLE', form: null });
    // below the group's own minimum
    expect(solveProtectedForm(input({ coverages: [...ITEMS, ...four], poolAssignments: pools, unitRequirements: need(1, 1) })).status).toBe('NOT_AVAILABLE');
  });

  it('a STIMULUS_SET requirement is satisfied only by groups of its kind, in its section, where the questions fit the positions', () => {
    expect(solveProtectedForm(input({ unitRequirements: [{ ...PASSAGE, setKind: 'PAIRED_PASSAGE' }] }))).toMatchObject({ status: 'NOT_AVAILABLE', form: null });
    expect(solveProtectedForm(input({ unitRequirements: [{ ...PASSAGE, setKind: null }] })).status).toBe('FORM_READY');
    expect(solveProtectedForm(input({ unitRequirements: [{ ...PASSAGE, units: 2 }] })).units.shortfalls).toMatchObject([{ placed: 1 }]);
    // the questions of the group are on lo-2: they go where three adjacent lo-2 positions are, not at the front
    const onLo2 = [member('g-a', 'st-1', 2, 'lo-2'), member('g-b', 'st-1', 3, 'lo-2'), member('g-c', 'st-1', 1, 'lo-2')];
    const mixed = [position(0), position(1, 'lo-2'), position(2, 'lo-2'), position(3, 'lo-2'), position(4)];
    const placed = solveProtectedForm(input({ coverages: [...ITEMS, ...onLo2], policy: { ...input().policy, positions: mixed } }));
    expect(placed.units.placed[0].slotIndexes).toEqual([1, 2, 3]);
    expect(placed.form?.positions.map((p) => p.key)).toEqual([K('i-1'), K('g-c'), K('g-a'), K('g-b'), K('i-2')]);
    // the lo-2 positions exist but are not adjacent: the group is not split to fit
    const apart = [position(0, 'lo-2'), position(1), position(2, 'lo-2'), position(3), position(4, 'lo-2')];
    expect(solveProtectedForm(input({ coverages: [...ITEMS, ...onLo2], policy: { ...input().policy, positions: apart } }))).toMatchObject({ status: 'NOT_AVAILABLE', form: null });
    // a group does not straddle two sections, and a requirement about one section is served there only
    const twoSections = [position(0), position(1), position(2, 'lo-1', 'comp-2'), position(3, 'lo-1', 'comp-2'), position(4, 'lo-1', 'comp-2')];
    expect(solveProtectedForm(input({ policy: { ...input().policy, positions: twoSections } })).units.placed[0].slotIndexes).toEqual([2, 3, 4]);
    expect(solveProtectedForm(input({ policy: { ...input().policy, positions: twoSections }, unitRequirements: [{ ...PASSAGE, assessmentComponentId: 'comp-1' }] })).status).toBe('NOT_AVAILABLE');
    expect(solveProtectedForm(input({ unitRequirements: [{ ...PASSAGE, assessmentComponentId: 'comp-1' }] })).status).toBe('FORM_READY');
  });

  it('pool: a group belongs to one pool as a whole and is never used by the form of another', () => {
    const other: PoolAssignments = new Map([...assign('FULL_MOCK_1', 'i-1', 'i-2'), ...assign('FULL_MOCK_2', 'g-a', 'g-b', 'g-c')]);
    const r = solveProtectedForm(input({ poolAssignments: other }));
    expect(r).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['POOL_SHORTAGE'], gate: { poolRejected: { POOL_MISMATCH: 3 }, usable: 2 } });
    // two pools, two forms: no shared question and no shared stimulus
    const second = [bank('j-1', 'lo-1'), bank('j-2', 'lo-1'), member('h-a', 'st-7', 1), member('h-b', 'st-7', 2), member('h-c', 'st-7', 3)];
    const both: PoolAssignments = new Map([...ASSIGN, ...assign('FULL_MOCK_2', 'j-1', 'j-2', 'h-a', 'h-b', 'h-c')]);
    const f1 = solveProtectedForm(input({ coverages: [...BANK, ...second], poolAssignments: both })).form as FrozenForm;
    const f2 = solveProtectedForm(input({ identity: id('FULL', 2), coverages: [...BANK, ...second], poolAssignments: both })).form as FrozenForm;
    expect(f1.pool).toBe('FULL_MOCK_1');
    expect(f2.pool).toBe('FULL_MOCK_2');
    expect(sharedItems(f1, f2)).toEqual([]);
    expect(sharedStimulusVersions(f1, f2)).toEqual([]);
    expect(sharedStimulusVersions(f1, f1)).toEqual(['st-1-v1']);
    expect(f2.positions.slice(0, 3).map((p) => p.stimulusVersionId)).toEqual(['st-7-v1', 'st-7-v1', 'st-7-v1']);
  });

  it('six pools, zero intentional overlap, and no protected pool with a soft exposure rule', () => {
    expect([...LOGICAL_POOLS]).toEqual(['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']);
    expect(PILOT_POOL_POLICY).toMatchObject({ overlap: 'ZERO_INTENTIONAL_OVERLAP', shared: [] });
    expect([...PROTECTED_POOLS].sort()).toEqual(['DIAGNOSTIC', 'FULL_MOCK_1', 'FULL_MOCK_2', 'REDUCED_MOCK', 'VERIFICATION']);
    expect(exposurePolicyViolations(PILOT_EXPOSURE_POLICY)).toEqual([]);
    expect(poolAssignmentViolations(new Map([[K('i-1'), ['FULL_MOCK_1', 'PRACTICE']]]))).toEqual([{ key: K('i-1'), code: 'OVERLAP_NOT_ALLOWED' }]);
    // a group recorded in two pools is in none
    const twice: PoolAssignments = new Map([...assign('FULL_MOCK_1', 'i-1', 'i-2'), ...['g-a', 'g-b', 'g-c'].map((i): [string, LogicalPool[]] => [K(i), ['FULL_MOCK_1', 'FULL_MOCK_2']])]);
    expect(solveProtectedForm(input({ poolAssignments: twice })).gate.poolRejected).toEqual({ POOL_ASSIGNMENT_INVALID: 3 });
  });

  it('a malformed unit requirement, a Diagnostic and an unpublished variant select nothing', () => {
    expect(solveProtectedForm(input({ unitRequirements: [{ ...PASSAGE, minItems: 4, maxItems: 2 }] })).causes).toEqual(['UNIT_REQUIREMENT_INVALID']);
    expect(solveProtectedForm(input({ identity: id('DIAGNOSTIC', 1) })).causes).toEqual(['BLUEPRINT_PURPOSE_MISMATCH']);
    expect(solveProtectedForm(input({ identity: id('FULL', 1, { status: 'DRAFT' }) })).causes).toEqual(['BLUEPRINT_PURPOSE_MISMATCH']);
    const feasibility = evaluateProtectedFeasibility(input());
    expect(feasibility).toMatchObject({ ready: true, positions: 5, unfillablePositions: 0 });
    expect(JSON.stringify(feasibility)).not.toMatch(/"selected"|formHash|memberKeys/);
  });
});

describe('B2-B2 hard exposure', () => {
  it('a previously delivered standalone question is excluded outright for a protected form', () => {
    const three = [...ITEMS, bank('i-3', 'lo-1')];
    const pools: PoolAssignments = new Map(assign('FULL_MOCK_1', 'i-1', 'i-2', 'i-3'));
    const base = { coverages: three, poolAssignments: pools, unitRequirements: [], policy: { ...input().policy, studentId: 'stu-1', positions: [0, 1].map((i) => position(i)) } };
    const r = solveProtectedForm(input({ ...base, exposure: new Map([[K('i-1'), { seen: true, recent: false }]]) }));
    expect(r.gate.exposureRejected).toEqual({ EXPOSED_TO_STUDENT: 1 });
    expect(r.form?.positions.map((p) => p.key)).toEqual([K('i-2'), K('i-3')]);
    expect(solveProtectedForm(input({ ...base, exposure: new Map([[K('i-1'), { seen: true, recent: false }], [K('i-2'), { seen: true, recent: false }]]) }))).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['EXPOSURE_SHORTAGE'], form: null });
  });

  it('exposure of ANY question of a group exposes the whole group', () => {
    const forStudent = { policy: { ...input().policy, studentId: 'stu-1' } };
    const one = solveProtectedForm(input({ ...forStudent, exposure: new Map([[K('g-b'), { seen: true, recent: false }]]) }));
    expect(one).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['EXPOSURE_SHORTAGE'], form: null, gate: { exposureRejected: { EXPOSED_TO_STUDENT: 3 }, usable: 2 } });
    // ... also when the Student met the stimulus through a question (or a version) that is no longer in the group
    const former = solveProtectedForm(input({ ...forStudent, exposedStimulusIds: new Set(['st-1']) }));
    expect(former).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['EXPOSURE_SHORTAGE'], gate: { exposureRejected: { EXPOSED_TO_STUDENT: 3 } } });
    // another unseen group of the same pool is taken instead; the exposed one is not repaired or trimmed
    const spare = [member('h-a', 'st-7', 1), member('h-b', 'st-7', 2), member('h-c', 'st-7', 3)];
    const pools: PoolAssignments = new Map([...ASSIGN, ...assign('FULL_MOCK_1', 'h-a', 'h-b', 'h-c')]);
    const swapped = solveProtectedForm(input({ ...forStudent, coverages: [...BANK, ...spare], poolAssignments: pools, exposure: new Map([[K('g-b'), { seen: true, recent: false }]]) }));
    expect(swapped.units.placed.map((p) => p.stimulusSetId)).toEqual(['st-7']);
    expect(swapped.form?.positions.some((p) => p.stimulusVersionId === 'st-1-v1')).toBe(false);
  });

  it('a fixed form with an exposed question or an exposed stimulus is not offered to that Student; answer reveal stays deferred', () => {
    const form = solveProtectedForm(input()).form as FrozenForm;
    expect(frozenFormEligibility(form, new Map(), 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ eligible: true });
    expect(frozenFormEligibility(form, new Map(), 'HARD_EXCLUDE_IF_EXPOSED', new Set(['st-1-v1']))).toEqual({ eligible: false, reason: 'FORM_CONTAINS_EXPOSED_ITEMS', exposedItems: [K('g-a'), K('g-b'), K('g-c')], exposedStimulusVersionIds: ['st-1-v1'] });
    expect(frozenFormEligibility(form, new Map(), 'PREFER_UNSEEN', new Set(['st-1-v1']))).toEqual({ eligible: true });
    expect(frozenFormEligibility(form, new Map([[K('i-2'), { seen: true, recent: false }]]), 'HARD_EXCLUDE_IF_EXPOSED')).toEqual({ eligible: false, reason: 'FORM_CONTAINS_EXPOSED_ITEMS', exposedItems: [K('i-2')] });
    expect(ANSWER_REVEAL_EXPOSURE).toBe('DEFERRED');
  });
});

describe('B2-B2 frozen form with group positions', () => {
  const form = solveProtectedForm(input()).form as FrozenForm;

  it('records the stimulus version and the place in the group, and its digest is 64 lowercase hex over all of it', () => {
    expect(FROZEN_FORM_VERSION).toBe(2);
    expect(form.v).toBe(2);
    expect(form.formHash).toMatch(/^[0-9a-f]{64}$/);
    expect(frozenFormHash(form)).toBe(form.formHash);
    expect(frozenFormIntact(form)).toBe(true);
    const changed = (positions: FrozenForm['positions']) => ({ ...form, positions });
    // a different stimulus version, a different place in the group, a dropped stimulus: each is a different form
    expect(frozenFormIntact(changed(form.positions.map((p) => (p.stimulusVersionId ? { ...p, stimulusVersionId: 'st-1-v2' } : p))))).toBe(false);
    expect(frozenFormIntact(changed(form.positions.map((p, i) => (i === 2 ? { ...p, unitPosition: 4 } : p))))).toBe(false);
    expect(frozenFormIntact(changed(form.positions.map((p) => ({ ...p, stimulusVersionId: null, unitPosition: null }))))).toBe(false);
    expect(frozenFormHash(changed(form.positions.map((p, i) => (i === 2 ? { ...p, unitPosition: 4 } : p))))).not.toBe(form.formHash);
    // a form of an older digest version is not accepted as intact
    expect(frozenFormIntact({ ...form, v: 1 as never })).toBe(false);
  });

  it('a form whose group is split or out of order is refused, even with a matching digest', () => {
    const at = (order: number[]) => order.map((from, slotIndex) => ({ ...form.positions[from], slotIndex }));
    expect(groupPositionViolations(form.positions)).toEqual([]);
    expect(groupPositionViolations(at([0, 1, 3, 2, 4]))).toEqual(['STIMULUS_GROUP_NOT_ADJACENT']);
    expect(groupPositionViolations(at([1, 0, 2, 3, 4]))).toEqual(['STIMULUS_GROUP_OUT_OF_ORDER']);
    expect(groupPositionViolations(at([3, 0, 1, 2, 4]))).toEqual([]);
    const split = { ...form, positions: at([0, 1, 3, 2, 4]) };
    expect(frozenFormIntact({ ...split, formHash: frozenFormHash(split) })).toBe(false);
    // freezing a selection that splits a group is refused by name
    const solved = solveProtectedForm(input());
    const stimulusOf = new Map(GROUP.map((c) => [K(c.ref.id), { stimulusVersionId: c.stimulus!.stimulusVersionId, unitPosition: c.stimulus!.position }]));
    const outcome = { ...solved.outcome!, selected: solved.outcome!.selected.map((s) => ({ ...s, slotIndex: [0, 1, 3, 2, 4][s.slotIndex as number] })) };
    expect(freezeForm({ identity: id('FULL', 1), outcome, fidelity: FULL, decision: { startable: true, type: 'FULL_MOCK' }, poolAssignments: ASSIGN, stimulusOf })).toEqual({ ok: false, violations: ['STIMULUS_GROUP_NOT_ADJACENT'] });
    expect(freezeForm({ identity: id('FULL', 1), outcome: solved.outcome!, fidelity: FULL, decision: { startable: true, type: 'FULL_MOCK' }, poolAssignments: ASSIGN, stimulusOf })).toMatchObject({ ok: true, form: { formHash: form.formHash } });
  });
});

describe('B2-B2 rights are decided by B1 eligibility, never by B2', () => {
  it('an item with only a PUBLICLY_ACCESSIBLE source and no established reuse right never reaches the candidate set', () => {
    const open = bank('i-open', 'lo-1', { itemRights: PUBLIC_ONLY, sourceIds: ['src-1'], sourceLicenses: ['PUBLIC'] });
    const unrecorded = bank('i-none', 'lo-1', { itemRights: null, sourceIds: ['src-1'], sourceLicenses: ['PUBLIC'] });
    for (const c of [open, unrecorded]) expect(evaluateQuestionEligibility(c, { family: 'OFFICIAL_EXAM', studentId: 'stu-1', examVersionId: EV, use: 'FULL_MOCK' })).toEqual({ eligible: false, reasons: ['REUSE_RIGHTS_NOT_ESTABLISHED'] });
    const { candidates, summary } = eligibleSolverCandidates([...ITEMS, open, unrecorded], { family: 'OFFICIAL_EXAM', studentId: 'stu-1', examVersionId: EV, use: 'FULL_MOCK' });
    expect(candidates.map((c) => c.key)).toEqual([K('i-1'), K('i-2')]);
    expect(summary.rejected).toEqual({ REUSE_RIGHTS_NOT_ESTABLISHED: 2 });
    // in the protected selector: in the right pool, fitting the position, the only way to complete the form -- and still not used
    const pools: PoolAssignments = new Map(assign('FULL_MOCK_1', 'i-1', 'i-2', 'i-open', 'i-none'));
    const three = { ...input().policy, positions: [0, 1, 2].map((i) => position(i)) };
    const r = solveProtectedForm(input({ coverages: [...ITEMS, open, unrecorded], poolAssignments: pools, unitRequirements: [], policy: three }));
    expect(r).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['INSUFFICIENT_ELIGIBLE_ITEMS'], form: null, gate: { offered: 4, eligible: 2, usable: 2, ineligible: { REUSE_RIGHTS_NOT_ESTABLISHED: 2 } } });
    expect(deriveSelectionUnits({ coverages: [...ITEMS, open, unrecorded], usableKeys: new Set(candidates.map((c) => c.key)), poolAssignments: pools }).units.map((u) => u.unitId)).toEqual([K('i-1'), K('i-2')]);
  });

  it('a stimulus that is only publicly accessible makes its whole group unusable', () => {
    const openPassage = GROUP.map((c) => member(c.ref.id, 'st-1', c.stimulus!.position, 'lo-1', { rights: PUBLIC_ONLY }));
    const r = solveProtectedForm(input({ coverages: [...ITEMS, ...openPassage] }));
    expect(r).toMatchObject({ status: 'NOT_AVAILABLE', form: null, gate: { eligible: 2, ineligible: { STIMULUS_RIGHTS_NOT_ESTABLISHED: 3 } }, units: { groupUnits: 0, groupBoundQuestions: 0 } });
    expect(r.units.unusableGroups).toMatchObject([{ reason: 'MEMBER_NOT_USABLE', unusableMembers: [K('g-c'), K('g-a'), K('g-b')] }]);
  });

  it('no file of the protected module states a rights rule: candidates come through evaluateQuestionEligibility only', () => {
    for (const f of readdirSync(DIR)) expect(strip(readFileSync(join(DIR, f), 'utf8')), f).not.toMatch(/reuseRights|reuse_rights|sourceAccess|source_access|PUBLICLY_ACCESSIBLE|reuseEstablished|rightsIneligibility|ESTABLISHED_REUSE_RIGHTS|license_status/);
    const selection = strip(readFileSync(join(DIR, 'protected-selection.ts'), 'utf8'));
    const runtime = strip(readFileSync(join(DIR, 'protected-runtime.ts'), 'utf8'));
    expect(selection.match(/eligibleSolverCandidates\(/g)).toHaveLength(1);
    expect(runtime.match(/eligibleSolverCandidates\(/g)).toHaveLength(1);
    expect(strip(readFileSync(join(ROOT, 'src/lib/assessment-blueprint/pipeline.ts'), 'utf8'))).toMatch(/evaluateQuestionEligibility\(coverage, studentRequest\)/);
    // the solver stays one function, called from the pipeline three times and never from the protected module
    expect(strip(readFileSync(join(ROOT, 'src/lib/assessment-blueprint/pipeline.ts'), 'utf8')).match(/solveBlueprint\(/g)).toHaveLength(3);
    for (const f of readdirSync(DIR)) expect(strip(readFileSync(join(DIR, f), 'utf8')), f).not.toMatch(/solveBlueprint\(/);
  });
});

describe('B2-B2 from a stored variant and loaded facts to a selection', () => {
  const requirement: AuthorityTaggedRequirement = { key: 'STIMULUS_SET:lectura', kind: 'STIMULUS_SET', subject: 'lectura', value: { kind: 'PASSAGE', sets: 1, minItems: 3, maxItems: 3 }, authority: 'STUDYUS_POLICY', sourceRefs: [], policyRef: { id: 'fixture-policy', version: '1' } };
  const variant: PersistedVariant = { blueprintId: 'bp-1', identity: id('FULL', 1), pool: 'FULL_MOCK_1', specification: { identity: id('FULL', 1), requirements: [requirement] }, componentIdBySubject: { lectura: 'comp-1' } };
  const facts = (over: Partial<ProtectedSelectionFacts> = {}): ProtectedSelectionFacts => ({ examVersionId: EV, coverages: BANK, poolAssignments: ASSIGN, exposure: new Map(), exposedStimuli: { stimulusIds: new Set(), stimulusVersionIds: new Set() }, ...over });
  const shape = { positions: [0, 1, 2, 3, 4].map((i) => position(i)), fidelity: FULL, difficultyBandMet: true };

  it('assembles the same form the selector would, with the variant\'s own unit requirements', () => {
    const r = assembleProtectedForm(variant, facts(), shape);
    expect(r.ok && r.result.status).toBe('FORM_READY');
    expect(r.ok && r.result.form?.formHash).toBe(solveProtectedForm(input()).form?.formHash);
    expect(assembleProtectedForm({ ...variant, identity: id('FULL', 1, { status: 'DRAFT' }) }, facts(), shape)).toEqual({ ok: false, refusals: [{ code: 'VARIANT_NOT_PUBLISHED' }] });
  });

  it('a fixed form is assembled for no Student: loaded exposure shapes it only when a Student is named', () => {
    const seen = facts({ exposure: new Map([[K('g-b'), { seen: true, recent: false }]]), exposedStimuli: { stimulusIds: new Set(['st-1']), stimulusVersionIds: new Set(['st-1-v1']) } });
    const fixed = assembleProtectedForm(variant, seen, shape);
    expect(fixed.ok && fixed.result.status).toBe('FORM_READY');
    const personal = assembleProtectedForm(variant, seen, { ...shape, studentId: 'stu-1' });
    expect(personal.ok && personal.result).toMatchObject({ status: 'NOT_AVAILABLE', causes: ['EXPOSURE_SHORTAGE'] });
  });

  it('DIAGNOSTIC stays a purpose and a selectable plan from its own pool, with hard exposure -- and claims no Q1 semantics', () => {
    expect(Q1_DIAGNOSTIC_FULL_SEMANTICS).toBe('DEFERRED_TO_B3');
    const diagnostic: PersistedVariant = { blueprintId: 'bp-d', identity: id('DIAGNOSTIC', 1), pool: 'DIAGNOSTIC', specification: { identity: id('DIAGNOSTIC', 1), requirements: [] }, componentIdBySubject: {} };
    const pool = [bank('d-1', 'lo-1'), bank('d-2', 'lo-1'), bank('d-3', 'lo-1'), bank('d-4', 'lo-2'), bank('d-5', 'lo-2'), member('d-g', 'st-5', 1), bank('p-1', 'lo-1')];
    const pools: PoolAssignments = new Map([...assign('DIAGNOSTIC', 'd-1', 'd-2', 'd-3', 'd-4', 'd-5', 'd-g'), ...assign('PRACTICE', 'p-1')]);
    const depth = { directQuestionsPerTarget: 2, authority: 'STUDYUS_POLICY' as const, policyRef: { id: 'fixture-depth', version: '1' } };
    const ask = (over: Partial<ProtectedSelectionFacts> = {}) => protectedDiagnosticSelection({ variant: diagnostic, facts: facts({ coverages: pool, poolAssignments: pools, ...over }), studentId: 'stu-1', kind: 'OBJECTIVE', targetIds: ['lo-1', 'lo-2'], depth });
    const r = ask();
    if (!r.ok) throw new Error('refused');
    expect(r.selection).toMatchObject({ pool: 'DIAGNOSTIC', gate: { offered: 7, eligible: 7, stimulusBound: 1, poolRejected: { POOL_MISMATCH: 1 }, usable: 5 }, plan: { mode: 'TARGETS', accept: { supporting: false, derived: false } } });
    expect(r.selection.candidates.map((c) => c.key)).toEqual(['d-1', 'd-2', 'd-3', 'd-4', 'd-5'].map(K));
    // the one shared solver serves the plan; the selection is a selection, nothing more
    expect(solveBlueprint(r.selection.plan, r.selection.candidates)).toMatchObject({ status: 'READY', selected: expect.arrayContaining([]) });
    expect(solveBlueprint(r.selection.plan, r.selection.candidates).selected).toHaveLength(4);
    // hard exposure: a delivered question is not a candidate, and the plan is then honestly short
    const exposed = ask({ exposure: new Map([[K('d-4'), { seen: true, recent: false }]]) });
    if (!exposed.ok) throw new Error('refused');
    expect(exposed.selection.gate).toMatchObject({ exposureRejected: { EXPOSED_TO_STUDENT: 1 }, usable: 4 });
    expect(solveBlueprint(exposed.selection.plan, exposed.selection.candidates).status).not.toBe('READY');
    // a mock variant is not a Diagnostic, and a Diagnostic has no fixed form
    expect(protectedDiagnosticSelection({ variant, facts: facts(), studentId: 'stu-1', kind: 'OBJECTIVE', targetIds: ['lo-1'], depth })).toEqual({ ok: false, refusals: [{ code: 'VARIANT_IS_NOT_A_DIAGNOSTIC' }] });
    const asForm = assembleProtectedForm(diagnostic, facts({ coverages: pool, poolAssignments: pools }), shape);
    expect(asForm.ok && asForm.result.causes).toEqual(['BLUEPRINT_PURPOSE_MISMATCH']);
    expect(strip(readFileSync(join(DIR, 'protected-runtime.ts'), 'utf8'))).not.toMatch(/independentEvidenceEligible|updateMastery|recordEvidence/);
  });
});
