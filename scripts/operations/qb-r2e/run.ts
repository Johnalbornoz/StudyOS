/**
 * QB-R2E -- the run script: file IO, git and the one network transport around the frozen pipeline. No database.
 *
 *   --write-freeze                 compute the freeze manifest of the working tree and write validator-freeze.json. No call.
 *   --verify-freeze --freeze-sha <sha>   say whether the working tree is the frozen one. No call.
 *   --preflight                    planned calls, prompt sizes and the worst-case cost against the cumulative cap. No call.
 *   --first   --freeze-sha <sha>   ONE call, for adaptation 01, made alone (a rejected request voids the run)
 *   --run     --freeze-sha <sha>   every first attempt not yet made, then exactly the regenerations the pre-registered rule says are due
 *   --write                        replay the recording (no network) and write every derived artifact
 *
 * BEFORE ANY CALL the script verifies the freeze (`verifyFreeze`) and refuses, naming every reason, when the working
 * tree is not the frozen one. `--freeze-sha` is required for `--first` and `--run`.
 *
 * The key is taken from the environment variable OPENAI_API_KEY and from nowhere else; pass ONLY that variable.
 * There is NO retry: one call per attempt. The recording and the ledger are saved after every call.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SPECIFICATION_PROVIDER_JSON_SCHEMA } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import { GUARD_PRICE_BASIS } from '../qb-r2d/budget';
import { configuredGeneration, LIVE_KEY_ENVIRONMENT_VARIABLE, LiveProviderBlockedError, repoConfiguredPrice, requireLiveKey } from '../qb-r2d/live-provider';
import { CumulativeBudgetExceededError, CumulativeBudgetProvider, R2D_R2E_CUMULATIVE_CAP_USD, R2E_MAX_CALLS, R2E_MAX_OUTPUT_TOKENS, R2E_REASONING_EFFORT, R2eLedger, RequestRejectedError, worstCaseCallUsd, type R2eLedgerEntry, type R2eTransport } from './budget';
import { pilotCorpus, r2dCandidates, r2dParameterSets, r2dSpendUsdGuardBasis } from './evidence';
import { computeFreezeManifest, FREEZE_RUN_PARAMETERS, verifyFreeze, type FreezeVerdict } from './freeze';
import { createR2eLiveTransport } from './live-provider';
import { plannedFirstAttempts, QB_R2E_DIR, QB_R2E_FILES, QB_R2E_REQUESTED_BY, r2eMalformedCodeOf, regenerationsDue, runQbR2e, serializeR2eArtifact, type R2eEvidence, type R2ePlannedUnit, type R2eRecordingFile } from './pipeline';

const ROOT = process.cwd();
const DIR = join(ROOT, QB_R2E_DIR);
const path = (f: string) => join(DIR, f);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
const has = (name: string) => process.argv.includes(name);
export const loadEvidence = (root: string = ROOT): R2eEvidence => ({ r2dCandidates: r2dCandidates(root), pilotCorpus: pilotCorpus(root), avoidParameterSets: r2dParameterSets(root) });

/**
 * The gate in front of the provider. `createTransport` is called ONLY when the freeze verifies: a refused run never
 * builds a transport, so it cannot make a call. Exported so that a test can prove the refusal without a network.
 */
export function transportBehindTheFreeze(verdict: FreezeVerdict, createTransport: () => R2eTransport): R2eTransport {
  if (!verdict.ok) throw new Error(`FREEZE_NOT_VERIFIED: ${verdict.reasons.join('; ')}`);
  return createTransport();
}

interface LedgerFile { kind: 'QB_R2E_SPEND_LEDGER'; label: string; freeze: R2eRecordingFile['freeze']; cumulativeCapUsdGuardBasis: number; r2dSpendUsdGuardBasis: number; guardPriceBasis: typeof GUARD_PRICE_BASIS; repoPriceBasis: ReturnType<typeof repoConfiguredPrice>; totals: Record<string, unknown>; entries: R2eLedgerEntry[] }
function saveLedger(ledger: R2eLedger, model: string, freeze: R2eRecordingFile['freeze']): void {
  const real = ledger.entries.filter((e) => e.outcome !== 'REFUSED_BY_BUDGET');
  const file: LedgerFile = {
    kind: 'QB_R2E_SPEND_LEDGER', label: 'Every live provider call of QB-R2E. Costs are provider-reported token usage x a price table; neither table is an invoice.', freeze, cumulativeCapUsdGuardBasis: R2D_R2E_CUMULATIVE_CAP_USD, r2dSpendUsdGuardBasis: Number(ledger.priorSpendUsdGuardBasis.toFixed(6)), guardPriceBasis: GUARD_PRICE_BASIS, repoPriceBasis: repoConfiguredPrice(model),
    totals: { calls: real.length, wellFormed: real.filter((e) => e.outcome === 'WELL_FORMED').length, malformed: real.filter((e) => e.outcome === 'MALFORMED').length, transportErrors: real.filter((e) => e.outcome === 'TRANSPORT_ERROR').length, requestRejected: real.filter((e) => e.outcome === 'REQUEST_REJECTED').length, refusedByBudget: ledger.entries.length - real.length, inputTokens: real.reduce((n, e) => n + (e.usage?.inputTokens ?? 0), 0), outputTokens: real.reduce((n, e) => n + (e.usage?.outputTokens ?? 0), 0), r2eSpentUsdGuardBasis: Number(ledger.spentUsdGuardBasis().toFixed(6)), cumulativeUsdGuardBasis: Number(ledger.cumulativeUsdGuardBasis().toFixed(6)), r2eSpentUsdRepoConfiguredBasis: real.some((e) => e.costUsdRepoBasis === null) ? null : Number(real.reduce((n, e) => n + (e.costUsdRepoBasis ?? 0), 0).toFixed(6)) },
    entries: ledger.entries,
  };
  writeFileSync(path(QB_R2E_FILES.ledger), serializeR2eArtifact(file));
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const model = FREEZE_RUN_PARAMETERS.model;
  if (configuredGeneration().primaryModel !== model) throw new Error(`FROZEN_MODEL_IS_NOT_THE_REPOSITORYS_ROUTED_MODEL: ${model} / ${configuredGeneration().primaryModel}`);
  const freezeSha = arg('--freeze-sha');

  if (has('--write-freeze')) {
    const manifest = computeFreezeManifest(ROOT);
    writeFileSync(path(QB_R2E_FILES.freeze), serializeR2eArtifact(manifest));
    console.log(JSON.stringify({ written: QB_R2E_FILES.freeze, files: manifest.files.length, dataFiles: manifest.dataFiles.length, manifestHash: manifest.manifestHash }));
    return;
  }
  if (has('--verify-freeze')) { console.log(JSON.stringify(verifyFreeze(ROOT, freezeSha), null, 1)); return; }

  const evidence = loadEvidence();
  if (has('--write')) {
    const recording = JSON.parse(readFileSync(path(QB_R2E_FILES.recording), 'utf8')) as R2eRecordingFile;
    const out = await runQbR2e(recording, evidence);
    for (const [name, value] of [['selection', out.selection], ['specifications', out.specifications], ['batch', out.batch], ['report', out.report], ['gates', out.gates], ['sameFamilyProof', out.sameFamilyProof], ['approachProof', out.approachProof], ['rights', out.rights]] as const) writeFileSync(path(QB_R2E_FILES[name]), serializeR2eArtifact(value));
    console.log(JSON.stringify(out.gates.evaluation, null, 1));
    return;
  }

  const firstUnits = plannedFirstAttempts(model, evidence);
  const prior = r2dSpendUsdGuardBasis(ROOT);
  if (has('--preflight')) {
    const chars = firstUnits.map((u) => u.system.length + u.user.length);
    const worst = chars.map((c) => worstCaseCallUsd(c));
    const worstFirst = worst.reduce((a, b) => a + b, 0);
    console.log(JSON.stringify({
      runParameters: FREEZE_RUN_PARAMETERS, credential: { variable: LIVE_KEY_ENVIRONMENT_VARIABLE, presentInProcess: typeof process.env[LIVE_KEY_ENVIRONMENT_VARIABLE] === 'string' && process.env[LIVE_KEY_ENVIRONMENT_VARIABLE]!.length >= 20 },
      units: firstUnits.length, promptCharacters: { min: Math.min(...chars), max: Math.max(...chars), total: chars.reduce((a, b) => a + b, 0) },
      cumulativeCapUsdGuardBasis: R2D_R2E_CUMULATIVE_CAP_USD, r2dSpendUsdGuardBasis: Number(prior.toFixed(6)), remainingUsdGuardBasis: Number((R2D_R2E_CUMULATIVE_CAP_USD - prior).toFixed(6)),
      worstCase: { perCallUsdMax: Number(Math.max(...worst).toFixed(6)), twentyFirstAttemptsUsd: Number(worstFirst.toFixed(6)), plusTwentyRegenerationsUsd: Number((2 * worstFirst).toFixed(6)), cumulativeWithR2dUsd: Number((prior + 2 * worstFirst).toFixed(6)), fitsTheCap: prior + 2 * worstFirst <= R2D_R2E_CUMULATIVE_CAP_USD },
      plan: `${firstUnits.length} first calls + at most ${firstUnits.length} regenerations = at most ${R2E_MAX_CALLS} calls; no retry of any kind`,
    }, null, 1));
    return;
  }
  if (!has('--first') && !has('--run')) { console.log('nothing to do: see the header of this file'); return; }

  // ---- everything below can call the provider: the freeze is verified first -------------------------------------
  const verdict = verifyFreeze(ROOT, freezeSha);
  let transport: R2eTransport;
  try {
    transport = transportBehindTheFreeze(verdict, () => {
      let key: string;
      try { key = requireLiveKey(); } catch (e) { if (e instanceof LiveProviderBlockedError) throw new Error(`LIVE_PROVIDER_BLOCKED: ${e.missing}`); throw e; }
      return createR2eLiveTransport({ model, apiKey: key, jsonSchema: SPECIFICATION_PROVIDER_JSON_SCHEMA });
    });
  } catch (e) { console.log(JSON.stringify({ REFUSED: (e as Error).message })); process.exitCode = 2; return; }
  const freeze = { freezeCommitSha: freezeSha!, manifestHash: verdict.manifestHash! };

  const startedAt = new Date().toISOString();
  const recording: R2eRecordingFile = existsSync(path(QB_R2E_FILES.recording)) ? (JSON.parse(readFileSync(path(QB_R2E_FILES.recording), 'utf8')) as R2eRecordingFile) : { kind: 'QB_R2E_RECORDED_LIVE_RESPONSES', label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT', freeze, run: { runId: `qb-r2e-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`, startedAt, provider: transport.providerId, requestedModel: model, requestedBy: QB_R2E_REQUESTED_BY, reasoningEffort: R2E_REASONING_EFFORT, maxOutputTokens: R2E_MAX_OUTPUT_TOKENS, responseMode: 'STRICT_JSON_SCHEMA', gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' }, responses: [] };
  if (recording.freeze.freezeCommitSha !== freeze.freezeCommitSha || recording.freeze.manifestHash !== freeze.manifestHash) { console.log(JSON.stringify({ REFUSED: 'RECORDING_IS_OF_ANOTHER_FREEZE' })); process.exitCode = 2; return; }
  if (recording.responses.some((r) => r.status === 'REQUEST_REJECTED')) { console.log(JSON.stringify({ REFUSED: 'RUN_IS_VOID: a request was rejected; no further call is made under this freeze' })); process.exitCode = 5; return; }
  const ledger = new R2eLedger(prior, existsSync(path(QB_R2E_FILES.ledger)) ? (JSON.parse(readFileSync(path(QB_R2E_FILES.ledger), 'utf8')) as LedgerFile).entries : []);
  const unitOfHash = new Map<string, string>();
  const provider = new CumulativeBudgetProvider({
    transport, ledger, capUsd: R2D_R2E_CUMULATIVE_CAP_USD, guardPrice: GUARD_PRICE_BASIS, repoPrice: repoConfiguredPrice(model), maxOutputTokens: R2E_MAX_OUTPUT_TOKENS, maxCalls: R2E_MAX_CALLS, malformedCodeOf: r2eMalformedCodeOf,
    unitKeyOf: (p) => unitOfHash.get(p.promptHash) ?? 'UNKNOWN_UNIT', now: () => new Date().toISOString(),
    onRecording: (r) => { recording.responses.push(r); writeFileSync(path(QB_R2E_FILES.recording), serializeR2eArtifact(recording)); },
    onLedger: () => saveLedger(ledger, model, freeze),
  });
  /** One call for one unit; never repeated for a prompt that already has a recorded answer. Returns false when the run must stop. */
  const call = async (u: R2ePlannedUnit): Promise<boolean> => {
    if (recording.responses.some((r) => r.promptHash === u.promptHash)) return true;
    unitOfHash.set(u.promptHash, u.unitKey);
    try {
      await provider.generate({ prompt: { system: u.system, instruction: JSON.parse(u.user) }, promptHash: u.promptHash });
    } catch (e) {
      if (e instanceof CumulativeBudgetExceededError) { console.log(JSON.stringify({ STOP: 'CUMULATIVE_SPEND_WOULD_EXCEED_CAP', detail: e.message })); process.exitCode = 3; return false; }
      if (e instanceof RequestRejectedError) { console.log(JSON.stringify({ STOP: 'REQUEST_REJECTED_RUN_VOID', LIVE_PROVIDER: 'BLOCKED', detail: e.message })); process.exitCode = 5; return false; }
    }
    const last = ledger.entries[ledger.entries.length - 1];
    console.log(JSON.stringify({ unit: u.unitKey, outcome: last.outcome, usage: last.usage, finishReason: last.finishReason, cumulativeUsdGuardBasis: Number(ledger.cumulativeUsdGuardBasis().toFixed(4)) }));
    return true;
  };
  if (has('--first')) { await call(firstUnits[0]); return; }
  for (const u of firstUnits) if (!(await call(u))) return;
  // exactly the regenerations the pre-registered rule says are due -- computed from the recording, not chosen
  for (const u of await regenerationsDue(recording, evidence)) if (!(await call(u))) return;
  saveLedger(ledger, model, freeze);
}

if (process.argv[1] && /qb-r2e[\\/]run\.ts$/.test(process.argv[1])) main().catch((e) => { console.error((e as Error).message); process.exit(1); });
