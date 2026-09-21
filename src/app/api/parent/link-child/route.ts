import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateParentId } from '@/lib/auth';
import { unlinkChild } from '@/services/parent.service';
import { z } from 'zod';

const UnlinkSchema = z.object({ studentId: z.string().uuid() });

/**
 * Onboarding/authorization rework (2026-09-21): the parent-initiated
 * direction (a Parent searching for/linking to a student by email,
 * `linkChildByEmail`) is retired. The only way a parent-student link
 * can now begin is the student inviting the parent's email
 * (`/api/student/parent-invitations`) and the parent accepting from
 * their own verified email (`/api/parent/invitations/[id]/respond`) --
 * a Parent must never be able to browse or unilaterally link to a
 * student. `linkChildByEmail` itself is left in `parent.service.ts`,
 * unused, rather than deleted -- it documents the prior model's own
 * consent step for anyone auditing history; nothing calls it anymore.
 * No POST export here means a POST to this route now correctly 405s.
 */
export async function DELETE(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parentId = await getOrCreateParentId(clerkUserId);
  const body = await request.json();

  let validated;
  try {
    validated = UnlinkSchema.parse(body);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', message: error.errors?.[0]?.message },
      { status: 400 }
    );
  }

  await unlinkChild(parentId, validated.studentId);
  return NextResponse.json({ success: true });
}
