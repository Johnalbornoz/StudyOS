/**
 * QB-R2F -- the run script of the NEXT run: file IO, git and the one network transport around the frozen pipeline.
 * No database. PREPARED, NOT RUN: no call has been made with it.
 *
 *   --write-freeze                 compute the freeze manifest of the working tree and write validator-freeze.json. No call.
 *   --verify-freeze --freeze-sha <sha>   say whether the working tree is the frozen one. No call.
 *   --preflight                    the plan, its worst case against the cumulative cap, and the expectation from QB-R2E. No call.
 *   --first   --freeze-sha <sha>   ONE call, for adaptation 01, made alone (a rejected request voids the run)
 *   --run     --freeze-sha <sha>   every remaining call, one after another, each planned from the recording so far
 *   --write                        replay the recording (no network) and write every derived artifact
 *
 * BEFORE ANY CALL the script (1) verifies the freeze and (2) checks that the worst case of the WHOLE plan fits the
 * cumulative cap. It refuses, naming the reason, when either fails. The key comes from OPENAI_API_KEY only.
 * One call per attempt; no retry of any kind.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SPECIFICATION_PROVIDER_JSON_SCHEMA } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import { GUARD_PRICE_BASIS } from '../qb-r2d/budget';
import { configuredGeneration, LIVE_KEY_ENVIRONMENT_VARIABLE, LiveProviderBlockedError, repoConfiguredPrice, requireLiveKey } from '../qb-r2d/live-provider';
import { CumulativeBudgetExceededError, CumulativeBudgetProvider, R2eLedger, RequestRejectedError, type R2eLedgerEntry, type R2eTransport } from '../qb-r2e/budget';
import { createR2eLiveTransport } from '../qb-r2e/live-provider';
import { PlanDoesNotFitTheCapError, planBudget, R2F_CUMULATIVE_CAP_USD, R2F_MAX_CALLS, R2F_MAX_OUTPUT_TOKENS, R2F_REASONING_EFFORT, type PlanBudget } from './budget';
import { loadR2fEvidence, priorSpendUsdGuardBasis, type R2fEvidence } from './evidence';
import { computeR2fFreezeManifest, R2F_RUN_PARAMETERS, verifyR2fFreeze, type R2fFreezeVerdict } from './freeze';
import { avoidListsFor, nextUnitToCall, planR2fUnit, QB_R2F_DIR, QB_R2F_FILES, QB_R2F_REQUESTED_BY, r2fMalformedCodeOf, runQbR2f, serializeR2fArtifact, type R2fRecordingFile } from './pipeline';
import { buildR2fSelection } from './selection';

const ROOT = process.cwd();
const DIR = join(ROOT, QB_R2F_DIR);
const path = (f: string) => join(DIR, f);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
const has = (name: string) => process.argv.includes(name);

/** The worst case of the whole plan, from the actual version-3 prompts of the twenty adaptations. */
export function r2fPlanBudget(root: string = ROOT, evidence: R2fEvidence = loadR2fEvidence(root), capUsd: number = R2F_CUMULATIVE_CAP_USD): PlanBudget & { promptCharacters: { min: number; max: number; total: number } } {
  const chars = buildR2fSelection().map((a) => { const u = planR2fUnit(a, 1, R2F_RUN_PARAMETERS.model, avoidListsFor(a, evidence, [])); return u.system.length + u.user.length; });
  return { ...planBudget(priorSpendUsdGuardBasis(root).total, chars, capUsd), promptCharacters: { min: Math.min(...chars), max: Math.max(...chars), total: chars.reduce((a, b) => a + b, 0) } };
}
/**
 * The gate in front of the provider. `createTransport` is called ONLY when the freeze verifies AND the worst case of
 * the plan fits the cap: a refused run never builds a transport, so it cannot make a call.
 */
export function transportBehindTheGates(verdict: R2fFreezeVerdict, plan: PlanBudget, createTransport: () => R2eTransport): R2eTransport {
  if (!verdict.ok) throw new Error(`FREEZE_NOT_VERIFIED: ${verdict.reasons.join('; ')}`);
  if (!plan.fits) throw new PlanDoesNotFitTheCapError(plan);
  return createTransport();
}

interface LedgerFile { entries: R2eLedgerEntry[] }
function saveLedger(ledger: R2eLedger, model: string, freeze: R2fRecordingFile['freeze'], prior: { r2d: number; r2e: number }): void {
  const real = ledger.entries.filter((e) => e.outcome !== 'REFUSED_BY_BUDGET');
  writeFileSync(path(QB_R2F_FILES.ledger), serializeR2fArtifact({
    kind: 'QB_R2F_SPEND_LEDGER', label: 'Every live provider call of QB-R2F. Costs are provider-reported token usage x a price table; neither table is an invoice.', freeze, cumulativeCapUsdGuardBasis: R2F_CUMULATIVE_CAP_USD, priorSpendUsdGuardBasis: { qbR2d: Number(prior.r2d.toFixed(6)), qbR2e: Number(prior.r2e.toFixed(6)) }, guardPriceBasis: GUARD_PRICE_BASIS, repoPriceBasis: repoConfiguredPrice(model),
    totals: { calls: real.length, wellFormed: real.filter((e) => e.outcome === 'WELL_FORMED').length, malformed: real.filter((e) => e.outcome === 'MALFORMED').length, transportErrors: real.filter((e) => e.outcome === 'TRANSPORT_ERROR').length, requestRejected: real.filter((e) => e.outcome === 'REQUEST_REJECTED').length, refusedByBudget: ledger.entries.length - real.length, inputTokens: real.reduce((n, e) => n + (e.usage?.inputTokens ?? 0), 0), outputTokens: real.reduce((n, e) => n + (e.usage?.outputTokens ?? 0), 0), r2fSpentUsdGuardBasis: Number(ledger.spentUsdGuardBasis().toFixed(6)), cumulativeUsdGuardBasis: Number(ledger.cumulativeUsdGuardBasis().toFixed(6)) },
    entries: ledger.entries,
  }));
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const model = R2F_RUN_PARAMETERS.model;
  if (configuredGeneration().primaryModel !== model) throw new Error(`FROZEN_MODEL_IS_NOT_THE_REPOSITORYS_ROUTED_MODEL: ${model} / ${configuredGeneration().primaryModel}`);
  const freezeSha = arg('--freeze-sha');
  if (has('--write-freeze')) {
    const manifest = computeR2fFreezeManifest(ROOT);
    writeFileSync(path(QB_R2F_FILES.freeze), serializeR2fArtifact(manifest));
    console.log(JSON.stringify({ written: QB_R2F_FILES.freeze, files: manifest.files.length, dataFiles: manifest.dataFiles.length, manifestHash: manifest.manifestHash }));
    return;
  }
  if (has('--verify-freeze')) { console.log(JSON.stringify(verifyR2fFreeze(ROOT, freezeSha), null, 1)); return; }
  const evidence = loadR2fEvidence(ROOT);
  if (has('--write')) {
    const recording = JSON.parse(readFileSync(path(QB_R2F_FILES.recording), 'utf8')) as R2fRecordingFile;
    const out = await runQbR2f(recording, evidence);
    for (const [name, value] of [['selection', out.selection], ['specifications', out.specifications], ['batch', out.batch], ['report', out.report], ['gates', out.gates], ['sameFamilyProof', out.sameFamilyProof], ['approachProof', out.approachProof], ['rights', out.rights]] as const) writeFileSync(path(QB_R2F_FILES[name]), serializeR2fArtifact(value));
    console.log(JSON.stringify(out.gates.evaluation, null, 1));
    return;
  }
  const prior = priorSpendUsdGuardBasis(ROOT);
  const plan = r2fPlanBudget(ROOT, evidence);
  if (has('--preflight')) {
    // what QB-R2E actually used per call, as the realistic expectation
    const r2e = (JSON.parse(readFileSync(join(ROOT, 'docs/exams/question-bank/pilots/qb-r2e/spend-ledger.json'), 'utf8')) as { entries: R2eLedgerEntry[] }).entries;
    const perCall = r2e.reduce((n, e) => n + e.costUsdGuardBasis, 0) / r2e.length;
    const largestOutput = Math.max(...r2e.map((e) => e.usage?.outputTokens ?? 0));
    console.log(JSON.stringify({
      runParameters: R2F_RUN_PARAMETERS, credential: { variable: LIVE_KEY_ENVIRONMENT_VARIABLE, presentInProcess: typeof process.env[LIVE_KEY_ENVIRONMENT_VARIABLE] === 'string' && process.env[LIVE_KEY_ENVIRONMENT_VARIABLE]!.length >= 20 },
      priorSpendUsdGuardBasis: { qbR2d: Number(prior.r2d.toFixed(6)), qbR2e: Number(prior.r2e.toFixed(6)), total: Number(prior.total.toFixed(6)) },
      plan: { ...plan, worstCasePlanUsd: Number(plan.worstCasePlanUsd.toFixed(6)), cumulativeWorstCaseUsd: Number(plan.cumulativeWorstCaseUsd.toFixed(6)), remainingUsd: Number(plan.remainingUsd.toFixed(6)) },
      expectationFromQbR2e: { perCallUsdGuardBasis: Number(perCall.toFixed(6)), largestOutputTokens: largestOutput, twentyCallsUsd: Number((20 * perCall).toFixed(4)), twentySixCallsAsInQbR2eUsd: Number((26 * perCall).toFixed(4)), fortyCallsUsd: Number((40 * perCall).toFixed(4)), note: 'QB-R2F prompts are longer than QB-R2E\'s (do-not-reuse lists, demand policy, evidence guidance): expect somewhat more input per call.' },
      R2F_READY_FOR_LIVE_RUN: plan.fits ? 'the worst case of the plan fits the cap' : `NO: PLAN_DOES_NOT_FIT_THE_CAP; MINIMUM_REQUIRED_CAP ${plan.minimumRequiredCapUsd}`,
    }, null, 1));
    return;
  }
  if (!has('--first') && !has('--run')) { console.log('nothing to do: see the header of this file'); return; }

  // ---- everything below can call the provider: the freeze and the plan are checked first -------------------------
  const verdict = verifyR2fFreeze(ROOT, freezeSha);
  let transport: R2eTransport;
  try {
    transport = transportBehindTheGates(verdict, plan, () => {
      let key: string;
      try { key = requireLiveKey(); } catch (e) { if (e instanceof LiveProviderBlockedError) throw new Error(`LIVE_PROVIDER_BLOCKED: ${e.missing}`); throw e; }
      return createR2eLiveTransport({ model, apiKey: key, jsonSchema: SPECIFICATION_PROVIDER_JSON_SCHEMA });
    });
  } catch (e) { console.log(JSON.stringify({ REFUSED: (e as Error).message })); process.exitCode = 2; return; }
  const freeze = { freezeCommitSha: freezeSha!, manifestHash: verdict.manifestHash! };
  const startedAt = new Date().toISOString();
  const recording: R2fRecordingFile = existsSync(path(QB_R2F_FILES.recording)) ? (JSON.parse(readFileSync(path(QB_R2F_FILES.recording), 'utf8')) as R2fRecordingFile) : { kind: 'QB_R2F_RECORDED_LIVE_RESPONSES', label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT', freeze, run: { runId: `qb-r2f-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`, startedAt, provider: transport.providerId, requestedModel: model, requestedBy: QB_R2F_REQUESTED_BY, reasoningEffort: R2F_REASONING_EFFORT, maxOutputTokens: R2F_MAX_OUTPUT_TOKENS, responseMode: 'STRICT_JSON_SCHEMA', gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' }, responses: [] };
  if (recording.freeze.freezeCommitSha !== freeze.freezeCommitSha || recording.freeze.manifestHash !== freeze.manifestHash) { console.log(JSON.stringify({ REFUSED: 'RECORDING_IS_OF_ANOTHER_FREEZE' })); process.exitCode = 2; return; }
  if (recording.responses.some((r) => r.status === 'REQUEST_REJECTED')) { console.log(JSON.stringify({ REFUSED: 'RUN_IS_VOID: a request was rejected; no further call is made under this freeze' })); process.exitCode = 5; return; }
  const ledger = new R2eLedger(prior.total, existsSync(path(QB_R2F_FILES.ledger)) ? (JSON.parse(readFileSync(path(QB_R2F_FILES.ledger), 'utf8')) as LedgerFile).entries : []);
  let current = 'UNKNOWN_UNIT';
  const provider = new CumulativeBudgetProvider({
    transport, ledger, capUsd: R2F_CUMULATIVE_CAP_USD, guardPrice: GUARD_PRICE_BASIS, repoPrice: repoConfiguredPrice(model), maxOutputTokens: R2F_MAX_OUTPUT_TOKENS, maxCalls: R2F_MAX_CALLS, malformedCodeOf: r2fMalformedCodeOf,
    unitKeyOf: () => current, now: () => new Date().toISOString(),
    onRecording: (r) => { recording.responses.push(r); writeFileSync(path(QB_R2F_FILES.recording), serializeR2fArtifact(recording)); },
    onLedger: () => saveLedger(ledger, model, freeze, prior),
  });
  // one call at a time; each next unit is planned by the frozen pipeline from the recording so far
  for (let made = 0; made < R2F_MAX_CALLS; made += 1) {
    const u = await nextUnitToCall(recording, evidence);
    if (!u) break;
    current = u.unitKey;
    try {
      await provider.generate({ prompt: { system: u.system, instruction: JSON.parse(u.user) }, promptHash: u.promptHash });
    } catch (e) {
      if (e instanceof CumulativeBudgetExceededError) { console.log(JSON.stringify({ STOP: 'CUMULATIVE_SPEND_WOULD_EXCEED_CAP', detail: e.message })); process.exitCode = 3; return; }
      if (e instanceof RequestRejectedError) { console.log(JSON.stringify({ STOP: 'REQUEST_REJECTED_RUN_VOID', LIVE_PROVIDER: 'BLOCKED', detail: e.message })); process.exitCode = 5; return; }
    }
    const last = ledger.entries[ledger.entries.length - 1];
    console.log(JSON.stringify({ unit: u.unitKey, outcome: last.outcome, usage: last.usage, finishReason: last.finishReason, cumulativeUsdGuardBasis: Number(ledger.cumulativeUsdGuardBasis().toFixed(4)) }));
    if (has('--first')) break;
  }
  saveLedger(ledger, model, freeze, prior);
}

if (process.argv[1] && /qb-r2f[\\/]run\.ts$/.test(process.argv[1])) main().catch((e) => { console.error((e as Error).message); process.exit(1); });
