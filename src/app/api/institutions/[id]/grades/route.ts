/**
 * Track A -- POST /api/institutions/[id]/grades
 * Institution admin creates a grade in THEIR institution (product decision:
 * the Institution Admin owns the institutional structure).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createGrade, listInstitutionGrades } from '@/services/institution.service';
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';

const Schema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  return NextResponse.json({ success: true, data: { grades: await listInstitutionGrades(institutionId) } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;

  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const grade = await createGrade(institutionId, parsed.data.name);
  return NextResponse.json({ success: true, data: { grade } }, { status: 201 });
}
