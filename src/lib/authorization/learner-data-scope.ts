import type { LearnerReadScope } from './index';

/**
 * L10 SF-4 -- shaping of payloads that several relationships read. Pure:
 * the scope comes from `resolveLearnerReadScope`, and the facts in
 * `ResultViewContext` from ./learner-result-scope (server). Nothing here
 * decides who may read; it decides how much of an already-authorized payload
 * is returned.
 *
 * D-1 final rulings (L10-R1):
 *
 *  RELEASED. A Parent or Coordinator sees a result only when that SAME result
 *  is visible to the Student under the assessment's publication rules
 *  (`studentVisible`). It is not "scored and not invalidated": an invalidated
 *  result is still shown to the Student (flagged), and an attempt the Student
 *  removed from their history is not shown to them at all.
 *
 *  ITEM REVIEW. The per-question review exists in the view only when the
 *  attempt's frozen policy gives it to the Student (`reviewPolicy: 'FULL'`).
 *  Nobody but the owner receives it here: a Parent and a Coordinator never
 *  do, and a Teacher only for data inside their authorized subject -- and a
 *  review item carries nothing that attributes it to a subject, so it cannot
 *  be sliced and is withheld (fail closed).
 *
 *  TEACHER. Only a submitted attempt; only the slice that belongs to the
 *  canonical subject(s) of an authorized class the learner is enrolled in.
 *  What can be attributed -- objectives, through their published concepts --
 *  is returned for those subjects. What cannot -- overall and section scores
 *  of an exam, the item review -- is withheld, and `subjectScope` says so.
 */

export function isOwnerScope(scope: LearnerReadScope): boolean {
  return scope.relationships.includes('OWNER');
}

export interface ResultViewContext {
  /** The attempt's result is visible to the Student today (./learner-result-scope). */
  studentVisible: boolean;
  /** The attempt has been submitted (never a draft or an attempt in progress). */
  submitted: boolean;
  /**
   * For a Teacher: the canonical concepts of this view that belong to the
   * subject(s) the teacher is authorized for with this learner. Empty when
   * the teacher has no subject scope here or nothing in the view belongs to it.
   */
  teacherConceptIds: ReadonlySet<string>;
  /** The subjects that set was computed for (reported back to the caller). */
  teacherSubjectIds: readonly string[];
}

interface ObjectiveLike {
  concepts: Array<{ canonicalConceptId: string }>;
}

interface ResultViewLike {
  result: unknown | null;
  review: unknown[] | null;
  reviewPolicy: 'FULL' | 'SCORES_ONLY';
  objectives: ObjectiveLike[];
}

export interface SubjectScopeNote {
  canonicalSubjectIds: readonly string[];
  /** Overall / section scores of the exam cannot be attributed to one subject. */
  scores: 'WITHHELD';
  /** Review items carry no subject attribution. */
  itemReview: 'WITHHELD';
}

export type ShapedResultView<V> = V & { subjectScope?: SubjectScopeNote };

/**
 * The attempt result view for this scope, or null when nothing may be shown.
 * Precedence when an actor holds several relationships: owner, then the
 * whole-result summary of a Parent / Coordinator, then the Teacher's slice.
 */
export function shapeAttemptResultViewForScope<V extends ResultViewLike>(view: V, scope: LearnerReadScope, context: ResultViewContext): ShapedResultView<V> | null {
  if (isOwnerScope(scope)) return view;
  if (!scope.permissions.includes('LEARNER_ASSESSMENT_SUMMARY_VIEW')) return null;
  if (!context.submitted || !context.studentVisible || !view.result) return null;

  const summaryRelationship = scope.relationships.includes('PARENT') || scope.relationships.includes('COORDINATOR');
  if (summaryRelationship) return { ...view, review: null, reviewPolicy: 'SCORES_ONLY' };

  if (scope.relationships.includes('TEACHER')) {
    const objectives = view.objectives
      .map((o) => ({ ...o, concepts: o.concepts.filter((c) => context.teacherConceptIds.has(c.canonicalConceptId)) }))
      .filter((o) => o.concepts.length > 0);
    if (objectives.length === 0) return null; // nothing of this attempt is inside the teacher's subject
    return {
      ...view,
      result: null,
      objectives,
      review: null,
      reviewPolicy: 'SCORES_ONLY',
      subjectScope: { canonicalSubjectIds: context.teacherSubjectIds, scores: 'WITHHELD', itemReview: 'WITHHELD' },
    };
  }
  return null;
}
