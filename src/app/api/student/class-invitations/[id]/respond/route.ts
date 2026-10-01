/**
 * Track A -- POST /api/student/class-invitations/[id]/respond { accept }
 * The Student consents to (or declines) a class enrollment. Only a PENDING
 * invitation addressed to the caller's own student identity can change;
 * any other id (another student's, an unknown one) is 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireStudentId } from '@/lib/auth';
import { respondToClassInvitation } from '@/services/institution.service';
import { allUuids } from '@/lib/institution/route-guard';
import { notifyInviterOfResponse } from '@/lib/institution/class-invitations';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.object({ accept: z.boolean() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: enrollmentId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!allUuids(enrollmentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const result = await respondToClassInvitation(studentId, enrollmentId, parsed.data.accept);
  if (!result) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await notifyInviterOfResponse(result, studentId, parsed.data.accept);
  return NextResponse.json({ success: true, data: { status: parsed.data.accept ? 'ACTIVE' : 'DECLINED' } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/student/class-invitations/[id]/respond', handlePOST);
