/**
 * GET /api/learning/next-action
 *
 * Phase 3D -- NBA v3. Returns the single best next action for the
 * student right now, or `{ nextAction: null }` if nothing is currently
 * actionable. Computed fresh on every call -- no cache, no persisted
 * "next action" row.
 *
 * Query params:
 *   studentId: string (uuid, required)
 *   availableMinutes: number (optional, default 30)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getNextBestActionV3 } from '@/services/next-best-action-v3.service';
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
    const nextAction = await getNextBestActionV3(studentId, { availableMinutes, preferredLanguage });
    return NextResponse.json({ success: true, data: { nextAction } });
  } catch (error) {
    console.error('Error computing next best action:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to compute next best action', details: process.env.NODE_ENV === 'development' ? String(error) : undefined },
      { status: 500 }
    );
  }
}
