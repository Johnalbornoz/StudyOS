/**
 * Track A -- POST /api/institutions/[id]/grades/[gradeId]/reactivate: reactivate an archived grade. Audited; foreign grade -> 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { reactivateGrade } from '@/lib/institution/institution-operations.service';

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; gradeId: string }> }) {
  const { id, gradeId } = await params;
  if (!allUuids(id, gradeId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    return NextResponse.json({ success: true, data: await reactivateGrade(id, gradeId, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/institutions/[id]/grades/[gradeId]/reactivate', handlePOST);
