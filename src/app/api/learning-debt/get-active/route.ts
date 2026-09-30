/**
 * GET /api/learning-debt/get-active
 *
 * Get all active learning debts for a student
 *
 * Query params:
 * - studentId: uuid
 * - subjectId?: uuid (optional - filter by subject)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getActiveDebts } from '@/services/learning-debt.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const subjectId = searchParams.get('subjectId');

    if (!studentId) {
      return NextResponse.json(
        { error: 'Missing studentId query parameter' },
        { status: 400 }
      );
    }

    // STUDENT E2E security: only the Student themselves (or an authorized teacher/admin).
    if (!(await verifyStudentAccess(authContext.userId, studentId, authContext.role))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const debts = await getActiveDebts(studentId, subjectId || undefined);

    return NextResponse.json({
      success: true,
      data: {
        debts,
        count: debts.length,
      },
    });
  } catch (error) {
    console.error('Error fetching active debts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch debts' },
      { status: 500 }
    );
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/learning-debt/get-active', handleGET);
