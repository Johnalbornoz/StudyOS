/**
 * Mastery Service - Orchestrates mastery calculations and database updates
 *
 * Never updates mastery directly from AI.
 * Always goes through: LearningEvidence → MasteryEngine → MasteryRecord → MasteryEvent
 */

import { db } from '@/lib/db';
import { ensureConceptLocalizations } from './localization.service';
import {
  calculateMasteryDelta,
  calculateConfidence,
  shouldCreateLearningDebt,
  calculateDebtSeverity,
  updateMastery as algorithmUpdateMastery,
  type LearningEvidence,
} from '@/lib/algorithms/mastery';
import { calculateNextReviewDate } from '@/lib/algorithms/spaced-repetition';
import { recalculateConceptKnowledgeState } from './knowledge-state.service';
import { recordDecisionEvent } from '@/lib/audit';

export type AIAssistanceType =
  | 'NONE' | 'HINT' | 'MULTIPLE_HINTS' | 'TUTOR_GUIDANCE' | 'TUTOR_EXPLANATION' | 'WORKED_EXAMPLE' | 'OTHER';
export type LearningMode = 'SOLO' | 'COACH' | 'AI_NATIVE';
// Matches learning_evidence's existing CHECK constraint (migration 021).
export type ConfidenceLevel = 'NOT_SURE' | 'SOMEWHAT_SURE' | 'VERY_SURE';

export interface MasteryUpdateInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
  evidence: LearningEvidence;
  errorClassification?: string; // Optional: CONCEPTUAL, PROCEDURAL, etc.
  telemetry?: {
    activityType?: string; // e.g. 'quiz'
    learningMode?: LearningMode;
    hintsUsed?: number;
    aiAssistanceType?: AIAssistanceType;
    confidenceBeforeAnswer?: ConfidenceLevel; // self-reported, captured before the student saw the result
  };
  // Arbitrary structured context to stamp onto the learning_evidence row
  // this call writes (e.g. exam-attribution granularity, or per-question
  // semantic tags for a multi-question concept bucket). Optional and
  // additive -- existing callers that omit it get exactly the previous
  // behavior (metadata stays NULL). Some earlier callers (e.g.
  // transfer/submit) instead stamp metadata with a follow-up UPDATE
  // after this call returns; both are valid, this is just the direct path.
  metadata?: Record<string, unknown>;
  /**
   * Phase 0E2: set ONLY when this evidence came from one unambiguous
   * AI execution (see src/lib/ai/gateway.ts's AIProvenance.aiExecutionId)
   * -- never fabricated when evidence was deterministic or aggregated
   * multiple/zero AI calls. Links the resulting MASTERY_UPDATED
   * decision_events row to that execution (Step 15).
   */
  aiExecutionId?: string | null;
}

export interface MasteryUpdateResult {
  oldMastery: number;
  newMastery: number;
  delta: number;
  confidenceScore: number;
  learningDebtCreated?: boolean;
  learningDebtSeverity?: number;
  eventId: string;
}

/**
 * Get current mastery record for a student+concept
 */
export async function getMasteryRecord(
  studentId: string,
  conceptId: string
) {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        mastery_score,
        confidence_score,
        attempt_count,
        correct_count,
        incorrect_count,
        last_practiced,
        last_assessed
      FROM mastery_records
      WHERE student_id = $1 AND concept_id = $2
      LIMIT 1
      `,
      [studentId, conceptId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error fetching mastery record:', error);
    throw error;
  }
}

/**
 * Create or get mastery record (auto-create if missing)
 */
export async function getOrCreateMasteryRecord(
  studentId: string,
  conceptId: string,
  subjectId: string
) {
  let record = await getMasteryRecord(studentId, conceptId);

  if (!record) {
    // Auto-create with default values
    const result = await db.query(
      `
      INSERT INTO mastery_records (
        student_id,
        concept_id,
        subject_id,
        mastery_score,
        confidence_score,
        attempt_count,
        correct_count,
        incorrect_count
      ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0)
      RETURNING
        id,
        mastery_score,
        confidence_score,
        attempt_count,
        correct_count,
        incorrect_count,
        last_practiced,
        last_assessed
      `,
      [studentId, conceptId, subjectId]
    );

    record = result.rows[0];
  }

  return record;
}

/**
 * Main method: Update mastery based on learning evidence
 *
 * Steps:
 * 1. Get/create mastery record
 * 2. Calculate new mastery using deterministic algorithm
 * 3. Update attempt counters
 * 4. Calculate confidence score
 * 5. Update mastery_records
 * 6. Create mastery_event (audit trail)
 * 7. Check if learning debt should be created/updated
 * 8. Return results
 */
export async function updateMastery(
  input: MasteryUpdateInput
): Promise<MasteryUpdateResult> {
  const { studentId, conceptId, subjectId, evidence, errorClassification, telemetry, metadata, aiExecutionId } = input;

  // Step 1: Get or create mastery record
  const masteryRecord = await getOrCreateMasteryRecord(
    studentId,
    conceptId,
    subjectId
  );

  const oldMastery = Number.isFinite(Number(masteryRecord.mastery_score))
    ? Number(masteryRecord.mastery_score)
    : 0;

  // Step 2: Calculate new mastery using algorithm
  const rawNewMastery = algorithmUpdateMastery(oldMastery, evidence);
  const newMastery = Number.isFinite(rawNewMastery) ? rawNewMastery : oldMastery;
  const delta = newMastery - oldMastery;

  // Step 3: Update attempt counters
  let correctCount = masteryRecord.correct_count;
  let incorrectCount = masteryRecord.incorrect_count;

  if (evidence.result === 'correct') {
    correctCount += 1;
  } else if (evidence.result === 'incorrect') {
    incorrectCount += 1;
  }

  const attemptCount = masteryRecord.attempt_count + 1;

  // Step 4: Calculate confidence score
  const recentResults: any[] = await getRecentResults(studentId, conceptId, 5);
  const confidenceInput = {
    mastery: newMastery,
    recentResults: recentResults.map(r => r.result as any),
    daysSinceLastAttempt: getDaysSinceLastAttempt(masteryRecord.last_practiced),
    attemptCount,
    correctCount,
  };

  const confidenceScore = calculateConfidence(confidenceInput);

  // Next time this concept is due for review -- interval scales with
  // the mastery/confidence just calculated, so well-known concepts get
  // spaced out further than ones just past the "solid" threshold.
  const nextReviewDate = calculateNextReviewDate(newMastery, confidenceScore);

  // Step 5: Update mastery_records
  const updateResult = await db.query(
    `
    UPDATE mastery_records
    SET
      mastery_score = $1,
      confidence_score = $2,
      attempt_count = $3,
      correct_count = $4,
      incorrect_count = $5,
      last_practiced = NOW(),
      next_review_date = $8,
      updated_at = NOW()
    WHERE student_id = $6 AND concept_id = $7
    RETURNING id
    `,
    [
      newMastery,
      confidenceScore,
      attemptCount,
      correctCount,
      incorrectCount,
      studentId,
      conceptId,
      nextReviewDate,
    ]
  );

  const masteryRecordId = updateResult.rows[0].id;

  // Step 6: Create mastery_event (audit trail)
  const eventResult = await db.query(
    `
    INSERT INTO mastery_events (
      mastery_id,
      old_score,
      new_score,
      delta_reason,
      created_at
    ) VALUES ($1, $2, $3, $4, NOW())
    RETURNING id
    `,
    [
      masteryRecordId,
      oldMastery,
      newMastery,
      `${evidence.sourceType}:${evidence.result}`.slice(0, 50),
    ]
  );

  const eventId = eventResult.rows[0].id;

  // Step 7: Check if learning debt should be created/updated
  const recurrenceCount = incorrectCount; // Simple: count of incorrect answers
  const shouldCreateDebt = shouldCreateLearningDebt(
    newMastery,
    evidence.sourceType === 'TOPIC_ASSESSMENT' || evidence.sourceType === 'CUMULATIVE_ASSESSMENT',
    evidence.sourceType === 'PRACTICE_QUIZ' || evidence.sourceType === 'PRACTICE_QUESTION',
    false, // TODO: check if prerequisite to upcoming exam
    recurrenceCount
  );

  let learningDebtCreated = false;
  let learningDebtSeverity = 0;

  if (shouldCreateDebt) {
    const severity = calculateDebtSeverity(
      newMastery,
      recurrenceCount,
      false // TODO: check if prerequisite to upcoming exam
    );

    // Upsert learning debt
    const debtResult = await db.query(
      `
      INSERT INTO learning_debt (
        student_id,
        concept_id,
        subject_id,
        severity,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, 'active', NOW())
      ON CONFLICT (student_id, concept_id)
      DO UPDATE SET
        severity = $4,
        status = 'active',
        resolved_at = NULL
      RETURNING id
      `,
      [studentId, conceptId, subjectId, severity]
    );

    learningDebtCreated = true;
    learningDebtSeverity = severity;

    // Phase 0E2 Step 19: shouldCreateLearningDebt's own boolean
    // condition, spelled out as a machine-readable reason -- mastery
    // below 60 AND (attempted recently in assessment/practice, or
    // recurrence >= 2, or blocking an upcoming exam). Never a fabricated
    // reason beyond what the algorithm actually evaluated.
    await recordDecisionEvent({
      decisionType: 'LEARNING_DEBT_CREATED',
      engine: 'debt-resolution-engine',
      engineVersion: 'v1',
      studentId,
      subjectId,
      conceptId,
      sourceEventType: 'learning_debt',
      sourceEventId: debtResult.rows[0]?.id ?? null,
      newState: { severity, status: 'active' },
      reasonCode: 'LOW_MASTERY_WITH_RECENT_ATTEMPT',
      reasonDetails: { mastery: newMastery, recurrenceCount, sourceType: evidence.sourceType },
    });
  }

  // Step 8: Store learning evidence (for history + error analysis, and
  // for the Learner Model's AI-assistance telemetry -- hints_used/
  // ai_assistance_type/learning_mode feed Independent Mastery,
  // Evidence Strength, and Confidence Calibration).
  const evidenceResult = await db.query(
    `
    INSERT INTO learning_evidence (
      student_id,
      concept_id,
      source_type,
      result,
      difficulty,
      timestamp,
      subject_id,
      activity_type,
      learning_mode,
      hints_used,
      ai_assistance_type,
      confidence_before_answer,
      score_percent,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id
    `,
    [
      studentId,
      conceptId,
      evidence.sourceType,
      evidence.result,
      evidence.difficulty,
      subjectId,
      telemetry?.activityType ?? null,
      telemetry?.learningMode ?? null,
      telemetry?.hintsUsed ?? 0,
      telemetry?.aiAssistanceType ?? (telemetry?.hintsUsed ? (telemetry.hintsUsed > 1 ? 'MULTIPLE_HINTS' : 'HINT') : 'NONE'),
      telemetry?.confidenceBeforeAnswer ?? null,
      evidence.scorePercent ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  const learningEvidenceId = evidenceResult.rows[0]?.id ?? null;

  // Phase 0E2 Step 14: cross-engine auditability for the mastery update
  // that just happened -- mastery_events (above) remains the domain
  // history record; this is the uniform-shaped, cross-engine-queryable
  // twin of it. reasonCode reuses the exact string already computed for
  // mastery_events.delta_reason (Step 7: prefer an existing exposed
  // reason over inventing a new one).
  await recordDecisionEvent({
    decisionType: 'MASTERY_UPDATED',
    engine: 'mastery-engine',
    engineVersion: 'v1',
    studentId,
    subjectId,
    conceptId,
    sourceEventType: 'learning_evidence',
    sourceEventId: learningEvidenceId,
    previousState: { masteryScore: oldMastery },
    newState: { masteryScore: newMastery, confidenceScore },
    reasonCode: `${evidence.sourceType}:${evidence.result}`.slice(0, 50),
    reasonDetails: {
      sourceType: evidence.sourceType,
      result: evidence.result,
      scorePercent: evidence.scorePercent ?? null,
      sampleSize: evidence.sampleSize ?? null,
      delta,
    },
    // Never fabricated -- see the MasteryUpdateInput.aiExecutionId doc comment.
    aiExecutionId: aiExecutionId ?? null,
  });

  // Step 9: Log a classified error, if this was a wrong/partial answer
  // and the caller classified why -- feeds error-intelligence.service.ts's
  // pattern detection (e.g. "keeps making procedural errors in Algebra").
  if (errorClassification && evidence.result !== 'correct') {
    await db.query(
      `
      INSERT INTO errors (student_id, concept_id, subject_id, error_type, source_type)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [studentId, conceptId, subjectId, errorClassification, evidence.sourceType]
    );
  }

  // Step 10: Phase 2.2A -- recompute Concept Knowledge State from the
  // evidence just written. Knowledge State is a projection, never a
  // second source of truth; this keeps it immediately current with
  // every evidence-writing action, the same way mastery_records itself
  // updates synchronously above. Never allowed to fail the actual quiz
  // submission this evidence came from.
  await recalculateConceptKnowledgeState(studentId, conceptId).catch((err) =>
    console.error('Knowledge State recalculation failed:', err)
  );

  return {
    oldMastery,
    newMastery,
    delta,
    confidenceScore,
    learningDebtCreated,
    learningDebtSeverity,
    eventId,
  };
}

/**
 * Get recent results for a concept (for confidence calculation)
 */
async function getRecentResults(
  studentId: string,
  conceptId: string,
  limit: number = 5
) {
  const result = await db.query(
    `
    SELECT result
    FROM learning_evidence
    WHERE student_id = $1 AND concept_id = $2
    ORDER BY timestamp DESC
    LIMIT $3
    `,
    [studentId, conceptId, limit]
  );

  return result.rows;
}

/**
 * Calculate days since last attempt
 */
function getDaysSinceLastAttempt(lastPracticedDate: string | null): number {
  if (!lastPracticedDate) return 999; // Never attempted

  const last = new Date(lastPracticedDate).getTime();
  const now = new Date().getTime();
  const daysDiff = (now - last) / (1000 * 60 * 60 * 24);

  return Math.floor(daysDiff);
}

/**
 * Get mastery progression for a concept (for visualization)
 */
export async function getMasteryHistory(
  studentId: string,
  conceptId: string,
  limit: number = 20
) {
  const result = await db.query(
    `
    SELECT
      created_at as timestamp,
      old_score,
      new_score,
      delta_reason
    FROM mastery_events
    WHERE mastery_id IN (
      SELECT id FROM mastery_records
      WHERE student_id = $1 AND concept_id = $2
    )
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [studentId, conceptId, limit]
  );

  return result.rows;
}

/**
 * Get all concepts for a student with current mastery
 */
export async function getStudentMastery(
  studentId: string,
  subjectId?: string,
  preferredLanguage: string = 'en',
  ensureLabels: boolean = false
) {
  if (ensureLabels) {
    const idsQuery = subjectId
      ? `SELECT c.id FROM mastery_records mr JOIN concepts c ON mr.concept_id = c.id WHERE mr.student_id = $1 AND mr.subject_id = $2`
      : `SELECT c.id FROM mastery_records mr JOIN concepts c ON mr.concept_id = c.id WHERE mr.student_id = $1`;
    const idsParams = subjectId ? [studentId, subjectId] : [studentId];
    const idsResult = await db.query(idsQuery, idsParams);
    // Non-blocking: a large subject could take a while to translate on
    // first view. Concepts fall back to canonical_id until it completes.
    ensureConceptLocalizations(idsResult.rows.map((r) => r.id), preferredLanguage).catch((err) =>
      console.error('Background concept localization failed:', err)
    );
  }

  let query = `
    SELECT
      c.id as concept_id,
      c.canonical_id,
      COALESCE(cl.label, c.canonical_id) as label,
      mr.mastery_score,
      mr.confidence_score,
      mr.attempt_count,
      mr.last_practiced,
      ld.severity as learning_debt_severity,
      ld.status as learning_debt_status
    FROM mastery_records mr
    JOIN concepts c ON mr.concept_id = c.id
    LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
    LEFT JOIN learning_debt ld ON mr.student_id = ld.student_id AND mr.concept_id = ld.concept_id AND ld.status = 'active'
    WHERE mr.student_id = $1
  `;

  const params: any[] = [studentId, preferredLanguage];

  if (subjectId) {
    query += ` AND mr.subject_id = $3`;
    params.push(subjectId);
  }

  query += ` ORDER BY mr.mastery_score ASC`;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Delete a concept. A mastery_records row, a concept_localizations
 * row, and (if generated) a concept_explanations row are all
 * structural -- created alongside the concept rather than being
 * "history" -- so they're removed as part of the same operation. Real
 * activity -- mastery_events, quiz_sessions, errors, learning_debt,
 * study_session_items, learning_evidence -- still blocks the delete
 * via the DB's own foreign keys (all NO ACTION), surfaced here as
 * HAS_HISTORY so the caller can suggest archiving instead.
 */
export async function deleteConcept(
  studentId: string,
  conceptId: string
): Promise<{ success: boolean; error?: 'NOT_FOUND' | 'HAS_HISTORY' }> {
  const client = await db.connect();
  try {
    const ownership = await client.query(
      `SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1 AND s.student_id = $2`,
      [conceptId, studentId]
    );
    if (ownership.rowCount === 0) {
      return { success: false, error: 'NOT_FOUND' };
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM concept_localizations WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM concept_explanations WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM mastery_records WHERE concept_id = $1 AND student_id = $2`, [
      conceptId,
      studentId,
    ]);
    await client.query(`DELETE FROM concepts WHERE id = $1`, [conceptId]);
    await client.query('COMMIT');
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      return { success: false, error: 'HAS_HISTORY' };
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Upserts today's average-mastery snapshot for a subject. Cheap and
 * idempotent (one row per subject per day) -- safe to call on every
 * dashboard load without awaiting it.
 */
export async function recordDailyMasterySnapshot(
  studentId: string,
  subjectId: string,
  avgMasteryScore: number
): Promise<void> {
  await db.query(
    `
    INSERT INTO subject_mastery_snapshots (student_id, subject_id, snapshot_date, avg_mastery_score)
    VALUES ($1, $2, CURRENT_DATE, $3)
    ON CONFLICT (subject_id, snapshot_date) DO UPDATE SET avg_mastery_score = EXCLUDED.avg_mastery_score
    `,
    [studentId, subjectId, Math.round(avgMasteryScore)]
  );
}

/**
 * Recent daily mastery trend for a subject, oldest first. Returns
 * however many snapshots exist within the window (0 to `days`) --
 * callers should treat fewer than 2 points as "not enough history yet"
 * rather than rendering a misleading single-point line.
 */
export async function getMasteryTrend(subjectId: string, days: number = 14): Promise<number[]> {
  const result = await db.query(
    `
    SELECT avg_mastery_score FROM subject_mastery_snapshots
    WHERE subject_id = $1 AND snapshot_date >= CURRENT_DATE - $2::int
    ORDER BY snapshot_date ASC
    `,
    [subjectId, days]
  );
  return result.rows.map((r) => Number(r.avg_mastery_score));
}
