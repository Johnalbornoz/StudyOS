/**
 * F11-A -- GET /api/teacher/students/[studentId]/overview
 *
 * studentId is a client-supplied route param, re-validated server-side
 * via canTeacherAccessLearner inside getTeacherStudentOverview itself.
 * Never falls back to Parent or Owner access.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getTeacherStudentOverview, TeacherAccessDeniedError } from '@/lib/teacher/read-model.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const overview = await getTeacherStudentOverview(actor.id, studentId);
    return NextResponse.json({ success: true, data: overview });
  } catch (error) {
    if (error instanceof TeacherAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}
