/**
 * GET /api/exam-readiness/score
 *
 * Get exam readiness prediction for student
 *
 * Query parameters:
 * - studentId: string
 * - daysUntilExam: number
 * - subjectId?: string (if not provided, calculates for all subjects)
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     overall: {
 *       score: number (0-100)
 *       predicted: number (estimated exam score)
 *       riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
 *     }
 *     breakdown: {
 *       mastery: number
 *       retention: number
 *       debt: number
 *       errors: number
 *     }
 *     concerns: string[]
 *     recommendations: string[]
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import {
  calculateExamReadiness,
  getOverallExamReadiness,
} from '@/services/exam-readiness.service';
import { getNextOccurrence, cacheReadinessScore } from '@/services/assessment.service';
import { z } from 'zod';

const ExamReadinessSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  daysUntilExam: z
    .string()
    .transform(Number)
    .pipe(z.number().int().min(0).max(365))
    .or(z.number().int().min(0).max(365))
    .optional(),
  subjectId: z.string().uuid('Invalid subjectId').optional(),
});

type ExamReadinessRequest = z.infer<typeof ExamReadinessSchema>;

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    let validated: ExamReadinessRequest;
    try {
      const raw = {
        studentId: searchParams.get('studentId'),
        daysUntilExam: searchParams.get('daysUntilExam') || undefined,
        subjectId: searchParams.get('subjectId') || undefined,
      };

      validated = ExamReadinessSchema.parse(raw);
    } catch (error: any) {
      return NextResponse.json(
        {
          error: 'INVALID_INPUT',
          message: error.errors?.[0]?.message || 'Invalid query parameters',
        },
        { status: 400 }
      );
    }

    // Verify authorization
    const canAccess = await verifyStudentAccess(
      authContext.userId,
      validated.studentId,
      authContext.role
    );

    if (!canAccess) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'You do not have permission to access exam readiness for this student',
        },
        { status: 403 }
      );
    }

    let daysUntilExam = typeof validated.daysUntilExam === 'string'
      ? parseInt(validated.daysUntilExam)
      : validated.daysUntilExam;
    const subjectId = validated.subjectId;

    if (subjectId) {
      // No explicit daysUntilExam -- derive it from the subject's real
      // exam calendar instead of requiring the caller to know/guess it.
      let occurrence = null;
      if (daysUntilExam === undefined) {
        occurrence = await getNextOccurrence(subjectId);
        if (!occurrence) {
          return NextResponse.json({
            success: true,
            data: {
              scope: 'single_subject',
              hasUpcomingExam: false,
              message: 'No upcoming exam scheduled for this subject.',
            },
          });
        }
        daysUntilExam = Math.max(0, occurrence.daysUntil);
      }

      // Single subject readiness
      const readiness = await calculateExamReadiness(
        validated.studentId,
        subjectId,
        daysUntilExam
      );

      if (occurrence) {
        await cacheReadinessScore(occurrence.id, readiness.overallScore).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        data: {
          scope: 'single_subject',
          hasUpcomingExam: true,
          examDate: occurrence?.scheduledDate,
          occurrenceId: occurrence?.id,
          overall: {
            score: readiness.overallScore,
            predicted: readiness.predictedExamScore,
            confidence: readiness.confidence,
          },
          breakdown: {
            mastery: readiness.breakdown.masteryScore,
            retention: readiness.breakdown.retentionScore,
            debt: readiness.breakdown.debtScore,
            errors: readiness.breakdown.errorScore,
          },
          concerns: readiness.areasOfConcern,
          recommendations: readiness.recommendations,
          daysUntilExam,
        },
      });
    } else {
      if (daysUntilExam === undefined) {
        return NextResponse.json(
          {
            error: 'INVALID_INPUT',
            message: 'daysUntilExam is required when subjectId is omitted (each subject may have a different exam date)',
          },
          { status: 400 }
        );
      }
      // Overall readiness across all subjects
      const {
        overallReadiness,
        bySubject,
        riskLevel,
      } = await getOverallExamReadiness(validated.studentId, daysUntilExam);

      return NextResponse.json({
        success: true,
        data: {
          scope: 'all_subjects',
          overall: {
            score: overallReadiness.overallScore,
            predicted: overallReadiness.predictedExamScore,
            confidence: overallReadiness.confidence,
            riskLevel,
          },
          breakdown: {
            mastery: overallReadiness.breakdown.masteryScore,
            retention: overallReadiness.breakdown.retentionScore,
            debt: overallReadiness.breakdown.debtScore,
            errors: overallReadiness.breakdown.errorScore,
          },
          bySubject: bySubject.map(r => ({
            subject: r.subjectName,
            score: r.overallScore,
            predicted: r.predictedExamScore,
            breakdown: r.breakdown,
          })),
          concerns: overallReadiness.areasOfConcern,
          recommendations: overallReadiness.recommendations,
          daysUntilExam,
        },
      });
    }
  } catch (error) {
    console.error('Error calculating exam readiness:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to calculate exam readiness',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
