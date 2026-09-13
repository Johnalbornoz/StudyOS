/**
 * Real study streak -- how many consecutive calendar days (in the
 * student's own timezone, when known) the student has done something
 * that actually moved a mastery score: a quiz, a real exam result, a
 * guided exercise. mastery_events already logs exactly that, one row
 * per practice interaction, so no new table is needed.
 *
 * A streak only counts as "current" if the most recent activity day
 * was today or yesterday -- skip a day and it resets to 0, same
 * convention as any other streak feature.
 */

import { db } from '@/lib/db';

function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calculateStreak(activityDatesDesc: string[]): number {
  if (activityDatesDesc.length === 0) return 0;

  const todayStr = toDateString(new Date());
  const yesterdayStr = toDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

  if (activityDatesDesc[0] !== todayStr && activityDatesDesc[0] !== yesterdayStr) {
    return 0;
  }

  let streak = 1;
  for (let i = 1; i < activityDatesDesc.length; i++) {
    const prevDate = new Date(activityDatesDesc[i - 1] + 'T00:00:00');
    const expected = toDateString(new Date(prevDate.getTime() - 24 * 60 * 60 * 1000));
    if (activityDatesDesc[i] === expected) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export async function getStudentStreak(studentId: string): Promise<number> {
  const result = await db.query(
    `
    SELECT DISTINCT (me.created_at AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date AS activity_date
    FROM mastery_events me
    JOIN mastery_records mr ON mr.id = me.mastery_id
    JOIN students s ON s.id = mr.student_id
    WHERE mr.student_id = $1
    ORDER BY activity_date DESC
    `,
    [studentId]
  );

  const dates: string[] = result.rows.map((r) => r.activity_date);
  return calculateStreak(dates);
}

/**
 * LX-9 A5: a calm, non-punitive alternative to a raw consecutive-day
 * streak number -- "3 learning days this week" rather than a big
 * cumulative count that implicitly invites loss-aversion pressure as it
 * grows ("Don't lose your 87-day streak!"). Counts DISTINCT calendar
 * days (in the student's own timezone, same `mastery_events` source
 * `getStudentStreak` already uses) with real learning activity within
 * the CURRENT calendar week (Monday-Sunday, matching Postgres's own
 * ISO-8601 `date_trunc('week', ...)`). Bounded to [0, 7] by
 * construction -- it can never grow into a large number, and a week
 * with zero days is simply 0, never implying anything was lost:
 * competence/mastery are computed entirely elsewhere and are never
 * touched by this count.
 */
export async function getLearningDaysThisWeek(studentId: string): Promise<number> {
  const result = await db.query(
    `
    SELECT COUNT(DISTINCT (me.created_at AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date) AS days
    FROM mastery_events me
    JOIN mastery_records mr ON mr.id = me.mastery_id
    JOIN students s ON s.id = mr.student_id
    WHERE mr.student_id = $1
      AND (me.created_at AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date
          >= date_trunc('week', (NOW() AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date)::date
    `,
    [studentId]
  );
  return Number(result.rows[0]?.days ?? 0);
}
