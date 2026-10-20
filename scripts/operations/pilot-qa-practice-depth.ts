/**
 * D76 -- governed PRACTICE bank depth for ONE synthetic QA student + concept on the PILOT CANDIDATE.
 *
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-practice-depth.ts plan      --student student-a --concept "Ecuaciones lineales"
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-practice-depth.ts replenish --student student-a --concept "Ecuaciones lineales" --expect <needed> --apply
 *   npx tsx --env-file=<studyos-dev/.env.neon-pilot-candidate> scripts/operations/pilot-qa-practice-depth.ts verify    --student student-a --concept "Ecuaciones lineales"
 *
 * `plan` (read-only) shows the learner's valid PRACTICE depth for the concept, measured exactly as the
 * delivery worker measures it (countValidBankDepth: the learner's VALIDATED question_bank_candidates for the
 * canonical Practice contract -- language, academic context, difficulty band -- that pass the P1-03 choice-item
 * validator), against the governed target BANK_DEPTH_TARGET.PRACTICE (9), the generation already in flight for
 * that bank, and how many items replenishment would request. Also a breakdown of every PRACTICE candidate row of
 * the pair (status / out-of-band / P1-03-invalid / delivered) and the distinct items of recent Practice sessions.
 *
 * `replenish` writes only with `--apply` AND `--expect <n>` equal to the `needed` the plan prints. It runs the
 * EXISTING BANK_REPLENISH handler (bankReplenishHandler -> generateActivityCandidates -> addValidatedCandidates:
 * quality gates + P1-03, provenance persisted, only valid items admitted) ONCE for the missing count; that
 * handler queues its own bounded follow-up round and a PREPARE_INVENTORY as it always does. This makes Learning
 * generation provider calls (allowed for Learning supply); standardized-exam supply is never touched.
 * Audit: one admin_audit_log row (actor = the QA admin, reason PILOT_QA_PRACTICE_DEPTH_REPLENISH).
 *
 * `verify` re-measures the depth: PASS when depth >= 9.
 *
 * Guards: database fingerprint == pilot candidate (4baac799b9bd2a6a), anything else refused; the student is a
 * synthetic QA STUDENT identity (studyus-qa-<tag>+clerk_test@example.com); the concept belongs to that student;
 * `replenish` additionally requires the learner's canonical next activity for the concept to be PRACTICE (its
 * contract is the one replenishment generates for -- no difficulty is invented here). Never prints DATABASE_URL.
 */
import { db, type DbExecutor } from '@/lib/db';
import { academicContextFingerprint, bankDepthTarget, type AcademicContext, type ActivityContract } from '@/lib/activity-delivery/contract';
import { validateChoiceItem } from '@/lib/lx/choice-item-validator';
import { runWithAiMetrics } from '@/lib/ai/request-metrics';
import { recordAdminAction } from '@/lib/admin/audit';
import { countValidBankDepth } from '@/services/activity-assembly.service';
import { bankReplenishHandler, resolveNextActivityContract } from '@/services/activity-delivery-worker.service';
import { openBankSupply } from '@/services/generation-queue.service';
import { loadAcademicContext } from '@/services/activity-delivery-context.service';
import { resolveLanguageForSubject } from '@/services/subject-generation-context.service';
import { dbFingerprint, qaEmail } from './pilot-qa-roles';
import { assertCandidateFingerprint, resolveTarget, type Target } from './pilot-qa-retain-time';

export const AUDIT_REASON = 'PILOT_QA_PRACTICE_DEPTH_REPLENISH';
const short = (id: string) => id.slice(0, 8);
const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

/** The SAME key the delivery worker uses for this bank (activity-delivery-worker.service bankKey). */
export const practiceBankKey = (conceptId: string, language: string, academic: AcademicContext) =>
  `bank:${conceptId}:PRACTICE:${language}:${academicContextFingerprint(academic)}`;

/** Items still to request so the bank reaches the target, after what is already in flight. */
export function neededTowardTarget(depth: number, target: number, inFlight: number): number {
  return Math.max(0, target - depth - inFlight);
}

export interface CliArgs { cmd: string; student?: string; concept?: string; expect?: string; apply: boolean }
export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { cmd: argv[0] ?? '', apply: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--student' || a === '--concept' || a === '--expect') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`REFUSING: ${a} needs a value`);
      out[a.slice(2) as 'student' | 'concept' | 'expect'] = v;
    } else throw new Error(`REFUSING: unknown argument "${a}"`);
  }
  return out;
}

export interface DepthPlan {
  target: { dbFingerprint: string; email: string; studentId: string; conceptId: string; conceptLabel: string | null; subjectId: string };
  nextActivity: string;
  practiceContract: { language: string; academicFingerprint: string; difficulty: ActivityContract['difficulty']; itemCount: number } | null;
  depthTarget: number;
  validPracticeDepth: number | null;
  inFlight: number;
  needed: number | null;
  verdict: 'AT_OR_ABOVE_TARGET' | 'BELOW_TARGET' | 'NEXT_ACTIVITY_NOT_PRACTICE';
  candidateRows: { total: number; byStatus: Record<string, number>; validatedChoiceInvalid: number; validatedOutOfBand: number | null; validatedDelivered: number; validatedDistinct: number };
  recentPracticeSessions: Array<{ id: string; createdAt: string; items: number; source: string | null }>;
  distinctItemsLastThreeSessions: number;
}

async function subjectOf(client: DbExecutor, conceptId: string): Promise<string> {
  const r = (await client.query(`SELECT subject_id FROM concepts WHERE id = $1`, [conceptId])).rows;
  if (r.length !== 1) throw new Error('REFUSING: concept subject not found');
  return r[0].subject_id;
}

export async function buildPlan(client: DbExecutor, refs: { student: string; concept: string }): Promise<{ plan: DepthPlan; t: Target; contract: ActivityContract | null; academic: AcademicContext; language: string }> {
  const t = await resolveTarget(client, refs.student, refs.concept);
  const subjectId = await subjectOf(client, t.conceptId);
  const depthTarget = bankDepthTarget('PRACTICE')!;
  const next = await resolveNextActivityContract({ studentId: t.studentId, subjectId, conceptId: t.conceptId });
  const practice = next.launchable && next.activityType === 'PRACTICE';
  const contract = practice ? next.contract : null;
  const language = contract?.language ?? (await resolveLanguageForSubject(subjectId, t.studentId));
  const academic = contract?.academic ?? (await loadAcademicContext(t.studentId, subjectId));
  const academicFp = academicContextFingerprint(academic);

  const [validPracticeDepth, inFlight] = await Promise.all([
    contract ? countValidBankDepth({ studentId: t.studentId, contract, academic }, client) : Promise.resolve(null),
    openBankSupply(practiceBankKey(t.conceptId, language, academic)),
  ]);

  // breakdown of every PRACTICE candidate row of this learner + concept (any language / context)
  const rows = (await client.query(
    `SELECT c.id, c.validation_status, c.difficulty, c.language, c.academic_context_fingerprint, c.content_fingerprint, c.question,
            EXISTS (SELECT 1 FROM question_bank_deliveries d WHERE d.candidate_id = c.id AND d.student_id = $1) AS delivered
       FROM question_bank_candidates c
      WHERE c.student_id = $1 AND c.concept_id = $2 AND c.activity_type = 'PRACTICE'`,
    [t.studentId, t.conceptId],
  )).rows;
  const byStatus: Record<string, number> = {};
  let validatedChoiceInvalid = 0, validatedOutOfBand = 0, validatedDelivered = 0;
  const distinct = new Set<string>();
  for (const r of rows) {
    byStatus[r.validation_status] = (byStatus[r.validation_status] ?? 0) + 1;
    if (r.validation_status !== 'VALIDATED') continue;
    if (!validateChoiceItem(parse(r.question)).ok) validatedChoiceInvalid++;
    if (contract && (Number(r.difficulty) < contract.difficulty.min || Number(r.difficulty) > contract.difficulty.max)) validatedOutOfBand++;
    if (r.delivered) validatedDelivered++;
    if (r.language === language && r.academic_context_fingerprint === academicFp) distinct.add(r.content_fingerprint);
  }

  const sessions = (await client.query(
    `SELECT id, created_at, questions, delivery_source FROM quiz_sessions
      WHERE student_id = $1 AND quiz_mode = 'topic_practice' AND pedagogical_policy_version IS NOT NULL AND $2::uuid = ANY(concept_ids)
      ORDER BY created_at DESC LIMIT 5`,
    [t.studentId, t.conceptId],
  )).rows;
  const lastThree = new Set<string>();
  sessions.slice(0, 3).forEach((s: any) => ((parse(s.questions) as any[]) ?? []).forEach((q) => typeof q?.question === 'string' && lastThree.add(q.question.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase())));

  const needed = validPracticeDepth === null ? null : neededTowardTarget(validPracticeDepth, depthTarget, inFlight);
  const plan: DepthPlan = {
    target: { dbFingerprint: dbFingerprint(), email: t.email, studentId: short(t.studentId), conceptId: short(t.conceptId), conceptLabel: t.conceptLabel, subjectId: short(subjectId) },
    nextActivity: next.launchable ? next.activityType : 'NONE_LAUNCHABLE',
    practiceContract: contract ? { language, academicFingerprint: academicFp.slice(0, 12), difficulty: contract.difficulty, itemCount: contract.itemCount } : null,
    depthTarget,
    validPracticeDepth,
    inFlight,
    needed,
    verdict: validPracticeDepth === null ? 'NEXT_ACTIVITY_NOT_PRACTICE' : validPracticeDepth >= depthTarget ? 'AT_OR_ABOVE_TARGET' : 'BELOW_TARGET',
    candidateRows: { total: rows.length, byStatus, validatedChoiceInvalid, validatedOutOfBand: contract ? validatedOutOfBand : null, validatedDelivered, validatedDistinct: distinct.size },
    recentPracticeSessions: sessions.map((s: any) => ({ id: String(s.id), createdAt: new Date(s.created_at).toISOString(), items: ((parse(s.questions) as any[]) ?? []).length, source: s.delivery_source ?? null })),
    distinctItemsLastThreeSessions: lastThree.size,
  };
  return { plan, t, contract, academic, language };
}

async function qaAdminUserId(client: DbExecutor): Promise<string> {
  const r = (await client.query(`SELECT id FROM users WHERE email = $1`, [qaEmail('admin')])).rows;
  if (r.length !== 1) throw new Error(`REFUSING: QA admin ${qaEmail('admin')} not found`);
  return r[0].id;
}

async function replenish(refs: { student: string; concept: string }, expectRaw: string | undefined, apply: boolean) {
  if (!apply) throw new Error('REFUSING: replenish generates and writes; run `plan` first, then `replenish ... --expect <needed> --apply`');
  const expected = Number(expectRaw);
  if (!Number.isInteger(expected) || expected < 1) throw new Error('REFUSING: --apply needs --expect <n> (the `needed` printed by `plan`, >= 1)');
  const { plan, t, contract, academic, language } = await buildPlan(db, refs);
  if (!contract) throw new Error(`REFUSING: the canonical next activity is ${plan.nextActivity}, not PRACTICE -- no Practice contract to replenish for`);
  if (plan.needed !== expected) throw new Error(`REFUSING: plan needs ${plan.needed}, --expect ${expected}`);
  const actor = await qaAdminUserId(db);
  const subjectId = await subjectOf(db, t.conceptId);
  const dedupKey = `${practiceBankKey(t.conceptId, language, academic)}:pilot-qa-${Date.now()}`;
  const result = await runWithAiMetrics('OPERATOR pilot-qa-practice-depth', () =>
    bankReplenishHandler({
      id: dedupKey, kind: 'BANK_REPLENISH', dedupKey, attempts: 1, maxAttempts: 1,
      payload: { studentId: t.studentId, subjectId, conceptId: t.conceptId, activityType: 'PRACTICE', language, academic, difficulty: contract.difficulty.target, needed: expected, round: 1 },
    } as never),
  );
  const after = await countValidBankDepth({ studentId: t.studentId, contract, academic });
  await recordAdminAction({
    actorUserId: actor, action: 'PILOT_QA_PRACTICE_DEPTH_REPLENISH', targetType: 'QUESTION_BANK_CANDIDATE', targetId: t.conceptId, // the (learner, concept) PRACTICE bank
    previousState: { validPracticeDepth: plan.validPracticeDepth, studentId: t.studentId }, newState: { validPracticeDepth: after, handler: result },
    reason: AUDIT_REASON, result: result.ok ? 'SUCCESS' : 'FAILURE', correlationId: dedupKey,
  });
  console.log(JSON.stringify({ before: plan.validPracticeDepth, requested: expected, handler: result, after, depthTarget: plan.depthTarget, audit: AUDIT_REASON }, null, 2));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  assertCandidateFingerprint(dbFingerprint());
  if (!a.student || !a.concept) throw new Error('usage: plan|replenish|verify --student <student-a|email> --concept <conceptId|label> [--expect n --apply]');
  const refs = { student: a.student, concept: a.concept };
  if (a.cmd === 'plan') {
    console.log(JSON.stringify((await buildPlan(db, refs)).plan, null, 2));
  } else if (a.cmd === 'replenish') {
    await replenish(refs, a.expect, a.apply);
  } else if (a.cmd === 'verify') {
    const { plan } = await buildPlan(db, refs);
    console.log(JSON.stringify(plan, null, 2));
    const pass = plan.validPracticeDepth !== null && plan.validPracticeDepth >= plan.depthTarget;
    console.log(`verify: ${pass ? `PASS valid Practice depth ${plan.validPracticeDepth} >= ${plan.depthTarget}` : `FAIL ${plan.verdict} (depth ${plan.validPracticeDepth ?? 'n/a'} / ${plan.depthTarget})`}`);
    if (!pass) process.exitCode = 1;
  } else throw new Error('usage: plan | replenish --expect <n> --apply | verify');
}

if (process.argv[1]?.endsWith('pilot-qa-practice-depth.ts')) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(async () => { await (db as any).end?.(); });
}
