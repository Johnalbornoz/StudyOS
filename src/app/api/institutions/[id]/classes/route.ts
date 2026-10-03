/**
 * Track A -- /api/institutions/[id]/classes
 * GET: the institution admin's class list (grade, area, curriculum, staff, enrollment counts, status).
 * POST: create a class in THIS institution: name, grade (REQUIRED, an ACTIVE grade of this institution),
 * academic area, an EXPLICITLY chosen curriculum (compatible: same area, usable for the grade; never
 * inferred), period, teacher (an APPROVED teacher of this institution). Validated before anything is
 * written; foreign grade / curriculum / teacher -> 404; duplicate active name in the grade -> 409.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listInstitutionClassesWithStaff } from '@/services/institution.service';
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { createClassV2 } from '@/lib/institution/institution-operations.service';

const Schema = z.object({
  name: z.string().trim().min(1).max(80),
  gradeId: z.string().uuid().nullable().optional(),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
  /** An ACTIVE curriculum subject of THIS institution, chosen EXPLICITLY (never inferred). */
  institutionCurriculumId: z.string().uuid().nullable().optional(),
  /** Canonical academic domain ("Área académica"), e.g. MATHEMATICS -- separate from the name and the curriculum. */
  academicDomainCode: z.string().regex(/^[A-Z][A-Z_]{1,39}$/).nullable().optional(),
  period: z.string().trim().max(40).nullable().optional(),
  teacherMembershipId: z.string().uuid().nullable().optional(),
});

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  return NextResponse.json({ success: true, data: { classes: await listInstitutionClassesWithStaff(institutionId) } });
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const created = await createClassV2(institutionId, { ...parsed.data, gradeId: parsed.data.gradeId ?? '' }, guard.actor.id);
    return NextResponse.json({ success: true, data: { class: created } }, { status: 201 });
  } catch (error) {
    return governedError(error);
  }
}

export const GET = withAiRequestMetrics('GET /api/institutions/[id]/classes', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes', handlePOST);
