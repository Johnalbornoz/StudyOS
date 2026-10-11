/**
 * POST /api/learning/record-evidence -- RETIRED (L6 ST-3).
 *
 * This route let the owner assert their own mastery: the client supplied
 * the result, the difficulty, a free-string sourceType and the confidence
 * weight, and the server wrote them as learning evidence. Nothing in the
 * app called it. Evidence is written only by the server-graded paths
 * (quiz submit, cognitive submit, verification, exam attempts).
 *
 * The file stays so the route answers deliberately rather than by
 * omission: callers are still authenticated and bound to the Student
 * first (401 / 403 unchanged), and the owner gets 404. It never imports
 * the mastery writer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess, checkRateLimit } from '@/lib/auth';
import { z } from 'zod';

const RetiredRequestSchema = z.object({ studentId: z.string().uuid('Invalid studentId') });

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  if (!checkRateLimit(authContext.userId, '/api/learning/record-evidence', 100, 60)) {
    return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const parsed = RetiredRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'Invalid request body' }, { status: 400 });
  }

  if (!(await verifyStudentAccess(authContext.userId, parsed.data.studentId, authContext.role))) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'You do not have permission to record evidence for this student' },
      { status: 403 },
    );
  }

  return NextResponse.json(
    { error: 'ENDPOINT_RETIRED', message: 'Learning evidence is recorded by graded activities only' },
    { status: 404 },
  );
}
