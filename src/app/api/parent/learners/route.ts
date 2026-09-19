/**
 * F10 -- GET /api/parent/learners
 *
 * List of learners the authenticated actor has an ACCEPTED parent
 * relationship with. Zero-length array is a valid, first-class result
 * (task §10). No studentId is ever accepted as input here -- the list
 * is derived entirely from the actor's own resolved identity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getParentLearners } from '@/lib/parent/read-model.service';

export async function GET(_request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const learners = await getParentLearners(actor.id);
  return NextResponse.json({ success: true, data: { learners } });
}
