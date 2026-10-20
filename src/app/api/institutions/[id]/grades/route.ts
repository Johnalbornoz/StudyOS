/**
 * Track A -- /api/institutions/[id]/grades (coordinator of THIS institution)
 * GET: grades (active by default; ?includeArchived=1 adds archived) with class / student / curriculum counts.
 * POST: create a grade: name, academic level, programme (catalog id or label), academic year. Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { listGrades, createGradeV2 } from '@/lib/institution/institution-operations.service';

const GradeSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  academicLevel: z.string().trim().max(120).nullable().optional(),
  programmeLabel: z.string().trim().max(120).nullable().optional(),
  academicProgrammeId: z.string().uuid().nullable().optional(),
  academicYear: z.string().trim().max(20).nullable().optional(),
});

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    return NextResponse.json({ success: true, data: { grades: await listGrades(id, { includeArchived: new URL(request.url).searchParams.get('includeArchived') === '1' }) } });
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
    const parsed = GradeSchema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: { grade: await createGradeV2(id, parsed.data, guard.actor.id) } }, { status: 201 });
  } catch (error) {
    return governedError(error);
  }
}

export const GET = withAiRequestMetrics('GET /api/institutions/[id]/grades', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/grades', handlePOST);
