/**
 * F7 -- POST /api/admin/assessment/exam-versions/transition
 *
 * Publishes a DRAFT exam version, atomically superseding whatever was
 * previously PUBLISHED for the same exam definition.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { publishExamVersion } from '@/lib/assessment/exam-definition.service';

const Schema = z.object({ examVersionId: z.string().uuid(), action: z.literal('PUBLISH') });

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

  try {
    const examVersion = await publishExamVersion(validated.examVersionId);
    return NextResponse.json({ success: true, data: { examVersion } });
  } catch (err: any) {
    return NextResponse.json({ error: 'INVALID_TRANSITION', message: err.message }, { status: 409 });
  }
}
