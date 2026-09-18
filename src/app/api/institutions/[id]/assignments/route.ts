/**
 * F2 / §9 -- POST create a TeacherAssignment (the scope that actually
 * grants a teacher access). Gated by canAccessInstitution
 * (TEACHER_ASSIGNMENT_MANAGE). `institutionMembershipId` must belong
 * to THIS institution and already be an APPROVED TEACHER membership --
 * validated here (institution match) and inside
 * createTeacherAssignment itself (approved-teacher match, throws
 * MEMBERSHIP_NOT_APPROVED otherwise -- never creates a dangling scope
 * for a membership that isn't real yet).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessInstitution } from '@/lib/authorization';
import { db } from '@/lib/db';
import { createTeacherAssignment } from '@/services/institution.service';

const Schema = z.object({
  institutionMembershipId: z.string().uuid(),
  gradeId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  subjectLabel: z.string().min(1).max(100).nullable().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const allowed = await canAccessInstitution(actor.id, institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const belongs = await db.query(
    `SELECT 1 FROM institution_memberships WHERE id = $1 AND institution_id = $2`,
    [validated.institutionMembershipId, institutionId]
  );
  if (belongs.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  try {
    const assignment = await createTeacherAssignment(validated.institutionMembershipId, validated);
    return NextResponse.json({ success: true, data: { assignment } });
  } catch (error: any) {
    if (error.message === 'MEMBERSHIP_NOT_APPROVED') {
      return NextResponse.json({ error: 'MEMBERSHIP_NOT_APPROVED' }, { status: 409 });
    }
    throw error;
  }
}
