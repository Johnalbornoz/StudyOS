import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentId } from '@/lib/auth';
import { cancelImport } from '@/services/document-import.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

/** DELETE /api/content/import/[sourceId] -- cancel: removes the Student's own uploaded material; nothing else exists yet. */
async function handleDELETE(_req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const removed = await cancelImport(studentId, sourceId).catch(() => false);
  return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}

export const DELETE = withAiRequestMetrics('DELETE /api/content/import/[sourceId]', handleDELETE);
