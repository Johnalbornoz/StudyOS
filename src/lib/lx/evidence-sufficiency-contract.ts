/**
 * LX-1D (repaired in LX-1R) -- EVIDENCE SUFFICIENCY & QUESTION-COUNT CONTRACT.
 *
 * Answers "how much evidence does StudyUS need?" using CANONICAL policy
 * ONLY. When a canonical authority does not state a count, the correct
 * result is UNRESOLVED -- never an invented heuristic.
 *
 * WHAT THIS MODULE IS ALLOWED TO DO:
 *   - Read `mastery_policies.minimum_evidence_count` and
 *     `minimum_independent_evidence_count` (Phase 2.2 canonical).
 *   - Read the learner's already-counted evidence
 *     (knowledge-state.service.evaluateEvidenceSufficiency).
 *   - Subtract the two ("remaining gap") -- arithmetic over canonical
 *     values, clamped to >= 0 (a gap is never negative; this is not a
 *     pedagogical floor).
 *   - Pass through canonical facts: EvidenceMode, TargetDimension,
 *     assessment profile id.
 *   - Record the CURRENT quiz-generation execution envelope / per-mode
 *     shape as EXISTING_EXECUTION_CONSTRAINT -- explicitly NOT an
 *     evidence requirement.
 *
 * WHAT THIS MODULE MUST NEVER DO:
 *   - Invent a per-activity count (no RETAIN=1, TRANSFER=1, DIAGNOSE=2,
 *     ASSESS=conceptCount*2, no coverageTargets, no max(1,...) floor).
 *   - Reinterpret a legacy execution clamp as pedagogical truth.
 *   - Define a new numeric threshold of any kind.
 *   - Grade, generate, read the DB, or become a mastery engine.
 */

import type { ActivityType, EvidenceMode } from '@/lib/activity-taxonomy';
import type { TargetDimension } from '@/lib/adaptive-learning-policy';
import type { MasteryPolicy, EvidenceSufficiency } from '@/services/knowledge-state.service';
import type { EvidenceDimension } from '@/services/quiz-generation.service';

/** Bumped from 1 -> 2 in LX-1R (invented counts removed; UNRESOLVED added). */
export const EVIDENCE_SUFFICIENCY_CONTRACT_VERSION = 2 as const;

/**
 * Purpose the evidence is gathered FOR -- a projection of the canonical
 * `ActivityType` (grouping mirrors EVIDENCE_MODE_BY_ACTIVITY). Not a
 * new taxonomy; only used to name which canonical authority owns the
 * count when it is UNRESOLVED.
 */
export type EvidencePurpose = 'PRACTICE' | 'PROVE' | 'RETAIN' | 'TRANSFER' | 'DIAGNOSE' | 'ASSESS';

export function evidencePurposeForActivity(activityType: ActivityType): EvidencePurpose {
  switch (activityType) {
    case 'PRACTICE':
    case 'REVIEW':
    case 'REMEDIATION':
      return 'PRACTICE';
    case 'SOLO_CHECK':
    case 'SOLO_VERIFY':
      return 'PROVE';
    case 'RETENTION_CHECK':
      return 'RETAIN';
    case 'TRANSFER':
      return 'TRANSFER';
    case 'DIAGNOSTIC_CHECK':
      return 'DIAGNOSE';
    case 'CUMULATIVE_ASSESSMENT':
    case 'MOCK_EXAM':
      return 'ASSESS';
    default: {
      const _exhaustive: never = activityType;
      return _exhaustive;
    }
  }
}

/**
 * EXISTING_EXECUTION_CONSTRAINT -- the hard question-count envelope the
 * CURRENT quiz-generation route/UI already enforce
 * (`Math.max(1, Math.min(20, ...))` in generate-and-take). This is
 * infrastructure compatibility, NOT an evidence requirement.
 */
export const CURRENT_GENERATION_QUESTION_ENVELOPE = { min: 1, max: 20 } as const;

/**
 * EXISTING_EXECUTION_CONSTRAINT -- per-activity question shapes the
 * CURRENT route/UI already impose. Verified against
 * `src/app/api/quizzes/generate-and-take/route.ts` +
 * `src/app/dashboard/quiz/page.tsx` (LX-0 audit):
 *   - quick_check (SOLO_CHECK): forced to exactly 6.
 *   - retention_check (RETENTION_CHECK): dedicated 6-question fast path.
 *   - diagnostic_check (DIAGNOSTIC_CHECK): clamped to [2, 4].
 * These are legacy execution clamps. They are surfaced here so LX-4 can
 * reconcile them -- they must never be read as evidence sufficiency.
 */
export const CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY: Partial<
  Record<ActivityType, { min: number; max: number }>
> = {
  SOLO_CHECK: { min: 6, max: 6 },
  RETENTION_CHECK: { min: 6, max: 6 },
  DIAGNOSTIC_CHECK: { min: 2, max: 4 },
};

/** The canonical authority that would have to state a count, and does not today. */
export type UnresolvedCountOwner =
  | 'PHASE_6_RETENTION'
  | 'PHASE_7_TRANSFER'
  | 'COGNITIVE_DIAGNOSIS'
  | 'ASSESSMENT_BLUEPRINT';

export type QuestionCountDecision =
  | {
      status: 'DETERMINED';
      /**
       * The canonical evidence GAP: `policy minimum - what the learner
       * already has`, clamped to >= 0. May be 0 (canonical policy says
       * no further evidence is needed). Purely arithmetic over canonical
       * values -- no floor.
       */
      pedagogicalRequirement: number;
      /**
       * EXISTING_EXECUTION_CONSTRAINT -- the generator cannot launch an
       * activity with fewer than this many questions. Reported SEPARATELY
       * so a `pedagogicalRequirement` of 0 is never silently rounded up
       * to "1 question needed for mastery".
       */
      executionMinimum: number;
      source: 'MASTERY_POLICY_TOTAL_EVIDENCE_GAP' | 'MASTERY_POLICY_INDEPENDENT_EVIDENCE_GAP';
    }
  | {
      status: 'UNRESOLVED';
      reason: string;
      owner: UnresolvedCountOwner;
    };

export interface EvidenceRequirementInputs {
  activityType: ActivityType;
  /** activity-taxonomy.evidenceModeForActivity(activityType) -- passed in, never recomputed. */
  evidenceMode: EvidenceMode;
  /** Phase 4 canonical -- LearningDecision.targetDimension. */
  targetDimension: TargetDimension;
  /** Phase 2.2 canonical -- the single active mastery_policies row. */
  masteryPolicy: MasteryPolicy;
  /** Phase 2.2 canonical -- what the learner has ALREADY accumulated for this concept. Optional for a first activity. */
  currentSufficiency?: EvidenceSufficiency | null;
  /** assessment-profiles.getAssessmentProfile(activityType). Non-null only for CUMULATIVE_ASSESSMENT / MOCK_EXAM. */
  assessmentProfileId?: 'CUMULATIVE_ASSESSMENT' | 'MOCK_EXAM' | null;
}

export interface EvidenceRequirement {
  contractVersion: typeof EVIDENCE_SUFFICIENCY_CONTRACT_VERSION;
  purpose: EvidencePurpose;

  // --- canonical facts (pass-through, never decisions) ---
  evidenceMode: EvidenceMode;
  targetDimension: TargetDimension;
  /** Strict projection of the canonical TargetDimension onto KS dimension name(s). `[]` for relational targets (MISCONCEPTION/PREREQUISITE/VALIDATION/EXAM_READINESS) -- no single KS dimension. */
  requiredDimensions: EvidenceDimension[];
  /** true iff EvidenceMode is INDEPENDENT or ASSESSMENT -- verbatim from activity-taxonomy. */
  independentEvidenceRequired: boolean;
  canonicalMinimumEvidenceCount: number;
  canonicalMinimumIndependentEvidenceCount: number;
  currentEvidenceCount: number | null;
  currentIndependentEvidenceCount: number | null;
  assessmentProfileId: 'CUMULATIVE_ASSESSMENT' | 'MOCK_EXAM' | null;

  // --- the count decision ---
  questionCount: QuestionCountDecision;

  // --- EXISTING_EXECUTION_CONSTRAINT (not evidence truth) ---
  currentGenerationEnvelope: { min: number; max: number };
  currentGenerationShape: { min: number; max: number } | null;

  rationale: string[];
}

const DIMENSION_TARGETS: Partial<Record<TargetDimension, EvidenceDimension>> = {
  UNDERSTANDING: 'understanding',
  INDEPENDENCE: 'independence',
  APPLICATION: 'application',
  RETENTION: 'retention',
  TRANSFER: 'transfer',
};

function dimensionsForTarget(target: TargetDimension): EvidenceDimension[] {
  const d = DIMENSION_TARGETS[target];
  return d ? [d] : [];
}

/** Pure, deterministic, no IO. Never manufactures a count. */
export function deriveEvidenceRequirement(inputs: EvidenceRequirementInputs): EvidenceRequirement {
  const { activityType, evidenceMode, targetDimension, masteryPolicy, currentSufficiency } = inputs;

  const purpose = evidencePurposeForActivity(activityType);
  const requiredDimensions = dimensionsForTarget(targetDimension);
  const independentEvidenceRequired = evidenceMode === 'INDEPENDENT' || evidenceMode === 'ASSESSMENT';
  const currentEvidenceCount = currentSufficiency?.evidenceCount ?? null;
  const currentIndependentEvidenceCount = currentSufficiency?.independentEvidenceCount ?? null;
  const assessmentProfileId = inputs.assessmentProfileId ?? null;

  const rationale: string[] = [
    `purpose=${purpose} (ActivityType ${activityType})`,
    `evidenceMode=${evidenceMode} -> independentEvidenceRequired=${independentEvidenceRequired}`,
    `targetDimension=${targetDimension} -> requiredDimensions=[${requiredDimensions.join(',')}]`,
    `policy v${masteryPolicy.version}: minEvidence=${masteryPolicy.minimumEvidenceCount}, minIndependent=${masteryPolicy.minimumIndependentEvidenceCount}`,
  ];

  let questionCount: QuestionCountDecision;
  switch (purpose) {
    case 'PRACTICE': {
      const gap = Math.max(0, masteryPolicy.minimumEvidenceCount - (currentEvidenceCount ?? 0));
      questionCount = {
        status: 'DETERMINED',
        pedagogicalRequirement: gap,
        executionMinimum: CURRENT_GENERATION_QUESTION_ENVELOPE.min,
        source: 'MASTERY_POLICY_TOTAL_EVIDENCE_GAP',
      };
      rationale.push(`practice: max(0, ${masteryPolicy.minimumEvidenceCount} - have ${currentEvidenceCount ?? 0}) = ${gap} (canonical); executionMinimum ${CURRENT_GENERATION_QUESTION_ENVELOPE.min}`);
      break;
    }
    case 'PROVE': {
      const gap = Math.max(0, masteryPolicy.minimumIndependentEvidenceCount - (currentIndependentEvidenceCount ?? 0));
      questionCount = {
        status: 'DETERMINED',
        pedagogicalRequirement: gap,
        executionMinimum: CURRENT_GENERATION_QUESTION_ENVELOPE.min,
        source: 'MASTERY_POLICY_INDEPENDENT_EVIDENCE_GAP',
      };
      rationale.push(`prove: max(0, ${masteryPolicy.minimumIndependentEvidenceCount} - haveIndependent ${currentIndependentEvidenceCount ?? 0}) = ${gap} (canonical); executionMinimum ${CURRENT_GENERATION_QUESTION_ENVELOPE.min}`);
      break;
    }
    case 'RETAIN': {
      questionCount = {
        status: 'UNRESOLVED',
        owner: 'PHASE_6_RETENTION',
        reason:
          'Phase 6 (memory-*) owns retention. It canonically owns WHEN a retention check is due (nextReviewAt) but does not canonically state HOW MANY demonstrations constitute one. No count is invented.',
      };
      rationale.push('retain: UNRESOLVED -- Phase 6 states no count');
      break;
    }
    case 'TRANSFER': {
      questionCount = {
        status: 'UNRESOLVED',
        owner: 'PHASE_7_TRANSFER',
        reason:
          'Phase 7 (transfer-*) owns transfer. TransferDepth / distance authorisation are canonical, but Phase 7 does not canonically state how many novel-context tasks constitute sufficient transfer evidence. No count is invented.',
      };
      rationale.push('transfer: UNRESOLVED -- Phase 7 states no count');
      break;
    }
    case 'DIAGNOSE': {
      questionCount = {
        status: 'UNRESOLVED',
        owner: 'COGNITIVE_DIAGNOSIS',
        reason:
          'cognitive-diagnosis.service owns diagnostic resolution (confirm/reject a root-cause hypothesis). The route`s [2,4] clamp is a legacy execution shape (surfaced as currentGenerationShape), not an evidence-sufficiency policy. No pedagogical count is invented.',
      };
      rationale.push('diagnose: UNRESOLVED -- [2,4] is an execution shape, not a sufficiency policy');
      break;
    }
    case 'ASSESS': {
      questionCount = {
        status: 'UNRESOLVED',
        owner: 'ASSESSMENT_BLUEPRINT',
        reason:
          'No canonical topic x weight assessment blueprint exists (LX-0 / LX-1). Assessment question structure requires an assessment-blueprint authority (LX-10). `conceptCount x 2` was an invented heuristic and has been removed.',
      };
      rationale.push('assess: UNRESOLVED -- no assessment blueprint authority exists');
      break;
    }
    default: {
      const _exhaustive: never = purpose;
      questionCount = _exhaustive;
    }
  }

  return {
    contractVersion: EVIDENCE_SUFFICIENCY_CONTRACT_VERSION,
    purpose,
    evidenceMode,
    targetDimension,
    requiredDimensions,
    independentEvidenceRequired,
    canonicalMinimumEvidenceCount: masteryPolicy.minimumEvidenceCount,
    canonicalMinimumIndependentEvidenceCount: masteryPolicy.minimumIndependentEvidenceCount,
    currentEvidenceCount,
    currentIndependentEvidenceCount,
    assessmentProfileId,
    questionCount,
    currentGenerationEnvelope: { ...CURRENT_GENERATION_QUESTION_ENVELOPE },
    currentGenerationShape: CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY[activityType]
      ? { ...CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY[activityType]! }
      : null,
    rationale,
  };
}

export type ResolvedQuestionCount =
  | { status: 'DETERMINED'; count: number; note: string }
  | { status: 'UNRESOLVED'; reason: string; owner: UnresolvedCountOwner };

/**
 * Turn the requirement into an actual number -- ONLY when the count is
 * canonically DETERMINED. Otherwise the caller (LX-4) must fall back to
 * the EXISTING execution default for that activity; this contract will
 * not manufacture a number to fill the gap.
 *
 * When DETERMINED: `count = clamp( max(executionMinimum, pedagogicalRequirement),
 * currentGenerationShape ?? currentGenerationEnvelope )` -- every term is
 * canonical or an existing execution constraint.
 */
export function resolveQuestionCount(requirement: EvidenceRequirement): ResolvedQuestionCount {
  const d = requirement.questionCount;
  if (d.status === 'UNRESOLVED') {
    return { status: 'UNRESOLVED', reason: d.reason, owner: d.owner };
  }
  const range = requirement.currentGenerationShape ?? requirement.currentGenerationEnvelope;
  const raw = Math.max(d.executionMinimum, d.pedagogicalRequirement);
  const count = Math.min(range.max, Math.max(range.min, raw));
  return {
    status: 'DETERMINED',
    count,
    note: `max(executionMinimum ${d.executionMinimum}, canonicalGap ${d.pedagogicalRequirement}) clamped to [${range.min},${range.max}]`,
  };
}
