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
 *   3. cuts what comes back to the class's canonical subject.
 *
 * How the subject cut works, and its limit. The exam bridge
 * (`examGapsFor`, src/lib/exam-core -- not modified here) returns aggregates
 * for every exam the learners have a scored attempt in, with no subject
 * option. Only the CONCEPT level carries a subject (`canonical_concepts
 * .canonical_subject_id`), so the cut is made there and it FAILS CLOSED:
 *   - byConcept / perStudent.concepts : kept only when the canonical concept
 *     belongs to the class's subject;
 *   - perStudent.gaps                 : the number of in-subject gap concepts
 *     (the bridge's own number counts gap objectives of every subject, which
 *     would itself disclose out-of-subject gaps);
 *   - byDomain / byObjective          : WITHHELD (empty). Their rows cannot be
 *     attributed to a subject from the aggregate, and an unattributable row is
 *     not shown. `subjectScope.objectiveAggregates` says so explicitly;
 *   - a class with no linked subject  : nothing.
 * Restoring exact domain / objective aggregates per subject needs the cut
 * inside the bridge's query (a `canonicalSubjectIds` option on `examGapsFor`).
 * That is exam-core logic and is requested from its owner (CR-L10-01 to L2 in
 * the L10 report); when it exists, only this file changes.
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
    /** WITHHELD: domain and objective aggregates cannot be attributed to one subject yet (see module comment). */
    objectiveAggregates: 'WITHHELD';
  };
}

const EMPTY = (canonicalSubjectId: string | null): SubjectScopedGapAggregate => ({
  studentsWithResults: 0,
  byDomain: [],
  byObjective: [],
  byConcept: [],
  perStudent: [],
  subjectScope: { canonicalSubjectId, objectiveAggregates: 'WITHHELD' },
});

/**
 * Cuts a gap aggregate down to ONE canonical subject. Fails closed: a concept
 * whose subject cannot be confirmed is dropped, and a lookup failure yields
 * the empty aggregate.
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

  const perStudent = gaps.perStudent
    .map((p) => {
      const concepts = p.concepts.filter((c) => inSubject.has(c.canonicalConceptId));
      return { studentId: p.studentId, gaps: concepts.length, concepts };
    })
    .filter((p) => p.concepts.length > 0);
  const visibleStudents = new Set(perStudent.map((p) => p.studentId));
  const byConcept = gaps.byConcept
    .filter((c) => inSubject.has(c.canonicalConceptId))
    .map((c) => {
      const studentIds = c.studentIds.filter((id) => visibleStudents.has(id));
      return { ...c, studentIds, students: studentIds.length };
    })
    .filter((c) => c.students > 0)
    .sort((a, b) => b.students - a.students);

  return {
    studentsWithResults: visibleStudents.size,
    byDomain: [],
    byObjective: [],
    byConcept,
    perStudent,
    subjectScope: { canonicalSubjectId, objectiveAggregates: 'WITHHELD' },
  };
}

/** What a Teacher surface must NOT fetch for itself, and why it is absent from the scoped result. */
export type WithheldTeacherExamData = 'DOMAIN_AGGREGATES' | 'OBJECTIVE_AGGREGATES' | 'EXAM_GOALS' | 'AICE_ENTRIES';

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
   * the exam bridge itself. Returning them needs a subject attribution in the
   * exam core (CR-L10-01 to L2).
   */
  goals: { studentsPreparing: 0; byFramework: []; byObjective: []; perStudent: [] };
  aice: [];
  withheld: readonly WithheldTeacherExamData[];
}

const WITHHELD: readonly WithheldTeacherExamData[] = ['DOMAIN_AGGREGATES', 'OBJECTIVE_AGGREGATES', 'EXAM_GOALS', 'AICE_ENTRIES'];
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
  if (!scope.canonicalSubjectId || studentIds.length === 0) {
    return { classId, canonicalSubjectId: scope.canonicalSubjectId, studentIds, gaps: EMPTY(scope.canonicalSubjectId), goals: NO_GOALS(), aice: [], withheld: WITHHELD };
  }
  const raw = await examGapsFor(studentIds, { families: opts.family ? [opts.family] : undefined, includePerStudent: true });
  // Defence in depth: the bridge is asked for the roster only; anything else it might return is dropped anyway.
  const onRoster = new Set(studentIds);
  const rosterOnly: GapAggregate = {
    ...raw,
    byConcept: raw.byConcept.map((c) => ({ ...c, studentIds: c.studentIds.filter((id) => onRoster.has(id)) })),
    perStudent: raw.perStudent.filter((p) => onRoster.has(p.studentId)),
  };
  return { classId, canonicalSubjectId: scope.canonicalSubjectId, studentIds, gaps: await scopeExamGapsToSubject(rosterOnly, scope.canonicalSubjectId), goals: NO_GOALS(), aice: [], withheld: WITHHELD };
}
