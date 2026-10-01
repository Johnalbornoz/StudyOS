/**
 * Track A -- POST /api/student/class-invitations/[id]/respond { accept }
 * The Student consents to (or declines) a class enrollment. Only a PENDING
 * invitation addressed to the caller's own student identity can change;
 * any other id (another student's, an unknown one) is 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireStudentId } from '@/lib/auth';
import { db } from '@/lib/db';
import { respondToClassInvitation } from '@/services/institution.service';
import { allUuids } from '@/lib/institution/route-guard';
import { notifyUser } from '@/lib/notifications/role-notifications.service';

const Schema = z.object({ accept: z.boolean() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: enrollmentId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(clerkUserId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!allUuids(enrollmentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const result = await respondToClassInvitation(studentId, enrollmentId, parsed.data.accept);
  if (!result) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  if (result.invitedByUserId) {
    const student = await db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]);
    const studentName = student.rows[0]?.name || student.rows[0]?.email || '';
    await notifyUser({
      recipientUserId: result.invitedByUserId,
      workspace: 'INSTITUTION',
      type: parsed.data.accept ? 'CLASS_ENROLLMENT_ACCEPTED' : 'CLASS_ENROLLMENT_DECLINED',
      title: parsed.data.accept ? 'Invitación aceptada' : 'Invitación rechazada',
      message: parsed.data.accept ? `${studentName} se unió a ${result.className}.` : `${studentName} no aceptó unirse a ${result.className}.`,
      payload: { studentName, className: result.className },
      actionHref: `/dashboard/institution/${result.institutionId}/classes`,
    });
  }
  return NextResponse.json({ success: true, data: { status: parsed.data.accept ? 'ACTIVE' : 'DECLINED' } });
}
