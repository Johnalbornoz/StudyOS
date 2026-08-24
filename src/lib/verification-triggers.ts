/**
 * Phase 3B: Verification Trigger Engine.
 *
 * This is new implementation -- an earlier attempt at this file existed
 * only as a placeholder (the literal word "placeholder") before it was
 * lost; nothing here is recovered from that.
 *
 * A verification question is evidence disambiguation, never punishment
 * or an anti-cheating interrogation: it exists purely to get one more
 * piece of evidence when the current answer doesn't yet support a
 * confident read. The decision of WHETHER to ask for that extra
 * evidence must be fully deterministic and explainable -- never "the AI
 * felt like the writing looked off" -- so every function in this file
 * is a pure function over typed, already-computed inputs. No network
 * call, no LLM call, nothing non-deterministic.
 */

export type VerificationTriggerId =
  | 'LOW_GRADING_CONFIDENCE'
  | 'CONTRADICTORY_EVIDENCE'
  | 'LARGE_CONFIDENCE_DISAGREEMENT'
  | 'WEAK_CONCEPT_ATTRIBUTION'
  | 'LOW_VARIANT_EQUIVALENCE'
  | 'HIGH_BEHAVIORAL_ANOMALY'
  | 'REASONING_ANSWER_INCONSISTENCY'
  | 'UNEXPECTED_PERFORMANCE_JUMP'
  | 'CONCEPT_COVERAGE_AMBIGUITY'
  | 'PROFILE_REQUIRES_VERIFICATION';

export type VerificationSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface VerificationTriggerResult {
  triggerId: VerificationTriggerId;
  severity: VerificationSeverity;
  /** Neutral, educational-language explanation -- suitable to eventually show a student as "why am I being asked this", never accusatory. */
  reason: string;
}

export interface VerificationTriggerInput {
  /** This question's own grading confidence, 0-1 (or the average across a concept's bucket -- see gradingConfidenceSpread for the multi-question case). */
  gradingConfidence: number;
  /** Spread (max - min) of grading confidence across multiple questions covering the same concept, 0-1. Undefined/null when there's only one question. */
  gradingConfidenceSpread?: number | null;
  /** A recently-established score for this concept, 0-100, if one exists (e.g. current mastery_score or last evidence). Null when there's no prior baseline to compare against. */
  priorConceptScorePercent?: number | null;
  /** This attempt's own score for the concept, 0-100. */
  currentScorePercent: number;
  /** Set only when a generated variant (not the original question) was used. */
  variantEquivalenceConfidence?: number | null;
  /** How confidently this question/evidence maps to the concept it's being counted toward, 0-1. Null when attribution isn't in question (e.g. a hand-authored single-concept question). */
  conceptMappingConfidence?: number | null;
  /** How broadly the questions covering this concept actually probed it (multiple angles vs. one narrow angle), 0-1. Null when not applicable (e.g. a single question). */
  conceptCoverageBreadth?: number | null;
  /** behavioralAnomalyScore() from assessment-confidence.ts, 0-1. */
  behavioralAnomalyScore?: number | null;
  /** Structured-reasoning check (gradeAnswer's reasoningValid): does the shown work actually support the final answer? Null when there's no separate reasoning to judge. */
  reasoningConsistent?: boolean | null;
  /** The Assessment Profile itself is demanding at least one verification pass for this concept, independent of any individual signal (e.g. ADAPTIVE strictness below its confidence floor). */
  requiresVerificationByProfile?: boolean;
}

const LOW_GRADING_CONFIDENCE_THRESHOLD = 0.6;
const CONFIDENCE_SPREAD_THRESHOLD = 0.4;
const SCORE_DISAGREEMENT_THRESHOLD = 40; // percentage points
const WEAK_ATTRIBUTION_THRESHOLD = 0.5;
const COVERAGE_AMBIGUITY_THRESHOLD = 0.3;
const LOW_VARIANT_EQUIVALENCE_THRESHOLD = 0.7;
const HIGH_ANOMALY_THRESHOLD = 0.6;

/**
 * Evaluates every trigger independently and returns every one that
 * fires -- zero or more, deterministic, no priority filtering here
 * (see highestSeverity for reducing to one signal when a caller needs
 * a single "how urgent" read).
 */
export function evaluateVerificationTriggers(input: VerificationTriggerInput): VerificationTriggerResult[] {
  const results: VerificationTriggerResult[] = [];

  if (input.gradingConfidence < LOW_GRADING_CONFIDENCE_THRESHOLD) {
    results.push({
      triggerId: 'LOW_GRADING_CONFIDENCE',
      severity: 'MEDIUM',
      reason: 'The grading itself was not very confident about this answer.',
    });
  }

  if (input.gradingConfidenceSpread != null && input.gradingConfidenceSpread >= CONFIDENCE_SPREAD_THRESHOLD) {
    results.push({
      triggerId: 'LARGE_CONFIDENCE_DISAGREEMENT',
      severity: 'MEDIUM',
      reason: 'Different questions on this concept were graded with very different levels of confidence.',
    });
  }

  if (input.priorConceptScorePercent != null) {
    const diff = input.currentScorePercent - input.priorConceptScorePercent;
    if (diff <= -SCORE_DISAGREEMENT_THRESHOLD) {
      results.push({
        triggerId: 'CONTRADICTORY_EVIDENCE',
        severity: 'HIGH',
        reason: 'This result is much weaker than what we previously observed for this concept.',
      });
    } else if (diff >= SCORE_DISAGREEMENT_THRESHOLD) {
      results.push({
        triggerId: 'UNEXPECTED_PERFORMANCE_JUMP',
        severity: 'MEDIUM',
        reason: 'This result is much stronger than what we previously observed for this concept.',
      });
    }
  }

  if (input.conceptMappingConfidence != null && input.conceptMappingConfidence < WEAK_ATTRIBUTION_THRESHOLD) {
    results.push({
      triggerId: 'WEAK_CONCEPT_ATTRIBUTION',
      severity: 'MEDIUM',
      reason: 'How well this question actually represents the concept is uncertain.',
    });
  }

  if (input.conceptCoverageBreadth != null && input.conceptCoverageBreadth < COVERAGE_AMBIGUITY_THRESHOLD) {
    results.push({
      triggerId: 'CONCEPT_COVERAGE_AMBIGUITY',
      severity: 'LOW',
      reason: 'This concept has only been probed from one narrow angle so far.',
    });
  }

  if (input.variantEquivalenceConfidence != null && input.variantEquivalenceConfidence < LOW_VARIANT_EQUIVALENCE_THRESHOLD) {
    results.push({
      triggerId: 'LOW_VARIANT_EQUIVALENCE',
      severity: 'MEDIUM',
      reason: 'The generated question variant may not be fully equivalent to the original.',
    });
  }

  if (input.behavioralAnomalyScore != null && input.behavioralAnomalyScore >= HIGH_ANOMALY_THRESHOLD) {
    // Deliberately LOW severity on its own -- a behavioral signal never
    // determines anything by itself (§43/§44); it only ever nudges
    // toward wanting one more piece of independent evidence.
    results.push({
      triggerId: 'HIGH_BEHAVIORAL_ANOMALY',
      severity: 'LOW',
      reason: 'A few contextual signals on this attempt were unusual -- not evidence of anything on their own, but worth a second data point.',
    });
  }

  if (input.reasoningConsistent === false) {
    results.push({
      triggerId: 'REASONING_ANSWER_INCONSISTENCY',
      severity: 'HIGH',
      reason: 'The shown reasoning does not clearly support the final answer given.',
    });
  }

  if (input.requiresVerificationByProfile) {
    results.push({
      triggerId: 'PROFILE_REQUIRES_VERIFICATION',
      severity: 'MEDIUM',
      reason: 'This assessment type calls for at least one confirming question on this concept.',
    });
  }

  return results;
}

export function shouldTriggerVerification(triggers: VerificationTriggerResult[]): boolean {
  return triggers.length > 0;
}

const SEVERITY_RANK: Record<VerificationSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function highestSeverity(triggers: VerificationTriggerResult[]): VerificationSeverity | null {
  if (triggers.length === 0) return null;
  return triggers.reduce<VerificationSeverity>(
    (max, t) => (SEVERITY_RANK[t.severity] > SEVERITY_RANK[max] ? t.severity : max),
    triggers[0].severity
  );
}
