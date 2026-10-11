/**
 * L9 IN-3 -- POST /api/student/class-enrollments/[id]/leave
 * The Student leaves a class: their OWN ACTIVE enrollment becomes ENDED (existing transition;
 * history kept). Any other id -- another student's, unknown, pending, already ended -- is 404.
 * From the next request the class's teachers no longer reach this learner through it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireStudentId } from '@/lib/auth';
import { allUuids } from '@/lib/institution/route-guard';
import { leaveClassAsStudent } from '@/lib/institution/student-class-membership';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: enrollmentId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!allUuids(enrollmentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const left = await leaveClassAsStudent(studentId, enrollmentId);
  if (!left) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: { enrollmentId: left.enrollmentId, status: 'ENDED' } });
}

export const POST = withAiRequestMetrics('POST /api/student/class-enrollments/[id]/leave', handlePOST);
