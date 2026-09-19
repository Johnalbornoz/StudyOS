/**
 * F11-A -- GET /api/teacher/classes/[classId]/roster
 *
 * classId is a client-supplied route param and is never trusted
 * without server-side re-validation via canAccessClass, performed
 * inside getTeacherClassRoster itself (task's own architectural rule:
 * never trust, always re-check server-side).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getTeacherClassRoster, TeacherAccessDeniedError } from '@/lib/teacher/read-model.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const roster = await getTeacherClassRoster(actor.id, classId);
    return NextResponse.json({ success: true, data: { roster } });
  } catch (error) {
    if (error instanceof TeacherAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}
