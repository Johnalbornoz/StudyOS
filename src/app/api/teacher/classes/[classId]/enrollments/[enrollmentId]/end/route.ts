/**
 * Track A -- POST /api/teacher/classes/[classId]/enrollments/[enrollmentId]/end
 * The class's Teacher withdraws a pending invitation or removes a learner
 * from THIS class (soft: ENDED, never a DELETE). Removal immediately ends
 * the Teacher's access to that learner (every check requires ACTIVE).
 * Scoped to the class and its institution: a foreign enrollment id is 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { allUuids } from '@/lib/institution/route-guard';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { endClassEnrollment } from '@/services/institution.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ classId: string; enrollmentId: string }> }) {
  const { classId, enrollmentId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId, enrollmentId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const ended = await endClassEnrollment(klass.institutionId, classId, enrollmentId);
  if (!ended) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/enrollments/[enrollmentId]/end', handlePOST);
