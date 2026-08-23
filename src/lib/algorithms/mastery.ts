/**
 * Mastery Engine: Deterministic algorithm for calculating student mastery scores
 *
 * Based on evidence: correct/incorrect answers, difficulty, source type weight
 * Never changes mastery directly from AI - always deterministic calculation
 */

export type EvidenceResult = 'correct' | 'incorrect' | 'partial';

export type EvidenceSourceType =
  | 'GUIDED_EXERCISE'
  | 'PRACTICE_QUESTION'
  | 'PRACTICE_QUIZ'
  | 'TOPIC_ASSESSMENT'
  | 'CUMULATIVE_ASSESSMENT'
  | 'EXAM_SIMULATION'
  | 'REAL_SCHOOL_EXAM';

export interface LearningEvidence {
  result: EvidenceResult;
  difficulty: number; // 1-5
  sourceType: EvidenceSourceType;
  confidenceWeight?: number; // 0-1, default 1.0
  scorePercent?: number; // 0-100, the actual raw score behind this evidence (e.g. 100 for "15/15 correct"). Falls back to a value derived from `result` when omitted, so existing callers are unaffected.
  sampleSize?: number; // how many individual questions/items this evidence event represents. Defaults to 1.
}

/**
 * Evidence weight mapping - determines impact of each source on mastery
 * Higher weight = more influential on final mastery score
 */
const EVIDENCE_WEIGHTS: Record<EvidenceSourceType, number> = {
  REAL_SCHOOL_EXAM: 1.0,      // 100% weight
  EXAM_SIMULATION: 0.8,        // 80% weight
  TOPIC_ASSESSMENT: 0.6,       // 60% weight
  CUMULATIVE_ASSESSMENT: 0.5,  // 50% weight
  PRACTICE_QUIZ: 0.3,          // 30% weight
  PRACTICE_QUESTION: 0.2,      // 20% weight
  GUIDED_EXERCISE: 0.1,        // 10% weight
};

/**
 * Calculate the change in mastery score based on evidence
 *
 * Algorithm:
 * 1. Base impact: signed, proportional to the actual score (100% -> +1,
 *    50% -> 0, 0% -> -1), not just a flat "correct/partial/incorrect"
 *    bucket -- a 100% result carries more weight than a 70% one that
 *    both happened to clear the "correct" threshold.
 * 2. Multiply by source weight (real exam more influential)
 * 3. Multiply by a sample-size factor (evidence backed by more
 *    questions is more trustworthy, so it's allowed to move mastery
 *    further -- diminishing returns, capped)
 * 4. Apply difficulty modifier (harder problems matter more)
 * 5. Apply smoothing factor (don't swing wildly)
 * 6. Return delta (change to add to current mastery)
 *
 * `scorePercent`/`sampleSize` are optional: a caller that only ever
 * had a coarse result (e.g. one manually-recorded answer) gets exactly
 * the old behavior (scorePercent derived from `result`, sampleSize 1,
 * multiplier 1 -- no change at all in that case).
 *
 * Example: Current 75%, EXAM_SIMULATION, 15/15 correct (100%), difficulty 3/5
 *   BaseImpact = (100-50)/50 = 1.0
 *   SourceWeight (EXAM_SIMULATION) = 0.8 -> 0.8
 *   SampleSizeFactor = min(5, 1+log2(15)) ≈ 4.9 -> 3.92
 *   DifficultyMod = (3/5)×2 = 1.2 -> 4.70
 *   Smoothing ×0.85 -> 4.00
 *   Confidence (default 1.0) -> 4.00
 *   NewMastery ≈ 75 + 4.0 = 79 (capped at maxDelta = 3×3.92 ≈ 11.8, not hit here)
 */
export function calculateMasteryDelta(
  evidence: LearningEvidence,
  currentMastery: number
): number {
  // Clamp difficulty to 1-5
  const difficulty = Math.max(1, Math.min(5, evidence.difficulty));

  // Confidence weight (how confident are we in this grading?)
  const confidence = evidence.confidenceWeight ?? 1.0;

  // 1. Base impact, signed and proportional to the actual score.
  // Falls back to the old flat mapping when no raw score is given, so
  // this is exactly the previous behavior for any caller that doesn't
  // pass scorePercent.
  const scorePercent =
    evidence.scorePercent ?? (evidence.result === 'correct' ? 100 : evidence.result === 'partial' ? 50 : 0);
  let baseImpact = (scorePercent - 50) / 50; // 0% -> -1, 50% -> 0, 100% -> +1

  // 2. Apply source type weight (real exams more influential)
  const sourceWeight = EVIDENCE_WEIGHTS[evidence.sourceType] ?? 0.5;
  baseImpact *= sourceWeight;

  // 3. Apply a sample-size factor: more questions behind this one
  // evidence event = more trustworthy signal, so it's allowed a bigger
  // (still bounded) impact. sampleSize 1 -> factor 1 (no change from
  // before); grows logarithmically, capped at 5x.
  const sampleSize = Math.max(1, evidence.sampleSize ?? 1);
  const sampleSizeFactor = Math.min(5, 1 + Math.log2(sampleSize));
  baseImpact *= sampleSizeFactor;

  // 4. Apply difficulty modifier (harder problems matter more)
  // Difficulty 1 = 0.4× impact, Difficulty 5 = 2.0× impact
  const difficultyModifier = (difficulty / 5) * 2; // 0.4 to 2.0
  let impact = baseImpact * difficultyModifier;

  // 5. Apply smoothing factor (don't swing mastery wildly)
  const smoothingFactor = 0.85;
  impact *= smoothingFactor;

  // 6. Scale by confidence (low confidence = smaller change)
  impact *= confidence;

  // 7. Scale by proximity to boundaries
  // Approaching 100% should increase more slowly
  // Approaching 0% should decrease more slowly
  if (impact > 0 && currentMastery > 80) {
    // Approaching mastery - diminishing returns
    impact *= 0.7;
  } else if (impact < 0 && currentMastery < 40) {
    // Already very low - don't punish as much
    impact *= 0.7;
  }

  // Final cap: scales with the sample-size factor, so a single-question
  // event keeps the original ±3 cap while a large, strong multi-question
  // assessment is allowed a proportionally bigger (still bounded) swing.
  const maxDelta = 3 * sampleSizeFactor;
  return Math.max(-maxDelta, Math.min(maxDelta, impact));
}

/**
 * Calculate new mastery score after evidence
 */
export function updateMastery(
  currentMastery: number,
  evidence: LearningEvidence
): number {
  const delta = calculateMasteryDelta(evidence, currentMastery);
  const newMastery = currentMastery + delta;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, newMastery));
}

/**
 * Calculate confidence score
 *
 * Confidence only increases when:
 * - Multiple correct attempts
 * - Increasing difficulty mastered
 * - Retention after delay
 * - Consistency across attempts
 */
export interface ConfidenceInput {
  mastery: number;
  recentResults: EvidenceResult[]; // last N attempts, most recent first
  daysSinceLastAttempt: number;
  attemptCount: number;
  correctCount: number;
}

export function calculateConfidence(input: ConfidenceInput): number {
  const {
    mastery,
    recentResults,
    daysSinceLastAttempt,
    attemptCount,
    correctCount,
  } = input;

  // Component 1: Mastery score (40%)
  const masteryComponent = mastery * 0.4;

  // Component 2: Consistency (40%)
  // How many of recent attempts were correct?
  const recentCorrectCount = recentResults.filter(r => r === 'correct').length;
  const recentAccuracy = recentResults.length > 0
    ? (recentCorrectCount / recentResults.length) * 100
    : 0;
  const consistencyComponent = recentAccuracy * 0.4;

  // Component 3: Retention bonus (10%)
  // Correct recall after >7 days shows retention
  let retentionBonus = 0;
  if (
    daysSinceLastAttempt > 7 &&
    recentResults.length > 0 &&
    recentResults[0] === 'correct'
  ) {
    retentionBonus = 20; // 20% bonus for delayed recall
  }

  // Component 4: Multiple attempts (10%)
  // Need >3 attempts to build confidence
  let consistencyBonus = 0;
  if (attemptCount > 3 && correctCount > attemptCount / 2) {
    consistencyBonus = 10;
  }

  const confidence = Math.min(
    100,
    masteryComponent + consistencyComponent + retentionBonus + consistencyBonus
  );

  return Math.round(confidence * 100) / 100;
}

/**
 * Determine if learning debt should be created
 *
 * Create debt when:
 * - Mastery < 60% AND
 * - (Attempted in assessment OR attempted in practice OR is prerequisite to upcoming exam)
 */
export function shouldCreateLearningDebt(
  mastery: number,
  inAssessment: boolean,
  inPractice: boolean,
  isPrerequisiteToUpcomingExam: boolean,
  recurrenceCount: number // how many times has this concept been attempted?
): boolean {
  if (mastery >= 60) {
    return false; // No debt for mastery >= 60%
  }

  // Debt if attempted + weak mastery
  const attemptedRecently = inAssessment || inPractice || recurrenceCount >= 2;
  const isBlockingProgress = isPrerequisiteToUpcomingExam;

  return attemptedRecently || isBlockingProgress;
}

/**
 * Calculate learning debt severity (1-5 scale)
 *
 * Factors:
 * - Very low mastery (0-40) adds +2
 * - Low mastery (40-50) adds +1
 * - Recurring errors add up to +2
 * - Prerequisite to exam adds +1
 * - Max severity = 5
 */
export function calculateDebtSeverity(
  mastery: number,
  recurrenceCount: number,
  isPrerequisiteToUpcomingExam: boolean
): number {
  let severity = 1; // base

  if (mastery < 40) severity += 2;
  else if (mastery < 50) severity += 1;

  // Recurrence (capped at 2 for non-infinite growth)
  severity += Math.min(recurrenceCount, 2);

  if (isPrerequisiteToUpcomingExam) severity += 1;

  return Math.min(severity, 5); // Cap at 5
}

/**
 * Determine if learning debt should be resolved
 *
 * Resolve when ALL of:
 * 1. Mastery > 85%
 * 2. Last 3 assessments: average > 80%
 * 3. Days since last successful assessment > 14 (retention proof)
 * 4. Forgetting risk < 20%
 */
export function shouldResolveLearningDebt(
  mastery: number,
  recentAssessmentScores: number[], // last 3, as percentages
  daysSinceLastSuccess: number,
  forgettingRisk: number
): boolean {
  // Mastery threshold
  if (mastery <= 85) return false;

  // Recent performance threshold (last 3 average > 80%)
  if (recentAssessmentScores.length < 3) return false;
  const avgRecentScore = recentAssessmentScores.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  if (avgRecentScore <= 80) return false;

  // Retention proof (no review for 14+ days but still correct)
  if (daysSinceLastSuccess <= 14) return false;

  // Forgetting risk acceptable
  if (forgettingRisk >= 20) return false;

  return true; // All conditions met
}

/**
 * Format mastery level for display
 */
export function getMasteryLevel(
  mastery: number
): 'CRITICAL' | 'WEAK' | 'DEVELOPING' | 'CONSOLIDATING' | 'MASTERED' | 'ADVANCED' {
  if (mastery < 40) return 'CRITICAL';
  if (mastery < 60) return 'WEAK';
  if (mastery < 75) return 'DEVELOPING';
  if (mastery < 85) return 'CONSOLIDATING';
  if (mastery < 95) return 'MASTERED';
  return 'ADVANCED';
}
