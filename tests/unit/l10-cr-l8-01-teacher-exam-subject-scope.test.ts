/**
 * CR-L8-01 (Orchestrator) -- GLOBAL CLOSE.
 *
 * Teacher exam-gap visibility is scoped by BOTH the authorized class/student AND the authorized academic
 * subject. A Mathematics teacher must not receive Reading gaps.
 *
 * Three parts now meet:
 *   L2  `examGapsFor(..., { canonicalSubjectIds })` builds every aggregate from in-subject objectives only.
 *   L10 `getTeacherClassExamGaps` ALWAYS passes `canonicalSubjectIds` on the Teacher path -- `[subject]`, or
 *       `[]` for a class with no governed subject -- and verifies what comes back.
 *   L8  reads exam data only through `getTeacherClassExamGaps` and renders the scoped aggregates.
 *
 * Required regressions:
 *   1. the Mathematics Teacher receives only Mathematics domain / objective / concept aggregates
 *   2. Reading objectives / gaps of the same learner are absent
 *   3. a multi-subject exam returns only the authorized subject slice
 *   4. a class with no linked canonical subject returns empty scoped aggregates, never unscoped data
 *   5. a Coordinator cannot use the Teacher route
 *   6. the existing Institution / internal unscoped caller remains compatible
 *   7. the L8 concept / exam assignment subject-scope tests stay green (tests/unit/l8*.test.ts, run with this file)
 *
 * The exam bridge is a stand-in built from L2's OWN pure authorities -- `subjectScopeOf`,
 * `scopeGapRowsToSubjects`, `aggregateGapRows` -- over fixture gap rows of ONE multi-subject exam, so the
 * aggregation and the subject cut exercised here are L2's real code. Everything else is real: the L10 guards,
 * the shared entry point, the L8 service and the route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const { MATHS, READING, C_MATH, C_READ, CLASS_MATHS, CLASS_READING, CLASS_NO_SUBJECT, CLASS_OTHER, ANA, BEN, h, world } = vi.hoisted(() => {
  const MATHS = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const READING = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const C_MATH = 'c0000000-0000-4000-8000-000000000001';
  const C_READ = 'c0000000-0000-4000-8000-000000000002';
  const CLASS_MATHS = '11111111-1111-4111-8111-111111111111';
  const CLASS_READING = '22222222-2222-4222-8222-222222222222';
  const CLASS_NO_SUBJECT = '33333333-3333-4333-8333-333333333333';
  const CLASS_OTHER = '44444444-4444-4444-8444-444444444444';
  const ANA = 'd0000000-0000-4000-8000-000000000001';
  const BEN = 'd0000000-0000-4000-8000-000000000002';
  const h = { actor: 'maths-teacher', examGapsFor: null as any, examGoalsFor: null as any };
  const world = {
    classes: { [CLASS_MATHS]: MATHS, [CLASS_READING]: READING, [CLASS_NO_SUBJECT]: null, [CLASS_OTHER]: MATHS } as Record<string, string | null>,
    /** actor -> classes they TEACH (approved TEACHER membership + active assignment + active role) */
    teaches: { 'maths-teacher': [CLASS_MATHS, CLASS_NO_SUBJECT], 'reading-teacher': [CLASS_READING] } as Record<string, string[]>,
    /** institution admins: they coordinate the institution of every class, and teach none */
    coordinators: ['coordinator'],
    roster: { [CLASS_MATHS]: [ANA], [CLASS_READING]: [ANA], [CLASS_NO_SUBJECT]: [ANA], [CLASS_OTHER]: [BEN] } as Record<string, string[]>,
    concepts: { [C_MATH]: MATHS, [C_READ]: READING } as Record<string, string>,
  };
  return { MATHS, READING, C_MATH, C_READ, CLASS_MATHS, CLASS_READING, CLASS_NO_SUBJECT, CLASS_OTHER, ANA, BEN, h, world };
});

vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_: string, fn: any) => fn }));
vi.mock('@/lib/exam-core/route-auth', () => ({ requireActor: async () => ({ ok: true, actorUserId: h.actor }) }));
vi.mock('@/lib/exam-core/exam-gaps.service', async (original) => ({
  ...(await original<typeof import('@/lib/exam-core/exam-gaps.service')>()),
  examGapsFor: (...a: any[]) => h.examGapsFor(...a),
  examGoalsFor: (...a: any[]) => h.examGoalsFor(...a),
}));
vi.mock('@/lib/db', () => {
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ');
    // resolveTeacherClassScope: TEACHER of this exact class only
    if (/FROM classes c JOIN institutions i .*im\.membership_role = 'TEACHER'/.test(s)) {
      const [actor, classId] = p;
      return (world.teaches[actor] ?? []).includes(classId) ? { rows: [{ class_id: classId, institution_id: 'inst-1', canonical_subject_id: world.classes[classId] }] } : { rows: [] };
    }
    // getTeacherClass (L8 service): TEACHER_CLASS_SQL, then the class row
    if (/SELECT 1 FROM \( SELECT DISTINCT c\.id FROM teacher_assignments ta/.test(s)) return { rows: (world.teaches[p[0]] ?? []).includes(p[1]) ? [{ id: p[1] }] : [] };
    if (/FROM classes c JOIN institutions i ON i\.id = c\.institution_id LEFT JOIN grades g/.test(s)) return { rows: [{ id: p[0], name: 'Class', institution_id: 'inst-1', institution_name: 'School', grade_name: null, canonical_subject_id: world.classes[p[0]], subject_name: null }] };
    if (/SELECT student_id FROM class_enrollments WHERE class_id = \$1 AND status = 'ACTIVE'/.test(s)) return { rows: (world.roster[p[0]] ?? []).map((student_id) => ({ student_id })) };
    if (/FROM class_enrollments ce JOIN students s ON s\.id = ce\.student_id/.test(s)) return { rows: (world.roster[p[0]] ?? []).map((id) => ({ id, name: `name-${id.slice(-1)}`, email: null })) };
    if (/FROM canonical_concepts WHERE id = ANY\(\$1::uuid\[\]\) AND canonical_subject_id = \$2/.test(s)) return { rows: (p[0] as string[]).filter((id) => world.concepts[id] === p[1]).map((id) => ({ id })) };
    // canAccessInstitution (the coordinator branch of canAccessClass) -- must never be what admits anyone here
    if (/membership_role = 'INSTITUTION_ADMIN'/.test(s)) return { rows: world.coordinators.includes(p[0]) ? [{ ok: 1 }] : [] };
    return { rows: [] };
  };
  return { db: { query }, query };
});

import { NextRequest } from 'next/server';
import { GET as examInsightsGET } from '@/app/api/teacher/exam-insights/route';
import { getTeacherClassExamGaps, scopeExamGapsToSubject, TeacherExamScopeDeniedError } from '@/lib/authorization/teacher-exam-scope';
import { resolveTeacherClassScope } from '@/lib/authorization';
import { getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { getTeacherClassExamInsights, examInsightsByStudent } from '@/lib/teacher/exam-insights.service';
import { aggregateGapRows, scopeGapRowsToSubjects, subjectScopeOf, type GapRow } from '@/lib/exam-core/exam-gaps.service';

const gapRow = (student_id: string, code: string, description: string, domain: string, concept: [string, string, string] | null): GapRow => ({
  student_id, family: 'PAA', exam: 'PAA', objective_id: `lo-${code}`, code, description, domain,
  canonical_concept_id: concept?.[0] ?? null, concept_name: concept?.[1] ?? null, canonical_subject_id: concept?.[2] ?? null, student_concept_id: null,
});
const math: [string, string, string] = [C_MATH, 'Ecuaciones lineales', MATHS];
const read: [string, string, string] = [C_READ, 'Inferencia', READING];
/** ONE multi-subject exam (PAA). Ana: a Mathematics gap, a Reading gap, an objective mapped to BOTH subjects, and one with no published concept. */
const GAP_ROWS: GapRow[] = [
  gapRow(ANA, 'M-ALG-1', 'Resolver ecuaciones lineales', 'Matemáticas', math),
  gapRow(ANA, 'L-INF-2', 'Inferir el propósito del autor', 'Lectura y Redacción', read),
  gapRow(ANA, 'X-MIX-9', 'Interpretar un texto con datos numéricos', 'Razonamiento', math),
  gapRow(ANA, 'X-MIX-9', 'Interpretar un texto con datos numéricos', 'Razonamiento', read),
  gapRow(ANA, 'U-0', 'Objetivo sin concepto publicado', 'Otros', null),
  gapRow(BEN, 'M-ALG-1', 'Resolver ecuaciones lineales', 'Matemáticas', math),
];
/** The bridge, as L2 defines it: subject scope, then aggregation. */
const bridge = async (ids: string[], opts: { includePerStudent: boolean; canonicalSubjectIds?: readonly string[] }) =>
  aggregateGapRows(scopeGapRowsToSubjects(GAP_ROWS.filter((r) => ids.includes(r.student_id)), subjectScopeOf(opts.canonicalSubjectIds)), opts.includePerStudent);

const get = (classId: string) => examInsightsGET(new NextRequest(`https://t.test/api/teacher/exam-insights?classId=${classId}`));
const dataOf = async (classId: string) => (await ((await get(classId)) as any).json()).data;
const READING_LEAKS = ['Inferencia', 'Lectura', 'L-INF-2', 'Inferir', C_READ, READING];

beforeEach(() => {
  h.actor = 'maths-teacher';
  h.examGapsFor = vi.fn(bridge);
  h.examGoalsFor = vi.fn(async () => ({ studentsPreparing: 0, byFramework: [], byObjective: [], perStudent: [] }));
});

describe('the Teacher path ALWAYS supplies the subject scope to the bridge', () => {
  it('a class with a canonical subject => canonicalSubjectIds: [that subject]', async () => {
    await getTeacherClassExamGaps('maths-teacher', CLASS_MATHS, { family: 'PAA' });
    expect(h.examGapsFor).toHaveBeenCalledTimes(1);
    expect(h.examGapsFor).toHaveBeenCalledWith([ANA], { families: ['PAA'], includePerStudent: true, canonicalSubjectIds: [MATHS] });
  });

  it('a class with NO governed subject => canonicalSubjectIds: [] (a scope that matches nothing) -- never omitted', async () => {
    await getTeacherClassExamGaps('maths-teacher', CLASS_NO_SUBJECT);
    const opts = h.examGapsFor.mock.calls[0][1];
    expect(opts.canonicalSubjectIds).toEqual([]);
    expect('canonicalSubjectIds' in opts).toBe(true);
  });

  it('in the source there is exactly one bridge call on this path and it passes the option', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/authorization/teacher-exam-scope.ts'), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    expect(src.match(/examGapsFor\(/g)).toHaveLength(1);
    expect(src).toMatch(/const canonicalSubjectIds: string\[\] = scope\.canonicalSubjectId \? \[scope\.canonicalSubjectId\] : \[\];/);
    expect(src).toMatch(/examGapsFor\(studentIds, \{ families: [^}]*includePerStudent: true, canonicalSubjectIds \}\)/);
  });
});

describe('1. the Mathematics Teacher receives only Mathematics domain / objective / concept aggregates', () => {
  it('domain, objective, concept and per-student aggregates are all present, and all Mathematics', async () => {
    const res: any = await get(CLASS_MATHS);
    expect(res.status).toBe(200);
    const { gaps, students } = (await res.json()).data;
    expect(students.map((s: any) => s.studentId)).toEqual([ANA]);
    expect(gaps.byDomain).toEqual([
      { family: 'PAA', exam: 'PAA', domain: 'Matemáticas', students: 1 },
      { family: 'PAA', exam: 'PAA', domain: 'Razonamiento', students: 1 },
    ]);
    expect(gaps.byObjective.map((o: any) => o.code).sort()).toEqual(['M-ALG-1', 'X-MIX-9']);
    expect(gaps.byConcept).toEqual([{ canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', students: 1, studentIds: [ANA] }]);
    expect(gaps.perStudent).toEqual([{ studentId: ANA, gaps: 2, concepts: [{ canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', studentConceptId: null }] }]);
    expect(gaps.studentsWithResults).toBe(1);
    expect(gaps.subjectScope).toEqual({ canonicalSubjectId: MATHS, objectiveAggregates: 'SUBJECT_SCOPED' });
  });

  it('the Reading teacher of the same student receives the Reading aggregates, and only those', async () => {
    h.actor = 'reading-teacher';
    const { gaps } = await dataOf(CLASS_READING);
    expect(gaps.byDomain.map((d: any) => d.domain).sort()).toEqual(['Lectura y Redacción', 'Razonamiento']);
    expect(gaps.byObjective.map((o: any) => o.code).sort()).toEqual(['L-INF-2', 'X-MIX-9']);
    expect(gaps.byConcept.map((c: any) => c.canonicalConceptId)).toEqual([C_READ]);
    const text = JSON.stringify(gaps);
    for (const leak of ['Ecuaciones lineales', 'M-ALG-1', 'Matemáticas', C_MATH]) expect(text).not.toContain(leak);
  });
});

describe('2. Reading objectives / gaps of the same learner are absent', () => {
  it('no Reading concept, objective, domain or count anywhere in the Mathematics teacher\'s response', async () => {
    const body = JSON.stringify(await dataOf(CLASS_MATHS));
    for (const leak of READING_LEAKS) expect(body).not.toContain(leak);
  });

  it('the per-student gap count is the in-subject one (2 Mathematics objectives), not the learner\'s 4 gap objectives', async () => {
    const { gaps } = await dataOf(CLASS_MATHS);
    expect(gaps.perStudent[0].gaps).toBe(2);
    expect((await bridge([ANA], { includePerStudent: true })).perStudent[0].gaps).toBe(4); // what an unscoped read holds
  });

  it('an objective with no published concept mapping is omitted (it cannot be attributed to a subject)', async () => {
    const body = JSON.stringify(await dataOf(CLASS_MATHS));
    expect(body).not.toContain('U-0');
    expect(body).not.toContain('Objetivo sin concepto publicado');
    expect(body).not.toContain('Otros');
  });
});

describe('3. a multi-subject exam returns only the authorized subject slice', () => {
  it('one exam (PAA) holds both subjects; the Mathematics teacher gets the Mathematics slice of it', async () => {
    const { gaps } = await dataOf(CLASS_MATHS);
    expect(new Set(gaps.byDomain.map((d: any) => d.exam))).toEqual(new Set(['PAA']));
    expect(gaps.byObjective).toHaveLength(2); // of the 4 gap objectives of that one exam
  });

  it('an objective mapped to concepts of BOTH subjects contributes only its in-subject slice to each teacher', async () => {
    const maths = (await dataOf(CLASS_MATHS)).gaps;
    expect(maths.byObjective.find((o: any) => o.code === 'X-MIX-9')).toMatchObject({ students: 1 });
    expect(maths.perStudent[0].concepts.map((c: any) => c.canonicalConceptId)).toEqual([C_MATH]); // never the Reading concept of that objective
    h.actor = 'reading-teacher';
    const reading = (await dataOf(CLASS_READING)).gaps;
    expect(reading.perStudent[0].concepts.map((c: any) => c.canonicalConceptId)).toEqual([C_READ]);
  });
});

describe('4. a class with no linked canonical subject returns empty scoped aggregates, never unscoped data', () => {
  it('200 with every aggregate empty', async () => {
    const res: any = await get(CLASS_NO_SUBJECT);
    expect(res.status).toBe(200);
    const { gaps } = (await res.json()).data;
    expect([gaps.studentsWithResults, gaps.byDomain, gaps.byObjective, gaps.byConcept, gaps.perStudent]).toEqual([0, [], [], [], []]);
    expect(gaps.subjectScope).toEqual({ canonicalSubjectId: null, objectiveAggregates: 'SUBJECT_SCOPED' });
  });

  it('the bridge was asked with an EMPTY scope -- the same learner has gaps, and an unscoped call would have returned them', async () => {
    await get(CLASS_NO_SUBJECT);
    expect(h.examGapsFor.mock.calls[0][1].canonicalSubjectIds).toEqual([]);
    expect((await bridge([ANA], { includePerStudent: true })).byObjective.length).toBeGreaterThan(0);
  });

  it('fails closed even if the bridge ignored the scope: nothing is passed on for a class without a subject', async () => {
    h.examGapsFor = vi.fn(async (ids: string[]) => bridge(ids, { includePerStudent: true })); // a bridge that returns everything
    const { gaps } = await dataOf(CLASS_NO_SUBJECT);
    expect([gaps.byDomain, gaps.byObjective, gaps.byConcept, gaps.perStudent]).toEqual([[], [], [], []]);
  });
});

describe('fail closed: the bridge\'s answer is verified, not trusted', () => {
  it('if the bridge returns ANY concept outside the requested subject, the whole answer is discarded -- its domain / objective rows are unscoped too', async () => {
    h.examGapsFor = vi.fn(async (ids: string[]) => bridge(ids, { includePerStudent: true })); // ignores canonicalSubjectIds
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gaps } = await dataOf(CLASS_MATHS);
    err.mockRestore();
    expect([gaps.studentsWithResults, gaps.byDomain, gaps.byObjective, gaps.byConcept, gaps.perStudent]).toEqual([0, [], [], [], []]);
  });

  it('if the bridge returns a learner outside the class roster, the answer is discarded', async () => {
    h.examGapsFor = vi.fn(async () => bridge([ANA, BEN], { includePerStudent: true, canonicalSubjectIds: [MATHS] }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gaps } = await getTeacherClassExamGaps('maths-teacher', CLASS_MATHS);
    err.mockRestore();
    expect(JSON.stringify(gaps)).not.toContain(BEN);
    expect(gaps.perStudent).toEqual([]);
  });

  it('scopeExamGapsToSubject: no subject => nothing; a clean in-subject aggregate passes through unchanged', async () => {
    const clean = await bridge([ANA], { includePerStudent: true, canonicalSubjectIds: [MATHS] });
    expect((await scopeExamGapsToSubject(clean, null)).perStudent).toEqual([]);
    const passed = await scopeExamGapsToSubject(clean, MATHS);
    expect([passed.byDomain, passed.byObjective, passed.byConcept, passed.perStudent]).toEqual([clean.byDomain, clean.byObjective, clean.byConcept, clean.perStudent]);
  });

  it('only the class roster is ever passed to the bridge', async () => {
    await getTeacherClassExamGaps('maths-teacher', CLASS_MATHS);
    expect(h.examGapsFor.mock.calls[0][0]).toEqual([ANA]);
  });
});

describe('unrelated class => hidden', () => {
  it('a teacher of another class gets 403 and the bridge is never queried for that class\'s students', async () => {
    const res: any = await get(CLASS_OTHER);
    expect(res.status).toBe(403);
    expect(h.examGapsFor).not.toHaveBeenCalled();
    await expect(getTeacherClassExamGaps('maths-teacher', CLASS_OTHER)).rejects.toBeInstanceOf(TeacherExamScopeDeniedError);
    await expect(getTeacherClassExamGaps('maths-teacher', CLASS_READING)).rejects.toBeInstanceOf(TeacherExamScopeDeniedError); // same student, not their class
    expect(await resolveTeacherClassScope('maths-teacher', CLASS_OTHER)).toBeNull();
  });
});

describe('5. a Coordinator cannot use the Teacher route', () => {
  beforeEach(() => {
    h.actor = 'coordinator';
  });

  it('GET /api/teacher/exam-insights => 403 for the institution\'s own coordinator; nothing is read', async () => {
    for (const classId of [CLASS_MATHS, CLASS_READING, CLASS_OTHER, CLASS_NO_SUBJECT]) expect(((await get(classId)) as any).status).toBe(403);
    expect(h.examGapsFor).not.toHaveBeenCalled();
    expect(h.examGoalsFor).not.toHaveBeenCalled();
  });

  it('the shared entry point, the L8 service and the Teacher roster read model all refuse the coordinator', async () => {
    await expect(getTeacherClassExamGaps('coordinator', CLASS_MATHS)).rejects.toBeInstanceOf(TeacherExamScopeDeniedError);
    await expect(getTeacherClassExamInsights('coordinator', CLASS_MATHS)).rejects.toThrow(/not a teacher/);
    await expect(getTeacherClassRoster('coordinator', CLASS_MATHS)).rejects.toThrow(/not authorized/);
    expect((await getTeacherClassRoster('maths-teacher', CLASS_MATHS)).map((r) => r.studentId)).toEqual([ANA]);
  });

  it('the teacher scope is resolved from a TEACHER membership only -- its query never consults an INSTITUTION_ADMIN membership', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function resolveTeacherClassScope'), src.indexOf('export async function teacherSubjectScopeForLearner'));
    expect(fn).toMatch(/im\.membership_role = 'TEACHER'/);
    expect(fn).not.toMatch(/INSTITUTION_ADMIN|canAccessInstitution|canAccessClass/);
    expect(readFileSync(join(process.cwd(), 'src/lib/teacher/read-model.service.ts'), 'utf8')).not.toMatch(/canAccessClass\(/);
  });
});

describe('6. the existing Institution / internal unscoped caller remains compatible', () => {
  it('omitting canonicalSubjectIds is still the unscoped behaviour: every gap, including unmapped objectives', async () => {
    const unscoped = await bridge([ANA], { includePerStudent: false });
    expect(unscoped.byObjective.map((o) => o.code).sort()).toEqual(['L-INF-2', 'M-ALG-1', 'U-0', 'X-MIX-9']);
    expect(unscoped.byDomain.map((d) => d.domain).sort()).toEqual(['Lectura y Redacción', 'Matemáticas', 'Otros', 'Razonamiento']);
    expect(subjectScopeOf(undefined)).toBeNull();
    expect(subjectScopeOf([])).toEqual([]);
  });

  it('the Institution route still calls the bridge without a subject scope, for aggregates only (no per-student data)', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/institutions/[id]/intelligence/exam-insights/route.ts'), 'utf8');
    const call = route.slice(route.indexOf('examGapsFor(ids,'), route.indexOf(')', route.indexOf('examGapsFor(ids,')) + 1);
    expect(call).toMatch(/includePerStudent: false/);
    expect(call).not.toMatch(/canonicalSubjectIds/);
  });

  it('the Teacher path and the Institution route are the ONLY callers of the bridge in application code', () => {
    const root = process.cwd();
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
    const callers = walk(join(root, 'src')).filter((f) => !f.endsWith('exam-gaps.service.ts') && /\bexamGapsFor\s*\(/.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''))).map((f) => f.slice(root.length + 1)).sort();
    expect(callers).toEqual(['src/app/api/institutions/[id]/intelligence/exam-insights/route.ts', 'src/lib/authorization/teacher-exam-scope.ts']);
  });
});

describe('L8 reads exam data only through the shared entry point, and shows the scoped aggregates', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
  const root = process.cwd();
  const teacherFiles = () => [...walk(join(root, 'src/app/api/teacher')), ...walk(join(root, 'src/lib/teacher')), ...walk(join(root, 'src/app/dashboard/teacher'))];
  const code = (f: string) => readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

  it('no Teacher route, page or read model calls examGapsFor directly', () => {
    expect(teacherFiles().filter((f) => /\bexamGapsFor\s*\(/.test(code(f))).map((f) => f.slice(root.length + 1))).toEqual([]);
  });

  it('the L8 service returns the scoped domain / objective / concept / per-student aggregates of the shared entry point, unchanged', async () => {
    const view = await getTeacherClassExamInsights('maths-teacher', CLASS_MATHS);
    const direct = await getTeacherClassExamGaps('maths-teacher', CLASS_MATHS);
    expect(view.gaps).toEqual(direct.gaps);
    expect(view.gaps.byDomain.length).toBeGreaterThan(0);
    expect(view.gaps.byObjective.length).toBeGreaterThan(0);
    expect(examInsightsByStudent(view)).toEqual([{ studentId: ANA, name: 'name-1', gaps: 1, concepts: [{ canonicalConceptId: C_MATH, name: 'Ecuaciones lineales' }] }]);
  });

  it('the page renders the area, objective, topic and per-student sections', () => {
    const page = code(join(root, 'src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx'));
    for (const fragment of ["gaps.byDomain.slice(0, TOP).map", "gaps.byObjective.slice(0, TOP).map", "gaps.byConcept.slice(0, TOP).map", "rows.map((r) =>", "m['l8.exams.domains.title']", "m['l8.exams.objectives.title']"]) expect(page).toContain(fragment);
  });
});

describe('still withheld: exam goals and AICE entries (no governed subject mapping)', () => {
  it('a Teacher receives no exam goals and no AICE entries, and is told so; domain / objective aggregates are no longer withheld', async () => {
    const data = await dataOf(CLASS_MATHS);
    expect(data.goals).toEqual({ studentsPreparing: 0, byFramework: [], byObjective: [], perStudent: [] });
    expect(data.aice).toEqual([]);
    expect([...data.withheld].sort()).toEqual(['AICE_ENTRIES', 'EXAM_GOALS']);
    expect(h.examGoalsFor).not.toHaveBeenCalled();
  });

  it('no Teacher route, page or read model reads exam goals or AICE plan entries for itself', () => {
    const root = process.cwd();
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
    const files = [...walk(join(root, 'src/app/api/teacher')), ...walk(join(root, 'src/lib/teacher')), ...walk(join(root, 'src/app/dashboard/teacher'))];
    const offenders = files.filter((f) => /\bexamGoalsFor\s*\(|aice_plan_entries|aice_diploma_plans/.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, ''))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the page does not render goals or AICE, and says what is withheld', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(page).not.toMatch(/goals|aice/i);
    expect(page).toMatch(/withheld\.length > 0 && <p className="ta-msg">\{m\['l8\.exams\.withheld'\]\}/);
  });
});
