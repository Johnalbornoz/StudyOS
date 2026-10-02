/**
 * Track A -- EXPLICIT class <-> curriculum binding.
 *   GET  ?curriculumId=<id|empty>  candidates for the class (every ACTIVE curriculum of THIS institution,
 *                                   compatible ones first -- a suggestion, nothing is bound) and, when a
 *                                   target is given, the impact of binding it.
 *   POST { curriculumId | null, confirmImpact? }  binds (or explicitly removes) the curriculum. A different
 *                                   academic domain is refused (422 DOMAIN_MISMATCH); re-binding a class that
 *                                   already has a curriculum or a plan needs confirmImpact (409 otherwise).
 * Foreign class / curriculum -> 404. Learner history is never modified.
 */
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { governedError } from '@/lib/institution/route-errors';
import { db } from '@/lib/db';
import { assignClassCurriculum, classAcademicDomain, classBindingImpact, compatibleCurriculaForClass } from '@/lib/institution/curriculum-management.service';
import { curriculumContextLabel } from '@/lib/institution/curriculum-identity';

const Schema = z.strictObject({ curriculumId: z.string().uuid().nullable(), confirmImpact: z.boolean().optional() });

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const klass = (await db.query(`SELECT id, grade_id, institution_curriculum_id FROM classes WHERE id = $1 AND institution_id = $2`, [classId, id])).rows[0];
  if (!klass) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const target = new URL(request.url).searchParams.get('curriculumId');
  if (target && !allUuids(target)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const domain = await classAcademicDomain(classId);
    const candidates = await compatibleCurriculaForClass(id, klass.grade_id, domain);
    return NextResponse.json({
      success: true,
      data: {
        academicDomain: domain,
        currentCurriculumId: klass.institution_curriculum_id,
        candidates: candidates.map((c) => ({ curriculumId: c.curriculumId, label: curriculumContextLabel(c), academicDomain: c.academicDomain, compatible: c.compatible, compatibility: c.compatibility })),
        impact: target !== null ? await classBindingImpact(id, classId, target || null) : null,
      },
    });
  } catch (error) {
    return governedError(error);
  }
}

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await assignClassCurriculum({ institutionId: id, classId, curriculumId: parsed.data.curriculumId, confirmImpact: parsed.data.confirmImpact, actorUserId: guard.actor.id }) });
  } catch (error) {
    return governedError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/institutions/[id]/classes/[classId]/curriculum', handleGET);
export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes/[classId]/curriculum', handlePOST);
