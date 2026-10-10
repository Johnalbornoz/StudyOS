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
 *   - whatever started an attempt, a FULL_MOCK with no frozen instance, and any MOCK / CHALLENGE instance,
 *     never receives learner-generated fallback content.
 *
 * Note: an exam instance starts its attempt with the stored type FULL_MOCK for every instance mode (the
 * instance, not the type, carries the semantics). `simulation_type` alone therefore says nothing about
 * official fidelity; `assessmentPathOf` does.
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
 * May an unfilled position of this attempt receive content generated for the learner? Never for an
 * official-format attempt: a MOCK / CHALLENGE instance, or a FULL_MOCK that has no instance behind it.
 */
export function mayUseGeneratedFallback(f: AttemptPathFacts): boolean {
  if (f.instanceMode === 'MOCK' || f.instanceMode === 'CHALLENGE') return false;
  if (!f.instanceMode && f.simulationType === 'FULL_MOCK') return false;
  return true;
}

/**
 * B1-C -- the invariant at the single place an attempt is started: a FULL_MOCK needs the exam instance that
 * starts it AND that instance's frozen form. Every other type is unaffected.
 */
export function fullMockHasFrozenInstance(f: { simulationType: string; examInstanceId?: string | null; hasFrozenForm: boolean }): boolean {
  if (f.simulationType !== 'FULL_MOCK') return true;
  return !!f.examInstanceId && f.hasFrozenForm;
}
