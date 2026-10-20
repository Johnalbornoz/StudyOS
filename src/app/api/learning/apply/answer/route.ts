/**
 * POST /api/learning/apply/answer -- grades the pending APPLY challenge (transfer-ladder-v1).
 *
 * The answer is graded by the canonical free-text grader (score 0..1 -> scorePercent); a challenge
 * passes at >= 80. The server then moves the ladder (pass + certified -> up; otherwise same level,
 * a different context) and either serves the next challenge or closes the attempt and writes ONE
 * learning_evidence row. During the attempt only correctness is returned; the model answers and the
 * grader's feedback are revealed in the final summary.
 *
 * Body: { studentId: uuid, sessionId: string, answer: string }
 * 200: { success: true, data: { result: { index, level, scorePercent, passed }, view: TransferLadderView } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { studentTextSafetyResponse, safetyResponseForError } from '@/lib/safety/safety-route';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { createTransferLadderService, TransferLadderError } from '@/services/transfer-ladder.service';

const Schema = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().min(1).max(100),
  answer: z.string().trim().min(1).max(8000),
});

async function handlePOST(request: NextRequest) {
  let studentIdForSafety: string | null = null;
  let language = 'es';
  let conceptIdForLog: string | undefined;
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const parsed = Schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
    const input = parsed.data;

    if (!(await verifyStudentAccess(authContext.userId, input.studentId, authContext.role))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const service = createTransferLadderService();
    const session = await service.load(input.sessionId);
    // Another learner's session is indistinguishable from a missing one.
    if (!session || session.studentId !== input.studentId) return NextResponse.json({ error: 'APPLY_SESSION_NOT_FOUND' }, { status: 404 });
    conceptIdForLog = session.conceptId;
    language = session.language;
    studentIdForSafety = input.studentId;

    // Human Agency P0-4: the deterministic safety gate runs before any grading model call.
    const safetyBlock = await studentTextSafetyResponse(input.answer, { studentId: input.studentId, surface: 'TRANSFER', locale: session.language });
    if (safetyBlock) return safetyBlock;

    // No licence check here: answering is the continuation of an attempt the server opened under a
    // valid licence (D-8(c)); a new challenge is only ever served inside that same open attempt.
    const { result, view } = await service.answer(session, input.answer);
    return NextResponse.json({ success: true, data: { result, view } });
  } catch (error) {
    if (studentIdForSafety) {
      const safety = await safetyResponseForError(error, { studentId: studentIdForSafety, surface: 'TRANSFER', locale: language });
      if (safety) return safety;
    }
    if (error instanceof TransferLadderError) {
      if (error.status >= 500) {
        logOperationalWarning({ subsystem: 'transfer', operation: 'POST /api/learning/apply/answer', context: { route: 'POST /api/learning/apply/answer', conceptId: conceptIdForLog } });
      }
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    logOperationalWarning({ subsystem: 'transfer', operation: 'POST /api/learning/apply/answer', error, context: { route: 'POST /api/learning/apply/answer', conceptId: conceptIdForLog } });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export const POST = withAiRequestMetrics('POST /api/learning/apply/answer', handlePOST);
