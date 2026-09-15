/**
 * CANON-R3 Part 19-21 -- THE SHADOW COMPARATOR.
 *
 * Pure. Deterministic. Never labels every disagreement "new engine
 * correct," never emits a bare "MISMATCH" -- every outcome carries at
 * least one closed-vocabulary `DisagreementReasonCode` and a
 * `ComparisonResult` category chosen by explicit, documented rules
 * below (never a coin flip, never a default-to-blame-one-side).
 */
import type {
  AdapterConfidence,
  AdapterUnresolvedMapping,
  ComparisonOutcome,
  ComparisonResult,
  DisagreementReasonCode,
  NewCanonicalSnapshot,
  OldCanonicalSnapshot,
} from './types';

/**
 * The OLD model's `LearnerJourneyStage` vocabulary (NOT_STARTED, LEARN,
 * PRACTICE, READY_TO_PROVE, PROVE, RETAIN, TRANSFER, CONSOLIDATED) and
 * the NEW engine's `PedagogicalStage` vocabulary (LEARN, PRACTICE,
 * PROVE, RETAIN, TRANSFER, CONSOLIDATED) are genuinely different --
 * this is the ONE documented equivalence table the comparator uses to
 * decide whether two differently-spelled stages represent the SAME
 * underlying position. NOT_STARTED and READY_TO_PROVE (the old model's
 * two finer-grained states with no v1-engine counterpart) fold into
 * LEARN and PROVE respectively.
 */
const OLD_TO_NEW_STAGE_EQUIVALENT: Record<string, string> = {
  NOT_STARTED: 'LEARN',
  LEARN: 'LEARN',
  PRACTICE: 'PRACTICE',
  READY_TO_PROVE: 'PROVE',
  PROVE: 'PROVE',
  RETAIN: 'RETAIN',
  TRANSFER: 'TRANSFER',
  CONSOLIDATED: 'CONSOLIDATED',
};

function hasUnresolved(adapter: readonly AdapterUnresolvedMapping[], reason: AdapterUnresolvedMapping['reason']): boolean {
  return adapter.some((u) => u.reason === reason);
}

function outcome(result: ComparisonResult, reasonCodes: DisagreementReasonCode[], explanation: string): ComparisonOutcome {
  return { result, reasonCodes, explanation };
}

/**
 * `adapterMetadata` is deliberately narrowed to just what the comparator
 * needs (never the raw evidence items themselves -- the comparator has
 * no business reading scores/counts directly; it reasons only about
 * WHY the two decisions differ, using the adapter's own already-computed
 * gap list).
 */
export interface ComparatorAdapterMetadata {
  unresolved: readonly AdapterUnresolvedMapping[];
  confidence: AdapterConfidence;
}

export function compareCanonicalDecisions(
  oldSnapshot: OldCanonicalSnapshot,
  newDecision: NewCanonicalSnapshot,
  adapterMetadata: ComparatorAdapterMetadata,
): ComparisonOutcome {
  if (oldSnapshot.stage == null) {
    return outcome(
      'UNRESOLVED',
      ['OLD_SNAPSHOT_FIELD_UNAVAILABLE'],
      'The current canonical model produced no stage for this concept (no Concept Knowledge State row, or the read failed) -- there is nothing to compare against.',
    );
  }

  const oldEquivalent = OLD_TO_NEW_STAGE_EQUIVALENT[oldSnapshot.stage] ?? null;
  if (oldEquivalent == null) {
    return outcome(
      'UNRESOLVED',
      ['STAGE_VOCABULARY_DIFFERS'],
      `Old stage "${oldSnapshot.stage}" has no documented equivalence-table entry -- the comparator will not guess a mapping.`,
    );
  }

  const stagesEquivalent = oldEquivalent === newDecision.stage;

  if (stagesEquivalent) {
    // Same underlying position -- but the two models could still
    // disagree on whether it is actionable right now (e.g. Retention
    // gating). This is exactly the axis CANON-R2R1's stricter 3-day/
    // exact-item-count Retention policy is expected to differ on.
    const actionsRoughlyAgree =
      (oldSnapshot.actionState === 'WAITING') === (newDecision.actionState === 'WAITING') &&
      (oldSnapshot.actionState === 'CONSOLIDATED') === (newDecision.actionState === 'CONSOLIDATED');
    if (actionsRoughlyAgree) {
      return outcome('MATCH', ['NO_DISAGREEMENT'], `Both models agree: stage=${newDecision.stage}, actionState roughly equivalent (old=${oldSnapshot.actionState ?? 'null'}, new=${newDecision.actionState}).`);
    }
    return outcome(
      'EXPECTED_POLICY_DIFFERENCE',
      ['ACTION_STATE_DIFFERS_SAME_STAGE'],
      `Same stage (${newDecision.stage}) but different executability: old actionState=${oldSnapshot.actionState ?? 'null'}, new actionState=${newDecision.actionState}. The frozen v1 engine's stricter gating (exact item counts, the 3-day Retention minimum, LEARN's own comprehension checkpoint) is expected to produce this class of difference even at the same stage.`,
    );
  }

  // Stages genuinely differ. Diagnose WHY, cheapest and most specific
  // explanation first -- an adapter gap always outranks a policy-vs-
  // model judgment, since a gap in the DATA makes any conclusion about
  // the MODELS themselves unreliable.
  if (!hasStageEvidenceLearnCheck(adapterMetadata) && newDecision.stage === 'LEARN' && oldEquivalent !== 'LEARN') {
    return outcome(
      'ADAPTER_DATA_GAP',
      ['NEW_LEARN_BLOCKED_BECAUSE_LEARN_CHECK_NOT_AVAILABLE'],
      `New engine reports LEARN because no LEARN_CHECK-equivalent evidence source exists in real StudyUS data for this concept -- this is an adapter limitation, not a new-engine defect. Old model reported ${oldSnapshot.stage} using a different (more permissive) definition of "has learned."`,
    );
  }

  if (hasUnresolved(adapterMetadata.unresolved, 'ITEM_COUNT_NOT_AVAILABLE')) {
    // The single most common, most expected source of a stage
    // disagreement: historical 6-question quick_check/retention_check
    // evidence meeting the frozen v1 engine's exact-10 policy.
    return outcome(
      'EXPECTED_POLICY_DIFFERENCE',
      ['HISTORICAL_ITEM_COUNT_DOES_NOT_MEET_NEW_POLICY'],
      `Old stage ${oldSnapshot.stage} vs. new stage ${newDecision.stage}: historical evidence for this concept does not carry a reliable item count, so the frozen v1 engine cannot treat it as a qualifying Prove/Retention/Transfer attempt under its exact-count policy (10/10/3). This is a deliberate, known policy tightening, not a defect in either model.`,
    );
  }

  if (hasUnresolved(adapterMetadata.unresolved, 'TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE') && (newDecision.stage === 'TRANSFER' || oldEquivalent === 'TRANSFER')) {
    return outcome(
      'ADAPTER_DATA_GAP',
      ['TRANSFER_BREAKDOWN_UNAVAILABLE'],
      `Transfer evidence for this concept has no 3-challenge breakdown in real StudyUS data (Transfer tasks are recorded individually, not as one 3-challenge attempt) -- the new engine cannot evaluate Transfer qualification at all for this evidence, regardless of what the old model concluded.`,
    );
  }

  if (oldEquivalent === 'RETAIN' && newDecision.stage === 'PRACTICE') {
    return outcome(
      'OLD_MODEL_INCONSISTENCY',
      ['OLD_RETAIN_NEW_PRACTICE_BECAUSE_NO_QUALIFIED_PROVE'],
      `Old model reports RETAIN, but the new engine finds no evidence qualifying as an independent Prove attempt at all under the frozen v1 contract -- the old model advanced past a gate the new engine's stricter evidence qualification does not consider satisfied.`,
    );
  }

  if (oldEquivalent === 'TRANSFER' && newDecision.stage === 'RETAIN') {
    return outcome(
      'OLD_MODEL_INCONSISTENCY',
      ['OLD_TRANSFER_NEW_RETAIN_BECAUSE_RETENTION_UNSATISFIED'],
      `Old model reports TRANSFER, but the new engine finds Retention not yet satisfied under the frozen v1 contract -- the same class of premature-sequencing gap UX/CANON-R1 previously fixed once in the old model itself; this instance's specific concept/evidence may still exhibit it.`,
    );
  }

  if (adapterMetadata.confidence === 'LOW') {
    return outcome(
      'UNRESOLVED',
      ['STAGE_VOCABULARY_DIFFERS'],
      `Old stage ${oldSnapshot.stage} vs. new stage ${newDecision.stage} disagree, and adapter confidence is LOW for this evidence set -- too many unresolved mappings to attribute the disagreement to either model specifically.`,
    );
  }

  return outcome(
    'NEW_MODEL_POSSIBLE_DEFECT',
    ['STAGE_VOCABULARY_DIFFERS'],
    `Old stage ${oldSnapshot.stage} vs. new stage ${newDecision.stage} disagree with HIGH adapter confidence and no known adapter gap or expected policy difference explaining it -- flagged for investigation outside this phase (CANON-R2R1's engine is frozen; not modified here).`,
  );
}

function hasStageEvidenceLearnCheck(adapterMetadata: ComparatorAdapterMetadata): boolean {
  return !hasUnresolved(adapterMetadata.unresolved, 'LEARN_CHECK_SOURCE_UNAVAILABLE');
}
