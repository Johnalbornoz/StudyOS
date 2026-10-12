/**
 * Question Factory V5 -- the run script.
 *
 *   npx tsx scripts/operations/qf-v5/run.ts plan [--bank <inventory.json>]
 *       No provider, no database, no key. Computes readiness and the coverage-driven generation plan from the
 *       governed blueprints and a bank inventory (default: empty), and writes the coverage matrix and plan.
 *
 *   QB_GENERATION_BUDGET_USD=<n> OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
 *   npx tsx scripts/operations/qf-v5/run.ts generate --run <id> --phase C1|C2|SCALE --cluster <id> [--batch-size 50]
 *       Live. Refuses without an authorised budget. Asks the spend guard before every batch with the batch's
 *       worst case, checkpoints after every batch, and stops a cluster on any stop condition.
 *
 * Pass ONLY the three variables into the process. Never --env-file an application .env: it holds a DATABASE_URL.
 * This script writes under docs/audits/qb_review/ only. It ingests nothing: promotion to the bank is a separate,
 * governed step.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allV2Configs } from '../../../src/lib/exam-core/verticals/v2/all';
import { RETIRED_V2_CONFIG_KEYS } from '../../../src/lib/exam-core/verticals/v2/index';
import { GENERATION_PROFILES, GENERATOR_PROFILE_VERSION, profileById } from '../../../src/lib/exam-core/question-bank/production/v5/generation-profile';
import { VALIDATOR_VERSION, keyPositionFinding, type CorpusEntry } from '../../../src/lib/exam-core/question-bank/production/v5/deterministic-stages';
import { learnerText, type CandidateItem, type GenerationSpecification } from '../../../src/lib/exam-core/question-bank/production/v5/item';
import { auditSample, calibrationGate, checkpoint, completedBatchIds, cumulativeSpend, maySpend, metricsBy, metricsOf, reviewQueue, stopCondition, type Checkpoint, type SpendLedger } from '../../../src/lib/exam-core/question-bank/production/v5/batch-control';
import { blueprintSections, generationAllocation, globalReadiness, type BankItem } from '../../../src/lib/exam-core/question-bank/production/v5/readiness';
import { planSpecifications } from '../../../src/lib/exam-core/question-bank/production/v5/plan';
import { authoringPrompt } from '../../../src/lib/exam-core/question-bank/production/v5/prompts';
import type { SpecificationOutcome, ValidationRecord } from '../../../src/lib/exam-core/question-bank/production/v5/pipeline';
import { COVERAGE_HEADER, coverageRows, reviewCsv, reviewRow, toCsv, toJsonl } from './artifacts';
import { WORST_CASE_CALLS, runBatch, type ModelRole } from './engine';

const ROOT = join(__dirname, '..', '..', '..');
const OUT = join(ROOT, 'docs', 'audits', 'qb_review');
const AUDITS = join(ROOT, 'docs', 'audits');
/** Share of raw candidates expected to be certified. A planning assumption until C1/C2 measure it. */
export const PLANNING_YIELD = 0.8;

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

interface RunState { ledger: SpendLedger; checkpoints: Checkpoint[]; records: ValidationRecord[]; items: Record<string, CandidateItem>; batchesByCluster: Record<string, SpecificationOutcome[][]> }

async function generate(): Promise<void> {
  const budget = Number(process.env.QB_GENERATION_BUDGET_USD);
  const ledgerProbe: SpendLedger = { authorizedUsd: Number.isFinite(budget) && budget > 0 ? budget : null, entries: [] };
  const probe = maySpend(ledgerProbe, 0);
  if (!probe.allowed) { console.error(`REFUSED: ${probe.code} -- ${probe.detail}. No provider call was made.`); process.exit(2); }
  const runId = arg('run'); const phase = arg('phase') as 'C1' | 'C2' | 'SCALE' | null; const cluster = arg('cluster');
  if (!runId || !phase || !cluster || !['C1', 'C2', 'SCALE'].includes(phase)) { console.error('usage: generate --run <id> --phase C1|C2|SCALE --cluster <id> [--batch-size n]'); process.exit(2); }
  const dir = join(OUT, 'run', runId);
  mkdirSync(join(dir, 'checkpoints'), { recursive: true });
  const statePath = join(dir, 'state.json');
  const state = readJson<RunState>(statePath, { ledger: { authorizedUsd: budget, entries: [] }, checkpoints: [], records: [], items: {}, batchesByCluster: {} });
  state.ledger.authorizedUsd = budget; // the operator's figure for this invocation; never raised by the script
  const versions = { profileVersion: GENERATOR_PROFILE_VERSION, validatorVersion: VALIDATOR_VERSION };
  // a calibration gate must be on record before scale: C1 before C2, C2 before SCALE, for this cluster and these versions
  const gates = readJson<Record<string, { phase: string; pass: boolean; versions: typeof versions }>>(join(dir, 'gates.json'), {});
  const need = phase === 'C2' ? 'C1' : phase === 'SCALE' ? 'C2' : null;
  if (need && !(gates[`${cluster}:${need}`]?.pass && gates[`${cluster}:${need}`].versions.validatorVersion === versions.validatorVersion && gates[`${cluster}:${need}`].versions.profileVersion === versions.profileVersion)) { console.error(`REFUSED: ${cluster} has no passing ${need} gate under ${versions.profileVersion} / ${versions.validatorVersion}.`); process.exit(2); }

  const { specifications } = planState([]);
  const done = new Set(state.records.map((r) => r.slotKey));
  const mine = specifications.filter((s) => clusterOf(s.profileId) === cluster && !done.has(s.slotKey));
  const size = phase === 'C1' ? 20 : phase === 'C2' ? 50 : Number(arg('batch-size') ?? 50);
  const batches: GenerationSpecification[][] = phase === 'SCALE' ? Array.from({ length: Math.ceil(mine.length / size) }, (_, i) => mine.slice(i * size, (i + 1) * size)) : [mine.slice(0, size)];
  const { liveModelCall, worstCaseUsd, estimatedUsd, VALIDATION_MODEL } = await import('./live');
  const live = liveModelCall(process.env);
  const finished = new Set(completedBatchIds(state.checkpoints, versions));

  for (let b = 0; b < batches.length; b += 1) {
    const batchId = `${cluster}:${phase}:${String(state.checkpoints.filter((c) => c.profileId === cluster && c.phase === phase).length + 1).padStart(3, '0')}`;
    if (finished.has(batchId) || !batches[b].length) continue;
    const chars = Math.max(...batches[b].map((s) => { const r = authoringPrompt(s, profileById(s.profileId)!); return r.system.length + r.user.length; }));
    const worst = batches[b].length * (Object.keys(WORST_CASE_CALLS) as ModelRole[]).reduce((a, role) => a + WORST_CASE_CALLS[role] * worstCaseUsd(role, role === 'AUTHOR' ? chars : chars + 12000), 0);
    const permission = maySpend(state.ledger, worst);
    if (!permission.allowed) { console.error(`STOPPED before ${batchId}: ${permission.code} -- ${permission.detail}`); break; }
    const corpus: CorpusEntry[] = Object.values(state.items).map((i) => ({ id: i.itemId, source: 'EARLIER_BATCH', text: learnerText(i) }));
    const result = await runBatch(batches[b], live.call, corpus);
    for (const role of Object.keys(result.account) as ModelRole[]) { const a = result.account[role]; state.ledger.entries.push({ batchId, provider: role === 'AUTHOR' ? 'openai' : 'anthropic', model: role === 'AUTHOR' ? live.authorModel : VALIDATION_MODEL, purpose: role === 'AUTHOR' ? 'GENERATION' : 'VALIDATION', calls: a.calls, succeeded: a.succeeded, failed: a.failed, estimatedUsd: estimatedUsd(role, a) }); }
    for (const o of result.outcomes) { for (const a of o.attempts) state.records.push(a.record); if (o.final.item) state.items[o.final.item.itemId] = o.final.item; }
    (state.batchesByCluster[cluster] ??= []).push(result.outcomes);
    const cp = checkpoint({ runId, batchId, phase, profileId: cluster, ...versions, cumulativeSpendUsd: cumulativeSpend(state.ledger), timestamp: new Date().toISOString(), outcomes: result.outcomes });
    state.checkpoints.push(cp);
    writeFileSync(join(dir, 'checkpoints', `${batchId.replace(/[:]/g, '_')}.json`), `${JSON.stringify(cp, null, 2)}\n`);
    writeFileSync(statePath, `${JSON.stringify(state)}\n`);
    console.log(JSON.stringify({ batchId, metrics: cp.metrics, cumulativeSpendUsd: cp.cumulativeSpendUsd, authorizedUsd: budget }));
    if (phase !== 'SCALE') {
      const gate = calibrationGate(phase, result.outcomes);
      gates[`${cluster}:${phase}`] = { phase, pass: gate.pass, versions };
      writeFileSync(join(dir, 'gates.json'), `${JSON.stringify(gates, null, 2)}\n`);
      console.log(JSON.stringify(gate));
      // a failed calibration batch is discarded from certification: its items are never promoted
      if (!gate.pass) for (const o of result.outcomes) if (o.final.item) delete state.items[o.final.item.itemId];
      writeFileSync(statePath, `${JSON.stringify(state)}\n`);
    } else {
      const verdict = stopCondition(state.batchesByCluster[cluster].filter((x) => x.length));
      if (verdict.warnings.length) console.warn(JSON.stringify(verdict.warnings));
      if (verdict.stop) { console.error(`STOPPED scaling ${cluster}: ${verdict.reasons.join(', ')}. Fix the profile, bump the version, run a fresh calibration batch.`); break; }
    }
  }
  writeReview(state, runId);
}

/** The review package: every review-bound item and the 2 % audit sample of the auto-approved. Nothing else. */
function writeReview(state: RunState, runId: string): void {
  const finals = new Map<string, ValidationRecord>();
  for (const r of state.records) finals.set(r.slotKey, r);
  const records = [...finals.values()];
  const queue = reviewQueue(records).map((r) => reviewRow(r, state.items[r.itemId] ?? null));
  const audit = auditSample(records.filter((r) => r.reviewDecision === 'AUTO_APPROVE' && state.items[r.itemId]), runId).map((r) => reviewRow(r, state.items[r.itemId] ?? null));
  writeFileSync(join(OUT, 'QB_REVIEW_QUEUE.csv'), reviewCsv(queue));
  writeFileSync(join(OUT, 'QB_REVIEW_QUEUE.jsonl'), toJsonl(queue));
  writeFileSync(join(OUT, 'QB_AUTOAPPROVE_AUDIT_SAMPLE.csv'), reviewCsv(audit));
  writeFileSync(join(OUT, 'QB_ALL_VALIDATION_RESULTS.jsonl'), toJsonl(state.records));
  const all = Object.values(state.batchesByCluster).flat().flat();
  const keys = records.filter((r) => r.reviewDecision === 'AUTO_APPROVE' && r.itemType === 'SELECTED_RESPONSE').map((r) => state.items[r.itemId]?.proposedAnswer).filter((k): k is string => !!k);
  writeFileSync(join(OUT, 'QF_V5_DASHBOARD.json'), `${JSON.stringify({ runId, overall: metricsOf(all), byFamily: metricsBy(all, 'family'), bySubject: metricsBy(all, 'subject'), byProfile: metricsBy(all, 'profileId'), byDifficulty: metricsBy(all, 'intendedDifficulty'), byItemType: metricsBy(all, 'itemType'), keyPosition: keyPositionFinding(keys, 4), spend: { authorizedUsd: state.ledger.authorizedUsd, cumulativeUsd: cumulativeSpend(state.ledger), entries: state.ledger.entries } }, null, 2)}\n`);
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'plan') plan();
  else if (command === 'generate') generate().catch((e) => { console.error((e as Error).message); process.exit(1); });
  else { console.error(`usage: run.ts plan | generate   (existing runs: ${existsSync(join(OUT, 'run')) ? readdirSync(join(OUT, 'run')).join(', ') : 'none'})`); process.exit(2); }
}
