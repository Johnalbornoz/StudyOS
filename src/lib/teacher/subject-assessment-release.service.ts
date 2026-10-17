/**
 * Teacher-assigned subject Test / Mock -- the feedback release decision (operator rule AB), computed at READ time from
 * the items actually served to the assignment's students.
 *
 * "Truly diverse" = no item fingerprint (exact-novelty fingerprint, lx/exact-duplicate-novelty) was served to two
 * DIFFERENT students of the same assignment group (a student's own repeat across their attempts is not a shared
 * version). Diverse -> full feedback immediately; otherwise score and general performance now, the per-question
 * review held until the window closes. Read-only; reads no answers.
 */
import { db } from '@/lib/db';
import { fingerprintQuestion } from '@/lib/lx/exact-duplicate-novelty';
import { crossStudentSharedFingerprints, feedbackReleaseFor, type FeedbackRelease } from './subject-assessment-assignment.rules';

/** Every attempt of every recipient of the group that `interventionId` belongs to: who was served which items. */
export async function loadGroupServedItems(interventionId: string): Promise<Array<{ studentId: string; interventionId: string; quizId: string; createdAt: string; fingerprints: string[] }>> {
  const r = await db.query(
    `SELECT qs.id, qs.student_id, qs.created_at, qs.questions, ti.id AS intervention_id
       FROM teacher_interventions me
       JOIN teacher_interventions ti ON ti.assignment_group_id = me.assignment_group_id
       JOIN quiz_sessions qs ON qs.subject_assessment_setup->>'assignmentId' = ti.id::text AND qs.student_id = ti.student_id
      WHERE me.id = $1 AND me.assignment_group_id IS NOT NULL`,
    [interventionId],
  );
  return r.rows.map((row: any) => ({
    studentId: row.student_id,
    interventionId: row.intervention_id,
    quizId: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    fingerprints: ((row.questions ?? []) as any[]).filter((q) => q && typeof q.question === 'string').map((q) => fingerprintQuestion(q)),
  }));
}

export async function resolveAssignmentFeedbackRelease(interventionId: string, closesAt: string, now: Date): Promise<FeedbackRelease & { sharedItemCount: number }> {
  const served = await loadGroupServedItems(interventionId);
  const shared = crossStudentSharedFingerprints(served);
  return { ...feedbackReleaseFor({ sharedItemCount: shared.size, closesAt, now }), sharedItemCount: shared.size };
}
