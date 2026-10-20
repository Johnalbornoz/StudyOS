/**
 * Track A -- Institution Curriculum Management V2 + hierarchical academic
 * governance: service-level invariants. Locks are enforced server-side
 * (never UI-only), every denial is audited, tenant scope is checked before
 * any write, and bulk content changes are applied in order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: vi.fn() } }));

const canAccessInstitutionMock = vi.fn();
vi.mock('@/lib/authorization', () => ({
  canAccessInstitution: (...a: any[]) => canAccessInstitutionMock(...a),
  canTeacherAccessLearner: vi.fn(async () => true),
}));
const getTeacherClassMock = vi.fn();
const publishClassAssignmentMock = vi.fn();
vi.mock('@/lib/teacher/class-assignment.service', () => ({
  getTeacherClass: (...a: any[]) => getTeacherClassMock(...a),
  publishClassAssignment: (...a: any[]) => publishClassAssignmentMock(...a),
}));
vi.mock('@/lib/teacher/intervention.service', () => ({ assignInstitutionDirectIntervention: vi.fn() }));
vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: vi.fn() }));
vi.mock('@/lib/learning-plan/personal-plan.service', () => ({ enrollCanonicalConcept: vi.fn() }));
vi.mock('@/lib/learning-plan/labels', () => ({ canonicalConceptLabels: vi.fn(async () => new Map()) }));

import { enforceClassPlanLocks, updateClassAssignment, addInstitutionAssignmentRecipients, createInstitutionAssignment, GovernanceError, INSTITUTION_PLAN_LOCKS } from '@/lib/institution/institution-governance.service';
import { assignClassCurriculum, updateInstitutionCurriculumContentStatus, CurriculumManagementError } from '@/lib/institution/curriculum-management.service';
import { FieldLockedError } from '@/lib/institution/academic-governance';

type Responder = (sql: string, params: unknown[]) => { rows: any[]; rowCount?: number } | undefined;
const respond = (fn: Responder) => dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => fn(String(sql ?? ""), params ?? []) ?? { rows: [], rowCount: 0 });
const calls = () => dbQueryMock.mock.calls.map((c) => ({ sql: String(c[0]), params: c[1] as unknown[] }));
const audits = () => calls().filter((c) => c.sql.includes('INSERT INTO academic_governance_events'));

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  canAccessInstitutionMock.mockReset().mockResolvedValue(true);
  getTeacherClassMock.mockReset().mockResolvedValue({ id: 'class-1', institutionId: 'inst-1' });
  publishClassAssignmentMock.mockReset().mockResolvedValue({ assigned: [], skipped: [] });
});

const institutionRow = {
  owner_scope: 'INSTITUTION',
  locked_fields: [...INSTITUTION_PLAN_LOCKS],
  priority: 'HIGH',
  period: 'T1',
  required_for_class: true,
  institution_target_date: new Date(2026, 9, 20), // pg DATE = local midnight
};
const lockArgs = (requested: any) => ({ classId: 'class-1', canonicalConceptId: 'c-1', actorUserId: 'teacher-1', institutionId: 'inst-1', requested });

describe('Institution-locked class plan content (server-side)', () => {
  beforeEach(() => respond((sql) => (sql.includes('FROM class_plan_concepts') ? { rows: [institutionRow] } : undefined)));

  it.each([
    ['removal', { remove: true }],
    ['priority', { priority: 'LOW' }],
    ['period', { period: 'T3' }],
    ['required_for_class', { requiredForClass: false }],
    ['institution_target_date', { targetDate: '2026-10-21' }],
  ])('denies %s with FIELD_LOCKED_BY_INSTITUTION and audits the attempt', async (field, requested) => {
    const err = await enforceClassPlanLocks(lockArgs(requested)).catch((e) => e);
    expect(err).toBeInstanceOf(FieldLockedError);
    expect(err.code).toBe('FIELD_LOCKED_BY_INSTITUTION');
    expect(err.fields).toContain(field);
    const a = audits();
    expect(a).toHaveLength(1);
    expect(a[0].params).toContain('DENIED');
    expect(a[0].params).toContain('TEACHER');
  });

  it('allows a teacher planning date on or before the institution date (local DATE, no timezone shift)', async () => {
    await expect(enforceClassPlanLocks(lockArgs({ targetDate: '2026-10-20' }))).resolves.toBeUndefined();
    await expect(enforceClassPlanLocks(lockArgs({ targetDate: '2026-10-15' }))).resolves.toBeUndefined();
    expect(audits()).toHaveLength(0);
  });

  it('allows re-sending the same locked values (no change is not a violation)', async () => {
    await expect(enforceClassPlanLocks(lockArgs({ priority: 'HIGH', period: 'T1', requiredForClass: true }))).resolves.toBeUndefined();
  });

  it('teacher-owned rows stay fully editable', async () => {
    respond((sql) => (sql.includes('FROM class_plan_concepts') ? { rows: [{ ...institutionRow, owner_scope: 'TEACHER', locked_fields: [] }] } : undefined));
    await expect(enforceClassPlanLocks(lockArgs({ remove: true, priority: 'LOW', period: 'T3', targetDate: '2027-01-01' }))).resolves.toBeUndefined();
  });

  it('a concept the curriculum marks REQUIRED can never be made "not required" by a teacher', async () => {
    respond((sql) => {
      if (sql.includes('FROM class_plan_concepts')) return { rows: [] };
      if (sql.includes("icc.classification = 'REQUIRED'")) return { rows: [{ '?column?': 1 }] };
      return undefined;
    });
    const err = await enforceClassPlanLocks(lockArgs({ requiredForClass: false })).catch((e) => e);
    expect(err).toBeInstanceOf(FieldLockedError);
    expect(err.fields).toEqual(['required_for_class']);
  });
});

describe('Institution tasks: the teacher only chooses recipients', () => {
  it('editing an institution-owned group is denied, audited with old/new values, and nothing is updated', async () => {
    respond((sql) => {
      if (sql.includes('FROM teacher_interventions WHERE assignment_group_id')) return { rows: [{ id: 'i1', owner_scope: 'INSTITUTION', institution_assignment_id: 'ia-1', title: 'T', due_at: new Date('2026-10-21T04:59:00Z'), starts_at: null }] };
      return undefined;
    });
    const err = await updateClassAssignment({ teacherUserId: 'teacher-1', classId: 'class-1', groupId: 'g-1', patch: { dueAt: '2026-10-21T23:59:00-05:00' } }).catch((e) => e);
    expect(err).toBeInstanceOf(FieldLockedError);
    expect(err.fields).toEqual(['due_at']);
    expect(calls().some((c) => c.sql.startsWith('UPDATE teacher_interventions'))).toBe(false);
    const a = audits();
    expect(a).toHaveLength(1);
    expect(a[0].params).toContain('DENIED');
    expect(String(a[0].params[7])).toContain('2026-10-21T04:59:00.000Z'); // old value
    expect(String(a[0].params[8])).toContain('2026-10-21T23:59:00-05:00'); // attempted value
  });

  it('a group that is an institution target is locked even before any recipient exists as INSTITUTION-owned', async () => {
    respond((sql) => {
      if (sql.includes('FROM teacher_interventions WHERE assignment_group_id')) return { rows: [{ id: 'i1', owner_scope: 'TEACHER', institution_assignment_id: null, title: 'T', due_at: null, starts_at: null }] };
      if (sql.includes('FROM institution_assignment_targets WHERE assignment_group_id')) return { rows: [{ '?column?': 1 }] };
      return undefined;
    });
    await expect(updateClassAssignment({ teacherUserId: 'teacher-1', classId: 'class-1', groupId: 'g-1', patch: { title: 'x' } })).rejects.toBeInstanceOf(FieldLockedError);
  });

  it("the teacher's own task stays editable and the change is audited as APPLIED", async () => {
    respond((sql) => {
      if (sql.includes('FROM teacher_interventions WHERE assignment_group_id')) return { rows: [{ id: 'i1', owner_scope: 'TEACHER', institution_assignment_id: null, title: 'Mine', instructions: null, due_at: new Date('2026-10-25T04:59:00Z'), starts_at: null }] };
      return undefined;
    });
    await expect(updateClassAssignment({ teacherUserId: 'teacher-1', classId: 'class-1', groupId: 'g-1', patch: { dueAt: '2026-10-26T23:59:00-05:00' } })).resolves.toEqual({ updated: 1 });
    expect(calls().some((c) => c.sql.startsWith('UPDATE teacher_interventions') && c.params.includes('2026-10-26T23:59:00-05:00'))).toBe(true);
    expect(audits()[0].params).toContain('APPLIED');
  });

  it('a teacher outside the class cannot touch any task', async () => {
    getTeacherClassMock.mockResolvedValue(null);
    await expect(updateClassAssignment({ teacherUserId: 'x', classId: 'class-1', groupId: 'g-1', patch: { title: 'x' } })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(addInstitutionAssignmentRecipients({ teacherUserId: 'x', assignmentId: 'ia-1', classId: 'class-1' })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('DIRECT_ALL_STUDENTS tasks cannot be re-delivered by the teacher', async () => {
    respond((sql) => {
      if (sql.includes('FROM institution_assignments ia')) return { rows: [{ id: 'ia-1', institution_id: 'inst-1', delivery_mode: 'DIRECT_ALL_STUDENTS', teacher_editable_fields: ['recipients'] }] };
      if (sql.includes('FROM institution_assignment_targets WHERE assignment_id')) return { rows: [{ assignment_group_id: 'g-1' }] };
      return undefined;
    });
    await expect(addInstitutionAssignmentRecipients({ teacherUserId: 't', assignmentId: 'ia-1', classId: 'class-1' })).rejects.toMatchObject({ code: 'DIRECT_DELIVERY' });
    expect(publishClassAssignmentMock).not.toHaveBeenCalled();
  });

  it('recipients are published with the institution-locked content, never teacher input', async () => {
    respond((sql) => {
      if (sql.includes('FROM institution_assignments ia'))
        return { rows: [{ id: 'ia-1', institution_id: 'inst-1', delivery_mode: 'TEACHER_SELECTS_RECIPIENTS', teacher_editable_fields: ['recipients'], canonical_concept_id: 'c-1', title: 'Inst', instructions: 'I', starts_at: null, due_at: new Date('2026-10-21T04:59:00Z') }] };
      if (sql.includes('FROM institution_assignment_targets WHERE assignment_id')) return { rows: [{ assignment_group_id: 'g-1' }] };
      return undefined;
    });
    await addInstitutionAssignmentRecipients({ teacherUserId: 't', assignmentId: 'ia-1', classId: 'class-1', studentIds: ['s1'] });
    expect(publishClassAssignmentMock).toHaveBeenCalledWith('t', expect.objectContaining({ title: 'Inst', dueAt: '2026-10-21T04:59:00.000Z', requestId: 'g-1', studentIds: ['s1'], governed: { institutionAssignmentId: 'ia-1' } }));
  });

  it('a task of another institution is NOT_FOUND for the teacher', async () => {
    respond((sql) => (sql.includes('FROM institution_assignments ia') ? { rows: [{ id: 'ia-1', institution_id: 'inst-2' }] } : undefined));
    await expect(addInstitutionAssignmentRecipients({ teacherUserId: 't', assignmentId: 'ia-1', classId: 'class-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('only a coordinator creates tasks; a replayed requestId creates nothing', async () => {
    canAccessInstitutionMock.mockResolvedValue(false);
    await expect(createInstitutionAssignment({ institutionId: 'inst-1', actorUserId: 't', canonicalConceptId: 'c', title: 'x', deliveryMode: 'DIRECT_ALL_STUDENTS', classIds: ['class-1'] })).rejects.toBeInstanceOf(GovernanceError);
    canAccessInstitutionMock.mockResolvedValue(true);
    respond((sql) => (sql.includes('WHERE request_id') ? { rows: [{ id: 'ia-1' }] } : undefined));
    await expect(createInstitutionAssignment({ institutionId: 'inst-1', actorUserId: 'c', canonicalConceptId: 'c', title: 'x', deliveryMode: 'DIRECT_ALL_STUDENTS', classIds: ['class-1'], requestId: 'r-1' })).resolves.toEqual({ id: 'ia-1', replayed: true, delivered: 0 });
    expect(calls().some((c) => c.sql.includes('INSERT INTO institution_assignments'))).toBe(false);
  });

  it('a class of another institution cannot be targeted', async () => {
    respond((sql) => (sql.includes('FROM classes WHERE id') ? { rows: [{ id: 'class-x', institution_id: 'inst-2', canonical_subject_id: 's' }] } : undefined));
    await expect(createInstitutionAssignment({ institutionId: 'inst-1', actorUserId: 'c', canonicalConceptId: 'c', title: 'x', deliveryMode: 'DIRECT_ALL_STUDENTS', classIds: ['class-x'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls().some((c) => c.sql.includes('INSERT INTO institution_assignments'))).toBe(false);
  });
});

describe('Curriculum management: tenant scope and bulk content', () => {
  it('a class of another institution cannot be associated (checked before any write)', async () => {
    respond((sql) => (sql.includes('FROM classes WHERE id') ? { rows: [{ id: 'class-x', institution_id: 'inst-2' }] } : undefined));
    await expect(assignClassCurriculum({ institutionId: 'inst-1', classId: 'class-x', curriculumId: 'cur-1', actorUserId: 'c' })).rejects.toMatchObject({ code: 'CLASS_NOT_IN_INSTITUTION' });
    expect(calls().some((c) => c.sql.startsWith('UPDATE classes'))).toBe(false);
  });

  it('a curriculum of another institution is NOT_FOUND (no association written)', async () => {
    respond((sql) => (sql.includes('FROM classes WHERE id') ? { rows: [{ id: 'class-1', institution_id: 'inst-1' }] } : undefined));
    const err = await assignClassCurriculum({ institutionId: 'inst-1', classId: 'class-1', curriculumId: 'foreign', actorUserId: 'c' }).catch((e) => e);
    expect(err).toBeInstanceOf(CurriculumManagementError);
    expect(err.code).toBe('NOT_FOUND');
    expect(calls().some((c) => c.sql.startsWith('UPDATE classes'))).toBe(false);
  });

  it('a batch touching the same objective twice applies both (restore + classify)', async () => {
    respond((sql) => {
      if (sql.includes('FROM institution_curricula WHERE id')) return { rows: [{ id: 'cur-1', status: 'ACTIVE', canonical_subject_id: 's' }] };
      if (sql.includes('SELECT learning_objective_id, status, classification FROM institution_curriculum_objectives')) return { rows: [{ learning_objective_id: 'lo-1', status: 'EXCLUDED', classification: 'RECOMMENDED' }] };
      return undefined;
    });
    await updateInstitutionCurriculumContentStatus({
      institutionId: 'inst-1',
      curriculumId: 'cur-1',
      actorUserId: 'c',
      objectives: [{ learningObjectiveId: 'lo-1', status: 'INCLUDED' }, { learningObjectiveId: 'lo-1', classification: 'REQUIRED' }],
    });
    const updates = calls().filter((c) => c.sql.startsWith('UPDATE institution_curriculum_objectives'));
    expect(updates.at(-1)?.params.slice(2, 4)).toEqual(['INCLUDED', 'REQUIRED']);
  });

  it('an unchanged concept is neither rewritten nor audited (local DATE compared without shift)', async () => {
    respond((sql) => {
      if (sql.includes('FROM institution_curricula WHERE id')) return { rows: [{ id: 'cur-1', status: 'ACTIVE', canonical_subject_id: 's' }] };
      if (sql.includes('FROM canonical_concepts cc JOIN canonical_subjects')) return { rows: [{ id: 'c-1' }] };
      if (sql.includes('FROM institution_curriculum_concepts WHERE curriculum_id')) return { rows: [{ canonical_concept_id: 'c-1', status: 'ACTIVE', classification: 'REQUIRED', institution_target_date: new Date(2026, 9, 20), period: null }] };
      return undefined;
    });
    const r = await updateInstitutionCurriculumContentStatus({ institutionId: 'inst-1', curriculumId: 'cur-1', actorUserId: 'c', concepts: [{ canonicalConceptId: 'c-1', status: 'INCLUDED', classification: 'REQUIRED', institutionTargetDate: '2026-10-20' }] });
    expect(r.concepts).toBe(0);
    expect(audits()).toHaveLength(0);
  });

  it('content of another subject / version is refused', async () => {
    respond((sql) => {
      if (sql.includes('FROM institution_curricula WHERE id')) return { rows: [{ id: 'cur-1', status: 'ACTIVE', canonical_subject_id: 's' }] };
      return undefined; // no objective rows / no valid concepts
    });
    await expect(updateInstitutionCurriculumContentStatus({ institutionId: 'inst-1', curriculumId: 'cur-1', actorUserId: 'c', objectives: [{ learningObjectiveId: 'lo-x', status: 'INCLUDED' }] })).rejects.toMatchObject({ code: 'CONTENT_NOT_IN_CURRICULUM' });
    await expect(updateInstitutionCurriculumContentStatus({ institutionId: 'inst-1', curriculumId: 'cur-1', actorUserId: 'c', concepts: [{ canonicalConceptId: 'c-x', status: 'INCLUDED' }] })).rejects.toMatchObject({ code: 'CONTENT_NOT_IN_CURRICULUM' });
  });

  it('an archived curriculum cannot be edited', async () => {
    respond((sql) => (sql.includes('FROM institution_curricula WHERE id') ? { rows: [{ id: 'cur-1', status: 'ARCHIVED' }] } : undefined));
    await expect(updateInstitutionCurriculumContentStatus({ institutionId: 'inst-1', curriculumId: 'cur-1', actorUserId: 'c', objectives: [] , concepts: [{ canonicalConceptId: 'c', status: 'INCLUDED' }] })).rejects.toMatchObject({ code: 'CURRICULUM_NOT_ACTIVE' });
  });
});

describe('Structural guards', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the V2 migration is additive: no table or column is dropped, only the replaced unique index', () => {
    const sql = read('database/migrations/20261018_1500_track_a_institution_curriculum_v2.sql');
    const body = strip(sql.split(/^-- ROLLBACK/m)[0].replace(/^--.*$/gm, ''));
    expect(body).not.toMatch(/DROP TABLE/i);
    expect(body).not.toMatch(/DROP COLUMN/i);
    expect(body).not.toMatch(/\bDELETE FROM\b/i);
    expect([...body.matchAll(/DROP INDEX[^;]*/gi)].map((m) => m[0])).toEqual([expect.stringContaining('uq_institution_curricula_active')]);
  });

  it('every V2 / governance route is wrapped with withAiRequestMetrics and maps lock errors through governedError', () => {
    const routes = [
      'src/app/api/institutions/[id]/curriculum/subjects/route.ts',
      'src/app/api/institutions/[id]/curriculum/subjects/[curriculumId]/route.ts',
      'src/app/api/institutions/[id]/curriculum/subjects/[curriculumId]/preview/route.ts',
      'src/app/api/institutions/[id]/curriculum/subjects/[curriculumId]/archive/route.ts',
      'src/app/api/institutions/[id]/curriculum/subjects/[curriculumId]/content/route.ts',
      'src/app/api/institutions/[id]/curriculum/coverage/route.ts',
      'src/app/api/institutions/[id]/classes/[classId]/curriculum/route.ts',
      'src/app/api/institutions/[id]/classes/[classId]/plan/route.ts',
      'src/app/api/institutions/[id]/institution-assignments/route.ts',
      'src/app/api/institutions/[id]/institution-assignments/[assignmentId]/route.ts',
      'src/app/api/teacher/classes/[classId]/institution-assignments/route.ts',
      'src/app/api/teacher/classes/[classId]/institution-assignments/[assignmentId]/recipients/route.ts',
      'src/app/api/teacher/classes/[classId]/assignments/[groupId]/route.ts',
    ];
    for (const r of routes) {
      const code = read(r);
      expect(code, r).toMatch(/withAiRequestMetrics\('(GET|POST|PATCH) /);
      expect(code, r).toMatch(/governedError\(/);
    }
  });

  it('coordinator routes require the institution admin capability; teacher routes resolve the class through the teacher', () => {
    for (const r of ['subjects/route.ts', 'subjects/[curriculumId]/route.ts', 'subjects/[curriculumId]/archive/route.ts', 'subjects/[curriculumId]/content/route.ts', 'coverage/route.ts']) {
      expect(read(`src/app/api/institutions/[id]/curriculum/${r}`)).toMatch(/requireInstitutionAdminActor\(id, 'TEACHER_ASSIGNMENT_MANAGE'\)/);
    }
    expect(read('src/lib/institution/institution-governance.service.ts')).toMatch(/getTeacherClass\(params\.teacherUserId, params\.classId\)/);
  });

  it('the recipients endpoint accepts recipients only (strict schema)', () => {
    expect(read('src/app/api/teacher/classes/[classId]/institution-assignments/[assignmentId]/recipients/route.ts')).toMatch(/studentIds[^\n]*\}\)\.strict\(\)/);
  });

  it('class plan writes pass the lock guard before writing', () => {
    const code = strip(read('src/lib/learning-plan/class-plan.service.ts'));
    const add = code.indexOf('export async function addToClassPlan');
    const remove = code.indexOf('export async function removeFromClassPlan');
    for (const start of [add, remove]) {
      const body = code.slice(start, start + 2500);
      expect(body.indexOf('enforceClassPlanLocks(')).toBeGreaterThan(-1);
      const firstWrite = body.search(/INSERT INTO class_plan_concepts|UPDATE class_plan_concepts/);
      expect(firstWrite === -1 || body.indexOf('enforceClassPlanLocks(') < firstWrite).toBe(true);
    }
  });
});
