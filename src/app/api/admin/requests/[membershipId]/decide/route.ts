import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { decideMembership } from '@/services/institution.service';
import { onTeacherMembershipDecided } from '@/lib/institution/membership-events';

const Schema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ membershipId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.requests.decide');
  if ('error' in guard) return guard.error;

  const { membershipId } = await params;
  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const decided = await decideMembership(membershipId, guard.admin.actor.id, validated.decision);
  if (!decided) return NextResponse.json({ error: 'NOT_PENDING' }, { status: 409 });

  // Track A: audits the REAL decision (a rejection used to be logged as
  // MEMBERSHIP_APPROVED) and notifies the teacher.
  await onTeacherMembershipDecided(membershipId, guard.admin.actor.id, validated.decision);
  return NextResponse.json({ success: true });
}
