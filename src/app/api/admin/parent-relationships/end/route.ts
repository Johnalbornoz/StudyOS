/**
 * L10 SF-7 (P1-9 admin half, CR-04) -- a platform administrator ends a
 * parent-learner relationship. Canonical admin guard (STUDYUS_ADMIN role +
 * allowlist + rate limit); the service writes the audit row. The parent's
 * access ends on the next request: every Parent guard reads the
 * relationship status on each call.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { endParentRelationshipByAdmin, ParentRelationshipNotFoundError } from '@/services/parent.service';

const Schema = z.object({
  parentId: z.string().uuid(),
  studentId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

async function handlePOST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.parent-relationships.end');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    await endParentRelationshipByAdmin(guard.admin.actor.id, validated.parentId, validated.studentId, validated.reason);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ParentRelationshipNotFoundError) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/admin/parent-relationships/end', handlePOST);
