import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { buildTutorContext, OwnershipError } from '@/lib/tutor/context-pack';
import { findApprovedVideo } from '@/lib/tutor/video/service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

/**
 * UX-5 -- POST /api/tutor/video: an approved educational video for the
 * verified context, or a graceful "none". The query is built server-side
 * from the verified concept/topic/subject (the client never sends free
 * search text), only approved channels are searched, and every candidate
 * passes the three gates (lib/tutor/video/policy.ts). The response never
 * contains gate reasons, scores or candidate lists.
 */
const Body = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  conceptId: z.string().uuid().optional(),
  deep: z.boolean().optional(),
});

async function handlePOST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const { studentId, subjectId, conceptId, deep } = parsed.data;
  if (!(await verifyStudentAccess(authContext.userId, studentId, authContext.role))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  if (!(await canUseCapability(actor.id, studentId, 'LEARNING_FULL_ACCESS'))) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });
  try {
    const language = await getInterfaceLanguage(studentId);
    const ctx = await buildTutorContext({ studentId, language, subjectId: subjectId ?? null, conceptId: conceptId ?? null });
    // Same integrity guard as the Tutor: no external help while evidence is being collected.
    if (ctx.supportPolicy !== 'OPEN') return NextResponse.json({ success: true, data: { status: 'RESTRICTED' } });
    const result = await findApprovedVideo({
      language,
      ageBand: ctx.student.ageBand,
      subjectName: ctx.learning.subject?.name ?? null,
      topic: ctx.learning.topic,
      conceptLabel: ctx.learning.concept?.label ?? null,
      deep,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof OwnershipError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    console.error('[tutor-video]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: true, data: { status: 'UNAVAILABLE' } });
  }
}

export const POST = withAiRequestMetrics('POST /api/tutor/video', handlePOST);
