/**
 * LEARNING_ACTIVITY_DELIVERY certification benchmark -- hosted DEV only.
 *
 *   BENCH_SECRET_FILE=<0600 file with the DEV CRON_SECRET> \
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/bench-activity-delivery.ts \
 *     [--scenarios=steady,cold,hot,stress] [--runs=3] [--launches=20]
 *
 * Every launch runs INSIDE the hosted DEV runtime, through the DEV-only
 * endpoint POST /api/internal/delivery-bench (the route's own launch path),
 * so the SLO gates use server-side latency; laptop -> Vercel round trips are
 * reported apart as E2E. There is no local worker: DEV replenishes itself
 * (after() -> dispatch -> worker endpoint in its own invocation).
 *
 * The laptop only administers the ONE synthetic learner
 * (clerk_id 'bench:activity-delivery', email @studyus.invalid) through the
 * DEV database (fingerprint-guarded): idempotent setup, resets, controlled
 * drains and read-only verification. No real learner is ever touched.
 *
 * Scenarios (certification = STEADY, COLD, HOT; STRESS = capacity only):
 *   STEADY  realistic cadence (itemCount x 20 s per learner), empty bank at
 *           start, filled and kept only by the real worker. Hard gates.
 *   COLD    controlled drain -> EMERGENCY_REQUIRED (0 AI) -> queued ->
 *           worker -> READY -> next launch served. Hard architecture gate.
 *   HOT     synthetic deep bank, 3 x 100 launches + double-click pairs.
 *   STRESS  STEADY at a launch every 30 s. Reported, not gated -- except the
 *           invariants that must hold even under stress.
 *
 * AI quota guard (DEV's limit is global, shared with E2E testing): before
 * each scenario remaining_daily must be >= estimate + 1000; during it the
 * per-minute counter is watched (AI_RATE_LIMIT_PRESSURE) and the scenario
 * stops if fewer than 1000 daily calls would remain, if the day's calls reach
 * --dayCallCeiling (default 6000), or if the open queue grows past
 * --openJobsAnomaly (a replenishment loop, not load). A stopped scenario also
 * closes the benchmark learner's open jobs, so no benchmark AI keeps running.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { db } from '@/lib/db';
import { verifyV1PracticeLaunchMarker } from '@/lib/pedagogical-decision';
import { loadAcademicContext } from '@/services/activity-delivery-context.service';
import { addValidatedCandidates } from '@/services/question-bank.service';
import { countSpareSets } from '@/services/activity-assembly.service';
import { reservedCandidateIds } from '@/services/activity-inventory.service';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';
import {
  QUIZ_MODE_FOR_ACTIVITY, SPARE_ASSEMBLABLE_SETS, STAGE_FOR_ACTIVITY, inventoryTarget,
  type AcademicContext, type ActivityContract, type DeliveryActivityType,
} from '@/lib/activity-delivery/contract';
import type { QuizMode } from '@/services/quiz-persistence.service';

const DEV_FINGERPRINT = '2a29b99ee14a22b4';
const BASE_URL = process.env.BENCH_BASE_URL ?? 'https://study-os-env-dev-study-so.vercel.app';
const argv = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const num = (name: string, dflt: number) => Number(argv(name) ?? dflt);
const RUNS = num('runs', 3);
const LAUNCHES = num('launches', 20);
const SECONDS_PER_ITEM = num('secondsPerItem', 20);
const STRESS_THINK_S = num('stressThink', 30);
const COLD_REPS = num('coldReps', 2);
const DOUBLE_CLICK_PAIRS = 5;
const TYPES: DeliveryActivityType[] = ['LEARN_CHECK', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'];
const LANGUAGE = 'es';
const QUOTA_RESERVE = 1000;
/** Hard stop for the whole run: the day's global AI calls must never pass this (cost / loop protection). */
const DAY_CALL_CEILING = num('dayCallCeiling', 6000);
/** More open jobs than this at once means a replenishment loop, not load: stop. */
const OPEN_JOBS_ANOMALY = num('openJobsAnomaly', 150);
/** Upper estimates of AI calls per scenario (from earlier DEV runs), for the pre-scenario quota check. */
const QUOTA_ESTIMATE: Record<string, number> = { steady: 1500, cold: 700, hot: 300, stress: 1600 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertDevDatabase() {
  const url = new URL(process.env.DATABASE_URL!);
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV_FINGERPRINT) throw new Error(`Refusing to run: database fingerprint ${fp} is not DEV`);
  return fp;
}

// ================================================================ hosted client
/** The project's automation bypass for Deployment Protection, read through the Vercel CLI into memory only. */
function protectionBypassSecret(): string {
  const project = JSON.parse(readFileSync('.vercel/project.json', 'utf-8'));
  const out = execFileSync('npx', ['-y', 'vercel@latest', 'api', `/v9/projects/${project.projectId}?teamId=${project.orgId}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  const entry = Object.entries(JSON.parse(out).protectionBypass ?? {}).find(([, v]: any) => v?.scope === 'automation-bypass');
  if (!entry) throw new Error('no automation bypass configured for the project');
  return entry[0];
}

class Hosted {
  private headers: Record<string, string>;
  constructor(secret: string, bypass: string) {
    this.headers = { authorization: `Bearer ${secret}`, 'x-vercel-protection-bypass': bypass, 'content-type': 'application/json' };
  }
  async post(body: Record<string, unknown>): Promise<{ status: number; json: any; e2eMs: number }> {
    const t0 = Date.now();
    const res = await fetch(`${BASE_URL}/api/internal/delivery-bench`, { method: 'POST', headers: this.headers, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, e2eMs: Date.now() - t0 };
  }
}

let hosted: Hosted;

interface LaunchSample {
  type: DeliveryActivityType; at: number; serverMs: number; e2eMs: number; source: string; aiCalls: number; quizId: string | null;
  authorizeMs: number; decisionMs: number; timings: Record<string, number>; readyBefore?: number; error?: string;
}

async function launch(ctx: { conceptId: string; type: DeliveryActivityType; syntheticTransfer?: boolean }): Promise<LaunchSample> {
  const at = Date.now();
  try {
    const r = await hosted.post({ action: 'launch', conceptId: ctx.conceptId, activityType: ctx.type, language: LANGUAGE, ...(ctx.syntheticTransfer ? { syntheticTransferContract: true } : {}) });
    const j = r.json ?? {};
    if (r.status !== 200 || !j.status) return { type: ctx.type, at, serverMs: 0, e2eMs: r.e2eMs, source: 'FAILED', aiCalls: 0, quizId: null, authorizeMs: 0, decisionMs: 0, timings: {}, error: `HTTP_${r.status}:${j.error ?? ''}` };
    if (j.status === 'NOT_AUTHORIZED_FOR_STAGE') return { type: ctx.type, at, serverMs: j.totalMs, e2eMs: r.e2eMs, source: 'FAILED', aiCalls: 0, quizId: null, authorizeMs: j.authorizeMs, decisionMs: j.decisionMs, timings: {}, error: 'NOT_AUTHORIZED_FOR_STAGE' };
    return {
      type: ctx.type, at, serverMs: j.totalMs, e2eMs: r.e2eMs, source: j.source, aiCalls: j.aiCalls, quizId: j.quizId,
      authorizeMs: j.authorizeMs, decisionMs: j.decisionMs, timings: j.timings ?? {}, ...(j.status === 'EMERGENCY_REQUIRED' ? { error: 'BANK_SHORT' } : {}),
    };
  } catch (error) {
    return { type: ctx.type, at, serverMs: 0, e2eMs: Date.now() - at, source: 'FAILED', aiCalls: 0, quizId: null, authorizeMs: 0, decisionMs: 0, timings: {}, error: error instanceof Error ? error.message : String(error) };
  }
}
const abandon = async (quizId: string | null) => { if (quizId) await hosted.post({ action: 'abandon', quizId }); };
const replenish = (conceptId: string) => hosted.post({ action: 'replenish', conceptId, language: LANGUAGE });

// ================================================================ AI quota guard
interface Quota { perDay: number; perMinute: number; dayCalls: number; minuteCalls: number; remaining: number; openJobs: number }
async function quota(): Promise<Quota & { commitSha: string | null; region: string | null }> {
  const r = await hosted.post({ action: 'status' });
  if (r.status !== 200) throw new Error(`status endpoint HTTP ${r.status}`);
  const { aiLimits, aiUsage, openJobs, commitSha, region } = r.json;
  const now = new Date(aiUsage?.now ?? Date.now());
  const today = now.toISOString().slice(0, 10);
  const dayCalls = aiUsage && new Date(aiUsage.day_start).toISOString().slice(0, 10) === today ? aiUsage.day_calls : 0;
  const minuteCalls = aiUsage && Math.floor(new Date(aiUsage.minute_start).getTime() / 60_000) === Math.floor(now.getTime() / 60_000) ? aiUsage.minute_calls : 0;
  return {
    perDay: aiLimits.perDay, perMinute: aiLimits.perMinute, dayCalls, minuteCalls, remaining: aiLimits.perDay - dayCalls,
    openJobs: (openJobs as Array<{ n: number }>).reduce((n, j) => n + j.n, 0), commitSha, region,
  };
}

class QuotaWatch {
  peakPerMinute = 0; pressureEvents: Array<{ at: string; minuteCalls: number }> = []; maxOpenJobs = 0; aborted: string | null = null;
  private stop = false; private done: Promise<void>;
  constructor() {
    this.done = (async () => {
      while (!this.stop) {
        try {
          const q = await quota();
          this.peakPerMinute = Math.max(this.peakPerMinute, q.minuteCalls);
          this.maxOpenJobs = Math.max(this.maxOpenJobs, q.openJobs);
          if (q.minuteCalls >= 0.9 * q.perMinute) this.pressureEvents.push({ at: new Date().toISOString(), minuteCalls: q.minuteCalls });
          if (q.remaining < QUOTA_RESERVE && !this.aborted) this.aborted = `daily AI quota below reserve (${q.remaining} left)`;
          if (q.dayCalls >= DAY_CALL_CEILING && !this.aborted) this.aborted = `day AI calls ${q.dayCalls} reached the ceiling ${DAY_CALL_CEILING}`;
          if (q.openJobs > OPEN_JOBS_ANOMALY && !this.aborted) this.aborted = `anomalous queue depth ${q.openJobs} (> ${OPEN_JOBS_ANOMALY})`;
        } catch { /* a missed sample is not a failure */ }
        await sleep(15_000);
      }
    })();
  }
  async end() { this.stop = true; await this.done; }
}

/** After a scenario the benchmark learner has no open jobs left: nothing keeps generating on its behalf. */
async function closeBenchJobs(studentId: string, reason: string) {
  const r = await db.query(
    `UPDATE generation_jobs SET status = 'FAILED', last_error = $2, locked_at = NULL, updated_at = now()
      WHERE payload->>'studentId' = $1 AND status IN ('PENDING', 'RUNNING') RETURNING id`, [studentId, reason]);
  return r.rows.length;
}

class QuotaPause extends Error {}
async function guardQuota(scenario: string) {
  const q = await quota();
  const need = QUOTA_ESTIMATE[scenario] + QUOTA_RESERVE;
  console.log(`[bench] quota before ${scenario}: ${q.dayCalls}/${q.perDay} used today, ${q.remaining} left, needs ${need}`);
  if (q.remaining < need) throw new QuotaPause(`PAUSED before ${scenario}: remaining_daily ${q.remaining} < estimate ${QUOTA_ESTIMATE[scenario]} + reserve ${QUOTA_RESERVE}`);
  if (q.dayCalls + QUOTA_ESTIMATE[scenario] > DAY_CALL_CEILING) throw new QuotaPause(`PAUSED before ${scenario}: ${q.dayCalls} day calls + estimate ${QUOTA_ESTIMATE[scenario]} would pass the ceiling ${DAY_CALL_CEILING}`);
  return q;
}

/** AI usage attributable to the benchmark learner (every executeAI call is audited with its student). */
async function benchAiUsage(studentId: string, since: Date) {
  const r = await db.query(
    `SELECT count(*)::int AS calls,
            count(*) FILTER (WHERE status = 'FAILURE')::int AS failures,
            count(*) FILTER (WHERE error_code = 'RATE_LIMIT')::int AS rate_limited,
            COALESCE(sum(duration_ms), 0)::bigint AS provider_ms,
            array_remove(array_agg(DISTINCT model), NULL) AS models
       FROM ai_execution_events WHERE student_id = $1 AND created_at >= $2`, [studentId, since]);
  const jobErrors = await db.query(
    `SELECT count(*) FILTER (WHERE last_error ILIKE '%rate%')::int AS rate_limited_jobs, count(*) FILTER (WHERE status = 'FAILED')::int AS failed_jobs
       FROM generation_jobs WHERE payload->>'studentId' = $1 AND created_at >= $2`, [studentId, since]);
  const row = r.rows[0];
  return { calls: row.calls, failures: row.failures, rateLimitedCalls: row.rate_limited, providerMs: Number(row.provider_ms), models: row.models ?? [], ...jobErrors.rows[0] };
}

// ================================================================ synthetic learner (DEV DB, bench learner only)
async function ensureLearner(): Promise<{ studentId: string; subjectId: string; concepts: Record<DeliveryActivityType, string> }> {
  const clerkId = 'bench:activity-delivery';
  let s = await db.query(`SELECT id FROM students WHERE clerk_id = $1`, [clerkId]);
  if (!s.rows[0]) s = await db.query(`INSERT INTO students (clerk_id, email, name) VALUES ($1, 'bench-activity-delivery@studyus.invalid', 'BENCH synthetic learner') RETURNING id`, [clerkId]);
  const studentId: string = s.rows[0].id;
  // subjects.student_id references profiles(id): the synthetic learner's student profile
  await db.query(`INSERT INTO profiles (id, user_type, full_name, clerk_id) VALUES ($1, 'student', 'BENCH synthetic learner', $2) ON CONFLICT (id) DO NOTHING`, [studentId, clerkId]);
  let sub = await db.query(`SELECT id FROM subjects WHERE student_id = $1 AND name = 'BENCH delivery'`, [studentId]);
  if (!sub.rows[0]) sub = await db.query(`INSERT INTO subjects (student_id, name, target_language) VALUES ($1, 'BENCH delivery', $2) RETURNING id`, [studentId, LANGUAGE]);
  const subjectId: string = sub.rows[0].id;
  const concepts = {} as Record<DeliveryActivityType, string>;
  for (const t of TYPES) {
    const canonicalId = `bench-${t.toLowerCase()}`;
    let c = await db.query(`SELECT id FROM concepts WHERE subject_id = $1 AND canonical_id = $2`, [subjectId, canonicalId]);
    if (!c.rows[0]) c = await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, canonicalId]);
    concepts[t] = c.rows[0].id;
  }
  return { studentId, subjectId, concepts };
}

const daysAgo = (d: number, minutes = 0) => new Date(Date.now() - d * 86400_000 + minutes * 60_000).toISOString();

async function ensureStageEvidence(studentId: string, subjectId: string, concepts: Record<DeliveryActivityType, string>) {
  const rows: Array<[DeliveryActivityType, string, string, number, number, number, string]> = [];
  // [concept, activityType, sourceType, difficulty, itemCount, score, timestamp]
  const learned = (t: DeliveryActivityType) => rows.push([t, 'LEARN_CHECK', 'PRACTICE_QUESTION', 2, 5, 100, daysAgo(10)]);
  const practiced = (t: DeliveryActivityType) => {
    rows.push([t, 'PRACTICE', 'PRACTICE_QUIZ', 2, 3, 100, daysAgo(9)]);
    rows.push([t, 'PRACTICE', 'PRACTICE_QUIZ', 3, 3, 100, daysAgo(9, 30)]);
  };
  const proved = (t: DeliveryActivityType) => rows.push([t, 'SOLO_CHECK', 'SOLO_VERIFICATION', 3, 10, 90, daysAgo(6)]);
  learned('PRACTICE');
  learned('PROVE'); practiced('PROVE');
  learned('RETAIN'); practiced('RETAIN'); proved('RETAIN');
  learned('TRANSFER'); practiced('TRANSFER'); proved('TRANSFER');
  for (const [t, activityType, sourceType, difficulty, itemCount, score, ts] of rows) {
    const conceptId = concepts[t];
    const exists = await db.query(`SELECT 1 FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND metadata->>'activityType' = $3 AND metadata->>'bench' = 'true' AND difficulty = $4`, [studentId, conceptId, activityType, difficulty]);
    if (exists.rows[0]) continue;
    await db.query(
      `INSERT INTO learning_evidence (student_id, concept_id, subject_id, source_type, result, difficulty, "timestamp", learning_mode, hints_used, ai_assistance_type, metadata, score_percent)
       VALUES ($1, $2, $3, $4, 'correct', $5, $6, $7, 0, 'NONE', $8, $9)`,
      [studentId, conceptId, subjectId, sourceType, difficulty, ts, activityType === 'SOLO_CHECK' ? 'SOLO' : 'COACH',
        JSON.stringify({ bench: 'true', activityType, itemCount, correctCount: Math.round((score / 100) * itemCount) }), score],
    );
  }
}

// HOT only: a deep SYNTHETIC validated bank, created once before the runs and never topped up during them.
const NOUNS = ['lumina', 'quarzo', 'brisal', 'tenzor', 'murela', 'vorkan', 'selpa', 'drimon', 'kaltor', 'fenix', 'orbel', 'praxa', 'zuleto', 'maribo', 'cantel', 'grevo', 'hudra', 'istel', 'jorva', 'lirpo'];
function syntheticQuestion(conceptId: string, t: DeliveryActivityType, i: number, difficulty: number): any {
  const a = NOUNS[i % NOUNS.length] + String.fromCharCode(97 + ((i / NOUNS.length) | 0) % 26) + (i / 520 | 0);
  const b = NOUNS[(i * 7 + 3) % NOUNS.length] + 'q' + i;
  const x = 3 + (i % 41), y = 7 + ((i * 13) % 97), z = 5 + ((i * 17) % 89);
  const base = {
    id: `bench-${t}-${i}`, conceptId, answerFormat: 'text', difficulty,
    question: `En el mundo ${a}, ${x} ${a}s equivalen a ${y} ${b}s. ¿Cuántos ${b}s equivalen a ${z} ${a}s?`,
    correctAnswer: `${((y * z) / x).toFixed(2)} ${b}s`,
    explanation: `Proporción directa: ${y}·${z}/${x}.`,
    questionIntent: ['CHECK_APPLICATION', 'CHECK_UNDERSTANDING', 'DIAGNOSTIC_PROBE'][i % 3],
    expectedReasoningType: ['PROCEDURAL', 'CONCEPTUAL', 'FACTUAL'][i % 3],
  };
  if (t === 'TRANSFER') {
    const depth = (['NEAR', 'CONTEXTUAL', 'HIGHER'] as const)[i % 3];
    return { ...base, type: depth === 'HIGHER' ? 'justification' : 'scenario', transferDepth: depth };
  }
  return { ...base, type: ['numeric_problem', 'short_answer', 'justification'][i % 3] };
}

async function ensureSyntheticBank(studentId: string, concepts: Record<DeliveryActivityType, string>, academic: AcademicContext, contracts: Record<DeliveryActivityType, { difficulty: { min: number; max: number; target: number }; itemCount: number }>) {
  for (const t of TYPES) {
    const conceptId = concepts[t];
    // every launch + double click + the READY sets and spare sets the worker keeps
    const need = (RUNS * LAUNCHES + DOUBLE_CLICK_PAIRS * RUNS + 10) * contracts[t].itemCount;
    const undelivered = (await db.query(
      `SELECT count(*)::int n FROM question_bank_candidates c WHERE c.concept_id = $1 AND c.activity_type = $2 AND c.generator_model = 'BENCHMARK_SYNTHETIC' AND c.validation_status = 'VALIDATED'
         AND NOT EXISTS (SELECT 1 FROM question_bank_deliveries d WHERE d.candidate_id = c.id)`, [conceptId, t])).rows[0].n;
    if (undelivered >= need) continue;
    const total = (await db.query(`SELECT count(*)::int n FROM question_bank_candidates WHERE concept_id = $1 AND activity_type = $2 AND generator_model = 'BENCHMARK_SYNTHETIC'`, [conceptId, t])).rows[0].n;
    const qs = [];
    for (let i = total; i < total + (need - undelivered); i++) {
      const d = t === 'TRANSFER' ? (i % 3 === 2 ? Math.min(5, contracts[t].difficulty.max) : contracts[t].difficulty.min) : contracts[t].difficulty.target;
      qs.push(syntheticQuestion(conceptId, t, i, d));
    }
    await addValidatedCandidates(qs, {
      studentId, conceptId, activityType: t, language: LANGUAGE, academic,
      generator: { provider: null, model: 'BENCHMARK_SYNTHETIC', promptId: null, promptVersion: 'bench-v1', operationId: null },
    });
    console.log(`[bench] hot bank ${t}: +${need - undelivered} synthetic candidates`);
  }
}

// STEADY / STRESS / COLD: a REAL subject whose bank only the real worker fills.
const STEADY_TOPICS: Record<DeliveryActivityType, string> = {
  LEARN_CHECK: 'Porcentajes', PRACTICE: 'Proporcionalidad directa', PROVE: 'Ecuaciones lineales',
  RETAIN: 'Área de figuras planas', TRANSFER: 'Regla de tres simple',
};

async function ensureSteadySubject(studentId: string) {
  let sub = await db.query(`SELECT id FROM subjects WHERE student_id = $1 AND name = 'Matemáticas'`, [studentId]);
  if (!sub.rows[0]) sub = await db.query(`INSERT INTO subjects (student_id, name, target_language) VALUES ($1, 'Matemáticas', $2) RETURNING id`, [studentId, LANGUAGE]);
  const subjectId: string = sub.rows[0].id;
  const concepts = {} as Record<DeliveryActivityType, string>;
  for (const t of TYPES) {
    const canonicalId = `bench-steady-${t.toLowerCase()}`;
    let c = await db.query(`SELECT id FROM concepts WHERE subject_id = $1 AND canonical_id = $2`, [subjectId, canonicalId]);
    if (!c.rows[0]) c = await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, canonicalId]);
    concepts[t] = c.rows[0].id;
    const l = await db.query(`SELECT 1 FROM concept_localizations WHERE concept_id = $1 AND language = $2`, [concepts[t], LANGUAGE]);
    if (!l.rows[0]) await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, $2, $3)`, [concepts[t], LANGUAGE, STEADY_TOPICS[t]]);
  }
  await ensureStageEvidence(studentId, subjectId, concepts);
  // TRANSFER concept: a certified retention check after the Prove (the stamp a novel attempt receives)
  const has = await db.query(`SELECT 1 FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND metadata->>'activityType' = 'RETENTION_CHECK' AND metadata->>'bench' = 'true'`, [studentId, concepts.TRANSFER]);
  if (!has.rows[0]) {
    await db.query(
      `INSERT INTO learning_evidence (student_id, concept_id, subject_id, source_type, result, difficulty, "timestamp", learning_mode, hints_used, ai_assistance_type, metadata, score_percent)
       VALUES ($1, $2, $3, 'SOLO_VERIFICATION', 'correct', 3, $4, 'SOLO', 0, 'NONE', $5, 90)`,
      [studentId, concepts.TRANSFER, subjectId, daysAgo(1), JSON.stringify({ bench: 'true', activityType: 'RETENTION_CHECK', itemCount: 10, correctCount: 9, novel: 'true' })],
    );
  }
  // only types the REAL engine launches are measured; TRANSFER is reported BLOCKED, never simulated
  const types: DeliveryActivityType[] = [];
  const blocked: Record<string, string> = {};
  const itemCount = {} as Record<DeliveryActivityType, number>;
  const academic = await loadAcademicContext(studentId, subjectId);
  const contracts = {} as Record<DeliveryActivityType, ActivityContract>;
  for (const t of TYPES) {
    const m = await verifyV1PracticeLaunchMarker({ studentId, conceptId: concepts[t] });
    const at = m?.canonicalActivityType ?? 'no launchable activity';
    if (m && at === ({ LEARN_CHECK: 'LEARN_CHECK', PRACTICE: 'PRACTICE', PROVE: 'PROVE', RETAIN: 'RETENTION_CHECK', TRANSFER: 'TRANSFER' } as const)[t]) {
      types.push(t);
      itemCount[t] = m.itemCount?.authorized ?? QUIZ_MODE_CONFIG[QUIZ_MODE_FOR_ACTIVITY[t] as QuizMode].defaultMax;
      contracts[t] = {
        conceptId: concepts[t], activityType: t, language: LANGUAGE, academic, difficulty: m.difficulty, itemCount: itemCount[t],
        independence: m.independence, policyVersion: m.pedagogicalPolicyVersion,
      };
    } else if (t === 'TRANSFER') {
      blocked[t] = `real engine resolves ${at} after a certified retention check (RETAIN evidence is not read as novel yet)`;
    } else {
      throw new Error(`steady concept for ${t} is at ${at} (real engine)`);
    }
  }
  return { subjectId, concepts, types, blocked, itemCount, contracts, academic };
}

/**
 * Benchmark learner ONLY: close queue jobs an interrupted earlier run left
 * open (their leases would read as generation in flight), expire its open
 * sessions, and with `emptyConcepts` start those concepts from an empty bank
 * and no inventory.
 */
async function resetBenchLearner(studentId: string, emptyConcepts: string[] = []) {
  const jobs = await db.query(
    `UPDATE generation_jobs SET status = 'FAILED', last_error = 'BENCH_RESET', locked_at = NULL, updated_at = now()
      WHERE payload->>'studentId' = $1 AND status IN ('PENDING', 'RUNNING') RETURNING id`, [studentId]);
  await db.query(`UPDATE quiz_sessions SET status = 'expired' WHERE student_id = $1 AND status = 'active'`, [studentId]);
  if (emptyConcepts.length) {
    await db.query(`UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = 'BENCH_RESET' WHERE student_id = $1 AND concept_id = ANY($2::uuid[]) AND status IN ('PREPARING', 'READY')`, [studentId, emptyConcepts]);
    await db.query(`UPDATE question_bank_candidates SET validation_status = 'RETIRED' WHERE student_id = $1 AND concept_id = ANY($2::uuid[]) AND validation_status = 'VALIDATED'`, [studentId, emptyConcepts]);
  }
  console.log(`[bench] reset: ${jobs.rows.length} open jobs closed, ${emptyConcepts.length} concepts emptied`);
}

// ================================================================ read-only verification
const readyCount = async (studentId: string, conceptId: string, t: DeliveryActivityType) =>
  (await db.query(`SELECT count(*)::int n FROM canonical_prepared_activity WHERE student_id = $1 AND concept_id = $2 AND stage = $3 AND status = 'READY'`, [studentId, conceptId, STAGE_FOR_ACTIVITY[t]])).rows[0].n as number;

const spareSets = async (studentId: string, contract: ActivityContract, academic: AcademicContext) =>
  countSpareSets({ studentId, contract, academic, reservedCandidateIds: await reservedCandidateIds(studentId, contract.conceptId), maxSets: SPARE_ASSEMBLABLE_SETS });

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number, watch?: QuotaWatch): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (watch?.aborted) return null;
    if (await cond()) return Date.now() - t0;
    await sleep(2000);
  }
  return null;
}

async function activeDuplicates(studentId: string): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int n FROM (
       SELECT concept_id, quiz_mode FROM quiz_sessions WHERE student_id = $1 AND status = 'active' AND expires_at > now()
       GROUP BY concept_id, quiz_mode HAVING count(*) > 1) d`, [studentId]);
  return r.rows[0].n;
}

const evidenceRows = async (studentId: string) => (await db.query(`SELECT count(*)::int n FROM learning_evidence WHERE student_id = $1`, [studentId])).rows[0].n as number;

/** The invariants that must hold in every scenario, stress included. */
async function invariants(studentId: string, conceptIds: string[], since: Date, evidenceBefore: number) {
  const redelivered = await db.query(
    `SELECT c.activity_type, count(*)::int n FROM (
       SELECT d.candidate_id FROM question_bank_deliveries d GROUP BY d.candidate_id HAVING count(*) > 1 AND max(d.delivered_at) >= $3) x
       JOIN question_bank_candidates c ON c.id = x.candidate_id
      WHERE c.student_id = $1 AND c.concept_id = ANY($2::uuid[]) AND c.activity_type IN ('PROVE', 'RETAIN', 'TRANSFER')
      GROUP BY 1`, [studentId, conceptIds, since]);
  const bankDupes = await db.query(
    `SELECT count(*)::int n FROM (SELECT concept_id, activity_type, language, content_fingerprint FROM question_bank_candidates
      WHERE student_id = $1 GROUP BY 1, 2, 3, 4 HAVING count(*) > 1) d`, [studentId]);
  // a delivered session must hold exactly its contract's item count
  const corrupt = await db.query(
    `SELECT count(*)::int n FROM quiz_sessions
      WHERE student_id = $1 AND created_at >= $2 AND delivery_source IS NOT NULL
        AND canonical_activity_contract->'itemCount'->>'authorized' IS NOT NULL
        AND jsonb_array_length(questions) <> (canonical_activity_contract->'itemCount'->>'authorized')::int`, [studentId, since]);
  const evidenceAfter = await evidenceRows(studentId);
  return {
    DUPLICATE_DELIVERED_ITEMS: redelivered.rows.reduce((n, r) => n + r.n, 0),
    duplicateDeliveredByType: Object.fromEntries(redelivered.rows.map((r) => [r.activity_type, r.n])),
    DUPLICATE_BANK_CONTENT: bankDupes.rows[0].n,
    CORRUPT_SESSIONS: corrupt.rows[0].n,
    EVIDENCE_WRITTEN_BY_LAUNCHES: evidenceAfter - evidenceBefore,
  };
}

async function jobsByConcept(studentId: string, since: Date, concepts: Record<DeliveryActivityType, string>) {
  const r = await db.query(
    `SELECT payload->>'conceptId' AS concept, kind, status, count(*)::int n,
            COALESCE(sum((result->>'inserted')::int), 0)::int AS inserted, COALESCE(sum((result->>'generated')::int), 0)::int AS generated
       FROM generation_jobs WHERE payload->>'studentId' = $1 AND created_at >= $2 GROUP BY 1, 2, 3`, [studentId, since]);
  const out = {} as Record<DeliveryActivityType, { jobs: Record<string, number>; candidatesInserted: number; candidatesGenerated: number }>;
  for (const t of TYPES) {
    const rows = r.rows.filter((x) => x.concept === concepts[t]);
    out[t] = {
      jobs: Object.fromEntries(rows.map((x) => [`${x.kind}:${x.status}`, x.n])),
      candidatesInserted: rows.reduce((n, x) => n + x.inserted, 0),
      candidatesGenerated: rows.reduce((n, x) => n + x.generated, 0),
    };
  }
  return out;
}

// ================================================================ statistics
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

function summarize(samples: LaunchSample[]) {
  const byType: Record<string, any> = {};
  for (const t of TYPES) {
    const xs = samples.filter((s) => s.type === t);
    if (!xs.length) continue;
    const ok = xs.filter((s) => s.quizId);
    const server = ok.map((s) => s.serverMs);
    const count = (src: string) => xs.filter((s) => s.source === src).length;
    const avg = (f: (s: LaunchSample) => number) => (ok.length ? Math.round(ok.reduce((n, s) => n + f(s), 0) / ok.length) : 0);
    byType[t] = {
      launches: xs.length,
      p50: pct(server, 50), p95: pct(server, 95), p99: pct(server, 99), max: server.length ? Math.max(...server) : 0,
      e2e: { p50: pct(ok.map((s) => s.e2eMs), 50), p95: pct(ok.map((s) => s.e2eMs), 95), p99: pct(ok.map((s) => s.e2eMs), 99) },
      inventoryHitRate: +(count('INVENTORY') / xs.length).toFixed(2),
      bankAssemblyRate: +(count('BANK') / xs.length).toFixed(2),
      resumed: count('RESUMED'),
      emergencies: count('EMERGENCY_REQUIRED'),
      aiCallsInHotPath: xs.reduce((n, s) => n + s.aiCalls, 0),
      failedLaunches: count('FAILED'),
      avgStageMs: {
        authorize: avg((s) => s.authorizeMs), decision: avg((s) => s.decisionMs), lock: avg((s) => s.timings.lockMs ?? 0), resume: avg((s) => s.timings.resumeMs ?? 0),
        inventory: avg((s) => s.timings.inventoryMs ?? 0), bank: avg((s) => s.timings.bankMs ?? 0), session: avg((s) => s.timings.sessionMs ?? 0),
      },
      errors: [...new Set(xs.filter((s) => s.error).map((s) => s.error))],
    };
  }
  return byType;
}

function tableRow(scenario: string, samples: LaunchSample[], duplicates: number) {
  const server = samples.filter((s) => s.quizId).map((s) => s.serverMs);
  return {
    scenario, p50: pct(server, 50), p95: pct(server, 95), p99: pct(server, 99),
    emergency: samples.filter((s) => s.source === 'EMERGENCY_REQUIRED').length,
    hotPathAi: samples.reduce((n, s) => n + s.aiCalls, 0), duplicates,
    failures: samples.filter((s) => s.source === 'FAILED').length, launches: samples.length,
  };
}

// ================================================================ scenarios
async function doubleClicks(ctx: { conceptId: string; type: DeliveryActivityType; syntheticTransfer?: boolean }, pairs: number, studentId: string) {
  let mismatches = 0; let maxActive = 0; const details: unknown[] = []; const samples: LaunchSample[] = [];
  for (let k = 0; k < pairs; k++) {
    const [a, b] = await Promise.all([launch(ctx), launch(ctx)]);
    samples.push(a, b);
    if (!a.quizId || a.quizId !== b.quizId) {
      mismatches++;
      details.push({ type: ctx.type, a: { source: a.source, quizId: a.quizId, error: a.error ?? null }, b: { source: b.source, quizId: b.quizId, error: b.error ?? null } });
    }
    maxActive = Math.max(maxActive, await activeDuplicates(studentId));
    await abandon(a.quizId);
    if (b.quizId !== a.quizId) await abandon(b.quizId);
  }
  return { mismatches, maxActive, details, samples };
}

/** STEADY (realistic cadence, hard gates) and STRESS (fixed fast cadence, capacity report). */
async function runSteadyLike(mode: 'steady' | 'stress') {
  const { studentId } = await ensureLearner();
  const { concepts, types, blocked, itemCount, contracts, academic } = await ensureSteadySubject(studentId);
  // from zero: empty bank + no inventory; everything below is produced by the deployed worker
  await resetBenchLearner(studentId, Object.values(concepts));
  const since = new Date();
  const evidenceBefore = await evidenceRows(studentId);
  const watch = new QuotaWatch();

  // warm-up: the real trigger queues + dispatches; the worker fills bank + inventory to the POLICY targets
  const tWarm = Date.now();
  await Promise.all(types.map((t) => replenish(concepts[t])));
  const warm: Record<string, number | null> = {};
  await Promise.all(types.map(async (t) => {
    warm[t] = await waitFor(async () => {
      if ((await readyCount(studentId, concepts[t], t)) >= inventoryTarget(t) && (await spareSets(studentId, contracts[t], academic)) >= SPARE_ASSEMBLABLE_SETS) return true;
      await replenish(concepts[t]); // keep the deployed worker dispatched while the bank fills (no local top-up)
      return false;
    }, 20 * 60_000, watch);
  }));
  const warmUpMs = Date.now() - tWarm;
  console.log(`[bench] ${mode} warm-up ${warmUpMs} ms`, JSON.stringify(warm));

  const thinkMs = (t: DeliveryActivityType) => (mode === 'steady' ? itemCount[t] * SECONDS_PER_ITEM : STRESS_THINK_S) * 1000;
  const samples: LaunchSample[] = [];
  const recoveries: Array<{ type: DeliveryActivityType; ms: number | null }> = [];
  const pendingRecoveries: Promise<void>[] = [];
  let maxActive = 0;
  const dc = { mismatches: 0, details: [] as unknown[] };
  const warmedUp = !watch.aborted && Object.values(warm).every((w) => w !== null);
  if (warmedUp) {
    await Promise.all(types.map(async (t) => {
      const ctx = { conceptId: concepts[t], type: t };
      for (let i = 0; i < LAUNCHES && !watch.aborted; i++) {
        const readyBefore = await readyCount(studentId, concepts[t], t);
        const sample = { ...(await launch(ctx)), readyBefore };
        samples.push(sample);
        if (sample.source === 'EMERGENCY_REQUIRED') {
          console.warn(`[bench] ${mode} ${t} #${i}: EMERGENCY_REQUIRED`);
          // time to recovery: until the worker has a READY activity again (measured apart, never blocks the track)
          const t0 = Date.now();
          pendingRecoveries.push(waitFor(async () => (await readyCount(studentId, concepts[t], t)) > 0, 10 * 60_000).then((ms) => { recoveries.push({ type: t, ms: ms === null ? null : Date.now() - t0 }); }));
        }
        maxActive = Math.max(maxActive, await activeDuplicates(studentId));
        await abandon(sample.quizId);
        await sleep(thinkMs(t));
      }
      const d = await doubleClicks(ctx, 2, studentId);
      samples.push(...d.samples);
      dc.mismatches += d.mismatches; dc.details.push(...d.details); maxActive = Math.max(maxActive, d.maxActive);
    }));
  }
  await Promise.all(pendingRecoveries);
  await watch.end();

  const byType = summarize(samples);
  const jobs = await jobsByConcept(studentId, since, concepts);
  for (const t of TYPES) {
    if (blocked[t]) { byType[t] = { status: 'BLOCKED', reason: blocked[t] }; continue; }
    const xs = samples.filter((x) => x.type === t);
    byType[t] = {
      ...(byType[t] ?? {}),
      thinkSeconds: thinkMs(t) / 1000,
      launchesWithoutReady: xs.filter((x) => x.readyBefore === 0).length,
      replenishment: jobs[t],
    };
  }
  const inv = await invariants(studentId, Object.values(concepts), since, evidenceBefore);
  const ai = await benchAiUsage(studentId, since);
  const minutes = Math.max(1, (Date.now() - since.getTime()) / 60_000);
  const duplicates = maxActive + dc.mismatches + inv.DUPLICATE_DELIVERED_ITEMS;
  const row = tableRow(mode.toUpperCase(), samples, duplicates);
  const quotaReport = {
    benchAiCalls: ai.calls, aiFailures: ai.failures, rateLimitedCalls: ai.rateLimitedCalls, rateLimitedJobs: ai.rate_limited_jobs, failedJobs: ai.failed_jobs,
    peakCallsPerMinute: watch.peakPerMinute, AI_RATE_LIMIT_PRESSURE: watch.pressureEvents, maxOpenJobs: watch.maxOpenJobs,
    remainingAfter: (await quota()).remaining, aborted: watch.aborted,
    contaminated: watch.pressureEvents.length > 0 || ai.rateLimitedCalls > 0 || !!watch.aborted,
  };
  const base = {
    scenario: mode.toUpperCase(), measuredTypes: types, blocked, warmUp: { totalMs: warmUpMs, byType: warm, completed: warmedUp },
    byType, invariants: inv, idempotency: { doubleClickMismatches: dc.mismatches, maxActiveDuplicateSessions: maxActive, details: dc.details },
    quota: quotaReport, table: row,
  };
  if (mode === 'stress') {
    const inserted = Object.values(jobs).reduce((n, j) => n + j.candidatesInserted, 0);
    const generated = Object.values(jobs).reduce((n, j) => n + j.candidatesGenerated, 0);
    const neverViolated = row.hotPathAi === 0 && inv.DUPLICATE_DELIVERED_ITEMS === 0 && maxActive + dc.mismatches === 0 && inv.CORRUPT_SESSIONS === 0 && inv.EVIDENCE_WRITTEN_BY_LAUNCHES === 0;
    return {
      ...base,
      capacity: {
        emergencyRate: samples.length ? +(row.emergency / samples.length).toFixed(3) : 0,
        inventoryDepletion: Object.fromEntries(types.map((t) => [t, byType[t].launchesWithoutReady])),
        replenishmentThroughputPerMin: +(inserted / minutes).toFixed(1),
        generationThroughputPerMin: +(generated / minutes).toFixed(1),
        queueDepthMax: watch.maxOpenJobs,
        aiCost: { calls: ai.calls, providerSeconds: Math.round(ai.providerMs / 1000), models: ai.models, note: 'no token or USD accounting is persisted; cost is reported in AI calls' },
        timeToRecoveryMs: recoveries,
      },
      invariantsVerdict: neverViolated ? 'HELD' : 'VIOLATED',
    };
  }
  const gates = {
    EMERGENCY_REQUIRED: row.emergency, HOT_PATH_AI_CALLS: row.hotPathAi, DUPLICATE_ACTIVE_SESSIONS: maxActive + dc.mismatches,
    DUPLICATE_DELIVERED_ITEMS: inv.DUPLICATE_DELIVERED_ITEMS, FAILED_LAUNCHES: row.failures, P95_LAUNCH_MS: row.p95, P99_LAUNCH_MS: row.p99,
    REPLENISHMENT_AUTOMATIC: Object.values(jobs).some((j) => j.candidatesInserted > 0), CORRUPT_SESSIONS: inv.CORRUPT_SESSIONS,
    EVIDENCE_WRITTEN_BY_LAUNCHES: inv.EVIDENCE_WRITTEN_BY_LAUNCHES, LAUNCHES_COMPLETED: samples.length === types.length * (LAUNCHES + 4),
  };
  const pass = gates.EMERGENCY_REQUIRED === 0 && gates.HOT_PATH_AI_CALLS === 0 && gates.DUPLICATE_ACTIVE_SESSIONS === 0 && gates.DUPLICATE_DELIVERED_ITEMS === 0
    && gates.FAILED_LAUNCHES === 0 && gates.P95_LAUNCH_MS < 2000 && gates.P99_LAUNCH_MS < 5000 && gates.REPLENISHMENT_AUTOMATIC
    && gates.CORRUPT_SESSIONS === 0 && gates.EVIDENCE_WRITTEN_BY_LAUNCHES === 0 && gates.LAUNCHES_COMPLETED;
  return { ...base, gates, verdict: pass ? 'PASS' : 'FAIL' };
}

/** COLD: controlled drain per type -> EMERGENCY_REQUIRED with 0 AI -> queued -> worker -> READY -> served. */
async function runCold() {
  const { studentId } = await ensureLearner();
  const { concepts, types, blocked } = await ensureSteadySubject(studentId);
  await resetBenchLearner(studentId);
  const since = new Date();
  const evidenceBefore = await evidenceRows(studentId);
  const watch = new QuotaWatch();
  const out: Record<string, any> = {};
  const samples: LaunchSample[] = [];
  for (const t of TYPES) if (blocked[t]) out[t] = { status: 'BLOCKED', reason: blocked[t] };
  for (const t of types) {
    const conceptId = concepts[t];
    const reps: any[] = [];
    for (let rep = 0; rep < COLD_REPS && !watch.aborted; rep++) {
      await resetBenchLearner(studentId);
      await db.query(`UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = 'BENCH_COLD_DRAIN' WHERE student_id = $1 AND concept_id = $2 AND status IN ('PREPARING', 'READY')`, [studentId, conceptId]);
      await db.query(`UPDATE question_bank_candidates SET validation_status = 'RETIRED' WHERE student_id = $1 AND concept_id = $2 AND activity_type = $3 AND validation_status = 'VALIDATED'`, [studentId, conceptId, t]);
      const repSince = new Date();
      const miss = await launch({ conceptId, type: t });
      samples.push(miss);
      const queuedMs = await waitFor(async () => (await db.query(
        `SELECT 1 FROM generation_jobs WHERE payload->>'studentId' = $1 AND payload->>'conceptId' = $2 AND created_at >= $3`, [studentId, conceptId, repSince])).rows.length > 0, 20_000);
      const tRec = Date.now();
      const recoveredMs = await waitFor(async () => (await readyCount(studentId, conceptId, t)) > 0, 10 * 60_000, watch);
      const next = await launch({ conceptId, type: t });
      samples.push(next);
      await abandon(next.quizId);
      reps.push({
        coldLaunch: { source: miss.source, serverMs: miss.serverMs, aiCalls: miss.aiCalls },
        backgroundQueued: queuedMs !== null, queuedWithinMs: queuedMs,
        timeToRecoveryMs: recoveredMs ?? Date.now() - tRec, recovered: recoveredMs !== null,
        nextLaunch: { source: next.source, serverMs: next.serverMs, aiCalls: next.aiCalls },
        jobs: (await jobsByConcept(studentId, repSince, concepts))[t],
      });
      console.log(`[bench] cold ${t} rep ${rep + 1}/${COLD_REPS}:`, JSON.stringify(reps[reps.length - 1]));
    }
    out[t] = {
      reps,
      pass: reps.length === COLD_REPS && reps.every((r) => r.coldLaunch.source === 'EMERGENCY_REQUIRED' && r.coldLaunch.aiCalls === 0 && r.backgroundQueued && r.recovered
        && ['INVENTORY', 'BANK'].includes(r.nextLaunch.source) && r.nextLaunch.aiCalls === 0),
    };
  }
  await watch.end();
  const inv = await invariants(studentId, Object.values(concepts), since, evidenceBefore);
  const ai = await benchAiUsage(studentId, since);
  const pass = types.every((t) => out[t].pass) && inv.DUPLICATE_DELIVERED_ITEMS === 0 && inv.EVIDENCE_WRITTEN_BY_LAUNCHES === 0 && inv.CORRUPT_SESSIONS === 0;
  // the controlled misses ARE this scenario: the table counts them, the verdict requires them
  return {
    scenario: 'COLD', byType: out, invariants: inv,
    quota: { benchAiCalls: ai.calls, rateLimitedCalls: ai.rateLimitedCalls, peakCallsPerMinute: watch.peakPerMinute, AI_RATE_LIMIT_PRESSURE: watch.pressureEvents, remainingAfter: (await quota()).remaining, aborted: watch.aborted },
    table: tableRow('COLD', samples, inv.DUPLICATE_DELIVERED_ITEMS), verdict: pass ? 'PASS' : 'FAIL',
  };
}

/** HOT: deep synthetic bank created once, 3 x 100 launches + double-click pairs; the deployed worker prepares inventory. */
async function runHot() {
  const { studentId, subjectId, concepts } = await ensureLearner();
  await ensureStageEvidence(studentId, subjectId, concepts);
  const academic = await loadAcademicContext(studentId, subjectId);
  const contracts = {} as Record<DeliveryActivityType, { difficulty: { min: number; max: number; target: number }; itemCount: number }>;
  for (const t of TYPES) {
    if (t === 'TRANSFER') { contracts[t] = { difficulty: { min: 4, max: 5, target: 4 }, itemCount: 3 }; continue; }
    const m = await verifyV1PracticeLaunchMarker({ studentId, conceptId: concepts[t] });
    if (!m) throw new Error(`synthetic concept for ${t} is not at that stage`);
    contracts[t] = { difficulty: m.difficulty, itemCount: m.itemCount?.authorized ?? QUIZ_MODE_CONFIG[QUIZ_MODE_FOR_ACTIVITY[t] as QuizMode].defaultMax };
  }
  await ensureSyntheticBank(studentId, concepts, academic, contracts);
  await resetBenchLearner(studentId);
  const since = new Date();
  const evidenceBefore = await evidenceRows(studentId);
  const watch = new QuotaWatch();

  const all: LaunchSample[] = [];
  const perRun: any[] = [];
  let mismatches = 0; let maxActive = 0; const details: unknown[] = [];
  for (let run = 1; run <= RUNS && !watch.aborted; run++) {
    const samples: LaunchSample[] = [];
    for (const t of TYPES) {
      const ctx = { conceptId: concepts[t], type: t, syntheticTransfer: t === 'TRANSFER' };
      for (let i = 0; i < LAUNCHES && !watch.aborted; i++) {
        const s = await launch(ctx);
        samples.push(s);
        await abandon(s.quizId);
      }
      const d = await doubleClicks(ctx, DOUBLE_CLICK_PAIRS, studentId);
      mismatches += d.mismatches; maxActive = Math.max(maxActive, d.maxActive); details.push(...d.details);
    }
    all.push(...samples);
    perRun.push({ run, byType: summarize(samples) });
    console.log(`[bench] hot run ${run}/${RUNS} done`);
  }
  await watch.end();
  const inv = await invariants(studentId, Object.values(concepts), since, evidenceBefore);
  const row = tableRow('HOT', all, maxActive + mismatches + inv.DUPLICATE_DELIVERED_ITEMS);
  const gates = {
    HOT_PATH_AI_CALLS: row.hotPathAi, P95_LAUNCH_MS: row.p95, P99_LAUNCH_MS: row.p99, DUPLICATE_ACTIVE_SESSIONS: maxActive + mismatches,
    DUPLICATE_DELIVERED_ITEMS: inv.DUPLICATE_DELIVERED_ITEMS, FAILED_LAUNCHES: row.failures, EMERGENCY_REQUIRED: row.emergency,
    CORRUPT_SESSIONS: inv.CORRUPT_SESSIONS, EVIDENCE_WRITTEN_BY_LAUNCHES: inv.EVIDENCE_WRITTEN_BY_LAUNCHES, LAUNCHES_COMPLETED: all.length === RUNS * TYPES.length * LAUNCHES,
  };
  const pass = gates.HOT_PATH_AI_CALLS === 0 && gates.P95_LAUNCH_MS < 2000 && gates.P99_LAUNCH_MS < 5000 && gates.DUPLICATE_ACTIVE_SESSIONS === 0
    && gates.DUPLICATE_DELIVERED_ITEMS === 0 && gates.FAILED_LAUNCHES === 0 && gates.EMERGENCY_REQUIRED === 0 && gates.CORRUPT_SESSIONS === 0
    && gates.EVIDENCE_WRITTEN_BY_LAUNCHES === 0 && gates.LAUNCHES_COMPLETED;
  const ai = await benchAiUsage(studentId, since);
  return {
    scenario: 'HOT', note: 'TRANSFER uses a synthetic contract: the real engine cannot reach TRANSFER yet',
    perRun, aggregate: summarize(all), idempotency: { doubleClickMismatches: mismatches, maxActiveDuplicateSessions: maxActive, details },
    invariants: inv, quota: { benchAiCalls: ai.calls, peakCallsPerMinute: watch.peakPerMinute, AI_RATE_LIMIT_PRESSURE: watch.pressureEvents, remainingAfter: (await quota()).remaining, aborted: watch.aborted },
    table: row, gates, verdict: pass ? 'PASS' : 'FAIL',
  };
}

// ================================================================ main
async function main() {
  const fingerprint = assertDevDatabase();
  const secretFile = process.env.BENCH_SECRET_FILE;
  if (!secretFile) throw new Error('BENCH_SECRET_FILE (0600 file holding the DEV CRON_SECRET) is required');
  hosted = new Hosted(readFileSync(secretFile, 'utf-8').trim(), protectionBypassSecret());

  // alignment: the deployment under test must serve exactly this checkout's SHA
  const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  const q0 = await quota();
  const migrations = (await db.query(`SELECT count(*)::int AS n, max(version) AS latest FROM schema_migrations`)).rows[0];
  const alignment = {
    localSha, deployedSha: q0.commitSha, functionRegion: q0.region, databaseFingerprint: fingerprint,
    databaseRegion: new URL(process.env.DATABASE_URL!).hostname.match(/\.([a-z]+-[a-z]+-\d)\.aws/)?.[1] ?? null, migrations,
  };
  console.log('[bench] alignment', JSON.stringify(alignment));
  if (q0.commitSha !== localSha) throw new Error(`deployment serves ${q0.commitSha}, checkout is ${localSha}`);

  const outDir = process.env.BENCH_OUT_DIR ?? 'bench-out';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'alignment.json'), JSON.stringify(alignment, null, 2));
  const scenarios = (argv('scenarios') ?? 'steady,cold,hot,stress').split(',');
  const table: unknown[] = [];
  for (const sc of scenarios) {
    try {
      await guardQuota(sc);
    } catch (e) {
      if (e instanceof QuotaPause) { console.log(`[bench] ${e.message}`); writeFileSync(join(outDir, `${sc}.json`), JSON.stringify({ scenario: sc, status: 'PAUSED', reason: e.message }, null, 2)); break; }
      throw e;
    }
    const result: any = sc === 'steady' ? await runSteadyLike('steady') : sc === 'stress' ? await runSteadyLike('stress') : sc === 'cold' ? await runCold() : await runHot();
    const { studentId } = await ensureLearner();
    result.benchJobsClosedAtEnd = await closeBenchJobs(studentId, 'BENCH_SCENARIO_END');
    writeFileSync(join(outDir, `${sc}.json`), JSON.stringify(result, null, 2));
    if (result.quota?.aborted) { console.log(`[bench] STOPPED after ${sc}: ${result.quota.aborted}`); break; }
    table.push({ ...result.table, verdict: result.verdict ?? `invariants ${result.invariantsVerdict}` });
    console.log(`[bench] ${sc} done:`, JSON.stringify({ verdict: result.verdict ?? `invariants ${result.invariantsVerdict}`, table: result.table, quota: result.quota }));
  }
  writeFileSync(join(outDir, 'table.json'), JSON.stringify(table, null, 2));
  console.log('[bench] TABLE', JSON.stringify(table));
  await db.end?.();
}

main().catch((e) => {
  console.error('[bench] FAILED', e instanceof Error ? e.message : e);
  process.exit(1);
});
