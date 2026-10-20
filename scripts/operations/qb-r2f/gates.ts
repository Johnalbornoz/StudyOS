/**
 * QB-R2F -- the PRE-REGISTERED criteria of the next run (pure, no IO). FROZEN with the validators.
 *
 * THE CRITERIA AND THEIR THRESHOLDS ARE QB-R2E's, UNCHANGED: they are taken from the QB-R2E pre-registration object,
 * not retyped, and the EVALUATOR is QB-R2E's own function. What differs is listed in `R2F_DELTAS`, each with its
 * reason; every delta either names what this run compares with or records a definition that changed because the
 * mechanism it describes changed. No delta makes a criterion easier to pass.
 */
import { evaluateGates, PRE_REGISTRATION, type AdaptationResult, type GateEvaluation } from '../qb-r2e/gates';

export const R2F_PRE_REGISTRATION = {
  id: 'qb-r2f-pre-registration', version: '1', basedOn: { id: PRE_REGISTRATION.id, version: PRE_REGISTRATION.version },
  criteria: PRE_REGISTRATION.criteria,
  verdict: PRE_REGISTRATION.verdict,
  definitions: {
    ...PRE_REGISTRATION.definitions,
    ADAPTATION: 'One of the 20 selected adaptation specifications (scripts/operations/qb-r2f/selection.ts, frozen).',
    ATTEMPT_1: 'The first call for an adaptation: its prompt with attempt = 1. Exactly one call. There is NO automatic retry of any kind. First attempts are made IN SELECTION ORDER, because the prompt of each names the parameter sets and scenarios the earlier ones used.',
    ATTEMPT_2: 'The ONE regeneration: the adaptation\'s prompt with attempt = 2, no hint of what failed, and the do-not-reuse lists of the whole first round. Exactly one call. Made if and only if ATTEMPT_1 is REGENERABLE; regenerations are made in selection order. There is no attempt 3.',
    GATE_FAIL: 'For a candidate, any of the gates of validators REVISION 4: structural FAIL; profileCompliance FAIL (which includes the item demand policy); constructPreservation FAIL; answerKey FAILED; machineRecomputation FAIL; stimulusIntegrity FAIL; originality other than PASS_LOW_SIMILARITY; lineage FAIL; learnerTextLeakage FAIL.',
    SIBLINGS_FOR_ORIGINALITY: 'A first attempt is compared with the first attempts of the other adaptations; a final attempt with the final attempts of the other adaptations. Both are also compared with every QB-R2D candidate, every QB-R2E candidate and the QB-R2B and QB-R2C pilot drafts.',
    MATERIAL_ORIGINALITY_FAILURE: 'An originality outcome other than PASS_LOW_SIMILARITY: textual similarity >= 0.5 (REVIEW) or >= 0.8 (REJECT) under the existing gate; the same construct with identical parameter values as another candidate; OR, new in revision 4, a whole parameter set, or a defining pair of parameter values of the construct (for example the amount and the quantity of one option, or the two coordinates of one point), shared with another candidate of the fresh batch, of QB-R2D or of QB-R2E; OR a scenario similarity of at least 0.4 with another fresh candidate of the same task family.',
    SAME_FAMILY_PROOF: PRE_REGISTRATION.definitions.SAME_FAMILY_PROOF,
    APPROACH_PROOF: 'The three pairs (06,07) (08,09) (10,11). PASS when in EVERY pair: both items are CLEAN; concept id, invariant hash and declared construct are identical; the two items do NOT share a parameter set and are not near-duplicate scenarios (neither has a batch-diversity finding against the other); the baseline is recorded by absence and STEM_PLUS explicitly; every unmet preference carries its overriding rule, and a rule authority exactly when it carries a certification status. AND the school pair differs in response format in specification and items; AND the PAA pair has at least one preference overridden by an OFFICIAL rule while both items keep the same response format.',
    REQUEST_REJECTED: PRE_REGISTRATION.definitions.REQUEST_REJECTED,
    PLAN_FITS_THE_CAP: 'Before the first call the run computes the worst case of the WHOLE plan (40 calls at the output cap, each prompt bounded from the actual prompts plus the largest the do-not-reuse lists can become) and refuses to start unless prior spend + that worst case is within the cumulative cap. The per-call guard stays in force as well.',
  },
  choices: PRE_REGISTRATION.choices,
} as const;

export const R2F_DELTAS = [
  'Validators revision 4 instead of revision 3: two demonstrated bugs corrected (V1, V2) and checks added. GATE_FAIL names revision 4.',
  'MATERIAL_ORIGINALITY_FAILURE is WIDER: a shared whole parameter set or defining pair of parameter values, and near-duplicate scenarios within a task family, now count. The prior corpus now includes QB-R2E. (Stricter.)',
  'APPROACH_PROOF names the new pairs, and additionally requires that the two items of a pair are not near-duplicate scenarios. (Stricter.)',
  'ATTEMPT_1 / ATTEMPT_2: attempts are made in selection order, because each prompt carries the do-not-reuse lists built from the answers before it. The rule of the one regeneration is unchanged.',
  'PLAN_FITS_THE_CAP is new: the run refuses to start unless the worst case of the whole plan fits the cumulative cap. (Stricter.)',
  'ADAPTATION points at the new selection. SAME_FAMILY_PROOF is word for word QB-R2E\'s; it applies to adaptations 01-05 of the new selection.',
  'No threshold changed. No definition was found defective in itself: the two defects of QB-R2E were in validator code, not in the definitions.',
] as const;

/** QB-R2E's evaluator, applied unchanged; only the name of the pre-registration it reports differs. */
export function evaluateR2fGates(p: Parameters<typeof evaluateGates>[0]): GateEvaluation {
  return { ...evaluateGates(p), preRegistration: { id: R2F_PRE_REGISTRATION.id, version: R2F_PRE_REGISTRATION.version } };
}
export type { AdaptationResult };
