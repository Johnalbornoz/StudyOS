import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getExamResultHistory } from '@/services/exam-result.service';

export async function GET(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const subjectId = searchParams.get('subjectId');

    if (!studentId) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: 'Missing studentId' }, { status: 400 });
    }

    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const results = await getExamResultHistory(studentId, subjectId || undefined);
    return NextResponse.json({ success: true, data: { results } });
  } catch (error) {
    console.error('Error fetching exam result history:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: String(error) }, { status: 500 });
  }
}
