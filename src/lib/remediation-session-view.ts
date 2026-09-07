/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-B1: the ONE server-side read boundary for the Remediation
 * Session Shell (`/dashboard/remediation/[pathId]`). Presentation +
 * navigation only -- it decides NOTHING: not the remediation pattern,
 * not which step is active, not how much support is needed, not
 * whether the learner is independent. Every one of those already has
 * a canonical owner (remediation.service.ts / adaptive-teaching-
 * policy.ts / activity-taxonomy.ts); this file only reads their output
 * and maps it into one bounded view object.
 *
 * Deliberately does NOT reconstruct a fresh Phase 4 LearningDecision
 * (getLearningDecisions) to source "why" facts -- that call chain
 * (via getActiveDebts -> ensureConceptLocalizations) performs a
 * background write, and Step 6L-B0/this step's own audit found no
 * safe way to get a WhyThisV3-shaped LearningFact[] without it. The
 * "why" shown here instead comes from the remediation path's own
 * ALREADY-PERSISTED `pattern` (set once, at start, by
 * determineRemediationPattern -- never re-decided here), which is
 * canonical and read-only.
 *
 * `getTeachingIntentForConcept` IS used for the support-level/
 * misconception-context signal (Section 5's explicit requirement):
 * this is the SAME call `explain/generate` and `quizzes/hint` already
 * make live, on every request, in production today -- calling it once
 * more here is not a new category of side effect, and it is wrapped
 * in `.catch(() => null)` so a failure degrades to "no support
 * information available" rather than breaking the page.
 */
import { db } from '@/lib/db';
import {
  getRemediationPath,
  remediationStepHref,
  type RemediationPathState,
  type RemediationPattern,
  type RemediationStepType,
  type RemediationStepStatus,
} from '@/services/remediation.service';
import { getTeachingIntentForConcept } from '@/services/adaptive-teaching.service';
import type { SupportLevel } from '@/lib/adaptive-teaching-policy';

export interface RemediationSessionStepView {
  readonly stepType: RemediationStepType;
  readonly status: RemediationStepStatus;
}

export type RemediationSessionViewResult =
  | { readonly status: 'NOT_FOUND' }
  | {
      readonly status: 'TERMINAL';
      readonly pathState: RemediationPathState;
      /** LX-5F: the journey this intervention was repairing -- for the continuation checkpoint. `null` if the concept row is gone. */
      readonly conceptId: string | null;
      readonly subjectId: string | null;
    }
  | {
      readonly status: 'ACTIVE';
      readonly pathId: string;
      readonly conceptId: string;
      readonly conceptLabel: string;
      readonly subjectId: string;
      readonly pattern: RemediationPattern;
      readonly steps: readonly RemediationSessionStepView[];
      readonly activeStepIndex: number;
      readonly currentStepType: RemediationStepType;
      readonly activityHref: string;
      /** null when Phase 4 has no active decision for this concept right now (e.g. it changed between path creation and this read) -- never fabricated. */
      readonly supportLevel: SupportLevel | null;
      readonly hasMisconceptionContext: boolean;
    };

/**
 * `preferredLanguage` only affects the concept LABEL's localization
 * lookup (same convention as concept-detail/today pages) -- it never
 * changes which step, pattern, or support level is returned.
 */
export async function getRemediationSessionView(
  studentId: string,
  pathId: string,
  preferredLanguage: string
): Promise<RemediationSessionViewResult> {
  const path = await getRemediationPath(pathId);
  // Never distinguish "path exists but belongs to someone else" from
  // "path does not exist" in the response -- both fail the same way,
  // so a guessed pathId can never confirm another student's remediation
  // history exists (Section 24).
  if (!path || path.studentId !== studentId) return { status: 'NOT_FOUND' };

  // LX-5F: resolve the repaired concept up front so a TERMINAL result
  // can carry it for the continuation checkpoint. `cl.description` is
  // never read (LX-3P-R1) -- label only.
  const conceptRow = await db.query(
    `SELECT c.subject_id, COALESCE(cl.label, c.canonical_id) AS label
     FROM concepts c
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
     WHERE c.id = $1`,
    [path.rootCauseConceptId, preferredLanguage]
  );
  const conceptRowData = conceptRow.rows[0];

  if (path.state === 'RESOLVED' || path.state === 'REJECTED') {
    return {
      status: 'TERMINAL',
      pathState: path.state,
      conceptId: conceptRowData ? path.rootCauseConceptId : null,
      subjectId: conceptRowData?.subject_id ?? null,
    };
  }

  const activeStepIndex = path.steps.findIndex((s) => s.status === 'active');
  const activeStep = activeStepIndex >= 0 ? path.steps[activeStepIndex] : null;
  // Defensive: a non-terminal path state with no active step is an
  // inconsistent/mid-transition read (e.g. a race with
  // completeRemediationStep) -- never crash or fabricate a step; treat
  // it the same as a terminal path so the shell fails safe.
  if (!activeStep) {
    return {
      status: 'TERMINAL',
      pathState: path.state,
      conceptId: conceptRowData ? path.rootCauseConceptId : null,
      subjectId: conceptRowData?.subject_id ?? null,
    };
  }

  if (!conceptRowData) return { status: 'NOT_FOUND' };

  const activityHref = remediationStepHref(activeStep, { id: path.id, subjectId: conceptRowData.subject_id });

  // See file header: same call explain/generate and quizzes/hint
  // already make live; degrades to null (never fabricated) on any
  // failure or when Phase 4 currently has no active decision here.
  const intent = await getTeachingIntentForConcept(studentId, path.rootCauseConceptId).catch(() => null);

  return {
    status: 'ACTIVE',
    pathId: path.id,
    conceptId: path.rootCauseConceptId,
    conceptLabel: conceptRowData.label,
    subjectId: conceptRowData.subject_id,
    pattern: path.pattern,
    steps: path.steps.map((s) => ({ stepType: s.stepType, status: s.status })),
    activeStepIndex,
    currentStepType: activeStep.stepType,
    activityHref,
    supportLevel: intent?.supportLevel ?? null,
    hasMisconceptionContext: (intent?.misconceptionCodes.length ?? 0) > 0,
  };
}
