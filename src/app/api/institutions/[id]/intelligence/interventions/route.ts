import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInstitutionInterventionSummary, type InterventionType } from '@/lib/institution-intelligence';
import { respondFromService } from '../_respond';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const url = new URL(request.url);
  const classId = url.searchParams.get('classId') ?? undefined;
  const interventionType = (url.searchParams.get('interventionType') as InterventionType | null) ?? undefined;
  const sinceDays = url.searchParams.get('sinceDays') ? Number(url.searchParams.get('sinceDays')) : undefined;

  return respondFromService(() => getInstitutionInterventionSummary(actor.id, institutionId, { classId, interventionType, sinceDays }));
}
