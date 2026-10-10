/**
 * B1 -- the official mock boundary (pure rules).
 *
 * An OFFICIAL MOCK is: official blueprint + frozen item selection + approved / eligible content + official
 * timing and policies. Exactly one path gives all four: an exam instance (`exam_instances`, mode MOCK or
 * CHALLENGE) whose form is frozen before the attempt starts.
 *
 * The legacy direct start (`POST /api/simulation/attempts`) is a PREPARATION SIMULATION: it builds a plan at
 * start, sources items lazily and may fall back to content generated for the learner's own concepts. That is
 * legitimate preparation practice (Exam Preparation may adapt to the learner), and it is never an official
 * mock. So:
 *   - the direct path does not start a FULL_MOCK;
 *   - a FULL_MOCK never receives learner-generated fallback content, whatever started it.
 *
 * Stored types (B1-E): PRACTICE -> EXAM_PRACTICE, CHALLENGE -> EXAM_CHALLENGE, MOCK -> FULL_MOCK (verified FULL
 * fidelity) or REDUCED_MOCK. Before B1-D / B1-E every instance mode stored FULL_MOCK, so a historical attempt may
 * still carry it: `assessmentPathOf` reads the linked instance and classifies those rows correctly too.
 */
import type { AssessmentPath } from '@/lib/assessment-foundation/families';

export const SIMULATION_START_TYPES = ['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'] as const;
export type SimulationStartType = (typeof SIMULATION_START_TYPES)[number];

/** What the direct (non-instance) path may start. */
export const PREPARATION_SIMULATION_TYPES = ['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK'] as const satisfies readonly SimulationStartType[];
export type PreparationSimulationType = (typeof PREPARATION_SIMULATION_TYPES)[number];

/** Error code of the direct path when asked for an official-format full mock. */
export const OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE = 'OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE' as const;

export const isPreparationSimulationType = (type: string): type is PreparationSimulationType => (PREPARATION_SIMULATION_TYPES as readonly string[]).includes(type);

/** The types the direct path may OFFER, from a version's delivery policy (or every type when it states none). */
export function preparationSimulationTypes<T extends string>(allowed: readonly T[] | undefined | null): T[] {
  const source = (allowed ?? SIMULATION_START_TYPES) as readonly string[];
  return source.filter(isPreparationSimulationType) as T[];
}

export interface AttemptPathFacts {
  /** `simulation_attempts.simulation_type`. */
  simulationType: string | null | undefined;
  /** `exam_instances.mode` of the instance the attempt belongs to; null when it was started directly. */
  instanceMode: string | null | undefined;
  /** Is the instance's form frozen (`form_frozen_at`)? */
  formFrozen?: boolean;
  /** Length fidelity recorded on the instance's frozen form (`form.fidelity`), for classifying historical MOCK attempts. */
  formFidelity?: 'FULL' | 'REDUCED' | null;
}

/**
 * What an attempt IS (B1-E).
 *
 *   OFFICIAL_MOCK            a verified complete official-format mock (stored FULL_MOCK since B1-E)
 *   REDUCED_MOCK             a frozen MOCK smaller than the complete official form
 *   EXAM_CHALLENGE           a frozen instance deliberately harder than the official exam
 *   EXAM_PRACTICE            a practice exam instance
 *   PREPARATION_SIMULATION   the direct path
 *
 * New attempts carry their own stored type. A HISTORICAL attempt stored as FULL_MOCK (every instance mode
 * wrote it before B1-D / B1-E) is classified from its linked exam instance: PRACTICE -> EXAM_PRACTICE,
 * CHALLENGE -> EXAM_CHALLENGE, and a MOCK by the length fidelity recorded on its frozen form. Nothing is
 * rewritten; a historical MOCK is called OFFICIAL_MOCK only when its form says FULL.
 */
export function assessmentPathOf(f: AttemptPathFacts): AssessmentPath {
  if (f.simulationType === 'EXAM_PRACTICE' || f.instanceMode === 'PRACTICE') return 'EXAM_PRACTICE';
  if (f.simulationType === 'EXAM_CHALLENGE' || f.instanceMode === 'CHALLENGE') return 'EXAM_CHALLENGE';
  if (f.simulationType === 'REDUCED_MOCK') return 'REDUCED_MOCK';
  if (f.instanceMode === 'MOCK') {
    if (f.formFrozen === false) return 'EXAM_PRACTICE';
    return f.formFidelity === 'REDUCED' ? 'REDUCED_MOCK' : 'OFFICIAL_MOCK';
  }
  if (f.instanceMode) return 'EXAM_PRACTICE';
  return 'PREPARATION_SIMULATION';
}

/**
 * May an unfilled position of this attempt receive content generated for the learner?
 *
 * B1-E (final): NEVER for a frozen mock-format attempt -- FULL_MOCK, REDUCED_MOCK, EXAM_CHALLENGE -- with no
 * exception, and never for a MOCK / CHALLENGE instance whatever its stored type. A reduced mock keeps the same
 * content governance as a full one. Only preparation may: EXAM_PRACTICE and the three direct types.
 */
export function mayUseGeneratedFallback(f: AttemptPathFacts): boolean {
  if (f.simulationType === 'FULL_MOCK' || f.simulationType === 'REDUCED_MOCK' || f.simulationType === 'EXAM_CHALLENGE') return false;
  if (f.instanceMode === 'MOCK' || f.instanceMode === 'CHALLENGE') return false;
  return true;
}

/**
 * B1-D -- the stored type by instance mode ALONE. Since B1-E a MOCK also depends on the verified fidelity of
 * its form, which `deriveInstanceAttemptType` (exam-core/form-fidelity) decides; this returns the type of
 * the two modes that need no fidelity, and null for a MOCK.
 */
export function attemptTypeForInstanceMode(mode: string): 'EXAM_PRACTICE' | 'EXAM_CHALLENGE' | null {
  return mode === 'PRACTICE' ? 'EXAM_PRACTICE' : mode === 'CHALLENGE' ? 'EXAM_CHALLENGE' : null;
}

export const EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE = 'EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE' as const;
export const INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE = 'INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE' as const;

export type InstanceStartViolation = typeof OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE | typeof EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE | typeof INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE;

/**
 * The start invariant, by stored type (B1-E):
 *   FULL_MOCK       -> a MOCK instance + its frozen form + VERIFIED FULL fidelity
 *   REDUCED_MOCK    -> a MOCK instance + its frozen form
 *   EXAM_CHALLENGE  -> a CHALLENGE instance + its frozen form
 *   EXAM_PRACTICE   -> a PRACTICE instance
 *   any other type  -> no instance involved
 * Returns the violation code, or null. A CHALLENGE or PRACTICE instance can never produce a FULL_MOCK.
 */
export function instanceStartViolation(f: { simulationType: string; examInstanceId?: string | null; examInstanceMode?: string | null; hasFrozenForm: boolean; verifiedFullFidelity?: boolean }): InstanceStartViolation | null {
  const frozenInstance = (mode: string) => !!f.examInstanceId && f.hasFrozenForm && f.examInstanceMode === mode;
  if (f.simulationType === 'FULL_MOCK') return frozenInstance('MOCK') && f.verifiedFullFidelity === true ? null : OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE;
  if (f.simulationType === 'REDUCED_MOCK') return frozenInstance('MOCK') ? null : INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE;
  if (f.simulationType === 'EXAM_CHALLENGE') return frozenInstance('CHALLENGE') ? null : INSTANCE_TYPE_REQUIRES_EXAM_INSTANCE;
  if (f.simulationType === 'EXAM_PRACTICE') return f.examInstanceId && f.examInstanceMode === 'PRACTICE' ? null : EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE;
  return null;
}

/**
 * B1-C -- kept for callers / tests of the original rule: a FULL_MOCK needs the exam instance that starts it and
 * that instance's frozen form. `instanceStartViolation` is the complete (B1-D) rule.
 */
export function fullMockHasFrozenInstance(f: { simulationType: string; examInstanceId?: string | null; hasFrozenForm: boolean }): boolean {
  if (f.simulationType !== 'FULL_MOCK') return true;
  return !!f.examInstanceId && f.hasFrozenForm;
}
