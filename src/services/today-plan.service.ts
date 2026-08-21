/**
 * "Today" study plan -- answers the brief's central question, "what
 * should I study today?". Built entirely from data already tracked:
 * mastery_records, learning_debt, the real exam calendar, and each
 * concept's spaced-repetition review interval.
 *
 * A concept earns a spot on today's list for exactly one of four
 * reasons, checked in priority order:
 * 1. exam_soon       -- its subject has an exam within EXAM_SOON_WINDOW_DAYS
 *                       and the concept is one of that exam's topics
 *                       (or the exam has no specific topics, meaning "all").
 * 2. learning_debt   -- it has an active learning-debt record.
 * 3. forgetting_risk -- mastery is otherwise solid, but it hasn't been
 *                       reviewed in a while relative to its spaced-
 *                       repetition interval (see spaced-repetition.ts)
 *                       -- reviewing it now is what prevents it from
 *                       becoming low_mastery later.
 * 4. low_mastery     -- mastery is below LOW_MASTERY_THRESHOLD but not
 *                       otherwise flagged.
 *
 * Every item is also tagged with an urgencyTier (critical / this_week /
 * can_wait) so the UI can group by what genuinely needs attention today
 * vs. what can be scheduled later, instead of one undifferentiated list.
 */

import { db } from '@/lib/db';
import { getUpcomingForStudent } from './assessment.service';
import { calculateReviewIntervalDays, calculateForgettingRisk } from '@/lib/algorithms/spaced-repetition';

export type TodayReason = 'exam_soon' | 'learning_debt' | 'forgetting_risk' | 'low_mastery';
export type UrgencyTier = 'critical' | 'this_week' | 'can_wait';

export interface TodayItem {
  conceptId: string;
  subjectId: string;
  subjectName: string;
  label: string;
  masteryScore: number;
  reason: TodayReason;
  urgencyTier: UrgencyTier;
  daysUntilExam?: number;
  examDate?: string;
  debtSeverity?: number;
  debtSince?: string; // ISO date the debt was created, for traceability
  forgettingRisk?: number;
  daysSincePractice?: number;
}

const EXAM_SOON_WINDOW_DAYS = 7;
const EXAM_CRITICAL_DAYS = 2;
const DEBT_CRITICAL_SEVERITY = 4;
const LOW_MASTERY_THRESHOLD = 60;
const FORGETTING_RISK_THRESHOLD = 50;

function tierFor(item: Pick<TodayItem, 'reason' | 'daysUntilExam' | 'debtSeverity'>): UrgencyTier {
  if (item.reason === 'exam_soon') {
    return (item.daysUntilExam ?? 99) <= EXAM_CRITICAL_DAYS ? 'critical' : 'this_week';
  }
  if (item.reason === 'learning_debt') {
    return (item.debtSeverity ?? 0) >= DEBT_CRITICAL_SEVERITY ? 'critical' : 'this_week';
  }
  if (item.reason === 'forgetting_risk') return 'this_week';
  return 'can_wait';
}

export async function getTodayPlan(
  studentId: string,
  preferredLanguage: string = 'en'
): Promise<{
  critical: TodayItem[];
  thisWeek: TodayItem[];
  canWait: TodayItem[];
  totalConcepts: number;
}> {
  const conceptsResult = await db.query(
    `
    SELECT
      c.id AS concept_id,
      c.canonical_id,
      c.subject_id,
      s.name AS subject_name,
      cl.label,
      mr.mastery_score,
      mr.confidence_score,
      mr.last_practiced,
      ld.severity AS debt_severity,
      ld.status AS debt_status,
      ld.created_at AS debt_created_at
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

    let forgettingRisk: number | undefined;
    let daysSincePractice: number | undefined;
    if (row.last_practiced) {
      daysSincePractice = Math.floor(
        (Date.now() - new Date(row.last_practiced).getTime()) / (1000 * 60 * 60 * 24)
      );
      const intervalDays = calculateReviewIntervalDays(masteryScore, Number(row.confidence_score) || 50);
      forgettingRisk = calculateForgettingRisk(daysSincePractice, intervalDays);
    }

    let reason: TodayReason | null = null;
    if (inExamWindow) reason = 'exam_soon';
    else if (row.debt_status === 'active') reason = 'learning_debt';
    else if (masteryScore >= LOW_MASTERY_THRESHOLD && (forgettingRisk ?? 0) >= FORGETTING_RISK_THRESHOLD) {
      reason = 'forgetting_risk';
    } else if (masteryScore < LOW_MASTERY_THRESHOLD) reason = 'low_mastery';

    if (!reason) continue;

    const daysUntilExam = inExamWindow ? occurrence!.daysUntil : undefined;
    const debtSeverity = row.debt_severity !== null ? Number(row.debt_severity) : undefined;

    items.push({
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      label: row.label || row.canonical_id,
      masteryScore,
      reason,
      urgencyTier: tierFor({ reason, daysUntilExam, debtSeverity }),
      daysUntilExam,
      examDate: inExamWindow ? occurrence!.scheduledDate : undefined,
      debtSeverity,
      debtSince: row.debt_created_at ? new Date(row.debt_created_at).toISOString().slice(0, 10) : undefined,
      forgettingRisk: reason === 'forgetting_risk' ? forgettingRisk : undefined,
      daysSincePractice,
    });
  }

  const priority = (item: TodayItem): number => {
    if (item.reason === 'exam_soon') return 1000 - (item.daysUntilExam ?? 0) * 10;
    if (item.reason === 'learning_debt') return 500 + (item.debtSeverity ?? 0) * 10;
    if (item.reason === 'forgetting_risk') return 200 + (item.forgettingRisk ?? 0);
    return 100 + (LOW_MASTERY_THRESHOLD - item.masteryScore);
  };

  items.sort((a, b) => priority(b) - priority(a));

  return {
    critical: items.filter((i) => i.urgencyTier === 'critical'),
    thisWeek: items.filter((i) => i.urgencyTier === 'this_week').slice(0, 10),
    canWait: items.filter((i) => i.urgencyTier === 'can_wait').slice(0, 8),
    totalConcepts: conceptsResult.rows.length,
  };
}
