/**
 * EA-1A -- the Learning Approach Profile: HOW AN INSTITUTION WANTS THE LEARNER TO WORK WITH AND DEMONSTRATE
 * KNOWLEDGE DURING LEARNING (pure contract and two profiles, no IO).
 *
 * THREE INDEPENDENT, COMPOSABLE LAYERS. None contains, implies or can be derived from another:
 *   CURRICULUM PROFILE          what the learner is expected to learn            (Curriculum: SEP / MCCEMS, MEN, IB ...)
 *   LEARNING APPROACH PROFILE   how the institution wants it worked and shown    (this module: STANDARD, STEM_PLUS)
 *   ASSESSMENT PROFILE          how an assessment requires evidence to be shown  (the assessment layer: PAA, PISA ...)
 * So one curriculum is taught under several approaches (MCCEMS + STANDARD, MCCEMS + STEM_PLUS), one approach
 * serves several curricula (MCCEMS + STEM_PLUS, MEN + STEM_PLUS), and either is assessed by several systems.
 * THERE IS NO "STEM CURRICULUM": an approach names no concept, no topic and no objective, and the schema has no
 * field that could hold one. It also names no exam and no exam rule.
 *
 * WHAT AN APPROACH OWNS: pedagogical and evidence EMPHASIS.
 *   - the transversal competencies it wants evidenced, by REFERENCE into the existing competency catalogue
 *     (`competencies.code`; in the repository: `DEV_COMPETENCIES`). It is not a second competency registry: a
 *     competency the catalogue does not hold yet is referenced by a PROPOSED code, marked NOT_YET_IN_CATALOGUE,
 *     to be created by the Curriculum -- never created here;
 *   - PREFERENCES over the dimensions an adaptation decides (context, response format, reasoning depth, stimulus,
 *     tool use);
 *   - the participation modes it uses (individual, collaborative).
 *
 * PRECEDENCE (who decides what, in this order):
 *   1 Curriculum            knowledge entitlement
 *   2 Learning approach     pedagogical / evidence emphasis
 *   3 Assessment profile    exam / system constraints
 *   4 Task family           task structure
 *   5 Adaptation specification resolves the combination
 * CONFLICT RULE. An assessment-profile rule constrains the feasible set; the approach only CHOOSES WITHIN it.
 *   - An OFFICIAL assessment constraint always wins over an approach preference (the brief's rule).
 *   - STUDYUS POLICY, flagged for confirmation: a profile rule of ANY authority (official, StudyUs policy,
 *     institution policy) constrains in the same way. An approach never widens what a profile, a family or a
 *     request allows.
 *   - A preference that could not be honoured is never dropped silently: it is recorded on the specification as
 *     UNMET, with what was wanted, what was decided and the rule that overrode it.
 *   - It is a refusal only when the approach marks the preference REQUIRED_OUTSIDE_EXAMS and the target is not an
 *     exam system (an institution's own assessment). Against an exam system even a required preference yields.
 *
 * STANDARD is the default approach and is EMPHASIS-NEUTRAL: no competency, no preference, individual work. It is
 * recorded by ABSENCE. An adaptation under STANDARD, or under no approach at all, is the same specification, with
 * the same id, as before learning approaches existed -- which is what keeps every EA-1 specification unchanged.
 *
 * Every approach is STUDYUS_POLICY. It is never an official curriculum statement and never an exam rule.
 */
import { z } from 'zod';

export const LEARNING_APPROACH_CONTRACT_VERSION = 1 as const;
export const STANDARD_APPROACH_ID = 'STANDARD' as const;

const ID = z.string().trim().min(1).max(200);
const STATEMENT = z.string().trim().min(10).max(700);

/** The dimensions of an adaptation an approach may express a preference about. Nothing else is the approach's to touch. */
export const APPROACH_DIMENSIONS = ['context', 'responseFormat', 'reasoningDepth', 'stimulus', 'toolPolicy'] as const;
export type ApproachDimension = (typeof APPROACH_DIMENSIONS)[number];
/**
 * The values a preference may name, per dimension. Restated from the task-family and profile vocabularies so that
 * this directory imports nothing of the assessment layer; a test keeps them equal.
 */
export const APPROACH_DIMENSION_VALUES: Readonly<Record<ApproachDimension, readonly string[]>> = {
  context: ['ABSTRACT', 'PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'],
  responseFormat: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'],
  reasoningDepth: ['ANSWER_ONLY', 'METHOD_SHOWN', 'JUSTIFIED_ARGUMENT'],
  stimulus: ['NONE', 'OWN_STIMULUS', 'SHARED_STIMULUS'],
  toolPolicy: ['NONE', 'ALLOWED', 'SCIENTIFIC_REQUIRED', 'GDC_REQUIRED'],
};
export const PREFERENCE_STRENGTHS = ['PREFERRED', 'REQUIRED_OUTSIDE_EXAMS'] as const;
export const APPROACH_PARTICIPATION_MODES = ['INDIVIDUAL', 'COLLABORATIVE'] as const;
export type ApproachParticipationMode = (typeof APPROACH_PARTICIPATION_MODES)[number];
export const APPROACH_STATUSES = ['PROVISIONAL', 'CERTIFIED'] as const;

/**
 * A reference into the competency catalogue. IN_CATALOGUE names an existing `competencies.code`.
 * NOT_YET_IN_CATALOGUE names the code PROPOSED for a competency the catalogue does not hold; it creates nothing,
 * and says who would create it.
 */
export const CompetencyReferenceSchema = z.discriminatedUnion('catalogueStatus', [
  z.strictObject({ catalogueStatus: z.literal('IN_CATALOGUE'), code: ID }),
  z.strictObject({ catalogueStatus: z.literal('NOT_YET_IN_CATALOGUE'), proposedCode: ID, toBeCreatedBy: z.literal('CURRICULUM') }),
]);
export type CompetencyReference = z.infer<typeof CompetencyReferenceSchema>;
/** The catalogue code a reference stands for: the existing one, or the proposed one. */
export const competencyCodeOf = (r: CompetencyReference): string => (r.catalogueStatus === 'IN_CATALOGUE' ? r.code : r.proposedCode);

export const ApproachPreferenceSchema = z.strictObject({
  preferenceId: ID,
  dimension: z.enum(APPROACH_DIMENSIONS),
  /** Values of the dimension, most wanted first. The adaptation takes the first one the feasible set contains. */
  prefer: z.array(ID).min(1),
  strength: z.enum(PREFERENCE_STRENGTHS),
  rationale: STATEMENT,
});
export type ApproachPreference = z.infer<typeof ApproachPreferenceSchema>;

export const LearningApproachProfileSchema = z
  .strictObject({
    v: z.literal(LEARNING_APPROACH_CONTRACT_VERSION),
    approachId: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'APPROACH_ID_FORMAT'),
    version: ID,
    displayName: ID,
    /**
     * An approach is StudyUs's pedagogical policy. Never official. D4: in this release approaches are StudyUs-managed
     * (STANDARD, STEM_PLUS); an institution SELECTS and ASSIGNS them and cannot author one, so no other authority and
     * no owner field exists.
     */
    authority: z.literal('STUDYUS_POLICY'),
    status: z.enum(APPROACH_STATUSES),
    certification: z.strictObject({ certifiedBy: ID, certifiedAt: z.string().datetime({ offset: true }) }).nullable(),
    statement: STATEMENT,
    /** The transversal competencies the approach wants evidenced, by its own key and by reference into the catalogue. */
    transversalCompetencies: z.array(z.strictObject({ key: z.string().regex(/^[A-Z][A-Z0-9_]{2,59}$/), reference: CompetencyReferenceSchema, description: STATEMENT })),
    preferences: z.array(ApproachPreferenceSchema),
    participationModes: z.array(z.enum(APPROACH_PARTICIPATION_MODES)).min(1),
  })
  .superRefine((a, ctx) => {
    const uniq = (xs: readonly string[]) => new Set(xs).size === xs.length;
    if ((a.status === 'CERTIFIED') !== (a.certification !== null)) ctx.addIssue({ code: 'custom', path: ['certification'], message: 'CERTIFIED_NEEDS_A_CERTIFICATION' });
    if (!a.participationModes.includes('INDIVIDUAL')) ctx.addIssue({ code: 'custom', path: ['participationModes'], message: 'INDIVIDUAL_WORK_IS_ALWAYS_POSSIBLE' });
    if (!uniq(a.participationModes) || !uniq(a.transversalCompetencies.map((c) => c.key)) || !uniq(a.transversalCompetencies.map((c) => competencyCodeOf(c.reference))) || !uniq(a.preferences.map((p) => p.preferenceId))) ctx.addIssue({ code: 'custom', path: [], message: 'LISTED_TWICE' });
    // at most one preference per dimension: an approach states one ordered wish for it
    if (!uniq(a.preferences.map((p) => p.dimension))) ctx.addIssue({ code: 'custom', path: ['preferences'], message: 'ONE_PREFERENCE_PER_DIMENSION' });
    a.preferences.forEach((p, i) => {
      if (!uniq(p.prefer) || p.prefer.some((v) => !APPROACH_DIMENSION_VALUES[p.dimension].includes(v))) ctx.addIssue({ code: 'custom', path: ['preferences', i, 'prefer'], message: 'VALUE_IS_NOT_OF_THE_DIMENSION' });
    });
    // STANDARD is the emphasis-neutral default, and nothing else may be: it is recorded by absence
    const neutral = a.transversalCompetencies.length === 0 && a.preferences.length === 0 && a.participationModes.length === 1;
    if ((a.approachId === STANDARD_APPROACH_ID) !== neutral) ctx.addIssue({ code: 'custom', path: ['approachId'], message: a.approachId === STANDARD_APPROACH_ID ? 'STANDARD_IS_EMPHASIS_NEUTRAL' : 'ONLY_STANDARD_IS_EMPHASIS_NEUTRAL' });
  });
export type LearningApproachProfile = z.infer<typeof LearningApproachProfileSchema>;

/**
 * CATALOGUE READINESS of an approach: are the competencies it references in the competency catalogue? Computed from
 * the approach's own references and the catalogue's codes (passed in: this module reads no catalogue).
 *   READY       every reference is IN_CATALOGUE and the catalogue holds its code
 *   PARTIAL     some are; the others are future canonical-catalogue work, owned by the Curriculum
 *   NOT_READY   none is
 * This is DATA readiness, kept apart from the approach CONTRACT: the contract can be sound while the catalogue is
 * not ready. A reference that disagrees with the catalogue (IN_CATALOGUE but absent, or NOT_YET but present) is an
 * inconsistency and is listed, never silently corrected. Nothing here creates a competency.
 */
export interface CatalogueReadiness {
  approachId: string; version: string;
  status: 'READY' | 'PARTIAL' | 'NOT_READY';
  inCatalogue: Array<{ key: string; code: string }>;
  /** Future canonical-catalogue work: the competencies to be created, with the code proposed for each. */
  missing: Array<{ key: string; proposedCode: string; owner: 'CURRICULUM' }>;
  inconsistencies: Array<{ key: string; code: string; issue: 'DECLARED_IN_CATALOGUE_BUT_ABSENT' | 'DECLARED_MISSING_BUT_PRESENT' }>;
}
export function catalogueReadinessOf(approach: Pick<LearningApproachProfile, 'approachId' | 'version' | 'transversalCompetencies'>, catalogueCodes: readonly string[]): CatalogueReadiness {
  const catalogue = new Set(catalogueCodes);
  const out: CatalogueReadiness = { approachId: approach.approachId, version: approach.version, status: 'READY', inCatalogue: [], missing: [], inconsistencies: [] };
  for (const c of approach.transversalCompetencies) {
    const code = competencyCodeOf(c.reference);
    if (c.reference.catalogueStatus === 'IN_CATALOGUE') {
      if (catalogue.has(code)) out.inCatalogue.push({ key: c.key, code });
      else out.inconsistencies.push({ key: c.key, code, issue: 'DECLARED_IN_CATALOGUE_BUT_ABSENT' });
    } else if (catalogue.has(code)) out.inconsistencies.push({ key: c.key, code, issue: 'DECLARED_MISSING_BUT_PRESENT' });
    else out.missing.push({ key: c.key, proposedCode: code, owner: 'CURRICULUM' });
  }
  const total = approach.transversalCompetencies.length;
  out.status = out.inCatalogue.length === total ? 'READY' : out.inCatalogue.length === 0 ? 'NOT_READY' : 'PARTIAL';
  return out;
}

export function validateLearningApproachProfile(input: unknown): { ok: true; approach: LearningApproachProfile } | { ok: false; issues: string[] } {
  const parsed = LearningApproachProfileSchema.safeParse(input);
  return parsed.success ? { ok: true, approach: parsed.data } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
export const isStandardApproach = (a: Pick<LearningApproachProfile, 'approachId'>): boolean => a.approachId === STANDARD_APPROACH_ID;

/**
 * What a response produced in a participation mode can be evidence OF. A collaborative activity yields a group
 * artefact; it is evidence about an individual learner only through an INDIVIDUAL component of it (an individual
 * defence, an individual follow-up task), and then only that component is. A contract for B3: nothing scores here.
 */
export const EVIDENCE_YIELDS = ['INDIVIDUAL_EVIDENCE', 'GROUP_ARTEFACT_ONLY'] as const;
export type EvidenceYield = (typeof EVIDENCE_YIELDS)[number];
export const evidenceYieldOf = (mode: ApproachParticipationMode): EvidenceYield => (mode === 'INDIVIDUAL' ? 'INDIVIDUAL_EVIDENCE' : 'GROUP_ARTEFACT_ONLY');

// ------------------------------------------------------------------------------------------------ the two approaches
export const STANDARD_APPROACH: LearningApproachProfile = {
  v: LEARNING_APPROACH_CONTRACT_VERSION, approachId: STANDARD_APPROACH_ID, version: '1', displayName: 'Standard', authority: 'STUDYUS_POLICY', status: 'PROVISIONAL', certification: null,
  statement: 'The default: no added emphasis. The curriculum is worked and shown the way each task family and each assessment profile already decide.',
  transversalCompetencies: [], preferences: [], participationModes: ['INDIVIDUAL'],
};

const proposed = (proposedCode: string): CompetencyReference => ({ catalogueStatus: 'NOT_YET_IN_CATALOGUE', proposedCode, toBeCreatedBy: 'CURRICULUM' });
/**
 * STEM_PLUS -- the first learning approach written against the contract. StudyUs policy, PROVISIONAL: its content
 * was drafted in-session and read by no STEM education specialist. Of its six competencies only SCIENTIFIC_INQUIRY
 * exists in the catalogue today (`dev.comp.scientific-inquiry`); the other five are referenced by proposed codes
 * and are for the Curriculum to create.
 */
export const STEM_PLUS_APPROACH: LearningApproachProfile = {
  v: LEARNING_APPROACH_CONTRACT_VERSION, approachId: 'STEM_PLUS', version: '0.1.0-provisional', displayName: 'STEM+', authority: 'STUDYUS_POLICY', status: 'PROVISIONAL', certification: null,
  statement: 'Knowledge is worked through inquiry, modelling, design and data, in situations, and is shown by reasoning that is made explicit. It changes how the curriculum is worked; it adds no content to it.',
  transversalCompetencies: [
    { key: 'SCIENTIFIC_INQUIRY', reference: { catalogueStatus: 'IN_CATALOGUE', code: 'dev.comp.scientific-inquiry' }, description: 'Asks a question that can be investigated, plans how to answer it and judges what the result supports.' },
    { key: 'MATHEMATICAL_MODELLING', reference: proposed('studyus.transversal.mathematical-modelling'), description: 'Turns a situation into mathematics, works the model and reads the result back into the situation, including its limits.' },
    { key: 'ENGINEERING_DESIGN', reference: proposed('studyus.transversal.engineering-design'), description: 'Designs a solution under criteria and constraints, tests it and improves it.' },
    { key: 'DATA_AND_COMPUTATIONAL_REASONING', reference: proposed('studyus.transversal.data-computational-reasoning'), description: 'Reads, organises and analyses data, and uses computation to answer a question about it.' },
    { key: 'PROBLEM_SOLVING_AND_TRANSFER', reference: proposed('studyus.transversal.problem-solving-transfer'), description: 'Uses what was learned in one situation to solve a problem in another that looks different.' },
    { key: 'SCIENTIFIC_COMMUNICATION_AND_ARGUMENTATION', reference: proposed('studyus.transversal.scientific-communication-argumentation'), description: 'States a claim, supports it with evidence and reasoning, and judges the claims of others.' },
  ],
  preferences: [
    { preferenceId: 'stem-plus.context.situated', dimension: 'context', prefer: ['SCIENTIFIC', 'SOCIETAL', 'OCCUPATIONAL', 'PERSONAL'], strength: 'REQUIRED_OUTSIDE_EXAMS', rationale: 'A task is set in a situation, scientific or societal first; a task with no situation does not fit the approach in the institution\'s own assessment.' },
    { preferenceId: 'stem-plus.response.constructed', dimension: 'responseFormat', prefer: ['EXTENDED_RESPONSE', 'SHORT_RESPONSE'], strength: 'PREFERRED', rationale: 'The learner produces the response, so that the reasoning can be seen.' },
    { preferenceId: 'stem-plus.reasoning.justified', dimension: 'reasoningDepth', prefer: ['JUSTIFIED_ARGUMENT', 'METHOD_SHOWN'], strength: 'PREFERRED', rationale: 'The learner justifies the result, or at least shows the method that produced it.' },
    { preferenceId: 'stem-plus.stimulus.data', dimension: 'stimulus', prefer: ['OWN_STIMULUS', 'SHARED_STIMULUS'], strength: 'PREFERRED', rationale: 'A task that can be asked about data or a representation is asked about one.' },
    { preferenceId: 'stem-plus.tools.available', dimension: 'toolPolicy', prefer: ['ALLOWED', 'SCIENTIFIC_REQUIRED', 'GDC_REQUIRED'], strength: 'PREFERRED', rationale: 'Realistic values are worked with a tool, so that the task is about the reasoning and not the arithmetic.' },
  ],
  participationModes: ['INDIVIDUAL', 'COLLABORATIVE'],
};

export const LEARNING_APPROACHES: readonly LearningApproachProfile[] = [STANDARD_APPROACH, STEM_PLUS_APPROACH];
export const learningApproachOf = (approachId: string): LearningApproachProfile | null => LEARNING_APPROACHES.find((a) => a.approachId === approachId) ?? null;
