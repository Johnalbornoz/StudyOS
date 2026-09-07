/**
 * LX-5E -- POST /api/learning/continue
 *
 * The one continuation endpoint. Given the concept the learner just
 * finished an activity (or Learn) on, it re-reads canonical truth and
 * returns exactly one continuation:
 *   { status: 'LAUNCH', launchTarget, activityType, source }
 *   { status: 'RETURN_TO_MISSION', reason }
 *
 * It decides nothing pedagogical -- `resolveContinuation` consumes the
 * canonical Phase 4 decision / Phase 8 first-touch / session engine.
 * `from` is presentation context only (which checkpoint copy was
 * shown); it never affects the resolution.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { resolveContinuation } from '@/services/learning-continuation.service';

const Schema = z.object({
  studentId: z.string().uuid(),
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid(),
  from: z.enum(['LEARN', 'PRACTICE', 'PROVE', 'TRANSFER', 'RETAIN', 'REINFORCE']).optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let v: z.infer<typeof Schema>;
  try {
    v = Schema.parse(await request.json());
  } catch (e: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: e.errors?.[0]?.message }, { status: 400 });
  }
  if (!(await verifyStudentAccess(authContext.userId, v.studentId, authContext.role))) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const continuation = await resolveContinuation({
      studentId: v.studentId,
      conceptId: v.conceptId,
      subjectId: v.subjectId,
    });
    return NextResponse.json({ success: true, data: { continuation } });
  } catch (e) {
    console.error('[LX-5] continuation resolve failed:', e);
    // Never fabricate a next activity -- fail safe to the mission.
    return NextResponse.json({
      success: true,
      data: { continuation: { status: 'RETURN_TO_MISSION', reason: 'RESOLVE_FAILED' } },
    });
  }
}
