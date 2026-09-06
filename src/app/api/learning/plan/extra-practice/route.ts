/**
 * Phase 8 -- Step 8F1: learner-requested extra practice.
 *
 * POST only. Adds ONE PRACTICE item for an eligible concept with
 * `reasonCode = LEARNER_REQUESTED` -- the lowest goal tier, so it never
 * outranks an integrity obligation. Requires an ACTIVE plan (the page
 * offers a rebuild otherwise). No GET handler.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { requestExtraPractice } from '@/services/learning-plan-agency.service';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid(), conceptId: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { studentId, conceptId } = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const todayIso = new Date().toISOString().slice(0, 10);
    const result = await requestExtraPractice(studentId, conceptId, todayIso);
    if (!result.ok) {
      const status = result.error === 'CONCEPT_NOT_ELIGIBLE' ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      success: true,
      data: { outcome: result.outcome, diff: result.outcome === 'ADDED' ? result.diff : null },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'requestExtraPractice',
      error,
      context: { route: 'POST /api/learning/plan/extra-practice' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
