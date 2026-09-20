/**
 * F13 -- GET /api/institutions/mine
 *
 * List of institutions the authenticated actor holds an APPROVED
 * INSTITUTION_ADMIN membership for. Mirrors the exact shape/precedent
 * of GET /api/teacher/classes (F11-A) -- zero-length array is a valid,
 * first-class result; no institutionId is ever accepted as input, the
 * list is derived entirely from the actor's own resolved identity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getAdministeredInstitutions } from '@/services/institution.service';

export async function GET(_request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const institutions = await getAdministeredInstitutions(actor.id);
  return NextResponse.json({ success: true, data: { institutions } });
}
