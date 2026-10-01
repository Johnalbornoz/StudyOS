/**
 * Track A (Roles E2E) -- the integrated role flow (A5), the A1-A4 lifecycles
 * and the security matrix, executed over REAL HTTP against a running
 * StudyUS deployment, as REAL Clerk DEV identities (backend-issued session
 * tokens, sent as `Authorization: Bearer`), with the DEV database checked
 * directly for every write the flow should -- and should NOT -- produce.
 *
 *   # local production server (next start) on DEV DB + DEV Clerk:
 *   npx tsx --env-file=.env.local scripts/operations/track-a-e2e-http.ts http://localhost:3200 <tokens.json>
 *   # hosted DEV (Vercel Authentication) with an existing automation bypass secret:
 *   VERCEL_PROTECTION_BYPASS=<secret> npx tsx --env-file=.env.local scripts/operations/track-a-e2e-http.ts https://<dev-deployment> <tokens.json>
 *   # or through `vercel curl` (slower, one CLI call per request):
 *   TRANSPORT=vercel VERCEL_LINK_DIR=<dir with .vercel/project.json> \
 *     npx tsx --env-file=.env.local scripts/operations/track-a-e2e-http.ts https://<dev-deployment> <tokens.json>
 *
 * Prerequisite: `track-a-fixtures.ts provision` then `tokens <file>`.
 * The run is re-runnable: it first resets Institution A and every
 * relationship the flow creates back to the provisioned state.
 */
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { assertDev, INST_A_NAME, INST_B_NAME, emailFor, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Record<Tag, string> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));
const TRANSPORT = process.env.TRANSPORT ?? 'fetch';

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

async function viaFetch(method: string, path: string, token: string | null, body?: unknown): Promise<Res> {
  // Hosted DEV sits behind Vercel Authentication: an EXISTING automation
  // bypass secret (never created by this script) may be supplied via env.
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function viaVercelCurl(method: string, path: string, token: string | null, body?: unknown): Promise<Res> {
  const args = ['-y', 'vercel@latest', 'curl', path, '--deployment', BASE, '--cwd', process.env.VERCEL_LINK_DIR ?? '.', '--', '-s', '-X', method, '-w', '\n__STATUS__%{http_code}'];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => {
      const m = out.match(/\n__STATUS__(\d{3})\s*$/);
      const text = m ? out.slice(0, m.index) : out;
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      resolve({ status: m ? Number(m[1]) : 0, body: parsed, text });
    });
  });
}

const call = (method: string, path: string, who: Tag | null, body?: unknown) =>
  (TRANSPORT === 'vercel' ? viaVercelCurl : viaFetch)(method, path, who ? TOKENS[who] : null, body);
const get = (path: string, who: Tag | null) => call('GET', path, who);
const post = (path: string, who: Tag | null, body: unknown = {}) => call('POST', path, who, body);
/** Authenticated page render (server components render the identity's real data). */
async function page(id: string, path: string, who: Tag, mustContain: Array<string | RegExp>) {
  const r = await call('GET', path, who);
  const missing = mustContain.filter((m) => (typeof m === 'string' ? !r.text.includes(m) : !m.test(r.text)));
  check(`PAGE.${id}`, r.status === 200 && missing.length === 0, `${r.status}${missing.length ? ' missing ' + missing.map(String).join(' | ') : ''}`);
}
const denied = (r: Res) => r.status === 401 || r.status === 403 || r.status === 404;
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
  const instA = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).id;
  const instB = (await q1(`SELECT id FROM institutions WHERE name = $1`, [INST_B_NAME])).id;
  const classB = (await q1(`SELECT id FROM classes WHERE institution_id = $1 LIMIT 1`, [instB])).id;
  const gradeB = (await q1(`SELECT id FROM grades WHERE institution_id = $1 LIMIT 1`, [instB])).id;
  const teacherBMembership = (await q1(`SELECT id FROM institution_memberships WHERE institution_id = $1 AND user_id = $2`, [instB, users['teacher-b']])).id;
  const canonical = (await q1(`SELECT id FROM canonical_concepts WHERE name = 'Linear Equations' AND status = 'ACTIVE' LIMIT 1`)).id;
  return { users, students, instA, instB, classB, gradeB, teacherBMembership, canonical };
}

/** Back to the provisioned state (re-runnable): Institution A empty, no parent links, no role edits from a previous run. */
async function reset(x: Awaited<ReturnType<typeof ids>>) {
  const fixtureUsers = Object.values(x.users);
  const fixtureStudents = Object.values(x.students);
  const interventions = (await db.query(`SELECT id FROM teacher_interventions WHERE student_id = ANY($1::uuid[])`, [fixtureStudents])).rows.map((r: any) => r.id);
  await db.query(`DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = ANY($1::uuid[])`, [interventions]);
  await db.query(`DELETE FROM teacher_interventions WHERE id = ANY($1::uuid[])`, [interventions]);
  await db.query(`DELETE FROM teacher_assignments WHERE institution_membership_id IN (SELECT id FROM institution_memberships WHERE institution_id = $1)`, [x.instA]);
  await db.query(`DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE institution_id = $1)`, [x.instA]);
  await db.query(`DELETE FROM classes WHERE institution_id = $1`, [x.instA]);
  await db.query(`DELETE FROM grades WHERE institution_id = $1`, [x.instA]);
  await db.query(`DELETE FROM institution_memberships WHERE institution_id = $1 AND membership_role = 'TEACHER'`, [x.instA]);
  await db.query(
    `DELETE FROM parent_student_relationships WHERE parent_id IN (SELECT id FROM profiles WHERE user_id = ANY($1::uuid[]))`,
    [fixtureUsers]
  );
  await db.query(`DELETE FROM parent_invitations WHERE student_id = ANY($1::uuid[])`, [fixtureStudents]);
  await db.query(`DELETE FROM notifications WHERE recipient_user_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [fixtureUsers, fixtureStudents]);
  await db.query(`UPDATE user_roles SET status = 'ACTIVE', revoked_at = NULL WHERE user_id = $1 AND role = 'PARENT'`, [x.users['parent-b']]);
  await db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'STUDENT'`, [x.users['inst-a']]);
  await db.query(`UPDATE users SET active_workspace = NULL WHERE id = ANY($1::uuid[])`, [fixtureUsers]);
  await db.query(`DELETE FROM user_language_preferences WHERE user_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`, [fixtureUsers, fixtureStudents]);
}

async function main() {
  assertDev();
  if (!BASE) throw new Error('usage: track-a-e2e-http.ts <baseUrl> <tokens.json>');
  const version = await get('/api/version', null);
  console.log(`target ${BASE} via ${TRANSPORT} -- version ${version.text.slice(0, 200)}`);
  const x = await ids();
  await reset(x);
  const evidenceBefore = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [Object.values(x.students)]);
  const masteryBefore = await n(`SELECT COUNT(*) n FROM mastery_records WHERE student_id = ANY($1::uuid[])`, [Object.values(x.students)]);

  // Student A completes the Student first-run (academic profile) through the
  // real Student API, as a real student must before using Student pages.
  const profile = await post('/api/academic-profile', 'student-a', {
    countryOfStudy: 'CO', schoolYear: '10', curriculumType: 'national', academicYear: '2026', profileCompleted: true,
  });
  check('SETUP.student-a-first-run', profile.status === 200, `${profile.status}`);

  // ------------------------------------------------------------------ A1 MULTIROLE
  check('A1.unauthenticated-401', (await get('/api/identity/me', null)).status === 401);
  const me = await get('/api/identity/me', 'multi');
  check('A1.multi-three-roles', JSON.stringify([...(me.body?.data?.roles ?? [])].sort()) === JSON.stringify(['PARENT', 'STUDENT', 'TEACHER']), JSON.stringify(me.body?.data?.roles));
  check('A1.multi-three-workspaces', (me.body?.data?.availableWorkspaces ?? []).length === 3);
  check('A1.switch-to-parent', (await post('/api/identity/workspace', 'multi', { workspace: 'PARENT' })).status === 200);
  check('A1.active-workspace-explicit', (await get('/api/identity/me', 'multi')).body?.data?.activeWorkspace === 'PARENT');
  await page('1-role-switcher', '/dashboard/parent', 'multi', ['Espacio de trabajo', 'Padre/Madre', 'Familia']);
  await page('2-account-add-role', '/role-select', 'multi', ['StudyUS']);
  check('A1.switch-unavailable-denied', (await post('/api/identity/workspace', 'multi', { workspace: 'INSTITUTION' })).status === 403);
  check('A1.privileged-not-self-service', (await post('/api/identity/roles/select', 'teacher-a', { role: 'INSTITUTION_ADMIN' })).status === 400);
  check('A1.privileged-not-self-service-admin', (await post('/api/identity/roles/select', 'teacher-a', { role: 'STUDYUS_ADMIN' })).status === 400);
  // An institution admin adds the Student role on the same account.
  const addStudent = await post('/api/identity/roles/select', 'inst-a', { role: 'STUDENT' });
  check('A1.admin-adds-student', addStudent.status === 200 && addStudent.body?.data?.activeWorkspace === 'STUDENT', `${addStudent.status} ${addStudent.text.slice(0, 120)}`);
  check('A1.no-duplicate-user', (await n(`SELECT COUNT(*) n FROM users WHERE email = $1`, [emailFor('inst-a')])) === 1);
  check('A1.one-student-row', (await n(`SELECT COUNT(*) n FROM students WHERE user_id = $1`, [x.users['inst-a']])) === 1);
  check('A1.student-row-own-identity', (await q1(`SELECT email FROM students WHERE user_id = $1`, [x.users['inst-a']]))?.email === emailFor('inst-a'));
  check('A1.role-add-audited', (await n(`SELECT COUNT(*) n FROM admin_audit_log WHERE actor_user_id = $1 AND action = 'ROLE_ADDED'`, [x.users['inst-a']])) >= 1);
  check('A1.admin-role-kept', (await get('/api/identity/me', 'inst-a')).body?.data?.roles?.includes('INSTITUTION_ADMIN'));
  check('A1.readd-idempotent', (await post('/api/identity/roles/select', 'inst-a', { role: 'STUDENT' })).status === 200 && (await n(`SELECT COUNT(*) n FROM students WHERE user_id = $1`, [x.users['inst-a']])) === 1);
  // Back to the institution workspace for the institution flow.
  check('A1.switch-back-institution', (await post('/api/identity/workspace', 'inst-a', { workspace: 'INSTITUTION' })).status === 200);
  // Revoked role: an administrator revokes parent-b's PARENT role (admin-console write, applied directly).
  await db.query(`UPDATE user_roles SET status = 'REVOKED', revoked_at = NOW() WHERE user_id = $1 AND role = 'PARENT'`, [x.users['parent-b']]);
  check('A1.revoked-not-reentered', (await post('/api/identity/roles/select', 'parent-b', { role: 'PARENT' })).status === 409);
  check('A1.revoked-explained', (await get('/api/identity/me', 'parent-b')).body?.data?.revokedRoles?.includes('PARENT'));
  check('A1.revoked-workspace-denied', (await post('/api/identity/workspace', 'parent-b', { workspace: 'PARENT' })).status === 403);
  check('A1.revoked-parent-cannot-request', (await post('/api/parent/child-requests', 'parent-b', { email: emailFor('student-a') })).status === 403);
  await db.query(`UPDATE user_roles SET status = 'ACTIVE', revoked_at = NULL WHERE user_id = $1 AND role = 'PARENT'`, [x.users['parent-b']]);
  for (const tag of ['student-a', 'parent-a', 'teacher-a', 'inst-a'] as Tag[]) {
    check(`A1.inbox-${tag}`, (await get('/api/notifications/inbox', tag)).status === 200);
  }

  // ------------------------------------------------------------------ A2 PARENT
  const reqA = await post('/api/parent/child-requests', 'parent-a', { email: emailFor('student-a') });
  const reqNone = await post('/api/parent/child-requests', 'parent-a', { email: 'nobody-ta+clerk_test@example.com' });
  check('A2.request-accepted-202', reqA.status === 202);
  check('A2.no-existence-oracle', reqA.status === reqNone.status && reqA.text === reqNone.text, `${reqA.text} vs ${reqNone.text}`);
  check('A2.not-student-cannot-request', (await post('/api/parent/child-requests', 'teacher-a', { email: emailFor('student-a') })).status === 403);
  check('A2.pending-not-listed', ((await get('/api/parent/learners', 'parent-a')).body?.data?.learners ?? []).length === 0);
  check('A2.pending-no-overview', denied(await get(`/api/parent/learners/${x.students['student-a']}/overview`, 'parent-a')));
  check('A2.pending-no-legacy-overview', denied(await get(`/api/parent/child-overview?studentId=${x.students['student-a']}`, 'parent-a')));
  check('A2.pending-not-in-children', !JSON.stringify((await get('/api/parent/children', 'parent-a')).body ?? {}).includes(x.students['student-a']));
  const studentRequests = await get('/api/parent/requests', 'student-a');
  const parentAProfile = (await q1(`SELECT id FROM profiles WHERE user_id = $1 AND user_type = 'parent'`, [x.users['parent-a']])).id;
  check('A2.student-receives-request', (studentRequests.body?.data?.requests ?? []).some((r: any) => r.parentId === parentAProfile));
  check('A2.student-notified', ((await get('/api/notifications/inbox', 'student-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'PARENT_LINK_REQUEST'));
  await page('4-student-sees-request', '/dashboard/notifications', 'student-a', ['quiere ver tu progreso']);
  check('A2.other-student-cannot-accept', (await post('/api/parent/requests', 'student-b', { parentId: parentAProfile, accept: true })).status === 404);
  check('A2.student-accepts', (await post('/api/parent/requests', 'student-a', { parentId: parentAProfile, accept: true })).status === 200);
  const learners = (await get('/api/parent/learners', 'parent-a')).body?.data?.learners ?? [];
  check('A2.accepted-listed', learners.length === 1 && learners[0].studentId === x.students['student-a']);
  for (const part of ['overview', 'subjects', 'activity', 'attention', 'exam-prep']) {
    check(`A2.accepted-reads-${part}`, (await get(`/api/parent/learners/${x.students['student-a']}/${part}`, 'parent-a')).status === 200);
  }
  await page('5-parent-dashboard', '/dashboard/parent', 'parent-a', ['Familia']);
  await page('5b-parent-notified', '/dashboard/notifications', 'parent-a', ['aceptó tu solicitud']);
  check('A2.parent-notified-accepted', ((await get('/api/notifications/inbox', 'parent-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'PARENT_LINK_ACCEPTED'));
  check('SEC.parentA-not-studentB', denied(await get(`/api/parent/learners/${x.students['student-b']}/overview`, 'parent-a')));
  check('SEC.parentA-not-studentB-legacy', denied(await get(`/api/parent/child-overview?studentId=${x.students['student-b']}`, 'parent-a')));
  // Parent B asks; the Student declines.
  await post('/api/parent/child-requests', 'parent-b', { email: emailFor('student-a') });
  const parentBProfile = (await q1(`SELECT id FROM profiles WHERE user_id = $1 AND user_type = 'parent'`, [x.users['parent-b']])).id;
  check('A2.student-declines', (await post('/api/parent/requests', 'student-a', { parentId: parentBProfile, accept: false })).status === 200);
  check('A2.declined-no-access', denied(await get(`/api/parent/learners/${x.students['student-a']}/overview`, 'parent-b')));
  check('A2.parent-notified-declined', ((await get('/api/notifications/inbox', 'parent-b')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'PARENT_LINK_DECLINED'));
  // Multiple children: the multi-role account (as a Student) accepts parent-a too.
  await post('/api/parent/child-requests', 'parent-a', { email: emailFor('multi') });
  check('A2.multi-child-accept', (await post('/api/parent/requests', 'multi', { parentId: parentAProfile, accept: true })).status === 200);
  check('A2.multiple-children', ((await get('/api/parent/learners', 'parent-a')).body?.data?.learners ?? []).length === 2);
  // Revoked relationship: the Student revokes; access ends immediately.
  check('A2.student-revokes', (await post('/api/parent/relationships/revoke', 'multi', { parentId: parentAProfile })).status === 200);
  check('A2.revoked-no-access', denied(await get(`/api/parent/learners/${x.students['multi']}/overview`, 'parent-a')));
  check('A2.revoked-not-listed', ((await get('/api/parent/learners', 'parent-a')).body?.data?.learners ?? []).length === 1);

  // ------------------------------------------------------------------ A3/A4 TEACHER + INSTITUTION
  check('A3.no-classes-before', ((await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? []).length === 0);
  check('A3.request-unknown-institution', (await post('/api/institutions/00000000-0000-4000-8000-000000000000/membership', 'teacher-a')).status === 404);
  check('A3.non-teacher-cannot-request', (await post(`/api/institutions/${x.instA}/membership`, 'parent-a')).status === 403);
  const reqT = await post(`/api/institutions/${x.instA}/membership`, 'teacher-a');
  check('A3.request-pending', reqT.status === 200 && reqT.body?.data?.membership?.status === 'PENDING', reqT.text.slice(0, 160));
  const membershipA = reqT.body?.data?.membership?.id;
  check('A4.admin-notified-request', ((await get('/api/notifications/inbox', 'inst-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'TEACHER_MEMBERSHIP_REQUESTED'));
  await page('6-teacher-pending', '/dashboard/teacher', 'teacher-a', ['Tu solicitud está pendiente', INST_A_NAME, 'Pendiente de aprobación']);
  check('SEC.pending-teacher-no-roster', denied(await get(`/api/teacher/classes/${x.classB}/roster`, 'teacher-a')));
  check('SEC.pending-teacher-no-student', denied(await get(`/api/teacher/students/${x.students['student-b']}/overview`, 'teacher-a')));
  // Institution A builds its structure.
  const grade = await post(`/api/institutions/${x.instA}/grades`, 'inst-a', { name: '10.º A' });
  check('A4.create-grade', grade.status === 201, grade.text.slice(0, 120));
  const gradeA = grade.body?.data?.grade?.id;
  const klass = await post(`/api/institutions/${x.instA}/classes`, 'inst-a', { name: 'Matemáticas 10A', gradeId: gradeA });
  check('A4.create-class', klass.status === 201, klass.text.slice(0, 120));
  const classA = klass.body?.data?.class?.id;
  check('SEC.class-under-foreign-grade', (await post(`/api/institutions/${x.instA}/classes`, 'inst-a', { name: 'X', gradeId: x.gradeB })).status === 422);
  check('SEC.instA-not-instB-pending', denied(await get(`/api/institutions/${x.instB}/memberships/pending`, 'inst-a')));
  check('SEC.instA-not-instB-create', denied(await post(`/api/institutions/${x.instB}/classes`, 'inst-a', { name: 'intrusion' })));
  check('SEC.instA-not-instB-roster', denied(await get(`/api/institutions/${x.instB}/classes/${x.classB}/enrollments`, 'inst-a')));
  check('SEC.instA-not-instB-intelligence', denied(await get(`/api/institutions/${x.instB}/intelligence/overview`, 'inst-a')));
  check('SEC.spoofed-institution-id-classB', denied(await get(`/api/institutions/${x.instA}/classes/${x.classB}/enrollments`, 'inst-a')));
  check('SEC.teacher-cannot-create-class', denied(await post(`/api/institutions/${x.instA}/classes`, 'teacher-a', { name: 'self-made' })));
  // Approval.
  const pending = await get(`/api/institutions/${x.instA}/memberships/pending`, 'inst-a');
  check('A4.sees-pending-request', JSON.stringify(pending.body ?? {}).includes(membershipA));
  await page('7-institution-approval', `/dashboard/institution/${x.instA}/requests`, 'inst-a', [emailFor('teacher-a'), 'Aprobar', 'Quiere unirse como docente']);
  check('SEC.teacher-cannot-self-approve', denied(await post(`/api/institutions/${x.instA}/memberships/${membershipA}/decide`, 'teacher-a', { decision: 'APPROVED' })));
  check('A4.approve-teacher', (await post(`/api/institutions/${x.instA}/memberships/${membershipA}/decide`, 'inst-a', { decision: 'APPROVED' })).status === 200);
  check('A3.teacher-notified-approved', ((await get('/api/notifications/inbox', 'teacher-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'TEACHER_MEMBERSHIP_APPROVED'));
  check('A3.approved-no-scope-no-classes', ((await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? []).length === 0);
  // Scope assignment.
  check('SEC.spoofed-class-id-cross-tenant', (await post(`/api/institutions/${x.instA}/assignments`, 'inst-a', { institutionMembershipId: membershipA, classId: x.classB })).status === 422);
  check('SEC.scope-required', (await post(`/api/institutions/${x.instA}/assignments`, 'inst-a', { institutionMembershipId: membershipA })).status === 400);
  check('SEC.spoofed-membership-id', (await post(`/api/institutions/${x.instA}/assignments`, 'inst-a', { institutionMembershipId: x.teacherBMembership, classId: classA })).status === 404);
  check('SEC.teacher-cannot-attach-self', denied(await post(`/api/institutions/${x.instA}/assignments`, 'teacher-a', { institutionMembershipId: membershipA, classId: classA })));
  check('SEC.teacherB-cannot-attach-to-instA', denied(await post(`/api/institutions/${x.instA}/assignments`, 'teacher-b', { institutionMembershipId: x.teacherBMembership, classId: classA })));
  const scope = await post(`/api/institutions/${x.instA}/assignments`, 'inst-a', { institutionMembershipId: membershipA, classId: classA });
  check('A4.assign-teacher-to-class', scope.status === 200, scope.text.slice(0, 120));
  const teacherClasses = (await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? [];
  check('A3.class-visible', teacherClasses.length === 1 && teacherClasses[0].classId === classA);
  // Consent-based enrollment.
  check('A4.invite-unknown-email', (await post(`/api/institutions/${x.instA}/classes/${classA}/enrollments`, 'inst-a', { email: 'nobody-ta+clerk_test@example.com' })).status === 404);
  const invite = await post(`/api/institutions/${x.instA}/classes/${classA}/enrollments`, 'inst-a', { email: emailFor('student-a') });
  check('A4.invite-student', invite.status === 201 && invite.body?.data?.outcome === 'INVITED', invite.text.slice(0, 120));
  check('SEC.pending-enrollment-no-roster', ((await get(`/api/teacher/classes/${classA}/roster`, 'teacher-a')).body?.data?.roster ?? []).length === 0);
  check('SEC.pending-enrollment-no-student', denied(await get(`/api/teacher/students/${x.students['student-a']}/overview`, 'teacher-a')));
  const invitations = (await get('/api/student/class-invitations', 'student-a')).body?.data?.invitations ?? [];
  check('A4.student-sees-invitation', invitations.length === 1);
  const enrollmentId = invitations[0]?.enrollmentId;
  check('SEC.other-student-cannot-accept-enrollment', (await post(`/api/student/class-invitations/${enrollmentId}/respond`, 'student-b', { accept: true })).status === 404);
  check('A4.student-accepts-enrollment', (await post(`/api/student/class-invitations/${enrollmentId}/respond`, 'student-a', { accept: true })).status === 200);
  check('A4.admin-notified-enrollment', ((await get('/api/notifications/inbox', 'inst-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'CLASS_ENROLLMENT_ACCEPTED'));
  await page('8-teacher-class', '/dashboard/teacher', 'teacher-a', ['Matemáticas 10A']);
  await page('8b-teacher-class-roster', `/dashboard/teacher/classes/${classA}`, 'teacher-a', ['Sofía Estudiante A', 'Nueva tarea para la clase']);
  await page('8c-institution-class', `/dashboard/institution/${x.instA}/classes/${classA}`, 'inst-a', ['Sofía Estudiante A', 'Inscrito', emailFor('teacher-a')]);
  const roster = (await get(`/api/teacher/classes/${classA}/roster`, 'teacher-a')).body?.data?.roster ?? [];
  check('A3.roster-has-student', roster.length === 1 && roster[0].studentId === x.students['student-a']);
  check('A3.teacher-reads-student', (await get(`/api/teacher/students/${x.students['student-a']}/overview`, 'teacher-a')).status === 200);
  check('SEC.teacherA-not-classB', denied(await get(`/api/teacher/classes/${x.classB}/roster`, 'teacher-a')));
  check('SEC.teacherA-not-studentB', denied(await get(`/api/teacher/students/${x.students['student-b']}/overview`, 'teacher-a')));
  check('SEC.teacherA-not-instB', denied(await get(`/api/institutions/${x.instB}/intelligence/overview`, 'teacher-a')));
  check('SEC.teacherA-not-instA-admin', denied(await get(`/api/institutions/${x.instA}/memberships/pending`, 'teacher-a')));
  check('SEC.inst-admin-not-learner', denied(await get(`/api/teacher/students/${x.students['student-a']}/overview`, 'inst-a')));
  check('SEC.teacherB-not-classA-assignments', denied(await get(`/api/teacher/classes/${classA}/assignments`, 'teacher-b')));

  // ------------------------------------------------------------------ A5 ASSIGNMENT
  const view = await get(`/api/teacher/classes/${classA}/assignments`, 'teacher-a');
  check('A5.assignable-topic', (view.body?.data?.concepts ?? []).some((c: any) => c.canonicalConceptId === x.canonical), view.text.slice(0, 200));
  check('SEC.inst-admin-cannot-publish', denied(await post(`/api/teacher/classes/${classA}/assignments`, 'inst-a', { canonicalConceptId: x.canonical })));
  check('SEC.teacherB-cannot-publish-classA', denied(await post(`/api/teacher/classes/${classA}/assignments`, 'teacher-b', { canonicalConceptId: x.canonical })));
  const publish = await post(`/api/teacher/classes/${classA}/assignments`, 'teacher-a', { canonicalConceptId: x.canonical, instructions: 'Practica antes del viernes.' });
  check('A5.publish', publish.status === 201 && publish.body?.data?.assigned?.length === 1, publish.text.slice(0, 200));
  const interventionId = publish.body?.data?.assigned?.[0]?.interventionId;
  check('A5.student-notified', ((await get('/api/notifications/inbox', 'student-a')).body?.data?.notifications ?? []).some((nn: any) => nn.type === 'ASSIGNMENT_PUBLISHED'));
  await page('9-assignment-published', `/dashboard/teacher/classes/${classA}`, 'teacher-a', ['Linear Equations', 'Asignada']);
  await page('10-student-assignment-view', '/dashboard/assignments', 'student-a', ['Mis tareas', 'Comenzar', 'Practica antes del viernes.']);
  const pendingList = (await get('/api/student/teacher-interventions', 'student-a')).body?.data;
  check('A5.student-sees-assignment', JSON.stringify(pendingList ?? {}).includes(interventionId));
  check('SEC.studentB-not-assignment', !JSON.stringify((await get('/api/student/teacher-interventions', 'student-b')).body ?? {}).includes(interventionId));
  check('SEC.spoofed-assignment-start-teacher', denied(await post(`/api/student/teacher-interventions/${interventionId}/start`, 'teacher-a', { idempotencyKey: 'x' })));
  check('SEC.spoofed-assignment-start-parent', denied(await post(`/api/student/teacher-interventions/${interventionId}/start`, 'parent-a', { idempotencyKey: 'x' })));
  check('SEC.spoofed-assignment-start-studentB', denied(await post(`/api/student/teacher-interventions/${interventionId}/start`, 'student-b', { idempotencyKey: 'x' })));
  check('SEC.teacherB-cannot-cancel', denied(await post(`/api/teacher/interventions/${interventionId}/cancel`, 'teacher-b', {})));
  // Direct writes into the learner's cognition by non-owners.
  // A fully VALID evidence payload for Student A's real concept, so the only thing that can refuse it is authorization.
  const own = await q1(`SELECT c.id AS concept_id, s.id AS subject_id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1 LIMIT 1`, [x.students['student-a']]);
  const evidencePayload = { studentId: x.students['student-a'], conceptId: own.concept_id, subjectId: own.subject_id, result: 'correct', difficulty: 3, sourceType: 'PRACTICE', idempotencyKey: `ta-spoof-${Date.now()}` };
  const teacherWrite = await post('/api/learning/record-evidence', 'teacher-a', evidencePayload);
  check('SEC.teacher-no-evidence-write', teacherWrite.status === 403, `${teacherWrite.status}`);
  const parentWrite = await post('/api/learning/record-evidence', 'parent-a', evidencePayload);
  check('SEC.parent-no-evidence-write', parentWrite.status === 403, `${parentWrite.status}`);
  const otherStudentWrite = await post('/api/learning/record-evidence', 'student-b', evidencePayload);
  check('SEC.spoofed-student-id-evidence-write', otherStudentWrite.status === 403, `${otherStudentWrite.status}`);
  check('SEC.teacher-no-exam-profile-write', denied(await post('/api/exam-profiles', 'teacher-a', { studentId: x.students['student-a'], examDefinitionId: '00000000-0000-4000-8000-000000000000' })));
  check('SEC.parent-no-exam-profile-write', denied(await post('/api/exam-profiles', 'parent-a', { studentId: x.students['student-a'], examDefinitionId: '00000000-0000-4000-8000-000000000000' })));

  // The Student performs the assignment (owner only) through the canonical practice path.
  // Generation is all-or-nothing; a GENERATION_FAILED (503) writes nothing and is simply retried, as the Student would.
  let start = await post(`/api/student/teacher-interventions/${interventionId}/start`, 'student-a', { idempotencyKey: `assignment:${interventionId}` });
  for (let attempt = 1; attempt < 4 && start.status === 503; attempt++) {
    check(`A5.generation-retry-${attempt}-wrote-nothing`, (await n(`SELECT COUNT(*) n FROM teacher_intervention_executions WHERE teacher_intervention_id = $1`, [interventionId])) === 0);
    start = await post(`/api/student/teacher-interventions/${interventionId}/start`, 'student-a', { idempotencyKey: `assignment:${interventionId}` });
  }
  check('A5.student-starts', start.status === 200 && start.body?.data?.outcome === 'STARTED', start.text.slice(0, 200));
  const quizId = start.body?.data?.executionReference;
  const again = await post(`/api/student/teacher-interventions/${interventionId}/start`, 'student-a', { idempotencyKey: `assignment:${interventionId}` });
  check('A5.continue-recovers-same-activity', again.body?.data?.outcome === 'RECOVERED' && again.body?.data?.executionReference === quizId);
  check('SEC.teacher-cannot-open-quiz', denied(await get(`/api/quizzes/session/${quizId}?studentId=${x.students['student-a']}`, 'teacher-a')));
  const session = await get(`/api/quizzes/session/${quizId}?studentId=${x.students['student-a']}`, 'student-a');
  const questions: any[] = session.body?.data?.questions ?? [];
  check('A5.activity-has-questions', questions.length > 0, `${questions.length}`);
  const answers = questions.map((qq) => ({
    questionIndex: qq.index,
    answer:
      qq.answerFormat === 'single_choice'
        ? qq.options?.[0]?.id ?? ''
        : qq.answerFormat === 'multi_choice'
          ? qq.options?.[0]?.id ?? ''
          : qq.answerFormat === 'text'
            ? 'x = 2'
            : qq.answerFormat === 'ordering'
              ? JSON.stringify(qq.orderingItemsShuffled ?? [])
              : '{}',
  }));
  check('SEC.teacher-cannot-submit-for-student', denied(await post('/api/quizzes/generate-and-take', 'teacher-a', { studentId: x.students['student-a'], quizId, answers })));
  check('SEC.parent-cannot-submit-for-student', denied(await post('/api/quizzes/generate-and-take', 'parent-a', { studentId: x.students['student-a'], quizId, answers })));
  const submit = await post('/api/quizzes/generate-and-take', 'student-a', { studentId: x.students['student-a'], quizId, answers });
  check('A5.student-submits', submit.status === 200, `${submit.status} ${submit.text.slice(0, 200)}`);
  const evidenceA = await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = $1`, [x.students['student-a']]);
  check('A5.engine-recorded-evidence', evidenceA > 0, `learning_evidence(studentA)=${evidenceA}`);
  // The teacher reads the outcome (completion is reconciled from the canonical session).
  const after = await get(`/api/teacher/classes/${classA}/assignments`, 'teacher-a');
  const learnerOutcome = after.body?.data?.assignments?.[0]?.learners?.[0];
  check('A5.teacher-sees-completed', learnerOutcome?.status === 'COMPLETED', JSON.stringify(learnerOutcome ?? {}).slice(0, 200));
  check('A5.teacher-sees-result', typeof learnerOutcome?.result?.total === 'number' && learnerOutcome.result.total > 0, JSON.stringify(learnerOutcome?.result ?? null));
  await page('11-teacher-result-view', `/dashboard/teacher/classes/${classA}`, 'teacher-a', ['Completada', /\d+ de \d+ correctas/]);
  await page('12-parent-summary', '/dashboard/parent', 'parent-a', ['Familia']);
  check('A5.teacher-sees-progress', (await get(`/api/teacher/students/${x.students['student-a']}/overview`, 'teacher-a')).body?.data?.lastActivityAt != null);
  const parentOverview = await get(`/api/parent/learners/${x.students['student-a']}/overview`, 'parent-a');
  check('A5.parent-sees-summary', parentOverview.status === 200 && parentOverview.body?.data?.lastActivityAt != null);
  check('A5.parent-sees-activity', ((await get(`/api/parent/learners/${x.students['student-a']}/activity`, 'parent-a')).body?.data?.activity ?? []).length > 0);
  // Removal ends teacher access immediately.
  check('A4.remove-student', (await post(`/api/institutions/${x.instA}/classes/${classA}/enrollments/${enrollmentId}/end`, 'inst-a')).status === 200);
  check('SEC.removed-student-no-teacher-access', denied(await get(`/api/teacher/students/${x.students['student-a']}/overview`, 'teacher-a')));
  check('A4.revoke-teacher', (await post(`/api/institutions/${x.instA}/memberships/${membershipA}/revoke`, 'inst-a')).status === 200);
  check('A3.revoked-teacher-no-classes', ((await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? []).length === 0);
  check('A3.revoked-teacher-can-reapply', (await post(`/api/institutions/${x.instA}/membership`, 'teacher-a')).body?.data?.membership?.status === 'PENDING');

  // ------------------------------------------------------------------ DATA INTEGRITY
  const fixtureStudents = Object.values(x.students);
  check('DATA.no-evidence-for-uninvolved', (await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [fixtureStudents.filter((s) => s !== x.students['student-a'])])) === 0);
  check('DATA.only-owner-practice-evidence', (await n(`SELECT COUNT(*) n FROM learning_evidence WHERE student_id = ANY($1::uuid[])`, [fixtureStudents])) === evidenceA, `before=${evidenceBefore} afterA=${evidenceA}`);
  check('DATA.mastery-only-via-engine', (await n(`SELECT COUNT(*) n FROM mastery_records WHERE student_id = ANY($1::uuid[]) AND student_id <> $2`, [fixtureStudents, x.students['student-a']])) === 0, `before=${masteryBefore}`);
  check('DATA.duplicate-users-0', (await n(`SELECT COUNT(*) n FROM (SELECT clerk_id FROM users GROUP BY clerk_id HAVING COUNT(*) > 1) d`)) === 0);
  check('DATA.duplicate-students-0', (await n(`SELECT COUNT(*) n FROM (SELECT user_id FROM students WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1) d`)) === 0);
  check('DATA.cross-institution-scopes-0', (await n(
    `SELECT COUNT(*) n FROM teacher_assignments ta JOIN institution_memberships im ON im.id = ta.institution_membership_id
     LEFT JOIN classes c ON c.id = ta.class_id LEFT JOIN grades g ON g.id = ta.grade_id
     WHERE (c.id IS NOT NULL AND c.institution_id <> im.institution_id) OR (g.id IS NOT NULL AND g.institution_id <> im.institution_id)`
  )) === 0);
  check('DATA.cross-institution-classes-0', (await n(`SELECT COUNT(*) n FROM classes c JOIN grades g ON g.id = c.grade_id WHERE g.institution_id <> c.institution_id`)) === 0);
  check('DATA.cross-institution-interventions-0', (await n(`SELECT COUNT(*) n FROM teacher_interventions ti JOIN classes c ON c.id = ti.class_id WHERE c.institution_id <> ti.institution_id`)) === 0);
  check('DATA.cross-student-interventions-0', (await n(
    `SELECT COUNT(*) n FROM teacher_interventions ti JOIN concepts co ON co.id = ti.concept_id JOIN subjects s ON s.id = co.subject_id WHERE s.student_id <> ti.student_id`
  )) === 0);
  check('DATA.orphan-parent-relationships-0', (await n(
    `SELECT COUNT(*) n FROM parent_student_relationships psr LEFT JOIN profiles p ON p.id = psr.parent_id LEFT JOIN profiles s ON s.id = psr.student_id WHERE p.id IS NULL OR s.id IS NULL`
  )) === 0);
  check('DATA.orphan-memberships-0', (await n(
    `SELECT COUNT(*) n FROM institution_memberships im LEFT JOIN institutions i ON i.id = im.institution_id LEFT JOIN users u ON u.id = im.user_id WHERE i.id IS NULL OR u.id IS NULL`
  )) === 0);
  check('DATA.scope-less-assignments-0', (await n(`SELECT COUNT(*) n FROM teacher_assignments WHERE grade_id IS NULL AND class_id IS NULL`)) === 0);
  check('DATA.assignment-owner-coherent', (await n(
    `SELECT COUNT(*) n FROM teacher_interventions ti WHERE NOT EXISTS (
       SELECT 1 FROM institution_memberships im WHERE im.user_id = ti.assigned_by_user_id AND im.institution_id = ti.institution_id AND im.membership_role = 'TEACHER')`
  )) === 0);
}

main()
  .catch((e) => check('RUN.error', false, e instanceof Error ? e.stack ?? e.message : String(e)))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) console.log('FAILED: ' + failed.map((f) => f.id).join(', '));
    await (db as any).end?.();
    process.exitCode = failed.length ? 1 : 0;
  });
