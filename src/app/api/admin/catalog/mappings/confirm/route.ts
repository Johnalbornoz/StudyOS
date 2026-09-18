/**
 * F4 -- POST /api/admin/catalog/mappings/confirm
 *
 * The one write action in the F4 admin surface: a human reviewer confirms
 * which canonical concept an AMBIGUOUS/PROPOSED mapping actually
 * corresponds to. Never automatic -- always records who confirmed it
 * (task 7's "reviewed/confirmed" state).
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { confirmMapping } from '@/lib/catalog/mapping.service';

const Schema = z.object({ mappingId: z.string().uuid(), canonicalConceptId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const reviewer = await getOrCreateCanonicalUser(userId, email);
  await confirmMapping(validated.mappingId, validated.canonicalConceptId, reviewer.id);

  return NextResponse.json({ success: true });
}
