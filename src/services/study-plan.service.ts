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
  } = {}
): Promise<StudyPlan> {
  try {
    const daysAhead = options.daysAhead || 7;
    const dailyMinutes = options.dailyMinutes || 90;
    const startDate = options.startDate || new Date();

    // Step 1: Get priorities
    const priorities = await getStudentStudyPriorities(studentId);

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
 * Store study plan in database
 */
export async function storeStudyPlan(plan: StudyPlan): Promise<string> {
  try {
    const result = await db.query(
      `
      INSERT INTO study_plans (
        student_id, start_date, end_date, total_minutes,
        subjects_in_plan, critical_concepts_count, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id
      `,
      [
        plan.studentId,
        plan.startDate,
        plan.endDate,
        plan.totalStudyMinutes,
        JSON.stringify(plan.subjectsInPlan),
        plan.criticalConceptsCount,
      ]
    );

    const planId = result.rows[0].id;

    // Store sessions
    for (const session of plan.sessions) {
      await db.query(
        `
        INSERT INTO study_sessions (
          study_plan_id, student_id, session_date,
          total_minutes, subject_breakdown, items, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [
          planId,
          session.studentId,
          session.date,
          session.totalMinutes,
          JSON.stringify(session.subjectBreakdown),
          JSON.stringify(session.items),
        ]
      );
    }

    return planId;
  } catch (error) {
    console.error('Error storing study plan:', error);
    throw error;
  }
}

/**
 * Get active study plan for student
 */
export async function getActiveStudyPlan(studentId: string): Promise<StudyPlan | null> {
  try {
    const result = await db.query(
      `
      SELECT * FROM study_plans
      WHERE student_id = $1 AND end_date >= TODAY()
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [studentId]
    );

    if (result.rows.length === 0) return null;

    const plan = result.rows[0];

    // Get sessions
    const sessionsResult = await db.query(
      `
      SELECT * FROM study_sessions
      WHERE study_plan_id = $1
      ORDER BY session_date ASC
      `,
      [plan.id]
    );

    const sessions: StudySession[] = sessionsResult.rows.map(row => ({
      id: row.id,
      studentId: row.student_id,
      date: new Date(row.session_date),
      totalMinutes: row.total_minutes,
      items: JSON.parse(row.items),
      subjectBreakdown: JSON.parse(row.subject_breakdown),
      notes: row.notes,
    }));

    return {
      studentId: plan.student_id,
      startDate: new Date(plan.start_date),
      endDate: new Date(plan.end_date),
      sessions,
      totalStudyMinutes: plan.total_minutes,
      subjectsInPlan: JSON.parse(plan.subjects_in_plan),
      criticalConceptsCount: plan.critical_concepts_count,
    };
  } catch (error) {
    console.error('Error getting study plan:', error);
    return null;
  }
}

/**
 * Get today's study session recommendations
 */
export async function getTodayStudyPlan(studentId: string): Promise<StudySession | null> {
  try {
    const plan = await getActiveStudyPlan(studentId);
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
  targetMastery: number = 0.85
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
