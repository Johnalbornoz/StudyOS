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
 * A profile whose rules are illustrative says so (`status: 'PROVISIONAL_ILLUSTRATIVE'`). A system for which the
 * repository records no sourced definition at all is `NO_CERTIFIED_SPECIFICATION` and may hold no OFFICIAL rule.
 */
import { z } from 'zod';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { CALCULATOR_POLICIES, CONTEXT_KINDS, ELICITATION_FORMATS, EVIDENCE_ACTIONS } from '@/lib/exam-core/question-bank/task-families/task-family';

export const ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(200);
const SHORT = z.string().trim().min(3).max(400);
const STATEMENT = z.string().trim().min(10).max(700);

export const RULE_AUTHORITIES = ['OFFICIAL', 'STUDYUS_POLICY'] as const;
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
export const SPECIFICATION_BASES = ['REPO_SOURCED_COMPONENT_DEFINITION', 'NO_CERTIFIED_SPECIFICATION'] as const;

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

export const AssessmentSystemProfileSchema = z
  .strictObject({
    v: z.literal(ASSESSMENT_SYSTEM_PROFILE_CONTRACT_VERSION),
    profileId: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'PROFILE_ID_FORMAT'),
    version: ID,
    displayName: ID,
    /** The exam family of the repository's taxonomy this profile describes; null when the repository has none. */
    examFamilyCode: z.enum(EXAM_FAMILIES).nullable(),
    status: z.enum(PROFILE_STATUSES),
    certification: z.strictObject({ certifiedBy: ID, certifiedAt: z.string().datetime({ offset: true }) }).nullable(),
    /** What the repository holds about the system, and the component(s) the OFFICIAL rules were read from. */
    specification: z.strictObject({
      basis: z.enum(SPECIFICATION_BASES),
      records: z.array(z.strictObject({ recordedIn: SHORT, component: SHORT, sourceKeys: z.array(ID).min(1) })),
      note: STATEMENT,
    }),
    rules: ProfileRulesSchema,
  })
  .superRefine((p, ctx) => {
    const r = p.rules;
    const official = PROFILE_RULE_DIMENSIONS.filter((d) => r[d].authority.kind === 'OFFICIAL');
    if ((p.status === 'CERTIFIED') !== (p.certification !== null)) ctx.addIssue({ code: 'custom', path: ['certification'], message: p.certification === null ? 'CERTIFIED_NEEDS_A_CERTIFICATION' : 'CERTIFICATION_ONLY_FOR_A_CERTIFIED_PROFILE' });
    // no sourced definition in the repository => nothing may be called official, and nothing is cited
    if (p.specification.basis === 'NO_CERTIFIED_SPECIFICATION' && (official.length > 0 || p.specification.records.length > 0)) ctx.addIssue({ code: 'custom', path: ['specification'], message: 'NO_CERTIFIED_SPECIFICATION_HOLDS_NO_OFFICIAL_RULE' });
    if (p.specification.basis === 'REPO_SOURCED_COMPONENT_DEFINITION' && p.specification.records.length === 0) ctx.addIssue({ code: 'custom', path: ['specification', 'records'], message: 'SOURCED_SPECIFICATION_NEEDS_A_RECORD' });
    // an OFFICIAL rule cites only sources of the records the profile declares
    const declared = new Set(p.specification.records.flatMap((x) => x.sourceKeys));
    for (const d of official) {
      const a = r[d].authority;
      if (a.kind === 'OFFICIAL' && a.sources.some((s) => !declared.has(s.sourceKey))) ctx.addIssue({ code: 'custom', path: ['rules', d, 'authority', 'sources'], message: 'SOURCE_NOT_IN_THE_PROFILES_SPECIFICATION_RECORDS' });
    }
    if (!unique(PROFILE_RULE_DIMENSIONS.map((d) => r[d].ruleId))) ctx.addIssue({ code: 'custom', path: ['rules'], message: 'RULE_ID_LISTED_TWICE' });
    if (!unique(r.responseFormats.value)) ctx.addIssue({ code: 'custom', path: ['rules', 'responseFormats'], message: 'FORMAT_LISTED_TWICE' });
    if (!unique(r.contextExpectations.value.allowed)) ctx.addIssue({ code: 'custom', path: ['rules', 'contextExpectations'], message: 'CONTEXT_LISTED_TWICE' });
    if (!unique(r.calculatorPolicy.value.allowed)) ctx.addIssue({ code: 'custom', path: ['rules', 'calculatorPolicy'], message: 'POLICY_LISTED_TWICE' });
    if ((r.commandTerms.value.use === 'NONE') !== (r.commandTerms.value.terms.length === 0)) ctx.addIssue({ code: 'custom', path: ['rules', 'commandTerms'], message: r.commandTerms.value.use === 'NONE' ? 'NO_VOCABULARY_HAS_NO_TERMS' : 'CONTROLLED_VOCABULARY_NEEDS_TERMS' });
    if (!r.stimulusExpectations.value.allowed.includes(r.stimulusExpectations.value.whenOptional)) ctx.addIssue({ code: 'custom', path: ['rules', 'stimulusExpectations'], message: 'DEFAULT_STIMULUS_MODE_IS_NOT_ALLOWED' });
    // the elicitation map covers exactly the system's competencies, and is never presented as the system's own statement
    const codes = r.competencyEmphasis.value.map((c) => c.code);
    const mapped = Object.keys(r.competencyElicitation.value);
    if (!unique(codes) || codes.some((c) => !mapped.includes(c)) || mapped.some((c) => !codes.includes(c))) ctx.addIssue({ code: 'custom', path: ['rules', 'competencyElicitation'], message: 'ELICITATION_DOES_NOT_MATCH_THE_COMPETENCIES' });
    if (r.competencyElicitation.authority.kind !== 'STUDYUS_POLICY') ctx.addIssue({ code: 'custom', path: ['rules', 'competencyElicitation', 'authority'], message: 'ELICITATION_IS_ALWAYS_STUDYUS_POLICY' });
  });
export type AssessmentSystemProfile = z.infer<typeof AssessmentSystemProfileSchema>;

export function validateAssessmentSystemProfile(input: unknown): { ok: true; profile: AssessmentSystemProfile } | { ok: false; issues: string[] } {
  const parsed = AssessmentSystemProfileSchema.safeParse(input);
  return parsed.success ? { ok: true, profile: parsed.data } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** Which rules of a profile are official and which are StudyUs's assumption. The honest summary of a profile. */
export function authorityBreakdown(profile: AssessmentSystemProfile): { official: Array<keyof ProfileRules>; studyusPolicy: Array<keyof ProfileRules> } {
  const official = PROFILE_RULE_DIMENSIONS.filter((d) => profile.rules[d].authority.kind === 'OFFICIAL');
  return { official, studyusPolicy: PROFILE_RULE_DIMENSIONS.filter((d) => !official.includes(d)) };
}
