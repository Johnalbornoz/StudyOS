/**
 * F8 -- pure unit tests for the intervention-selection algorithm.
 */
import { describe, it, expect } from 'vitest';
import { selectIntervention } from '@/lib/teaching/intervention-selection.service';
import type { InterventionPolicyRules } from '@/lib/teaching/types';
import type { GapDiagnosis } from '@/lib/diagnostics/types';

const POLICY: InterventionPolicyRules = {
  chains: {
    KNOWLEDGE_GAP: ['EXPLAIN', 'WORKED_EXAMPLE', 'GUIDED_PRACTICE'],
    SKILL_GAP: ['WORKED_EXAMPLE', 'GUIDED_PRACTICE', 'INDEPENDENT_PRACTICE'],
    EXAM_TECHNIQUE_GAP: ['EXPLAIN', 'WORKED_EXAMPLE', 'GUIDED_PRACTICE'],
    SPEED_FLUENCY_GAP: ['INDEPENDENT_PRACTICE'],
  },
  insufficientEvidenceChain: ['GUIDED_PRACTICE'],
  mixedTieBreakPriority: ['KNOWLEDGE_GAP', 'EXAM_TECHNIQUE_GAP', 'SKILL_GAP', 'SPEED_FLUENCY_GAP'],
};

function diagnosis(overrides: Partial<GapDiagnosis>): GapDiagnosis {
  return {
    primaryGapType: 'KNOWLEDGE_GAP',
    secondarySignals: [],
    confidence: 0.7,
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    reasonCodes: [],
    alternatives: [],
    ...overrides,
  };
}

describe('selectIntervention', () => {
  it('KNOWLEDGE_GAP resolves to its configured chain', () => {
    const rec = selectIntervention(diagnosis({ primaryGapType: 'KNOWLEDGE_GAP' }), POLICY);
    expect(rec.primary).toBe('EXPLAIN');
    expect(rec.chain).toEqual(['EXPLAIN', 'WORKED_EXAMPLE', 'GUIDED_PRACTICE']);
  });

  it('INSUFFICIENT_EVIDENCE never implies a gap diagnosis -- rationale says so explicitly', () => {
    const rec = selectIntervention(diagnosis({ primaryGapType: 'INSUFFICIENT_EVIDENCE', confidence: 0 }), POLICY);
    expect(rec.primary).toBe('GUIDED_PRACTICE');
    expect(rec.rationale).toContain('EVIDENCE_GATHERING_ONLY');
  });

  it('MIXED merges chains for every secondary signal, ordered by tie-break priority, de-duplicated', () => {
    const rec = selectIntervention(
      diagnosis({ primaryGapType: 'MIXED', secondarySignals: ['SKILL_GAP', 'KNOWLEDGE_GAP'] }),
      POLICY
    );
    // KNOWLEDGE_GAP outranks SKILL_GAP in mixedTieBreakPriority -> its chain's items come first.
    expect(rec.chain[0]).toBe('EXPLAIN');
    expect(new Set(rec.chain).size).toBe(rec.chain.length); // de-duplicated
    expect(rec.chain).toContain('INDEPENDENT_PRACTICE'); // from SKILL_GAP's own chain
  });

  it('PROVE never appears in any policy-driven chain', () => {
    for (const gapType of ['KNOWLEDGE_GAP', 'SKILL_GAP', 'EXAM_TECHNIQUE_GAP', 'SPEED_FLUENCY_GAP'] as const) {
      const rec = selectIntervention(diagnosis({ primaryGapType: gapType }), POLICY);
      expect(rec.chain).not.toContain('PROVE');
    }
  });

  it('deterministic given the same (diagnosis, policy)', () => {
    const d = diagnosis({ primaryGapType: 'EXAM_TECHNIQUE_GAP' });
    expect(selectIntervention(d, POLICY)).toEqual(selectIntervention(d, POLICY));
  });
});
