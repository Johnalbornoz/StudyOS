/**
 * Error Intelligence Service - Detects patterns in student mistakes
 *
 * When student makes same error repeatedly (3+ times), system:
 * 1. Creates ErrorPattern (audit + visibility)
 * 2. Escalates LearningDebt
 * 3. Adds to study plan for targeted practice
 * 4. Signals need for intervention
 */

import { db } from '@/lib/db';

export type ErrorType =
  | 'CONCEPTUAL'
  | 'PROCEDURAL'
  | 'CALCULATION'
  | 'MISINTERPRETATION'
  | 'PREREQUISITE_GAP'
  | 'CARELESSNESS'
  | 'INCOMPLETE_KNOWLEDGE';

export interface ErrorRecord {
  id: string;
  studentId: string;
  conceptId: string;
  errorType: ErrorType;
  timestamp: string;
  context: any; // { question, studentAnswer, correctAnswer, difficulty }
}

export interface ErrorPattern {
  id: string;
  conceptId: string;
  errorType: ErrorType;
  recurrenceCount: number;
  lastOccurred: string;
  needsAttention: boolean;
}

/**
 * Record an error occurrence
 *
 * Called after every wrong answer. If this is the 3rd occurrence of same
 * error type on same concept, creates ErrorPattern automatically.
 */
export async function recordError(
  studentId: string,
  conceptId: string,
  errorType: ErrorType,
  context: {
    question: string;
    studentAnswer: string;
    correctAnswer: string;
    difficulty: number;
    confidence?: number;
  }
): Promise<{
  errorId: string;
  patternCreated: boolean;
  pattern?: ErrorPattern;
}> {
  try {
    // Step 1: Insert error record
    const errorResult = await db.query(
      `
      INSERT INTO errors (
        student_id,
        concept_id,
        error_type,
        timestamp,
        context
      ) VALUES ($1, $2, $3, NOW(), $4)
      RETURNING id
      `,
      [
        studentId,
        conceptId,
        errorType,
        JSON.stringify(context),
      ]
    );

    const errorId = errorResult.rows[0].id;

    // Step 2: Count errors of same type for this concept
    const countResult = await db.query(
      `
      SELECT COUNT(*) as count
      FROM errors
      WHERE student_id = $1 AND concept_id = $2 AND error_type = $3
      AND timestamp > NOW() - INTERVAL '30 days'
      `,
      [studentId, conceptId, errorType]
    );

    const errorCount = parseInt(countResult.rows[0].count);

    // Step 3: If 3+ errors of same type, create pattern
    if (errorCount >= 3) {
      const pattern = await createOrUpdatePattern(
        conceptId,
        errorType,
        errorCount
      );

      return {
        errorId,
        patternCreated: true,
        pattern,
      };
    }

    return {
      errorId,
      patternCreated: false,
    };
  } catch (error) {
    console.error('Error recording error:', error);
    throw error;
  }
}

/**
 * Create or update error pattern when detected (3+ occurrences)
 */
async function createOrUpdatePattern(
  conceptId: string,
  errorType: ErrorType,
  recurrenceCount: number
): Promise<ErrorPattern> {
  try {
    // Try to update existing pattern
    const updateResult = await db.query(
      `
      UPDATE error_patterns
      SET
        recurrence_count = $1,
        last_occurred = NOW(),
        needs_attention = true
      WHERE concept_id = $2 AND error_type = $3
      RETURNING
        id,
        concept_id,
        error_type,
        recurrence_count,
        last_occurred,
        needs_attention
      `,
      [recurrenceCount, conceptId, errorType]
    );

    if (updateResult.rows.length > 0) {
      const row = updateResult.rows[0];
      return {
        id: row.id,
        conceptId: row.concept_id,
        errorType: row.error_type,
        recurrenceCount: row.recurrence_count,
        lastOccurred: row.last_occurred,
        needsAttention: row.needs_attention,
      };
    }

    // Insert if doesn't exist
    const insertResult = await db.query(
      `
      INSERT INTO error_patterns (
        concept_id,
        error_type,
        recurrence_count,
        last_occurred,
        needs_attention
      ) VALUES ($1, $2, $3, NOW(), true)
      RETURNING
        id,
        concept_id,
        error_type,
        recurrence_count,
        last_occurred,
        needs_attention
      `,
      [conceptId, errorType, recurrenceCount]
    );

    const row = insertResult.rows[0];
    return {
      id: row.id,
      conceptId: row.concept_id,
      errorType: row.error_type,
      recurrenceCount: row.recurrence_count,
      lastOccurred: row.last_occurred,
      needsAttention: row.needs_attention,
    };
  } catch (error) {
    console.error('Error creating/updating pattern:', error);
    throw error;
  }
}

/**
 * Get active error patterns for a student (for dashboard)
 */
export async function getStudentErrorPatterns(
  studentId: string,
  subjectId?: string
) {
  try {
    let query = `
      SELECT DISTINCT
        ep.id,
        ep.concept_id,
        ep.error_type,
        ep.recurrence_count,
        ep.last_occurred,
        ep.needs_attention,
        c.canonical_id,
        cl.label,
        COUNT(DISTINCT e.id) as recent_error_count
      FROM error_patterns ep
      JOIN concepts c ON ep.concept_id = c.id
      LEFT JOIN concept_localizations cl ON c.id = cl.concept_id AND cl.language = 'en'
      LEFT JOIN errors e ON ep.concept_id = e.concept_id
        AND e.student_id = $1
        AND e.error_type = ep.error_type
        AND e.timestamp > NOW() - INTERVAL '30 days'
      WHERE e.student_id = $1 AND ep.needs_attention = true
    `;

    const params: any[] = [studentId];

    if (subjectId) {
      query += ` AND c.subject_id = $2`;
      params.push(subjectId);
    }

    query += `
      GROUP BY ep.id, c.id, cl.label
      ORDER BY ep.recurrence_count DESC, ep.last_occurred DESC
    `;

    const result = await db.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      conceptId: row.concept_id,
      errorType: row.error_type,
      recurrenceCount: row.recurrence_count,
      lastOccurred: row.last_occurred,
      needsAttention: row.needs_attention,
      concept: {
        id: row.concept_id,
        canonicalId: row.canonical_id,
        label: row.label,
      },
      recentErrorCount: parseInt(row.recent_error_count),
    }));
  } catch (error) {
    console.error('Error fetching error patterns:', error);
    throw error;
  }
}

/**
 * Get error history for a concept
 */
export async function getConceptErrorHistory(
  studentId: string,
  conceptId: string,
  limit: number = 10
) {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        student_id,
        concept_id,
        error_type,
        timestamp,
        context
      FROM errors
      WHERE student_id = $1 AND concept_id = $2
      ORDER BY timestamp DESC
      LIMIT $3
      `,
      [studentId, conceptId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      errorType: row.error_type,
      timestamp: row.timestamp,
      context: row.context,
    }));
  } catch (error) {
    console.error('Error fetching error history:', error);
    throw error;
  }
}

/**
 * Get error statistics by type (for analytics)
 */
export async function getErrorStatistics(studentId: string) {
  try {
    const result = await db.query(
      `
      SELECT
        error_type,
        COUNT(*) as count,
        MAX(timestamp) as last_occurred
      FROM errors
      WHERE student_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
      GROUP BY error_type
      ORDER BY count DESC
      `,
      [studentId]
    );

    return result.rows.map(row => ({
      errorType: row.error_type,
      count: parseInt(row.count),
      lastOccurred: row.last_occurred,
    }));
  } catch (error) {
    console.error('Error fetching error statistics:', error);
    throw error;
  }
}

/**
 * Mark pattern as resolved (no longer needs attention)
 */
export async function resolveErrorPattern(
  conceptId: string,
  errorType: ErrorType
) {
  try {
    const result = await db.query(
      `
      UPDATE error_patterns
      SET needs_attention = false
      WHERE concept_id = $1 AND error_type = $2
      RETURNING
        id,
        concept_id,
        error_type,
        recurrence_count,
        last_occurred,
        needs_attention
      `,
      [conceptId, errorType]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      conceptId: row.concept_id,
      errorType: row.error_type,
      recurrenceCount: row.recurrence_count,
      lastOccurred: row.last_occurred,
      needsAttention: row.needs_attention,
    };
  } catch (error) {
    console.error('Error resolving pattern:', error);
    throw error;
  }
}
