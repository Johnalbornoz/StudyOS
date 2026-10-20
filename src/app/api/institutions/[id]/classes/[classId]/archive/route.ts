/**
 * Track A -- POST /api/institutions/[id]/classes/[classId]/archive: archive (enrollments, plan, assignments and learner history are kept). Audited; foreign class -> 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { archiveClass } from '@/lib/institution/institution-operations.service';

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  if (!allUuids(id, classId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    return NextResponse.json({ success: true, data: await archiveClass(id, classId, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/institutions/[id]/classes/[classId]/archive', handlePOST);
