/**
 * LEARNING_ACTIVITY_DELIVERY benchmark -- reproducible launch-latency and
 * integrity gates, run against the DEV database only (fingerprint-guarded).
 *
 *   npx tsx --env-file=.env.local scripts/bench-activity-delivery.ts [--runs=3] [--launches=20]
 *
 * Setup (idempotent): one clearly-labelled SYNTHETIC learner
 * (clerk_id 'bench:activity-delivery', email @studyus.invalid) with one
 * concept per canonical stage, placed there by synthetic evidence, and a
 * SYNTHETIC VALIDATED bank (generator 'BENCHMARK_SYNTHETIC') -- no AI calls,
 * no real learner touched.
 *
 * Each launch runs the route's hot path in-process: canonical authorization
 * (verifyV1PracticeLaunchMarker -- the real engine decision) -> academic
 * context -> deliverCanonicalActivity (resume / inventory / bank / session).
 * Clerk session verification (network to Clerk) is outside this process
 * and not measured. TRANSFER cannot be authorized from real evidence today
 * (RETAIN evidence is never marked novel -- see the report), so its launches
 * use the real decision call for timing plus a synthetic TRANSFER contract.
 * Between launches the session is abandoned (status 'expired', no evidence),
 * and on odd launches the background worker prepares inventory first, so
 * both the INVENTORY and the BANK paths are measured.
 *
 * Gates: HOT_PATH_AI_CALLS = 0, P95 < 2 s, P99 < 5 s,
 * DUPLICATE_ACTIVE_SESSIONS = 0, FAILED_LAUNCHES = 0.
 */
import { createHash } from 'crypto';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { db } from '@/lib/db';
import { verifyV1PracticeLaunchMarker, getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision';
import { runWithAiMetrics, currentAiCallCount } from '@/lib/ai/request-metrics';
import { deliverCanonicalActivity, type DeliveryInput } from '@/services/activity-delivery.service';
import { loadAcademicContext } from '@/services/activity-delivery-context.service';
import { addValidatedCandidates } from '@/services/question-bank.service';
import { runGenerationWorker, type JobHandler } from '@/services/generation-queue.service';
import { prepareInventoryHandler, runDeliveryWorker, scheduleDeliveryReplenishment } from '@/services/activity-delivery-worker.service';
import { STAGE_FOR_ACTIVITY, inventoryTarget, SPARE_ASSEMBLABLE_SETS, type ActivityContract } from '@/lib/activity-delivery/contract';
import { countSpareSets } from '@/services/activity-assembly.service';
import { reservedCandidateIds } from '@/services/activity-inventory.service';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';
import type { DeliveryActivityType, AcademicContext } from '@/lib/activity-delivery/contract';
import { QUIZ_MODE_FOR_ACTIVITY } from '@/lib/activity-delivery/contract';
import type { QuizMode, QuizSessionV1Marker } from '@/services/quiz-persistence.service';

const DEV_FINGERPRINT = '2a29b99ee14a22b4';
const arg = (name: string, dflt: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt);
const RUNS = arg('runs', 3);
const LAUNCHES = arg('launches', 20);
const DOUBLE_CLICK_PAIRS = 5;
const TYPES: DeliveryActivityType[] = ['LEARN_CHECK', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'];
const LANGUAGE = 'es';

function assertDev() {
  const url = new URL(process.env.DATABASE_URL!);
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV_FINGERPRINT) throw new Error(`Refusing to run: database fingerprint ${fp} is not DEV`);
}

// ---------------------------------------------------------------- setup
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

async function ensureBank(studentId: string, subjectId: string, concepts: Record<DeliveryActivityType, string>, academic: AcademicContext, contracts: Record<DeliveryActivityType, { difficulty: { min: number; max: number; target: number }; itemCount: number }>) {
  for (const t of TYPES) {
    const conceptId = concepts[t];
    const perLaunch = contracts[t].itemCount;
    // enough NEVER-DELIVERED candidates for every launch + double click + the READY sets the worker reserves
    const need = (RUNS * LAUNCHES + DOUBLE_CLICK_PAIRS * RUNS + 10) * perLaunch;
    const undelivered = (await db.query(
      `SELECT count(*)::int n FROM question_bank_candidates c WHERE c.concept_id = $1 AND c.activity_type = $2 AND c.generator_model = 'BENCHMARK_SYNTHETIC'
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
    console.log(`[bench] bank ${t}: +${need - undelivered} synthetic candidates (${need} undelivered)`);
  }
}

// ---------------------------------------------------------------- launch
interface LaunchSample { type: DeliveryActivityType; ms: number; source: string; aiCalls: number; authMs: number; decisionMs: number; timings: Record<string, number>; quizId: string | null; error?: string }

const TRANSFER_MARKER = (policyVersion: string, canonicalRevision: string): QuizSessionV1Marker => ({
  pedagogicalPolicyVersion: policyVersion as never, canonicalRevision, canonicalStage: 'TRANSFER' as never, canonicalActivityType: 'TRANSFER' as never,
  itemCount: { min: 3, max: 3, authorized: 3 }, difficulty: { min: 4, max: 5, target: 4 }, assistanceAllowed: false, independence: true,
  supportLevel: 'NONE', minimumScorePercent: 80,
});

async function launchOnce(ctx: { studentId: string; subjectId: string; conceptId: string; type: DeliveryActivityType; academic: AcademicContext; realTransfer?: boolean }): Promise<LaunchSample> {
  const quizMode = QUIZ_MODE_FOR_ACTIVITY[ctx.type] as QuizMode;
  return runWithAiMetrics(`BENCH launch ${ctx.type}`, async () => {
    const t0 = Date.now();
    try {
      // authorization: the ownership read the route performs (Clerk session verification is outside this process)
      await db.query(`SELECT id FROM students WHERE id = $1`, [ctx.studentId]);
      const authMs = Date.now() - t0;
      const t1 = Date.now();
      let marker: QuizSessionV1Marker | null;
      if (ctx.type === 'TRANSFER' && !ctx.realTransfer) {
        const { decision } = await getCanonicalPedagogicalDecision({ studentId: ctx.studentId, conceptId: ctx.conceptId });
        marker = TRANSFER_MARKER(decision.policyVersion, decision.canonicalRevision);
      } else {
        marker = (await verifyV1PracticeLaunchMarker({ studentId: ctx.studentId, conceptId: ctx.conceptId })) as QuizSessionV1Marker | null;
      }
      const decisionMs = Date.now() - t1;
      if (!marker) throw new Error('NOT_AUTHORIZED_FOR_STAGE');
      const input: DeliveryInput = {
        studentId: ctx.studentId, subjectId: ctx.subjectId, conceptId: ctx.conceptId, quizMode, activityType: ctx.type, academic: ctx.academic,
        v1Marker: marker, canonicalRevision: marker.canonicalRevision,
        contract: {
          conceptId: ctx.conceptId, activityType: ctx.type, language: LANGUAGE, academic: ctx.academic, difficulty: marker.difficulty,
          itemCount: marker.itemCount?.authorized ?? QUIZ_MODE_CONFIG[quizMode].defaultMax, independence: marker.independence, policyVersion: marker.pedagogicalPolicyVersion,
        },
      };
      const r = await deliverCanonicalActivity(input);
      const ai = currentAiCallCount();
      if (r.status !== 'DELIVERED') {
        await r.lock.release();
        return { type: ctx.type, ms: Date.now() - t0, source: 'EMERGENCY_REQUIRED', aiCalls: ai.executions + ai.providerCalls, authMs, decisionMs, timings: r.timings as never, quizId: null, error: 'BANK_SHORT' };
      }
      return { type: ctx.type, ms: Date.now() - t0, source: r.source, aiCalls: ai.executions + ai.providerCalls, authMs, decisionMs, timings: r.timings as never, quizId: r.quizId };
    } catch (error) {
      const ai = currentAiCallCount();
      return { type: ctx.type, ms: Date.now() - t0, source: 'FAILED', aiCalls: ai.executions + ai.providerCalls, authMs: 0, decisionMs: 0, timings: {}, quizId: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

const abandon = (quizId: string | null) => (quizId ? db.query(`UPDATE quiz_sessions SET status = 'expired' WHERE id = $1`, [quizId]) : Promise.resolve());
const skipBankJobs: JobHandler = async () => ({ ok: true, result: { skipped: 'benchmark: synthetic bank, no AI generation' } });

async function activeDuplicates(studentId: string): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int n FROM (
       SELECT concept_id, quiz_mode FROM quiz_sessions WHERE student_id = $1 AND status = 'active' AND expires_at > now()
       GROUP BY concept_id, quiz_mode HAVING count(*) > 1) d`,
    [studentId],
  );
  return r.rows[0].n;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function runHot() {
  const { studentId, subjectId, concepts } = await ensureLearner();
  await ensureStageEvidence(studentId, subjectId, concepts);
  const academic = await loadAcademicContext(studentId, subjectId);

  // contracts per stage from the real engine (TRANSFER: synthetic, see header)
  const contracts = {} as Record<DeliveryActivityType, { difficulty: { min: number; max: number; target: number }; itemCount: number }>;
  for (const t of TYPES) {
    if (t === 'TRANSFER') { contracts[t] = { difficulty: { min: 4, max: 5, target: 4 }, itemCount: 3 }; continue; }
    const m = await verifyV1PracticeLaunchMarker({ studentId, conceptId: concepts[t] });
    if (!m) throw new Error(`synthetic concept for ${t} is not at that stage`);
    const quizMode = QUIZ_MODE_FOR_ACTIVITY[t] as QuizMode;
    contracts[t] = { difficulty: m.difficulty, itemCount: m.itemCount?.authorized ?? QUIZ_MODE_CONFIG[quizMode].defaultMax };
  }
  await ensureBank(studentId, subjectId, concepts, academic, contracts);
  // start clean: no open sessions / queue jobs from earlier runs
  await resetBenchLearner(studentId);

  const all: LaunchSample[] = [];
  const runsReport: any[] = [];
  let doubleClickMismatches = 0;
  const mismatchDetails: Array<Record<string, unknown>> = [];
  let maxActiveDuplicates = 0;
  for (let run = 1; run <= RUNS; run++) {
    const samples: LaunchSample[] = [];
    for (const t of TYPES) {
      const ctx = { studentId, subjectId, conceptId: concepts[t], type: t, academic };
      for (let i = 0; i < LAUNCHES; i++) {
        if (i % 2 === 1) {
          // background replenishment between launches (not timed): the worker prepares READY inventory
          await runGenerationWorker({ PREPARE_INVENTORY: prepareInventoryHandler, BANK_REPLENISH: skipBankJobs }, { onlyStudentId: studentId, maxJobs: 10, concurrency: 2 });
        }
        const s = await launchOnce(ctx);
        samples.push(s);
        await abandon(s.quizId);
      }
      // idempotency: concurrent double clicks must yield ONE session
      for (let k = 0; k < DOUBLE_CLICK_PAIRS; k++) {
        const [a, b] = await Promise.all([launchOnce(ctx), launchOnce(ctx)]);
        if (!a.quizId || a.quizId !== b.quizId) {
          doubleClickMismatches++;
          mismatchDetails.push({ run, type: t, a: { source: a.source, quizId: a.quizId, error: a.error ?? null }, b: { source: b.source, quizId: b.quizId, error: b.error ?? null } });
        }
        maxActiveDuplicates = Math.max(maxActiveDuplicates, await activeDuplicates(studentId));
        await abandon(a.quizId);
        if (b.quizId !== a.quizId) await abandon(b.quizId);
      }
    }
    all.push(...samples);
    runsReport.push({ run, ...summarize(samples) });
    console.log(`[bench] run ${run}/${RUNS} done`);
  }

  const report = {
    environment: 'DEV (Neon) from a local runner -- includes laptop->Neon network latency',
    runs: RUNS, launchesPerTypePerRun: LAUNCHES, doubleClickPairsPerTypePerRun: DOUBLE_CLICK_PAIRS,
    perRun: runsReport,
    aggregate: summarize(all),
    idempotency: { doubleClickMismatches, maxActiveDuplicateSessions: maxActiveDuplicates, mismatchDetails },
  };
  const gates = {
    HOT_PATH_AI_CALLS: all.reduce((n, s) => n + s.aiCalls, 0),
    P95_LAUNCH_MS: pct(all.filter((s) => s.quizId).map((s) => s.ms), 95),
    P99_LAUNCH_MS: pct(all.filter((s) => s.quizId).map((s) => s.ms), 99),
    DUPLICATE_ACTIVE_SESSIONS: maxActiveDuplicates + doubleClickMismatches,
    FAILED_LAUNCHES: all.filter((s) => !s.quizId).length,
  };
  const pass = gates.HOT_PATH_AI_CALLS === 0 && gates.P95_LAUNCH_MS < 2000 && gates.P99_LAUNCH_MS < 5000 && gates.DUPLICATE_ACTIVE_SESSIONS === 0 && gates.FAILED_LAUNCHES === 0;
  const out = { ...report, gates, verdict: pass ? 'PASS' : 'FAIL', generatedAt: new Date().toISOString() };
  console.log(JSON.stringify({ scenario: 'HOT', gates, verdict: out.verdict, aggregate: out.aggregate.byType }, null, 1));
  return { scenario: 'HOT', ...out };
}

function summarize(samples: LaunchSample[]) {
  const byType: Record<string, any> = {};
  for (const t of TYPES) {
    const xs = samples.filter((s) => s.type === t);
    const ok = xs.filter((s) => s.quizId);
    const ms = ok.map((s) => s.ms);
    const count = (src: string) => xs.filter((s) => s.source === src).length;
    const avg = (f: (s: LaunchSample) => number) => (ok.length ? Math.round(ok.reduce((n, s) => n + f(s), 0) / ok.length) : 0);
    byType[t] = {
      launches: xs.length,
      p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: ms.length ? Math.max(...ms) : 0,
      inventoryHitRate: xs.length ? +(count('INVENTORY') / xs.length).toFixed(2) : 0,
      bankAssemblyRate: xs.length ? +(count('BANK') / xs.length).toFixed(2) : 0,
      resumed: count('RESUMED'),
      emergencyColdMisses: count('EMERGENCY_REQUIRED'),
      aiCallsInHotPath: xs.reduce((n, s) => n + s.aiCalls, 0),
      failedLaunches: xs.filter((s) => !s.quizId).length,
      avgStageMs: {
        authorization: avg((s) => s.authMs), decision: avg((s) => s.decisionMs), lock: avg((s) => s.timings.lockMs ?? 0), resume: avg((s) => s.timings.resumeMs ?? 0),
        inventory: avg((s) => s.timings.inventoryMs ?? 0), bank: avg((s) => s.timings.bankMs ?? 0), session: avg((s) => s.timings.sessionMs ?? 0),
      },
      errors: [...new Set(xs.filter((s) => s.error).map((s) => s.error))],
    };
  }
  return { byType };
}

// ================================================================ STEADY STATE / COLD MISS
// A second, REAL subject of the same synthetic learner: real concept labels,
// an EMPTY bank at first creation, and every candidate produced by the REAL
// background worker (BANK_REPLENISH -> certified generators, real AI). The
// benchmark never inserts or tops up candidates here. TRANSFER is reached
// through the real engine: the synthetic RETAIN evidence carries the
// submit-time `novel` stamp a certified attempt receives.
const STEADY_TOPICS: Record<DeliveryActivityType, string> = {
  LEARN_CHECK: 'Porcentajes', PRACTICE: 'Proporcionalidad directa', PROVE: 'Ecuaciones lineales',
  RETAIN: 'Área de figuras planas', TRANSFER: 'Regla de tres simple',
};
const THINK_MS = arg('think', 30) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // TRANSFER concept: a certified (novel) retention check after the Prove
  const tc = concepts.TRANSFER;
  const has = await db.query(`SELECT 1 FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 AND metadata->>'activityType' = 'RETENTION_CHECK' AND metadata->>'bench' = 'true'`, [studentId, tc]);
  if (!has.rows[0]) {
    await db.query(
      `INSERT INTO learning_evidence (student_id, concept_id, subject_id, source_type, result, difficulty, "timestamp", learning_mode, hints_used, ai_assistance_type, metadata, score_percent)
       VALUES ($1, $2, $3, 'SOLO_VERIFICATION', 'correct', 3, $4, 'SOLO', 0, 'NONE', $5, 90)`,
      [studentId, tc, subjectId, daysAgo(1), JSON.stringify({ bench: 'true', activityType: 'RETENTION_CHECK', itemCount: 10, correctCount: 9, novel: 'true' })],
    );
  }
  // Only types the REAL engine launches are measured. TRANSFER is reported
  // BLOCKED (not simulated) while retention evidence cannot unlock it.
  const types: DeliveryActivityType[] = [];
  const blocked: Record<string, string> = {};
  for (const t of TYPES) {
    const m = await verifyV1PracticeLaunchMarker({ studentId, conceptId: concepts[t] });
    const at = m?.canonicalActivityType ?? 'no launchable activity';
    if (at === ({ LEARN_CHECK: 'LEARN_CHECK', PRACTICE: 'PRACTICE', PROVE: 'PROVE', RETAIN: 'RETENTION_CHECK', TRANSFER: 'TRANSFER' } as const)[t]) types.push(t);
    else if (t === 'TRANSFER') blocked[t] = `real engine resolves ${at} after a certified retention check (RETAIN evidence is not read as novel yet)`;
    else throw new Error(`steady concept for ${t} is at ${at} (real engine)`);
  }
  return { subjectId, concepts, types, blocked, academic: await loadAcademicContext(studentId, subjectId) };
}

/** The background worker, as after()/cron drive it: this learner's queue only, AI calls counted apart from launches. */
function startWorkerLoop(studentId: string) {
  const stats = { runs: 0, processed: 0, succeeded: 0, retried: 0, failed: 0, backgroundAiCalls: 0, maxOpenDuplicateKeys: 0 };
  let stop = false;
  const done = (async () => {
    while (!stop) {
      const r = await runWithAiMetrics('BENCH background worker', async () => {
        const w = await runDeliveryWorker({ onlyStudentId: studentId, maxJobs: 10, concurrency: 5, deadlineMs: 240_000 });
        const ai = currentAiCallCount();
        return { w, ai: ai.executions + ai.providerCalls };
      });
      stats.runs++; stats.processed += r.w.processed; stats.succeeded += r.w.succeeded; stats.retried += r.w.retried; stats.failed += r.w.failed; stats.backgroundAiCalls += r.ai;
      const dup = await db.query(`SELECT count(*)::int n FROM (SELECT dedup_key FROM generation_jobs WHERE status IN ('PENDING','RUNNING') GROUP BY dedup_key HAVING count(*) > 1) d`);
      stats.maxOpenDuplicateKeys = Math.max(stats.maxOpenDuplicateKeys, dup.rows[0].n);
      if (r.w.processed === 0) await sleep(2000);
    }
  })();
  return { stats, stop: async () => { stop = true; await done; } };
}

/**
 * Benchmark learner ONLY: close queue jobs an interrupted earlier run left
 * open (their leases would otherwise read as generation in flight), and with
 * `emptyConcepts` start those concepts from an empty bank and no inventory.
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

type WorkerStats = ReturnType<typeof startWorkerLoop>['stats'];

/** Runs the worker loop in a child process (this script, `--scenario=worker-loop`); stop() returns its stats. */
function startWorkerProcess(studentId: string) {
  const statsFile = join(tmpdir(), `bench-worker-${process.pid}-${Date.now()}.json`);
  const child = spawn('npx', ['tsx', '--tsconfig', 'tsconfig.json', process.argv[1], '--scenario=worker-loop', `--student=${studentId}`, `--stats=${statsFile}`], {
    env: process.env, stdio: ['ignore', 'inherit', 'inherit'],
  });
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  return {
    async stop(): Promise<WorkerStats> {
      child.kill('SIGTERM');
      await exited;
      const stats = JSON.parse(readFileSync(statsFile, 'utf-8')) as WorkerStats;
      rmSync(statsFile, { force: true });
      return stats;
    },
  };
}

/** `--scenario=worker-loop`: the child side of startWorkerProcess. */
async function runWorkerLoopProcess() {
  const studentId = process.argv.find((a) => a.startsWith('--student='))!.split('=')[1];
  const statsFile = process.argv.find((a) => a.startsWith('--stats='))!.split('=')[1];
  const loop = startWorkerLoop(studentId);
  const stop = async () => {
    await loop.stop();
    writeFileSync(statsFile, JSON.stringify(loop.stats));
    await db.end?.();
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop());
  await new Promise(() => {});
}

const readyCount = async (studentId: string, conceptId: string, t: DeliveryActivityType) =>
  (await db.query(`SELECT count(*)::int n FROM canonical_prepared_activity WHERE student_id = $1 AND concept_id = $2 AND stage = $3 AND status = 'READY'`, [studentId, conceptId, STAGE_FOR_ACTIVITY[t]])).rows[0].n as number;

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await cond()) return Date.now() - t0;
    await sleep(2000);
  }
  return null;
}

async function jobsByConcept(studentId: string, since: Date, concepts: Record<DeliveryActivityType, string>) {
  const r = await db.query(
    `SELECT payload->>'conceptId' AS concept, kind, status, count(*)::int n FROM generation_jobs
      WHERE payload->>'studentId' = $1 AND created_at >= $2 GROUP BY 1, 2, 3`,
    [studentId, since],
  );
  const out = {} as Record<DeliveryActivityType, Record<string, number>>;
  for (const t of TYPES) {
    out[t] = {};
    for (const row of r.rows.filter((x) => x.concept === concepts[t])) out[t][`${row.kind}:${row.status}`] = row.n;
  }
  return out;
}

/** Independent-check candidates delivered in more than one session, among those delivered during this scenario. */
async function integrity(studentId: string, concepts: Record<DeliveryActivityType, string>, since: Date) {
  const redelivered = await db.query(
    `SELECT c.activity_type, count(*)::int n FROM (
       SELECT d.candidate_id FROM question_bank_deliveries d GROUP BY d.candidate_id
       HAVING count(*) > 1 AND max(d.delivered_at) >= $3) x
       JOIN question_bank_candidates c ON c.id = x.candidate_id
      WHERE c.student_id = $1 AND c.concept_id = ANY($2::uuid[]) AND c.activity_type IN ('PROVE', 'RETAIN', 'TRANSFER')
      GROUP BY 1`,
    [studentId, Object.values(concepts), since],
  );
  const bankDupes = await db.query(
    `SELECT count(*)::int n FROM (SELECT concept_id, activity_type, language, content_fingerprint FROM question_bank_candidates
      WHERE student_id = $1 GROUP BY 1, 2, 3, 4 HAVING count(*) > 1) d`,
    [studentId],
  );
  return { independentCandidatesRedelivered: Object.fromEntries(redelivered.rows.map((r) => [r.activity_type, r.n])), duplicateBankContent: bankDupes.rows[0].n };
}

async function runSteady() {
  const { studentId } = await ensureLearner();
  const { subjectId, concepts, academic, types, blocked } = await ensureSteadySubject(studentId);
  // from zero: empty bank + no inventory; everything below is produced by the real worker
  await resetBenchLearner(studentId, Object.values(concepts));
  const since = new Date();
  // the background worker runs in its OWN process (own pool, own event loop), as the protected
  // worker endpoint runs in its own invocation -- launches never share a process with AI generation here
  const worker = startWorkerProcess(studentId);

  // warm-up: the REAL triggers queue preparation; the REAL worker fills bank + inventory (no seeding)
  const tWarm = Date.now();
  for (const t of types) await scheduleDeliveryReplenishment({ studentId, subjectId, conceptId: concepts[t] }, { kickWorker: false, language: LANGUAGE });
  // "start with sufficient inventory": every type at its POLICY targets -- READY inventory and
  // SPARE_ASSEMBLABLE_SETS complete sets assemblable beyond it -- reached by the real worker
  const warm: Record<string, number | null> = {};
  await Promise.all(types.map(async (t) => {
    const m = (await verifyV1PracticeLaunchMarker({ studentId, conceptId: concepts[t] }))!;
    const quizMode = QUIZ_MODE_FOR_ACTIVITY[t] as QuizMode;
    const contract: ActivityContract = {
      conceptId: concepts[t], activityType: t, language: LANGUAGE, academic, difficulty: m.difficulty,
      itemCount: m.itemCount?.authorized ?? QUIZ_MODE_CONFIG[quizMode].defaultMax, independence: m.independence, policyVersion: m.pedagogicalPolicyVersion,
    };
    warm[t] = await waitFor(async () =>
      (await readyCount(studentId, concepts[t], t)) >= inventoryTarget(t)
      && (await countSpareSets({ studentId, contract, academic, reservedCandidateIds: await reservedCandidateIds(studentId, concepts[t]), maxSets: SPARE_ASSEMBLABLE_SETS })) >= SPARE_ASSEMBLABLE_SETS, 15 * 60_000);
  }));
  const warmUpMs = Date.now() - tWarm;
  console.log(`[bench] steady warm-up ${warmUpMs} ms`, JSON.stringify(warm));

  // one learner track per activity type, concurrently; a launch every THINK_MS; the worker keeps running
  const samples: (LaunchSample & { readyBefore: number })[] = [];
  let maxActiveDuplicates = 0;
  let doubleClickMismatches = 0;
  await Promise.all(types.map(async (t) => {
    const ctx = { studentId, subjectId, conceptId: concepts[t], type: t, academic, realTransfer: true };
    for (let i = 0; i < LAUNCHES; i++) {
      const readyBefore = await readyCount(studentId, concepts[t], t);
      const s = await launchOnce(ctx);
      samples.push({ ...s, readyBefore });
      if (s.source === 'EMERGENCY_REQUIRED') console.warn(`[bench] steady ${t} #${i}: EMERGENCY_REQUIRED`);
      maxActiveDuplicates = Math.max(maxActiveDuplicates, await activeDuplicates(studentId));
      await abandon(s.quizId);
      await sleep(THINK_MS);
    }
    for (let k = 0; k < 2; k++) {
      const [a, b] = await Promise.all([launchOnce(ctx), launchOnce(ctx)]);
      if (!a.quizId || a.quizId !== b.quizId) doubleClickMismatches++;
      await abandon(a.quizId);
      if (b.quizId !== a.quizId) await abandon(b.quizId);
      await sleep(THINK_MS);
    }
  }));
  const workerStats = await worker.stop();

  const summary = summarize(samples);
  const jobs = await jobsByConcept(studentId, since, concepts);
  for (const t of TYPES) {
    if (blocked[t]) { summary.byType[t] = { status: 'BLOCKED', reason: blocked[t] }; continue; }
    const xs = samples.filter((s) => s.type === t);
    Object.assign(summary.byType[t], {
      replenishmentJobs: jobs[t],
      minReadyBeforeLaunch: Math.min(...xs.map((s) => s.readyBefore)),
      launchesWithoutReady: xs.filter((s) => s.readyBefore === 0).length,
    });
  }
  const ok = samples.filter((s) => s.quizId).map((s) => s.ms);
  const gates = {
    HOT_PATH_AI_CALLS: samples.reduce((n, s) => n + s.aiCalls, 0),
    P95_LAUNCH_MS: pct(ok, 95),
    P99_LAUNCH_MS: pct(ok, 99),
    DUPLICATE_ACTIVE_SESSIONS: maxActiveDuplicates + doubleClickMismatches,
    FAILED_LAUNCHES: samples.filter((s) => s.source === 'FAILED').length,
    EMERGENCY_IN_NORMAL_OPERATION: samples.filter((s) => s.source === 'EMERGENCY_REQUIRED').length,
    QUEUE_DUPLICATE_OPEN_JOBS: workerStats.maxOpenDuplicateKeys,
  };
  const integ = await integrity(studentId, concepts, since);
  const pass = gates.HOT_PATH_AI_CALLS === 0 && gates.P95_LAUNCH_MS < 2000 && gates.P99_LAUNCH_MS < 5000 && gates.DUPLICATE_ACTIVE_SESSIONS === 0
    && gates.FAILED_LAUNCHES === 0 && gates.EMERGENCY_IN_NORMAL_OPERATION === 0 && gates.QUEUE_DUPLICATE_OPEN_JOBS === 0
    && integ.duplicateBankContent === 0 && Object.keys(integ.independentCandidatesRedelivered).length === 0;
  const out = { scenario: 'STEADY_STATE', measuredTypes: types, blocked, thinkMs: THINK_MS, launchesPerType: LAUNCHES, warmUp: { totalMs: warmUpMs, firstReadyMsByType: warm }, worker: { process: 'separate', ...workerStats }, ...summary, integrity: integ, gates, verdict: pass ? 'PASS' : 'FAIL' };
  console.log(JSON.stringify(out, null, 1));
  return out;
}

/**
 * TRUE COLD MISS, per activity type: the controlled contract's READY
 * inventory and its whole VALIDATED bank are drained (bench learner only),
 * the launch must return EMERGENCY_REQUIRED with 0 AI calls and queue
 * replenishment; the worker then recovers and the next launch is served.
 */
async function runCold() {
  const { studentId } = await ensureLearner();
  const { subjectId, concepts, academic, types, blocked } = await ensureSteadySubject(studentId);
  const REPS = arg('coldReps', 2);
  await resetBenchLearner(studentId);
  const out: Record<string, any> = {};
  for (const t of TYPES) if (blocked[t]) out[t] = { status: 'BLOCKED', reason: blocked[t] };
  for (const t of types) {
    const conceptId = concepts[t];
    const reps: any[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      // quiesce this learner's queue first, so the drain is the only change
      await runDeliveryWorker({ onlyStudentId: studentId, maxJobs: 30, concurrency: 5 });
      await db.query(`UPDATE quiz_sessions SET status = 'expired' WHERE student_id = $1 AND status = 'active'`, [studentId]);
      await db.query(`UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = 'BENCH_COLD_DRAIN' WHERE student_id = $1 AND concept_id = $2 AND status IN ('PREPARING', 'READY')`, [studentId, conceptId]);
      await db.query(`UPDATE question_bank_candidates SET validation_status = 'RETIRED' WHERE student_id = $1 AND concept_id = $2 AND activity_type = $3 AND validation_status = 'VALIDATED'`, [studentId, conceptId, t]);
      const since = new Date();
      const ctx = { studentId, subjectId, conceptId, type: t, academic, realTransfer: true };

      const miss = await launchOnce(ctx);
      const queuedMs = await waitFor(async () => (await db.query(
        `SELECT 1 FROM generation_jobs WHERE payload->>'studentId' = $1 AND payload->>'conceptId' = $2 AND created_at >= $3`, [studentId, conceptId, since])).rows.length > 0, 20_000);

      const worker = startWorkerLoop(studentId);
      const tRec = Date.now();
      const recoveredMs = await waitFor(async () => (await readyCount(studentId, conceptId, t)) > 0, 10 * 60_000);
      await worker.stop();
      const next = await launchOnce(ctx);
      await abandon(next.quizId);
      reps.push({
        coldLaunch: { source: miss.source, ms: miss.ms, aiCalls: miss.aiCalls, error: miss.error ?? null },
        backgroundQueued: queuedMs !== null, queuedWithinMs: queuedMs,
        recovery: { readyAfterMs: recoveredMs ?? (Date.now() - tRec), recovered: recoveredMs !== null, worker: worker.stats },
        nextLaunch: { source: next.source, ms: next.ms, aiCalls: next.aiCalls, error: next.error ?? null },
        jobs: (await jobsByConcept(studentId, since, concepts))[t],
      });
      console.log(`[bench] cold ${t} rep ${rep + 1}/${REPS}:`, JSON.stringify(reps[reps.length - 1]));
    }
    out[t] = {
      reps,
      pass: reps.every((r) => r.coldLaunch.source === 'EMERGENCY_REQUIRED' && r.coldLaunch.aiCalls === 0 && r.backgroundQueued && r.recovery.recovered
        && ['INVENTORY', 'BANK'].includes(r.nextLaunch.source) && r.nextLaunch.aiCalls === 0),
    };
  }
  const verdict = types.every((t) => out[t].pass) ? 'PASS' : 'FAIL';
  console.log(JSON.stringify({ scenario: 'COLD_MISS', verdict }, null, 1));
  return { scenario: 'COLD_MISS', byType: out, verdict };
}

async function main() {
  assertDev();
  const scenario = (process.argv.find((a) => a.startsWith('--scenario='))?.split('=')[1] ?? 'hot').toLowerCase();
  if (scenario === 'worker-loop') return runWorkerLoopProcess();
  const results: Record<string, unknown> = {};
  if (scenario === 'hot' || scenario === 'all') results.hot = await runHot();
  if (scenario === 'steady' || scenario === 'all') results.steady = await runSteady();
  if (scenario === 'cold' || scenario === 'all') results.cold = await runCold();
  const file = process.env.BENCH_OUT ?? 'bench-activity-delivery.json';
  writeFileSync(file, JSON.stringify(results, null, 2));
  await db.end?.();
}

main().catch((e) => {
  console.error('[bench] FAILED', e);
  process.exit(1);
});
