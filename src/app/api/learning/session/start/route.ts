/**
 * POST /api/learning/session/start
 *
 * Phase 3D -- Session Engine. Resolves ONE Phase 3C decision (selected
 * by the concept the client is choosing to act on, from a next-action/
 * daily-plan response it already has) into a launch target using the
 * existing quiz/remediation/transfer flows. Never selects a different
 * intervention than the one Phase 3C already decided.
 *
 * The decision is re-derived from a fresh getLearningDecisions() call
 * by actionConceptId rather than accepting a client-serialized
 * LearningDecision -- this keeps the server, not the client, as the
 * source of truth for what the decision actually is, and stays
 * consistent with the closed-loop principle that priority is always
 * recomputed fresh, never trusted stale from the client.
 *
 * Request body:
 *   { studentId: string (uuid), actionConceptId: string (uuid) }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';
import { startLearningSession } from '@/services/learning-session-engine.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';

const StartSessionSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  actionConceptId: z.string().uuid('Invalid actionConceptId'),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    let validated: z.infer<typeof StartSessionSchema>;
    try {
      validated = StartSessionSchema.parse(body);
    } catch (error: any) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message || 'Invalid request body' }, { status: 400 });
    }

    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'You do not have permission to start a session for this student' }, { status: 403 });
    }

    const preferredLanguage = await getInterfaceLanguage(validated.studentId);
    const decisions = await getLearningDecisions(validated.studentId, preferredLanguage);
    const decision = decisions.find((d) => d.actionConceptId === validated.actionConceptId);
    if (!decision) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'No current Phase 3C decision exists for this concept -- it may already be resolved.' },
        { status: 404 }
      );
    }

    const session = await startLearningSession({ studentId: validated.studentId, learningDecision: decision });
    return NextResponse.json({ success: true, data: { session } });
  } catch (error) {
    console.error('Error starting learning session:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to start learning session', details: process.env.NODE_ENV === 'development' ? String(error) : undefined },
      { status: 500 }
    );
  }
}
