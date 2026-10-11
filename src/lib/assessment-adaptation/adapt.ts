/**
 * EA-1 -- the transversal adaptation engine (pure, deterministic; no IO, no clock, no randomness).
 *
 *   adapt({ family, profile, disciplinePolicy, request }) -> frozen AdaptationSpecification | named refusal
 *
 * The engine knows no exam, no discipline and no concept. It reads three declarative objects and a request:
 *   the FAMILY says what must be elicited and what it can be asked as;
 *   the PROFILE says how a system asks;
 *   the POLICY says what the profile's words mean in the family's discipline.
 * It never repairs a mismatch. Every way the three can fail to fit has a name, and the answer is then a refusal:
 * an unsupported adaptation is never forced, a constraint is never relaxed, an invariant is never changed.
 *
 * ORDER OF DECISION (each step can only refuse or narrow; none widens):
 *   1 inputs valid; profile resolved (system + component)     2 family not retired; family maturity for the use class
 *   3 policy is for the family's type                         4 no invariant change
 *   5 family declares support; component required?            6 assessment applicability
 *   7 response format       8 context, authenticity           9 transfer
 *   10 tool policy          11 stimulus                       12 command term
 *   13 competencies         -> specification, provenance, hashes, freeze
 *
 * COMPONENT REQUIRED (D2), precisely. A system profile names its component-dependent dimensions. When it has any
 * and no component is targeted, the adaptation is refused (`COMPONENT_REQUIRED`) if ANY of these holds:
 *   a. the purpose is anything but PRACTICE or LOW_STAKES_REINFORCEMENT (content for a form is content of a component);
 *   b. the content is EVIDENCE_BEARING (evidence is of a concrete component's behaviour);
 *   c. the request fixes a value of a component-dependent dimension (format, calculator, command term, context);
 *   d. the family's support for the system is constrained on a component-dependent dimension;
 *   e. the family REQUIRES a tool and the tool policy is component-dependent.
 *   f. the system-level fallback of a component-dependent dimension offers nothing the family can use.
 * Otherwise -- generic dev-test practice that needs nothing component-specific -- the system's common rules apply
 * and the specification says its component is null.
 *
 * WHAT IT DOES NOT DO. It writes no question, selects nothing (B2), records no evidence (B3), establishes no
 * right, no review and no pool membership, and certifies nothing. A specification of a DRAFT family under a
 * PROVISIONAL profile says so in its own fields.
 */
import { DEFAULT_TASK_FAMILY_REGISTRY } from '@/lib/exam-core/question-bank/task-families';
import type { CalculatorPolicy, ContextKind, ElicitationFormat, SupportConstraint, TaskFamily, TaskFamilyRegistry, TaskFamilySpecialization } from '@/lib/exam-core/question-bank/task-families/task-family';
import { ADAPTATION_ENGINE, ADAPTATION_SPECIFICATION_VERSION, AdaptationRequestSchema, invariantHashOf, PRODUCTION_FORMAT_OF, specificationIdOf, type AdaptationInvariants, type AdaptationRefusal, type AdaptationRefusalCode, type AdaptationRequest, type AdaptationSpecification, type FieldProvenance } from './adaptation-specification';
import { EA1_APPLICABILITY_THRESHOLD, ApplicabilityThresholdPolicySchema, applicabilityRegisterIssues, resolveApplicability, type AssessmentApplicabilityRecord } from './assessment-applicability';
import { resolveProfile, type ProfileRules, type RuleOrigin, type StimulusMode } from './assessment-system-profile';
import { deepFreeze, sha256OfCanonicalJson } from './canonical-hash';
import { DisciplineAdaptationPolicySchema, policyRuleId, type DisciplineAdaptationPolicy, type VariableDimension } from './discipline-policy';
import { ADAPTATION_POOLS, instancePolicyFor, type AdaptationPool } from './instance-lineage';
import { familyMayFeedEvidenceBearingContent } from '@/lib/exam-core/question-bank/task-families/task-family';

export interface AdaptInput {
  family: unknown;
  /** The assessment-SYSTEM profile. */
  profile: unknown;
  /** The component profile of that system the specification targets. Omit only for generic practice (see COMPONENT REQUIRED). */
  component?: unknown;
  /** The applicability register to read. Omitted or empty = nothing is recorded: every applicability is NONE. */
  applicability?: readonly unknown[];
  /** Defaults to the threshold EA-1 is decided under. */
  applicabilityPolicy?: unknown;
  disciplinePolicy: unknown;
  request: unknown;
  /** The specialisations the family may be of. Defaults to what the repository implements (mathematics). */
  registry?: TaskFamilyRegistry;
  /** ISO date-time recorded on the specification. Passed in: the engine reads no clock. Not part of the identity. */
  adaptedAt?: string | null;
}
export type AdaptationResult = { ok: true; specification: AdaptationSpecification } | { ok: false; refusal: AdaptationRefusal };

/** Formats that collect a selection, a value or an expression; the others collect written working. */
export const CLOSED_FORMATS: ReadonlySet<ElicitationFormat> = new Set(['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION']);
const OPTION_FORMATS: ReadonlySet<ElicitationFormat> = new Set(['SELECTED_RESPONSE', 'MULTI_SELECT']);

class Refuse extends Error {
  constructor(public readonly code: AdaptationRefusalCode, public readonly detail: string) { super(`${code}: ${detail}`); }
}
const refuse = (code: AdaptationRefusalCode, detail: string): never => { throw new Refuse(code, detail); };

/** What every adaptation of the family must leave as it is. Read from the family and from its registered specialisation, never from a request. */
export function invariantsOfFamily(family: TaskFamily, specialization: TaskFamilySpecialization): AdaptationInvariants {
  return {
    primaryConceptStableIds: family.primaryConcepts.map((c) => c.stableId).sort(),
    canonicalSubject: family.canonicalSubject,
    construct: specialization.adaptationFacts(family.specialization).invariantConstruct,
    evidenceTarget: { actions: [...family.evidenceTarget.actions], object: family.evidenceTarget.object, observablePerformance: family.evidenceTarget.observablePerformance },
  };
}

/** The dimension of the profile each fixable request field and each support constraint settles. */
const REQUEST_FIELD_DIMENSION = { responseFormat: 'responseFormats', calculatorPolicy: 'calculatorPolicy', commandTerm: 'commandTerms', context: 'contextExpectations' } as const satisfies Record<string, keyof ProfileRules>;
const CONSTRAINT_DIMENSION: Record<SupportConstraint['kind'], keyof ProfileRules | null> = { RESPONSE_FORMAT_ONLY: 'responseFormats', CALCULATOR_ONLY: 'calculatorPolicy', CONTEXT_ONLY: 'contextExpectations', DIFFICULTY_ONLY: null };
const GENERIC_PRACTICE_PURPOSES: ReadonlySet<string> = new Set(['PRACTICE', 'LOW_STAKES_REINFORCEMENT']);
const policyProvenance = (policy: DisciplineAdaptationPolicy, rule: string): FieldProvenance => ({ origin: 'POLICY_RULE', ref: policyRuleId(policy, rule), authority: 'STUDYUS_POLICY' });
const familyProvenance = (ref: string): FieldProvenance => ({ origin: 'FAMILY', ref, authority: null });
const requestProvenance = (ref: string): FieldProvenance => ({ origin: 'REQUEST', ref, authority: null });

function build(input: AdaptInput): AdaptationSpecification {
  const registry = input.registry ?? DEFAULT_TASK_FAMILY_REGISTRY;

  // 1 -- inputs
  const validated = registry.validate(input.family);
  if (!validated.ok) return refuse(validated.issue === 'FAMILY_TYPE_NOT_REGISTERED' ? 'FAMILY_TYPE_NOT_REGISTERED' : 'FAMILY_INVALID', `${validated.issue}: ${validated.details.slice(0, 4).join('; ')}`);
  const { family, specialization } = validated;
  const resolution = resolveProfile(input.profile, input.component);
  if (!resolution.ok) return refuse(resolution.issue === 'SYSTEM_PROFILE_INVALID' ? 'PROFILE_INVALID' : resolution.issue === 'COMPONENT_NOT_OF_THE_SYSTEM' ? 'COMPONENT_NOT_OF_THE_SYSTEM' : 'COMPONENT_PROFILE_INVALID', `${resolution.issue}: ${resolution.details.join('; ')}`);
  const { resolved, system: profile, component } = resolution;
  const ruleProvenance = (rules: ProfileRules, dimension: keyof ProfileRules): FieldProvenance => ({ origin: (resolved.ruleOrigin[dimension] as RuleOrigin) === 'COMPONENT' ? 'COMPONENT_PROFILE_RULE' : 'SYSTEM_PROFILE_RULE', ref: rules[dimension].ruleId, authority: rules[dimension].authority.kind });
  const registerIssues = applicabilityRegisterIssues(input.applicability ?? []);
  if (registerIssues.length > 0) return refuse('APPLICABILITY_REGISTER_INVALID', registerIssues.slice(0, 4).join('; '));
  const thresholdParsed = ApplicabilityThresholdPolicySchema.safeParse(input.applicabilityPolicy ?? EA1_APPLICABILITY_THRESHOLD);
  if (!thresholdParsed.success) return refuse('APPLICABILITY_REGISTER_INVALID', `threshold policy: ${thresholdParsed.error.issues.slice(0, 2).map((i) => i.message).join('; ')}`);
  const policyParsed = DisciplineAdaptationPolicySchema.safeParse(input.disciplinePolicy);
  if (!policyParsed.success) return refuse('DISCIPLINE_POLICY_INVALID', policyParsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const policy = policyParsed.data;
  const requestParsed = AdaptationRequestSchema.safeParse(input.request);
  if (!requestParsed.success) return refuse('REQUEST_INVALID', requestParsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const request: AdaptationRequest = requestParsed.data;
  const rules = resolved.rules;
  const facts = specialization.adaptationFacts(family.specialization);

  // 2 -- a retired family produces nothing
  if (family.lifecycle === 'RETIRED') refuse('FAMILY_RETIRED', family.familyId);
  // a DRAFT or UNREVIEWED family version produces DEV_TEST_CONTENT only: it never feeds evidence-bearing content
  if (request.contentUseClass === 'EVIDENCE_BEARING' && !familyMayFeedEvidenceBearingContent(family)) refuse('FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT', `${family.familyId}@${family.version} is ${family.lifecycle} / ${family.reviewStatus}; it may generate DEV_TEST_CONTENT only`);
  // 3 -- a policy translates for its own family types and discipline; never by analogy
  if (!policy.familyTypes.includes(family.familyType) || policy.discipline !== specialization.discipline) refuse('DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE', `${policy.policyId} (${policy.discipline}: ${policy.familyTypes.join(', ')}) / ${family.familyType} (${specialization.discipline})`);

  // 4 -- the invariants are not negotiable
  const overrides = Object.entries(request.invariantOverrides ?? {}).filter(([, v]) => v !== undefined).map(([k]) => k);
  if (overrides.length > 0) refuse('INVARIANT_CHANGE_REQUESTED', overrides.sort().join(', '));
  if (request.targetPrimaryConceptStableId !== undefined && !family.primaryConcepts.some((c) => c.stableId === request.targetPrimaryConceptStableId)) refuse('INVARIANT_CHANGE_REQUESTED', `targetPrimaryConceptStableId ${request.targetPrimaryConceptStableId} is not a PRIMARY concept of ${family.familyId}`);
  if (request.targetPrimaryConceptStableId === undefined && family.primaryConcepts.length > 1) refuse('REQUEST_INVALID', 'targetPrimaryConceptStableId is required: the family has several PRIMARY concepts');
  const primaryConcept = family.primaryConcepts.find((c) => c.stableId === (request.targetPrimaryConceptStableId ?? family.primaryConcepts[0].stableId))!;

  // 5 -- the family's own declaration decides first. UNSUPPORTED is final; an undeclared system is not a supported one.
  const support = family.profileSupport[profile.profileId];
  if (!support) return refuse('PROFILE_SUPPORT_NOT_DECLARED', `${family.familyId} / ${profile.profileId}`);
  if (support.status === 'UNSUPPORTED') return refuse('PROFILE_UNSUPPORTED_BY_FAMILY', support.reason);
  const constraints: readonly SupportConstraint[] = support.status === 'SUPPORTED_WITH_CONSTRAINTS' ? support.constraints : [];
  const constraintOf = <K extends SupportConstraint['kind']>(kind: K) => constraints.find((c): c is Extract<SupportConstraint, { kind: K }> => c.kind === kind) ?? null;
  const violated = (kind: SupportConstraint['kind'], value: string): never => refuse('SUPPORT_CONSTRAINT_VIOLATED', `${kind}: ${value} -- ${constraintOf(kind)!.reason}`);

  // 5b -- component: is anything component-specific needed that no component settles?
  if (resolved.unsettledDimensions.length > 0) {
    const unsettled = new Set<keyof ProfileRules>(resolved.unsettledDimensions);
    const why: string[] = [];
    if (!GENERIC_PRACTICE_PURPOSES.has(request.purpose)) why.push(`purpose ${request.purpose}`);
    if (request.contentUseClass === 'EVIDENCE_BEARING') why.push('evidence-bearing content');
    for (const [field, dimension] of Object.entries(REQUEST_FIELD_DIMENSION)) if (request[field as keyof typeof REQUEST_FIELD_DIMENSION] !== undefined && unsettled.has(dimension)) why.push(`request fixes ${field}`);
    for (const c of constraints) { const d = CONSTRAINT_DIMENSION[c.kind]; if (d && unsettled.has(d)) why.push(`family constraint ${c.kind}`); }
    if (facts.toolDependency === 'REQUIRED' && unsettled.has('calculatorPolicy')) why.push('the family requires a tool');
    if (why.length > 0) refuse('COMPONENT_REQUIRED', `${profile.profileId} has component-dependent dimensions (${resolved.unsettledDimensions.join(', ')}) and no component is targeted: ${why.join('; ')}`);
  }

  // 6 -- assessment applicability: a fact read from the register, never inferred from the behaviour fit above,
  // from another exam, or from the name of a subject. Evidence-bearing content requires it to be established.
  const applicability = resolveApplicability((input.applicability ?? []) as AssessmentApplicabilityRecord[], primaryConcept, { systemProfileId: profile.profileId, componentId: component?.componentId ?? null }, thresholdParsed.data);
  if ((request.contentUseClass === 'EVIDENCE_BEARING' || request.applicabilityRequirement === 'ESTABLISHED') && applicability.status !== 'ESTABLISHED') refuse('ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED', `${primaryConcept.stableId} (${primaryConcept.canonicalSubject}) / ${component?.componentId ?? profile.profileId}: basis ${applicability.basis}`);

  const provenance = {} as Record<VariableDimension, FieldProvenance[]>;
  // A misfit on a dimension that only a component settles is not a verdict on the system: without a component the
  // answer is COMPONENT_REQUIRED, and the dimension-specific refusal is given once a component is targeted.
  const refuseOn = (dimension: keyof ProfileRules, code: AdaptationRefusalCode, detail: string): never => (resolved.unsettledDimensions.includes(dimension) ? refuse('COMPONENT_REQUIRED', `${dimension} is component-dependent and the system-level fallback does not fit (${code}: ${detail})`) : refuse(code, detail));

  // difficulty: asked for, inside the family's constraint
  const bands = constraintOf('DIFFICULTY_ONLY');
  if (bands && !bands.bands.includes(request.difficultyBand)) violated('DIFFICULTY_ONLY', request.difficultyBand);
  provenance.difficulty = [requestProvenance('difficultyBand'), ...(bands ? [familyProvenance(`profileSupport.${profile.profileId}.DIFFICULTY_ONLY`)] : [])];

  // 7 -- response format: allowed by the family AND by the profile, inside the family's constraint
  const familyFormats = family.responseConstraints.allowedFormats;
  const profileFormats = rules.responseFormats.value;
  const formatConstraint = constraintOf('RESPONSE_FORMAT_ONLY');
  let format: ElicitationFormat;
  if (request.responseFormat !== undefined) {
    format = request.responseFormat;
    if (!familyFormats.includes(format)) refuse('RESPONSE_FORMAT_NOT_ALLOWED', `${format} is not a format of the family (${familyFormats.join(', ')})`);
    if (!profileFormats.includes(format)) refuse('RESPONSE_FORMAT_NOT_ALLOWED', `${format} is not a format of the profile (${profileFormats.join(', ')})`);
    if (formatConstraint && !formatConstraint.formats.includes(format)) violated('RESPONSE_FORMAT_ONLY', format);
    provenance.responseFormat = [requestProvenance('responseFormat'), ruleProvenance(rules, 'responseFormats'), familyProvenance('responseConstraints.allowedFormats')];
  } else {
    const both = familyFormats.filter((f) => profileFormats.includes(f));
    if (both.length === 0) refuseOn('responseFormats', 'RESPONSE_FORMAT_NOT_ALLOWED', `no format is allowed by both: family ${familyFormats.join(', ')} / profile ${profileFormats.join(', ')}`);
    const open = both.filter((f) => !formatConstraint || formatConstraint.formats.includes(f));
    if (open.length === 0) violated('RESPONSE_FORMAT_ONLY', both.join(', '));
    // the discipline's preference decides among what is left; a format the policy does not rank comes last, in the profile's order
    format = policy.formatPreference.find((f) => open.includes(f)) ?? profileFormats.find((f) => open.includes(f))!;
    provenance.responseFormat = [ruleProvenance(rules, 'responseFormats'), familyProvenance('responseConstraints.allowedFormats'), policyProvenance(policy, 'formatPreference'), ...(formatConstraint ? [familyProvenance(`profileSupport.${profile.profileId}.RESPONSE_FORMAT_ONLY`)] : [])];
  }

  // 8 -- context: one the family supports and the profile offers
  const familyContexts = family.supportedContexts.map((c) => c.kind);
  const profileContexts = rules.contextExpectations.value.allowed;
  const contextConstraint = constraintOf('CONTEXT_ONLY');
  let context: ContextKind;
  if (request.context !== undefined) {
    context = request.context;
    if (!familyContexts.includes(context)) refuse('CONTEXT_NOT_ALLOWED', `${context} is not a context of the family (${familyContexts.join(', ')})`);
    if (!profileContexts.includes(context)) refuse('CONTEXT_NOT_ALLOWED', `${context} is not a context of the profile (${profileContexts.join(', ')})`);
    if (contextConstraint && !contextConstraint.contexts.includes(context)) violated('CONTEXT_ONLY', context);
    provenance.context = [requestProvenance('context'), ruleProvenance(rules, 'contextExpectations'), familyProvenance('supportedContexts')];
  } else {
    const both = profileContexts.filter((c) => familyContexts.includes(c));
    if (both.length === 0) refuseOn('contextExpectations', 'PROFILE_REQUIRES_CONTEXT_FAMILY_CANNOT_PROVIDE', `profile offers ${profileContexts.join(', ')}; family supports ${familyContexts.join(', ')}`);
    const open = both.filter((c) => !contextConstraint || contextConstraint.contexts.includes(c));
    if (open.length === 0) violated('CONTEXT_ONLY', both.join(', '));
    context = open[0];
    provenance.context = [ruleProvenance(rules, 'contextExpectations'), familyProvenance('supportedContexts'), ...(contextConstraint ? [familyProvenance(`profileSupport.${profile.profileId}.CONTEXT_ONLY`)] : [])];
  }
  const authenticity = rules.authenticityRequirements.value;
  if (authenticity === 'AUTHENTIC_CONTEXT_REQUIRED' && context === 'ABSTRACT') refuse('PROFILE_REQUIRES_CONTEXT_FAMILY_CANNOT_PROVIDE', 'the profile requires an authentic context and the task is asked without one');
  provenance.context.push(ruleProvenance(rules, 'authenticityRequirements'), ruleProvenance(rules, 'transferExpectations'));

  // 9 -- transfer: what it asks of a task is the discipline's to say
  const transfer = rules.transferExpectations.value;
  if (transfer === 'REQUIRED') {
    const acts = family.evidenceTarget.actions.some((a) => policy.transfer.requiresAnyAction.includes(a));
    if (!acts) refuse('PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE', `the evidence target (${family.evidenceTarget.actions.join(', ')}) has none of ${policy.transfer.requiresAnyAction.join(', ')}`);
    if (policy.transfer.requiresNonAbstractContext && context === 'ABSTRACT') refuse('PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE', 'transfer needs a situation and the task is asked without one');
    provenance.context.push(policyProvenance(policy, 'transfer'));
  }

  // 10 -- tool policy: a family that needs a tool is refused where none is allowed
  const allowedTools = rules.calculatorPolicy.value.allowed;
  const toolConstraint = constraintOf('CALCULATOR_ONLY');
  const usable = (c: CalculatorPolicy): boolean => facts.toolDependency !== 'REQUIRED' || c !== 'NONE';
  let calculator: CalculatorPolicy;
  if (request.calculatorPolicy !== undefined) {
    calculator = request.calculatorPolicy;
    if (!allowedTools.includes(calculator)) refuse('TOOL_POLICY_NOT_ALLOWED_BY_PROFILE', `${calculator} is not among ${allowedTools.join(', ')}`);
    if (!usable(calculator)) refuse('TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE', `the family requires a tool and ${calculator} was asked`);
    if (toolConstraint && !toolConstraint.policies.includes(calculator)) violated('CALCULATOR_ONLY', calculator);
    provenance.toolPolicy = [requestProvenance('calculatorPolicy'), ruleProvenance(rules, 'calculatorPolicy')];
  } else {
    const fit = allowedTools.filter(usable);
    if (fit.length === 0) refuseOn('calculatorPolicy', 'TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE', `the family requires a tool and the profile allows only ${allowedTools.join(', ')}`);
    const open = fit.filter((c) => !toolConstraint || toolConstraint.policies.includes(c));
    if (open.length === 0) violated('CALCULATOR_ONLY', fit.join(', '));
    calculator = open[0];
    provenance.toolPolicy = [ruleProvenance(rules, 'calculatorPolicy'), ...(toolConstraint ? [familyProvenance(`profileSupport.${profile.profileId}.CALCULATOR_ONLY`)] : [])];
  }
  provenance.toolPolicy.push(familyProvenance('specialization.toolDependency'));
  const numericProfile = policy.toolInteraction[calculator].numericProfile;
  provenance.numericProfile = [policyProvenance(policy, `toolInteraction.${calculator}`), ruleProvenance(rules, 'calculatorPolicy')];

  // 11 -- stimulus: the family's need against what the profile offers
  const stimulusRule = rules.stimulusExpectations.value;
  const withStimulus = stimulusRule.allowed.filter((m) => m !== 'NONE');
  const need2 = family.responseConstraints.stimulusNeed;
  let stimulusMode: StimulusMode;
  if (need2 === 'REQUIRED') {
    if (withStimulus.length === 0) refuse('STIMULUS_REQUIRED_BY_FAMILY_NOT_OFFERED_BY_PROFILE', `the profile offers ${stimulusRule.allowed.join(', ')}`);
    stimulusMode = withStimulus[0];
  } else if (need2 === 'NONE') {
    // the family is asked without a stimulus; a profile that offers no stimulus-free task still receives one, and says so in its rule
    stimulusMode = 'NONE';
  } else stimulusMode = stimulusRule.whenOptional;
  provenance.stimulus = [familyProvenance('responseConstraints.stimulusNeed'), ruleProvenance(rules, 'stimulusExpectations')];

  // 12 -- command term: only from the profile's own vocabulary
  const vocabulary = rules.commandTerms.value;
  let commandTerm: string | null = null;
  if (vocabulary.use === 'NONE') {
    if (request.commandTerm !== undefined) refuse('COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY', `the profile uses no command terms; ${request.commandTerm} was asked`);
    provenance.commandTerm = [ruleProvenance(rules, 'commandTerms')];
  } else if (request.commandTerm !== undefined) {
    if (!vocabulary.terms.includes(request.commandTerm)) refuse('COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY', `${request.commandTerm} is not among ${vocabulary.terms.join(', ')}`);
    commandTerm = request.commandTerm;
    provenance.commandTerm = [requestProvenance('commandTerm'), ruleProvenance(rules, 'commandTerms')];
  } else {
    const lead = family.evidenceTarget.actions[0];
    commandTerm = policy.commandTermByLeadAction[lead].find((t) => vocabulary.terms.includes(t)) ?? vocabulary.terms[0];
    provenance.commandTerm = [ruleProvenance(rules, 'commandTerms'), policyProvenance(policy, `commandTermByLeadAction.${lead}`), familyProvenance('evidenceTarget.actions[0]')];
  }

  // 13 -- the system's competencies this task would count under
  const competencies = rules.competencyEmphasis.value.map((c) => c.code).filter((code) => rules.competencyElicitation.value[code].some((a) => family.evidenceTarget.actions.includes(a)));
  if (rules.competencyEmphasis.value.length > 0 && competencies.length === 0) refuse('PROFILE_COMPETENCY_NOT_ELICITED', `the evidence target (${family.evidenceTarget.actions.join(', ')}) elicits none of ${rules.competencyEmphasis.value.map((c) => c.code).join(', ')}`);
  provenance.competencies = [ruleProvenance(rules, 'competencyEmphasis'), ruleProvenance(rules, 'competencyElicitation'), familyProvenance('evidenceTarget.actions')];

  // reasoning depth: the profile's word for this kind of response, the policy's meaning of it
  const depth = CLOSED_FORMATS.has(format) ? rules.reasoningDepth.value.closedResponse : rules.reasoningDepth.value.constructedResponse;
  const depthMeaning = policy.reasoningDepth[depth];
  provenance.reasoningDepth = [ruleProvenance(rules, 'reasoningDepth'), policyProvenance(policy, `reasoningDepth.${depth}`)];

  // time: the pace the system's published totals leave, when it publishes them
  const t = rules.timePressure.value;
  const units = t.officialMarks ?? t.officialItems;
  const timeBudget = t.officialMinutes !== null && units !== null ? { secondsPerUnit: Math.round(((t.officialMinutes * 60) / units) * 100) / 100, unit: t.officialMarks !== null ? ('MARK' as const) : ('ITEM' as const) } : { secondsPerUnit: null, unit: null };
  provenance.timeBudget = [ruleProvenance(rules, 'timePressure')];
  provenance.markStructure = [ruleProvenance(rules, 'markStructure')];
  provenance.rubricStyle = [ruleProvenance(rules, 'rubricStyle')];

  // distractors exist only where there are options, and come from the family's modelled errors
  const distractors = OPTION_FORMATS.has(format) ? { source: 'FAMILY_MISCONCEPTION_MODELS' as const, misconceptionModelIds: [...facts.misconceptionModelIds] } : null;
  provenance.distractors = distractors ? [policyProvenance(policy, 'distractors'), familyProvenance('specialization.misconceptionModels')] : [policyProvenance(policy, 'distractors')];

  // levers: the family's, of the kinds the policy lets this adaptation pull
  const kinds = new Set([...policy.difficultyLevers.always, ...(context !== 'ABSTRACT' ? policy.difficultyLevers.whenContextualised : []), ...(stimulusMode !== 'NONE' ? policy.difficultyLevers.whenStimulus : [])]);
  const difficultyLevers = family.difficultyLevers.filter((l) => kinds.has(l.kind)).map((l) => l.lever);
  provenance.difficultyLevers = [familyProvenance('difficultyLevers'), policyProvenance(policy, 'difficultyLevers')];
  provenance.language = [requestProvenance('language')];

  const invariants = invariantsOfFamily(family, specialization);
  const instancePolicy = instancePolicyFor(request.purpose, request.contentUseClass);
  const pool = (ADAPTATION_POOLS as readonly string[]).includes(request.purpose) ? (request.purpose as AdaptationPool) : null;
  const content: Omit<AdaptationSpecification, 'specificationId' | 'adaptedAt'> = {
    v: ADAPTATION_SPECIFICATION_VERSION,
    taskFamily: { familyId: family.familyId, version: family.version, familyType: family.familyType, lifecycle: family.lifecycle, reviewStatus: family.reviewStatus },
    systemProfile: { ...resolved.system },
    componentProfile: resolved.component ? { ...resolved.component } : null,
    disciplinePolicy: { policyId: policy.policyId, version: policy.version, discipline: policy.discipline },
    primaryConcept: { ...primaryConcept },
    assessmentApplicability: applicability,
    contentUseClass: request.contentUseClass,
    targetSkills: [...family.targetSkills],
    targetCompetencies: [...family.targetCompetencies],
    invariants,
    invariantHash: invariantHashOf(invariants),
    variable: {
      context: { kind: context, authenticity, transfer },
      responseFormat: { format, productionFormat: PRODUCTION_FORMAT_OF[format] },
      reasoningDepth: { depth, workingShown: depthMeaning.workingShown, justificationRequired: depthMeaning.justificationRequired },
      commandTerm,
      stimulus: { mode: stimulusMode, kinds: stimulusMode === 'NONE' ? [] : [...family.responseConstraints.stimulusKinds] },
      competencies,
      timeBudget,
      markStructure: rules.markStructure.value,
      rubricStyle: rules.rubricStyle.value,
      toolPolicy: { calculator },
      numericProfile,
      distractors,
      difficulty: { band: request.difficultyBand, basis: 'EDITORIAL_ESTIMATE' },
      difficultyLevers,
      language: request.language,
    },
    parameterization: facts.parameterization,
    purpose: { purpose: request.purpose, pool, allowedInstanceClasses: [...instancePolicy.allowedClasses], minimumInstanceClass: instancePolicy.minimumClass },
    blueprintRequirement: request.requirementCellKey ? { requirementCellKey: request.requirementCellKey } : null,
    provenance,
    lineage: { engine: { ...ADAPTATION_ENGINE }, familyContentHash: sha256OfCanonicalJson(family), systemProfileContentHash: sha256OfCanonicalJson(profile), componentProfileContentHash: component ? sha256OfCanonicalJson(component) : null, policyContentHash: sha256OfCanonicalJson(policy), requestHash: sha256OfCanonicalJson(request) },
  };
  // a specification is detached from its inputs (no shared reference) and then frozen
  const detached = JSON.parse(JSON.stringify(content)) as typeof content;
  return deepFreeze({ ...detached, specificationId: specificationIdOf(detached), adaptedAt: input.adaptedAt ?? null });
}

/** One family, asked the way one system asks. A frozen specification, or the name of why not. Same inputs, same result. */
export function adapt(input: AdaptInput): AdaptationResult {
  try {
    return { ok: true, specification: build(input) };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, refusal: { code: e.code, detail: e.detail } };
    throw e;
  }
}

/**
 * Does a specification still carry exactly the invariants of its family? True only when the PRIMARY concepts, the
 * canonical subject, the construct and the evidence target are the family's, and the hash is theirs.
 */
export function invariantsPreserved(family: unknown, specification: Pick<AdaptationSpecification, 'invariants' | 'invariantHash' | 'primaryConcept'>, registry: TaskFamilyRegistry = DEFAULT_TASK_FAMILY_REGISTRY): boolean {
  const validated = registry.validate(family);
  if (!validated.ok) return false;
  const expected = invariantHashOf(JSON.parse(JSON.stringify(invariantsOfFamily(validated.family, validated.specialization))));
  return expected === specification.invariantHash && invariantHashOf(specification.invariants) === expected && validated.family.primaryConcepts.some((c) => c.stableId === specification.primaryConcept.stableId && c.canonicalSubject === specification.primaryConcept.canonicalSubject);
}
