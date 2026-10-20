/**
 * Track A -- GET /api/student/class-invitations
 * The Student's own pending class invitations (and current classes).
 * `studentId` is always the caller's own resolved identity.
 */
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireStudentId } from '@/lib/auth';
import { listPendingClassInvitationsForStudent, listActiveClassesForStudent } from '@/services/institution.service';

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const [invitations, classes] = await Promise.all([
    listPendingClassInvitationsForStudent(studentId),
    listActiveClassesForStudent(studentId),
  ]);
  return NextResponse.json({ success: true, data: { invitations, classes } });
}
