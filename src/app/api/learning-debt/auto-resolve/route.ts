/**
 * POST /api/learning-debt/auto-resolve
 *
 * Automatically check and resolve learning debts
 *
 * Request body:
 * {
 *   studentId: string
 *   conceptId?: string (if omitted, resolves all debts for student)
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     results: DebtResolutionResult[]
 *     summary: {
 *       totalChecked: number
 *       resolved: number
 *       stillActive: number
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import {
  autoResolveDebt,
  autoResolveAllDebts,
} from '@/services/debt-resolution.service';
import { z } from 'zod';

const AutoResolveSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  conceptId: z.string().uuid('Invalid conceptId').optional(),
});

type AutoResolveRequest = z.infer<typeof AutoResolveSchema>;

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
    let validated: AutoResolveRequest;
    try {
      validated = AutoResolveSchema.parse(body);
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
          message: 'You do not have permission to resolve debts for this student',
        },
        { status: 403 }
      );
    }

    // Resolve debts
    let results;
    if (validated.conceptId) {
      // Resolve single debt
      const result = await autoResolveDebt(validated.studentId, validated.conceptId);
      results = [result];
    } else {
      // Resolve all debts for student
      results = await autoResolveAllDebts(validated.studentId);
    }

    // Calculate summary
    const resolved = results.filter(r => r.resolved).length;
    const stillActive = results.filter(r => !r.resolved).length;

    return NextResponse.json({
      success: true,
      data: {
        results: results.map(r => ({
          debtId: r.debtId,
          conceptId: r.conceptId,
          resolved: r.resolved,
          reason: r.reason,
          mastery: Math.round(r.mastery * 100) / 100,
          daysSinceLastSuccess: r.daysSinceLastSuccess,
          forgettingRisk: Math.round(r.forgettingRisk * 100) / 100,
          criteria: r.criteria,
        })),
        summary: {
          totalChecked: results.length,
          resolved,
          stillActive,
        },
      },
    });
  } catch (error) {
    console.error('Error in auto-resolve:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to auto-resolve debts',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
