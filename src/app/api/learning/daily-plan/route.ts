/**
 * GET /api/learning/daily-plan
 *
 * Phase 3D -- Execution Scheduler. Returns the full time-fitted daily
 * plan: which of Phase 3C's ranked decisions fit the requested time
 * budget (`items`), and which were deferred with an honest reason
 * (`deferred`). Never reorders Phase 3C's pedagogical priority.
 *
 * Query params:
 *   studentId: string (uuid, required)
 *   availableMinutes: number (optional, default 30)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getDailyLearningPlan } from '@/services/learning-execution-scheduler.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';

export async function GET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'Missing studentId' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const availableMinutesParam = searchParams.get('availableMinutes');
  const availableMinutes = availableMinutesParam ? Number(availableMinutesParam) : undefined;
  if (availableMinutesParam !== null && (!Number.isFinite(availableMinutes) || (availableMinutes as number) <= 0)) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'availableMinutes must be a positive number' }, { status: 400 });
  }

  try {
    const preferredLanguage = await getInterfaceLanguage(studentId);
    const plan = await getDailyLearningPlan(studentId, { availableMinutes, preferredLanguage });
    return NextResponse.json({ success: true, data: { plan } });
  } catch (error) {
    console.error('Error computing daily learning plan:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to compute daily learning plan', details: process.env.NODE_ENV === 'development' ? String(error) : undefined },
      { status: 500 }
    );
  }
}
