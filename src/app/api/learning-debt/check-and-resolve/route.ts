/**
 * POST /api/learning-debt/check-and-resolve -- RETIRED (L6 ST-3).
 *
 * This route resolved a learning debt from client-supplied currentMastery,
 * daysSinceLastSuccess and forgettingRisk, so the owner could clear their
 * own debt by asserting the numbers. Nothing in the app called it. Debts
 * are resolved server-side, from the mastery the server itself computed.
 *
 * The file stays so the route answers deliberately rather than by
 * omission: callers are still authenticated and bound to the Student
 * first (401 / 403 unchanged), and the owner gets 404. It never imports
 * the debt resolver.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { studentId?: unknown } | null;
  if (!body || typeof body.studentId !== 'string') {
    return NextResponse.json({ error: 'Missing required field: studentId' }, { status: 400 });
  }

  if (!(await verifyStudentAccess(authContext.userId, body.studentId, authContext.role))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  return NextResponse.json({ error: 'ENDPOINT_RETIRED' }, { status: 404 });
}
