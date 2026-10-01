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
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';

const Schema = z.object({
  name: z.string().trim().min(1).max(80),
  gradeId: z.string().uuid().nullable().optional(),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
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
    const created = await createClass(institutionId, parsed.data.gradeId ?? null, parsed.data.name, parsed.data.canonicalSubjectId ?? null);
    return NextResponse.json({ success: true, data: { class: created } }, { status: 201 });
  } catch (error: any) {
    if (error?.message === 'SCOPE_OUTSIDE_INSTITUTION') return NextResponse.json({ error: 'SCOPE_OUTSIDE_INSTITUTION' }, { status: 422 });
    if (error?.message === 'SUBJECT_NOT_AVAILABLE') return NextResponse.json({ error: 'SUBJECT_NOT_AVAILABLE' }, { status: 422 });
    throw error;
  }
}
