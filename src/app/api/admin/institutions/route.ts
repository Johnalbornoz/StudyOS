/**
 * F2 -- POST /api/admin/institutions
 *
 * The only path to create an Institution. Gated by `isAdminEmail`, the
 * same StudyUS-admin allowlist already used by the existing
 * `/api/admin/*` routes -- not a new admin mechanism.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { createInstitution } from '@/services/institution.service';

const Schema = z.object({ name: z.string().min(1).max(200) });

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

  const institution = await createInstitution(validated.name);
  return NextResponse.json({ success: true, data: { institution } });
}
