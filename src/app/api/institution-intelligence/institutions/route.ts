import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getAccessibleInstitutionIntelligenceInstitutions } from '@/lib/institution-intelligence/service';
export async function GET() {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error:'UNAUTHORIZED' }, { status:401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  return NextResponse.json({ success:true, data:{ institutions: await getAccessibleInstitutionIntelligenceInstitutions(actor.id) } });
}
