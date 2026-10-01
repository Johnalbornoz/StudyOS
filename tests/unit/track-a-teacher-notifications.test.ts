/**
 * Track A (Roles E2E) -- teacher assignments and the role notification
 * inbox. Class assignments are N per-learner interventions created only
 * through the certified per-learner authorization chain; the teacher's
 * reads are scoped to classes they TEACH; notifications are scoped to the
 * caller's own (user, workspace) inbox.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const canAccessClassMock = vi.fn();
const canTeacherManageInterventionMock = vi.fn();
const canTeacherAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({
  canAccessClass: (...a: any[]) => canAccessClassMock(...a),
  canTeacherManageIntervention: (...a: any[]) => canTeacherManageInterventionMock(...a),
  canTeacherAccessLearner: (...a: any[]) => canTeacherAccessLearnerMock(...a),
}));
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({ getStudentExamProfile: vi.fn(async () => null) }));
const reconcileMock = vi.fn(async () => {});
vi.mock('@/lib/student/teacher-intervention-execution.service', () => ({
  reconcileCompletionsForStudent: (...a: any[]) => (reconcileMock as any)(...a),
  getEffectiveStatus: (s: string, due: string | null) => (due && new Date(due).getTime() < Date.now() && (s === 'ASSIGNED' || s === 'IN_PROGRESS') ? 'EXPIRED' : s),
}));
const resolveConceptMock = vi.fn();
vi.mock('@/lib/readiness/student-concept-resolution.service', () => ({
  resolveStudentConceptForCanonicalConcept: (...a: any[]) => resolveConceptMock(...a),
}));

import {
  assignTeacherIntervention,
  listTeacherInterventionsForStudent,
  cancelTeacherIntervention,
  TeacherInterventionInvalidTargetError,
  TeacherInterventionAccessDeniedError,
} from '@/lib/teacher/intervention.service';
import { publishClassAssignment, TeacherClassAccessDeniedError, NoLearnersToAssignError } from '@/lib/teacher/class-assignment.service';
import { listInbox, markInboxRead, notifyUser, countUnread } from '@/lib/notifications/role-notifications.service';

type Responder = (sql: string, params: unknown[]) => { rows: any[]; rowCount?: number } | undefined;
const respond = (fn: Responder) => dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => fn(sql, params) ?? { rows: [], rowCount: 0 });
const sqls = () => dbQueryMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  canAccessClassMock.mockReset().mockResolvedValue(true);
  canTeacherManageInterventionMock.mockReset().mockResolvedValue(true);
  canTeacherAccessLearnerMock.mockReset().mockResolvedValue(true);
  resolveConceptMock.mockReset();
  reconcileMock.mockClear();
});

const authorizedClass: Responder = (sql) => {
  if (sql.includes('SELECT institution_id FROM classes')) return { rows: [{ institution_id: 'inst-A' }] };
  if (sql.includes('FROM class_enrollments WHERE class_id = $1 AND student_id = $2')) return { rows: [{ '?': 1 }] };
  return undefined;
};

describe('Per-learner assignment (A3)', () => {
  it('refuses a type/target mismatch (would sit NOT_EXECUTABLE forever) before writing', async () => {
    respond(authorizedClass);
    await expect(
      assignTeacherIntervention('t1', { classId: 'c1', studentId: 's1', interventionType: 'SKILL_PRACTICE', target: { targetType: 'CONCEPT', conceptId: 'k1' } })
    ).rejects.toBeInstanceOf(TeacherInterventionInvalidTargetError);
    expect(sqls().some((s) => s.includes('INSERT INTO teacher_interventions'))).toBe(false);
  });

  it('refuses a LEARNING_OBJECTIVE target (no execution path exists)', async () => {
    respond(authorizedClass);
    await expect(
      assignTeacherIntervention('t1', { classId: 'c1', studentId: 's1', interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'LEARNING_OBJECTIVE', learningObjectiveId: 'lo' } })
    ).rejects.toBeInstanceOf(TeacherInterventionInvalidTargetError);
  });

  it('a CONCEPT target must be THIS learner\'s own concept (spoofed concept of another learner refused)', async () => {
    respond(authorizedClass);
    await expect(
      assignTeacherIntervention('t1', { classId: 'c1', studentId: 's1', interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: 'someone-elses' } })
    ).rejects.toBeInstanceOf(TeacherInterventionInvalidTargetError);
    expect(sqls().some((s) => s.includes('INSERT INTO teacher_interventions'))).toBe(false);
  });

  it('the teacher\'s list of a learner\'s interventions is limited to classes the teacher teaches, and reconciled first', async () => {
    respond((sql) => (sql.includes('SELECT DISTINCT c.id FROM teacher_assignments') ? { rows: [{ id: 'c1' }] } : undefined));
    await listTeacherInterventionsForStudent('t1', 's1');
    expect(reconcileMock).toHaveBeenCalledWith('s1');
    const list = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('FROM teacher_interventions WHERE student_id'))!;
    expect(String(list[0])).toMatch(/class_id = ANY\(\$2::uuid\[\]\)/);
    expect(list[1]).toEqual(['s1', ['c1']]);
  });

  it('a teacher of the same learner in ANOTHER class cannot cancel the intervention', async () => {
    respond((sql) => {
      if (sql.includes('SELECT student_id, status, class_id FROM teacher_interventions')) return { rows: [{ student_id: 's1', status: 'ASSIGNED', class_id: 'class-A' }] };
      if (sql.includes('SELECT DISTINCT c.id FROM teacher_assignments')) return { rows: [{ id: 'class-B' }] };
      return undefined;
    });
    await expect(cancelTeacherIntervention('teacher-B', 'iv-1')).rejects.toBeInstanceOf(TeacherInterventionAccessDeniedError);
    expect(sqls().some((s) => s.includes("SET status = 'CANCELLED'"))).toBe(false);
  });
});

describe('Class assignment publish (A3/A5)', () => {
  it('only a teacher who TEACHES the class can publish (an institution admin or another class\'s teacher cannot)', async () => {
    respond(() => ({ rows: [] }));
    await expect(publishClassAssignment('admin-1', { classId: 'c1', canonicalConceptId: 'cc1' })).rejects.toBeInstanceOf(TeacherClassAccessDeniedError);
    expect(sqls().some((s) => s.includes('INSERT INTO teacher_interventions'))).toBe(false);
  });

  it('writes nothing when no learner has the topic', async () => {
    respond((sql) => {
      if (sql.includes('FROM (') && sql.includes('WHERE t.id = $2')) return { rows: [{ '?': 1 }] };
      if (sql.includes('SELECT canonical_subject_id FROM classes')) return { rows: [{ canonical_subject_id: 'subj-1' }] };
      if (sql.includes('FROM canonical_concepts WHERE id')) return { rows: [{ id: 'cc1', name: 'Linear Equations' }] };
      if (sql.includes('FROM class_enrollments ce JOIN students s')) return { rows: [{ id: 's1', name: 'A', email: 'a@x', user_id: 'u1' }] };
      return undefined;
    });
    resolveConceptMock.mockResolvedValue(null);
    await expect(publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: 'cc1' })).rejects.toBeInstanceOf(NoLearnersToAssignError);
    expect(sqls().some((s) => s.includes('INSERT INTO teacher_interventions'))).toBe(false);
  });

  it('one group, one per-learner row through the full chain, each learner\'s OWN concept; unmatched learners are reported, never guessed', async () => {
    respond((sql) => {
      if (sql.includes('FROM (') && sql.includes('WHERE t.id = $2')) return { rows: [{ '?': 1 }] };
      if (sql.includes('SELECT canonical_subject_id FROM classes')) return { rows: [{ canonical_subject_id: 'subj-1' }] };
      if (sql.includes('FROM canonical_concepts WHERE id')) return { rows: [{ id: 'cc1', name: 'Linear Equations' }] };
      if (sql.includes('FROM class_enrollments ce JOIN students s')) return { rows: [{ id: 's1', name: 'A', email: 'a@x', user_id: 'u1' }, { id: 's2', name: 'B', email: 'b@x', user_id: 'u2' }] };
      if (sql.includes('SELECT institution_id FROM classes')) return { rows: [{ institution_id: 'inst-A' }] };
      if (sql.includes('FROM class_enrollments WHERE class_id = $1 AND student_id = $2')) return { rows: [{ '?': 1 }] };
      if (sql.includes('FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1 AND s.student_id = $2')) return { rows: [{ '?': 1 }] };
      if (sql.includes('INSERT INTO teacher_interventions')) return { rows: [{ id: 'iv-1', status: 'ASSIGNED' }] };
      return undefined;
    });
    resolveConceptMock.mockImplementation(async (studentId: string) => (studentId === 's1' ? 'own-concept-of-s1' : null));
    const result = await publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: 'cc1' });
    expect(result.assigned).toEqual([{ studentId: 's1', interventionId: 'iv-1' }]);
    expect(result.skipped).toEqual([{ studentId: 's2', name: 'B', reason: 'NO_MATCHED_CONCEPT' }]);
    const insert = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO teacher_interventions'))!;
    expect(insert[1]).toContain('own-concept-of-s1');
    expect(insert[1]).toContain(result.assignmentGroupId);
    expect(canTeacherManageInterventionMock).toHaveBeenCalledWith('t1', 's1', 'TEACHER_INTERVENTION_ASSIGN');
  });
});

describe('Role notification inbox (§9)', () => {
  it('a Teacher/Institution inbox is the caller\'s own (user, workspace) -- never another workspace\'s rows', async () => {
    await listInbox('u1', 'TEACHER');
    expect(sqls()[0]).toMatch(/n\.recipient_user_id = \$1 AND n\.workspace = \$2/);
    expect(dbQueryMock.mock.calls[0][1]).toEqual(['u1', 'TEACHER']);
  });

  it('the Parent inbox also reads legacy rows addressed to the parent\'s own profile', async () => {
    await countUnread('u1', 'PARENT');
    expect(sqls()[0]).toMatch(/user_type = 'parent'/);
    expect(sqls()[0]).toMatch(/n\.read_at IS NULL/);
  });

  it('mark-read only touches rows inside the caller\'s scope (a spoofed id elsewhere changes nothing)', async () => {
    await markInboxRead('u1', 'INSTITUTION', ['11111111-1111-4111-8111-111111111111']);
    expect(sqls()[0]).toMatch(/UPDATE notifications n SET read_at = NOW\(\) WHERE \(n\.recipient_user_id = \$1 AND n\.workspace = \$2\) AND n\.read_at IS NULL AND n\.id = ANY\(\$3::uuid\[\]\)/);
  });

  it('a failed notification write never fails the business decision', async () => {
    dbQueryMock.mockRejectedValue(new Error('db down'));
    await expect(notifyUser({ recipientUserId: 'u1', workspace: 'PARENT', type: 'PARENT_LINK_ACCEPTED', title: 't', message: 'm' })).resolves.toBeNull();
  });
});
