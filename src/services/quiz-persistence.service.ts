// @ts-nocheck
/**
 * Quiz Persistence Service
 *
 * Stores and retrieves quiz sessions from database instead of memory.
 * Prevents loss on server restart and enables concurrent requests.
 */

import { db } from '@/lib/db';
import { GeneratedQuestion } from '@/services/quiz-generation.service';
import { evidenceModeForActivity, type ActivityType, type EvidenceMode } from '@/lib/activity-taxonomy';

export type QuizMode =
  | 'topic_practice'
  | 'review'
  | 'quick_check'
  | 'retention_check'
  | 'cumulative_assessment'
  | 'exam_simulation'
  | 'diagnostic_check';

/**
 * Phase 3A: the Quiz/Activity Engine's own Activity Type per quiz
 * mode -- fixed at attempt creation (see storeQuiz) and never changed
 * afterward. `quick_check` is deliberately SOLO_CHECK, not
 * CUMULATIVE_ASSESSMENT -- Solo Check must never be represented
 * internally as Cumulative Assessment just because an earlier route
 * happened to reuse that mode for a "prove it alone" moment
 * (Concept Detail's soloCheck CTA did exactly that; it's fixed
 * alongside this).
 */
export const ACTIVITY_TYPE_BY_QUIZ_MODE: Record<QuizMode, ActivityType> = {
  topic_practice: 'PRACTICE',
  review: 'REVIEW',
  quick_check: 'SOLO_CHECK',
  retention_check: 'RETENTION_CHECK',
  cumulative_assessment: 'CUMULATIVE_ASSESSMENT',
  exam_simulation: 'MOCK_EXAM',
  diagnostic_check: 'DIAGNOSTIC_CHECK',
};

export function activityTypeForQuizMode(quizMode: QuizMode): ActivityType {
  return ACTIVITY_TYPE_BY_QUIZ_MODE[quizMode] ?? 'PRACTICE';
}

export function evidenceModeForQuizMode(quizMode: QuizMode): EvidenceMode {
  return evidenceModeForActivity(activityTypeForQuizMode(quizMode));
}

/**
 * CANON-R5R1 -- the trusted, server-persisted v1 launch marker for this
 * session, written ONCE at generation time (storeQuiz) from an
 * independently-verified `getCanonicalPedagogicalDecision` call -- never
 * from a client claim. `null` for every legacy/non-canonical session
 * (the overwhelming majority). See
 * src/lib/pedagogical-decision/v1-practice-launch-marker.ts.
 */
export interface QuizSessionV1Marker {
  pedagogicalPolicyVersion: string;
  canonicalRevision: string;
  canonicalStage: string;
}

export interface QuizSession {
  id: string;
  studentId: string;
  conceptId: string | null;
  subjectId: string;
  conceptIds: string[];
  quizMode: QuizMode;
  activityType: ActivityType;
  evidenceMode: EvidenceMode;
  questions: GeneratedQuestion[];
  language: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'active' | 'completed' | 'expired';
  hintsUsedQuestions: number[];
  v1Marker: QuizSessionV1Marker | null;
}

/**
 * Store generated quiz in database. `conceptId` is the single concept
 * for topic_practice/quick_check quizzes, or null for quizzes spanning
 * multiple concepts (cumulative_assessment/exam_simulation) -- those
 * pass the full set via `conceptIds` instead. Individual questions
 * always carry their own conceptId regardless.
 */
export async function storeQuiz(
  studentId: string,
  conceptId: string | null,
  subjectId: string,
  questions: GeneratedQuestion[],
  language: string = 'en',
  quizMode: QuizMode = 'topic_practice',
  conceptIds: string[] = [],
  /**
   * CANON-R5R1 -- the ALREADY-INDEPENDENTLY-VERIFIED v1 marker (see
   * verifyV1PracticeLaunchMarker), or `null`/omitted for every ordinary
   * (legacy) session. This function never verifies eligibility itself
   * -- it only persists what the caller already confirmed.
   */
  v1Marker: QuizSessionV1Marker | null = null
): Promise<string> {
  try {
    const quizId = `quiz-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 45 * 60 * 1000); // Expire after 45 minutes

    // Phase 3A: Activity Type/Evidence Mode are derived once, here, at
    // attempt creation, and stamped onto the row -- never recomputed or
    // rewritten afterward. That's what makes them immutable per attempt:
    // there is no UPDATE path in this file that touches either column.
    const activityType = activityTypeForQuizMode(quizMode);
    const evidenceMode = evidenceModeForActivity(activityType);

    await db.query(
      `
      INSERT INTO quiz_sessions (
        id, student_id, concept_id, subject_id,
        questions, language, status, created_at, expires_at,
        quiz_mode, concept_ids, activity_type, evidence_mode,
        pedagogical_policy_version, canonical_revision, canonical_stage
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        quizId,
        studentId,
        conceptId,
        subjectId,
        JSON.stringify(questions),
        language,
        'active',
        now,
        expiresAt,
        quizMode,
        conceptIds.length > 0 ? conceptIds : questions.map((q) => q.conceptId),
        activityType,
        evidenceMode,
        v1Marker?.pedagogicalPolicyVersion ?? null,
        v1Marker?.canonicalRevision ?? null,
        v1Marker?.canonicalStage ?? null,
      ]
    );

    return quizId;
  } catch (error) {
    console.error('Error storing quiz:', error);
    throw error;
  }
}

/**
 * Retrieve quiz questions from database
 */
export async function getQuiz(quizId: string): Promise<GeneratedQuestion[] | null> {
  try {
    const result = await db.query(
      `
      SELECT questions, status, expires_at
      FROM quiz_sessions
      WHERE id = $1
      `,
      [quizId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Check if quiz has expired
    if (new Date() > new Date(row.expires_at)) {
      // Mark as expired
      await db.query(
        'UPDATE quiz_sessions SET status = $1 WHERE id = $2',
        ['expired', quizId]
      );
      return null;
    }

    return row.questions;
  } catch (error) {
    console.error('Error retrieving quiz:', error);
    return null;
  }
}

/**
 * Mark quiz as completed
 */
export async function completeQuiz(quizId: string): Promise<boolean> {
  try {
    const result = await db.query(
      `
      UPDATE quiz_sessions
      SET status = $1, completed_at = NOW()
      WHERE id = $2
      `,
      ['completed', quizId]
    );

    return result.rowCount > 0;
  } catch (error) {
    console.error('Error completing quiz:', error);
    return false;
  }
}

/**
 * Records that a hint was requested for a specific question, so
 * submission-time telemetry (learning_evidence.hints_used) knows which
 * concepts got assisted. Idempotent -- requesting a hint twice for the
 * same question doesn't double-count.
 */
export async function recordHintUsed(quizId: string, questionIndex: number): Promise<void> {
  await db.query(
    `
    UPDATE quiz_sessions
    SET hints_used_questions = (
      SELECT ARRAY(SELECT DISTINCT unnest(hints_used_questions || $2::int[]))
    )
    WHERE id = $1
    `,
    [quizId, [questionIndex]]
  );
}

/**
 * Get quiz session metadata
 */
export async function getQuizSession(quizId: string): Promise<QuizSession | null> {
  try {
    const result = await db.query(
      `
      SELECT id, student_id, concept_id, subject_id,
             questions, language, status, created_at, expires_at,
             quiz_mode, concept_ids, hints_used_questions, activity_type, evidence_mode,
             pedagogical_policy_version, canonical_revision, canonical_stage
      FROM quiz_sessions
      WHERE id = $1
      `,
      [quizId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const quizMode: QuizMode = row.quiz_mode || 'topic_practice';
    // Backward compatibility: a row created before this migration has
    // NULL activity_type/evidence_mode -- derive them from its
    // (unchanged) quiz_mode via the same mapping, rather than treating
    // historical attempts as mode-less.
    const activityType: ActivityType = row.activity_type || activityTypeForQuizMode(quizMode);
    const evidenceMode: EvidenceMode = row.evidence_mode || evidenceModeForActivity(activityType);
    // CANON-R5R1 -- a row with NO persisted policy version is an
    // ordinary legacy session, `v1Marker: null` -- never reconstructed
    // or guessed from quiz_mode/current canonical stage at read time.
    const v1Marker: QuizSessionV1Marker | null = row.pedagogical_policy_version
      ? { pedagogicalPolicyVersion: row.pedagogical_policy_version, canonicalRevision: row.canonical_revision, canonicalStage: row.canonical_stage }
      : null;

    return {
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      conceptIds: row.concept_ids || [],
      quizMode,
      activityType,
      evidenceMode,
      questions: row.questions,
      language: row.language,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      status: row.status,
      hintsUsedQuestions: row.hints_used_questions || [],
      v1Marker,
    };
  } catch (error) {
    console.error('Error getting quiz session:', error);
    return null;
  }
}

/**
 * Get all active quizzes for a student
 */
export async function getStudentActiveQuizzes(studentId: string): Promise<QuizSession[]> {
  try {
    const result = await db.query(
      `
      SELECT id, student_id, concept_id, subject_id,
             questions, status, created_at, expires_at, quiz_mode, concept_ids, activity_type, evidence_mode
      FROM quiz_sessions
      WHERE student_id = $1
      AND status = 'active'
      AND expires_at > NOW()
      ORDER BY created_at DESC
      `,
      [studentId]
    );

    return result.rows.map((row) => {
      const quizMode: QuizMode = row.quiz_mode || 'topic_practice';
      const activityType: ActivityType = row.activity_type || activityTypeForQuizMode(quizMode);
      const evidenceMode: EvidenceMode = row.evidence_mode || evidenceModeForActivity(activityType);
      return {
        id: row.id,
        studentId: row.student_id,
        conceptId: row.concept_id,
        subjectId: row.subject_id,
        conceptIds: row.concept_ids || [],
        quizMode,
        activityType,
        evidenceMode,
        questions: row.questions,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
        status: row.status,
        hintsUsedQuestions: [],
        // This listing query doesn't select the v1 marker columns --
        // callers of getStudentActiveQuizzes never need submission
        // authority, only getQuizSession (the real reload path) does.
        v1Marker: null,
      };
    });
  } catch (error) {
    console.error('Error getting student quizzes:', error);
    return [];
  }
}

/**
 * Cleanup expired quizzes (run periodically)
 */
export async function cleanupExpiredQuizzes(): Promise<number> {
  try {
    const result = await db.query(
      `
      DELETE FROM quiz_sessions
      WHERE status = 'expired'
      OR (status = 'active' AND expires_at < NOW())
      `
    );

    return result.rowCount || 0;
  } catch (error) {
    console.error('Error cleaning up quizzes:', error);
    return 0;
  }
}
