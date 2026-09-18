import type { DiagnosisResultType, GapType } from '@/lib/diagnostics/types';

export type InterventionType = 'EXPLAIN' | 'WORKED_EXAMPLE' | 'GUIDED_PRACTICE' | 'CONTEXTUAL_HELP' | 'INDEPENDENT_PRACTICE' | 'PROVE';

export interface InterventionPolicyRules {
  chains: Record<GapType, InterventionType[]>;
  insufficientEvidenceChain: InterventionType[];
  mixedTieBreakPriority: GapType[];
}

export interface InterventionPolicyVersion {
  id: string;
  version: number;
  rules: InterventionPolicyRules;
  status: 'ACTIVE' | 'RETIRED';
  effectiveFrom: string;
  createdAt: string;
}

export interface InterventionRecommendation {
  primary: InterventionType;
  chain: InterventionType[];
  rationale: string[];
  gapTypeConsidered: DiagnosisResultType;
}

export interface FrameworkIdentity {
  academicOrganizationId: string;
  academicOrganizationName: string;
  academicProgrammeId: string;
  programmeType: 'CURRICULUM' | 'ASSESSMENT_FRAMEWORK' | 'ADMISSION_EXAM';
  examDefinitionId?: string;
  examVersionId?: string;
  examFamily?: string;
}

export type AssistanceLevel = 'NONE' | 'HINT' | 'MULTIPLE_HINTS' | 'TUTOR_GUIDANCE' | 'TUTOR_EXPLANATION' | 'WORKED_EXAMPLE' | 'OTHER';

export const DEFAULT_ASSISTANCE_LEVEL_BY_INTERVENTION: Record<InterventionType, AssistanceLevel> = {
  EXPLAIN: 'WORKED_EXAMPLE',
  WORKED_EXAMPLE: 'WORKED_EXAMPLE',
  GUIDED_PRACTICE: 'TUTOR_GUIDANCE',
  CONTEXTUAL_HELP: 'HINT',
  INDEPENDENT_PRACTICE: 'NONE',
  PROVE: 'NONE',
};

export interface InterventionSession {
  id: string;
  studentId: string;
  diagnosisId: string;
  interventionPolicyVersionId: string;
  interventionType: InterventionType;
  gapType: DiagnosisResultType;
  reasonCodes: string[];
  frameworkContext: FrameworkIdentity | null;
  assistanceLevel: AssistanceLevel | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  createdAt: string;
  completedAt: string | null;
}

export interface InterventionAttempt {
  id: string;
  interventionSessionId: string;
  attemptNumber: number;
  evidenceId: string;
  outcome: 'correct' | 'incorrect' | 'partial';
  feedback: Record<string, unknown>;
  createdAt: string;
}

export interface CommandTermInterpretation {
  id: string;
  commandTermId: string;
  academicProgrammeId: string | null;
  expectedStructure: string;
  rubricNotes: string | null;
  commonFailurePatterns: unknown[];
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
}
