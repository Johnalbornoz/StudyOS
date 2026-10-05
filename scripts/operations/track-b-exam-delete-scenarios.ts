/**
 * Exam history delete -- DEV scenarios with the REAL services against the REAL
 * DEV database (or an ephemeral cert database). Covers both kinds of history
 * row: an Exam V2 instance (PAA skill practice, fast) and a pre-V2 Exam Prep
 * attempt (dev-cert.paa MINI_MOCK, no instance).
 *
 *   1 delete READY            6 result audit retained
 *   2 delete DRAFT            7 new attempt = fresh ids, from zero
 *   3 cancel IN_PROGRESS      8 foreign Student denied
 *   4 soft-delete COMPLETED   9 double delete safe
 *   5 evidence retained      10 deleted rows absent from the normal history
 *
 * DEV ONLY (fingerprint guard). Fixtures (`tbd-<run>-…`, `@trackb.test`) are
 * removed at the end.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-exam-delete-scenarios.ts
 */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { getOrCreateCanonicalUser, assignSelfServiceRole } from '@/lib/identity';
import { upsertStudentFromWebhook } from '@/lib/auth';
import { updateMastery } from '@/services/mastery.service';
import { resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createExamInstance, startExamInstance, deleteExamInstance, newInstanceFromExisting, getExamInstance, ensureExamProfile, ExamInstanceError, listExamInstances } from '@/lib/exam-core/exam-instance.service';
import { deleteAttemptFromHistory, isAttemptDeletedFromHistory } from '@/lib/exam-core/history.service';
import { listProfileAttempts } from '@/lib/exam-core/catalog.service';
import { createStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import { getNextSimulationItem, submitSimulationItemAnswer, finalizeOpenItemsForSubmission } from '@/lib/simulation/item-resolution.service';
import { startSimulationAttempt, completeSimulationAttempt, getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { scoreAndRecordAttemptResult, getAttemptResult } from '@/lib/exam-core/results.service';
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
async function rejects(fn: () => Promise<unknown>, code?: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return !code || (e as any).code === code;
  }
}

async function student(tag: string) {
  const clerk = `tbd-${RUN}-${tag}`;
  const email = `del-${tag}-${RUN}@trackb.test`;
  const user = await getOrCreateCanonicalUser(clerk, email);
  const studentId = await upsertStudentFromWebhook(clerk, email, `Track B delete ${tag}`);
  await assignSelfServiceRole(clerk, user.id, 'STUDENT');
  return { user, studentId };
}

function answerFor(item: ExamItem): string {
  const e = item.exam;
  if (e.parts) return JSON.stringify(Object.fromEntries(e.parts.map((p) => [p.id, p.answerFormat === 'math' ? p.math!.answers[0] : p.correctAnswer])));
  if (e.math) return e.math.answers[0];
  return item.correctAnswer ?? 'A';
}
async function serverItem(simId: string, index: number): Promise<ExamItem | undefined> {
  const nav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [simId])).rows[0]?.navigation_state as ExamNavState;
  return nav?.items?.[String(index)]?.item;
}
/** Answers `max` items (all when omitted), then optionally hands in and scores. */
async function answer(actor: string, simId: string, opts: { max?: number; finish: boolean }) {
  for (let i = 0; i < (opts.max ?? 80); i++) {
    const next = await getNextSimulationItem(actor, simId);
    if (next.outcome === 'BREAK') {
      await db.query(`UPDATE simulation_attempts SET navigation_state = jsonb_set(navigation_state, '{breakUntil}', 'null') WHERE id = $1`, [simId]);
      continue;
    }
    if (next.outcome !== 'ITEM_READY') break;
    const item = (await serverItem(simId, next.targetIndex))!;
    const r = await submitSimulationItemAnswer(actor, simId, answerFor(item), `del:${simId}:${next.targetIndex}`, next.targetIndex);
    if (r.done) break;
  }
  if (!opts.finish) return null;
  await finalizeOpenItemsForSubmission(actor, simId);
  await completeSimulationAttempt(simId);
  return scoreAndRecordAttemptResult(simId);
}
const responsesOf = (examAttemptId: string) => count(`SELECT count(*) n FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [examAttemptId]);
const evidenceOf = (studentId: string, examAttemptId: string) => count(`SELECT count(*) n FROM learning_evidence WHERE student_id = $1 AND metadata->'context'->>'examAttemptId' = $2`, [studentId, examAttemptId]);

/** Consolidated evidence for an attempt, written through the REAL evidence writer (as the earlier V2 scenario does). */
async function seedEvidence(studentId: string, examAttemptId: string, tag: string) {
  const subj = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, $2) RETURNING id`, [studentId, `tbd-${RUN} ${tag}`])).rows[0].id;
  const conc = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subj, `tbd-${RUN}-${tag}`])).rows[0].id;
  await updateMastery({
    studentId, conceptId: conc, subjectId: subj,
    evidence: { sourceType: 'EXAM_SIMULATION', result: 'correct', difficulty: 3, scorePercent: 100 },
    telemetry: { activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' },
    metadata: { context: { examAttemptId, simulationSource: true } },
    identity: { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: `tbd-${RUN}-${tag}`, conceptId: conc },
  } as never);
}

async function main() {
  console.log(`track-b exam delete scenarios -- db ${guard()} -- run ${RUN}`);
  const A = await student('a');
  const B = await student('b');

  // ---------------- Exam V2 instances (PAA skill practice: Lectura -> Inferencias) ----------------
  const lvl = (await resolveExamLevel('paa.practice.lectura.inferencia', 'es', { audience: 'TECHNICAL_DEMO' }))!;
  const profileId = await ensureExamProfile(A.studentId, lvl.examDefinitionId, lvl.examVersionId);
  const make = () => createExamInstance({ contentAudience: 'TECHNICAL_DEMO', studentId: A.studentId, examProfileId: profileId, examVersionId: lvl.examVersionId, componentIds: lvl.components.map((c) => c.componentId), mode: 'PRACTICE', focusObjectiveIds: lvl.focusObjectiveIds });

  // 1. READY
  const ready = await make();
  const d1 = await deleteExamInstance(ready.id, { confirm: false, ownerStudentId: A.studentId });
  check('1.delete-READY', ready.status === 'READY' && d1.instance.status === 'DELETED');

  // 2. DRAFT (no service creates DRAFT today; the row is put in that state to exercise the contract)
  const draft = await make();
  await db.query(`UPDATE exam_instances SET status = 'DRAFT' WHERE id = $1`, [draft.id]);
  const d2 = await deleteExamInstance(draft.id, { confirm: false, ownerStudentId: A.studentId });
  check('2.delete-DRAFT', d2.instance.status === 'DELETED');

  // 3. IN_PROGRESS -> cancelled, never resumable
  const ip = await make();
  const ipSim = (await startExamInstance(ip.id, { language: 'es' })).simulationAttemptId!;
  await answer(A.user.id, ipSim, { max: 1, finish: false });
  check('3.in-progress-needs-confirmation', await rejects(() => deleteAttemptFromHistory(ipSim, { confirm: false, ownerStudentId: A.studentId }), 'CONFIRMATION_REQUIRED'));
  const d3 = await deleteAttemptFromHistory(ipSim, { confirm: true, ownerStudentId: A.studentId });
  check('3.cancel-IN_PROGRESS', d3.attemptAbandoned && (await getExamInstance(ip.id))?.status === 'DELETED' && (await getSimulationAttempt(ipSim))?.status === 'ABANDONED');
  check('3.deleted-cannot-resume', await rejects(() => getNextSimulationItem(A.user.id, ipSim)));

  // 4-6. COMPLETED -> soft delete; result, responses and evidence retained
  const done = await make();
  const doneSim = (await startExamInstance(done.id, { language: 'es' })).simulationAttemptId!;
  await answer(A.user.id, doneSim, { finish: true });
  const doneEa = (await getSimulationAttempt(doneSim))!.examAttemptId;
  await seedEvidence(A.studentId, doneEa, 'v2');
  const before = { result: await getAttemptResult(doneEa), responses: await responsesOf(doneEa), evidence: await evidenceOf(A.studentId, doneEa), mastery: await count(`SELECT count(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId]) };
  check('4.completed-needs-confirmation', await rejects(() => deleteAttemptFromHistory(doneSim, { confirm: false, ownerStudentId: A.studentId }), 'CONFIRMATION_REQUIRED'));
  const d4 = await deleteAttemptFromHistory(doneSim, { confirm: true, ownerStudentId: A.studentId });
  const afterResult = await getAttemptResult(doneEa);
  check('4.soft-delete-COMPLETED', d4.resultPreserved && !d4.attemptAbandoned && (await getExamInstance(done.id))?.status === 'DELETED' && (await getSimulationAttempt(doneSim))?.status === 'COMPLETED');
  check('5.completed-evidence-retained', before.evidence >= 1 && (await evidenceOf(A.studentId, doneEa)) === before.evidence && (await count(`SELECT count(*) n FROM learning_evidence WHERE student_id = $1`, [A.studentId])) === before.mastery, `evidence=${before.evidence}`);
  check('6.result-audit-retained', afterResult?.status === 'SCORED' && afterResult.responseSetHash === before.result?.responseSetHash && afterResult.rawScore === before.result?.rawScore && (await responsesOf(doneEa)) === before.responses && before.responses > 0, `${afterResult?.rawScore}/${afterResult?.maxScore} responses=${before.responses}`);

  // 7. New attempt from zero = fresh ids
  const again = await newInstanceFromExisting(done.id, { contentAudience: 'TECHNICAL_DEMO' });
  const againSim = (await startExamInstance(again.id, { language: 'es' })).simulationAttemptId!;
  const againEa = (await getSimulationAttempt(againSim))!.examAttemptId;
  const nav = (await db.query(`SELECT navigation_state FROM simulation_attempts WHERE id = $1`, [againSim])).rows[0].navigation_state as ExamNavState;
  check('7.new-attempt-fresh-ids', again.id !== done.id && againSim !== doneSim && againEa !== doneEa && (await responsesOf(againEa)) === 0 && Object.values(nav.items).every((x) => !x.draft && x.status !== 'ANSWERED'));
  await deleteAttemptFromHistory(againSim, { confirm: true, ownerStudentId: A.studentId });

  // ---------------- Pre-V2 Exam Prep attempts (no instance) ----------------
  const legacy = (await db.query(`SELECT d.id AS definition_id, v.id AS version_id FROM exam_definitions d JOIN exam_versions v ON v.exam_definition_id = d.id AND v.status = 'PUBLISHED' WHERE d.config_key = 'dev-cert.paa'`)).rows[0];
  const legacyProfile = await createStudentExamProfile({ studentId: A.studentId, examDefinitionId: legacy.definition_id, examVersionId: legacy.version_id });
  const startLegacy = async () => (await startSimulationAttempt({ studentId: A.studentId, examProfileId: legacyProfile.id, examVersionId: legacy.version_id, simulationType: 'MINI_MOCK', timingMode: 'UNTIMED', language: 'es' })).simulationAttempt.id;

  const lDone = await startLegacy();
  await answer(A.user.id, lDone, { finish: true });
  const lEa = (await getSimulationAttempt(lDone))!.examAttemptId;
  await seedEvidence(A.studentId, lEa, 'legacy');
  const lBefore = { result: await getAttemptResult(lEa), responses: await responsesOf(lEa), evidence: await evidenceOf(A.studentId, lEa) };
  const ld = await deleteAttemptFromHistory(lDone, { confirm: true, ownerStudentId: A.studentId });
  const lAfter = await getAttemptResult(lEa);
  check('4.legacy-soft-delete-COMPLETED', ld.resultPreserved && (await isAttemptDeletedFromHistory(lDone)) && (await getSimulationAttempt(lDone))?.status === 'COMPLETED');
  check('5.legacy-evidence-retained', lBefore.evidence >= 1 && (await evidenceOf(A.studentId, lEa)) === lBefore.evidence);
  check('6.legacy-result-audit-retained', lAfter?.status === 'SCORED' && lAfter.responseSetHash === lBefore.result?.responseSetHash && (await responsesOf(lEa)) === lBefore.responses && lBefore.responses > 0);

  const lIp = await startLegacy();
  await answer(A.user.id, lIp, { max: 1, finish: false });
  const lid = await deleteAttemptFromHistory(lIp, { confirm: true, ownerStudentId: A.studentId });
  check('3.legacy-cancel-IN_PROGRESS', lid.attemptAbandoned && (await getSimulationAttempt(lIp))?.status === 'ABANDONED' && (await isAttemptDeletedFromHistory(lIp)));
  check('3.legacy-deleted-cannot-resume', await rejects(() => getNextSimulationItem(A.user.id, lIp)));
  const lNew = await startLegacy();
  check('7.legacy-new-attempt-fresh-ids', lNew !== lIp && lNew !== lDone && (await responsesOf((await getSimulationAttempt(lNew))!.examAttemptId)) === 0);

  // 8. Foreign Student denied (service level; the HTTP route answers 404 -- unit tests)
  check('8.foreign-history-delete-denied', (await rejects(() => deleteAttemptFromHistory(lNew, { confirm: true, ownerStudentId: B.studentId }), 'NOT_FOUND')) && (await getSimulationAttempt(lNew))?.status === 'ACTIVE' && !(await isAttemptDeletedFromHistory(lNew)));
  const fresh = await make();
  check('8.foreign-instance-delete-denied', (await rejects(() => deleteExamInstance(fresh.id, { confirm: true, ownerStudentId: B.studentId }), 'NOT_FOUND')) && (await getExamInstance(fresh.id))?.status === 'READY');

  // 9. Double delete safe (same outcome, nothing changes)
  const twice1 = await deleteAttemptFromHistory(doneSim, { confirm: true, ownerStudentId: A.studentId });
  const twice2 = await deleteAttemptFromHistory(lDone, { confirm: false, ownerStudentId: A.studentId });
  const twice3 = await deleteExamInstance(ready.id, { confirm: false, ownerStudentId: A.studentId });
  check('9.double-delete-safe', twice1.alreadyDeleted && twice1.resultPreserved && twice2.alreadyDeleted && twice3.instance.status === 'DELETED' && (await getAttemptResult(doneEa))?.responseSetHash === before.result?.responseSetHash);

  // 10. Absent from the normal history
  const visibleInstances = (await listExamInstances(A.studentId, undefined, { includeTechnicalDemo: true })).map((i) => i.id);
  const v2History = (await listProfileAttempts(profileId)).map((a) => a.id);
  const legacyHistory = (await listProfileAttempts(legacyProfile.id)).map((a) => a.id);
  check(
    '10.deleted-absent-from-history',
    [ready.id, draft.id, ip.id, done.id, again.id].every((id) => !visibleInstances.includes(id)) &&
      [ipSim, doneSim, againSim].every((id) => !v2History.includes(id)) &&
      [lDone, lIp].every((id) => !legacyHistory.includes(id)) &&
      legacyHistory.includes(lNew) && visibleInstances.includes(fresh.id),
    `visible instances=${visibleInstances.length} legacy history=${legacyHistory.length}`
  );
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
  const userIds = await ids(`SELECT id FROM users WHERE clerk_id LIKE $1`, [`tbd-${RUN}-%`]);
  const studentIds = await ids(`SELECT id FROM students WHERE clerk_id LIKE $1`, [`tbd-${RUN}-%`]);
  for (let pass = 0; pass < 4; pass++) {
    try {
      for (const sid of studentIds) await resetStudentExamFixtures({ studentId: sid, confirm: 'RESET-DEV-FIXTURES' }).catch(() => undefined);
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
  const left = (await count(`SELECT COUNT(*) n FROM users WHERE clerk_id LIKE $1`, [`tbd-${RUN}-%`])) + (await count(`SELECT COUNT(*) n FROM students WHERE clerk_id LIKE $1`, [`tbd-${RUN}-%`]));
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
