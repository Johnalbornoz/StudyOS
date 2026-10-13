/**
 * POST-CANARY -- the script: file IO around the pure modules. ENTIRELY OFFLINE.
 * This lane has NO transport and reads NO key: nothing in this directory can make a provider call.
 *
 *   --write                 derive every post-canary artifact from the frozen Canary and write it (new files only)
 *   --gate                  the facts of the next-run gate, and whether a live run may be requested
 *   --analyse <form.json>   human calibration analytics over a FILLED form; refuses when it holds no settled label
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { agreementOf } from '../qb-canary-250/calibration';
import { CANARY_DIR, CANARY_FILES } from '../qb-canary-250/report';
import { hasGateFail } from '../qb-r2e/gates';
import { analyse, type AnalyticsRow, type Call, type Dimension, type Judge } from './calibration-analytics';
import { readCanary, readCanaryJson, type CanaryReadBack } from './canary-evidence';
import { composeDemand, demandCheck, DEMAND_PROFILE_V2, PAPER_FIDELITY_PROFILES } from './demand-profile-v2';
import { automatedContentIn, emptyForm, FIELD_MEANINGS, formIssues, fullyBlind, HUMAN_REVIEW_FIELDS, HUMAN_REVIEW_VOCABULARIES, HumanReviewFormSchema, humanLabelOf, renderPacketHtml, REVIEWER_INSTRUCTIONS, SECOND_REVIEW_RULE, secondHumanReviewRequired, toCalibrationRowV1, type FrozenAiDecision, type PacketItem } from './human-review';
import { humanCalibrationComplete, nextRunGate, type NextRunFacts } from './next-run-gate';
import { replayCanaryWithRevision5, serializeArtifact } from './replay';
import { authoritativeSpend, reconcile } from './spend-accounting-v2';
import { hasGateFailR5, validateSpecificationCandidateR5 } from './validators-r5';

export const POST_CANARY_FILES = {
  replay: 'v5-offline-replay/replay.json', changedOutcomes: 'v5-offline-replay/changed-outcomes.json', counterfactual: 'v5-offline-replay/counterfactual-ai-policy.json', demandDiagnostic: 'v5-offline-replay/demand-diagnostic.json', families: 'v5-offline-replay/family-analysis.json', harnessLeakDiagnostic: 'v5-offline-replay/harness-leak-diagnostic.json',
  spendReconciliation: 'spend-reconciliation.json',
  responseTemplate: 'human-review/response-template.json', packetHtml: 'human-review/reviewer-packet.html', packetFullyBlindHtml: 'human-review/reviewer-packet-fully-blind.html', packetFullyBlindJson: 'human-review/reviewer-packet-fully-blind.json', instructions: 'human-review/REVIEWER_INSTRUCTIONS.md', packetAudit: 'human-review/packet-audit.json', demandProfile: 'v5-offline-replay/demand-profile-v2.json',
} as const;
interface Packet { freeze: { freezeCommitSha: string } | null; run: { runId: string } | null; items: PacketItem[] }
interface KeyFile { items: Array<{ ITEM_ID: string; blind: boolean; aiOutcome: string }> }

/** THE AUDIT of the frozen reviewer-facing packet: what each item shows of the automated results. */
export function auditPacket(packet: Packet, key: KeyFile) {
  const blindIds = key.items.filter((i) => i.blind).map((i) => i.ITEM_ID).sort();
  const rows = packet.items.map((i) => ({ ITEM_ID: i.ITEM_ID, presentation: i.presentation, designatedBlind: blindIds.includes(i.ITEM_ID), automatedContent: automatedContentIn(i) }));
  const blind = rows.filter((r) => r.designatedBlind), open = rows.filter((r) => !r.designatedBlind);
  const text = JSON.stringify(packet.items.filter((i) => blindIds.includes(i.ITEM_ID)));
  return {
    kind: 'QB_CANARY_250_PACKET_AUDIT', packet: CANARY_FILES.packet, items: rows.length, blindItems: blind.length, blindItemIds: blindIds,
    BLIND_ITEMS_EXPOSE_NO_AUTOMATED_RESULT: blind.every((r) => r.presentation === 'BLIND' && r.automatedContent.length === 0) && !/APPROVED|REJECTED|NEEDS_HUMAN_REVIEW|MACHINE_VERIFIED|PASS_LOW_SIMILARITY|"rationale"|"declaredModel"|"workingOutline"/.test(text),
    whatTheOtherItemsShow: { items: open.length, automatedContentShown: [...new Set(open.flatMap((r) => r.automatedContent))].sort(), statement: 'The 27 items that are not blind are shown WITH the AI review (its classification, its ten verdicts with reasons, its own worked solution, its question) and the validator gates. A person reviewing them is not independent of the AI reviewer on those items.' },
    positionsOfBlindItems: packet.items.filter((i) => blindIds.includes(i.ITEM_ID)).map((i) => i.position),
    recommendation: 'For a first review that is independent on all 37 items, hand out reviewer-packet-fully-blind.html (or .json): the same items in the same order with no automated result for any item. The orchestrator named human-calibration-packet.json as the reviewer-facing packet, so reviewer-packet.html -- its rendering, automated results shown for the 27 -- remains the default. Either way the key file is not for reviewers.',
    perItem: rows,
  };
}
const aiOf = (canary: CanaryReadBack, slotId: string): FrozenAiDecision => { const r = canary.reviews.get(slotId); return { classification: r?.decision?.classification ?? null, academicCorrectness: r?.review?.dimensions.ACADEMIC_CORRECTNESS.verdict ?? null, agreesWithKey: r?.review?.independentSolution.agreesWithKey ?? null }; };

/** Every post-canary artifact, as path -> bytes. Derived from the frozen Canary alone: the same inputs give the same bytes. */
export async function buildPostCanaryArtifacts(root: string = process.cwd()): Promise<Record<keyof typeof POST_CANARY_FILES, string>> {
  const canary = await readCanary(root);
  const out = await replayCanaryWithRevision5(canary, root);
  const packet = readCanaryJson<Packet>(root, CANARY_FILES.packet), key = readCanaryJson<KeyFile>(root, CANARY_FILES.sampleKey);
  const candidates = readCanaryJson<{ slots: Array<{ slotId: string; stimulus: { renderedAssets?: Array<{ svg?: string }> } | null }> }>(root, CANARY_FILES.candidates);
  const svgOf = (itemId: string): string[] => (candidates.slots.find((s) => s.slotId === itemId)?.stimulus?.renderedAssets ?? []).flatMap((a) => (typeof a.svg === 'string' && a.svg.startsWith('<svg') ? [a.svg] : []));
  // spend: one authoritative total, and the Canary's own figures against it
  const metrics = readCanaryJson<{ metrics: { ASSUMED_CUMULATIVE_SPEND_USD: { cumulative: number } } }>(root, CANARY_FILES.metrics), ledger = readCanaryJson<{ cumulativeUsd: number; entries: Array<{ cumulativeAfterUsdAssumed: number; phase: string; costUsdAssumed: number }> }>(root, CANARY_FILES.ledger);
  const authoritative = authoritativeSpend(canary.log.lines as never, canary.priorUsd);
  const preflight = authoritative.byPhase.PREFLIGHT?.usd ?? 0;
  const reconciliation = reconcile(authoritative, [
    { source: 'run-log.jsonl (every call line, every phase) -- AUTHORITATIVE', cumulativeUsd: authoritative.cumulativeUsd },
    { source: 'spend-ledger.json entries (last cumulativeAfterUsdAssumed)', cumulativeUsd: ledger.entries[ledger.entries.length - 1].cumulativeAfterUsdAssumed },
    { source: 'spend-ledger.json entries (earlier runs + sum of costUsdAssumed)', cumulativeUsd: canary.priorUsd + ledger.entries.reduce((n, e) => n + e.costUsdAssumed, 0) },
    { source: 'spend-ledger.json header (cumulativeUsd)', cumulativeUsd: ledger.cumulativeUsd },
    { source: 'metrics.json (ASSUMED_CUMULATIVE_SPEND_USD.cumulative)', cumulativeUsd: metrics.metrics.ASSUMED_CUMULATIVE_SPEND_USD.cumulative },
  ], (_source, d) => (Math.abs(d + preflight) < 1e-6 ? `The frozen report summed the GENERATION and REVIEW phases only and left out the one PREFLIGHT call (${preflight.toFixed(6)}). The difference is exactly that call.` : 'UNEXPLAINED'));
  const blindAll = packet.items.map(fullyBlind);
  return {
    replay: serializeArtifact(out.replay), changedOutcomes: serializeArtifact(out.changedOutcomes), counterfactual: serializeArtifact(out.counterfactual), demandDiagnostic: serializeArtifact(out.demandDiagnostic), families: serializeArtifact(out.families), harnessLeakDiagnostic: serializeArtifact(out.harnessLeakDiagnostic),
    spendReconciliation: serializeArtifact({
      kind: 'QB_CANARY_250_SPEND_RECONCILIATION', label: 'Reconciliation statement for the Canary. A NEW file: no frozen Canary artifact was edited. ASSUMED prices; not an invoice.', canaryFreeze: canary.log.header()?.freeze ?? null,
      AUTHORITATIVE_CUMULATIVE_SPEND_USD: authoritative.cumulativeUsd, derivedFrom: 'the frozen run log: earlier runs + every call of every phase at its recorded cost', ...reconciliation,
      CANARY_FIGURES_RECONCILE_AS_WRITTEN: reconciliation.reconciled ? 'YES' : 'NO', EVERY_DIFFERENCE_EXPLAINED: reconciliation.sources.every((s) => s.reconciles || (s.explanation !== null && s.explanation !== 'UNEXPLAINED')) ? 'YES' : 'NO',
      statement: `The authoritative cumulative assumed spend of the Canary is ${authoritative.cumulativeUsd.toFixed(6)}. The run log and the ledger's entries agree with it. The ledger header and metrics.json state ${ledger.cumulativeUsd.toFixed(6)}: they omit the reviewer pre-flight call of ${preflight.toFixed(6)}. The budget guard during the run read the run log, so the cap was enforced on the authoritative figure. Spend accounting version 2 reports one total and refuses to write a report that does not reconcile.`,
      signedOffBy: 'question-bank lane (automated reconciliation; recomputed by test from the frozen run log)',
    }),
    responseTemplate: serializeArtifact(emptyForm({ itemIds: packet.items.map((i) => i.ITEM_ID), runId: packet.run?.runId ?? null, freezeCommitSha: packet.freeze?.freezeCommitSha ?? null, packet: CANARY_FILES.packet })),
    packetHtml: renderPacketHtml({ title: 'Canary 250 -- human calibration packet (37 items; 10 blind)', items: packet.items, showAutomatedResultsForNonBlind: true, svgOf }),
    packetFullyBlindHtml: renderPacketHtml({ title: 'Canary 250 -- human calibration packet, FULLY BLIND rendering (37 items)', items: blindAll, showAutomatedResultsForNonBlind: false, svgOf }),
    packetFullyBlindJson: serializeArtifact({ kind: 'QB_CANARY_250_HUMAN_CALIBRATION_PACKET_FULLY_BLIND', label: 'An ADDITIONAL rendering of human-calibration-packet.json: the same 37 items in the same order, with no AI review and no validator outcome for ANY item. The frozen packet is unchanged.', forHumanReviewers: true, items: blindAll }),
    instructions: REVIEWER_INSTRUCTIONS,
    packetAudit: serializeArtifact(auditPacket(packet, key)),
    demandProfile: serializeArtifact({ kind: 'STUDYUS_DEMAND_PROFILE', profile: DEMAND_PROFILE_V2, paperFidelityProfiles: PAPER_FIDELITY_PROFILES }),
  };
}
export const pathOf = (root: string, name: keyof typeof POST_CANARY_FILES): string => join(root, CANARY_DIR, POST_CANARY_FILES[name]);

/** The gate's facts today. HUMAN_CALIBRATION_COMPLETE comes from the response file, when there is one. */
export async function gateFacts(root: string = process.cwd()): Promise<{ facts: NextRunFacts; evidence: Record<string, unknown> }> {
  const canary = await readCanary(root);
  const out = await replayCanaryWithRevision5(canary, root);
  const filled = join(root, CANARY_DIR, 'human-review/responses.json');
  let human = { sampled: 37, settled: 0, awaitingSecondReview: 0, unsettled: 0 };
  if (existsSync(filled)) { const form = HumanReviewFormSchema.parse(JSON.parse(readFileSync(filled, 'utf8'))); const labels = form.items.map((i) => humanLabelOf(i, aiOf(canary, i.ITEM_ID))); human = { sampled: form.items.length, settled: labels.filter((l) => l.state === 'SETTLED').length, awaitingSecondReview: labels.filter((l) => l.state === 'AWAITING_SECOND_REVIEW').length, unsettled: labels.filter((l) => l.state === 'UNSETTLED').length }; }
  const c = Object.fromEntries(out.replay.criteria.map((x) => [x.id, x.pass]));
  const spend = JSON.parse((await buildPostCanaryArtifacts(root)).spendReconciliation) as { EVERY_DIFFERENCE_EXPLAINED: string };
  return {
    facts: { HUMAN_CALIBRATION_COMPLETE: humanCalibrationComplete(human), VALIDATOR_V5_OFFLINE_REPLAY: out.replay.OFFLINE_REPLAY === 'PASS' ? 'PASS' : 'FAIL', ANSWER_KEY_INDEPENDENT_RECOMPUTATION: c.C1 && c.C2 && c.C5 ? 'PASS' : 'FAIL', SPEND_ACCOUNTING_RECONCILED: spend.EVERY_DIFFERENCE_EXPLAINED === 'YES' ? 'PASS' : 'FAIL', DIFFICULTY_PROFILE_V2: 'READY' },
    evidence: { human, criteria: c, note: 'DIFFICULTY_PROFILE_V2 = READY means the profile STRUCTURE exists and is checkable; every number in it is provisional StudyUs policy awaiting subject-matter-expert confirmation.' },
  };
}

async function main() {
  const has = (f: string) => process.argv.includes(f);
  if (has('--write')) {
    const artifacts = await buildPostCanaryArtifacts(process.cwd());
    for (const [name, bytes] of Object.entries(artifacts) as Array<[keyof typeof POST_CANARY_FILES, string]>) { const p = pathOf(process.cwd(), name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); }
    const replay = JSON.parse(artifacts.replay) as { OFFLINE_REPLAY: string; comparison: unknown };
    console.log(JSON.stringify({ written: Object.values(POST_CANARY_FILES), OFFLINE_REPLAY: replay.OFFLINE_REPLAY, comparison: replay.comparison }, null, 1));
    return;
  }
  if (has('--gate')) { const g = await gateFacts(process.cwd()); console.log(JSON.stringify({ ...g, gate: nextRunGate(g.facts) }, null, 1)); return; }
  if (has('--analyse')) {
    const file = process.argv[process.argv.indexOf('--analyse') + 1];
    if (!file || !existsSync(file)) { console.log(JSON.stringify({ REFUSED: 'NO_RESPONSE_FILE: give the path of a FILLED human review form. No label is invented.' })); process.exitCode = 2; return; }
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    const issues = formIssues(value);
    if (issues.length > 0) { console.log(JSON.stringify({ REFUSED: 'FORM_NOT_VALID', issues }, null, 1)); process.exitCode = 2; return; }
    const form = HumanReviewFormSchema.parse(value);
    const canary = await readCanary(process.cwd());
    const key = readCanaryJson<KeyFile>(process.cwd(), CANARY_FILES.sampleKey);
    const rows: AnalyticsRow[] = form.items.map((slot) => {
      const g = canary.generation.find((x) => x.slot.slotId === slot.ITEM_ID)!, r4 = canary.validations.get(slot.ITEM_ID)!, review = canary.reviews.get(slot.ITEM_ID);
      const r5 = validateSpecificationCandidateR5({ candidate: g.candidate!, specification: g.slot.specification, stimulus: g.stimulus, revision4: r4 });
      const demand = demandCheck(g.candidate!, composeDemand(g.slot.specification));
      const call = (b: boolean): Call => (b ? 'DEFECT' : 'NO_DEFECT');
      const dims = review?.review?.dimensions, cls = review?.decision?.classification ?? null, agrees = review?.review?.independentSolution.agreesWithKey ?? null;
      const none = Object.fromEntries((['CORRECTNESS', 'ANSWER_KEY', 'CONSTRUCT', 'DIFFICULTY', 'ASSESSMENT_SYSTEM_FIDELITY', 'OVERALL_DECISION'] as Dimension[]).map((d) => [d, 'NO_OPINION' as Call])) as Record<Dimension, Call>;
      const calls: Record<Judge, Record<Dimension, Call>> = {
        VALIDATOR_V4: { CORRECTNESS: call(r4.gates.answerKey === 'FAILED' || r4.gates.machineRecomputation === 'FAIL'), ANSWER_KEY: call(r4.gates.answerKey === 'FAILED'), CONSTRUCT: call(r4.gates.constructPreservation === 'FAIL'), DIFFICULTY: 'NO_OPINION', ASSESSMENT_SYSTEM_FIDELITY: call(r4.gates.profileCompliance === 'FAIL'), OVERALL_DECISION: call(hasGateFail(r4.gates)) },
        VALIDATOR_V5: { CORRECTNESS: call(r5.gates.answerKey === 'KEY_CONTRADICTED'), ANSWER_KEY: call(r5.gates.answerKey === 'KEY_CONTRADICTED'), CONSTRUCT: call(r5.gates.constructPreservation === 'FAIL'), DIFFICULTY: demand.difficultyAchieved === 'UNVERIFIED' ? 'NO_OPINION' : call(demand.difficultyAchieved === 'BELOW_DEMAND'), ASSESSMENT_SYSTEM_FIDELITY: call(r5.gates.profileCompliance === 'FAIL'), OVERALL_DECISION: call(hasGateFailR5(r5.gates)) },
        AI_REVIEWER: dims ? { CORRECTNESS: call(dims.ACADEMIC_CORRECTNESS.verdict === 'FAIL' || agrees === 'DISAGREES'), ANSWER_KEY: call(agrees === 'DISAGREES'), CONSTRUCT: call(dims.CONSTRUCT_VALIDITY.verdict === 'FAIL'), DIFFICULTY: call(dims.DIFFICULTY.verdict === 'FAIL' || dims.DIFFICULTY.verdict === 'CONCERN'), ASSESSMENT_SYSTEM_FIDELITY: call(dims.PROFILE_FIDELITY.verdict === 'FAIL'), OVERALL_DECISION: cls === 'REJECTED' ? 'DEFECT' : cls === 'APPROVED' ? 'NO_DEFECT' : 'NO_OPINION' } : none,
      };
      return { itemId: slot.ITEM_ID, blind: key.items.find((k) => k.ITEM_ID === slot.ITEM_ID)?.blind ?? false, human: humanLabelOf(slot, aiOf(canary, slot.ITEM_ID)), calls };
    });
    try {
      const analysis = analyse(rows);
      const determinations = form.items.filter((s) => s.first_review).map((s) => ({ ITEM_ID: s.ITEM_ID, ...secondHumanReviewRequired(s.first_review!, aiOf(canary, s.ITEM_ID)) }));
      const v1Rows = rows.flatMap((r) => (r.human.state === 'SETTLED' ? [toCalibrationRowV1(r.itemId, ((key.items.find((k) => k.ITEM_ID === r.itemId)?.aiOutcome ?? 'REVIEWER_FAILURE') as never), r.human.label, agreementOf)] : []));
      console.log(JSON.stringify({ analysis, secondReviewDeterminations: { rule: SECOND_REVIEW_RULE, notForFirstReviewers: true, determinations }, calibrationSetV1Rows: v1Rows }, null, 1));
    } catch (e) { console.log(JSON.stringify({ REFUSED: (e as Error).message })); process.exitCode = 2; }
    return;
  }
  console.log(`nothing to do. Fields of the human form: ${HUMAN_REVIEW_FIELDS.join(', ')} (${Object.keys(HUMAN_REVIEW_VOCABULARIES).length} with a vocabulary; ${Object.keys(FIELD_MEANINGS).length} described)`);
}
if (process.argv[1] && /qb-post-canary[\\/]run\.ts$/.test(process.argv[1])) main().catch((e) => { console.error((e as Error).message); process.exit(1); });
