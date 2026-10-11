/**
 * L9 IN-1 -- POST /api/institutions/[id]/teachers/bulk { emails[] }
 * Invite a list of EXISTING teacher accounts: the single invitation (`inviteTeacher`) once per
 * address, only where there is no relation yet. Answers 200 with one outcome per address; an
 * existing relation (pending, rejected, revoked, suspended) is reported and left as it is.
 * Coordinator of THIS institution only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { bulkInviteTeachers } from '@/lib/institution/institution-operations.service';
import { BULK_EMAIL_LIMIT } from '@/lib/institution/email-list';

const Schema = z.strictObject({ emails: z.array(z.string().max(320)).min(1).max(BULK_EMAIL_LIMIT) });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  try {
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ success: true, data: await bulkInviteTeachers(id, parsed.data.emails, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/institutions/[id]/teachers/bulk', handlePOST);
