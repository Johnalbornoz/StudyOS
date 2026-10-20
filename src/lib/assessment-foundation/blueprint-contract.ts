/**
 * B1 -- BlueprintRequirement / BlueprintResult: one contract for the three assessment families (pure).
 *
 * They EXTEND what exists; they do not replace it and they are not an engine:
 *   - LEARNING            the canonical engine's `ActivityContract` (pedagogical-engine) is the single-concept
 *                         case: `learningRequirementFromActivityContract` carries it over unchanged.
 *   - OFFICIAL_EXAM       the official blueprint's form positions (`FormPosition`, built from
 *                         `blueprint_objective_targets`) are the slots: `officialRequirementFromFormPositions`.
 *   - EXAM_PREPARATION    exam applicability + published gaps + goal + time; the policy that fills it is B2's.
 *
 * A requirement states constraints. Satisfying them (choosing questions, and therefore the resulting count
 * for LEARNING and EXAM_PREPARATION) is the shared solver's job in B2 -- nothing here selects, and there is
 * no count field a question store could own.
 *
 * Blueprint Engine V2 stays shadow-only; these contracts do not read or enable it.
 */
import { z } from 'zod';
import type { ActivityContract } from '@/lib/pedagogical-engine/types';
import type { AssembledForm, FormPosition } from '@/lib/exam-core/form-assembly';
import { SlotConstraintSchema } from '@/lib/exam-core/slot-constraints';
import { ASSESSMENT_FAMILIES } from './families';
import { QUESTION_STORES, type QuestionRef } from './question-coverage';

export const BLUEPRINT_CONTRACT_VERSION = 1 as const;

const ID = z.string().min(1).max(200);

const CurriculumScopeRefSchema = z.strictObject({ structureVersionId: ID, academicSubjectId: ID });

const PolicyRefSchema = z.strictObject({ id: z.string().min(1).max(120), version: z.string().min(1).max(120) });

/** What the assessment is about. Always canonical identities; never a learner concept id or a label. */
const TargetsSchema = z.strictObject({
  canonicalConceptIds: z.array(ID).default([]),
  learningObjectiveIds: z.array(ID).default([]),
});

/** LEARNING: evidence the activity must produce. Mirrors the canonical `ActivityContract`. */
const EvidenceNeedsSchema = z.strictObject({
  activityType: z.string().min(1).max(60),
  /** The engine's own range for a single-concept activity; null where the engine states none. */
  itemCount: z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) }).nullable(),
  independence: z.boolean(),
  supportLevel: z.enum(['ASSISTED', 'NONE']),
  minimumScorePercent: z.number().min(0).max(100).nullable(),
  evidenceContract: z.string().min(1).max(200),
  novelItemsRequired: z.boolean().default(false),
});

const DifficultySchema = z.strictObject({ min: z.number(), max: z.number(), target: z.number().nullable(), reasonCode: z.string().max(120).nullable().default(null) });

const DiversitySchema = z.strictObject({
  questionTypes: z.array(z.string().min(1)).default([]),
  maxPerTemplate: z.number().int().min(1).nullable().default(null),
});

const TimeSchema = z.strictObject({ availableMinutes: z.number().positive().nullable().default(null), officialMinutes: z.number().positive().nullable().default(null) });

const ExposureSchema = z.strictObject({ avoidSeenByStudent: z.boolean().default(true) });

/** EXAM_PREPARATION: where the emphasis may move. Inputs to a policy; never an instruction to place anything in Today. */
const EmphasisSchema = z.strictObject({
  objective: z.enum(['CLOSE_GAPS', 'SECTION_PRACTICE', 'TIMED_PREPARATION', 'COVERAGE']),
  gapConceptIds: z.array(ID).default([]),
  gapObjectiveIds: z.array(ID).default([]),
  /** Explicit: preparation is allowed to depart from the official distribution. */
  mayDeviateFromOfficialDistribution: z.literal(true),
});

const OfficialSlotSchema = z.strictObject({
  index: z.number().int().min(0),
  blueprintObjectiveTargetId: ID,
  assessmentComponentId: ID,
  learningObjectiveId: ID.nullable(),
  questionType: z.string().nullable(),
  difficultyRange: z.strictObject({ min: z.number(), max: z.number() }).nullable(),
  constraints: z.array(SlotConstraintSchema).default([]),
});

/** OFFICIAL_EXAM: the verified structure that must be reproduced. */
const OfficialFidelitySchema = z.strictObject({
  examVersionId: ID,
  blueprintId: ID.nullable(),
  slots: z.array(OfficialSlotSchema).min(1),
  /** An official form is selected once and frozen before the attempt starts. */
  frozenSelectionRequired: z.literal(true),
  /** Official mocks never adapt to the learner. */
  adaptsToLearner: z.literal(false),
});

export const BlueprintRequirementSchema = z
  .strictObject({
    v: z.literal(BLUEPRINT_CONTRACT_VERSION),
    family: z.enum(ASSESSMENT_FAMILIES),
    policy: PolicyRefSchema,
    studentId: ID,
    curriculum: z.array(CurriculumScopeRefSchema).default([]),
    exam: z.strictObject({ examTargetId: ID.nullable(), examVersionId: ID, assessmentComponentIds: z.array(ID).default([]) }).nullable().default(null),
    targets: TargetsSchema,
    evidence: EvidenceNeedsSchema.nullable().default(null),
    difficulty: DifficultySchema.nullable().default(null),
    diversity: DiversitySchema.nullable().default(null),
    time: TimeSchema.nullable().default(null),
    exposure: ExposureSchema.nullable().default(null),
    emphasis: EmphasisSchema.nullable().default(null),
    official: OfficialFidelitySchema.nullable().default(null),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (r.family === 'OFFICIAL_EXAM') {
      if (!r.official) issue('OFFICIAL_EXAM requires the official fidelity block');
      if (!r.exam) issue('OFFICIAL_EXAM requires an exam version');
      if (r.official && r.exam && r.official.examVersionId !== r.exam.examVersionId) issue('official.examVersionId must be the requirement exam version');
      // The structure is the blueprint's: nothing learner-driven may shape an official form.
      if (r.emphasis) issue('OFFICIAL_EXAM cannot carry adaptive emphasis');
      if (r.evidence) issue('OFFICIAL_EXAM cannot carry learner evidence needs');
      if (r.targets.canonicalConceptIds.length > 0 || r.targets.learningObjectiveIds.length > 0) issue('OFFICIAL_EXAM takes no learner-chosen targets');
    }
    if (r.family === 'EXAM_PREPARATION') {
      if (!r.exam) issue('EXAM_PREPARATION requires an exam version (applicability still holds)');
      if (r.official) issue('EXAM_PREPARATION is not an official form');
    }
    if (r.family === 'LEARNING') {
      if (r.official) issue('LEARNING is not an official form');
      if (r.emphasis) issue('LEARNING does not use exam-preparation emphasis');
      if (!r.evidence) issue('LEARNING requires evidence needs');
      if (r.targets.canonicalConceptIds.length === 0 && r.targets.learningObjectiveIds.length === 0) issue('LEARNING requires at least one canonical target');
    }
  });

export type BlueprintRequirement = z.infer<typeof BlueprintRequirementSchema>;
export type BlueprintRequirementInput = z.input<typeof BlueprintRequirementSchema>;

export function parseBlueprintRequirement(input: unknown): { ok: true; requirement: BlueprintRequirement } | { ok: false; issues: string[] } {
  const r = BlueprintRequirementSchema.safeParse(input);
  return r.success ? { ok: true, requirement: r.data } : { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/* ------------------------------------------------------------------ */
/* Adapters from the existing authorities                               */
/* ------------------------------------------------------------------ */

/**
 * LEARNING, single concept: the canonical engine's activity contract as a requirement. Count, difficulty,
 * independence and the pass bar are the engine's, copied verbatim -- nothing is decided here.
 */
export function learningRequirementFromActivityContract(p: {
  studentId: string;
  canonicalConceptId: string;
  contract: ActivityContract;
  policy: { id: string; version: string };
  curriculum?: Array<{ structureVersionId: string; academicSubjectId: string }>;
}): BlueprintRequirement {
  return BlueprintRequirementSchema.parse({
    v: BLUEPRINT_CONTRACT_VERSION,
    family: 'LEARNING',
    policy: p.policy,
    studentId: p.studentId,
    curriculum: p.curriculum ?? [],
    targets: { canonicalConceptIds: [p.canonicalConceptId], learningObjectiveIds: [] },
    evidence: {
      activityType: p.contract.activityType,
      itemCount: p.contract.itemCount ? { min: p.contract.itemCount.min, max: p.contract.itemCount.max } : null,
      independence: p.contract.independence,
      supportLevel: p.contract.supportLevel,
      minimumScorePercent: p.contract.minimumScorePercent,
      evidenceContract: p.contract.evidenceContract,
      novelItemsRequired: p.contract.noveltyRequirements === 'NOVEL_ITEMS_REQUIRED',
    },
    difficulty: { min: p.contract.difficulty.min, max: p.contract.difficulty.max, target: p.contract.difficulty.target, reasonCode: p.contract.difficulty.reasonCode },
  } satisfies BlueprintRequirementInput);
}

/** OFFICIAL_EXAM: the blueprint's positions as the slots to reproduce. One slot per position; nothing is added or dropped. */
export function officialRequirementFromFormPositions(p: {
  studentId: string;
  examTargetId: string | null;
  examVersionId: string;
  blueprintId: string | null;
  positions: readonly FormPosition[];
  policy: { id: string; version: string };
  officialMinutes?: number | null;
}): BlueprintRequirement {
  return BlueprintRequirementSchema.parse({
    v: BLUEPRINT_CONTRACT_VERSION,
    family: 'OFFICIAL_EXAM',
    policy: p.policy,
    studentId: p.studentId,
    exam: { examTargetId: p.examTargetId, examVersionId: p.examVersionId, assessmentComponentIds: [...new Set(p.positions.map((x) => x.assessmentComponentId))] },
    targets: { canonicalConceptIds: [], learningObjectiveIds: [] },
    time: p.officialMinutes ? { availableMinutes: null, officialMinutes: p.officialMinutes } : null,
    official: {
      examVersionId: p.examVersionId,
      blueprintId: p.blueprintId,
      slots: p.positions.map((x) => ({
        index: x.index,
        blueprintObjectiveTargetId: x.blueprintObjectiveTargetId,
        assessmentComponentId: x.assessmentComponentId,
        learningObjectiveId: x.learningObjectiveId,
        questionType: x.questionType,
        difficultyRange: x.difficultyRange,
        constraints: x.constraints ?? [],
      })),
      frozenSelectionRequired: true,
      adaptsToLearner: false,
    },
  } satisfies BlueprintRequirementInput);
}

/* ------------------------------------------------------------------ */
/* Result                                                               */
/* ------------------------------------------------------------------ */

/**
 * READY                   every requirement is met.
 * PARTIAL                 a usable selection that leaves stated constraints unmet (each one listed).
 * INSUFFICIENT_COVERAGE   no acceptable selection exists with the eligible content.
 * An OFFICIAL_EXAM result is never PARTIAL: an official form is complete or it is not offered
 * (the existing rule: `FORM_INCOMPLETE`).
 */
export const BLUEPRINT_RESULT_STATUSES = ['READY', 'PARTIAL', 'INSUFFICIENT_COVERAGE'] as const;
export type BlueprintResultStatus = (typeof BLUEPRINT_RESULT_STATUSES)[number];

const QuestionRefSchema = z.strictObject({ store: z.enum(QUESTION_STORES), id: ID });

export const BlueprintResultSchema = z
  .strictObject({
    v: z.literal(BLUEPRINT_CONTRACT_VERSION),
    family: z.enum(ASSESSMENT_FAMILIES),
    status: z.enum(BLUEPRINT_RESULT_STATUSES),
    policy: PolicyRefSchema,
    selected: z.array(z.strictObject({ question: QuestionRefSchema, slotIndex: z.number().int().min(0).nullable().default(null), marks: z.number().nullable().default(null) })),
    coverage: z.strictObject({ canonicalConceptIds: z.array(ID).default([]), learningObjectiveIds: z.array(ID).default([]), percent: z.number().min(0).max(100).nullable().default(null) }),
    unmet: z.array(z.strictObject({ constraint: z.string().min(1).max(80), detail: z.string().max(300).default('') })).default([]),
    estimate: z.strictObject({ items: z.number().int().min(0), marks: z.number().nullable().default(null), minutes: z.number().nullable().default(null) }),
    rationale: z.array(z.string().max(300)).default([]),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (r.status === 'READY' && r.unmet.length > 0) issue('READY cannot list unmet constraints');
    if (r.status !== 'READY' && r.unmet.length === 0) issue(`${r.status} must list what is unmet`);
    if (r.family === 'OFFICIAL_EXAM') {
      if (r.status === 'PARTIAL') issue('an official form is never partial');
      // Official content is reviewed-bank content only; a generated / cached item can never be in an official form.
      if (r.selected.some((s) => s.question.store !== 'REVIEWED_EXAM_BANK')) issue('OFFICIAL_EXAM may only select reviewed-bank questions');
    }
    if (r.estimate.items !== r.selected.length) issue('estimate.items must equal the number of selected questions');
  });

export type BlueprintResult = z.infer<typeof BlueprintResultSchema>;
export type BlueprintResultInput = z.input<typeof BlueprintResultSchema>;

export function parseBlueprintResult(input: unknown): { ok: true; result: BlueprintResult } | { ok: false; issues: string[] } {
  const r = BlueprintResultSchema.safeParse(input);
  return r.success ? { ok: true, result: r.data } : { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/**
 * The existing official assembly output as a result. Only a complete form is READY; a form with any unfilled
 * position is INSUFFICIENT_COVERAGE for an official exam (never PARTIAL), with every shortage listed.
 */
export function officialResultFromAssembledForm(form: AssembledForm, policy: { id: string; version: string }): BlueprintResult {
  const filled = form.slots.filter((s) => s.approvedItemId);
  const complete = filled.length === form.slots.length && form.slots.length > 0;
  const selected = complete ? filled.map((s) => ({ question: { store: 'REVIEWED_EXAM_BANK', id: s.approvedItemId! } satisfies QuestionRef, slotIndex: s.index, marks: s.marks })) : [];
  return BlueprintResultSchema.parse({
    v: BLUEPRINT_CONTRACT_VERSION,
    family: 'OFFICIAL_EXAM',
    status: complete ? 'READY' : 'INSUFFICIENT_COVERAGE',
    policy,
    selected,
    coverage: { canonicalConceptIds: [], learningObjectiveIds: [], percent: form.coveragePercent },
    unmet: complete ? [] : [{ constraint: 'OFFICIAL_SLOTS_FILLED', detail: `${filled.length} of ${form.slots.length} positions have an eligible item` }],
    estimate: { items: selected.length, marks: complete ? filled.reduce((n, s) => n + s.marks, 0) : null, minutes: null },
    rationale: [...form.notes],
  } satisfies BlueprintResultInput);
}
