/**
 * Track A -- Learning Plan Orchestrator: plan status semantics, matrix
 * buckets, exam-prep status, concept equivalence, Class Learning Plan
 * assignment (merge, never reset, authorization), removal semantics,
 * server-verified Student sources and the authorization / integrity
 * invariants of every new route and the governed migration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: vi.fn() } }));
const getTeacherClassMock = vi.fn();
vi.mock('@/lib/teacher/class-assignment.service', () => ({ getTeacherClass: (...a: any[]) => getTeacherClassMock(...a) }));
const canAccessMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canTeacherAccessLearner: (...a: any[]) => canAccessMock(...a) }));
const enrollMock = vi.fn();
const deactivateMock = vi.fn();
vi.mock('@/lib/learning-plan/personal-plan.service', async (orig) => ({
  ...(await orig<typeof import('@/lib/learning-plan/personal-plan.service')>()),
  enrollCanonicalConcept: (...a: any[]) => enrollMock(...a),
  deactivateClassSources: (...a: any[]) => deactivateMock(...a),
}));
const eventMock = vi.fn();
const curriculumForClassMock = vi.fn();
vi.mock('@/lib/learning-plan/institution-curriculum.service', () => ({
  recordCurriculumEvent: (...a: any[]) => eventMock(...a),
  curriculumForClass: (...a: any[]) => curriculumForClassMock(...a),
}));
const notifyMock = vi.fn();
vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyInstitutionAdmins: (...a: any[]) => notifyMock(...a) }));
vi.mock('@/lib/pedagogical-decision/canonical-decision.service', () => ({ getCanonicalPedagogicalDecision: vi.fn(async () => ({ decision: { stage: 'PRACTICE' } })) }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ deriveExamGaps: vi.fn(async () => []) }));
vi.mock('@/lib/learning-plan/labels', () => ({ canonicalConceptLabels: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `label-${id}`]))) }));

import { derivePlanStatus } from '@/lib/learning-plan/personal-plan.service';
import { matrixBucket, assignClassPlanConcept, removeFromClassPlan, addToClassPlan, ClassPlanError } from '@/lib/learning-plan/class-plan.service';
import { conceptSimilarity, conceptTokens } from '@/lib/learning-plan/concept-proposals.service';

const CLASS = '11111111-1111-4111-8111-111111111111';
const CC = '22222222-2222-4222-8222-222222222222';
const KLASS = { id: CLASS, name: 'Math 10', institutionId: 'inst-1', institutionName: 'ALBO', gradeName: '10', subjectId: 'cs-math', subjectName: 'Mathematics' };
const learners = (ids: string[]) => ({ rows: ids.map((id) => ({ id, name: `name-${id}` })) });

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  getTeacherClassMock.mockReset().mockResolvedValue(KLASS);
  canAccessMock.mockReset().mockResolvedValue(true);
  enrollMock.mockReset();
  deactivateMock.mockReset().mockResolvedValue(0);
  eventMock.mockReset();
  curriculumForClassMock.mockReset().mockResolvedValue(null);
  notifyMock.mockReset();
});

describe('plan status never changes learning phases (pure projection)', () => {
  it('maps plan state + canonical phase + evidence to the displayed status', () => {
    expect(derivePlanStatus('ARCHIVED', 'CONSOLIDATED', 9)).toBe('ARCHIVED');
    expect(derivePlanStatus('IN_PLAN', 'CONSOLIDATED', 9)).toBe('COMPLETED');
    expect(derivePlanStatus('IN_PLAN', 'RETAIN', 3)).toBe('MAINTENANCE');
    expect(derivePlanStatus('IN_PLAN', 'TRANSFER', 3)).toBe('MAINTENANCE');
    expect(derivePlanStatus('IN_PLAN', 'PRACTICE', 2)).toBe('ACTIVE');
    expect(derivePlanStatus('IN_PLAN', 'LEARN', 0)).toBe('IN_PLAN');
    expect(derivePlanStatus('IN_PLAN', null, 0)).toBe('IN_PLAN');
  });

  it('matrix bucket: not in plan / no phase = NOT_STARTED, else the canonical phase', () => {
    expect(matrixBucket(false, 'PROVE')).toBe('NOT_STARTED');
    expect(matrixBucket(true, null)).toBe('NOT_STARTED');
    expect(matrixBucket(true, 'PROVE')).toBe('PROVE');
  });
});

describe('concept equivalence (duplicate detection before a proposal)', () => {
  it('normalizes accents, stopwords and plurals', () => {
    expect(conceptTokens('Sistemas de Ecuaciones Lineales')).toEqual(['sistema', 'ecuacion', 'lineal']);
  });
  it('flags close equivalents and not unrelated concepts', () => {
    expect(conceptSimilarity('Systems of Linear Equations', 'Linear Systems')).toBeGreaterThanOrEqual(0.4);
    expect(conceptSimilarity('Linear Equations', 'linear equation')).toBe(1);
    expect(conceptSimilarity('Photosynthesis', 'Linear Equations')).toBe(0);
  });
});

describe('Class Learning Plan', () => {
  function world(opts: { inClassPlan?: boolean; roster?: string[] } = {}) {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT 1 FROM class_plan_concepts')) return { rows: opts.inClassPlan ? [{}] : [] };
      if (sql.includes('FROM class_enrollments ce JOIN students s')) return learners(opts.roster ?? ['s1', 's2', 's3']);
      if (sql.startsWith('SELECT name FROM canonical_concepts')) return { rows: [{ name: 'Linear Equations' }] };
      if (sql.startsWith('INSERT INTO class_plan_concepts')) return { rows: [{ inserted: true, prior_status: null }] };
      return { rows: [] };
    });
  }

  it('assign all: merges into every personal plan with a CLASS_PLAN source keyed by the class; learners who had it keep their state', async () => {
    world({ inClassPlan: true });
    enrollMock
      .mockResolvedValueOnce({ learnerConceptId: 'a', conceptCreated: false, entryCreated: false, restored: false, sourceAdded: true })
      .mockResolvedValueOnce({ learnerConceptId: 'b', conceptCreated: true, entryCreated: true, restored: false, sourceAdded: true })
      .mockResolvedValueOnce({ learnerConceptId: 'c', conceptCreated: false, entryCreated: false, restored: true, sourceAdded: true });
    expect(await assignClassPlanConcept('teacher', CLASS, CC)).toEqual({ assigned: 3, added: 2, alreadyHad: 1, skipped: 0 });
    for (const call of enrollMock.mock.calls) expect(call[2]).toMatchObject({ type: 'CLASS_PLAN', key: CLASS, classId: CLASS, institutionId: 'inst-1', actorUserId: 'teacher' });
    expect(eventMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CLASS_PLAN_UPDATED', detail: expect.objectContaining({ action: 'ASSIGNED', added: 2, alreadyHad: 1 }) }));
  });

  it('assign selected: only the chosen ACTIVE learners; a learner outside the class is refused', async () => {
    world({ inClassPlan: true });
    enrollMock.mockResolvedValue({ conceptCreated: false, entryCreated: true, restored: false });
    expect(await assignClassPlanConcept('teacher', CLASS, CC, ['s2'])).toMatchObject({ assigned: 1, added: 1 });
    expect(enrollMock.mock.calls.map((c) => c[0])).toEqual(['s2']);
    await expect(assignClassPlanConcept('teacher', CLASS, CC, ['s2', 'outsider'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a learner the Teacher cannot access is skipped, never enrolled', async () => {
    world({ inClassPlan: true });
    canAccessMock.mockImplementation(async (_a: string, s: string) => s !== 's2');
    enrollMock.mockResolvedValue({ conceptCreated: false, entryCreated: true, restored: false });
    expect(await assignClassPlanConcept('teacher', CLASS, CC)).toMatchObject({ skipped: 1, assigned: 2 });
    expect(enrollMock.mock.calls.map((c) => c[0])).not.toContain('s2');
  });

  it('only the Teacher of the class; the class needs a subject', async () => {
    getTeacherClassMock.mockResolvedValue(null);
    await expect(assignClassPlanConcept('other', CLASS, CC)).rejects.toMatchObject({ code: 'NOT_TEACHER' });
    getTeacherClassMock.mockResolvedValue({ ...KLASS, subjectId: null });
    await expect(addToClassPlan('teacher', CLASS, CC)).rejects.toMatchObject({ code: 'CLASS_SUBJECT_REQUIRED' });
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it('a concept outside the class subject is refused (nobody creates canonical concepts here)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    await expect(addToClassPlan('teacher', CLASS, CC)).rejects.toBeInstanceOf(ClassPlanError);
    expect(dbQueryMock.mock.calls.some((c) => /INSERT INTO canonical_concepts/.test(String(c[0])))).toBe(false);
  });

  it('a concept outside the institution curriculum is SUPPLEMENTAL and coordinators are told', async () => {
    world();
    curriculumForClassMock.mockResolvedValue({ curriculumId: 'cur', classifications: new Map([['other', 'REQUIRED']]) });
    expect(await addToClassPlan('teacher', CLASS, CC)).toEqual({ supplemental: true, created: true });
    expect(notifyMock).toHaveBeenCalledWith('inst-1', expect.objectContaining({ type: 'CURRICULUM_SUPPLEMENTAL_CONCEPT' }));
  });

  it('removing from the class plan retires CLASS_PLAN sources only (learner concept, state and history untouched)', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => (sql.startsWith('UPDATE class_plan_concepts') ? { rows: [{ id: 'x' }] } : { rows: [] }));
    deactivateMock.mockResolvedValue(4);
    expect(await removeFromClassPlan('teacher', CLASS, CC)).toEqual({ sourcesRetired: 4 });
    expect(deactivateMock).toHaveBeenCalledWith(expect.objectContaining({ classId: CLASS, canonicalConceptId: CC, sourceTypes: ['CLASS_PLAN'] }));
    const sql = dbQueryMock.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sql).not.toMatch(/DELETE FROM|UPDATE (concepts|mastery_records|student_plan_entries|learning_evidence)/);
  });
});

// ---------------------------------------------------------------------------
// Source invariants
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
function routes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(process.cwd(), p)).isDirectory()) out.push(...routes(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

describe('security matrix (every new route is gated by its owner)', () => {
  it('Student routes act only on the authenticated learner', () => {
    const files = [...routes('src/app/api/student/plan'), ...routes('src/app/api/student/curriculum'), ...routes('src/app/api/student/recommendations'), ...routes('src/app/api/student/exam-prep')];
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const code = strip(read(f));
      expect(code, f).toMatch(/requireStudentActor\(\)/);
      expect(code, f).not.toMatch(/studentId:\s*(parsed\.data|body|url\.searchParams)/);
    }
  });

  it('Teacher class routes require an authenticated user and the class-teacher check lives in the service', () => {
    const files = ['plan', 'plan/[conceptId]/remove', 'plan/[conceptId]/assign', 'matrix', 'needs', 'assignment-preview', 'concept-proposals'].map((p) => `src/app/api/teacher/classes/[classId]/${p}/route.ts`);
    for (const f of files) expect(strip(read(f)), f).toMatch(/requireUserActor\(\)/);
    const svc = strip(read('src/lib/learning-plan/class-plan.service.ts'));
    for (const fn of ['getClassPlanView', 'addToClassPlan', 'removeFromClassPlan', 'getClassLearnerMatrix', 'getClassNeeds', 'previewAssignment', 'assignClassPlanConcept', 'getClassStudentPlans']) {
      expect(svc, fn).toMatch(new RegExp(`function ${fn}\\([^]*?requireTeacherClass\\(actorUserId, classId\\)`));
    }
  });

  it('Coordinator curriculum routes require INSTITUTION_ADMIN of that institution; catalog resolution is Platform Admin only', () => {
    for (const f of routes('src/app/api/institutions/[id]/curricula')) expect(strip(read(f)), f).toMatch(/requireInstitutionAdminActor\(id, 'TEACHER_ASSIGNMENT_MANAGE'\)/);
    expect(strip(read('src/app/api/institutions/[id]/concept-proposals/route.ts'))).toMatch(/requireInstitutionAdminActor\(/);
    for (const f of routes('src/app/api/admin/concept-proposals')) expect(strip(read(f)), f).toMatch(/guardAdminUsersRoute\(/);
  });

  it('a Student-claimed CLASS_PLAN / INSTITUTION_CURRICULUM source is verified server-side (ACTIVE enrollment + concept in that plan)', () => {
    const code = strip(read('src/app/api/student/plan/route.ts'));
    expect(code).toMatch(/ce\.student_id = \$2 AND ce\.status = 'ACTIVE'/);
    expect(code).toMatch(/NOT_IN_CLASS_PLAN/);
    expect(code).toMatch(/NOT_IN_CURRICULUM/);
    expect(code).not.toMatch(/'TEACHER_ASSIGNMENT'|'EXAM_GAP'/);
  });
});

describe('data integrity (governed migration)', () => {
  const sql = strip(read('database/migrations/20261018_1400_track_a_learning_plan_orchestrator.sql').replace(/^--.*$/gm, ''));
  it('1 Student + 1 Canonical Concept = 1 Learner State, enforced in the database', () => {
    expect(sql).toMatch(/UNIQUE \(student_id, canonical_concept_id\)/);
    expect(sql).toMatch(/trg_one_learner_concept_per_canonical/);
  });
  it('sources are unique per origin and never deleted (deactivated with audit)', () => {
    expect(sql).toMatch(/UNIQUE \(student_id, canonical_concept_id, source_type, source_key\)/);
    expect(sql).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN/i);
  });
  it('the reserved learning_plan scheduler tables are not reused', () => {
    expect(sql).not.toMatch(/\b(CREATE TABLE|ALTER TABLE)\s+(IF NOT EXISTS\s+)?learning_plan(_item)?\b/i);
  });
});
