/**
 * Track A -- /api/institutions/[id]/classes
 * GET: the institution admin's class list (grade, staff, enrollment counts).
 * POST: create a class in THIS institution, optionally under one of ITS
 * grades (a grade from another institution is refused, 422), optionally
 * linked to one ACTIVE catalog subject (otherwise 422 SUBJECT_NOT_AVAILABLE).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClass, listInstitutionClassesWithStaff } from '@/services/institution.service';
import { compatibleCurriculaForClass, assignClassCurriculum } from '@/lib/institution/curriculum-management.service';
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';
import { db } from '@/lib/db';

const Schema = z.object({
  name: z.string().trim().min(1).max(80),
  gradeId: z.string().uuid().nullable().optional(),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
  /** Track A Curriculum V2: an ACTIVE curriculum subject of THIS institution, chosen EXPLICITLY (never inferred). */
  institutionCurriculumId: z.string().uuid().nullable().optional(),
  /** Canonical academic domain ("Área académica"), e.g. MATHEMATICS -- separate from the name and the curriculum. */
  academicDomainCode: z.string().regex(/^[A-Z][A-Z_]{1,39}$/).nullable().optional(),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  return NextResponse.json({ success: true, data: { classes: await listInstitutionClassesWithStaff(institutionId) } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;

  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  try {
    let subjectId = parsed.data.canonicalSubjectId ?? null;
    const domain = parsed.data.academicDomainCode ?? null;
    if (domain && !(await db.query(`SELECT 1 FROM canonical_academic_domains WHERE code = $1 AND status = 'ACTIVE'`, [domain])).rows[0]) {
      return NextResponse.json({ error: 'DOMAIN_NOT_AVAILABLE' }, { status: 422 });
    }
    if (parsed.data.institutionCurriculumId) {
      // validate BEFORE creating anything: a foreign / archived / other-domain / other-grade curriculum creates no class
      const candidates = await compatibleCurriculaForClass(institutionId, parsed.data.gradeId ?? null, domain);
      const curriculum = candidates.find((c) => c.curriculumId === parsed.data.institutionCurriculumId);
      if (!curriculum) return NextResponse.json({ error: 'CURRICULUM_NOT_AVAILABLE' }, { status: 404 });
      if (!curriculum.compatible) return NextResponse.json({ error: curriculum.compatibility === 'OTHER_DOMAIN' ? 'DOMAIN_MISMATCH' : 'CURRICULUM_NOT_AVAILABLE' }, { status: 422 });
      subjectId = curriculum.canonicalSubjectId;
    }
    const created = await createClass(institutionId, parsed.data.gradeId ?? null, parsed.data.name, subjectId);
    if (domain) await db.query(`UPDATE classes SET academic_domain_code = $2 WHERE id = $1`, [created.id, domain]);
    if (parsed.data.institutionCurriculumId) {
      await assignClassCurriculum({ institutionId, classId: created.id, curriculumId: parsed.data.institutionCurriculumId, actorUserId: guard.actor.id });
    }
    return NextResponse.json({ success: true, data: { class: created } }, { status: 201 });
  } catch (error: any) {
    if (error?.message === 'SCOPE_OUTSIDE_INSTITUTION') return NextResponse.json({ error: 'SCOPE_OUTSIDE_INSTITUTION' }, { status: 422 });
    if (error?.message === 'SUBJECT_NOT_AVAILABLE') return NextResponse.json({ error: 'SUBJECT_NOT_AVAILABLE' }, { status: 422 });
    throw error;
  }
}
