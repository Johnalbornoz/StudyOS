/**
 * Track A -- a Teacher assignment adds the catalog concept to the plan of
 * learners who do not have it yet. Covers: already has / lacks / mixed /
 * all lack / duplicate submit / learner outside class / concept outside the
 * class subject / cross-tenant / existing progress preserved / no
 * fabricated evidence or mastery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    query: (...a: any[]) => dbQueryMock(...a),
    connect: vi.fn(async () => ({ query: (...a: any[]) => clientQueryMock(...a), release: releaseMock })),
  },
}));
const resolveMock = vi.fn();
vi.mock('@/lib/readiness/student-concept-resolution.service', () => ({ resolveStudentConceptForCanonicalConcept: (...a: any[]) => resolveMock(...a) }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(async () => 'es') }));

import { ensureConceptInLearnerPlan, canonicalConceptKey } from '@/lib/teacher/plan-enrollment.service';

const CC = '11111111-2222-4333-8444-555555555555';
const clientSqls = () => clientQueryMock.mock.calls.map((c) => String(c[0]));
const COGNITIVE = /learning_evidence|concept_knowledge_state|pedagogical_requirement_recognition|concept_memory_state|concept_transfer_state|student_misconceptions|UPDATE mastery_records/;

function clientWorld(opts: { subjects?: Array<{ id: string; name: string }>; byMapping?: string | null; inserted?: boolean }) {
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM canonical_concepts cc JOIN canonical_subjects')) return { rows: [{ id: CC, name: 'Linear Equations', subject_id: 'cs-math', subject_name: 'Mathematics' }] };
    if (sql.includes('JOIN concept_catalog_mapping m') && sql.includes('cc.canonical_subject_id = $2')) return { rows: opts.byMapping ? [{ id: opts.byMapping }] : [] };
    if (sql.startsWith("SELECT id, name FROM subjects")) return { rows: opts.subjects ?? [] };
    if (sql.startsWith('INSERT INTO subjects')) return { rows: [{ id: 'new-subject' }] };
    if (sql.startsWith('INSERT INTO concepts')) return { rows: [{ id: 'learner-concept', inserted: opts.inserted ?? true }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  resolveMock.mockReset().mockResolvedValue(null);
});

describe('ensureConceptInLearnerPlan', () => {
  it('1 / 9: a learner who already has the concept keeps it untouched (no write, progress preserved)', async () => {
    resolveMock.mockResolvedValue('existing-concept');
    expect(await ensureConceptInLearnerPlan({ studentId: 's1', canonicalConceptId: CC, classId: 'c1' })).toEqual({ conceptId: 'existing-concept', added: false });
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('2 / 10: a learner without it gets it in the existing equivalent subject (Matemáticas = Mathematics), MATCHED by construction, origin TEACHER_ASSIGNMENT, no evidence / progress', async () => {
    clientWorld({ subjects: [{ id: 'sub-history', name: 'Historia' }, { id: 'sub-mate', name: 'Matemáticas' }] });
    const r = await ensureConceptInLearnerPlan({ studentId: 's1', canonicalConceptId: CC, classId: 'c1' });
    expect(r).toEqual({ conceptId: 'learner-concept', added: true });
    const sql = clientSqls();
    expect(sql[0]).toBe('BEGIN');
    expect(sql.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    const conceptInsert = clientQueryMock.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO concepts'))!;
    expect(conceptInsert[1]).toEqual(['sub-mate', canonicalConceptKey(CC), 'TEACHER_ASSIGNMENT', 'c1']);
    expect(String(conceptInsert[0])).toMatch(/ON CONFLICT \(subject_id, canonical_id\)/);
    expect(sql.some((s) => s.startsWith('INSERT INTO subjects'))).toBe(false);
    const mapping = clientQueryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO concept_catalog_mapping'))!;
    expect(String(mapping[0])).toMatch(/'MATCHED', 'TEACHER_ASSIGNMENT'/);
    expect(mapping[1]).toEqual(['learner-concept', CC]);
    const mastery = sql.find((s) => s.includes('INSERT INTO mastery_records'))!;
    expect(mastery).toMatch(/VALUES \(\$1, \$2, \$3, 0, 0, 0, 0, 0\) ON CONFLICT \(student_id, concept_id\) DO NOTHING/);
    expect(sql.some((s) => COGNITIVE.test(s))).toBe(false);
    expect(sql.at(-1)).toBe('COMMIT');
  });

  it('prefers the subject that already holds concepts of this canonical subject; creates a subject only when there is none', async () => {
    clientWorld({ byMapping: 'sub-by-mapping', subjects: [{ id: 'sub-mate', name: 'Matemáticas' }] });
    await ensureConceptInLearnerPlan({ studentId: 's1', canonicalConceptId: CC, classId: 'c1' });
    expect(clientQueryMock.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO concepts'))![1][0]).toBe('sub-by-mapping');
    clientQueryMock.mockReset();
    clientWorld({ subjects: [{ id: 'sub-history', name: 'Historia' }] });
    await ensureConceptInLearnerPlan({ studentId: 's1', canonicalConceptId: CC, classId: 'c1' });
    const subjectInsert = clientQueryMock.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO subjects'))!;
    expect(subjectInsert[1]).toEqual(['s1', 'Matemáticas']);
  });

  it('5: a concurrent / retried call finds the concept under the lock and adds nothing', async () => {
    resolveMock.mockResolvedValueOnce(null).mockResolvedValueOnce('created-by-first-call');
    clientWorld({});
    expect(await ensureConceptInLearnerPlan({ studentId: 's1', canonicalConceptId: CC, classId: 'c1' })).toEqual({ conceptId: 'created-by-first-call', added: false });
    expect(clientSqls().some((s) => s.startsWith('INSERT'))).toBe(false);
  });

  it('a conflicting row (same deterministic key) is reused, not duplicated', async () => {
    clientWorld({ subjects: [{ id: 'sub-mate', name: 'Mathematics' }], inserted: false });
    expect((await ensureConceptInLearnerPlan({ studentId: 's1', canonicalConceptId: CC, classId: 'c1' })).added).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publishClassAssignment with the plan step mocked (what is under test is the orchestration and its gates)
// ---------------------------------------------------------------------------
describe('publishClassAssignment -- auto-add to plan', async () => {
  vi.resetModules();
  const ensureMock = vi.fn();
  const accessMock = vi.fn();
  const assignMock = vi.fn();
  vi.doMock('@/lib/teacher/plan-enrollment.service', () => ({
    ensureConceptInLearnerPlan: (...a: any[]) => ensureMock(...a),
    learnersHavingCanonicalConcept: vi.fn(async () => new Set()),
  }));
  vi.doMock('@/lib/authorization', () => ({ canTeacherAccessLearner: (...a: any[]) => accessMock(...a) }));
  vi.doMock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: vi.fn(async () => 'n1') }));
  vi.doMock('@/lib/student/teacher-intervention-execution.service', () => ({ reconcileCompletionsForStudent: vi.fn(), getEffectiveStatus: (s: string) => s }));
  vi.doMock('@/lib/teacher/intervention.service', () => {
    class TeacherInterventionAccessDeniedError extends Error {}
    return { assignTeacherIntervention: (...a: any[]) => assignMock(...a), TeacherInterventionAccessDeniedError };
  });
  const { publishClassAssignment, InvalidClassAssignmentError } = await import('@/lib/teacher/class-assignment.service');

  const learners = [
    { id: 's-has', name: 'Ana', email: 'a@x', user_id: 'u1' },
    { id: 's-lacks', name: 'Beto', email: 'b@x', user_id: 'u2' },
  ];
  const world = (opts: { subject?: string | null; conceptOk?: boolean; existing?: any[] } = {}) =>
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM (') && sql.includes('WHERE t.id = $2')) return { rows: [{ '?': 1 }] };
      if (sql.includes('SELECT canonical_subject_id FROM classes')) return { rows: [{ canonical_subject_id: opts.subject === undefined ? 'subj-math' : opts.subject }] };
      if (sql.includes('FROM canonical_concepts WHERE id')) return { rows: opts.conceptOk === false ? [] : [{ id: CC, name: 'Linear Equations' }] };
      if (sql.includes('FROM class_enrollments ce JOIN students s')) return { rows: learners.map((l) => ({ ...l })) };
      if (sql.includes('FROM teacher_interventions WHERE assignment_group_id = $1') && !sql.includes('student_id = $2')) return { rows: opts.existing ?? [] };
      return { rows: [] };
    });

  beforeEach(() => {
    ensureMock.mockReset().mockImplementation(async ({ studentId }: any) => ({ conceptId: `concept-of-${studentId}`, added: studentId === 's-lacks' }));
    accessMock.mockReset().mockResolvedValue(true);
    assignMock.mockReset().mockImplementation(async (_a: string, p: any) => ({ id: `iv-${p.studentId}` }));
  });

  it('3: mixed selection -- the learner with the concept reuses it, the other gets it added; nobody is blocked', async () => {
    world();
    const r = await publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: CC });
    expect(r.assigned).toEqual([
      { studentId: 's-has', interventionId: 'iv-s-has', addedToPlan: false },
      { studentId: 's-lacks', interventionId: 'iv-s-lacks', addedToPlan: true },
    ]);
    expect([r.alreadyHadConcept, r.addedToPlan]).toEqual([1, 1]);
    expect(assignMock).toHaveBeenCalledWith('t1', expect.objectContaining({ studentId: 's-lacks', target: { targetType: 'CONCEPT', conceptId: 'concept-of-s-lacks' }, addedToPlan: true }));
  });

  it('4: all selected learners lack the concept -- all receive it', async () => {
    world();
    ensureMock.mockImplementation(async ({ studentId }: any) => ({ conceptId: `concept-of-${studentId}`, added: true }));
    const r = await publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: CC });
    expect(r.addedToPlan).toBe(2);
    expect(r.skipped).toEqual([]);
  });

  it('5: a duplicate submit (same requestId) replays the assignment: no new recipient, no plan write', async () => {
    const req = '99999999-9999-4999-8999-999999999999';
    world({ existing: [
      { id: 'iv-s-has', student_id: 's-has', class_id: 'c1', assigned_by_user_id: 't1', concept_added_to_plan: false },
      { id: 'iv-s-lacks', student_id: 's-lacks', class_id: 'c1', assigned_by_user_id: 't1', concept_added_to_plan: true },
    ] });
    const r = await publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: CC, requestId: req });
    expect(r.replayed).toBe(true);
    expect(r.assignmentGroupId).toBe(req);
    expect(r.assigned.map((a) => a.interventionId)).toEqual(['iv-s-has', 'iv-s-lacks']);
    expect(ensureMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('6: a learner outside the class is refused before ANY write (plan included)', async () => {
    world();
    await expect(publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: CC, studentIds: ['s-has', 'student-of-class-B'] })).rejects.toMatchObject({ code: 'RECIPIENT_NOT_IN_CLASS' });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('7: a concept outside the class subject is refused before any write; the Teacher never creates catalog concepts', async () => {
    world({ conceptOk: false });
    await expect(publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: CC })).rejects.toBeInstanceOf(InvalidClassAssignmentError);
    expect(ensureMock).not.toHaveBeenCalled();
    expect(dbQueryMock.mock.calls.some((c) => /INSERT INTO canonical_concepts/.test(String(c[0])))).toBe(false);
  });

  it('8: cross-tenant -- a requestId of another class / teacher is refused; a learner without a genuine teacher relationship gets no plan write', async () => {
    world({ existing: [{ id: 'iv-x', student_id: 's-has', class_id: 'class-B', assigned_by_user_id: 'teacher-B', concept_added_to_plan: false }] });
    await expect(publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: CC, requestId: '99999999-9999-4999-8999-999999999999' })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    expect(ensureMock).not.toHaveBeenCalled();
    world();
    accessMock.mockImplementation(async (_t: string, s: string) => s !== 's-lacks');
    const r = await publishClassAssignment('t1', { classId: 'c1', canonicalConceptId: CC });
    expect(r.skipped).toEqual([{ studentId: 's-lacks', name: 'Beto', reason: 'NOT_AUTHORIZED' }]);
    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(ensureMock).toHaveBeenCalledWith(expect.objectContaining({ studentId: 's-has' }));
  });

  it('a non-teacher of the class writes nothing at all', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    await expect(publishClassAssignment('intruder', { classId: 'c1', canonicalConceptId: CC })).rejects.toThrow();
    expect(ensureMock).not.toHaveBeenCalled();
  });
});
