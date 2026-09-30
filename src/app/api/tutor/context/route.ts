import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { buildTutorContext, OwnershipError } from '@/lib/tutor/context-pack';
import { videoRetrievalConfigured } from '@/lib/tutor/video/service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

/**
 * UX-5 -- GET /api/tutor/context?studentId&subjectId&conceptId
 *
 * What the Tutor UI may show about the current context: names/labels only
 * (never ids it did not send, never scores), the support policy from the
 * existing integrity guard, and which optional capabilities are configured.
 * Every client id is authorized: student access, then subject / concept
 * ownership (403 otherwise -- never another Student's data).
 */
async function handleGET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const studentId = sp.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  if (!(await verifyStudentAccess(authContext.userId, studentId, authContext.role))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const uuid = /^[0-9a-f-]{36}$/i;
  const subjectId = sp.get('subjectId');
  const conceptId = sp.get('conceptId');
  if ((subjectId && !uuid.test(subjectId)) || (conceptId && !uuid.test(conceptId))) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const language = await getInterfaceLanguage(studentId);
    const ctx = await buildTutorContext({ studentId, language, subjectId, conceptId, entryMode: sp.get('from') });
    return NextResponse.json({
      success: true,
      data: {
        subject: ctx.learning.subject,
        concept: ctx.learning.concept,
        topic: ctx.learning.topic,
        entryMode: ctx.learning.entryMode,
        supportPolicy: ctx.supportPolicy,
        capabilities: { video: videoRetrievalConfigured(), visuals: true },
      },
    });
  } catch (e) {
    if (e instanceof OwnershipError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    console.error('[tutor-context]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export const GET = withAiRequestMetrics('GET /api/tutor/context', handleGET);
