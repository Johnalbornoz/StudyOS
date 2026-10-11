/**
 * L8 -- TE-1 (the individual practice form is mounted on the Teacher's
 * learner page) and TE-2 (class exam insights, for the class's Teacher only).
 *
 * The exam-insights tests run the REAL teacher gate
 * (class-assignment.service `getTeacherClass` / TEACHER_CLASS_SQL) against a
 * scripted database, so "a Coordinator is refused" is proven on the query
 * that decides it, not on a mock of the decision.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: unknown[]) => query(...args) } }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_n: string, h: unknown) => h }));
vi.mock('@/lib/exam-core/route-auth', () => ({ requireActor: vi.fn() }));
vi.mock('@/lib/teacher/read-model.service', () => ({ getTeacherClassRoster: vi.fn() }));
vi.mock('@/lib/exam-core/exam-gaps.service', () => ({ examGapsFor: vi.fn(), examGoalsFor: vi.fn() }));

import { requireActor } from '@/lib/exam-core/route-auth';
import { getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { examGapsFor, examGoalsFor } from '@/lib/exam-core/exam-gaps.service';
import { getTeacherClassExamInsights, examInsightsByStudent, TeacherExamInsightsAccessDeniedError } from '@/lib/teacher/exam-insights.service';
import { listIndividualAssignmentConcepts } from '@/lib/teacher/individual-assignment';
import { TEACHER_L8_MESSAGES } from '@/lib/i18n/teacher-l8-messages';
import { GET } from '@/app/api/teacher/exam-insights/route';

const CLASS = '44444444-4444-4444-8444-444444444444';
const ANA = '11111111-1111-4111-8111-111111111111';
const BEA = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '99999999-9999-4999-8999-999999999999';
const TEACHER = 'teacher-user';
const COORDINATOR = 'coordinator-user';
const OTHER_TEACHER = 'other-class-teacher';

const GAPS = {
  studentsWithResults: 1,
  byDomain: [{ family: 'PISA', exam: 'PISA Math', domain: 'Quantity', students: 1 }],
  byObjective: [{ family: 'PISA', exam: 'PISA Math', code: 'Q1', description: 'Ratios', students: 1 }],
  byConcept: [{ canonicalConceptId: 'cc-1', name: 'Ratios', students: 1, studentIds: [ANA] }],
  perStudent: [{ studentId: ANA, gaps: 2, concepts: [{ canonicalConceptId: 'cc-1', name: 'Ratios', studentConceptId: null }] }],
};
const GOALS = { studentsPreparing: 1, byFramework: [], byObjective: [], perStudent: [{ studentId: ANA, goals: [{ objectiveKey: 'pisa', label: 'PISA', examDate: null }] }] };

/** Scripts the database: only TEACHER teaches CLASS (the teacher-only gate); the class row exists for everyone. */
function scriptDb() {
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM teacher_assignments ta/.test(sql) && /membership_role = 'TEACHER'/.test(sql)) return { rows: params[0] === TEACHER ? [{ id: CLASS }] : [] };
    if (/FROM classes c JOIN institutions i/.test(sql)) return { rows: [{ id: CLASS, name: '9A', institution_id: 'inst', institution_name: 'School', grade_name: null, canonical_subject_id: null, subject_name: null }] };
    return { rows: [] };
  });
}
const get = (qs: string) => (GET as any)(new NextRequest(`http://localhost/api/teacher/exam-insights?${qs}`));
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  vi.clearAllMocks();
  scriptDb();
  vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: TEACHER } as any);
  // The roster guard (canAccessClass) admits the class's Teacher AND its institution's admins.
  vi.mocked(getTeacherClassRoster).mockResolvedValue([{ studentId: ANA, name: 'Ana' }, { studentId: BEA, name: 'Bea' }]);
  vi.mocked(examGapsFor).mockResolvedValue(GAPS as any);
  vi.mocked(examGoalsFor).mockResolvedValue(GOALS as any);
});

describe('TE-2 service: the class\'s Teacher only', () => {
  it('the Teacher of the class gets per-Student gaps and goals, limited to the ACTIVE roster', async () => {
    const r = await getTeacherClassExamInsights(TEACHER, CLASS, { family: 'PISA' });
    expect(r.klass.id).toBe(CLASS);
    expect(r.students.map((s) => s.studentId)).toEqual([ANA, BEA]);
    expect(examGapsFor).toHaveBeenCalledWith([ANA, BEA], { families: ['PISA'], includePerStudent: true });
    expect(examGoalsFor).toHaveBeenCalledWith([ANA, BEA], { includePerStudent: true });
  });

  it('a Coordinator (institution admin) is refused although the roster guard would admit them; nothing is read', async () => {
    await expect(getTeacherClassExamInsights(COORDINATOR, CLASS)).rejects.toBeInstanceOf(TeacherExamInsightsAccessDeniedError);
    expect(getTeacherClassRoster).not.toHaveBeenCalled();
    expect(examGapsFor).not.toHaveBeenCalled();
    expect(examGoalsFor).not.toHaveBeenCalled();
  });

  it('a Teacher of another class is refused; nothing is read', async () => {
    await expect(getTeacherClassExamInsights(OTHER_TEACHER, CLASS)).rejects.toBeInstanceOf(TeacherExamInsightsAccessDeniedError);
    expect(getTeacherClassRoster).not.toHaveBeenCalled();
    expect(examGapsFor).not.toHaveBeenCalled();
  });

  it('the roster guard still applies: if it refuses, the result is a denial and no gaps are read', async () => {
    vi.mocked(getTeacherClassRoster).mockRejectedValue(new Error('denied'));
    await expect(getTeacherClassExamInsights(TEACHER, CLASS)).rejects.toBeInstanceOf(TeacherExamInsightsAccessDeniedError);
    expect(examGapsFor).not.toHaveBeenCalled();
  });

  it('an empty class reads no AICE plans', async () => {
    vi.mocked(getTeacherClassRoster).mockResolvedValue([]);
    const r = await getTeacherClassExamInsights(TEACHER, CLASS);
    expect(r.aice).toEqual([]);
    expect(query.mock.calls.some(([sql]) => /aice_diploma_plans/.test(String(sql)))).toBe(false);
  });
});

describe('TE-2 route: GET /api/teacher/exam-insights', () => {
  it('the class Teacher gets 200 with the same payload shape as before', async () => {
    const res = await get(`classId=${CLASS}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(['aice', 'classId', 'gaps', 'goals', 'students']);
    expect(body.data.gaps.perStudent[0].studentId).toBe(ANA);
  });

  it('a Coordinator gets 403 and no per-Student data is read', async () => {
    vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: COORDINATOR } as any);
    const res = await get(`classId=${CLASS}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    expect(getTeacherClassRoster).not.toHaveBeenCalled();
    expect(examGapsFor).not.toHaveBeenCalled();
  });

  it('a Teacher of another class gets 403', async () => {
    vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: OTHER_TEACHER } as any);
    expect((await get(`classId=${CLASS}`)).status).toBe(403);
    expect(examGapsFor).not.toHaveBeenCalled();
  });

  it('signed out is 401; a malformed class id or family is 400 before any read', async () => {
    expect((await get('classId=x')).status).toBe(400);
    expect((await get(`classId=${CLASS}&family=pisa;drop`)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    vi.mocked(requireActor).mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHORIZED' } as any);
    expect((await get(`classId=${CLASS}`)).status).toBe(401);
  });

  it('an unexpected failure is not reported as a denial', async () => {
    vi.mocked(examGapsFor).mockRejectedValue(new Error('database down'));
    await expect(get(`classId=${CLASS}`)).rejects.toThrow('database down');
  });
});

describe('TE-2 view model: one row per roster Student', () => {
  const students = [{ studentId: BEA, name: 'Bea' }, { studentId: ANA, name: 'Ana' }];
  it('joins gaps, goals and AICE entries by Student, most gaps first', () => {
    const rows = examInsightsByStudent({
      students,
      gaps: GAPS as any,
      goals: GOALS as any,
      aice: [{ student_id: BEA, syllabus_code: '9709', level: 'AS', expected_series_year: 2027, expected_series_month: 6, readiness: null }],
    });
    expect(rows.map((r) => r.studentId)).toEqual([ANA, BEA]);
    expect(rows[0]).toMatchObject({ gaps: 2, goals: [{ label: 'PISA' }], concepts: [{ canonicalConceptId: 'cc-1', name: 'Ratios' }], aice: [] });
    expect(rows[1]).toMatchObject({ gaps: 0, goals: [], concepts: [], aice: [{ syllabusCode: '9709', level: 'AS', series: '2027-06' }] });
  });
  it('a Student outside the roster never produces a row, whatever the aggregates contain', () => {
    const rows = examInsightsByStudent({
      students,
      gaps: { ...GAPS, perStudent: [...GAPS.perStudent, { studentId: OUTSIDER, gaps: 9, concepts: [] }] } as any,
      goals: { ...GOALS, perStudent: [{ studentId: OUTSIDER, goals: [{ objectiveKey: 'x', label: 'X', examDate: null }] }] } as any,
      aice: [{ student_id: OUTSIDER, syllabus_code: '9700', level: 'A', expected_series_year: null, expected_series_month: null, readiness: null }],
    });
    expect(rows.map((r) => r.studentId).sort()).toEqual([ANA, BEA].sort());
    expect(JSON.stringify(rows)).not.toContain(OUTSIDER);
  });
});

describe('TE-1: the individual practice form', () => {
  const concept = (canonicalConceptId: string, topic: string, inLearnerPlan: boolean) => ({ canonicalConceptId, topic, inLearnerPlan }) as any;
  const view = {
    student: { id: ANA, name: 'Ana' },
    klass: { id: CLASS, name: '9A', institutionId: 'i', institutionName: 'School', gradeName: null, subjectId: 's', subjectName: 'Mathematics' },
    concepts: [concept('cc-1', 'Ratios', true), concept('cc-2', 'Fractions', false), concept('cc-3', 'Percent', true)],
  };

  it('offers only the learner\'s own concepts of the class subject that are in their plan', async () => {
    const resolve = vi.fn(async (_s: string, canonical: string) => (canonical === 'cc-1' ? 'own-1' : null));
    const out = await listIndividualAssignmentConcepts(view, resolve);
    expect(out).toEqual([{ conceptId: 'own-1', label: 'Ratios', subjectName: 'Mathematics' }]);
    // Never resolved for a topic outside the learner's plan, and always for THIS learner.
    expect(resolve.mock.calls.map((c) => c[1])).toEqual(['cc-1', 'cc-3']);
    expect(resolve.mock.calls.every((c) => c[0] === ANA)).toBe(true);
  });

  it('is mounted on the class-scoped learner page, fed from the authorized view', () => {
    const page = strip(read('src/app/dashboard/teacher/classes/[classId]/students/[studentId]/page.tsx'));
    expect(page).toMatch(/import \{ AssignInterventionForm \} from '@\/app\/dashboard\/teacher\/students\/AssignInterventionForm'/);
    expect(page).toMatch(/<AssignInterventionForm\s+classId=\{classId\}\s+studentId=\{studentId\}\s+concepts=\{ownConcepts\}/);
    expect(page).toMatch(/listIndividualAssignmentConcepts\(view\)/);
    // The view is read (and authorized) before anything is derived from it.
    expect(page.indexOf('getTeacherLearnerView(actor.id, classId, studentId)')).toBeLessThan(page.indexOf('listIndividualAssignmentConcepts(view)'));
    // Not the cross-subject picker: that one lists every subject of the learner.
    expect(page).not.toMatch(/listLearnerConceptsForTeacher/);
  });

  it('posts to the scoped route with the class and the learner, and nothing else decides authorization', () => {
    const form = strip(read('src/app/dashboard/teacher/students/AssignInterventionForm.tsx'));
    expect(form).toMatch(/fetch\('\/api\/teacher\/interventions'/);
    expect(form).toMatch(/classId,\s+studentId,\s+interventionType: 'CONCEPT_REINFORCEMENT'/);
  });
});

describe('L8 surfaces: scope and wiring', () => {
  it('the exam-insights page uses the teacher-only service and answers not-found on denial', () => {
    const page = strip(read('src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx'));
    expect(page).toMatch(/getTeacherClassExamInsights\(actor\.id, classId/);
    expect(page).toMatch(/error instanceof TeacherExamInsightsAccessDeniedError\) notFound\(\)/);
    expect(page).not.toMatch(/canAccessClass|canAccessInstitution|getTeacherClassRoster|examGapsFor/);
    // The family filter only ever takes a validated value.
    expect(page).toMatch(/FAMILY_RE\.test\(requested\)/);
  });

  it('the service gates on getTeacherClass before the roster, never on canAccessClass directly', () => {
    const service = strip(read('src/lib/teacher/exam-insights.service.ts'));
    expect(service).not.toMatch(/canAccessClass|canAccessInstitution/);
    expect(service.indexOf('getTeacherClass(actorUserId, classId)')).toBeGreaterThan(-1);
    expect(service.indexOf('getTeacherClass(actorUserId, classId)')).toBeLessThan(service.indexOf('getTeacherClassRoster(actorUserId, classId)'));
  });

  it('the class sub-navigation links the view and every class page passes its locale', () => {
    expect(strip(read('src/app/dashboard/teacher/classes/[classId]/TeacherClassSubNav.tsx'))).toMatch(/\{ key: 'exams', href: `\$\{base\}\/exam-insights` \}/);
    for (const p of ['page.tsx', 'plan/page.tsx', 'students/page.tsx', 'assignments/page.tsx', 'progress/page.tsx', 'exam-insights/page.tsx']) {
      const src = strip(read(`src/app/dashboard/teacher/classes/[classId]/${p}`));
      const uses = src.match(/<ClassChrome [^>]*\/>/g) ?? [];
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u).toMatch(/locale=\{locale\}/);
    }
  });

  it('every locale has every L8 string, none empty', () => {
    const keys = Object.keys(TEACHER_L8_MESSAGES.es).sort();
    for (const [locale, messages] of Object.entries(TEACHER_L8_MESSAGES)) {
      expect(Object.keys(messages).sort(), locale).toEqual(keys);
      for (const k of keys) expect((messages as Record<string, string>)[k].trim().length, `${locale}:${k}`).toBeGreaterThan(0);
    }
  });
});
