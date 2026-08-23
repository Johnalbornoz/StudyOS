/**
 * Adaptive Remediation Path (Phase 2): once a root cause is CONFIRMED,
 * generate the smallest step sequence that repairs it -- never a fixed
 * 30-minute lesson. The pattern (which steps, in what order) is chosen
 * from the *candidate concept's own* learner state, not the target's,
 * since it's the candidate that's actually being repaired.
 */

import { db } from '@/lib/db';
import { getLearnerConceptState, type LearnerConceptState } from './learner-model.service';
import { getDiagnosis } from './cognitive-diagnosis.service';
import { track } from '@/lib/analytics';

export type RemediationStepType = 'LEARN' | 'GUIDED_PRACTICE' | 'RETRIEVAL' | 'EXPLAIN' | 'TRANSFER' | 'SOLO_VERIFY';
export type RemediationPathState = 'DETECTED' | 'DIAGNOSING' | 'CONFIRMED' | 'REPAIRING' | 'VERIFYING' | 'RESOLVED' | 'REJECTED';
export type RemediationStepStatus = 'pending' | 'active' | 'completed' | 'skipped';

export type RemediationPattern =
  | 'LOW_MASTERY'
  | 'LOW_RETENTION'
  | 'LOW_INDEPENDENCE'
  | 'OVERCONFIDENT'
  | 'TRANSFER_WEAKNESS'
  | 'DEFAULT';

const PATTERN_STEPS: Record<RemediationPattern, RemediationStepType[]> = {
  // Doesn't understand it yet at all: rebuild it, practice with support, then prove it alone.
  LOW_MASTERY: ['LEARN', 'GUIDED_PRACTICE', 'SOLO_VERIFY'],
  // Understood it before, hasn't touched it in a while: retrieve it from memory, brief practice, prove it.
  LOW_RETENTION: ['RETRIEVAL', 'GUIDED_PRACTICE', 'SOLO_VERIFY'],
  // Does fine with help but hasn't proven it alone: skip re-teaching, go straight to solo practice.
  LOW_INDEPENDENCE: ['GUIDED_PRACTICE', 'SOLO_VERIFY'],
  // Confident but wrong: needs to reason about *why*, not just more repetition.
  OVERCONFIDENT: ['EXPLAIN', 'GUIDED_PRACTICE', 'SOLO_VERIFY'],
  // Knows it in the context it was learned in, not elsewhere: apply it somewhere new before verifying.
  TRANSFER_WEAKNESS: ['TRANSFER', 'SOLO_VERIFY'],
  DEFAULT: ['GUIDED_PRACTICE', 'SOLO_VERIFY'],
};

/**
 * Minimum Effective Intervention: pick the smallest pattern that fits
 * the candidate's actual state, from the same signals Phase 1 already
 * computes -- never a one-size-fits-all lesson.
 */
export function determineRemediationPattern(state: LearnerConceptState | null): RemediationPattern {
  if (!state) return 'LOW_MASTERY'; // no evidence at all -> treat as needing the full rebuild
  if (state.masteryScore < 50) return 'LOW_MASTERY';
  if (state.confidenceCalibration.label === 'OVERCONFIDENT') return 'OVERCONFIDENT';
  if (state.retention !== null && state.retention < 50) return 'LOW_RETENTION';
  if (state.independentMastery !== null && state.independentMastery < state.masteryScore - 20) return 'LOW_INDEPENDENCE';
  return 'DEFAULT';
}

export interface RemediationStep {
  id: string;
  stepType: RemediationStepType;
  conceptId: string;
  sequence: number;
  status: RemediationStepStatus;
  result: Record<string, unknown> | null;
}

export interface RemediationPath {
  id: string;
  studentId: string;
  diagnosisId: string | null;
  targetConceptId: string;
  rootCauseConceptId: string;
  pattern: RemediationPattern;
  state: RemediationPathState;
  steps: RemediationStep[];
}

async function loadPath(pathId: string): Promise<RemediationPath | null> {
  const pathResult = await db.query(
    `SELECT id, student_id, diagnosis_id, target_concept_id, root_cause_concept_id, pattern, state FROM remediation_paths WHERE id = $1`,
    [pathId]
  );
  const row = pathResult.rows[0];
  if (!row) return null;
  const stepsResult = await db.query(
    `SELECT id, step_type, concept_id, sequence, status, result FROM remediation_steps WHERE remediation_path_id = $1 ORDER BY sequence ASC`,
    [pathId]
  );
  return {
    id: row.id,
    studentId: row.student_id,
    diagnosisId: row.diagnosis_id,
    targetConceptId: row.target_concept_id,
    rootCauseConceptId: row.root_cause_concept_id,
    pattern: row.pattern,
    state: row.state,
    steps: stepsResult.rows.map((s) => ({
      id: s.id,
      stepType: s.step_type,
      conceptId: s.concept_id,
      sequence: s.sequence,
      status: s.status,
      result: s.result,
    })),
  };
}

/**
 * Creates the path + its steps from a CONFIRMED diagnosis. Only
 * callable once per diagnosis in practice (the caller checks
 * getActiveRemediationForDiagnosis first); doesn't enforce uniqueness
 * itself since a student could conceivably need a second attempt at
 * the same root cause later.
 */
export async function startRemediation(diagnosisId: string): Promise<RemediationPath> {
  const diagnosis = await getDiagnosis(diagnosisId);
  if (!diagnosis) throw new Error('DIAGNOSIS_NOT_FOUND');
  if (diagnosis.state !== 'CONFIRMED') throw new Error('DIAGNOSIS_NOT_CONFIRMED');

  const candidateState = await getLearnerConceptState(diagnosis.studentId, diagnosis.candidateConceptId);
  const pattern = determineRemediationPattern(candidateState);
  const stepTypes = PATTERN_STEPS[pattern];

  const pathResult = await db.query(
    `INSERT INTO remediation_paths (student_id, diagnosis_id, target_concept_id, root_cause_concept_id, pattern, state)
     VALUES ($1, $2, $3, $4, $5, 'REPAIRING') RETURNING id`,
    [diagnosis.studentId, diagnosisId, diagnosis.targetConceptId, diagnosis.candidateConceptId, pattern]
  );
  const pathId = pathResult.rows[0].id;

  for (let i = 0; i < stepTypes.length; i++) {
    await db.query(
      `INSERT INTO remediation_steps (remediation_path_id, step_type, concept_id, sequence, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [pathId, stepTypes[i], diagnosis.candidateConceptId, i + 1, i === 0 ? 'active' : 'pending']
    );
  }

  track(diagnosis.studentId, 'remediation_started', { diagnosisId, pathId, pattern, rootCauseConceptId: diagnosis.candidateConceptId });

  return (await loadPath(pathId))!;
}

/**
 * Marks the current active step completed, activates the next one (or
 * resolves/rejects the whole path if this was the last step). The
 * SOLO_VERIFY step's result determines RESOLVED vs. staying open for
 * a retry -- a failed final verification does not silently resolve.
 */
export async function completeRemediationStep(
  stepId: string,
  result: Record<string, unknown>
): Promise<RemediationPath> {
  const stepResult = await db.query(`SELECT remediation_path_id, step_type, sequence FROM remediation_steps WHERE id = $1`, [stepId]);
  const step = stepResult.rows[0];
  if (!step) throw new Error('STEP_NOT_FOUND');

  await db.query(
    `UPDATE remediation_steps SET status = 'completed', result = $2, completed_at = NOW() WHERE id = $1`,
    [stepId, JSON.stringify(result)]
  );

  const path = (await loadPath(step.remediation_path_id))!;
  const nextStep = path.steps.find((s) => s.sequence === step.sequence + 1);
  const isLastStep = !nextStep;
  const succeeded = result.success !== false;

  track(path.studentId, 'remediation_step_completed', { pathId: path.id, stepId, stepType: step.step_type, succeeded });
  if (step.step_type === 'SOLO_VERIFY') {
    track(path.studentId, 'solo_verification_completed', { pathId: path.id, stepId, succeeded });
  }

  if (isLastStep) {
    const newState: RemediationPathState = succeeded ? 'RESOLVED' : 'REPAIRING';
    await db.query(
      `UPDATE remediation_paths SET state = $2, resolved_at = $3 WHERE id = $1`,
      [path.id, newState, succeeded ? new Date() : null]
    );
    if (!succeeded) {
      // Verification failed -- reopen the SOLO_VERIFY step itself for
      // a retry rather than silently declaring victory.
      await db.query(`UPDATE remediation_steps SET status = 'active', completed_at = NULL WHERE id = $1`, [stepId]);
    } else {
      track(path.studentId, 'remediation_completed', { pathId: path.id, rootCauseConceptId: path.rootCauseConceptId });
    }
  } else {
    await db.query(`UPDATE remediation_steps SET status = 'active' WHERE id = $1`, [nextStep.id]);
    const newState: RemediationPathState = nextStep.stepType === 'SOLO_VERIFY' ? 'VERIFYING' : 'REPAIRING';
    await db.query(`UPDATE remediation_paths SET state = $2 WHERE id = $1`, [path.id, newState]);
  }

  return (await loadPath(path.id))!;
}

/** Currently open remediation paths for a student (not RESOLVED/REJECTED) -- NBA v2 uses this to prefer continuing active repair over starting something unrelated. */
export async function getActiveRemediations(studentId: string): Promise<RemediationPath[]> {
  const result = await db.query(
    `SELECT id FROM remediation_paths WHERE student_id = $1 AND state IN ('CONFIRMED', 'REPAIRING', 'VERIFYING') ORDER BY started_at ASC`,
    [studentId]
  );
  const paths = await Promise.all(result.rows.map((r) => loadPath(r.id)));
  return paths.filter((p): p is RemediationPath => p !== null);
}

export async function getRemediationPath(pathId: string): Promise<RemediationPath | null> {
  return loadPath(pathId);
}

export interface RemediationPathWithLabels extends RemediationPath {
  rootCauseLabel: string;
  targetLabel: string;
  subjectId: string;
  subjectName: string;
}

/** Adds display labels/subject to each active path -- used only by the Improve page's "Active repairs" section. */
export async function getActiveRemediationsWithLabels(studentId: string): Promise<RemediationPathWithLabels[]> {
  const paths = await getActiveRemediations(studentId);
  if (paths.length === 0) return [];
  const conceptIds = [...new Set(paths.flatMap((p) => [p.rootCauseConceptId, p.targetConceptId]))];
  const result = await db.query(
    `SELECT c.id, COALESCE(cl.label, c.canonical_id) AS label, c.subject_id, s.name AS subject_name
     FROM concepts c JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN LATERAL (SELECT label FROM concept_localizations WHERE concept_id = c.id LIMIT 1) cl ON true
     WHERE c.id = ANY($1)`,
    [conceptIds]
  );
  const rows = new Map(result.rows.map((r) => [r.id, r]));
  return paths
    .map((p) => {
      const rootCause = rows.get(p.rootCauseConceptId);
      const target = rows.get(p.targetConceptId);
      if (!rootCause || !target) return null;
      return {
        ...p,
        rootCauseLabel: rootCause.label,
        targetLabel: target.label,
        subjectId: rootCause.subject_id,
        subjectName: rootCause.subject_name,
      };
    })
    .filter((p): p is RemediationPathWithLabels => p !== null);
}

/**
 * Where a remediation step's "continue" CTA points -- pure so it stays
 * in one place instead of duplicated per page. LEARN/GUIDED_PRACTICE
 * reuse the quiz engine's topic_practice mode, RETRIEVAL reuses
 * quick_check, SOLO_VERIFY reuses cumulative_assessment scoped to the
 * one concept; EXPLAIN/TRANSFER go to their own lightweight pages.
 */
export function remediationStepHref(
  step: RemediationStep,
  path: { id: string; subjectId: string }
): string {
  const base = `remediationStepId=${step.id}`;
  switch (step.stepType) {
    case 'LEARN':
    case 'GUIDED_PRACTICE':
      return `/dashboard/quiz?subjectId=${path.subjectId}&conceptId=${step.conceptId}&mode=topic_practice&${base}`;
    case 'RETRIEVAL':
      return `/dashboard/quiz?subjectId=${path.subjectId}&conceptId=${step.conceptId}&mode=quick_check&${base}`;
    case 'SOLO_VERIFY':
      return `/dashboard/quiz?subjectId=${path.subjectId}&conceptId=${step.conceptId}&mode=cumulative_assessment&${base}`;
    case 'EXPLAIN':
      return `/dashboard/cognitive/explain?conceptId=${step.conceptId}&${base}`;
    case 'TRANSFER':
      return `/dashboard/cognitive/transfer?conceptId=${step.conceptId}&${base}`;
  }
}
