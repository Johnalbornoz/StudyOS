/**
 * FULL_MOCK       a VERIFIED COMPLETE official-format mock: a MOCK exam instance whose frozen form has FULL fidelity
 *                 and official difficulty. Nothing else writes it.
 * REDUCED_MOCK    (B1-E) a frozen MOCK following the official model, smaller than the complete official form.
 * EXAM_CHALLENGE  (B1-E) a frozen exam-instance assessment deliberately more demanding than the official exam.
 * EXAM_PRACTICE   (B1-D) an exam-instance-based preparation assessment over the instance's selected components /
 *                 positions. May be full-length; never official.
 * PREPARATION_MOCK (Track B, 2026-10-15) a frozen MOCK with the complete official size whose official structure cannot be
 *                 verified (no published per-area time / distribution), started only under a recorded governance
 *                 authorisation (full-mock-authorization.ts) and presented as StudyUs preparation, never official.
 * TOPIC_EXAM / DOMAIN_EXAM / MINI_MOCK   preparation simulations a client may request directly.
 *
 * The five instance types are DERIVED by the exam-instance start service; no client requests them.
 */
export type SimulationType = 'TOPIC_EXAM' | 'DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK' | 'EXAM_PRACTICE' | 'EXAM_CHALLENGE' | 'REDUCED_MOCK' | 'PREPARATION_MOCK';

/** Types only the exam-instance start service derives and writes. */
export const INSTANCE_DERIVED_SIMULATION_TYPES = ['FULL_MOCK', 'REDUCED_MOCK', 'PREPARATION_MOCK', 'EXAM_CHALLENGE', 'EXAM_PRACTICE'] as const;
export type TimingMode = 'UNTIMED' | 'TRAINING_TIMED' | 'OFFICIAL_SIMULATION_TIMED';
export type SimulationAttemptStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED';

export interface SimulationEligibility {
  simulationType: SimulationType;
  eligible: boolean;
  reasons: string[];
  structuralReadiness?: { ready: boolean; reasons: string[]; miniMockObjectiveIds: string[] };
}

export interface SimulationPlanTarget {
  blueprintObjectiveTargetId: string;
  assessmentComponentId: string;
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
  reasoningRequirement: string | null;
  commandTermId: string | null;
  allocatedSeconds: number | null;
}

/** Track B: one section of a plan = one assessment component, contiguous in `selectedTargets`. */
export interface SimulationPlanSection {
  componentId: string;
  key: string;
  name: string;
  order: number;
  startIndex: number;
  endIndex: number;
  /** Section time limit; null when untimed or not configured. */
  durationSeconds: number | null;
}

export interface SimulationPlan {
  id: string;
  studentId: string;
  examVersionId: string;
  blueprintId: string | null;
  simulationType: SimulationType;
  readinessSnapshotId: string | null;
  selectedTargets: SimulationPlanTarget[];
  timingAllocation: { mode: TimingMode; totalSeconds: number | null };
  toolRules: Record<string, Record<string, unknown> | null>;
  scoringConfiguration: { scoringModelId: string | null };
  /** Track B: present on every plan built after Track B; derived on read for older plans. */
  sections?: SimulationPlanSection[];
  createdAt: string;
}

export interface SimulationAttempt {
  id: string;
  examAttemptId: string;
  studentId: string;
  examProfileId: string;
  examVersionId: string;
  simulationType: SimulationType;
  simulationPlanId: string;
  readinessSnapshotId: string | null;
  timingMode: TimingMode;
  pauseAllowed: boolean;
  status: SimulationAttemptStatus;
  pausedAt: string | null;
  resumedAt: string | null;
  elapsedSecondsAtPause: number | null;
  navigationState: Record<string, unknown>;
  language: string;
  timezone: string | null;
  createdAt: string;
}
