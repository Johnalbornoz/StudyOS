/**
 * Track A -- POST /api/institutions/[id]/classes/[classId]/teacher { membershipId | null }
 * The class's teacher, changed atomically (current class-scoped assignment ended, new one created).
 * Only an APPROVED teacher of THIS institution (another institution's teacher -> 404). Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { setClassTeacher } from '@/lib/institution/institution-operations.service';

const Schema = z.strictObject({ membershipId: z.string().uuid().nullable() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await setClassTeacher(id, classId, parsed.data.membershipId, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes/[classId]/teacher', handlePOST);
