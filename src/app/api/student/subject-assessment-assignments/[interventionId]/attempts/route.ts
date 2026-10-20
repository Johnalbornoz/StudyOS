/**
 * Overnight 2026-10-16 -- POST /api/student/subject-assessment-assignments/[interventionId]/attempts
 * Start the next attempt of a teacher-assigned subject Test / Mock, or resume the active one (never a second attempt
 * in parallel, never an extra attempt consumed by a resume). Owner ONLY (isOwner, inside the service) -- never
 * Teacher, never Parent. Starting needs the Student's learning licence; resuming an attempt already open does not.
 * Returns { outcome STARTED | RESUMED, quizId, attemptNumber, subjectId, quizMode } for the subject assessment runner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { ownStudentId } from '@/lib/exam-core/route-auth';
import { learningLicenceRequiredUnlessOpenAttemptForActor } from '@/lib/entitlements/learning-gate';
import { allUuids } from '@/lib/institution/route-guard';
import { db } from '@/lib/db';
import { startSubjectAssignmentAttempt, SubjectAssignmentError } from '@/lib/teacher/subject-assessment-assignment.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ interventionId: string }> }) {
  const { interventionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(interventionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const learnerId = await ownStudentId(actor.id);
  if (!learnerId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  // an attempt already open is only resumed (nothing generated): no licence needed for it
  const open = await db.query(
    `SELECT 1 FROM quiz_sessions WHERE student_id = $1 AND subject_assessment_setup->>'assignmentId' = $2 AND status = 'active' LIMIT 1`,
    [learnerId, interventionId]
  );
  const licenceRequired = await learningLicenceRequiredUnlessOpenAttemptForActor(actor.id, learnerId, open.rows.length > 0);
  if (licenceRequired) return licenceRequired;
  try {
    return NextResponse.json({ success: true, data: await startSubjectAssignmentAttempt(actor.id, interventionId) });
  } catch (error) {
    if (error instanceof SubjectAssignmentError) return NextResponse.json({ error: error.code, ...(error.code === 'GENERATION_INSUFFICIENT' ? { retryable: true } : {}) }, { status: error.status });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/student/subject-assessment-assignments/[interventionId]/attempts', handlePOST);
