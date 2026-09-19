import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInstitutionLearnerSummary } from '@/lib/institution-intelligence';
import { respondFromService } from '../_respond';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const url = new URL(request.url);
  const classId = url.searchParams.get('classId') ?? undefined;

  return respondFromService(() => getInstitutionLearnerSummary(actor.id, institutionId, { classId }));
}
