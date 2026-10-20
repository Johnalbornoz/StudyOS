/**
 * QF V5.2 -- the evidence for one item, rule by rule, and its certification (pure, no IO).
 *
 * Two kinds of subject, two sources of evidence, ONE policy and ONE engine:
 *   ITEM_INSTANCE        a deterministic instance of the library. Every rule is judged from the instance itself,
 *                        its construct and the objects it inherits from. No person and no model is asked.
 *   RECORDED_CANDIDATE   item text that predates construct cores (a generated candidate). Its quality rules are
 *                        judged from the signals its run recorded; its lineage rule cannot pass, so it is never a
 *                        certified instance, whatever its quality.
 * Nothing here reads an item id or a wording to decide: the same input in gives the same decision out, for any item.
 */
import type { AssessmentAdapter } from '../assessment-adapter';
import { blueprintGate } from '../blueprint-classification';
import { certificationDecision, validateInstance, validatableOfRendered, type MachineEvidence, type Tier, type ValidatableItem } from '../instance-validators';
import { lineageClassOf } from '../item-instance-lineage';
import type { LibraryRender } from '../library/catalogue';
import { readRational, sameRational, writeRational, type PlanningBand } from '../library/parametric';
import { unrenderableRepresentations } from '../renderer';
import { certifiedLineageIntact, itemDifficultyOf } from '../renderer-envelope';
import { evaluateResponse } from '../response-evaluation';
import { decide, evidence as E, type CertificationDecisionV52, type RuleEvidence } from './certification-engine';
import { HUMAN50_POLICY_V1, type CertificationPolicy, type EligibilityScope } from './certification-policy';
import { governanceEligible, type GovernanceDecision } from './object-governance';
import { rightsCategoryOf, rightsGate, type RightsCategory } from './rights-provenance';

/** The validator each V5.1 finding comes from is the rule it is evidence for. */
const RULE_OF_VALIDATOR: Readonly<Record<string, string>> = {
  CONSTRUCT_NECESSITY: 'CONSTRUCT_NECESSITY', SHORTCUT_BYPASS: 'SHORTCUT_BYPASS', OPTION_STRUCTURAL_LEAKAGE: 'OPTION_STRUCTURAL_LEAKAGE', DISTRACTOR_DIAGNOSTICITY: 'DISTRACTOR_DIAGNOSTICITY',
  DISTRACTOR_COMPETITIVENESS: 'DISTRACTOR_COMPETITIVENESS', REPRESENTATION_FIT: 'REPRESENTATION_FIT', DIFFICULTY_MECHANISM: 'DIFFICULTY_MECHANISM', AUTHENTICITY: 'ASSESSMENT_AUTHENTICITY',
};

export interface Governance { core: GovernanceDecision; adapter: GovernanceDecision; envelope: GovernanceDecision; blueprint: GovernanceDecision }
export interface AlreadyCertified { wordings: ReadonlySet<string>; recognition: ReadonlySet<string> }
export const recognitionIdOf = (r: Pick<LibraryRender, 'entry' | 'rendered'>): string => `${r.entry.core.constructFamilyId}|${r.entry.construct.recognitionKey(r.rendered.parameterSet)}`;
/** The wording a learner reads, per adapter: the same mathematics under another adapter is another deliverable. */
export const wordingIdOf = (r: Pick<LibraryRender, 'target' | 'rendered'>): string => `${r.target.adapterId}|${r.rendered.learner.prompt}`;

/** Every rule of the policy, judged for one deterministic instance. */
export function evidenceOfInstance(r: LibraryRender, adapter: AssessmentAdapter, governance: Governance, already: AlreadyCertified, policy: CertificationPolicy = HUMAN50_POLICY_V1, scope: EligibilityScope = 'PILOT_PREVIEW'): RuleEvidence[] {
  const { rendered, entry, target } = r;
  const { core, construct, envelope, reasoning } = entry;
  const p = rendered.parameterSet;
  const keys = rendered.key.answers.map(readRational);
  const allowed = core.family.responseConstraints.allowedFormats as readonly string[];
  const format = rendered.learner.itemType;
  const validation = validateInstance({
    item: { ...validatableOfRendered(rendered), commandTerm: r.commandTerm },
    construct: { intendedReasoningPath: reasoning.minimumSuccessfulPath, difficultyMechanisms: r.planningBand === 'CHALLENGE' ? entry.challengeMechanisms : [], intendedTier: r.planningBand as Tier, requiredRepresentations: [], verbalDecodingIntended: false },
    adapter, shortcutExcludedFormats: core.shortcutConstraints.flatMap((s) => s.excludedFormats), lineageRequired: true, judgeAuthenticity: null, calibratedTier: null,
  });
  const findingsOf = (ruleId: string) => validation.findings.filter((f) => RULE_OF_VALIDATOR[f.validator] === ruleId && f.severity !== 'INFO').map((f) => ({ reasonCode: f.code, detail: f.detail }));
  const out: RuleEvidence[] = [];

  // ANSWER_CORRECTNESS: a second route to the key, from the numbers the learner is shown
  const keyOk = keys.every((k) => k !== null) && (keys.length === 1 ? construct.keyHolds(p, keys[0]!) : construct.everyKeyHolds?.(p, keys as never) === true);
  out.push(keyOk ? E.pass('ANSWER_CORRECTNESS', `${rendered.key.answers.join(' ; ')} recomputed from the shown values by ${construct.construct}`) : E.fail('ANSWER_CORRECTNESS', 'KEY_DOES_NOT_HOLD', `${rendered.key.answers.join(' ; ')} does not solve what the learner is shown`));
  out.push(rendered.lineage.constructFamilyId === core.constructFamilyId && entry.strategy.construct === construct.construct ? E.pass('CONSTRUCT_ALIGNMENT', `an instance of ${core.constructFamilyId}, rendered by the strategy of its construct`) : E.fail('CONSTRUCT_ALIGNMENT', 'CONSTRUCT_FAIL', 'the instance is not of the core it names'));
  const methodObserved = reasoning.requiredObservableMethod === null || rendered.learner.conditions.workingShown;
  out.push(E.check('CONSTRUCT_NECESSITY', [...findingsOf('CONSTRUCT_NECESSITY'), ...(methodObserved ? [] : [{ reasonCode: 'METHOD_REQUIRED_BUT_NOT_OBSERVED', detail: `${reasoning.requiredObservableMethod} is required and the response does not show it` }])], `necessary: ${reasoning.minimumSuccessfulPath.length}-step path, no shorter route found`));
  out.push(E.check('SHORTCUT_BYPASS', [...findingsOf('SHORTCUT_BYPASS'), ...(core.shortcutConstraints.some((s) => (s.excludedFormats as readonly string[]).includes(format)) ? [{ reasonCode: 'SHORTCUT_FORMAT_EXCLUDED_BY_THE_CORE', detail: format }] : [])], `${format}: no candidate value is offered`));
  const hasOptions = rendered.learner.options.length > 0;
  for (const ruleId of ['DISTRACTOR_DIAGNOSTICITY', 'OPTION_STRUCTURAL_LEAKAGE']) out.push(hasOptions ? E.check(ruleId, findingsOf(ruleId), 'options checked') : E.notApplicable(ruleId, 'a produced response: there are no options'));
  // with or without options, the key is never what a modelled misconception gives
  const collision = keys.length === 1 && keys[0] ? construct.misconceptionAnswers(p).find((m) => m.value !== null && sameRational(m.value, keys[0]!)) : undefined;
  out.push(E.check('DISTRACTOR_COMPETITIVENESS', [...(hasOptions ? findingsOf('DISTRACTOR_COMPETITIVENESS') : []), ...(collision ? [{ reasonCode: 'KEY_COINCIDES_WITH_A_MISCONCEPTION', detail: collision.id }] : [])], 'the key is not the answer of any modelled misconception'));
  out.push(E.check('REPRESENTATION_FIT', findingsOf('REPRESENTATION_FIT'), 'nothing is described in words that needs a figure'));
  const difficulty = itemDifficultyOf(envelope, r.planningBand);
  const bandMisses = construct.bandIssues(r.planningBand as PlanningBand, p);
  out.push(E.check('DIFFICULTY_MECHANISM', [
    ...(difficulty === null || difficulty !== r.certifiedLineage.itemDifficulty ? [{ reasonCode: 'DIFFICULTY_NOT_RECORDED', detail: `envelope ${String(difficulty)} / instance ${r.certifiedLineage.itemDifficulty}` }] : []),
    ...bandMisses.map((m) => ({ reasonCode: 'PARAMETER_SET_IS_NOT_OF_ITS_BAND', detail: m })),
    ...(r.planningBand === 'CHALLENGE' && entry.challengeMechanisms.length === 0 ? [{ reasonCode: 'CHALLENGE_WITHOUT_A_MECHANISM', detail: 'the hardest band names no mechanism' }] : []),
  ], `item difficulty ${String(difficulty)} from the envelope; the parameter set carries every lever setting of its band`));
  out.push(reasoning.minimumSuccessfulPath.length === 0 ? E.unknown('MINIMUM_SUCCESSFUL_REASONING_PATH', 'NO_MINIMUM_PATH_DECLARED', core.constructFamilyId) : methodObserved ? E.pass('MINIMUM_SUCCESSFUL_REASONING_PATH', reasoning.minimumSuccessfulPath.join(' -> ')) : E.fail('MINIMUM_SUCCESSFUL_REASONING_PATH', 'METHOD_REQUIRED_BUT_NOT_OBSERVED', String(reasoning.requiredObservableMethod)));
  out.push(E.check('ASSESSMENT_AUTHENTICITY', findingsOf('ASSESSMENT_AUTHENTICITY'), `${format}${r.commandTerm ? ` under "${r.commandTerm}"` : ''} is how ${adapter.adapterId} asks`));

  // RESPONSE_EVALUATION: the instance's own policy accepts its key in every accepted form and refuses the modelled wrong answers
  const policyKind = rendered.responsePolicy.kind;
  if (policyKind === 'NUMERIC' && keys.length === 1 && keys[0]) {
    const k = keys[0];
    const forms = [writeRational(k), ...(k.d !== 1 && [2, 4, 5, 10, 20, 25, 50, 100].some((d) => d % k.d === 0) ? [String(k.n / k.d), String(k.n / k.d).replace('.', ',')] : []), ...(k.d === 1 ? [`${k.n * 2}/2`] : [])];
    const refused = forms.filter((f) => !evaluateResponse(rendered.responsePolicy, rendered.key.answers, f).correct);
    const accepted = construct.misconceptionAnswers(p).filter((m) => m.value !== null && !sameRational(m.value, k) && evaluateResponse(rendered.responsePolicy, rendered.key.answers, writeRational(m.value)).correct).map((m) => m.id);
    out.push(E.check('RESPONSE_EVALUATION', [...refused.map((f) => ({ reasonCode: 'KEY_NOT_ACCEPTED_BY_ITS_OWN_POLICY', detail: f })), ...accepted.map((id) => ({ reasonCode: 'WRONG_ANSWER_ACCEPTED', detail: id }))], `key accepted as ${forms.join(', ')}; ${construct.misconceptionAnswers(p).length} modelled wrong answers refused`));
  } else if (policyKind === 'RUBRIC') {
    const answerPoints = rendered.responsePolicy.partialCredit.filter((c) => c.answer !== null).map((c) => c.answer as string);
    out.push(E.check('RESPONSE_EVALUATION', rendered.key.answers.filter((a) => !answerPoints.includes(a)).map((a) => ({ reasonCode: 'KEY_NOT_ACCEPTED_BY_ITS_OWN_POLICY', detail: `${a} has no accuracy point` })), `each keyed value has an accuracy point; method points are marked by a marker (${rendered.responsePolicy.partialCredit.length} points)`));
  } else if (policyKind === 'OPTION' && rendered.key.correctOption && keys.length === 1 && keys[0]) {
    // a selected response is judged by its option: the key's label is accepted, every other label refused; the key
    // option shows the checked key, and every distractor shows what a MODELLED misconception gives (never a made-up value)
    const k = keys[0];
    const correct = rendered.key.correctOption;
    const options = rendered.learner.options;
    const issues: { reasonCode: string; detail: string }[] = [];
    if (!evaluateResponse(rendered.responsePolicy, [correct], correct).correct) issues.push({ reasonCode: 'KEY_NOT_ACCEPTED_BY_ITS_OWN_POLICY', detail: correct });
    for (const o of options) if (o.label !== correct && evaluateResponse(rendered.responsePolicy, [correct], o.label).correct) issues.push({ reasonCode: 'WRONG_ANSWER_ACCEPTED', detail: o.label });
    if (options.find((o) => o.label === correct)?.text !== writeRational(k)) issues.push({ reasonCode: 'KEY_OPTION_IS_NOT_THE_KEY', detail: correct });
    const modelled = construct.misconceptionAnswers(p).filter((m) => m.value !== null).map((m) => writeRational(m.value!));
    for (const o of options) if (o.label !== correct && (!modelled.includes(o.text) || o.text === writeRational(k))) issues.push({ reasonCode: 'DISTRACTOR_NOT_A_MODELLED_MISCONCEPTION', detail: `${o.label}: ${o.text}` });
    out.push(E.check('RESPONSE_EVALUATION', issues, `option ${correct} accepted, ${options.length - 1} others refused; every distractor is a modelled misconception value`));
  } else out.push(E.unknown('RESPONSE_EVALUATION', 'NO_RESPONSE_POLICY', `a ${policyKind} policy is not checked by this version`));
  const rubricMarks = rendered.rubric.reduce((n, x) => n + x.marks, 0);
  out.push(rubricMarks === rendered.learner.marks && rendered.learner.marks > 0 ? E.pass('MARKS_CONSISTENCY', `${rendered.learner.marks} marks; the mark scheme adds up to ${rubricMarks}`) : E.fail('MARKS_CONSISTENCY', 'MARKS_DO_NOT_ADD_UP', `${rendered.learner.marks} stated, ${rubricMarks} in the mark scheme`));
  out.push(governance.envelope.checks.find((c) => c.code === 'ONE_WORDING_ONE_KEY')?.passed ? E.pass('AMBIGUITY', 'across the whole envelope no wording has two keys, and the solution rules of the core give one value') : E.unknown('AMBIGUITY', 'SAME_WORDING_DIFFERENT_KEY', 'the envelope sweep does not show one key per wording'));
  const text = rendered.learner.prompt;
  out.push(E.check('LANGUAGE_QUALITY', [
    ...(text.trim().length < 15 ? [{ reasonCode: 'EMPTY_PROMPT', detail: text }] : []),
    ...(/\{\{|\}\}|undefined|NaN|\[object/.test(text) ? [{ reasonCode: 'UNFILLED_PLACEHOLDER', detail: text }] : []),
    ...(rendered.learner.language !== target.language || !envelope.languages.includes(rendered.learner.language) ? [{ reasonCode: 'LANGUAGE_IS_NOT_THE_DECLARED_ONE', detail: `${rendered.learner.language} / ${target.language}` }] : []),
  ], `complete wording in ${rendered.learner.language}`));

  const rights = rightsCategoryOf({ origin: 'DETERMINISTIC_RENDER', coreAuthoredByStudyUs: core.family.provenance.authoredBy === 'STUDYUS', containsCopiedProtectedExpression: core.family.provenance.containsCopiedProtectedExpression, runRecordPresent: false, basisRecorded: false });
  const gate = rightsGate(policy, rights, scope);
  out.push(gate.deliverable ? E.pass('RIGHTS_PROVENANCE', `${rights.category}: ${rights.basis}`) : E.fail('RIGHTS_PROVENANCE', gate.reasonCode, gate.detail));
  const class_ = blueprintGate('PRACTICE', r.blueprint.blueprintClass);
  out.push(E.check('BLUEPRINT_COMPATIBILITY', [
    ...(class_.ok ? [] : [{ reasonCode: class_.code === 'BLUEPRINT_NOT_CLASSIFIED' ? 'BLUEPRINT_NOT_CLASSIFIED' : 'BLUEPRINT_CLASS_NOT_ELIGIBLE', detail: class_.detail }]),
    ...(r.bucket.primaryConceptStableIds.includes(core.primaryConceptStableId) && r.bucket.adapterId === target.adapterId ? [] : [{ reasonCode: 'BUCKET_DOES_NOT_LINK_THE_CONCEPT', detail: `${r.bucket.bucketId} / ${core.primaryConceptStableId}` }]),
  ], `${r.bucket.bucketId} (${r.blueprint.blueprintClass}) links ${core.primaryConceptStableId}`));
  out.push(E.check('LINEAGE_COMPLETENESS', [
    ...(lineageClassOf(r.certifiedLineage.lineage) === 'CORE_DERIVED' ? [] : [{ reasonCode: 'LINEAGE_INCOMPLETE', detail: 'a reference of the lineage is missing' }]),
    ...(certifiedLineageIntact(r.certifiedLineage) ? [] : [{ reasonCode: 'LINEAGE_ALTERED', detail: 'the digest does not match' }]),
    ...(r.applicability.status === 'NOT_APPLICABLE' ? [{ reasonCode: 'APPLICABILITY_NOT_SUPPORTED', detail: r.applicability.reason ?? '' }] : []),
  ], `core, applicability (${r.applicability.status}), adapter, bucket, seed, parameter set, renderer, envelope, difficulty, digest ${r.certifiedLineage.digest.slice(0, 12)}`));
  out.push(E.check('DUPLICATION', [
    ...(already.wordings.has(wordingIdOf(r)) ? [{ reasonCode: 'DUPLICATE_OF_A_CERTIFIED_INSTANCE', detail: 'the same wording is already certified under this adapter' }] : []),
  ], 'no certified instance has this wording'));
  out.push(E.check('UNSUPPORTED_REPRESENTATION', [
    ...unrenderableRepresentations(core, entry.strategy).map((k) => ({ reasonCode: 'REPRESENTATION_NOT_RENDERABLE', detail: k })),
    ...(rendered.learner.stimulus !== null && envelope.stimulusKinds.length === 0 ? [{ reasonCode: 'REPRESENTATION_OUTSIDE_THE_ENVELOPE', detail: 'a stimulus in a text-only envelope' }] : []),
  ], 'text only: nothing needs to be drawn'));
  out.push(E.check('UNSUPPORTED_RESPONSE_FORMAT', [
    ...(adapter.responseFormats.includes(format) ? [] : [{ reasonCode: 'FORMAT_NOT_OF_THE_ADAPTER', detail: format }]),
    ...(allowed.includes(format) ? [] : [{ reasonCode: 'FORMAT_NOT_ALLOWED_BY_THE_CORE', detail: format }]),
    ...(envelope.responseFormats.includes(format) ? [] : [{ reasonCode: 'FORMAT_OUTSIDE_THE_ENVELOPE', detail: format }]),
  ], `${format}: governed by the adapter, allowed by the core, covered by the envelope`));
  const notEligible = (Object.entries(governance) as [string, GovernanceDecision][]).filter(([, g]) => !governanceEligible(g)).map(([k, g]) => ({ reasonCode: 'GOVERNING_OBJECT_NOT_ELIGIBLE', detail: `${k} ${g.objectId}: ${g.state} (${g.failed.join(', ')})` }));
  out.push(E.check('ENVELOPE_CONFORMANCE', [...r.envelopeIssues.map((i) => ({ reasonCode: 'OUTSIDE_THE_CERTIFIED_ENVELOPE', detail: `${i.code}: ${i.detail}` })), ...(rendered.lineage.rendererVersion === envelope.rendererVersion ? [] : [{ reasonCode: 'RENDERER_VERSION_CHANGED', detail: rendered.lineage.rendererVersion }]), ...notEligible],
    `inside the envelope of ${envelope.rendererVersion}; core, adapter, blueprint and envelope are each eligible`));
  return out;
}

export interface InstanceCertificationV52 { decision: CertificationDecisionV52; rightsCategory: RightsCategory; itemDifficulty: number; mode: 'INHERITED_DETERMINISTIC_CERTIFICATION' | null }
/** The certification of one deterministic instance. Certified = it inherits; no approval of the item by a person is involved. */
export function certifyInstance(r: LibraryRender, adapter: AssessmentAdapter, governance: Governance, already: AlreadyCertified, policy: CertificationPolicy = HUMAN50_POLICY_V1): InstanceCertificationV52 {
  const decision = decide('ITEM_INSTANCE', evidenceOfInstance(r, adapter, governance, already, policy), policy);
  return { decision, rightsCategory: 'STUDYUS_ORIGINAL_DETERMINISTIC', itemDifficulty: r.certifiedLineage.itemDifficulty, mode: decision.outcome === 'AUTOMATED_CERTIFIED_PILOT' ? 'INHERITED_DETERMINISTIC_CERTIFICATION' : null };
}

// ------------------------------------------------------------------------------------------ recorded candidates
/** What a generation run recorded about a candidate. The signals of model-backed stages, reduced to what a decision needs. */
export interface RecordedSignals { machine: MachineEvidence; judgeAuthenticity: 'HIGH' | 'MEDIUM' | 'LOW' | null; intendedTier: Tier; calibratedTier: Tier | null; commandTerm: string | null }
const MACHINE_REASON_RULE: Readonly<Record<string, string>> = {
  PROVENANCE_UNCLEAR: 'RIGHTS_PROVENANCE', CONSTRUCT_FAIL: 'CONSTRUCT_ALIGNMENT', CONSTRUCT_WEAK: 'CONSTRUCT_ALIGNMENT', CONSTRUCT_NOT_JUDGED: 'CONSTRUCT_ALIGNMENT', TIER_MISMATCH: 'DIFFICULTY_MECHANISM', TIER_BORDERLINE: 'DIFFICULTY_MECHANISM',
  TIER_NOT_JUDGED: 'DIFFICULTY_MECHANISM', ANSWER_UNCONFIRMED: 'ANSWER_CORRECTNESS', AMBIGUITY_FLAGGED: 'AMBIGUITY', AUTHENTICITY_LOW: 'ASSESSMENT_AUTHENTICITY',
};
/** The rules that judge the QUALITY of an item's text. The others (lineage, rights, blueprint, format support) judge whether it can be an instance. */
export const QUALITY_RULES: readonly string[] = ['ANSWER_CORRECTNESS', 'CONSTRUCT_ALIGNMENT', 'CONSTRUCT_NECESSITY', 'SHORTCUT_BYPASS', 'DISTRACTOR_DIAGNOSTICITY', 'DISTRACTOR_COMPETITIVENESS', 'OPTION_STRUCTURAL_LEAKAGE', 'REPRESENTATION_FIT', 'DIFFICULTY_MECHANISM', 'ASSESSMENT_AUTHENTICITY', 'AMBIGUITY'];
export type QualityVerdict = 'QUALITY_PASS' | 'QUALITY_REVIEW' | 'QUALITY_REJECT';

/**
 * The quality evidence of a recorded candidate: the V5.1 validators and decision, which the fifty reviewed items
 * calibrated, read rule by rule. The verdict IS that decision, so the policy reads a candidate exactly as V5.1 did.
 */
export function qualityOfRecordedCandidate(item: ValidatableItem, signals: RecordedSignals, adapter: Pick<AssessmentAdapter, 'adapterId' | 'responseFormats' | 'commandTerms'> | null): { verdict: QualityVerdict; reasons: string[]; evidence: RuleEvidence[] } {
  const validation = validateInstance({
    item: { ...item, commandTerm: signals.commandTerm }, construct: { intendedReasoningPath: [], difficultyMechanisms: [], intendedTier: signals.intendedTier, requiredRepresentations: [], verbalDecodingIntended: false },
    adapter, shortcutExcludedFormats: [], lineageRequired: false, judgeAuthenticity: signals.judgeAuthenticity, calibratedTier: signals.calibratedTier,
  });
  const outcome = certificationDecision(signals.machine, validation);
  const ruleOfReason = (code: string): string => MACHINE_REASON_RULE[code] ?? RULE_OF_VALIDATOR[validation.findings.find((f) => f.code === code)?.validator ?? ''] ?? 'CONSTRUCT_ALIGNMENT';
  const evidence = QUALITY_RULES.map((ruleId) => {
    const mine = outcome.reasons.filter((c) => ruleOfReason(c) === ruleId);
    if (mine.length === 0) return E.pass(ruleId, 'no finding');
    return outcome.decision === 'REJECTED' ? E.fail(ruleId, mine[0], mine.join(', ')) : E.unknown(ruleId, mine[0], mine.join(', '));
  });
  return { verdict: outcome.decision === 'MACHINE_CERTIFIED' ? 'QUALITY_PASS' : outcome.decision === 'REVIEW_REQUIRED' ? 'QUALITY_REVIEW' : 'QUALITY_REJECT', reasons: outcome.reasons, evidence };
}
