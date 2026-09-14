/**
 * CANON-R2 -- Canonical Learning State Machine v1.0: the core engine.
 *
 * `evaluateCanonicalLearningState` (aliased `rebuildConceptCanonicalState`)
 * is the ONE deterministic function that turns a raw evidence ledger +
 * policy + current-moment facts into a `CanonicalPedagogicalDecision`.
 * Same input + same policyVersion => same output, always (no reads of
 * the system clock, no randomness, no hidden state).
 *
 * REPLAY MODEL: evidence is processed in chronological order exactly
 * once. Each item can only affect the requirement it targets and,
 * on a genuine (non-premature, non-temporally-ineligible) FAILURE,
 * the specific downstream rollback the spec defines for that stage.
 * History itself is never mutated -- this function only ever reads
 * `evidence`; the ledger a caller holds is untouched.
 */
import { qualifyEvidence } from './evidence-qualification';
import { CANONICAL_POLICY } from './policy';
import { buildActivityContract } from './activity-contract';
import { STAGE_ORDER } from './types';
import type {
  CanonicalPedagogicalDecision,
  EvidenceQualificationReasonCode,
  PedagogicalEngineInput,
  PedagogicalStage,
  RawEvidenceItem,
  RequirementResult,
  RollbackCase,
  RollbackDecision,
} from './types';

type Stage = Exclude<PedagogicalStage, 'CONSOLIDATED'>;

interface StageAccumulator {
  qualifyingCount: number;
  nonQualifyingCount: number;
  reasonCodes: Set<EvidenceQualificationReasonCode>;
}

function newAccumulator(): StageAccumulator {
  return { qualifyingCount: 0, nonQualifyingCount: 0, reasonCodes: new Set() };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Runs the full chronological replay. Returns the final satisfaction
 * state per stage, the per-stage evidence tallies, and at most one
 * currently-in-effect rollback (the LAST one triggered -- an earlier
 * rollback that was itself superseded by a later qualifying attempt is
 * not reported, since it is no longer the reason the learner is where
 * they are).
 */
function replay(evidence: RawEvidenceItem[]) {
  const sorted = [...evidence].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const acc: Record<Stage, StageAccumulator> = {
    LEARN: newAccumulator(),
    PRACTICE: newAccumulator(),
    PROVE: newAccumulator(),
    RETAIN: newAccumulator(),
    TRANSFER: newAccumulator(),
  };

  let learnSatisfied = false;
  let practiceSatisfied = false;
  let proveSatisfied = false;
  let proveQualifyingAt: string | null = null;
  let retainSatisfied = false;
  let transferSatisfied = false;
  let lastRollback: RollbackDecision | null = null;

  function makeRollback(
    triggeredBy: RollbackDecision['triggeredBy'],
    rollbackCase: RollbackCase,
    rolledBackTo: Stage,
    reasonCodes: EvidenceQualificationReasonCode[],
  ): RollbackDecision {
    return { triggeredBy, case: rollbackCase, rolledBackTo, reasonCodes };
  }

  // LEARN: order-independent -- any single qualifying item is enough,
  // and nothing downstream can ever roll LEARN back (Invariant: LEARN is
  // "understanding only, not mastery" -- the lowest possible bar).
  for (const item of sorted) {
    const verdict = qualifyEvidence(item, { targetStage: 'LEARN', prerequisiteSatisfied: true });
    if (verdict.result === 'QUALIFIES') {
      learnSatisfied = true;
      acc.LEARN.qualifyingCount++;
    } else {
      acc.LEARN.nonQualifyingCount++;
    }
    acc.LEARN.reasonCodes.add(verdict.reasonCode);
  }

  for (const item of sorted) {
    if (item.activityType === 'PRACTICE') {
      const verdict = qualifyEvidence(item, { targetStage: 'PRACTICE', prerequisiteSatisfied: learnSatisfied });
      acc.PRACTICE.reasonCodes.add(verdict.reasonCode);
      if (verdict.result === 'QUALIFIES') {
        practiceSatisfied = true;
        acc.PRACTICE.qualifyingCount++;
        // A qualifying Practice attempt resolves any rollback that sent
        // the learner back here for repair -- they are no longer in
        // REINFORCE, just ready to attempt the next stage normally.
        if (lastRollback?.rolledBackTo === 'PRACTICE') lastRollback = null;
      } else {
        acc.PRACTICE.nonQualifyingCount++;
      }
    }

    if (item.activityType === 'PROVE') {
      const verdict = qualifyEvidence(item, { targetStage: 'PROVE', prerequisiteSatisfied: practiceSatisfied });
      acc.PROVE.reasonCodes.add(verdict.reasonCode);
      if (verdict.result === 'QUALIFIES') {
        proveSatisfied = true;
        proveQualifyingAt = item.timestamp;
        acc.PROVE.qualifyingCount++;
        // A fresh qualifying Prove resolves a Retention-triggered
        // rollback ("a NEW successful Prove creates a NEW retention
        // window") -- the learner is no longer in REINFORCE.
        if (lastRollback?.rolledBackTo === 'PROVE') lastRollback = null;
      } else {
        acc.PROVE.nonQualifyingCount++;
        // A genuine (non-premature) failed attempt -- never a premature
        // or malformed one -- triggers repair: PROVE spec's own rule,
        // "failure returns to PRACTICE with NEW Prove required after
        // repair, never just repeats."
        if (verdict.reasonCode === 'FAILED_ATTEMPT') {
          proveSatisfied = false;
          practiceSatisfied = false;
          lastRollback = makeRollback('PROVE', 'PROVE_FAILURE_RETURN_TO_PRACTICE', 'PRACTICE', ['FAILED_ATTEMPT']);
        }
      }
    }

    if (item.activityType === 'RETENTION_CHECK') {
      const eligibleFrom = proveQualifyingAt ? addDays(proveQualifyingAt, CANONICAL_POLICY.retention.minimumWaitDays) : undefined;
      const verdict = qualifyEvidence(item, { targetStage: 'RETAIN', prerequisiteSatisfied: proveSatisfied, eligibleFrom });
      acc.RETAIN.reasonCodes.add(verdict.reasonCode);
      if (verdict.result === 'QUALIFIES') {
        retainSatisfied = true;
        acc.RETAIN.qualifyingCount++;
      } else {
        acc.RETAIN.nonQualifyingCount++;
        if (verdict.reasonCode === 'FAILED_ATTEMPT') {
          // Retention spec's own rule: "failure rolls back to PROVE and
          // a NEW successful Prove creates a NEW retention window --
          // never reuses old due date." Invalidate the prior qualifying
          // Prove entirely so a fresh one is required.
          retainSatisfied = false;
          proveSatisfied = false;
          proveQualifyingAt = null;
          lastRollback = makeRollback('RETAIN', 'RETENTION_FAILURE_RETURN_TO_PROVE', 'PROVE', ['FAILED_ATTEMPT']);
        }
      }
    }

    if (item.activityType === 'TRANSFER') {
      const verdict = qualifyEvidence(item, { targetStage: 'TRANSFER', prerequisiteSatisfied: retainSatisfied });
      acc.TRANSFER.reasonCodes.add(verdict.reasonCode);
      if (verdict.result === 'QUALIFIES') {
        acc.TRANSFER.qualifyingCount++;
        transferSatisfied = true;
        // A qualifying Transfer resolves a Case A (application-weak)
        // rollback -- the retry succeeded, no REINFORCE remains active.
        if (lastRollback?.rolledBackTo === 'TRANSFER') lastRollback = null;
      } else {
        acc.TRANSFER.nonQualifyingCount++;
        if (verdict.reasonCode === 'CRITICAL_MISCONCEPTION') {
          // Case C: rollback to the first requirement invalidated by
          // the misconception. Documented CANON-R2 decision: treated as
          // foundational -- rolls all the way back to PRACTICE, since a
          // critical misconception undermines every stage built on top
          // of it, not just Transfer itself.
          practiceSatisfied = false;
          proveSatisfied = false;
          proveQualifyingAt = null;
          retainSatisfied = false;
          transferSatisfied = false;
          lastRollback = makeRollback('TRANSFER', 'CASE_C_CRITICAL_MISCONCEPTION', 'PRACTICE', ['CRITICAL_MISCONCEPTION']);
        } else if (verdict.reasonCode === 'FAILED_ATTEMPT' || verdict.reasonCode === 'MISSING_REQUIRED_REASONING') {
          const floor = CANONICAL_POLICY.transfer.perChallengeFailureFloor;
          const scores = item.perChallengeScores ?? [];
          const allChallengesFailed = scores.length > 0 && scores.every((s) => s < floor);
          if (allChallengesFailed) {
            // Case B: foundational failure -- documented CANON-R2
            // decision: rolls back to PRACTICE (the earliest requirement
            // this total a wipeout plausibly invalidates).
            practiceSatisfied = false;
            proveSatisfied = false;
            proveQualifyingAt = null;
            retainSatisfied = false;
            transferSatisfied = false;
            lastRollback = makeRollback('TRANSFER', 'CASE_B_FOUNDATIONAL_FAILURE', 'PRACTICE', [verdict.reasonCode]);
          } else {
            transferSatisfied = false;
            // Case A: application-weak, knowledge intact -- Prove and
            // Retention remain valid; only a Transfer-focused REINFORCE
            // + a new Transfer attempt is required.
            lastRollback = makeRollback('TRANSFER', 'CASE_A_TRANSFER_APPLICATION_WEAK', 'TRANSFER', [verdict.reasonCode]);
          }
        }
      }
    }
  }

  return {
    learnSatisfied,
    practiceSatisfied,
    proveSatisfied,
    proveQualifyingAt,
    retainSatisfied,
    transferSatisfied,
    acc,
    lastRollback,
  };
}

function buildRequirementResult(
  stage: Stage,
  status: RequirementResult['status'],
  a: StageAccumulator,
  waitingUntil: string | null = null,
): RequirementResult {
  return {
    stage,
    status,
    qualifyingEvidenceCount: a.qualifyingCount,
    nonQualifyingEvidenceCount: a.nonQualifyingCount,
    reasonCodes: [...a.reasonCodes],
    waitingUntil,
  };
}

export function evaluateCanonicalLearningState(input: PedagogicalEngineInput): CanonicalPedagogicalDecision {
  const policyVersion = input.policyVersion ?? CANONICAL_POLICY.version;
  const state = replay(input.evidence);

  const requirements: RequirementResult[] = [];

  requirements.push(buildRequirementResult('LEARN', state.learnSatisfied ? 'SATISFIED' : 'UNSATISFIED', state.acc.LEARN));

  requirements.push(
    buildRequirementResult(
      'PRACTICE',
      !state.learnSatisfied ? 'LOCKED' : state.practiceSatisfied ? 'SATISFIED' : 'UNSATISFIED',
      state.acc.PRACTICE,
    ),
  );

  requirements.push(
    buildRequirementResult('PROVE', !state.practiceSatisfied ? 'LOCKED' : state.proveSatisfied ? 'SATISFIED' : 'UNSATISFIED', state.acc.PROVE),
  );

  let retainStatus: RequirementResult['status'];
  let retainWaitingUntil: string | null = null;
  if (!state.proveSatisfied) {
    retainStatus = 'LOCKED';
  } else if (state.retainSatisfied) {
    retainStatus = 'SATISFIED';
  } else {
    const eligibleFrom = state.proveQualifyingAt ? addDays(state.proveQualifyingAt, CANONICAL_POLICY.retention.minimumWaitDays) : null;
    if (eligibleFrom && new Date(input.now).getTime() < new Date(eligibleFrom).getTime()) {
      retainStatus = 'WAITING';
      retainWaitingUntil = eligibleFrom;
    } else {
      retainStatus = 'UNSATISFIED';
    }
  }
  requirements.push(buildRequirementResult('RETAIN', retainStatus, state.acc.RETAIN, retainWaitingUntil));

  requirements.push(
    buildRequirementResult(
      'TRANSFER',
      !state.retainSatisfied ? 'LOCKED' : state.transferSatisfied ? 'SATISFIED' : 'UNSATISFIED',
      state.acc.TRANSFER,
    ),
  );

  const firstUnsatisfied = requirements.find((r) => r.status !== 'SATISFIED');
  let currentStage: PedagogicalStage = firstUnsatisfied ? firstUnsatisfied.stage : 'CONSOLIDATED';

  // Any currently-in-effect rollback (see `replay`'s own doc comment --
  // resolved rollbacks are cleared as soon as the stage they targeted is
  // re-satisfied) means the learner is under a REINFORCE intervention,
  // Case A (application-weak Transfer retry) included -- it is still an
  // overlay on top of the underlying stage, never a journey stage itself.
  let intervention: 'REINFORCE' | null = state.lastRollback ? 'REINFORCE' : null;

  // A CURRENT, live critical misconception (not evidence-derived) blocks
  // everything except a journey that has not even started -- mirrors
  // the existing `computeLearningState`'s own top-priority precedent
  // (misconception overrides all downstream state) and
  // `deriveLearnerJourneyStage`'s own REINFORCE-always-reports-PRACTICE
  // convention.
  if (input.activeCriticalMisconception && currentStage !== 'LEARN') {
    currentStage = 'PRACTICE';
    intervention = 'REINFORCE';
  }

  const activityContract = buildActivityContract(currentStage, intervention);

  const reasonCodes = [...new Set(requirements.flatMap((r) => r.reasonCodes))];
  if (input.activeCriticalMisconception) reasonCodes.push('CRITICAL_MISCONCEPTION');

  return {
    policyVersion,
    conceptId: input.conceptId,
    studentId: input.studentId,
    requirements,
    currentStage,
    activityContract,
    intervention,
    rollback: state.lastRollback,
    reasonCodes: [...new Set(reasonCodes)],
    computedAt: input.now,
  };
}

/**
 * Named per the spec's own conceptual signature
 * (`rebuildConceptCanonicalState({evidence, policy, retentionContext,
 * conceptContext, now})`). `policy`/`retentionContext`/`conceptContext`
 * are accepted for interface compatibility with that signature but the
 * engine's own policy is always `CANONICAL_POLICY` -- an external caller
 * cannot inject a different numeric policy through this alias; only
 * `policyVersion` (a label) varies. This keeps "raw evidence + policy =
 * canonical truth" a single, non-bypassable code path rather than two.
 */
export function rebuildConceptCanonicalState(args: {
  conceptId: string;
  studentId: string;
  evidence: RawEvidenceItem[];
  activeCriticalMisconception: boolean;
  now: string;
  policyVersion?: string;
}): CanonicalPedagogicalDecision {
  return evaluateCanonicalLearningState(args);
}

export { STAGE_ORDER };
