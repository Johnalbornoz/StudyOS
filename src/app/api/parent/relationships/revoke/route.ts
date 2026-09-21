/**
 * F2 / §7 -- POST /api/parent/relationships/revoke
 *
 * The LEARNER'S OWN side of revocation: a student revokes an ACTIVE
 * ('accepted') parent/guardian/coach relationship. `studentId` is
 * always the caller's own resolved identity (`requireStudentId`, which
 * 403s rather than provisioning a Student for a non-Student account)
 * -- there is no studentId field
 * in the request body to manipulate, so a caller can never revoke a
 * relationship belonging to a different student. Soft-revoke only
 * (parent.service.ts::revokeRelationshipByStudent) -- never deletes
 * the relationship row or anything about the learner's own history.
 */
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentId } from '@/lib/auth';
import { revokeRelationshipByStudent } from '@/services/parent.service';
import { z } from 'zod';

const Schema = z.object({ parentId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const revoked = await revokeRelationshipByStudent(studentId, validated.parentId);
  if (!revoked) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
