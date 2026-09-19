/**
 * F11-C1 -- GET /api/student/teacher-interventions
 *
 * Always "my own" -- studentId is resolved server-side from the
 * authenticated actor's own canonical identity (getOrCreateStudentId),
 * never accepted as a request param. There is no studentId for a
 * caller to substitute, so no separate authorization check is needed
 * beyond identity resolution itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, getOrCreateStudentId } from '@/lib/auth';
import { getStudentPendingTeacherInterventions } from '@/lib/student/teacher-intervention-execution.service';

export async function GET(_request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await getOrCreateStudentId(authContext.userId);

  const interventions = await getStudentPendingTeacherInterventions(studentId);
  return NextResponse.json({ success: true, data: { interventions } });
}
