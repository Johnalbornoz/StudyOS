import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { createConversation, getConversations } from '@/services/tutor.service';
import { assertOwnedSubject, OwnershipError } from '@/lib/tutor/context-pack';
import { z } from 'zod';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

// GET (viewing past conversations) is never entitlement-gated -- a
// Student's own history remains visible regardless of subscription
// state (LEARNING_HISTORY_VIEW is never revoked). Only POST (starting
// a new AI tutor conversation) is a paid capability.

async function handleGET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'Missing studentId' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const conversations = await getConversations(studentId);
  return NextResponse.json({ success: true, data: { conversations } });
}

const CreateSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
});

async function handlePOST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await request.json();
  let validated;
  try {
    validated = CreateSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const entitled = await canUseCapability(actor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
  if (!entitled) {
    return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });
  }

  // UX-5: a conversation may only be scoped to a subject this Student owns
  // (its material grounds every reply).
  if (validated.subjectId) {
    try {
      await assertOwnedSubject(validated.studentId, validated.subjectId);
    } catch (e) {
      if (e instanceof OwnershipError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
      throw e;
    }
  }
  const conversationId = await createConversation(validated.studentId, validated.subjectId);
  return NextResponse.json({ success: true, data: { conversationId } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/tutor/conversations', handleGET);
export const POST = withAiRequestMetrics('POST /api/tutor/conversations', handlePOST);
