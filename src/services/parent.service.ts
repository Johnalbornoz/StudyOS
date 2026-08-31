/**
 * Parent access to a linked student's progress -- read-only, and only
 * for students who accepted the parent's link request. Linking is by
 * the student's account email, but it's a real invitation now: a new
 * link starts 'pending' and grants no access until the student accepts
 * it (verifyParentAccess only counts 'accepted' rows) -- previously a
 * parent could enter any student's email and see their data
 * immediately, with no consent step at all.
 *
 * Notifications for both sides go through the existing `notifications`
 * table directly (its student_id column is a FK to profiles(id), so it
 * already accepts a parent's profile row as a recipient too) rather
 * than through notifications.service.ts's sendNotification(), which
 * turned out to be dead code -- nothing in the app ever calls it, so
 * the whole in-app notification feed has silently never been populated.
 * That's a pre-existing gap worth fixing on its own; out of scope here.
 */

import { db } from '@/lib/db';
import { getStudentMastery } from './mastery.service';
import { getActiveDebts } from './learning-debt.service';
import { getUpcomingForStudent } from './assessment.service';
import { masteryToPercent, tryMasteryScore, averageMasteryScore } from '@/lib/mastery-format';

export type LinkStatus = 'pending' | 'accepted' | 'declined';

export interface LinkedChild {
  studentId: string;
  name: string;
  email: string;
  status: LinkStatus;
}

export interface PendingRequest {
  parentId: string;
  parentName: string;
  requestedAt: string;
}

async function notify(recipientProfileId: string, notificationType: string, title: string, message: string) {
  await db.query(
    `INSERT INTO notifications (id, student_id, notification_type, title, message, delivered_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
    [recipientProfileId, notificationType, title, message]
  );
}

export async function linkChildByEmail(
  parentId: string,
  childEmail: string
): Promise<LinkedChild> {
  const studentResult = await db.query(
    `SELECT id, name, email FROM students WHERE lower(email) = lower($1)`,
    [childEmail]
  );
  const student = studentResult.rows[0];
  if (!student) {
    throw new Error('NO_STUDENT_FOUND');
  }

  await db.query(
    `INSERT INTO parent_student_relationships (parent_id, student_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`,
    [parentId, student.id]
  );

  const parentRow = await db.query(`SELECT full_name FROM profiles WHERE id = $1`, [parentId]);
  const parentName = parentRow.rows[0]?.full_name || 'Someone';

  await notify(
    student.id,
    'PARENT_LINK_REQUEST',
    'Solicitud de acceso',
    `${parentName} quiere ver tu progreso en StudyUS. Puedes aceptar o rechazar en tus notificaciones.`
  );

  return { studentId: student.id, name: student.name || student.email, email: student.email, status: 'pending' };
}

export async function unlinkChild(parentId: string, studentId: string): Promise<void> {
  await db.query(
    `DELETE FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`,
    [parentId, studentId]
  );
}

export async function getLinkedChildren(parentId: string): Promise<LinkedChild[]> {
  const result = await db.query(
    `
    SELECT s.id, s.name, s.email, psr.status
    FROM parent_student_relationships psr
    JOIN students s ON s.id = psr.student_id
    WHERE psr.parent_id = $1 AND psr.status != 'declined'
    ORDER BY psr.created_at ASC
    `,
    [parentId]
  );
  return result.rows.map((r) => ({ studentId: r.id, name: r.name || r.email, email: r.email, status: r.status }));
}

export async function verifyParentAccess(parentId: string, studentId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2 AND status = 'accepted'`,
    [parentId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Pending link requests directed at a student, for them to accept/decline. */
export async function getPendingRequestsForStudent(studentId: string): Promise<PendingRequest[]> {
  const result = await db.query(
    `
    SELECT psr.parent_id, p.full_name, psr.created_at
    FROM parent_student_relationships psr
    JOIN profiles p ON p.id = psr.parent_id
    WHERE psr.student_id = $1 AND psr.status = 'pending'
    ORDER BY psr.created_at ASC
    `,
    [studentId]
  );
  return result.rows.map((r) => ({
    parentId: r.parent_id,
    parentName: r.full_name || 'Someone',
    requestedAt: r.created_at,
  }));
}

/** The student accepts or declines a parent's pending link request. */
export async function respondToRequest(
  studentId: string,
  parentId: string,
  accept: boolean
): Promise<void> {
  const status: LinkStatus = accept ? 'accepted' : 'declined';
  const result = await db.query(
    `
    UPDATE parent_student_relationships
    SET status = $1, responded_at = NOW()
    WHERE student_id = $2 AND parent_id = $3 AND status = 'pending'
    RETURNING parent_id
    `,
    [status, studentId, parentId]
  );
  if ((result.rowCount ?? 0) === 0) return;

  if (accept) {
    const studentRow = await db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]);
    const studentName = studentRow.rows[0]?.name || studentRow.rows[0]?.email || 'Your child';
    await notify(
      parentId,
      'PARENT_LINK_ACCEPTED',
      'Solicitud aceptada',
      `${studentName} aceptó tu solicitud. Ya puedes ver su progreso en Modo padre.`
    );
  }
}

export interface ChildSubjectSummary {
  subjectId: string;
  name: string;
  avgMastery: number | null;
  conceptCount: number;
  activeDebtCount: number;
}

export interface ChildOverview {
  studentId: string;
  name: string;
  subjects: ChildSubjectSummary[];
  totalActiveDebt: number;
  upcomingExams: Array<{
    subjectId: string;
    subjectName?: string;
    scheduledDate: string;
    daysUntil: number;
    examReadiness: number | null;
  }>;
}

export async function getChildOverview(
  studentId: string,
  preferredLanguage: string = 'en'
): Promise<ChildOverview> {
  const [subjectsResult, debts, upcoming] = await Promise.all([
    db.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY name`, [studentId]),
    getActiveDebts(studentId, undefined, preferredLanguage).catch(() => []),
    getUpcomingForStudent(studentId).catch(() => []),
  ]);

  const subjects: ChildSubjectSummary[] = await Promise.all(
    subjectsResult.rows.map(async (s: any) => {
      const records = await getStudentMastery(studentId, s.id, preferredLanguage).catch(() => []);
      // mastery_records.mastery_score is already 0-100 -- validate each
      // row against that domain (an out-of-range row is dropped and
      // logged, never silently reinterpreted), average the RAW values,
      // then round for display exactly once, here.
      const validScores = records.flatMap((r: any) => {
        const score = tryMasteryScore(r.mastery_score, `parent overview concept ${r.concept_id}`);
        return score !== null ? [score] : [];
      });
      const avgMastery = masteryToPercent(averageMasteryScore(validScores));
      const activeDebtCount = debts.filter((d: any) => d.subjectId === s.id).length;
      return { subjectId: s.id, name: s.name, avgMastery, conceptCount: records.length, activeDebtCount };
    })
  );

  const studentRow = await db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]);
  const name = studentRow.rows[0]?.name || studentRow.rows[0]?.email || '';

  return {
    studentId,
    name,
    subjects,
    totalActiveDebt: debts.length,
    upcomingExams: upcoming.map((o) => ({
      subjectId: o.subjectId,
      subjectName: o.subjectName,
      scheduledDate: o.scheduledDate,
      daysUntil: o.daysUntil,
      examReadiness: o.examReadiness,
    })),
  };
}
