/**
 * F8 -- GET /api/diagnostics?studentId=&conceptId=
 *
 * Lists prior diagnoses for one (studentId, conceptId), newest first.
 * LEARNER_PROGRESS_VIEW -- owner/parent/teacher, same as every other
 * progress-reading route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { listDiagnosesForStudentConcept } from '@/lib/diagnostics/diagnosis.service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const conceptId = searchParams.get('conceptId');
  if (!studentId || !conceptId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const allowed = await canAccessLearner(actor.id, studentId, 'LEARNER_PROGRESS_VIEW');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const diagnoses = await listDiagnosesForStudentConcept(studentId, conceptId);
  return NextResponse.json({ success: true, data: { diagnoses } });
}
