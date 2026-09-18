/**
 * F8 -- pure intervention-selection algorithm (task §13). No I/O, no
 * AI, deterministic given (diagnosis, policy). PROVE never appears in
 * a policy-driven chain -- it is reachable only by an explicit,
 * non-diagnosis-driven session request (see session.service.ts).
 */
import type { GapDiagnosis } from '@/lib/diagnostics/types';
import type { InterventionPolicyRules, InterventionRecommendation, InterventionType } from './types';

export function selectIntervention(diagnosis: GapDiagnosis, policy: InterventionPolicyRules): InterventionRecommendation {
  if (diagnosis.primaryGapType === 'INSUFFICIENT_EVIDENCE') {
    return {
      primary: policy.insufficientEvidenceChain[0],
      chain: policy.insufficientEvidenceChain,
      rationale: ['EVIDENCE_GATHERING_ONLY', ...diagnosis.reasonCodes],
      gapTypeConsidered: diagnosis.primaryGapType,
    };
  }

  if (diagnosis.primaryGapType === 'MIXED') {
    const seen = new Set<InterventionType>();
    const merged: InterventionType[] = [];
    for (const gapType of policy.mixedTieBreakPriority) {
      if (!diagnosis.secondarySignals.includes(gapType)) continue;
      for (const interventionType of policy.chains[gapType]) {
        if (!seen.has(interventionType)) {
          seen.add(interventionType);
          merged.push(interventionType);
        }
      }
    }
    return {
      primary: merged[0],
      chain: merged,
      rationale: diagnosis.reasonCodes,
      gapTypeConsidered: diagnosis.primaryGapType,
    };
  }

  const chain = policy.chains[diagnosis.primaryGapType];
  return {
    primary: chain[0],
    chain,
    rationale: diagnosis.reasonCodes,
    gapTypeConsidered: diagnosis.primaryGapType,
  };
}
