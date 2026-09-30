/**
 * POST /api/learning-debt/check-and-resolve
 *
 * Check if a learning debt should be resolved based on student progress
 *
 * Request body:
 * {
 *   studentId: string
 *   conceptId: string
 *   currentMastery: number (0-100)
 *   daysSinceLastSuccess: number
 *   forgettingRisk: number (0-100)
 * }
 *
 * Response:
 * {
 *   resolved: boolean
 *   debt?: { id, severity, status, ... }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { checkAndResolveDebt } from '@/services/learning-debt.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

interface CheckAndResolveRequest {
  studentId: string;
  conceptId: string;
  currentMastery: number;
  daysSinceLastSuccess: number;
  forgettingRisk: number;
}

async function handlePOST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: CheckAndResolveRequest = await request.json();

    // Validate required fields
    const required = ['studentId', 'conceptId', 'currentMastery', 'daysSinceLastSuccess', 'forgettingRisk'];
    for (const field of required) {
      if (body[field as keyof CheckAndResolveRequest] === undefined) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // STUDENT E2E security: a Student can only touch their OWN debts (the
    // service's UPDATE is scoped by this verified studentId).
    if (!(await verifyStudentAccess(authContext.userId, body.studentId, authContext.role))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const resolved = await checkAndResolveDebt(
      body.studentId,
      body.conceptId,
      body.currentMastery,
      body.daysSinceLastSuccess,
      body.forgettingRisk
    );

    return NextResponse.json({
      success: true,
      data: {
        resolved: !!resolved,
        debt: resolved,
      },
    });
  } catch (error) {
    console.error('Error checking/resolving debt:', error);
    return NextResponse.json(
      { error: 'Failed to check debt resolution' },
      { status: 500 }
    );
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/learning-debt/check-and-resolve', handlePOST);
