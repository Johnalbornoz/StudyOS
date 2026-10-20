/**
 * Track A -- /api/institutions/[id]/teachers
 * GET: every teacher relation of THIS institution with its state (Invitado / Pendiente / Aprobado / Suspendido / ...)
 * and active class scopes. POST { email }: invite an EXISTING teacher account (INVITED until accepted; a pending
 * request from that teacher is approved). No account -> 422 NO_TEACHER_ACCOUNT. Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { listTeachers, inviteTeacher } from '@/lib/institution/institution-operations.service';

const Schema = z.strictObject({ email: z.string().trim().email().max(320) });

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    return NextResponse.json({ success: true, data: { teachers: await listTeachers(id) } });
  } catch (error) {
    return governedError(error);
  }
}
async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await inviteTeacher(id, parsed.data.email, guard.actor.id) }, { status: 201 });
  } catch (error) {
    return governedError(error);
  }
}

export const GET = withAiRequestMetrics('GET /api/institutions/[id]/teachers', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/teachers', handlePOST);
