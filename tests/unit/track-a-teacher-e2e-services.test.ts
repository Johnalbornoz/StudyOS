/**
 * Track A -- Teacher E2E readiness, service level: class ↔ subject, the
 * assignment lifecycle (title, start, recipients, subject-scoped topics,
 * 0 writes on any invalid request), start-date gating, the Teacher learner
 * view (scoped, read-only) and the pure "who needs help" derivation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: vi.fn() } }));

const canAccessClassMock = vi.fn();
const canTeacherManageInterventionMock = vi.fn();
const canTeacherAccessLearnerMock = vi.fn();
const isOwnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({
  canAccessClass: (...a: any[]) => canAccessClassMock(...a),
  canTeacherManageIntervention: (...a: any[]) => canTeacherManageInterventionMock(...a),
  canTeacherAccessLearner: (...a: any[]) => canTeacherAccessLearnerMock(...a),
  isOwner: (...a: any[]) => isOwnerMock(...a),
}));
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({ getStudentExamProfile: vi.fn(async () => null) }));
vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: vi.fn(async () => 'n1') }));
vi.mock('@/lib/identity/display-identity', () => ({ resolveDisplayIdentities: vi.fn(async () => new Map()) }));
const resolveConceptMock = vi.fn();
vi.mock('@/lib/readiness/student-concept-resolution.service', () => ({
  resolveStudentConceptForCanonicalConcept: (...a: any[]) => resolveConceptMock(...a),
}));
const decisionMock = vi.fn();
vi.mock('@/lib/pedagogical-decision/canonical-decision.service', () => ({ getCanonicalPedagogicalDecision: (...a: any[]) => decisionMock(...a) }));
vi.mock('@/services/learner-model.service', () => ({
  getConceptEvidenceSummary: vi.fn(async () => ({ totalAttempts: 3, correctAttempts: 2, soloAttempts: 1, soloCorrect: 1, lastEvidenceDate: '2026-10-01T10:00:00Z' })),
  getConceptEvidenceHistory: vi.fn(async () => []),
}));
vi.mock('@/services/memory-read.service', () => ({ getTwinMemorySignal: vi.fn(async () => null) }));
vi.mock('@/services/transfer-read.service', () => ({ getConceptTransferDepth: vi.fn(async () => null) }));
vi.mock('@/services/misconception.service', () => ({ getMisconceptionCountsForConcept: vi.fn(async () => ({ activeCount: 1, criticalCount: 0, recurringCount: 0, resolvedCount: 0 })) }));
vi.mock('@/services/cognitive-diagnosis.service', () => ({ getActiveDiagnoses: vi.fn(async () => []) }));

import { createClass, setClassSubject } from '@/services/institution.service';
import {
  publishClassAssignment,
  listAssignableConceptsForClass,
  InvalidClassAssignmentError,
  TeacherClassAccessDeniedError,
} from '@/lib/teacher/class-assignment.service';
import { getTeacherLearnerView, deriveTeacherAttention, TeacherLearnerAccessDeniedError, type LearnerConceptState } from '@/lib/teacher/learner-view.service';
import { startTeacherInterventionExecution, StudentInterventionNotStartableError } from '@/lib/student/teacher-intervention-execution.service';

type Responder = (sql: string, params: unknown[]) => { rows: any[]; rowCount?: number } | undefined;
const respond = (fn: Responder) => dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => fn(sql, params) ?? { rows: [], rowCount: 0 });
const sqls = () => dbQueryMock.mock.calls.map((c) => String(c[0]));
const inserts = () => sqls().filter((s) => s.includes('INSERT INTO teacher_interventions'));

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  canAccessClassMock.mockReset().mockResolvedValue(true);
  canTeacherManageInterventionMock.mockReset().mockResolvedValue(true);
  canTeacherAccessLearnerMock.mockReset().mockResolvedValue(true);
  isOwnerMock.mockReset().mockResolvedValue(true);
  resolveConceptMock.mockReset().mockResolvedValue('own-concept');
  decisionMock.mockReset().mockResolvedValue({ decision: { stage: 'PRACTICE', actionState: 'EXECUTABLE', nextCanonicalAction: 'PRACTICE', intervention: 'REINFORCE', nextEligibleAt: null, lastQualifyingProveAt: null, practiceProgress: { passesInWindow: 1, requiredPasses: 3 } } });
});

describe('Class ↔ canonical subject (TEACHER_CLASS_MODEL)', () => {
  it('a class can only be linked to an ACTIVE catalog subject (nothing inserted otherwise)', async () => {
    respond(() => ({ rows: [] }));
    await expect(createClass('inst-A', null, 'Matemáticas 3A', 'unknown-subject')).rejects.toThrow('SUBJECT_NOT_AVAILABLE');
    expect(sqls().some((s) => s.includes('INSERT INTO classes'))).toBe(false);
  });

  it('createClass stores the subject in the same tenant-guarded INSERT', async () => {
    respond((sql) => {
      if (sql.includes('FROM canonical_subjects')) return { rows: [{ '?': 1 }] };
      if (sql.includes('INSERT INTO classes')) return { rows: [{ id: 'c1', name: 'Matemáticas 3A' }] };
      return undefined;
    });
    await createClass('inst-A', 'grade-A', 'Matemáticas 3A', 'subj-math');
    const insert = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO classes'))!;
    expect(String(insert[0])).toMatch(/g\.institution_id = \$1::uuid/);
    expect(insert[1]).toEqual(['inst-A', 'grade-A', 'Matemáticas 3A', 'subj-math']);
  });

  it('linking a subject is scoped to the institution: a foreign class id changes nothing', async () => {
    respond((sql) => (sql.includes('FROM canonical_subjects') ? { rows: [{ '?': 1 }] } : { rows: [], rowCount: 0 }));
    expect(await setClassSubject('inst-A', 'class-of-B', 'subj-math')).toBe(false);
    expect(sqls().find((s) => s.startsWith('UPDATE classes'))).toMatch(/WHERE id = \$1 AND institution_id = \$2/);
  });
});

const teacherOfClass: Responder = (sql) => {
  if (sql.includes('FROM (') && sql.includes('WHERE t.id = $2')) return { rows: [{ '?': 1 }] };
  return undefined;
};
const learners = [
  { id: 's1', name: 'Sofía', email: 's@x', user_id: 'u1' },
  { id: 's2', name: 'Samuel', email: 'b@x', user_id: 'u2' },
];
const publishWorld = (subject: string | null, conceptInSubject = true): Responder => (sql, params) =>
  teacherOfClass(sql, params) ??
  (sql.includes('SELECT canonical_subject_id FROM classes')
    ? { rows: [{ canonical_subject_id: subject }] }
    : sql.includes('FROM canonical_concepts WHERE id')
      ? { rows: conceptInSubject ? [{ id: 'cc1', name: 'Linear Equations' }] : [] }
      : sql.includes('FROM class_enrollments ce JOIN students s')
        ? { rows: learners.map((l) => ({ ...l })) }
        : sql.includes('SELECT institution_id FROM classes')
          ? { rows: [{ institution_id: 'inst-A' }] }
          : sql.includes('FROM class_enrollments WHERE class_id = $1 AND student_id = $2')
            ? { rows: [{ '?': 1 }] }
            : sql.includes('FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1 AND s.student_id = $2')
              ? { rows: [{ '?': 1 }] }
              : sql.includes('INSERT INTO teacher_interventions')
                ? { rows: [{ id: `iv-${params[3]}`, status: 'ASSIGNED' }] }
                : undefined);

describe('Assignment lifecycle (TEACHER_ASSIGNMENT_MODEL)', () => {
  it('a class without a subject cannot receive assignments (0 writes)', async () => {
    respond(publishWorld(null));
    await expect(publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: 'cc1' })).rejects.toMatchObject({ code: 'CLASS_SUBJECT_REQUIRED' });
    expect(inserts()).toHaveLength(0);
  });

  it('only a topic of the class\'s OWN subject can be assigned (0 writes otherwise)', async () => {
    respond(publishWorld('subj-math', false));
    await expect(publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: 'cc-history' })).rejects.toMatchObject({ code: 'CONCEPT_NOT_IN_CLASS_SUBJECT' });
    const lookup = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('FROM canonical_concepts WHERE id'))!;
    expect(String(lookup[0])).toMatch(/canonical_subject_id = \$2/);
    expect(lookup[1]).toEqual(['cc-history', 'subj-math']);
    expect(inserts()).toHaveLength(0);
  });

  it('a selected recipient who is not ACTIVE in the class rejects the whole request (0 writes, never narrowed)', async () => {
    respond(publishWorld('subj-math'));
    await expect(publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: 'cc1', studentIds: ['s1', 'student-of-class-B'] })).rejects.toBeInstanceOf(InvalidClassAssignmentError);
    expect(inserts()).toHaveLength(0);
  });

  it('due date must be after the start date (0 writes)', async () => {
    respond(publishWorld('subj-math'));
    await expect(
      publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: 'cc1', startsAt: '2026-10-10T00:00:00Z', dueAt: '2026-10-09T23:59:00Z' })
    ).rejects.toMatchObject({ code: 'INVALID_DATES' });
    expect(inserts()).toHaveLength(0);
  });

  it('selected learners only, with title and start date persisted on each per-learner row', async () => {
    respond(publishWorld('subj-math'));
    const result = await publishClassAssignment('t1', {
      classId: 'c1',
      canonicalConceptId: 'cc1',
      title: 'Repaso de ecuaciones',
      startsAt: '2026-10-02T00:00:00Z',
      dueAt: '2026-10-09T23:59:00Z',
      studentIds: ['s1'],
    });
    expect(result.assigned.map((a) => a.studentId)).toEqual(['s1']);
    expect(inserts()).toHaveLength(1);
    const insert = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO teacher_interventions'))!;
    expect(insert[1]).toEqual(expect.arrayContaining(['s1', 'Repaso de ecuaciones', '2026-10-02T00:00:00Z', '2026-10-09T23:59:00Z']));
  });

  it('whole class = every ACTIVE learner; the title defaults to the topic', async () => {
    respond(publishWorld('subj-math'));
    const result = await publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: 'cc1' });
    expect(result.assigned.map((a) => a.studentId).sort()).toEqual(['s1', 's2']);
    for (const call of dbQueryMock.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO teacher_interventions'))) {
      expect(call[1]).toContain('Linear Equations');
    }
  });

  it('assignable topics are the class subject\'s concepts, and only for a teacher of the class', async () => {
    respond(() => ({ rows: [] }));
    await expect(listAssignableConceptsForClass('other-teacher', 'c1')).rejects.toBeInstanceOf(TeacherClassAccessDeniedError);
    dbQueryMock.mockReset();
    respond(teacherOfClass);
    await listAssignableConceptsForClass('t1', 'c1');
    expect(sqls().some((s) => /cc\.canonical_subject_id = k\.canonical_subject_id/.test(s))).toBe(true);
  });
});

describe('Start-date gating (student execution)', () => {
  it('an assignment whose start date is in the future is visible but not startable by its owner', async () => {
    respond((sql) =>
      sql.includes('SELECT intervention_type, student_id, starts_at FROM teacher_interventions')
        ? { rows: [{ intervention_type: 'CONCEPT_REINFORCEMENT', student_id: 's1', starts_at: new Date(Date.now() + 86_400_000) }] }
        : undefined
    );
    await expect(startTeacherInterventionExecution('u1', 'iv-1', 'k1')).rejects.toBeInstanceOf(StudentInterventionNotStartableError);
  });
});

describe('Teacher learner view (TEACHER_LEARNER_VISIBILITY)', () => {
  const viewWorld = (enrolled: boolean): Responder => (sql, params) =>
    teacherOfClass(sql, params) ??
    (sql.includes('FROM classes c JOIN institutions i')
      ? { rows: [{ id: 'c1', name: 'Matemáticas 3A', institution_id: 'inst-A', institution_name: 'A', grade_name: '3º', canonical_subject_id: 'subj-math', subject_name: 'Mathematics' }] }
      : sql.includes('FROM class_enrollments WHERE class_id = $1 AND student_id = $2')
        ? { rows: enrolled ? [{ '?': 1 }] : [] }
        : sql.includes('SELECT name, email FROM students')
          ? { rows: [{ name: 'Sofía', email: 's@x' }] }
          : sql.includes('FROM canonical_concepts WHERE canonical_subject_id')
            ? { rows: [{ id: 'cc1', name: 'Linear Equations' }] }
            : undefined);

  it('a learner not ACTIVE in the actor\'s class is denied (no learning read happens)', async () => {
    respond(viewWorld(false));
    await expect(getTeacherLearnerView('t1', 'c1', 'student-B')).rejects.toBeInstanceOf(TeacherLearnerAccessDeniedError);
    expect(decisionMock).not.toHaveBeenCalled();
  });

  it('a non-teacher of the class is denied', async () => {
    respond(() => ({ rows: [] }));
    await expect(getTeacherLearnerView('teacher-B', 'c1', 's1')).rejects.toBeInstanceOf(TeacherLearnerAccessDeniedError);
  });

  it('reads the canonical decision for the class subject topics only, and performs no write', async () => {
    respond(viewWorld(true));
    const view = await getTeacherLearnerView('t1', 'c1', 's1');
    expect(view.klass.subjectName).toBe('Mathematics');
    expect(view.concepts).toHaveLength(1);
    expect(view.concepts[0]).toMatchObject({ topic: 'Linear Equations', stage: 'PRACTICE', reinforce: true, practice: { passesInWindow: 1, requiredPasses: 3 } });
    expect(decisionMock).toHaveBeenCalledWith({ studentId: 's1', conceptId: 'own-concept' });
    expect(view.attention.map((a) => a.reason)).toEqual(['MISCONCEPTION', 'REINFORCE']);
    const writes = sqls().filter((s) => /\b(INSERT INTO|DELETE FROM)\b/.test(s) || /^\s*UPDATE\s/m.test(s));
    expect(writes.filter((s) => !s.includes('teacher_intervention'))).toEqual([]);
  });
});

describe('deriveTeacherAttention (pure)', () => {
  const base = (over: Partial<LearnerConceptState> = {}): LearnerConceptState => ({
    canonicalConceptId: 'cc1',
    topic: 'Linear Equations',
    inLearnerPlan: true,
    stage: 'PRACTICE',
    actionState: 'EXECUTABLE',
    nextAction: 'PRACTICE',
    nextEligibleAt: null,
    reinforce: false,
    practice: null,
    lastSuccessfulProveAt: null,
    retention: null,
    transferDepth: null,
    evidence: { totalAttempts: 2, correctAttempts: 1, independentAttempts: 0, independentCorrect: 0, lastEvidenceAt: null },
    recentActivity: [],
    misconceptions: { active: 0, critical: 0, recurring: 0, items: [] },
    answerSignals: { minorSlips: 0, mathErrors: 0, misconceptions: 0 },
    prerequisiteGaps: [],
    decisionUnavailable: false,
    ...over,
  });

  it('on track → nothing', () => {
    expect(deriveTeacherAttention([base()], [])).toEqual([]);
  });

  it('orders overdue work, misconceptions, reinforcement, prerequisites, retention; each with a Teacher action', () => {
    const items = deriveTeacherAttention(
      [base({ reinforce: true, retention: { status: 'AT_RISK', due: true, nextReviewAt: null, lastSuccessfulAt: null }, prerequisiteGaps: [{ label: 'Fracciones', state: 'LIKELY' }], misconceptions: { active: 1, critical: 0, recurring: 0, items: [{ description: 'Cambia el signo al despejar', occurrences: 2 }] } })],
      [{ interventionId: 'i', title: 'Tarea 1', topic: 'Linear Equations', status: 'EXPIRED', assignedAt: '', startsAt: null, dueAt: '', result: null, addedToPlan: false }]
    );
    expect(items.map((i) => i.reason)).toEqual(['OVERDUE_ASSIGNMENT', 'MISCONCEPTION', 'REINFORCE', 'PREREQUISITE_GAP', 'RETENTION_DUE']);
    expect(items.map((i) => i.suggestion)).toEqual(['FOLLOW_UP_ASSIGNMENT', 'REVIEW_MISCONCEPTION', 'ASSIGN_REINFORCEMENT', 'ASSIGN_PREREQUISITE', 'ASSIGN_RETENTION']);
    expect(items[1].detail).toBe('Cambia el signo al despejar');
  });

  it('a topic not in the learner\'s plan is "not started", never a guessed weakness', () => {
    expect(deriveTeacherAttention([base({ inLearnerPlan: false, stage: null, evidence: { totalAttempts: 0, correctAttempts: 0, independentAttempts: 0, independentCorrect: 0, lastEvidenceAt: null } })], []).map((i) => i.reason)).toEqual(['NOT_STARTED']);
  });
});
