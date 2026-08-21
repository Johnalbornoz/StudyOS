/**
 * GET /api/learning-debt/progress
 *
 * Get resolution progress for a learning debt
 *
 * Query parameters:
 * - studentId: string
 * - conceptId: string
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     progress: 0-100 (percentage to resolution)
 *     criteriaStatus: {
 *       masteryAbove85: { status, current, target }
 *       recentScoresAbove80: { status, current, target }
 *       retentionProof: { status, current, target }
 *       lowForgettingRisk: { status, current, target }
 *     }
 *     daysToResolution: number (estimated days)
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getDebtResolutionProgress } from '@/services/debt-resolution.service';
import { z } from 'zod';

const ProgressSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  conceptId: z.string().uuid('Invalid conceptId'),
});

type ProgressRequest = z.infer<typeof ProgressSchema>;

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
    let validated: ProgressRequest;
    try {
      validated = ProgressSchema.parse({
        studentId: searchParams.get('studentId'),
        conceptId: searchParams.get('conceptId'),
      });
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
          message: 'You do not have permission to access this student',
        },
        { status: 403 }
      );
    }

    // Get progress
    const progress = await getDebtResolutionProgress(
      validated.studentId,
      validated.conceptId
    );

    return NextResponse.json({
      success: true,
      data: {
        progress: progress.progress,
        criteria: {
          mastery: {
            met: progress.criteriaStatus.masteryAbove85.status,
            current: Math.round(progress.criteriaStatus.masteryAbove85.current * 100) / 100,
            target: progress.criteriaStatus.masteryAbove85.target,
            percentageToTarget: Math.round(
              (progress.criteriaStatus.masteryAbove85.current / progress.criteriaStatus.masteryAbove85.target) * 100
            ),
          },
          recentScores: {
            met: progress.criteriaStatus.recentScoresAbove80.status,
            target: progress.criteriaStatus.recentScoresAbove80.target,
          },
          retention: {
            met: progress.criteriaStatus.retentionProof.status,
            current: progress.criteriaStatus.retentionProof.current,
            target: progress.criteriaStatus.retentionProof.target,
            daysRemaining: Math.max(
              0,
              progress.criteriaStatus.retentionProof.target - progress.criteriaStatus.retentionProof.current
            ),
          },
          forgettingRisk: {
            met: progress.criteriaStatus.lowForgettingRisk.status,
            current: Math.round(progress.criteriaStatus.lowForgettingRisk.current * 100) / 100,
            target: progress.criteriaStatus.lowForgettingRisk.target,
          },
        },
        estimatedDaysToResolution: progress.daysToResolution,
        recommendation:
          progress.progress >= 75
            ? 'Very close to resolution! Continue your current study routine.'
            : progress.progress >= 50
              ? 'Making good progress. Focus on the criteria that are not yet met.'
              : progress.progress >= 25
                ? 'Some progress. Keep working on mastery and retention.'
                : 'Still early in the resolution process. Continue studying.',
      },
    });
  } catch (error) {
    console.error('Error getting debt progress:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to get debt progress',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
