/**
 * Overnight 2026-10-16 -- teacher-assigned subject Test / Mock: the service's authorization order and write discipline
 * (db mocked). A refused actor reads no attempt and writes nothing; a refused draft writes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
const isOwnerMock = vi.fn();
const canTeacherAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ isOwner: (...a: any[]) => isOwnerMock(...a), canTeacherAccessLearner: (...a: any[]) => canTeacherAccessLearnerMock(...a) }));
const isTeacherOfClassMock = vi.fn();
const resolveRecipientsMock = vi.fn();
vi.mock('@/lib/teacher/class-assignment.service', () => {
  class TeacherClassAccessDeniedError extends Error {}
  class InvalidClassAssignmentError extends Error {
    constructor(public readonly code: string) { super(code); }
  }
  return {
    isTeacherOfClass: (...a: any[]) => isTeacherOfClassMock(...a),
    resolvePublishRecipients: (...a: any[]) => resolveRecipientsMock(...a),
    TeacherClassAccessDeniedError,
    InvalidClassAssignmentError,
  };
});
const assignMock = vi.fn();
vi.mock('@/lib/teacher/intervention.service', () => ({ assignTeacherIntervention: (...a: any[]) => assignMock(...a), TeacherInterventionAccessDeniedError: class extends Error {} }));
const ensureMock = vi.fn();
vi.mock('@/lib/teacher/plan-enrollment.service', () => ({ ensureConceptInLearnerPlan: (...a: any[]) => ensureMock(...a) }));
vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: vi.fn(async () => null) }));

import {
  startSubjectAssignmentAttempt, getSubjectAssessmentGroupResults, getSubjectAssessmentStudentResult, publishSubjectAssessmentAssignment, SubjectAssignmentError,
} from '@/lib/teacher/subject-assessment-assignment.service';
import { TeacherClassAccessDeniedError } from '@/lib/teacher/class-assignment.service';

const sqls = () => dbQueryMock.mock.calls.map((c) => String(c[0]));
const CONFIG = {
  version: 'teacher-subject-assessment-v1', kind: 'TEST', subjectId: 'subj', conceptIds: ['cc1'], allSubject: false, difficultyBand: 'LOW',
  plan: { questionCount: 4, distribution: { cc1: 4 }, rule: 'TEST_BALANCED_PRESET' }, timing: { timed: false, durationMinutes: null }, maxAttempts: 2,
  window: { startDate: '2026-10-17', endDate: '2026-10-18', timezone: 'UTC', timezoneSource: 'INSTITUTION', opensAt: '2026-10-17T00:00:00.000Z', closesAt: '2026-10-18T21:00:00.000Z' },
  feedbackPolicy: 'TEST_CORRECTNESS_ONLY', feedbackRelease: 'DIVERSE_IMMEDIATE_ELSE_AT_CLOSE', attemptLink: 'INTERVENTION_ID', learner: { subjectId: 'ls', conceptIds: { cc1: 'lc1' } }, frozenAt: 'x',
};

beforeEach(() => {
  dbQueryMock.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('FROM teacher_interventions WHERE id = $1')) return { rows: [{ id: 'iv1', student_id: 's1', class_id: 'k1', assignment_group_id: 'g1', intervention_type: 'SUBJECT_TEST', status: 'ASSIGNED', title: null, instructions: null, assigned_at: new Date(), config: CONFIG }] };
    if (sql.includes('FROM teacher_interventions ti JOIN students s')) return { rows: [{ id: 'iv1', student_id: 's1', class_id: 'k1', assignment_group_id: 'g1', intervention_type: 'SUBJECT_TEST', status: 'ASSIGNED', title: null, instructions: null, assigned_at: new Date(), config: CONFIG, student_name: 'A' }] };
    if (sql.includes('FROM classes c JOIN institutions i')) return { rows: [{ id: 'k1', name: 'K', institution_id: 'i1', canonical_subject_id: 'subj', subject_name: 'Mat', timezone: null }] };
    if (sql.includes('FROM canonical_concepts WHERE canonical_subject_id')) return { rows: [{ id: 'cc1', name: 'C1' }] };
    if (sql.includes('SELECT now()')) return { rows: [{ now: new Date('2026-10-17T12:00:00Z') }] };
    return { rows: [] };
  });
  isOwnerMock.mockReset().mockResolvedValue(true);
  canTeacherAccessLearnerMock.mockReset().mockResolvedValue(true);
  isTeacherOfClassMock.mockReset().mockResolvedValue(true);
  resolveRecipientsMock.mockReset();
  assignMock.mockReset();
  ensureMock.mockReset();
});

describe('authorization order', () => {
  it('a non-owner (another student, the teacher, a parent) cannot start / resume: refused before any attempt is read', async () => {
    isOwnerMock.mockResolvedValue(false);
    await expect(startSubjectAssignmentAttempt('other-user', 'iv1')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(sqls().some((s) => s.includes('FROM quiz_sessions'))).toBe(false);
    expect(sqls().some((s) => /INSERT|UPDATE|DELETE/.test(s))).toBe(false);
  });

  it('a teacher who does not teach the class reads no assignment row', async () => {
    isTeacherOfClassMock.mockResolvedValue(false);
    await expect(getSubjectAssessmentGroupResults('t2', 'k1', 'g1')).rejects.toBeInstanceOf(TeacherClassAccessDeniedError);
    await expect(getSubjectAssessmentStudentResult('t2', 'k1', 'g1', 's1')).rejects.toBeInstanceOf(TeacherClassAccessDeniedError);
    expect(sqls().some((s) => s.includes('teacher_interventions') || s.includes('quiz_sessions'))).toBe(false);
  });

  it('the drill-down also needs a genuine teacher of THIS learner: refused before any attempt is read', async () => {
    canTeacherAccessLearnerMock.mockResolvedValue(false);
    await expect(getSubjectAssessmentStudentResult('t1', 'k1', 'g1', 's1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(sqls().some((s) => s.includes('FROM quiz_sessions'))).toBe(false);
  });

  it('a learner outside the group is NOT_FOUND', async () => {
    await expect(getSubjectAssessmentStudentResult('t1', 'k1', 'g1', 'not-a-recipient')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('write discipline', () => {
  it('no institution timezone -> TIMEZONE_AUTHORITY_BLOCKER before recipients are resolved; nothing written', async () => {
    const e = await publishSubjectAssessmentAssignment('t1', { classId: 'k1', kind: 'TEST', conceptIds: ['cc1'], difficulty: 'BASICO', startDate: '2026-10-17', endDate: '2026-10-18', maxAttempts: 1, timing: { timed: false, durationMinutes: null } }).catch((x) => x);
    expect(e).toBeInstanceOf(SubjectAssignmentError);
    expect(e.code).toBe('TIMEZONE_AUTHORITY_BLOCKER');
    expect(e.status).toBe(409);
    expect(resolveRecipientsMock).not.toHaveBeenCalled();
    expect(ensureMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('the teacher service never writes evidence, mastery or knowledge state itself', async () => {
    const { readFileSync } = await import('fs');
    for (const f of ['src/lib/teacher/subject-assessment-assignment.service.ts', 'src/lib/teacher/subject-assessment-release.service.ts', 'src/lib/teacher/subject-assessment-assignment.rules.ts']) {
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(learning_evidence|mastery_records|concept_knowledge_state|quiz_responses|quiz_response_grades)\b/i);
      expect(code, f).not.toMatch(/\bupdateMastery\s*\(/);
      expect(code, f).not.toMatch(/INSERT INTO teacher_interventions/);
    }
  });
});
