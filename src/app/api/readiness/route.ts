/**
 * F9 -- GET /api/readiness?examProfileId=&studentId=
 *
 * Latest snapshot for an exam profile. LEARNER_PROGRESS_VIEW
 * (owner/parent/teacher).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getLatestReadinessSnapshot, listReadinessSnapshots } from '@/lib/readiness/readiness.service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const examProfileId = searchParams.get('examProfileId');
  const all = searchParams.get('all') === 'true';
  if (!studentId || !examProfileId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const allowed = await canAccessLearner(actor.id, studentId, 'LEARNER_PROGRESS_VIEW');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  if (all) {
    const snapshots = await listReadinessSnapshots(examProfileId);
    return NextResponse.json({ success: true, data: { snapshots } });
  }
  const snapshot = await getLatestReadinessSnapshot(examProfileId);
  return NextResponse.json({ success: true, data: { snapshot } });
}
