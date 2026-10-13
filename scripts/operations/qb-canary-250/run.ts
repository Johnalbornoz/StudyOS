/**
 * QUESTION FACTORY CANARY 250 -- the run script: file IO, git and the two network transports around the frozen
 * pipeline. No database. PREPARED, NOT RUN.
 *
 *   --write-manifest                         write manifest.json, spend-projection.json and the empty calibration template. No call.
 *   --write-freeze                           compute the freeze of the working tree and write freeze.json. No call.
 *   --verify-freeze --freeze-sha <sha>       say whether the working tree is the frozen one. No call.
 *   --preflight                              balance, projection and credential presence. No call.
 *   --status                                 what the run log says so far. No call.
 *   --reviewer-preflight --freeze-sha <sha>  ONE call to the reviewer's provider on a stand-in (a stored QB-R2E
 *                                            item): checks that the request shape is accepted. Not a slot, not scored.
 *   --generate --freeze-sha <sha> [--concurrency n] [--limit n]   generation calls for slots not yet called
 *   --review   --freeze-sha <sha> [--concurrency n] [--limit n]   review calls, only once generation is closed
 *   --write                                  replay the run log (no network) and write every derived artifact
 *
 * BEFORE ANY CALL the freeze is verified; a run log of another freeze is refused. The run log is appended to, line by
 * line, and never rewritten: re-invoking a command continues where the log stops, and a slot with any record is
 * never called again. Keys come from OPENAI_API_KEY (generator) and ANTHROPIC_API_KEY (reviewer) only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SPECIFICATION_PROVIDER_JSON_SCHEMA } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import { configuredGeneration, LIVE_KEY_ENVIRONMENT_VARIABLE, requireLiveKey } from '../qb-r2d/live-provider';
import { RequestRejectedError, type R2eTransport } from '../qb-r2e/budget';
import { createR2eLiveTransport } from '../qb-r2e/live-provider';
import { assumedCostOf, budgetRefusalFor, CANARY_CUMULATIVE_CAP_USD, CANARY_GENERATION_PHASE_CAP_USD, CANARY_REVIEW_MAX_OUTPUT_TOKENS, PROJECTION_ASSUMPTIONS, reviewInputTokenUpperBound, reviewWorstCaseUsd } from './budget';
import { CALIBRATION_NOT_FOR_RESCORING, DEFECT_CLASS_VOCABULARY, emptyCalibrationSet, SEVERITY_VOCABULARY } from './calibration';
import { canaryManifest, loadCanaryEvidence } from './evidence';
import { CANARY_RUN_PARAMETERS, computeCanaryFreezeManifest, verifyCanaryFreeze, type CanaryFreezeVerdict } from './freeze';
import { balanceOf, CANARY_TARGET_QUOTAS, CANARY_UNSUPPLIED_STRATA } from './manifest';
import { CANARY_LABEL, CANARY_VERSIONS, deriveGeneration, generationIsClosed, generationMalformedCodeOf, planReviews, validateBatch } from './pipeline';
import { canaryProjection, standInReviewRequests } from './projection';
import { CANARY_DIR, CANARY_FILES, deriveCanary, serializeCanaryArtifact } from './report';
import { REVIEWER_VERSION, reviewRefusalCodeOf } from './reviewer';
import { createReviewerLiveTransport, REVIEWER_KEY_ENVIRONMENT_VARIABLE, requireReviewerKey } from './reviewer-transport';
import { RunLog, type RunLogLine } from './run-log';
import { runPhase } from './runner';
import { SAMPLE_PROCEDURE } from './sample';

const ROOT = process.cwd();
const DIR = join(ROOT, CANARY_DIR);
const path = (f: string) => join(DIR, f);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
const has = (name: string) => process.argv.includes(name);
const MODEL = CANARY_RUN_PARAMETERS.generator.model;

/** The manifest as it is stored: the slots with their specifications and guidance, and the balance. */
export function manifestArtifact(root: string = ROOT) {
  const m = canaryManifest(root);
  return { kind: 'QB_CANARY_250_MANIFEST', label: CANARY_LABEL, manifest: m.manifest, slotGuidance: m.slotGuidance, quotasPerTarget: CANARY_TARGET_QUOTAS, balance: balanceOf(m), unsuppliedStrata: CANARY_UNSUPPLIED_STRATA, slots: m.slots };
}
export function calibrationTemplate() {
  return { ...emptyCalibrationSet({ items: [], runId: null, freezeCommitSha: null, freezeManifestHash: null, sampleProcedure: SAMPLE_PROCEDURE, reviewerVersion: `${REVIEWER_VERSION.id}@${REVIEWER_VERSION.version}` }), notForRescoring: CALIBRATION_NOT_FOR_RESCORING };
}
export function projectionArtifact(root: string = ROOT) {
  return { kind: 'QB_CANARY_250_SPEND_PROJECTION', basis: 'ASSUMED prices; a projection, not an invoice and not a quotation', assumptions: PROJECTION_ASSUMPTIONS, caps: { cumulative: CANARY_CUMULATIVE_CAP_USD, generationPhase: CANARY_GENERATION_PHASE_CAP_USD }, projection: canaryProjection(root, MODEL) };
}
/** The gate in front of both providers: a transport is built only when the freeze verifies. */
export function transportBehindTheFreeze(verdict: CanaryFreezeVerdict, createTransport: () => R2eTransport): R2eTransport {
  if (!verdict.ok) throw new Error(`FREEZE_NOT_VERIFIED: ${verdict.reasons.join('; ')}`);
  return createTransport();
}
function openLog(): RunLog {
  const file = path(CANARY_FILES.runLog);
  return new RunLog(existsSync(file) ? RunLog.parse(readFileSync(file, 'utf8')) : [], (line: RunLogLine) => appendFileSync(file, RunLog.serializeLine(line)));
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  if (configuredGeneration().primaryModel !== MODEL) throw new Error(`FROZEN_GENERATOR_MODEL_IS_NOT_THE_REPOSITORYS_ROUTED_MODEL: ${MODEL} / ${configuredGeneration().primaryModel}`);
  const freezeSha = arg('--freeze-sha');
  if (has('--write-manifest')) {
    writeFileSync(path(CANARY_FILES.manifest), serializeCanaryArtifact(manifestArtifact()));
    writeFileSync(path(CANARY_FILES.projection), serializeCanaryArtifact(projectionArtifact()));
    writeFileSync(path(CANARY_FILES.calibrationTemplate), serializeCanaryArtifact({ ...calibrationTemplate(), vocabularyValues: { defectClass: DEFECT_CLASS_VOCABULARY, severity: SEVERITY_VOCABULARY } }));
    console.log(JSON.stringify({ written: [CANARY_FILES.manifest, CANARY_FILES.projection, CANARY_FILES.calibrationTemplate], slots: canaryManifest().slots.length }));
    return;
  }
  if (has('--write-freeze')) {
    const manifest = computeCanaryFreezeManifest(ROOT);
    writeFileSync(path(CANARY_FILES.freeze), serializeCanaryArtifact(manifest));
    console.log(JSON.stringify({ written: CANARY_FILES.freeze, files: manifest.files.length, dataFiles: manifest.dataFiles.length, manifestHash: manifest.manifestHash }));
    return;
  }
  if (has('--verify-freeze')) { console.log(JSON.stringify(verifyCanaryFreeze(ROOT, freezeSha), null, 1)); return; }
  const present = (v: string) => typeof process.env[v] === 'string' && process.env[v]!.length >= 20;
  if (has('--preflight')) {
    console.log(JSON.stringify({ runParameters: CANARY_RUN_PARAMETERS, credentials: { [LIVE_KEY_ENVIRONMENT_VARIABLE]: { presentInProcess: present(LIVE_KEY_ENVIRONMENT_VARIABLE) }, [REVIEWER_KEY_ENVIRONMENT_VARIABLE]: { presentInProcess: present(REVIEWER_KEY_ENVIRONMENT_VARIABLE) } }, balance: balanceOf(canaryManifest()), ...projectionArtifact() }, null, 1));
    return;
  }
  const evidence = loadCanaryEvidence(ROOT);
  const manifest = canaryManifest(ROOT);
  const log = openLog();
  if (has('--status') || has('--write')) {
    const out = await deriveCanary(manifest, log, evidence, MODEL);
    if (has('--write')) for (const [name, value] of Object.entries(out.artifacts)) if (value !== null) writeFileSync(path(CANARY_FILES[name as keyof typeof out.artifacts]), serializeCanaryArtifact(value));
    const m = out.metrics;
    console.log(JSON.stringify({ generationClosed: out.generationClosed, GENERATED: m.GENERATED, PROVIDER_FAILURES: m.PROVIDER_FAILURES.count, HARNESS_REFUSALS: m.HARNESS_REFUSALS.count, NOT_RUN: m.NOT_RUN, NOT_CALLED_BUDGET_STOP: m.NOT_CALLED_BUDGET_STOP, VALIDATOR_STRICT_PASS: m.VALIDATOR_STRICT_PASS, REVIEWED: m.REVIEWED, APPROVED: m.APPROVED, NEEDS_HUMAN_REVIEW: m.NEEDS_HUMAN_REVIEW, REJECTED: m.REJECTED, REVIEWER_FAILURES: m.REVIEWER_FAILURES.count, ASSUMED_CUMULATIVE_SPEND_USD: Number(m.ASSUMED_CUMULATIVE_SPEND_USD.cumulative.toFixed(6)), HUMAN_CALIBRATION_SAMPLE_PROPOSED: m.HUMAN_CALIBRATION_SAMPLE_PROPOSED }, null, 1));
    return;
  }
  const phase = has('--generate') ? 'GENERATION' : has('--review') ? 'REVIEW' : has('--reviewer-preflight') ? 'PREFLIGHT' : null;
  if (!phase) { console.log('nothing to do: see the header of this file'); return; }

  // ---- everything below can call a provider: the freeze is checked first ------------------------------------------
  const verdict = verifyCanaryFreeze(ROOT, freezeSha);
  let transport: R2eTransport;
  try {
    transport = transportBehindTheFreeze(verdict, () => (phase === 'GENERATION' ? createR2eLiveTransport({ model: MODEL, apiKey: requireLiveKey(), jsonSchema: SPECIFICATION_PROVIDER_JSON_SCHEMA }) : createReviewerLiveTransport({ apiKey: requireReviewerKey() })));
  } catch (e) { console.log(JSON.stringify({ REFUSED: (e as Error).message })); process.exitCode = 2; return; }
  const freeze = { freezeCommitSha: freezeSha!, manifestHash: verdict.manifestHash! };
  const now = () => new Date().toISOString();
  const header = log.header();
  if (header && (header.freeze.freezeCommitSha !== freeze.freezeCommitSha || header.freeze.manifestHash !== freeze.manifestHash)) { console.log(JSON.stringify({ REFUSED: 'RUN_LOG_IS_OF_ANOTHER_FREEZE' })); process.exitCode = 2; return; }
  if (!header) { const startedAt = now(); log.begin({ type: 'RUN', kind: 'QB_CANARY_250_RUN_LOG', label: `${CANARY_LABEL} -- raw provider text as returned`, runId: `qb-canary-250-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`, startedAt, freeze, parameters: { ...CANARY_RUN_PARAMETERS, versions: CANARY_VERSIONS } }); }
  const priorUsd = evidence.priorSpendUsd.total;

  if (phase === 'PREFLIGHT') {
    const standIn = standInReviewRequests(ROOT)[0];
    const characters = standIn.system.length + standIn.user.length;
    const worstCase = reviewWorstCaseUsd(characters);
    const refusal = budgetRefusalFor('PREFLIGHT', priorUsd + log.spentUsd(), worstCase);
    if (refusal) { console.log(JSON.stringify({ REFUSED: refusal })); process.exitCode = 3; return; }
    log.startCall({ phase: 'PREFLIGHT', slotId: 'reviewer-preflight', requestHash: standIn.requestHash, at: now(), provider: transport.providerId, requestedModel: transport.model, maxOutputTokens: CANARY_REVIEW_MAX_OUTPUT_TOKENS, inputTokenUpperBound: reviewInputTokenUpperBound(characters), worstCaseCostUsdAssumed: worstCase });
    try {
      const r = await transport.complete({ system: standIn.system, user: standIn.user, maxOutputTokens: CANARY_REVIEW_MAX_OUTPUT_TOKENS });
      const code = reviewRefusalCodeOf(r.rawText);
      log.finishCall({ phase: 'PREFLIGHT', slotId: 'reviewer-preflight', requestHash: standIn.requestHash, at: now(), status: code ? 'MALFORMED' : 'WELL_FORMED', detail: code, servedModel: r.servedModel, responseId: r.responseId, finishReason: r.finishReason, usage: r.usage, usageSource: r.usage ? 'PROVIDER_USAGE_RESPONSE' : 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdAssumed: r.usage ? assumedCostOf('PREFLIGHT', r.usage) : worstCase, rawText: r.rawText });
      console.log(JSON.stringify({ REVIEWER_PREFLIGHT: code ? `ANSWERED_BUT_NOT_ACCEPTED: ${code}` : 'ACCEPTED', standIn: standIn.unitKey, servedModel: r.servedModel, finishReason: r.finishReason, usage: r.usage, cumulativeUsdAssumed: Number((priorUsd + log.spentUsd()).toFixed(6)) }));
    } catch (e) {
      log.finishCall({ phase: 'PREFLIGHT', slotId: 'reviewer-preflight', requestHash: standIn.requestHash, at: now(), status: e instanceof RequestRejectedError ? 'REQUEST_REJECTED' : 'TRANSPORT_ERROR', detail: (e as Error).message.slice(0, 300), servedModel: null, responseId: null, finishReason: null, usage: null, usageSource: 'NOT_REPORTED_CHARGED_AT_WORST_CASE', costUsdAssumed: worstCase, rawText: '' });
      console.log(JSON.stringify({ REVIEWER_PREFLIGHT: 'FAILED', detail: (e as Error).message.slice(0, 300) }));
      process.exitCode = 5;
    }
    return;
  }

  const concurrency = Number(arg('--concurrency') ?? '1');
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
  const generation = await deriveGeneration(manifest, log, evidence, MODEL);
  let plans: Array<{ slotId: string; requestHash: string; system: string; user: string }>;
  if (phase === 'GENERATION') plans = generation.filter((g) => g.state === 'NOT_RUN').map((g) => ({ slotId: g.slot.slotId, requestHash: g.plan.requestHash, system: g.plan.system, user: g.plan.user }));
  else {
    if (!generationIsClosed(generation)) { console.log(JSON.stringify({ REFUSED: 'GENERATION_IS_NOT_CLOSED: no review is made until every slot has a generation outcome', notRun: generation.filter((g) => g.state === 'NOT_RUN').length })); process.exitCode = 2; return; }
    plans = planReviews(generation, validateBatch(generation, evidence)).filter((p) => log.outcomeOf('REVIEW', p.slotId).state === 'NOT_RUN');
  }
  const run = await runPhase({ phase, plans: plans.slice(0, limit), log, transport, priorUsd, concurrency, now, malformedCodeOf: phase === 'GENERATION' ? generationMalformedCodeOf : reviewRefusalCodeOf, onCall: (slotId, status, cumulative) => console.log(JSON.stringify({ phase, slotId, status, cumulativeUsdAssumed: Number(cumulative.toFixed(4)) })) });
  console.log(JSON.stringify({ phase, ...run, remaining: plans.length - Math.min(plans.length, limit === Infinity ? plans.length : limit), cumulativeUsdAssumed: Number((priorUsd + log.spentUsd()).toFixed(6)) }));
  if (run.halted) process.exitCode = 5;
}

if (process.argv[1] && /qb-canary-250[\\/]run\.ts$/.test(process.argv[1])) main().catch((e) => { console.error((e as Error).message); process.exit(1); });
