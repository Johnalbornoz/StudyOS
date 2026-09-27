import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { query } from '@/lib/db';
import { suggestConceptNames } from '@/services/concept-extraction.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const subjectId = searchParams.get('subjectId');
  const partial = searchParams.get('partial') || '';
  const language = searchParams.get('language') || 'en';

  if (!studentId || !subjectId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const subject = await query(`SELECT name FROM subjects WHERE id = $1 AND student_id = $2`, [
    subjectId,
    studentId,
  ]);
  if (subject.rowCount === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const suggestions = await suggestConceptNames(subject.rows[0].name, partial, language);
  return NextResponse.json({ success: true, data: { suggestions } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/concepts/suggest', handleGET);
