import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { sendMessage, verifyConversationOwnership } from '@/services/tutor.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { z } from 'zod';

const SendSchema = z.object({
  studentId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  conceptId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
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
    const reply = await sendMessage(validated.conversationId, validated.studentId, validated.message, preferredLanguage, validated.conceptId);
    return NextResponse.json({ success: true, data: { reply } });
  } catch (error) {
    console.error('Error sending tutor message:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: String(error) }, { status: 500 });
  }
}
