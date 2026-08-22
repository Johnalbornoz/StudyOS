import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { query } from '@/lib/db';
import { getErrorPatternGuidance } from '@/services/error-intelligence.service';

export async function GET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const subjectId = searchParams.get('subjectId');
  const errorType = searchParams.get('errorType');
  const topConceptId = searchParams.get('topConceptId') || '';
  const topConceptLabel = searchParams.get('topConceptLabel') || '';
  const occurrences = Number(searchParams.get('occurrences') || '0');
  const language = searchParams.get('language') || 'en';

  if (!studentId || !subjectId || !errorType) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const subject = await query(`SELECT name FROM subjects WHERE id = $1 AND student_id = $2`, [subjectId, studentId]);
  if (subject.rowCount === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  try {
    const guidance = await getErrorPatternGuidance(
      studentId,
      subjectId,
      subject.rows[0].name,
      errorType,
      topConceptId,
      topConceptLabel,
      occurrences,
      language
    );
    return NextResponse.json({ success: true, data: { guidance } });
  } catch (error) {
    console.error('Error generating error-pattern guidance:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
