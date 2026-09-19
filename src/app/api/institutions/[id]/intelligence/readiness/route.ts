import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInstitutionReadiness } from '@/lib/institution-intelligence';
import { respondFromService } from '../_respond';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const url = new URL(request.url);
  const examVersionId = url.searchParams.get('examVersionId');
  const classId = url.searchParams.get('classId') ?? undefined;
  if (!examVersionId) return NextResponse.json({ error: 'INVALID_INPUT', message: 'examVersionId is required' }, { status: 400 });

  return respondFromService(() => getInstitutionReadiness(actor.id, institutionId, { examVersionId, classId }));
}
