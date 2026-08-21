/**
 * Debt Resolution Service - Automatically resolve learning debt
 *
 * Enhanced debt resolution with automatic checking of resolution criteria
 */

import { db } from '@/lib/db';
import { getDebtRecord, updateDebtSeverity } from '@/services/learning-debt.service';

export interface DebtResolutionResult {
  debtId: string;
  conceptId: string;
  resolved: boolean;
  reason: string;
  criteria: {
    masteryAbove85: boolean;
    recentScoresAbove80: boolean;
    retentionProof: boolean;
    lowForgettingRisk: boolean;
  };
  mastery: number;
  daysSinceLastSuccess: number;
  forgettingRisk: number;
}

/**
 * Check and resolve a single debt automatically
 *
 * Calculates all metrics needed and determines resolution
 */
export async function autoResolveDebt(
  studentId: string,
  conceptId: string
): Promise<DebtResolutionResult> {
  try {
    const debt = await getDebtRecord(studentId, conceptId);

    if (!debt || debt.status === 'resolved') {
      return {
        debtId: debt?.id || '',
        conceptId,
        resolved: false,
        reason: debt ? 'Already resolved' : 'No debt found',
        criteria: {
          masteryAbove85: false,
          recentScoresAbove80: false,
          retentionProof: false,
          lowForgettingRisk: false,
        },
        mastery: 0,
        daysSinceLastSuccess: 0,
        forgettingRisk: 100,
      };
    }

    // Get mastery
    const masteryResult = await db.query(
      `
      SELECT mastery_score, last_practiced
      FROM mastery_records
      WHERE student_id = $1 AND concept_id = $2
      `,
      [studentId, conceptId]
    );

    if (masteryResult.rows.length === 0) {
      return {
        debtId: debt.id,
        conceptId,
        resolved: false,
        reason: 'No mastery record',
        criteria: {
          masteryAbove85: false,
          recentScoresAbove80: false,
          retentionProof: false,
          lowForgettingRisk: false,
        },
        mastery: 0,
        daysSinceLastSuccess: 0,
        forgettingRisk: 100,
      };
    }

    const masteryRecord = masteryResult.rows[0];
    // mastery_score is already 0-100 in the database.
    const mastery = Number(masteryRecord.mastery_score) || 0;

    // Calculate days since last success
    const lastStudiedAt = masteryRecord.last_practiced
      ? new Date(masteryRecord.last_practiced)
      : new Date();
    const daysSinceLastSuccess = Math.floor(
      (Date.now() - lastStudiedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Get recent assessment scores
    const recentScores = await getRecentAssessmentScores(
      studentId,
      conceptId,
      3
    );

    const recentAverage =
      recentScores.length >= 3
        ? recentScores.slice(0, 3).reduce((a, b) => a + b, 0) / 3
        : 0;

    // Calculate forgetting risk (inverse of retention)
    // Risk = days elapsed / decay half-life
    // Half-life assumed to be 14 days
    const forgettingRisk = Math.min(
      100,
      (daysSinceLastSuccess / 14) * 100
    );

    // Evaluate criteria
    const criteria = {
      masteryAbove85: mastery > 85,
      recentScoresAbove80: recentScores.length >= 3 && recentAverage > 80,
      retentionProof: daysSinceLastSuccess > 14,
      lowForgettingRisk: forgettingRisk < 20,
    };

    const shouldResolve =
      criteria.masteryAbove85 &&
      criteria.recentScoresAbove80 &&
      criteria.retentionProof &&
      criteria.lowForgettingRisk;

    if (shouldResolve) {
      // Resolve the debt
      const result = await db.query(
        `
        UPDATE learning_debt
        SET
          status = 'resolved',
          resolved_at = NOW()
        WHERE student_id = $1 AND concept_id = $2
        RETURNING id
        `,
        [studentId, conceptId]
      );

      // Log resolution event
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
          `AUTO-RESOLVED: Mastery ${mastery.toFixed(1)}% | Avg Score ${recentAverage.toFixed(1)}% | Retention ${daysSinceLastSuccess}d | Risk ${forgettingRisk.toFixed(1)}%`,
        ]
      );

      return {
        debtId: debt.id,
        conceptId,
        resolved: true,
        reason: 'All resolution criteria met',
        criteria,
        mastery,
        daysSinceLastSuccess,
        forgettingRisk,
      };
    }

    // Identify failing criteria for feedback
    const failingCriteria: string[] = [];
    if (!criteria.masteryAbove85)
      failingCriteria.push(
        `Mastery too low (${mastery.toFixed(1)}% < 85%)`
      );
    if (!criteria.recentScoresAbove80)
      failingCriteria.push(
        `Recent scores too low (${recentAverage.toFixed(1)}% < 80%)`
      );
    if (!criteria.retentionProof)
      failingCriteria.push(
        `Insufficient retention proof (${daysSinceLastSuccess}d < 14d)`
      );
    if (!criteria.lowForgettingRisk)
      failingCriteria.push(
        `Forgetting risk too high (${forgettingRisk.toFixed(1)}% > 20%)`
      );

    return {
      debtId: debt.id,
      conceptId,
      resolved: false,
      reason: failingCriteria.join('; '),
      criteria,
      mastery,
      daysSinceLastSuccess,
      forgettingRisk,
    };
  } catch (error) {
    console.error('Error auto-resolving debt:', error);
    throw error;
  }
}

/**
 * Check and resolve all debts for a student
 */
export async function autoResolveAllDebts(
  studentId: string
): Promise<DebtResolutionResult[]> {
  try {
    // Get all active debts
    const debtsResult = await db.query(
      `
      SELECT concept_id
      FROM learning_debt
      WHERE student_id = $1 AND status IN ('active', 'monitoring')
      `,
      [studentId]
    );

    const results: DebtResolutionResult[] = [];

    for (const row of debtsResult.rows) {
      const result = await autoResolveDebt(studentId, row.concept_id);
      results.push(result);
    }

    return results;
  } catch (error) {
    console.error('Error auto-resolving all debts:', error);
    throw error;
  }
}

/**
 * Batch resolution for all students (for cron jobs)
 *
 * Resolves debts for all students automatically
 */
export async function batchResolveAllStudentDebts(): Promise<{
  studentsProcessed: number;
  debtsResolved: number;
  debtsStillActive: number;
}> {
  try {
    // Get all students with active debts
    const studentsResult = await db.query(
      `
      SELECT DISTINCT student_id
      FROM learning_debt
      WHERE status IN ('active', 'monitoring')
      `
    );

    let totalResolved = 0;
    let totalActive = 0;

    for (const row of studentsResult.rows) {
      const results = await autoResolveAllDebts(row.student_id);

      const resolved = results.filter(r => r.resolved).length;
      const active = results.filter(r => !r.resolved).length;

      totalResolved += resolved;
      totalActive += active;

      console.log(
        `Student ${row.student_id}: ${resolved} resolved, ${active} still active`
      );
    }

    return {
      studentsProcessed: studentsResult.rows.length,
      debtsResolved: totalResolved,
      debtsStillActive: totalActive,
    };
  } catch (error) {
    console.error('Error in batch debt resolution:', error);
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
    // Get quiz responses
    const result = await db.query(
      `
      SELECT
        CAST(SUM(CASE WHEN score >= 0.5 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 as score
      FROM quiz_responses qr
      JOIN quiz_sessions qs ON qr.quiz_session_id = qs.id
      WHERE qs.student_id = $1 AND qs.concept_id = $2
      GROUP BY qs.concept_id, DATE(qr.created_at)
      ORDER BY DATE(qr.created_at) DESC
      LIMIT $3
      `,
      [studentId, conceptId, limit]
    );

    return result.rows.map(r => parseFloat(r.score || 0));
  } catch (error) {
    console.error('Error fetching recent assessment scores:', error);
    return [];
  }
}

/**
 * Get resolution progress for a debt
 *
 * Shows how close a debt is to resolution
 */
export async function getDebtResolutionProgress(
  studentId: string,
  conceptId: string
): Promise<{
  debtId: string;
  progress: number; // 0-100 (percentage to resolution)
  criteriaStatus: {
    masteryAbove85: { status: boolean; current: number; target: number };
    recentScoresAbove80: { status: boolean; current: number; target: number };
    retentionProof: { status: boolean; current: number; target: number };
    lowForgettingRisk: { status: boolean; current: number; target: number };
  };
  daysToResolution: number; // estimated days until all criteria met
}> {
  try {
    const result = await autoResolveDebt(studentId, conceptId);

    if (!result.debtId) {
      throw new Error('No debt found');
    }

    // Calculate progress for each criterion
    const masteryProgress = Math.min(100, (result.mastery / 85) * 100);
    const retentionProgress = Math.min(100, (result.daysSinceLastSuccess / 14) * 100);
    const riskProgress = Math.min(100, (1 - result.forgettingRisk / 20) * 100);

    // Overall progress (average of criteria)
    const overallProgress = Math.round(
      (masteryProgress + (result.criteria.recentScoresAbove80 ? 100 : 0) + retentionProgress + riskProgress) / 4
    );

    // Estimate days to resolution
    let daysToResolution = 0;
    if (!result.criteria.masteryAbove85) {
      // Assuming 2% mastery improvement per day with focused study
      daysToResolution = Math.max(
        daysToResolution,
        Math.ceil((85 - result.mastery) / 2)
      );
    }
    if (!result.criteria.retentionProof) {
      daysToResolution = Math.max(
        daysToResolution,
        Math.ceil(14 - result.daysSinceLastSuccess)
      );
    }

    return {
      debtId: result.debtId,
      progress: overallProgress,
      criteriaStatus: {
        masteryAbove85: {
          status: result.criteria.masteryAbove85,
          current: result.mastery,
          target: 85,
        },
        recentScoresAbove80: {
          status: result.criteria.recentScoresAbove80,
          current: 0, // Would need to calculate from recent scores
          target: 80,
        },
        retentionProof: {
          status: result.criteria.retentionProof,
          current: result.daysSinceLastSuccess,
          target: 14,
        },
        lowForgettingRisk: {
          status: result.criteria.lowForgettingRisk,
          current: result.forgettingRisk,
          target: 20,
        },
      },
      daysToResolution,
    };
  } catch (error) {
    console.error('Error getting debt resolution progress:', error);
    throw error;
  }
}
