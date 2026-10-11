/**
 * L8-R1 -- Teacher exam-practice assignment through the EXISTING
 * EXAM_PRACTICE intervention (POST /api/teacher/interventions).
 *
 * The route, the options service, the intervention service and the shared
 * authorization primitives all run for real here, against a small scripted
 * world (two classes of one institution, three teachers-or-not, three
 * students). Only the session, the database driver, the Student-side
 * execution module and the mini-mock eligibility are replaced. So every
 * denial below is decided by the production code path, and "nothing was
 * persisted" is checked on the INSERT itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_n: string, h: unknown) => h }));
vi.mock('@/lib/observability/pilot-events', () => ({ logPilotEvent: vi.fn() }));
vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn(async (clerkId: string) => ({ id: clerkId })) }));
vi.mock('@/lib/i18n/language', () => ({ getUserInterfaceLanguage: vi.fn(async () => 'es') }));
vi.mock('@/lib/student/teacher-intervention-execution.service', () => ({ reconcileCompletionsForStudent: vi.fn(async () => {}), getEffectiveStatus: (s: string) => s }));
vi.mock('@/lib/simulation/eligibility.service', () => ({ getSimulationEligibility: vi.fn() }));

import { verifyAuth } from '@/lib/auth';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { listTeacherExamPracticeOptions, TeacherExamPracticeAccessDeniedError } from '@/lib/teacher/exam-practice-options.service';
import { POST } from '@/app/api/teacher/interventions/route';

const u = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const INST = u(1);
const CLASS_MATH = u(2);
const CLASS_READ = u(3);
const ANA = u(4); // enrolled in both classes
const OUTSIDER = u(5); // enrolled only in CLASS_READ
const BEA = u(6); // enrolled in CLASS_MATH; owns P_BEA
const SUBJ_MATH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBJ_READ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P_MULTI = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'; // Ana: a multi-subject exam (maths + reading)
const P_MATH = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'; // Ana: a single-subject mathematics exam
const P_BEA = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'; // Bea's profile
const V_MULTI = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const V_MATH = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
const LO_MATH = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const LO_READ = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
const LO_MATH_UNSUPPORTED = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const AS_MATH = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
const AS_READ = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
const CONCEPT_ANA = 'abababab-abab-4bab-8bab-abababababab';
const TEACHER = 'math-teacher';
const READ_TEACHER = 'reading-teacher';
const COORDINATOR = 'coordinator';

const world = {
  classSubject: { [CLASS_MATH]: SUBJ_MATH, [CLASS_READ]: SUBJ_READ } as Record<string, string | null>,
  teaches: { [TEACHER]: [CLASS_MATH], [READ_TEACHER]: [CLASS_READ] } as Record<string, string[]>,
  admins: [COORDINATOR],
  enrolled: { [CLASS_MATH]: [ANA, BEA], [CLASS_READ]: [ANA, OUTSIDER] } as Record<string, string[]>,
  profiles: [
    { id: P_MULTI, student: ANA, exam: 'PISA', version: V_MULTI, examSubject: null as string | null },
    { id: P_MATH, student: ANA, exam: 'AICE Mathematics', version: V_MATH, examSubject: SUBJ_MATH },
    { id: P_BEA, student: BEA, exam: 'PISA', version: V_MULTI, examSubject: null },
  ],
  components: [
    { version: V_MULTI, id: 'comp-math', academicSubject: AS_MATH, support: 'SUPPORTED' },
    { version: V_MULTI, id: 'comp-read', academicSubject: AS_READ, support: 'SUPPORTED' },
    { version: V_MULTI, id: 'comp-math-oral', academicSubject: AS_MATH, support: 'UNSUPPORTED' },
  ],
  objectives: [
    { version: V_MULTI, id: LO_MATH, code: 'M1', description: 'Ratios', subject: SUBJ_MATH, component: 'comp-math' },
    { version: V_MULTI, id: LO_READ, code: 'R1', description: 'Inference', subject: SUBJ_READ, component: 'comp-read' },
    { version: V_MULTI, id: LO_MATH_UNSUPPORTED, code: 'M9', description: 'Oral reasoning', subject: SUBJ_MATH, component: 'comp-math-oral' },
  ],
  domains: [
    { id: AS_MATH, name: 'Mathematics', subject: SUBJ_MATH },
    { id: AS_READ, name: 'Reading', subject: SUBJ_READ },
  ],
};
let inserts: unknown[][] = [];

function scriptDb() {
  query.mockImplementation(async (sql: string, p: any[] = []) => {
    const teaches = (actor: string, classId: string) => (world.teaches[actor] ?? []).includes(classId);
    if (/^\s*INSERT INTO teacher_interventions/.test(sql)) {
      inserts.push(p);
      return { rows: [{ id: 'new-intervention', assigned_by_user_id: p[0], institution_id: p[1], class_id: p[2], student_id: p[3], target_type: p[4], concept_id: p[5], learning_objective_id: p[8], exam_profile_id: p[9], simulation_type: p[10], academic_subject_id: p[11], intervention_type: p[12], title: p[17], status: 'ASSIGNED', assigned_at: '2026-10-11T00:00:00.000Z' }] };
    }
    // class-assignment.service: the teacher-only gate, then the class row
    if (/SELECT 1 FROM \(/.test(sql) && /FROM teacher_assignments ta/.test(sql)) return { rows: teaches(p[0], p[1]) ? [{}] : [] };
    if (/FROM classes c JOIN institutions i/.test(sql)) return { rows: p[0] in world.classSubject ? [{ id: p[0], name: 'Class', institution_id: INST, institution_name: 'School', grade_name: null, canonical_subject_id: world.classSubject[p[0]], subject_name: 'Subject' }] : [] };
    // authorization: canTeacherAccessLearner
    if (/JOIN class_enrollments ce ON ce\.student_id = \$2/.test(sql)) return { rows: (world.teaches[p[0]] ?? []).some((c) => world.enrolled[c].includes(p[1])) ? [{}] : [] };
    // authorization: canAccessInstitution, then canAccessClass's teacher branch
    if (/membership_role = 'INSTITUTION_ADMIN'/.test(sql)) return { rows: world.admins.includes(p[0]) && p[1] === INST ? [{}] : [] };
    if (/ta\.class_id = \$2 OR/.test(sql)) return { rows: teaches(p[0], p[1]) ? [{}] : [] };
    if (/SELECT institution_id(, grade_id)? FROM classes WHERE id = \$1/.test(sql)) return { rows: p[0] in world.classSubject ? [{ institution_id: INST, grade_id: null }] : [] };
    if (/FROM class_enrollments WHERE class_id = \$1 AND student_id = \$2/.test(sql)) return { rows: (world.enrolled[p[0]] ?? []).includes(p[1]) ? [{}] : [] };
    // exam-practice options
    if (/FROM student_exam_profiles p\s+JOIN exam_definitions d/.test(sql)) {
      return { rows: world.profiles.filter((x) => x.student === p[0]).map((x) => ({ profile_id: x.id, exam_name: x.exam, version_id: x.version, exam_of_class_subject: x.examSubject === null ? null : x.examSubject === p[1] })) };
    }
    // existing assessment readers: legacy blueprint, its targets, the version's components
    if (/FROM assessment_blueprints WHERE exam_version_id = \$1 AND purpose IS NULL/.test(sql)) return { rows: [{ id: `bp-${p[0]}`, exam_version_id: p[0] }] };
    if (/FROM blueprint_objective_targets WHERE blueprint_id = \$1/.test(sql)) return { rows: world.objectives.filter((o) => `bp-${o.version}` === p[0]).map((o) => ({ id: `t-${o.id}`, blueprint_id: p[0], learning_objective_id: o.id, assessment_component_id: o.component })) };
    if (/FROM assessment_components WHERE exam_version_id = \$1/.test(sql)) return { rows: world.components.filter((c) => c.version === p[0]).map((c) => ({ id: c.id, exam_version_id: c.version, academic_subject_id: c.academicSubject, support_status: c.support })) };
    if (/JOIN objective_concept_mappings m/.test(sql)) return { rows: world.objectives.filter((o) => p[0].includes(o.id) && o.subject === p[1]).map((o) => ({ id: o.id, code: o.code, description: o.description })) };
    if (/FROM academic_subjects s WHERE s\.id = ANY/.test(sql)) return { rows: world.domains.filter((d) => p[0].includes(d.id) && d.subject === p[1]).map((d) => ({ id: d.id, name: d.name })) };
    // intervention.service: profile ownership and concept ownership
    if (/SELECT \* FROM student_exam_profiles WHERE id = \$1/.test(sql)) return { rows: world.profiles.filter((x) => x.id === p[0]).map((x) => ({ id: x.id, student_id: x.student, status: 'ACTIVE' })) };
    if (/FROM concepts c JOIN subjects s ON s\.id = c\.subject_id WHERE c\.id = \$1 AND s\.student_id = \$2/.test(sql)) return { rows: p[0] === CONCEPT_ANA && p[1] === ANA ? [{}] : [] };
    return { rows: [] };
  });
}

const as = (actor: string) => vi.mocked(verifyAuth).mockResolvedValue({ userId: actor, email: null } as any);
const post = (body: unknown) => (POST as any)(new NextRequest('http://localhost/api/teacher/interventions', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
const exam = (classId: string, studentId: string, target: Record<string, string>) => ({ classId, studentId, interventionType: 'EXAM_PRACTICE', target: { targetType: 'EXAM', ...target } });
const topicMath = { examProfileId: P_MULTI, simulationType: 'TOPIC_EXAM', learningObjectiveId: LO_MATH };
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  vi.clearAllMocks();
  inserts = [];
  scriptDb();
  as(TEACHER);
  vi.mocked(getSimulationEligibility).mockResolvedValue({ simulationType: 'MINI_MOCK', eligible: true, reasons: [] });
});

describe('the class Teacher sees the applicable exam-practice options', () => {
  it('lists the learner\'s own preparation, only within the class subject', async () => {
    const { options, subjectLinked } = await listTeacherExamPracticeOptions(TEACHER, CLASS_MATH, ANA);
    expect(subjectLinked).toBe(true);
    expect(options.map((o) => [o.examName, o.kind, o.targetLabel])).toEqual([
      ['PISA', 'DOMAIN_EXAM', 'Mathematics'],
      ['PISA', 'TOPIC_EXAM', 'M1 Ratios'],
      ['AICE Mathematics', 'MINI_MOCK', null],
    ]);
    const text = JSON.stringify(options);
    // Never the reading objective / reading domain of the same exam, never another learner's profile.
    for (const foreign of [LO_READ, AS_READ, P_BEA, 'Reading', 'Inference']) expect(text).not.toContain(foreign);
    // A whole-exam task only for the single-subject exam of the class subject -- not for the multi-subject one.
    expect(options.filter((o) => o.kind === 'MINI_MOCK').map((o) => o.examProfileId)).toEqual([P_MATH]);
  });

  it('the subject filter is part of the queries themselves, bound to the class subject', async () => {
    await listTeacherExamPracticeOptions(TEACHER, CLASS_MATH, ANA);
    const call = (re: RegExp) => query.mock.calls.find(([sql]) => re.test(String(sql)))!;
    expect(String(call(/JOIN objective_concept_mappings m/)[0])).toMatch(/m\.status = 'PUBLISHED'[\s\S]*cc\.canonical_subject_id = \$2/);
    expect(call(/JOIN objective_concept_mappings m/)[1][1]).toBe(SUBJ_MATH);
    expect(String(call(/FROM academic_subjects s WHERE/)[0])).toMatch(/s\.canonical_subject_id = \$2/);
    expect(call(/FROM academic_subjects s WHERE/)[1][1]).toBe(SUBJ_MATH);
    const profiles = call(/FROM student_exam_profiles p\s+JOIN exam_definitions d/);
    expect(String(profiles[0])).toMatch(/v\.status = 'PUBLISHED'/);
    expect(String(profiles[0])).toMatch(/p\.status <> 'ARCHIVED'/);
    expect(profiles[1]).toEqual([ANA, SUBJ_MATH]);
  });

  it('an objective on an unsupported component is not offered and cannot be assigned', async () => {
    const { options } = await listTeacherExamPracticeOptions(TEACHER, CLASS_MATH, ANA);
    expect(JSON.stringify(options)).not.toContain(LO_MATH_UNSUPPORTED);
    const res = await post(exam(CLASS_MATH, ANA, { examProfileId: P_MULTI, simulationType: 'TOPIC_EXAM', learningObjectiveId: LO_MATH_UNSUPPORTED }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('the same learner in the reading class gets reading options, not mathematics', async () => {
    const { options } = await listTeacherExamPracticeOptions(READ_TEACHER, CLASS_READ, ANA);
    expect(options.map((o) => [o.kind, o.targetLabel])).toEqual([['DOMAIN_EXAM', 'Reading'], ['TOPIC_EXAM', 'R1 Inference']]);
  });

  it('a mini mock is offered only when the existing eligibility allows it', async () => {
    vi.mocked(getSimulationEligibility).mockResolvedValue({ simulationType: 'MINI_MOCK', eligible: false, reasons: ['NO_FULLY_SUPPORTED_MAPPED_OBJECTIVES'] });
    const { options } = await listTeacherExamPracticeOptions(TEACHER, CLASS_MATH, ANA);
    expect(options.some((o) => o.kind === 'MINI_MOCK')).toBe(false);
  });

  it('a class without a linked subject offers nothing and reads no exam profile', async () => {
    world.classSubject[CLASS_MATH] = null;
    try {
      const r = await listTeacherExamPracticeOptions(TEACHER, CLASS_MATH, ANA);
      expect(r).toMatchObject({ subjectLinked: false, options: [] });
      expect(query.mock.calls.some(([sql]) => /student_exam_profiles/.test(String(sql)))).toBe(false);
    } finally {
      world.classSubject[CLASS_MATH] = SUBJ_MATH;
    }
  });

  it.each([
    ['a Coordinator of the institution', COORDINATOR, CLASS_MATH, ANA],
    ['a Teacher of another class', READ_TEACHER, CLASS_MATH, ANA],
    ['the class Teacher, for a learner outside the class', TEACHER, CLASS_MATH, OUTSIDER],
    ['the class Teacher, through a class they do not teach', TEACHER, CLASS_READ, ANA],
  ])('%s is refused and no exam profile is read', async (_who, actor, classId, studentId) => {
    await expect(listTeacherExamPracticeOptions(actor, classId, studentId)).rejects.toBeInstanceOf(TeacherExamPracticeAccessDeniedError);
    expect(query.mock.calls.some(([sql]) => /student_exam_profiles/.test(String(sql)))).toBe(false);
  });
});

describe('POST /api/teacher/interventions -- exam practice', () => {
  it('the class Teacher assigns an exam-practice task; it persists through the existing model', async () => {
    const res = await post({ ...exam(CLASS_MATH, ANA, topicMath), instructions: 'Before Friday' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.intervention).toMatchObject({ studentId: ANA, classId: CLASS_MATH, interventionType: 'EXAM_PRACTICE', targetType: 'EXAM', examProfileId: P_MULTI, simulationType: 'TOPIC_EXAM', learningObjectiveId: LO_MATH });
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    // teacher_interventions columns, in the INSERT's order
    expect(row.slice(0, 5)).toEqual([TEACHER, INST, CLASS_MATH, ANA, 'EXAM']);
    expect(row.slice(5, 13)).toEqual([null, null, null, LO_MATH, P_MULTI, 'TOPIC_EXAM', null, 'EXAM_PRACTICE']);
    expect(row[14]).toBe('Before Friday');
    expect(row[17]).toBe('PISA · Tema: M1 Ratios'); // server-derived title, never client-supplied
  });

  it('a domain practice and a single-subject mini mock are assignable too', async () => {
    expect((await post(exam(CLASS_MATH, ANA, { examProfileId: P_MULTI, simulationType: 'DOMAIN_EXAM', academicSubjectId: AS_MATH }))).status).toBe(200);
    expect((await post(exam(CLASS_MATH, ANA, { examProfileId: P_MATH, simulationType: 'MINI_MOCK' }))).status).toBe(200);
    expect(inserts.map((r) => [r[10], r[11]])).toEqual([['DOMAIN_EXAM', AS_MATH], ['MINI_MOCK', null]]);
  });

  it('a client-supplied title is ignored', async () => {
    await post({ ...exam(CLASS_MATH, ANA, topicMath), title: 'Injected' });
    expect(inserts[0][17]).toBe('PISA · Tema: M1 Ratios');
  });

  it('the Teacher cannot assign to a learner outside their class', async () => {
    const res = await post(exam(CLASS_MATH, OUTSIDER, topicMath));
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it('the Teacher cannot assign through a class they do not teach, even for their own learner', async () => {
    const res = await post(exam(CLASS_READ, ANA, { examProfileId: P_MULTI, simulationType: 'TOPIC_EXAM', learningObjectiveId: LO_READ }));
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it.each([
    ['an objective of another subject of the same exam', { examProfileId: P_MULTI, simulationType: 'TOPIC_EXAM', learningObjectiveId: LO_READ }],
    ['a domain of another subject of the same exam', { examProfileId: P_MULTI, simulationType: 'DOMAIN_EXAM', academicSubjectId: AS_READ }],
    ['a whole-exam mini mock of a multi-subject exam', { examProfileId: P_MULTI, simulationType: 'MINI_MOCK' }],
    ['an official full mock', { examProfileId: P_MATH, simulationType: 'FULL_MOCK' }],
    ['another learner\'s exam profile', { examProfileId: P_BEA, simulationType: 'TOPIC_EXAM', learningObjectiveId: LO_MATH }],
  ])('the Teacher cannot assign %s (400, nothing persisted)', async (_what, target) => {
    const res = await post(exam(CLASS_MATH, ANA, target));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'EXAM_TARGET_OUT_OF_SCOPE' });
    expect(inserts).toHaveLength(0);
  });

  it('a Coordinator cannot use the Teacher endpoint as a bypass -- exam practice or concept', async () => {
    as(COORDINATOR);
    expect((await post(exam(CLASS_MATH, ANA, topicMath))).status).toBe(403);
    // Concept path: the Coordinator passes canAccessClass (institution admin) and is still refused by the
    // genuine-teacher check of the unchanged assignment chain.
    const concept = await post({ classId: CLASS_MATH, studentId: ANA, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: CONCEPT_ANA } });
    expect(concept.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it('a Teacher of another class cannot assign exam practice in this one', async () => {
    as(READ_TEACHER);
    expect((await post(exam(CLASS_MATH, ANA, topicMath))).status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it('signed out is 401; a mismatched type and target is refused by the existing validation', async () => {
    const bad = await post({ classId: CLASS_MATH, studentId: ANA, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'EXAM', ...topicMath } });
    expect(bad.status).toBe(400);
    expect(inserts).toHaveLength(0);
    vi.mocked(verifyAuth).mockResolvedValue(null as any);
    expect((await post(exam(CLASS_MATH, ANA, topicMath))).status).toBe(401);
  });
});

describe('concept reinforcement is unchanged', () => {
  it('the class Teacher still assigns a concept; the exam scope check is not involved', async () => {
    const res = await post({ classId: CLASS_MATH, studentId: ANA, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: CONCEPT_ANA }, instructions: 'Review' });
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].slice(3, 6)).toEqual([ANA, 'CONCEPT', CONCEPT_ANA]);
    expect(inserts[0][12]).toBe('CONCEPT_REINFORCEMENT');
    expect(inserts[0][17]).toBeNull();
    expect(query.mock.calls.some(([sql]) => /FROM student_exam_profiles p\s+JOIN exam_definitions d/.test(String(sql)))).toBe(false);
    expect(getSimulationEligibility).not.toHaveBeenCalled();
  });

  it('a concept that is not this learner\'s own is still refused', async () => {
    const res = await post({ classId: CLASS_MATH, studentId: BEA, interventionType: 'CONCEPT_REINFORCEMENT', target: { targetType: 'CONCEPT', conceptId: CONCEPT_ANA } });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});

describe('wiring and ownership boundaries', () => {
  it('the exam-practice form is mounted on the class-scoped learner page, fed by the teacher-only read', () => {
    const page = strip(read('src/app/dashboard/teacher/classes/[classId]/students/[studentId]/page.tsx'));
    expect(page).toMatch(/listTeacherExamPracticeOptions\(actor\.id, classId, studentId\)/);
    expect(page).toMatch(/<AssignExamPracticeForm\s+classId=\{classId\}\s+studentId=\{studentId\}\s+options=\{examPractice\.options\.map/);
    expect(page.indexOf('getTeacherLearnerView(actor.id, classId, studentId)')).toBeLessThan(page.indexOf('listTeacherExamPracticeOptions(actor.id, classId, studentId)'));
    // The concept form stays mounted next to it.
    expect(page).toMatch(/<AssignInterventionForm\s+classId=\{classId\}/);
  });

  it('the form posts the existing EXAM_PRACTICE shape to the existing route, and nothing else', () => {
    const form = strip(read('src/app/dashboard/teacher/students/AssignExamPracticeForm.tsx'));
    expect(form.match(/fetch\(/g)).toHaveLength(1);
    expect(form).toMatch(/fetch\('\/api\/teacher\/interventions'/);
    expect(form).toMatch(/interventionType: 'EXAM_PRACTICE',\s+target: chosen\.target/);
  });

  it('the read path is teacher-only and writes nothing', () => {
    const service = strip(read('src/lib/teacher/exam-practice-options.service.ts'));
    expect(service).not.toMatch(/canAccessClass|canAccessInstitution/);
    expect(service).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(service.indexOf('getTeacherClass(actorUserId, classId)')).toBeLessThan(service.indexOf('student_exam_profiles'));
    // Exam structure only through the existing readers: no direct read of the blueprint tables.
    expect(service).not.toMatch(/(FROM|JOIN)\s+(assessment_blueprints|blueprint_objective_targets|assessment_components)\b/);
  });

  it('the route checks the exam scope before the assignment and keeps the existing service call', () => {
    const route = strip(read('src/app/api/teacher/interventions/route.ts'));
    expect(route.indexOf('findTeacherExamPracticeOption(')).toBeLessThan(route.indexOf('assignTeacherIntervention(actor.id'));
    expect(route).toMatch(/interventionType: z\.enum\(\['CONCEPT_REINFORCEMENT', 'SKILL_PRACTICE', 'COMPETENCY_PRACTICE', 'EXAM_PRACTICE'\]\)/);
  });
});
