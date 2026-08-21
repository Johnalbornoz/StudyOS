/**
 * Priority Engine - Rank concepts by study urgency
 *
 * Factors:
 * 1. Mastery (low mastery = high priority)
 * 2. Learning debt (active debt = boost priority)
 * 3. Error patterns (recurring errors = high priority)
 * 4. Days until exam (soon = higher priority)
 */

import { db } from '@/lib/db';
import { getUpcomingForStudent } from './assessment.service';

export interface ConceptPriority {
  conceptId: string;
  canonicalId: string;
  label: string;
  mastery: number;
  priority: number; // 0-100 (higher = more urgent)
  reason: string; // Why this is high priority
  estimatedStudyTime: number; // Minutes
  urgencyLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

function scorePriority(
  mastery: number,
  debtSeverity: number,
  errorCount: number,
  daysUntilExam?: number
): { priority: number; urgencyLevel: ConceptPriority['urgencyLevel']; reason: string; estimatedStudyTime: number } {
  const masteryComponent = (100 - mastery) * 0.4; // 0-40 points
  const debtComponent = debtSeverity * 10; // 0-50 points (severity 1-5)
  const errorComponent = Math.min(errorCount * 5, 20); // 0-20 points (capped)
  const examComponent = daysUntilExam !== undefined ? Math.max(0, (7 - daysUntilExam) * 8) : 0;

  const priority = Math.min(100, masteryComponent + debtComponent + errorComponent + examComponent);

  let urgencyLevel: ConceptPriority['urgencyLevel'];
  if (priority >= 75) urgencyLevel = 'CRITICAL';
  else if (priority >= 55) urgencyLevel = 'HIGH';
  else if (priority >= 35) urgencyLevel = 'MEDIUM';
  else urgencyLevel = 'LOW';

  let reason = '';
  if (debtSeverity >= 3) reason += 'Active learning debt. ';
  if (mastery < 40) reason += 'Critical mastery gap. ';
  else if (mastery < 60) reason += 'Weak mastery. ';
  if (errorCount >= 3) reason += 'Recurring errors detected. ';
  if (daysUntilExam !== undefined && daysUntilExam <= 3) reason += 'Exam very soon. ';
  if (!reason) reason = 'Regular maintenance study.';

  const estimatedStudyTime = Math.max(15, Math.min(60, priority / 2));

  return { priority: Math.round(priority * 100) / 100, urgencyLevel, reason: reason.trim(), estimatedStudyTime: Math.round(estimatedStudyTime) };
}

/**
 * Calculate priority for a single concept. Prefer
 * getStudentStudyPriorities for a whole student -- it's a single
 * aggregate query instead of the several per-concept round trips this
 * makes.
 */
export async function calculateConceptPriority(
  studentId: string,
  conceptId: string,
  subjectId: string,
  options: {
    daysUntilExam?: number;
    preferredLanguage?: string;
  } = {}
): Promise<ConceptPriority> {
  const preferredLanguage = options.preferredLanguage || 'en';

  const masteryResult = await db.query(
    `SELECT mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const mastery = Number(masteryResult.rows[0]?.mastery_score) || 0;

  const debtResult = await db.query(
    `SELECT severity FROM learning_debt WHERE student_id = $1 AND concept_id = $2 AND status = 'active'`,
    [studentId, conceptId]
  );
  const debtSeverity = Number(debtResult.rows[0]?.severity) || 0;

  const errorResult = await db.query(
    `SELECT COUNT(*) as error_count FROM errors WHERE student_id = $1 AND concept_id = $2 AND created_at > NOW() - INTERVAL '30 days'`,
    [studentId, conceptId]
  );
  const errorCount = parseInt(errorResult.rows[0]?.error_count || '0', 10);

  const conceptResult = await db.query(
    `
    SELECT c.canonical_id, cl.label
    FROM concepts c
    LEFT JOIN LATERAL (
      SELECT label FROM concept_localizations
      WHERE concept_id = c.id
      ORDER BY (language = $2) DESC
      LIMIT 1
    ) cl ON true
    WHERE c.id = $1
    `,
    [conceptId, preferredLanguage]
  );
  if (conceptResult.rows.length === 0) {
    throw new Error(`Concept ${conceptId} not found`);
  }
  const { canonical_id, label } = conceptResult.rows[0];

  const scored = scorePriority(mastery, debtSeverity, errorCount, options.daysUntilExam);

  return {
    conceptId,
    canonicalId: canonical_id,
    label: label || canonical_id,
    mastery: Math.round(mastery * 100) / 100,
    ...scored,
  };
}

/**
 * Concepts ranked by priority across all of a student's subjects, for
 * a whole-student study plan. One aggregate query for mastery/debt/
 * errors across every concept (previously N sequential per-concept
 * round trips -- with 191 tracked concepts on a real account, that
 * was ~4 sequential queries x 191 = 764 round trips per call).
 */
export async function getStudentStudyPriorities(
  studentId: string,
  options: { limit?: number; preferredLanguage?: string } = {}
): Promise<Array<ConceptPriority & { subjectId: string; subjectName: string }>> {
  const preferredLanguage = options.preferredLanguage || 'en';

  const rows = await db.query(
    `
    SELECT
      c.id AS concept_id,
      c.canonical_id,
      c.subject_id,
      s.name AS subject_name,
      cl.label,
      mr.mastery_score,
      ld.severity AS debt_severity,
      COALESCE(ec.error_count, 0) AS error_count
    FROM mastery_records mr
    JOIN concepts c ON c.id = mr.concept_id
    JOIN subjects s ON s.id = c.subject_id
    LEFT JOIN LATERAL (
      SELECT label FROM concept_localizations
      WHERE concept_id = c.id
      ORDER BY (language = $2) DESC
      LIMIT 1
    ) cl ON true
    LEFT JOIN learning_debt ld
      ON ld.student_id = mr.student_id AND ld.concept_id = mr.concept_id AND ld.status = 'active'
    LEFT JOIN (
      SELECT concept_id, COUNT(*) AS error_count
      FROM errors
      WHERE student_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY concept_id
    ) ec ON ec.concept_id = c.id
    WHERE mr.student_id = $1
    `,
    [studentId, preferredLanguage]
  );

  const upcoming = await getUpcomingForStudent(studentId).catch(() => []);
  const examBySubject = new Map(upcoming.map((o) => [o.subjectId, o]));

  const priorities = rows.rows.map((row) => {
    const mastery = Number(row.mastery_score) || 0;
    const debtSeverity = Number(row.debt_severity) || 0;
    const errorCount = parseInt(row.error_count, 10) || 0;

    const occurrence = examBySubject.get(row.subject_id);
    const daysUntilExam =
      occurrence && (occurrence.topics.length === 0 || occurrence.topics.includes(row.concept_id))
        ? occurrence.daysUntil
        : undefined;

    const scored = scorePriority(mastery, debtSeverity, errorCount, daysUntilExam);

    return {
      conceptId: row.concept_id,
      canonicalId: row.canonical_id,
      label: row.label || row.canonical_id,
      mastery: Math.round(mastery * 100) / 100,
      ...scored,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
    };
  });

  priorities.sort((a, b) => b.priority - a.priority);

  return options.limit ? priorities.slice(0, options.limit) : priorities;
}

/**
 * Priority-ranked concepts within a single subject. Kept for API
 * completeness; getStudentStudyPriorities is the one actually used to
 * build a whole-student study plan.
 */
export async function getRankedConceptsByPriority(
  studentId: string,
  subjectId: string,
  options: { daysUntilExam?: number; limit?: number; preferredLanguage?: string } = {}
): Promise<ConceptPriority[]> {
  const conceptsResult = await db.query(`SELECT id FROM concepts WHERE subject_id = $1`, [subjectId]);

  const priorities = await Promise.all(
    conceptsResult.rows.map((concept) =>
      calculateConceptPriority(studentId, concept.id, subjectId, options)
    )
  );

  priorities.sort((a, b) => b.priority - a.priority);

  return options.limit ? priorities.slice(0, options.limit) : priorities;
}
