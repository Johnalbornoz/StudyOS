/**
 * Track A -- Teacher E2E readiness: the 18-step Teacher journey over REAL
 * HTTP as REAL Clerk DEV identities (backend-issued session tokens), with
 * the DEV database checked (read-only) for every write the journey should --
 * and should NOT -- produce.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-teacher-e2e-http.ts <baseUrl> <tokens.json>
 *   npx tsx --env-file=.env.local scripts/operations/track-a-teacher-e2e-http.ts <baseUrl> <tokens.json> --learner-data-only
 *   (hosted DEV: VERCEL_PROTECTION_BYPASS=<existing automation bypass secret>)
 *
 * Prerequisite: `track-a-fixtures.ts provision` then `teacher-reset` (Teresa
 * without persona, Institution A empty, Sofía outside every class) then
 * `tokens <file>`.
 *
 * `--learner-data-only` gives Sofía (student-a) realistic learning history
 * through the GOVERNED path only: the canonical decision chooses the next
 * activity, the real Student API generates it and grades her submission,
 * and `updateMastery` records the evidence. Nothing is written to cognitive
 * tables by this script. Her answers are simulated: the first activities
 * correct, the last one with a deliberate wrong choice on part of the items
 * (a controlled, recognisable error pattern).
 */
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision/canonical-decision.service';
import { resolveCanonicalLaunch } from '@/lib/pedagogical-decision/canonical-session-launch';
import { assertDev, INST_A_NAME, INST_B_NAME, emailFor, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Record<Tag, string> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));
const LEARNER_DATA_ONLY = process.argv.includes('--learner-data-only');

export const MANUAL_NAMES = { grade: '3º Preparatoria', klass: 'Matemáticas 3A', concept: 'Linear Equations' } as const;

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};

interface Res {
  status: number;
  body: any;
  text: string;
}
async function call(method: string, path: string, who: Tag | null, body?: unknown): Promise<Res> {
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}
const get = (path: string, who: Tag | null) => call('GET', path, who);
const post = (path: string, who: Tag | null, body: unknown = {}) => call('POST', path, who, body);
const patch = (path: string, who: Tag | null, body: unknown = {}) => call('PATCH', path, who, body);
const denied = (r: Res) => r.status === 401 || r.status === 403 || r.status === 404;
async function page(id: string, path: string, who: Tag, mustContain: Array<string | RegExp>, mustNot: Array<string | RegExp> = []) {
  const r = await get(path, who);
  const has = (m: string | RegExp) => (typeof m === 'string' ? r.text.includes(m) : m.test(r.text));
  const missing = mustContain.filter((m) => !has(m));
  const present = mustNot.filter(has);
  check(`PAGE.${id}`, r.status === 200 && missing.length === 0 && present.length === 0, `${r.status}${missing.length ? ' missing ' + missing.map(String).join(' | ') : ''}${present.length ? ' unexpected ' + present.map(String).join(' | ') : ''}`);
}
const q1 = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await q1(sql, p))?.n ?? 0);

async function ids() {
  const users: Record<string, string> = {};
  const students: Record<string, string> = {};
  for (const r of (await db.query(`SELECT id, email FROM users WHERE email LIKE 'studyus-ta-%+clerk_test@example.com'`)).rows) {
    users[r.email.replace('studyus-ta-', '').replace('+clerk_test@example.com', '')] = r.id;
  }
  for (const r of (await db.query(`SELECT s.id, u.email FROM students s JOIN users u ON u.id = s.user_id WHERE u.email LIKE 'studyus-ta-%+clerk_test@example.com'`)).rows) {
    students[r.email.replace('studyus-ta-', '').replace('+clerk_test@example.com', '')] = r.id;
  }
  const instA = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).id as string;
  const instB = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_B_NAME])).id as string;
  const classB = (await q1(`SELECT id FROM classes WHERE institution_id = $1 LIMIT 1`, [instB])).id as string;
  const canonical = await q1(`SELECT id, canonical_subject_id FROM canonical_concepts WHERE name = $1 AND status = 'ACTIVE' LIMIT 1`, [MANUAL_NAMES.concept]);
  const subjectA = (await q1(`SELECT id FROM subjects WHERE student_id = $1 LIMIT 1`, [students['student-a']])).id as string;
  const conceptA = (await q1(`SELECT id FROM concepts WHERE subject_id = $1 LIMIT 1`, [subjectA])).id as string;
  return { users, students, instA, instB, classB, canonical: canonical.id as string, mathSubject: canonical.canonical_subject_id as string, subjectA, conceptA };
}
type Ids = Awaited<ReturnType<typeof ids>>;

/** One activity chosen by the canonical decision, generated and graded by the real Student API. */
async function sofiaActivity(x: Ids, label: string, wrongShare: number): Promise<boolean> {
  const { decision } = await getCanonicalPedagogicalDecision({ studentId: x.students['student-a'], conceptId: x.conceptA });
  const launch = resolveCanonicalLaunch({ subjectId: x.subjectA, conceptId: x.conceptA, decision });
  if (launch.launchStatus !== 'READY') {
    check(`LEARNER.${label}-launchable`, false, `${decision.stage}/${decision.actionState}/${launch.launchStatus}`);
    return false;
  }
  const lp = launch.launchParams;
  let gen: Res | null = null;
  for (let attempt = 0; attempt < 3 && (!gen || gen.status >= 500); attempt++) {
    gen = await post('/api/quizzes/generate-and-take', 'student-a', {
      studentId: x.students['student-a'],
      subjectId: lp.subjectId,
      conceptId: lp.conceptId,
      quizMode: lp.mode,
      difficulty: Number(lp.difficulty),
      ...(lp.maxQuestions ? { maxQuestions: Number(lp.maxQuestions) } : {}),
      v1Launch: true,
      language: 'es',
    });
  }
  const quizId = gen?.body?.data?.quizId ?? gen?.body?.quizId ?? gen?.body?.data?.quiz?.id;
  check(`LEARNER.${label}-generated`, gen!.status === 200 && !!quizId, `${decision.stage} ${lp.mode} ${gen!.status} ${gen!.text.slice(0, 120)}`);
  if (!quizId) return false;
  // The answer key is read from the stored activity only to SIMULATE the
  // student's choices; grading and evidence are the server's own.
  const stored = await q1(`SELECT questions FROM quiz_sessions WHERE id = $1 AND student_id = $2`, [quizId, x.students['student-a']]);
  const questions: any[] = stored?.questions ?? [];
  const wrongCount = Math.round(questions.length * wrongShare);
  const answers = questions.map((qq: any, index: number) => {
    const wrong = index < wrongCount;
    if (qq.answerFormat === 'single_choice' || qq.answerFormat === 'multi_choice' || Array.isArray(qq.options)) {
      const other = (qq.options ?? []).find((o: any) => o.id !== qq.correctAnswer)?.id ?? 'A';
      return { questionIndex: index, answer: wrong ? other : String(qq.correctAnswer ?? other) };
    }
    return { questionIndex: index, answer: wrong ? 'x = -2' : String(qq.correctAnswer ?? qq.expectedAnswer ?? '') };
  });
  const submit = await post('/api/quizzes/generate-and-take', 'student-a', { studentId: x.students['student-a'], quizId, answers });
  check(`LEARNER.${label}-submitted`, submit.status === 200, `${submit.status} ${submit.text.slice(0, 120)}`);
  return submit.status === 200;
}

async function learnerData(x: Ids) {
  // Self-practice is a licensed Student capability; `teacher-reset` grants
  // a time-boxed, audited licence through the admin licensing service.
  const licensed = await n(
    `SELECT COUNT(*) n FROM subscriptions WHERE student_id = $1 AND status IN ('active', 'past_due', 'reactivated') AND (grant_expires_at IS NULL OR grant_expires_at > NOW())`,
    [x.students['student-a']]
  );
  check('LEARNER.sofia-licensed', licensed > 0);
  const before = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [x.students['student-a']]);
  await sofiaActivity(x, 'activity-1', 0);
  await sofiaActivity(x, 'activity-2', 0);
  await sofiaActivity(x, 'activity-3', 0.4);
  const after = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [x.students['student-a']]);
  check('LEARNER.evidence-via-engine', after > before, `learning_evidence ${before} -> ${after}`);
  const { decision } = await getCanonicalPedagogicalDecision({ studentId: x.students['student-a'], conceptId: x.conceptA });
  console.log(`Sofía canonical state: stage=${decision.stage} action=${decision.nextCanonicalAction}/${decision.actionState} reinforce=${decision.intervention} practice=${decision.practiceProgress?.passesInWindow}/${decision.practiceProgress?.requiredPasses}`);
}

async function main() {
  assertDev();
  if (!BASE) throw new Error('usage: track-a-teacher-e2e-http.ts <baseUrl> <tokens.json> [--learner-data-only]');
  const version = await get('/api/version', null);
  console.log(`target ${BASE} -- version ${version.text.slice(0, 200)}`);
  const x = await ids();
  const sofia = x.students['student-a'];
  const studentB = x.students['student-b'];

  if (LEARNER_DATA_ONLY) {
    await learnerData(x);
    return;
  }

  // Sofía arrives with her own learning history (governed engine path), as in the manual package.
  if ((await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [sofia])) === 0) await learnerData(x);

  const allStudents = Object.values(x.students);
  const masteryBefore = await n(`SELECT COUNT(*) n FROM mastery_records WHERE student_id = ANY($1::uuid[])`, [allStudents]);
  const evidenceOthersBefore = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[]) AND student_id <> $2`, [allStudents, sofia]);

  // 0 -- starting state (teacher-reset): Teresa has no persona; Sofía is outside every class of Institution A.
  check('S0.teresa-no-persona', (await n(`SELECT COUNT(*) n FROM user_roles WHERE user_id = $1 AND role IN ('STUDENT','PARENT','TEACHER')`, [x.users['teacher-a']])) === 0);
  check('S0.sofia-outside-classes', (await n(`SELECT COUNT(*) n FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = $1 AND c.institution_id = $2`, [sofia, x.instA])) === 0);
  check('S0.instA-empty', (await n(`SELECT COUNT(*) n FROM classes WHERE institution_id = $1`, [x.instA])) === 0);

  // 1 -- Teresa chooses Teacher (her one persona).
  // /role-select is a client page driven by /api/identity/me: no persona yet => the one-time choice is offered.
  const meBefore = (await get('/api/identity/me', 'teacher-a')).body?.data;
  check('S1.choice-offered', (meBefore?.roles ?? []).filter((r: string) => ['STUDENT', 'PARENT', 'TEACHER'].includes(r)).length === 0, JSON.stringify(meBefore).slice(0, 120));
  check('S1.account-page-reachable', (await get('/role-select', 'teacher-a')).status === 200);
  const choose = await post('/api/identity/roles/select', 'teacher-a', { role: 'TEACHER' });
  check('S1.teresa-chooses-teacher', choose.status === 200, `${choose.status} ${choose.text.slice(0, 100)}`);
  const me = (await get('/api/identity/me', 'teacher-a')).body?.data;
  check('S1.single-persona-teacher', JSON.stringify((me?.roles ?? []).filter((r: string) => ['STUDENT', 'PARENT', 'TEACHER'].includes(r))) === '["TEACHER"]' && me?.activeWorkspace === 'TEACHER', JSON.stringify(me).slice(0, 160));
  for (const role of ['STUDENT', 'PARENT']) {
    const r = await post('/api/identity/roles/select', 'teacher-a', { role });
    check(`S1.teacher-cannot-add-${role.toLowerCase()}`, r.status === 409 && r.body?.error === 'PERSONA_EXISTS', `${r.status}`);
  }
  check('S1.no-extra-persona-rows', (await n(`SELECT COUNT(*) n FROM user_roles WHERE user_id = $1 AND role IN ('STUDENT','PARENT','TEACHER')`, [x.users['teacher-a']])) === 1);

  // 2-3 -- Teresa requests Institution A and stays PENDING (no classes, no learner data).
  const reqT = await post(`/api/institutions/${x.instA}/membership`, 'teacher-a');
  check('S2.request-institution-a', reqT.status === 200 && reqT.body?.data?.membership?.status === 'PENDING', reqT.text.slice(0, 120));
  const membershipA = reqT.body?.data?.membership?.id as string;
  check('S2.request-idempotent', (await post(`/api/institutions/${x.instA}/membership`, 'teacher-a')).body?.data?.membership?.id === membershipA);
  check('S2.one-membership-row', (await n(`SELECT COUNT(*) n FROM institution_memberships WHERE user_id = $1 AND institution_id = $2`, [x.users['teacher-a'], x.instA])) === 1);
  await page('3-teresa-pending', '/dashboard/teacher', 'teacher-a', ['Tu solicitud está pendiente', INST_A_NAME, 'Pendiente de aprobación']);
  check('S3.pending-no-classes', ((await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? []).length === 0);
  check('S3.pending-no-roster', denied(await get(`/api/teacher/classes/${x.classB}/roster`, 'teacher-a')));
  check('S3.pending-no-learner', denied(await get(`/api/teacher/classes/${x.classB}/students/${studentB}`, 'teacher-a')));
  check('S3.pending-no-assignments', denied(await get(`/api/teacher/classes/${x.classB}/assignments`, 'teacher-a')));

  // 4-5 -- Ana sees "Nombre · email" and approves.
  await page('4-ana-sees-requester', `/dashboard/institution/${x.instA}/requests`, 'inst-a', ['Teresa Docente A · ' + emailFor('teacher-a'), 'Aprobar']);
  check('S4.admin-notified', ((await get('/api/notifications/inbox', 'inst-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'TEACHER_MEMBERSHIP_REQUESTED'));
  check('S5.teacher-cannot-self-approve', denied(await post(`/api/institutions/${x.instA}/memberships/${membershipA}/decide`, 'teacher-a', { decision: 'APPROVED' })));
  check('S5.ana-approves', (await post(`/api/institutions/${x.instA}/memberships/${membershipA}/decide`, 'inst-a', { decision: 'APPROVED' })).status === 200);
  check('S5.teresa-notified', ((await get('/api/notifications/inbox', 'teacher-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'TEACHER_MEMBERSHIP_APPROVED'));

  // 6 -- approved, no class: usable empty state, never stranded.
  await page('6-teresa-empty-state', '/dashboard/teacher', 'teacher-a', ['Aún no tienes clases asignadas.', 'Cuando tu institución te asigne una clase o grado, aparecerá aquí.']);
  // The account page's CTA ("Ir a mi espacio de Profesor") is driven by the resolved persona workspace.
  check('S6.account-cta-target-teacher', (await get('/api/identity/me', 'teacher-a')).body?.data?.activeWorkspace === 'TEACHER');
  check('S6.no-classes', ((await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? []).length === 0);

  // 7 -- Ana creates Grade, Class and links the canonical subject.
  const grade = await post(`/api/institutions/${x.instA}/grades`, 'inst-a', { name: MANUAL_NAMES.grade });
  check('S7.create-grade', grade.status === 201, grade.text.slice(0, 100));
  check('S7.teacher-cannot-create-class', denied(await post(`/api/institutions/${x.instA}/classes`, 'teacher-a', { name: 'self-made' })));
  const klass = await post(`/api/institutions/${x.instA}/classes`, 'inst-a', { name: MANUAL_NAMES.klass, gradeId: grade.body?.data?.grade?.id });
  check('S7.create-class', klass.status === 201, klass.text.slice(0, 100));
  const classA = klass.body?.data?.class?.id as string;
  check('S7.subject-unknown-422', (await patch(`/api/institutions/${x.instA}/classes/${classA}`, 'inst-a', { canonicalSubjectId: '00000000-0000-4000-8000-000000000000' })).status === 422);
  check('S7.teacher-cannot-link-subject', denied(await patch(`/api/institutions/${x.instA}/classes/${classA}`, 'teacher-a', { canonicalSubjectId: x.mathSubject })));
  check('S7.foreign-class-404', (await patch(`/api/institutions/${x.instA}/classes/${x.classB}`, 'inst-a', { canonicalSubjectId: x.mathSubject })).status === 404);
  check('S7.link-subject', (await patch(`/api/institutions/${x.instA}/classes/${classA}`, 'inst-a', { canonicalSubjectId: x.mathSubject })).status === 200);
  check('S7.class-subject-stored', (await q1(`SELECT canonical_subject_id FROM classes WHERE id = $1`, [classA]))?.canonical_subject_id === x.mathSubject);
  await page('7-ana-class', `/dashboard/institution/${x.instA}/classes/${classA}`, 'inst-a', [MANUAL_NAMES.klass, 'Mathematics', MANUAL_NAMES.grade]);

  // 8 -- Ana assigns Teresa to the class.
  check('S8.teacher-cannot-self-assign', denied(await post(`/api/institutions/${x.instA}/assignments`, 'teacher-a', { institutionMembershipId: membershipA, classId: classA })));
  check('S8.assign-teresa', (await post(`/api/institutions/${x.instA}/assignments`, 'inst-a', { institutionMembershipId: membershipA, classId: classA })).status === 200);
  check('S8.teresa-notified', ((await get('/api/notifications/inbox', 'teacher-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'TEACHER_CLASS_ASSIGNED'));

  // 9 -- Teresa sees "Matemáticas 3A · Mathematics" automatically.
  const tClasses = (await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? [];
  check('S9.class-visible', tClasses.length === 1 && tClasses[0].classId === classA);
  await page('9-teresa-sees-class', '/dashboard/teacher', 'teacher-a', [`${MANUAL_NAMES.klass} · Mathematics`, INST_A_NAME, MANUAL_NAMES.grade]);

  // 10 -- Teresa invites Sofía (own class only; idempotent; no foreign class).
  check('S10.teacher-cannot-invite-class-b', denied(await post(`/api/teacher/classes/${x.classB}/enrollments`, 'teacher-a', { email: emailFor('student-b') })));
  check('S10.institution-route-denied-to-teacher', denied(await post(`/api/institutions/${x.instA}/classes/${classA}/enrollments`, 'teacher-a', { email: emailFor('student-a') })));
  check('S10.unknown-email-404', (await post(`/api/teacher/classes/${classA}/enrollments`, 'teacher-a', { email: 'nobody-ta+clerk_test@example.com' })).status === 404);
  const invite = await post(`/api/teacher/classes/${classA}/enrollments`, 'teacher-a', { email: emailFor('student-a') });
  check('S10.invite-sofia', invite.status === 201 && invite.body?.data?.outcome === 'INVITED', invite.text.slice(0, 100));
  check('S10.invite-idempotent', (await post(`/api/teacher/classes/${classA}/enrollments`, 'teacher-a', { email: emailFor('student-a') })).body?.data?.outcome === 'ALREADY_PENDING');
  check('S10.one-enrollment-row', (await n(`SELECT COUNT(*) n FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classA, sofia])) === 1);
  check('S10.pending-grants-nothing', denied(await get(`/api/teacher/classes/${classA}/students/${sofia}`, 'teacher-a')));

  // 11 -- Sofía accepts (other students cannot accept for her).
  check('S11.sofia-notified', ((await get('/api/notifications/inbox', 'student-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'CLASS_ENROLLMENT_INVITE'));
  const invitations = (await get('/api/student/class-invitations', 'student-a')).body?.data?.invitations ?? [];
  check('S11.sofia-sees-invitation', invitations.length === 1 && invitations[0].className === MANUAL_NAMES.klass);
  const enrollmentId = invitations[0]?.enrollmentId;
  check('S11.other-student-cannot-accept', (await post(`/api/student/class-invitations/${enrollmentId}/respond`, 'student-b', { accept: true })).status === 404);
  check('S11.sofia-accepts', (await post(`/api/student/class-invitations/${enrollmentId}/respond`, 'student-a', { accept: true })).status === 200);
  check('S11.teresa-notified-in-teacher-inbox', ((await get('/api/notifications/inbox', 'teacher-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'CLASS_ENROLLMENT_ACCEPTED'));

  // 12 -- Teresa sees Sofía and her real learning state.
  const roster = (await get(`/api/teacher/classes/${classA}/enrollments`, 'teacher-a')).body?.data?.roster ?? [];
  check('S12.roster-has-sofia', roster.some((r: any) => r.studentId === sofia && r.status === 'ACTIVE'));
  const lv = await get(`/api/teacher/classes/${classA}/students/${sofia}`, 'teacher-a');
  const topic = lv.body?.data?.concepts?.[0];
  check('S12.learner-view', lv.status === 200 && lv.body?.data?.klass?.subjectName === 'Mathematics' && topic?.topic === MANUAL_NAMES.concept, lv.text.slice(0, 160));
  check('S12.learner-view-canonical-phase', ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER', 'CONSOLIDATED'].includes(topic?.stage), `${topic?.stage}`);
  check('S12.learner-view-evidence', (topic?.evidence?.totalAttempts ?? 0) > 0, JSON.stringify(topic?.evidence ?? null));
  await page('12-teresa-sees-sofia', `/dashboard/teacher/classes/${classA}`, 'teacher-a', ['Quién necesita ayuda', 'Sofía Estudiante A']);
  await page('12b-learner-view', `/dashboard/teacher/classes/${classA}/students/${sofia}`, 'teacher-a', ['Estado de aprendizaje', 'Fase', 'Siguiente paso', 'Prácticas válidas', 'Evidencia', 'Dificultades', MANUAL_NAMES.concept], [/tutor/i, /Pilar Madre/]);
  check('S12.attention-api', (await get(`/api/teacher/classes/${classA}/attention`, 'teacher-a')).body?.data?.learners?.[0]?.studentId === sofia);

  // 13 -- Teresa creates the assignment "Linear Equations".
  const before13 = await n(`SELECT COUNT(*) n FROM teacher_interventions WHERE class_id = $1`, [classA]);
  check('S13.foreign-recipient-422', (await post(`/api/teacher/classes/${classA}/assignments`, 'teacher-a', { canonicalConceptId: x.canonical, studentIds: [studentB] })).status === 422);
  check('S13.concept-outside-subject-422', (await post(`/api/teacher/classes/${classA}/assignments`, 'teacher-a', { canonicalConceptId: '00000000-0000-4000-8000-000000000000' })).status === 422);
  check('S13.invalid-dates-422', (await post(`/api/teacher/classes/${classA}/assignments`, 'teacher-a', { canonicalConceptId: x.canonical, startsAt: '2030-01-10T00:00:00.000Z', dueAt: '2030-01-09T00:00:00.000Z' })).status === 422);
  check('S13.inst-admin-cannot-publish', denied(await post(`/api/teacher/classes/${classA}/assignments`, 'inst-a', { canonicalConceptId: x.canonical })));
  check('S13.teacherB-cannot-publish', denied(await post(`/api/teacher/classes/${classA}/assignments`, 'teacher-b', { canonicalConceptId: x.canonical })));
  check('S13.invalid-wrote-nothing', (await n(`SELECT COUNT(*) n FROM teacher_interventions WHERE class_id = $1`, [classA])) === before13);
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const publish = await post(`/api/teacher/classes/${classA}/assignments`, 'teacher-a', { canonicalConceptId: x.canonical, title: 'Repaso: ecuaciones lineales', instructions: 'Resuélvelo sin pistas.', dueAt: due, studentIds: [sofia] });
  check('S13.publish', publish.status === 201 && publish.body?.data?.assigned?.length === 1, publish.text.slice(0, 160));
  const interventionId = publish.body?.data?.assigned?.[0]?.interventionId as string;
  const row = await q1(`SELECT title, due_at, status, assigned_by_user_id, class_id FROM teacher_interventions WHERE id = $1`, [interventionId]);
  check('S13.row-fields', row?.title === 'Repaso: ecuaciones lineales' && row?.status === 'ASSIGNED' && row?.class_id === classA && row?.assigned_by_user_id === x.users['teacher-a']);

  // 14 -- Sofía receives, sees and completes it.
  check('S14.sofia-notified', ((await get('/api/notifications/inbox', 'student-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'ASSIGNMENT_PUBLISHED'));
  await page('14-sofia-assignments', '/dashboard/assignments', 'student-a', ['Repaso: ecuaciones lineales']);
  check('S14.teacher-cannot-start', denied(await post(`/api/student/teacher-interventions/${interventionId}/start`, 'teacher-a', { idempotencyKey: 'x' })));
  check('S14.studentB-cannot-start', denied(await post(`/api/student/teacher-interventions/${interventionId}/start`, 'student-b', { idempotencyKey: 'x' })));
  let start = await post(`/api/student/teacher-interventions/${interventionId}/start`, 'student-a', { idempotencyKey: `assignment:${interventionId}` });
  for (let attempt = 1; attempt < 4 && start.status === 503; attempt++) start = await post(`/api/student/teacher-interventions/${interventionId}/start`, 'student-a', { idempotencyKey: `assignment:${interventionId}` });
  check('S14.sofia-starts', start.status === 200 && start.body?.data?.outcome === 'STARTED', start.text.slice(0, 160));
  const quizId = start.body?.data?.executionReference;
  check('S14.status-started', ((await get(`/api/teacher/classes/${classA}/assignments`, 'teacher-a')).body?.data?.assignments?.[0]?.learners?.[0]?.status) === 'IN_PROGRESS');
  const session = await get(`/api/quizzes/session/${quizId}?studentId=${sofia}`, 'student-a');
  const questions: any[] = session.body?.data?.questions ?? [];
  const stored = await q1(`SELECT questions FROM quiz_sessions WHERE id = $1`, [quizId]);
  const key: any[] = stored?.questions ?? [];
  const answers = questions.map((qq: any, i: number) => ({ questionIndex: qq.index ?? i, answer: String(key[qq.index ?? i]?.correctAnswer ?? qq.options?.[0]?.id ?? 'x = 2') }));
  check('S14.teacher-cannot-submit', denied(await post('/api/quizzes/generate-and-take', 'teacher-a', { studentId: sofia, quizId, answers })));
  const submit = await post('/api/quizzes/generate-and-take', 'student-a', { studentId: sofia, quizId, answers });
  check('S14.sofia-submits', submit.status === 200, `${submit.status} ${submit.text.slice(0, 120)}`);

  // 15 -- Teresa sees progress and evidence.
  const after = (await get(`/api/teacher/classes/${classA}/assignments`, 'teacher-a')).body?.data?.assignments?.[0];
  check('S15.completed-with-result', after?.learners?.[0]?.status === 'COMPLETED' && (after?.learners?.[0]?.result?.total ?? 0) > 0, JSON.stringify(after?.learners?.[0] ?? {}).slice(0, 160));
  const lv2 = (await get(`/api/teacher/classes/${classA}/students/${sofia}`, 'teacher-a')).body?.data;
  check('S15.learner-view-assignment-completed', lv2?.assignments?.some((a: any) => a.interventionId === interventionId && a.status === 'COMPLETED'));
  check('S15.evidence-grew', (lv2?.concepts?.[0]?.evidence?.totalAttempts ?? 0) > (topic?.evidence?.totalAttempts ?? 0));
  await page('15-teresa-results', `/dashboard/teacher/classes/${classA}`, 'teacher-a', ['Completada', /\d+ de \d+ correctas/, 'Repaso: ecuaciones lineales']);

  // 16 -- tenant security with real ids.
  check('S16.teacherA-not-classB-roster', denied(await get(`/api/teacher/classes/${x.classB}/enrollments`, 'teacher-a')));
  check('S16.teacherA-not-studentB', denied(await get(`/api/teacher/classes/${x.classB}/students/${studentB}`, 'teacher-a')));
  check('S16.teacherA-studentB-via-own-class', denied(await get(`/api/teacher/classes/${classA}/students/${studentB}`, 'teacher-a')));
  check('S16.teacherA-not-instB', denied(await get(`/api/institutions/${x.instB}/intelligence/overview`, 'teacher-a')));
  check('S16.teacherA-not-instA-admin', denied(await get(`/api/institutions/${x.instA}/memberships/pending`, 'teacher-a')));
  check('S16.teacherA-not-instA-classes-admin', denied(await get(`/api/institutions/${x.instA}/classes`, 'teacher-a')));
  check('S16.teacherA-not-studyus-admin', denied(await get('/api/admin/requests', 'teacher-a')));
  check('S16.teacherA-not-studyus-admin-users', denied(await get('/api/admin/users', 'teacher-a')));
  check('S16.teacherB-not-sofia', denied(await get(`/api/teacher/classes/${classA}/students/${sofia}`, 'teacher-b')));
  check('S16.inst-admin-not-learner-view', denied(await get(`/api/teacher/classes/${classA}/students/${sofia}`, 'inst-a')));
  const evidencePayload = { studentId: sofia, conceptId: x.conceptA, subjectId: x.subjectA, result: 'correct', difficulty: 3, sourceType: 'PRACTICE', idempotencyKey: `ta-teacher-spoof-${Date.now()}` };
  check('S16.teacher-no-evidence-write', (await post('/api/learning/record-evidence', 'teacher-a', evidencePayload)).status === 403);
  check('S16.studentB-not-assignment', !(((await get('/api/student/teacher-interventions', 'student-b')).body?.data?.interventions ?? []) as any[]).some((i: any) => i.id === interventionId));
  const foreignPage = await get(`/dashboard/teacher/classes/${classA}`, 'teacher-b');
  check('PAGE.16-teacherB-not-found-on-classA', foreignPage.status === 404 && !foreignPage.text.includes('Sofía Estudiante A'), `${foreignPage.status}`);
  const foreignLearner = await get(`/dashboard/teacher/classes/${classA}/students/${sofia}`, 'teacher-b');
  check('PAGE.16b-teacherB-not-found-on-sofia', foreignLearner.status === 404 && !foreignLearner.text.includes('Estado de aprendizaje'), `${foreignLearner.status}`);

  // 17 -- removal revokes access immediately.
  const enrollment = await q1(`SELECT id FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classA, sofia]);
  check('S17.teacher-removes-sofia', (await post(`/api/teacher/classes/${classA}/enrollments/${enrollment.id}/end`, 'teacher-a')).status === 200);
  check('S17.access-revoked', denied(await get(`/api/teacher/classes/${classA}/students/${sofia}`, 'teacher-a')));
  check('S17.reinvite-reopens', (await post(`/api/teacher/classes/${classA}/enrollments`, 'teacher-a', { email: emailFor('student-a') })).body?.data?.outcome === 'INVITED');
  const reinv = (await get('/api/student/class-invitations', 'student-a')).body?.data?.invitations ?? [];
  check('S17.sofia-reaccepts', (await post(`/api/student/class-invitations/${reinv[0]?.enrollmentId}/respond`, 'student-a', { accept: true })).status === 200);

  // 18 -- data integrity.
  check('S18.no-mastery-for-other-students', (await n(`SELECT COUNT(*) n FROM mastery_records WHERE student_id = ANY($1::uuid[]) AND student_id <> $2`, [allStudents, sofia])) <= masteryBefore);
  check('S18.no-evidence-for-other-students', (await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[]) AND student_id <> $2`, [allStudents, sofia])) === evidenceOthersBefore);
  check('S18.single-persona-per-fixture', (await n(`SELECT COUNT(*) n FROM (SELECT user_id FROM user_roles WHERE user_id = ANY($1::uuid[]) AND role IN ('STUDENT','PARENT','TEACHER') AND status = 'ACTIVE' GROUP BY user_id HAVING COUNT(*) > 1) d`, [Object.values(x.users)])) === 0);
  check('S18.no-duplicate-enrollments', (await n(`SELECT COUNT(*) n FROM (SELECT class_id, student_id FROM class_enrollments GROUP BY 1, 2 HAVING COUNT(*) > 1) d`)) === 0);
  check('S18.interventions-in-own-tenant', (await n(`SELECT COUNT(*) n FROM teacher_interventions ti JOIN classes c ON c.id = ti.class_id WHERE ti.institution_id <> c.institution_id`)) === 0);
  check('S18.interventions-only-active-learners-at-publish', (await n(`SELECT COUNT(*) n FROM teacher_interventions WHERE class_id = $1 AND student_id <> $2`, [classA, sofia])) === 0);
  check('S18.teacher-wrote-no-evidence', (await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1 AND (metadata->>'actorUserId') = $2`, [sofia, x.users['teacher-a']])) === 0);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\nTEACHER E2E: ${results.length - failed.length}/${results.length} PASS${failed.length ? ' -- FAILED: ' + failed.map((f) => f.id).join(', ') : ''}`);
    if (failed.length) process.exitCode = 1;
    await (db as any).end?.();
  });
