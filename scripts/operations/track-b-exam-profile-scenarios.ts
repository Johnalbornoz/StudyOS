/**
 * Exam Prep profile remove / restart -- DEV scenarios with the REAL services
 * against the REAL DEV database (or an ephemeral cert database).
 *
 *    1 remove with no attempts           7 disappears from the dashboard list
 *    2 remove with a READY exam          8 archived profile no longer operates
 *    3 remove with an IN_PROGRESS one    9 re-adding the exam = clean active profile
 *    4 remove with COMPLETED attempts   10 max one active profile per exam
 *    5 completed evidence retained      11 double submit (remove / restart)
 *    6 learner state retained           12 cross-user + Teacher / Parent denied
 *    + restart: archive + new clean profile in one step, history kept
 *
 * DEV ONLY (fingerprint guard). Fixtures (`tbp-<run>-…`, `@trackb.test`) are
 * removed at the end.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-exam-profile-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { updateMastery } from '@/services/mastery.service';
import { resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createExamInstance, startExamInstance, ensureExamProfile, getExamInstance, newInstanceFromExisting } from '@/lib/exam-core/exam-instance.service';
import { archiveExamProfile, restartExamProfile } from '@/lib/exam-core/prep-profile.service';
import { isAttemptDeletedFromHistory } from '@/lib/exam-core/history.service';
import { createStudentExamProfile, getStudentExamProfile, listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission } from '@/lib/simulation/item-resolution.service';
import { startSimulationAttempt, completeSimulationAttempt, getSimulationAttempt, ExamProfileArchivedError } from '@/lib/simulation/attempt.service';
import { scoreAndRecordAttemptResult, getAttemptResult } from '@/lib/exam-core/results.service';
import { requireOwnerOf } from '@/lib/exam-core/route-auth';
import { resetStudentExamFixtures } from '@/lib/exam-core/dev-fixture-reset';
import type { ExamItem } from '@/lib/exam-core/items';
import type { ExamNavState } from '@/lib/exam-core/navigation-state';

const DEV_FP = '2a29b99ee14a22b4';
const RUN = randomBytes(3).toString('hex');
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = '') => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  [' + detail + ']' : ''}`);
};
function guard() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV_FP && process.env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new Error(`REFUSING: not the DEV database (${fp})`);
  return fp;
}
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0]?.n ?? 0);
async function rejects(fn: () => Promise<unknown>, test: (e: any) => boolean = () => true): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return test(e);
  }
}
const code = (c: string) => (e: any) => e?.code === c;

async function identity(tag: string, role: 'STUDENT' | 'TEACHER' | 'PARENT') {
  const clerk = `tbp-${RUN}-${tag}`;
  const email = `prof-${tag}-${RUN}@trackb.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  const studentId = role === 'STUDENT' ? await upsertStudentFromWebhook(clerk, email, `Track B profile ${tag}`) : null;
  await assignSelfServiceRole(clerk, user.id, role);
  return { user, studentId: studentId as string };
}

function answerFor(item: ExamItem): string {
  const e = item.exam;
  if (e.parts) return JSON.stringify(Object.fromEntries(e.parts.map((p) => [p.id, p.answerFormat === 'math' ? p.math!.answers[0] : p.correctAnswer])));
  if (e.math) return e.math.answers[0];
  return item.correctAnswer ?? 'A';
}
async function answer(actor: string, simId: string, opts: { max?: number; finish: boolean }) {
  for (let i = 0; i < (opts.max ?? 80); i++) {
    const next = await getNextSimulationItem(actor, simId);
    if (next.outcome === 'BREAK') {
      await db.query(`UPDATE simulation_attempts SET navigation_state = jsonb_set(navigation_state, '{breakUntil}', 'null') WHERE id = $1`, [simId]);
      continue;
    }
    if (next.outcome !== 'ITEM_READY') break;
    const nav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).rows[0].navigation_state as ExamNavState;
    const r = await submitSimulationItemAnswer(actor, simId, answerFor(nav.items[String(next.targetIndex)].item!), `prof:${simId}:${next.targetIndex}`, next.targetIndex);
    if (r.done) break;
  }
  if (!opts.finish) return;
  await finalizeOpenItemsForSubmission(actor, simId);
  await completeSimulationAttempt(simId);
  await scoreAndRecordAttemptResult(simId);
}

/** Every NON-exam table with a student_id column: the learner's state, which removing a preparation must not touch. */
async function learnerStateSnapshot(studentId: string) {
  const exam = new Set(['student_exam_profiles', 'exam_instances', 'simulation_attempts', 'simulation_plans', 'exam_submissions', 'exam_item_usage', 'readiness_snapshots']);
  const tables = (await db.query(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'student_id' ORDER BY 1`)).rows.map((r: any) => r.table_name as string).filter((t) => !exam.has(t));
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = await count(`SELECT count(*) n FROM public."${t}" WHERE student_id = $1`, [studentId]);
  return out;
}

async function main() {
  console.log(`track-b exam profile scenarios -- db ${guard()} -- run ${RUN}`);
  const A = await identity('a', 'STUDENT');
  const B = await identity('b', 'STUDENT');
  const T = await identity('t', 'TEACHER');
  const P = await identity('p', 'PARENT');
  const lvl = (await resolveExamLevel('paa.practice.lectura.inferencia', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  const practice = (profileId: string) => createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: profileId, examVersionId: lvl.examVersionId, componentIds: lvl.components.map((c) => c.componentId), mode: 'PRACTICE', focusObjectiveIds: lvl.focusObjectiveIds });
  const legacy = (await db.query(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = 'dev-cert.paa'`)).rows[0];
  const icfes = (await db.query(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = 'dev-cert.icfes.saber11'`)).rows[0];

  // 1. No attempts
  const p1 = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: icfes.definition_id, examVersionId: icfes.version_id, examDate: '2027-05-01' });
  check('1.confirmation-required', await rejects(() => archiveExamProfile(p1.id, { ownerStudentId: A.studentId, confirm: false }), code('CONFIRMATION_REQUIRED')) && (await getStudentExamProfile(p1.id))?.status === 'ACTIVE');
  const r1 = await archiveExamProfile(p1.id, { ownerStudentId: A.studentId, confirm: true });
  check('1.remove-no-attempts', r1.status === 'ARCHIVED' && !r1.alreadyArchived && (await getStudentExamProfile(p1.id))?.status === 'ARCHIVED' && !!(await getStudentExamProfile(p1.id))?.archivedAt);
  check('7.disappears-from-dashboard', !(await listStudentExamProfiles(A.studentId)).some((p) => p.id === p1.id) && (await listStudentExamProfiles(A.studentId, { includeArchived: true })).some((p) => p.id === p1.id));

  // 2. READY exam (not started) is removed with the preparation
  const v2Profile = await ensureExamProfile(A.studentId, lvl.examDefinitionId, lvl.examVersionId);
  const ready = await practice(v2Profile);
  // 4-6 on the same preparation: one COMPLETED practice with consolidated evidence
  const done = await practice(v2Profile);
  const doneSim = (await startExamInstance(done.id, { language: 'es' })).simulationAttemptId!;
  await answer(A.user.id, doneSim, { finish: true });
  const doneEa = (await getSimulationAttempt(doneSim))!.examAttemptId;
  const subj = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, $2) RETURNING id`, [A.studentId, `tbp-${RUN} lectura`])).rows[0].id;
  const conc = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subj, `tbp-${RUN}-inferencia`])).rows[0].id;
  await updateMastery({
    studentId: A.studentId, conceptId: conc, subjectId: subj,
    evidence: { sourceType: 'EXAM_SIMULATION', result: 'correct', difficulty: 3, scorePercent: 100 },
    telemetry: { activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' },
    metadata: { context: { examAttemptId: doneEa, simulationSource: true } },
    identity: { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: `tbp-${RUN}-ev`, conceptId: conc },
  } as never);
  // 3. ... and one IN_PROGRESS practice
  const ip = await practice(v2Profile);
  const ipSim = (await startExamInstance(ip.id, { language: 'es' })).simulationAttemptId!;
  await answer(A.user.id, ipSim, { max: 1, finish: false });

  const before = { result: await getAttemptResult(doneEa), responses: await count(`SELECT count(*) n FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [doneEa]), state: await learnerStateSnapshot(A.studentId) };
  check('3.in-progress-needs-extra-confirmation', (await rejects(() => archiveExamProfile(v2Profile, { ownerStudentId: A.studentId, confirm: true }), code('IN_PROGRESS_CONFIRMATION_REQUIRED'))) && (await getStudentExamProfile(v2Profile))?.status === 'ACTIVE' && (await getSimulationAttempt(ipSim))?.status === 'ACTIVE' && (await getExamInstance(ready.id))?.status === 'READY');
  const r2 = await archiveExamProfile(v2Profile, { ownerStudentId: A.studentId, confirm: true, confirmInProgress: true });
  check('2.remove-with-READY', (await getExamInstance(ready.id))?.status === 'DELETED' && r2.removedNotStarted === 1, `removedNotStarted=${r2.removedNotStarted}`);
  check('3.remove-with-IN_PROGRESS', r2.cancelledAttempts === 1 && (await getSimulationAttempt(ipSim))?.status === 'ABANDONED' && (await isAttemptDeletedFromHistory(ipSim)) && (await rejects(() => getNextSimulationItem(A.user.id, ipSim))));
  const afterResult = await getAttemptResult(doneEa);
  check('4.remove-with-COMPLETED-keeps-results', r2.completedKept === 1 && afterResult?.status === 'SCORED' && afterResult.responseSetHash === before.result?.responseSetHash && (await count(`SELECT count(*) n FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [doneEa])) === before.responses && (await getSimulationAttempt(doneSim))?.status === 'COMPLETED' && !(await isAttemptDeletedFromHistory(doneSim)));
  const afterState = await learnerStateSnapshot(A.studentId);
  const changed = Object.keys(before.state).filter((k) => before.state[k] !== afterState[k]);
  check('5.completed-evidence-retained', before.state.learning_evidence >= 1 && afterState.learning_evidence === before.state.learning_evidence, `learning_evidence=${afterState.learning_evidence}`);
  check('6.learner-state-retained', changed.length === 0, changed.length ? `changed: ${changed.join(',')}` : `${Object.keys(afterState).length} learner tables unchanged`);

  // 8. The archived preparation no longer operates
  check('8.archived-cannot-start-simulation', await rejects(() => startSimulationAttempt({ studentId: A.studentId, examProfileId: v2Profile, examVersionId: lvl.examVersionId, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'es' }), (e) => e instanceof ExamProfileArchivedError));
  check('8.archived-cannot-create-exam', await rejects(() => practice(v2Profile), code('PROFILE_ARCHIVED')));

  // 9. Re-adding the same exam (Explorar exámenes) = a NEW clean active preparation
  const readded = await ensureExamProfile(A.studentId, lvl.examDefinitionId, lvl.examVersionId);
  check(
    '9.re-add-clean-profile',
    readded !== v2Profile && (await getStudentExamProfile(readded))?.status === 'ACTIVE' &&
      (await count(`SELECT count(*) n FROM simulation_attempts WHERE exam_profile_id = $1`, [readded])) === 0 &&
      (await count(`SELECT count(*) n FROM exam_instances WHERE exam_profile_id = $1`, [readded])) === 0
  );
  // A retake of the old completed exam goes to the ACTIVE preparation, never the archived one.
  const retake = await newInstanceFromExisting(done.id, { contentAudience: 'TECHNICAL_DEMO' });
  check('9.retake-uses-active-profile', retake.examProfileId === readded && retake.simulationAttemptId === null);

  // 10. At most one active profile per exam (parallel creates, raw duplicate insert)
  const [c1, c2, c3] = await Promise.all([1, 2, 3].map(() => createStudentExamProfile({ studentId: A.studentId, examDefinitionId: legacy.definition_id, examVersionId: legacy.version_id })));
  check('10.max-one-active', c1.id === c2.id && c2.id === c3.id && (await count(`SELECT count(*) n FROM student_exam_profiles WHERE student_id = $1 AND exam_definition_id = $2 AND status <> 'ARCHIVED'`, [A.studentId, legacy.definition_id])) === 1);
  check('10.db-rejects-duplicate', await rejects(() => db.query(`INSERT INTO student_exam_profiles (student_id, exam_definition_id) VALUES ($1, $2)`, [A.studentId, legacy.definition_id])));

  // Restart: legacy preparation with one completed and one in-progress simulation
  const lDone = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: c1.id, examVersionId: legacy.version_id, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'es' })).simulationAttempt.id;
  await answer(A.user.id, lDone, { finish: true });
  const lIp = (await startSimulationAttempt({ studentId: A.studentId, examProfileId: c1.id, examVersionId: legacy.version_id, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'es' })).simulationAttempt.id;
  await answer(A.user.id, lIp, { max: 1, finish: false });
  const lResult = await getAttemptResult((await getSimulationAttempt(lDone))!.examAttemptId);
  await db.query(`UPDATE student_exam_profiles SET purpose = 'Admisión universitaria', exam_date = '2027-04-10' WHERE id = $1`, [c1.id]);
  check('RESTART.in-progress-needs-extra-confirmation', await rejects(() => restartExamProfile(c1.id, { ownerStudentId: A.studentId, confirm: true }), code('IN_PROGRESS_CONFIRMATION_REQUIRED')));
  // 11. Double submit of restart (parallel): one new preparation, both calls get it
  const [rs1, rs2] = await Promise.all([1, 2].map(() => restartExamProfile(c1.id, { ownerStudentId: A.studentId, confirm: true, confirmInProgress: true })));
  const fresh = (await getStudentExamProfile(rs1.newProfileId))!;
  check('11.double-restart-one-new-profile', rs1.newProfileId === rs2.newProfileId && (await count(`SELECT count(*) n FROM student_exam_profiles WHERE student_id = $1 AND exam_definition_id = $2 AND status <> 'ARCHIVED'`, [A.studentId, legacy.definition_id])) === 1);
  check(
    'RESTART.archives-old-creates-clean',
    (await getStudentExamProfile(c1.id))?.status === 'ARCHIVED' && (await getStudentExamProfile(c1.id))?.replacedByProfileId === fresh.id && fresh.status === 'ACTIVE' &&
      fresh.purpose === 'Admisión universitaria' && String(fresh.examDate).startsWith('2027-04-10') &&
      (await count(`SELECT count(*) n FROM simulation_attempts WHERE exam_profile_id = $1`, [fresh.id])) === 0,
    `new ${fresh.id.slice(0, 8)}`
  );
  check('RESTART.history-kept-in-progress-cancelled', (await getAttemptResult((await getSimulationAttempt(lDone))!.examAttemptId))?.responseSetHash === lResult?.responseSetHash && (await getSimulationAttempt(lIp))?.status === 'ABANDONED');
  const rs3 = await restartExamProfile(c1.id, { ownerStudentId: A.studentId, confirm: true });
  check('11.restart-again-idempotent', rs3.alreadyRestarted && rs3.newProfileId === fresh.id);

  // 11. Double submit of remove (parallel) + a later repeat
  const [a1, a2] = await Promise.all([1, 2].map(() => archiveExamProfile(fresh.id, { ownerStudentId: A.studentId, confirm: true })));
  const a3 = await archiveExamProfile(fresh.id, { ownerStudentId: A.studentId, confirm: false });
  check('11.double-remove-idempotent', a1.status === 'ARCHIVED' && a2.status === 'ARCHIVED' && a3.alreadyArchived && (await getStudentExamProfile(fresh.id))?.status === 'ARCHIVED');

  // 12. Cross-user and other roles
  const p12 = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: icfes.definition_id, examVersionId: icfes.version_id });
  check('12.foreign-student-denied', (await rejects(() => archiveExamProfile(p12.id, { ownerStudentId: B.studentId, confirm: true }), code('NOT_FOUND'))) && (await rejects(() => restartExamProfile(p12.id, { ownerStudentId: B.studentId, confirm: true }), code('NOT_FOUND'))) && (await getStudentExamProfile(p12.id))?.status === 'ACTIVE');
  check('12.teacher-and-parent-not-owner', !(await requireOwnerOf(T.user.id, A.studentId)).ok && !(await requireOwnerOf(P.user.id, A.studentId)).ok && !(await requireOwnerOf(B.user.id, A.studentId)).ok && (await requireOwnerOf(A.user.id, A.studentId)).ok);
}

const childRefs = new Map<string, { t: string; c: string }[]>();
async function refsTo(table: string) {
  if (!childRefs.has(table)) {
    const rows = (await db.query(
      `SELECT conrelid::regclass::text AS t, a.attname AS c FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND confrelid::regclass::text = $1 AND array_length(con.conkey, 1) = 1 AND conrelid::regclass::text <> $1`,
      [table]
    )).rows as { t: string; c: string }[];
    childRefs.set(table, rows);
  }
  return childRefs.get(table)!;
}
async function deleteCascade(table: string, col: string, ids: string[], depth = 0): Promise<void> {
  if (ids.length === 0 || depth > 8) return;
  for (const ch of await refsTo(table)) {
    let rowIds: string[] = [];
    try {
      rowIds = (await db.query(`SELECT id::text AS id FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids])).rows.map((r: any) => r.id);
    } catch {
      rowIds = [];
    }
    await deleteCascade(ch.t, ch.c, rowIds, depth + 1);
  }
  await db.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1::text[])`, [ids]);
}

async function cleanup() {
  guard();
  const ids = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows.map((r: any) => r.id as string);
  const userIds = await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`tbp-${RUN}-%`]);
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`tbp-${RUN}-%`]);
  for (let pass = 0; pass < 4; pass++) {
    try {
      for (const sid of studentIds) await resetStudentExamFixtures({ studentId: sid, confirm: 'RESET-DEV-FIXTURES' }).catch(() => undefined);
      await db.query(`UPDATE student_exam_profiles SET replaced_by_profile_id = NULL WHERE student_id = ANY($1::uuid[])`, [studentIds]);
      await deleteCascade('student_exam_profiles', 'student_id', studentIds);
      await deleteCascade('learning_evidence', 'student_id', studentIds);
      await deleteCascade('subjects', 'student_id', studentIds);
      await db.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])`, [userIds, userIds]);
      await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await deleteCascade('students', 'id', studentIds);
      await deleteCascade('profiles', 'user_id', userIds);
      await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      break;
    } catch (e) {
      if (pass === 3) throw e;
    }
  }
  const left = (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id LIKE $1`, [`tbp-${RUN}-%`])) + (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id LIKE $1`, [`tbp-${RUN}-%`]));
  check('CLEANUP.no-fixtures-left', left === 0, `remaining=${left}`);
}

main()
  .catch((e) => check('RUN.error', false, e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
  .then(() => cleanup().catch((e) => check('CLEANUP.error', false, e instanceof Error ? e.message : String(e))))
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    for (const f of failed) console.log(`FAILED: ${f.id} ${f.detail}`);
    await (db as any).end?.();
    process.exitCode = failed.length ? 1 : 0;
  });
