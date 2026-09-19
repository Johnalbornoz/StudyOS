export type SimulationType = 'TOPIC_EXAM' | 'DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK';
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
