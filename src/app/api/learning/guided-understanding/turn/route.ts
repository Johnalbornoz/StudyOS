/**
 * POST /api/learning/guided-understanding/turn -- one answer inside a guided LEARN session.
 *
 * Body: { studentId, sessionId, answer }
 *
 * Grades the pending interaction with the existing grader, returns immediate feedback (correct / partial /
 * incorrect, what was wrong, the confusion, the concept reinforced, extra context) and either the next
 * interaction or the close. The server enforces the bounds (a close before 4 is ignored; 7 always closes,
 * closedBy CAP). On close exactly one learning_evidence row is written (contract 1.1, idempotent).
 *
 * Like the per-question check route, answering inside an OPEN session continues an attempt that was started
 * with a valid licence, so no licence is asked for here; nothing new can be started from this route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, checkRateLimit } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { isOwner } from '@/lib/authorization';
import { instructionalAssistanceLockedResponse } from '@/lib/ai/instructional-assistance-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentTextSafetyResponse } from '@/lib/safety/safety-route';
import { getGuidedSession, submitGuidedLearnTurn } from '@/services/learn-guided.service';

const TurnSchema = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().min(1).max(100),
  answer: z.string().trim().min(1).max(5_000),
});

const FAILURE_STATUS = { NOT_FOUND: 404, SESSION_NOT_ACTIVE: 409, TURN_CONFLICT: 409, GENERATION_FAILED: 503 } as const;

async function handlePOST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: z.infer<typeof TurnSchema>;
  try {
    body = TurnSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  if (!(await isOwner(actor.id, body.studentId))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!checkRateLimit(actor.id, 'learn-guided-turn', 30, 60)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });

  // ownership of the session folded into NOT_FOUND (another Student's session id is indistinguishable from none)
  const session = await getGuidedSession(body.studentId, body.sessionId);
  if (!session) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // Human Agency P0-4 (Layer B): deterministic safety gate first, before any grading or tutoring model.
  const safetyBlock = await studentTextSafetyResponse(body.answer, { studentId: body.studentId, surface: 'QUIZ_ANSWER', locale: session.language });
  if (safetyBlock) return safetyBlock;
  // Human Agency P0-1: no AI feedback while restricted evidence is being collected anywhere for this Student.
  const assistanceLocked = await instructionalAssistanceLockedResponse(body.studentId);
  if (assistanceLocked) return assistanceLocked;

  const result = await submitGuidedLearnTurn({ studentId: body.studentId, sessionId: body.sessionId, answer: body.answer });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: FAILURE_STATUS[result.code] });
  const { ok: _ok, ...data } = result;
  return NextResponse.json({ success: true, data });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/learning/guided-understanding/turn', handlePOST);
