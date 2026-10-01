/**
 * Track A -- institution creation + coordinator (Institution Admin) E2E over
 * REAL HTTP as REAL Clerk DEV identities, with the DEV database checked
 * read-only for every write the flow should -- and should NOT -- produce.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts provision
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts institution-reset
 *   npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts tokens <tokens.json>
 *   npx tsx --env-file=.env.local scripts/operations/track-a-institution-e2e-http.ts <baseUrl> <tokens.json>
 *   (hosted DEV: VERCEL_PROTECTION_BYPASS=<existing automation bypass secret>)
 *
 * The only direct DB write is test arrangement on fixture data: one
 * invitation's `expires_at` is moved into the past to exercise expiry
 * (7 days cannot be waited for). Everything else goes through the API.
 */
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { assertDev, emailFor, signUpLater, institutionReset, INST_A_NAME, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Partial<Record<Tag, string>> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
interface Res {
  status: number;
  body: any;
  text: string;
  location: string | null;
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
  return { status: res.status, body: parsed, text, location: res.headers.get('location') };
}
const get = (p: string, w: Tag | null) => call('GET', p, w);
const post = (p: string, w: Tag | null, b: unknown = {}) => call('POST', p, w, b);
const patch = (p: string, w: Tag | null, b: unknown = {}) => call('PATCH', p, w, b);
const denied = (r: Res) => r.status === 401 || r.status === 403 || r.status === 404;
const q1 = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await q1(sql, p))?.n ?? 0);
const userId = async (tag: Tag) => (await q1(`SELECT id FROM users WHERE email = $1`, [emailFor(tag)]))?.id as string | undefined;
const personas = async (tag: Tag) => n(`SELECT COUNT(*) n FROM user_roles r JOIN users u ON u.id = r.user_id WHERE u.email = $1 AND r.role IN ('STUDENT','PARENT','TEACHER') AND r.status = 'ACTIVE'`, [emailFor(tag)]);

const PROFILE_A = {
  name: 'Institution E2E A',
  displayName: 'Colegio E2E A',
  country: 'CO',
  region: 'Bogotá',
  curriculum: 'Nacional (MEN)',
  status: 'ACTIVE',
  primaryContactName: 'Rectoría E2E A',
  primaryContactEmail: 'rectoria-e2e-a+clerk_test@example.com',
  timezone: 'America/Bogota',
  locale: 'es',
};

async function main() {
  assertDev();
  if (!BASE) throw new Error('usage: track-a-institution-e2e-http.ts <baseUrl> <tokens.json>');
  console.log(`target ${BASE} -- version ${(await get('/api/version', null)).text.slice(0, 160)}`);
  await institutionReset(); // re-runnable: no E2E institution, coord-a / coord-x not signed up yet
  const institutionsBefore = await n(`SELECT COUNT(*) n FROM institutions`);
  const mathSubject = (await q1(`SELECT canonical_subject_id FROM canonical_concepts WHERE name = 'Linear Equations' AND status = 'ACTIVE' LIMIT 1`))?.canonical_subject_id;

  // 1-2 -- only the Platform Admin can create institutions (hiding the button is not the control).
  check('C1.platform-admin-lists', (await get('/api/admin/institutions', 'platform-admin')).status === 200);
  for (const who of ['inst-a', 'teacher-a', 'parent-a', 'student-a', 'student-c'] as Tag[]) {
    check(`C2.create-denied-${who}`, (await post('/api/admin/institutions', who, { name: `Intrusion ${who}` })).status === 403);
  }
  check('C2.create-denied-unauthenticated', denied(await post('/api/admin/institutions', null, { name: 'Intrusion anon' })));
  check('C2.no-institution-written', (await n(`SELECT COUNT(*) n FROM institutions`)) === institutionsBefore);
  check('C2.admin-page-not-for-coordinator', (await get('/dashboard/admin/institutions', 'inst-a')).status !== 200 || !(await get('/dashboard/admin/institutions', 'inst-a')).text.includes('Crear institución'));

  // 3 -- create Institution E2E A (full profile) and B; validation and duplicates.
  check('C3.invalid-country-400', (await post('/api/admin/institutions', 'platform-admin', { ...PROFILE_A, country: 'Colombia' })).status === 400);
  check('C3.invalid-timezone-400', (await post('/api/admin/institutions', 'platform-admin', { ...PROFILE_A, timezone: 'Mars/Olympus' })).status === 400);
  const createA = await post('/api/admin/institutions', 'platform-admin', PROFILE_A);
  check('C3.create-A-201', createA.status === 201 && createA.body?.data?.institution?.status === 'ACTIVE', createA.text.slice(0, 160));
  const instA = createA.body?.data?.institution?.id as string;
  const rowA = await q1(`SELECT * FROM institutions WHERE id = $1`, [instA]);
  check('C3.profile-stored', rowA?.slug === 'institution-e2e-a' && rowA?.country === 'CO' && rowA?.timezone === 'America/Bogota' && rowA?.locale === 'es' && rowA?.display_name === 'Colegio E2E A' && rowA?.curriculum === 'Nacional (MEN)');
  check('C3.duplicate-409', (await post('/api/admin/institutions', 'platform-admin', { ...PROFILE_A, name: 'institution e2e a' })).status === 409);
  check('C3.audited', (await n(`SELECT COUNT(*) n FROM admin_audit_log WHERE action = 'INSTITUTION_CREATED' AND target_id = $1`, [instA])) === 1);
  const createB = await post('/api/admin/institutions', 'platform-admin', { name: 'Institution E2E B', country: 'MX', timezone: 'America/Mexico_City', locale: 'es' });
  check('C3.create-B-201', createB.status === 201);
  const instB = createB.body?.data?.institution?.id as string;
  const createDraft = await post('/api/admin/institutions', 'platform-admin', { name: 'Institution E2E Draft', country: 'CO', timezone: 'America/Bogota', locale: 'es', status: 'DRAFT' });
  check('C3.create-draft', createDraft.status === 201 && createDraft.body?.data?.institution?.status === 'DRAFT');
  const instDraft = createDraft.body?.data?.institution?.id as string;
  const adminPage = await get(`/dashboard/admin/institutions/${instA}`, 'platform-admin');
  const visible = adminPage.text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  check('PAGE.C3-admin-institution-detail', adminPage.status === 200 && visible.includes('Colegio E2E A') && visible.includes('Coordinadores') && !visible.includes(instA) && !/\b(ACTIVE|PENDING|INSTITUTION_ADMIN)\b/.test(visible), `${adminPage.status}`);

  // 4 -- invite a NEW coordinator (no account yet).
  check('C4.draft-institution-invite-409', (await post(`/api/admin/institutions/${instDraft}/coordinators`, 'platform-admin', { email: emailFor('coord-x') })).status === 409);
  const inviteA = await post(`/api/admin/institutions/${instA}/coordinators`, 'platform-admin', { email: emailFor('coord-a'), name: 'Andrea Coordinadora A' });
  check('C4.invite-new-201', inviteA.status === 201 && inviteA.body?.data?.outcome === 'INVITED', inviteA.text.slice(0, 160));
  const tokenA = String(inviteA.body?.data?.acceptPath ?? '').split('/').pop()!;
  const dupInvite = await post(`/api/admin/institutions/${instA}/coordinators`, 'platform-admin', { email: emailFor('coord-a').toUpperCase() });
  check('C4.duplicate-invite-idempotent', dupInvite.status === 200 && dupInvite.body?.data?.outcome === 'ALREADY_INVITED');
  check('C4.one-pending-invitation', (await n(`SELECT COUNT(*) n FROM institution_admin_invitations WHERE institution_id = $1 AND email = $2 AND status = 'PENDING'`, [instA, emailFor('coord-a')])) === 1);
  check('C4.token-not-stored', (await n(`SELECT COUNT(*) n FROM institution_admin_invitations WHERE token_hash = $1`, [tokenA])) === 0);
  const listed = (await get(`/api/admin/institutions/${instA}/coordinators`, 'platform-admin')).body?.data?.coordinators ?? [];
  check('C4.listed-pending-with-identity', listed.some((c: any) => c.status === 'PENDING' && c.email === emailFor('coord-a') && c.name === 'Andrea Coordinadora A' && c.invitedAt));
  check('C4.no-account-created', (await userId('coord-a')) === undefined);
  const landing = await get(`/invite/coordinator/${tokenA}`, null);
  check('PAGE.C4-invitation-landing', landing.status === 200 && landing.text.includes('Institution E2E A') && landing.text.includes(emailFor('coord-a')), `${landing.status}`);

  // 5 -- Coordinator A signs up and accepts (only with the invited email; single use).
  TOKENS['coord-a'] = await signUpLater('coord-a');
  check('C5.wrong-account-cannot-accept', (await post('/api/coordinator-invitations/accept', 'coord-b', { token: tokenA })).status === 403);
  check('C5.unauthenticated-cannot-accept', (await post('/api/coordinator-invitations/accept', null, { token: tokenA })).status === 401);
  const inviterInboxBefore = await n(`SELECT COUNT(*) n FROM notifications WHERE recipient_user_id = $1 AND notification_type = 'COORDINATOR_INVITATION_ACCEPTED'`, [await userId('platform-admin')]);
  const accept = await post('/api/coordinator-invitations/accept', 'coord-a', { token: tokenA });
  check('C5.accept', accept.status === 200 && accept.body?.data?.institutionId === instA, accept.text.slice(0, 160));
  check('C5.accept-again-idempotent', (await post('/api/coordinator-invitations/accept', 'coord-a', { token: tokenA })).body?.data?.outcome === 'ALREADY_ACCEPTED');
  check('C5.already-used-by-other', (await post('/api/coordinator-invitations/accept', 'coord-b', { token: tokenA })).status === 409);
  check('C5.inviter-notified', (await n(`SELECT COUNT(*) n FROM notifications WHERE recipient_user_id = $1 AND notification_type = 'COORDINATOR_INVITATION_ACCEPTED'`, [await userId('platform-admin')])) === inviterInboxBefore + 1);

  // 6 -- Coordinator A goes straight to the institution workspace (no persona, no /role-select).
  const meA = (await get('/api/identity/me', 'coord-a')).body?.data;
  check('C6.capability-not-persona', (await personas('coord-a')) === 0 && (meA?.roles ?? []).includes('INSTITUTION_ADMIN'), JSON.stringify(meA).slice(0, 160));
  const entry = await get('/dashboard', 'coord-a');
  check('C6.entry-goes-to-institution', entry.status >= 300 && entry.status < 400 && (entry.location ?? '').includes('/dashboard/institution') && !(entry.location ?? '').includes('role-select'), `${entry.status} ${entry.location}`);
  const instHome = await get('/dashboard/institution', 'coord-a');
  check('C6.single-institution-redirect', instHome.status >= 300 && (instHome.location ?? '').includes(`/dashboard/institution/${instA}`), `${instHome.status} ${instHome.location}`);
  const overview = await get(`/dashboard/institution/${instA}`, 'coord-a');
  check('PAGE.C6-institution-workspace', overview.status === 200 && overview.text.includes('Institution E2E A') && overview.text.includes('Coordinadores') && !/Mis tareas|Mi plan/.test(overview.text), `${overview.status}`);
  for (const section of ['grades', 'classes', 'subjects', 'teachers', 'requests', 'coordinators', 'settings']) {
    check(`PAGE.C6-section-${section}`, (await get(`/dashboard/institution/${instA}/${section}`, 'coord-a')).status === 200);
  }

  // Expired / revoked invitations (Coordinator X).
  const invX = await post(`/api/admin/institutions/${instA}/coordinators`, 'platform-admin', { email: emailFor('coord-x'), name: 'Ximena Invitada X' });
  const tokenX = String(invX.body?.data?.acceptPath ?? '').split('/').pop()!;
  await db.query(`UPDATE institution_admin_invitations SET expires_at = NOW() - INTERVAL '1 minute' WHERE institution_id = $1 AND email = $2 AND status = 'PENDING'`, [instA, emailFor('coord-x')]); // test arrangement
  TOKENS['coord-x'] = await signUpLater('coord-x');
  check('C7.expired-410', (await post('/api/coordinator-invitations/accept', 'coord-x', { token: tokenX })).status === 410);
  const invX2 = await post(`/api/admin/institutions/${instA}/coordinators`, 'platform-admin', { email: emailFor('coord-x') });
  // coord-x now HAS an account, so this is the existing-account path:
  check('C7.after-signup-existing-path', invX2.body?.data?.outcome === 'ASSIGNED_EXISTING', invX2.text.slice(0, 120));
  const expiredLanding = await get(`/invite/coordinator/${tokenX}`, null);
  check('PAGE.C7-expired-landing', expiredLanding.status === 200 && expiredLanding.text.includes('venció'));

  // 7 -- Coordinator A: profile edit (descriptive only), grade, class + subject, pending teacher, approve, assign.
  const edit = await patch(`/api/institutions/${instA}`, 'coord-a', { region: 'Bogotá D.C.', name: 'Hijacked', status: 'ARCHIVED' });
  const rowA2 = await q1(`SELECT name, status, region FROM institutions WHERE id = $1`, [instA]);
  check('C7.coordinator-edits-profile', edit.status === 200 && rowA2.region === 'Bogotá D.C.' && rowA2.name === 'Institution E2E A' && rowA2.status === 'ACTIVE');
  const grade = await post(`/api/institutions/${instA}/grades`, 'coord-a', { name: '3º Preparatoria' });
  check('C8.create-grade', grade.status === 201);
  const klass = await post(`/api/institutions/${instA}/classes`, 'coord-a', { name: 'Matemáticas 3A', gradeId: grade.body?.data?.grade?.id, canonicalSubjectId: mathSubject });
  check('C8.create-class-with-subject', klass.status === 201);
  const classA = klass.body?.data?.class?.id as string;
  const reqT = await post(`/api/institutions/${instA}/membership`, 'teacher-a');
  check('C9.teacher-requests', reqT.status === 200 && reqT.body?.data?.membership?.status === 'PENDING', reqT.text.slice(0, 120));
  const membershipT = reqT.body?.data?.membership?.id as string;
  check('C9.coordinator-sees-pending', JSON.stringify((await get(`/api/institutions/${instA}/memberships/pending`, 'coord-a')).body ?? {}).includes(membershipT));
  const reqPage = await get(`/dashboard/institution/${instA}/requests`, 'coord-a');
  check('PAGE.C9-pending-teacher-identity', reqPage.status === 200 && reqPage.text.includes(`Teresa Docente A · ${emailFor('teacher-a')}`));
  check('C10.approve', (await post(`/api/institutions/${instA}/memberships/${membershipT}/decide`, 'coord-a', { decision: 'APPROVED' })).status === 200);
  check('C11.assign-teacher', (await post(`/api/institutions/${instA}/assignments`, 'coord-a', { institutionMembershipId: membershipT, classId: classA })).status === 200);
  check('C11.teacher-sees-class', ((await get('/api/teacher/classes', 'teacher-a')).body?.data?.classes ?? []).some((c: any) => c.classId === classA));

  // Coordinator manages coordinators of its OWN institution.
  const coordList = (await get(`/api/institutions/${instA}/coordinators`, 'coord-a')).body?.data?.coordinators ?? [];
  const xMembership = coordList.find((c: any) => c.kind === 'MEMBER' && c.email === emailFor('coord-x'))?.id;
  const aMembership = coordList.find((c: any) => c.kind === 'MEMBER' && c.email === emailFor('coord-a'))?.id;
  check('C12.coordinator-cannot-remove-self', (await post(`/api/institutions/${instA}/coordinators/${aMembership}/remove`, 'coord-a')).status === 409);
  check('C12.coordinator-removes-other', (await post(`/api/institutions/${instA}/coordinators/${xMembership}/remove`, 'coord-a')).status === 200);
  check('C12.removed-coordinator-loses-access', denied(await get(`/api/institutions/${instA}`, 'coord-x')) && !((await get('/api/identity/me', 'coord-x')).body?.data?.availableWorkspaces ?? []).includes('INSTITUTION'));
  check('C12.removed-is-soft', (await q1(`SELECT status FROM institution_memberships WHERE id = $1`, [xMembership]))?.status === 'REVOKED');
  check('C12.coordinator-invites-new', (await post(`/api/institutions/${instA}/coordinators`, 'coord-a', { email: 'studyus-ta-coord-z+clerk_test@example.com', name: 'Zoe' })).body?.data?.outcome === 'INVITED');

  // Existing account with a TEACHER persona becomes coordinator of B (capability, not a second persona).
  const usersBefore = await n(`SELECT COUNT(*) n FROM users WHERE email LIKE 'studyus-ta-%'`);
  const assignB = await post(`/api/admin/institutions/${instB}/coordinators`, 'platform-admin', { email: emailFor('coord-b'), name: 'Bernardo' });
  check('C13.existing-user-assigned', assignB.status === 201 && assignB.body?.data?.outcome === 'ASSIGNED_EXISTING', assignB.text.slice(0, 120));
  check('C13.no-duplicate-account', (await n(`SELECT COUNT(*) n FROM users WHERE email LIKE 'studyus-ta-%'`)) === usersBefore);
  check('C13.no-invitation-row-for-existing', (await n(`SELECT COUNT(*) n FROM institution_admin_invitations WHERE email = $1`, [emailFor('coord-b')])) === 0);
  const meB = (await get('/api/identity/me', 'coord-b')).body?.data;
  check('C13.teacher-plus-capability', (await personas('coord-b')) === 1 && (meB?.roles ?? []).includes('TEACHER') && (meB?.roles ?? []).includes('INSTITUTION_ADMIN'), JSON.stringify(meB).slice(0, 160));
  check('C13.persona-cannot-be-added', (await post('/api/identity/roles/select', 'coord-b', { role: 'STUDENT' })).status === 409);

  // 8 -- tenant isolation with real ids.
  for (const [who, foreign] of [['coord-a', instB], ['coord-b', instA]] as Array<[Tag, string]>) {
    check(`C14.${who}-no-profile`, denied(await get(`/api/institutions/${foreign}`, who)));
    check(`C14.${who}-no-edit`, denied(await patch(`/api/institutions/${foreign}`, who, { region: 'x' })));
    check(`C14.${who}-no-coordinators`, denied(await get(`/api/institutions/${foreign}/coordinators`, who)));
    check(`C14.${who}-no-invite`, denied(await post(`/api/institutions/${foreign}/coordinators`, who, { email: 'intruder+clerk_test@example.com' })));
    check(`C14.${who}-no-grade`, denied(await post(`/api/institutions/${foreign}/grades`, who, { name: 'x' })));
    check(`C14.${who}-no-class`, denied(await post(`/api/institutions/${foreign}/classes`, who, { name: 'x' })));
    check(`C14.${who}-no-pending`, denied(await get(`/api/institutions/${foreign}/memberships/pending`, who)));
    check(`C14.${who}-no-page`, (await get(`/dashboard/institution/${foreign}`, who)).status === 404);
  }
  check('C14.coord-a-sees-only-A', JSON.stringify((await get('/dashboard/institution', 'coord-a')).location ?? '').includes(instA));
  check('C14.coordinator-not-platform-admin', (await post('/api/admin/institutions', 'coord-a', { name: 'Coord-made' })).status === 403 && (await get(`/api/admin/institutions/${instA}`, 'coord-a')).status === 403 && (await post(`/api/admin/institutions/${instA}/coordinators`, 'coord-a', { email: 'x+clerk_test@example.com' })).status === 403);
  check('C14.coordinator-cannot-self-grant-platform', (await post('/api/identity/roles/select', 'coord-a', { role: 'STUDYUS_ADMIN' })).status === 400);
  check('C14.coordinator-cannot-change-status', (await q1(`SELECT status FROM institutions WHERE id = $1`, [instA]))?.status === 'ACTIVE');
  check('C14.TA-inst-a-admin-not-E2E-A', denied(await get(`/api/institutions/${instA}`, 'inst-a')));

  // Inactive institution: suspending closes the workspace; re-activating restores it.
  check('C15.suspend-B', (await patch(`/api/admin/institutions/${instB}`, 'platform-admin', { status: 'SUSPENDED' })).status === 200);
  check('C15.suspended-no-access', denied(await get(`/api/institutions/${instB}`, 'coord-b')) && !((await get('/api/identity/me', 'coord-b')).body?.data?.availableWorkspaces ?? []).includes('INSTITUTION'));
  check('C15.suspended-no-invite', (await post(`/api/admin/institutions/${instB}/coordinators`, 'platform-admin', { email: 'q+clerk_test@example.com' })).status === 409);
  check('C15.reactivate-B', (await patch(`/api/admin/institutions/${instB}`, 'platform-admin', { status: 'ACTIVE' })).status === 200 && (await get(`/api/institutions/${instB}`, 'coord-b')).status === 200);

  // Revoked invitation.
  const invZ = await q1(`SELECT id FROM institution_admin_invitations WHERE institution_id = $1 AND email = 'studyus-ta-coord-z+clerk_test@example.com' AND status = 'PENDING'`, [instA]);
  check('C16.revoke-invitation', (await post(`/api/institutions/${instA}/coordinator-invitations/${invZ?.id}/revoke`, 'coord-a')).status === 200);
  check('C16.revoked-not-in-other-tenant', (await post(`/api/institutions/${instB}/coordinator-invitations/${invZ?.id}/revoke`, 'coord-b')).status === 404);

  // 11 -- DB audit.
  check('DB.max-one-persona-per-account', (await n(`SELECT COUNT(*) n FROM (SELECT user_id FROM user_roles WHERE role IN ('STUDENT','PARENT','TEACHER') AND status = 'ACTIVE' GROUP BY user_id HAVING COUNT(*) > 1) d`)) === 0);
  check('DB.no-duplicate-emails', (await n(`SELECT COUNT(*) n FROM (SELECT lower(email) FROM users WHERE email IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1) d`)) === 0);
  check('DB.one-pending-invite-per-email', (await n(`SELECT COUNT(*) n FROM (SELECT institution_id, email FROM institution_admin_invitations WHERE status = 'PENDING' GROUP BY 1, 2 HAVING COUNT(*) > 1) d`)) === 0);
  check('DB.accepted-invites-have-membership', (await n(`SELECT COUNT(*) n FROM institution_admin_invitations inv WHERE inv.status = 'ACCEPTED' AND NOT EXISTS (SELECT 1 FROM institution_memberships im WHERE im.institution_id = inv.institution_id AND im.user_id = inv.accepted_user_id AND im.membership_role = 'INSTITUTION_ADMIN')`)) === 0);
  check('DB.coordinator-memberships-have-capability', (await n(`SELECT COUNT(*) n FROM institution_memberships im WHERE im.membership_role = 'INSTITUTION_ADMIN' AND im.status = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = im.user_id AND r.role = 'INSTITUTION_ADMIN')`)) === 0);
  check('DB.slugs-unique-and-set', (await n(`SELECT COUNT(*) n FROM institutions WHERE slug IS NULL`)) === 0);
  const audit = (await db.query(`SELECT action, COUNT(*)::int AS n FROM admin_audit_log WHERE occurred_at > NOW() - INTERVAL '1 hour' AND action IN ('INSTITUTION_CREATED','INSTITUTION_UPDATED','COORDINATOR_INVITED','COORDINATOR_INVITATION_ACCEPTED','INSTITUTION_ADMIN_GRANTED','COORDINATOR_REMOVED','COORDINATOR_INVITATION_REVOKED') GROUP BY action`)).rows;
  check('DB.audit-trail', ['INSTITUTION_CREATED', 'INSTITUTION_UPDATED', 'COORDINATOR_INVITED', 'COORDINATOR_INVITATION_ACCEPTED', 'INSTITUTION_ADMIN_GRANTED', 'COORDINATOR_REMOVED', 'COORDINATOR_INVITATION_REVOKED'].every((a) => audit.some((r: any) => r.action === a)), JSON.stringify(audit));
  check('DB.TA-institutions-untouched', (await n(`SELECT COUNT(*) n FROM institutions WHERE name = $1 AND status = 'ACTIVE'`, [INST_A_NAME])) === 1);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\nINSTITUTION E2E: ${results.length - failed.length}/${results.length} PASS${failed.length ? ' -- FAILED: ' + failed.map((f) => f.id).join(', ') : ''}`);
    if (failed.length) process.exitCode = 1;
    await (db as any).end?.();
  });
