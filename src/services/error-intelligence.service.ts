/**
 * Error intelligence: turns individual classified mistakes (see the
 * `errors` table, written from mastery.service.ts and quiz grading)
 * into patterns a student can act on -- "you keep making procedural
 * errors in Algebra" is more useful than a bare wrong/right count.
 *
 * Patterns are always a GROUP BY over `errors`, not a separately
 * maintained table -- there's nothing to keep in sync, and the numbers
 * are always current.
 */

import { db } from '@/lib/db';

export type ErrorType = 'CONCEPTUAL' | 'PROCEDURAL' | 'CARELESS' | 'INCOMPLETE' | 'MISREADING';

export interface RecordErrorInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
  errorType: string;
  sourceType: string;
}

export async function recordError(input: RecordErrorInput): Promise<void> {
  await db.query(
    `INSERT INTO errors (student_id, concept_id, subject_id, error_type, source_type) VALUES ($1, $2, $3, $4, $5)`,
    [input.studentId, input.conceptId, input.subjectId, input.errorType, input.sourceType]
  );
}

export interface ErrorPattern {
  errorType: string;
  count: number;
  subjectId: string;
  subjectName: string;
  topConceptId: string;
  topConceptLabel: string;
  topConceptCount: number;
  lastOccurredAt: string;
}

/**
 * Recurring error types for a student (optionally scoped to one
 * subject), most frequent first. Only returns a type once it has
 * recurred at least MIN_OCCURRENCES times within the last
 * RECENCY_WINDOW_DAYS -- a single mistake isn't a pattern, and an old
 * one the student has since fixed shouldn't haunt them forever.
 */
export async function getErrorPatterns(
  studentId: string,
  subjectId?: string,
  preferredLanguage: string = 'en'
): Promise<ErrorPattern[]> {
  const MIN_OCCURRENCES = 2;
  const RECENCY_WINDOW_DAYS = 30;

  let sql = `
    SELECT
      e.error_type,
      e.subject_id,
      s.name AS subject_name,
      COUNT(*) AS total_count,
      MAX(e.created_at) AS last_occurred_at
    FROM errors e
    JOIN subjects s ON s.id = e.subject_id
    WHERE e.student_id = $1 AND e.created_at > NOW() - INTERVAL '${RECENCY_WINDOW_DAYS} days'
  `;
  const params: any[] = [studentId];
  if (subjectId) {
    sql += ` AND e.subject_id = $2`;
    params.push(subjectId);
  }
  sql += `
    GROUP BY e.error_type, e.subject_id, s.name
    HAVING COUNT(*) >= ${MIN_OCCURRENCES}
    ORDER BY total_count DESC
    LIMIT 8
  `;

  const grouped = await db.query(sql, params);

  const patterns: ErrorPattern[] = await Promise.all(
    grouped.rows.map(async (row) => {
      const topConceptResult = await db.query(
        `
        SELECT e.concept_id, cl.label, c.canonical_id, COUNT(*) AS concept_count
        FROM errors e
        JOIN concepts c ON c.id = e.concept_id
        LEFT JOIN LATERAL (
          SELECT label FROM concept_localizations
          WHERE concept_id = c.id
          ORDER BY (language = $3) DESC
          LIMIT 1
        ) cl ON true
        WHERE e.student_id = $1 AND e.subject_id = $2 AND e.error_type = $4
          AND e.created_at > NOW() - INTERVAL '${RECENCY_WINDOW_DAYS} days'
        GROUP BY e.concept_id, cl.label, c.canonical_id
        ORDER BY concept_count DESC
        LIMIT 1
        `,
        [studentId, row.subject_id, preferredLanguage, row.error_type]
      );
      const top = topConceptResult.rows[0];

      return {
        errorType: row.error_type,
        count: Number(row.total_count),
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        topConceptId: top?.concept_id ?? '',
        topConceptLabel: top?.label || top?.canonical_id || '',
        topConceptCount: top ? Number(top.concept_count) : 0,
        lastOccurredAt: row.last_occurred_at,
      };
    })
  );

  return patterns;
}
