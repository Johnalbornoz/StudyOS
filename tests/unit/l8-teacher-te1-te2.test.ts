/**
 * L8 -- TE-1 (the individual practice form is mounted on the Teacher's
 * learner page) and TE-2 (class exam insights, for the class's Teacher only).
 *
 * The exam-insights tests run the REAL shared entry point
 * (`getTeacherClassExamGaps`, L10) and the REAL teacher gates against a
 * scripted database; only the exam bridge and the roster read are replaced.
 * So "a Coordinator is refused" and "only the class subject comes back" are
 * proven on the code that decides them.
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
const SUBJ_MATH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CC_MATH = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const CC_READ = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const TEACHER = 'teacher-user';
const COORDINATOR = 'coordinator-user';
const OTHER_TEACHER = 'other-class-teacher';

/** What the exam bridge returns for the roster: Ana has a Mathematics gap AND a Reading gap; an off-roster Student too. */
const BRIDGE = {
  studentsWithResults: 2,
  byDomain: [{ family: 'PISA', exam: 'PISA', domain: 'Reading', students: 1 }],
  byObjective: [{ family: 'PISA', exam: 'PISA', code: 'R1', description: 'Inference', students: 1 }],
  byConcept: [
    { canonicalConceptId: CC_MATH, name: 'Ratios', students: 1, studentIds: [ANA] },
    { canonicalConceptId: CC_READ, name: 'Inference', students: 2, studentIds: [ANA, OUTSIDER] },
  ],
  perStudent: [
    { studentId: ANA, gaps: 2, concepts: [{ canonicalConceptId: CC_MATH, name: 'Ratios', studentConceptId: null }, { canonicalConceptId: CC_READ, name: 'Inference', studentConceptId: null }] },
    { studentId: OUTSIDER, gaps: 1, concepts: [{ canonicalConceptId: CC_READ, name: 'Inference', studentConceptId: null }] },
  ],
};

let classSubject: string | null = SUBJ_MATH;
/** Scripts the database: only TEACHER teaches CLASS (a Mathematics class); Ana and Bea are its ACTIVE roster. */
function scriptDb() {
  query.mockImplementation(async (sql: string, params: any[] = []) => {
    // L10 resolveTeacherClassScope: the teacher-only gate of the shared entry point
    if (/FROM classes c\s+JOIN institutions i ON i\.id = c\.institution_id AND i\.status = 'ACTIVE'\s+JOIN institution_memberships im/.test(sql)) {
      return { rows: params[0] === TEACHER && params[1] === CLASS ? [{ class_id: CLASS, institution_id: 'inst', canonical_subject_id: classSubject }] : [] };
    }
    // class-assignment.service getTeacherClass: TEACHER_CLASS_SQL, then the class row
    if (/SELECT 1 FROM \(/.test(sql) && /FROM teacher_assignments ta/.test(sql)) return { rows: params[0] === TEACHER ? [{ id: CLASS }] : [] };
    if (/FROM classes c JOIN institutions i/.test(sql)) return { rows: [{ id: CLASS, name: '9A', institution_id: 'inst', institution_name: 'School', grade_name: null, canonical_subject_id: classSubject, subject_name: 'Mathematics' }] };
    if (/SELECT student_id FROM class_enrollments WHERE class_id = \$1 AND status = 'ACTIVE'/.test(sql)) return { rows: [{ student_id: ANA }, { student_id: BEA }] };
    if (/FROM canonical_concepts WHERE id = ANY\(\$1::uuid\[\]\) AND canonical_subject_id = \$2/.test(sql)) return { rows: params[1] === SUBJ_MATH ? (params[0] as string[]).filter((id) => id === CC_MATH).map((id) => ({ id })) : [] };
    return { rows: [] };
  });
}
const get = (qs: string) => (GET as any)(new NextRequest(`http://localhost/api/teacher/exam-insights?${qs}`));
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  vi.clearAllMocks();
  classSubject = SUBJ_MATH;
  scriptDb();
  vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: TEACHER } as any);
  vi.mocked(getTeacherClassRoster).mockResolvedValue([{ studentId: ANA, name: 'Ana' }, { studentId: BEA, name: 'Bea' }]);
  vi.mocked(examGapsFor).mockResolvedValue(BRIDGE as any);
});

describe('TE-2 service: the shared entry point, for the class\'s Teacher only', () => {
  it('the Teacher of the class gets the roster and only the gaps of the class subject', async () => {
    const r = await getTeacherClassExamInsights(TEACHER, CLASS, { family: 'PISA' });
    expect(r.klass.id).toBe(CLASS);
    expect(r.students.map((s) => s.studentId)).toEqual([ANA, BEA]);
    expect(examGapsFor).toHaveBeenCalledWith([ANA, BEA], { families: ['PISA'], includePerStudent: true });
    // Mathematics only: the same Student's Reading gap is gone at every level, and so is the off-roster Student.
    expect(r.gaps.byConcept.map((c) => c.canonicalConceptId)).toEqual([CC_MATH]);
    expect(r.gaps.perStudent).toEqual([{ studentId: ANA, gaps: 1, concepts: [expect.objectContaining({ canonicalConceptId: CC_MATH })] }]);
    expect(r.gaps.studentsWithResults).toBe(1);
    const text = JSON.stringify(r.gaps);
    for (const foreign of [CC_READ, 'Inference', 'Reading', OUTSIDER]) expect(text).not.toContain(foreign);
  });

  it('what the entry point withholds stays withheld: no area / objective totals, no goals, no AICE, and none is fetched here', async () => {
    const r = await getTeacherClassExamInsights(TEACHER, CLASS);
    expect(r.gaps.byDomain).toEqual([]);
    expect(r.gaps.byObjective).toEqual([]);
    expect(r.goals).toEqual({ studentsPreparing: 0, byFramework: [], byObjective: [], perStudent: [] });
    expect(r.aice).toEqual([]);
    expect([...r.withheld].sort()).toEqual(['AICE_ENTRIES', 'DOMAIN_AGGREGATES', 'EXAM_GOALS', 'OBJECTIVE_AGGREGATES']);
    expect(examGoalsFor).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => /aice_/.test(String(sql)))).toBe(false);
  });

  it('a class with no linked subject shows no gaps and the bridge is not asked', async () => {
    classSubject = null;
    const r = await getTeacherClassExamInsights(TEACHER, CLASS);
    expect(r.gaps.byConcept).toEqual([]);
    expect(r.gaps.perStudent).toEqual([]);
    expect(examGapsFor).not.toHaveBeenCalled();
  });

  it.each([['a Coordinator (institution admin)', COORDINATOR], ['a Teacher of another class', OTHER_TEACHER]])('%s is refused; no roster and no gaps are read', async (_who, actor) => {
    await expect(getTeacherClassExamInsights(actor, CLASS)).rejects.toBeInstanceOf(TeacherExamInsightsAccessDeniedError);
    expect(getTeacherClassRoster).not.toHaveBeenCalled();
    expect(examGapsFor).not.toHaveBeenCalled();
  });

  it('the roster guard still applies: if it refuses, the result is a denial', async () => {
    vi.mocked(getTeacherClassRoster).mockRejectedValue(new Error('denied'));
    await expect(getTeacherClassExamInsights(TEACHER, CLASS)).rejects.toBeInstanceOf(TeacherExamInsightsAccessDeniedError);
  });

  it('names are returned only for the learners the scoped result is about', async () => {
    vi.mocked(getTeacherClassRoster).mockResolvedValue([{ studentId: ANA, name: 'Ana' }, { studentId: OUTSIDER, name: 'Not on the scoped roster' }]);
    const r = await getTeacherClassExamInsights(TEACHER, CLASS);
    expect(r.students.map((s) => s.studentId)).toEqual([ANA]);
  });
});

describe('TE-2 route: GET /api/teacher/exam-insights (the L10 route, unchanged by L8)', () => {
  it('the class Teacher gets 200, gaps in the class subject only, and is told what is withheld', async () => {
    const res = await get(`classId=${CLASS}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(['aice', 'classId', 'gaps', 'goals', 'students', 'withheld']);
    expect(body.data.gaps.perStudent.map((p: any) => p.studentId)).toEqual([ANA]);
    expect(JSON.stringify(body.data)).not.toContain(CC_READ);
  });

  it.each([['a Coordinator', COORDINATOR], ['a Teacher of another class', OTHER_TEACHER]])('%s gets 403 and no per-Student data is read', async (_who, actor) => {
    vi.mocked(requireActor).mockResolvedValue({ ok: true, actorUserId: actor } as any);
    const res = await get(`classId=${CLASS}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    expect(examGapsFor).not.toHaveBeenCalled();
  });

  it('signed out is 401; a malformed class id or family is 400 before any read', async () => {
    expect((await get('classId=x')).status).toBe(400);
    expect((await get(`classId=${CLASS}&family=pisa;drop`)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    vi.mocked(requireActor).mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHORIZED' } as any);
    expect((await get(`classId=${CLASS}`)).status).toBe(401);
  });
});

describe('TE-2 view model: one row per roster Student', () => {
  const students = [{ studentId: BEA, name: 'Bea' }, { studentId: ANA, name: 'Ana' }];
  const gaps = (perStudent: any[]) => ({ perStudent }) as any;
  it('joins the in-subject gaps by Student, most gaps first', () => {
    const rows = examInsightsByStudent({ students, gaps: gaps([{ studentId: ANA, gaps: 1, concepts: [{ canonicalConceptId: CC_MATH, name: 'Ratios', studentConceptId: null }] }]) });
    expect(rows).toEqual([
      { studentId: ANA, name: 'Ana', gaps: 1, concepts: [{ canonicalConceptId: CC_MATH, name: 'Ratios' }] },
      { studentId: BEA, name: 'Bea', gaps: 0, concepts: [] },
    ]);
  });
  it('a Student outside the roster never produces a row, whatever the aggregate contains', () => {
    const rows = examInsightsByStudent({ students, gaps: gaps([{ studentId: OUTSIDER, gaps: 9, concepts: [{ canonicalConceptId: CC_READ, name: 'Inference', studentConceptId: null }] }]) });
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
  it('the exam-insights page uses the L8 service, answers not-found on denial and says what is withheld', () => {
    const page = strip(read('src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx'));
    expect(page).toMatch(/getTeacherClassExamInsights\(actor\.id, classId\)/);
    expect(page).toMatch(/error instanceof TeacherExamInsightsAccessDeniedError\) notFound\(\)/);
    expect(page).not.toMatch(/canAccessClass|canAccessInstitution|getTeacherClassRoster|examGapsFor|examGoalsFor|byDomain|byObjective|aice/);
    expect(page).toMatch(/withheld\.length > 0 && <p className="ta-msg">\{m\['l8\.exams\.withheld'\]\}/);
  });

  it('the L8 service reads exam data only through the shared entry point', () => {
    const service = strip(read('src/lib/teacher/exam-insights.service.ts'));
    expect(service).toMatch(/import \{ getTeacherClassExamGaps, TeacherExamScopeDeniedError, type TeacherClassExamGaps \} from '@\/lib\/authorization\/teacher-exam-scope'/);
    expect(service).toMatch(/getTeacherClassExamGaps\(actorUserId, classId, \{ family: opts\.family \}\)/);
    expect(service).not.toMatch(/exam-gaps\.service|examGapsFor|examGoalsFor|aice_|canAccessClass|canAccessInstitution|db\.query/);
    // Teacher gate first, then the entry point, then names.
    expect(service.indexOf('getTeacherClass(actorUserId, classId)')).toBeLessThan(service.indexOf('getTeacherClassExamGaps(actorUserId, classId'));
    expect(service.indexOf('getTeacherClassExamGaps(actorUserId, classId')).toBeLessThan(service.indexOf('getTeacherClassRoster(actorUserId, classId)'));
  });

  it('the route goes through the shared entry point and reads nothing else for itself', () => {
    const route = strip(read('src/app/api/teacher/exam-insights/route.ts'));
    expect(route).toMatch(/getTeacherClassExamGaps\(gate\.actorUserId, classId, \{ family \}\)/);
    expect(route).not.toMatch(/exam-gaps\.service|examGapsFor|examGoalsFor|aice_|db\.query/);
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
