/**
 * Adaptive Remediation Path (Phase 2): once a root cause is CONFIRMED,
 * generate the smallest step sequence that repairs it -- never a fixed
 * 30-minute lesson. The pattern (which steps, in what order) is chosen
 * from the *candidate concept's own* learner state, not the target's,
 * since it's the candidate that's actually being repaired.
 */

import { db, type DbExecutor } from '@/lib/db';
import type { LearnerConceptState } from './learner-model.service';
import { getDiagnosis } from './cognitive-diagnosis.service';
import { track } from '@/lib/analytics';
import { getDecisionContext, type DecisionContext } from '@/lib/learner-twin';
import { recordDecisionEvent } from '@/lib/audit';

/**
 * Postgres unique_violation on the Phase 2D partial unique index
 * (database/migrations/20260904_1000_intervention_lifecycle_concurrency.sql):
 * at most one non-terminal (CONFIRMED/REPAIRING/VERIFYING) remediation
 * path may exist per diagnosis. `startRemediation`'s own
 * getActiveRemediationForDiagnosis check already makes concurrent
 * duplicate starts unlikely, but a plain SELECT-then-INSERT is not
 * itself race-proof (Phase 2B's own lesson) -- this index is the real,
 * database-enforced guarantee; catching its violation and returning
 * the now-existing path (rather than surfacing a raw 23505 to the
 * caller) is the same ALREADY_APPLIED pattern mastery.service.ts uses
 * for evidence idempotency, reused here rather than reinvented.
 */
const PG_UNIQUE_VIOLATION = '23505';
const REMEDIATION_PATH_OPEN_PER_DIAGNOSIS_CONSTRAINT = 'remediation_paths_open_per_diagnosis_idx';
function isDuplicateRemediationPathConflict(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string } | undefined;
  return pgErr?.code === PG_UNIQUE_VIOLATION && pgErr?.constraint === REMEDIATION_PATH_OPEN_PER_DIAGNOSIS_CONSTRAINT;
}

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
 * Phase 1C-R: adapts the canonical `DecisionContext` into the exact
 * shape `determineRemediationPattern` already expects, so the pure,
 * tested pattern-selection logic below needs no change at all.
 *
 * "retention" here MUST stay the OLD forward-looking, spaced-repetition
 * value (100 - forgettingRisk) -- NOT `DecisionContext.retention.
 * retentionScore`, which is a different, backward-looking Knowledge
 * State dimension. Substituting it would silently change which
 * candidates get classified LOW_RETENTION. This is a release-blocking
 * semantic invariant -- see docs/audits/
 * STUDYUS_PHASE_1C_R_CANONICAL_CONSUMER_CLOSURE.md §6 and
 * tests/unit/decision-consumer-migration-regression.test.ts.
 */
export function toCandidateState(dc: DecisionContext | null): LearnerConceptState | null {
  if (!dc) return null;
  return {
    masteryScore: dc.mastery.score,
    retention: dc.retention.forgettingRisk !== null ? 100 - dc.retention.forgettingRisk : null,
    independentMastery: dc.independence.independentMastery,
    evidenceStrength: dc.independence.evidenceStrength,
    confidence: null, // not read by determineRemediationPattern; DecisionContext does not carry self-reported confidence under this name
    confidenceCalibration: dc.metacognition.confidenceCalibration,
  };
}

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

async function loadPath(pathId: string, client: DbExecutor = db): Promise<RemediationPath | null> {
  const pathResult = await client.query(
    `SELECT id, student_id, diagnosis_id, target_concept_id, root_cause_concept_id, pattern, state FROM remediation_paths WHERE id = $1`,
    [pathId]
  );
  const row = pathResult.rows[0];
  if (!row) return null;
  const stepsResult = await client.query(
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
 * The already-open (not yet RESOLVED/REJECTED) remediation path for
 * this diagnosis, if one exists -- an abandoned path left sitting in
 * REPAIRING/VERIFYING still counts as "already open" here on purpose
 * (see startRemediation), since Phase 2 has no time-based expiry.
 */
async function getActiveRemediationForDiagnosis(diagnosisId: string): Promise<RemediationPath | null> {
  const result = await db.query(
    `SELECT id FROM remediation_paths WHERE diagnosis_id = $1 AND state IN ('CONFIRMED', 'REPAIRING', 'VERIFYING') LIMIT 1`,
    [diagnosisId]
  );
  const row = result.rows[0];
  return row ? loadPath(row.id) : null;
}

/**
 * Creates the path + its steps from a CONFIRMED diagnosis. Idempotent
 * per diagnosis: if a remediation path for this diagnosis is already
 * open (including one abandoned mid-REPAIRING/VERIFYING -- Phase 2 has
 * no time-based expiry, see docs/architecture/phase-2-cognitive-
 * learning-engine.md), this returns that same path instead of creating
 * a duplicate, so calling it twice (a double-click, two tabs, a retry)
 * is always deterministic. A brand-new path is only ever created once
 * the previous one has reached a terminal state (RESOLVED/REJECTED).
 */
export async function startRemediation(diagnosisId: string): Promise<RemediationPath> {
  const diagnosis = await getDiagnosis(diagnosisId);
  if (!diagnosis) throw new Error('DIAGNOSIS_NOT_FOUND');
  if (diagnosis.state !== 'CONFIRMED') throw new Error('DIAGNOSIS_NOT_CONFIRMED');

  const existing = await getActiveRemediationForDiagnosis(diagnosisId);
  if (existing) return existing;

  const candidateDecisionContext = await getDecisionContext(diagnosis.studentId, diagnosis.candidateConceptId);
  const candidateState = toCandidateState(candidateDecisionContext);
  const pattern = determineRemediationPattern(candidateState);
  const stepTypes = PATTERN_STEPS[pattern];

  let pathId: string;
  try {
    const pathResult = await db.query(
      `INSERT INTO remediation_paths (student_id, diagnosis_id, target_concept_id, root_cause_concept_id, pattern, state)
       VALUES ($1, $2, $3, $4, $5, 'REPAIRING') RETURNING id`,
      [diagnosis.studentId, diagnosisId, diagnosis.targetConceptId, diagnosis.candidateConceptId, pattern]
    );
    pathId = pathResult.rows[0].id;
  } catch (err) {
    if (isDuplicateRemediationPathConflict(err)) {
      // A genuinely concurrent call already won the race and inserted
      // the open path for this diagnosis first -- return that one
      // instead of a raw constraint error (Phase 2B's ALREADY_APPLIED
      // pattern). It is safe to re-run the same getActiveRemediationForDiagnosis
      // read now: the winner's row is already committed.
      const existingAfterRace = await getActiveRemediationForDiagnosis(diagnosisId);
      if (existingAfterRace) return existingAfterRace;
      throw err; // genuinely unexpected -- the constraint fired but no open path is now visible
    }
    throw err;
  }

  for (let i = 0; i < stepTypes.length; i++) {
    await db.query(
      `INSERT INTO remediation_steps (remediation_path_id, step_type, concept_id, sequence, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [pathId, stepTypes[i], diagnosis.candidateConceptId, i + 1, i === 0 ? 'active' : 'pending']
    );
  }

  track(diagnosis.studentId, 'remediation_started', { diagnosisId, pathId, pattern, rootCauseConceptId: diagnosis.candidateConceptId });
  await recordDecisionEvent({
    decisionType: 'INTERVENTION_STARTED',
    engine: 'intervention-engine',
    engineVersion: 'v1',
    studentId: diagnosis.studentId,
    conceptId: diagnosis.targetConceptId,
    sourceEventType: 'remediation_paths',
    sourceEventId: pathId,
    newState: { pattern, rootCauseConceptId: diagnosis.candidateConceptId, stepCount: stepTypes.length },
    reasonCode: 'DIAGNOSIS_CONFIRMED',
    reasonDetails: { diagnosisId },
  });

  return (await loadPath(pathId))!;
}

/**
 * Marks the current active step completed, activates the next one (or
 * resolves/rejects the whole path if this was the last step). The
 * SOLO_VERIFY step's result determines RESOLVED vs. staying open for
 * a retry -- a failed final verification does not silently resolve.
 *
 * Phase 2-R (release-blocking fix): the ACTIVE->COMPLETED transition
 * and every one of its downstream side effects (next-step activation,
 * path-state transition, resolved_at, INTERVENTION_COMPLETED) now run
 * inside ONE atomic transaction, gated by a single
 * `UPDATE ... WHERE id = $1 AND status = 'active'` claim -- not a prior
 * `SELECT status` read followed by a separate `UPDATE`. Two genuinely
 * concurrent callers racing the same step can both reach that UPDATE,
 * but Postgres's own row-level locking (not this code) decides which
 * one's WHERE clause still matches once the other's transaction
 * commits: the winner's claim affects exactly one row; the loser's
 * claim -- re-evaluated against the now-committed, no-longer-'active'
 * row -- affects zero. A zero-row claim is ALREADY_APPLIED: the loser
 * performs none of the downstream mutations and returns the winner's
 * (or, for a true sequential replay, its own prior) already-applied
 * path. This is the same "reuse domain state as the atomic guard,
 * never a second idempotency framework" principle Phase 2C's
 * `resolveMisconceptionSignatures` and Phase 2D's
 * `remediation_paths_open_per_diagnosis_idx` already established --
 * applied here via the transaction/row-lock pattern the task calls for
 * (no new column, no new index: `status` was already the step's own
 * stable identity, per Step 2D's original design).
 *
 * No AI/network call happens inside this transaction -- confirmed:
 * every operation below is a parameterized SQL statement or a
 * `recordDecisionEvent` call (itself a single parameterized INSERT).
 */
export async function completeRemediationStep(
  stepId: string,
  result: Record<string, unknown>
): Promise<RemediationPath> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // The atomic claim. `RETURNING` on a zero-row match returns zero
    // rows (not an error) -- Postgres's own row-level MVCC is what
    // serializes two concurrent claims against the SAME row; no
    // application-level locking is added or needed.
    const claim = await client.query(
      `UPDATE remediation_steps
       SET status = 'completed', result = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING remediation_path_id, step_type, sequence`,
      [stepId, JSON.stringify(result)]
    );

    if (claim.rows.length === 0) {
      // ALREADY_APPLIED: either a genuine sequential replay of this
      // exact request (the step is already 'completed'), or this call
      // lost a genuine concurrent race to another caller's identical
      // request. Either way, this call performs NONE of the downstream
      // transition side effects -- it only observes and returns the
      // current state. Distinguishes a truly nonexistent stepId
      // (STEP_NOT_FOUND, unchanged pre-existing contract) from a real,
      // already-transitioned step.
      const existing = await client.query(`SELECT remediation_path_id FROM remediation_steps WHERE id = $1`, [stepId]);
      if (!existing.rows[0]) throw new Error('STEP_NOT_FOUND');
      const path = (await loadPath(existing.rows[0].remediation_path_id, client))!;
      await client.query('COMMIT');
      return path;
    }

    // This call is the genuine winner -- every side effect below
    // belongs to it alone.
    const step = claim.rows[0];
    const pathBeforeTransition = (await loadPath(step.remediation_path_id, client))!;
    const nextStep = pathBeforeTransition.steps.find((s) => s.sequence === step.sequence + 1);
    const isLastStep = !nextStep;
    const succeeded = result.success !== false;

    if (isLastStep) {
      const newState: RemediationPathState = succeeded ? 'RESOLVED' : 'REPAIRING';
      await client.query(
        `UPDATE remediation_paths SET state = $2, resolved_at = $3 WHERE id = $1`,
        [pathBeforeTransition.id, newState, succeeded ? new Date() : null]
      );
      if (!succeeded) {
        // Verification failed -- reopen the SOLO_VERIFY step itself,
        // in this SAME transaction/row-lock, for a retry rather than
        // silently declaring victory. A genuinely NEW subsequent
        // attempt (the only identity this flow has for one -- the
        // step reused, status cycling active<->completed) claims it
        // again exactly as any other completion does, once this
        // transaction commits.
        await client.query(`UPDATE remediation_steps SET status = 'active', completed_at = NULL WHERE id = $1`, [stepId]);
      } else {
        await recordDecisionEvent(
          {
            decisionType: 'INTERVENTION_COMPLETED',
            engine: 'intervention-engine',
            engineVersion: 'v1',
            studentId: pathBeforeTransition.studentId,
            conceptId: pathBeforeTransition.targetConceptId,
            sourceEventType: 'remediation_paths',
            sourceEventId: pathBeforeTransition.id,
            previousState: { state: pathBeforeTransition.state },
            newState: { state: 'RESOLVED' },
            reasonCode: 'FINAL_STEP_SUCCEEDED',
            reasonDetails: { rootCauseConceptId: pathBeforeTransition.rootCauseConceptId, diagnosisId: pathBeforeTransition.diagnosisId },
          },
          client
        );
      }
    } else {
      await client.query(`UPDATE remediation_steps SET status = 'active' WHERE id = $1`, [nextStep.id]);
      const newState: RemediationPathState = nextStep.stepType === 'SOLO_VERIFY' ? 'VERIFYING' : 'REPAIRING';
      await client.query(`UPDATE remediation_paths SET state = $2 WHERE id = $1`, [pathBeforeTransition.id, newState]);
    }

    const finalPath = (await loadPath(pathBeforeTransition.id, client))!;
    await client.query('COMMIT');

    // Analytics stays outside the atomic boundary (Phase 2B/2C/2D's
    // established convention: best-effort product telemetry, not part
    // of the exactly-once cognitive-state guarantee) -- but only ever
    // reached by the genuine winner, after a successful COMMIT, never
    // by a loser or a rolled-back attempt.
    track(pathBeforeTransition.studentId, 'remediation_step_completed', { pathId: pathBeforeTransition.id, stepId, stepType: step.step_type, succeeded });
    if (step.step_type === 'SOLO_VERIFY') {
      track(pathBeforeTransition.studentId, 'solo_verification_completed', { pathId: pathBeforeTransition.id, stepId, succeeded });
    }
    if (isLastStep && succeeded) {
      track(pathBeforeTransition.studentId, 'remediation_completed', { pathId: pathBeforeTransition.id, rootCauseConceptId: pathBeforeTransition.rootCauseConceptId });
    }

    return finalPath;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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

export interface InterventionStateSummary {
  /** Currently-unresolved diagnoses TARGETING this concept -- same "active" definition as getActiveDiagnoses (state IN LIKELY/DIAGNOSIS_REQUIRED/CONFIRMED, no RESOLVED remediation yet), narrowed to one concept. */
  activeDiagnosisCount: number;
  /** Remediation paths currently CONFIRMED/REPAIRING/VERIFYING for this concept -- same definition as getActiveRemediations, narrowed to one concept. */
  openInterventionCount: number;
  /** The most recent TERMINAL (RESOLVED or REJECTED) remediation path's outcome for this concept, if any -- independent of whether a new one is now open. */
  lastOutcome: 'RESOLVED' | 'REJECTED' | null;
  lastOutcomeAt: string | null;
}

/**
 * Phase 2D: a read-only, concept-scoped Intervention Lifecycle summary
 * for the Digital Learning Twin/DecisionContext -- exposes just enough
 * for a future Decision Engine to tell "no known problem" from "under
 * active repair" from "repair attempted and finished, outcome X",
 * without becoming the lifecycle engine itself (Phase 2D.12's own
 * instruction). Two bounded, indexed COUNT/SELECT queries -- no
 * unbounded history.
 */
export async function getInterventionStateForConcept(studentId: string, conceptId: string, client: DbExecutor = db): Promise<InterventionStateSummary> {
  const [activeDiagnoses, openInterventions, lastTerminal] = await Promise.all([
    client.query(
      `SELECT COUNT(*)::int AS n FROM cognitive_diagnoses cd
       WHERE cd.student_id = $1 AND cd.target_concept_id = $2 AND cd.state IN ('LIKELY', 'DIAGNOSIS_REQUIRED', 'CONFIRMED')
         AND NOT EXISTS (SELECT 1 FROM remediation_paths rp WHERE rp.diagnosis_id = cd.id AND rp.state = 'RESOLVED')`,
      [studentId, conceptId]
    ),
    client.query(
      `SELECT COUNT(*)::int AS n FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('CONFIRMED', 'REPAIRING', 'VERIFYING')`,
      [studentId, conceptId]
    ),
    client.query(
      `SELECT state, resolved_at FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('RESOLVED', 'REJECTED') ORDER BY resolved_at DESC LIMIT 1`,
      [studentId, conceptId]
    ),
  ]);
  return {
    activeDiagnosisCount: activeDiagnoses.rows[0].n,
    openInterventionCount: openInterventions.rows[0].n,
    lastOutcome: lastTerminal.rows[0]?.state ?? null,
    lastOutcomeAt: lastTerminal.rows[0]?.resolved_at ?? null,
  };
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
