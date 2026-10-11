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
import { canReadLearnerRoute } from '@/lib/authorization/teacher-subject-scope';
import { listDiagnosesForStudentConcept } from '@/lib/diagnostics/diagnosis.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const conceptId = searchParams.get('conceptId');
  if (!studentId || !conceptId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  // L10-R2: one concept of the learner -- a Teacher reads it only inside a subject they are authorized for with this learner.
  const allowed = await canReadLearnerRoute(actor.id, studentId, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: conceptId });
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const diagnoses = await listDiagnosesForStudentConcept(studentId, conceptId);
  return NextResponse.json({ success: true, data: { diagnoses } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/diagnostics', handleGET);
