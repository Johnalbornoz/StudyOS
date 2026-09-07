/**
 * LX-4B -- TEACHING EXPERIENCE CONTRACT (pure presentation).
 *
 * Translates the CANONICAL adaptive-teaching outputs
 * (`adaptive-teaching-policy.ts`: `SupportLevel`, `ExplanationDepth`,
 * `PrimaryBarrier`) and the CANONICAL `EvidenceMode`
 * (`activity-taxonomy.ts`) into a learner-facing teaching-experience
 * configuration:
 *
 *   EXPLAIN  -> understand the idea
 *   MODEL    -> see a worked example
 *   GUIDE    -> solve one together (step prompts)
 *   PRACTICE -> try, with support available
 *   INDEPENDENT -> try alone, no support (evidence-collection moment)
 *
 * ARCHITECTURAL RULE (LX): the Learning Experience presents canonical
 * truth; it never becomes a second Learning Engine. This module:
 *   - NEVER computes `SupportLevel` / `TeachingIntent` -- it only maps a
 *     value another authority (`computeSupportLevel`) already produced.
 *   - NEVER decides whether help is *permitted* -- that is
 *     `ai-permission-policy` / `active-evidence-guard` on the server.
 *     `helpAvailable` here is a PRESENTATION hint, always additionally
 *     gated by `evidenceMode === 'PRACTICE'` so supported instruction
 *     can never be shown during INDEPENDENT/ASSESSMENT evidence.
 *   - is pure, deterministic, versioned, and unit-tested.
 *
 * The five modes are PRESENTATION MODES, not new canonical
 * LearningStates. Nothing here is persisted.
 */

import type { SupportLevel, ExplanationDepth, PrimaryBarrier } from '@/lib/adaptive-teaching-policy';
import type { EvidenceMode } from '@/lib/activity-taxonomy';

/** Bumped only when this mapping changes. */
export const TEACHING_EXPERIENCE_CONTRACT_VERSION = 1 as const;

export type TeachingExperienceMode = 'EXPLAIN' | 'MODEL' | 'GUIDE' | 'PRACTICE' | 'INDEPENDENT';

/** How much of a solution the learner is shown / walked through before working. */
export type ScaffoldingLevel = 'NONE' | 'LIGHT' | 'GUIDED' | 'FULL';

/** How the concept explanation is surfaced for this teaching moment. */
export type ExplanationProminence = 'PRIMARY' | 'SECONDARY' | 'ON_REQUEST' | 'HIDDEN';

export interface TeachingExperienceInputs {
  /** Canonical -- `adaptive-teaching-policy.computeSupportLevel(...)`. Never computed here. */
  supportLevel: SupportLevel;
  /** Canonical -- `adaptive-teaching-policy.computeExplanationDepth(...)`. */
  explanationDepth: ExplanationDepth;
  /** Canonical -- the ALREADY-FIXED attempt EvidenceMode (`activity-taxonomy.EVIDENCE_MODE_BY_ACTIVITY`). The integrity backstop. */
  evidenceMode: EvidenceMode;
  /** Canonical -- `adaptive-teaching-policy.computePrimaryBarrier(...)`. Drives error-repair framing only. */
  primaryBarrier: PrimaryBarrier;
  /** Canonical -- `TeachingIntent.misconceptionCodes.length > 0`. Presentation flag only. */
  hasActiveMisconception: boolean;
}

export interface TeachingExperienceView {
  /** The dominant presentation mode for this teaching moment. */
  mode: TeachingExperienceMode;
  /** The ordered teaching stages the learner passes through before independent work. Never persisted. */
  stages: TeachingExperienceMode[];
  /** Whether a worked example is shown before the learner is asked to reproduce the procedure. */
  showWorkedExample: boolean;
  /** How much scaffolding the working area carries. */
  scaffolding: ScaffoldingLevel;
  /** Presentation hint only -- always additionally gated by the server's ai-permission-policy / active-evidence-guard. */
  helpAvailable: boolean;
  /** Whether the learner may act on feedback and try the SAME question again inside this activity (LX-4G). Cross-activity continuation is LX-5. */
  retryAllowed: boolean;
  /** How the concept explanation is surfaced. */
  explanationProminence: ExplanationProminence;
  /** Whether a correct answer earns concise explanatory reinforcement (true) rather than a bare "correct" (LX-4G: never over-celebrate). */
  reinforceCorrect: boolean;
  /** True when this is an evidence-collection moment (Prove): no teaching help, single attempt. */
  isProve: boolean;
  contractVersion: typeof TEACHING_EXPERIENCE_CONTRACT_VERSION;
}

const STAGES_BY_SUPPORT: Record<SupportLevel, TeachingExperienceMode[]> = {
  HIGH_SUPPORT: ['EXPLAIN', 'MODEL', 'GUIDE', 'PRACTICE'],
  GUIDED: ['MODEL', 'GUIDE', 'PRACTICE'],
  PARTIAL_SUPPORT: ['PRACTICE'],
  MINIMAL_SUPPORT: ['PRACTICE'],
  INDEPENDENT: ['INDEPENDENT'],
};

const SCAFFOLDING_BY_SUPPORT: Record<SupportLevel, ScaffoldingLevel> = {
  HIGH_SUPPORT: 'FULL',
  GUIDED: 'GUIDED',
  PARTIAL_SUPPORT: 'LIGHT',
  MINIMAL_SUPPORT: 'NONE',
  INDEPENDENT: 'NONE',
};

const EXPLANATION_PROMINENCE_BY_SUPPORT: Record<SupportLevel, ExplanationProminence> = {
  HIGH_SUPPORT: 'PRIMARY',
  GUIDED: 'SECONDARY',
  PARTIAL_SUPPORT: 'ON_REQUEST',
  MINIMAL_SUPPORT: 'ON_REQUEST',
  INDEPENDENT: 'HIDDEN',
};

/**
 * Pure. Deterministic. No I/O. Maps canonical adaptive-teaching outputs
 * to the learner-facing teaching-experience configuration.
 */
export function deriveTeachingExperience(inputs: TeachingExperienceInputs): TeachingExperienceView {
  const { supportLevel, explanationDepth, evidenceMode, primaryBarrier, hasActiveMisconception } = inputs;

  // Integrity backstop: any non-PRACTICE evidence mode is an
  // evidence-collection moment. `computeSupportLevel` already returns
  // INDEPENDENT there; we re-assert it so a mismatched input can never
  // surface teaching help during INDEPENDENT/ASSESSMENT evidence.
  const isProve = evidenceMode !== 'PRACTICE';
  const effectiveSupport: SupportLevel = isProve ? 'INDEPENDENT' : supportLevel;
  // `INDEPENDENT` support only ever co-occurs canonically with a
  // non-PRACTICE evidence mode; treat it as a no-support moment either
  // way so a mismatched input can never leak teaching help.
  const noSupport = isProve || effectiveSupport === 'INDEPENDENT';

  const stages = STAGES_BY_SUPPORT[effectiveSupport];
  const mode = stages[0];

  // A worked example is shown when the teaching flow includes MODEL, OR
  // when an active misconception / prerequisite repair is the barrier
  // (seeing it done correctly is part of the repair) -- never during a
  // no-support moment.
  const showWorkedExample =
    !noSupport &&
    (stages.includes('MODEL') ||
      hasActiveMisconception ||
      primaryBarrier === 'ACTIVE_MISCONCEPTION' ||
      primaryBarrier === 'PREREQUISITE_GAP');

  return {
    mode,
    stages,
    showWorkedExample,
    scaffolding: SCAFFOLDING_BY_SUPPORT[effectiveSupport],
    helpAvailable: !noSupport,
    // Acting on feedback and retrying the same question is a supported-
    // practice affordance only. Prove / no-support is a single attempt.
    retryAllowed: !noSupport,
    explanationProminence:
      noSupport ? 'HIDDEN'
      : explanationDepth === 'DEEP' && EXPLANATION_PROMINENCE_BY_SUPPORT[effectiveSupport] === 'SECONDARY'
        ? 'PRIMARY'
        : EXPLANATION_PROMINENCE_BY_SUPPORT[effectiveSupport],
    reinforceCorrect: !noSupport && (effectiveSupport === 'HIGH_SUPPORT' || effectiveSupport === 'GUIDED'),
    isProve,
    contractVersion: TEACHING_EXPERIENCE_CONTRACT_VERSION,
  };
}

/**
 * The learner-visible label key for a teaching mode. Presentation only.
 * The page resolves `teachingExperience.mode.${mode}` against i18n.
 */
export const TEACHING_MODE_LABEL_KEY: Record<TeachingExperienceMode, string> = {
  EXPLAIN: 'teachingExperience.mode.EXPLAIN',
  MODEL: 'teachingExperience.mode.MODEL',
  GUIDE: 'teachingExperience.mode.GUIDE',
  PRACTICE: 'teachingExperience.mode.PRACTICE',
  INDEPENDENT: 'teachingExperience.mode.INDEPENDENT',
};
