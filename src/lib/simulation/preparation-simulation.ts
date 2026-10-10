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
 * Stored types (B1-D): a MOCK / CHALLENGE instance stores FULL_MOCK; a PRACTICE instance stores EXAM_PRACTICE.
 * Before B1-D every instance mode stored FULL_MOCK, so a historical PRACTICE-instance attempt may still carry
 * it: `assessmentPathOf` reads the instance mode first and therefore classifies those rows correctly too.
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
}

/** What an attempt IS. An official mock only through a frozen MOCK / CHALLENGE instance. */
export function assessmentPathOf(f: AttemptPathFacts): AssessmentPath {
  if (f.instanceMode === 'MOCK' || f.instanceMode === 'CHALLENGE') return f.formFrozen === false ? 'EXAM_PRACTICE' : 'OFFICIAL_MOCK';
  if (f.instanceMode) return 'EXAM_PRACTICE';
  return 'PREPARATION_SIMULATION';
}

/**
 * May an unfilled position of this attempt receive content generated for the learner?
 *
 * B1-D (final): NEVER for a FULL_MOCK -- no exception, whatever instance (or none) is behind it -- and never
 * for a MOCK / CHALLENGE instance. Preparation attempts (EXAM_PRACTICE, TOPIC_EXAM, DOMAIN_EXAM, MINI_MOCK)
 * may, under the preparation rule. A historical PRACTICE-instance attempt that is still stored as FULL_MOCK
 * is read as before; while open it simply gets no generated fallback.
 */
export function mayUseGeneratedFallback(f: AttemptPathFacts): boolean {
  if (f.simulationType === 'FULL_MOCK') return false;
  if (f.instanceMode === 'MOCK' || f.instanceMode === 'CHALLENGE') return false;
  return true;
}

/** B1-D -- what the exam-instance start flow stores, by instance mode. The only writer of EXAM_PRACTICE. */
export function attemptTypeForInstanceMode(mode: string): 'FULL_MOCK' | 'EXAM_PRACTICE' {
  return mode === 'PRACTICE' ? 'EXAM_PRACTICE' : 'FULL_MOCK';
}

export const EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE = 'EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE' as const;

/**
 * B1-D -- the start invariant, by stored type:
 *   FULL_MOCK      -> a MOCK / CHALLENGE exam instance AND its frozen form
 *   EXAM_PRACTICE  -> a PRACTICE exam instance (the only flow that may write it)
 *   any other type -> no instance involved
 * Returns the violation code, or null.
 */
export function instanceStartViolation(f: { simulationType: string; examInstanceId?: string | null; examInstanceMode?: string | null; hasFrozenForm: boolean }): typeof OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE | typeof EXAM_PRACTICE_REQUIRES_EXAM_INSTANCE | null {
  if (f.simulationType === 'FULL_MOCK') return f.examInstanceId && f.hasFrozenForm && (f.examInstanceMode === 'MOCK' || f.examInstanceMode === 'CHALLENGE') ? null : OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE;
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
