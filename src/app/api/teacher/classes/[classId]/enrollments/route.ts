/**
 * Track A -- /api/teacher/classes/[classId]/enrollments
 * GET: the class roster (ACTIVE + PENDING invitations) for its Teacher.
 * POST { email }: the Teacher invites a Student to THIS class. Only a class
 * the actor TEACHES (approved membership + active scope); anyone else
 * (pending teacher, another class's teacher, institution admin acting as
 * teacher) gets 403 and nothing is written. Consent-based: PENDING grants
 * nothing until the Student accepts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import { getTeacherClass, type TeacherClassContext } from '@/lib/teacher/class-assignment.service';
import { listClassRosterForInstitution } from '@/services/institution.service';
import { inviteToClassAndNotify } from '@/lib/institution/class-invitations';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.object({ email: z.string().trim().email().max(320) });

async function teacherClassFor(classId: string): Promise<{ response: NextResponse } | { actor: { id: string }; klass: TeacherClassContext }> {
  const authContext = await verifyAuth();
  if (!authContext) return { response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  if (!allUuids(classId)) return { response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) return { response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  return { actor, klass };
}

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const ctx = await teacherClassFor(classId);
  if ('response' in ctx) return ctx.response;
  return NextResponse.json({ success: true, data: { roster: await listClassRosterForInstitution(ctx.klass.institutionId, classId) } });
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const ctx = await teacherClassFor(classId);
  if ('response' in ctx) return ctx.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const result = await inviteToClassAndNotify(ctx.klass.institutionId, ctx.klass, parsed.data.email, ctx.actor.id);
  if (result.outcome === 'NO_STUDENT_ACCOUNT') return NextResponse.json({ error: 'NO_STUDENT_ACCOUNT' }, { status: 404 });
  return NextResponse.json({ success: true, data: { outcome: result.outcome } }, { status: result.outcome === 'INVITED' ? 201 : 200 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/enrollments', handleGET);
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/enrollments', handlePOST);
