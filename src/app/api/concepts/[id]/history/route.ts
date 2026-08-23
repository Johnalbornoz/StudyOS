import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getConceptEvidenceHistory } from '@/services/learner-model.service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const history = await getConceptEvidenceHistory(studentId, id, 20);
    return NextResponse.json({ success: true, data: { history } });
  } catch (error) {
    console.error('Get concept history error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
