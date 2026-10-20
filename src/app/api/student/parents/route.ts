/**
 * Track A -- GET /api/student/parents
 * The Student's own list of family members with ACCEPTED access to their
 * progress (to review and revoke). Owner-only: `requireStudentId`.
 */
import { NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { auth } from '@clerk/nextjs/server';
import { requireStudentId } from '@/lib/auth';
import { listParentsForStudent } from '@/services/parent.service';

async function handleGET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  return NextResponse.json({ success: true, data: { parents: await listParentsForStudent(studentId) } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/student/parents', handleGET);
