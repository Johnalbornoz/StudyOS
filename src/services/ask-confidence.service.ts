import { db } from '@/lib/db';
import { getIndependentMastery, shouldAskConfidence } from '@/services/learner-model.service';
import type { QuizMode } from '@/services/quiz-persistence.service';

/**
 * Decides, per concept, whether the first question about it in this
 * quiz should ask the student to self-report confidence first (see
 * shouldAskConfidence in learner-model.service.ts for the rule and
 * why). One DB round trip for mastery_records regardless of concept
 * count, plus one getIndependentMastery call per concept (bounded by
 * maxQuestions, same pattern already used for question generation
 * itself just above this function's call site).
 */
export async function computeAskConfidenceFlags(
  studentId: string,
  conceptIds: string[],
  quizMode: QuizMode
): Promise<Map<string, boolean>> {
  // A Diagnostic Check is a deliberately minimal, single-purpose
  // interaction (see quiz-generation guidance) -- it's testing the
  // candidate concept, not a moment to also calibrate confidence.
  if (quizMode === 'diagnostic_check') return new Map(conceptIds.map((id) => [id, false]));

  const masteryRows = await db.query(
    `SELECT concept_id, mastery_score, attempt_count FROM mastery_records WHERE student_id = $1 AND concept_id = ANY($2)`,
    [studentId, conceptIds]
  );
  const masteryByConcept = new Map(masteryRows.rows.map((r) => [r.concept_id as string, r]));
  const independentMasteries = await Promise.all(conceptIds.map((cId) => getIndependentMastery(studentId, cId)));

  const flags = new Map<string, boolean>();
  conceptIds.forEach((cId, i) => {
    const row = masteryByConcept.get(cId);
    flags.set(
      cId,
      shouldAskConfidence({
        quizMode,
        hasExistingMasteryRecord: !!row,
        masteryScore: row ? Number(row.mastery_score) : null,
        independentMastery: independentMasteries[i],
        attemptCount: row ? Number(row.attempt_count) : 0,
      })
    );
  });
  return flags;
}
