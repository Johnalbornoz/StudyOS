/**
 * Learning Debt Service - Tracks and manages student knowledge gaps
 *
 * Learning Debt = concept with mastery < 60% that needs reinforcement before it's too late
 *
 * Flow:
 * 1. Mastery drops below 60% → Create debt
 * 2. Student makes more mistakes → Increase severity
 * 3. Student studies + masters concept → Resolve debt
 * 4. Debt resolved → Track for analytics
 */

import { db } from '@/lib/db';
import { calculateDebtSeverity } from '@/lib/algorithms/mastery';
import { ensureConceptLocalizations } from './localization.service';

export interface LearningDebtRecord {
  id: string;
  studentId: string;
  conceptId: string;
  subjectId: string;
  severity: number; // 1-5
  status: 'active' | 'monitoring' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}

export interface LearningDebtEvent {
  id: string;
  debtId: string;
  oldSeverity: number;
  newSeverity: number;
  reason: string;
  createdAt: string;
}

/**
 * Get current learning debt for a concept
 */
export async function getDebtRecord(
  studentId: string,
  conceptId: string
): Promise<LearningDebtRecord | null> {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        student_id,
        concept_id,
        subject_id,
        severity,
        status,
        created_at,
        resolved_at
      FROM learning_debt
      WHERE student_id = $1 AND concept_id = $2
      LIMIT 1
      `,
      [studentId, conceptId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      id: result.rows[0].id,
      studentId: result.rows[0].student_id,
      conceptId: result.rows[0].concept_id,
      subjectId: result.rows[0].subject_id,
      severity: result.rows[0].severity,
      status: result.rows[0].status,
      createdAt: result.rows[0].created_at,
      resolvedAt: result.rows[0].resolved_at,
    };
  } catch (error) {
    console.error('Error fetching learning debt:', error);
    throw error;
  }
}

/**
 * Create learning debt
 *
 * Called when:
 * - Mastery drops below 60%
 * - AND student attempted the concept
 * - AND it's not already in debt
 */
export async function createDebt(
  studentId: string,
  conceptId: string,
  subjectId: string,
  severity: number,
  reason: string
): Promise<LearningDebtRecord> {
  try {
    // Check if debt already exists
    const existing = await getDebtRecord(studentId, conceptId);
    if (existing && existing.status !== 'resolved') {
      // Update instead of create
      return updateDebtSeverity(
        studentId,
        conceptId,
        severity,
        reason
      );
    }

    const result = await db.query(
      `
      INSERT INTO learning_debt (
        student_id,
        concept_id,
        subject_id,
        severity,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, 'active', NOW())
      RETURNING
        id,
        student_id,
        concept_id,
        subject_id,
        severity,
        status,
        created_at,
        resolved_at
      `,
      [studentId, conceptId, subjectId, Math.max(1, Math.min(5, severity))]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      severity: row.severity,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  } catch (error) {
    console.error('Error creating learning debt:', error);
    throw error;
  }
}

/**
 * Update debt severity when student makes more mistakes
 */
export async function updateDebtSeverity(
  studentId: string,
  conceptId: string,
  newSeverity: number,
  reason: string
): Promise<LearningDebtRecord> {
  try {
    const clamped = Math.max(1, Math.min(5, newSeverity));
    const debt = await getDebtRecord(studentId, conceptId);

    if (!debt) {
      throw new Error(`No debt found for student ${studentId}, concept ${conceptId}`);
    }

    const oldSeverity = debt.severity;

    const result = await db.query(
      `
      UPDATE learning_debt
      SET
        severity = $1,
        status = CASE
          WHEN severity > $1 THEN 'monitoring'
          ELSE status
        END
      WHERE student_id = $2 AND concept_id = $3
      RETURNING
        id,
        student_id,
        concept_id,
        subject_id,
        severity,
        status,
        created_at,
        resolved_at
      `,
      [clamped, studentId, conceptId]
    );

    const row = result.rows[0];

    // Log debt event
    if (oldSeverity !== clamped) {
      await db.query(
        `
        INSERT INTO learning_debt_events (
          debt_id,
          old_severity,
          new_severity,
          reason,
          created_at
        ) VALUES ($1, $2, $3, $4, NOW())
        `,
        [debt.id, oldSeverity, clamped, reason]
      );
    }

    return {
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      severity: row.severity,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  } catch (error) {
    console.error('Error updating debt severity:', error);
    throw error;
  }
}

/**
 * Check if debt should be resolved
 *
 * Criteria:
 * 1. Mastery > 85%
 * 2. Last 3 assessments average > 80%
 * 3. 14+ days since last successful attempt (retention proof)
 * 4. Forgetting risk < 20%
 */
export async function checkAndResolveDebt(
  studentId: string,
  conceptId: string,
  currentMastery: number,
  daysSinceLastSuccess: number,
  forgettingRisk: number
): Promise<LearningDebtRecord | null> {
  try {
    const debt = await getDebtRecord(studentId, conceptId);

    if (!debt || debt.status === 'resolved') {
      return null;
    }

    // Get recent assessment scores
    const recentScores = await getRecentAssessmentScores(
      studentId,
      conceptId,
      3
    );

    // Check resolution criteria
    const criteria = {
      masteryAbove85: currentMastery > 85,
      recentScoresAbove80:
        recentScores.length >= 3 &&
        recentScores.slice(0, 3).reduce((a, b) => a + b, 0) / 3 > 80,
      retentionProof: daysSinceLastSuccess > 14,
      lowForgettingRisk: forgettingRisk < 20,
    };

    const shouldResolve =
      criteria.masteryAbove85 &&
      criteria.recentScoresAbove80 &&
      criteria.retentionProof &&
      criteria.lowForgettingRisk;

    if (!shouldResolve) {
      return null;
    }

    // Resolve debt
    const result = await db.query(
      `
      UPDATE learning_debt
      SET
        status = 'resolved',
        resolved_at = NOW()
      WHERE student_id = $1 AND concept_id = $2
      RETURNING
        id,
        student_id,
        concept_id,
        subject_id,
        severity,
        status,
        created_at,
        resolved_at
      `,
      [studentId, conceptId]
    );

    const row = result.rows[0];

    // Log resolution
    await db.query(
      `
      INSERT INTO learning_debt_events (
        debt_id,
        old_severity,
        new_severity,
        reason,
        created_at
      ) VALUES ($1, $2, 0, $3, NOW())
      `,
      [
        debt.id,
        debt.severity,
        `RESOLVED: Mastery ${currentMastery.toFixed(1)}% | Retention ${daysSinceLastSuccess}d | Risk ${forgettingRisk.toFixed(1)}%`,
      ]
    );

    return {
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      severity: row.severity,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  } catch (error) {
    console.error('Error resolving debt:', error);
    throw error;
  }
}

/**
 * Get recent assessment scores for a concept
 */
async function getRecentAssessmentScores(
  studentId: string,
  conceptId: string,
  limit: number = 3
): Promise<number[]> {
  try {
    const result = await db.query(
      `
      SELECT percentage
      FROM assessment_results ar
      JOIN assessment_occurrences ao ON ar.occurrence_id = ao.id
      WHERE ar.student_id = $1 AND $2 = ANY(ao.topics)
      ORDER BY ar.created_at DESC
      LIMIT $3
      `,
      [studentId, conceptId, limit]
    );

    return result.rows.map(r => parseFloat(r.percentage));
  } catch (error) {
    console.error('Error fetching recent assessment scores:', error);
    return [];
  }
}

/**
 * Get all active learning debts for a student
 */
export async function getActiveDebts(
  studentId: string,
  subjectId?: string,
  preferredLanguage: string = 'en'
) {
  try {
    const debtConceptIdsQuery = subjectId
      ? `SELECT concept_id FROM learning_debt WHERE student_id = $1 AND status IN ('active', 'monitoring') AND subject_id = $2`
      : `SELECT concept_id FROM learning_debt WHERE student_id = $1 AND status IN ('active', 'monitoring')`;
    const debtConceptIdsParams = subjectId ? [studentId, subjectId] : [studentId];
    const debtConceptIds = await db.query(debtConceptIdsQuery, debtConceptIdsParams);
    ensureConceptLocalizations(debtConceptIds.rows.map((r) => r.concept_id), preferredLanguage).catch((err) =>
      console.error('Background concept localization failed:', err)
    );

    let query = `
      SELECT
        ld.id,
        ld.student_id,
        ld.concept_id,
        ld.subject_id,
        ld.severity,
        ld.status,
        ld.created_at,
        ld.resolved_at,
        c.canonical_id,
        COALESCE(cl.label, c.canonical_id) AS label,
        mr.mastery_score,
        mr.attempt_count
      FROM learning_debt ld
      JOIN concepts c ON ld.concept_id = c.id
      LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
      LEFT JOIN mastery_records mr ON ld.student_id = mr.student_id AND ld.concept_id = mr.concept_id
      WHERE ld.student_id = $1 AND ld.status IN ('active', 'monitoring')
    `;

    const params: any[] = [studentId, preferredLanguage];

    if (subjectId) {
      query += ` AND ld.subject_id = $3`;
      params.push(subjectId);
    }

    query += ` ORDER BY ld.severity DESC, ld.created_at ASC`;

    const result = await db.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      subjectId: row.subject_id,
      severity: row.severity,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      concept: {
        id: row.concept_id,
        canonicalId: row.canonical_id,
        label: row.label,
      },
      mastery: row.mastery_score,
      attemptCount: row.attempt_count,
    }));
  } catch (error) {
    console.error('Error fetching active debts:', error);
    throw error;
  }
}

/**
 * Get learning debt history for a concept
 */
export async function getDebtHistory(
  studentId: string,
  conceptId: string,
  limit: number = 20
) {
  try {
    const debt = await getDebtRecord(studentId, conceptId);
    if (!debt) {
      return [];
    }

    const result = await db.query(
      `
      SELECT
        id,
        debt_id,
        old_severity,
        new_severity,
        reason,
        created_at
      FROM learning_debt_events
      WHERE debt_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [debt.id, limit]
    );

    return result.rows;
  } catch (error) {
    console.error('Error fetching debt history:', error);
    throw error;
  }
}

/**
 * Get learning debt statistics for dashboard
 */
export async function getDebtStats(studentId: string) {
  try {
    const result = await db.query(
      `
      SELECT
        COUNT(*) as total_debts,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_debts,
        COUNT(CASE WHEN status = 'monitoring' THEN 1 END) as monitoring_debts,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_debts,
        AVG(severity) as avg_severity,
        MAX(severity) as max_severity
      FROM learning_debt
      WHERE student_id = $1
      `,
      [studentId]
    );

    const row = result.rows[0];
    return {
      totalDebts: parseInt(row.total_debts),
      activeDebts: parseInt(row.active_debts),
      monitoringDebts: parseInt(row.monitoring_debts),
      resolvedDebts: parseInt(row.resolved_debts),
      avgSeverity: parseFloat(row.avg_severity || 0),
      maxSeverity: parseInt(row.max_severity || 0),
    };
  } catch (error) {
    console.error('Error fetching debt stats:', error);
    throw error;
  }
}
