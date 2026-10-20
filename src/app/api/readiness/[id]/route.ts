/**
 * F9 -- GET /api/readiness/[id]
 *
 * Access is checked against the SNAPSHOT'S OWN studentId, never a
 * caller-supplied one (case T).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canReadLearnerRoute } from '@/lib/authorization/teacher-subject-scope';
import { getReadinessSnapshotById } from '@/lib/readiness/readiness.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const snapshot = await getReadinessSnapshotById(id);
  if (!snapshot) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // L10-R2: exam-wide readiness payload -- it cannot be sliced by subject, so a reader who is only this learner's Teacher is refused.
  const allowed = await canReadLearnerRoute(actor.id, snapshot.studentId, 'LEARNER_PROGRESS_VIEW', 'DENY');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  return NextResponse.json({ success: true, data: { snapshot } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/readiness/[id]', handleGET);
