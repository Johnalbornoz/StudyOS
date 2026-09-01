/**
 * Learner-Aware Tutor: deterministic strategy selection + a compact
 * context builder. The LLM executes the chosen strategy linguistically;
 * it never picks its own pedagogical approach from the full learner
 * history, which is the point -- keeps the Tutor's behavior explainable
 * and keeps every request's context small and targeted instead of
 * shipping the whole Learner Model on every message.
 */

import { db } from '@/lib/db';
import { getDecisionContext } from '@/lib/learner-twin';
import { getTransferScore } from './transfer.service';
import { getActiveDiagnoses } from './cognitive-diagnosis.service';
import { getActiveRemediations } from './remediation.service';

export type TutorStrategy =
  | 'SOCRATIC'
  | 'SCAFFOLD'
  | 'RETRIEVAL'
  | 'ANALOGY'
  | 'EXPLAIN'
  | 'CONTRAST'
  | 'CHALLENGE'
  | 'TEACH_BACK'
  | 'TRANSFER';

const STRATEGY_INSTRUCTION: Record<TutorStrategy, string> = {
  SOCRATIC: 'Ask a short guiding question before explaining anything -- let the student attempt the reasoning first.',
  SCAFFOLD: 'Break the problem into smaller, ordered sub-steps rather than solving it in one leap.',
  RETRIEVAL: "Prompt the student to recall what they already know about this before you add anything new -- they've seen this before, they just haven't touched it in a while.",
  ANALOGY: 'Offer a different representation or analogy of the idea, since the current framing may not be landing.',
  EXPLAIN: 'A real conceptual block is likely here -- give a clear, direct explanation rather than more questions.',
  CONTRAST: "Explicitly contrast the student's likely misconception against the correct reasoning, side by side.",
  CHALLENGE: 'This student is doing well here -- raise the difficulty or ask a deeper follow-up rather than reviewing basics.',
  TEACH_BACK: 'Ask the student to explain the idea back to you in their own words, as if teaching it to someone else.',
  TRANSFER: 'Ask the student to apply this idea to a new, different context rather than reviewing the original one again.',
};

export interface StrategyInputs {
  masteryScore: number | null;
  retention: number | null;
  independentMastery: number | null;
  confidenceCalibrationLabel: 'OVERCONFIDENT' | 'WELL_CALIBRATED' | 'UNDERCONFIDENT' | 'INSUFFICIENT_EVIDENCE' | null;
  transferScore: number | null;
  hasRecurringMisconception: boolean;
}

/**
 * Deterministic mapping from learner state to pedagogical strategy.
 * Order matters -- checked as a priority list, first match wins, since
 * a student can plausibly qualify for more than one.
 */
export function selectTutorStrategy(inputs: StrategyInputs): TutorStrategy {
  if (inputs.hasRecurringMisconception) return 'CONTRAST';
  if (inputs.confidenceCalibrationLabel === 'OVERCONFIDENT') return 'SOCRATIC';
  if (inputs.masteryScore !== null && inputs.masteryScore < 50) return 'SCAFFOLD';
  if (inputs.retention !== null && inputs.retention < 50) return 'RETRIEVAL';
  if (inputs.independentMastery !== null && inputs.masteryScore !== null && inputs.independentMastery < inputs.masteryScore - 20) {
    return 'SCAFFOLD'; // reduced scaffolding in spirit -- same instruction family, phrased to hand back more responsibility
  }
  if (inputs.masteryScore !== null && inputs.masteryScore >= 80 && inputs.transferScore !== null && inputs.transferScore < 60) {
    return 'TRANSFER';
  }
  if (inputs.masteryScore !== null && inputs.masteryScore >= 85 && (inputs.retention === null || inputs.retention >= 70)) {
    return 'CHALLENGE';
  }
  return 'EXPLAIN';
}

export function strategyInstruction(strategy: TutorStrategy): string {
  return STRATEGY_INSTRUCTION[strategy];
}

export interface CompactTutorContext {
  strategy: TutorStrategy;
  instruction: string;
  summary: string; // one short line, safe to drop straight into a system prompt
}

/**
 * Builds ONLY what's relevant for this concept -- never the full
 * Learner Model, never the student's whole history. Returns null when
 * there's no concept in scope (a general, non-concept-scoped Tutor
 * conversation behaves exactly as it did before Phase 2).
 */
export async function buildCompactTutorContext(studentId: string, conceptId: string): Promise<CompactTutorContext | null> {
  const decisionContext = await getDecisionContext(studentId, conceptId);
  if (!decisionContext) return null;

  // "retention" here MUST stay the OLD forward-looking, spaced-repetition
  // value (100 - forgettingRisk) -- NOT DecisionContext.retention.
  // retentionScore, a different, backward-looking Knowledge State
  // dimension. See docs/audits/STUDYUS_PHASE_1C_R_CANONICAL_CONSUMER_CLOSURE.md §6.
  const retention = decisionContext.retention.forgettingRisk !== null ? 100 - decisionContext.retention.forgettingRisk : null;

  const [transferScore, activeDiagnoses, activeRemediations] = await Promise.all([
    getTransferScore(studentId, conceptId),
    getActiveDiagnoses(studentId),
    getActiveRemediations(studentId),
  ]);

  const misconceptionCheck = await db.query(
    `SELECT 1 FROM student_misconceptions sm JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
     WHERE sm.student_id = $1 AND ms.concept_id = $2 AND sm.occurrence_count >= 2 LIMIT 1`,
    [studentId, conceptId]
  );

  const strategy = selectTutorStrategy({
    masteryScore: decisionContext.mastery.score,
    retention,
    independentMastery: decisionContext.independence.independentMastery,
    confidenceCalibrationLabel: decisionContext.metacognition.confidenceCalibration.label,
    transferScore,
    hasRecurringMisconception: (misconceptionCheck.rowCount ?? 0) > 0,
  });

  const relevantDiagnosis = activeDiagnoses.find((d) => d.targetConceptId === conceptId && d.state === 'CONFIRMED');
  const relevantRemediation = activeRemediations.find((r) => r.rootCauseConceptId === conceptId || r.targetConceptId === conceptId);

  const parts = [
    `Mastery ${Math.round(decisionContext.mastery.score)}%`,
    retention !== null ? `Retention ${Math.round(retention)}%` : null,
    decisionContext.independence.independentMastery !== null ? `Independent Mastery ${decisionContext.independence.independentMastery}%` : null,
    relevantDiagnosis ? `Confirmed prerequisite gap: this concept is a candidate root cause for another struggling concept` : null,
    relevantRemediation ? `Active repair in progress (step: ${relevantRemediation.state})` : null,
  ].filter(Boolean);

  return {
    strategy,
    instruction: strategyInstruction(strategy),
    summary: parts.join(', '),
  };
}
