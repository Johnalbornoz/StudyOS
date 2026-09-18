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
  /**
   * CANON-V2-REMEDIATION Part 1A -- the CURRENT Practice qualification
   * cycle's window: one entry per structurally-valid Practice attempt
   * (right activity type, right stage/prerequisite, right difficulty
   * range, no blocking misconception -- i.e. every `qualifyEvidence`
   * verdict whose reasonCode is `PASSING_SCORE` or `INSUFFICIENT_SCORE`,
   * the two outcomes that only differ by the score bar itself), `true`
   * when that attempt scored >=80%. Reset to `[]` -- a brand NEW cycle,
   * per Policy V2's own frozen product decision -- every time a rollback
   * lands back on PRACTICE (a genuine Prove failure, or a Transfer
   * foundational/critical-misconception rollback). Historical entries
   * from a prior cycle are never deleted from `RawEvidenceItem`/History
   * itself -- only this in-memory replay accumulator forgets them.
   */
  let practiceWindow: boolean[] = [];
  let proveSatisfied = false;
  let proveBasis: SatisfactionBasis = null;
  let proveQualifyingAt: string | null = null;
  let proveQualifyingDifficulty: number | null = null;
  let retainSatisfied = false;
  let retainBasis: SatisfactionBasis = null;
  let retainQualifyingScore: number | null = null;
  /**
   * CANON-V2-REMEDIATION Part 2 -- consecutive Retain failures since the
   * most recently qualifying Prove (the "current Retain cycle"). Reset
   * to 0 the instant a NEW Prove qualifies, and also on a qualifying
   * Retain -- so a stale strike from a prior, already-rebuilt cycle can
   * never carry over and contaminate a new one.
   */
  let retainStrikeCount = 0;
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
        acc.PRACTICE.qualifyingCount++;
        acc.PRACTICE.qualifyingIds.push(item.id);
        highestQualifyingPracticeDifficulty =
          highestQualifyingPracticeDifficulty == null ? item.difficulty : Math.max(highestQualifyingPracticeDifficulty, item.difficulty);
      } else {
        acc.PRACTICE.nonQualifyingCount++;
        acc.PRACTICE.nonQualifyingIds.push(item.id);
      }
      // CANON-V2-REMEDIATION Part 1A -- "2 of the last 3 VALID Practice
      // attempts" (Policy V2 Section 3). A "valid Practice attempt" is
      // any attempt that survives every check EXCEPT the score bar
      // itself -- exactly the two reason codes below (PASSING_SCORE and
      // INSUFFICIENT_SCORE only differ by that bar); WRONG_ACTIVITY_TYPE,
      // CRITICAL_MISCONCEPTION, PREMATURE_STAGE_EVIDENCE, and NOT_APPLICABLE
      // (out-of-range difficulty / a malformed contract) never occupy a
      // window slot at all. REINFORCE is an overlay only -- this engine
      // has no field distinguishing a REINFORCE-administered Practice
      // attempt from an ordinary one, so a Practice attempt performed
      // during REINFORCE counts identically here, by construction.
      const isWindowEligible = verdict.reasonCode === 'PASSING_SCORE' || verdict.reasonCode === 'INSUFFICIENT_SCORE';
      if (isWindowEligible) {
        practiceWindow.push(verdict.result === 'QUALIFIES');
        const passesInWindow = practiceWindow.slice(-3).filter(Boolean).length;
        if (!practiceSatisfied && passesInWindow >= 2) {
          practiceSatisfied = true;
          practiceBasis = 'V1_EVIDENCE';
          // A newly-satisfied Practice window resolves any rollback that
          // sent the learner back here for repair -- they are no longer
          // in REINFORCE, just ready to attempt the next stage normally.
          if (lastRollback?.rolledBackTo === 'PRACTICE') lastRollback = null;
        }
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
        // CANON-V2-REMEDIATION Part 2 -- a NEW qualifying Prove always
        // opens a brand new Retain cycle: its own two-strike counter
        // starts back at zero, regardless of any strikes accumulated
        // against a prior (now-superseded) qualifying Prove.
        retainStrikeCount = 0;
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
          // CANON-V2-REMEDIATION Part 1A -- the frozen product decision:
          // a rollback that lands on PRACTICE always starts a brand new
          // Practice qualification cycle. Prior Practice evidence stays
          // in History (never mutated) but no longer occupies a window
          // slot for the NEW requalification.
          practiceWindow = [];
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
        // CANON-V2-REMEDIATION Part 2 -- a qualifying Retain closes out
        // this cycle's strike count (moot for THIS cycle, but keeps the
        // counter clean for defensive clarity).
        retainStrikeCount = 0;
        acc.RETAIN.qualifyingCount++;
        acc.RETAIN.qualifyingIds.push(item.id);
        // Resolves a Transfer-triggered RETENTION_WEAKNESS rollback --
        // the requalification succeeded, no overlay remains active.
        if (lastRollback?.rolledBackTo === 'RETAIN') lastRollback = null;
      } else {
        acc.RETAIN.nonQualifyingCount++;
        acc.RETAIN.nonQualifyingIds.push(item.id);
        if (verdict.reasonCode === 'FAILED_ATTEMPT') {
          // CANON-V2-REMEDIATION Part 2 -- Policy V2 Section 6's
          // two-strike rule: a FIRST Retain failure in this cycle never
          // touches Prove/Retain satisfaction at all -- it simply
          // doesn't qualify (already recorded above), leaving RETAIN
          // immediately re-attemptable (its own eligibility gate is
          // unaffected, since proveQualifyingAt is untouched) with no
          // additional 3-day wait. Only the SECOND CONSECUTIVE failure
          // in this same cycle rolls back to PROVE.
          retainStrikeCount++;
          if (retainStrikeCount >= 2) {
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
            // The next real Prove that qualifies will reset this to 0
            // again anyway (Part 2 above) -- reset here too so the
            // in-between state (Prove now unsatisfied, no Prove yet)
            // never reports a stale nonzero strike count.
            retainStrikeCount = 0;
          }
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
          // Case D: rollback to the first requirement invalidated by
          // the misconception. Documented decision: treated as
          // foundational -- rolls all the way back to PRACTICE, since a
          // critical misconception undermines every stage built on top
          // of it, not just Transfer itself. This permanently
          // invalidates any recognition-seeded basis for every one of
          // these stages, for the rest of this replay, and -- per
          // CANON-V2-REMEDIATION Part 1A -- resets the Practice
          // qualification cycle exactly like any other rollback to
          // PRACTICE.
          practiceSatisfied = false;
          practiceBasis = null;
          practiceWindow = [];
          proveSatisfied = false;
          proveBasis = null;
          proveQualifyingAt = null;
          proveQualifyingDifficulty = null;
          retainSatisfied = false;
          retainBasis = null;
          retainQualifyingScore = null;
          retainStrikeCount = 0;
          transferSatisfied = false;
          transferBasis = null;
          lastRollback = makeRollback('TRANSFER', 'TRANSFER_CASE_D_CRITICAL_MISCONCEPTION', 'PRACTICE', ['CRITICAL_MISCONCEPTION']);
        } else if (verdict.reasonCode === 'FAILED_ATTEMPT' || verdict.reasonCode === 'MISSING_REQUIRED_REASONING') {
          transferSatisfied = false;
          transferBasis = null;
          // CANON-V2-REMEDIATION Part 4: qualification (did this attempt
          // pass?) and rollback DIAGNOSIS (why, and how far back?) stay
          // fully separate. A per-challenge/overall score pattern never
          // by itself implies any of the three classifications below --
          // only the EXPLICIT `transferFailureDiagnostic` signal
          // (produced by evidence dimensions outside this bare score,
          // out of this isolated engine's own scope to compute) decides.
          // Absent that signal, every failure defaults to the most
          // conservative classification: APPLICATION_CONTEXT_WEAKNESS --
          // the underlying Prove/Retention evidence remains valid, and
          // only a Transfer-focused retry is required.
          const diagnostic = item.transferFailureDiagnostic ?? 'APPLICATION_CONTEXT_WEAKNESS';
          if (diagnostic === 'FOUNDATIONAL_PROCEDURAL_FAILURE') {
            // Case C: foundational/procedural failure -- rolls back to
            // the earliest invalidated requirement, normally PRACTICE.
            // Resets the Practice qualification cycle (Part 1A).
            practiceSatisfied = false;
            practiceBasis = null;
            practiceWindow = [];
            proveSatisfied = false;
            proveBasis = null;
            proveQualifyingAt = null;
            proveQualifyingDifficulty = null;
            retainSatisfied = false;
            retainBasis = null;
            retainQualifyingScore = null;
            retainStrikeCount = 0;
            lastRollback = makeRollback('TRANSFER', 'TRANSFER_CASE_C_FOUNDATIONAL_PROCEDURAL_FAILURE', 'PRACTICE', [verdict.reasonCode]);
          } else if (diagnostic === 'RETENTION_WEAKNESS') {
            // Case B (CANON-V2-REMEDIATION, newly implemented): the
            // learner fails to retrieve previously-demonstrated
            // knowledge, but there is no explicit foundational/
            // procedural breakdown and no critical misconception --
            // PROVE remains valid. Rollback ONLY to RETAIN; its own
            // eligibility gate is anchored to the UNCHANGED
            // `proveQualifyingAt`, which is already in the past by the
            // time a Transfer attempt was even reachable -- so RETAIN
            // recomputes as immediately EXECUTABLE, never WAITING, with
            // no new 3-day wait.
            retainSatisfied = false;
            retainBasis = null;
            retainQualifyingScore = null;
            lastRollback = makeRollback('TRANSFER', 'TRANSFER_CASE_B_RETENTION_WEAKNESS', 'RETAIN', [verdict.reasonCode]);
          } else {
            // Case A: application-weak, knowledge intact -- Prove and
            // Retention remain valid; only a Transfer-focused REINFORCE
            // + a new Transfer attempt is required.
            lastRollback = makeRollback('TRANSFER', 'TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS', 'TRANSFER', [verdict.reasonCode]);
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
    transferFailureDiagnostic: e.transferFailureDiagnostic ?? null,
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
  // re-satisfied) that lands on PRACTICE, or Case A's own "stay
  // TRANSFER" retry, means the learner is under a REINFORCE
  // intervention -- an overlay on top of the underlying stage, never a
  // journey stage itself. CANON-V2-REMEDIATION Part 2/4: a rollback
  // that lands on PROVE (Retain's second-strike failure) or RETAIN
  // (Transfer's Case B) is deliberately EXCLUDED here -- Policy V2
  // describes both as producing a normal, immediately-executable real
  // Prove/Retain attempt, never a Practice-shaped remediation overlay.
  let intervention: 'REINFORCE' | null =
    state.lastRollback && (state.lastRollback.rolledBackTo === 'PRACTICE' || state.lastRollback.rolledBackTo === 'TRANSFER')
      ? 'REINFORCE'
      : null;

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

  // CANON-V2-REMEDIATION Part 4 (discovered defect, fixed alongside the
  // rest of this remediation): REINFORCE's own Practice-shaped contract
  // (2-3 items, the reinforce difficulty band) must NEVER be substituted
  // for a DIFFERENT stage's real contract merely because `intervention`
  // is reported as REINFORCE for observability. The only case where
  // `intervention === 'REINFORCE'` and `stage !== 'PRACTICE'` is Case A
  // (stay TRANSFER) -- and Policy V2 Section 7 is explicit that this
  // administers a real, 3-challenge Transfer retry, not a 2-3 item
  // Practice drill. `applyReinforceShape` is the ONLY signal
  // `buildActivityContract` receives for "shape this as REINFORCE" --
  // decoupled from the top-level `intervention` field reported on the
  // decision, which still reads REINFORCE for both cases (an unchanged,
  // already-certified observability fact).
  const applyReinforceShape = intervention === 'REINFORCE' && stage === 'PRACTICE';

  // CANON-R2R1 Part 9-17: DifficultyPolicy -- always evidence-driven,
  // never a static stage-only midpoint. `practiceDifficulty` is computed
  // unconditionally because REINFORCE's own target derives from it
  // regardless of which stage the rollback landed on.
  const practiceDifficulty = resolvePracticeDifficulty(state.sorted.filter((e) => e.activityType === 'PRACTICE'));
  let difficultyResolution: DifficultyResolution;
  if (applyReinforceShape) {
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

  const activityContract = buildActivityContract(stage, applyReinforceShape ? 'REINFORCE' : null, difficultyResolution);

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
    // Verbatim from `state.proveQualifyingAt` -- the SAME value
    // `retainStatus`'s own `eligibleFrom` computation above already
    // used. Never independently recomputed.
    lastQualifyingProveAt: state.proveQualifyingAt,
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
