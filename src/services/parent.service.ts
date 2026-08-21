/**
 * Parent access to a linked student's progress -- read-only, and only
 * for students a parent has actually been linked to via
 * parent_student_relationships. Linking today is by the student's
 * account email (the student must already exist); nothing here lets a
 * parent modify the student's data, only view it.
 */

import { db } from '@/lib/db';
import { getStudentMastery } from './mastery.service';
import { getActiveDebts } from './learning-debt.service';
import { getUpcomingForStudent } from './assessment.service';

export interface LinkedChild {
  studentId: string;
  name: string;
  email: string;
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
    `INSERT INTO parent_student_relationships (parent_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [parentId, student.id]
  );

  return { studentId: student.id, name: student.name || student.email, email: student.email };
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
    SELECT s.id, s.name, s.email
    FROM parent_student_relationships psr
    JOIN students s ON s.id = psr.student_id
    WHERE psr.parent_id = $1
    ORDER BY psr.created_at ASC
    `,
    [parentId]
  );
  return result.rows.map((r) => ({ studentId: r.id, name: r.name || r.email, email: r.email }));
}

export async function verifyParentAccess(parentId: string, studentId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2`,
    [parentId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
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
    db.query(`SELECT id, name FROM subjects WHERE student_id = $1 ORDER BY name`, [studentId]),
    getActiveDebts(studentId, undefined, preferredLanguage).catch(() => []),
    getUpcomingForStudent(studentId).catch(() => []),
  ]);

  const subjects: ChildSubjectSummary[] = await Promise.all(
    subjectsResult.rows.map(async (s: any) => {
      const records = await getStudentMastery(studentId, s.id, preferredLanguage).catch(() => []);
      const avgMastery = records.length
        ? Math.round(
            records.reduce((sum: number, r: any) => sum + Number(r.mastery_score), 0) / records.length
          )
        : null;
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
