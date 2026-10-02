/**
 * Track A -- UX fix E2E over REAL HTTP (DEV): notification READ state vs
 * business ACTION state (all roles), and Institution Intelligence context
 * UX (no technical ids, governed selectors, explanations, empty states,
 * cross-tenant denial). Runs on the Learning Plan E2E world (run
 * track-a-learning-plan-e2e-http.ts first).
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-a-ux-notifications-intelligence-e2e-http.ts <baseUrl> <tokens.json>
 *
 * The notifications page marks what it displayed as read from the browser
 * (InboxReadControls); over HTTP the same call is made explicitly with the
 * ids the page rendered as UNREAD (data-read="UNREAD"), exactly what the
 * client posts.
 */
import { readFileSync } from 'fs';
import { db } from '@/lib/db';
import { assertDev, emailFor, INST_LP_NAME, INST_A_NAME, LP_CLASS_NAME, type Tag } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const TOKENS: Record<Tag, string> = JSON.parse(readFileSync(process.argv[3] ?? '', 'utf-8'));
const results: Array<{ id: string; ok: boolean; detail: string }> = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
async function call(method: string, path: string, who: Tag | null, body?: unknown) {
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
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
const get = (p: string, who: Tag | null) => call('GET', p, who);
const post = (p: string, who: Tag | null, body: unknown = {}) => call('POST', p, who, body);
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const denied = (s: number) => s === 401 || s === 403 || s === 404;

/** The nav badge for the notifications item as the server rendered it (layout). */
function navBadge(html: string): number {
  const m = html.match(/href="\/dashboard\/notifications"[^>]*>[\s\S]{0,600}?<span class="lx-nav-badge">(\d+)<\/span>/);
  return m ? Number(m[1]) : 0;
}

/** Open the notifications page as the browser does: render, then mark the rendered UNREAD ids read. */
async function openInbox(who: Tag) {
  const page = await get('/dashboard/notifications', who);
  const unreadIds = [...page.text.matchAll(/data-read="UNREAD"/g)].length;
  const inbox = (await get('/api/notifications/inbox', who)).body?.data;
  const displayedUnread = (inbox?.notifications ?? []).filter((n: any) => !n.readAt).map((n: any) => n.id);
  const mark = displayedUnread.length ? await post('/api/notifications/inbox', who, { ids: displayedUnread }) : null;
  return { page, renderedUnread: unreadIds, displayedUnread, unreadAfter: mark?.body?.data?.unreadCount ?? inbox?.unreadCount ?? 0 };
}

async function main() {
  assertDev();
  const inst = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_LP_NAME])).rows[0]?.id;
  const klass = (await db.query(`SELECT id FROM classes WHERE institution_id = $1 AND name = $2`, [inst, LP_CLASS_NAME])).rows[0]?.id;
  if (!inst || !klass) throw new Error('run track-a-learning-plan-e2e-http.ts first');
  const instA = (await db.query(`SELECT id FROM institutions WHERE name = $1`, [INST_A_NAME])).rows[0]?.id;
  const users = Object.fromEntries((await db.query(`SELECT id, email FROM users WHERE email LIKE 'studyus-ta-%+clerk_test@example.com'`)).rows.map((r: any) => [r.email.replace('studyus-ta-', '').replace('+clerk_test@example.com', ''), r.id]));
  // Clean inboxes of the actors used here (fixtures only).
  await db.query(`UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL AND recipient_user_id = ANY($1::uuid[])`, [[users['lp-student'], users['lp-coord'], users['teacher-b'], users['parent-a']]]);

  // ---------------------------------------------------------------- STUDENT
  const invite = await post(`/api/teacher/classes/${klass}/enrollments`, 'lp-teacher', { email: emailFor('lp-student') });
  check('N.student.invited', invite.status === 201, `${invite.status}`);
  const parentReq = await post('/api/parent/child-requests', 'parent-a', { email: emailFor('lp-student') });
  check('N.student.parent-request', [200, 201, 202].includes(parentReq.status), `${parentReq.status}`);
  const dash = await get('/dashboard/plan', 'lp-student');
  check('N1.student.unread-badge', navBadge(dash.text) >= 2, `badge=${navBadge(dash.text)}`);
  const otherPage = await get('/dashboard/plan?tab=explore', 'lp-student');
  check('N.student.other-pages-do-not-clear', navBadge(otherPage.text) >= 2);
  const s1 = await openInbox('lp-student');
  check('N2.student.page-shows-unread', s1.renderedUnread >= 2 && s1.displayedUnread.length >= 2, `${s1.renderedUnread}`);
  check('N3.student.badge-decrements', s1.unreadAfter === 0, `${s1.unreadAfter}`);
  const after = await get('/dashboard/plan', 'lp-student');
  check('N3.student.badge-gone', navBadge(after.text) === 0 && !/lx-topbar-dot/.test(after.text));
  const reread = await get('/dashboard/notifications', 'lp-student');
  const rereadText = visible(reread.text);
  check('N5.student.read-but-pending', /data-read="READ"[^>]*data-action-pending="true"/.test(reread.text) && rereadText.includes('Acción pendiente') && rereadText.includes('Acciones pendientes'));
  check('N8.student.refresh-preserves-read', !/data-read="UNREAD"/.test(reread.text));
  const invitations = (await get('/api/student/class-invitations', 'lp-student')).body?.data?.invitations ?? [];
  const inv = invitations.find((i: any) => i.className === LP_CLASS_NAME);
  check('N6.student.invitation-still-actionable', !!inv);
  const parentProfile = (await db.query(`SELECT id FROM profiles WHERE user_id = $1 AND user_type = 'parent'`, [users['parent-a']])).rows[0]?.id;
  check('N6.student.decline-parent-request-works', (await post('/api/parent/requests', 'lp-student', { parentId: parentProfile, accept: false })).status === 200);
  check('N6.student.accept-invitation-works', (await post(`/api/student/class-invitations/${inv?.enrollmentId}/respond`, 'lp-student', { accept: true })).status === 200);
  const resolved = await get('/dashboard/notifications', 'lp-student');
  check('N5.student.pending-cleared-after-action', !/data-action-pending="true"/.test(resolved.text));
  // mark unread / mark all read
  const anyId = ((await get('/api/notifications/inbox', 'lp-student')).body?.data?.notifications ?? [])[0]?.id;
  const unread = await post('/api/notifications/inbox', 'lp-student', { ids: [anyId], unread: true });
  check('N.student.mark-unread', unread.status === 200 && unread.body?.data?.unreadCount === 1);
  check('N.student.mark-all-cta-visible', visible((await get('/dashboard/notifications', 'lp-student')).text).includes('Marcar todas como leídas'));
  const all = await post('/api/notifications/inbox', 'lp-student', {});
  check('N4.student.mark-all-read', all.status === 200 && all.body?.data?.unreadCount === 0);
  check('N4.student.mark-all-cta-hidden', !visible((await get('/dashboard/notifications', 'lp-student')).text).includes('Marcar todas como leídas'));

  // ---------------------------------------------------------------- PARENT (declined request notice)
  const p1 = await get('/dashboard/parent', 'parent-a');
  check('N7.parent.unread-badge', navBadge(p1.text) >= 1, `badge=${navBadge(p1.text)}`);
  const po = await openInbox('parent-a');
  check('N7.parent.badge-zero-after-view', po.unreadAfter === 0 && navBadge((await get('/dashboard/parent', 'parent-a')).text) === 0);

  // ---------------------------------------------------------------- COORDINATOR (teacher request: READ + PENDING)
  const req = await post(`/api/institutions/${inst}/membership`, 'teacher-b');
  check('N.coord.teacher-request', req.status === 200 || req.status === 201, `${req.status}`);
  const c1 = await get(`/dashboard/institution/${inst}`, 'lp-coord');
  check('N7.coord.unread-badge', navBadge(c1.text) >= 1, `badge=${navBadge(c1.text)}`);
  const co = await openInbox('lp-coord');
  check('N7.coord.badge-zero-after-view', co.unreadAfter === 0 && navBadge((await get(`/dashboard/institution/${inst}`, 'lp-coord')).text) === 0);
  const cpage = await get('/dashboard/notifications', 'lp-coord');
  const ctext = visible(cpage.text);
  check('N5.coord.read-but-pending', /data-read="READ"[^>]*data-action-pending="true"/.test(cpage.text) && ctext.includes('Revisar solicitud') && ctext.includes(emailFor('teacher-b')));
  const membership = (await db.query(`SELECT id FROM institution_memberships WHERE institution_id = $1 AND user_id = $2 AND status = 'PENDING'`, [inst, users['teacher-b']])).rows[0]?.id;
  check('N6.coord.approve-works', (await post(`/api/institutions/${inst}/memberships/${membership}/decide`, 'lp-coord', { decision: 'APPROVED' })).status === 200);
  check('N5.coord.pending-cleared', !/data-action-pending="true"/.test((await get('/dashboard/notifications', 'lp-coord')).text));

  // ---------------------------------------------------------------- TEACHER (approval notice)
  const t1 = await get('/dashboard/teacher', 'teacher-b');
  check('N7.teacher.unread-badge', navBadge(t1.text) >= 1, `badge=${navBadge(t1.text)}`);
  const to = await openInbox('teacher-b');
  check('N7.teacher.badge-zero-after-view', to.unreadAfter === 0 && navBadge((await get('/dashboard/teacher', 'teacher-b')).text) === 0);

  // ---------------------------------------------------------------- scope
  const foreignId = ((await get('/api/notifications/inbox', 'lp-coord')).body?.data?.notifications ?? [])[0]?.id;
  const spoof = await post('/api/notifications/inbox', 'lp-student', { ids: [foreignId], unread: true });
  check('N.scope.foreign-id-untouched', spoof.status === 200 && spoof.body?.data?.marked === 0);

  // ---------------------------------------------------------------- INSTITUTION INTELLIGENCE
  const tabs = ['coverage', 'readiness', 'interventions', 'attention'] as const;
  const help: Record<(typeof tabs)[number], string> = {
    coverage: 'Consulta qué parte del currículo seleccionado ya está siendo trabajada por tus clases y estudiantes',
    readiness: 'Consulta el avance de los estudiantes frente a los exámenes asociados a su programa académico.',
    interventions: 'Revisa tareas activas, completadas, atrasadas y grupos que necesitan seguimiento.',
    attention: 'Identifica conceptos y grupos de estudiantes donde la evidencia muestra necesidades de refuerzo.',
  };
  for (const tab of tabs) {
    const r = await get(`/dashboard/institution/${inst}/${tab}`, 'lp-coord');
    const text = visible(r.text);
    check(`I9.${tab}.no-technical-ids`, r.status === 200 && !/Structure Version ID|Exam Version ID|Class ID|structureVersionId|examVersionId/.test(r.text), `${r.status}`);
    check(`I14.${tab}.explained`, text.includes(help[tab]));
    check(`I10.${tab}.context-selectors`, text.includes('Programa') && text.includes('Versión curricular') && text.includes('Grado / Nivel') && text.includes('Asignatura'));
  }
  const cov = visible((await get(`/dashboard/institution/${inst}/coverage`, 'lp-coord')).text);
  check('I11.smart-default-single-curriculum', cov.includes('Matemáticas 11 LP') && cov.includes('11.º LP') && cov.includes('Trabajo en clases y estudiantes'));
  check('I15.coverage.work-numbers', /\d+ de \d+ conceptos están en el plan de alguna clase/.test(cov));
  check('I15.coverage.no-base-explained', cov.includes('catálogo general de la asignatura'));
  const rd = visible((await get(`/dashboard/institution/${inst}/readiness`, 'lp-coord')).text);
  check('I15.readiness.empty-or-data', rd.includes('Examen') || rd.includes('Este currículo todavía no tiene exámenes asociados.') || rd.includes('Todavía no hay estudiantes preparando este examen.'));
  const iv = visible((await get(`/dashboard/institution/${inst}/interventions?period=30d`, 'lp-coord')).text);
  check('I12.interventions.period-selector', iv.includes('Periodo') && iv.includes('El periodo se aplica a la actividad de asignaciones.'));
  const at = visible((await get(`/dashboard/institution/${inst}/attention`, 'lp-coord')).text);
  check('I15.attention.empty-or-reasons', at.includes('No se han detectado áreas de atención con la evidencia disponible.') || /Concentración|tareas asignadas|evidencia de aprendizaje/.test(at));

  // no curriculum (Institution A) -> empty state + CTA, no technical input
  if (instA) {
    const noCur = await get(`/dashboard/institution/${instA}/coverage`, 'inst-a');
    const nt = visible(noCur.text);
    check('I13.no-curriculum-empty-state', noCur.status === 200 && nt.includes('Tu institución todavía no tiene un currículo configurado.') && nt.includes('Configurar currículo') && !/Structure Version ID/.test(noCur.text));
  }
  // cross-tenant: foreign curriculum / class / exam ids are ignored; foreign institution pages are not found
  const lpCurriculum = (await db.query(`SELECT id FROM institution_curricula WHERE institution_id = $1 LIMIT 1`, [inst])).rows[0]?.id;
  if (instA && lpCurriculum) {
    const spoofCur = visible((await get(`/dashboard/institution/${instA}/coverage?curriculum=${lpCurriculum}&class=${klass}`, 'inst-a')).text);
    check('I16.foreign-curriculum-ignored', spoofCur.includes('Tu institución todavía no tiene un currículo configurado.') && !spoofCur.includes('Matemáticas 11 LP'));
  }
  for (const tab of tabs) check(`I16.${tab}.foreign-institution-denied`, denied((await get(`/dashboard/institution/${inst}/${tab}`, 'inst-a')).status));
  check('I16.teacher-denied', denied((await get(`/dashboard/institution/${inst}/coverage`, 'lp-teacher')).status));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nUX NOTIFICATIONS + INTELLIGENCE E2E: ${results.length - failed.length}/${results.length} PASS${failed.length ? ' -- FAILED: ' + failed.map((f) => f.id).join(', ') : ''}`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (db as any).end?.();
  });
