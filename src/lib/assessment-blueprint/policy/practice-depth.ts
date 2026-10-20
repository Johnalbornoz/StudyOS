/**
 * B2 -- practice depth: QUICK / BALANCED / DEEP as POLICY PRESETS (pure). The one place their meaning lives.
 *
 * A depth is not a number of questions. It states how much of each concept's canonical evidence deficit an
 * assessment should give an opportunity for, how strong the coverage must be, and how much variety to seek.
 * The number of questions is whatever the solver needs to satisfy that for the concepts in scope, given
 * how the available questions overlap.
 *
 *   QUICK     the shortest useful practice: one opportunity on every concept in scope; a concept may be
 *             covered as a SUPPORTING part of a question. It does not aim at evidence sufficiency.
 *   BALANCED  the normal practice: opportunities up to the canonical evidence deficit (bounded), at least one
 *             DIRECT per concept; variety preferred.
 *   DEEP      BALANCED first, then more: more of the deficit, more DIRECT coverage, and an independent
 *             demonstration per concept so no concept rests on a shared multi-concept question.
 *
 * Sources. EXISTING_CANONICAL_POLICY: the evidence / independent-evidence deficits come from
 * `mastery_policies` and `concept_knowledge_state`; the difficulty band and whether an activity is
 * independent come from the canonical pedagogical policy. B2_SELECTION_POLICY: the bounds below.
 */
import type { EvidenceNeed } from './evidence-requirement';

export const PRACTICE_DEPTHS = ['QUICK', 'BALANCED', 'DEEP'] as const;
export type PracticeDepth = (typeof PRACTICE_DEPTHS)[number];

export const PRACTICE_DEPTH_POLICY_VERSION = 'b2-practice-depth-1' as const;

export interface DepthPreset {
  /** Upper bound on opportunities per concept (the canonical deficit is used up to this bound). */
  opportunityCeiling: number;
  /** Opportunities a concept gets even when its canonical deficit is 0 (the Student still chose it). */
  opportunityFloor: number;
  /** DIRECT opportunities required per concept (never more than the opportunities). */
  directOpportunities: number;
  /** May a SUPPORTING coverage count as an opportunity? */
  acceptSupporting: boolean;
  /** Independent demonstrations per concept when the activity does NOT require independence. */
  baseIndependentDemonstrations: number;
  /** Upper bound on independent demonstrations when the activity DOES require independence (bounded by the canonical independent deficit). */
  independentCeiling: number;
  /** Variety sought (soft): distinct question types / difficulty levels. */
  diversity: { questionTypes: number; difficultyLevels: number };
}

/** B2_SELECTION_POLICY. No value here is a question count. */
export const DEPTH_PRESETS: Record<PracticeDepth, DepthPreset> = {
  QUICK: { opportunityCeiling: 1, opportunityFloor: 1, directOpportunities: 0, acceptSupporting: true, baseIndependentDemonstrations: 0, independentCeiling: 1, diversity: { questionTypes: 1, difficultyLevels: 1 } },
  BALANCED: { opportunityCeiling: 2, opportunityFloor: 1, directOpportunities: 1, acceptSupporting: true, baseIndependentDemonstrations: 0, independentCeiling: 2, diversity: { questionTypes: 2, difficultyLevels: 2 } },
  DEEP: { opportunityCeiling: 3, opportunityFloor: 2, directOpportunities: 2, acceptSupporting: true, baseIndependentDemonstrations: 1, independentCeiling: 3, diversity: { questionTypes: 3, difficultyLevels: 3 } },
};

export interface ConceptDepthRequirement {
  opportunities: number;
  directOpportunities: number;
  independentDemonstrations: number;
}

/**
 * What ONE concept needs at this depth, from its canonical evidence need.
 * @param requiresIndependence the activity's own canonical contract (a prove / retention check is independent).
 */
export function depthRequirementFor(need: EvidenceNeed, depth: PracticeDepth, requiresIndependence: boolean): ConceptDepthRequirement {
  const p = DEPTH_PRESETS[depth];
  const opportunities = Math.max(p.opportunityFloor, Math.min(p.opportunityCeiling, need.evidenceDeficit));
  // An independent activity must give the canonical independent deficit a chance (bounded); at least one demonstration.
  const independentDemonstrations = requiresIndependence ? Math.max(1, Math.min(p.independentCeiling, need.independentDeficit)) : p.baseIndependentDemonstrations;
  const directOpportunities = Math.max(Math.min(p.directOpportunities, Math.max(opportunities, independentDemonstrations)), independentDemonstrations);
  return { opportunities: Math.max(opportunities, directOpportunities), directOpportunities, independentDemonstrations };
}

/** The report table of the presets (machine-readable; the certification report prints it). */
export function depthPolicyTable(): Array<{ requirement: string; QUICK: string; BALANCED: string; DEEP: string; source: 'EXISTING_CANONICAL_POLICY' | 'B2_SELECTION_POLICY' }> {
  const row = (requirement: string, f: (p: DepthPreset) => string, source: 'EXISTING_CANONICAL_POLICY' | 'B2_SELECTION_POLICY') => ({ requirement, QUICK: f(DEPTH_PRESETS.QUICK), BALANCED: f(DEPTH_PRESETS.BALANCED), DEEP: f(DEPTH_PRESETS.DEEP), source });
  return [
    { requirement: 'evidence deficit per concept (minimum_evidence_count - evidence_count)', QUICK: 'read', BALANCED: 'read', DEEP: 'read', source: 'EXISTING_CANONICAL_POLICY' },
    { requirement: 'independent deficit per concept (minimum_independent_evidence_count - independent_evidence_count)', QUICK: 'read', BALANCED: 'read', DEEP: 'read', source: 'EXISTING_CANONICAL_POLICY' },
    { requirement: 'activity requires independence; difficulty band', QUICK: 'read', BALANCED: 'read', DEEP: 'read', source: 'EXISTING_CANONICAL_POLICY' },
    row('opportunities per concept = clamp(deficit, floor, ceiling)', (p) => `floor ${p.opportunityFloor}, ceiling ${p.opportunityCeiling}`, 'B2_SELECTION_POLICY'),
    row('DIRECT opportunities required per concept', (p) => String(p.directOpportunities), 'B2_SELECTION_POLICY'),
    row('SUPPORTING coverage counts as an opportunity', (p) => (p.acceptSupporting ? 'yes' : 'no'), 'B2_SELECTION_POLICY'),
    row('independent demonstrations per concept (non-independent activity)', (p) => String(p.baseIndependentDemonstrations), 'B2_SELECTION_POLICY'),
    row('independent demonstrations ceiling (independent activity)', (p) => String(p.independentCeiling), 'B2_SELECTION_POLICY'),
    row('variety sought: question types / difficulty levels (soft)', (p) => `${p.diversity.questionTypes} / ${p.diversity.difficultyLevels}`, 'B2_SELECTION_POLICY'),
    { requirement: 'DERIVED (objective-mapping) coverage counts for a concept', QUICK: 'no', BALANCED: 'no', DEEP: 'no', source: 'B2_SELECTION_POLICY' },
    { requirement: 'number of questions', QUICK: 'not a policy value', BALANCED: 'not a policy value', DEEP: 'not a policy value', source: 'B2_SELECTION_POLICY' },
  ];
}
