/**
 * F8 -- GET /api/teaching/interventions/[id]
 *
 * Session + its attempt history. LEARNER_PROGRESS_VIEW (owner/parent/
 * teacher), checked against the session's OWN studentId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { resolveLearnerReadScope } from '@/lib/authorization';
import { getInterventionSession, listAttemptsForSession } from '@/lib/teaching/session.service';
import { getDiagnosisById } from '@/lib/diagnostics/diagnosis.service';
import { teacherMayReadLearnerConcept } from '@/lib/authorization/learner-result-scope';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const session = await getInterventionSession(id);
  if (!session) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const scope = await resolveLearnerReadScope(actor.id, session.studentId);
  if (!scope.permissions.includes('LEARNER_PROGRESS_VIEW')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  // L10 SF-4 (D-1 final rulings). The attempts are the learner's submitted, item-level responses.
  //  - owner: everything;
  //  - Parent: the session, never the attempts;
  //  - Teacher (and nothing else): only when the session's concept belongs to a subject the teacher
  //    is authorized for with this learner -- otherwise the session is not theirs to read at all.
  const owner = scope.relationships.includes('OWNER');
  const teacherOnly = !owner && scope.relationships.includes('TEACHER') && !scope.relationships.includes('PARENT');
  let teacherInSubject = false;
  if (!owner && scope.relationships.includes('TEACHER')) {
    const diagnosis = await getDiagnosisById(session.diagnosisId).catch(() => null);
    teacherInSubject = await teacherMayReadLearnerConcept(actor.id, session.studentId, diagnosis?.conceptId ?? null);
  }
  if (teacherOnly && !teacherInSubject) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const attempts = await listAttemptsForSession(id);
  if (!owner && !teacherInSubject) {
    return NextResponse.json({ success: true, data: { session, attempts: [], attemptCount: attempts.length, detailWithheld: true } });
  }
  return NextResponse.json({ success: true, data: { session, attempts } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teaching/interventions/[id]', handleGET);
