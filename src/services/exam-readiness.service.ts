/**
 * Exam Readiness Scoring - Predict student exam performance
 *
 * Factors:
 * 1. Concept mastery (higher mastery = higher readiness)
 * 2. Knowledge retention (recent review = higher readiness)
 * 3. Active learning debt (debt reduces readiness)
 * 4. Error patterns (recurring errors reduce readiness)
 * 5. Time to exam (more time = opportunity to improve)
 */

import { db } from '@/lib/db';

export interface ExamReadinessScore {
  overallScore: number; // 0-100
  confidence: number; // 0-1 (how confident in prediction)
  breakdown: {
    masteryScore: number; // 0-100 (avg mastery of exam concepts)
    retentionScore: number; // 0-100 (time since last review)
    debtScore: number; // 0-100 (inverse of active debt)
    errorScore: number; // 0-100 (inverse of error patterns)
  };
  predictedExamScore: number; // 0-100 (estimated exam performance)
  areasOfConcern: string[]; // Weak concepts or high debt areas
  recommendations: string[];
  daysUntilExam: number;
}

/**
 * Calculate exam readiness for a subject
 */
export async function calculateExamReadiness(
  studentId: string,
  subjectId: string,
  daysUntilExam: number
): Promise<ExamReadinessScore> {
  try {
    // Get all concepts for subject
    const conceptsResult = await db.query(
      `
      SELECT mr.concept_id, c.canonical_id, cl.label, mr.mastery_score
      FROM mastery_records mr
      JOIN concepts c ON mr.concept_id = c.id
      LEFT JOIN concept_localizations cl ON c.id = cl.concept_id AND cl.language = 'en'
      WHERE mr.student_id = $1 AND c.subject_id = $2
      `,
      [studentId, subjectId]
    );

    if (conceptsResult.rows.length === 0) {
      throw new Error('No concepts found for subject');
    }

    const concepts = conceptsResult.rows;

    // Calculate mastery score (average mastery)
    const masteryScores = concepts.map(c => c.mastery_score || 0);
    const masteryScore = Math.round(
      (masteryScores.reduce((a, b) => a + b, 0) / masteryScores.length) * 100
    );

    // Calculate retention score
    const retentionScore = await calculateRetentionScore(studentId, subjectId);

    // Calculate debt score
    const debtScore = await calculateDebtScore(studentId, subjectId);

    // Calculate error score
    const errorScore = await calculateErrorScore(studentId, subjectId);

    // Weighted overall score
    const overallScore = Math.round(
      masteryScore * 0.4 + retentionScore * 0.3 + debtScore * 0.2 + errorScore * 0.1
    );

    // Predict exam performance (non-linear adjustment)
    let predictedExamScore = overallScore;
    if (overallScore >= 85) {
      predictedExamScore = Math.min(95, overallScore + 5); // Slight boost for high readiness
    } else if (overallScore <= 40) {
      predictedExamScore = Math.max(25, overallScore - 10); // Risk reduction for low readiness
    }

    // Identify areas of concern
    const areasOfConcern: string[] = [];
    if (masteryScore < 60) areasOfConcern.push('Overall mastery is weak');
    if (retentionScore < 50)
      areasOfConcern.push('Concepts have not been reviewed recently');

    // Get concepts with low mastery
    const lowMasteryConcepts = concepts
      .filter(c => c.mastery_score < 0.6)
      .sort((a, b) => a.mastery_score - b.mastery_score)
      .slice(0, 3);

    for (const concept of lowMasteryConcepts) {
      areasOfConcern.push(`Low mastery in ${concept.label} (${Math.round(concept.mastery_score * 100)}%)`);
    }

    // Get active debt
    const debtResult = await db.query(
      `
      SELECT COUNT(*) as debt_count FROM learning_debt
      WHERE student_id = $1 AND status = 'active'
      `,
      [studentId]
    );

    const activeDebtCount = parseInt(debtResult.rows[0]?.debt_count || 0);
    if (activeDebtCount > 0) {
      areasOfConcern.push(`${activeDebtCount} active learning debt items`);
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (predictedExamScore >= 85) {
      recommendations.push('You are well-prepared. Focus on maintaining mastery.');
    } else if (predictedExamScore >= 70) {
      recommendations.push(
        'Good progress. Review weak concepts before exam.'
      );
    } else if (predictedExamScore >= 50) {
      recommendations.push(
        'Significant preparation needed. Prioritize high-importance concepts.'
      );
    } else {
      recommendations.push(
        'Critical preparation needed. Consider requesting additional help.'
      );
    }

    if (daysUntilExam <= 3) {
      recommendations.push(
        'Exam is very soon. Focus on reviewing rather than learning new material.'
      );
    } else if (daysUntilExam <= 7) {
      recommendations.push(
        'One week until exam. Prioritize high-debt or low-mastery concepts.'
      );
    } else {
      recommendations.push(
        `You have ${daysUntilExam} days to study. Create a structured study plan.`
      );
    }

    if (retentionScore < 60) {
      recommendations.push(
        'Review older material that has not been studied recently.'
      );
    }

    if (activeDebtCount > 0) {
      recommendations.push(
        'Resolve active learning debt before attempting exam preparation.'
      );
    }

    return {
      overallScore: Math.min(100, overallScore),
      confidence: Math.min(0.95, 0.5 + concepts.length * 0.02), // More concepts = higher confidence
      breakdown: {
        masteryScore,
        retentionScore,
        debtScore,
        errorScore,
      },
      predictedExamScore: Math.round(predictedExamScore),
      areasOfConcern,
      recommendations,
      daysUntilExam,
    };
  } catch (error) {
    console.error('Error calculating exam readiness:', error);
    throw error;
  }
}

/**
 * Calculate retention score based on time since last review
 */
async function calculateRetentionScore(studentId: string, subjectId: string): Promise<number> {
  try {
    const result = await db.query(
      `
      SELECT
        AVG(EXTRACT(DAY FROM (NOW() - last_studied_at))) as avg_days_since_review
      FROM mastery_records
      WHERE student_id = $1 AND concept_id IN (
        SELECT id FROM concepts WHERE subject_id = $2
      )
      `,
      [studentId, subjectId]
    );

    const avgDaysSinceReview = parseFloat(result.rows[0]?.avg_days_since_review || 0);

    // Retention decays over time
    // 0 days = 100%, 7 days = 70%, 14 days = 40%, 30+ days = 10%
    let score = 100;
    if (avgDaysSinceReview > 30) score = 10;
    else if (avgDaysSinceReview > 14) score = Math.max(10, 40 - (avgDaysSinceReview - 14) * 2);
    else if (avgDaysSinceReview > 7)
      score = Math.max(40, 70 - (avgDaysSinceReview - 7) * 4.3);
    else score = Math.max(70, 100 - avgDaysSinceReview * 4.3);

    return Math.round(score);
  } catch (error) {
    console.error('Error calculating retention score:', error);
    return 50; // Default middle score
  }
}

/**
 * Calculate debt score (inverse of active learning debt)
 */
async function calculateDebtScore(studentId: string, subjectId: string): Promise<number> {
  try {
    // Get total active debt severity
    const result = await db.query(
      `
      SELECT SUM(ld.severity) as total_severity, COUNT(*) as debt_count
      FROM learning_debt ld
      JOIN concepts c ON ld.concept_id = c.id
      WHERE ld.student_id = $1 AND c.subject_id = $2 AND ld.status = 'active'
      `,
      [studentId, subjectId]
    );

    const totalSeverity = parseFloat(result.rows[0]?.total_severity || 0);
    const debtCount = parseInt(result.rows[0]?.debt_count || 0);

    if (debtCount === 0) return 100; // No debt = perfect score

    // Debt reduces score: each severity point costs ~20 points
    const score = Math.max(10, 100 - debtCount * 20 - totalSeverity * 5);

    return Math.round(score);
  } catch (error) {
    console.error('Error calculating debt score:', error);
    return 50;
  }
}

/**
 * Calculate error score (inverse of recurring errors)
 */
async function calculateErrorScore(studentId: string, subjectId: string): Promise<number> {
  try {
    // Get error patterns
    const result = await db.query(
      `
      SELECT COUNT(*) as pattern_count
      FROM error_patterns ep
      JOIN concepts c ON ep.concept_id = c.id
      WHERE ep.student_id = $1 AND c.subject_id = $2 AND ep.status = 'active'
      `,
      [studentId, subjectId]
    );

    const patternCount = parseInt(result.rows[0]?.pattern_count || 0);

    if (patternCount === 0) return 100; // No patterns = perfect score

    // Each active pattern reduces score by 15 points
    const score = Math.max(10, 100 - patternCount * 15);

    return Math.round(score);
  } catch (error) {
    console.error('Error calculating error score:', error);
    return 50;
  }
}

/**
 * Get readiness for all subjects student is taking
 */
export async function getMultiSubjectReadiness(
  studentId: string,
  daysUntilExam: number
): Promise<
  Array<ExamReadinessScore & { subjectId: string; subjectName: string }>
> {
  try {
    // Get all subjects student has concepts in
    const subjectsResult = await db.query(
      `
      SELECT DISTINCT s.id, s.name
      FROM subjects s
      JOIN concepts c ON s.id = c.subject_id
      JOIN mastery_records mr ON c.id = mr.concept_id
      WHERE mr.student_id = $1
      ORDER BY s.name
      `,
      [studentId]
    );

    const subjects = subjectsResult.rows;

    const readinessScores: any[] = [];

    for (const subject of subjects) {
      const readiness = await calculateExamReadiness(studentId, subject.id, daysUntilExam);
      readinessScores.push({
        ...readiness,
        subjectId: subject.id,
        subjectName: subject.name,
      });
    }

    // Sort by overall score (lowest first, to prioritize)
    readinessScores.sort((a, b) => a.overallScore - b.overallScore);

    return readinessScores;
  } catch (error) {
    console.error('Error getting multi-subject readiness:', error);
    throw error;
  }
}

/**
 * Get overall exam readiness (across all subjects)
 */
export async function getOverallExamReadiness(
  studentId: string,
  daysUntilExam: number
): Promise<{
  overallReadiness: ExamReadinessScore;
  bySubject: Array<ExamReadinessScore & { subjectId: string; subjectName: string }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}> {
  try {
    const bySubject = await getMultiSubjectReadiness(studentId, daysUntilExam);

    if (bySubject.length === 0) {
      throw new Error('No readiness data available');
    }

    // Calculate overall (weighted average of all subjects)
    const avgScore = Math.round(
      bySubject.reduce((sum, r) => sum + r.overallScore, 0) / bySubject.length
    );

    // Risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (avgScore >= 80) riskLevel = 'LOW';
    else if (avgScore >= 65) riskLevel = 'MEDIUM';
    else if (avgScore >= 50) riskLevel = 'HIGH';
    else riskLevel = 'CRITICAL';

    const overallReadiness: ExamReadinessScore = {
      overallScore: avgScore,
      confidence: Math.min(0.9, 0.5 + bySubject.length * 0.1),
      breakdown: {
        masteryScore: Math.round(
          bySubject.reduce((sum, r) => sum + r.breakdown.masteryScore, 0) /
            bySubject.length
        ),
        retentionScore: Math.round(
          bySubject.reduce((sum, r) => sum + r.breakdown.retentionScore, 0) /
            bySubject.length
        ),
        debtScore: Math.round(
          bySubject.reduce((sum, r) => sum + r.breakdown.debtScore, 0) /
            bySubject.length
        ),
        errorScore: Math.round(
          bySubject.reduce((sum, r) => sum + r.breakdown.errorScore, 0) /
            bySubject.length
        ),
      },
      predictedExamScore: Math.round(
        bySubject.reduce((sum, r) => sum + r.predictedExamScore, 0) /
          bySubject.length
      ),
      areasOfConcern: Array.from(
        new Set(bySubject.flatMap(r => r.areasOfConcern))
      ).slice(0, 5),
      recommendations: Array.from(
        new Set(bySubject.flatMap(r => r.recommendations))
      ).slice(0, 5),
      daysUntilExam,
    };

    return {
      overallReadiness,
      bySubject,
      riskLevel,
    };
  } catch (error) {
    console.error('Error getting overall exam readiness:', error);
    throw error;
  }
}
