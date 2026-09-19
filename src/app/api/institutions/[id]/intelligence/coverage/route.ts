import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInstitutionCoverage } from '@/lib/institution-intelligence';
import { respondFromService } from '../_respond';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const url = new URL(request.url);
  const structureVersionId = url.searchParams.get('structureVersionId');
  if (!structureVersionId) return NextResponse.json({ error: 'INVALID_INPUT', message: 'structureVersionId is required' }, { status: 400 });

  return respondFromService(() => getInstitutionCoverage(actor.id, institutionId, { structureVersionId }));
}
