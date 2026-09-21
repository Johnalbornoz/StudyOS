/**
 * F11-C1 -- GET /api/student/teacher-interventions
 *
 * Always "my own" -- studentId is resolved server-side from the
 * authenticated actor's own canonical identity (`requireStudentId`,
 * which returns null -- 403 -- rather than provisioning a Student for
 * an account with no ACTIVE STUDENT role), never accepted as a request
 * param. There is no studentId for a caller to substitute.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireStudentId } from '@/lib/auth';
import { getStudentPendingTeacherInterventions } from '@/lib/student/teacher-intervention-execution.service';

export async function GET(_request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(authContext.userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const interventions = await getStudentPendingTeacherInterventions(studentId);
  return NextResponse.json({ success: true, data: { interventions } });
}
