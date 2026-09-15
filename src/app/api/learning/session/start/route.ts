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
 * CANON-R5 Part 12 -- "the most important integration": when
 * `CANONICAL_ENGINE_V1_ENABLED` is on (Preview only), this endpoint
 * calls `getCanonicalPedagogicalDecision` FRESH for `actionConceptId`
 * instead of the legacy Phase 3C path, and enforces its `actionState`
 * server-side -- the client still supplies only `{studentId,
 * actionConceptId}`, never a mode/stage, so there is nothing here for a
 * client to override. A canonical read failure returns a controlled
 * error (Part 28) rather than silently falling back to Phase 3C.
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
import {
  isCanonicalEngineV1Enabled,
  getCanonicalPedagogicalDecision,
  CanonicalDecisionUnavailableError,
  resolveCanonicalLaunch,
  resolveConceptSubjectForStudent,
} from '@/lib/pedagogical-decision';

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

    if (isCanonicalEngineV1Enabled()) {
      const owned = await resolveConceptSubjectForStudent(validated.actionConceptId, validated.studentId);
      if (!owned) {
        return NextResponse.json(
          { error: 'NOT_FOUND', message: 'Concept does not belong to this student.' },
          { status: 404 }
        );
      }

      let decisionResult;
      try {
        decisionResult = await getCanonicalPedagogicalDecision({ studentId: validated.studentId, conceptId: validated.actionConceptId });
      } catch (error) {
        if (error instanceof CanonicalDecisionUnavailableError) {
          // Part 28 fail-safe: never fall back to the legacy Phase 3C
          // authority here -- a controlled error is the honest answer.
          console.error('Canonical decision unavailable for session start:', error, error.cause);
          return NextResponse.json(
            { error: 'CANONICAL_DECISION_UNAVAILABLE', message: 'The canonical pedagogical decision could not be computed.' },
            { status: 503 }
          );
        }
        throw error;
      }

      const session = resolveCanonicalLaunch({
        subjectId: owned.subjectId,
        conceptId: validated.actionConceptId,
        decision: decisionResult.decision,
      });
      return NextResponse.json({ success: true, data: { session, authority: 'CANONICAL_ENGINE_V1' } });
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
