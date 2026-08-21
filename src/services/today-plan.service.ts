/**
 * "Today" study plan -- answers the brief's central question, "what
 * should I study today?", without needing a spaced-repetition schema
 * that doesn't exist yet. Built entirely from data already tracked:
 * mastery_records, learning_debt, and the real exam calendar.
 *
 * A concept earns a spot on today's list for exactly one of three
 * reasons, checked in priority order:
 * 1. exam_soon      -- its subject has an exam within EXAM_SOON_WINDOW_DAYS
 *                      and the concept is one of that exam's topics
 *                      (or the exam has no specific topics, meaning "all").
 * 2. learning_debt  -- it has an active learning-debt record.
 * 3. low_mastery     -- mastery is below LOW_MASTERY_THRESHOLD but not
 *                      otherwise flagged.
 */

import { db } from '@/lib/db';
import { getUpcomingForStudent } from './assessment.service';

export type TodayReason = 'exam_soon' | 'learning_debt' | 'low_mastery';

export interface TodayItem {
  conceptId: string;
  subjectId: string;
  subjectName: string;
  label: string;
  masteryScore: number;
  reason: TodayReason;
  daysUntilExam?: number;
  debtSeverity?: number;
}

const EXAM_SOON_WINDOW_DAYS = 7;
const LOW_MASTERY_THRESHOLD = 60;
const MAX_ITEMS = 12;

export async function getTodayPlan(
  studentId: string,
  preferredLanguage: string = 'en'
): Promise<{ items: TodayItem[]; totalConcepts: number }> {
  const conceptsResult = await db.query(
    `
    SELECT
      c.id AS concept_id,
      c.canonical_id,
      c.subject_id,
      s.name AS subject_name,
      cl.label,
      mr.mastery_score,
      ld.severity AS debt_severity,
      ld.status AS debt_status
    FROM mastery_records mr
    JOIN concepts c ON mr.concept_id = c.id
    JOIN subjects s ON c.subject_id = s.id
    LEFT JOIN LATERAL (
      SELECT label FROM concept_localizations
      WHERE concept_id = c.id
      ORDER BY (language = $2) DESC
      LIMIT 1
    ) cl ON true
    LEFT JOIN learning_debt ld
      ON ld.student_id = mr.student_id AND ld.concept_id = mr.concept_id AND ld.status = 'active'
    WHERE mr.student_id = $1 AND s.student_id = $1
    `,
    [studentId, preferredLanguage]
  );

  const upcoming = await getUpcomingForStudent(studentId).catch(() => []);
  const examBySubject = new Map(upcoming.map((o) => [o.subjectId, o]));

  const items: TodayItem[] = [];
  for (const row of conceptsResult.rows) {
    const masteryScore = Number(row.mastery_score);
    const occurrence = examBySubject.get(row.subject_id);

    const inExamWindow = Boolean(
      occurrence &&
        occurrence.daysUntil >= 0 &&
        occurrence.daysUntil <= EXAM_SOON_WINDOW_DAYS &&
        (occurrence.topics.length === 0 || occurrence.topics.includes(row.concept_id))
    );

    let reason: TodayReason | null = null;
    if (inExamWindow) reason = 'exam_soon';
    else if (row.debt_status === 'active') reason = 'learning_debt';
    else if (masteryScore < LOW_MASTERY_THRESHOLD) reason = 'low_mastery';

    if (!reason) continue;

    items.push({
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      label: row.label || row.canonical_id,
      masteryScore,
      reason,
      daysUntilExam: inExamWindow ? occurrence!.daysUntil : undefined,
      debtSeverity: row.debt_severity !== null ? Number(row.debt_severity) : undefined,
    });
  }

  const priority = (item: TodayItem): number => {
    if (item.reason === 'exam_soon') return 1000 - (item.daysUntilExam ?? 0) * 10;
    if (item.reason === 'learning_debt') return 500 + (item.debtSeverity ?? 0) * 10;
    return 100 + (LOW_MASTERY_THRESHOLD - item.masteryScore);
  };

  items.sort((a, b) => priority(b) - priority(a));

  return {
    items: items.slice(0, MAX_ITEMS),
    totalConcepts: conceptsResult.rows.length,
  };
}
