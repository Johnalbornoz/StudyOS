/**
 * Track B / B1 -- POST /api/admin/assessment/attempt-results/invalidate
 *
 * Integrity process: stamps a SCORED attempt result as INVALIDATED (with a
 * reason). Never deletes, never re-scores, never touches cognition -- the
 * result simply stops counting as exam history. StudyUs admin only.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { invalidateAttemptResult } from '@/lib/exam-core/results.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({ examAttemptId: z.string().uuid(), reason: z.string().min(3).max(500) });

async function handlePOST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const result = await invalidateAttemptResult(parsed.data.examAttemptId, parsed.data.reason);
  if (!result) return NextResponse.json({ error: 'NOT_FOUND_OR_NOT_SCORED' }, { status: 404 });
  return NextResponse.json({ success: true, data: { result } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/admin/assessment/attempt-results/invalidate', handlePOST);
