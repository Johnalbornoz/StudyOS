import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { sendMessage, verifyConversationOwnership } from '@/services/tutor.service';
import { buildTutorContext, OwnershipError, TUTOR_ENTRY_MODES } from '@/lib/tutor/context-pack';
import { TUTOR_ACTIONS } from '@/lib/tutor/quick-actions';
import { db } from '@/lib/db';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { z } from 'zod';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const SendSchema = z.object({
  studentId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  conceptId: z.string().uuid().optional(),
  // UX-5 closure: the allowed learning surface the Tutor was opened from (framing only).
  from: z.enum(TUTOR_ENTRY_MODES).optional(),
  // UX-5: a representation request (never FIND_VIDEO -- that goes through /api/tutor/video).
  action: z.enum(TUTOR_ACTIONS.filter((a) => a !== 'FIND_VIDEO') as [string, ...string[]]).optional(),
});

async function handlePOST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await request.json();
  let validated;
  try {
    validated = SendSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const owns = await verifyConversationOwnership(validated.conversationId, validated.studentId);
  if (!owns) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // The AI tutor is a paid capability -- gated server-side, never only
  // hidden in the UI. An unlicensed Student's DEMO access does not
  // include AI-generated tutoring.
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const entitled = await canUseCapability(actor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
  if (!entitled) {
    return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });
  }

  try {
    const preferredLanguage = await getInterfaceLanguage(validated.studentId);
    // UX-5: the concept (client-supplied) must belong to one of this
    // Student's subjects, and to the conversation's own subject when the
    // conversation has one -- verified before it reaches retrieval,
    // teaching intent or the model.
    const conv = await db.query(`SELECT subject_id FROM tutor_conversations WHERE id = $1`, [validated.conversationId]);
    const context = await buildTutorContext({
      studentId: validated.studentId,
      language: preferredLanguage,
      subjectId: conv.rows[0]?.subject_id ?? null,
      conceptId: validated.conceptId ?? null,
      entryMode: validated.from ?? null,
    });
    const reply = await sendMessage(validated.conversationId, validated.studentId, validated.message, preferredLanguage, validated.conceptId, {
      context,
      action: validated.action as any,
    });
    return NextResponse.json({ success: true, data: { reply } });
  } catch (error) {
    if (error instanceof OwnershipError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    console.error('Error sending tutor message:', error);
    // Never internal detail to the client.
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/tutor/message', handlePOST);
