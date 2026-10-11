/**
 * CR-L8-01 (Orchestrator) -- Teacher exam-gap visibility is scoped by BOTH the authorized class/student
 * AND the authorized academic subject. A Mathematics teacher must not receive Reading gaps.
 *
 * Required regressions:
 *   - authorized class + matching subject  => visible
 *   - authorized class + different subject => hidden
 *   - unrelated class                      => hidden
 *   - Coordinator cannot use the Teacher route as a bypass
 *
 * The world below is a small relational fixture behind the real guards and the real route; the exam
 * bridge (`examGapsFor`, L2-owned, not modified) is a spy that returns what it returns today: every gap
 * of the learners it is asked for, across all subjects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const { MATHS, READING, C_MATH, C_READ, C_UNKNOWN, CLASS_MATHS, CLASS_READING, CLASS_NO_SUBJECT, CLASS_OTHER, ANA, BEN, h, world } = vi.hoisted(() => {
  const MATHS = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const READING = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const C_MATH = 'c0000000-0000-4000-8000-000000000001';
  const C_READ = 'c0000000-0000-4000-8000-000000000002';
  const C_UNKNOWN = 'c0000000-0000-4000-8000-000000000003';
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
  return { MATHS, READING, C_MATH, C_READ, C_UNKNOWN, CLASS_MATHS, CLASS_READING, CLASS_NO_SUBJECT, CLASS_OTHER, ANA, BEN, h, world };
});

vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_: string, fn: any) => fn }));
vi.mock('@/lib/exam-core/route-auth', () => ({ requireActor: async () => ({ ok: true, actorUserId: h.actor }) }));
vi.mock('@/lib/exam-core/catalog/readiness-view', () => ({ stateSql: () => 'NULL' }));
vi.mock('@/lib/exam-core/exam-gaps.service', () => ({ examGapsFor: (...a: any[]) => h.examGapsFor(...a), examGoalsFor: (...a: any[]) => h.examGoalsFor(...a) }));
vi.mock('@/lib/db', () => {
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ');
    // resolveTeacherClassScope: TEACHER of this exact class only
    if (/FROM classes c JOIN institutions i .*im\.membership_role = 'TEACHER'/.test(s)) {
      const [actor, classId] = p;
      return (world.teaches[actor] ?? []).includes(classId) ? { rows: [{ class_id: classId, institution_id: 'inst-1', canonical_subject_id: world.classes[classId] }] } : { rows: [] };
    }
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

/** What the bridge returns today for Ana: a Maths gap AND a Reading gap, plus an objective with no concept. */
const anaAllSubjects = () => ({
  studentsWithResults: 1,
  byDomain: [{ family: 'PAA', exam: 'PAA', domain: 'Matemáticas', students: 1 }, { family: 'PAA', exam: 'PAA', domain: 'Lectura y Redacción', students: 1 }],
  byObjective: [{ family: 'PAA', exam: 'PAA', code: 'M-ALG-1', description: 'Resolver ecuaciones lineales', students: 1 }, { family: 'PAA', exam: 'PAA', code: 'L-INF-2', description: 'Inferir el propósito del autor', students: 1 }],
  byConcept: [
    { canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', students: 1, studentIds: [ANA] },
    { canonicalConceptId: C_READ, name: 'Inferencia', students: 1, studentIds: [ANA] },
    { canonicalConceptId: C_UNKNOWN, name: 'Concepto sin materia', students: 1, studentIds: [ANA] },
  ],
  perStudent: [{ studentId: ANA, gaps: 3, concepts: [
    { canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', studentConceptId: null },
    { canonicalConceptId: C_READ, name: 'Inferencia', studentConceptId: null },
    { canonicalConceptId: C_UNKNOWN, name: 'Concepto sin materia', studentConceptId: null },
  ] }],
});

const get = (classId: string) => examInsightsGET(new NextRequest(`https://t.test/api/teacher/exam-insights?classId=${classId}`));
const READING_LEAKS = ['Inferencia', 'Lectura', 'L-INF-2', 'Inferir', C_READ];

beforeEach(() => {
  h.actor = 'maths-teacher';
  h.examGapsFor = vi.fn(async (ids: string[]) => (ids.includes(ANA) ? anaAllSubjects() : { studentsWithResults: 0, byDomain: [], byObjective: [], byConcept: [], perStudent: [] }));
  h.examGoalsFor = vi.fn(async () => ({ studentsPreparing: 0, byFramework: [], byObjective: [], perStudent: [] }));
});

describe('authorized class + matching subject => visible', () => {
  it('the Mathematics teacher sees the Mathematics gap of a student of the class', async () => {
    const res: any = await get(CLASS_MATHS);
    expect(res.status).toBe(200);
    const { gaps, students } = (await res.json()).data;
    expect(students.map((s: any) => s.studentId)).toEqual([ANA]);
    expect(gaps.perStudent).toEqual([{ studentId: ANA, gaps: 1, concepts: [{ canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', studentConceptId: null }] }]);
    expect(gaps.byConcept).toEqual([{ canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', students: 1, studentIds: [ANA] }]);
    expect(gaps.studentsWithResults).toBe(1);
    expect(gaps.subjectScope).toEqual({ canonicalSubjectId: MATHS, objectiveAggregates: 'WITHHELD' });
  });

  it('the Reading teacher of the same student sees the Reading gap, and only that', async () => {
    h.actor = 'reading-teacher';
    const gaps = (await (await get(CLASS_READING) as any).json()).data.gaps;
    expect(gaps.perStudent[0].concepts.map((c: any) => c.canonicalConceptId)).toEqual([C_READ]);
    expect(JSON.stringify(gaps)).not.toContain('Ecuaciones lineales');
  });
});

describe('authorized class + different subject => hidden', () => {
  it('the Mathematics teacher receives nothing of the same student\'s Reading gaps -- no concept, no objective, no domain, no count', async () => {
    const body = JSON.stringify((await (await get(CLASS_MATHS) as any).json()).data);
    for (const leak of READING_LEAKS) expect(body).not.toContain(leak);
    const { gaps } = JSON.parse(body);
    expect(gaps.perStudent[0].gaps).toBe(1); // not 3: the bridge's count spans every subject
    expect(gaps.byDomain).toEqual([]);
    expect(gaps.byObjective).toEqual([]);
  });

  it('a gap whose concept has no confirmed subject is dropped (fails closed)', async () => {
    const body = JSON.stringify((await (await get(CLASS_MATHS) as any).json()).data);
    expect(body).not.toContain(C_UNKNOWN);
    expect(body).not.toContain('Concepto sin materia');
  });

  it('a class with no linked subject shows no gaps at all, and the bridge is not even asked', async () => {
    const res: any = await get(CLASS_NO_SUBJECT);
    expect(res.status).toBe(200);
    const { gaps } = (await res.json()).data;
    expect([gaps.perStudent, gaps.byConcept, gaps.byDomain, gaps.byObjective]).toEqual([[], [], [], []]);
    expect(h.examGapsFor).not.toHaveBeenCalled();
  });

  it('scopeExamGapsToSubject: a student with only out-of-subject gaps disappears from the aggregate', async () => {
    const onlyReading = { ...anaAllSubjects(), byConcept: [anaAllSubjects().byConcept[1]], perStudent: [{ studentId: ANA, gaps: 1, concepts: [anaAllSubjects().perStudent[0].concepts[1]] }] };
    const scoped = await scopeExamGapsToSubject(onlyReading, MATHS);
    expect([scoped.studentsWithResults, scoped.perStudent, scoped.byConcept]).toEqual([0, [], []]);
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

  it('only the class roster is ever passed to the bridge, and a non-roster student it returned would be dropped', async () => {
    h.examGapsFor = vi.fn(async () => ({ ...anaAllSubjects(), perStudent: [...anaAllSubjects().perStudent, { studentId: BEN, gaps: 1, concepts: [{ canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', studentConceptId: null }] }], byConcept: [{ canonicalConceptId: C_MATH, name: 'Ecuaciones lineales', students: 2, studentIds: [ANA, BEN] }] }));
    const { gaps } = await getTeacherClassExamGaps('maths-teacher', CLASS_MATHS);
    expect(h.examGapsFor.mock.calls[0][0]).toEqual([ANA]);
    expect(JSON.stringify(gaps)).not.toContain(BEN);
    expect(gaps.byConcept[0]).toMatchObject({ students: 1, studentIds: [ANA] });
  });
});

describe('Coordinator cannot use the Teacher route as a bypass', () => {
  beforeEach(() => {
    h.actor = 'coordinator';
  });

  it('GET /api/teacher/exam-insights => 403 for the institution\'s own coordinator; nothing is read', async () => {
    for (const classId of [CLASS_MATHS, CLASS_READING, CLASS_OTHER]) expect(((await get(classId)) as any).status).toBe(403);
    expect(h.examGapsFor).not.toHaveBeenCalled();
    expect(h.examGoalsFor).not.toHaveBeenCalled();
  });

  it('the Teacher read model (roster) refuses the coordinator too', async () => {
    await expect(getTeacherClassRoster('coordinator', CLASS_MATHS)).rejects.toThrow(/not authorized/);
    expect((await getTeacherClassRoster('maths-teacher', CLASS_MATHS)).map((r) => r.studentId)).toEqual([ANA]);
  });

  it('the teacher scope is resolved from a TEACHER membership only -- its query never consults an INSTITUTION_ADMIN membership', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function resolveTeacherClassScope'), src.indexOf('/**\n * F11-B'));
    expect(fn).toMatch(/im\.membership_role = 'TEACHER'/);
    expect(fn).not.toMatch(/INSTITUTION_ADMIN|canAccessInstitution|canAccessClass/);
    const readModel = readFileSync(join(process.cwd(), 'src/lib/teacher/read-model.service.ts'), 'utf8');
    expect(readModel).not.toMatch(/canAccessClass\(/);
  });
});

describe('one entry point', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });

  it('no Teacher route, page or read model calls the exam bridge\'s examGapsFor directly -- they go through getTeacherClassExamGaps', () => {
    const root = process.cwd();
    const files = [...walk(join(root, 'src/app/api/teacher')), ...walk(join(root, 'src/lib/teacher')), ...walk(join(root, 'src/app/dashboard/teacher'))];
    const offenders = files.filter((f) => /\bexamGapsFor\s*\(/.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, ''))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the exam bridge itself was not modified for this (it has no subject option yet -- CR-L10-01 to L2)', () => {
    const bridge = readFileSync(join(process.cwd(), 'src/lib/exam-core/exam-gaps.service.ts'), 'utf8');
    expect(bridge).toMatch(/opts: \{ families\?: string\[\]; includePerStudent: boolean \}/);
  });
});
