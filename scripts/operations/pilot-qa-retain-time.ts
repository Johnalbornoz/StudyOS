/**
 * Pilot QA RETAIN time shift on the PILOT CANDIDATE (Browser QA support only -- no product behaviour).
 *
 * Makes the canonical RETAIN "+3 days after PROVE" due condition true for ONE synthetic QA student and ONE of that
 * student's concepts, as a governed, audited operation instead of raw SQL.
 *
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-retain-time.ts plan   --student student-a --concept "Ecuaciones lineales" --days 3
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-retain-time.ts shift  --student student-a --concept "Ecuaciones lineales" --days 3 --apply
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-retain-time.ts verify --student student-a --concept "Ecuaciones lineales"
 *
 * WHAT THE ENGINE READS (the only clock input of the RETAIN gate):
 *   - `learning_evidence.timestamp` of the (student, concept) rows, via `fetchStudyUSEvidenceRows`
 *     (src/lib/pedagogical-shadow/evidence-fetch.ts) -> adapter -> `RawEvidenceItem.timestamp`;
 *   - the engine's replay sets `proveQualifyingAt = item.timestamp` of the qualifying PROVE
 *     (src/lib/pedagogical-engine/engine.ts, PROVE branch) or a recognized PROVE's `recognizedAt`;
 *   - RETAIN is WAITING while `now < proveQualifyingAt + CANONICAL_POLICY.retention.minimumWaitDays` (3), and a
 *     RETENTION_CHECK attempt only qualifies at/after that instant (`eligibleFrom`).
 *   `now` is injected at the one IO boundary (`getCanonicalPedagogicalDecision`), so the minimal state change is to move
 *   that student+concept's `learning_evidence.timestamp` rows back by the same N days (ordering preserved, every other
 *   student / concept untouched). quiz_sessions timestamps are NOT read by the engine and are left alone; the shadow
 *   `concept_memory_state` projection re-reads `learning_evidence.timestamp` on the next evidence write.
 *
 * Guards: database fingerprint == pilot candidate (4baac799b9bd2a6a), every other DB refused (DEV, Preview, Stage,
 * Production, anything); student is a synthetic QA STUDENT identity of pilot-qa-roles.ts (email pattern AND one of the
 * QA_IDENTITIES student tags); concept belongs to that student (concepts -> subjects.student_id); --days integer 1..14,
 * required; `shift` refuses without --apply. `shift --apply` runs in ONE transaction and fails closed (ROLLBACK) when
 * the row set differs from the plan, the pre-shift decision is not RETAIN / WAITING (WAIT_FOR_RETENTION), or the
 * post-shift decision is not RETAIN / EXECUTABLE (RETENTION_CHECK). Audit: admin_audit_log row (recordAdminAction,
 * actor = the QA admin user, reason PILOT_QA_RETAIN_TIME_SHIFT, previous/new timestamps), in the same transaction.
 * Never prints DATABASE_URL.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { PoolClient } from 'pg';
import { evaluateCanonicalLearningState, type CanonicalPedagogicalDecision } from '@/lib/pedagogical-engine';
import { mapStudyUSEvidenceToPedagogicalEvidence, fetchStudyUSEvidenceRows } from '@/lib/pedagogical-shadow';
import type { StudyUSEvidenceRow } from '@/lib/pedagogical-shadow/types';
import { loadRecognizedRequirementsForEngine, INITIAL_MIGRATION_VERSION } from '@/lib/pedagogical-migration';
import { getMisconceptionCountsForConcept } from '@/services/misconception.service';
import { getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision/canonical-decision.service';
import { projectCanonicalJourneyStage, canonicalEngineHasEvidence } from '@/lib/lx/learner-journey-contract';
import { recordAdminAction } from '@/lib/admin/audit';
import { CANDIDATE_FP, QA_IDENTITIES, dbFingerprint, qaEmail, type QaTag } from './pilot-qa-roles';

export const AUDIT_REASON = 'PILOT_QA_RETAIN_TIME_SHIFT';
export const QA_EMAIL_PATTERN = /^studyus-qa-([a-z0-9-]+)\+clerk_test@example\.com$/;
export const PREVIEW_FP = '4c249c68e0627b9f';
export const DEV_FP = '2a29b99ee14a22b4';
export const QA_STUDENT_TAGS = (Object.keys(QA_IDENTITIES) as QaTag[]).filter((t) => QA_IDENTITIES[t].role === 'STUDENT');
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- pure guards / planning (unit-tested)

export function assertCandidateFingerprint(fp: string): void {
  if (fp !== CANDIDATE_FP) {
    const known = fp === DEV_FP ? 'DEV' : fp === PREVIEW_FP ? 'Preview' : 'not the pilot candidate';
    throw new Error(`REFUSING: database fingerprint ${fp} is ${known}; only the pilot candidate (${CANDIDATE_FP}) is allowed`);
  }
}

export function parseDays(raw: string | undefined): number {
  if (raw === undefined) throw new Error('REFUSING: --days is required (integer 1..14)');
  if (!/^\d+$/.test(raw)) throw new Error(`REFUSING: --days must be an integer 1..14 (got "${raw}")`);
  const n = Number(raw);
  if (n < 1 || n > 14) throw new Error(`REFUSING: --days must be within 1..14 (got ${n})`);
  return n;
}

/** `student-a` or the full QA email -> the canonical QA email; refuses anything that is not a QA STUDENT identity. */
export function resolveQaStudentEmail(ref: string): string {
  const tag = QA_EMAIL_PATTERN.exec(ref)?.[1] ?? ref;
  if (!(QA_STUDENT_TAGS as string[]).includes(tag)) throw new Error(`REFUSING: "${ref}" is not a synthetic QA student (${QA_STUDENT_TAGS.join(', ')})`);
  const email = qaEmail(tag as QaTag);
  if (ref.includes('@') && ref !== email) throw new Error(`REFUSING: "${ref}" is not a synthetic QA student email`);
  return email;
}

export interface CliArgs { cmd: string; student?: string; concept?: string; days?: string; apply: boolean }
export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { cmd: argv[0] ?? '', apply: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--student' || a === '--concept' || a === '--days') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`REFUSING: ${a} needs a value`);
      out[a.slice(2) as 'student' | 'concept' | 'days'] = v;
    } else throw new Error(`REFUSING: unknown argument "${a}"`);
  }
  return out;
}

export interface EvidenceTimeRow { id: string; timestamp: string; activityType: string | null }
export interface ShiftEntry { id: string; activityType: string | null; before: string; after: string }

/** Every row of that (student, concept) moved back by exactly `days`; ordering (incl. ties) preserved by construction. */
export function planShift(rows: EvidenceTimeRow[], days: number): ShiftEntry[] {
  return rows.map((r) => ({ id: r.id, activityType: r.activityType, before: new Date(r.timestamp).toISOString(), after: new Date(new Date(r.timestamp).getTime() - days * DAY_MS).toISOString() }));
}

export function orderingPreserved(entries: ShiftEntry[]): boolean {
  const key = (k: 'before' | 'after') => [...entries].sort((a, b) => a[k].localeCompare(b[k]) || a.id.localeCompare(b.id)).map((e) => e.id).join(',');
  return key('before') === key('after');
}

/** The rows read inside the transaction must be exactly the planned rows, with the planned "before" timestamps. */
export function samePlan(planned: ShiftEntry[], current: EvidenceTimeRow[]): string | null {
  if (planned.length !== current.length) return `row count differs from the plan (planned ${planned.length}, now ${current.length})`;
  const byId = new Map(current.map((r) => [r.id, new Date(r.timestamp).toISOString()]));
  for (const p of planned) {
    if (!byId.has(p.id)) return `planned row ${p.id} is no longer present`;
    if (byId.get(p.id) !== p.before) return `row ${p.id} timestamp changed since the plan`;
  }
  return null;
}

export type DecisionView = { stage: string; actionState: string; nextCanonicalAction: string; journeyStage: string; nextEligibleAt: string | null; lastQualifyingProveAt: string | null };
export function viewOf(d: CanonicalPedagogicalDecision): DecisionView {
  return {
    stage: d.stage,
    actionState: d.actionState,
    nextCanonicalAction: d.nextCanonicalAction,
    journeyStage: projectCanonicalJourneyStage(d, canonicalEngineHasEvidence(d)),
    nextEligibleAt: d.nextEligibleAt,
    lastQualifyingProveAt: d.lastQualifyingProveAt,
  };
}
/** Pre-shift state the tool exists for: RETAIN waiting for the minimum interval (journey WAIT_FOR_RETENTION). */
export const isRetainWaiting = (v: DecisionView) => v.stage === 'RETAIN' && v.actionState === 'WAITING';
/** RETAIN due: executable Retention check. */
export const isRetainDue = (v: DecisionView) => v.stage === 'RETAIN' && v.actionState === 'EXECUTABLE' && v.nextCanonicalAction === 'RETENTION_CHECK';

// ---------------------------------------------------------------- DB reads

export interface Target { email: string; userId: string; studentId: string; conceptId: string; conceptLabel: string | null }

export async function resolveTarget(client: DbExecutor, studentRef: string, conceptRef: string): Promise<Target> {
  const email = resolveQaStudentEmail(studentRef);
  const s = (await client.query(`SELECT u.id AS user_id, u.email, s.id AS student_id FROM users u JOIN students s ON s.user_id = u.id WHERE u.email = $1`, [email])).rows;
  if (s.length !== 1) throw new Error(`REFUSING: QA student ${email} not found (or ambiguous) on this database`);
  if (!QA_EMAIL_PATTERN.test(s[0].email)) throw new Error('REFUSING: resolved user is not a synthetic QA identity');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conceptRef);
  const c = (await client.query(
    `SELECT DISTINCT c.id, sub.student_id,
            (SELECT cl.label FROM concept_localizations cl WHERE cl.concept_id = c.id ORDER BY (cl.language = 'es') DESC LIMIT 1) AS label
       FROM concepts c JOIN subjects sub ON sub.id = c.subject_id
      WHERE ${isUuid ? 'c.id = $1::uuid' : `(c.canonical_id = $1 OR EXISTS (SELECT 1 FROM concept_localizations cl WHERE cl.concept_id = c.id AND lower(cl.label) = lower($1)))`}
        AND sub.student_id = $2`,
    [conceptRef, s[0].student_id],
  )).rows;
  if (c.length === 0) throw new Error(`REFUSING: concept "${conceptRef}" does not belong to ${email}`);
  if (c.length > 1) throw new Error(`REFUSING: concept "${conceptRef}" is ambiguous for ${email} (${c.length} matches); pass the concept id`);
  if (c[0].student_id !== s[0].student_id) throw new Error('REFUSING: concept belongs to another student');
  return { email, userId: s[0].user_id, studentId: s[0].student_id, conceptId: c[0].id, conceptLabel: c[0].label ?? null };
}

export async function loadEvidenceTimes(client: DbExecutor, t: Target, forUpdate = false): Promise<EvidenceTimeRow[]> {
  const rows = (await client.query(
    `SELECT id, timestamp, metadata->>'activityType' AS activity_type FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp ASC, id ASC${forUpdate ? ' FOR UPDATE' : ''}`,
    [t.studentId, t.conceptId],
  )).rows;
  return rows.map((r: any) => ({ id: r.id, timestamp: new Date(r.timestamp).toISOString(), activityType: r.activity_type ?? null }));
}

/** The engine's own read path (getCanonicalPedagogicalDecision) -- the same reads, with the evidence timestamps shifted in memory by `days` (0 = current). */
export async function decisionWithShift(client: DbExecutor, t: Target, days: number, now: string): Promise<CanonicalPedagogicalDecision> {
  if (days === 0) return (await getCanonicalPedagogicalDecision({ studentId: t.studentId, conceptId: t.conceptId, now, client })).decision;
  const [rows, recognized, counts] = await Promise.all([
    fetchStudyUSEvidenceRows(t.studentId, t.conceptId, client),
    loadRecognizedRequirementsForEngine(t.studentId, t.conceptId, INITIAL_MIGRATION_VERSION, client),
    getMisconceptionCountsForConcept(t.studentId, t.conceptId, client),
  ]);
  const shifted: StudyUSEvidenceRow[] = rows.map((r) => ({ ...r, timestamp: new Date(new Date(r.timestamp).getTime() - days * DAY_MS).toISOString() }));
  const adapted = mapStudyUSEvidenceToPedagogicalEvidence(shifted);
  return evaluateCanonicalLearningState({
    conceptId: t.conceptId, studentId: t.studentId, now, evidence: adapted.items,
    activeCriticalMisconception: counts.criticalCount > 0,
    recognizedRequirements: recognized.length > 0 ? recognized : undefined,
  });
}

async function qaAdminUserId(client: DbExecutor): Promise<string> {
  const r = (await client.query(`SELECT id FROM users WHERE email = $1`, [qaEmail('admin')])).rows;
  if (r.length !== 1) throw new Error(`REFUSING: QA admin ${qaEmail('admin')} not found -- run pilot-qa-roles.ts provision first`);
  return r[0].id;
}

// ---------------------------------------------------------------- commands

export interface PlanResult {
  target: Target & { dbFingerprint: string };
  days: number;
  table: 'learning_evidence';
  column: 'timestamp';
  rowCount: number;
  rows: ShiftEntry[];
  orderingPreserved: boolean;
  recognitions: number;
  current: DecisionView;
  predicted: DecisionView;
  applicable: boolean;
  refusal: string | null;
}

export async function buildPlan(client: DbExecutor, args: { student: string; concept: string; days: number; now?: string; fingerprint?: string }): Promise<PlanResult> {
  const fp = args.fingerprint ?? dbFingerprint();
  assertCandidateFingerprint(fp);
  parseDays(String(args.days));
  const now = args.now ?? new Date().toISOString();
  const target = await resolveTarget(client, args.student, args.concept);
  const rows = planShift(await loadEvidenceTimes(client, target), args.days);
  const recognitions = (await client.query(`SELECT count(*)::int AS n FROM pedagogical_requirement_recognition WHERE student_id = $1 AND concept_id = $2`, [target.studentId, target.conceptId])).rows[0]?.n ?? 0;
  const current = viewOf(await decisionWithShift(client, target, 0, now));
  const predicted = viewOf(await decisionWithShift(client, target, args.days, now));
  const refusal = rows.length === 0 ? 'no learning_evidence rows for this student+concept'
    : !isRetainWaiting(current) ? `current canonical decision is ${current.stage}/${current.actionState} (journey ${current.journeyStage}), expected RETAIN/WAITING (WAIT_FOR_RETENTION)`
    : !isRetainDue(predicted) ? `predicted decision after -${args.days}d is ${predicted.stage}/${predicted.actionState}/${predicted.nextCanonicalAction}, expected RETAIN/EXECUTABLE/RETENTION_CHECK`
    : null;
  return { target: { ...target, dbFingerprint: fp }, days: args.days, table: 'learning_evidence', column: 'timestamp', rowCount: rows.length, rows, orderingPreserved: orderingPreserved(rows), recognitions, current, predicted, applicable: refusal === null, refusal };
}

export interface ConnectableDb { connect(): Promise<Pick<PoolClient, 'query' | 'release'>> }

/** ONE transaction: re-read FOR UPDATE, compare with the plan, shift, re-verify with the engine, audit, COMMIT. Any failure -> ROLLBACK. */
export async function applyShift(pool: ConnectableDb, plan: PlanResult, opts: { apply: boolean; now?: string }): Promise<{ shifted: number; after: DecisionView }> {
  if (!opts.apply) throw new Error('REFUSING: shift writes; run `plan` first, then `shift ... --apply`');
  if (!plan.applicable) throw new Error(`REFUSING: ${plan.refusal}`);
  if (!plan.orderingPreserved) throw new Error('REFUSING: planned shift would change evidence ordering');
  assertCandidateFingerprint(plan.target.dbFingerprint);
  const now = opts.now ?? new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = plan.target;
    const mismatch = samePlan(plan.rows, await loadEvidenceTimes(client, t, true));
    if (mismatch) throw new Error(`ROLLBACK: ${mismatch}`);
    const before = viewOf(await decisionWithShift(client, t, 0, now));
    if (!isRetainWaiting(before)) throw new Error(`ROLLBACK: decision is ${before.stage}/${before.actionState} (journey ${before.journeyStage}), expected RETAIN/WAITING (WAIT_FOR_RETENTION)`);
    const ids = plan.rows.map((r) => r.id);
    const upd = await client.query(
      `UPDATE learning_evidence SET timestamp = timestamp - make_interval(days => $3::int) WHERE student_id = $1 AND concept_id = $2 AND id = ANY($4::uuid[]) RETURNING id`,
      [t.studentId, t.conceptId, plan.days, ids],
    );
    if ((upd.rowCount ?? upd.rows.length) !== plan.rowCount) throw new Error(`ROLLBACK: updated ${upd.rowCount} rows, plan had ${plan.rowCount}`);
    const after = viewOf(await decisionWithShift(client, t, 0, now));
    if (!isRetainDue(after)) throw new Error(`ROLLBACK: post-shift decision is ${after.stage}/${after.actionState}/${after.nextCanonicalAction}, expected RETAIN/EXECUTABLE/RETENTION_CHECK`);
    await recordAdminAction({
      actorUserId: await qaAdminUserId(client),
      action: 'PILOT_QA_RETAIN_TIME_SHIFT',
      targetType: 'LEARNING_EVIDENCE',
      targetId: `${t.studentId}:${t.conceptId}`,
      previousState: { studentEmail: t.email, conceptId: t.conceptId, decision: before, timestamps: plan.rows.map((r) => ({ id: r.id, timestamp: r.before })) },
      newState: { days: plan.days, column: 'learning_evidence.timestamp', decision: after, timestamps: plan.rows.map((r) => ({ id: r.id, timestamp: r.after })) },
      reason: AUDIT_REASON,
      result: 'SUCCESS',
    }, client);
    await client.query('COMMIT');
    return { shifted: plan.rowCount, after };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function verifyTarget(client: DbExecutor, args: { student: string; concept: string; now?: string; fingerprint?: string }) {
  assertCandidateFingerprint(args.fingerprint ?? dbFingerprint());
  const target = await resolveTarget(client, args.student, args.concept);
  const v = viewOf(await decisionWithShift(client, target, 0, args.now ?? new Date().toISOString()));
  return { target: { email: target.email, studentId: target.studentId, conceptId: target.conceptId, conceptLabel: target.conceptLabel }, decision: v, retainDue: isRetainDue(v) };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  assertCandidateFingerprint(dbFingerprint());
  if (!a.student || !a.concept) throw new Error('usage: plan|shift|verify --student <student-a|email> --concept <conceptId|label> [--days 1..14] [--apply]');
  if (a.cmd === 'plan') {
    console.log(JSON.stringify(await buildPlan(db, { student: a.student, concept: a.concept, days: parseDays(a.days) }), null, 2));
  } else if (a.cmd === 'shift') {
    const days = parseDays(a.days);
    if (!a.apply) throw new Error('REFUSING: shift writes; run `plan` first, then `shift ... --apply`');
    const plan = await buildPlan(db, { student: a.student, concept: a.concept, days });
    const r = await applyShift(db as unknown as ConnectableDb, plan, { apply: a.apply });
    console.log(JSON.stringify({ shifted: r.shifted, days, after: r.after, audit: AUDIT_REASON }, null, 2));
  } else if (a.cmd === 'verify') {
    const r = await verifyTarget(db, { student: a.student, concept: a.concept });
    console.log(JSON.stringify(r, null, 2));
    console.log(`verify: ${r.retainDue ? 'PASS RETAIN due (EXECUTABLE / RETENTION_CHECK)' : `FAIL ${r.decision.stage}/${r.decision.actionState}`}`);
    if (!r.retainDue) process.exitCode = 1;
  } else throw new Error('usage: plan | shift --apply | verify');
}

if (process.argv[1]?.endsWith('pilot-qa-retain-time.ts')) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(async () => { await (db as any).end?.(); });
}
