/**
 * Track A -- /api/institutions/[id]/classes/[classId]/enrollments
 * GET: roster (ACTIVE + PENDING) of a class of THIS institution.
 * POST { email }: invite a Student to the class. Consent-based: the
 * enrollment is PENDING (grants nothing) until the Student accepts.
 * A class id from another institution is 404 (never acted on).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getClassInInstitution, listClassRosterForInstitution } from '@/services/institution.service';
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';
import { inviteToClassAndNotify } from '@/lib/institution/class-invitations';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.object({ email: z.string().trim().email().max(320) });

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: institutionId, classId } = await params;
  if (!allUuids(institutionId, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  if (!(await getClassInInstitution(institutionId, classId))) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: { roster: await listClassRosterForInstitution(institutionId, classId) } });
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: institutionId, classId } = await params;
  if (!allUuids(institutionId, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;

  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const klass = await getClassInInstitution(institutionId, classId);
  if (!klass) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const result = await inviteToClassAndNotify(institutionId, klass, parsed.data.email, guard.actor.id);
  if (result.outcome === 'NO_STUDENT_ACCOUNT') return NextResponse.json({ error: 'NO_STUDENT_ACCOUNT' }, { status: 404 });
  return NextResponse.json({ success: true, data: { outcome: result.outcome } }, { status: result.outcome === 'INVITED' ? 201 : 200 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/classes/[classId]/enrollments', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes/[classId]/enrollments', handlePOST);
