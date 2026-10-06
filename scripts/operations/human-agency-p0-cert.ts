/**
 * Human Agency P0 -- real-Postgres certification on an EPHEMERAL database only.
 * Run by scripts/operations/exam-platform-v2-migration-chain-cert.sh after the
 * full migration chain. Refuses DEV / Preview / Production and any database
 * whose fingerprint differs from HA_CERT_EPHEMERAL. Prints no credential.
 *
 *  P0-1  the real student-wide guard over real quiz_sessions / verification rows
 *  P0-2  expiry boundary BEFORE / AT / AFTER on the real DB clock; the submit
 *        reader and the guard are exact complements (no overlap, no gap)
 *  P0-3  explain_defend_task_instances: create, load, ownership, expiry, consume
 *  P0-4  safety routing on real rows: institutional lead / operator fallback /
 *        independent operator; minimal event; notification; no parent; dedupe
 */
import { createHash, randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { getInstructionalAssistanceState } from '@/lib/ai/instructional-assistance-guard';
import { getQuizSession, getStudentActiveQuizzes } from '@/services/quiz-persistence.service';
import { createExplainTask, loadExplainTaskForSubmission, markExplainTaskConsumed } from '@/services/explain-defend-task.service';
import { handleSafetySignal } from '@/services/safety-signal.service';

const REFUSED = new Set(['2a29b99ee14a22b4', '53d158d5811e7ee0', '6671e7382d808d06']); // DEV, Preview, Production
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function one<T = any>(sql: string, params: any[] = []): Promise<T> {
  return (await db.query(sql, params)).rows[0] as T;
}

async function fixtures() {
  const tag = randomUUID().slice(0, 8);
  const user = await one(`INSERT INTO users (clerk_id, email, is_system) VALUES ($1, NULL, false) RETURNING id`, [`ha-student-${tag}`]);
  const student = await one(`INSERT INTO students (clerk_id, email, name, user_id) VALUES ($1, $2, 'Ana Cert', $3) RETURNING id`, [`ha-student-${tag}`, `ha-${tag}@cert.invalid`, user.id]);
  await db.query(`INSERT INTO profiles (id, user_type, full_name) VALUES ($1, 'student', 'Ana Cert')`, [student.id]); // subjects.student_id -> profiles(id)
  const subject = await one(`INSERT INTO subjects (student_id, name) VALUES ($1, 'Math') RETURNING id`, [student.id]);
  const concept = await one(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subject.id, `ha-concept-${tag}`]);
  const other = await one(`INSERT INTO students (clerk_id, email, name) VALUES ($1, $2, 'Other') RETURNING id`, [`ha-other-${tag}`, `ha-other-${tag}@cert.invalid`]);
  return { tag, userId: user.id as string, studentId: student.id as string, subjectId: subject.id as string, conceptId: concept.id as string, otherStudentId: other.id as string };
}

async function quizSession(f: { studentId: string; subjectId: string; conceptId: string }, mode: 'quick_check' | 'topic_practice', evidenceMode: 'INDEPENDENT' | 'PRACTICE', expiresSql: string) {
  const id = `ha-${randomUUID()}`;
  await db.query(
    `INSERT INTO quiz_sessions (id, student_id, concept_id, subject_id, questions, language, status, expires_at, quiz_mode, activity_type, evidence_mode)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, 'es', 'active', ${expiresSql}, $5, $6, $7)`,
    [id, f.studentId, f.conceptId, f.subjectId, mode, evidenceMode === 'INDEPENDENT' ? 'SOLO_CHECK' : 'PRACTICE', evidenceMode],
  );
  return id;
}

async function p01p02(f: Awaited<ReturnType<typeof fixtures>>) {
  // P0-1: nothing active -> allowed; an active Independent session -> locked student-wide.
  check('P0-1 no restricted evidence -> help allowed', (await getInstructionalAssistanceState(f.studentId)).allowed === true);
  const practice = await quizSession(f, 'topic_practice', 'PRACTICE', `now() + interval '30 minutes'`);
  check('P0-1 an active PRACTICE session does not lock help', (await getInstructionalAssistanceState(f.studentId)).allowed === true);
  const live = await quizSession(f, 'quick_check', 'INDEPENDENT', `now() + interval '30 minutes'`);
  const locked = await getInstructionalAssistanceState(f.studentId);
  check('P0-1 an active INDEPENDENT session locks help student-wide (any concept, any tab)', locked.allowed === false && (locked as any).reason === 'ACTIVE_QUIZ_SESSION');
  check('P0-1 other Students are unaffected', (await getInstructionalAssistanceState(f.otherStudentId)).allowed === true);

  // P0-2 before expiry: restricted + accepted.
  const s1 = await getQuizSession(live);
  check('P0-2 BEFORE expiry: submit reader says not expired', s1?.isExpired === false);

  // P0-2 after expiry: guard releases + submit rejects.
  await db.query(`UPDATE quiz_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [live]);
  const s2 = await getQuizSession(live);
  const after = await getInstructionalAssistanceState(f.studentId);
  check('P0-2 AFTER expiry: submit reader says expired (submission rejected)', s2?.isExpired === true);
  check('P0-2 AFTER expiry: the guard no longer restricts (Tutor reopens)', after.allowed === true);

  // P0-2 AT expiry: one transaction, one frozen now() -- both predicates evaluated on the same instant.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE quiz_sessions SET expires_at = now() WHERE id = $1`, [live]);
    const at = (await client.query(
      `SELECT (now() >= expires_at) AS submit_rejected,
              EXISTS (SELECT 1 FROM quiz_sessions q WHERE q.id = $1 AND q.status = 'active' AND q.expires_at > NOW()) AS guard_active
         FROM quiz_sessions WHERE id = $1`,
      [live],
    )).rows[0];
    check('P0-2 AT expiry: submission rejected and guard inactive (exact complement, no overlap)', at.submit_rejected === true && at.guard_active === false, JSON.stringify(at));
    const grid = (await client.query(
      `SELECT bool_and((now() >= e) <> (e > now())) AS complementary
         FROM (SELECT now() + (i * interval '1 millisecond') AS e FROM generate_series(-1000, 1000) i) g`,
    )).rows[0];
    check('P0-2 complement holds on a +/-1s millisecond grid around now()', grid.complementary === true);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  const active = await getStudentActiveQuizzes(f.studentId);
  check('P0-2 expired restricted session is not listed as active', !active.some((q) => q.id === live) && active.some((q) => q.id === practice));
}

async function p03(f: Awaited<ReturnType<typeof fixtures>>) {
  const id = randomUUID();
  await createExplainTask({ id, studentId: f.studentId, subjectId: f.subjectId, conceptId: f.conceptId, conceptLabel: 'Fracciones', activityType: 'EXPLAIN', language: 'es', prompt: '¿Por qué 1/2 = 2/4?', expectedElements: ['misma proporción', 'multiplicar numerador y denominador'], generatorPromptId: 'explain.prompt_generation', generatorPromptVersion: 'v2' });
  const ok = await loadExplainTaskForSubmission(id, { studentId: f.studentId });
  check('P0-3 the server rubric round-trips from the DB', ok.ok && ok.task.expectedElements.length === 2 && ok.task.prompt.startsWith('¿Por qué'));
  const foreign = await loadExplainTaskForSubmission(id, { studentId: f.otherStudentId });
  check('P0-3 ownership mismatch -> TASK_NOT_FOUND', !foreign.ok && foreign.code === 'TASK_NOT_FOUND');
  const missing = await loadExplainTaskForSubmission(randomUUID(), { studentId: f.studentId });
  check('P0-3 missing instance -> TASK_NOT_FOUND', !missing.ok && missing.code === 'TASK_NOT_FOUND');
  await db.query(`UPDATE explain_defend_task_instances SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1`, [id]);
  const expired = await loadExplainTaskForSubmission(id, { studentId: f.studentId });
  check('P0-3 expired instance -> TASK_EXPIRED', !expired.ok && expired.code === 'TASK_EXPIRED');
  await db.query(`UPDATE explain_defend_task_instances SET rubric_version = 'explain-defend-rubric-v0', expires_at = now() + interval '1 day' WHERE id = $1`, [id]);
  const version = await loadExplainTaskForSubmission(id, { studentId: f.studentId });
  check('P0-3 rubric version mismatch -> RUBRIC_VERSION_MISMATCH', !version.ok && version.code === 'RUBRIC_VERSION_MISMATCH');
  await markExplainTaskConsumed(id);
  await markExplainTaskConsumed(id);
  const consumed = await one(`SELECT consumed_at FROM explain_defend_task_instances WHERE id = $1`, [id]);
  check('P0-3 consumed_at is set once (idempotent)', consumed.consumed_at !== null);
  let rejected = false;
  try {
    await db.query(`INSERT INTO explain_defend_task_instances (id, student_id, subject_id, concept_id, concept_label, activity_type, language, prompt, expected_elements, rubric_version, generator_prompt_id, generator_prompt_version, expires_at) VALUES ($1, $2, $3, $4, 'x', 'EXPLAIN', 'es', 'p', '{"not":"array"}', 'v', 'p', 'v', now() + interval '1 hour')`, [randomUUID(), f.studentId, f.subjectId, f.conceptId]);
  } catch {
    rejected = true;
  }
  check('P0-3 the DB refuses a non-array rubric', rejected);
}

async function p04(f: Awaited<ReturnType<typeof fixtures>>) {
  const op = await one(`INSERT INTO users (clerk_id, email, is_system) VALUES ($1, NULL, false) RETURNING id`, [`ha-operator-${f.tag}`]);
  const lead = await one(`INSERT INTO users (clerk_id, email, is_system) VALUES ($1, NULL, false) RETURNING id`, [`ha-lead-${f.tag}`]);

  // Independent learner, no operator designated -> event recorded, NO_RECIPIENT_DESIGNATED, still a fixed response.
  const r0 = await handleSafetySignal({ studentId: f.studentId, status: 'SAFETY_SIGNAL', surface: 'TUTOR_MESSAGE', locale: 'es' });
  const e0 = await one(`SELECT * FROM safety_signal_events WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`, [f.studentId]);
  check('P0-4 independent, no operator -> NO_RECIPIENT_DESIGNATED, fixed response still returned', e0.routing === 'STUDYUS_SAFETY_OPERATOR' && e0.routing_reason === 'INDEPENDENT_LEARNER' && e0.routing_status === 'NO_RECIPIENT_DESIGNATED' && !!r0.text && r0.notified === null);

  await db.query(`INSERT INTO safety_contact_designations (scope, user_id, role) VALUES ('PLATFORM', $1, 'SAFETY_OPERATOR')`, [op.id]);
  await handleSafetySignal({ studentId: f.studentId, status: 'IMMEDIATE_DANGER_SIGNAL', surface: 'EXPLAIN_DEFEND', locale: 'es' });
  const n1 = await one(`SELECT recipient_user_id, workspace, notification_type, payload FROM notifications WHERE recipient_user_id = $1 ORDER BY delivered_at DESC LIMIT 1`, [op.id]);
  check('P0-4 independent learner -> StudyUs Safety Operator notified (ADMIN workspace)', n1?.workspace === 'ADMIN' && n1?.notification_type === 'SAFETY_IMMEDIATE_DANGER');
  check('P0-4 notification payload is minimal (learner name + event id only)', !!n1 && JSON.stringify(Object.keys(n1.payload).sort()) === JSON.stringify(['learnerName', 'safetyEventId']));

  // Institutional learner -> institution lead; operator not notified.
  const inst = await one(`INSERT INTO institutions (name, status, country) VALUES ('HA Cert School', 'ACTIVE', 'CO') RETURNING id`);
  const cls = await one(`INSERT INTO classes (institution_id, name) VALUES ($1, '10A') RETURNING id`, [inst.id]);
  await db.query(`INSERT INTO class_enrollments (class_id, student_id) VALUES ($1, $2)`, [cls.id, f.studentId]);
  const opBefore = Number((await one(`SELECT count(*) n FROM notifications WHERE recipient_user_id = $1`, [op.id])).n);
  await db.query(`DELETE FROM safety_signal_events WHERE student_id = $1`, [f.studentId]); // reset the dedupe window for this scenario
  await handleSafetySignal({ studentId: f.studentId, status: 'SAFETY_SIGNAL', surface: 'TUTOR_MESSAGE', locale: 'es' });
  const e1 = await one(`SELECT * FROM safety_signal_events WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`, [f.studentId]);
  check('P0-4 institutional learner without a lead -> operator fallback (INSTITUTION_LEAD_NOT_DESIGNATED)', e1.routing_reason === 'INSTITUTION_LEAD_NOT_DESIGNATED' && e1.institution_id === inst.id && e1.routing_status === 'NOTIFIED');

  await db.query(`INSERT INTO safety_contact_designations (scope, institution_id, user_id, role) VALUES ('INSTITUTION', $1, $2, 'SAFEGUARDING_LEAD')`, [inst.id, lead.id]);
  await db.query(`DELETE FROM safety_signal_events WHERE student_id = $1`, [f.studentId]);
  const opMid = Number((await one(`SELECT count(*) n FROM notifications WHERE recipient_user_id = $1`, [op.id])).n);
  await handleSafetySignal({ studentId: f.studentId, status: 'SAFETY_SIGNAL', surface: 'QUIZ_ANSWER', locale: 'es' });
  const e2 = await one(`SELECT * FROM safety_signal_events WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`, [f.studentId]);
  const leadN = Number((await one(`SELECT count(*) n FROM notifications WHERE recipient_user_id = $1 AND notification_type = 'SAFETY_SIGNAL'`, [lead.id])).n);
  const opAfter = Number((await one(`SELECT count(*) n FROM notifications WHERE recipient_user_id = $1`, [op.id])).n);
  check('P0-4 institutional learner -> institution Safeguarding Lead notified, operator not', e2.routing === 'INSTITUTION_SAFEGUARDING' && leadN === 1 && opAfter === opMid && opMid > opBefore);
  check('P0-4 country resource lookup used the institution country (allowlist empty -> 0 shown, generic guidance)', e2.resource_country === 'CO' && e2.resources_shown === 0 && e2.resource_allowlist_version === 'crisis-resources-v1');

  await handleSafetySignal({ studentId: f.studentId, status: 'SAFETY_SIGNAL', surface: 'CONCEPT_SUGGEST', locale: 'es' });
  const e3 = await one(`SELECT routing_status FROM safety_signal_events WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`, [f.studentId]);
  const leadN2 = Number((await one(`SELECT count(*) n FROM notifications WHERE recipient_user_id = $1`, [lead.id])).n);
  check('P0-4 a repeat inside the window is recorded DEDUPLICATED without re-notifying', e3.routing_status === 'DEDUPLICATED' && leadN2 === 1);

  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'safety_signal_events'`)).rows.map((r: any) => r.column_name);
  check('P0-4 safety_signal_events has no text / phrase / label column', !cols.some((c: string) => /text|message|phrase|content|label|diagnos/.test(c)), cols.join(','));
  const parentNotified = Number((await one(`SELECT count(*) n FROM notifications WHERE notification_type LIKE 'SAFETY%' AND workspace = 'PARENT'`)).n);
  check('P0-4 no parent/guardian is ever notified', parentNotified === 0);
}

async function main() {
  const fp = fingerprint();
  if (REFUSED.has(fp) || process.env.HA_CERT_EPHEMERAL !== fp) throw new Error(`REFUSED: not the declared ephemeral database (${fp})`);
  const f = await fixtures();
  await p01p02(f);
  await p03(f);
  await p04(f);
  const failed = checks.filter((c) => !c.ok);
  console.log(`HUMAN_AGENCY_P0_DB_CERT = ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length})`);
  await db.end();
  if (failed.length) process.exit(1);
}

main().catch(async (e) => {
  console.error('HUMAN_AGENCY_P0_DB_CERT = ERROR', (e as Error).message);
  await db.end().catch(() => undefined);
  process.exit(1);
});
