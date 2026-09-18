/**
 * F2 -- POST end a TeacherAssignment. The institution to authorize
 * against is resolved from the assignment's own membership (never
 * trusted from the client) -- an admin can only end an assignment
 * that actually belongs to their own institution.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessInstitution } from '@/lib/authorization';
import { db } from '@/lib/db';
import { endTeacherAssignment } from '@/services/institution.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: assignmentId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const owning = await db.query(
    `SELECT im.institution_id FROM teacher_assignments ta JOIN institution_memberships im ON im.id = ta.institution_membership_id WHERE ta.id = $1`,
    [assignmentId]
  );
  if (owning.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const allowed = await canAccessInstitution(actor.id, owning.rows[0].institution_id, 'TEACHER_ASSIGNMENT_MANAGE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const ended = await endTeacherAssignment(assignmentId);
  if (!ended) return NextResponse.json({ error: 'NOT_ACTIVE' }, { status: 409 });

  return NextResponse.json({ success: true });
}
