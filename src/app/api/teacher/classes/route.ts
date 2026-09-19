/**
 * F11-A -- GET /api/teacher/classes
 *
 * List of classes the authenticated actor has an ACTIVE Teacher
 * assignment for. Zero-length array is a valid, first-class result --
 * no studentId/classId is ever accepted as input here, the list is
 * derived entirely from the actor's own resolved identity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getTeacherAssignedClasses } from '@/lib/teacher/read-model.service';

export async function GET(_request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const classes = await getTeacherAssignedClasses(actor.id);
  return NextResponse.json({ success: true, data: { classes } });
}
