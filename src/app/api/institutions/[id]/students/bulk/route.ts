/**
 * L9 IN-1 -- POST /api/institutions/[id]/students/bulk { classId, emails[] }
 * "Añadir estudiantes" from a list: the single add (`addStudentToClass`) once per address, for
 * existing accounts only. Answers 200 with one outcome per address (enrolled, invited, already
 * there, no account, previously declined / ended, not an email); nothing is created for an unknown
 * address and a closed enrollment is never re-opened. Coordinator of THIS institution only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { bulkAddStudentsToClass } from '@/lib/institution/institution-operations.service';
import { BULK_EMAIL_LIMIT } from '@/lib/institution/email-list';

const Schema = z.strictObject({ classId: z.string().uuid(), emails: z.array(z.string().max(320)).min(1).max(BULK_EMAIL_LIMIT) });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  try {
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await bulkAddStudentsToClass(id, parsed.data.classId, parsed.data.emails, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/institutions/[id]/students/bulk', handlePOST);
