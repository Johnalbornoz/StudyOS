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
 * breakdown. The *score* (the percentage) is real and applies to every
 * concept the exam covered -- that's not fabricated. What used to be
 * fabricated was the CONFIDENCE: every concept got the same 1.0
 * confidenceWeight regardless of how precisely we actually know the
 * exam covered it. Phase 3 Pre-flight fixes that by attributing a
 * source granularity per concept (see getConceptAttribution below) and
 * scaling confidenceWeight down when the mapping is coarse, so an 82%
 * exam doesn't move mastery as if we were certain every covered
 * concept was tested with equal rigor.
 *
 * If the occurrence has no specific topics selected, that means
 * "covers everything" (same convention as today-plan.service.ts), so
 * every concept in the subject gets recalibrated -- just at the
 * lowest, most honest confidence tier (SUBJECT_WIDE).
 */

import { db } from '@/lib/db';
import { updateMastery } from './mastery.service';
import { autoResolveDebt } from './debt-resolution.service';
import type { LearningEvidence } from '@/lib/algorithms/mastery';

/** Postgres unique_violation. See database/migrations/20260901_1200_evidence_idempotency.sql. */
const PG_UNIQUE_VIOLATION = '23505';
const SUBMISSION_TOKEN_CONSTRAINT = 'assessment_results_submission_token_unique_idx';

function isSubmissionTokenConflict(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string } | undefined;
  return pgErr?.code === PG_UNIQUE_VIOLATION && pgErr?.constraint === SUBMISSION_TOKEN_CONSTRAINT;
}

export type ExamConceptSourceGranularity = 'CONCEPT_MAPPED' | 'TOPICS_LIST' | 'SUBJECT_WIDE';

export interface ExamConceptAttribution {
  conceptId: string;
  sourceGranularity: ExamConceptSourceGranularity;
  coverageWeight: number;
  mappingConfidence: number;
  confidenceWeight: number; // coverageWeight * mappingConfidence, clamped to [0,1] -- what actually gets passed to updateMastery
}

const TOPICS_LIST_MAPPING_CONFIDENCE = 0.7; // explicit concept selection, but no per-concept weight/confidence was ever recorded
const SUBJECT_WIDE_MAPPING_CONFIDENCE = 0.4; // no selection at all -- "covers everything" is the coarsest, least certain attribution available

/**
 * Determines, per concept, how confidently this exam's evidence can be
 * attributed to it -- preferring the most precise mapping this schema
 * can actually express today:
 *   1. CONCEPT_MAPPED -- an explicit assessment_concept_coverage row
 *      exists (weight + mapping_confidence set via mapAssessmentConceptCoverage).
 *   2. TOPICS_LIST -- the occurrence names specific concepts (topics[])
 *      but nobody weighted/confirmed them individually.
 *   3. SUBJECT_WIDE -- no topics selected at all; every concept in the
 *      subject is assumed covered, at the lowest confidence.
 *
 * Question-level and section-level granularity are intentionally not
 * implemented: REAL_SCHOOL_EXAM occurrences are an external calendar
 * entry with no decomposed question/section structure in this schema
 * (unlike internally-generated quizzes). assessment_concept_coverage's
 * source_granularity column is forward-compatible with those tiers
 * once such structure exists, but nothing produces them yet -- that's
 * honest, not a shortcut.
 */
export async function getConceptAttribution(
  occurrenceId: string,
  subjectId: string,
  topics: string[]
): Promise<ExamConceptAttribution[]> {
  const mapped = await db.query(
    `SELECT concept_id, weight, mapping_confidence FROM assessment_concept_coverage WHERE assessment_occurrence_id = $1`,
    [occurrenceId]
  );
  if (mapped.rows.length > 0) {
    return mapped.rows.map((r) => {
      const coverageWeight = Number(r.weight);
      const mappingConfidence = Number(r.mapping_confidence);
      return {
        conceptId: r.concept_id,
        sourceGranularity: 'CONCEPT_MAPPED' as const,
        coverageWeight,
        mappingConfidence,
        confidenceWeight: Math.max(0, Math.min(1, coverageWeight * mappingConfidence)),
      };
    });
  }

  if (topics.length > 0) {
    return topics.map((conceptId) => ({
      conceptId,
      sourceGranularity: 'TOPICS_LIST' as const,
      coverageWeight: 1.0,
      mappingConfidence: TOPICS_LIST_MAPPING_CONFIDENCE,
      confidenceWeight: TOPICS_LIST_MAPPING_CONFIDENCE,
    }));
  }

  const allConcepts = await db.query(`SELECT id FROM concepts WHERE subject_id = $1`, [subjectId]);
  return allConcepts.rows.map((r) => ({
    conceptId: r.id,
    sourceGranularity: 'SUBJECT_WIDE' as const,
    coverageWeight: 1.0,
    mappingConfidence: SUBJECT_WIDE_MAPPING_CONFIDENCE,
    confidenceWeight: SUBJECT_WIDE_MAPPING_CONFIDENCE,
  }));
}

export interface ExamResultInput {
  occurrenceId: string;
  studentId: string;
  score: number;
  maxScore: number;
  /**
   * Phase 2B: an opaque token the CLIENT mints once when the "Record
   * Result" form is opened for a new entry, and reuses for every
   * submit attempt of that same deliberate action -- including a
   * network retry -- until the form is closed and reopened. This is
   * deliberately NOT `occurrenceId` (Phase 2B Step 8's correction):
   * the same occurrence can legitimately be corrected/re-entered later
   * (a genuinely new, deliberate action with its own new token), so
   * `occurrenceId` alone cannot safely mean "duplicate." Optional here
   * -- a caller with no way to maintain a stable per-submission token
   * keeps today's unprotected behavior (see the Phase 2B report's
   * Evidence Writer Audit) rather than being forced into an unsafe
   * default; the one real caller (AssessmentPanel.tsx via
   * /api/assessments/record-result) always supplies one.
   */
  submissionToken?: string;
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
  /** Phase 2B: true when this exact submissionToken was already recorded -- nothing new was written. */
  duplicate: boolean;
}

export async function recordExamResult(
  input: ExamResultInput,
  preferredLanguage: string = 'en'
): Promise<ExamResultOutcome> {
  const { occurrenceId, studentId, score, maxScore, submissionToken } = input;
  const percentage = Math.round((score / maxScore) * 100);

  const occResult = await db.query(
    `SELECT subject_id, topics, exam_readiness FROM assessment_occurrences WHERE id = $1`,
    [occurrenceId]
  );
  const occ = occResult.rows[0];
  if (!occ) throw new Error('Occurrence not found');

  const predictedReadiness = occ.exam_readiness !== null ? Number(occ.exam_readiness) : null;
  const readinessDelta = predictedReadiness !== null ? percentage - predictedReadiness : null;

  // Phase 2B: the atomic claim on submissionToken -- NOT occurrenceId
  // (Phase 2B Step 8: an occurrence may legitimately be corrected/
  // re-entered later; only a transport retry of the SAME deliberate
  // submission should collapse). A conflict here means this exact
  // submission already recorded a result; reuse that row's id/
  // percentage rather than inserting a second one, and let the
  // per-concept updateMastery calls below -- independently gated on
  // the same token -- correctly no-op too.
  let resultId: string;
  let duplicate = false;
  try {
    const resultInsert = await db.query(
      `
      INSERT INTO assessment_results (occurrence_id, student_id, score, max_score, analyzed_at, analysis_result, submission_token)
      VALUES ($1, $2, $3, $4, NOW(), $5, $6)
      RETURNING id, percentage
      `,
      [
        occurrenceId,
        studentId,
        score,
        maxScore,
        JSON.stringify({ predictedReadiness, actualPercentage: percentage, readinessDelta }),
        submissionToken ?? null,
      ]
    );
    resultId = resultInsert.rows[0].id;
  } catch (err) {
    if (submissionToken && isSubmissionTokenConflict(err)) {
      duplicate = true;
      const existing = await db.query(`SELECT id FROM assessment_results WHERE submission_token = $1`, [submissionToken]);
      resultId = existing.rows[0]?.id ?? '';
    } else {
      throw err;
    }
  }

  await db.query(`UPDATE assessment_occurrences SET status = 'result_recorded' WHERE id = $1`, [
    occurrenceId,
  ]);

  const attributions = await getConceptAttribution(occurrenceId, occ.subject_id, occ.topics || []);

  let recalibrated: ConceptRecalibration[] = [];
  if (attributions.length > 0) {
    const conceptIds = attributions.map((a) => a.conceptId);
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

    recalibrated = await Promise.all(
      attributions.map(async (attribution) => {
        const evidence: LearningEvidence = {
          result: percentage >= 70 ? 'correct' : percentage >= 50 ? 'partial' : 'incorrect',
          difficulty: 3,
          sourceType: 'REAL_SCHOOL_EXAM',
          confidenceWeight: attribution.confidenceWeight,
          scorePercent: percentage,
        };
        const masteryResult = await updateMastery({
          studentId,
          conceptId: attribution.conceptId,
          subjectId: occ.subject_id,
          evidence,
          // Phase 2B: only set when the caller supplied a stable
          // per-submission token -- see ExamResultInput.submissionToken.
          // Concept-scoped, same as every other multi-concept writer,
          // so one concept's recalibration replaying safely never
          // blocks another's.
          identity: submissionToken
            ? { operationType: 'REAL_SCHOOL_EXAM', operationId: submissionToken, conceptId: attribution.conceptId }
            : undefined,
          metadata: {
            examConceptAttribution: {
              sourceGranularity: attribution.sourceGranularity,
              coverageWeight: attribution.coverageWeight,
              mappingConfidence: attribution.mappingConfidence,
              occurrenceId,
            },
          },
        });
        const resolution = masteryResult.duplicate
          ? null
          : await autoResolveDebt(studentId, attribution.conceptId).catch(() => null);

        // mastery_records.mastery_score (and updateMastery's old/new/delta,
        // which read and write it) is canonically 0-100 already -- pass
        // through as-is. Do NOT multiply by 100: forensic audit confirmed
        // this column is already percentage points (see mastery-format.ts).
        return {
          conceptId: attribution.conceptId,
          label: labelById.get(attribution.conceptId) || attribution.conceptId,
          previousMastery: masteryResult.oldMastery,
          newMastery: masteryResult.newMastery,
          delta: masteryResult.delta,
          debtResolved: resolution?.resolved ?? false,
        };
      })
    );
  }

  return { resultId, percentage, predictedReadiness, readinessDelta, recalibrated, duplicate };
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
