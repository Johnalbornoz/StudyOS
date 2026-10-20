/**
 * L10 SF-4 / CR-L8-01 -- Teacher exam-gap visibility.
 *
 * Canonical rule (Orchestrator, 2026-10-11): a Teacher's view of exam data --
 * gaps, goals, AICE entries and assessment detail -- is scoped by BOTH
 *   - the authorized class / student   (who), and
 *   - the authorized academic subject  (what): the class's own canonical subject.
 * A Mathematics teacher must not receive a student's Reading gaps because the
 * same student happens to have them.
 *
 * This is the ONE entry point a Teacher surface uses to read exam gaps. It
 *   1. resolves the actor as a TEACHER of the class (`resolveTeacherClassScope`:
 *      never an institution admin -- a Coordinator cannot use the Teacher
 *      surface as a way into per-student gap data);
 *   2. limits the learners to that class's ACTIVE roster;
 *   3. asks the exam bridge for that class's canonical subject ONLY.
 *
 * The subject cut is made by the exam bridge (`examGapsFor`, L2,
 * `canonicalSubjectIds`): every aggregate -- domain, objective, concept, per
 * Student -- is built only from gap objectives with a PUBLISHED mapping to a
 * concept of the given subject. This file's part of the contract:
 *
 *   - the option is ALWAYS supplied on this path. `[subjectId]` when the class
 *     has a governed canonical subject, `[]` when it has none (a scope that
 *     matches nothing). It is never omitted: omitting it means "unscoped",
 *     which is reserved for the institution / internal callers;
 *   - what comes back is checked, not trusted (`scopeExamGapsToSubject`): the
 *     roster is re-applied, every concept is confirmed to belong to the
 *     subject, and if the bridge returned ANY concept outside it the whole
 *     answer is discarded -- the scope was not honoured, so none of the
 *     aggregates can be relied on. Fail closed, never partial.
 *
 * Still withheld: exam GOALS and AICE entries. Neither carries a governed
 * link to a canonical subject, so they cannot be sliced and are not returned
 * to a Teacher (see `TeacherClassExamGaps`).
 */
import { db } from '@/lib/db';
import { examGapsFor, type GapAggregate } from '@/lib/exam-core/exam-gaps.service';
import { resolveTeacherClassScope } from './index';

export class TeacherExamScopeDeniedError extends Error {
  constructor(classId: string) {
    super(`actor is not a teacher of class ${classId}`);
    this.name = 'TeacherExamScopeDeniedError';
  }
}

export interface SubjectScopedGapAggregate extends GapAggregate {
  subjectScope: {
    canonicalSubjectId: string | null;
    /** Domain and objective aggregates are cut to the subject by the exam bridge (CR-L8-01 closed). */
    objectiveAggregates: 'SUBJECT_SCOPED';
  };
}

const EMPTY = (canonicalSubjectId: string | null): SubjectScopedGapAggregate => ({
  studentsWithResults: 0,
  byDomain: [],
  byObjective: [],
  byConcept: [],
  perStudent: [],
  subjectScope: { canonicalSubjectId, objectiveAggregates: 'SUBJECT_SCOPED' },
});

/**
 * Verifies an aggregate the exam bridge produced FOR ONE SUBJECT and returns
 * it as the Teacher's view. It does not re-cut domain or objective rows (they
 * carry no subject); it decides whether the bridge's answer can be believed:
 *
 *   - no subject                    => nothing;
 *   - the subject lookup fails      => nothing;
 *   - any returned concept is NOT of the subject => nothing at all (the
 *     bridge did not honour the scope; its domain / objective rows are then
 *     unscoped too);
 *   - domain or objective rows without a single in-subject concept behind
 *     them => nothing (a scoped answer always has one).
 */
export async function scopeExamGapsToSubject(gaps: GapAggregate, canonicalSubjectId: string | null): Promise<SubjectScopedGapAggregate> {
  if (!canonicalSubjectId) return EMPTY(null);
  const conceptIds = [...new Set([...gaps.byConcept.map((c) => c.canonicalConceptId), ...gaps.perStudent.flatMap((p) => p.concepts.map((c) => c.canonicalConceptId))])];
  if (conceptIds.length === 0) return EMPTY(canonicalSubjectId);

  let inSubject: Set<string>;
  try {
    const r = await db.query(`SELECT id FROM canonical_concepts WHERE id = ANY($1::uuid[]) AND canonical_subject_id = $2`, [conceptIds, canonicalSubjectId]);
    inSubject = new Set((r.rows ?? []).map((row: { id: string }) => row.id));
  } catch (error) {
    console.error('[teacher-exam-scope] subject lookup failed', error instanceof Error ? error.message : error);
    return EMPTY(canonicalSubjectId);
  }
  if (conceptIds.some((id) => !inSubject.has(id))) {
    console.error('[teacher-exam-scope] the exam bridge returned a concept outside the requested subject; the answer is discarded');
    return EMPTY(canonicalSubjectId);
  }

  return {
    studentsWithResults: gaps.studentsWithResults,
    byDomain: gaps.byDomain,
    byObjective: gaps.byObjective,
    byConcept: gaps.byConcept,
    perStudent: gaps.perStudent,
    subjectScope: { canonicalSubjectId, objectiveAggregates: 'SUBJECT_SCOPED' },
  };
}

/** What a Teacher surface must NOT fetch for itself, and why it is absent from the scoped result. */
export type WithheldTeacherExamData = 'EXAM_GOALS' | 'AICE_ENTRIES';

export interface TeacherClassExamGaps {
  classId: string;
  canonicalSubjectId: string | null;
  /** The class's ACTIVE roster: the only learners the gaps below can mention. */
  studentIds: string[];
  gaps: SubjectScopedGapAggregate;
  /**
   * L10-R1 (D-1 final ruling): subject scoping covers exam GOALS and AICE
   * entries as well as gaps. A learner's exam goal (an exam or qualification
   * they prepare, with its date) and an AICE plan entry (a syllabus) carry no
   * governed link to a canonical subject today, and a multi-subject exam goal
   * cannot be sliced. So both are withheld from the Teacher surface (fail
   * closed): always empty here, and a Teacher route must not read them from
   * the exam bridge itself.
   */
  goals: { studentsPreparing: 0; byFramework: []; byObjective: []; perStudent: [] };
  aice: [];
  withheld: readonly WithheldTeacherExamData[];
}

const WITHHELD: readonly WithheldTeacherExamData[] = ['EXAM_GOALS', 'AICE_ENTRIES'];
const NO_GOALS = (): TeacherClassExamGaps['goals'] => ({ studentsPreparing: 0, byFramework: [], byObjective: [], perStudent: [] });

/**
 * Exam gaps of ONE class for ITS teacher, in the class's subject only.
 * Throws TeacherExamScopeDeniedError for anyone who does not teach the class
 * (another teacher, a Coordinator, a Parent, the Student).
 */
export async function getTeacherClassExamGaps(actorUserId: string, classId: string, opts: { family?: string | null } = {}): Promise<TeacherClassExamGaps> {
  const scope = await resolveTeacherClassScope(actorUserId, classId);
  if (!scope) throw new TeacherExamScopeDeniedError(classId);

  const roster = await db.query(`SELECT student_id FROM class_enrollments WHERE class_id = $1 AND status = 'ACTIVE'`, [classId]);
  const studentIds: string[] = (roster.rows ?? []).map((row: { student_id: string }) => row.student_id);
  const base = { classId, canonicalSubjectId: scope.canonicalSubjectId, studentIds, goals: NO_GOALS(), aice: [] as [], withheld: WITHHELD };
  if (studentIds.length === 0) return { ...base, gaps: EMPTY(scope.canonicalSubjectId) };

  // The subject scope is ALWAYS passed on the Teacher path -- `[]` for a class with no governed subject,
  // which the bridge answers with no gaps. Never `undefined`: that would be the unscoped (institution) call.
  const canonicalSubjectIds: string[] = scope.canonicalSubjectId ? [scope.canonicalSubjectId] : [];
  const raw = await examGapsFor(studentIds, { families: opts.family ? [opts.family] : undefined, includePerStudent: true, canonicalSubjectIds });

  // Defence in depth: the bridge is asked for the roster only; a learner outside it invalidates nothing
  // but is never passed on.
  const onRoster = new Set(studentIds);
  const offRoster = raw.perStudent.some((p) => !onRoster.has(p.studentId)) || raw.byConcept.some((c) => c.studentIds.some((id) => !onRoster.has(id)));
  if (offRoster) {
    console.error('[teacher-exam-scope] the exam bridge returned a learner outside the class roster; the answer is discarded');
    return { ...base, gaps: EMPTY(scope.canonicalSubjectId) };
  }
  return { ...base, gaps: await scopeExamGapsToSubject(raw, scope.canonicalSubjectId) };
}
