/**
 * Phase 8 -- Step 8F1: the READ-ONLY learner plan view.
 *
 * GET only. Returns the "Tu plan" render model from the 8B read
 * boundary -- it NEVER creates, rolls, reconciles, or mutates a plan
 * (8A0 invariant). When the learner has no ACTIVE plan it returns
 * `hasPlan: false` and the page offers an explicit rebuild.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getLearnerPlanView } from '@/services/learning-plan-view.service';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid() });

export async function GET(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const parsed = Schema.safeParse({ studentId: request.nextUrl.searchParams.get('studentId') });
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

    const { studentId } = parsed.data;
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const locale = await getInterfaceLanguage(studentId);
    const todayIso = new Date().toISOString().slice(0, 10);
    const view = await getLearnerPlanView(studentId, todayIso, locale);

    return NextResponse.json({ success: true, data: view });
  } catch (error: any) {
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'getLearnerPlanView',
      error,
      context: { route: 'GET /api/learning/plan' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
