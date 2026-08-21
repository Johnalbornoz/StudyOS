/**
 * Mastery Service - Orchestrates mastery calculations and database updates
 *
 * Never updates mastery directly from AI.
 * Always goes through: LearningEvidence → MasteryEngine → MasteryRecord → MasteryEvent
 */

import { db } from '@/lib/db';
import {
  calculateMasteryDelta,
  calculateConfidence,
  shouldCreateLearningDebt,
  calculateDebtSeverity,
  updateMastery as algorithmUpdateMastery,
  type LearningEvidence,
} from '@/lib/algorithms/mastery';

export interface MasteryUpdateInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
  evidence: LearningEvidence;
  errorClassification?: string; // Optional: CONCEPTUAL, PROCEDURAL, etc.
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
  const { studentId, conceptId, subjectId, evidence, errorClassification } = input;

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
    await db.query(
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
      `,
      [studentId, conceptId, subjectId, severity]
    );

    learningDebtCreated = true;
    learningDebtSeverity = severity;
  }

  // Step 8: Store learning evidence (for history + error analysis)
  await db.query(
    `
    INSERT INTO learning_evidence (
      student_id,
      concept_id,
      source_type,
      result,
      difficulty,
      timestamp
    ) VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [studentId, conceptId, evidence.sourceType, evidence.result, evidence.difficulty]
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
  subjectId?: string
) {
  let query = `
    SELECT
      c.id as concept_id,
      c.canonical_id,
      cl.label,
      mr.mastery_score,
      mr.confidence_score,
      mr.attempt_count,
      mr.last_practiced,
      ld.severity as learning_debt_severity,
      ld.status as learning_debt_status
    FROM mastery_records mr
    JOIN concepts c ON mr.concept_id = c.id
    LEFT JOIN concept_localizations cl ON c.id = cl.concept_id AND cl.language = 'en'
    LEFT JOIN learning_debt ld ON mr.student_id = ld.student_id AND mr.concept_id = ld.concept_id AND ld.status = 'active'
    WHERE mr.student_id = $1
  `;

  const params: any[] = [studentId];

  if (subjectId) {
    query += ` AND mr.subject_id = $2`;
    params.push(subjectId);
  }

  query += ` ORDER BY mr.mastery_score ASC`;

  const result = await db.query(query, params);
  return result.rows;
}
