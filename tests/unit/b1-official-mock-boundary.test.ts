/**
 * B1 -- the official mock boundary.
 *
 * An official mock is served only through a frozen exam instance. The legacy direct start
 * (POST /api/simulation/attempts) is a Preparation Simulation: it never starts a FULL_MOCK, and no
 * official-format attempt ever receives content generated for the learner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
const generatePracticeQuestionsMock = vi.fn();
const bridgeMock = vi.fn();
const resolveStudentConceptMock = vi.fn();
const startSimulationAttemptMock = vi.fn();
const eligibilityMock = vi.fn();

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));
vi.mock('@/lib/curriculum/activity-metadata-bridge.service', () => ({ resolveActivityMetadataForObjective: (...a: any[]) => bridgeMock(...a) }));
vi.mock('@/lib/readiness/student-concept-resolution.service', () => ({ resolveStudentConceptForCanonicalConcept: (...a: any[]) => resolveStudentConceptMock(...a) }));
vi.mock('@/services/quiz-generation.service', () => ({ generatePracticeQuestions: (...a: any[]) => generatePracticeQuestionsMock(...a) }));
vi.mock('@/lib/auth', () => ({ verifyAuth: async () => ({ userId: 'clerk-1', email: 'a@b.c' }), checkRateLimit: () => true }));
vi.mock('@/lib/observability/pilot-events', () => ({ logPilotEvent: () => undefined }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/authorization', () => ({ canAccessLearner: async () => true }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: async () => true }));
vi.mock('@/lib/simulation/eligibility.service', () => ({ getSimulationEligibility: (...a: any[]) => eligibilityMock(...a) }));
vi.mock('@/lib/simulation/attempt.service', () => ({
  startSimulationAttempt: (...a: any[]) => startSimulationAttemptMock(...a),
  findOpenSimulationAttemptForProfile: async () => null,
  DeliveryPolicyConfigurationError: class extends Error {},
  SimulationModeNotAllowedError: class extends Error {},
  ExamProfileArchivedError: class extends Error {},
}));
vi.mock('@/lib/simulation/plan.service', () => ({ TimingConfigurationError: class extends Error {} }));
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({ isExamProfileOwnedByStudent: async () => true, isExamVersionStartableForProfile: async () => true }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_name: string, handler: any) => handler }));

import { assessmentPathOf, isPreparationSimulationType, mayUseGeneratedFallback, OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE, preparationSimulationTypes, PREPARATION_SIMULATION_TYPES } from '@/lib/simulation/preparation-simulation';
import { generatedFallbackAllowed, sourceExamItem } from '@/lib/exam-core/item-sourcing.service';
import { POST } from '@/app/api/simulation/attempts/route';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const body = (simulationType: string, timingMode = 'UNTIMED') => ({ studentId: UUID(1), examProfileId: UUID(2), examVersionId: UUID(3), simulationType, timingMode, language: 'es' });
const post = (payload: unknown) => POST({ json: async () => payload } as any);

beforeEach(() => {
  queryMock.mockReset();
  generatePracticeQuestionsMock.mockReset();
  bridgeMock.mockReset();
  resolveStudentConceptMock.mockReset();
  startSimulationAttemptMock.mockReset().mockResolvedValue({ examAttempt: { id: 'ea' }, simulationAttempt: { id: 'sa' }, planId: 'p' });
  eligibilityMock.mockReset().mockResolvedValue({ eligible: true, reasons: [] });
});

describe('B1 official mock boundary -- pure rules', () => {
  it('the direct path may start preparation simulations only', () => {
    expect([...PREPARATION_SIMULATION_TYPES]).toEqual(['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK']);
    expect(isPreparationSimulationType('FULL_MOCK')).toBe(false);
    expect(isPreparationSimulationType('MINI_MOCK')).toBe(true);
    expect(preparationSimulationTypes(['MINI_MOCK', 'FULL_MOCK', 'TOPIC_EXAM'])).toEqual(['MINI_MOCK', 'TOPIC_EXAM']);
    expect(preparationSimulationTypes(undefined)).toEqual(['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK']);
    expect(preparationSimulationTypes(['FULL_MOCK'])).toEqual([]);
  });

  it('an attempt is an official mock only through a frozen MOCK instance of full fidelity (B1-E)', () => {
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', formFrozen: true, formFidelity: 'FULL' })).toBe('OFFICIAL_MOCK');
    // a historical CHALLENGE or reduced MOCK stored as FULL_MOCK is read by its instance, not by its stored type
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'CHALLENGE' })).toBe('EXAM_CHALLENGE');
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', formFrozen: true, formFidelity: 'REDUCED' })).toBe('REDUCED_MOCK');
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK', formFrozen: false })).toBe('EXAM_PRACTICE');
    // an instance starts every mode with the stored type FULL_MOCK: the type alone says nothing
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: 'PRACTICE' })).toBe('EXAM_PRACTICE');
    // a FULL_MOCK with no instance behind it is NOT an official mock
    expect(assessmentPathOf({ simulationType: 'FULL_MOCK', instanceMode: null })).toBe('PREPARATION_SIMULATION');
    expect(assessmentPathOf({ simulationType: 'MINI_MOCK', instanceMode: null })).toBe('PREPARATION_SIMULATION');
  });

  it('generated fallback is never allowed for an official-format attempt', () => {
    expect(mayUseGeneratedFallback({ simulationType: 'FULL_MOCK', instanceMode: 'MOCK' })).toBe(false);
    expect(mayUseGeneratedFallback({ simulationType: 'FULL_MOCK', instanceMode: 'CHALLENGE' })).toBe(false);
    expect(mayUseGeneratedFallback({ simulationType: 'FULL_MOCK', instanceMode: null })).toBe(false);
    // B1-D: no exception -- a stored FULL_MOCK never gets generated content, even a historical practice-instance row
    expect(mayUseGeneratedFallback({ simulationType: 'FULL_MOCK', instanceMode: 'PRACTICE' })).toBe(false);
    // preparation: adaptive content is legitimate
    expect(mayUseGeneratedFallback({ simulationType: 'EXAM_PRACTICE', instanceMode: 'PRACTICE' })).toBe(true);
    expect(mayUseGeneratedFallback({ simulationType: 'MINI_MOCK', instanceMode: null })).toBe(true);
    expect(mayUseGeneratedFallback({ simulationType: 'TOPIC_EXAM', instanceMode: null })).toBe(true);
  });
});

describe('B1 official mock boundary -- POST /api/simulation/attempts (legacy direct path)', () => {
  it('refuses FULL_MOCK with a clear code and the canonical path, and creates nothing', async () => {
    for (const timing of ['UNTIMED', 'OFFICIAL_SIMULATION_TIMED']) {
      const res = await post(body('FULL_MOCK', timing));
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe(OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE);
      expect(json.data).toEqual({ canonicalPath: '/api/exams/instances', allowedSimulationTypes: ['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK'] });
    }
    expect(startSimulationAttemptMock).not.toHaveBeenCalled();
    expect(eligibilityMock).not.toHaveBeenCalled();
  });

  it('still starts preparation simulations exactly as before', async () => {
    for (const type of ['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']) {
      const res = await post(body(type));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    }
    expect(startSimulationAttemptMock).toHaveBeenCalledTimes(3);
    expect(startSimulationAttemptMock.mock.calls.map((c) => c[0].simulationType)).toEqual(['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']);
  });

  it('input validation is unchanged (an unknown type is still INVALID_INPUT, not the boundary error)', async () => {
    const res = await post(body('OFFICIAL'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_INPUT');
  });

  it('the canonical official path is untouched: exam instances still freeze the form before starting', () => {
    const instance = read('src/lib/exam-core/exam-instance.service.ts');
    expect(instance).toMatch(/const form = instance\.form \?\? \(await freezeForm\(instance\)\);/);
    expect(instance).toMatch(/simulationType: decision\.type,/);
    // a non-practice instance never leaves a position to be generated
    expect(instance).toMatch(/instance\.mode !== 'PRACTICE'\) preset\[index\] = \{ status: 'EXCLUDED'/);
  });

  it('the Student panel that calls the direct path no longer offers a full mock', () => {
    const page = read('src/app/dashboard/exam-prep/[examProfileId]/page.tsx');
    expect(page).toMatch(/allowedTypes=\{preparationSimulationTypes\(/);
  });
});

const target = { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null };
const source = () => sourceExamItem({ attemptId: 'att-1', studentId: 'stu-1', target, excludeApprovedItemIds: [], preferredStimulusKey: null, language: 'es' });

/** No bank item for the target; the attempt row is what the boundary reads. */
function attemptIs(row: { simulation_type: string; instance_mode: string | null } | null) {
  queryMock.mockImplementation(async (sql: string) => {
    if (/FROM simulation_attempts sa LEFT JOIN exam_instances i/.test(sql) && /sa\.simulation_type/.test(sql)) return { rows: row ? [row] : [] };
    return { rows: [] };
  });
}

describe('B1 official mock boundary -- item sourcing', () => {
  it('a FULL_MOCK with no frozen instance never receives learner-generated content', async () => {
    attemptIs({ simulation_type: 'FULL_MOCK', instance_mode: null });
    expect(await generatedFallbackAllowed('att-1')).toBe(false);
    expect(await source()).toEqual({ outcome: 'UNAVAILABLE', reason: 'NO_ITEM_GENERATED' });
    expect(generatePracticeQuestionsMock).not.toHaveBeenCalled();
    expect(bridgeMock).not.toHaveBeenCalled();
  });

  it('a MOCK / CHALLENGE instance never receives learner-generated content', async () => {
    for (const instance_mode of ['MOCK', 'CHALLENGE']) {
      attemptIs({ simulation_type: 'FULL_MOCK', instance_mode });
      expect(await source()).toEqual({ outcome: 'UNAVAILABLE', reason: 'NO_ITEM_GENERATED' });
    }
    expect(generatePracticeQuestionsMock).not.toHaveBeenCalled();
  });

  it('revised OE-014: NO standardized exam attempt reaches the generator -- a preparation simulation without a certified item is unavailable', async () => {
    for (const row of [{ simulation_type: 'MINI_MOCK', instance_mode: null }, { simulation_type: 'TOPIC_EXAM', instance_mode: null }, { simulation_type: 'EXAM_PRACTICE', instance_mode: 'PRACTICE' }]) {
      attemptIs(row);
      bridgeMock.mockResolvedValue(null);
      // the Certified Exam Bank had nothing: NOT_READY for this position, and the generator path is never entered
      expect(await source()).toEqual({ outcome: 'UNAVAILABLE', reason: 'NO_ITEM_GENERATED' });
    }
    expect(bridgeMock).not.toHaveBeenCalled();
  });

  it('an attempt that cannot be read is treated as before B1 (only a positively identified official attempt is refused)', async () => {
    attemptIs(null);
    expect(await generatedFallbackAllowed('att-x')).toBe(true);
    queryMock.mockRejectedValue(new Error('db down'));
    expect(await generatedFallbackAllowed('att-x')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* B1-C -- the frozen invariant: FULL_MOCK => frozen exam instance      */
/* ------------------------------------------------------------------ */

import { fullMockHasFrozenInstance } from '@/lib/simulation/preparation-simulation';

describe('B1-C official mock invariant -- FULL_MOCK => frozen exam instance', () => {
  it('pure rule: a FULL_MOCK needs both the instance and its frozen form; other types need neither', () => {
    expect(fullMockHasFrozenInstance({ simulationType: 'FULL_MOCK', examInstanceId: 'inst-1', hasFrozenForm: true })).toBe(true);
    expect(fullMockHasFrozenInstance({ simulationType: 'FULL_MOCK', examInstanceId: null, hasFrozenForm: true })).toBe(false);
    expect(fullMockHasFrozenInstance({ simulationType: 'FULL_MOCK', examInstanceId: 'inst-1', hasFrozenForm: false })).toBe(false);
    expect(fullMockHasFrozenInstance({ simulationType: 'FULL_MOCK', hasFrozenForm: false })).toBe(false);
    for (const simulationType of ['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']) expect(fullMockHasFrozenInstance({ simulationType, hasFrozenForm: false })).toBe(true);
  });

  it('the single start function enforces it before reading or writing anything', () => {
    const svc = read('src/lib/simulation/attempt.service.ts');
    const start = svc.slice(svc.indexOf('export async function startSimulationAttempt('));
    const guard = start.indexOf('throw new FullMockRequiresExamInstanceError()');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(start.indexOf('db.query('));
    expect(start).toMatch(/instanceStartViolation\(\{ simulationType: params\.simulationType, examInstanceId: params\.examInstanceId, examInstanceMode: params\.examInstanceMode, hasFrozenForm: !!params\.presetItems, verifiedFullFidelity: params\.verifiedFullFidelity \}\)/);
  });

  it('only the exam instance starts a FULL_MOCK, and it passes its id and its frozen form', () => {
    const instance = read('src/lib/exam-core/exam-instance.service.ts');
    const start = instance.slice(instance.indexOf('export async function startExamInstance('), instance.indexOf('export async function deleteExamInstance('));
    expect(start).toMatch(/simulationType: decision\.type,/);
    expect(start).toMatch(/verifiedFullFidelity: decision\.type === 'FULL_MOCK'/);
    expect(start).toMatch(/presetItems: \(plan\) => presetFromForm\(instance, form, plan\)/);
    expect(start).toMatch(/examInstanceId: instance\.id/);
    expect(start).toMatch(/examInstanceMode: instance\.mode/);
    // no other module starts an attempt with a literal FULL_MOCK
    const literal = /startSimulationAttempt\(\{[^}]*simulationType: 'FULL_MOCK'/;
    for (const f of ['src/app/api/simulation/attempts/route.ts', 'src/lib/student/teacher-intervention-execution.service.ts']) expect(literal.test(read(f)), f).toBe(false);
  });

  it('a Teacher-assigned FULL_MOCK is an official mock: created as a MOCK exam instance and started through it', () => {
    const svc = read('src/lib/student/teacher-intervention-execution.service.ts');
    const dispatch = svc.slice(svc.indexOf('export async function startInterventionExamAttempt('), svc.indexOf('export async function startOfficialMockForIntervention('));
    expect(dispatch).toMatch(/if \(!isPreparationSimulationType\(p\.simulationType\)\) return startOfficialMockForIntervention\(/);
    const helper = svc.slice(svc.indexOf('export async function startOfficialMockForIntervention('), svc.indexOf('export async function startOfficialMockForIntervention(') + 1400);
    expect(helper).toMatch(/createExamInstance\(\{[^}]*mode: 'MOCK' \}\)/);
    expect(helper).toMatch(/startExamInstance\(instance\.id/);
    // no official form -> not startable; never downgraded to a learner-adaptive simulation
    expect(helper).toMatch(/if \(err instanceof ExamInstanceError\) throw new StudentInterventionNotStartableError\(`official mock not available: \$\{err\.code\}`\)/);
    expect(helper).not.toMatch(/startSimulationAttempt|generatePracticeQuestions/);
    // the Teacher execution uses the dispatch, after the unconditional eligibility gate
    const exec = svc.slice(svc.indexOf('async function startExamReinforcementExecution'));
    expect(exec.indexOf('startInterventionExamAttempt(')).toBeGreaterThan(exec.indexOf('if (!eligibility.eligible)'));
    expect(exec.slice(0, exec.indexOf('\nexport async function startTeacherInterventionExecution'))).not.toMatch(/await startSimulationAttempt\(/);
  });

  it('a Teacher-assigned preparation assessment is NOT a FULL_MOCK: it keeps the direct preparation path', () => {
    const svc = read('src/lib/student/teacher-intervention-execution.service.ts');
    const dispatch = svc.slice(svc.indexOf('export async function startInterventionExamAttempt('), svc.indexOf('export async function startOfficialMockForIntervention('));
    const direct = dispatch.slice(dispatch.indexOf('const { simulationAttempt } = await startSimulationAttempt({'));
    expect(direct).toMatch(/simulationType: p\.simulationType,/);
    expect(direct).not.toMatch(/examInstanceId|'FULL_MOCK'/);
    for (const type of ['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK']) expect(assessmentPathOf({ simulationType: type, instanceMode: null })).toBe('PREPARATION_SIMULATION');
  });

  it('historical attempts are read as before: no migration and no rewrite of stored simulation types', () => {
    for (const f of ['src/lib/simulation/attempt.service.ts', 'src/lib/student/teacher-intervention-execution.service.ts', 'src/lib/simulation/preparation-simulation.ts']) {
      expect(read(f), f).not.toMatch(/UPDATE simulation_attempts SET simulation_type|UPDATE teacher_interventions SET simulation_type/);
    }
  });
});

describe('B1-D -- the direct route cannot request EXAM_PRACTICE', () => {
  it('a client-submitted EXAM_PRACTICE is INVALID_INPUT and starts nothing', async () => {
    const res = await post(body('EXAM_PRACTICE'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_INPUT');
    expect(startSimulationAttemptMock).not.toHaveBeenCalled();
  });
});

describe('B1-E -- the direct route cannot request any instance-derived type', () => {
  it('EXAM_CHALLENGE and REDUCED_MOCK are INVALID_INPUT and start nothing', async () => {
    for (const type of ['EXAM_CHALLENGE', 'REDUCED_MOCK']) {
      const res = await post(body(type));
      expect(res.status, type).toBe(400);
      expect((await res.json()).error, type).toBe('INVALID_INPUT');
    }
    expect(startSimulationAttemptMock).not.toHaveBeenCalled();
  });
});
