/**
 * F11-B -- GET /api/teacher/students/[studentId]/interventions
 *
 * TEACHER_INTERVENTION_VIEW. studentId is a client-supplied route
 * param, re-validated server-side inside listTeacherInterventionsForStudent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { listTeacherInterventionsForStudent, TeacherInterventionAccessDeniedError } from '@/lib/teacher/intervention.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const interventions = await listTeacherInterventionsForStudent(actor.id, studentId);
    return NextResponse.json({ success: true, data: { interventions } });
  } catch (error) {
    if (error instanceof TeacherInterventionAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}
