/**
 * Track A -- Institution FIRST-TIME OPERATIONAL E2E over REAL HTTP as REAL Clerk DEV identities
 * (spec §13, steps 1-22), with the DEV database checked read-only for every write the journey
 * should -- and should NOT -- produce.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts provision
 *   npx tsx --env-file=.env.local scripts/operations/track-a-institution-operational-e2e-http.ts <baseUrl> <tokens.json>
 *   (hosted DEV: VERCEL_PROTECTION_BYPASS=<existing automation bypass secret>)
 *
 * World (built here, DEV fixtures only): an EMPTY "Institution E2E Ops" coordinated by ops-coord.
 * ops-teacher is a Teacher account with no institution; student-a (Sofía) is an EXISTING Student
 * (proves "connect existing Student, never a duplicate account"); teacher-b requests membership
 * (proves the approval path). Everything is removed by `institution-reset` (prefix "Institution E2E").
 *
 * Hosted AI cap: a learning activity that cannot be generated because the shared DEV AI daily cap
 * is exhausted (ai_execution_events RATE_LIMIT) is reported as ENV, never as a code failure.
 */
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { createInstitution, inviteInstitutionAdmin } from '@/services/institution.service';
import { assertDev, clerk, emailFor, findClerkUser, institutionReset, E2E_INSTITUTION_PREFIX, INST_A_NAME, INST_B_NAME, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Record<Tag, string> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));
const INSTITUTION = `${E2E_INSTITUTION_PREFIX} Ops`;
const SUITE_TAGS: Tag[] = ['ops-coord', 'ops-teacher', 'student-a', 'teacher-b', 'inst-a', 'parent-a'];

const results: Array<{ id: string; ok: boolean | 'ENV'; detail: string }> = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
const env = (id: string, detail: string) => {
  results.push({ id, ok: 'ENV', detail });
  console.log(`ENV   ${id}  [${detail}]`);
};

let mintedAt = 0;
async function freshTokens(force = false) {
  if (!force && Date.now() - mintedAt < 6 * 60_000) return;
  for (const tag of SUITE_TAGS) {
    const u = await findClerkUser(tag);
    if (!u) throw new Error(`missing Clerk identity ${tag} -- run track-a-fixtures.ts provision`);
    const session = await clerk().sessions.createSession({ userId: u.id });
    TOKENS[tag] = (await clerk().sessions.getToken(session.id, undefined, 600)).jwt;
  }
  mintedAt = Date.now();
}

interface Res {
  status: number;
  body: any;
  text: string;
}
async function call(method: string, path: string, who: Tag | null, body?: unknown): Promise<Res> {
  await freshTokens();
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
const visible = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
async function page(id: string, path: string, who: Tag, mustContain: Array<string | RegExp>, mustNot: Array<string | RegExp> = []) {
  const r = await get(path, who);
  const text = visible(r.text);
  const has = (m: string | RegExp) => (typeof m === 'string' ? text.includes(m) : m.test(text));
  const missing = mustContain.filter((m) => !has(m));
  const present = [...mustNot, UUID].filter(has);
  check(`PAGE.${id}`, r.status === 200 && missing.length === 0 && present.length === 0, `${r.status}${missing.length ? ' missing ' + missing.map(String).join(' | ') : ''}${present.length ? ' unexpected ' + present.map(String).join(' | ') : ''}`);
}
const q1 = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await q1(sql, p))?.n ?? 0);

async function prepare() {
  assertDev();
  await institutionReset(); // removes every "Institution E2E …" institution (incl. a previous Ops run) and what was filed under it
  const users: Record<string, string> = {};
  const students: Record<string, string> = {};
  for (const tag of SUITE_TAGS) {
    const u = await q1(`SELECT u.id, s.id AS student_id FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE u.email = $1`, [emailFor(tag)]);
    if (!u) throw new Error(`fixture ${tag} missing -- run track-a-fixtures.ts provision`);
    users[tag] = u.id;
    if (u.student_id) students[tag] = u.student_id;
  }
  // ops-teacher has no institution relationship at all before the journey.
  await db.query(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE user_id = $1)`, [users['ops-teacher']]);
  await db.query(`DELETE FROM institution_memberships WHERE user_id = $1`, [users['ops-teacher']]);
  await db.query(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[])`, [[users['ops-teacher'], users['ops-coord']]]);
  const inst = (await createInstitution(INSTITUTION)).id;
  await inviteInstitutionAdmin(inst, users['ops-coord']);
  const instA = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).id;
  const instB = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_B_NAME])).id;
  const classB = (await q1(`SELECT id FROM classes WHERE institution_id = $1 LIMIT 1`, [instB])).id;
  const le = (await q1(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cc.name = 'Linear Equations' AND cs.name = 'Mathematics' AND cc.status = 'ACTIVE'`)).id;
  return { inst, instA, instB, classB, users, students, le };
}

async function main() {
  if (!BASE) throw new Error('usage: <baseUrl> <tokens.json>');
  await freshTokens(true);
  const w = await prepare();
  const base = `/api/institutions/${w.inst}`;
  const dash = `/dashboard/institution/${w.inst}`;
  const sofia = w.students['student-a'];
  console.log(`prepared: ${INSTITUTION} ${w.inst}`);

  // ------------------------------------------------------------------ 0. empty institution: quick actions, guided setup, empty states
  console.log('\n--- 0 first-time coordinator view');
  await page('0-summary-quick-actions', dash, 'ops-coord', ['Acciones rápidas', '+ Crear grado', '+ Crear clase', '+ Configurar currículo', '+ Invitar docente', '+ Añadir estudiante', '+ Añadir coordinador']);
  const summary = visible((await get(dash, 'ops-coord')).text);
  const order = ['Crear grados', 'Configurar currículo', 'Crear clases', 'Invitar docentes', 'Añadir estudiantes'].map((s) => summary.indexOf(`. ${s}`));
  check('0.guided-setup-in-order', summary.includes('Configura tu institución') && summary.includes('0 de 5 pasos completados') && order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), order.join(','));
  await page('0-grades-empty', `${dash}/grades`, 'ops-coord', ['Todavía no tienes grados.', 'Crear primer grado']);
  await page('0-classes-empty', `${dash}/classes`, 'ops-coord', ['Todavía no tienes clases.', 'Primero crea un grado', 'Crear primer grado']);
  await page('0-teachers-empty', `${dash}/teachers`, 'ops-coord', ['Todavía no hay docentes.', 'Invitar docente']);
  await page('0-students-empty', `${dash}/students`, 'ops-coord', ['Todavía no hay estudiantes.', 'Primero crea una clase', 'Crear primera clase']);
  await page('0-curriculum-empty', `${dash}/curriculum`, 'ops-coord', ['Tu institución todavía no tiene un currículo configurado.', 'Configurar currículo']);

  // ------------------------------------------------------------------ 1. grade
  console.log('\n--- 1-4 grade, curriculum, class, explicit binding');
  const grade = await post(`${base}/grades`, 'ops-coord', { name: '10.º Ops', academicYear: '2026-2027' });
  const gradeId = grade.body?.data?.grade?.id;
  check('1.create-grade', grade.status === 201 && !!gradeId, `${grade.status} ${grade.text.slice(0, 120)}`);
  check('1.duplicate-grade-refused', (await post(`${base}/grades`, 'ops-coord', { name: '10.º Ops' })).status >= 400);

  // ------------------------------------------------------------------ 2. curriculum
  const sources = (await get(`${base}/curriculum/subjects`, 'ops-coord')).body?.data?.sources ?? [];
  const aice = sources.find((s: any) => s.programme === 'Cambridge AICE Diploma' && s.subject === 'Mathematics' && s.level === 'AS Level');
  const cur = await post(`${base}/curriculum/subjects`, 'ops-coord', { gradeId, items: [{ academicSubjectId: aice?.academicSubjectId, versionId: aice?.versionId }] });
  const curriculumId = cur.body?.data?.results?.[0]?.curriculumId;
  check('2.configure-curriculum', cur.status === 201 && !!curriculumId, `${cur.status} ${cur.text.slice(0, 120)}`);

  // ------------------------------------------------------------------ 3. class (unbound: no automatic binding)
  const c3a = await post(`${base}/classes`, 'ops-coord', { name: 'Math 3A', gradeId, academicDomainCode: 'MATHEMATICS', period: '2026-2027' });
  const classId = c3a.body?.data?.class?.id;
  check('3.create-class', c3a.status === 201 && !!classId, `${c3a.status} ${c3a.text.slice(0, 160)}`);
  check('3.no-automatic-binding', (await q1(`SELECT institution_curriculum_id FROM classes WHERE id = $1`, [classId]))?.institution_curriculum_id === null);
  check('3.class-requires-grade', (await post(`${base}/classes`, 'ops-coord', { name: 'Sin grado' })).status >= 400 && (await n(`SELECT COUNT(*) n FROM classes WHERE institution_id = $1 AND name = 'Sin grado'`, [w.inst])) === 0);
  check('3.duplicate-active-name-refused', (await post(`${base}/classes`, 'ops-coord', { name: 'Math 3A', gradeId, academicDomainCode: 'MATHEMATICS' })).status >= 400);

  // ------------------------------------------------------------------ 4. explicit binding
  const cands = await get(`${base}/classes/${classId}/curriculum`, 'ops-coord');
  const cand = (cands.body?.data?.candidates ?? []).find((c: any) => c.curriculumId === curriculumId);
  check('4.candidates-labelled', cands.status === 200 && cand?.compatible === true && /Mathematics/.test(cand.label) && /AS Level/.test(cand.label) && !UUID.test(cand.label), cand?.label);
  const bind = await post(`${base}/classes/${classId}/curriculum`, 'ops-coord', { curriculumId });
  check('4.explicit-binding', bind.status === 200 && (await q1(`SELECT institution_curriculum_id FROM classes WHERE id = $1`, [classId]))?.institution_curriculum_id === curriculumId, `${bind.status} ${bind.text.slice(0, 120)}`);
  check('4.binding-audited', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND object_id = $2 AND action LIKE 'CLASS_CURRICULUM_%'`, [w.inst, classId])) >= 1);
  const c3b = await post(`${base}/classes`, 'ops-coord', { name: 'Math 3B', gradeId, academicDomainCode: 'MATHEMATICS', institutionCurriculumId: curriculumId });
  const classB2 = c3b.body?.data?.class?.id;
  check('4.create-with-explicit-curriculum', c3b.status === 201 && (await q1(`SELECT institution_curriculum_id FROM classes WHERE id = $1`, [classB2]))?.institution_curriculum_id === curriculumId, `${c3b.status}`);

  // ------------------------------------------------------------------ 5-8. teachers
  console.log('\n--- 5-8 teachers');
  const inv = await post(`${base}/teachers`, 'ops-coord', { email: emailFor('ops-teacher') });
  const membershipId = inv.body?.data?.membershipId;
  check('5.invite-teacher', inv.status === 201 && inv.body?.data?.status === 'INVITED', `${inv.status} ${inv.text.slice(0, 120)}`);
  check('5.no-teacher-account-refused', (await post(`${base}/teachers`, 'ops-coord', { email: 'nobody-ops+clerk_test@example.com' })).status >= 400);
  check('5.invited-teacher-has-no-class-access', denied(await get(`/api/teacher/classes/${classId}/roster`, 'ops-teacher')));
  const myInv = await get('/api/teacher/institution-invitations', 'ops-teacher');
  check('6.teacher-sees-invitation', myInv.status === 200 && JSON.stringify(myInv.body).includes(membershipId), myInv.text.slice(0, 160));
  check('6.other-teacher-cannot-answer', denied(await post(`/api/teacher/institution-invitations/${membershipId}/respond`, 'teacher-b', { accept: true })));
  const acc = await post(`/api/teacher/institution-invitations/${membershipId}/respond`, 'ops-teacher', { accept: true });
  check('6.teacher-accepts', acc.status === 200 && (await q1(`SELECT status FROM institution_memberships WHERE id = $1`, [membershipId]))?.status === 'APPROVED', `${acc.status} ${acc.text.slice(0, 120)}`);
  const req = await post(`${base}/membership`, 'teacher-b', {});
  const reqId = (await q1(`SELECT id, status FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND membership_role = 'TEACHER'`, [w.inst, w.users['teacher-b']]));
  check('7.teacher-requests-membership', (req.status === 200 || req.status === 201) && reqId?.status === 'PENDING', `${req.status} ${reqId?.status}`);
  const decide = await post(`${base}/memberships/${reqId?.id}/decide`, 'ops-coord', { decision: 'APPROVED' });
  check('7.coordinator-approves', decide.status === 200 && (await q1(`SELECT status FROM institution_memberships WHERE id = $1`, [reqId?.id]))?.status === 'APPROVED', `${decide.status}`);
  check('7.teacher-cannot-self-assign', denied(await post(`${base}/classes/${classId}/teacher`, 'ops-teacher', { membershipId })));
  const assign = await post(`${base}/classes/${classId}/teacher`, 'ops-coord', { membershipId });
  check('8.assign-teacher-to-class', assign.status === 200 && (await n(`SELECT COUNT(*) n FROM teacher_assignments WHERE class_id = $1 AND institution_membership_id = $2 AND status = 'ACTIVE'`, [classId, membershipId])) === 1, `${assign.status} ${assign.text.slice(0, 120)}`);
  const tlist = (await get(`${base}/teachers`, 'ops-coord')).body?.data?.teachers ?? (await get(`${base}/teachers`, 'ops-coord')).body?.data ?? [];
  check('8.teacher-status-shown', JSON.stringify(tlist).includes('APPROVED') && JSON.stringify(tlist).includes('Math 3A'));

  // ------------------------------------------------------------------ 9-11. students
  console.log('\n--- 9-11 students');
  const accountsBefore = await n(`SELECT COUNT(*) n FROM students WHERE user_id = $1`, [w.users['student-a']]);
  const addS = await post(`${base}/students`, 'ops-coord', { email: emailFor('student-a'), classId });
  check('9.invite-existing-student', addS.status === 201 && addS.body?.data?.outcome === 'INVITED' && addS.body?.data?.studentId === sofia, `${addS.status} ${addS.text.slice(0, 120)}`);
  check('9.no-student-account-refused', (await post(`${base}/students`, 'ops-coord', { email: 'nobody-ops+clerk_test@example.com', classId })).status >= 400);
  check('9.invitation-not-access', denied(await get(`/api/teacher/classes/${classId}/students/${sofia}`, 'ops-teacher')) || (await n(`SELECT COUNT(*) n FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [classId, sofia])) === 0);
  const pending = await q1(`SELECT id FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'PENDING'`, [classId, sofia]);
  const sinv = await get('/api/student/class-invitations', 'student-a');
  check('10.student-sees-invitation', sinv.status === 200 && JSON.stringify(sinv.body).includes('Math 3A'));
  check('10.other-student-cannot-accept', denied(await post(`/api/student/class-invitations/${pending?.id}/respond`, 'teacher-b', { accept: true })));
  const sacc = await post(`/api/student/class-invitations/${pending?.id}/respond`, 'student-a', { accept: true });
  check('10.student-accepts', sacc.status === 200 && (await q1(`SELECT status FROM class_enrollments WHERE id = $1`, [pending?.id]))?.status === 'ACTIVE', `${sacc.status}`);
  check('10.no-duplicate-account', (await n(`SELECT COUNT(*) n FROM students WHERE user_id = $1`, [w.users['student-a']])) === accountsBefore && accountsBefore === 1);
  const enr = await post(`${base}/students/${sofia}/enroll`, 'ops-coord', { classId: classB2 });
  check('11.coordinator-enrolls-in-class', enr.status === 201 && (await q1(`SELECT status FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classB2, sofia]))?.status === 'ACTIVE', `${enr.status} ${enr.text.slice(0, 120)}`);
  check('11.duplicate-enrollment-refused', (await post(`${base}/students/${sofia}/enroll`, 'ops-coord', { classId: classB2 })).status >= 400 && (await n(`SELECT COUNT(*) n FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classB2, sofia])) === 1);
  check('11.foreign-student-refused', denied(await post(`${base}/students/${w.students['student-b'] ?? '00000000-0000-4000-8000-000000000000'}/enroll`, 'ops-coord', { classId })));

  // ------------------------------------------------------------------ 12-14. teacher signs in
  console.log('\n--- 12-14 teacher');
  const tc = await get('/api/teacher/classes', 'ops-teacher');
  const tClasses: any[] = tc.body?.data?.classes ?? [];
  check('12-13.teacher-sees-assigned-class', tc.status === 200 && tClasses.some((c) => (c.id ?? c.classId) === classId) && !tClasses.some((c) => (c.id ?? c.classId) === classB2), JSON.stringify(tClasses.map((c) => c.name)));
  const roster = await get(`/api/teacher/classes/${classId}/roster`, 'ops-teacher');
  check('14.teacher-sees-student', roster.status === 200 && JSON.stringify(roster.body).includes(sofia));
  check('14.unassigned-teacher-denied', denied(await get(`/api/teacher/classes/${classId}/roster`, 'teacher-b')));
  check('14.teacher-cannot-create-structure', denied(await post(`${base}/grades`, 'ops-teacher', { name: 'x' })) && denied(await post(`${base}/classes`, 'ops-teacher', { name: 'x', gradeId })));
  await page('13-teacher-dashboard', '/dashboard/teacher', 'ops-teacher', ['Math 3A'], ['Math 3B']);

  // ------------------------------------------------------------------ 15-16. assignments
  console.log('\n--- 15-17 assignments');
  const k = `/api/teacher/classes/${classId}`;
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const sup = await post(`${k}/assignments`, 'ops-teacher', { canonicalConceptId: w.le, title: 'Ops: tarea complementaria', studentIds: [sofia], dueAt: due });
  const supGroup = sup.body?.data?.assignmentGroupId;
  check('15.teacher-supplemental-assignment', sup.status === 201 && sup.body?.data?.assigned?.length === 1, `${sup.status} ${sup.text.slice(0, 160)}`);
  const view = await get(`${k}/plan`, 'ops-teacher');
  const v = view.body?.data;
  check('16.teacher-sees-class-curriculum', view.status === 200 && v?.curriculum?.level === 'AS Level', JSON.stringify(v?.curriculum));
  const planConcept = (v?.concepts ?? []).find((c: any) => c.classification && c.canonicalConceptId !== w.le)?.canonicalConceptId;
  const addPlan = await post(`${k}/plan`, 'ops-teacher', { canonicalConceptId: planConcept, priority: 'HIGH' });
  const fromPlan = await post(`${k}/plan/${planConcept}/assign`, 'ops-teacher', { studentIds: [sofia] });
  check('16.assignment-from-class-plan', (addPlan.status === 201 || addPlan.status === 200) && fromPlan.status === 200 && fromPlan.body?.data?.assigned === 1, `${addPlan.status} ${fromPlan.status} ${fromPlan.text.slice(0, 120)}`);
  const inst = await post(`${base}/institution-assignments`, 'ops-coord', { canonicalConceptId: planConcept, title: 'Ops: tarea institucional', dueAt: due, deliveryMode: 'TEACHER_SELECTS_RECIPIENTS', classIds: [classId] });
  const instId = inst.body?.data?.id;
  const recip = await post(`${k}/institution-assignments/${instId}/recipients`, 'ops-teacher', { studentIds: [sofia] });
  check('16.assignment-from-institution-template', inst.status === 201 && recip.status === 200 && recip.body?.data?.assigned?.length === 1, `${inst.status} ${recip.status}`);
  const instGroup = (await q1(`SELECT assignment_group_id FROM institution_assignment_targets WHERE assignment_id = $1`, [instId]))?.assignment_group_id;
  const lockTry = await patch(`${k}/assignments/${instGroup}`, 'ops-teacher', { dueAt: new Date(Date.now() + 20 * 86_400_000).toISOString() });
  check('16.institution-locked-fields', lockTry.status === 403 && lockTry.body?.error === 'FIELD_LOCKED_BY_INSTITUTION', `${lockTry.status}`);
  const own = await patch(`${k}/assignments/${supGroup}`, 'ops-teacher', { dueAt: new Date(Date.now() + 15 * 86_400_000).toISOString() });
  check('16.own-assignment-editable', own.status === 200, `${own.status}`);

  // ------------------------------------------------------------------ 17-19. student works
  const list = await get('/api/student/teacher-interventions', 'student-a');
  const sup1 = await q1(`SELECT id FROM teacher_interventions WHERE assignment_group_id = $1 AND student_id = $2`, [supGroup, sofia]);
  check('17.student-sees-assigned-work', list.status === 200 && JSON.stringify(list.body).includes(sup1?.id) && JSON.stringify(list.body).includes('Ops: tarea institucional'));
  await page('17-student-assignments', '/dashboard/assignments', 'student-a', ['Ops: tarea complementaria', 'Asignación institucional']);
  console.log('\n--- 18-21 learning, learner state, progress, counts');
  const evidenceBefore = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [sofia]);
  const masteryBefore = await q1(`SELECT COALESCE(SUM(attempt_count), 0)::int AS a, COUNT(*)::int AS n FROM mastery_records WHERE student_id = $1`, [sofia]);
  if (process.env.OPS_SKIP_AI === '1') {
    // Presentation-only re-certification: the AI chain (18-20) is certified by a previous hosted run; spend no AI quota.
    for (const id of ['18.student-begins-activity', '19.learner-state-updated', '20.teacher-sees-progress']) {
      results.push({ id, ok: 'ENV', detail: 'SKIPPED (OPS_SKIP_AI=1)' });
      console.log(`SKIP  ${id}`);
    }
  }
  let start = process.env.OPS_SKIP_AI === '1' ? ({ status: 0, body: null, text: '' } as Res) : await post(`/api/student/teacher-interventions/${sup1?.id}/start`, 'student-a', { idempotencyKey: `assignment:${sup1?.id}` });
  // Generation is all-or-nothing; a 503 writes nothing. The shared DEV AI limit has a per-minute window:
  // wait for it to reset (65 s) and retry, as the Student would. Never raise the cap.
  for (let attempt = 1; attempt <= 4 && start.status === 503 && process.env.OPS_SKIP_AI !== '1'; attempt++) {
    await new Promise((r) => setTimeout(r, 65_000));
    start = await post(`/api/student/teacher-interventions/${sup1?.id}/start`, 'student-a', { idempotencyKey: `assignment:${sup1?.id}` });
  }
  const skipAI = process.env.OPS_SKIP_AI === '1';
  const rateLimited = start.status === 503 && (await n(`SELECT COUNT(*) n FROM ai_execution_events WHERE error_code = 'RATE_LIMIT' AND created_at > now() - interval '10 minutes'`)) > 0;
  if (skipAI) {
    // reported above
  } else if (rateLimited) {
    env('18.student-begins-activity', `GENERATION_FAILED: shared DEV AI limit (RATE_LIMIT) still active after 4 waits of 65 s; not a code failure`);
    env('19.learner-state-updated', 'depends on 18');
    env('20.teacher-sees-progress', 'depends on 18');
  } else {
    check('18.student-begins-activity', start.status === 200 && start.body?.data?.outcome === 'STARTED', `${start.status} ${start.text.slice(0, 160)}`);
    const quizId = start.body?.data?.executionReference;
    const session = await get(`/api/quizzes/session/${quizId}?studentId=${sofia}`, 'student-a');
    const questions: any[] = session.body?.data?.questions ?? [];
    const answers = questions.map((qq) => ({
      questionIndex: qq.index,
      answer: qq.answerFormat === 'single_choice' || qq.answerFormat === 'multi_choice' ? qq.options?.[0]?.id ?? '' : qq.answerFormat === 'text' ? 'x = 2' : qq.answerFormat === 'ordering' ? JSON.stringify(qq.orderingItemsShuffled ?? []) : '{}',
    }));
    check('18.teacher-cannot-submit-for-student', denied(await post('/api/quizzes/generate-and-take', 'ops-teacher', { studentId: sofia, quizId, answers })));
    const submit = await post('/api/quizzes/generate-and-take', 'student-a', { studentId: sofia, quizId, answers });
    check('18.student-submits', submit.status === 200 && questions.length > 0, `${submit.status} q=${questions.length}`);
    const evidenceAfter = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [sofia]);
    const masteryAfter = await q1(`SELECT COALESCE(SUM(attempt_count), 0)::int AS a, COUNT(*)::int AS n FROM mastery_records WHERE student_id = $1`, [sofia]);
    check('19.learner-state-updated', evidenceAfter > evidenceBefore && masteryAfter.a > masteryBefore.a, `evidence ${evidenceBefore}->${evidenceAfter} attempts ${masteryBefore.a}->${masteryAfter.a}`);
    const ta = await get(`${k}/assignments`, 'ops-teacher');
    const learner = (ta.body?.data?.assignments ?? []).flatMap((a: any) => a.learners ?? []).find((l: any) => l.interventionId === sup1?.id);
    const prog = await get(`${k}/progress?period=all`, 'ops-teacher');
    const row = (prog.body?.data?.students ?? []).find((s: any) => s.studentId === sofia);
    check('20.teacher-sees-progress', learner?.status === 'COMPLETED' && prog.status === 200 && row?.lastActivity != null, `${learner?.status} ${row?.lastActivity}`);
  }
  const cov = await get(`${base}/curriculum/coverage?gradeId=${gradeId}`, 'ops-coord');
  const covRow = (cov.body?.data?.subjects ?? []).find((s: any) => s.curriculumId === curriculumId);
  check('21.institution-coverage-updated', cov.status === 200 && covRow?.classes === 2 && covRow?.students === 1 && covRow?.inClassPlans >= 1 && covRow?.inStudentPlans >= 1, JSON.stringify(covRow && { cl: covRow.classes, st: covRow.students, c: covRow.inClassPlans, s: covRow.inStudentPlans }));
  const summaryAfter = visible((await get(dash, 'ops-coord')).text);
  check('21.summary-setup-complete', !summaryAfter.includes('Configura tu institución') && summaryAfter.includes('Acciones rápidas'));
  await page('21-students-list', `${dash}/students`, 'ops-coord', ['Math 3A', 'Math 3B']);

  // ------------------------------------------------------------------ 22. modify / archive without deleting history
  console.log('\n--- 22 modify / archive / suspend / move');
  const ren = await patch(`${base}/classes/${classId}`, 'ops-coord', { name: 'Math 3A · AICE' });
  check('22.edit-class-keeps-binding', ren.status === 200 && (await q1(`SELECT name, institution_curriculum_id FROM classes WHERE id = $1`, [classId]))?.institution_curriculum_id === curriculumId, `${ren.status}`);
  const historyBefore = await n(`SELECT COUNT(*) n FROM class_enrollments WHERE class_id = $1`, [classB2]);
  const arch = await post(`${base}/classes/${classB2}/archive`, 'ops-coord', {});
  check('22.archive-class', arch.status === 200 && (await q1(`SELECT status FROM classes WHERE id = $1`, [classB2]))?.status === 'ARCHIVED', `${arch.status} ${arch.text.slice(0, 120)}`);
  check('22.history-kept', (await n(`SELECT COUNT(*) n FROM class_enrollments WHERE class_id = $1`, [classB2])) === historyBefore && (await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [sofia])) >= evidenceBefore);
  check('22.archived-class-locked', (await post(`${base}/students/${sofia}/enroll`, 'ops-coord', { classId: classB2 })).status >= 400);
  const react = await post(`${base}/classes/${classB2}/reactivate`, 'ops-coord', {});
  check('22.reactivate-class', react.status === 200 && (await q1(`SELECT status FROM classes WHERE id = $1`, [classB2]))?.status === 'ACTIVE', `${react.status}`);
  const c3c = await post(`${base}/classes`, 'ops-coord', { name: 'Math 3C', gradeId, academicDomainCode: 'MATHEMATICS' });
  const classC = c3c.body?.data?.class?.id;
  const mv = await post(`${base}/students/${sofia}/move`, 'ops-coord', { fromClassId: classB2, toClassId: classC });
  check('22.move-student-keeps-history', mv.status === 200 && (await q1(`SELECT status FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classB2, sofia]))?.status === 'ENDED' && (await q1(`SELECT status FROM class_enrollments WHERE class_id = $1 AND student_id = $2`, [classC, sofia]))?.status === 'ACTIVE', `${mv.status} ${mv.text.slice(0, 120)}`);
  const susp = await post(`${base}/teachers/${membershipId}/suspend`, 'ops-coord', {});
  check('22.suspended-teacher-loses-access', susp.status === 200 && denied(await get(`/api/teacher/classes/${classId}/roster`, 'ops-teacher')), `${susp.status}`);
  const reac = await post(`${base}/teachers/${membershipId}/reactivate`, 'ops-coord', {});
  check('22.reactivated-teacher-regains-access', reac.status === 200 && (await get(`/api/teacher/classes/${classId}/roster`, 'ops-teacher')).status === 200);
  const garch = await post(`${base}/grades/${gradeId}/archive`, 'ops-coord', {});
  check('22.grade-with-active-classes-not-deleted', (await call('DELETE', `${base}/grades/${gradeId}`, 'ops-coord')).status >= 400 && (await n(`SELECT COUNT(*) n FROM grades WHERE id = $1`, [gradeId])) === 1, `archive=${garch.status}`);

  // ------------------------------------------------------------------ security / tenant isolation
  console.log('\n--- security');
  check('SEC.other-coordinator', denied(await get(`${base}/classes`, 'inst-a')) && denied(await post(`${base}/grades`, 'inst-a', { name: 'x' })));
  check('SEC.foreign-class-id', denied(await post(`${base}/classes/${w.classB}/teacher`, 'ops-coord', { membershipId })) && denied(await post(`${base}/classes/${w.classB}/archive`, 'ops-coord', {})));
  check('SEC.foreign-grade-id', (await post(`${base}/classes`, 'ops-coord', { name: 'x', gradeId: (await q1(`SELECT id FROM grades WHERE institution_id = $1 LIMIT 1`, [w.instB]))?.id })).status === 404);
  check('SEC.student-denied', denied(await get(`${base}/teachers`, 'student-a')) && denied(await get(`${base}/students`, 'student-a')));
  check('SEC.parent-denied', denied(await get(`${base}/classes`, 'parent-a')));
  check('SEC.teacher-denied-admin', denied(await get(`${base}/students`, 'ops-teacher')) && denied(await post(`${base}/teachers`, 'ops-teacher', { email: emailFor('teacher-b') })));
  check('SEC.anonymous', (await get(`${base}/classes`, null)).status === 401);
  check('SEC.foreign-pages', (await get(dash, 'inst-a')).status === 404 && (await get(dash, 'ops-teacher')).status === 404);
  check('SEC.audit-every-change', (await n(`SELECT COUNT(*) n FROM academic_governance_events WHERE institution_id = $1 AND actor_user_id IS NULL`, [w.inst])) === 0 &&
    (await n(`SELECT COUNT(DISTINCT action) n FROM academic_governance_events WHERE institution_id = $1`, [w.inst])) >= 10);

  const failed = results.filter((r) => r.ok === false);
  const envs = results.filter((r) => r.ok === 'ENV');
  console.log(`\n${results.length - failed.length - envs.length}/${results.length} checks passed${envs.length ? `, ${envs.length} ENV/SKIPPED (AI)` : ''}`);
  if (failed.length) {
    console.log('FAILED:\n' + failed.map((f) => `  ${f.id} ${f.detail}`).join('\n'));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (db as any).end?.();
  });
