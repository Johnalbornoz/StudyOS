import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getMessages, verifyConversationOwnership } from '@/services/tutor.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const conversationId = searchParams.get('conversationId');
  if (!studentId || !conversationId) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'Missing studentId or conversationId' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const owns = await verifyConversationOwnership(conversationId, studentId);
  if (!owns) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const messages = await getMessages(conversationId);
  return NextResponse.json({ success: true, data: { messages } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/tutor/messages', handleGET);
