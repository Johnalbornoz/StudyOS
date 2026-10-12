/**
 * QB-R2D -- the live run: file IO and the one network transport around the pure pipeline. No database.
 *
 *   --preflight                         what would be called, with what, and the cost estimate. Makes NO call.
 *   --smoke                             ONE call, for the smallest unit: verifies the key, the response format and the usage accounting
 *   --run                               every planned unit that has no recording yet
 *   --regenerate <selectionKey> --reason "<why>"   an explicit, counted second attempt at CONTENT (new unit, new prompt)
 *   --write                             replay the recording (no network) and write every derived artifact
 *   --model <id>                        only the repository's routed primary or fallback is accepted
 *
 * The key is taken from the environment variable OPENAI_API_KEY and from nowhere else. Pass ONLY that variable:
 *   OPENAI_API_KEY="$(grep -E '^OPENAI_API_KEY=' <env file> | cut -d= -f2- | tr -d '"')" npx tsx scripts/operations/qb-r2d/run.ts --smoke
 * Never load a whole env file into this process: the file that holds the key also holds a database URL.
 *
 * Writes only under docs/exams/question-bank/pilots/qb-r2d/. The recording and the ledger are saved after EVERY
 * call, so an interrupted run loses nothing and never calls twice for a prompt it already has an answer to.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BudgetedLiveProvider, BudgetExceededError, costOf, GUARD_PRICE_BASIS, inputTokenUpperBound, QB_R2D_SPEND_CAP_USD, SpendLedger, type LedgerEntry } from './budget';
import { configuredGeneration, createLiveTransport, LIVE_KEY_ENVIRONMENT_VARIABLE, LIVE_MAX_OUTPUT_TOKENS, LIVE_REASONING_EFFORT, LiveProviderBlockedError, repoConfiguredPrice, requireLiveKey } from './live-provider';
import { malformedCodeOf, plannedUnits, QB_R2D_DIR, QB_R2D_FILES, QB_R2D_REQUESTED_BY, runQbR2d, serializeArtifact, type LiveRecordingFile } from './pipeline';
import { priorPilotCorpus } from './prior-corpus';

const DIR = join(process.cwd(), QB_R2D_DIR);
const path = (f: string) => join(DIR, f);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
const has = (name: string) => process.argv.includes(name);

interface LedgerFile { kind: 'QB_R2D_SPEND_LEDGER'; label: string; capUsd: number; guardPriceBasis: typeof GUARD_PRICE_BASIS; repoPriceBasis: ReturnType<typeof repoConfiguredPrice>; totals: Record<string, unknown>; entries: LedgerEntry[] }

function loadRecording(model: string, provider: string): LiveRecordingFile {
  if (existsSync(path(QB_R2D_FILES.recording))) return JSON.parse(readFileSync(path(QB_R2D_FILES.recording), 'utf8')) as LiveRecordingFile;
  const startedAt = new Date().toISOString();
  return { kind: 'QB_R2D_RECORDED_LIVE_RESPONSES', label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT', run: { runId: `qb-r2d-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`, startedAt, provider, requestedModel: model, requestedBy: QB_R2D_REQUESTED_BY, reasoningEffort: LIVE_REASONING_EFFORT, maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS, gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' }, regenerations: [], responses: [] };
}
const loadLedger = (): SpendLedger => new SpendLedger(existsSync(path(QB_R2D_FILES.ledger)) ? (JSON.parse(readFileSync(path(QB_R2D_FILES.ledger), 'utf8')) as LedgerFile).entries : []);
function saveLedger(ledger: SpendLedger, model: string): void {
  const repo = repoConfiguredPrice(model);
  const real = ledger.entries.filter((e) => e.outcome !== 'REFUSED_BY_BUDGET');
  const file: LedgerFile = {
    kind: 'QB_R2D_SPEND_LEDGER', label: 'Every live provider call of QB-R2D. Costs are provider-reported token usage x a price table; neither table is an invoice.', capUsd: QB_R2D_SPEND_CAP_USD, guardPriceBasis: GUARD_PRICE_BASIS, repoPriceBasis: repo,
    totals: {
      calls: real.length, callsOk: real.filter((e) => e.outcome === 'OK').length, callsMalformed: real.filter((e) => e.outcome === 'MALFORMED_RESPONSE').length, callsTransportError: real.filter((e) => e.outcome === 'TRANSPORT_ERROR').length, refusedByBudget: ledger.entries.length - real.length, retries: real.filter((e) => e.try === 2).length,
      inputTokens: real.reduce((n, e) => n + (e.usage?.inputTokens ?? 0), 0), outputTokens: real.reduce((n, e) => n + (e.usage?.outputTokens ?? 0), 0), reasoningTokens: real.reduce((n, e) => n + (e.usage?.reasoningTokens ?? 0), 0),
      spentUsdGuardBasis: Number(ledger.spentUsdGuardBasis().toFixed(6)), spentUsdRepoConfiguredBasis: ledger.spentUsdRepoBasis() === null ? null : Number(ledger.spentUsdRepoBasis()!.toFixed(6)),
    },
    entries: ledger.entries,
  };
  writeFileSync(path(QB_R2D_FILES.ledger), serializeArtifact(file));
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const configured = configuredGeneration();
  const model = arg('--model') ?? configured.primaryModel;
  if (model !== configured.primaryModel && model !== configured.fallbackModel) throw new Error(`MODEL_IS_NOT_ONE_THE_REPOSITORY_ROUTES_FOR_GENERATION: ${model}`);
  const providerId = 'live:openai:chat-completions';

  if (has('--write')) {
    const recording = JSON.parse(readFileSync(path(QB_R2D_FILES.recording), 'utf8')) as LiveRecordingFile;
    const out = await runQbR2d(recording, priorPilotCorpus());
    writeFileSync(path(QB_R2D_FILES.selection), serializeArtifact(out.selection));
    writeFileSync(path(QB_R2D_FILES.specifications), serializeArtifact(out.specifications));
    writeFileSync(path(QB_R2D_FILES.batch), serializeArtifact(out.batch));
    writeFileSync(path(QB_R2D_FILES.report), serializeArtifact(out.report));
    writeFileSync(path(QB_R2D_FILES.sameFamilyProof), serializeArtifact(out.sameFamilyProof));
    writeFileSync(path(QB_R2D_FILES.approachProof), serializeArtifact(out.approachProof));
    writeFileSync(path(QB_R2D_FILES.rights), serializeArtifact(out.rights));
    console.log(JSON.stringify({ totals: out.report.totals, proofs: out.report.proofs }, null, 1));
    return;
  }

  const recording = loadRecording(model, providerId);
  if (recording.run.requestedModel !== model) throw new Error(`RECORDING_IS_OF_ANOTHER_MODEL: ${recording.run.requestedModel} (a recording answers the prompts of ONE model)`);
  if (has('--regenerate')) {
    const selectionKey = arg('--regenerate')!;
    const reason = arg('--reason');
    if (!reason) throw new Error('REGENERATION_NEEDS_A_REASON');
    const attempt = 2 + recording.regenerations.filter((r) => r.selectionKey === selectionKey).length;
    recording.regenerations.push({ selectionKey, attempt, reason });
  }
  const units = plannedUnits(model, recording.regenerations);
  const ledger = loadLedger();
  const repo = repoConfiguredPrice(model);
  const answered = new Set(recording.responses.map((r) => r.promptHash));
  const pending = units.filter((u) => !answered.has(u.promptHash));
  const worst = (u: { system: string; user: string }) => costOf({ inputTokens: inputTokenUpperBound(u.system + u.user), outputTokens: LIVE_MAX_OUTPUT_TOKENS }, GUARD_PRICE_BASIS);

  if (has('--preflight')) {
    const chars = units.map((u) => u.system.length + u.user.length);
    const expectedIn = chars.reduce((n, c) => n + Math.ceil(c / 3.5), 0);
    const expectedOut = units.length * 2500;
    console.log(JSON.stringify({
      configured, modelToCall: model, endpoint: 'chat completions, JSON object mode', reasoningEffort: LIVE_REASONING_EFFORT, maxOutputTokensPerCall: LIVE_MAX_OUTPUT_TOKENS,
      credential: { variable: LIVE_KEY_ENVIRONMENT_VARIABLE, presentInProcess: typeof process.env[LIVE_KEY_ENVIRONMENT_VARIABLE] === 'string' && process.env[LIVE_KEY_ENVIRONMENT_VARIABLE]!.length >= 20 },
      gateway: 'BYPASSED: the repository gateway writes governance rows to a database; this lane writes its own ledger file instead',
      units: units.length, pending: pending.length, promptCharacters: { min: Math.min(...chars), max: Math.max(...chars), total: chars.reduce((a, b) => a + b, 0) },
      capUsd: QB_R2D_SPEND_CAP_USD, alreadySpentUsdGuardBasis: ledger.spentUsdGuardBasis(),
      priceBases: { guard: GUARD_PRICE_BASIS, repo },
      estimate: {
        assumption: `${units.length} calls, about ${Math.round(expectedIn / units.length)} input tokens each (prompt characters / 3.5) and 2500 output tokens each (answer plus low-effort reasoning)`,
        expectedUsdRepoConfiguredBasis: repo ? Number(costOf({ inputTokens: expectedIn, outputTokens: expectedOut }, repo).toFixed(4)) : null,
        expectedUsdGuardBasis: Number(costOf({ inputTokens: expectedIn, outputTokens: expectedOut }, GUARD_PRICE_BASIS).toFixed(4)),
        worstCaseUsdGuardBasisOneTryEach: Number(units.reduce((n, u) => n + worst(u), 0).toFixed(4)),
        worstCaseUsdGuardBasisEveryUnitRetried: Number((2 * units.reduce((n, u) => n + worst(u), 0)).toFixed(4)),
      },
    }, null, 1));
    return;
  }

  let key: string;
  try { key = requireLiveKey(); } catch (e) { if (e instanceof LiveProviderBlockedError) { console.log(JSON.stringify({ LIVE_PROVIDER: 'BLOCKED', missing: e.missing })); process.exitCode = 2; return; } throw e; }
  const byHash = new Map(units.map((u) => [u.promptHash, u.unitKey]));
  const provider = new BudgetedLiveProvider({
    transport: createLiveTransport({ model, apiKey: key }), ledger, capUsd: QB_R2D_SPEND_CAP_USD, guardPrice: GUARD_PRICE_BASIS, repoPrice: repo, maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS, malformedCodeOf,
    unitKeyOf: (p) => byHash.get(p.promptHash) ?? 'UNKNOWN_UNIT', now: () => new Date().toISOString(),
    onRecording: (r) => { recording.responses.push(r); writeFileSync(path(QB_R2D_FILES.recording), serializeArtifact(recording)); },
    onLedger: () => saveLedger(ledger, model),
  });
  const todo = has('--smoke') ? [...pending].sort((a, b) => a.system.length + a.user.length - (b.system.length + b.user.length)).slice(0, 1) : has('--run') || has('--regenerate') ? pending : [];
  if (todo.length === 0) { console.log(JSON.stringify({ nothingToCall: true, pending: pending.length })); return; }
  for (const u of todo) {
    try {
      const r = await provider.generate({ prompt: { system: u.system, instruction: JSON.parse(u.user) }, promptHash: u.promptHash });
      const last = ledger.entries[ledger.entries.length - 1];
      console.log(JSON.stringify({ unit: u.unitKey, outcome: last.outcome, tries: ledger.entries.filter((e) => e.promptHash === u.promptHash).length, usage: last.usage, servedModel: last.servedModel, malformed: malformedCodeOf(r.rawText), spentUsdGuardBasis: Number(ledger.spentUsdGuardBasis().toFixed(4)) }));
    } catch (e) {
      if (e instanceof BudgetExceededError) { console.log(JSON.stringify({ STOP: 'SPEND_WOULD_EXCEED_CAP', detail: e.message })); process.exitCode = 3; break; }
      console.log(JSON.stringify({ unit: u.unitKey, outcome: 'NO_ANSWER', error: (e as Error).message.slice(0, 300) }));
      if (has('--smoke')) { process.exitCode = 4; break; }
    }
  }
  writeFileSync(path(QB_R2D_FILES.recording), serializeArtifact(recording));
  saveLedger(ledger, model);
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
