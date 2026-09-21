/**
 * Onboarding/authorization rework (2026-09-21) -- GET the minimal
 * public list of ACTIVE institutions (id + name only), so a Teacher
 * can select their institution during self-service membership request.
 * Requires authentication (not a fully public/anonymous endpoint) but
 * no particular role -- any authenticated caller may browse this list,
 * since choosing an institution to request membership at is exactly
 * the point of it.
 */
import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { listActiveInstitutions } from '@/services/institution.service';

export async function GET() {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const institutions = await listActiveInstitutions();
  return NextResponse.json({ success: true, data: { institutions } });
}
