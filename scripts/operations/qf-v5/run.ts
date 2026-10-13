/**
 * Question Factory V5 -- the run script.
 *
 *   npx tsx scripts/operations/qf-v5/run.ts plan [--bank <inventory.json>]
 *       No provider, no database, no key. Computes readiness and the coverage-driven generation plan from the
 *       governed blueprints and a bank inventory (default: empty), and writes the coverage matrix and plan.
 *
 *   QB_GENERATION_BUDGET_USD=<n> OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
 *   npx tsx scripts/operations/qf-v5/run.ts generate --run <id> --manifest <manifest.json> [--batch-size 4]
 *       Live. Refuses without an authorised budget. The manifest lists {profileId, count, phase}. Before every
 *       batch the spend guard is asked with the batch's conservative maximum; a checkpoint follows every batch; a
 *       profile stops at once on a wrong key, a construct failure, leakage or a harness error; C2 and SCALE need
 *       a passing C1 of that profile under the same versions.
 *
 * Pass ONLY the three variables into the process. Never --env-file an application .env: it holds a DATABASE_URL.
 * This script writes under docs/audits/qb_review/ only. It ingests nothing: promotion to the bank is a separate,
 * governed step.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allV2Configs } from '../../../src/lib/exam-core/verticals/v2/all';
import { RETIRED_V2_CONFIG_KEYS } from '../../../src/lib/exam-core/verticals/v2/index';
import { GENERATION_PROFILES, GENERATOR_PROFILE_VERSION, mayScaleTier, profileById } from '../../../src/lib/exam-core/question-bank/production/v5/generation-profile';
import { VALIDATOR_VERSION, keyPositionFinding, type CorpusEntry } from '../../../src/lib/exam-core/question-bank/production/v5/deterministic-stages';
import { learnerText, type CandidateItem, type GenerationSpecification } from '../../../src/lib/exam-core/question-bank/production/v5/item';
import { auditSample, calibrationGate, checkpoint, cumulativeSpend, maySpend, metricsBy, metricsOf, reviewQueue, stopCondition, type Checkpoint, type SpendLedger } from '../../../src/lib/exam-core/question-bank/production/v5/batch-control';
import { blueprintSections, generationAllocation, globalReadiness, type BankItem } from '../../../src/lib/exam-core/question-bank/production/v5/readiness';
import { planSpecifications } from '../../../src/lib/exam-core/question-bank/production/v5/plan';
import { authoringPrompt } from '../../../src/lib/exam-core/question-bank/production/v5/prompts';
import type { SpecificationOutcome, ValidationRecord } from '../../../src/lib/exam-core/question-bank/production/v5/pipeline';
import { COVERAGE_HEADER, coverageRows, reviewCsv, reviewRow, toCsv, toJsonl } from './artifacts';
import { WORST_CASE_CALLS, revalidateItems, runBatch, type ModelRole } from './engine';


const ROOT = join(__dirname, '..', '..', '..');
const OUT = join(ROOT, 'docs', 'audits', 'qb_review');
const AUDITS = join(ROOT, 'docs', 'audits');
/** Share of raw candidates expected to be certified. A planning assumption until C1/C2 measure it. */
export const PLANNING_YIELD = 0.8;

/** While this file exists no provider call is made by this lane: generate and revalidate refuse before reading a key. */
export const FREEZE_FILE = join(OUT, 'GENERATION_FREEZE.json');
export function refuseIfFrozen(): void {
  if (!existsSync(FREEZE_FILE)) return;
  const f = readJson<{ reason?: string }>(FREEZE_FILE, {});
  console.error(`REFUSED: GENERATION_FROZEN -- ${f.reason ?? 'a freeze is in force'}. No provider call was made. Remove ${FREEZE_FILE} only on the operator's instruction.`);
  process.exit(2);
}

export const clusterOf = (profileId: string): string => profileId.split('.').slice(0, 2).join('.');
const arg = (name: string): string | null => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? null : null; };
const readJson = <T>(p: string, fallback: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback);

export function planState(bank: readonly BankItem[]) {
  const configs = allV2Configs().filter((c) => !RETIRED_V2_CONFIG_KEYS.includes(c.key));
  const sections = blueprintSections(configs as never);
  const readiness = globalReadiness(sections, bank);
  const allocation = generationAllocation(sections, bank, PLANNING_YIELD);
  const specifications = planSpecifications(sections, allocation);
  return { sections, readiness, allocation, specifications };
}

function plan(): void {
  const bankPath = arg('bank');
  const bank = bankPath ? readJson<BankItem[]>(bankPath, []) : [];
  const { sections, readiness, allocation, specifications } = planState(bank);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(AUDITS, 'QUESTION_BANK_COVERAGE_MATRIX.csv'), toCsv(COVERAGE_HEADER, coverageRows(readiness)));
  const byCluster: Record<string, { profiles: string[]; buckets: number; rawCandidates: number; targetEligible: number }> = {};
  for (const r of allocation) { const k = clusterOf(r.profileId); const c = (byCluster[k] ??= { profiles: [], buckets: 0, rawCandidates: 0, targetEligible: 0 }); if (!c.profiles.includes(r.profileId)) c.profiles.push(r.profileId); c.buckets += 1; c.rawCandidates += r.toGenerate; c.targetEligible += r.required - r.available; }
  const sampleChars = specifications.length ? authoringPrompt(specifications[0], profileById(specifications[0].profileId)!).user.length : 0;
  const summary = {
    kind: 'QF_V5_GENERATION_PLAN', profileVersion: GENERATOR_PROFILE_VERSION, validatorVersion: VALIDATOR_VERSION, planningYield: PLANNING_YIELD, bankInventory: bankPath ?? 'EMPTY (no Student-eligible item supplied)',
    profiles: GENERATION_PROFILES.length, blueprintSections: sections.length, blueprintBuckets: sections.reduce((a, s) => a + s.buckets.length, 0),
    governedSlotsOneForm: sections.reduce((a, s) => a + s.buckets.reduce((x, b) => x + b.required, 0), 0),
    targetEligibleAtRepeatableDepth: allocation.reduce((a, r) => a + r.required - r.available, 0), rawCandidatesPlanned: specifications.length,
    worstCaseCallsPerSpecification: WORST_CASE_CALLS, authoringPromptCharactersSample: sampleChars, byCluster,
    readiness: readiness.map((f) => ({ family: f.family, eligibleItems: f.eligibleItems, practice: f.practice.state, reducedMock: f.reducedMock.state, fullMock: f.fullMock.state, repeatableFullMock: f.repeatableFullMock.state, challenge: f.challenge.state, coveragePercent: f.coveragePercent, blockers: { practice: f.practice.blockers.length, reducedMock: f.reducedMock.blockers.length, fullMock: f.fullMock.blockers.length, challenge: f.challenge.blockers.length }, fullMockBlockerCodes: [...new Set(f.fullMock.blockers.map((b) => b.code))] })),
  };
  writeFileSync(join(OUT, 'QF_V5_GENERATION_PLAN.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(OUT, 'QF_V5_READINESS.json'), `${JSON.stringify(readiness, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

interface RunState { ledger: SpendLedger; checkpoints: Checkpoint[]; records: ValidationRecord[]; items: Record<string, CandidateItem>; batchesByProfile: Record<string, SpecificationOutcome[][]> }
export interface ManifestEntry { profileId: string; count: number; phase: 'C1' | 'C2' | 'SCALE'; /** Restrict the sample to these tiers; the gate it earns is a gate for these tiers only. */ tiers?: ('CHALLENGE' | 'STANDARD' | 'FOUNDATIONAL')[] }

/**
 * The specifications of one profile for a live sample: hardest tiers first (40 % CHALLENGE, 40 % STANDARD, the rest
 * FOUNDATIONAL), spread across the profile's blueprint buckets instead of taken from one.
 */
export function selectForProfile(all: readonly GenerationSpecification[], profileId: string, count: number, done: ReadonlySet<string>, tiers?: readonly string[]): GenerationSpecification[] {
  const pool = all.filter((s) => s.profileId === profileId && !done.has(s.slotKey) && (!tiers || tiers.includes(s.intendedDifficulty)));
  const want = tiers ? { CHALLENGE: tiers.includes('CHALLENGE') ? count : 0, STANDARD: Math.ceil(count * 0.6), FOUNDATIONAL: count } : { CHALLENGE: Math.ceil(count * 0.4), STANDARD: Math.ceil(count * 0.4), FOUNDATIONAL: count };
  const out: GenerationSpecification[] = [];
  for (const tier of ['CHALLENGE', 'STANDARD', 'FOUNDATIONAL'] as const) {
    const byBucket = new Map<string, GenerationSpecification[]>();
    for (const s of pool.filter((x) => x.intendedDifficulty === tier)) { const k = `${s.bucket.objectiveCode}#${s.bucket.targetIndex}`; byBucket.set(k, [...(byBucket.get(k) ?? []), s]); }
    const queues = [...byBucket.values()];
    let taken = 0;
    for (let round = 0; taken < want[tier] && out.length < count && queues.some((q) => q.length > round); round += 1) for (const q of queues) if (q[round] && taken < want[tier] && out.length < count) { out.push(q[round]); taken += 1; }
  }
  return out;
}

async function generate(): Promise<void> {
  refuseIfFrozen();
  const budget = Number(process.env.QB_GENERATION_BUDGET_USD);
  const probe = maySpend({ authorizedUsd: Number.isFinite(budget) && budget > 0 ? budget : null, entries: [] }, 0);
  if (!probe.allowed) { console.error(`REFUSED: ${probe.code} -- ${probe.detail}. No provider call was made.`); process.exit(2); }
  const runId = arg('run'); const manifestPath = arg('manifest');
  if (!runId || !manifestPath) { console.error('usage: generate --run <id> --manifest <manifest.json> [--batch-size n]'); process.exit(2); }
  const manifest = readJson<ManifestEntry[]>(manifestPath, []);
  const dir = join(OUT, 'run', runId);
  mkdirSync(join(dir, 'checkpoints'), { recursive: true });
  const statePath = join(dir, 'state.json');
  const state = readJson<RunState>(statePath, { ledger: { authorizedUsd: budget, entries: [] }, checkpoints: [], records: [], items: {}, batchesByProfile: {} });
  state.ledger.authorizedUsd = budget; // the operator's figure for this invocation; never raised by the script
  const versions = { profileVersion: GENERATOR_PROFILE_VERSION, validatorVersion: VALIDATOR_VERSION };
  const stale = state.records.filter((r) => r.validatorVersion !== versions.validatorVersion).length;
  if (stale) { console.error(`REFUSED: ${stale} record(s) of this run were scored by another validator version. Start a new run id; never mix rulers in one run.`); process.exit(2); }
  const gatesPath = join(dir, 'gates.json');
  const gates = readJson<Record<string, { phase: string; pass: boolean; unmet: string[]; size: number; versions: typeof versions }>>(gatesPath, {});
  const { specifications } = planState([]);
  const { liveModelCall, specificationReserveUsd, estimatedUsd, VALIDATION_MODEL } = await import('./live');
  const live = liveModelCall(process.env);
  const size = Number(arg('batch-size') ?? 4);
  let halted = false;
  const earlier = (arg('exclude-runs')?.split(',') ?? []).flatMap((id) => readJson<RunState | null>(join(OUT, 'run', id, 'state.json'), null)?.records.map((r) => r.slotKey) ?? []);

  for (const entry of manifest) {
    if (halted) break;
    const need = entry.phase === 'C2' ? 'C1' : entry.phase === 'SCALE' ? 'C1' : null;
    // nothing is scaled on a profile that has not passed its live calibration under these exact versions
    if (need && !gates[`${entry.profileId}:${need}`]?.pass) { console.error(`SKIPPED ${entry.profileId} ${entry.phase}: no passing ${need} gate under ${versions.profileVersion} / ${versions.validatorVersion}.`); continue; }
    // slots an earlier run already used are never drawn again: a calibration batch is out of sample
    const done = new Set([...state.records.map((r) => r.slotKey), ...earlier]);
    // a tier that is not calibrated is never scaled, whatever the manifest asks for
    const scalable = entry.phase === 'SCALE' ? specifications.filter((s) => mayScaleTier(profileById(s.profileId)!, s.intendedDifficulty)) : specifications;
    const chosen = selectForProfile(scalable, entry.profileId, entry.count, done, entry.tiers);
    if (entry.phase === 'SCALE' && !chosen.length) { console.error(`SKIPPED ${entry.profileId} SCALE: no tier of this profile is calibrated for scaling.`); continue; }
    const outcomes: SpecificationOutcome[] = [];
    for (let b = 0; b * size < chosen.length; b += 1) {
      const batch = chosen.slice(b * size, (b + 1) * size);
      const batchId = `${entry.profileId}:${entry.phase}:${String(state.checkpoints.filter((c) => c.profileId === entry.profileId).length + 1).padStart(3, '0')}`;
      const reserve = batch.reduce((a, s) => { const r = authoringPrompt(s, profileById(s.profileId)!); return a + specificationReserveUsd(r.system.length + r.user.length); }, 0);
      const permission = maySpend(state.ledger, reserve);
      if (!permission.allowed) { console.error(`STOPPED before ${batchId}: ${permission.code} -- ${permission.detail}`); halted = true; break; }
      const before = cumulativeSpend(state.ledger);
      const corpus: CorpusEntry[] = Object.values(state.items).map((i) => ({ id: i.itemId, source: 'EARLIER_BATCH', text: learnerText(i) }));
      const result = await runBatch(batch, live.call, corpus);
      for (const role of Object.keys(result.account) as ModelRole[]) { const a = result.account[role]; state.ledger.entries.push({ batchId, provider: role === 'AUTHOR' ? 'openai' : 'anthropic', model: role === 'AUTHOR' ? live.authorModel : VALIDATION_MODEL, purpose: role === 'AUTHOR' ? 'GENERATION' : 'VALIDATION', calls: a.calls, succeeded: a.succeeded, failed: a.failed, estimatedUsd: estimatedUsd(role, a) }); }
      for (const o of result.outcomes) { for (const a of o.attempts) state.records.push(a.record); if (o.final.item) state.items[o.final.item.itemId] = o.final.item; }
      (state.batchesByProfile[entry.profileId] ??= []).push(result.outcomes);
      outcomes.push(...result.outcomes);
      const spent = cumulativeSpend(state.ledger);
      const cp = checkpoint({ runId, batchId, phase: entry.phase, profileId: entry.profileId, ...versions, cumulativeSpendUsd: spent, timestamp: new Date().toISOString(), outcomes: result.outcomes });
      state.checkpoints.push(cp);
      writeFileSync(join(dir, 'checkpoints', `${batchId.replace(/[:]/g, '_')}.json`), `${JSON.stringify(cp, null, 2)}\n`);
      writeFileSync(statePath, `${JSON.stringify(state)}\n`);
      const p = profileById(entry.profileId)!;
      console.log(JSON.stringify({ BATCH_ID: batchId, FAMILY: p.family, PROFILE: p.profileId, RAW_CANDIDATES: result.outcomes.reduce((a, o) => a + o.attempts.length, 0), MACHINE_CERTIFIED: cp.metrics.autoApproved, REVIEW_REQUIRED: cp.metrics.humanReview, REJECTED: cp.metrics.autoRejected, ACTUAL_SPEND: +(spent - before).toFixed(4), CUMULATIVE_SPEND: +spent.toFixed(4), BUDGET_REMAINING: +(budget - spent).toFixed(4), reasons: result.outcomes.filter((o) => o.final.record.reviewDecision !== 'AUTO_APPROVE').map((o) => `${o.final.record.reviewDecision}:${o.final.record.reviewReason.slice(0, 110)}`) }));
      // a wrong key, a construct failure, leakage or a harness error stops this profile at once: no more is spent on it
      const verdict = stopCondition(state.batchesByProfile[entry.profileId]);
      // the review-rate and tier-drift conditions govern SCALE; a calibration batch runs to its size and is judged by its gate
      const reasons = entry.phase === 'SCALE' ? verdict.reasons : verdict.reasons.filter((r) => !r.startsWith('HUMAN_REVIEW_OVER') && !r.startsWith('DIFFICULTY_SYSTEMATICALLY'));
      if (reasons.length) { console.error(`STOPPED ${entry.profileId}: ${reasons.join(', ')}`); break; }
    }
    if (entry.phase !== 'SCALE' && outcomes.length) {
      const gate = calibrationGate(entry.phase, outcomes, entry.count);
      gates[`${entry.profileId}${entry.tiers ? `[${entry.tiers.join('+')}]` : ''}:${entry.phase}`] = { phase: entry.phase, pass: gate.pass, unmet: gate.unmet, size: outcomes.length, versions };
      writeFileSync(gatesPath, `${JSON.stringify(gates, null, 2)}\n`);
      console.log(JSON.stringify({ GATE: `${entry.profileId}:${entry.phase}`, ...gate }));
    }
  }
  writeReview(state, runId, gates);
}

/**
 * After a validator fix: every candidate a previous run authored is validated again under the current validator
 * version, into a NEW run. No authoring call is made. The earlier run's verdicts are left as they were recorded.
 */
async function revalidate(): Promise<void> {
  refuseIfFrozen();
  const budget = Number(process.env.QB_GENERATION_BUDGET_USD);
  const probe = maySpend({ authorizedUsd: Number.isFinite(budget) && budget > 0 ? budget : null, entries: [] }, 0);
  if (!probe.allowed) { console.error(`REFUSED: ${probe.code} -- ${probe.detail}. No provider call was made.`); process.exit(2); }
  const runId = arg('run'); const from = arg('from'); const only = arg('only')?.split(',') ?? null;
  if (!runId || !from) { console.error('usage: revalidate --run <new id> --from <old id> [--only <itemId suffix>,...] [--batch-size n]'); process.exit(2); }
  const source = readJson<RunState | null>(join(OUT, 'run', from, 'state.json'), null);
  if (!source) { console.error(`REFUSED: run ${from} has no state.`); process.exit(2); }
  const dir = join(OUT, 'run', runId);
  mkdirSync(join(dir, 'checkpoints'), { recursive: true });
  const statePath = join(dir, 'state.json');
  const state = readJson<RunState>(statePath, { ledger: { authorizedUsd: budget, entries: [] }, checkpoints: [], records: [], items: {}, batchesByProfile: {} });
  state.ledger.authorizedUsd = budget;
  const versions = { profileVersion: GENERATOR_PROFILE_VERSION, validatorVersion: VALIDATOR_VERSION };
  if (state.records.some((r) => r.validatorVersion !== versions.validatorVersion)) { console.error('REFUSED: this run id holds records of another validator version.'); process.exit(2); }
  const specs = new Map(planState([]).specifications.map((s) => [s.slotKey, s]));
  const done = new Set(state.records.map((r) => r.itemId));
  const pairs = Object.values(source.items)
    .filter((i) => !done.has(i.itemId) && (!only || only.some((o) => i.itemId.endsWith(o))))
    .map((item) => ({ item, spec: { ...specs.get(item.slotKey)!, attempt: Number(item.itemId.slice(-1)) === 1 ? 1 : 0 } as GenerationSpecification }))
    .filter((p) => p.spec.slotKey)
    .sort((a, b) => (a.item.itemId < b.item.itemId ? -1 : 1));
  const { liveModelCall, revalidationReserveUsd, estimatedUsd, VALIDATION_MODEL } = await import('./live');
  const live = liveModelCall(process.env);
  const size = Number(arg('batch-size') ?? 6);
  for (let b = 0; b * size < pairs.length; b += 1) {
    const batch = pairs.slice(b * size, (b + 1) * size);
    const batchId = `REVALIDATION:${from}:${String(state.checkpoints.length + 1).padStart(3, '0')}`;
    const permission = maySpend(state.ledger, batch.length * revalidationReserveUsd());
    if (!permission.allowed) { console.error(`STOPPED before ${batchId}: ${permission.code} -- ${permission.detail}`); break; }
    const before = cumulativeSpend(state.ledger);
    const corpus: CorpusEntry[] = Object.values(state.items).filter((i) => state.records.some((r) => r.itemId === i.itemId && r.reviewDecision !== 'AUTO_REJECT')).map((i) => ({ id: i.itemId, source: 'EARLIER_BATCH', text: learnerText(i) }));
    const result = await revalidateItems(batch, live.call, corpus);
    for (const role of ['SOLVER', 'JUDGE'] as const) { const a = result.account[role]; state.ledger.entries.push({ batchId, provider: 'anthropic', model: VALIDATION_MODEL, purpose: 'VALIDATION', calls: a.calls, succeeded: a.succeeded, failed: a.failed, estimatedUsd: estimatedUsd(role, a) }); }
    for (const o of result.outcomes) { state.records.push(o.final.record); if (o.final.item) state.items[o.final.item.itemId] = o.final.item; (state.batchesByProfile[o.final.record.profileId] ??= []).push([o]); }
    const spent = cumulativeSpend(state.ledger);
    const cp = checkpoint({ runId, batchId, phase: 'C1', profileId: 'REVALIDATION', ...versions, cumulativeSpendUsd: spent, timestamp: new Date().toISOString(), outcomes: result.outcomes });
    state.checkpoints.push(cp);
    writeFileSync(join(dir, 'checkpoints', `${batchId.replace(/[:]/g, '_')}.json`), `${JSON.stringify(cp, null, 2)}\n`);
    writeFileSync(statePath, `${JSON.stringify(state)}\n`);
    console.log(JSON.stringify({ BATCH_ID: batchId, REVALIDATED: batch.length, MACHINE_CERTIFIED: cp.metrics.autoApproved, REVIEW_REQUIRED: cp.metrics.humanReview, REJECTED: cp.metrics.autoRejected, ACTUAL_SPEND: +(spent - before).toFixed(4), CUMULATIVE_SPEND: +spent.toFixed(4), BUDGET_REMAINING: +(budget - spent).toFixed(4), verdicts: result.outcomes.map((o) => `${o.final.record.itemId.slice(-28)} ${o.final.record.reviewDecision}:${o.final.record.reviewReason.slice(0, 90)}`) }));
  }
  writeReview(state, runId, {});
}

/** The review package: every review-bound item and the 2 % audit sample of the auto-approved. Nothing else. */
function writeReview(state: RunState, runId: string, gates: Record<string, { phase: string; pass: boolean }>): void {
  const finals = new Map<string, ValidationRecord>();
  for (const r of state.records) finals.set(r.slotKey, r);
  const records = [...finals.values()];
  const queue = reviewQueue(records).map((r) => reviewRow(r, state.items[r.itemId] ?? null));
  const audit = auditSample(records.filter((r) => r.reviewDecision === 'AUTO_APPROVE' && state.items[r.itemId]), runId).map((r) => reviewRow(r, state.items[r.itemId] ?? null));
  writeFileSync(join(OUT, 'QB_REVIEW_QUEUE.csv'), reviewCsv(queue));
  writeFileSync(join(OUT, 'QB_REVIEW_QUEUE.jsonl'), toJsonl(queue));
  writeFileSync(join(OUT, 'QB_AUTOAPPROVE_AUDIT_SAMPLE.csv'), reviewCsv(audit));
  writeFileSync(join(OUT, 'QB_ALL_VALIDATION_RESULTS.jsonl'), toJsonl(state.records));
  const all = Object.values(state.batchesByProfile).flat().flat();
  const keys = records.filter((r) => r.reviewDecision === 'AUTO_APPROVE' && r.itemType === 'SELECTED_RESPONSE').map((r) => state.items[r.itemId]?.proposedAnswer).filter((k): k is string => !!k);
  writeFileSync(join(OUT, 'QF_V5_DASHBOARD.json'), `${JSON.stringify({ runId, gates, overall: metricsOf(all), byFamily: metricsBy(all, 'family'), bySubject: metricsBy(all, 'subject'), byProfile: metricsBy(all, 'profileId'), byDifficulty: metricsBy(all, 'intendedDifficulty'), byItemType: metricsBy(all, 'itemType'), keyPosition: keyPositionFinding(keys, 4), spend: { authorizedUsd: state.ledger.authorizedUsd, cumulativeUsd: cumulativeSpend(state.ledger), entries: state.ledger.entries } }, null, 2)}\n`);
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'plan') plan();
  else if (command === 'revalidate') revalidate().catch((e) => { console.error((e as Error).message); process.exit(1); });
  else if (command === 'generate') generate().catch((e) => { console.error((e as Error).message); process.exit(1); });
  else { console.error(`usage: run.ts plan | generate   (existing runs: ${existsSync(join(OUT, 'run')) ? readdirSync(join(OUT, 'run')).join(', ') : 'none'})`); process.exit(2); }
}
