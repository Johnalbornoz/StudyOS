/**
 * POST /api/study-plan/generate
 *
 * Generate a personalized study plan for the student
 *
 * Request body:
 * {
 *   studentId: string
 *   daysAhead?: number (default 7)
 *   dailyMinutes?: number (default 90)
 *   startDate?: string (ISO date, default today)
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     planId: string
 *     plan: {
 *       startDate: string
 *       endDate: string
 *       sessions: [
 *         {
 *           date: string
 *           totalMinutes: number
 *           items: [
 *             {
 *               conceptId: string
 *               label: string
 *               activityType: string
 *               estimatedMinutes: number
 *               priority: string
 *             }
 *           ]
 *         }
 *       ]
 *       totalStudyMinutes: number
 *       criticalConceptsCount: number
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import {
  generateStudyPlan,
  storeStudyPlan,
} from '@/services/study-plan.service';
import { z } from 'zod';

const GenerateStudyPlanSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  daysAhead: z.number().int().min(1).max(90).optional(),
  dailyMinutes: z.number().int().min(30).max(240).optional(),
  startDate: z.string().datetime().optional(),
});

type GenerateStudyPlanRequest = z.infer<typeof GenerateStudyPlanSchema>;

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate input
    let validated: GenerateStudyPlanRequest;
    try {
      validated = GenerateStudyPlanSchema.parse(body);
    } catch (error: any) {
      return NextResponse.json(
        {
          error: 'INVALID_INPUT',
          message: error.errors?.[0]?.message || 'Invalid request body',
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
          message: 'You do not have permission to generate a plan for this student',
        },
        { status: 403 }
      );
    }

    const startDate = validated.startDate ? new Date(validated.startDate) : new Date();

    // Generate plan
    const plan = await generateStudyPlan(validated.studentId, {
      daysAhead: validated.daysAhead || 7,
      dailyMinutes: validated.dailyMinutes || 90,
      startDate,
    });

    // Store plan
    const planId = await storeStudyPlan(plan);

    return NextResponse.json({
      success: true,
      data: {
        planId,
        plan: {
          startDate: plan.startDate.toISOString(),
          endDate: plan.endDate.toISOString(),
          sessions: plan.sessions.map(s => ({
            date: s.date.toISOString(),
            totalMinutes: s.totalMinutes,
            items: s.items.map(item => ({
              conceptId: item.conceptId,
              canonicalId: item.canonicalId,
              label: item.label,
              activityType: item.activityType,
              estimatedMinutes: item.estimatedMinutes,
              priority: item.priority,
            })),
            subjectBreakdown: s.subjectBreakdown,
          })),
          totalStudyMinutes: plan.totalStudyMinutes,
          subjectsInPlan: plan.subjectsInPlan,
          criticalConceptsCount: plan.criticalConceptsCount,
        },
      },
    });
  } catch (error) {
    console.error('Error generating study plan:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to generate study plan',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
