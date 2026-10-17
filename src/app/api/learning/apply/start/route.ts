/**
 * POST /api/learning/apply/start -- APPLY (adaptive transfer ladder, transfer-ladder-v1).
 *
 * Resumes the learner's open APPLY attempt for this concept, or starts a new one. A NEW attempt is
 * authorized only when a FRESH canonical decision is TRANSFER + EXECUTABLE (the same precondition
 * as /api/cognitive/transfer/generate); the client never chooses a level -- the first challenge is
 * NEAR and every later level comes from the attempt's own previous step (server-side state).
 *
 * Body: { studentId: uuid, conceptId: uuid, subjectId: uuid, language?: string }
 * 200: { success: true, data: TransferLadderView }
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { resolveConceptSubjectForStudent } from '@/lib/pedagogical-decision';
import { learningLicenceRequiredResponse } from '@/lib/entitlements/learning-gate';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { createTransferLadderService, TransferLadderError } from '@/services/transfer-ladder.service';

const Schema = z.object({
  studentId: z.string().uuid(),
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid(),
  language: z.string().min(2).max(10).optional(),
});

async function handlePOST(request: NextRequest) {
  let conceptIdForLog: string | undefined;
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const parsed = Schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
    const input = parsed.data;
    conceptIdForLog = input.conceptId;

    if (!(await verifyStudentAccess(authContext.userId, input.studentId, authContext.role))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    // The concept must belong to THIS learner's subject, and to the subject the client named.
    const owned = await resolveConceptSubjectForStudent(input.conceptId, input.studentId);
    if (!owned || owned.subjectId !== input.subjectId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    // D-8: a route that STARTS (or resumes and may generate) is plainly PAID. Answering inside an open
    // attempt is the CONTINUATION route /api/learning/apply/answer.
    const licence = await learningLicenceRequiredResponse(authContext, input.studentId);
    if (licence) return licence;

    const service = createTransferLadderService();

    const language = input.language || (await getInterfaceLanguage(input.studentId));
    const view = await service.start({ studentId: input.studentId, conceptId: input.conceptId, subjectId: input.subjectId, language });
    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    if (error instanceof TransferLadderError) {
      if (error.status >= 500) {
        logOperationalWarning({ subsystem: 'transfer', operation: 'POST /api/learning/apply/start', context: { route: 'POST /api/learning/apply/start', conceptId: conceptIdForLog } });
      }
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    logOperationalWarning({ subsystem: 'transfer', operation: 'POST /api/learning/apply/start', error, context: { route: 'POST /api/learning/apply/start', conceptId: conceptIdForLog } });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export const POST = withAiRequestMetrics('POST /api/learning/apply/start', handlePOST);
