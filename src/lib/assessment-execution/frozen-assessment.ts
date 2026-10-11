/**
 * B3 -- FrozenAssessment: what an assessment MEANT when it was generated (pure contract, no IO).
 *
 * B2 decides what to assess (`BlueprintSolution`). This freezes that decision into the one record an
 * attempt executes from. After freezing, nothing re-selects: a later change to the question bank, the
 * curriculum mappings, the Student's knowledge state or a policy cannot change which questions the attempt
 * serves or what each of them was expected to give evidence about.
 *
 * It stores references plus the minimum semantics needed to read the attempt later:
 *   - each selected question by reference, in its frozen order (and its official slot, when it has one);
 *   - the coverage that question had AT SELECTION TIME (canonical concept, role, basis) -- the facts
 *     evidence attribution uses, so attribution never depends on what the bank says afterwards;
 *   - what the blueprint intended each question to contribute (B2 `contributes` / `dedicatedTo`);
 *   - the policy, depth, activity, curriculum and exam context it was built under;
 *   - what the blueprint could not satisfy.
 * It does not copy question content, the curriculum or the Student's state.
 *
 * `snapshotId` is a digest of the content: an edited snapshot no longer verifies.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { ASSESSMENT_FAMILIES, ASSESSMENT_PATHS, FAMILY_OF_PATH, type AssessmentPath } from '@/lib/assessment-foundation/families';
import { QUESTION_STORES, questionRefKey, type QuestionCoverage, type QuestionRef } from '@/lib/assessment-foundation/question-coverage';
import type { BlueprintSolution } from '@/lib/assessment-blueprint/result';

export const FROZEN_ASSESSMENT_VERSION = 1 as const;

const ID = z.string().min(1).max(200);
const QuestionRefSchema = z.strictObject({ store: z.enum(QUESTION_STORES), id: ID });

const FrozenItemSchema = z.strictObject({
  /** Position the attempt serves it at. Frozen: no reordering after this. */
  order: z.number().int().min(0),
  key: ID,
  question: QuestionRefSchema,
  /** Official exam position; null elsewhere. */
  slotIndex: z.number().int().min(0).nullable(),
  provenance: z.enum(['OFFICIAL', 'LICENSED', 'STUDYUS_GENERATED', 'FIXTURE', 'GENERATED_UNREVIEWED']),
  learningObjectiveIds: z.array(ID),
  /** Coverage at selection time. Canonical identities only (B1): what attribution reads. */
  coverage: z.array(z.strictObject({ canonicalConceptId: ID, role: z.enum(['PRIMARY', 'SUPPORTING', 'UNSPECIFIED']), basis: z.enum(['ITEM_ATTRIBUTION', 'OBJECTIVE_MAPPING', 'LEARNER_CONCEPT_LINK']) })),
  /** Recorded facts, or null when the source does not record them. Never a default. */
  difficulty: z.number().nullable(),
  marks: z.number().nullable(),
  estimatedSeconds: z.number().nullable(),
  questionType: z.string().max(80).nullable(),
  /** What the blueprint expected this question to contribute (planning metadata; not an evidence weight). */
  intended: z.array(z.strictObject({ targetKey: ID, strength: z.enum(['DIRECT', 'SUPPORTING', 'DERIVED']), counted: z.array(z.enum(['OPPORTUNITY', 'DIRECT', 'INDEPENDENT'])) })),
  dedicatedTo: ID.nullable(),
  reasons: z.array(z.string().max(80)),
});

export const FrozenAssessmentSchema = z.strictObject({
  v: z.literal(FROZEN_ASSESSMENT_VERSION),
  snapshotId: z.string().regex(/^[0-9a-f]{32}$/),
  /** Explicit generation time (ISO). The freeze never reads a clock. */
  createdAt: z.string().min(1),
  family: z.enum(ASSESSMENT_FAMILIES),
  path: z.enum(ASSESSMENT_PATHS),
  /** The assessment intent the policy was asked for (a B2 learning intent / preparation objective). */
  intent: z.string().max(60).nullable(),
  contentAudience: z.enum(['STUDENT', 'TECHNICAL_DEMO']),
  studentId: ID,
  policy: z.strictObject({ id: ID, version: ID }),
  depth: z.string().max(20).nullable(),
  /**
   * LEARNING only: the activity the session runs as, fixed server-side at generation from the existing
   * registries (quiz mode -> ActivityType -> EvidenceMode, quiz mode -> evidence source). null for exam families.
   */
  activity: z.strictObject({ quizMode: z.string().max(40), activityType: z.string().max(40), evidenceMode: z.enum(['PRACTICE', 'INDEPENDENT', 'ASSESSMENT']), evidenceSource: z.string().max(40) }).nullable(),
  curriculum: z.array(z.strictObject({ structureVersionId: ID, academicSubjectId: ID })),
  exam: z.strictObject({ examTargetId: ID.nullable(), examVersionId: ID, assessmentComponentIds: z.array(ID) }).nullable(),
  /** INTENDED coverage: what the blueprint set out to assess. */
  targets: z.strictObject({ canonicalConceptIds: z.array(ID), learningObjectiveIds: z.array(ID) }),
  items: z.array(FrozenItemSchema).min(1),
  blueprint: z.strictObject({
    status: z.enum(['READY', 'PARTIAL', 'INSUFFICIENT_COVERAGE']),
    unmet: z.array(z.strictObject({ subject: ID, requirement: z.string().max(40), missing: z.number().int(), cause: z.string().max(60) })),
    softShortfalls: z.array(z.strictObject({ preference: z.string().max(60), wanted: z.number(), reached: z.number() })),
    candidates: z.strictObject({ count: z.number().int().min(0), digest: z.string().max(64) }),
    /** Identifies the learner evidence the policy read; the evidence itself is not copied. */
    learnerEvidence: z.strictObject({ digest: z.string().max(64), asOf: z.string().nullable() }).nullable(),
  }),
});

export type FrozenAssessment = z.infer<typeof FrozenAssessmentSchema>;
export type FrozenItem = FrozenAssessment['items'][number];
export type FrozenActivity = NonNullable<FrozenAssessment['activity']>;

const knownOrNull = <T>(k: { state: string; value?: T }): T | null => (k.state === 'KNOWN' ? (k.value as T) : null);

function digestOf(content: Omit<FrozenAssessment, 'snapshotId'>): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 32);
}

export interface FreezeInput {
  solution: BlueprintSolution;
  /** Coverage of (at least) every selected question, as it was when the solver ran. */
  coverages: readonly QuestionCoverage[];
  studentId: string;
  createdAt: string;
  path: AssessmentPath;
  intent?: string | null;
  activity?: FrozenActivity | null;
  exam?: FrozenAssessment['exam'];
  contentAudience?: 'STUDENT' | 'TECHNICAL_DEMO';
}

export type FreezeRefusal = 'PATH_FAMILY_MISMATCH' | 'NOTHING_SELECTED' | 'OFFICIAL_FORM_INCOMPLETE' | 'EXAM_CONTEXT_REQUIRED' | 'ACTIVITY_REQUIRED' | 'COVERAGE_MISSING_FOR_SELECTED';

export class FreezeError extends Error {
  constructor(public readonly code: FreezeRefusal, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** Freezes one B2 solution. Deterministic: the same input gives the same snapshot and the same id. */
export function freezeAssessment(input: FreezeInput): FrozenAssessment {
  const { solution } = input;
  if (FAMILY_OF_PATH[input.path] !== solution.family) throw new FreezeError('PATH_FAMILY_MISMATCH', `${input.path} is not a ${solution.family} path`);
  if (solution.outcome.selected.length === 0) throw new FreezeError('NOTHING_SELECTED');
  // An official form is all of its positions or it is not an official form (B1 / B2).
  if (solution.family === 'OFFICIAL_EXAM' && solution.outcome.status !== 'READY') throw new FreezeError('OFFICIAL_FORM_INCOMPLETE');
  if (solution.family !== 'LEARNING' && !input.exam) throw new FreezeError('EXAM_CONTEXT_REQUIRED');
  if (solution.family === 'LEARNING' && !input.activity) throw new FreezeError('ACTIVITY_REQUIRED');

  const coverageByKey = new Map(input.coverages.map((c) => [questionRefKey(c.ref), c]));
  const ordered = [...solution.outcome.selected].sort((a, b) => (a.slotIndex ?? a.order) - (b.slotIndex ?? b.order) || a.order - b.order);
  const items: FrozenItem[] = ordered.map((s, order) => {
    const coverage = coverageByKey.get(s.key);
    if (!coverage) throw new FreezeError('COVERAGE_MISSING_FOR_SELECTED', s.key);
    return {
      order,
      key: s.key,
      question: { store: s.question.store, id: s.question.id },
      slotIndex: s.slotIndex,
      provenance: coverage.provenance,
      learningObjectiveIds: [...(knownOrNull<string[]>(coverage.learningObjectiveIds) ?? [])].sort(),
      coverage: coverage.concepts.map((c) => ({ canonicalConceptId: c.canonicalConceptId, role: c.role, basis: c.basis })).sort((a, b) => a.canonicalConceptId.localeCompare(b.canonicalConceptId)),
      difficulty: knownOrNull<number>(coverage.difficulty),
      marks: knownOrNull<number>(coverage.marks),
      estimatedSeconds: knownOrNull<number>(coverage.estimatedSeconds),
      questionType: knownOrNull<string>(coverage.questionType),
      intended: s.contributes.map((c) => ({ targetKey: c.targetKey, strength: c.strength, counted: [...c.counted] })),
      dedicatedTo: s.dedicatedTo,
      reasons: [...s.reasons],
    };
  });

  const targets = solution.plan.mode === 'TARGETS' ? solution.plan.targets : [];
  const content: Omit<FrozenAssessment, 'snapshotId'> = {
    v: FROZEN_ASSESSMENT_VERSION,
    createdAt: input.createdAt,
    family: solution.family,
    path: input.path,
    intent: input.intent ?? null,
    contentAudience: input.contentAudience ?? 'STUDENT',
    studentId: input.studentId,
    policy: { id: solution.snapshot.policy.id, version: solution.snapshot.policy.version },
    depth: solution.snapshot.depth,
    activity: solution.family === 'LEARNING' ? input.activity ?? null : null,
    curriculum: solution.snapshot.curriculum.map((c) => ({ structureVersionId: c.structureVersionId, academicSubjectId: c.academicSubjectId })),
    exam: solution.family === 'LEARNING' ? null : input.exam ?? null,
    targets: {
      canonicalConceptIds: targets.filter((t) => t.kind === 'CONCEPT').map((t) => t.id).sort(),
      // an official form's intended objectives are the objectives of its positions
      learningObjectiveIds: (solution.plan.mode === 'SLOTS' ? solution.plan.slots.map((s) => s.learningObjectiveId).filter((x): x is string => !!x) : targets.filter((t) => t.kind === 'OBJECTIVE').map((t) => t.id)).filter((id, i, all) => all.indexOf(id) === i).sort(),
    },
    items,
    blueprint: {
      status: solution.outcome.status,
      unmet: solution.outcome.unmet.map((u) => ({ subject: u.subject, requirement: u.requirement, missing: u.missing, cause: u.cause })),
      softShortfalls: solution.outcome.softShortfalls.map((s) => ({ preference: s.preference, wanted: s.wanted, reached: s.reached })),
      candidates: { count: solution.snapshot.candidates.count, digest: solution.snapshot.candidates.digest },
      learnerEvidence: solution.snapshot.learnerEvidence ? { digest: solution.snapshot.learnerEvidence.digest, asOf: solution.snapshot.learnerEvidence.asOf } : null,
    },
  };
  return FrozenAssessmentSchema.parse({ ...content, snapshotId: digestOf(content) });
}

export type SnapshotIssue = 'MALFORMED' | 'DIGEST_MISMATCH';

/** Reads a stored snapshot. A malformed or edited one is refused: an attempt never runs on a reinterpreted assessment. */
export function readFrozenAssessment(raw: unknown): { ok: true; frozen: FrozenAssessment } | { ok: false; issue: SnapshotIssue } {
  const parsed = FrozenAssessmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issue: 'MALFORMED' };
  const { snapshotId, ...content } = parsed.data;
  return digestOf(content) === snapshotId ? { ok: true, frozen: parsed.data } : { ok: false, issue: 'DIGEST_MISMATCH' };
}

/** The exact questions an attempt serves, in order. The ONLY source of an attempt's content. */
export const executionRefs = (frozen: FrozenAssessment): Array<{ order: number; slotIndex: number | null; question: QuestionRef }> =>
  frozen.items.map((i) => ({ order: i.order, slotIndex: i.slotIndex, question: { ...i.question } }));

export const frozenItem = (frozen: FrozenAssessment, key: string): FrozenItem | null => frozen.items.find((i) => i.key === key) ?? null;
