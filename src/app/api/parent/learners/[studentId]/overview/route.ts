/**
 * F10 -- GET /api/parent/learners/[studentId]/overview
 *
 * LEARNER_PROGRESS_VIEW, re-validated server-side inside
 * getParentLearnerOverview itself -- studentId here is client-supplied
 * (a route param) and is never trusted without that check (task §29).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getParentLearnerOverview, ParentAccessDeniedError } from '@/lib/parent/read-model.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const overview = await getParentLearnerOverview(actor.id, studentId);
    return NextResponse.json({ success: true, data: overview });
  } catch (error) {
    if (error instanceof ParentAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}
