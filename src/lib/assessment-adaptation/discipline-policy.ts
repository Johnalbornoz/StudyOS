/**
 * EA-1 -- the Discipline Adaptation Policy: what a profile's generic words MEAN in one discipline (pure, no IO).
 *
 *   AssessmentTaskFamily -> AssessmentSystemProfile -> [DisciplineAdaptationPolicy] -> AdaptationSpecification
 *
 * A profile says "method shown", "calculator not allowed", "transfer required". Those are generic. What counts as
 * shown method in a mathematics problem, what a no-calculator rule does to the numbers an instance may use, and
 * what transfer asks of a mathematical task are statements about MATHEMATICS -- they belong neither to the
 * profile (which must hold no discipline rule) nor to a family (which must know no exam). They live here, keyed
 * by discipline and by the family types the discipline covers, versioned, and they are StudyUs policy throughout.
 *
 * The policy also names what an adaptation may never touch (`invariantDimensions`) and what it may
 * (`variableDimensions`). The engine enforces the first and reports provenance for the second.
 *
 * Only MATHEMATICS exists. Another discipline is another policy object of this same schema; nothing here is
 * specific to mathematics except the data at the bottom.
 */
import { z } from 'zod';
import { CALCULATOR_POLICIES, DIFFICULTY_LEVER_KINDS, ELICITATION_FORMATS, EVIDENCE_ACTIONS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { REASONING_DEPTHS } from './assessment-system-profile';

export const DISCIPLINE_POLICY_CONTRACT_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(200);
const STATEMENT = z.string().trim().min(10).max(700);

/** What every adaptation of a family leaves untouched. */
export const INVARIANT_DIMENSIONS = ['PRIMARY_CONCEPT', 'CONSTRUCT', 'EVIDENCE_TARGET'] as const;
export type InvariantDimension = (typeof INVARIANT_DIMENSIONS)[number];
/** What an adaptation decides, each with a recorded origin. `numbers` and `language` are instance-level: a specification bounds them, generation fixes them. */
export const VARIABLE_DIMENSIONS = ['context', 'responseFormat', 'reasoningDepth', 'commandTerm', 'stimulus', 'competencies', 'timeBudget', 'markStructure', 'rubricStyle', 'toolPolicy', 'numericProfile', 'distractors', 'difficulty', 'difficultyLevers', 'language'] as const;
export type VariableDimension = (typeof VARIABLE_DIMENSIONS)[number];
/** How the numbers of an instance are chosen once the tool policy is known. */
export const NUMERIC_PROFILES = ['EXACT_WITHOUT_TOOL', 'REALISTIC_VALUES'] as const;
export type NumericProfile = (typeof NUMERIC_PROFILES)[number];

const depthMeaning = z.strictObject({ workingShown: z.boolean(), justificationRequired: z.boolean(), meaning: STATEMENT });
const toolMeaning = z.strictObject({ numericProfile: z.enum(NUMERIC_PROFILES), meaning: STATEMENT });

export const MARK_POINT_KINDS = ['METHOD', 'ACCURACY', 'REASONING'] as const;
export const MARK_SCORING_KINDS = ['SINGLE_KEYED_UNIT', 'SINGLE_CODED_UNIT', 'MARKED_PARTS'] as const;
const range = z.strictObject({ min: z.number().int().min(1).max(30), max: z.number().int().min(1).max(30) }).refine((r) => r.min <= r.max, 'RANGE_INVERTED');
const markMeaning = z.strictObject({ scoredAs: z.enum(MARK_SCORING_KINDS), total: range, parts: range.nullable(), meaning: STATEMENT });

export const DisciplineAdaptationPolicySchema = z
  .strictObject({
    v: z.literal(DISCIPLINE_POLICY_CONTRACT_VERSION),
    policyId: ID,
    version: ID,
    discipline: ID,
    /** The family types this policy translates for. A family of another type is refused, never translated by analogy. */
    familyTypes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,59}$/)).min(1),
    authority: z.literal('STUDYUS_POLICY'),
    status: z.enum(['PROVISIONAL', 'CERTIFIED']),
    invariantDimensions: z.array(z.enum(INVARIANT_DIMENSIONS)),
    variableDimensions: z.array(z.enum(VARIABLE_DIMENSIONS)).min(1),
    /** Which response format an adaptation takes when the request names none: the first of these that family, profile and constraints all allow. */
    formatPreference: z.array(z.enum(ELICITATION_FORMATS)).min(1),
    /** What each generic reasoning depth requires of a response in this discipline. */
    reasoningDepth: z.strictObject({ ANSWER_ONLY: depthMeaning, METHOD_SHOWN: depthMeaning, JUSTIFIED_ARGUMENT: depthMeaning }),
    /** What each tool policy does to the numbers of an instance. A family that REQUIRES a tool is refused where none is allowed. */
    toolInteraction: z.strictObject({ NONE: toolMeaning, ALLOWED: toolMeaning, SCIENTIFIC_REQUIRED: toolMeaning, GDC_REQUIRED: toolMeaning }),
    /** Which kinds of difficulty lever an adaptation may pull, and when. */
    difficultyLevers: z.strictObject({ always: z.array(z.enum(DIFFICULTY_LEVER_KINDS)), whenContextualised: z.array(z.enum(DIFFICULTY_LEVER_KINDS)), whenStimulus: z.array(z.enum(DIFFICULTY_LEVER_KINDS)) }),
    /** What "transfer" asks of a task in this discipline. A family that cannot meet it is refused where transfer is required. */
    transfer: z.strictObject({ requiresAnyAction: z.array(z.enum(EVIDENCE_ACTIONS)).min(1), requiresNonAbstractContext: z.boolean(), meaning: STATEMENT }),
    /** Command terms that suit a task, by the FIRST action of its evidence target, most suitable first. Used only against a profile's own vocabulary. */
    commandTermByLeadAction: z.record(z.enum(EVIDENCE_ACTIONS), z.array(z.string().trim().min(2).max(60)).min(1)),
    distractors: z.strictObject({ source: z.literal('FAMILY_MISCONCEPTION_MODELS'), meaning: STATEMENT }),
    /**
     * QB-R2E. What each mark structure means for ONE instance: how it is scored, the range its total may take and
     * how many parts it may have. No assessment system in the repository records a total for a single question, so
     * these ranges are StudyUs policy and are cited as such; an OFFICIAL per-question total, once recorded in a
     * profile, would take precedence.
     */
    marks: z.strictObject({
      ONE_MARK_PER_ITEM: markMeaning, MULTI_MARK_PARTS: markMeaning, CODED_CREDIT: markMeaning,
      /** The kinds of mark point a marked part may carry. StudyUs's neutral names, not a board's notation. */
      markPointKinds: z.array(z.enum(MARK_POINT_KINDS)).min(1),
    }),
  })
  .superRefine((p, ctx) => {
    // the three invariants are not optional: a policy that drops one is not a policy of this architecture
    if (INVARIANT_DIMENSIONS.some((d) => !p.invariantDimensions.includes(d)) || p.invariantDimensions.length !== INVARIANT_DIMENSIONS.length) ctx.addIssue({ code: 'custom', path: ['invariantDimensions'], message: 'A_POLICY_KEEPS_ALL_THREE_INVARIANTS' });
    if (new Set(p.formatPreference).size !== p.formatPreference.length) ctx.addIssue({ code: 'custom', path: ['formatPreference'], message: 'FORMAT_LISTED_TWICE' });
    for (const d of REASONING_DEPTHS) if (d === 'ANSWER_ONLY' && (p.reasoningDepth[d].workingShown || p.reasoningDepth[d].justificationRequired)) ctx.addIssue({ code: 'custom', path: ['reasoningDepth', d], message: 'ANSWER_ONLY_SHOWS_NOTHING' });
    for (const c of CALCULATOR_POLICIES) if (c === 'NONE' && p.toolInteraction[c].numericProfile !== 'EXACT_WITHOUT_TOOL') ctx.addIssue({ code: 'custom', path: ['toolInteraction', c], message: 'NO_TOOL_MEANS_EXACT_WITHOUT_ONE' });
  });
export type DisciplineAdaptationPolicy = z.infer<typeof DisciplineAdaptationPolicySchema>;

export function validateDisciplinePolicy(input: unknown): { ok: true; policy: DisciplineAdaptationPolicy } | { ok: false; issues: string[] } {
  const parsed = DisciplineAdaptationPolicySchema.safeParse(input);
  return parsed.success ? { ok: true, policy: parsed.data } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** The id a specification cites when one of its fields came from a rule of the policy. */
export const policyRuleId = (policy: Pick<DisciplineAdaptationPolicy, 'policyId' | 'version'>, rule: string): string => `${policy.policyId}@${policy.version}#${rule}`;

/**
 * MATHEMATICS, for MATH_PROBLEM families. StudyUs policy, provisional, written for the proof of concept and read
 * by no mathematics specialist. It states StudyUs's working rules; it describes no examination board.
 */
export const MATHEMATICS_ADAPTATION_POLICY: DisciplineAdaptationPolicy = {
  v: DISCIPLINE_POLICY_CONTRACT_VERSION,
  policyId: 'studyus.adaptation.mathematics',
  version: '0.2.0-provisional',
  discipline: 'MATHEMATICS',
  familyTypes: ['MATH_PROBLEM'],
  authority: 'STUDYUS_POLICY',
  status: 'PROVISIONAL',
  invariantDimensions: ['PRIMARY_CONCEPT', 'CONSTRUCT', 'EVIDENCE_TARGET'],
  variableDimensions: [...VARIABLE_DIMENSIONS],
  formatPreference: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'SHORT_RESPONSE', 'MATH_EXPRESSION', 'EXTENDED_RESPONSE', 'MULTI_SELECT'],
  reasoningDepth: {
    ANSWER_ONLY: { workingShown: false, justificationRequired: false, meaning: 'Only the result is collected. The task must be built so that the result cannot be reached without the relationships of the construct.' },
    METHOD_SHOWN: { workingShown: true, justificationRequired: false, meaning: 'The response writes the relationship it uses before working it, and each line follows from the one before. Credit can be given for a correct method with a wrong result.' },
    JUSTIFIED_ARGUMENT: { workingShown: true, justificationRequired: true, meaning: 'The response states a conclusion and supports it with the mathematics: which quantities were compared, and why the comparison decides the question.' },
  },
  toolInteraction: {
    NONE: { numericProfile: 'EXACT_WITHOUT_TOOL', meaning: 'Values are drawn from the part of the parameter ranges that gives exact results by hand: whole numbers, simple fractions, terminating decimals of at most two places.' },
    ALLOWED: { numericProfile: 'REALISTIC_VALUES', meaning: 'Values may be realistic. The task must still need the construct: a tool only carries out the arithmetic.' },
    SCIENTIFIC_REQUIRED: { numericProfile: 'REALISTIC_VALUES', meaning: 'Values may be realistic and results are given to a stated accuracy. Nothing may depend on graphing or symbolic manipulation by the tool.' },
    GDC_REQUIRED: { numericProfile: 'REALISTIC_VALUES', meaning: 'Values may be realistic and a graph or a numerical solver may be used; the response still states the relationship it set up.' },
  },
  difficultyLevers: { always: ['NUMERIC', 'STEPS', 'ABSTRACTION'], whenContextualised: ['CONTEXT_LOAD'], whenStimulus: ['REPRESENTATION'] },
  transfer: { requiresAnyAction: ['FORMULATE', 'INTERPRET', 'EVALUATE'], requiresNonAbstractContext: true, meaning: 'A mathematical task shows transfer when the learner must turn a situation into mathematics, or read a mathematical result back into the situation, or judge a statement about it. Working a given structure does not.' },
  commandTermByLeadAction: {
    RECALL: ['write down', 'find'],
    COMPUTE: ['calculate', 'work out', 'find'],
    SOLVE: ['solve', 'work out', 'find', 'calculate'],
    REPRESENT: ['write down', 'find', 'work out'],
    FORMULATE: ['find', 'work out', 'show that'],
    INTERPRET: ['write down', 'find', 'work out'],
    EVALUATE: ['show that', 'find', 'work out'],
    JUSTIFY: ['show that', 'hence'],
  },
  distractors: { source: 'FAMILY_MISCONCEPTION_MODELS', meaning: 'Each wrong option of a selected response is the result one modelled error of the family produces. A wrong option that no modelled error produces is not written.' },
  marks: {
    ONE_MARK_PER_ITEM: { scoredAs: 'SINGLE_KEYED_UNIT', total: { min: 1, max: 1 }, parts: null, meaning: 'One keyed answer, one mark. No parts and no mark scheme.' },
    CODED_CREDIT: { scoredAs: 'SINGLE_CODED_UNIT', total: { min: 1, max: 1 }, parts: null, meaning: 'One scored unit, coded as full, partial or no credit. It carries credit levels, not marks per step.' },
    MULTI_MARK_PARTS: { scoredAs: 'MARKED_PARTS', total: { min: 2, max: 8 }, parts: { min: 1, max: 4 }, meaning: 'One or more parts, each with its marks and its mark points. The range is a StudyUs working rule for a single question, not a figure of any examination.' },
    markPointKinds: ['METHOD', 'ACCURACY', 'REASONING'],
  },
};
