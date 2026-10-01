/**
 * Track A -- PATCH /api/institutions/[id]/classes/[classId]
 * The Institution Admin links (or re-links) a class of THIS institution to
 * one ACTIVE catalog subject. A class of another institution is 404; an
 * unknown / inactive subject is 422. Teachers never reach this route (403).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setClassSubject } from '@/services/institution.service';
import { allUuids, requireInstitutionAdminActor, readJson } from '@/lib/institution/route-guard';

const Schema = z.object({ canonicalSubjectId: z.string().uuid() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: institutionId, classId } = await params;
  if (!allUuids(institutionId, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(institutionId, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;

  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  try {
    const updated = await setClassSubject(institutionId, classId, parsed.data.canonicalSubjectId);
    if (!updated) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'SUBJECT_NOT_AVAILABLE') return NextResponse.json({ error: 'SUBJECT_NOT_AVAILABLE' }, { status: 422 });
    throw error;
  }
}
