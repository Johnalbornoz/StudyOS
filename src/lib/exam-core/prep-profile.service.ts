/**
 * Exam Prep -- "Quitar de mi preparación" and "Empezar de nuevo" on the
 * Student's own exam preparation profile (student_exam_profiles).
 *
 * Remove = ARCHIVE the profile, nothing else is deleted:
 *   - not-started exam instances (DRAFT / READY) are deleted by their own rules;
 *   - an in-progress simulation is cancelled (ABANDONED, hidden from the
 *     history) -- only with the extra in-progress confirmation;
 *   - completed attempts keep their results, responses, scoring audit and
 *     learning evidence; learner state and learned concepts are untouched.
 *
 * Restart = the same cleanup, then -- in ONE transaction -- archive the old
 * profile and create a new, clean ACTIVE one for the same exam (same version
 * or objective, and the Student's own plan fields: exam date, purpose, target institution),
 * linked by replaced_by_profile_id. A repeated restart returns that same new
 * profile. "Fresh exam preparation ≠ erase learning history".
 *
 * Owner-scoped (another Student's profile is NOT_FOUND) and idempotent.
 */
import { db } from '@/lib/db';
import { createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { deleteExamInstance } from './exam-instance.service';
import { deleteAttemptFromHistory } from './history.service';

export class ExamProfileError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'CONFIRMATION_REQUIRED' | 'IN_PROGRESS_CONFIRMATION_REQUIRED', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ExamProfileError';
  }
}

export interface ProfileOpenWork {
  /** ACTIVE / PAUSED simulations (with or without an exam instance). */
  inProgressAttemptIds: string[];
  /** Exam instances created but not started (DRAFT / READY). */
  notStartedInstanceIds: string[];
  completedAttempts: number;
}

export interface ArchiveOutcome {
  status: 'ARCHIVED';
  profileId: string;
  alreadyArchived: boolean;
  cancelledAttempts: number;
  removedNotStarted: number;
  completedKept: number;
  replacedByProfileId: string | null;
}

async function ownedProfile(profileId: string, ownerStudentId: string) {
  const r = await db.query(`SELECT * FROM student_exam_profiles WHERE id = $1`, [profileId]);
  const p = r.rows[0];
  // Another Student's profile does not exist for this caller (no existence leak).
  if (!p || p.student_id !== ownerStudentId) throw new ExamProfileError('NOT_FOUND');
  return p;
}

export async function getProfileOpenWork(profileId: string): Promise<ProfileOpenWork> {
  const [open, notStarted, completed] = await Promise.all([
    db.query(`SELECT id FROM simulation_attempts WHERE exam_profile_id = $1 AND status IN ('ACTIVE','PAUSED') ORDER BY created_at`, [profileId]),
    db.query(`SELECT id FROM exam_instances WHERE exam_profile_id = $1 AND status IN ('DRAFT','READY') ORDER BY created_at`, [profileId]),
    db.query(`SELECT count(*)::int AS n FROM simulation_attempts WHERE exam_profile_id = $1 AND status = 'COMPLETED'`, [profileId]),
  ]);
  return { inProgressAttemptIds: open.rows.map((x: any) => x.id), notStartedInstanceIds: notStarted.rows.map((x: any) => x.id), completedAttempts: completed.rows[0].n };
}

/** Cancels what cannot outlive the preparation. Throws before touching anything when a confirmation is missing. */
async function closeOpenWork(profileId: string, ownerStudentId: string, opts: { confirm: boolean; confirmInProgress: boolean }, reason: string) {
  if (!opts.confirm) throw new ExamProfileError('CONFIRMATION_REQUIRED');
  const work = await getProfileOpenWork(profileId);
  if (work.inProgressAttemptIds.length > 0 && !opts.confirmInProgress) throw new ExamProfileError('IN_PROGRESS_CONFIRMATION_REQUIRED', String(work.inProgressAttemptIds.length));
  for (const id of work.notStartedInstanceIds) await deleteExamInstance(id, { confirm: true, ownerStudentId, reason });
  for (const id of work.inProgressAttemptIds) await deleteAttemptFromHistory(id, { confirm: true, ownerStudentId, reason });
  return work;
}

export async function archiveExamProfile(profileId: string, params: { ownerStudentId: string; confirm: boolean; confirmInProgress?: boolean }): Promise<ArchiveOutcome> {
  const p = await ownedProfile(profileId, params.ownerStudentId);
  if (p.status === 'ARCHIVED') {
    return { status: 'ARCHIVED', profileId, alreadyArchived: true, cancelledAttempts: 0, removedNotStarted: 0, completedKept: (await getProfileOpenWork(profileId)).completedAttempts, replacedByProfileId: p.replaced_by_profile_id ?? null };
  }
  const work = await closeOpenWork(profileId, params.ownerStudentId, { confirm: params.confirm, confirmInProgress: !!params.confirmInProgress }, 'PREPARATION_REMOVED');
  await db.query(
    `UPDATE student_exam_profiles SET status = 'ARCHIVED', archived_at = now(), archive_reason = 'STUDENT_REMOVED', updated_at = now() WHERE id = $1 AND status <> 'ARCHIVED'`,
    [profileId]
  );
  console.log('[exam-core]', JSON.stringify({ at: 'exam_profile_archived', profileId, cancelledAttempts: work.inProgressAttemptIds.length, removedNotStarted: work.notStartedInstanceIds.length, completedKept: work.completedAttempts }));
  return { status: 'ARCHIVED', profileId, alreadyArchived: false, cancelledAttempts: work.inProgressAttemptIds.length, removedNotStarted: work.notStartedInstanceIds.length, completedKept: work.completedAttempts, replacedByProfileId: null };
}

export async function restartExamProfile(profileId: string, params: { ownerStudentId: string; confirm: boolean; confirmInProgress?: boolean }): Promise<{ newProfileId: string; alreadyRestarted: boolean; archived: ArchiveOutcome }> {
  const p = await ownedProfile(profileId, params.ownerStudentId);
  // Double submit: the first restart already produced the new preparation.
  if (p.status === 'ARCHIVED' && p.replaced_by_profile_id) {
    return { newProfileId: p.replaced_by_profile_id, alreadyRestarted: true, archived: { status: 'ARCHIVED', profileId, alreadyArchived: true, cancelledAttempts: 0, removedNotStarted: 0, completedKept: (await getProfileOpenWork(profileId)).completedAttempts, replacedByProfileId: p.replaced_by_profile_id } };
  }
  const work = p.status === 'ARCHIVED'
    ? { inProgressAttemptIds: [], notStartedInstanceIds: [], completedAttempts: (await getProfileOpenWork(profileId)).completedAttempts }
    : await closeOpenWork(profileId, params.ownerStudentId, { confirm: params.confirm, confirmInProgress: !!params.confirmInProgress }, 'PREPARATION_RESTARTED');

  const client = await db.connect();
  let newProfileId: string;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE student_exam_profiles SET status = 'ARCHIVED', archived_at = COALESCE(archived_at, now()), archive_reason = COALESCE(archive_reason, 'STUDENT_RESTARTED'), updated_at = now() WHERE id = $1`,
      [profileId]
    );
    const created = await createStudentExamProfile(
      {
        studentId: p.student_id,
        examDefinitionId: p.exam_definition_id,
        examVersionId: p.exam_version_id ?? undefined,
        purpose: p.purpose ?? undefined,
        programmeContext: p.programme_context ?? undefined,
        subjectFocus: p.subject_focus ?? undefined,
        examDate: p.exam_date ? (p.exam_date instanceof Date ? p.exam_date.toISOString().slice(0, 10) : String(p.exam_date)) : undefined,
        timezone: p.timezone ?? undefined,
        institutionTargetId: p.institution_target_id ?? undefined,
        // Objective first: the same objective and the Student's own goal details.
        objectiveKey: p.objective_key ?? undefined,
        objectiveFramework: p.objective_framework ?? undefined,
        objectiveNodeId: p.objective_node_id ?? null,
        objectiveContext: p.objective_context ?? undefined,
        targetInstitutionName: p.target_institution_name ?? undefined,
        targetQualification: p.target_qualification ?? undefined,
        source: p.source ?? undefined,
      },
      client
    );
    newProfileId = created.id;
    await client.query(`UPDATE student_exam_profiles SET replaced_by_profile_id = $2 WHERE id = $1`, [profileId, newProfileId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  console.log('[exam-core]', JSON.stringify({ at: 'exam_profile_restarted', profileId, newProfileId, cancelledAttempts: work.inProgressAttemptIds.length, completedKept: work.completedAttempts }));
  return {
    newProfileId,
    alreadyRestarted: false,
    archived: { status: 'ARCHIVED', profileId, alreadyArchived: p.status === 'ARCHIVED', cancelledAttempts: work.inProgressAttemptIds.length, removedNotStarted: work.notStartedInstanceIds.length, completedKept: work.completedAttempts, replacedByProfileId: newProfileId },
  };
}
