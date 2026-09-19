import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInstitutionIntelligenceOverview, InstitutionIntelligenceAccessDeniedError, InstitutionIntelligenceInputError } from '@/lib/institution-intelligence/service';

export async function GET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const institutionId = request.nextUrl.searchParams.get('institutionId');
  if (!institutionId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  try {
    return NextResponse.json({ success: true, data: await getInstitutionIntelligenceOverview(actor.id, institutionId) });
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (error instanceof InstitutionIntelligenceInputError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    throw error;
  }
}
