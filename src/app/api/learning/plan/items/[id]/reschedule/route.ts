/**
 * Phase 8 -- Step 8F1: learner reschedule of one plan item.
 *
 * POST only. The server validates the target date (inside the horizon,
 * not in the past, no key collision). On success the 8B projector
 * SUPERSEDES the old item and ADDS a new one on the chosen day with
 * `source = MANUAL_RESCHEDULE`; the original canonical `reasonCode` is
 * preserved. No GET handler -- a read never mutates a plan.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { rescheduleLearningPlanItem } from '@/services/learning-plan-agency.service';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const BAD_REQUEST = new Set(['DATE_INVALID', 'DATE_IN_PAST', 'DATE_OUT_OF_HORIZON', 'DATE_CONFLICT']);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'INVALID_INPUT', message: 'bad item id' }, { status: 400 });

    const { studentId, date } = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const todayIso = new Date().toISOString().slice(0, 10);
    const result = await rescheduleLearningPlanItem(studentId, id, date, todayIso);
    if (!result.ok) {
      const status = result.error === 'ITEM_NOT_FOUND' ? 404 : BAD_REQUEST.has(result.error) ? 400 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true, data: { outcome: result.outcome, newDate: result.newDate, diff: result.diff } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'rescheduleLearningPlanItem',
      error,
      context: { route: 'POST /api/learning/plan/items/:id/reschedule' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
