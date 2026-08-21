/**
 * Study Plan Service - Generate adaptive daily study plans
 *
 * Process:
 * 1. Get prioritized concepts from priority engine
 * 2. Group by urgency level and subject
 * 3. Balance study load across subjects
 * 4. Create daily sessions with study items
 * 5. Allocate study time based on priority
 */

import { db } from '@/lib/db';
import { ConceptPriority, getStudentStudyPriorities } from './priority-engine.service';

export interface StudySessionItem {
  conceptId: string;
  canonicalId: string;
  label: string;
  activityType: 'review' | 'practice' | 'quiz' | 'deep_dive';
  estimatedMinutes: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  resources: {
    contentChunks?: string[]; // chunk IDs
    relatedConcepts?: string[]; // prerequisite or related concepts
  };
}

export interface StudySession {
  id: string;
  studentId: string;
  date: Date;
  totalMinutes: number;
  items: StudySessionItem[];
  subjectBreakdown: Array<{
    subjectId: string;
    subjectName: string;
    minutes: number;
    conceptCount: number;
  }>;
  notes?: string;
}

export interface StudyPlan {
  studentId: string;
  startDate: Date;
  endDate: Date;
  sessions: StudySession[];
  totalStudyMinutes: number;
  subjectsInPlan: string[];
  criticalConceptsCount: number;
  estimatedCompletionDate?: Date;
}

/**
 * Generate daily study plan for a student
 *
 * Algorithm:
 * 1. Get priorities for all concepts
 * 2. Group by urgency (CRITICAL first, then HIGH, etc.)
 * 3. Allocate time: CRITICAL=40%, HIGH=35%, MEDIUM=20%, LOW=5%
 * 4. Balance across subjects (no subject >60% of daily time)
 * 5. Create sessions with mixed activity types
 */
export async function generateStudyPlan(
  studentId: string,
  options: {
    daysAhead?: number; // How many days to plan (default 7)
    dailyMinutes?: number; // Daily study time budget (default 90)
    startDate?: Date;
    preferredLanguage?: string;
  } = {}
): Promise<StudyPlan> {
  try {
    const daysAhead = options.daysAhead || 7;
    const dailyMinutes = options.dailyMinutes || 90;
    const startDate = options.startDate || new Date();

    // Step 1: Get priorities
    const priorities = await getStudentStudyPriorities(studentId, {
      preferredLanguage: options.preferredLanguage,
    });

    if (priorities.length === 0) {
      throw new Error('No concepts with priority data found for student');
    }

    // Step 2: Group by urgency
    const byUrgency = {
      CRITICAL: priorities.filter(p => p.urgencyLevel === 'CRITICAL'),
      HIGH: priorities.filter(p => p.urgencyLevel === 'HIGH'),
      MEDIUM: priorities.filter(p => p.urgencyLevel === 'MEDIUM'),
      LOW: priorities.filter(p => p.urgencyLevel === 'LOW'),
    };

    // Step 3: Allocate time
    const timeAllocation = {
      CRITICAL: Math.round(dailyMinutes * 0.4),
      HIGH: Math.round(dailyMinutes * 0.35),
      MEDIUM: Math.round(dailyMinutes * 0.2),
      LOW: Math.round(dailyMinutes * 0.05),
    };

    // Step 4: Generate sessions
    const sessions: StudySession[] = [];
    let conceptIndex = 0;

    for (let day = 0; day < daysAhead; day++) {
      const sessionDate = new Date(startDate);
      sessionDate.setDate(sessionDate.getDate() + day);

      const items: StudySessionItem[] = [];
      let dayTotalMinutes = 0;
      const subjectMinutes: { [key: string]: number } = {};
      const subjectNames: { [key: string]: string } = {};

      // Cycle through urgency levels
      for (const urgency of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const) {
        const urgencyPriorities = byUrgency[urgency];
        if (urgencyPriorities.length === 0) continue;

        const timeForUrgency = timeAllocation[urgency];
        let urgencyMinutes = 0;

        // Pick concepts for this urgency level, rotating through them
        for (let i = 0; i < urgencyPriorities.length && urgencyMinutes < timeForUrgency; i++) {
          const idx = (conceptIndex + i) % urgencyPriorities.length;
          const priority = urgencyPriorities[idx];

          // Calculate time for this concept
          let itemMinutes = Math.min(
            priority.estimatedStudyTime,
            timeForUrgency - urgencyMinutes
          );

          // Check subject load balance (max 60% of daily time)
          const subjectId = priority.subjectId;
          const currentSubjectMinutes = subjectMinutes[subjectId] || 0;
          const projectedMinutes = currentSubjectMinutes + itemMinutes;

          if (projectedMinutes > dailyMinutes * 0.6) {
            // Skip this subject if it would exceed load balance
            continue;
          }

          // Choose activity type based on urgency
          let activityType: StudySessionItem['activityType'] = 'review';
          if (urgency === 'CRITICAL') activityType = 'deep_dive';
          else if (urgency === 'HIGH') activityType = 'practice';
          else if (urgency === 'MEDIUM') activityType = 'quiz';
          else activityType = 'review';

          items.push({
            conceptId: priority.conceptId,
            canonicalId: priority.canonicalId,
            label: priority.label,
            activityType,
            estimatedMinutes: itemMinutes,
            priority: urgency,
            resources: {
              contentChunks: [], // Would populate from RAG
              relatedConcepts: [],
            },
          });

          subjectMinutes[subjectId] = projectedMinutes;
          subjectNames[subjectId] = priority.subjectName;
          urgencyMinutes += itemMinutes;
          dayTotalMinutes += itemMinutes;
        }

        conceptIndex = (conceptIndex + urgencyPriorities.length) % priorities.length;
      }

      // Create subject breakdown
      const subjectBreakdown = Object.entries(subjectMinutes).map(([subjectId, minutes]) => ({
        subjectId,
        subjectName: subjectNames[subjectId],
        minutes,
        conceptCount: items.filter(
          item => priorities.find(p => p.conceptId === item.conceptId)?.subjectId === subjectId
        ).length,
      }));

      const session: StudySession = {
        id: `session-${studentId}-${day}`,
        studentId,
        date: sessionDate,
        totalMinutes: dayTotalMinutes,
        items,
        subjectBreakdown,
        notes: `Day ${day + 1} of ${daysAhead}`,
      };

      sessions.push(session);
    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + daysAhead - 1);

    const subjectsInPlan = Array.from(
      new Set(priorities.map(p => p.subjectName))
    );

    const totalStudyMinutes = sessions.reduce((sum, s) => sum + s.totalMinutes, 0);

    return {
      studentId,
      startDate,
      endDate,
      sessions,
      totalStudyMinutes,
      subjectsInPlan,
      criticalConceptsCount: byUrgency.CRITICAL.length,
      estimatedCompletionDate: undefined, // Would calculate based on mastery
    };
  } catch (error) {
    console.error('Error generating study plan:', error);
    throw error;
  }
}

/**
 * Store study plan against the real normalized schema:
 * study_plans (one row) -> study_sessions (one row per day) ->
 * study_session_items (one row per concept in that day). There's no
 * column for total_minutes/subject_breakdown/etc. on the plan or
 * session rows -- those are recomputed on read from the items, which
 * is also what keeps them from ever going stale.
 */
function toDateString(d: Date): string {
  // Local calendar-date components, not toISOString() -- that converts
  // to UTC first, which can shift the date by a day depending on the
  // server's timezone offset relative to the intended local date.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function storeStudyPlan(plan: StudyPlan): Promise<string> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const planResult = await client.query(
      `
      INSERT INTO study_plans (id, student_id, period_start, period_end, generated_at, status)
      VALUES (gen_random_uuid(), $1, $2, $3, NOW(), 'active')
      RETURNING id
      `,
      [plan.studentId, toDateString(plan.startDate), toDateString(plan.endDate)]
    );
    const planId = planResult.rows[0].id;

    for (const session of plan.sessions) {
      const sessionResult = await client.query(
        `
        INSERT INTO study_sessions (id, plan_id, scheduled_date, estimated_duration_minutes, completion_status)
        VALUES (gen_random_uuid(), $1, $2, $3, 'pending')
        RETURNING id
        `,
        [planId, toDateString(session.date), session.totalMinutes]
      );
      const sessionId = sessionResult.rows[0].id;

      let sequence = 0;
      for (const item of session.items) {
        await client.query(
          `
          INSERT INTO study_session_items (id, session_id, concept_id, item_type, reason, sequence, duration_estimate_minutes)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
          `,
          [sessionId, item.conceptId, item.activityType, item.priority, sequence++, item.estimatedMinutes]
        );
      }
    }

    await client.query('COMMIT');
    return planId;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error storing study plan:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get active study plan for student, rebuilt from study_sessions +
 * study_session_items (joined back to concepts/subjects for display).
 */
export async function getActiveStudyPlan(
  studentId: string,
  preferredLanguage: string = 'en'
): Promise<StudyPlan | null> {
  try {
    const planResult = await db.query(
      `
      SELECT id, student_id, period_start, period_end
      FROM study_plans
      WHERE student_id = $1 AND period_end >= CURRENT_DATE AND status = 'active'
      ORDER BY generated_at DESC
      LIMIT 1
      `,
      [studentId]
    );
    if (planResult.rows.length === 0) return null;
    const plan = planResult.rows[0];

    const sessionsResult = await db.query(
      `SELECT id, scheduled_date, estimated_duration_minutes FROM study_sessions WHERE plan_id = $1 ORDER BY scheduled_date ASC`,
      [plan.id]
    );

    const sessions: StudySession[] = await Promise.all(
      sessionsResult.rows.map(async (row) => {
        const itemsResult = await db.query(
          `
          SELECT
            si.concept_id, si.item_type, si.reason, si.duration_estimate_minutes,
            c.canonical_id, c.subject_id, s.name AS subject_name, cl.label
          FROM study_session_items si
          JOIN concepts c ON c.id = si.concept_id
          JOIN subjects s ON s.id = c.subject_id
          LEFT JOIN LATERAL (
            SELECT label FROM concept_localizations
            WHERE concept_id = c.id
            ORDER BY (language = $2) DESC
            LIMIT 1
          ) cl ON true
          WHERE si.session_id = $1
          ORDER BY si.sequence ASC
          `,
          [row.id, preferredLanguage]
        );

        const items: StudySessionItem[] = itemsResult.rows.map((it) => ({
          conceptId: it.concept_id,
          canonicalId: it.canonical_id,
          label: it.label || it.canonical_id,
          activityType: it.item_type,
          estimatedMinutes: it.duration_estimate_minutes || 0,
          priority: it.reason,
          resources: {},
        }));

        const subjectMinutes = new Map<string, { subjectName: string; minutes: number; conceptCount: number }>();
        for (let i = 0; i < items.length; i++) {
          const it = itemsResult.rows[i];
          const entry = subjectMinutes.get(it.subject_id) || { subjectName: it.subject_name, minutes: 0, conceptCount: 0 };
          entry.minutes += items[i].estimatedMinutes;
          entry.conceptCount += 1;
          subjectMinutes.set(it.subject_id, entry);
        }

        return {
          id: row.id,
          studentId,
          date: new Date(row.scheduled_date + 'T00:00:00'),
          totalMinutes: row.estimated_duration_minutes,
          items,
          subjectBreakdown: Array.from(subjectMinutes.entries()).map(([subjectId, v]) => ({
            subjectId,
            subjectName: v.subjectName,
            minutes: v.minutes,
            conceptCount: v.conceptCount,
          })),
        };
      })
    );

    const criticalConceptsCount = sessions.reduce(
      (sum, s) => sum + s.items.filter((i) => i.priority === 'CRITICAL').length,
      0
    );
    const subjectsInPlan = Array.from(
      new Set(sessions.flatMap((s) => s.subjectBreakdown.map((b) => b.subjectName)))
    );

    return {
      studentId: plan.student_id,
      startDate: new Date(plan.period_start + 'T00:00:00'),
      endDate: new Date(plan.period_end + 'T00:00:00'),
      sessions,
      totalStudyMinutes: sessions.reduce((sum, s) => sum + s.totalMinutes, 0),
      subjectsInPlan,
      criticalConceptsCount,
    };
  } catch (error) {
    console.error('Error getting study plan:', error);
    return null;
  }
}

/**
 * Get today's study session recommendations
 */
export async function getTodayStudyPlan(
  studentId: string,
  preferredLanguage: string = 'en'
): Promise<StudySession | null> {
  try {
    const plan = await getActiveStudyPlan(studentId, preferredLanguage);
    if (!plan) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaySession = plan.sessions.find(s => {
      const sessionDate = new Date(s.date);
      sessionDate.setHours(0, 0, 0, 0);
      return sessionDate.getTime() === today.getTime();
    });

    return todaySession || null;
  } catch (error) {
    console.error('Error getting today study plan:', error);
    return null;
  }
}

/**
 * Calculate estimated completion date based on current progress
 */
export async function calculateEstimatedCompletionDate(
  studentId: string,
  targetMastery: number = 85 // mastery_score is 0-100, not 0-1
): Promise<Date> {
  try {
    // Get current mastery stats
    const result = await db.query(
      `
      SELECT
        COUNT(*) as total_concepts,
        SUM(CASE WHEN mastery_score >= $1 THEN 1 ELSE 0 END) as mastered_count
      FROM mastery_records
      WHERE student_id = $2
      `,
      [targetMastery, studentId]
    );

    const row = result.rows[0];
    const totalConcepts = parseInt(row.total_concepts);
    const masteredCount = parseInt(row.mastered_count);
    const remaining = totalConcepts - masteredCount;

    if (remaining === 0) {
      return new Date(); // Already done
    }

    // Estimate: ~3-4 days per concept to master (based on study data)
    const estimatedDays = Math.ceil(remaining * 3.5);
    const completionDate = new Date();
    completionDate.setDate(completionDate.getDate() + estimatedDays);

    return completionDate;
  } catch (error) {
    console.error('Error calculating completion date:', error);
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days
  }
}
