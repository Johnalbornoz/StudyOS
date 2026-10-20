/**
 * Track A -- /api/institutions/[id]/grades/[gradeId]
 * PATCH: edit a grade of THIS institution (foreign -> 404). DELETE: only a grade nothing depends on
 * (no class ever, no curriculum, no teacher scope) -- otherwise 409 GRADE_HAS_DEPENDENCIES (archive it).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { updateGrade, deleteGrade } from '@/lib/institution/institution-operations.service';

const PatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  academicLevel: z.string().trim().max(120).nullable().optional(),
  programmeLabel: z.string().trim().max(120).nullable().optional(),
  academicProgrammeId: z.string().uuid().nullable().optional(),
  academicYear: z.string().trim().max(20).nullable().optional(),
});

async function handlePATCH(request: NextRequest, { params }: { params: Promise<{ id: string; gradeId: string }> }) {
  const { id, gradeId } = await params;
  if (!allUuids(id, gradeId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    const parsed = PatchSchema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await updateGrade(id, gradeId, parsed.data, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}
async function handleDELETE(request: NextRequest, { params }: { params: Promise<{ id: string; gradeId: string }> }) {
  const { id, gradeId } = await params;
  if (!allUuids(id, gradeId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    return NextResponse.json({ success: true, data: await deleteGrade(id, gradeId, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const PATCH = withAiRequestMetrics('PATCH /api/institutions/[id]/grades/[gradeId]', handlePATCH);
export const DELETE = withAiRequestMetrics('DELETE /api/institutions/[id]/grades/[gradeId]', handleDELETE);
