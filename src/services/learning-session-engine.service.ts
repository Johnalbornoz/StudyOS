/**
 * Phase 3D -- Session Engine. Converts one Phase 3C LearningDecision
 * into an executable launch target using the REAL existing student-
 * facing flow for that ActivityType -- generate-and-take's quizMode
 * table, the remediation step-continuation system, or the dedicated
 * Transfer route pair. It never selects a different intervention,
 * never changes ActivityType, never re-derives EvidenceMode by hand
 * (always evidenceModeForActivity), and never creates a session record
 * of its own: the actual quiz_sessions/remediation_steps/learning_evidence
 * row is created by whichever existing route the student's browser
 * lands on when it follows launchTarget. This is deliberate -- it means
 * "session completion" is entirely owned by those existing flows (quiz
 * submission, remediation step completion, transfer submission), never
 * a second evidence pipeline, and it means no new persistence/migration
 * is needed here at all.
 */

import { db } from '@/lib/db';
import { evidenceModeForActivity, type ActivityType, type EvidenceMode } from '@/lib/activity-taxonomy';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import { getRemediationPath, remediationStepHref, type RemediationStep } from './remediation.service';

export type LaunchStatus = 'READY' | 'UNAVAILABLE';

export interface LearningSession {
  activityType: ActivityType;
  evidenceMode: EvidenceMode;
  actionConceptId: string;
  subjectId: string;
  remediationPathId?: string;
  diagnosisId?: string;
  occurrenceId?: string;
  launchStatus: LaunchStatus;
  /** A navigable URL the client can follow to start the existing flow, or null when UNAVAILABLE. */
  launchTarget: string | null;
  /** The exact params behind launchTarget, for a programmatic (non-navigation) caller. */
  launchParams: Record<string, string>;
  unavailableReason?: string;
}

type LaunchResolution = Pick<LearningSession, 'launchStatus' | 'launchTarget' | 'launchParams' | 'unavailableReason'>;

function buildUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${path}?${qs}`;
}

function ready(path: string, params: Record<string, string>): LaunchResolution {
  return { launchStatus: 'READY', launchTarget: buildUrl(path, params), launchParams: params };
}

function unavailable(reason: string): LaunchResolution {
  return { launchStatus: 'UNAVAILABLE', launchTarget: null, launchParams: {}, unavailableReason: reason };
}

function quizLaunch(quizMode: string, decision: LearningDecision): LaunchResolution {
  return ready('/dashboard/quiz', { subjectId: decision.subjectId, conceptId: decision.actionConceptId, mode: quizMode });
}

function subjectQuizLaunch(quizMode: string, decision: LearningDecision): LaunchResolution {
  return ready('/dashboard/quiz', { subjectId: decision.subjectId, mode: quizMode });
}

function diagnosticLaunch(decision: LearningDecision): LaunchResolution {
  if (!decision.diagnosisId) {
    return unavailable('DIAGNOSTIC_CHECK requires a diagnosisId; none is present on this decision.');
  }
  return ready('/dashboard/quiz', {
    subjectId: decision.subjectId,
    conceptId: decision.actionConceptId,
    mode: 'diagnostic_check',
    diagnosisId: decision.diagnosisId,
  });
}

interface ConceptOwnership {
  owned: boolean;
  label: string | null;
}

/**
 * Read-only ownership check: does actionConceptId genuinely belong to
 * subjectId, for THIS student -- never trusted from the client/decision
 * as given. One query does double duty as the concept-label lookup
 * (TRANSFER's own requirement) so nothing redundant is issued when a
 * label is also needed; no write, ever.
 */
async function verifyConceptOwnership(conceptId: string, subjectId: string, studentId: string): Promise<ConceptOwnership> {
  const result = await db.query(
    `SELECT COALESCE(cl.label, c.canonical_id) AS label
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id
     WHERE c.id = $1 AND c.subject_id = $2 AND s.student_id = $3`,
    [conceptId, subjectId, studentId]
  );
  if (result.rows.length === 0) return { owned: false, label: null };
  return { owned: true, label: result.rows[0].label ?? null };
}

/**
 * TRANSFER as a freestanding, top-level Phase 3C decision (not a
 * remediation step) has never had a launch URL before -- it only used
 * to be reachable via a remediation step's own (buggy) href. This
 * builds a correct one: the destination page requires subjectId +
 * conceptLabel. The label was already resolved by the ownership check
 * that gates every launch (see startLearningSession) -- reused here,
 * never re-queried. A required field is never silently omitted: if the
 * label could not be resolved, this returns UNAVAILABLE rather than a
 * READY launch missing conceptLabel.
 */
function transferLaunch(decision: LearningDecision, label: string | null): LaunchResolution {
  if (!label) {
    return unavailable(`Could not resolve a label for concept ${decision.actionConceptId}; TRANSFER requires one to launch.`);
  }
  return ready('/dashboard/cognitive/transfer', { subjectId: decision.subjectId, conceptId: decision.actionConceptId, conceptLabel: label });
}

/**
 * REMEDIATION never starts a new path, never re-runs diagnosis, and
 * never substitutes a different concept -- it only resolves where the
 * ALREADY-ACTIVE step of the ALREADY-DETERMINED path (the same one
 * Phase 3C's REMEDIATION_ACTIVE signal pointed at) sends the student,
 * via the existing remediationStepHref used everywhere else in the
 * product.
 *
 * getRemediationPath is path-id scoped, not student-scoped -- a
 * remediationPathId is never trusted on its own. Three invariants are
 * checked, read-only, before any launch is built, each failing closed
 * to UNAVAILABLE rather than mutating the path, starting a new one, or
 * substituting a different concept/activity:
 *   1. path.studentId === the supplied studentId (never another
 *      student's path).
 *   2. path.rootCauseConceptId === decision.actionConceptId (the path
 *      genuinely repairs the root cause Phase 3C selected, not a
 *      different one).
 *   3. activeStep.conceptId === path.rootCauseConceptId (the step
 *      actually being launched operates on that same root cause -- so
 *      LearningSession.actionConceptId and the launched concept can
 *      never diverge).
 *
 * Once (2) holds, activeStep.conceptId (verified equal to
 * rootCauseConceptId by (3)) is the SAME concept as
 * decision.actionConceptId, already ownership-verified by the caller --
 * so the already-resolved label is reused for TRANSFER/EXPLAIN steps
 * rather than a second query. TRANSFER/EXPLAIN steps get a corrected
 * href built here rather than editing remediation.service.ts --
 * remediationStepHref's TRANSFER/EXPLAIN cases have a known
 * pre-existing gap (they omit subjectId/conceptLabel, which those
 * destination pages require) that predates Phase 3D and is out of this
 * phase's scope to fix at the source; see the architecture doc's known
 * limitations.
 */
async function remediationLaunch(studentId: string, decision: LearningDecision, label: string | null): Promise<LaunchResolution> {
  if (!decision.remediationPathId) {
    return unavailable('REMEDIATION requires an active remediationPathId; none is present on this decision.');
  }
  const path = await getRemediationPath(decision.remediationPathId);
  if (!path) {
    return unavailable(`Remediation path ${decision.remediationPathId} was not found.`);
  }
  if (path.studentId !== studentId) {
    return unavailable(`Remediation path ${decision.remediationPathId} does not belong to this student.`);
  }
  if (path.rootCauseConceptId !== decision.actionConceptId) {
    return unavailable(
      `Remediation path ${decision.remediationPathId}'s root cause (${path.rootCauseConceptId}) does not match the decision's actionConceptId (${decision.actionConceptId}).`
    );
  }
  const activeStep: RemediationStep | undefined = path.steps.find((s) => s.status === 'active');
  if (!activeStep) {
    return unavailable(`Remediation path ${decision.remediationPathId} has no active step to continue.`);
  }
  if (activeStep.conceptId !== path.rootCauseConceptId) {
    return unavailable(
      `Remediation path ${decision.remediationPathId}'s active step operates on ${activeStep.conceptId}, not its own root cause ${path.rootCauseConceptId} -- refusing to launch a mismatched concept.`
    );
  }

  if (activeStep.stepType === 'TRANSFER' || activeStep.stepType === 'EXPLAIN') {
    if (activeStep.stepType === 'TRANSFER' && !label) {
      return unavailable(`Could not resolve a label for concept ${activeStep.conceptId}; this TRANSFER step requires one to launch.`);
    }
    const base = activeStep.stepType === 'TRANSFER' ? '/dashboard/cognitive/transfer' : '/dashboard/cognitive/explain';
    const params: Record<string, string> = {
      conceptId: activeStep.conceptId,
      subjectId: decision.subjectId,
      remediationStepId: activeStep.id,
    };
    if (activeStep.stepType === 'TRANSFER' && label) params.conceptLabel = label;
    return ready(base, params);
  }

  const href = remediationStepHref(activeStep, { id: path.id, subjectId: decision.subjectId });
  return { launchStatus: 'READY', launchTarget: href, launchParams: { remediationStepId: activeStep.id } };
}

async function resolveLaunch(studentId: string, decision: LearningDecision): Promise<LaunchResolution> {
  // Universal gate, before any ActivityType-specific branch: never
  // trust that actionConceptId genuinely belongs to subjectId/studentId
  // just because the decision says so.
  const ownership = await verifyConceptOwnership(decision.actionConceptId, decision.subjectId, studentId);
  if (!ownership.owned) {
    return unavailable(
      `Concept ${decision.actionConceptId} does not belong to subject ${decision.subjectId} for this student -- refusing to launch.`
    );
  }

  switch (decision.activityType) {
    case 'PRACTICE':
      return quizLaunch('topic_practice', decision);
    case 'REVIEW':
      return quizLaunch('review', decision);
    case 'SOLO_CHECK':
      return quizLaunch('quick_check', decision);
    case 'RETENTION_CHECK':
      return quizLaunch('retention_check', decision);
    case 'DIAGNOSTIC_CHECK':
      return diagnosticLaunch(decision);
    case 'CUMULATIVE_ASSESSMENT':
      return subjectQuizLaunch('cumulative_assessment', decision);
    case 'MOCK_EXAM':
      return subjectQuizLaunch('exam_simulation', decision);
    case 'SOLO_VERIFY':
      // Not currently selected by Phase 3C's own policy (documented gap,
      // not invented here) -- included for completeness and future-
      // proofing. Matches the SAME convention remediation.service.ts's
      // own remediationStepHref already uses for a SOLO_VERIFY
      // remediation step: a single-concept-scoped cumulative_assessment,
      // since no dedicated SOLO_VERIFY quizMode exists in production.
      return quizLaunch('cumulative_assessment', decision);
    case 'REMEDIATION':
      return remediationLaunch(studentId, decision, ownership.label);
    case 'TRANSFER':
      return transferLaunch(decision, ownership.label);
    default:
      return unavailable(`No executable launch path implemented for ActivityType ${decision.activityType satisfies never}.`);
  }
}

/**
 * Resolves a LearningDecision into a LearningSession. Never selects a
 * different intervention, never changes ActivityType, and EvidenceMode
 * always comes from evidenceModeForActivity -- never re-derived by
 * hand. studentId is not just carried for logging -- resolveLaunch uses
 * it to verify, read-only, that the decision's concept/remediation path
 * genuinely belong to this student before ever returning READY.
 */
export async function startLearningSession(params: { studentId: string; learningDecision: LearningDecision }): Promise<LearningSession> {
  const { studentId, learningDecision } = params;
  const launch = await resolveLaunch(studentId, learningDecision);

  return {
    activityType: learningDecision.activityType,
    evidenceMode: evidenceModeForActivity(learningDecision.activityType),
    actionConceptId: learningDecision.actionConceptId,
    subjectId: learningDecision.subjectId,
    remediationPathId: learningDecision.remediationPathId,
    diagnosisId: learningDecision.diagnosisId,
    occurrenceId: learningDecision.occurrenceId,
    ...launch,
  };
}
