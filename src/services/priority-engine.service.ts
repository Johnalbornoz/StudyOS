/**
 * Priority Engine - Rank concepts by study urgency
 *
 * Factors:
 * 1. Mastery (low mastery = high priority)
 * 2. Learning debt (active debt = boost priority)
 * 3. Error patterns (recurring errors = high priority)
 * 4. Days until exam (soon = higher priority)
 * 5. Prerequisites (blocking other concepts = high priority)
 */

import { db } from '@/lib/db';

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

/**
 * Calculate priority for a concept
 *
 * Formula:
 * priority = (100 - mastery) × 0.4  [Low mastery is priority]
 *          + debt_severity × 10     [Active debt is priority]
 *          + error_recurrence × 5   [Errors are priority]
 *          + exam_proximity × 8     [Upcoming exams are priority]
 *
 * Result: 0-100 scale
 */
export async function calculateConceptPriority(
  studentId: string,
  conceptId: string,
  subjectId: string,
  options: {
    daysUntilExam?: number;
  } = {}
): Promise<ConceptPriority> {
  try {
    // Get mastery
    const masteryResult = await db.query(
      `
      SELECT mastery_score FROM mastery_records
      WHERE student_id = $1 AND concept_id = $2
      `,
      [studentId, conceptId]
    );

    const mastery = masteryResult.rows[0]?.mastery_score || 0;

    // Get learning debt (if exists)
    const debtResult = await db.query(
      `
      SELECT severity FROM learning_debt
      WHERE student_id = $1 AND concept_id = $2 AND status = 'active'
      `,
      [studentId, conceptId]
    );

    const debtSeverity = debtResult.rows[0]?.severity || 0;

    // Get error count
    const errorResult = await db.query(
      `
      SELECT COUNT(*) as error_count FROM errors
      WHERE student_id = $1 AND concept_id = $2
      AND timestamp > NOW() - INTERVAL '30 days'
      `,
      [studentId, conceptId]
    );

    const errorCount = parseInt(errorResult.rows[0]?.error_count || 0);

    // Get concept details
    const conceptResult = await db.query(
      `
      SELECT c.canonical_id, cl.label
      FROM concepts c
      LEFT JOIN concept_localizations cl ON c.id = cl.concept_id AND cl.language = 'en'
      WHERE c.id = $1
      `,
      [conceptId]
    );

    if (conceptResult.rows.length === 0) {
      throw new Error(`Concept ${conceptId} not found`);
    }

    const { canonical_id, label } = conceptResult.rows[0];

    // Calculate priority
    const masteryComponent = (100 - mastery) * 0.4; // 0-40 points
    const debtComponent = debtSeverity * 10; // 0-50 points (severity 1-5)
    const errorComponent = Math.min(errorCount * 5, 20); // 0-20 points (capped)
    const examComponent = options.daysUntilExam
      ? Math.max(0, (7 - options.daysUntilExam) * 8)
      : 0; // Upcoming = higher priority

    const priority = Math.min(
      100,
      masteryComponent + debtComponent + errorComponent + examComponent
    );

    // Determine urgency level
    let urgencyLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    if (priority >= 75) urgencyLevel = 'CRITICAL';
    else if (priority >= 55) urgencyLevel = 'HIGH';
    else if (priority >= 35) urgencyLevel = 'MEDIUM';
    else urgencyLevel = 'LOW';

    // Determine reason
    let reason = '';
    if (debtSeverity >= 3) reason += 'Active learning debt. ';
    if (mastery < 40) reason += 'Critical mastery gap. ';
    else if (mastery < 60) reason += 'Weak mastery. ';
    if (errorCount >= 3) reason += 'Recurring errors detected. ';
    if (options.daysUntilExam && options.daysUntilExam <= 3)
      reason += 'Exam very soon. ';

    if (!reason) reason = 'Regular maintenance study.';

    // Estimate study time based on priority
    const estimatedStudyTime = Math.max(15, Math.min(60, priority / 2));

    return {
      conceptId,
      canonicalId: canonical_id,
      label,
      mastery: Math.round(mastery * 100) / 100,
      priority: Math.round(priority * 100) / 100,
      reason: reason.trim(),
      estimatedStudyTime: Math.round(estimatedStudyTime),
      urgencyLevel,
    };
  } catch (error) {
    console.error('Error calculating priority:', error);
    throw error;
  }
}

/**
 * Get all concepts ranked by priority for a subject
 */
export async function getRankedConceptsByPriority(
  studentId: string,
  subjectId: string,
  options: {
    daysUntilExam?: number;
    limit?: number;
  } = {}
): Promise<ConceptPriority[]> {
  try {
    // Get all concepts for subject
    const conceptsResult = await db.query(
      `
      SELECT id FROM concepts WHERE subject_id = $1
      `,
      [subjectId]
    );

    const concepts = conceptsResult.rows;

    // Calculate priority for each
    const priorities: ConceptPriority[] = [];

    for (const concept of concepts) {
      const priority = await calculateConceptPriority(
        studentId,
        concept.id,
        subjectId,
        options
      );
      priorities.push(priority);
    }

    // Sort by priority (highest first)
    priorities.sort((a, b) => b.priority - a.priority);

    // Limit if specified
    if (options.limit) {
      return priorities.slice(0, options.limit);
    }

    return priorities;
  } catch (error) {
    console.error('Error getting ranked concepts:', error);
    throw error;
  }
}

/**
 * Get concepts ranked by priority across all subjects (for whole-student study plan)
 */
export async function getStudentStudyPriorities(
  studentId: string,
  options: {
    limit?: number;
  } = {}
): Promise<
  Array<ConceptPriority & { subjectId: string; subjectName: string }>
> {
  try {
    // Get all concepts for student across all subjects
    const conceptsResult = await db.query(
      `
      SELECT DISTINCT c.id, c.subject_id, s.name as subject_name
      FROM concepts c
      JOIN subjects s ON c.subject_id = s.id
      JOIN mastery_records mr ON c.id = mr.concept_id
      WHERE mr.student_id = $1
      ORDER BY s.name, c.id
      `,
      [studentId]
    );

    const concepts = conceptsResult.rows;

    // Calculate priority for each
    const priorities: any[] = [];

    for (const concept of concepts) {
      const priority = await calculateConceptPriority(
        studentId,
        concept.id,
        concept.subject_id
      );
      priorities.push({
        ...priority,
        subjectId: concept.subject_id,
        subjectName: concept.subject_name,
      });
    }

    // Sort by priority (highest first)
    priorities.sort((a, b) => b.priority - a.priority);

    // Limit if specified
    if (options.limit) {
      return priorities.slice(0, options.limit);
    }

    return priorities;
  } catch (error) {
    console.error('Error getting student priorities:', error);
    throw error;
  }
}

/**
 * Get priority breakdown (why is this concept important?)
 */
export function getPriorityBreakdown(priority: ConceptPriority): {
  components: Array<{ factor: string; points: number }>;
  total: number;
} {
  // This would reconstruct the calculation shown above
  // For now, return a summary
  return {
    components: [
      { factor: 'Low mastery', points: (100 - priority.mastery) * 0.4 },
      { factor: 'Learning debt', points: 0 }, // Would need to query
      { factor: 'Error patterns', points: 0 }, // Would need to query
    ],
    total: priority.priority,
  };
}
