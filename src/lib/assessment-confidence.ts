/**
 * Phase 3B: Assessment Confidence -- a concept Phase 3B owns and keeps
 * strictly separate from Knowledge Confidence.
 *
 * Knowledge Confidence ("how strong is StudyUS's overall evidence that
 * the student knows this concept?") belongs to Phase 2.2's Knowledge
 * State/evidence-sufficiency interpretation and is never touched here.
 *
 * Assessment Confidence answers a different question: "how trustworthy
 * is THIS SPECIFIC assessment attempt as evidence?" It's computed from
 * grading confidence, whether a generated variant was actually
 * equivalent to its source, whether a verification question confirmed
 * or contradicted the primary answer, and behavioral signals -- never
 * from Understanding/Independence/Application/Retention/Transfer.
 *
 * This is explicitly NOT an AI-authorship detector: nothing here ever
 * outputs a "this looks AI-generated" classification, and no single
 * signal is treated as proof of anything. Behavioral signals only ever
 * move this number; they never touch mastery or Knowledge State
 * directly (see behavioralAnomalyScore below and its callers).
 */

export interface AssessmentConfidenceInput {
  /** gradeAnswer's own per-question confidence (0-1) across the questions this evidence event covers. */
  gradingConfidences: number[];
  /** Only set when a generated variant (not the original question) was used. */
  variantEquivalenceConfidence?: number | null;
  /** Outcome of a verification question, if one was triggered for this evidence. */
  verificationResult?: 'confirmed' | 'contradicted' | null;
  /** 0 (no anomalies) to 1 (several/strong anomalies) -- see behavioralAnomalyScore. */
  behavioralAnomalyScore?: number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0.7; // no grading confidence reported -- a neutral default, not a fabricated high/low
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Returns Assessment Confidence on a 0-100 scale. */
export function calculateAssessmentConfidence(input: AssessmentConfidenceInput): number {
  let confidence = average(input.gradingConfidences) * 100;

  if (input.variantEquivalenceConfidence != null) {
    confidence = confidence * 0.7 + input.variantEquivalenceConfidence * 100 * 0.3;
  }

  if (input.verificationResult === 'confirmed') {
    confidence = Math.min(100, confidence + 15);
  } else if (input.verificationResult === 'contradicted') {
    confidence = Math.max(0, confidence - 25);
  }

  const anomaly = Math.max(0, Math.min(1, input.behavioralAnomalyScore ?? 0));
  confidence = confidence * (1 - 0.3 * anomaly);

  return Math.round(Math.max(0, Math.min(100, confidence)));
}

/**
 * Configurable, non-invasive integrity signals (§43). Deliberately NOT
 * collected: keystrokes, webcam/microphone data, biometric identity.
 * Each field is optional -- an attempt that reports none of them still
 * gets a neutral (zero-anomaly) score, never a penalized one, since
 * "no signal reported" is not evidence of anything.
 */
export interface IntegritySignals {
  responseDurationMs?: number;
  timeToFirstInteractionMs?: number;
  answerEditCount?: number;
  mathInsertions?: number;
  pasteCount?: number;
  largestPasteLength?: number;
  focusLossCount?: number;
  totalFocusLossDurationMs?: number;
  tabChanges?: number;
  fullscreenExitCount?: number;
  attemptCount?: number;
}

/**
 * A single signal never means anything on its own (§43: "paste = AI"
 * and "tab switch = cheating" are explicitly the inferences NOT to
 * make) -- this only accumulates a soft anomaly score from multiple
 * corroborating signals, capped at 1, that calculateAssessmentConfidence
 * uses to discount confidence. It never flags an individual student or
 * classifies authorship.
 */
export function behavioralAnomalyScore(signals: IntegritySignals, expectedMinDurationMs = 3000): number {
  let score = 0;
  if ((signals.largestPasteLength ?? 0) > 200) score += 0.3;
  if (signals.responseDurationMs != null && signals.responseDurationMs < expectedMinDurationMs) score += 0.2;
  if ((signals.focusLossCount ?? 0) >= 3) score += 0.2;
  if ((signals.tabChanges ?? 0) >= 3) score += 0.15;
  if ((signals.fullscreenExitCount ?? 0) >= 2) score += 0.15;
  return Math.min(1, score);
}
