/**
 * B1-D -- EXAM_PRACTICE: the persisted type of a PRACTICE exam instance.
 *
 *   exam_instance.mode = PRACTICE          -> simulation type EXAM_PRACTICE (preparation; never official)
 *   exam_instance.mode = MOCK / CHALLENGE  -> simulation type FULL_MOCK
 *
 * EXAM_PRACTICE keeps the positions a practice instance has always had (it is not reduced like MINI_MOCK),
 * is written only by the exam-instance start flow, and is the only instance type that may use generated
 * fallback. A FULL_MOCK never does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
const targetsMock = vi.fn();
const guardMock = vi.fn();

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));
vi.mock('@/lib/assessment/blueprint.service', () => ({ getBlueprintForVersion: async () => ({ id: 'bp-1', status: 'PUBLISHED' }), listObjectiveTargets: (...a: any[]) => targetsMock(...a) }));
vi.mock('@/lib/assessment/full-mock-guard.service', () => ({ canFullMockBeOffered: (...a: any[]) => guardMock(...a) }));
vi.mock('@/lib/assessment/exam-definition.service', () => ({ getExamVersion: async () => ({ id: 'ev-1', scoringModelId: 'sm-1' }) }));
const COMPONENTS = [
  { id: 'c1', name: 'Paper 1', sectionKey: 'p1', sequenceOrder: 0, academicSubjectId: 'subj-1', timingStatus: 'CONFIGURED', durationMinutes: 60, toolRuleStatus: 'CONFIGURED', toolRules: {}, simulationCapable: true },
  { id: 'c2', name: 'Paper 2', sectionKey: 'p2', sequenceOrder: 1, academicSubjectId: 'subj-2', timingStatus: 'CONFIGURED', durationMinutes: 90, toolRuleStatus: 'CONFIGURED', toolRules: {}, simulationCapable: true },
];
vi.mock('@/lib/assessment/component.service', () => ({ listComponentsForVersion: async () => COMPONENTS, getComponent: async (id: string) => COMPONENTS.find((c) => c.id === id) ?? null }));

import { buildSimulationPlan } from '@/lib/simulation/plan.service';
import { startSimulationAttempt, ExamPracticeRequiresExamInstanceError, FullMockRequiresExamInstanceError } from '@/lib/simulation/attempt.service';
import { assessmentPathOf, attemptTypeForInstanceMode, EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE, instanceStartViolation, isPreparationSimulationType, mayUseGeneratedFallback, OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE, PREPARATION_SIMULATION_TYPES } from '@/lib/simulation/preparation-simulation';
import { DeliveryPolicySchema, isModeAllowed, resolveDeliveryPolicy, SIMULATION_TYPE_VALUES } from '@/lib/exam-core/delivery-policy';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { attemptKindLabelKey, SIMULATION_TYPES } from '@/lib/experience/exam-prep';
import { getMessages } from '@/lib/i18n/messages';
import { CHALLENGE_BAND, CHALLENGE_TARGET, MOCK_BAND, MOCK_TARGET, targetDifficultyFor } from '@/lib/exam-core/form-assembly';
import { timingFor } from '@/lib/exam-core/exam-instance.service';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const target = (id: string, componentId: string, objectiveId: string) => ({ id, assessmentComponentId: componentId, learningObjectiveId: objectiveId, questionType: null, difficultyMin: null, difficultyMax: null, reasoningRequirement: null, commandTermId: null });
/** 5 blueprint positions over two papers; the mini-mock guard supports only objective o1. */
const TARGETS = [target('t1', 'c1', 'o1'), target('t2', 'c1', 'o2'), target('t3', 'c1', 'o3'), target('t4', 'c2', 'o1'), target('t5', 'c2', 'o4')];
const planOf = async (over: Record<string, unknown>) => (await buildSimulationPlan({ studentId: 'stu-1', examVersionId: 'ev-1', timingMode: 'UNTIMED', simulationType: 'EXAM_PRACTICE', ...over } as any)).selectedTargets.map((t) => t.blueprintObjectiveTargetId);

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [{ id: 'plan-1', created_at: new Date() }] });
  targetsMock.mockReset().mockResolvedValue(TARGETS);
  guardMock.mockReset().mockResolvedValue({ ready: false, reasons: [], miniMockObjectiveIds: ['o1'] });
});

describe('B1-D -- stored attempt type follows the instance mode', () => {
  it('PRACTICE instance -> EXAM_PRACTICE; MOCK instance -> FULL_MOCK; CHALLENGE instance -> FULL_MOCK (current)', () => {
    expect(attemptTypeForInstanceMode('PRACTICE')).toBe('EXAM_PRACTICE');
    expect(attemptTypeForInstanceMode('MOCK')).toBe('FULL_MOCK');
    expect(attemptTypeForInstanceMode('CHALLENGE')).toBe('FULL_MOCK');
  });

  it('the exam-instance start flow is the only writer, and it derives the type from the mode', () => {
    const instance = read('src/lib/exam-core/exam-instance.service.ts');
    expect(instance).toMatch(/simulationType: attemptTypeForInstanceMode\(instance\.mode\)/);
    expect(instance).not.toMatch(/simulationType: 'FULL_MOCK'/);
    // nothing else starts an attempt with that simulation type. (The Teacher-intervention domain has its own,
    // older `intervention_type` / `execution_type` value that is also spelled EXAM_PRACTICE: a different column
    // and meaning, untouched here -- so the check is on the simulation type, not on the bare word.)
    for (const f of ['src/app/api/simulation/attempts/route.ts', 'src/lib/student/teacher-intervention-execution.service.ts', 'src/lib/teacher/intervention.service.ts', 'src/app/api/teacher/interventions/route.ts']) {
      expect(read(f), f).not.toMatch(/simulationType:\s*'EXAM_PRACTICE'|simulation_type\s*=\s*'EXAM_PRACTICE'|z\.(literal|enum)\([^)]*'EXAM_PRACTICE'[^)]*\)[^\n]*simulationType/);
    }
  });

  it('start invariant: FULL_MOCK needs a frozen MOCK / CHALLENGE instance; EXAM_PRACTICE needs a PRACTICE instance', () => {
    const v = instanceStartViolation;
    expect(v({ simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: true })).toBeNull();
    expect(v({ simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'CHALLENGE', hasFrozenForm: true })).toBeNull();
    // no PRACTICE instance can create a FULL_MOCK
    expect(v({ simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'PRACTICE', hasFrozenForm: true })).toBe(OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE);
    expect(v({ simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: false })).toBe(OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE);
    expect(v({ simulationType: 'FULL_MOCK', hasFrozenForm: true })).toBe(OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE);
    expect(v({ simulationType: 'EXAM_PRACTICE', examInstanceId: 'i', examInstanceMode: 'PRACTICE', hasFrozenForm: true })).toBeNull();
    expect(v({ simulationType: 'EXAM_PRACTICE', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: true })).toBe(EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE);
    expect(v({ simulationType: 'EXAM_PRACTICE', hasFrozenForm: false })).toBe(EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE);
    for (const simulationType of ['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']) expect(v({ simulationType, hasFrozenForm: false })).toBeNull();
  });

  it('the real start function refuses both violations before touching the database', async () => {
    queryMock.mockReset();
    const base = { studentId: 's', examProfileId: 'p', examVersionId: 'v', timingMode: 'UNTIMED' as const, language: 'es' };
    await expect(startSimulationAttempt({ ...base, simulationType: 'EXAM_PRACTICE' })).rejects.toBeInstanceOf(ExamPracticeRequiresExamInstanceError);
    await expect(startSimulationAttempt({ ...base, simulationType: 'EXAM_PRACTICE', examInstanceId: 'i', examInstanceMode: 'MOCK', presetItems: async () => ({}) })).rejects.toBeInstanceOf(ExamPracticeRequiresExamInstanceError);
    await expect(startSimulationAttempt({ ...base, simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'PRACTICE', presetItems: async () => ({}) })).rejects.toBeInstanceOf(FullMockRequiresExamInstanceError);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('B1-D -- EXAM_PRACTICE preserves the positions a practice instance has always had', () => {
  it('covers every position of the selected components -- exactly what FULL_MOCK selected for a practice instance before', async () => {
    const practice = await planOf({ simulationType: 'EXAM_PRACTICE', assessmentComponentIds: ['c1', 'c2'] });
    const before = await planOf({ simulationType: 'FULL_MOCK', assessmentComponentIds: ['c1', 'c2'] });
    expect(practice).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(practice).toEqual(before);
  });

  it('is NOT filtered like MINI_MOCK: the readiness subset does not reduce it', async () => {
    const mini = await planOf({ simulationType: 'MINI_MOCK', assessmentComponentIds: ['c1', 'c2'] });
    expect(mini).toEqual(['t1', 't4']);
    expect(await planOf({ simulationType: 'EXAM_PRACTICE', assessmentComponentIds: ['c1', 'c2'] })).toHaveLength(5);
    // and it does not even consult the mini-mock guard
    guardMock.mockClear();
    await planOf({ simulationType: 'EXAM_PRACTICE', assessmentComponentIds: ['c1'] });
    expect(guardMock).not.toHaveBeenCalled();
  });

  it('supports selected components and focus objectives', async () => {
    expect(await planOf({ assessmentComponentIds: ['c1'] })).toEqual(['t1', 't2', 't3']);
    expect(await planOf({ assessmentComponentIds: ['c1', 'c2'], learningObjectiveIds: ['o1'] })).toEqual(['t1', 't4']);
    expect(await planOf({ assessmentComponentIds: ['c2'], learningObjectiveIds: ['o4'] })).toEqual(['t5']);
  });

  it('the plan is persisted with the EXAM_PRACTICE type', async () => {
    await planOf({ assessmentComponentIds: ['c1'] });
    const insert = queryMock.mock.calls.find((c) => /INSERT INTO simulation_plans/.test(c[0]))!;
    expect(insert[1][3]).toBe('EXAM_PRACTICE');
  });
});

describe('B1-D -- delivery policy and eligibility', () => {
  const policy = (allowed: string[]) => DeliveryPolicySchema.parse({ allowedSimulationTypes: allowed });

  it('EXAM_PRACTICE does not depend on a version allow-list (it is instance-started), but timing rules still apply', () => {
    expect(isModeAllowed(policy(['FULL_MOCK', 'TOPIC_EXAM']), 'EXAM_PRACTICE', 'UNTIMED')).toEqual({ allowed: true });
    expect(isModeAllowed(policy(['MINI_MOCK']), 'EXAM_PRACTICE', 'TRAINING_TIMED')).toEqual({ allowed: true });
    // contrast: MINI_MOCK is refused where the version does not list it
    expect(isModeAllowed(policy(['FULL_MOCK', 'TOPIC_EXAM']), 'MINI_MOCK', 'UNTIMED')).toEqual({ allowed: false, reason: 'SIMULATION_TYPE_NOT_ALLOWED' });
    const untimedOnly = DeliveryPolicySchema.parse({ allowedTimingModes: ['UNTIMED'] });
    expect(isModeAllowed(untimedOnly, 'EXAM_PRACTICE', 'TRAINING_TIMED')).toEqual({ allowed: false, reason: 'TIMING_MODE_NOT_ALLOWED' });
  });

  it('a version configuration cannot offer EXAM_PRACTICE as a client-selectable mode', () => {
    expect([...SIMULATION_TYPE_VALUES]).toEqual(['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK']);
    expect(DeliveryPolicySchema.safeParse({ allowedSimulationTypes: ['EXAM_PRACTICE'] }).success).toBe(false);
  });

  it('the resolved delivery policy of a practice attempt is what it was when stored as FULL_MOCK', () => {
    const cfg = DeliveryPolicySchema.parse({});
    for (const timing of ['UNTIMED', 'TRAINING_TIMED'] as const) expect(resolveDeliveryPolicy(cfg, 'EXAM_PRACTICE', timing)).toEqual(resolveDeliveryPolicy(cfg, 'FULL_MOCK', timing));
  });

  it('the direct-path eligibility never reports EXAM_PRACTICE as startable', async () => {
    expect(await getSimulationEligibility({ studentId: 's', examVersionId: 'ev-1', simulationType: 'EXAM_PRACTICE' })).toEqual({ simulationType: 'EXAM_PRACTICE', eligible: false, reasons: ['EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE'] });
  });
});

describe('B1-D -- generated fallback', () => {
  it('EXAM_PRACTICE may use it (preparation policy); a FULL_MOCK never, with no exception', () => {
    expect(mayUseGeneratedFallback({ simulationType: 'EXAM_PRACTICE', instanceMode: 'PRACTICE' })).toBe(true);
    for (const instanceMode of ['MOCK', 'CHALLENGE', 'PRACTICE', null]) expect(mayUseGeneratedFallback({ simulationType: 'FULL_MOCK', instanceMode })).toBe(false);
    // a mis-stored row can never open the door either
    expect(mayUseGeneratedFallback({ simulationType: 'EXAM_PRACTICE', instanceMode: 'MOCK' })).toBe(false);
  });

  it('the item sourcing reads that one rule', () => {
    const src = read('src/lib/exam-core/item-sourcing.service.ts');
    expect(src).toMatch(/return mayUseGeneratedFallback\(\{ simulationType: row\.simulation_type \?\? null, instanceMode: row\.instance_mode \?\? null \}\)/);
  });
});

describe('B1-D -- client authority is not widened', () => {
  it('EXAM_PRACTICE is not a preparation type a client may request, and not in the start panel list', () => {
    expect(isPreparationSimulationType('EXAM_PRACTICE')).toBe(false);
    expect([...PREPARATION_SIMULATION_TYPES]).toEqual(['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK']);
    expect([...SIMULATION_TYPES]).not.toContain('EXAM_PRACTICE');
  });

  it('the request schemas of the direct start, eligibility and Teacher assignment routes do not list it', () => {
    expect(read('src/app/api/simulation/attempts/route.ts')).toMatch(/simulationType: z\.enum\(\['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'\]\)/);
    expect(read('src/app/api/simulation/eligibility/route.ts')).toMatch(/simulationType: z\.enum\(\['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'\]\)/);
    expect(read('src/app/api/teacher/interventions/route.ts')).toMatch(/simulationType: z\.enum\(\['MINI_MOCK', 'FULL_MOCK'\]\)/);
  });
});

describe('B1-D -- historical attempts stay readable', () => {
  it('a historical PRACTICE-instance attempt stored as FULL_MOCK is still classified and labelled as practice', () => {
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'PRACTICE' })).toBe('EXAM_PRACTICE');
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK', instanceMode: 'PRACTICE' })).toBe('exv2.mode.PRACTICE');
    // and a new one reads the same way
    expect(assessmentPathOf({ simulationType: 'EXAM_PRACTICE', instanceMode: 'PRACTICE' })).toBe('EXAM_PRACTICE');
    expect(attemptKindLabelKey({ simulationType: 'EXAM_PRACTICE', instanceMode: 'PRACTICE' })).toBe('exv2.mode.PRACTICE');
  });

  it('a historical FULL_MOCK with no instance keeps its own label; nothing rewrites stored types', () => {
    expect(attemptKindLabelKey({ simulationType: 'FULL_MOCK' })).toBe('ex.type.FULL_MOCK');
    const migration = read('database/migrations/20261108_1000_simulation_type_exam_practice.sql').replace(/^\s*--.*$/gm, '');
    expect(migration).not.toMatch(/\bUPDATE\b/i);
    for (const f of ['src/lib/simulation/attempt.service.ts', 'src/lib/exam-core/exam-instance.service.ts']) expect(read(f), f).not.toMatch(/UPDATE simulation_attempts SET simulation_type/);
  });

  it('the new type has a learner-facing label in every interface language (never a raw enum)', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt']) {
      const label = (getMessages(locale) as Record<string, string>)['ex.type.EXAM_PRACTICE'];
      expect(label, locale).toBeTruthy();
      expect(label).not.toMatch(/EXAM_PRACTICE|mock|simulacro|simulado|Probeprüfung|blanc/i);
    }
  });
});

/**
 * CHALLENGE -- characterization of the CURRENT behaviour (B1-D section 5).
 * It is stored as FULL_MOCK. It satisfies the structural half of the official-fidelity invariant and FAILS the
 * fidelity half; this suite records both. Its persisted type was NOT changed (decision pending).
 */
describe('B1-D -- CHALLENGE: what holds and what does not (characterization, current behaviour)', () => {
  const instance = read('src/lib/exam-core/exam-instance.service.ts');

  it('HOLDS: frozen instance, complete form or none, official timing, no generated fallback', () => {
    // frozen at creation for every non-practice mode, and deleted when it cannot be assembled
    expect(instance).toMatch(/if \(instance\.mode !== 'PRACTICE'\) \{\s*try \{\s*await freezeForm\(instance\);/);
    // every required position is filled, or there is no form
    expect(instance).toMatch(/if \(empty > 0\) throw new ExamInstanceError\('FORM_INCOMPLETE'/);
    // a position is never left to be generated
    expect(instance).toMatch(/else if \(instance\.mode !== 'PRACTICE'\) preset\[index\] = \{ status: 'EXCLUDED'/);
    expect(timingFor('CHALLENGE', undefined)).toBe('OFFICIAL_SIMULATION_TIMED');
    expect(timingFor('CHALLENGE', 'UNTIMED')).toBe('OFFICIAL_SIMULATION_TIMED');
    expect(mayUseGeneratedFallback({ simulationType: 'FULL_MOCK', instanceMode: 'CHALLENGE' })).toBe(false);
    expect(instanceStartViolation({ simulationType: 'FULL_MOCK', examInstanceId: 'i', examInstanceMode: 'CHALLENGE', hasFrozenForm: true })).toBeNull();
  });

  it('DOES NOT HOLD: its difficulty is deliberately above the official exam (1.10x, band 1.05-1.15), unlike MOCK (1.00x)', () => {
    expect(MOCK_TARGET).toBe(1.0);
    expect(targetDifficultyFor('MOCK', null)).toBe(1.0);
    expect(CHALLENGE_TARGET).toBe(1.1);
    expect(targetDifficultyFor('CHALLENGE', null)).toBe(1.1);
    expect(CHALLENGE_BAND.min).toBeGreaterThan(MOCK_BAND.max - 1e-9);
  });

  it('DOES NOT HOLD (shared with MOCK): the form may be a REDUCED form, shorter than the official exam', () => {
    // a non-practice instance draws REDUCED_MOCK items when the blueprint is shorter than the official item count
    expect(instance).toMatch(/const use = mode === 'PRACTICE' \? 'PRACTICE' : fullLength \? 'FULL_MOCK' : 'REDUCED_MOCK'/);
    // and the assembled form records its length fidelity as FULL or REDUCED for MOCK and CHALLENGE alike
    expect(read('src/lib/exam-core/form-assembly.ts')).toMatch(/fidelity: allFilled && marksComplete \? 'FULL' : 'REDUCED'/);
  });
});
