/**
 * Track A -- /api/institutions/[id]/classes/[classId]/enrollments
 * GET: roster (ACTIVE + PENDING) of a class of THIS institution.
 * POST { email }: invite a Student to the class. Consent-based: the
 * enrollment is PENDING (grants nothing) until the Student accepts.
 * A class id from another institution is 404 (never acted on).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getClassInInstitution, inviteStudentToClass, listClassRosterForInstitution, getInstitutionById } from '@/services/institution.service';
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';
import { notifyUser } from '@/lib/notifications/role-notifications.service';

const Schema = z.object({ email: z.string().trim().email().max(320) });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: institutionId, classId } = await params;
  if (!allUuids(institutionId, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  if (!(await getClassInInstitution(institutionId, classId))) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: { roster: await listClassRosterForInstitution(institutionId, classId) } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: institutionId, classId } = await params;
  if (!allUuids(institutionId, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;

  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const klass = await getClassInInstitution(institutionId, classId);
  if (!klass) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const result = await inviteStudentToClass(institutionId, classId, parsed.data.email, guard.actor.id);
  if (result.outcome === 'NO_STUDENT_ACCOUNT') return NextResponse.json({ error: 'NO_STUDENT_ACCOUNT' }, { status: 404 });
  if (result.outcome === 'INVITED') {
    const institution = await getInstitutionById(institutionId);
    await notifyUser({
      recipientUserId: result.studentUserId,
      workspace: 'STUDENT',
      type: 'CLASS_ENROLLMENT_INVITE',
      title: 'Invitación a una clase',
      message: `${institution?.name ?? ''} te invitó a la clase ${klass.name}. Acepta o rechaza en tus notificaciones.`,
      payload: { institutionName: institution?.name ?? '', className: klass.name },
      actionHref: '/dashboard/notifications',
    });
  }
  return NextResponse.json({ success: true, data: { outcome: result.outcome } }, { status: result.outcome === 'INVITED' ? 201 : 200 });
}
