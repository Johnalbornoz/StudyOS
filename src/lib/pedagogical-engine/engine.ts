/**
 * CANON-R2 / CANON-R2R1 -- Canonical Learning State Machine v1.0: the
 * core engine.
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
import {
  resolveLearnDifficulty,
  resolvePracticeDifficulty,
  resolveProveDifficulty,
  resolveReinforceDifficulty,
  resolveRetentionDifficulty,
  resolveTransferDifficulty,
  type DifficultyResolution,
} from './difficulty-policy';
import { STAGE_ORDER } from './types';
import type {
  ActionState,
  CanonicalPedagogicalDecision,
  EvidenceQualificationReasonCode,
  NextCanonicalAction,
  PedagogicalEngineInput,
  PedagogicalStage,
  QualifiedEvidenceSummary,
  RawEvidenceItem,
  RecognitionRejectionReason,
  RecognizedRequirement,
  RequirementResult,
  RollbackCase,
  RollbackDecision,
  SatisfactionBasis,
} from './types';

type Stage = Exclude<PedagogicalStage, 'CONSOLIDATED'>;

interface StageAccumulator {
  qualifyingCount: number;
  nonQualifyingCount: number;
  qualifyingIds: string[];
  nonQualifyingIds: string[];
  reasonCodes: Set<EvidenceQualificationReasonCode>;
}

function newAccumulator(): StageAccumulator {
  return { qualifyingCount: 0, nonQualifyingCount: 0, qualifyingIds: [], nonQualifyingIds: [], reasonCodes: new Set() };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Chronological, with a deterministic tiebreak by `id` for same-timestamp items -- so a caller handing evidence in a different array order can never change the sorted result (Cross-Surface Consistency, and canonicalRevision stability). */
function sortEvidence(evidence: RawEvidenceItem[]): RawEvidenceItem[] {
  return [...evidence].sort((a, b) => {
    const t = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * CANON-R4R1 Part 11 -- an invalid `recognizedRequirements` input is
 * rejected in its ENTIRETY, never partially applied and never
 * gap-filled. Valid sets are exactly the contiguous prefixes of
 * `STAGE_ORDER` starting at LEARN (`{}`, `{LEARN}`,
 * `{LEARN,PRACTICE}`, ...) with no duplicate requirement.
 */
function validateRecognitionSet(recognized: RecognizedRequirement[] | undefined): RecognitionRejectionReason | null {
  if (!recognized || recognized.length === 0) return null;
  const requirements = recognized.map((r) => r.requirement);
  if (new Set(requirements).size !== requirements.length) return 'DUPLICATE_REQUIREMENT_IN_RECOGNITION_SET';
  const set = new Set(requirements);
  const expectedPrefix = STAGE_ORDER.slice(0, requirements.length);
  const isContiguousPrefix = expectedPrefix.every((s) => set.has(s)) && set.size === requirements.length;
  return isContiguousPrefix ? null : 'NON_CONTIGUOUS_RECOGNITION_SET';
}

/**
 * Runs the full chronological replay. Returns the final satisfaction
 * state per stage, the per-stage evidence tallies, the evidence-derived
 * difficulty facts CANON-R2R1 needs (the highest sustained qualifying
 * Practice difficulty, the currently-valid qualifying Prove's own
 * difficulty, and the currently-valid qualifying Retention's own
 * score), and at most one currently-in-effect rollback (the LAST one
 * triggered -- an earlier rollback that was itself superseded by a
 * later qualifying attempt is not reported, since it is no longer the
 * reason the learner is where they are).
 */
function replay(evidence: RawEvidenceItem[], recognizedByStage: Map<Stage, RecognizedRequirement> | null) {
  const sorted = sortEvidence(evidence);

  const acc: Record<Stage, StageAccumulator> = {
    LEARN: newAccumulator(),
    PRACTICE: newAccumulator(),
    PROVE: newAccumulator(),
    RETAIN: newAccumulator(),
    TRANSFER: newAccumulator(),
  };

  // CANON-R4R1 -- recognition seeds the STARTING baseline exactly once,
  // before any evidence is processed. It is never re-applied mid-replay:
  // once a boolean below is reset to `false` by the engine's own
  // existing rollback logic (unchanged this phase), only a NEW
  // qualifying REAL v1 item -- never the recognition again -- can set it
  // back to `true`. This is precisely "newer v1 failure/rollback state >
  // legacy recognition" (Part 14), achieved with zero special-cased
  // invalidation logic: the existing reset-on-failure code already does
  // the whole job.
  let learnSatisfied = false;
  let learnBasis: SatisfactionBasis = null;
  let practiceSatisfied = false;
  let practiceBasis: SatisfactionBasis = null;
  let proveSatisfied = false;
  let proveBasis: SatisfactionBasis = null;
  let proveQualifyingAt: string | null = null;
  let proveQualifyingDifficulty: number | null = null;
  let retainSatisfied = false;
  let retainBasis: SatisfactionBasis = null;
  let retainQualifyingScore: number | null = null;
  let transferSatisfied = false;
  let transferBasis: SatisfactionBasis = null;
  let highestQualifyingPracticeDifficulty: number | null = null;
  let lastRollback: RollbackDecision | null = null;

  if (recognizedByStage) {
    const learn = recognizedByStage.get('LEARN');
    if (learn) {
      learnSatisfied = true;
      learnBasis = learn.basis;
    }
    const practice = recognizedByStage.get('PRACTICE');
    if (practice) {
      practiceSatisfied = true;
      practiceBasis = practice.basis;
    }
    const prove = recognizedByStage.get('PROVE');
    if (prove) {
      proveSatisfied = true;
      proveBasis = prove.basis;
      // No real administered timestamp/difficulty exists for a
      // recognition-only Prove -- `recognizedAt` is used ONLY as the
      // conservative anchor Retention's 3-day wait counts from; the
      // difficulty stays `null` (never fabricated), which
      // `resolveRetentionDifficulty`/`resolveTransferDifficulty` already
      // handle gracefully via their own documented defaults.
      proveQualifyingAt = prove.recognizedAt;
    }
    const retain = recognizedByStage.get('RETAIN');
    if (retain) {
      retainSatisfied = true;
      retainBasis = retain.basis;
    }
    const transfer = recognizedByStage.get('TRANSFER');
    if (transfer) {
      transferSatisfied = true;
      transferBasis = transfer.basis;
    }
  }

  function makeRollback(
    triggeredBy: RollbackDecision['triggeredBy'],
    rollbackCase: RollbackCase,
    rolledBackTo: Stage,
    reasonCodes: EvidenceQualificationReasonCode[],
  ): RollbackDecision {
    return { triggeredBy, case: rollbackCase, rolledBackTo, reasonCodes };
  }

  // LEARN: order-independent -- any single qualifying LEARN_CHECK item
  // is enough, and nothing downstream can ever roll LEARN back
  // (Invariant: LEARN is a comprehension checkpoint, never mastery).
  // CANON-R2R1 Part 3: `qualifyEvidence` now rejects any non-LEARN_CHECK
  // activity type outright (WRONG_ACTIVITY_TYPE) -- arbitrary Practice/
  // Transfer/Prove evidence can never satisfy this loop merely by
  // existing.
  for (const item of sorted) {
    const verdict = qualifyEvidence(item, { targetStage: 'LEARN', prerequisiteSatisfied: true });
    if (verdict.result === 'QUALIFIES') {
      learnSatisfied = true;
      learnBasis = 'V1_EVIDENCE';
      acc.LEARN.qualifyingCount++;
      acc.LEARN.qualifyingIds.push(item.id);
    } else {
      acc.LEARN.nonQualifyingCount++;
      acc.LEARN.nonQualifyingIds.push(item.id);
    }
    acc.LEARN.reasonCodes.add(verdict.reasonCode);
  }

  for (const item of sorted) {
    if (item.activityType === 'PRACTICE') {
      const verdict = qualifyEvidence(item, { targetStage: 'PRACTICE', prerequisiteSatisfied: learnSatisfied });
      acc.PRACTICE.reasonCodes.add(verdict.reasonCode);
      if (verdict.result === 'QUALIFIES') {
        practiceSatisfied = true;
        practiceBasis = 'V1_EVIDENCE';
        acc.PRACTICE.qualifyingCount++;
        acc.PRACTICE.qualifyingIds.push(item.id);
        highestQualifyingPracticeDifficulty =
          highestQualifyingPracticeDifficulty == null ? item.difficulty : Math.max(highestQualifyingPracticeDifficulty, item.difficulty);
        // A qualifying Practice attempt resolves any rollback that sent
        // the learner back here for repair -- they are no longer in
        // REINFORCE, just ready to attempt the next stage normally.
        if (lastRollback?.rolledBackTo === 'PRACTICE') lastRollback = null;
      } else {
        acc.PRACTICE.nonQualifyingCount++;
        acc.PRACTICE.nonQualifyingIds.push(item.id);
      }
    }

    if (item.activityType === 'PROVE') {
      const verdict = qualifyEvidence(item, { targetStage: 'PROVE', prerequisiteSatisfied: practiceSatisfied });
      acc.PROVE.reasonCodes.add(verdict.reasonCode);
      if (verdict.result === 'QUALIFIES') {
        proveSatisfied = true;
        proveBasis = 'V1_EVIDENCE';
        proveQualifyingAt = item.timestamp;
        proveQualifyingDifficulty = item.difficulty;
        acc.PROVE.qualifyingCount++;
        acc.PROVE.qualifyingIds.push(item.id);
        // A fresh qualifying Prove resolves a Retention-triggered
        // rollback ("a NEW successful Prove creates a NEW retention
        // window") -- the learner is no longer in REINFORCE.
        if (lastRollback?.rolledBackTo === 'PROVE') lastRollback = null;
      } else {
        acc.PROVE.nonQualifyingCount++;
        acc.PROVE.nonQualifyingIds.push(item.id);
        // A genuine (non-premature) failed attempt -- never a premature
        // or malformed one -- triggers repair: PROVE spec's own rule,
        // "failure returns to PRACTICE with NEW Prove required after
        // repair, never just repeats." CANON-R4R1 Part 12: this ALSO
        // permanently invalidates any recognition-seeded PROVE/PRACTICE
        // basis for the rest of this replay -- newer v1 failure beats
        // legacy recognition -- simply by resetting the same booleans a
        // pre-CANON-R4R1 failure already reset.
        if (verdict.reasonCode === 'FAILED_ATTEMPT') {
          proveSatisfied = false;
          proveBasis = null;
          proveQualifyingDifficulty = null;
          practiceSatisfied = false;
          practiceBasis = null;
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
        retainBasis = 'V1_EVIDENCE';
        retainQualifyingScore = item.scorePercent;
        acc.RETAIN.qualifyingCount++;
        acc.RETAIN.qualifyingIds.push(item.id);
      } else {
        acc.RETAIN.nonQualifyingCount++;
        acc.RETAIN.nonQualifyingIds.push(item.id);
        if (verdict.reasonCode === 'FAILED_ATTEMPT') {
          // Retention spec's own rule: "failure rolls back to PROVE and
          // a NEW successful Prove creates a NEW retention window --
          // never reuses old due date." Invalidate the prior qualifying
          // Prove entirely so a fresh one is required. CANON-R4R1 Part
          // 12: a recognition-seeded PROVE basis is permanently
          // invalidated here too -- the learner must produce a NEW real
          // v1 Prove; legacy recognition can never instantly re-satisfy
          // it (Part 12's own forbidden example).
          retainSatisfied = false;
          retainBasis = null;
          retainQualifyingScore = null;
          proveSatisfied = false;
          proveBasis = null;
          proveQualifyingAt = null;
          proveQualifyingDifficulty = null;
          lastRollback = makeRollback('RETAIN', 'RETENTION_FAILURE_RETURN_TO_PROVE', 'PROVE', ['FAILED_ATTEMPT']);
        }
      }
    }

    if (item.activityType === 'TRANSFER') {
      const verdict = qualifyEvidence(item, { targetStage: 'TRANSFER', prerequisiteSatisfied: retainSatisfied });
      acc.TRANSFER.reasonCodes.add(verdict.reasonCode);
      if (verdict.result === 'QUALIFIES') {
        acc.TRANSFER.qualifyingCount++;
        acc.TRANSFER.qualifyingIds.push(item.id);
        transferSatisfied = true;
        transferBasis = 'V1_EVIDENCE';
        // A qualifying Transfer resolves a Case A (application-weak)
        // rollback -- the retry succeeded, no REINFORCE remains active.
        if (lastRollback?.rolledBackTo === 'TRANSFER') lastRollback = null;
      } else {
        acc.TRANSFER.nonQualifyingCount++;
        acc.TRANSFER.nonQualifyingIds.push(item.id);
        if (verdict.reasonCode === 'CRITICAL_MISCONCEPTION') {
          // Case C: rollback to the first requirement invalidated by
          // the misconception. Documented CANON-R2R1 decision: treated
          // as foundational -- rolls all the way back to PRACTICE, since
          // a critical misconception undermines every stage built on
          // top of it, not just Transfer itself. CANON-R4R1: this
          // permanently invalidates any recognition-seeded basis for
          // every one of these stages, for the rest of this replay.
          practiceSatisfied = false;
          practiceBasis = null;
          proveSatisfied = false;
          proveBasis = null;
          proveQualifyingAt = null;
          proveQualifyingDifficulty = null;
          retainSatisfied = false;
          retainBasis = null;
          retainQualifyingScore = null;
          transferSatisfied = false;
          transferBasis = null;
          lastRollback = makeRollback('TRANSFER', 'CASE_C_CRITICAL_MISCONCEPTION', 'PRACTICE', ['CRITICAL_MISCONCEPTION']);
        } else if (verdict.reasonCode === 'FAILED_ATTEMPT' || verdict.reasonCode === 'MISSING_REQUIRED_REASONING') {
          transferSatisfied = false;
          transferBasis = null;
          // CANON-R2R1 Part 2: qualification (did this attempt pass?)
          // and rollback DIAGNOSIS (why, and how far back?) are now
          // fully separate. A low -- even a zero -- per-challenge score
          // never by itself implies Case B: only an EXPLICIT diagnostic
          // signal (`transferFoundationalFailureIndicated`, produced by
          // evidence dimensions outside this bare score, e.g. a
          // procedural-correctness sub-check -- out of this isolated
          // engine's own scope to compute) can trigger it. Absent that
          // signal, every failure defaults to the more conservative
          // Case A: the underlying Prove/Retention evidence remains
          // valid, and only a Transfer-focused retry is required.
          if (item.transferFoundationalFailureIndicated === true) {
            // Case B: foundational failure -- rolls back to PRACTICE
            // (the earliest requirement a genuine foundational failure
            // plausibly invalidates).
            practiceSatisfied = false;
            practiceBasis = null;
            proveSatisfied = false;
            proveBasis = null;
            proveQualifyingAt = null;
            proveQualifyingDifficulty = null;
            retainSatisfied = false;
            retainBasis = null;
            retainQualifyingScore = null;
            lastRollback = makeRollback('TRANSFER', 'CASE_B_FOUNDATIONAL_FAILURE', 'PRACTICE', [verdict.reasonCode]);
          } else {
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
    sorted,
    learnSatisfied,
    learnBasis,
    practiceSatisfied,
    practiceBasis,
    proveSatisfied,
    proveBasis,
    proveQualifyingAt,
    proveQualifyingDifficulty,
    retainSatisfied,
    retainBasis,
    retainQualifyingScore,
    transferSatisfied,
    transferBasis,
    highestQualifyingPracticeDifficulty,
    acc,
    lastRollback,
  };
}

function buildRequirementResult(
  stage: Stage,
  status: RequirementResult['status'],
  a: StageAccumulator,
  satisfactionBasis: SatisfactionBasis,
  waitingUntil: string | null = null,
): RequirementResult {
  return {
    stage,
    status,
    qualifyingEvidenceCount: a.qualifyingCount,
    nonQualifyingEvidenceCount: a.nonQualifyingCount,
    qualifyingEvidenceIds: [...a.qualifyingIds],
    nonQualifyingEvidenceIds: [...a.nonQualifyingIds],
    reasonCodes: [...a.reasonCodes],
    waitingUntil,
    // Never reported unless actually SATISFIED -- a stage reset to
    // UNSATISFIED/LOCKED by a rollback also had its basis reset to
    // `null` at the exact same point (see `replay`), so this is never
    // stale.
    satisfactionBasis: status === 'SATISFIED' ? satisfactionBasis : null,
  };
}

/** CANON-R2R1 Part 27 -- mirrors `src/lib/lx/journey-progress.ts`'s own already-approved fixed stage anchors WITHOUT importing that (presentation-layer) module, preserving Engine Isolation. This engine's own stage set has no NOT_STARTED/READY_TO_PROVE distinction (see the CANON-R2R1 report) -- LEARN and PROVE each cover both of that model's finer-grained states. */
const STAGE_PROGRESS_PERCENT: Record<PedagogicalStage, number> = {
  LEARN: 15,
  PRACTICE: 35,
  PROVE: 55,
  RETAIN: 70,
  TRANSFER: 85,
  CONSOLIDATED: 100,
};

/**
 * CANON-R2R1 Part 25/26 -- a deterministic, non-cryptographic fingerprint
 * (FNV-1a) of exactly the pedagogical input state that produced a
 * decision. Never a random UUID, never persisted here, and -- since
 * `RawEvidenceItem` itself carries no learner answer/question text or
 * other free-form content -- structurally incapable of leaking PII: the
 * fingerprint can only ever reflect ids, scores, counts, and flags.
 */
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function computeCanonicalRevision(input: PedagogicalEngineInput, policyVersion: string, sortedEvidence: RawEvidenceItem[]): string {
  const normalizedEvidence = sortedEvidence.map((e) => ({
    id: e.id,
    activityType: e.activityType,
    timestamp: e.timestamp,
    itemCount: e.itemCount,
    correctCount: e.correctCount,
    scorePercent: e.scorePercent,
    independent: e.independent,
    difficulty: e.difficulty,
    hasCriticalMisconception: e.hasCriticalMisconception,
    transferDepth: e.transferDepth ?? null,
    perChallengeScores: e.perChallengeScores ?? null,
    reasoningProvided: e.reasoningProvided ?? null,
    novel: e.novel ?? null,
    transferFoundationalFailureIndicated: e.transferFoundationalFailureIndicated ?? null,
  }));
  const fingerprint = JSON.stringify({
    policyVersion,
    conceptId: input.conceptId,
    studentId: input.studentId,
    now: input.now,
    activeCriticalMisconception: input.activeCriticalMisconception,
    evidence: normalizedEvidence,
  });
  return `${policyVersion}:${fnv1aHash(fingerprint)}`;
}

export function evaluateCanonicalLearningState(input: PedagogicalEngineInput): CanonicalPedagogicalDecision {
  const policyVersion = input.policyVersion ?? CANONICAL_POLICY.version;

  // CANON-R4R1 Part 11 -- an invalid recognition input is rejected in
  // its ENTIRETY: the decision proceeds exactly as if `recognizedRequirements`
  // had been omitted, and the rejection is reported explicitly rather
  // than silently gap-filled.
  const recognitionRejected = validateRecognitionSet(input.recognizedRequirements);
  const recognizedByStage: Map<Stage, RecognizedRequirement> | null =
    !recognitionRejected && input.recognizedRequirements && input.recognizedRequirements.length > 0
      ? new Map(input.recognizedRequirements.map((r) => [r.requirement, r]))
      : null;

  const state = replay(input.evidence, recognizedByStage);

  const requirements: RequirementResult[] = [];

  requirements.push(buildRequirementResult('LEARN', state.learnSatisfied ? 'SATISFIED' : 'UNSATISFIED', state.acc.LEARN, state.learnBasis));

  requirements.push(
    buildRequirementResult(
      'PRACTICE',
      !state.learnSatisfied ? 'LOCKED' : state.practiceSatisfied ? 'SATISFIED' : 'UNSATISFIED',
      state.acc.PRACTICE,
      state.practiceBasis,
    ),
  );

  requirements.push(
    buildRequirementResult(
      'PROVE',
      !state.practiceSatisfied ? 'LOCKED' : state.proveSatisfied ? 'SATISFIED' : 'UNSATISFIED',
      state.acc.PROVE,
      state.proveBasis,
    ),
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
  requirements.push(buildRequirementResult('RETAIN', retainStatus, state.acc.RETAIN, state.retainBasis, retainWaitingUntil));

  requirements.push(
    buildRequirementResult(
      'TRANSFER',
      !state.retainSatisfied ? 'LOCKED' : state.transferSatisfied ? 'SATISFIED' : 'UNSATISFIED',
      state.acc.TRANSFER,
      state.transferBasis,
    ),
  );

  const firstUnsatisfied = requirements.find((r) => r.status !== 'SATISFIED');
  let stage: PedagogicalStage = firstUnsatisfied ? firstUnsatisfied.stage : 'CONSOLIDATED';

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
  if (input.activeCriticalMisconception && stage !== 'LEARN') {
    stage = 'PRACTICE';
    intervention = 'REINFORCE';
  }

  // CANON-R2R1 Part 9-17: DifficultyPolicy -- always evidence-driven,
  // never a static stage-only midpoint. `practiceDifficulty` is computed
  // unconditionally because REINFORCE's own target derives from it
  // regardless of which stage the rollback landed on.
  const practiceDifficulty = resolvePracticeDifficulty(state.sorted.filter((e) => e.activityType === 'PRACTICE'));
  let difficultyResolution: DifficultyResolution;
  if (intervention === 'REINFORCE') {
    difficultyResolution = resolveReinforceDifficulty(practiceDifficulty.target);
  } else {
    switch (stage) {
      case 'LEARN':
        difficultyResolution = resolveLearnDifficulty();
        break;
      case 'PRACTICE':
        difficultyResolution = practiceDifficulty;
        break;
      case 'PROVE':
        difficultyResolution = resolveProveDifficulty(state.highestQualifyingPracticeDifficulty);
        break;
      case 'RETAIN':
        difficultyResolution = resolveRetentionDifficulty(state.proveQualifyingDifficulty);
        break;
      case 'TRANSFER':
        difficultyResolution = resolveTransferDifficulty({
          qualifyingProveDifficulty: state.proveQualifyingDifficulty,
          qualifyingRetentionScore: state.retainQualifyingScore,
          activeCriticalMisconception: input.activeCriticalMisconception,
        });
        break;
      case 'CONSOLIDATED':
        // Never actually consumed -- buildActivityContract returns null
        // for CONSOLIDATED before touching this value.
        difficultyResolution = resolveLearnDifficulty();
        break;
      default: {
        const _exhaustive: never = stage;
        difficultyResolution = _exhaustive;
      }
    }
  }

  const activityContract = buildActivityContract(stage, intervention, difficultyResolution);

  // CANON-R2R1 Part 21 -- a closed enum, never left for a consumer to
  // infer from `stage` alone.
  const currentRequirement = requirements.find((r) => r.stage === stage) ?? null;
  let actionState: ActionState;
  if (stage === 'CONSOLIDATED') {
    actionState = 'CONSOLIDATED';
  } else if (intervention === 'REINFORCE') {
    actionState = 'EXECUTABLE';
  } else if (currentRequirement?.status === 'LOCKED') {
    actionState = 'LOCKED';
  } else if (currentRequirement?.status === 'WAITING') {
    actionState = 'WAITING';
  } else if (currentRequirement?.status === 'UNRESOLVED') {
    actionState = 'BLOCKED';
  } else {
    actionState = 'EXECUTABLE';
  }

  // CANON-R2R1 Part 22 -- a semantic pedagogical action, never a URL,
  // API route, or React navigation target. Independent of `intervention`
  // -- REINFORCE is metadata layered on top of the same underlying next
  // action (its own reinforcement-shaped ActivityContract already
  // carries that distinction), not a different action category.
  let nextCanonicalAction: NextCanonicalAction = 'NONE';
  if (actionState === 'EXECUTABLE') {
    switch (stage) {
      case 'LEARN':
        nextCanonicalAction = 'LEARN';
        break;
      case 'PRACTICE':
        nextCanonicalAction = 'PRACTICE';
        break;
      case 'PROVE':
        nextCanonicalAction = 'PROVE';
        break;
      case 'RETAIN':
        nextCanonicalAction = 'RETENTION_CHECK';
        break;
      case 'TRANSFER':
        nextCanonicalAction = 'TRANSFER';
        break;
      case 'CONSOLIDATED':
        nextCanonicalAction = 'NONE';
        break;
      default: {
        const _exhaustive: never = stage;
        nextCanonicalAction = _exhaustive;
      }
    }
  }

  // CANON-R2R1 Part 23/24.
  const waitingReason = actionState === 'WAITING' ? 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED' : null;
  const nextEligibleAt = actionState === 'WAITING' ? retainWaitingUntil : null;

  const reasonCodes = [...new Set(requirements.flatMap((r) => r.reasonCodes))];
  if (input.activeCriticalMisconception) reasonCodes.push('CRITICAL_MISCONCEPTION');

  // CANON-R2R1 Part 28.
  const qualifiedEvidence: QualifiedEvidenceSummary[] = requirements.map((r) => ({
    requirement: r.stage,
    status: r.status,
    qualifyingEvidenceIds: r.qualifyingEvidenceIds,
    nonQualifyingEvidenceIds: r.nonQualifyingEvidenceIds,
    reasonCodes: r.reasonCodes,
    satisfactionBasis: r.satisfactionBasis,
  }));

  const canonicalRevision = computeCanonicalRevision(input, policyVersion, state.sorted);

  return {
    policyVersion,
    canonicalRevision,
    conceptId: input.conceptId,
    studentId: input.studentId,
    stage,
    currentStage: stage,
    actionState,
    nextCanonicalAction,
    requirements,
    qualifiedEvidence,
    activityContract,
    waitingReason,
    nextEligibleAt,
    intervention,
    rollback: state.lastRollback,
    reasonCodes: [...new Set(reasonCodes)],
    journeyProgressPercent: STAGE_PROGRESS_PERCENT[stage],
    computedAt: input.now,
    recognitionRejected,
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
  recognizedRequirements?: RecognizedRequirement[];
}): CanonicalPedagogicalDecision {
  return evaluateCanonicalLearningState(args);
}

export { STAGE_ORDER };
