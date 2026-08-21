// @ts-nocheck
/**
 * Quiz Persistence Service
 *
 * Stores and retrieves quiz sessions from database instead of memory.
 * Prevents loss on server restart and enables concurrent requests.
 */

import { db } from '@/lib/db';
import { GeneratedQuestion } from '@/services/quiz-generation.service';

export interface QuizSession {
  id: string;
  studentId: string;
  conceptId: string;
  subjectId: string;
  questions: GeneratedQuestion[];
  createdAt: Date;
  expiresAt: Date;
  status: 'active' | 'completed' | 'expired';
}

/**
 * Store generated quiz in database
 */
export async function storeQuiz(
  studentId: string,
  conceptId: string,
  subjectId: string,
  questions: GeneratedQuestion[]
): Promise<string> {
  try {
    const quizId = `quiz-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // Expire after 30 minutes

    await db.query(
      `
      INSERT INTO quiz_sessions (
        id, student_id, concept_id, subject_id,
        questions, status, created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        quizId,
        studentId,
        conceptId,
        subjectId,
        JSON.stringify(questions),
        'active',
        now,
        expiresAt,
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
 * Get quiz session metadata
 */
export async function getQuizSession(quizId: string): Promise<QuizSession | null> {
  try {
    const result = await db.query(
      `
      SELECT id, student_id, concept_id, subject_id,
             questions, status, created_at, expires_at
      FROM quiz_sessions
      WHERE id = $1
      `,
      [quizId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    return {
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      questions: row.questions,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      status: row.status,
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
             questions, status, created_at, expires_at
      FROM quiz_sessions
      WHERE student_id = $1
      AND status = 'active'
      AND expires_at > NOW()
      ORDER BY created_at DESC
      `,
      [studentId]
    );

    return result.rows.map(row => ({
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      questions: row.questions,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      status: row.status,
    }));
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
