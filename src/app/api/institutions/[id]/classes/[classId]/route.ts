/**
 * Track A -- PATCH /api/institutions/[id]/classes/[classId]
 * Edit a class of THIS institution: name, grade (an ACTIVE grade of this institution), academic area,
 * period, catalog subject. The curriculum is changed only through .../curriculum (explicit, with impact)
 * and the teacher through .../teacher. Foreign class / grade -> 404; archived class -> 409; unknown
 * subject -> 422. Teachers never reach this route (403). Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { updateClassV2 } from '@/lib/institution/institution-operations.service';

const Schema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  gradeId: z.string().uuid().optional(),
  academicDomainCode: z.string().regex(/^[A-Z][A-Z_]{1,39}$/).nullable().optional(),
  period: z.string().trim().max(40).nullable().optional(),
  canonicalSubjectId: z.string().uuid().optional(),
});

async function handlePATCH(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: institutionId, classId } = await params;
  if (!allUuids(institutionId, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await updateClassV2(institutionId, classId, parsed.data, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const PATCH = withAiRequestMetrics('PATCH /api/institutions/[id]/classes/[classId]', handlePATCH);
