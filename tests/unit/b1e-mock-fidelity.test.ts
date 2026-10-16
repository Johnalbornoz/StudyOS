/**
 * B1-E -- final mock fidelity semantics.
 *
 *   PRACTICE                 -> EXAM_PRACTICE
 *   CHALLENGE                -> EXAM_CHALLENGE
 *   MOCK + fidelity FULL     -> FULL_MOCK
 *   MOCK + fidelity REDUCED  -> REDUCED_MOCK
 *   MOCK + fidelity UNKNOWN  -> nothing is started
 *
 * Fidelity is classified from machine-readable exam / blueprint facts only. Size alone never proves FULL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
const startSimulationAttemptMock = vi.fn();
const targetsMock = vi.fn();

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));
vi.mock('@/lib/assessment/blueprint.service', () => ({ getBlueprintForVersion: async () => ({ id: 'bp-1', status: 'PUBLISHED' }), listObjectiveTargets: (...a: any[]) => targetsMock(...a) }));
vi.mock('@/lib/simulation/attempt.service', () => ({
  startSimulationAttempt: (...a: any[]) => startSimulationAttemptMock(...a),
  abandonSimulationAttempt: vi.fn(),
  getSimulationAttempt: vi.fn(),
}));

import { classifyExamFormFidelity, deriveInstanceAttemptType, type FormComponentFacts, type FormFidelityFacts } from '@/lib/exam-core/form-fidelity';
import { ExamInstanceError, startExamInstance } from '@/lib/exam-core/exam-instance.service';
import { assessmentPathOf, instanceStartViolation, INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE, isPreparationSimulationType, mayUseGeneratedFallback, OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE } from '@/lib/simulation/preparation-simulation';
import { INSTANCE_DERIVED_SIMULATION_TYPES } from '@/lib/simulation/types';
import { DeliveryPolicySchema, isModeAllowed, resolveDeliveryPolicy } from '@/lib/exam-core/delivery-policy';
import { attemptKindLabelKey, SIMULATION_TYPES } from '@/lib/experience/exam-prep';
import { getMessages } from '@/lib/i18n/messages';
import { FAMILY_OF_PATH } from '@/lib/assessment-foundation/families';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** One component whose frozen form is the complete, documented, officially timed official form. */
const full = (over: Partial<FormComponentFacts> = {}): FormComponentFacts => ({
  componentId: 'c1', sectionKey: 'p1', definitionPresent: true, officialMarks: 50, officialItemCount: 50, officialDurationMinutes: 90, configuredDurationMinutes: 90,
  distribution: 'DOCUMENTED', blueprintPositions: 50, formPositions: 50, filledPositions: 50, plannedMarks: 50, ...over,
});
const facts = (components: FormComponentFacts[], over: Partial<FormFidelityFacts> = {}): FormFidelityFacts => ({ formFrozen: true, components, versionMockableSectionKeys: components.map((c) => c.sectionKey!).filter(Boolean), officialComponentSets: [], ...over });
const classify = (components: FormComponentFacts[], over: Partial<FormFidelityFacts> = {}) => classifyExamFormFidelity(facts(components, over));

describe('B1-E fidelity classifier -- FULL only when the complete official structure is verified', () => {
  it('FULL: complete size, complete component set, official timing confirmed, distribution documented', () => {
    expect(classify([full()])).toEqual({ fidelity: 'FULL', reasons: [] });
    expect(classify([full(), full({ componentId: 'c2', sectionKey: 'p2' })])).toEqual({ fidelity: 'FULL', reasons: [] });
  });

  it('ITEM COUNT ALONE IS NOT ENOUGH: full size with an undocumented distribution is UNKNOWN, not FULL', () => {
    expect(classify([full({ distribution: 'PARTIAL' })])).toEqual({ fidelity: 'UNKNOWN', reasons: ['DISTRIBUTION_NOT_DOCUMENTED'] });
    expect(classify([full({ distribution: 'UNKNOWN' })])).toEqual({ fidelity: 'UNKNOWN', reasons: ['DISTRIBUTION_NOT_DOCUMENTED'] });
  });

  it('full size with unverifiable official timing is UNKNOWN', () => {
    expect(classify([full({ officialDurationMinutes: null })]).fidelity).toBe('UNKNOWN');
    expect(classify([full({ configuredDurationMinutes: null })]).fidelity).toBe('UNKNOWN');
    expect(classify([full({ configuredDurationMinutes: 60 })])).toEqual({ fidelity: 'UNKNOWN', reasons: ['OFFICIAL_TIMING_NOT_VERIFIABLE'] });
  });

  it('UNKNOWN when a fact needed to judge size is not recorded', () => {
    expect(classify([full()], { formFrozen: false })).toEqual({ fidelity: 'UNKNOWN', reasons: ['FORM_NOT_FROZEN'] });
    expect(classify([])).toEqual({ fidelity: 'UNKNOWN', reasons: ['NO_COMPONENTS'] });
    expect(classify([full({ definitionPresent: false })])).toEqual({ fidelity: 'UNKNOWN', reasons: ['COMPONENT_DEFINITION_MISSING'] });
    expect(classify([full({ officialMarks: null, officialItemCount: null })])).toEqual({ fidelity: 'UNKNOWN', reasons: ['OFFICIAL_SIZE_NOT_RECORDED'] });
    // an unknown size is never read as "smaller": not REDUCED either
    expect(classify([full({ officialMarks: null, officialItemCount: null, plannedMarks: 3, filledPositions: 3, formPositions: 3, blueprintPositions: 3 })]).fidelity).toBe('UNKNOWN');
  });

  it('REDUCED when the form is known to be smaller than the complete official form', () => {
    expect(classify([full({ plannedMarks: 20, filledPositions: 20, formPositions: 20, blueprintPositions: 20 })])).toEqual({ fidelity: 'REDUCED', reasons: ['BELOW_OFFICIAL_MARKS', 'BELOW_OFFICIAL_ITEM_COUNT'] });
    expect(classify([full({ officialItemCount: null, plannedMarks: 49 })])).toEqual({ fidelity: 'REDUCED', reasons: ['BELOW_OFFICIAL_MARKS'] });
    expect(classify([full({ officialMarks: null, plannedMarks: 36, filledPositions: 36, formPositions: 36, blueprintPositions: 36, officialItemCount: 175 })])).toEqual({ fidelity: 'REDUCED', reasons: ['BELOW_OFFICIAL_ITEM_COUNT'] });
    expect(classify([full({ filledPositions: 49 })]).reasons).toContain('UNFILLED_POSITIONS');
    expect(classify([full({ formPositions: 40, filledPositions: 40, plannedMarks: 40 })]).reasons).toContain('FORM_SHORTER_THAN_BLUEPRINT');
  });

  it('a known-reduced form is REDUCED even when its distribution or timing is undocumented (those only block FULL)', () => {
    expect(classify([full({ plannedMarks: 20, filledPositions: 20, formPositions: 20, blueprintPositions: 20, distribution: 'UNKNOWN', officialDurationMinutes: null })]).fidelity).toBe('REDUCED');
  });

  it('required components: one paper of a multi-paper exam is REDUCED; the whole exam or an official combination is complete', () => {
    const p1 = full();
    const p2 = full({ componentId: 'c2', sectionKey: 'p2' });
    // only Paper 1 of a two-paper exam
    expect(classify([p1], { versionMockableSectionKeys: ['p1', 'p2'] })).toEqual({ fidelity: 'REDUCED', reasons: ['COMPONENT_SET_INCOMPLETE'] });
    expect(classify([p1, p2], { versionMockableSectionKeys: ['p1', 'p2'] }).fidelity).toBe('FULL');
    // an official route (or a stage of one) is a complete official combination
    expect(classify([p1, p2], { versionMockableSectionKeys: ['p1', 'p2', 'p4', 'p5'], officialComponentSets: [['p1', 'p2'], ['p1', 'p4']] }).fidelity).toBe('FULL');
    expect(classify([p1], { versionMockableSectionKeys: ['p1', 'p2', 'p4'], officialComponentSets: [['p1', 'p2']] }).fidelity).toBe('REDUCED');
    // a component with no section key cannot be matched to any official set
    expect(classify([full({ sectionKey: null })]).fidelity).toBe('REDUCED');
  });

  it('every component must pass: one reduced or unverified paper decides the form', () => {
    expect(classify([full(), full({ componentId: 'c2', sectionKey: 'p2', plannedMarks: 10 })]).fidelity).toBe('REDUCED');
    expect(classify([full(), full({ componentId: 'c2', sectionKey: 'p2', distribution: 'PARTIAL' })]).fidelity).toBe('UNKNOWN');
    expect(classify([full(), full({ componentId: 'c2', sectionKey: 'p2', definitionPresent: false })]).fidelity).toBe('UNKNOWN');
  });

  it('names no vertical and does not read the attempt type, a label or the instance mode', () => {
    const src = read('src/lib/exam-core/form-fidelity.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const classifier = src.slice(src.indexOf('export function classifyExamFormFidelity'), src.indexOf('export type InstanceAttemptType'));
    expect(classifier).not.toMatch(/saber|icfes|paa|pisa|cambridge|aice|\bib\b|exam_family|family/i);
    expect(classifier).not.toMatch(/simulationType|simulation_type|mode|label|ex\.type/);
  });
});

describe('B1-E -- stored attempt type of an exam instance (the one derivation)', () => {
  const FULL = { fidelity: 'FULL' as const, reasons: [] };
  const REDUCED = { fidelity: 'REDUCED' as const, reasons: ['BELOW_OFFICIAL_MARKS' as const] };
  const UNKNOWN = { fidelity: 'UNKNOWN' as const, reasons: ['DISTRIBUTION_NOT_DOCUMENTED' as const] };

  it('the attempt type matrix', () => {
    expect(deriveInstanceAttemptType({ mode: 'PRACTICE', fidelity: null, difficultyBandMet: null })).toEqual({ startable: true, type: 'EXAM_PRACTICE' });
    expect(deriveInstanceAttemptType({ mode: 'CHALLENGE', fidelity: null, difficultyBandMet: true })).toEqual({ startable: true, type: 'EXAM_CHALLENGE' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: FULL, difficultyBandMet: true })).toEqual({ startable: true, type: 'FULL_MOCK' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: REDUCED, difficultyBandMet: true })).toEqual({ startable: true, type: 'REDUCED_MOCK' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: UNKNOWN, difficultyBandMet: true })).toEqual({ startable: false, reason: 'FIDELITY_UNKNOWN', fidelityReasons: ['DISTRIBUTION_NOT_DOCUMENTED'] });
  });

  it('a CHALLENGE or PRACTICE is never a FULL_MOCK, whatever its form looks like', () => {
    for (const mode of ['CHALLENGE', 'PRACTICE']) {
      const d = deriveInstanceAttemptType({ mode, fidelity: FULL, difficultyBandMet: true });
      expect(d.startable && d.type).not.toBe('FULL_MOCK');
    }
  });

  it('a MOCK with no classified form is UNKNOWN and does not start; it is never downgraded to practice', () => {
    const d = deriveInstanceAttemptType({ mode: 'MOCK', fidelity: null, difficultyBandMet: null });
    expect(d).toMatchObject({ startable: false, reason: 'FIDELITY_UNKNOWN' });
    expect(JSON.stringify(d)).not.toMatch(/EXAM_PRACTICE|MINI_MOCK/);
  });

  it('a full-structure MOCK off the official difficulty band is not a FULL_MOCK and does not start', () => {
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: FULL, difficultyBandMet: false })).toEqual({ startable: false, reason: 'OFFICIAL_DIFFICULTY_NOT_MET', fidelityReasons: [] });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: FULL, difficultyBandMet: null })).toMatchObject({ startable: false });
    // a reduced mock is not gated on the band (it is not claimed to be the official form)
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: REDUCED, difficultyBandMet: false })).toEqual({ startable: true, type: 'REDUCED_MOCK' });
  });

  it('a TECHNICAL_DEMO engine run is never stored as FULL_MOCK (and is not a Student official mock)', () => {
    for (const fidelity of [FULL, REDUCED, UNKNOWN, null]) expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity, difficultyBandMet: true, contentAudience: 'TECHNICAL_DEMO' })).toEqual({ startable: true, type: 'REDUCED_MOCK' });
  });
});

/* ---- the exam-instance start service, with the classifier reading real (mocked) facts ---- */

const form = (marks: number, positions: number, band = true) => ({
  v: 1, mode: 'MOCK', targetDifficulty: 1, difficultyIndex: 1, fidelity: 'FULL', coveragePercent: 100, difficultyBandMet: band, notes: [],
  slots: Array.from({ length: positions }, (_, i) => ({ index: i, blueprintObjectiveTargetId: `t${i}`, assessmentComponentId: 'c1', approvedItemId: `item-${i}`, marks: marks / positions, difficultyIndex: 1, contentOrigin: 'GENERATED' })),
  components: [{ componentId: 'c1', officialMarks: 50, officialItems: 50, plannedMarks: marks, positions, filled: positions }],
});
const definition = (over: Record<string, unknown> = {}) => ({
  officialName: 'Paper 1', kind: 'WRITTEN_PAPER', assessment: 'EXTERNAL', officialDurationMinutes: 90, maxMarks: 50, weightingPercent: 100, officialItemCount: 50, calculatorPolicy: 'NONE',
  responseFormats: ['SELECTED_RESPONSE'], sourceKeys: ['src-1'], blueprintSpecification: { status: 'DOCUMENTED', sourceKeys: ['src-1'] }, ...over,
});

let world: { mode: string; audience: string; form: any; definition: any; duration: number | null; blueprintTargets: number };
const instanceRow = () => ({ id: 'inst-1', student_id: 'stu-1', exam_profile_id: 'target-1', exam_version_id: 'ev-1', structure_node_id: null, component_ids: ['c1'], focus_objective_ids: [], mode: world.mode, rigor: 'OFFICIAL_FIDELITY', practice_level: null, timing_mode: 'OFFICIAL_SIMULATION_TIMED', status: 'READY', form: world.form, form_frozen_at: world.form ? '2026-10-10T00:00:00Z' : null, difficulty_index: 1, simulation_attempt_id: null, created_at: '2026-10-10T00:00:00Z', started_at: null, completed_at: null, content_audience: world.audience });

beforeEach(() => {
  world = { mode: 'MOCK', audience: 'STUDENT', form: form(50, 50), definition: definition(), duration: 90, blueprintTargets: 50 };
  targetsMock.mockReset().mockImplementation(async () => Array.from({ length: world.blueprintTargets }, (_, i) => ({ id: `t${i}`, assessmentComponentId: 'c1', learningObjectiveId: 'lo-1' })));
  startSimulationAttemptMock.mockReset().mockResolvedValue({ simulationAttempt: { id: 'sa-1' } });
  queryMock.mockReset().mockImplementation(async (sql: string) => {
    if (/SELECT \* FROM exam_instances WHERE id = \$1/.test(sql)) return { rows: [instanceRow()] };
    if (/FROM simulation_attempts WHERE exam_profile_id = \$1 AND status IN/.test(sql)) return { rows: [] };
    if (/FROM assessment_components c JOIN exam_versions v/.test(sql)) return { rows: [{ id: 'c1', section_key: 'p1', definition: world.definition, max_marks: world.definition?.maxMarks ?? null, duration_minutes: world.duration, timing_status: world.duration === null ? 'NOT_CONFIGURED' : 'CONFIGURED', simulation_capable: true, exam_family: 'ICFES' }] };
    if (/SELECT navigation_rules FROM exam_versions/.test(sql)) return { rows: [{ navigation_rules: {} }] };
    if (/UPDATE exam_instances SET status = 'IN_PROGRESS'/.test(sql)) return { rows: [{ ...instanceRow(), status: 'IN_PROGRESS', simulation_attempt_id: 'sa-1' }] };
    return { rows: [] };
  });
});

const started = () => startSimulationAttemptMock.mock.calls[0]?.[0];

describe('B1-E -- startExamInstance derives and writes the type', () => {
  it('PRACTICE -> EXAM_PRACTICE (no fidelity is read)', async () => {
    world.mode = 'PRACTICE';
    await startExamInstance('inst-1', { language: 'es' });
    expect(started()).toMatchObject({ simulationType: 'EXAM_PRACTICE', examInstanceId: 'inst-1', examInstanceMode: 'PRACTICE', verifiedFullFidelity: false });
    expect(queryMock.mock.calls.some((c) => /FROM assessment_components c JOIN exam_versions v/.test(c[0]))).toBe(false);
  });

  it('CHALLENGE -> EXAM_CHALLENGE', async () => {
    world.mode = 'CHALLENGE';
    await startExamInstance('inst-1', { language: 'es' });
    expect(started()).toMatchObject({ simulationType: 'EXAM_CHALLENGE', examInstanceMode: 'CHALLENGE', verifiedFullFidelity: false });
  });

  it('MOCK + FULL -> FULL_MOCK, flagged as verified full fidelity', async () => {
    await startExamInstance('inst-1', { language: 'es' });
    expect(started()).toMatchObject({ simulationType: 'FULL_MOCK', examInstanceMode: 'MOCK', verifiedFullFidelity: true });
    expect(typeof started().presetItems).toBe('function');
  });

  it('MOCK + REDUCED -> REDUCED_MOCK', async () => {
    world.form = form(20, 20);
    world.blueprintTargets = 20;
    await startExamInstance('inst-1', { language: 'es' });
    expect(started()).toMatchObject({ simulationType: 'REDUCED_MOCK', examInstanceMode: 'MOCK', verifiedFullFidelity: false });
  });

  it('MOCK + UNKNOWN -> no attempt is created (FIDELITY_NOT_VERIFIABLE); never started as practice', async () => {
    const cases: Array<[string, () => void]> = [
      ['distribution not documented', () => { world.definition = definition({ blueprintSpecification: { status: 'PARTIAL', sourceKeys: [] } }); }],
      ['distribution absent', () => { const d = definition(); delete (d as any).blueprintSpecification; world.definition = d; }],
      ['no component definition', () => { world.definition = null; }],
      ['official timing not confirmed', () => { world.duration = 60; }],
      ['official size not recorded', () => { world.definition = definition({ maxMarks: null, officialItemCount: null }); world.form = { ...form(50, 50), components: [{ componentId: 'c1', officialMarks: null, officialItems: null, plannedMarks: 50, positions: 50, filled: 50 }] }; }],
    ];
    for (const [name, arrange] of cases) {
      world = { mode: 'MOCK', audience: 'STUDENT', form: form(50, 50), definition: definition(), duration: 90, blueprintTargets: 50 };
      arrange();
      const err = await startExamInstance('inst-1', { language: 'es' }).catch((e) => e);
      expect(err, name).toBeInstanceOf(ExamInstanceError);
      expect(err.code, name).toBe('FIDELITY_NOT_VERIFIABLE');
    }
    expect(startSimulationAttemptMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some((c) => /UPDATE exam_instances SET status = 'IN_PROGRESS'/.test(c[0]))).toBe(false);
  });

  it('a full-size MOCK off the official difficulty band does not start as a full mock', async () => {
    world.form = form(50, 50, false);
    const err = await startExamInstance('inst-1', { language: 'es' }).catch((e) => e);
    expect(err.code).toBe('FIDELITY_NOT_VERIFIABLE');
    expect(String(err.message)).toContain('OFFICIAL_DIFFICULTY_NOT_MET');
    expect(startSimulationAttemptMock).not.toHaveBeenCalled();
  });

  it('a TECHNICAL_DEMO MOCK runs as REDUCED_MOCK and never as FULL_MOCK', async () => {
    world.audience = 'TECHNICAL_DEMO';
    world.definition = null;
    await startExamInstance('inst-1', { language: 'es' });
    expect(started()).toMatchObject({ simulationType: 'REDUCED_MOCK', verifiedFullFidelity: false });
  });

  it('creation applies the same rule: an unverifiable MOCK is deleted, not left READY', () => {
    const src = read('src/lib/exam-core/exam-instance.service.ts');
    const create = src.slice(src.indexOf('export async function createExamInstance('), src.indexOf('/** Server-held items for every filled form slot'));
    expect(create).toMatch(/const decision = await instanceAttemptDecision\(instance, form\);\s*if \(!decision\.startable\) throw new ExamInstanceError\('FIDELITY_NOT_VERIFIABLE'/);
    expect(create).toMatch(/delete_reason = \$2/);
  });
});

describe('B1-E -- start invariant, fallback and client authority', () => {
  it('start invariant per stored type', () => {
    const v = instanceStartViolation;
    expect(v({ simulationType: 'REDUCED_MOCK', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: true })).toBeNull();
    expect(v({ simulationType: 'REDUCED_MOCK', examInstanceId: 'i', examInstanceMode: 'PRACTICE', hasFrozenForm: true })).toBe(INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE);
    expect(v({ simulationType: 'REDUCED_MOCK', hasFrozenForm: false })).toBe(INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE);
    expect(v({ simulationType: 'EXAM_CHALLENGE', examInstanceId: 'i', examInstanceMode: 'CHALLENGE', hasFrozenForm: true })).toBeNull();
    expect(v({ simulationType: 'EXAM_CHALLENGE', examInstanceId: 'i', examInstanceMode: 'CHALLENGE', hasFrozenForm: false })).toBe(INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE);
    expect(v({ simulationType: 'EXAM_CHALLENGE', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: true })).toBe(INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE);
    // FULL_MOCK: MOCK + frozen + verified FULL, and nothing less
    expect(v({ simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: true, verifiedFullFidelity: true })).toBeNull();
    for (const bad of [{ examInstanceMode: 'CHALLENGE' }, { examInstanceMode: 'PRACTICE' }, { verifiedFullFidelity: false }, { hasFrozenForm: false }, { examInstanceId: null }]) {
      expect(v({ simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: true, verifiedFullFidelity: true, ...bad })).toBe(OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE);
    }
  });

  it('generated fallback: forbidden for FULL_MOCK, REDUCED_MOCK and EXAM_CHALLENGE; preparation only for EXAM_PRACTICE', () => {
    for (const simulationType of ['FULL_MOCK', 'REDUCED_MOCK', 'EXAM_CHALLENGE']) {
      for (const instanceMode of ['MOCK', 'CHALLENGE', 'PRACTICE', null]) expect(mayUseGeneratedFallback({ simulationType, instanceMode }), `${simulationType}/${instanceMode}`).toBe(false);
    }
    expect(mayUseGeneratedFallback({ simulationType: 'EXAM_PRACTICE', instanceMode: 'PRACTICE' })).toBe(true);
    expect(mayUseGeneratedFallback({ simulationType: 'EXAM_PRACTICE', instanceMode: 'MOCK' })).toBe(false);
    for (const simulationType of ['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']) expect(mayUseGeneratedFallback({ simulationType, instanceMode: null })).toBe(true);
  });

  it('derived instance-only types are not client-requestable anywhere', () => {
    expect([...INSTANCE_DERIVED_SIMULATION_TYPES]).toEqual(['FULL_MOCK', 'REDUCED_MOCK', 'PREPARATION_MOCK', 'EXAM_CHALLENGE', 'EXAM_PRACTICE']);
    for (const t of INSTANCE_DERIVED_SIMULATION_TYPES) expect(isPreparationSimulationType(t), t).toBe(false);
    for (const t of ['EXAM_PRACTICE', 'EXAM_CHALLENGE', 'REDUCED_MOCK', 'PREPARATION_MOCK']) {
      expect([...SIMULATION_TYPES], t).not.toContain(t);
      expect(DeliveryPolicySchema.safeParse({ allowedSimulationTypes: [t] }).success, t).toBe(false);
    }
    const enumOf4 = /simulationType: z\.enum\(\['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'\]\)/;
    expect(read('src/app/api/simulation/attempts/route.ts')).toMatch(enumOf4);
    expect(read('src/app/api/simulation/eligibility/route.ts')).toMatch(enumOf4);
    expect(read('src/app/api/teacher/interventions/route.ts')).toMatch(/simulationType: z\.enum\(\['MINI_MOCK', 'FULL_MOCK'\]\)/);
    // the migration does not widen the Teacher intervention domain
    expect(read('database/migrations/20261109_1000_simulation_type_challenge_reduced_mock.sql').replace(/^\s*--.*$/gm, '')).not.toMatch(/teacher_interventions/);
  });

  it('delivery policy: a reduced mock or a challenge is allowed exactly where the version allows a mock', () => {
    const allowing = DeliveryPolicySchema.parse({ allowedSimulationTypes: ['FULL_MOCK', 'TOPIC_EXAM'] });
    const refusing = DeliveryPolicySchema.parse({ allowedSimulationTypes: ['MINI_MOCK', 'TOPIC_EXAM'] });
    for (const t of ['REDUCED_MOCK', 'EXAM_CHALLENGE'] as const) {
      expect(isModeAllowed(allowing, t, 'OFFICIAL_SIMULATION_TIMED')).toEqual({ allowed: true });
      expect(isModeAllowed(refusing, t, 'OFFICIAL_SIMULATION_TIMED')).toEqual({ allowed: false, reason: 'SIMULATION_TYPE_NOT_ALLOWED' });
      // and it resolves to the policy a mock always had
      expect(resolveDeliveryPolicy(allowing, t, 'OFFICIAL_SIMULATION_TIMED')).toEqual(resolveDeliveryPolicy(allowing, 'FULL_MOCK', 'OFFICIAL_SIMULATION_TIMED'));
    }
  });

  it('a Teacher mock goes through the same derivation: the Teacher never selects the stored type', () => {
    const svc = read('src/lib/student/teacher-intervention-execution.service.ts');
    const helper = svc.slice(svc.indexOf('export async function startOfficialMockForIntervention('), svc.indexOf('export async function startOfficialMockForIntervention(') + 1400);
    expect(helper).toMatch(/createExamInstance\(\{[^}]*mode: 'MOCK' \}\)/);
    expect(helper).toMatch(/startExamInstance\(instance\.id/);
    expect(helper).not.toMatch(/FULL_MOCK|REDUCED_MOCK|simulationType/);
    // unknown fidelity surfaces as "not startable", through the ExamInstanceError the helper already converts
    expect(helper).toMatch(/if \(err instanceof ExamInstanceError\) throw new StudentInterventionNotStartableError/);
  });
});

describe('B1-E -- historical compatibility and labels', () => {
  it('historical attempts stored as FULL_MOCK are read through their instance', () => {
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'PRACTICE' })).toBe('EXAM_PRACTICE');
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'CHALLENGE' })).toBe('EXAM_CHALLENGE');
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', formFidelity: 'REDUCED' })).toBe('REDUCED_MOCK');
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', formFidelity: 'FULL' })).toBe('OFFICIAL_MOCK');
    // labels come from the instance mode (and the form's recorded length), never from the stored type
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'PRACTICE' })).toBe('exv2.mode.PRACTICE');
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'CHALLENGE' })).toBe('exv2.mode.CHALLENGE');
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', instanceFidelity: 'REDUCED' })).toBe('exv2.mode.MOCK.reduced');
  });

  it('new attempts are classified by their own stored type', () => {
    expect(assessmentPathOf({ simulationType: 'REDUCED_MOCK', instanceMode: 'MOCK', formFidelity: 'REDUCED' })).toBe('REDUCED_MOCK');
    expect(assessmentPathOf({ simulationType: 'EXAM_CHALLENGE', instanceMode: 'CHALLENGE' })).toBe('EXAM_CHALLENGE');
    expect(FAMILY_OF_PATH.REDUCED_MOCK).toBe('OFFICIAL_EXAM');
    expect(FAMILY_OF_PATH.EXAM_CHALLENGE).toBe('EXAM_PREPARATION');
    expect(FAMILY_OF_PATH.OFFICIAL_MOCK).toBe('OFFICIAL_EXAM');
  });

  it('no stored type is rewritten: both migrations only widen two CHECK constraints', () => {
    for (const m of ['20261108_1000_simulation_type_exam_practice.sql', '20261109_1000_simulation_type_challenge_reduced_mock.sql']) {
      const sql = read(`database/migrations/${m}`).replace(/^\s*--.*$/gm, '');
      expect(sql, m).not.toMatch(/\bUPDATE\b|\bINSERT\b|ADD COLUMN|DROP COLUMN/i);
    }
  });

  it('governed labels exist in every interface language', () => {
    const es = getMessages('es') as Record<string, string>;
    expect(es['ex.type.EXAM_PRACTICE']).toBe('Práctica de examen');
    expect(es['ex.type.EXAM_CHALLENGE']).toBe('Reto de examen');
    expect(es['ex.type.REDUCED_MOCK']).toBe('Simulacro reducido');
    expect(es['ex.type.FULL_MOCK']).toBe('Simulacro completo');
    for (const locale of ['es', 'en', 'de', 'fr', 'pt']) {
      const m = getMessages(locale) as Record<string, string>;
      for (const key of ['ex.type.EXAM_CHALLENGE', 'ex.type.REDUCED_MOCK']) {
        expect(m[key], `${locale} ${key}`).toBeTruthy();
        expect(m[key]).not.toMatch(/EXAM_CHALLENGE|REDUCED_MOCK/);
      }
      // a reduced mock is never labelled like the complete one
      expect(m['ex.type.REDUCED_MOCK']).not.toBe(m['ex.type.FULL_MOCK']);
    }
  });
});
