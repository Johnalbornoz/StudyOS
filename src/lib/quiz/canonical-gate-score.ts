/**
 * BR-SCORE P1-01 -- THE ONE canonical gate score for correctness-gated canonical stages (PRACTICE / PROVE / RETAIN).
 *
 * Approved contract: the score the learner sees (`correct / total`, binary per item, unanswered items in the
 * denominator) IS the score the canonical engine gates on and IS the score persisted as the evidence's canonical
 * `scorePercent`. Per-item partial credit (a rubric `gradeResult.score` of e.g. 0.5 for "Casi" / INCORRECT-with-credit)
 * is preserved SEPARATELY as `rubricScorePercent` and never replaces or inflates the gate score.
 *
 * Browser E2E evidence (candidate DB, QA Student A, "Ecuaciones lineales"): a Practice shown as 2/3 = 67% was persisted
 * as 83 (0.5 + 1 + 1 over 3) and passed the latest >= 80 rule; a Prove shown as 6/10 = 60% was persisted as 79; a Prove
 * shown as 8/10 = 80% was persisted as 90 -- because generate-and-take persisted the MEAN of per-item rubric scores.
 *
 * Pure: no DB, no IO. Rounding: integer percent (`Math.round`), identical to the learner-facing results `score`.
 */
import { CANONICAL_POLICY } from '@/lib/pedagogical-engine';

/**
 * ActivityTypes whose evidence the canonical adapter maps onto a correctness-gated stage -- mirrors
 * `evidence-adapter.ts`'s ACTIVITY_TYPE_MAP entries for PRACTICE / PROVE / RETENTION_CHECK (and the quiz_mode
 * fallbacks below). Transfer, LEARN, internal assessments and diagnostics are NOT in this set (they have their own
 * scoring authorities).
 */
export const CORRECTNESS_GATED_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'PRACTICE',
  'REVIEW',
  'REMEDIATION',
  'SOLO_CHECK',
  'SOLO_VERIFY',
  'RETENTION_CHECK',
]);
export const CORRECTNESS_GATED_QUIZ_MODES: ReadonlySet<string> = new Set([
  'topic_practice',
  'review',
  'quick_check',
  'canonical_prove',
  'retention_check',
]);

export function isCorrectnessGatedActivity(activityType: string | null | undefined, quizMode?: string | null): boolean {
  if (activityType && CORRECTNESS_GATED_ACTIVITY_TYPES.has(activityType)) return true;
  return !activityType && !!quizMode && CORRECTNESS_GATED_QUIZ_MODES.has(quizMode);
}

/** Binary correctness percent: correct / total (total includes unanswered items), integer-rounded. 0 when total <= 0. */
export function correctnessScorePercent(correct: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const c = Math.max(0, Math.min(correct, total));
  return Math.round((c / total) * 100);
}

/** The mean of per-item rubric/partial-credit scores (0-1 each), as an integer percent. Preserved, never gating. */
export function rubricMeanScorePercent(scoreSum: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round((scoreSum / total) * 100);
}

export type QuizEvidenceScoreBasis = 'CORRECTNESS' | 'RUBRIC_MEAN';

export interface QuizConceptEvidenceScore {
  /** The value persisted as learning_evidence.score_percent (and evidence.scorePercent). */
  scorePercent: number;
  /** The partial-credit mean, always computed; stamped separately into metadata.rubricScorePercent. */
  rubricScorePercent: number;
  scoreBasis: QuizEvidenceScoreBasis;
  /** The denominator used for the correctness score (administered items, unanswered included). */
  denominator: number;
}

/**
 * The producer rule for one quiz concept bucket. Correctness-gated canonical activities persist the binary correctness
 * score (the learner-visible one); every other quiz activity keeps its pre-existing partial-credit mean (CV2-07).
 * `administeredCount` (items of this concept actually administered) puts unanswered items in the denominator.
 */
export function resolveQuizConceptEvidenceScore(input: {
  activityType: string | null | undefined;
  quizMode?: string | null;
  correct: number;
  gradedTotal: number;
  scoreSum: number;
  administeredCount?: number;
}): QuizConceptEvidenceScore {
  const denominator = Math.max(input.gradedTotal, input.administeredCount ?? 0);
  const rubricScorePercent = rubricMeanScorePercent(input.scoreSum, denominator);
  if (isCorrectnessGatedActivity(input.activityType, input.quizMode)) {
    return { scorePercent: correctnessScorePercent(input.correct, denominator), rubricScorePercent, scoreBasis: 'CORRECTNESS', denominator };
  }
  return { scorePercent: rubricMeanScorePercent(input.scoreSum, input.gradedTotal), rubricScorePercent, scoreBasis: 'RUBRIC_MEAN', denominator };
}

export type CorrectnessGatedStage = 'PRACTICE' | 'PROVE' | 'RETAIN';

const STAGE_POLICY: Record<CorrectnessGatedStage, { minimumScorePercent: number; itemCount: number | null }> = {
  PRACTICE: { minimumScorePercent: CANONICAL_POLICY.practice.minimumScorePercent, itemCount: null },
  PROVE: { minimumScorePercent: CANONICAL_POLICY.prove.minimumScorePercent, itemCount: CANONICAL_POLICY.prove.itemCount },
  RETAIN: { minimumScorePercent: CANONICAL_POLICY.retention.minimumScorePercent, itemCount: CANONICAL_POLICY.retention.itemCount },
};

export function toCorrectnessGatedStage(stage: string | null | undefined): CorrectnessGatedStage | null {
  return stage === 'PRACTICE' || stage === 'PROVE' || stage === 'RETAIN' ? stage : null;
}

export interface CanonicalAttemptGate {
  stage: CorrectnessGatedStage;
  correctCount: number;
  totalCount: number;
  scorePercent: number;
  passPercent: number;
  /** This ATTEMPT met its own pass rule (score >= pass bar, and the exact item count where the stage fixes one). */
  passed: boolean;
}

/** The per-attempt pass rule shown to the learner (headline) -- the same score and bar the engine applies. */
export function canonicalAttemptGate(stage: CorrectnessGatedStage, correct: number, total: number): CanonicalAttemptGate {
  const p = STAGE_POLICY[stage];
  const scorePercent = correctnessScorePercent(correct, total);
  const countOk = p.itemCount == null || total === p.itemCount;
  return { stage, correctCount: correct, totalCount: total, scorePercent, passPercent: p.minimumScorePercent, passed: countOk && scorePercent >= p.minimumScorePercent };
}

/**
 * BR-SCORE P1-01 -- the ONE learner-facing score source for a results screen. A correctness-gated canonical attempt
 * (`results.canonicalGate`, server-computed) shows exactly the gate score the engine applies and the evidence
 * persists; any other attempt shows the plain `results.results` fact. Never a second, client-side computation.
 */
export function resultScoreDisplay(results: {
  canonicalGate?: { correctCount?: unknown; totalCount?: unknown; scorePercent?: unknown } | null;
  results?: { correctCount?: unknown; totalQuestions?: unknown; score?: unknown } | null;
}): { correct: number; total: number; scorePercent: number; source: 'CANONICAL_GATE' | 'RESULTS' } {
  const g = results.canonicalGate;
  if (g && typeof g.scorePercent === 'number' && typeof g.correctCount === 'number' && typeof g.totalCount === 'number') {
    return { correct: g.correctCount, total: g.totalCount, scorePercent: g.scorePercent, source: 'CANONICAL_GATE' };
  }
  const r = results.results ?? {};
  return { correct: Number(r.correctCount ?? 0), total: Number(r.totalQuestions ?? 0), scorePercent: Number(r.score ?? 0), source: 'RESULTS' };
}
