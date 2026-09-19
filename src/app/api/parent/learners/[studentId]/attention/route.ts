/**
 * F10 -- GET /api/parent/learners/[studentId]/attention
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getParentAttentionAreas, ParentAccessDeniedError } from '@/lib/parent/read-model.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const areas = await getParentAttentionAreas(actor.id, studentId);
    return NextResponse.json({ success: true, data: { areas } });
  } catch (error) {
    if (error instanceof ParentAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}
