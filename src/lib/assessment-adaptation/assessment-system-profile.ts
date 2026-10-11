/**
 * EA-1 -- the Assessment System Profile: HOW an assessment system expects evidence to be elicited (pure contract, no IO).
 *
 *   Canonical Knowledge -> AssessmentTaskFamily -> [AssessmentSystemProfile] -> DisciplineAdaptationPolicy
 *     -> AdaptationSpecification -> generation -> QuestionCandidate
 *
 * NAMING. The brief calls this concept "AssessmentProfile". `src/lib/assessment-profiles.ts` already exports an
 * `AssessmentProfile` -- the Phase 3B verification settings of the CUMULATIVE_ASSESSMENT and MOCK_EXAM activity
 * types (strictness, grading-confidence floor, timer flag), imported by the assessment-verification service.
 * That is an unrelated thing with the same name. This module therefore names its type
 * `AssessmentSystemProfile` and lives in its own directory; it neither imports nor changes the other.
 *
 * A profile owns BEHAVIOUR AND CONSTRAINTS: response formats, time, command terms, marks, reasoning depth,
 * context, tools, stimulus, length, rubric, competency emphasis, transfer, authenticity, blueprint. It owns NO
 * curriculum knowledge: the schema has no field that can hold a concept, a definition or a concept id, and it is
 * strict, so none can be added without changing this file. What a system assesses is the Curriculum's; how it
 * asks is here.
 *
 * It also holds NO discipline rule. "Method shown" is a profile's word; what method-shown means for a
 * mathematics problem is the discipline policy's.
 *
 * EVERY RULE STATES WHO SAYS SO.
 *   OFFICIAL         the repository already records this fact about the system, with a registered source. The
 *                    rule must cite the source key(s) and where in the repository the fact is recorded; the
 *                    schema refuses an OFFICIAL rule without them. A test re-reads the recorded fact.
 *   STUDYUS_POLICY   StudyUs's working assumption for this proof of concept. Provisional by construction.
 * A profile whose rules are illustrative says so (`status: 'PROVISIONAL_ILLUSTRATIVE'`), and states what its rules
 * rest on (`specification.basis`: MIXED_AUTHORITY or STUDYUS_POLICY_ONLY).
 *
 * HIERARCHY (D2).  AssessmentSystemProfile -> AssessmentComponentProfile
 *   The SYSTEM profile owns the versioned common rules of the assessment system / qualification / subject context.
 *   A COMPONENT profile owns the paper- or component-specific OVERRIDES: calculator policy, duration, response
 *   formats, marks, command-term constraints, section and stimulus behaviour, and any other component rule.
 *   Rules inherit downward. An override is a whole rule with its own authority: an OFFICIAL override needs its own
 *   source, exactly like any OFFICIAL rule. `resolveProfile(system, component?)` gives the rules in force and, for
 *   every dimension, whether it came from the SYSTEM or from the COMPONENT.
 *   The system profile names its COMPONENT-DEPENDENT dimensions: the ones a component may override. That list is
 *   what "component-specific behaviour" means, precisely; a component may override no other dimension.
 */
import { z } from 'zod';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { CALCULATOR_POLICIES, CONTEXT_KINDS, ELICITATION_FORMATS, EVIDENCE_ACTIONS } from '@/lib/exam-core/question-bank/task-families/task-family';

export const ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(200);
const SHORT = z.string().trim().min(3).max(400);
const STATEMENT = z.string().trim().min(10).max(700);

/**
 * Who says a rule is what it is. Three authorities that are never confusable:
 *   OFFICIAL            the assessment system itself, as a source the repository records. Needs source lineage.
 *   STUDYUS_POLICY      StudyUs's working assumption. Provisional.
 *   INSTITUTION_POLICY  (EA-1A) a school's own rule for its own assessment. It names the institution that set it,
 *                       cites no official source, and exists only in a profile whose basis is INSTITUTION_POLICY:
 *                       it can never sit in the profile of an exam system, and it is never official curriculum.
 */
export const RULE_AUTHORITIES = ['OFFICIAL', 'STUDYUS_POLICY', 'INSTITUTION_POLICY'] as const;
export type RuleAuthorityKind = (typeof RULE_AUTHORITIES)[number];

/** Where an OFFICIAL fact comes from: the registered source, and the place in the repository that records the fact. */
export const SourceLineageSchema = z.strictObject({
  /** A key of the assessment source registry (`exam-core/catalog/sources.ts`). */
  sourceKey: ID,
  /** Where the repository records the fact: `<configuration or module> > <path to the value>`. */
  locator: SHORT,
});

export const RuleAuthoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('OFFICIAL'), sources: z.array(SourceLineageSchema).min(1) }),
  z.strictObject({ kind: z.literal('STUDYUS_POLICY'), provisional: z.literal(true), assumption: STATEMENT }),
  // provenance of an institution's rule: WHO set it. No `sources`: an institution's decision is not an official source.
  z.strictObject({ kind: z.literal('INSTITUTION_POLICY'), institutionKey: ID, statement: STATEMENT }),
]);
export type RuleAuthority = z.infer<typeof RuleAuthoritySchema>;

/** One rule of a profile: a stable id, a value, and who says so. */
export const ruleOf = <V extends z.ZodTypeAny>(value: V) => z.strictObject({ ruleId: ID, value, authority: RuleAuthoritySchema });
export interface ProfileRule<V> { ruleId: string; value: V; authority: RuleAuthority }

/** How much of the reasoning a response must show. Generic: the discipline policy says what each means in a discipline. */
export const REASONING_DEPTHS = ['ANSWER_ONLY', 'METHOD_SHOWN', 'JUSTIFIED_ARGUMENT'] as const;
export type ReasoningDepth = (typeof REASONING_DEPTHS)[number];
export const MARK_STRUCTURES = ['ONE_MARK_PER_ITEM', 'MULTI_MARK_PARTS', 'CODED_CREDIT'] as const;
export const RUBRIC_STYLES = ['KEY_ONLY', 'METHOD_AND_ACCURACY', 'CODED_CREDIT_LEVELS'] as const;
export const STIMULUS_MODES = ['NONE', 'OWN_STIMULUS', 'SHARED_STIMULUS'] as const;
export type StimulusMode = (typeof STIMULUS_MODES)[number];
export const CONSTRUCTED_RESPONSE_LENGTHS = ['NOT_OFFERED', 'SHORT_WORKING', 'SHORT_OR_EXTENDED_WORKING'] as const;
export const TRANSFER_EXPECTATIONS = ['NOT_REQUIRED', 'EXPECTED', 'REQUIRED'] as const;
export const AUTHENTICITY_REQUIREMENTS = ['NONE', 'PLAUSIBLE_CONTEXT_PREFERRED', 'AUTHENTIC_CONTEXT_REQUIRED'] as const;
/** Whether the repository holds a sourced distribution of one full form (`blueprintSpecification.status`), or the system has no fixed form. */
export const FULL_FORM_SPECIFICATIONS = ['DOCUMENTED', 'PARTIAL', 'UNKNOWN', 'NOT_APPLICABLE_NO_FIXED_FORM'] as const;
export const PROFILE_STATUSES = ['PROVISIONAL_ILLUSTRATIVE', 'CERTIFIED'] as const;
/**
 * What a profile's rules rest on (D3).
 *   MIXED_AUTHORITY        some rules restate facts the repository records with a source (OFFICIAL, each with its
 *                          lineage); the others are StudyUs policy. Every profile of the proof of concept is this.
 *   STUDYUS_POLICY_ONLY    the repository records no sourced fact for it: it may hold no OFFICIAL rule and cites nothing.
 * Neither is a certification, and an inference is never promoted to OFFICIAL under either.
 */
export const SPECIFICATION_BASES = ['MIXED_AUTHORITY', 'STUDYUS_POLICY_ONLY', 'INSTITUTION_POLICY'] as const;
/** Bases under which no rule may be OFFICIAL and nothing is cited. INSTITUTION_POLICY (EA-1A): a school's own assessment; StudyUs and institution policy only. */
const UNSOURCED_BASES: ReadonlySet<string> = new Set(['STUDYUS_POLICY_ONLY', 'INSTITUTION_POLICY']);

const unique = <T>(list: readonly T[]): boolean => new Set(list).size === list.length;

export const ProfileRulesSchema = z.strictObject({
  /** The formats the system offers, in the order the repository records them. Which one an adaptation prefers is the discipline policy's. */
  responseFormats: ruleOf(z.array(z.enum(ELICITATION_FORMATS)).min(1)),
  /** The component's published totals; null where the system publishes none. The pace follows from them. */
  timePressure: ruleOf(z.strictObject({ officialMinutes: z.number().positive().nullable(), officialItems: z.number().int().positive().nullable(), officialMarks: z.number().positive().nullable() })),
  commandTerms: ruleOf(z.strictObject({ use: z.enum(['NONE', 'CONTROLLED_VOCABULARY']), terms: z.array(z.string().trim().min(2).max(60)) })),
  markStructure: ruleOf(z.enum(MARK_STRUCTURES)),
  /** By kind of response: closed (a selection, a value, an expression) and constructed (written working). */
  reasoningDepth: ruleOf(z.strictObject({ closedResponse: z.enum(REASONING_DEPTHS), constructedResponse: z.enum(REASONING_DEPTHS) })),
  /** In order of preference. A context that is not listed is not offered by this system. */
  contextExpectations: ruleOf(z.strictObject({ allowed: z.array(z.enum(CONTEXT_KINDS)).min(1) })),
  /** In order of preference; several when the system's components differ (a paper without and a paper with). */
  calculatorPolicy: ruleOf(z.strictObject({ allowed: z.array(z.enum(CALCULATOR_POLICIES)).min(1) })),
  stimulusExpectations: ruleOf(z.strictObject({ allowed: z.array(z.enum(STIMULUS_MODES)).min(1), whenOptional: z.enum(STIMULUS_MODES) })),
  responseLength: ruleOf(z.strictObject({ constructedResponse: z.enum(CONSTRUCTED_RESPONSE_LENGTHS) })),
  rubricStyle: ruleOf(z.enum(RUBRIC_STYLES)),
  /** The system's OWN competency or process model, by its own codes. Not canonical knowledge: how the system groups what it asks. */
  competencyEmphasis: ruleOf(z.array(z.strictObject({ code: ID, label: ID, weightPercent: z.string().max(20).nullable() }))),
  /** Which observable actions elicit each competency of the system's model. Always StudyUs's reading. */
  competencyElicitation: ruleOf(z.record(ID, z.array(z.enum(EVIDENCE_ACTIONS)).min(1))),
  transferExpectations: ruleOf(z.enum(TRANSFER_EXPECTATIONS)),
  authenticityRequirements: ruleOf(z.enum(AUTHENTICITY_REQUIREMENTS)),
  blueprintConstraints: ruleOf(z.strictObject({ fullFormSpecification: z.enum(FULL_FORM_SPECIFICATIONS), notes: z.array(SHORT) })),
});
export type ProfileRules = z.infer<typeof ProfileRulesSchema>;
export const PROFILE_RULE_DIMENSIONS = Object.keys(ProfileRulesSchema.shape) as Array<keyof ProfileRules>;

/** Cross-rule consistency of a COMPLETE set of rules. Checked on a system profile and again on every resolved profile. */
export function ruleConsistencyIssues(r: ProfileRules): Array<{ dimension: keyof ProfileRules; message: string }> {
  const out: Array<{ dimension: keyof ProfileRules; message: string }> = [];
  if (!unique(PROFILE_RULE_DIMENSIONS.map((d) => r[d].ruleId))) out.push({ dimension: 'responseFormats', message: 'RULE_ID_LISTED_TWICE' });
  if (!unique(r.responseFormats.value)) out.push({ dimension: 'responseFormats', message: 'FORMAT_LISTED_TWICE' });
  if (!unique(r.contextExpectations.value.allowed)) out.push({ dimension: 'contextExpectations', message: 'CONTEXT_LISTED_TWICE' });
  if (!unique(r.calculatorPolicy.value.allowed)) out.push({ dimension: 'calculatorPolicy', message: 'POLICY_LISTED_TWICE' });
  if ((r.commandTerms.value.use === 'NONE') !== (r.commandTerms.value.terms.length === 0)) out.push({ dimension: 'commandTerms', message: r.commandTerms.value.use === 'NONE' ? 'NO_VOCABULARY_HAS_NO_TERMS' : 'CONTROLLED_VOCABULARY_NEEDS_TERMS' });
  if (!r.stimulusExpectations.value.allowed.includes(r.stimulusExpectations.value.whenOptional)) out.push({ dimension: 'stimulusExpectations', message: 'DEFAULT_STIMULUS_MODE_IS_NOT_ALLOWED' });
  // the elicitation map covers exactly the system's competencies, and is never presented as the system's own statement
  const codes = r.competencyEmphasis.value.map((c) => c.code);
  const mapped = Object.keys(r.competencyElicitation.value);
  if (!unique(codes) || codes.some((c) => !mapped.includes(c)) || mapped.some((c) => !codes.includes(c))) out.push({ dimension: 'competencyElicitation', message: 'ELICITATION_DOES_NOT_MATCH_THE_COMPETENCIES' });
  if (r.competencyElicitation.authority.kind !== 'STUDYUS_POLICY') out.push({ dimension: 'competencyElicitation', message: 'ELICITATION_IS_ALWAYS_STUDYUS_POLICY' });
  return out;
}

const SpecificationSchema = z.strictObject({
  basis: z.enum(SPECIFICATION_BASES),
  /** The repository records the OFFICIAL rules of THIS object were read from. */
  records: z.array(z.strictObject({ recordedIn: SHORT, component: SHORT, sourceKeys: z.array(ID).min(1) })),
  note: STATEMENT,
});
const CertificationSchema = z.strictObject({ certifiedBy: ID, certifiedAt: z.string().datetime({ offset: true }) }).nullable();
const DIMENSION = z.enum(PROFILE_RULE_DIMENSIONS as [keyof ProfileRules, ...Array<keyof ProfileRules>]);

/** What both levels must respect about authority: a certification is stated, and an OFFICIAL rule cites only declared records. */
function authorityIssues(p: { status: string; certification: unknown; specification: z.infer<typeof SpecificationSchema> }, rules: Partial<ProfileRules>, ctx: z.RefinementCtx, path: string): void {
  const present = PROFILE_RULE_DIMENSIONS.filter((d) => rules[d] !== undefined);
  const official = present.filter((d) => rules[d]!.authority.kind === 'OFFICIAL');
  if ((p.status === 'CERTIFIED') !== (p.certification !== null)) ctx.addIssue({ code: 'custom', path: ['certification'], message: p.certification === null ? 'CERTIFIED_NEEDS_A_CERTIFICATION' : 'CERTIFICATION_ONLY_FOR_A_CERTIFIED_PROFILE' });
  // no sourced fact in the repository => nothing may be called official, and nothing is cited
  if (UNSOURCED_BASES.has(p.specification.basis) && (official.length > 0 || p.specification.records.length > 0)) ctx.addIssue({ code: 'custom', path: ['specification'], message: `${p.specification.basis}_HOLDS_NO_OFFICIAL_RULE` });
  // an institution's rule lives only in an institution's profile: never beside the rules of an exam system
  if (p.specification.basis !== 'INSTITUTION_POLICY' && present.some((d) => rules[d]!.authority.kind === 'INSTITUTION_POLICY')) ctx.addIssue({ code: 'custom', path: [path], message: 'INSTITUTION_RULE_ONLY_IN_AN_INSTITUTION_PROFILE' });
  if (p.specification.basis === 'MIXED_AUTHORITY' && p.specification.records.length === 0) ctx.addIssue({ code: 'custom', path: ['specification', 'records'], message: 'MIXED_AUTHORITY_NEEDS_A_RECORD' });
  const declared = new Set(p.specification.records.flatMap((x) => x.sourceKeys));
  for (const d of official) {
    const a = rules[d]!.authority;
    if (a.kind === 'OFFICIAL' && a.sources.some((s) => !declared.has(s.sourceKey))) ctx.addIssue({ code: 'custom', path: [path, d, 'authority', 'sources'], message: 'SOURCE_NOT_IN_THE_PROFILES_SPECIFICATION_RECORDS' });
  }
}

export const AssessmentSystemProfileSchema = z
  .strictObject({
    v: z.literal(ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION),
    profileId: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'PROFILE_ID_FORMAT'),
    version: ID,
    displayName: ID,
    /** The exam family of the repository's taxonomy this profile describes; null when the repository has none. */
    examFamilyCode: z.enum(EXAM_FAMILIES).nullable(),
    status: z.enum(PROFILE_STATUSES),
    certification: CertificationSchema,
    specification: SpecificationSchema,
    /**
     * The dimensions whose rule depends on the component (paper, section, test) of the system. A component profile
     * may override these and no other. When this list is not empty, an adaptation that needs any of them settled
     * must target a concrete component (see `adapt.ts`, COMPONENT_REQUIRED).
     */
    componentDependentDimensions: z.array(DIMENSION),
    /** The common rules. For a component-dependent dimension the rule here is the system-level fallback used by generic practice only. */
    rules: ProfileRulesSchema,
  })
  .superRefine((p, ctx) => {
    authorityIssues(p, p.rules, ctx, 'rules');
    for (const i of ruleConsistencyIssues(p.rules)) ctx.addIssue({ code: 'custom', path: ['rules', i.dimension], message: i.message });
    // an institution's assessment is not an exam system of the taxonomy and never claims to be one
    if (p.specification.basis === 'INSTITUTION_POLICY' && p.examFamilyCode !== null) ctx.addIssue({ code: 'custom', path: ['examFamilyCode'], message: 'INSTITUTION_ASSESSMENT_IS_NOT_AN_EXAM_FAMILY' });
    if (!unique(p.componentDependentDimensions)) ctx.addIssue({ code: 'custom', path: ['componentDependentDimensions'], message: 'DIMENSION_LISTED_TWICE' });
    // a fact that differs by component is not a fact of the system: the system-level fallback of such a dimension is never OFFICIAL
    for (const d of p.componentDependentDimensions) if (p.rules[d].authority.kind === 'OFFICIAL') ctx.addIssue({ code: 'custom', path: ['rules', d, 'authority'], message: 'COMPONENT_DEPENDENT_FALLBACK_IS_NOT_OFFICIAL' });
  });
export type AssessmentSystemProfile = z.infer<typeof AssessmentSystemProfileSchema>;

export const ASSESSMENT_COMPONENT_PROFILE_CONTRACT_VERSION = 1 as const;
/** A paper, section or test of a system: the overrides it makes to the system's common rules. */
export const AssessmentComponentProfileSchema = z
  .strictObject({
    v: z.literal(ASSESSMENT_COMPONENT_PROFILE_CONTRACT_VERSION),
    /** `<SYSTEM>.<COMPONENT...>`; starts with the id of the system it belongs to. */
    componentId: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}(\.[A-Z0-9_]{1,40}){1,4}$/, 'COMPONENT_ID_FORMAT'),
    version: ID,
    systemProfileId: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'PROFILE_ID_FORMAT'),
    displayName: ID,
    /** The exam's LOCAL subject label of the component, as the repository records it. A label, never a canonical subject. */
    localSubject: ID.nullable(),
    status: z.enum(PROFILE_STATUSES),
    certification: CertificationSchema,
    specification: SpecificationSchema,
    /**
     * EA-1A (locked): a component profile is VERSION-AWARE. Official rules belong to a concrete exam / component
     * version, so the profile names the version it binds to, exactly as the repository records it. A component with
     * an OFFICIAL override and no binding is refused. null only for a component that states no official fact.
     */
    versionBinding: z.strictObject({
      /** What kind of record the version is: a reference exam configuration, or a generated syllabus record. */
      source: z.enum(['EXAM_VERTICAL_CONFIGURATION', 'SYLLABUS_RECORD']),
      /** The configuration key (`exam_definitions.config_key`), or the syllabus code. */
      configKey: ID,
      /** The version of it the rules were read from, as recorded (the exam version label, or the syllabus version key). */
      versionLabel: ID,
      /** The component inside that version (the section or component key). */
      componentKey: ID,
    }).nullable(),
    /**
     * An OPTIONAL stable key of the component across versions ("PAA Matemáticas" over the years), for continuity
     * of reporting only. It never replaces the version binding: no rule is read through it.
     */
    semanticComponentKey: z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/).nullable(),
    /** Whole rules, each with its own authority. A dimension that is absent is inherited from the system. */
    overrides: ProfileRulesSchema.partial(),
  })
  .superRefine((c, ctx) => {
    authorityIssues(c, c.overrides, ctx, 'overrides');
    if (c.versionBinding === null && PROFILE_RULE_DIMENSIONS.some((d) => c.overrides[d]?.authority.kind === 'OFFICIAL')) ctx.addIssue({ code: 'custom', path: ['versionBinding'], message: 'OFFICIAL_RULE_NEEDS_A_VERSION_BINDING' });
    if (!c.componentId.startsWith(`${c.systemProfileId}.`)) ctx.addIssue({ code: 'custom', path: ['componentId'], message: 'COMPONENT_ID_IS_NOT_UNDER_ITS_SYSTEM' });
    const ids = PROFILE_RULE_DIMENSIONS.flatMap((d) => (c.overrides[d] ? [c.overrides[d]!.ruleId] : []));
    if (!unique(ids)) ctx.addIssue({ code: 'custom', path: ['overrides'], message: 'RULE_ID_LISTED_TWICE' });
  });
export type AssessmentComponentProfile = z.infer<typeof AssessmentComponentProfileSchema>;

export function validateAssessmentSystemProfile(input: unknown): { ok: true; profile: AssessmentSystemProfile } | { ok: false; issues: string[] } {
  const parsed = AssessmentSystemProfileSchema.safeParse(input);
  return parsed.success ? { ok: true, profile: parsed.data } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

export type RuleOrigin = 'SYSTEM' | 'COMPONENT';
/** The rules in force for a target: the system's, with the component's overrides, and where each one came from. */
export interface ResolvedProfile {
  system: Pick<AssessmentSystemProfile, 'profileId' | 'version' | 'status' | 'examFamilyCode'>;
  component: Pick<AssessmentComponentProfile, 'componentId' | 'version' | 'status' | 'localSubject' | 'versionBinding'> | null;
  rules: ProfileRules;
  ruleOrigin: Record<keyof ProfileRules, RuleOrigin>;
  componentDependentDimensions: Array<keyof ProfileRules>;
  /** The component-dependent dimensions NOT settled: all of them when no component is targeted, none when one is (a component that does not override a dimension has chosen the system's rule). */
  unsettledDimensions: Array<keyof ProfileRules>;
}
export type ProfileResolutionIssue = 'SYSTEM_PROFILE_INVALID' | 'COMPONENT_PROFILE_INVALID' | 'COMPONENT_NOT_OF_THE_SYSTEM' | 'OVERRIDE_OF_A_DIMENSION_THAT_IS_NOT_COMPONENT_DEPENDENT' | 'RESOLVED_RULES_INCONSISTENT';
export type ProfileResolution = { ok: true; resolved: ResolvedProfile; system: AssessmentSystemProfile; component: AssessmentComponentProfile | null } | { ok: false; issue: ProfileResolutionIssue; details: string[] };

/**
 * Inheritance, as a pure function. The component's overrides replace the system's rule of the same dimension,
 * whole (value AND authority: an override never borrows the authority of the rule it replaces). A component may
 * override only what its system declares component-dependent. The resolved rules are checked for consistency again.
 */
export function resolveProfile(systemInput: unknown, componentInput?: unknown): ProfileResolution {
  const sys = AssessmentSystemProfileSchema.safeParse(systemInput);
  if (!sys.success) return { ok: false, issue: 'SYSTEM_PROFILE_INVALID', details: sys.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`) };
  const system = sys.data;
  const origin = Object.fromEntries(PROFILE_RULE_DIMENSIONS.map((d) => [d, 'SYSTEM'])) as Record<keyof ProfileRules, RuleOrigin>;
  const head = { profileId: system.profileId, version: system.version, status: system.status, examFamilyCode: system.examFamilyCode };
  if (componentInput === undefined || componentInput === null) return { ok: true, system, component: null, resolved: { system: head, component: null, rules: system.rules, ruleOrigin: origin, componentDependentDimensions: [...system.componentDependentDimensions], unsettledDimensions: [...system.componentDependentDimensions] } };
  const comp = AssessmentComponentProfileSchema.safeParse(componentInput);
  if (!comp.success) return { ok: false, issue: 'COMPONENT_PROFILE_INVALID', details: comp.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`) };
  const component = comp.data;
  if (component.systemProfileId !== system.profileId) return { ok: false, issue: 'COMPONENT_NOT_OF_THE_SYSTEM', details: [`${component.componentId} belongs to ${component.systemProfileId}, not ${system.profileId}`] };
  const overridden = PROFILE_RULE_DIMENSIONS.filter((d) => component.overrides[d] !== undefined);
  const stray = overridden.filter((d) => !system.componentDependentDimensions.includes(d));
  if (stray.length > 0) return { ok: false, issue: 'OVERRIDE_OF_A_DIMENSION_THAT_IS_NOT_COMPONENT_DEPENDENT', details: stray };
  const rules = { ...system.rules } as Record<string, unknown>;
  for (const d of overridden) { rules[d] = component.overrides[d]; origin[d] = 'COMPONENT'; }
  const inconsistent = ruleConsistencyIssues(rules as ProfileRules);
  if (inconsistent.length > 0) return { ok: false, issue: 'RESOLVED_RULES_INCONSISTENT', details: inconsistent.map((i) => `${i.dimension}: ${i.message}`) };
  return { ok: true, system, component, resolved: { system: head, component: { componentId: component.componentId, version: component.version, status: component.status, localSubject: component.localSubject, versionBinding: component.versionBinding ? { ...component.versionBinding } : null }, rules: rules as ProfileRules, ruleOrigin: origin, componentDependentDimensions: [...system.componentDependentDimensions], unsettledDimensions: [] } };
}

/** Which rules in force are official, which are StudyUs's assumption and which are an institution's. The honest summary of a profile or of a resolved target. */
export function authorityBreakdown(profile: { rules: ProfileRules }): { official: Array<keyof ProfileRules>; studyusPolicy: Array<keyof ProfileRules>; institutionPolicy: Array<keyof ProfileRules> } {
  const of = (kind: RuleAuthorityKind) => PROFILE_RULE_DIMENSIONS.filter((d) => profile.rules[d].authority.kind === kind);
  return { official: of('OFFICIAL'), studyusPolicy: of('STUDYUS_POLICY'), institutionPolicy: of('INSTITUTION_POLICY') };
}
/** May a profile version feed evidence-bearing content? Only a CERTIFIED one (EA-1A, locked): a provisional or illustrative profile generates DEV_TEST_CONTENT only. */
export const profileMayFeedEvidenceBearingContent = (p: { status: string }): boolean => p.status === 'CERTIFIED';
