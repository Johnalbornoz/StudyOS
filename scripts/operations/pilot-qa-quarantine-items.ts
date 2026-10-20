/**
 * P1-03 -- governed quarantine of Learning items that fail item validation, on the PILOT CANDIDATE only.
 *
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-quarantine-items.ts plan
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-quarantine-items.ts quarantine --expect <n> --apply
 *
 * `plan` (the default, read-only) runs the deterministic choice-item validator
 * (src/lib/lx/choice-item-validator.ts -- the same check every Learning delivery path now applies) over:
 *   1. question_bank_candidates   VALIDATED                      -> would become validation_status = 'REJECTED'
 *   2. canonical_prepared_activity READY / PREPARING             -> would become status = 'INVALIDATED' (failure_reason PILOT_QA_ITEM_INVALID)
 *      (a set is invalid when any of its questions fails, or any of its candidate_ids is a candidate being rejected)
 *   3. quiz_sessions learn_guided 'active' whose PENDING interaction fails -> would become status = 'expired'
 *      (the same mechanism the guided service uses for an unusable resumable session)
 * and reports, without any write, the already-closed sessions that delivered a failing item (evidence only).
 *
 * `quarantine` writes only with `--apply` AND `--expect <n>` equal to the number of rows the plan targets.
 * Guards: database fingerprint is the pilot candidate's (4baac799b9bd2a6a); ONE transaction; the plan is
 * recomputed inside the transaction under row locks; every UPDATE's row count must equal the plan
 * (fail closed: ROLLBACK otherwise); one admin_audit_log row per changed row (actor = the QA admin identity,
 * action LEARNING_ITEM_QUARANTINED, previous and new state). Nothing is ever deleted.
 */
import { createHash } from 'crypto';
import { db, type DbExecutor } from '@/lib/db';
import { validateChoiceItem, type ChoiceItemFailure } from '@/lib/lx/choice-item-validator';
import { recordAdminAction } from '@/lib/admin/audit';

export const CANDIDATE_FP = '4baac799b9bd2a6a';
export const QA_ADMIN_EMAIL = 'studyus-qa-admin+clerk_test@example.com';
const REASON = 'PILOT_QA_ITEM_INVALID';

export function dbFingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

function assertCandidate(): void {
  if (dbFingerprint() !== CANDIDATE_FP) throw new Error(`REFUSING: database is not the pilot candidate (${dbFingerprint()})`);
}

type Failure = Pick<ChoiceItemFailure, 'code' | 'detail'>;
const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
const failuresOf = (q: unknown): Failure[] => validateChoiceItem(q as never).failures;
const short = (id: string) => id.slice(0, 8);

export interface QuarantinePlan {
  candidates: Array<{ id: string; studentId: string; conceptId: string; activityType: string; question: string; failures: Failure[] }>;
  preparedActivities: Array<{ id: string; stage: string; status: string; reason: string }>;
  activeLearnSessions: Array<{ id: string; pendingIndex: number; failures: Failure[] }>;
  /** Closed sessions that delivered a failing item: evidence only, never changed. */
  deliveredEvidence: Array<{ sessionId: string; quizMode: string; index: number; question: string; failures: Failure[] }>;
}

export async function buildPlan(client: DbExecutor = db, lock = false): Promise<QuarantinePlan> {
  const forUpdate = lock ? ' FOR UPDATE' : '';
  const candidates: QuarantinePlan['candidates'] = [];
  const cand = await client.query(`SELECT id, student_id, concept_id, activity_type, question FROM question_bank_candidates WHERE validation_status = 'VALIDATED' ORDER BY created_at, id${forUpdate}`);
  for (const r of cand.rows) {
    const q = parse(r.question);
    const f = failuresOf(q);
    if (f.length) candidates.push({ id: r.id, studentId: r.student_id, conceptId: r.concept_id, activityType: r.activity_type, question: String(q?.question ?? '').slice(0, 90), failures: f });
  }
  const rejected = new Set(candidates.map((c) => c.id));

  const preparedActivities: QuarantinePlan['preparedActivities'] = [];
  const prep = await client.query(`SELECT id, stage, status, questions, candidate_ids FROM canonical_prepared_activity WHERE status IN ('READY', 'PREPARING') ORDER BY created_at, id${forUpdate}`);
  for (const r of prep.rows) {
    const qs: unknown[] = parse(r.questions) ?? [];
    const bad = qs.map(failuresOf).find((f) => f.length);
    const viaCandidate = ((r.candidate_ids as string[] | null) ?? []).find((id) => rejected.has(id));
    if (bad || viaCandidate) preparedActivities.push({ id: r.id, stage: r.stage, status: r.status, reason: bad ? bad.map((f) => f.code).join(',') : `CANDIDATE_REJECTED:${short(viaCandidate!)}` });
  }

  const activeLearnSessions: QuarantinePlan['activeLearnSessions'] = [];
  const deliveredEvidence: QuarantinePlan['deliveredEvidence'] = [];
  const sess = await client.query(`SELECT id, status, quiz_mode, questions FROM quiz_sessions WHERE quiz_mode IN ('learn_guided', 'topic_practice', 'canonical_prove', 'canonical_retain') AND questions::text LIKE '%single_choice%' ORDER BY created_at, id${forUpdate}`);
  for (const r of sess.rows) {
    const items: any[] = parse(r.questions) ?? [];
    items.forEach((item, index) => {
      // learn_guided stores { question, answer, ... } records; the other modes store the questions
      const q = r.quiz_mode === 'learn_guided' ? item?.question : item;
      const f = failuresOf(q);
      if (!f.length) return;
      const pending = r.quiz_mode === 'learn_guided' && r.status === 'active' && item?.answer == null;
      if (pending) activeLearnSessions.push({ id: r.id, pendingIndex: index, failures: f });
      else deliveredEvidence.push({ sessionId: r.id, quizMode: r.quiz_mode, index, question: String(q?.question ?? '').slice(0, 90), failures: f });
    });
  }
  return { candidates, preparedActivities, activeLearnSessions, deliveredEvidence };
}

const targetCount = (p: QuarantinePlan) => p.candidates.length + p.preparedActivities.length + new Set(p.activeLearnSessions.map((s) => s.id)).size;

function printPlan(p: QuarantinePlan) {
  console.log(JSON.stringify({
    target: { dbFingerprint: dbFingerprint() },
    targets: targetCount(p),
    rejectCandidates: p.candidates.map((c) => ({ id: short(c.id), student: short(c.studentId), concept: short(c.conceptId), activityType: c.activityType, question: c.question, failures: c.failures.map((f) => f.code) })),
    invalidatePreparedActivities: p.preparedActivities.map((a) => ({ id: short(a.id), stage: a.stage, status: a.status, reason: a.reason })),
    expireActiveLearnSessions: p.activeLearnSessions.map((s) => ({ id: short(s.id), pendingIndex: s.pendingIndex, failures: s.failures.map((f) => f.code) })),
    deliveredEvidenceOnly: p.deliveredEvidence.map((e) => ({ session: short(e.sessionId), quizMode: e.quizMode, index: e.index, question: e.question, failures: e.failures.map((f) => f.code) })),
  }, null, 2));
}

async function plan() {
  assertCandidate();
  printPlan(await buildPlan());
}

async function quarantine() {
  assertCandidate();
  const argv = process.argv;
  const apply = argv.includes('--apply');
  const expectAt = argv.indexOf('--expect');
  const expected = expectAt > 0 ? Number(argv[expectAt + 1]) : NaN;
  if (!apply) {
    console.log('DRY RUN (no --apply): nothing is written.');
    return plan();
  }
  if (!Number.isInteger(expected)) throw new Error('REFUSING: --apply needs --expect <n> (the target count printed by `plan`)');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const actor = (await client.query(`SELECT id FROM users WHERE email = $1`, [QA_ADMIN_EMAIL])).rows[0]?.id;
    if (!actor) throw new Error(`REFUSING: QA admin identity ${QA_ADMIN_EMAIL} not found`);
    const p = await buildPlan(client, true);
    if (targetCount(p) !== expected) throw new Error(`REFUSING: plan targets ${targetCount(p)} rows, --expect ${expected}`);
    const correlationId = `pilot-qa-quarantine-${Date.now()}`;

    if (p.candidates.length) {
      const ids = p.candidates.map((c) => c.id);
      const u = await client.query(`UPDATE question_bank_candidates SET validation_status = 'REJECTED' WHERE id = ANY($1::uuid[]) AND validation_status = 'VALIDATED' RETURNING id`, [ids]);
      if (u.rowCount !== ids.length) throw new Error(`FAIL-CLOSED: rejected ${u.rowCount} of ${ids.length} candidates`);
      for (const c of p.candidates) {
        await recordAdminAction({ actorUserId: actor, action: 'LEARNING_ITEM_QUARANTINED', targetType: 'QUESTION_BANK_CANDIDATE', targetId: c.id, previousState: { validation_status: 'VALIDATED' }, newState: { validation_status: 'REJECTED', failures: c.failures }, reason: REASON, correlationId }, client);
      }
    }
    if (p.preparedActivities.length) {
      const ids = p.preparedActivities.map((a) => a.id);
      const u = await client.query(`UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = $2 WHERE id = ANY($1::uuid[]) AND status IN ('READY', 'PREPARING') RETURNING id`, [ids, REASON]);
      if (u.rowCount !== ids.length) throw new Error(`FAIL-CLOSED: invalidated ${u.rowCount} of ${ids.length} prepared activities`);
      for (const a of p.preparedActivities) {
        await recordAdminAction({ actorUserId: actor, action: 'LEARNING_ITEM_QUARANTINED', targetType: 'PREPARED_ACTIVITY', targetId: a.id, previousState: { status: a.status }, newState: { status: 'INVALIDATED', failure_reason: REASON, cause: a.reason }, reason: REASON, correlationId }, client);
      }
    }
    const sessionIds = [...new Set(p.activeLearnSessions.map((s) => s.id))];
    if (sessionIds.length) {
      const u = await client.query(`UPDATE quiz_sessions SET status = 'expired' WHERE id = ANY($1::text[]) AND status = 'active' RETURNING id`, [sessionIds]);
      if (u.rowCount !== sessionIds.length) throw new Error(`FAIL-CLOSED: expired ${u.rowCount} of ${sessionIds.length} sessions`);
      for (const id of sessionIds) {
        await recordAdminAction({ actorUserId: actor, action: 'LEARNING_ITEM_QUARANTINED', targetType: 'QUIZ_SESSION', targetId: id, previousState: { status: 'active' }, newState: { status: 'expired' }, reason: REASON, correlationId }, client);
      }
    }
    const audited = (await client.query(`SELECT count(*)::int n FROM admin_audit_log WHERE correlation_id = $1`, [correlationId])).rows[0].n;
    if (audited !== expected) throw new Error(`FAIL-CLOSED: ${audited} audit rows for ${expected} changes`);
    await client.query('COMMIT');
    console.log(JSON.stringify({ applied: true, correlationId, rejectedCandidates: p.candidates.length, invalidatedPreparedActivities: p.preparedActivities.length, expiredLearnSessions: sessionIds.length }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// runs only when executed as the script (importing it, e.g. from a test, runs nothing)
if (/pilot-qa-quarantine-items\.ts$/.test(process.argv[1] ?? '')) {
  const command = process.argv[2] ?? 'plan';
  (command === 'plan' ? plan() : command === 'quarantine' ? quarantine() : Promise.reject(new Error(`unknown command ${command} (plan | quarantine [--expect n --apply])`)))
    .then(() => db.end())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      await db.end().catch(() => {});
      process.exit(1);
    });
}
