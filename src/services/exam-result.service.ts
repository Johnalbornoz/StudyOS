/**
 * Real exam result cycle.
 *
 * The brief calls this one of the most important interactions in the
 * product: closing the loop between what StudyUS predicted
 * (exam_readiness, cached on the occurrence) and what actually
 * happened at school. It's also the highest-confidence evidence the
 * mastery engine ever sees -- REAL_SCHOOL_EXAM carries full 1.0 weight
 * in calculateMasteryDelta, vs. 0.3 for a practice quiz -- so recording
 * one real grade can move mastery (and resolve learning debt) more than
 * many practice attempts would.
 *
 * A school grade is one number for the whole exam, not a per-concept
 * breakdown, so the same evidence (derived from the overall
 * percentage) is applied to every concept the exam covered. If the
 * occurrence has no specific topics selected, that means "covers
 * everything" (same convention as today-plan.service.ts), so every
 * concept in the subject gets recalibrated.
 */

import { db } from '@/lib/db';
import { updateMastery } from './mastery.service';
import { autoResolveDebt } from './debt-resolution.service';
import type { LearningEvidence } from '@/lib/algorithms/mastery';

export interface ExamResultInput {
  occurrenceId: string;
  studentId: string;
  score: number;
  maxScore: number;
}

export interface ConceptRecalibration {
  conceptId: string;
  label: string;
  previousMastery: number;
  newMastery: number;
  delta: number;
  debtResolved: boolean;
}

export interface ExamResultOutcome {
  resultId: string;
  percentage: number;
  predictedReadiness: number | null;
  readinessDelta: number | null;
  recalibrated: ConceptRecalibration[];
}

export async function recordExamResult(
  input: ExamResultInput,
  preferredLanguage: string = 'en'
): Promise<ExamResultOutcome> {
  const { occurrenceId, studentId, score, maxScore } = input;
  const percentage = Math.round((score / maxScore) * 100);

  const occResult = await db.query(
    `SELECT subject_id, topics, exam_readiness FROM assessment_occurrences WHERE id = $1`,
    [occurrenceId]
  );
  const occ = occResult.rows[0];
  if (!occ) throw new Error('Occurrence not found');

  const predictedReadiness = occ.exam_readiness !== null ? Number(occ.exam_readiness) : null;
  const readinessDelta = predictedReadiness !== null ? percentage - predictedReadiness : null;

  const resultInsert = await db.query(
    `
    INSERT INTO assessment_results (occurrence_id, student_id, score, max_score, analyzed_at, analysis_result)
    VALUES ($1, $2, $3, $4, NOW(), $5)
    RETURNING id, percentage
    `,
    [
      occurrenceId,
      studentId,
      score,
      maxScore,
      JSON.stringify({ predictedReadiness, actualPercentage: percentage, readinessDelta }),
    ]
  );
  const resultId = resultInsert.rows[0].id;

  await db.query(`UPDATE assessment_occurrences SET status = 'result_recorded' WHERE id = $1`, [
    occurrenceId,
  ]);

  let conceptIds: string[] = occ.topics || [];
  if (conceptIds.length === 0) {
    const allConcepts = await db.query(`SELECT id FROM concepts WHERE subject_id = $1`, [
      occ.subject_id,
    ]);
    conceptIds = allConcepts.rows.map((r) => r.id);
  }

  let recalibrated: ConceptRecalibration[] = [];
  if (conceptIds.length > 0) {
    const labelsResult = await db.query(
      `
      SELECT c.id, c.canonical_id, cl.label
      FROM concepts c
      LEFT JOIN LATERAL (
        SELECT label FROM concept_localizations
        WHERE concept_id = c.id
        ORDER BY (language = $2) DESC
        LIMIT 1
      ) cl ON true
      WHERE c.id = ANY($1::uuid[])
      `,
      [conceptIds, preferredLanguage]
    );
    const labelById = new Map<string, string>(
      labelsResult.rows.map((r) => [r.id, r.label || r.canonical_id])
    );

    const evidence: LearningEvidence = {
      result: percentage >= 70 ? 'correct' : percentage >= 50 ? 'partial' : 'incorrect',
      difficulty: 3,
      sourceType: 'REAL_SCHOOL_EXAM',
      confidenceWeight: 1.0,
    };

    recalibrated = await Promise.all(
      conceptIds.map(async (conceptId) => {
        const masteryResult = await updateMastery({
          studentId,
          conceptId,
          subjectId: occ.subject_id,
          evidence,
        });
        const resolution = await autoResolveDebt(studentId, conceptId).catch(() => null);

        return {
          conceptId,
          label: labelById.get(conceptId) || conceptId,
          previousMastery: masteryResult.oldMastery,
          newMastery: masteryResult.newMastery,
          delta: masteryResult.delta,
          debtResolved: resolution?.resolved ?? false,
        };
      })
    );
  }

  return { resultId, percentage, predictedReadiness, readinessDelta, recalibrated };
}

/** Real exam results recorded for a student, most recent first. */
export async function getExamResultHistory(studentId: string, subjectId?: string) {
  let sql = `
    SELECT ar.id, ar.occurrence_id, ar.score, ar.max_score, ar.percentage, ar.analyzed_at,
      ao.scheduled_date, ao.subject_id, s.name AS subject_name
    FROM assessment_results ar
    JOIN assessment_occurrences ao ON ar.occurrence_id = ao.id
    JOIN subjects s ON s.id = ao.subject_id
    WHERE ar.student_id = $1
  `;
  const params: any[] = [studentId];
  if (subjectId) {
    sql += ` AND ao.subject_id = $2`;
    params.push(subjectId);
  }
  sql += ` ORDER BY ar.analyzed_at DESC`;

  const result = await db.query(sql, params);
  return result.rows.map((r) => ({
    id: r.id,
    occurrenceId: r.occurrence_id,
    subjectId: r.subject_id,
    subjectName: r.subject_name,
    scheduledDate: r.scheduled_date,
    score: Number(r.score),
    maxScore: Number(r.max_score),
    percentage: Number(r.percentage),
    analyzedAt: r.analyzed_at,
  }));
}
