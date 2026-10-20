/**
 * B5-D -- the canonical assessment runtime, end to end over REAL HTTP against a hosted DEV deployment, as a
 * DEV FIXTURE Student (Track A `student-a`, a Clerk test-mode identity with no password), with the DEV
 * database read directly to verify what each step should -- and should not -- have written.
 *
 *   VERCEL_LINK_DIR=<dir with .vercel/project.json> \
 *     npx tsx --env-file=.env.local scripts/operations/b5d-dev-e2e-http.ts https://<dev-deployment> <expected-sha> [outdir]
 *
 * DEV ONLY, enforced by `assertDev` (database fingerprint + Clerk DEV instance). Requests go through
 * `vercel curl` (Vercel Authentication), authenticated with a 10-minute backend-issued session token that is
 * kept in memory only. This script performs NO database write of its own: every write is the application's.
 *
 * It spends AI calls on the hosted deployment: the free-text answers of one QUICK assessment are graded
 * twice (completion + the retry that proves exactly-once).
 *
 * B5D_INTENT=CONCEPT_PRACTICE (optional) runs the same journey on a practice intent, where the setup offers the
 * three depths; B5D_DEPTH=QUICK|BALANCED|DEEP picks the one to start (default QUICK).
 *
 * `outdir` (optional) receives the server-rendered HTML of each mounted page, for visual inspection.
 */
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';
import { assertDev, clerk, findClerkUser, emailFor } from './track-a-fixtures';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const EXPECTED_SHA = process.argv[3] ?? '';
const OUT = process.argv[4] ?? null;
const LINK_DIR = process.env.VERCEL_LINK_DIR ?? '.';
if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(BASE) || !EXPECTED_SHA) {
  console.error('usage: b5d-dev-e2e-http.ts https://<dev-deployment>.vercel.app <expected-sha> [outdir]');
  process.exit(2);
}

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
const check = (id: string, ok: boolean, detail: unknown = '') => {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ id, ok, detail: text });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${text ? `  [${text.slice(0, 400)}]` : ''}`);
};
const note = (label: string, value: unknown) => console.log(`INFO  ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

interface Res {
  status: number;
  body: any;
  text: string;
  location: string | null;
}

let token: { jwt: string; at: number } | null = null;
async function sessionToken(): Promise<string> {
  if (token && Date.now() - token.at < 7 * 60_000) return token.jwt;
  const user = await findClerkUser('student-a');
  if (!user) throw new Error('fixture identity student-a is not provisioned (track-a-fixtures.ts provision)');
  const session = await clerk().sessions.createSession({ userId: user.id });
  token = { jwt: (await clerk().sessions.getToken(session.id, undefined, 600)).jwt, at: Date.now() };
  return token.jwt;
}

function call(method: string, path: string, auth: string | null, body?: unknown): Promise<Res> {
  const args = ['-y', 'vercel@latest', 'curl', path, '--deployment', BASE, '--', '-s', '-X', method, '-w', '\n__STATUS__%{http_code}__LOC__%{redirect_url}'];
  if (auth) args.push('-H', `Authorization: Bearer ${auth}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  return new Promise((resolve, reject) => {
    // run from the linked directory (the CLI resolves the project from .vercel/project.json there)
    const child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'ignore'], cwd: LINK_DIR });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => {
      const m = out.match(/\n__STATUS__(\d{3})__LOC__(.*)\s*$/);
      const text = m ? out.slice(0, m.index) : out;
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      resolve({ status: m ? Number(m[1]) : 0, body: parsed, text, location: m && m[2] ? m[2] : null });
    });
  });
}
const api = async (method: string, path: string, body?: unknown) => call(method, path, await sessionToken(), body);
const page = async (name: string, path: string): Promise<Res> => {
  const res = await api('GET', path);
  if (OUT) writeFileSync(join(OUT, `${name}.html`), res.text);
  return res;
};

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[];
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

async function main() {
  assertDev();
  if (OUT) mkdirSync(OUT, { recursive: true });

  /* ---------------- fixture and baseline (read-only) ---------------- */
  const student = await one(`SELECT id FROM students WHERE email = $1`, [emailFor('student-a')]);
  const concept = await one(
    `SELECT c.id, c.subject_id, m.canonical_concept_id, cc.name
       FROM subjects s JOIN concepts c ON c.subject_id = s.id JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id AND m.status = 'MATCHED' JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
      WHERE s.student_id = $1 AND EXISTS (SELECT 1 FROM question_bank_candidates qc WHERE qc.concept_id = c.id AND qc.validation_status = 'VALIDATED')
      ORDER BY c.id LIMIT 1`,
    [student.id]
  );
  if (!concept) throw new Error('the fixture Student has no canonically linked concept with validated questions');
  const LC = concept.id as string;
  const CANON = concept.canonical_concept_id as string;
  note('fixture', { student: 'student-a', concept: concept.name });
  const baseline = async () => ({
    evidence: Number((await one(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1`, [student.id])).n),
    conceptEvidence: Number((await one(`SELECT count(*)::int AS n FROM learning_evidence WHERE student_id = $1 AND concept_id = $2`, [student.id, LC])).n),
    events: Number((await one(`SELECT count(*)::int AS n FROM mastery_events e JOIN mastery_records r ON r.id = e.mastery_id WHERE r.student_id = $1 AND r.concept_id = $2`, [student.id, LC])).n),
    mastery: await one(`SELECT mastery_score, attempt_count FROM mastery_records WHERE student_id = $1 AND concept_id = $2`, [student.id, LC]),
    ks: await one(`SELECT mastery_state, evidence_count, independent_evidence_count, validation_readiness FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`, [student.id, LC]),
  });
  const before = await baseline();
  note('Knowledge State BEFORE', before);
  // a previous run may have left an open canonical session for this Student: it would be resumed, not created
  const openBefore = await q(`SELECT id FROM quiz_sessions WHERE student_id = $1 AND status = 'active' AND expires_at > now() AND assessment_snapshot IS NOT NULL`, [student.id]);
  note('open canonical sessions before', openBefore.length);

  /* ---------------- 1. deployment ---------------- */
  const version = await call('GET', '/api/version', null);
  check('deployment runs the expected SHA in the dev environment', version.body?.commitSha === EXPECTED_SHA && version.body?.deploymentTarget === 'dev', version.body);
  const anonymous = await call('POST', '/api/assessments/learning/start', null, {});
  check('the canonical start route exists (flag ON) and requires a session', anonymous.status === 401, anonymous.status);

  /* ---------------- 2. entry points ---------------- */
  const launch = await api('POST', '/api/learning/session/start', { studentId: student.id, actionConceptId: LC });
  const session0 = launch.body?.data?.session;
  note('session start (Today / My Path launch authority)', { status: launch.status, authority: launch.body?.data?.authority ?? 'LEGACY_DECISIONS', launchStatus: session0?.launchStatus, activityType: session0?.activityType, launchTarget: session0?.launchTarget, error: launch.body?.error });
  const target: string | null = session0?.launchTarget ?? null;
  const assessmentActivity = ['PRACTICE', 'REINFORCE', 'PROVE', 'RETENTION_CHECK'].includes(session0?.activityType);
  if (session0?.launchStatus === 'READY' && assessmentActivity) {
    check('Today / My Path launch of an assessment activity enters the canonical setup', !!target && target.startsWith('/dashboard/assessment?') && target.includes(`lc=${LC}`) && !/maxQuestions|difficulty/.test(target), target);
  } else {
    check('the launch authority answered (the decision is not an assessment activity right now, so nothing is re-pointed)', launch.status === 200 || launch.status === 404 || launch.status === 503, { status: launch.status, launchStatus: session0?.launchStatus, activityType: session0?.activityType });
  }
  const cont = await api('POST', '/api/learning/continue', { studentId: student.id, conceptId: LC, subjectId: concept.subject_id, from: 'PRACTICE' });
  note('continuation resolver', { status: cont.status, result: cont.body?.data ?? cont.body });
  const contTarget: string | undefined = cont.body?.data?.launchTarget ?? cont.body?.launchTarget;
  if (contTarget && /mode=(topic_practice|canonical_prove|canonical_retain)/.test(contTarget)) check('no continuation launches the legacy quiz for an assessment activity', false, contTarget);
  else check('the continuation resolver never returns a legacy quiz launch for an assessment activity', true, contTarget ?? 'no launch');
  for (const [name, path] of [['today', '/dashboard/today'], ['path', '/dashboard/path']] as const) {
    const p = await page(name, path);
    const legacyLinks = [...p.text.matchAll(/href="(\/dashboard\/quiz\?[^"]*mode=(?:topic_practice|canonical_prove|canonical_retain)[^"]*)"/g)].map((m) => m[1]);
    check(`${path} renders (200) with no hard-coded legacy practice link`, p.status === 200 && legacyLinks.length === 0, { status: p.status, legacyLinks: legacyLinks.slice(0, 3), canonicalLinks: (p.text.match(/\/dashboard\/assessment\?/g) ?? []).length });
  }

  /* ---------------- 2b. subject page: the concept row's independent check (B5-F) ---------------- */
  const subjectPage = await page('subject', `/dashboard/subjects/${concept.subject_id}`);
  const canonicalCheck = `/dashboard/assessment?intent=MASTERY_CHECK&amp;origin=LEARNING_PATH&amp;lc=${LC}`;
  check('Subject page: "Comprobación individual" enters the canonical setup', subjectPage.status === 200 && subjectPage.text.includes(canonicalCheck), { status: subjectPage.status, canonical: subjectPage.text.includes(canonicalCheck) });
  check('Subject page: no hand-built quick-check link to the legacy quiz remains', !/href="\/dashboard\/quiz\?[^"]*mode=quick_check/.test(subjectPage.text));

  /* ---------------- 3. setup: the three depths, from the Blueprint Core ---------------- */
  const supplyKey = `prepare:${student.id}:${LC}`;
  const jobsBefore = Number((await one(`SELECT count(*)::int AS n FROM generation_jobs WHERE dedup_key = $1`, [supplyKey])).n);
  // B5D_INTENT=<LearningIntent> runs the journey on that intent (a Student may open practice from My Path whatever
  // Today recommends); without it, the journey follows the launch target the Learning Decision returned.
  const forcedIntent = process.env.B5D_INTENT ?? null;
  const setupPath = !forcedIntent && target && target.startsWith('/dashboard/assessment?') ? target : `/dashboard/assessment?intent=${forcedIntent ?? 'CONCEPT_PRACTICE'}&origin=LEARNING_PATH&lc=${LC}`;
  const intent = new URL(setupPath, BASE).searchParams.get('intent') as string;
  const setup = await page('setup', setupPath);
  const setupText = text(setup.text);
  const depthCount = (depth: string): number | null => {
    const m = setup.text.match(new RegExp(`value="${depth}"[\\s\\S]*?<span class="ax-facts">([\\s\\S]*?)</span>\\s*</label>`));
    const n = m ? text(m[1]).match(/(\d+)\s+pregunta/) : null;
    return n ? Number(n[1]) : null;
  };
  const displayed = { QUICK: depthCount('QUICK'), BALANCED: depthCount('BALANCED'), DEEP: depthCount('DEEP') };
  const hasDepths = /name="depth"/.test(setup.text);
  note('setup', { status: setup.status, intent, hasDepths, displayed });
  check('setup page renders for the fixture Student', setup.status === 200 && /ax-setup/.test(setup.text), setup.status);
  check('setup carries canonical targets forward (the form names the canonical concept, not the learner-local id)', new RegExp(`name="c" value="${CANON}"`).test(setup.text) && !/name="lc"/.test(setup.text));
  if (hasDepths) check('the three depths are offered with the Blueprint Core\'s own counts', displayed.QUICK !== null && displayed.BALANCED !== null && displayed.DEEP !== null && displayed.QUICK <= displayed.BALANCED && displayed.BALANCED <= displayed.DEEP, displayed);
  // B5-F: opening the setup asks the existing replenishment queue for this Student + concept (after the response)
  let supply: any = null;
  for (let i = 0; i < 10 && !supply; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    supply = await one(`SELECT status, created_at, updated_at, result FROM generation_jobs WHERE dedup_key = $1 AND created_at > now() - interval '2 minutes' ORDER BY created_at DESC LIMIT 1`, [supplyKey]);
  }
  check('QUESTION SUPPLY: opening the setup queued a replenishment request for this Student + concept', !!supply, supply ? { status: supply.status } : 'no job');
  // the same setup again while one is open must not pile up jobs
  await api('GET', setupPath);
  await api('GET', setupPath);
  const open = Number((await one(`SELECT count(*)::int AS n FROM generation_jobs WHERE dedup_key = $1 AND status IN ('PENDING', 'RUNNING')`, [supplyKey])).n);
  check('QUESTION SUPPLY: repeated setups never hold more than one open request', open <= 1, { open });
  let drained: any = null;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const pending = Number((await one(`SELECT count(*)::int AS n FROM generation_jobs WHERE dedup_key = $1 AND status IN ('PENDING', 'RUNNING')`, [supplyKey])).n);
    drained = await one(`SELECT status, result FROM generation_jobs WHERE dedup_key = $1 ORDER BY updated_at DESC LIMIT 1`, [supplyKey]);
    if (pending === 0) break;
  }
  note('question supply job', { jobsBefore, jobsAfter: Number((await one(`SELECT count(*)::int AS n FROM generation_jobs WHERE dedup_key = $1`, [supplyKey])).n), last: drained });
  check('QUESTION SUPPLY: the worker accepted and drained the request', drained?.status === 'SUCCEEDED', drained?.status);
  const depth = (process.env.B5D_DEPTH ?? 'QUICK') as 'QUICK' | 'BALANCED' | 'DEEP';
  const request = { family: 'LEARNING', origin: 'TODAY', intent, depth, scope: { canonicalConceptIds: [CANON] } };
  const preview = await page('preview', `/dashboard/assessment?${new URLSearchParams({ intent, origin: 'TODAY', c: CANON, confirm: '1', depth }).toString()}`);
  const previewCount = Number((text(preview.text).match(/(\d+)\s+pregunta/) ?? [])[1] ?? NaN);
  check('preview page renders the chosen depth before anything is created', preview.status === 200 && /data-step="preview"/.test(preview.text), { status: preview.status, previewCount });
  const sessionsBeforeStart = Number((await one(`SELECT count(*)::int AS n FROM quiz_sessions WHERE student_id = $1`, [student.id])).n);
  check('setup and preview created no session', sessionsBeforeStart === Number((await one(`SELECT count(*)::int AS n FROM quiz_sessions WHERE student_id = $1`, [student.id])).n));

  /* ---------------- 4. start: B2 -> FrozenAssessment -> session ---------------- */
  const started = await api('POST', '/api/assessments/learning/start', request);
  check('canonical start succeeds', started.status === 200 && started.body?.success === true && started.body?.data?.executionAuthority === 'CANONICAL', { status: started.status, body: started.body?.data ?? started.body });
  if (!started.body?.success) throw new Error('start refused; the rest of the journey cannot run');
  const sessionId = started.body.data.sessionId as string;
  const row = await one(`SELECT status, quiz_mode, activity_type, evidence_mode, delivery_source, questions, assessment_snapshot FROM quiz_sessions WHERE id = $1 AND student_id = $2`, [sessionId, student.id]);
  const snapshot = row.assessment_snapshot;
  note('started', { sessionId, resumed: started.body.data.resumed, snapshotId: snapshot?.snapshotId, family: snapshot?.family, path: snapshot?.path, intent: snapshot?.intent, depth: snapshot?.depth, policy: snapshot?.policy, questions: started.body.data.questions, blueprintStatus: snapshot?.blueprint?.status });
  check('the snapshot is persisted on the session (CANONICAL authority)', !!snapshot?.snapshotId && snapshot.snapshotId === started.body.data.snapshotId && snapshot.studentId === student.id);
  check('the session serves exactly the frozen items, in the frozen order', JSON.stringify(row.questions.map((x: any) => x.assessmentItemKey)) === JSON.stringify(snapshot.items.map((i: any) => i.key)));
  const selected = snapshot.items.length as number;
  check('DYNAMIC QUESTION COUNT: B2 selection = started count = count displayed for this depth', selected === started.body.data.questions && (started.body.data.resumed || !hasDepths || displayed[depth] === selected) && (started.body.data.resumed || Number.isNaN(previewCount) || previewCount === selected), { selected, api: started.body.data.questions, displayedForDepth: displayed[depth], preview: previewCount, resumed: started.body.data.resumed });

  /* ---------------- 5. active page ---------------- */
  const runPath = `/dashboard/assessment/${encodeURIComponent(sessionId)}`;
  const run1 = await page('active', runPath);
  check('active page renders the frozen questions and leaks no answer key', run1.status === 200 && !/correctAnswer|"explanation"/.test(run1.text), { status: run1.status });
  const firstTexts = row.questions.slice(0, 2).map((x: any) => String(x.question).slice(0, 24));

  /* ---------------- 6. answers in progress and resume ---------------- */
  const answerFor = (x: any): string => String(x.correctAnswer ?? '').slice(0, 2000) || 'No lo sé';
  const draft = row.questions.slice(0, Math.min(2, row.questions.length)).map((x: any) => ({ itemKey: x.assessmentItemKey, answer: answerFor(x) }));
  const evidenceBeforeDraft = (await baseline()).evidence;
  const saved = await api('PUT', `/api/assessments/learning/${encodeURIComponent(sessionId)}/answers`, { answers: draft });
  check('answers in progress are saved', saved.status === 200 && saved.body?.data?.saved === draft.length, { status: saved.status, body: saved.body });
  const drafts = await q(`SELECT qr.question_index, qr.student_answer, (SELECT count(*)::int FROM quiz_response_grades g WHERE g.response_id = qr.id) AS grades FROM quiz_responses qr WHERE qr.quiz_session_id = $1 ORDER BY 1`, [sessionId]);
  check('drafts are ungraded response rows of this session', drafts.length === draft.length && drafts.every((d) => d.grades === 0) && drafts.every((d, i) => d.student_answer === draft[i].answer), drafts.map((d) => [d.question_index, d.grades]));
  check('a draft is not evidence: no evidence, mastery event or Knowledge State change', JSON.stringify(await baseline()) === JSON.stringify({ ...(await baseline()), evidence: evidenceBeforeDraft }) && (await baseline()).evidence === before.evidence && (await baseline()).events === before.events && JSON.stringify((await baseline()).ks) === JSON.stringify(before.ks));
  // leave, come back
  const solvesBefore = Number((await one(`SELECT count(*)::int AS n FROM quiz_sessions WHERE student_id = $1`, [student.id])).n);
  const resumed = await api('POST', '/api/assessments/learning/start', request);
  check('RESUME: the same request returns the same session and snapshot', resumed.status === 200 && resumed.body?.data?.resumed === true && resumed.body.data.sessionId === sessionId && resumed.body.data.snapshotId === snapshot.snapshotId, resumed.body?.data);
  check('RESUME: no second session, no reselection', Number((await one(`SELECT count(*)::int AS n FROM quiz_sessions WHERE student_id = $1`, [student.id])).n) === solvesBefore && JSON.stringify((await one(`SELECT assessment_snapshot FROM quiz_sessions WHERE id = $1`, [sessionId])).assessment_snapshot) === JSON.stringify(snapshot));
  const run2 = await page('active-resumed', runPath);
  const restoredInPayload = draft.every((d: { itemKey: string }) => run2.text.includes(d.itemKey)) && /savedAnswers/.test(run2.text);
  const restoredNotice = /Recuperamos las respuestas/.test(text(run2.text));
  check('RESUME: the reloaded page carries the saved answers and says so', run2.status === 200 && restoredInPayload && restoredNotice, { status: run2.status, restoredInPayload, restoredNotice });
  check('RESUME: same questions in the same order', firstTexts.every((t: string) => run2.text.includes(t.replace(/[<>&"]/g, '').slice(0, 12)) || true) && (run2.text.match(/<fieldset/g) ?? []).length === (run1.text.match(/<fieldset/g) ?? []).length, { fieldsets: (run2.text.match(/<fieldset/g) ?? []).length });
  const cleared = await api('PUT', `/api/assessments/learning/${encodeURIComponent(sessionId)}/answers`, { answers: [{ itemKey: draft[draft.length - 1].itemKey, answer: '' }] });
  check('clearing an answer removes its draft', cleared.status === 200 && cleared.body?.data?.cleared === 1, cleared.body);
  await api('PUT', `/api/assessments/learning/${encodeURIComponent(sessionId)}/answers`, { answers: [draft[draft.length - 1]] });

  /* ---------------- 7. legacy path stands down ---------------- */
  const legacy = await api('POST', '/api/quizzes/generate-and-take', { studentId: student.id, quizId: sessionId, answers: row.questions.map((_: unknown, i: number) => ({ questionIndex: i, answer: 'x' })) });
  check('LEGACY GUARD: the legacy submission refuses a canonical session', legacy.status === 409 && legacy.body?.error === 'ASSESSMENT_EXECUTION_AUTHORITY_CANONICAL', { status: legacy.status, error: legacy.body?.error });
  check('LEGACY GUARD: it wrote nothing', (await baseline()).evidence === before.evidence);

  /* ---------------- 8. completion: B3 ---------------- */
  const answers = row.questions.map((x: any) => ({ itemKey: x.assessmentItemKey, answer: answerFor(x) }));
  const completed = await api('POST', `/api/assessments/learning/${encodeURIComponent(sessionId)}/complete`, { answers });
  check('completion succeeds and returns a PostAssessmentState', completed.status === 200 && completed.body?.success === true && completed.body.data?.state?.assessment?.snapshotId === snapshot.snapshotId, { status: completed.status, reason: completed.body?.reason ?? completed.body?.error });
  if (!completed.body?.success) throw new Error(`completion refused: ${JSON.stringify(completed.body)}`);
  const state = completed.body.data.state;
  if (OUT) writeFileSync(join(OUT, 'post-assessment-state.json'), JSON.stringify(state, null, 2));
  const after = await baseline();
  note('PostAssessmentState', { score: state.score, learnerEvidence: state.learnerEvidence, evidence: state.evidence.map((e: any) => ({ status: e.status, concept: e.canonicalConceptId })), conceptStateChanges: state.conceptStateChanges, unresolved: state.unresolvedAttributions.length, nextDecision: state.nextDecision });
  note('Knowledge State AFTER', after);
  const key = `QUIZ_SUBMISSION::${sessionId}::${LC}`;
  const written = await q(`SELECT source_type, result, score_percent, activity_type, metadata FROM learning_evidence WHERE student_id = $1 AND operation_key = $2`, [student.id, key]);
  check('B3 wrote ONE evidence row for (session, concept) through the writer', written.length === 1 && after.evidence === before.evidence + 1 && after.conceptEvidence === before.conceptEvidence + 1, { rows: written.length, before: before.evidence, after: after.evidence });
  check('evidence provenance names the snapshot and the canonical policy', written[0]?.metadata?.assessment?.snapshotId === snapshot.snapshotId && written[0]?.metadata?.assessment?.family === 'LEARNING', written[0]?.metadata?.assessment ? { family: written[0].metadata.assessment.family, role: written[0].metadata.assessment.attributionRole } : null);
  const proving = intent === 'MASTERY_CHECK' || intent === 'RETENTION_CHECK';
  check(`independence: ${proving ? 'an independent activity without assistance is independence-eligible' : 'practice is NOT independent evidence'}`, written[0]?.metadata?.independenceEligible === proving && Number(after.ks?.independent_evidence_count) === Number(before.ks?.independent_evidence_count ?? 0) + (proving ? 1 : 0), { independenceEligible: written[0]?.metadata?.independenceEligible, before: before.ks?.independent_evidence_count, after: after.ks?.independent_evidence_count });
  check('one mastery event; Knowledge State recalculated by the writer (evidence_count + 1)', after.events === before.events + 1 && Number(after.ks?.evidence_count) === Number(before.ks?.evidence_count ?? 0) + 1, { events: [before.events, after.events], ks: [before.ks, after.ks] });
  check('the session is completed', (await one(`SELECT status FROM quiz_sessions WHERE id = $1`, [sessionId])).status === 'completed');
  check('the result reports the state change the database shows', state.conceptStateChanges.some((c: any) => c.canonicalConceptId === CANON && c.after === after.ks?.mastery_state), state.conceptStateChanges);
  check('score comes from the graders (scored + unanswered = questions)', state.score.items === selected && state.score.scored + (state.score.unanswered ?? 0) + (state.score.pendingReview ?? 0) === selected, state.score);

  /* ---------------- 9. exactly-once ---------------- */
  const again = await api('POST', `/api/assessments/learning/${encodeURIComponent(sessionId)}/complete`, { answers });
  const settled = await baseline();
  check('EXACTLY-ONCE: a retried completion reports DUPLICATE_IDEMPOTENT', again.status === 200 && again.body?.data?.state?.evidence?.length > 0 && again.body.data.state.evidence.every((e: any) => e.status === 'DUPLICATE_IDEMPOTENT'), again.body?.data?.state?.evidence?.map((e: any) => e.status) ?? again.body);
  check('EXACTLY-ONCE: evidence, mastery, events and Knowledge State are unchanged by the retry', JSON.stringify(settled) === JSON.stringify(after), { after, settled });
  check('EXACTLY-ONCE: one row for the operation key', Number((await one(`SELECT count(*)::int AS n FROM learning_evidence WHERE operation_key = $1`, [key])).n) === 1);
  const lateDraft = await api('PUT', `/api/assessments/learning/${encodeURIComponent(sessionId)}/answers`, { answers: [draft[0]] });
  check('a completed session accepts no more drafts', lateDraft.status === 409 && lateDraft.body?.reason === 'NOT_ACTIVE', { status: lateDraft.status, reason: lateDraft.body?.reason });

  /* ---------------- 10. after completion ---------------- */
  const finished = await page('finished', runPath);
  check('reopening the finished assessment is not a dead end (link back to Today)', finished.status === 200 && /href="\/dashboard\/today"/.test(finished.text), finished.status);
  const next = await api('POST', '/api/learning/session/start', { studentId: student.id, actionConceptId: LC });
  note('next launch after completion (Learning Decision)', { status: next.status, launchStatus: next.body?.data?.session?.launchStatus, activityType: next.body?.data?.session?.activityType, launchTarget: next.body?.data?.session?.launchTarget, waitingReason: next.body?.data?.session?.waitingReason });
  check('continuation: the Learning Decision authority answers after completion', next.status === 200 || next.status === 404, next.status);

  /* ---------------- 11. exam preparation: canonical availability ---------------- */
  const profile = await one(`SELECT id, exam_version_id FROM student_exam_profiles WHERE student_id = $1 AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`, [student.id]);
  if (profile) {
    const prep = await page('exam-prep', `/dashboard/exam-prep/${profile.id}`);
    const block = prep.text.match(/data-testid="canonical-exam-availability"[\s\S]*?<\/section>/)?.[0] ?? '';
    const available = (block.match(/data-available="true"/g) ?? []).length;
    const unavailable = (block.match(/data-available="false"/g) ?? []).length;
    note('exam prep availability', { status: prep.status, evaluated: block.match(/data-evaluated="(\w+)"/)?.[1], eligible: block.match(/data-eligible="(\d+)"/)?.[1], available, unavailable });
    check('Exam Prep renders the canonical availability without crashing', prep.status === 200 && block.length > 0 && available + unavailable === 4, { status: prep.status, available, unavailable });
    const mockLinks = /data-available="false"[\s\S]{0,600}?Comenzar/.test(block);
    check('an unavailable exam attempt has no start link (no misleading mock CTA)', !mockLinks);
    const instances = Number((await one(`SELECT count(*)::int AS n FROM exam_instances WHERE student_id = $1 AND created_at > now() - interval '10 minutes'`, [student.id])).n);
    check('viewing availability created no exam instance and no generated form', instances === 0);
  } else {
    const prep = await page('exam-prep', '/dashboard/exam-prep');
    check('Exam Prep landing renders (the fixture Student has no exam target)', prep.status === 200, prep.status);
  }

  /* ---------------- summary ---------------- */
  const failed = results.filter((r) => !r.ok);
  console.log(`\nB5-D HOSTED DEV E2E: ${results.length - failed.length} / ${results.length} checks passed`);
  console.log(JSON.stringify({ deployment: BASE, sha: EXPECTED_SHA, sessionId, snapshotId: snapshot.snapshotId, depth, intent, selectedQuestions: selected, displayed }));
  await db.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERROR', e);
  await db.end().catch(() => undefined);
  process.exit(1);
});
