/**
 * B1 -- GeneratedAssessmentSnapshot: the auditable description of an assessment that was generated for a
 * Student (pure read projections; no new storage).
 *
 *   OFFICIAL_EXAM / exam practice   REUSED: the existing frozen record -- `exam_instances.form`
 *                                    (`form_frozen_at`) + the attempt's `frozen_configuration`. This module
 *                                    only projects it; there is no second exam-instance system.
 *   LEARNING                         EXTENDED from what a quiz session already persists
 *                                    (`quiz_sessions.canonical_activity_contract`, policy version, stage,
 *                                    concept ids, the delivered questions). Fields a session does not record
 *                                    are UNKNOWN.
 *
 * Persistence of the additional fields (family policy id, intended coverage, selection rationale) for
 * LEARNING / EXAM_PREPARATION is DEFERRED to B2/B3, when a solver exists to produce them: writing them now
 * would record values nothing computes. Historical sessions and attempts stay readable as they are.
 */
import type { AssembledForm } from '@/lib/exam-core/form-assembly';
import { assessmentPathOf } from '@/lib/simulation/preparation-simulation';
import { FAMILY_OF_PATH, type AssessmentFamily, type AssessmentPath } from './families';
import { known, knownOrUnknown, NOT_APPLICABLE, UNKNOWN, type Known } from './known';
import type { QuestionRef } from './question-coverage';

export const GENERATED_ASSESSMENT_SNAPSHOT_VERSION = 1 as const;

export interface GeneratedAssessmentSnapshot {
  v: typeof GENERATED_ASSESSMENT_SNAPSHOT_VERSION;
  family: AssessmentFamily;
  path: AssessmentPath;
  /** Where the record of truth lives. The snapshot is a view of it, never a copy to be edited. */
  record: { kind: 'EXAM_INSTANCE'; id: string } | { kind: 'QUIZ_SESSION'; id: string };
  studentId: string;
  /** Was the selection fixed before the attempt started? */
  frozen: boolean;
  frozenAt: Known<string>;
  policy: Known<{ id: string; version: string }>;
  exam: Known<{ examVersionId: string; examTargetId: string | null; assessmentComponentIds: string[] }>;
  /** Canonical targets the assessment was built for. */
  targets: { canonicalConceptIds: Known<string[]>; learningObjectiveIds: Known<string[]>; learnerConceptIds: Known<string[]> };
  /** Selected questions by reference, where the record identifies them. */
  selected: Known<Array<{ question: QuestionRef; slotIndex: number | null }>>;
  itemCount: Known<number>;
  estimatedMinutes: Known<number>;
  /** Selection rationale / metadata the record carries. */
  rationale: Known<string[]>;
}

export interface ExamInstanceSnapshotRow {
  id: string;
  studentId: string;
  examProfileId: string | null;
  examVersionId: string;
  componentIds: string[] | null;
  mode: string;
  form: AssembledForm | null;
  formFrozenAt: string | Date | null;
  focusObjectiveIds: string[] | null;
}

const isoOf = (v: string | Date | null | undefined): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/** REUSE: the frozen exam instance, projected. An instance with no frozen form is described as not frozen. */
export function snapshotFromExamInstance(row: ExamInstanceSnapshotRow): GeneratedAssessmentSnapshot {
  const frozenAt = isoOf(row.formFrozenAt);
  // The instance is read by its own facts (mode, frozen form, the form's recorded length fidelity): this is
  // also how a historical instance, whose attempt was stored as FULL_MOCK whatever its mode, is described.
  const path = assessmentPathOf({ simulationType: null, instanceMode: row.mode, formFrozen: !!(row.form && frozenAt), formFidelity: row.form?.fidelity ?? null });
  const slots = row.form?.slots ?? null;
  return {
    v: GENERATED_ASSESSMENT_SNAPSHOT_VERSION,
    family: FAMILY_OF_PATH[path],
    path,
    record: { kind: 'EXAM_INSTANCE', id: row.id },
    studentId: row.studentId,
    frozen: !!(row.form && frozenAt),
    frozenAt: knownOrUnknown(frozenAt),
    // The official blueprint of the version is the policy; its identity is the exam version itself.
    policy: known({ id: 'official-blueprint', version: row.examVersionId }),
    exam: known({ examVersionId: row.examVersionId, examTargetId: row.examProfileId ?? null, assessmentComponentIds: row.componentIds ?? [] }),
    targets: {
      canonicalConceptIds: NOT_APPLICABLE,
      learningObjectiveIds: row.focusObjectiveIds && row.focusObjectiveIds.length > 0 ? known([...row.focusObjectiveIds]) : NOT_APPLICABLE,
      learnerConceptIds: NOT_APPLICABLE,
    },
    selected: slots ? known(slots.filter((s) => s.approvedItemId).map((s) => ({ question: { store: 'REVIEWED_EXAM_BANK' as const, id: s.approvedItemId! }, slotIndex: s.index }))) : UNKNOWN,
    itemCount: slots ? known(slots.length) : UNKNOWN,
    estimatedMinutes: UNKNOWN,
    rationale: row.form ? known([...row.form.notes]) : UNKNOWN,
  };
}

export interface QuizSessionSnapshotRow {
  id: string;
  studentId: string;
  conceptId: string | null;
  conceptIds: string[] | null;
  questions: unknown;
  pedagogicalPolicyVersion: string | null;
  canonicalStage: string | null;
  canonicalActivityContract: unknown;
  deliverySource: string | null;
  createdAt: string | Date | null;
}

/**
 * EXTEND: what a quiz session already records, as a snapshot. A session is created with its questions, so it
 * is frozen from creation. A legacy session without a canonical contract reports its policy as UNKNOWN --
 * nothing is reconstructed for it.
 */
export function snapshotFromQuizSession(row: QuizSessionSnapshotRow, canonicalConceptIds: readonly string[] | null = null): GeneratedAssessmentSnapshot {
  const questions = Array.isArray(row.questions) ? row.questions : null;
  const learner = [...new Set([row.conceptId, ...(row.conceptIds ?? [])].filter((x): x is string => !!x))];
  const rationale: string[] = [];
  if (row.canonicalStage) rationale.push(`canonical_stage:${row.canonicalStage}`);
  if (row.deliverySource) rationale.push(`delivery_source:${row.deliverySource}`);
  return {
    v: GENERATED_ASSESSMENT_SNAPSHOT_VERSION,
    family: 'LEARNING',
    path: 'LEARNING_ACTIVITY',
    record: { kind: 'QUIZ_SESSION', id: row.id },
    studentId: row.studentId,
    frozen: questions !== null,
    frozenAt: knownOrUnknown(isoOf(row.createdAt)),
    policy: row.canonicalActivityContract && row.pedagogicalPolicyVersion ? known({ id: 'canonical-pedagogical-policy', version: row.pedagogicalPolicyVersion }) : UNKNOWN,
    exam: NOT_APPLICABLE,
    targets: {
      // Canonical identity is resolved by the caller through the explicit learner-concept link; never guessed here.
      canonicalConceptIds: canonicalConceptIds ? known([...canonicalConceptIds]) : UNKNOWN,
      learningObjectiveIds: UNKNOWN,
      learnerConceptIds: learner.length > 0 ? known(learner) : UNKNOWN,
    },
    // A session stores the delivered questions inline; it does not reference cache rows by id.
    selected: UNKNOWN,
    itemCount: questions ? known(questions.length) : UNKNOWN,
    estimatedMinutes: UNKNOWN,
    rationale: rationale.length > 0 ? known(rationale) : UNKNOWN,
  };
}
