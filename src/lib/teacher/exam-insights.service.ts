/**
 * L8 (TE-2) -- exam insights of ONE class, for its Teacher only.
 *
 * Everything about exam data comes from the shared Teacher entry point,
 * `getTeacherClassExamGaps` (L10, src/lib/authorization/teacher-exam-scope):
 * it admits only a Teacher of the class (never an institution admin), limits
 * the learners to the class's ACTIVE roster and asks the exam bridge for the
 * class's own subject only, so every aggregate it returns -- by area, by
 * objective, by topic, per Student -- is already subject-scoped (CR-L8-01).
 * This file never reads the exam bridge, exam goals or AICE plans itself;
 * what the entry point still withholds (goals, AICE entries: no governed
 * subject mapping) stays withheld and is passed on as such.
 *
 * Added here: the class context for the page and the roster's names.
 */
import { getTeacherClassExamGaps, TeacherExamScopeDeniedError, type TeacherClassExamGaps } from '@/lib/authorization/teacher-exam-scope';
import { getTeacherClass, type TeacherClassContext } from './class-assignment.service';
import { getTeacherClassRoster, type TeacherRosterStudent } from './read-model.service';

export class TeacherExamInsightsAccessDeniedError extends Error {
  constructor(classId: string) {
    super(`actor is not a teacher of class ${classId}`);
    this.name = 'TeacherExamInsightsAccessDeniedError';
  }
}

export interface TeacherClassExamInsights {
  klass: TeacherClassContext;
  students: TeacherRosterStudent[];
  gaps: TeacherClassExamGaps['gaps'];
  goals: TeacherClassExamGaps['goals'];
  aice: TeacherClassExamGaps['aice'];
  withheld: TeacherClassExamGaps['withheld'];
}

export async function getTeacherClassExamInsights(actorUserId: string, classId: string, opts: { family?: string | null } = {}): Promise<TeacherClassExamInsights> {
  const klass = await getTeacherClass(actorUserId, classId);
  if (!klass) throw new TeacherExamInsightsAccessDeniedError(classId);
  let scoped: TeacherClassExamGaps;
  try {
    scoped = await getTeacherClassExamGaps(actorUserId, classId, { family: opts.family });
  } catch (error) {
    if (error instanceof TeacherExamScopeDeniedError) throw new TeacherExamInsightsAccessDeniedError(classId);
    throw error;
  }
  let roster: TeacherRosterStudent[];
  try {
    roster = await getTeacherClassRoster(actorUserId, classId);
  } catch {
    throw new TeacherExamInsightsAccessDeniedError(classId);
  }
  // Names only for the learners the scoped result is about.
  const scopedIds = new Set(scoped.studentIds);
  const students = roster.filter((s) => scopedIds.has(s.studentId));
  return { klass, students, gaps: scoped.gaps, goals: scoped.goals, aice: scoped.aice, withheld: scoped.withheld };
}

export interface StudentExamInsightRow {
  studentId: string;
  name: string;
  /** Gap concepts inside the class subject; 0 when none is recorded. */
  gaps: number;
  concepts: Array<{ canonicalConceptId: string; name: string }>;
}

/**
 * Pure: one row per roster Student, most gaps first. A Student that is not
 * on the roster never produces a row, whatever the aggregate contains.
 */
export function examInsightsByStudent(data: Pick<TeacherClassExamInsights, 'students' | 'gaps'>): StudentExamInsightRow[] {
  const gapsOf = new Map(data.gaps.perStudent.map((p) => [p.studentId, p]));
  return data.students
    .map((s) => ({
      studentId: s.studentId,
      name: s.name,
      // The page labels this number "topics": it is the count of in-subject gap concepts. (The aggregate's own
      // `gaps` counts in-subject gap OBJECTIVES; several objectives can share one topic.)
      gaps: (gapsOf.get(s.studentId)?.concepts ?? []).length,
      concepts: (gapsOf.get(s.studentId)?.concepts ?? []).map((c) => ({ canonicalConceptId: c.canonicalConceptId, name: c.name })),
    }))
    .sort((a, b) => b.gaps - a.gaps || a.name.localeCompare(b.name));
}
