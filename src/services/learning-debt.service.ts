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
import { getRetention } from './learner-model.service';

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
 * Criteria (see computeDebtResolutionCriteria for the shared, testable
 * version of this same logic, also used to show live progress in the UI):
 * 1. Mastery > 85%
 * 2. Last 3 assessments average > 80%
 * 3. 14+ days since last successful attempt (retention proof)
 * 4. Forgetting risk < 20%
 */
export interface LearningDebtCriteriaProgress {
  masteryAbove85: { current: number; threshold: 85; met: boolean };
  recentScoresAbove80: { current: number | null; threshold: 80; sampleCount: number; requiredSamples: 3; met: boolean };
  retentionProof: { daysSinceLastSuccess: number; threshold: 14; met: boolean };
  lowForgettingRisk: { current: number; threshold: 20; met: boolean };
  allMet: boolean;
}

export function computeDebtResolutionCriteria(
  currentMastery: number,
  recentScores: number[],
  daysSinceLastSuccess: number,
  forgettingRisk: number
): LearningDebtCriteriaProgress {
  const recentAvg = recentScores.length >= 3 ? recentScores.slice(0, 3).reduce((a, b) => a + b, 0) / 3 : null;
  const masteryAbove85 = currentMastery > 85;
  const recentScoresAbove80 = recentAvg !== null && recentAvg > 80;
  const retentionProof = daysSinceLastSuccess > 14;
  const lowForgettingRisk = forgettingRisk < 20;
  return {
    masteryAbove85: { current: currentMastery, threshold: 85, met: masteryAbove85 },
    recentScoresAbove80: { current: recentAvg, threshold: 80, sampleCount: recentScores.length, requiredSamples: 3, met: recentScoresAbove80 },
    retentionProof: { daysSinceLastSuccess, threshold: 14, met: retentionProof },
    lowForgettingRisk: { current: forgettingRisk, threshold: 20, met: lowForgettingRisk },
    allMet: masteryAbove85 && recentScoresAbove80 && retentionProof && lowForgettingRisk,
  };
}

/**
 * Live progress toward resolving a specific concept's debt, for
 * display (Concept Detail's "what's needed to clear this" section).
 * Null when there's no mastery record yet -- nothing to show.
 */
export async function getLearningDebtCriteriaProgress(
  studentId: string,
  conceptId: string
): Promise<LearningDebtCriteriaProgress | null> {
  const masteryRow = await db.query(
    `SELECT mastery_score, confidence_score, last_practiced FROM mastery_records WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const record = masteryRow.rows[0];
  if (!record) return null;

  const mastery = Number(record.mastery_score);
  const daysSinceLastSuccess = record.last_practiced
    ? Math.floor((Date.now() - new Date(record.last_practiced).getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  const retention = getRetention(mastery, Number(record.confidence_score), record.last_practiced);
  const forgettingRisk = retention !== null ? 100 - retention : 100;

  const recentScores = await getRecentAssessmentScores(studentId, conceptId, 3);
  return computeDebtResolutionCriteria(mastery, recentScores, daysSinceLastSuccess, forgettingRisk);
}

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

    const criteria = computeDebtResolutionCriteria(currentMastery, recentScores, daysSinceLastSuccess, forgettingRisk);

    if (!criteria.allMet) {
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
 * Get recent assessment scores for a concept -- the most recent
 * `limit` scores across both real recorded school exams
 * (assessment_results, the strongest signal) and meaningful in-app
 * assessments (learning_evidence.score_percent for
 * cumulative/exam-simulation/topic-assessment quiz attempts, not
 * casual practice questions). Previously this only looked at real
 * exams, which meant a student could ace comprehensive in-app quizzes
 * indefinitely without ever satisfying this resolution criterion.
 */
async function getRecentAssessmentScores(
  studentId: string,
  conceptId: string,
  limit: number = 3
): Promise<number[]> {
  try {
    const result = await db.query(
      `
      SELECT percentage AS score, created_at AS at FROM (
        SELECT ar.percentage, ar.created_at
        FROM assessment_results ar
        JOIN assessment_occurrences ao ON ar.occurrence_id = ao.id
        WHERE ar.student_id = $1 AND $2::text = ANY(ao.topics)
        UNION ALL
        SELECT le.score_percent AS percentage, le.timestamp AS created_at
        FROM learning_evidence le
        WHERE le.student_id = $1 AND le.concept_id = $2::uuid
          AND le.score_percent IS NOT NULL
          AND le.source_type IN ('CUMULATIVE_ASSESSMENT', 'EXAM_SIMULATION', 'TOPIC_ASSESSMENT', 'REAL_SCHOOL_EXAM')
      ) combined
      ORDER BY at DESC
      LIMIT $3
      `,
      [studentId, conceptId, limit]
    );

    return result.rows.map(r => parseFloat(r.score));
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
      ? `SELECT ld.concept_id FROM learning_debt ld JOIN subjects s ON s.id = ld.subject_id WHERE ld.student_id = $1 AND ld.status IN ('active', 'monitoring') AND s.status = 'active' AND ld.subject_id = $2`
      : `SELECT ld.concept_id FROM learning_debt ld JOIN subjects s ON s.id = ld.subject_id WHERE ld.student_id = $1 AND ld.status IN ('active', 'monitoring') AND s.status = 'active'`;
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
        mr.attempt_count,
        mr.confidence_score,
        mr.last_practiced
      FROM learning_debt ld
      JOIN concepts c ON ld.concept_id = c.id
      JOIN subjects s ON s.id = ld.subject_id
      LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
      LEFT JOIN mastery_records mr ON ld.student_id = mr.student_id AND ld.concept_id = mr.concept_id
      WHERE ld.student_id = $1 AND ld.status IN ('active', 'monitoring') AND s.status = 'active'
    `;

    const params: any[] = [studentId, preferredLanguage];

    if (subjectId) {
      query += ` AND ld.subject_id = $3`;
      params.push(subjectId);
    }

    query += ` ORDER BY ld.severity DESC, ld.created_at ASC`;

    const result = await db.query(query, params);

    // Lazily re-check resolution on every read, the same way
    // forgetting_risk/retention are always computed fresh rather than
    // relying on something to have written a new value in the past --
    // a debt whose evidence quietly cleared all four criteria since
    // the last time anyone looked gets resolved right now instead of
    // never (this endpoint was previously the only way to trigger a
    // resolution check, and nothing in the app ever called it).
    const stillActive = await Promise.all(
      result.rows.map(async (row) => {
        if (row.mastery_score === null) return row; // no mastery record yet, nothing to re-check
        const mastery = Number(row.mastery_score);
        const daysSinceLastSuccess = row.last_practiced
          ? Math.floor((Date.now() - new Date(row.last_practiced).getTime()) / (1000 * 60 * 60 * 24))
          : Infinity;
        const retention = getRetention(mastery, Number(row.confidence_score), row.last_practiced);
        const forgettingRisk = retention !== null ? 100 - retention : 100;
        const resolved = await checkAndResolveDebt(studentId, row.concept_id, mastery, daysSinceLastSuccess, forgettingRisk).catch(
          () => null
        );
        return resolved ? null : row;
      })
    );

    return stillActive
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map(row => ({
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
