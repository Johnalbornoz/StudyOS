import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getNextOccurrence, getUpcomingForStudent } from '@/services/assessment.service';

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
      return NextResponse.json({ error: 'Missing studentId' }, { status: 400 });
    }

    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    if (subjectId) {
      const occurrence = await getNextOccurrence(subjectId);
      return NextResponse.json({ success: true, data: { occurrence } });
    }

    const occurrences = await getUpcomingForStudent(studentId);
    return NextResponse.json({ success: true, data: { occurrences } });
  } catch (error) {
    console.error('Error fetching upcoming assessments:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: String(error) }, { status: 500 });
  }
}
