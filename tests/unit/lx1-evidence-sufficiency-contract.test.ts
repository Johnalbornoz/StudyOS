/**
 * LX-1D (repaired LX-1R) -- Evidence Sufficiency & Question-Count Contract.
 * Numbers come ONLY from the canonical mastery policy; anything a
 * canonical authority does not state is UNRESOLVED. No invented counts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveEvidenceRequirement,
  resolveQuestionCount,
  evidencePurposeForActivity,
  EVIDENCE_SUFFICIENCY_CONTRACT_VERSION,
  CURRENT_GENERATION_QUESTION_ENVELOPE,
  CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY,
  type EvidenceRequirementInputs,
} from '@/lib/lx/evidence-sufficiency-contract';
import { evidenceModeForActivity } from '@/lib/activity-taxonomy';
import type { MasteryPolicy } from '@/services/knowledge-state.service';

// The single active production policy (mastery_policies v1).
const POLICY: MasteryPolicy = {
  version: 1,
  minimumUnderstanding: 80,
  minimumIndependence: 80,
  minimumApplication: 75,
  minimumRetention: 75,
  minimumTransfer: 70,
  requiresTransfer: true,
  maximumCriticalMisconceptions: 0,
  minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 2,
  validationWindowDays: 14,
};

function inputs(over: Partial<EvidenceRequirementInputs>): EvidenceRequirementInputs {
  const activityType = over.activityType ?? 'PRACTICE';
  return {
    activityType,
    evidenceMode: over.evidenceMode ?? evidenceModeForActivity(activityType),
    targetDimension: over.targetDimension ?? 'UNDERSTANDING',
    masteryPolicy: over.masteryPolicy ?? POLICY,
    currentSufficiency: over.currentSufficiency,
    assessmentProfileId: over.assessmentProfileId,
  };
}

const SRC = readFileSync(join(process.cwd(), 'src/lib/lx/evidence-sufficiency-contract.ts'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('LX-1R -- no invented heuristics remain in the source', () => {
  it('no conceptCount * 2 heuristic and no conceptCount input', () => {
    expect(SRC).not.toMatch(/conceptCount\s*\*\s*2/);
    expect(SRC).not.toMatch(/conceptCount\s*[:?]/); // not a field / input
    // the only surviving mention is the doc string recording that it was removed
  });
  it('no coverageTargets / max(1,...) / max(2,...) pedagogical floors', () => {
    expect(SRC).not.toMatch(/coverageTargets/);
    expect(SRC).not.toMatch(/Math\.max\(\s*1\s*,/);
    expect(SRC).not.toMatch(/Math\.max\(\s*2\s*,/);
  });
  it('the only arithmetic on policy values is a non-negative gap (max(0, min - have))', () => {
    const gapExprs = SRC.match(/Math\.max\(0,\s*masteryPolicy\.\w+\s*-\s*\(?current\w+/g) ?? [];
    expect(gapExprs.length).toBe(2); // one for PRACTICE (total), one for PROVE (independent)
  });
});

describe('LX-1D purpose projection', () => {
  it('mirrors the canonical ActivityType', () => {
    expect(evidencePurposeForActivity('PRACTICE')).toBe('PRACTICE');
    expect(evidencePurposeForActivity('REVIEW')).toBe('PRACTICE');
    expect(evidencePurposeForActivity('SOLO_CHECK')).toBe('PROVE');
    expect(evidencePurposeForActivity('SOLO_VERIFY')).toBe('PROVE');
    expect(evidencePurposeForActivity('RETENTION_CHECK')).toBe('RETAIN');
    expect(evidencePurposeForActivity('TRANSFER')).toBe('TRANSFER');
    expect(evidencePurposeForActivity('DIAGNOSTIC_CHECK')).toBe('DIAGNOSE');
    expect(evidencePurposeForActivity('MOCK_EXAM')).toBe('ASSESS');
  });
});

describe('LX-1D PRACTICE / PROVE -- canonical mastery-policy gaps only', () => {
  it('PRACTICE: pedagogicalRequirement = max(0, minEvidenceCount - currentEvidenceCount); executionMinimum reported separately', () => {
    const fresh = deriveEvidenceRequirement(inputs({ activityType: 'PRACTICE' }));
    expect(fresh.questionCount.status).toBe('DETERMINED');
    if (fresh.questionCount.status === 'DETERMINED') {
      expect(fresh.questionCount.pedagogicalRequirement).toBe(3); // 3 - 0
      expect(fresh.questionCount.executionMinimum).toBe(CURRENT_GENERATION_QUESTION_ENVELOPE.min);
      expect(fresh.questionCount.source).toBe('MASTERY_POLICY_TOTAL_EVIDENCE_GAP');
    }

    const partial = deriveEvidenceRequirement(inputs({
      activityType: 'PRACTICE',
      currentSufficiency: { evidenceCount: 2, independentEvidenceCount: 0, passed: false },
    }));
    if (partial.questionCount.status === 'DETERMINED') expect(partial.questionCount.pedagogicalRequirement).toBe(1); // 3 - 2
  });

  it('PRACTICE: canonical gap of 0 is DETERMINED as 0 (not silently forced to 1)', () => {
    const done = deriveEvidenceRequirement(inputs({
      activityType: 'PRACTICE',
      currentSufficiency: { evidenceCount: 5, independentEvidenceCount: 3, passed: true },
    }));
    expect(done.questionCount.status).toBe('DETERMINED');
    if (done.questionCount.status === 'DETERMINED') {
      expect(done.questionCount.pedagogicalRequirement).toBe(0);
      expect(done.questionCount.executionMinimum).toBe(1);
    }
    // the execution layer still needs >=1 to launch -- expressed by resolveQuestionCount, not the pedagogical requirement
    const resolved = resolveQuestionCount(done);
    expect(resolved.status).toBe('DETERMINED');
    if (resolved.status === 'DETERMINED') expect(resolved.count).toBe(1);
  });

  it('PROVE: pedagogicalRequirement = max(0, minIndependentEvidenceCount - currentIndependentEvidenceCount)', () => {
    const r = deriveEvidenceRequirement(inputs({
      activityType: 'SOLO_CHECK',
      currentSufficiency: { evidenceCount: 5, independentEvidenceCount: 1, passed: false },
    }));
    expect(r.independentEvidenceRequired).toBe(true);
    if (r.questionCount.status === 'DETERMINED') {
      expect(r.questionCount.pedagogicalRequirement).toBe(1); // 2 - 1
      expect(r.questionCount.source).toBe('MASTERY_POLICY_INDEPENDENT_EVIDENCE_GAP');
    }
  });
});

describe('LX-1D RETAIN / TRANSFER / DIAGNOSE / ASSESS -- UNRESOLVED, no invented count', () => {
  it('RETAIN is UNRESOLVED, owned by PHASE_6_RETENTION', () => {
    const r = deriveEvidenceRequirement(inputs({ activityType: 'RETENTION_CHECK', targetDimension: 'RETENTION' }));
    expect(r.questionCount.status).toBe('UNRESOLVED');
    if (r.questionCount.status === 'UNRESOLVED') expect(r.questionCount.owner).toBe('PHASE_6_RETENTION');
    expect(resolveQuestionCount(r).status).toBe('UNRESOLVED');
  });

  it('TRANSFER is UNRESOLVED, owned by PHASE_7_TRANSFER', () => {
    const r = deriveEvidenceRequirement(inputs({ activityType: 'TRANSFER', targetDimension: 'TRANSFER' }));
    expect(r.questionCount.status).toBe('UNRESOLVED');
    if (r.questionCount.status === 'UNRESOLVED') expect(r.questionCount.owner).toBe('PHASE_7_TRANSFER');
  });

  it('DIAGNOSE is UNRESOLVED; the [2,4] route clamp is surfaced only as an execution shape', () => {
    const r = deriveEvidenceRequirement(inputs({ activityType: 'DIAGNOSTIC_CHECK' }));
    expect(r.questionCount.status).toBe('UNRESOLVED');
    if (r.questionCount.status === 'UNRESOLVED') expect(r.questionCount.owner).toBe('COGNITIVE_DIAGNOSIS');
    expect(r.currentGenerationShape).toEqual(CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY.DIAGNOSTIC_CHECK);
  });

  it('ASSESS is UNRESOLVED, owned by ASSESSMENT_BLUEPRINT (no blueprint authority exists)', () => {
    const r = deriveEvidenceRequirement(inputs({ activityType: 'CUMULATIVE_ASSESSMENT', targetDimension: 'VALIDATION', assessmentProfileId: 'CUMULATIVE_ASSESSMENT' }));
    expect(r.questionCount.status).toBe('UNRESOLVED');
    if (r.questionCount.status === 'UNRESOLVED') expect(r.questionCount.owner).toBe('ASSESSMENT_BLUEPRINT');
    expect(r.assessmentProfileId).toBe('CUMULATIVE_ASSESSMENT'); // canonical pass-through kept
  });
});

describe('LX-1D execution constraints are separated from pedagogical requirements', () => {
  it('SOLO_CHECK: PROVE requirement is DETERMINED, but the current forced-6 shape is surfaced separately', () => {
    const r = deriveEvidenceRequirement(inputs({ activityType: 'SOLO_CHECK' }));
    expect(r.questionCount.status).toBe('DETERMINED'); // independent-evidence gap is canonical
    expect(r.currentGenerationShape).toEqual({ min: 6, max: 6 }); // legacy execution shape, NOT the requirement
    const resolved = resolveQuestionCount(r);
    if (resolved.status === 'DETERMINED') expect(resolved.count).toBe(6); // clamped into the legacy shape
  });

  it('requiredDimensions is a strict projection of the canonical TargetDimension; [] for relational targets', () => {
    expect(deriveEvidenceRequirement(inputs({ targetDimension: 'RETENTION' })).requiredDimensions).toEqual(['retention']);
    expect(deriveEvidenceRequirement(inputs({ targetDimension: 'INDEPENDENCE' })).requiredDimensions).toEqual(['independence']);
    expect(deriveEvidenceRequirement(inputs({ targetDimension: 'MISCONCEPTION' })).requiredDimensions).toEqual([]);
    expect(deriveEvidenceRequirement(inputs({ targetDimension: 'EXAM_READINESS' })).requiredDimensions).toEqual([]);
  });

  it('carries canonical policy pass-through facts + contract version + rationale', () => {
    const r = deriveEvidenceRequirement(inputs({}));
    expect(r.contractVersion).toBe(EVIDENCE_SUFFICIENCY_CONTRACT_VERSION);
    expect(r.canonicalMinimumEvidenceCount).toBe(3);
    expect(r.canonicalMinimumIndependentEvidenceCount).toBe(2);
    expect(r.rationale.length).toBeGreaterThan(0);
  });
});
