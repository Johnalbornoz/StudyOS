/**
 * Track A -- POST /api/institutions/[id]/coordinators/[membershipId]/reactivate
 * Reactivate a REMOVED coordinator of THIS institution (an account whose coordinator role was revoked by
 * StudyUs -> 422 ROLE_REVOKED). Audited; foreign -> 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { governedError } from '@/lib/institution/route-errors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { reactivateCoordinator } from '@/lib/institution/institution-operations.service';

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  const { id, membershipId } = await params;
  if (!allUuids(id, membershipId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  void request;
  try {
    return NextResponse.json({ success: true, data: await reactivateCoordinator(id, membershipId, guard.actor.id) });
  } catch (error) {
    return governedError(error);
  }
}

export const POST = withAiRequestMetrics('POST /api/institutions/[id]/coordinators/[membershipId]/reactivate', handlePOST);
