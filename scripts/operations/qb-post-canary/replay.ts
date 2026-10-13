/**
 * POST-CANARY -- THE OFFLINE REPLAY (pure given the Canary read back; no network, no key, no transport).
 *
 * Validators revision 5 over the 221 candidates the Canary produced, beside revision 4 as the Canary scored them.
 * THE CANARY IS NOT RESCORED. Its artifacts, its AI reviews and its classifications stand as they are; what is
 * written here is a separate diagnostic, IN-SAMPLE (revision 5 was written with these items in view).
 *
 * THE PASS CRITERIA BELOW WERE WRITTEN BEFORE THE REPLAY WAS COMPUTED.
 */
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { generateFromSpecificationV4, renderSpecificationPromptV4, SPECIFICATION_TEMPLATE_REGISTRY_V4, SpecificationGenerationV4Error } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v4';
import { constructIntegrityOf, constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import { validateSpecificationCandidateR4, type SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { hasGateFail, isStrictPass } from '../qb-r2e/gates';
import { loadCanaryEvidence } from '../qb-canary-250/evidence';
import { avoidListsOf, canaryPolicyFor, unitKeyOf } from '../qb-canary-250/pipeline';
import { decide } from '../qb-canary-250/reviewer';
import type { CanaryReadBack } from './canary-evidence';
import { composeDemand, demandCheck, DEMAND_PROFILE_V2 } from './demand-profile-v2';
import { analyseFamilies, CAUSE_RULES, ZERO_APPROVAL_FAMILIES, type FamilySlot } from './family-analysis';
import { hasGateFailR5, isStrictPassR5, ORIGINALITY_RULE_R5, PROFILE_CHANNEL_RULE, R5_CHANGE_LOG, R5_IN_SAMPLE_NOTICE, R5_READERS, rejectedByValidatorR4, rejectedByValidatorR5, validateSpecificationCandidateR5, channelOfProfileIssue, type GatesR5, type SpecificationItemValidationR5 } from './validators-r5';

export const REPLAY_LABEL = 'OFFLINE DIAGNOSTIC -- validators revision 5 over the Canary\'s candidates -- IN-SAMPLE -- NOT certification evidence, NOT a rescore of the Canary -- DEV_TEST_CONTENT, RIGHTS_NOT_ESTABLISHED, NOT RELEASE CONTENT' as const;
/** Keys confirmed wrong by the frozen AI reviewer's own solution and by a person's working (the lane's reading of the Canary). */
export const CONFIRMED_WRONG_KEYS = ['c250-016', 'c250-070', 'c250-085', 'c250-135', 'c250-177', 'c250-226'] as const;
/** Revision-4 failures on items whose key is correct (same two confirmations). 019 failed on structure, the others on the key. */
export const KNOWN_FALSE_FAILURES = ['c250-004', 'c250-019', 'c250-048', 'c250-079', 'c250-090', 'c250-146', 'c250-153', 'c250-194'] as const;
/**
 * FOUND BY THE REPLAY, NOT KNOWN BEFORE IT. Disclosed here and NOT added to the list above: the criteria were written
 * with eight known false failures, and criterion C4 is evaluated against those eight, as written.
 */
export const DISCLOSED_AFTER_COMPUTING = [{ slotId: 'c250-241', what: 'A ninth false key failure of revision 4, of the same kind as 004, 079 and 090: the stem asks for y at x = 3 on the line through (0, 2) and (4, -6); the key -4 is correct (slope -2, y = -2*3 + 2); revision 4 compared it with the declared target, the y-intercept 2. Not reviewed by the AI reviewer (closed by the budget). Confirmed by the lane\'s own working only.' }] as const;
export const OFFLINE_REPLAY_CRITERIA = [
  { id: 'C1', criterion: 'None of the 8 known false failures is KEY_CONTRADICTED or structurally failed under revision 5.' },
  { id: 'C2', criterion: 'None of the 6 confirmed wrong keys is INDEPENDENTLY_VERIFIED under revision 5; each is KEY_CONTRADICTED where the stem lets a reader recompute it, otherwise not verified -- and which is which is stated.' },
  { id: 'C3', criterion: 'The two defects the AI reviewer caught and revision 4 passed (122, 211) fail under revision 5.' },
  { id: 'C4', criterion: 'No item loses a revision-4 "rejected by validator" status under revision 5 unless it is one of the 8 known false failures: no correct failure is lost without a stated reason.' },
  { id: 'C5', criterion: 'Every KEY_CONTRADICTED of revision 5 is confirmed by the frozen AI reviewer (its own solution DISAGREES): revision 5 introduces no unconfirmed key failure.' },
  { id: 'C6', criterion: 'The replay is reproducible byte for byte from the frozen run log (asserted by test).' },
] as const;

const r4AsCounterfactualGates = (g: GatesR5, base: SpecificationItemValidationR4['gates']): SpecificationItemValidationR4['gates'] => ({ ...base, structural: g.structural, profileCompliance: g.profileCompliance, constructPreservation: g.constructPreservation, answerKey: g.answerKey === 'KEY_CONTRADICTED' ? 'FAILED' : g.answerKey === 'INDEPENDENTLY_VERIFIED' ? 'MACHINE_VERIFIED' : 'HUMAN_REVIEW_REQUIRED', machineRecomputation: g.answerKey === 'KEY_CONTRADICTED' ? 'FAIL' : g.answerKey === 'INDEPENDENTLY_VERIFIED' ? 'PASS' : 'NOT_APPLICABLE', stimulusIntegrity: g.stimulusIntegrity, originality: g.originality === 'MATERIAL_DUPLICATE' ? 'REVIEW_STRUCTURAL_SIMILARITY' : 'PASS_LOW_SIMILARITY' } as SpecificationItemValidationR4['gates']);
const tally = <T>(xs: readonly T[], key: (x: T) => string): Record<string, number> => { const m: Record<string, number> = {}; for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1))); };

export async function replayCanaryWithRevision5(canary: CanaryReadBack, root: string = process.cwd()) {
  const rows = canary.generation.filter((g) => g.candidate).map((g) => {
    const r4 = canary.validations.get(g.slot.slotId)!;
    const r5 = validateSpecificationCandidateR5({ candidate: g.candidate!, specification: g.slot.specification, stimulus: g.stimulus, revision4: r4 });
    const demand = composeDemand(g.slot.specification);
    return { g, r4, r5, demand, demandCheck: demandCheck(g.candidate!, demand), review: canary.reviews.get(g.slot.slotId) ?? null };
  });
  const id = (r: (typeof rows)[number]) => r.g.slot.slotId;
  const changedOf = (r: (typeof rows)[number]): string[] => {
    const a = r.r4.gates, b = r.r5.gates, out: string[] = [];
    if (a.structural !== b.structural) out.push(`structural ${a.structural} -> ${b.structural}: ${b.structural === 'PASS' ? 'B1 options that are different equations are different options' : r.r5.structuralIssues.join(',')}`);
    if (a.profileCompliance !== b.profileCompliance) out.push(`profileCompliance ${a.profileCompliance} -> ${b.profileCompliance}: D1 declaration-quality issues no longer block (${r.r5.profile.declarationQuality.map((i) => i.split(':')[0]).join(',')})`);
    if (a.constructPreservation !== b.constructPreservation) out.push(`constructPreservation ${a.constructPreservation} -> ${b.constructPreservation}: ${r.r5.constructIssues.filter((i) => i.startsWith('KEYED_VALUE')).join(',') || 'see issues'}`);
    if (a.stimulusIntegrity !== b.stimulusIntegrity) out.push(`stimulusIntegrity ${a.stimulusIntegrity} -> ${b.stimulusIntegrity}: ${r.r5.stimulusIssues.join(',')}`);
    if ((a.originality !== 'PASS_LOW_SIMILARITY') !== (b.originality !== 'PASS')) out.push(`originality ${a.originality} -> ${b.originality}: C1/C2 ${r.r5.originality.scenarioRuleApplied ? 'a signal alone is not a material duplicate' : 'scenario similarity is not applied to an abstract item'} (signals: ${b.originalitySignals})`);
    const keyFrom = a.answerKey, keyTo = b.answerKey;
    const sameMeaning = (keyFrom === 'FAILED' && keyTo === 'KEY_CONTRADICTED');
    if (!sameMeaning) out.push(`answerKey ${keyFrom} -> ${keyTo}: ${keyFrom === 'FAILED' ? 'A2/A3 the failure came from a declaration, a sign, a unit or a rounding form, not from the stem' : keyTo === 'KEY_CONTRADICTED' ? 'A1 recomputed from the stem' : keyTo === 'INDEPENDENTLY_VERIFIED' ? 'A1 recomputed from the stem and the asked quantity read' : 'A1/A4 no verification from declarations: the asked quantity or the givens were not read'}`);
    return out;
  };
  const perItem = rows.map((r) => ({
    slotId: id(r), system: r.g.slot.systemId, familyId: r.g.slot.familyId, responseType: r.g.slot.strata.responseType, band: r.g.slot.strata.band,
    v4: { strictPass: isStrictPass({ attempt: 1, status: 'CANDIDATE', refusalCode: null, gates: r.r4.gates }), rejectedByValidator: rejectedByValidatorR4(r.r4.gates), gates: r.r4.gates },
    v5: { strictPass: isStrictPassR5(r.r5.gates), rejectedByValidator: rejectedByValidatorR5(r.r5.gates), gates: r.r5.gates, keyUnits: r.r5.answerKey.units, reader: r.r5.answerKey.reading?.reader ?? null, structuralIssues: r.r5.structuralIssues, profileHard: r.r5.profile.hard, declarationQuality: r.r5.profile.declarationQuality, constructIssues: r.r5.constructIssues, stimulusIssues: r.r5.stimulusIssues, originality: r.r5.originality },
    demand: { difficultyAchieved: r.demandCheck.difficultyAchieved, paperLevelFidelity: r.demandCheck.paperLevelFidelity, evidencedReasoningSteps: r.demandCheck.evidencedReasoningSteps, issues: r.demandCheck.issues },
    frozenAi: r.review ? { state: r.review.state, classification: r.review.decision?.classification ?? null, rule: r.review.decision?.rule ?? null, agreesWithKey: r.review.review?.independentSolution.agreesWithKey ?? null } : null,
    changes: changedOf(r),
  }));
  const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const comparison = {
    candidates: rows.length,
    STRICT_PASS: { V4: n((r) => isStrictPass({ attempt: 1, status: 'CANDIDATE', refusalCode: null, gates: r.r4.gates })), V5: n((r) => isStrictPassR5(r.r5.gates)), V5_ALSO_NOT_BELOW_DEMAND: n((r) => isStrictPassR5(r.r5.gates) && r.demandCheck.difficultyAchieved !== 'BELOW_DEMAND' && r.demandCheck.paperLevelFidelity !== 'BELOW_PROVISIONAL_FLOOR') },
    KEY_FAILURES: { V4: n((r) => r.r4.gates.answerKey === 'FAILED'), V5: n((r) => r.r5.gates.answerKey === 'KEY_CONTRADICTED') },
    KEY_VERIFIED: { V4_FROM_DECLARATIONS: n((r) => r.r4.gates.answerKey === 'MACHINE_VERIFIED' || r.r4.gates.answerKey === 'DETERMINISTIC_RULE_VERIFIED'), V5_INDEPENDENTLY: n((r) => r.r5.gates.answerKey === 'INDEPENDENTLY_VERIFIED') },
    V5_KEY_CLASSES_BY_ITEM: tally(rows, (r) => r.r5.gates.answerKey), V5_KEY_CLASSES_BY_UNIT: tally(rows.flatMap((r) => r.r5.answerKey.units), (u) => u.class),
    MATERIAL_DUPLICATES: { V4: n((r) => r.r4.gates.originality !== 'PASS_LOW_SIMILARITY'), V5: n((r) => r.r5.gates.originality === 'MATERIAL_DUPLICATE'), V5_SIGNALS: { mathematicalTemplateSimilarity: n((r) => r.r5.originality.mathematicalTemplateSimilarity.length > 0), structuralSimilarity: n((r) => r.r5.originality.structuralSimilarity.length > 0), abstractItemsWithScenarioRuleNotApplied: n((r) => !r.r5.originality.scenarioRuleApplied) } },
    PROFILE_FAILURES: { V4: n((r) => r.r4.gates.profileCompliance === 'FAIL'), V5: n((r) => r.r5.gates.profileCompliance === 'FAIL'), V5_DECLARATION_QUALITY_ONLY: n((r) => r.r5.gates.profileCompliance === 'PASS' && r.r5.gates.declarationQuality === 'ISSUES') },
    REJECTED_BY_VALIDATOR: { definition: 'a failure of a gate that states a deterministic fact about the item: structural FAIL, answer key failed / contradicted (with revision 4\'s machine recomputation), lineage FAIL, learner-text leakage FAIL. The same definition for both revisions.', V4: n((r) => rejectedByValidatorR4(r.r4.gates)), V5: n((r) => rejectedByValidatorR5(r.r5.gates)) },
    ANY_HARD_FAILURE: { V4: n((r) => hasGateFail(r.r4.gates)), V5: n((r) => hasGateFailR5(r.r5.gates)) },
    CONSTRUCT_FAILURES: { V4: n((r) => r.r4.gates.constructPreservation === 'FAIL'), V5: n((r) => r.r5.gates.constructPreservation === 'FAIL') },
    STIMULUS_FAILURES: { V4: n((r) => r.r4.gates.stimulusIntegrity === 'FAIL'), V5: n((r) => r.r5.gates.stimulusIntegrity === 'FAIL') },
  };
  const profileIssueChannels = Object.fromEntries([...new Set(rows.flatMap((r) => [...r.r5.profile.hard, ...r.r5.profile.declarationQuality].map((i) => i.split(':')[0])))].sort().map((code) => [code, { channel: channelOfProfileIssue(code), items: n((r) => [...r.r5.profile.hard, ...r.r5.profile.declarationQuality].some((i) => i.split(':')[0] === code)) }]));
  const statusOf = (slotId: string) => { const r = perItem.find((x) => x.slotId === slotId)!; return { slotId, v4: { answerKey: r.v4.gates.answerKey, structural: r.v4.gates.structural, strictPass: r.v4.strictPass }, v5: { answerKey: r.v5.gates.answerKey, structural: r.v5.gates.structural, constructPreservation: r.v5.gates.constructPreservation, stimulusIntegrity: r.v5.gates.stimulusIntegrity, strictPass: r.v5.strictPass, units: r.v5.keyUnits.map((u) => `${u.label}:${u.class}${u.representation ? `/${u.representation}` : ''}${u.asked ? ` (${u.asked})` : ''}`) }, frozenAi: r.frozenAi }; };
  const named = { confirmedWrongKeys: CONFIRMED_WRONG_KEYS.map(statusOf), knownFalseFailures: KNOWN_FALSE_FAILURES.map(statusOf), others: ['c250-122', 'c250-211', 'c250-032'].map(statusOf) };
  // the criteria, evaluated
  const of = (slotId: string) => perItem.find((x) => x.slotId === slotId)!;
  const lost = perItem.filter((r) => r.v4.rejectedByValidator && !r.v5.rejectedByValidator).map((r) => r.slotId);
  const contradicted = perItem.filter((r) => r.v5.gates.answerKey === 'KEY_CONTRADICTED');
  const criteria = [
    { ...OFFLINE_REPLAY_CRITERIA[0], pass: KNOWN_FALSE_FAILURES.every((s) => of(s).v5.gates.answerKey !== 'KEY_CONTRADICTED' && of(s).v5.gates.structural === 'PASS'), observed: KNOWN_FALSE_FAILURES.map((s) => `${s}: ${of(s).v5.gates.answerKey}, structural ${of(s).v5.gates.structural}`) },
    { ...OFFLINE_REPLAY_CRITERIA[1], pass: CONFIRMED_WRONG_KEYS.every((s) => of(s).v5.gates.answerKey !== 'INDEPENDENTLY_VERIFIED'), observed: CONFIRMED_WRONG_KEYS.map((s) => `${s}: ${of(s).v5.gates.answerKey}${of(s).v5.gates.answerKey === 'KEY_CONTRADICTED' ? ' (caught)' : ' (NOT caught: the stem does not let a reader decide which numbers correspond)'}`) },
    { ...OFFLINE_REPLAY_CRITERIA[2], pass: of('c250-122').v5.gates.constructPreservation === 'FAIL' && of('c250-211').v5.gates.stimulusIntegrity === 'FAIL', observed: [`c250-122: construct ${of('c250-122').v5.gates.constructPreservation}`, `c250-211: stimulus ${of('c250-211').v5.gates.stimulusIntegrity}`] },
    { ...OFFLINE_REPLAY_CRITERIA[3], pass: lost.every((s) => (KNOWN_FALSE_FAILURES as readonly string[]).includes(s)), observed: [`lost: ${lost.join(', ')}`, `not among the known false failures: ${lost.filter((s) => !(KNOWN_FALSE_FAILURES as readonly string[]).includes(s)).join(', ') || 'none'}`] },
    { ...OFFLINE_REPLAY_CRITERIA[4], pass: contradicted.every((r) => r.frozenAi?.agreesWithKey === 'DISAGREES'), observed: contradicted.map((r) => `${r.slotId}: AI ${r.frozenAi?.agreesWithKey ?? 'not reviewed'}`) },
    { ...OFFLINE_REPLAY_CRITERIA[5], pass: true, observed: ['asserted by tests/unit/qb-post-canary.test.ts against the stored files'] },
  ];
  // counterfactual: the frozen decision policy fed revision-5 gates. NOT the Canary's result.
  const reviewed = rows.filter((r) => r.review?.review && r.review.decision);
  const counterfactual = {
    label: 'COUNTERFACTUAL -- IN-SAMPLE -- NOT EVIDENCE. What the Canary\'s frozen decision policy WOULD classify if it were given revision-5 gates and the same frozen AI reviews. The Canary\'s classifications are unchanged and remain the Canary\'s result.',
    mapping: 'Revision-5 gates are put into the policy\'s revision-4 shape: KEY_CONTRADICTED -> FAILED; INDEPENDENTLY_VERIFIED -> MACHINE_VERIFIED; every other key class -> HUMAN_REVIEW_REQUIRED; MATERIAL_DUPLICATE -> a failed originality gate; profile = the hard channel.',
    reviewed: reviewed.length, canaryAsRecorded: tally(reviewed, (r) => r.review!.decision!.classification), withRevision5Gates: tally(reviewed, (r) => decide(r.review!.review!, r4AsCounterfactualGates(r.r5.gates, r.r4.gates)).classification),
    transitions: tally(reviewed, (r) => `${r.review!.decision!.classification} -> ${decide(r.review!.review!, r4AsCounterfactualGates(r.r5.gates, r.r4.gates)).classification}`),
    rules: tally(reviewed, (r) => decide(r.review!.review!, r4AsCounterfactualGates(r.r5.gates, r.r4.gates)).rule),
  };
  // demand diagnostic
  const challenge = rows.filter((r) => r.g.slot.strata.band === 'CHALLENGE');
  const approvedIbCambridge = rows.filter((r) => r.review?.decision?.classification === 'APPROVED' && (r.g.slot.systemId === 'IB' || r.g.slot.systemId === 'CAMBRIDGE'));
  const demandDiagnostic = {
    label: `DIAGNOSTIC against ${DEMAND_PROFILE_V2.id}@${DEMAND_PROFILE_V2.version}: STUDYUS_POLICY, PROVISIONAL, requires subject-matter-expert confirmation. Not the standard of any board. ${R5_IN_SAMPLE_NOTICE}`,
    allCandidates: { difficultyAchieved: tally(rows, (r) => r.demandCheck.difficultyAchieved), paperLevelFidelity: tally(rows, (r) => r.demandCheck.paperLevelFidelity) },
    challengeBand: { candidates: challenge.length, difficultyAchieved: tally(challenge, (r) => r.demandCheck.difficultyAchieved), constructed: challenge.filter((r) => r.demandCheck.evidencedReasoningSteps !== null).length, constructedBelowDemand: challenge.filter((r) => r.demandCheck.difficultyAchieved === 'BELOW_DEMAND').length, issues: tally(challenge.flatMap((r) => r.demandCheck.issues), (i) => i.split(':')[0]), evidencedStepsOfConstructed: tally(challenge.filter((r) => r.demandCheck.evidencedReasoningSteps !== null), (r) => String(r.demandCheck.evidencedReasoningSteps)) },
    approvedIbAndCambridge: approvedIbCambridge.map((r) => ({ slotId: id(r), target: r.g.slot.targetId, band: r.g.slot.strata.band, totalMarks: r.demandCheck.totalMarks, evidencedReasoningSteps: r.demandCheck.evidencedReasoningSteps, difficultyAchieved: r.demandCheck.difficultyAchieved, paperLevelFidelity: r.demandCheck.paperLevelFidelity, issues: r.demandCheck.issues })),
    ibAndCambridgeCandidates: { candidates: rows.filter((r) => r.g.slot.systemId === 'IB' || r.g.slot.systemId === 'CAMBRIDGE').length, paperLevelFidelity: tally(rows.filter((r) => r.g.slot.systemId === 'IB' || r.g.slot.systemId === 'CAMBRIDGE'), (r) => r.demandCheck.paperLevelFidelity) },
  };
  // the four families
  const byId = new Map(rows.map((r) => [id(r), r]));
  const familySlots: FamilySlot[] = canary.generation.filter((g) => (ZERO_APPROVAL_FAMILIES as readonly string[]).includes(g.slot.familyId)).map((g) => {
    const r = byId.get(g.slot.slotId) ?? null;
    const xv = r?.r5.answerKey.reading?.determined.MEASURE_AT_OPTIMUM;
    return { slotId: g.slot.slotId, familyId: g.slot.familyId, generationState: g.state, generationCode: g.code, v4StrictPass: r ? isStrictPass({ attempt: 1, status: 'CANDIDATE', refusalCode: null, gates: r.r4.gates }) : null, v5: r?.r5 ?? null, v5Gates: r?.r5.gates ?? null, ai: r?.review ? { classification: r.review.decision?.classification ?? null, agreesWithKey: r.review.review?.independentSolution.agreesWithKey ?? null, verdicts: Object.fromEntries(Object.entries(r.review.review?.dimensions ?? {}).map(([k, v]) => [k, (v as { verdict: string }).verdict])) } : null, nonCleanVertex: typeof xv === 'number' && Math.abs(xv * 2 - Math.round(xv * 2)) > 1e-9, asksValueAtX: r?.r5.answerKey.units.some((u) => (u.asked ?? '').startsWith('VALUE_AT_X')) ?? false };
  });
  const families = { label: `${REPLAY_LABEL}. One primary cause per slot, by the first rule that applies.`, rules: CAUSE_RULES, families: analyseFamilies(familySlots).map(({ perSlot, ...f }) => ({ ...f, perSlot })) };
  // the harness leak rule, version 4, on the eight recorded refusals; and what revision 5 would say of those it would accept
  const evidence = loadCanaryEvidence(root);
  const fresh = rows.map((r) => r.g.candidate!);
  const leaks = [];
  for (const g of canary.generation.filter((x) => x.code === 'RESPONSE_LEAKS_SPECIFICATION_VOCABULARY')) {
    const o = canary.log.outcomeOf('GENERATION', g.slot.slotId);
    const raw = o.state === 'FINISHED' ? o.finished.rawText : '';
    const input = { unit: { unitKey: unitKeyOf(g.slot.slotId), specification: g.slot.specification, attempt: 1, avoid: avoidListsOf(g.slot, evidence) }, constructVocabulary: constructVocabularyOf(g.slot.construct), constructIntegrity: constructIntegrityOf(g.slot.construct), policy: { ...canaryPolicyFor('gpt-5.6-luna', g.slot.specification.variable.language), author: { kind: 'MODEL' as const, model: 'gpt-5.6-luna', promptVersion: 'specification-prompt@4', requestedBy: 'qb-post-canary-diagnostic' } }, templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V4 };
    const hash = renderSpecificationPromptV4({ ...input, provider: new RecordedResponseProvider('recorded:canary-run-log', 'gpt-5.6-luna', {}) }).promptHash;
    let v4: { accepted: boolean; refusal: string | null; r5: SpecificationItemValidationR5 | null; r4StrictPass: boolean | null } = { accepted: false, refusal: null, r5: null, r4StrictPass: null };
    try {
      const out = await generateFromSpecificationV4({ ...input, provider: new RecordedResponseProvider('recorded:canary-run-log', 'gpt-5.6-luna', { [hash]: raw }), runId: 'post-canary-diagnostic', batchKey: 'post-canary-would-have-been', now: o.state === 'FINISHED' ? o.finished.at : '2026-01-01T00:00:00.000Z' });
      const r4 = validateSpecificationCandidateR4({ candidate: out.candidate, specification: g.slot.specification, stimulus: out.stimulus, siblings: [...fresh, ...evidence.priorCandidates], extraCorpus: evidence.pilotCorpus, peers: [...fresh.map((candidate) => ({ candidate, sameRun: true })), ...evidence.priorCandidates.map((candidate) => ({ candidate, sameRun: false }))] });
      v4 = { accepted: true, refusal: null, r5: validateSpecificationCandidateR5({ candidate: out.candidate, specification: g.slot.specification, stimulus: out.stimulus, revision4: r4 }), r4StrictPass: isStrictPass({ attempt: 1, status: 'CANDIDATE', refusalCode: null, gates: r4.gates }) };
    } catch (e) { if (!(e instanceof SpecificationGenerationV4Error)) throw e; v4 = { accepted: false, refusal: `${e.code}:${e.detail}`, r5: null, r4StrictPass: null }; }
    leaks.push({ slotId: g.slot.slotId, familyId: g.slot.familyId, version3Refusal: `${g.code}:${g.detail}`, falseUnderVersion4: v4.accepted || !(v4.refusal ?? '').startsWith('RESPONSE_LEAKS_SPECIFICATION_VOCABULARY'), version4: v4.accepted ? 'ACCEPTED' : v4.refusal, wouldHaveBeen: v4.r5 ? { gates: v4.r5.gates, strictPassV5: isStrictPassR5(v4.r5.gates), strictPassV4: v4.r4StrictPass, keyUnits: v4.r5.answerKey.units.map((u) => `${u.label}:${u.class}`), constructIssues: v4.r5.constructIssues } : null });
  }
  const harnessLeakDiagnostic = { label: `${REPLAY_LABEL}. The eight slots stay "no candidate" in the Canary. "wouldHaveBeen" is an APPENDIX: what the version-4 harness and revision 5 would say of the recorded answer; it adds nothing to the Canary's evidence.`, refusals: leaks.length, falseUnderVersion4: leaks.filter((l) => l.falseUnderVersion4).length, stillRefusedAsALeak: leaks.filter((l) => !l.falseUnderVersion4).length, slots: leaks };
  const changed = perItem.filter((r) => r.changes.length > 0);
  return {
    replay: { kind: 'QB_POST_CANARY_V5_OFFLINE_REPLAY', label: REPLAY_LABEL, inSample: R5_IN_SAMPLE_NOTICE, canaryFreeze: canary.log.header()?.freeze ?? null, validators: { from: 4, to: 5 }, criteriaStatedBeforeComputing: OFFLINE_REPLAY_CRITERIA, criteria, OFFLINE_REPLAY: criteria.every((c) => c.pass) ? 'PASS' : 'FAIL', criteriaMet: `${criteria.filter((c) => c.pass).length} of ${criteria.length}`, disclosedAfterComputing: DISCLOSED_AFTER_COMPUTING, comparison, namedCases: named, profileIssueChannels, profileChannelRule: PROFILE_CHANNEL_RULE, originalityRule: ORIGINALITY_RULE_R5, readers: R5_READERS, changeLog: R5_CHANGE_LOG, items: perItem },
    changedOutcomes: { kind: 'QB_POST_CANARY_V5_CHANGED_OUTCOMES', label: REPLAY_LABEL, changedItems: changed.length, unchangedItems: perItem.length - changed.length, byChange: tally(changed.flatMap((r) => r.changes.map((c) => c.split(':')[0])), (c) => c), strictPass: { gained: perItem.filter((r) => !r.v4.strictPass && r.v5.strictPass).map((r) => r.slotId), lost: perItem.filter((r) => r.v4.strictPass && !r.v5.strictPass).map((r) => ({ slotId: r.slotId, why: r.changes })) }, items: changed.map((r) => ({ slotId: r.slotId, changes: r.changes })) },
    counterfactual: { kind: 'QB_POST_CANARY_COUNTERFACTUAL_POLICY', ...counterfactual },
    demandDiagnostic: { kind: 'QB_POST_CANARY_DEMAND_DIAGNOSTIC', ...demandDiagnostic },
    families: { kind: 'QB_POST_CANARY_FAMILY_ANALYSIS', ...families },
    harnessLeakDiagnostic: { kind: 'QB_POST_CANARY_HARNESS_LEAK_DIAGNOSTIC', ...harnessLeakDiagnostic },
  };
}
export const serializeArtifact = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
