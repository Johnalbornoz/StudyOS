/**
 * B2 -- what a policy hands the solver, and what the solver hands back (pure types).
 *
 * A PLAN is constraints, never a count. A policy translates domain state (evidence needs, exam relevance,
 * official blueprint positions) into it; the solver only satisfies it. The number of questions is a
 * property of the result (`selected.length`) and appears nowhere in a plan.
 */
import type { SlotConstraint } from '@/lib/exam-core/slot-constraints';
import type { AssessmentFamily } from '@/lib/assessment-foundation/families';
import type { QuestionRef } from '@/lib/assessment-foundation/question-coverage';
import type { CoverageStrength, TargetKind } from './candidate';

/* ------------------------------------------------------------------ */
/* Target plan (LEARNING, EXAM_PREPARATION)                             */
/* ------------------------------------------------------------------ */

export interface TargetRequirement {
  targetKey: string;
  kind: TargetKind;
  id: string;
  /**
   * How much this target matters to the policy (evidence need, exam relevance x gap x urgency ...). An
   * integer >= 1. It orders the solver's choices; it never removes a target the caller asked for.
   */
  priority: number;
  /** Distinct questions that must give an opportunity on this target, by any ACCEPTED strength. */
  opportunities: number;
  /** Of those, how many must be DIRECT. A SUPPORTING or DERIVED coverage can never count here. */
  directOpportunities: number;
  /**
   * Independent demonstrations: questions DEDICATED to this target. One question can be dedicated to one
   * target only, so a multi-concept item never serves as the independent demonstration of two concepts.
   * Each needs DIRECT coverage.
   */
  independentDemonstrations: number;
}

export interface SoftPreferences {
  /** Preferred difficulty band (the activity's canonical range). A candidate of UNKNOWN difficulty is neither rewarded nor assumed in band. */
  difficulty: { min: number; max: number; target: number | null } | null;
  /** Distinct values sought per dimension, where the pool exposes them. Reported when not reached; never forced. */
  diversity: { questionTypes: number; difficultyLevels: number };
  /** Prefer questions the Student has not seen (a strong, deterministic penalty -- not an exclusion). */
  avoidRecent: boolean;
}

export interface TargetPlan {
  mode: 'TARGETS';
  family: AssessmentFamily;
  targets: TargetRequirement[];
  /** Strengths that count as an "opportunity". DIRECT always does. */
  accept: { supporting: boolean; derived: boolean };
  soft: SoftPreferences;
  hard: {
    /** Recently seen questions are excluded outright (only where the activity's canonical policy requires novelty). */
    excludeRecent: boolean;
    /** A hard time limit. Verified only against KNOWN durations; an unknown duration is never assumed to fit. */
    maxSeconds: number | null;
    /**
     * A difficulty the Student asked for, as levels of the 1-5 item scale (question-bank/requested-difficulty). Only a
     * question whose RECORDED difficulty rounds into the range may be selected: one outside it, or of unknown
     * difficulty, is never used to fill the requirement. Absent / null = not asked for.
     */
    difficulty?: { min: number; max: number } | null;
  };
  /** Targets the caller asked for that have no canonical identity: reported, never guessed. */
  unresolvedTargets: Array<{ ref: string; reason: 'TRANSITIONAL_LINK' | 'UNRESOLVED_LINK' | 'NOT_IN_SCOPE' | 'NOT_EXAM_RELEVANT' }>;
}

/* ------------------------------------------------------------------ */
/* Slot plan (OFFICIAL_EXAM)                                            */
/* ------------------------------------------------------------------ */

export interface SlotRequirement {
  index: number;
  blueprintObjectiveTargetId: string;
  assessmentComponentId: string;
  learningObjectiveId: string | null;
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
  constraints: SlotConstraint[];
}

export interface SlotPlan {
  mode: 'SLOTS';
  family: 'OFFICIAL_EXAM';
  /** Exactly the blueprint's positions. The solver fills them; it never adds, drops, merges or reweights one. */
  slots: SlotRequirement[];
  soft: { avoidSeen: boolean };
}

export type SolverPlan = TargetPlan | SlotPlan;

/* ------------------------------------------------------------------ */
/* Result                                                               */
/* ------------------------------------------------------------------ */

export type SelectionReason =
  | 'COVERS_UNCOVERED_TARGET'
  | 'ADDS_REQUIRED_OPPORTUNITY'
  | 'ADDS_DIRECT_OPPORTUNITY'
  | 'INDEPENDENT_DEMONSTRATION'
  | 'FILLS_OFFICIAL_SLOT'
  | 'ADDS_DIVERSITY'
  | 'RECENT_REUSE_REQUIRED';

export interface SelectedQuestion {
  question: QuestionRef;
  key: string;
  /** Order in which the solver chose it (0-based). */
  order: number;
  /** Official exam only. */
  slotIndex: number | null;
  /** Which targets it contributes to, and with what strength. */
  contributes: Array<{ targetKey: string; strength: CoverageStrength; counted: Array<'OPPORTUNITY' | 'DIRECT' | 'INDEPENDENT'> }>;
  /** The target it is the independent demonstration of, when it is one. */
  dedicatedTo: string | null;
  reasons: SelectionReason[];
}

export type UnmetCause =
  /** No eligible candidate covers the target at all. */
  | 'NO_ELIGIBLE_CANDIDATE'
  /** Candidates exist, but not enough distinct ones. */
  | 'NOT_ENOUGH_CANDIDATES'
  /** Coverage exists only as SUPPORTING / DERIVED where DIRECT is required. */
  | 'ONLY_WEAKER_COVERAGE'
  /** A hard time budget stopped the selection. */
  | 'TIME_BUDGET'
  /** A hard time budget could not be verified: remaining candidates have no recorded duration. */
  | 'DURATION_UNKNOWN'
  /** The only candidates left are recently seen and the policy excludes them. */
  | 'ONLY_RECENT_CANDIDATES'
  /** The only candidates left are not of the difficulty that was asked for (or their difficulty is not recorded). */
  | 'ONLY_OTHER_DIFFICULTY'
  /** The target has no canonical identity. */
  | 'UNRESOLVED_TARGET'
  /** No eligible reviewed item fits this official slot. */
  | 'NO_ITEM_FOR_SLOT';

export interface UnmetRequirement {
  /** Target key, slot index (`SLOT:<n>`) or the unresolved reference. */
  subject: string;
  requirement: 'OPPORTUNITY' | 'DIRECT' | 'INDEPENDENT' | 'SLOT' | 'IDENTITY';
  missing: number;
  cause: UnmetCause;
}

export type SolveStatus = 'READY' | 'PARTIAL' | 'INSUFFICIENT_COVERAGE';

export interface SolverDiagnostics {
  family: AssessmentFamily;
  mode: 'TARGETS' | 'SLOTS';
  candidateCount: number;
  /** Candidates the solver could use for at least one requirement. */
  usableCount: number;
  selectedCount: number;
  unmetCount: number;
  iterations: number;
  prunedCount: number;
  status: SolveStatus;
}

export interface SolveOutcome {
  status: SolveStatus;
  selected: SelectedQuestion[];
  unmet: UnmetRequirement[];
  /** Soft preferences that could not be reached with the pool. They never change the status. */
  softShortfalls: Array<{ preference: 'QUESTION_TYPE_DIVERSITY' | 'DIFFICULTY_DIVERSITY' | 'DIFFICULTY_BAND' | 'UNSEEN_QUESTIONS'; wanted: number; reached: number }>;
  /** Sum of KNOWN durations, or null when any selected question has none (never an estimate). */
  estimatedSeconds: number | null;
  /** Sum of KNOWN marks, or null when any selected question has none. */
  marks: number | null;
  diagnostics: SolverDiagnostics;
}
