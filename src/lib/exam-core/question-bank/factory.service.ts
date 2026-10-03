/**
 * Question Bank Factory -- the bounded, resumable FACTORY RUN.
 *
 *   1. calculate health (live bank -> snapshot);
 *   2. choose the highest-value gaps -> bounded queue entries (idempotent);
 *   3. claim requests one by one and, within budget, generate a small batch,
 *      validate every candidate (deterministic first, independent AI only
 *      where needed), repair once at most, and land accepted items in PILOT;
 *   4. stop cleanly at the daily budget, the per-run cap, the shared-AI
 *      reserve, a provider rate limit or the deadline -- the queue resumes on
 *      the next run;
 *   5. recompute health and record the coverage delta.
 *
 * Disabled unless QUESTION_BANK_FACTORY_ENABLED=true. One run at a time
 * (unique RUNNING row). Never called from a Student request.
 */
import { createHash, randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { aiVolumeLimits } from '@/lib/ai/operational-limits';
import { ComponentDefinitionSchema, componentDefinitionForAI } from '../component-definition';
import { adapterFor } from './adapters';
import { gatewayFactoryAI, type AICallUsage, type FactoryAI } from './ai-runner';
import { createGeneratedItem, createNextVersion, ensureBankIdentities, recordValidationReport, transitionVersion } from './bank.service';
import { refreshItemStats } from './calibration.service';
import type { BankHealth } from './health';
import { listBankVersions, loadVersionHealthInputs, refreshVersionHealth, type VersionHealthInputs } from './health.service';
import { budgetStop, factoryConfig, type BudgetState, type BudgetStop, type FactoryConfig } from './policy';
import { candidateToContent, type GeneratedCandidate, type GenerationContext } from './prompts';
import { addRequestCounters, cellSpecFor, claimNextRequest, completeRequest, deferRequest, enqueueGaps, reclaimExpiredLeases, releaseRequest, type GenerationRequest } from './queue.service';
import { judgeValidatorVerdict, runDeterministicValidation, type CellSpec, type ExistingItemText, type ValidationIssue } from './validation';

export type RunStatus = 'COMPLETED' | 'STOPPED_BUDGET' | 'STOPPED_RESERVE' | 'STOPPED_RATE_LIMIT' | 'STOPPED_MAX_PER_RUN' | 'STOPPED_DEADLINE' | 'FAILED' | 'SKIPPED_DISABLED' | 'SKIPPED_LOCKED';

export interface RunCounters {
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  candidates: number;
  validated: number;
  accepted: number;
  rejected: number;
  repaired: number;
  reviewRequired: number;
  promoted: number;
  rateLimitEvents: number;
}

export interface CoverageDelta {
  examVersionId: string;
  family: string;
  definitionName: string;
  before: { pilot: number; active: number; cellsFormBlocking: number; reducedMock: boolean; fullMock: boolean };
  after: { pilot: number; active: number; cellsFormBlocking: number; reducedMock: boolean; fullMock: boolean };
  cells: Array<{ cellKey: string; practiceEligibleBefore: number; practiceEligibleAfter: number; pilotBefore: number; pilotAfter: number }>;
}

export interface FactoryRunResult {
  runId: string | null;
  status: RunStatus;
  counters: RunCounters;
  requestsProcessed: number;
  requestsCreated: number;
  coverage: CoverageDelta[];
  notes: string[];
}

const ZERO = (): RunCounters => ({ aiCalls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0, candidates: 0, validated: 0, accepted: 0, rejected: 0, repaired: 0, reviewRequired: 0, promoted: 0, rateLimitEvents: 0 });
const STOP_STATUS: Record<Exclude<BudgetStop, null>, RunStatus> = { DISABLED: 'SKIPPED_DISABLED', DAILY_BUDGET: 'STOPPED_BUDGET', MAX_PER_RUN: 'STOPPED_MAX_PER_RUN', AI_RESERVE: 'STOPPED_RESERVE' };
const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 10);

/** Factory AI calls already made today (UTC), across every run. */
export async function factoryCallsToday(): Promise<number> {
  const r = await db.query(`SELECT COALESCE(sum(ai_calls), 0)::int AS n FROM question_bank_factory_runs WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
  return r.rows[0]?.n ?? 0;
}

/** Calls left on the SHARED platform AI day cap; null (= stop) when it cannot be read. */
export async function platformAiRemaining(): Promise<number | null> {
  try {
    const perDay = aiVolumeLimits().perDay;
    const r = await db.query(`SELECT day_calls, day_start = (date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today FROM ai_global_limits WHERE id = true`);
    const row = r.rows[0];
    if (!row) return null;
    return perDay - (row.today ? Number(row.day_calls) : 0);
  } catch {
    return null;
  }
}

export async function budgetSnapshot(cfg: FactoryConfig = factoryConfig()): Promise<{ config: Omit<FactoryConfig, 'examConfigKeys'> & { examConfigKeys: string[] }; usedToday: number; platformRemaining: number | null; stop: BudgetStop }> {
  const [usedToday, platformRemaining] = await Promise.all([factoryCallsToday(), platformAiRemaining()]);
  return { config: cfg, usedToday, platformRemaining, stop: budgetStop(cfg, { usedToday, usedThisRun: 0, platformRemaining }) };
}

async function startRun(trigger: 'SCHEDULED' | 'MANUAL' | 'CLI', requestedBy: string | null, cfg: FactoryConfig, budget: Record<string, unknown>): Promise<{ id: string; locked: boolean }> {
  // A run whose lease expired (crashed instance) never blocks the factory forever.
  await db.query(`UPDATE question_bank_factory_runs SET status = 'FAILED', finished_at = now(), error = 'LEASE_EXPIRED' WHERE status = 'RUNNING' AND lease_expires_at < now()`);
  try {
    const r = await db.query(
      `INSERT INTO question_bank_factory_runs (trigger, status, environment, requested_by, lease_expires_at, budget) VALUES ($1, 'RUNNING', $2, $3, now() + ($4::int * interval '1 millisecond'), $5) RETURNING id`,
      [trigger, process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV ?? 'local', requestedBy, cfg.runDeadlineMs + 60_000, JSON.stringify(budget)]
    );
    return { id: r.rows[0].id, locked: false };
  } catch (err: any) {
    if (err?.code !== '23505') throw err;
    const r = await db.query(
      `INSERT INTO question_bank_factory_runs (trigger, status, environment, requested_by, finished_at, budget, notes) VALUES ($1, 'SKIPPED_LOCKED', $2, $3, now(), $4, $5) RETURNING id`,
      [trigger, process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV ?? 'local', requestedBy, JSON.stringify(budget), JSON.stringify(['another factory run is RUNNING'])]
    );
    return { id: r.rows[0].id, locked: true };
  }
}

async function bumpRun(runId: string, u: AICallUsage): Promise<void> {
  await db.query(
    `UPDATE question_bank_factory_runs SET ai_calls = ai_calls + $2, input_tokens = input_tokens + $3, output_tokens = output_tokens + $4, estimated_cost_usd = estimated_cost_usd + $5, rate_limit_events = rate_limit_events + $6 WHERE id = $1`,
    [runId, u.calls, u.inputTokens, u.outputTokens, u.costUSD, u.rateLimited ? 1 : 0]
  );
}

function summarize(h: BankHealth) {
  return { pilot: h.totals.pilot, active: h.totals.active, cellsFormBlocking: h.totals.cellsFormBlocking, reducedMock: h.readiness.reducedMock.ready, fullMock: h.readiness.fullMock.ready };
}

/* ------------------------------------------------------------------ */
/* One request                                                          */
/* ------------------------------------------------------------------ */

interface RequestContext {
  runId: string;
  leaseOwner: string;
  cfg: FactoryConfig;
  ai: FactoryAI;
  counters: RunCounters;
  budget: BudgetState;
}

type Spend = 'OK' | Exclude<BudgetStop, null> | 'RATE_LIMIT';

async function spend(ctx: RequestContext, u: AICallUsage): Promise<'OK' | 'RATE_LIMIT'> {
  ctx.counters.aiCalls += u.calls;
  ctx.counters.inputTokens += u.inputTokens;
  ctx.counters.outputTokens += u.outputTokens;
  ctx.counters.costUSD += u.costUSD;
  ctx.budget.usedThisRun += u.calls;
  ctx.budget.usedToday += u.calls;
  if (ctx.budget.platformRemaining !== null) ctx.budget.platformRemaining -= u.calls;
  if (u.rateLimited) ctx.counters.rateLimitEvents += 1;
  await bumpRun(ctx.runId, u);
  return u.rateLimited ? 'RATE_LIMIT' : 'OK';
}

const canSpend = (ctx: RequestContext, calls = 1): Spend => budgetStop(ctx.cfg, ctx.budget, calls) ?? 'OK';

async function generationContext(inputs: VersionHealthInputs, req: GenerationRequest, spec: CellSpec): Promise<GenerationContext> {
  const cell = inputs.cells.find((c) => c.cellKey === req.cellKey)!;
  const def = (await db.query(`SELECT definition FROM assessment_components WHERE id = $1`, [cell.componentId])).rows[0]?.definition;
  const parsed = def ? ComponentDefinitionSchema.safeParse(def) : null;
  const own = inputs.texts.filter((t) => t.learningObjectiveId === cell.learningObjectiveId);
  return {
    examLabel: inputs.meta.definitionName,
    versionLabel: inputs.meta.versionLabel,
    componentName: cell.componentName,
    componentContract: parsed?.success ? componentDefinitionForAI(parsed.data) : null,
    objectiveCode: cell.objectiveCode,
    objectiveDescription: cell.objectiveDescription ?? cell.objectiveCode,
    spec,
    count: req.requestedCount,
    reason: req.reason,
    exemplars: own.filter((t) => t.published).slice(0, 3).map((t) => ({ stimulusTitle: t.stimulusTitle, question: t.question, options: t.options })),
    avoidStems: own.map((t) => t.question),
    aggregate: req.generationParams.aggregate ?? null,
  };
}

interface CandidateOutcome {
  /** DEFERRED: validation could not finish within budget -- the version stays VALIDATING and resumes next run. */
  final: 'PILOT' | 'REJECTED' | 'REPAIR_REQUIRED' | 'REVIEW_REQUIRED' | 'DEFERRED';
  repaired: boolean;
  stop: Spend | null;
}

/** Validates one version (deterministic, then the independent validator when needed). Never promotes on doubt. */
async function validateVersion(ctx: RequestContext, versionId: string, content: Record<string, unknown>, verification: { verificationExpression: string | null; evidenceQuote: string | null }, spec: CellSpec, existing: ExistingItemText[]): Promise<{ outcome: 'PASS' | 'REJECTED' | 'REPAIR_REQUIRED' | 'REVIEW_REQUIRED' | 'DEFERRED'; issues: ValidationIssue[]; stop: Spend | null; validator: Record<string, unknown> | null }> {
  await transitionVersion({ versionId, to: 'VALIDATING', reason: 'VALIDATION_STARTED', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
  const det = runDeterministicValidation(content, spec, verification, existing);
  if (det.outcome !== 'NEEDS_AI_VALIDATION') {
    const outcome = det.outcome === 'PASS' ? 'PASS' : det.outcome;
    await recordValidationReport(versionId, { stage: 'DETERMINISTIC', outcome, issues: det.issues, deterministicallyVerified: det.deterministicallyVerified, verification });
    return { outcome, issues: det.issues, stop: null, validator: null };
  }
  // Independent validator: Luna first, Terra only when Luna is not confident.
  let escalated = false;
  for (;;) {
    const allowed = canSpend(ctx);
    if (allowed !== 'OK') {
      await recordValidationReport(versionId, { stage: 'AI_VALIDATOR', outcome: 'DEFERRED', reason: allowed, issues: det.issues, verification });
      return { outcome: 'DEFERRED', issues: det.issues, stop: allowed, validator: null };
    }
    const { verdict, usage } = await ctx.ai.validate(det.content!, escalated);
    const s = await spend(ctx, usage);
    if (!verdict) {
      if (s === 'RATE_LIMIT') {
        // Provider / platform limit: nothing was judged -- resume next run (never promoted, never lost).
        await recordValidationReport(versionId, { stage: 'AI_VALIDATOR', outcome: 'DEFERRED', reason: 'RATE_LIMIT', issues: det.issues, verification });
        return { outcome: 'DEFERRED', issues: det.issues, stop: 'RATE_LIMIT', validator: null };
      }
      await recordValidationReport(versionId, { stage: 'AI_VALIDATOR', outcome: 'VALIDATOR_UNAVAILABLE', errorCode: usage.errorCode, model: usage.model, verification });
      return { outcome: 'REVIEW_REQUIRED', issues: [{ stage: 'AI_VALIDATOR', code: 'VALIDATOR_UNAVAILABLE', severity: 'REVIEW', detail: usage.errorCode ?? undefined }], stop: null, validator: null };
    }
    const judged = judgeValidatorVerdict(verdict, det.content!.correctAnswer, spec, escalated);
    if (judged.outcome === 'ESCALATE' && !escalated) {
      escalated = true;
      continue;
    }
    const outcome = judged.outcome === 'ESCALATE' ? 'REVIEW_REQUIRED' : judged.outcome;
    const validator = { model: usage.model, escalated, verdict };
    await recordValidationReport(versionId, { stage: 'AI_VALIDATOR', outcome, issues: [...det.issues, ...judged.issues], validator, verification });
    return { outcome, issues: [...det.issues, ...judged.issues], stop: null, validator };
  }
}

async function processCandidate(ctx: RequestContext, req: GenerationRequest, inputs: VersionHealthInputs, gctx: GenerationContext, candidate: GeneratedCandidate, existing: ExistingItemText[]): Promise<CandidateOutcome> {
  const spec = gctx.spec;
  const cell = inputs.cells.find((c) => c.cellKey === req.cellKey)!;
  const itemKey = `qb.${cell.objectiveCode}.${shortHash(`${candidate.question}|${ctx.runId}|${req.id}`)}`;
  const toVersion = (c: GeneratedCandidate) => {
    const stimulusKey = c.stimulusText ? `qb.${cell.sectionKey}.${shortHash(c.stimulusText)}` : null;
    return candidateToContent(c, { itemKey, spec, stimulusKey, difficultyIndex: Math.round((1 + (Math.min(5, Math.max(1, c.difficulty)) - spec.targetDifficulty) * 0.05) * 100) / 100 });
  };
  let current = toVersion(candidate);
  let created: { bankItemId: string; versionId: string };
  try {
    created = await createGeneratedItem({
      itemKey,
      examVersionId: inputs.meta.examVersionId,
      componentId: cell.componentId,
      cellKey: cell.cellKey,
      language: spec.language,
      generationRequestId: req.id,
      generationMetadata: { runId: ctx.runId, reason: req.reason, priority: req.priority, prompt: 'question_bank.generate_items@v1', targetDifficulty: spec.targetDifficulty },
      version: { content: current.content, learningObjectiveId: cell.learningObjectiveId, questionType: String(current.content.type), targetDifficulty: spec.targetDifficulty },
      runId: ctx.runId,
    });
  } catch {
    // Not even the stored item shape: never written, counted as rejected.
    return { final: 'REJECTED', repaired: false, stop: null };
  }
  ctx.counters.candidates += 1;
  let versionId = created.versionId;
  let v = await validateVersion(ctx, versionId, current.content, current.verification, spec, existing);
  let repaired = false;
  if (v.outcome === 'DEFERRED') return { final: 'DEFERRED', repaired, stop: v.stop };

  if (v.outcome === 'REPAIR_REQUIRED') {
    await transitionVersion({ versionId, to: 'REPAIR_REQUIRED', reason: v.issues.map((i) => i.code).join(',') || 'REPAIR', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
    const allowed = ctx.cfg.maxRepairsPerCandidate > 0 ? canSpend(ctx) : 'OK';
    if (ctx.cfg.maxRepairsPerCandidate === 0 || allowed !== 'OK') return { final: 'REPAIR_REQUIRED', repaired: false, stop: allowed === 'OK' ? null : allowed };
    const { candidate: fixed, usage } = await ctx.ai.repair(gctx, candidate, v.issues.filter((i) => i.severity !== 'REVIEW'));
    const s = await spend(ctx, usage);
    if (!fixed) {
      await transitionVersion({ versionId, to: 'REJECTED', reason: 'REPAIR_FAILED', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
      return { final: 'REJECTED', repaired: false, stop: s === 'RATE_LIMIT' ? 'RATE_LIMIT' : null };
    }
    current = toVersion(fixed);
    try {
      const next = await createNextVersion({ bankItemId: created.bankItemId, version: { content: current.content, learningObjectiveId: cell.learningObjectiveId, questionType: String(current.content.type), targetDifficulty: spec.targetDifficulty }, lifecycle: 'DRAFT_AI', replaceNow: true, reason: 'REPAIRED', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
      versionId = next.versionId;
    } catch {
      await transitionVersion({ versionId, to: 'REJECTED', reason: 'REPAIR_INVALID_SHAPE', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
      return { final: 'REJECTED', repaired: false, stop: null };
    }
    repaired = true;
    v = await validateVersion(ctx, versionId, current.content, current.verification, spec, existing);
    if (v.outcome === 'DEFERRED') return { final: 'DEFERRED', repaired: true, stop: v.stop };
    // One repair only: a repaired version that still needs repair is rejected.
    if (v.outcome === 'REPAIR_REQUIRED') v = { ...v, outcome: 'REJECTED' };
  }

  if (v.outcome === 'PASS') {
    await transitionVersion({ versionId, to: 'VALIDATED', reason: 'VALIDATION_PASSED', actor: { kind: 'SYSTEM' }, runId: ctx.runId, detail: { validator: v.validator ? 'AI_INDEPENDENT' : 'DETERMINISTIC' } });
    await transitionVersion({ versionId, to: 'PILOT', reason: 'PILOT_ENTRY', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
    ctx.counters.validated += 1;
    ctx.counters.promoted += 1;
    existing.push({ versionId, question: String(current.content.question), stimulusText: (current.content.stimulus as any)?.text ?? null });
    return { final: 'PILOT', repaired, stop: v.stop };
  }
  const to = v.outcome === 'REJECTED' ? 'REJECTED' : 'REVIEW_REQUIRED';
  await transitionVersion({ versionId, to, reason: v.issues.map((i) => i.code).join(',').slice(0, 400) || to, actor: { kind: 'SYSTEM' }, runId: ctx.runId });
  return { final: to, repaired, stop: v.stop };
}

async function processRequest(ctx: RequestContext, req: GenerationRequest): Promise<Spend | null> {
  const inputs = await loadVersionHealthInputs(req.examVersionId);
  const cell = inputs?.cells.find((c) => c.cellKey === req.cellKey);
  if (!inputs || !cell) {
    await deferRequest(req.id, ctx.leaseOwner, 'CELL_NO_LONGER_IN_BLUEPRINT');
    return null;
  }
  const spec = cellSpecFor(cell, inputs);
  const gctx = await generationContext(inputs, req, spec);
  const allowed = canSpend(ctx);
  if (allowed !== 'OK') {
    await releaseRequest(req.id, ctx.leaseOwner, `BUDGET:${allowed}`);
    return allowed;
  }
  const { candidates, usage } = await ctx.ai.generate(gctx);
  const s = await spend(ctx, usage);
  await addRequestCounters(req.id, { provider: usage.provider, model: usage.model, runId: ctx.runId });
  if (s === 'RATE_LIMIT') {
    await deferRequest(req.id, ctx.leaseOwner, `RATE_LIMIT:${usage.errorCode ?? ''}`);
    return 'RATE_LIMIT';
  }
  if (candidates.length === 0) {
    await deferRequest(req.id, ctx.leaseOwner, `NO_CANDIDATES:${usage.errorCode ?? 'EMPTY'}`);
    return null;
  }
  const existing: ExistingItemText[] = inputs.texts.filter((t) => t.learningObjectiveId === cell.learningObjectiveId).map((t) => ({ versionId: t.versionId, question: t.question, stimulusText: t.stimulusText }));
  let stop: Spend | null = null;
  for (const candidate of candidates) {
    if (stop) break;
    const out = await processCandidate(ctx, req, inputs, gctx, candidate, existing);
    await addRequestCounters(req.id, {
      candidates: 1,
      accepted: out.final === 'PILOT' ? 1 : 0,
      rejected: out.final === 'REJECTED' ? 1 : 0,
      repaired: out.repaired ? 1 : 0,
      reviewRequired: out.final === 'REVIEW_REQUIRED' || out.final === 'REPAIR_REQUIRED' ? 1 : 0,
    });
    if (out.final === 'PILOT') ctx.counters.accepted += 1;
    else if (out.final === 'REJECTED') ctx.counters.rejected += 1;
    else if (out.final !== 'DEFERRED') ctx.counters.reviewRequired += 1;
    if (out.repaired) ctx.counters.repaired += 1;
    stop = out.stop;
  }
  await completeRequest(req.id, ctx.leaseOwner);
  return stop;
}

/** Generated versions whose validation was interrupted (budget / rate limit) are finished first -- the run is resumable. */
async function resumeDeferredValidations(ctx: RequestContext, versionIds: string[], max = 5): Promise<Spend | null> {
  const rows = (
    await db.query(
      `SELECT ai.id, ai.content, ai.validation_report, qi.exam_version_id, qi.cell_key, qi.id AS bank_item_id
         FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id
        WHERE ai.bank_lifecycle_status = 'VALIDATING' AND ai.validation_report->>'outcome' = 'DEFERRED' AND qi.exam_version_id = ANY($1::uuid[])
        ORDER BY ai.created_at LIMIT $2`,
      [versionIds, max]
    )
  ).rows;
  const inputsCache = new Map<string, VersionHealthInputs | null>();
  for (const r of rows) {
    if (!inputsCache.has(r.exam_version_id)) inputsCache.set(r.exam_version_id, await loadVersionHealthInputs(r.exam_version_id));
    const inputs = inputsCache.get(r.exam_version_id);
    const cell = inputs?.cells.find((c) => c.cellKey === r.cell_key);
    if (!inputs || !cell) continue;
    const spec = cellSpecFor(cell, inputs);
    const existing = inputs.texts.filter((t) => t.learningObjectiveId === cell.learningObjectiveId && t.versionId !== r.id).map((t) => ({ versionId: t.versionId, question: t.question, stimulusText: t.stimulusText }));
    const verification = r.validation_report?.verification ?? { verificationExpression: null, evidenceQuote: null };
    const v = await validateVersion(ctx, r.id, r.content, verification, spec, existing);
    if (v.outcome === 'DEFERRED') return v.stop;
    if (v.outcome === 'PASS') {
      await transitionVersion({ versionId: r.id, to: 'VALIDATED', reason: 'VALIDATION_PASSED', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
      await transitionVersion({ versionId: r.id, to: 'PILOT', reason: 'PILOT_ENTRY', actor: { kind: 'SYSTEM' }, runId: ctx.runId });
      ctx.counters.validated += 1;
      ctx.counters.promoted += 1;
      ctx.counters.accepted += 1;
    } else {
      const to = v.outcome === 'REJECTED' ? 'REJECTED' : v.outcome === 'REPAIR_REQUIRED' ? 'REPAIR_REQUIRED' : 'REVIEW_REQUIRED';
      await transitionVersion({ versionId: r.id, to, reason: v.issues.map((i) => i.code).join(',').slice(0, 400) || to, actor: { kind: 'SYSTEM' }, runId: ctx.runId });
      if (to === 'REJECTED') ctx.counters.rejected += 1;
      else ctx.counters.reviewRequired += 1;
    }
    if (v.stop) return v.stop;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The run                                                              */
/* ------------------------------------------------------------------ */

export async function runFactory(opts: { trigger: 'SCHEDULED' | 'MANUAL' | 'CLI'; requestedBy?: string | null; examVersionIds?: string[]; onlyRequestId?: string; ai?: FactoryAI; cfg?: FactoryConfig; skipGapAnalysis?: boolean }): Promise<FactoryRunResult> {
  const cfg = opts.cfg ?? factoryConfig();
  const counters = ZERO();
  const notes: string[] = [];
  const [usedToday, platformRemaining] = await Promise.all([factoryCallsToday(), platformAiRemaining()]);
  const budgetInfo = { dailyBudget: cfg.dailyBudget, maxPerRun: cfg.maxPerRun, minRemainingAiReserve: cfg.minRemainingAiReserve, usedTodayAtStart: usedToday, platformRemainingAtStart: platformRemaining };
  if (!cfg.enabled) {
    const r = await db.query(
      `INSERT INTO question_bank_factory_runs (trigger, status, environment, requested_by, finished_at, budget, notes) VALUES ($1, 'SKIPPED_DISABLED', $2, $3, now(), $4, $5) RETURNING id`,
      [opts.trigger, process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV ?? 'local', opts.requestedBy ?? null, JSON.stringify(budgetInfo), JSON.stringify(['QUESTION_BANK_FACTORY_ENABLED is not true'])]
    );
    return { runId: r.rows[0].id, status: 'SKIPPED_DISABLED', counters, requestsProcessed: 0, requestsCreated: 0, coverage: [], notes: ['QUESTION_BANK_FACTORY_ENABLED is not true'] };
  }
  const run = await startRun(opts.trigger, opts.requestedBy ?? null, cfg, budgetInfo);
  if (run.locked) return { runId: run.id, status: 'SKIPPED_LOCKED', counters, requestsProcessed: 0, requestsCreated: 0, coverage: [], notes: ['another factory run is RUNNING'] };

  const deadline = Date.now() + cfg.runDeadlineMs;
  let status: RunStatus = 'COMPLETED';
  let requestsProcessed = 0;
  let requestsCreated = 0;
  const coverage: CoverageDelta[] = [];
  const before = new Map<string, BankHealth>();
  try {
    let versionIds = opts.examVersionIds;
    if (!versionIds) {
      const all = await listBankVersions();
      versionIds = all.filter((v) => v.configKey && cfg.examConfigKeys.includes(v.configKey)).map((v) => v.examVersionId);
      if (versionIds.length === 0) notes.push('QUESTION_BANK_FACTORY_EXAMS selects no published exam version');
    }
    const registered = await ensureBankIdentities();
    if (registered) notes.push(`registered ${registered} items written outside the factory`);
    const stats = await refreshItemStats(run.id);
    if (stats.transitions) notes.push(`calibration moved ${stats.transitions} versions`);
    for (const id of versionIds) {
      const h = await refreshVersionHealth(id, run.id);
      if (!h) continue;
      before.set(id, h.health);
      if (!opts.skipGapAnalysis && !opts.onlyRequestId) requestsCreated += (await enqueueGaps(h.inputs, h.health, cfg)).length;
      if (!adapterFor(h.inputs.meta.family).generation.supported) notes.push(`${h.inputs.meta.definitionName}: ${adapterFor(h.inputs.meta.family).generation.note}`);
    }
    await reclaimExpiredLeases();

    const ctx: RequestContext = { runId: run.id, leaseOwner: `run:${run.id}:${randomUUID().slice(0, 8)}`, cfg, ai: opts.ai ?? gatewayFactoryAI, counters, budget: { usedToday, usedThisRun: 0, platformRemaining } };
    const resumed = canSpend(ctx) === 'OK' ? await resumeDeferredValidations(ctx, versionIds) : null;
    if (resumed && resumed !== 'OK') status = resumed === 'RATE_LIMIT' ? 'STOPPED_RATE_LIMIT' : STOP_STATUS[resumed];
    for (; status === 'COMPLETED';) {
      if (Date.now() > deadline) {
        status = 'STOPPED_DEADLINE';
        break;
      }
      const pre = canSpend(ctx);
      if (pre !== 'OK') {
        status = pre === 'RATE_LIMIT' ? 'STOPPED_RATE_LIMIT' : STOP_STATUS[pre];
        break;
      }
      const req = await claimNextRequest(ctx.leaseOwner, cfg.runDeadlineMs + 60_000, versionIds, opts.onlyRequestId);
      if (!req) break;
      requestsProcessed += 1;
      let stop: Spend | null = null;
      try {
        stop = await processRequest(ctx, req);
      } catch (err) {
        // Provider / pipeline failure: diagnostics kept, request retryable, bank never corrupted (each step is its own transaction).
        await deferRequest(req.id, ctx.leaseOwner, `ERROR:${err instanceof Error ? err.message : String(err)}`).catch(() => undefined);
        notes.push(`request ${req.cellKey}: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`);
        continue;
      }
      if (stop && stop !== 'OK') {
        status = stop === 'RATE_LIMIT' ? 'STOPPED_RATE_LIMIT' : STOP_STATUS[stop];
        break;
      }
      if (opts.onlyRequestId) break;
    }

    for (const id of versionIds) {
      const prev = before.get(id);
      const after = await refreshVersionHealth(id, run.id);
      if (!prev || !after) continue;
      coverage.push({
        examVersionId: id,
        family: after.inputs.meta.family,
        definitionName: after.inputs.meta.definitionName,
        before: summarize(prev),
        after: summarize(after.health),
        cells: after.health.cells
          .map((c) => {
            const p = prev.cells.find((x) => x.cellKey === c.cellKey);
            return { cellKey: c.cellKey, practiceEligibleBefore: p?.counts.practiceEligible ?? 0, practiceEligibleAfter: c.counts.practiceEligible, pilotBefore: p?.counts.pilot ?? 0, pilotAfter: c.counts.pilot };
          })
          .filter((c) => c.practiceEligibleAfter !== c.practiceEligibleBefore || c.pilotAfter !== c.pilotBefore),
      });
    }
  } catch (err) {
    status = 'FAILED';
    notes.push(err instanceof Error ? err.message.slice(0, 300) : String(err));
  } finally {
    await db.query(
      `UPDATE question_bank_factory_runs SET status = $2, finished_at = now(), candidates_generated = $3, validated = $4, accepted = $5, rejected = $6, repaired = $7, review_required = $8, promoted = $9,
              coverage_before = $10, coverage_after = $11, notes = $12, error = $13 WHERE id = $1`,
      [
        run.id, status, counters.candidates, counters.validated, counters.accepted, counters.rejected, counters.repaired, counters.reviewRequired, counters.promoted,
        JSON.stringify(coverage.map((c) => ({ examVersionId: c.examVersionId, ...c.before }))), JSON.stringify(coverage.map((c) => ({ examVersionId: c.examVersionId, ...c.after, cells: c.cells }))),
        JSON.stringify(notes), status === 'FAILED' ? notes[notes.length - 1] ?? null : null,
      ]
    );
  }
  return { runId: run.id, status, counters, requestsProcessed, requestsCreated, coverage, notes };
}

export async function listRuns(limit = 30) {
  const r = await db.query(`SELECT * FROM question_bank_factory_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? null);
  return r.rows.map((x: any) => ({
    id: x.id, trigger: x.trigger, status: x.status, environment: x.environment, startedAt: iso(x.started_at), finishedAt: iso(x.finished_at),
    aiCalls: x.ai_calls, inputTokens: Number(x.input_tokens), outputTokens: Number(x.output_tokens), estimatedCostUSD: Number(x.estimated_cost_usd),
    candidates: x.candidates_generated, validated: x.validated, accepted: x.accepted, rejected: x.rejected, repaired: x.repaired, reviewRequired: x.review_required, promoted: x.promoted,
    rateLimitEvents: x.rate_limit_events, notes: x.notes ?? [], coverageAfter: x.coverage_after ?? null, coverageBefore: x.coverage_before ?? null,
  }));
}

