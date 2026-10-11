/**
 * F8 -- GET /api/diagnostics/[id]/explain (task §11)
 *
 * The diagnosis's own studentId (not a query param) determines the
 * access check -- a caller cannot spoof authorization by supplying an
 * unrelated studentId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canReadLearnerRoute } from '@/lib/authorization/teacher-subject-scope';
import { getDiagnosisById } from '@/lib/diagnostics/diagnosis.service';
import { explainDiagnosis } from '@/lib/diagnostics/explain.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const diagnosis = await getDiagnosisById(id);
  if (!diagnosis) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // L10-R2: one concept of the learner -- a Teacher reads it only inside a subject they are authorized for with this learner.
  const allowed = await canReadLearnerRoute(actor.id, diagnosis.studentId, 'LEARNER_PROGRESS_VIEW', { learnerConceptId: diagnosis.conceptId });
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const explanation = await explainDiagnosis(id);
  return NextResponse.json({ success: true, data: { explanation } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/diagnostics/[id]/explain', handleGET);
