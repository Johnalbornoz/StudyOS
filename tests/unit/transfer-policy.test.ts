/**
 * Phase 7 -- Step 7A1: Transfer Policy Foundation.
 *
 * Pure/deterministic tests for src/lib/transfer-policy.ts: the taxonomy
 * (no enum drift), transfer-evidence qualification, distance <-> novelty
 * compatibility, and the monotonic transfer-depth state machine. No DB,
 * no AI, no clock, no runtime wiring.
 */
import { describe, it, expect } from 'vitest';
import {
  TRANSFER_POLICY_VERSION,
  TRANSFER_DISTANCE_VALUES,
  NOVELTY_DIMENSIONS,
  TRANSFER_MODALITIES,
  TRANSFER_DEPTH_VALUES,
  validateTransferDistanceNovelty,
  isSurfaceOnlyNovelty,
  qualifiesAsTransferEvidence,
  isSuccessfulTransferAttempt,
  isPartialTransferAttempt,
  transferDepthTransition,
  type TransferAttemptInput,
  type NoveltyDimension,
  type TransferDistance,
  type TransferDepthPriorState,
  type TransferDepthAttempt,
} from '@/lib/transfer-policy';

// ---------------------------------------------------------------------
// Taxonomy -- exact, no drift
// ---------------------------------------------------------------------
describe('7A1 -- taxonomy', () => {
  it('policy version is 1', () => {
    expect(TRANSFER_POLICY_VERSION).toBe(1);
  });
  it('TransferDistance values are exactly NEAR/MID/FAR', () => {
    expect([...TRANSFER_DISTANCE_VALUES]).toEqual(['NEAR', 'MID', 'FAR']);
  });
  it('TransferDepth values are exactly NONE/NEAR_DEMONSTRATED/GENERALIZED/ROBUST', () => {
    expect([...TRANSFER_DEPTH_VALUES]).toEqual(['NONE', 'NEAR_DEMONSTRATED', 'GENERALIZED', 'ROBUST']);
  });
  it('TransferModality values are exactly STRUCTURAL/REPRESENTATIONAL', () => {
    expect([...TRANSFER_MODALITIES]).toEqual(['STRUCTURAL', 'REPRESENTATIONAL']);
  });
  it('NoveltyDimension set is exactly the approved eight', () => {
    expect([...NOVELTY_DIMENSIONS].sort()).toEqual(
      [
        'CONCEPT_COMBINATION',
        'CONSTRAINT',
        'CONTEXT',
        'DATA_PRESENTATION',
        'GOAL_FRAMING',
        'REPRESENTATION',
        'STRATEGY',
        'SURFACE',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------
// qualification
// ---------------------------------------------------------------------
function attempt(overrides: Partial<TransferAttemptInput> = {}): TransferAttemptInput {
  return {
    activityType: 'TRANSFER',
    evidenceMode: 'INDEPENDENT',
    aiAssisted: false,
    operationKeyValid: true,
    taskIdentityValid: true,
    duplicateFingerprint: false,
    sameQuestionFallback: false,
    noveltyValidationPassed: true,
    transferDistance: 'NEAR',
    transferModality: 'STRUCTURAL',
    noveltyDimensions: ['CONTEXT'],
    targetConceptIds: [],
    targetConceptsIndependent: true,
    outcome: 'SUCCESS',
    attemptedAt: '2026-09-06T00:00:00.000Z',
    taskFamilyId: 'fam-1',
    ...overrides,
  };
}

describe('7A1 -- qualifiesAsTransferEvidence', () => {
  it('valid NEAR independent task qualifies', () => {
    expect(qualifiesAsTransferEvidence(attempt({ transferDistance: 'NEAR', noveltyDimensions: ['CONTEXT'] })).qualifies).toBe(true);
  });
  it('valid MID independent task qualifies', () => {
    expect(qualifiesAsTransferEvidence(attempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'] })).qualifies).toBe(true);
  });
  it('valid FAR independent task with independent targets qualifies', () => {
    const r = qualifiesAsTransferEvidence(
      attempt({ transferDistance: 'FAR', noveltyDimensions: ['CONCEPT_COMBINATION'], targetConceptIds: ['c-2'], targetConceptsIndependent: true }),
    );
    expect(r.qualifies).toBe(true);
  });
  it('PARTIAL and FAILURE are still qualifying ATTEMPTS', () => {
    expect(qualifiesAsTransferEvidence(attempt({ outcome: 'PARTIAL' })).qualifies).toBe(true);
    expect(qualifiesAsTransferEvidence(attempt({ outcome: 'FAILURE' })).qualifies).toBe(true);
  });

  const negatives: Array<[string, Partial<TransferAttemptInput>, string]> = [
    ['practice mode', { evidenceMode: 'PRACTICE' }, 'NOT_INDEPENDENT'],
    ['non-transfer activity', { activityType: 'PRACTICE' }, 'NOT_TRANSFER_ACTIVITY'],
    ['ai-assisted', { aiAssisted: true }, 'AI_ASSISTED'],
    ['invalid operation identity', { operationKeyValid: false }, 'INVALID_OPERATION_IDENTITY'],
    ['invalid task identity', { taskIdentityValid: false }, 'INVALID_TASK_IDENTITY'],
    ['duplicate fingerprint', { duplicateFingerprint: true }, 'DUPLICATE_TASK'],
    ['same-question fallback', { sameQuestionFallback: true }, 'SAME_QUESTION_FALLBACK'],
    ['novelty not validated', { noveltyValidationPassed: false }, 'NOVELTY_NOT_VALIDATED'],
    ['no novelty', { noveltyDimensions: [] }, 'NO_NOVELTY'],
    ['MID with only CONTEXT', { transferDistance: 'MID', noveltyDimensions: ['CONTEXT'] }, 'DISTANCE_NOVELTY_MISMATCH'],
    [
      'FAR target not independent',
      { transferDistance: 'FAR', noveltyDimensions: ['CONSTRAINT'], targetConceptIds: ['c-2'], targetConceptsIndependent: false },
      'FAR_TARGET_NOT_INDEPENDENT',
    ],
  ];
  for (const [label, ov, reason] of negatives) {
    it(`does not qualify: ${label}`, () => {
      const r = qualifiesAsTransferEvidence(attempt(ov));
      expect(r.qualifies).toBe(false);
      expect(r.reasons).toContain(reason);
    });
  }

  it('reasons never throw and accumulate multiple failures', () => {
    const r = qualifiesAsTransferEvidence(attempt({ evidenceMode: 'PRACTICE', aiAssisted: true, noveltyDimensions: [] }));
    expect(r.qualifies).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining(['NOT_INDEPENDENT', 'AI_ASSISTED', 'NO_NOVELTY']));
  });
});

// ---------------------------------------------------------------------
// distance <-> novelty
// ---------------------------------------------------------------------
describe('7A1 -- validateTransferDistanceNovelty', () => {
  const cases: Array<[TransferDistance, NoveltyDimension[], boolean]> = [
    ['NEAR', ['CONTEXT'], true],
    ['NEAR', ['SURFACE'], true],
    ['NEAR', ['CONTEXT', 'CONSTRAINT'], true], // richer novelty never invalidates NEAR
    ['NEAR', [], false],
    ['MID', ['CONTEXT'], false],
    ['MID', ['SURFACE'], false],
    ['MID', ['CONTEXT', 'SURFACE'], false],
    ['MID', ['REPRESENTATION'], true],
    ['MID', ['STRATEGY'], true],
    ['MID', ['DATA_PRESENTATION'], true],
    ['MID', ['CONTEXT', 'STRATEGY'], true],
    ['FAR', ['CONTEXT'], false],
    ['FAR', ['CONTEXT', 'SURFACE'], false],
    ['FAR', ['STRATEGY'], false], // "beyond surface" but not a generalizing dimension
    ['FAR', ['CONCEPT_COMBINATION'], true],
    ['FAR', ['GOAL_FRAMING'], true],
    ['FAR', ['CONSTRAINT'], true],
    ['FAR', ['CONTEXT', 'CONSTRAINT'], true],
  ];
  for (const [distance, dims, valid] of cases) {
    it(`${distance} + [${dims.join(',')}] -> ${valid ? 'valid' : 'invalid'}`, () => {
      expect(validateTransferDistanceNovelty(distance, dims).valid).toBe(valid);
    });
  }

  it('isSurfaceOnlyNovelty', () => {
    expect(isSurfaceOnlyNovelty(['CONTEXT', 'SURFACE'])).toBe(true);
    expect(isSurfaceOnlyNovelty(['CONTEXT', 'STRATEGY'])).toBe(false);
    expect(isSurfaceOnlyNovelty([])).toBe(false);
  });
});

// ---------------------------------------------------------------------
// success helpers
// ---------------------------------------------------------------------
describe('7A1 -- success helpers', () => {
  it('isSuccessful / isPartial', () => {
    expect(isSuccessfulTransferAttempt({ outcome: 'SUCCESS' })).toBe(true);
    expect(isSuccessfulTransferAttempt({ outcome: 'PARTIAL' })).toBe(false);
    expect(isPartialTransferAttempt({ outcome: 'PARTIAL' })).toBe(true);
    expect(isPartialTransferAttempt({ outcome: 'FAILURE' })).toBe(false);
  });
});

// ---------------------------------------------------------------------
// transfer depth transition
// ---------------------------------------------------------------------
function prior(overrides: Partial<TransferDepthPriorState> = {}): TransferDepthPriorState {
  return {
    depth: 'NONE',
    successfulDistances: [],
    successfulNoveltyDimensions: [],
    successfulTaskFamilyIds: [],
    ...overrides,
  };
}
function depthAttempt(overrides: Partial<TransferDepthAttempt> = {}): TransferDepthAttempt {
  return {
    qualifies: true,
    outcome: 'SUCCESS',
    transferDistance: 'NEAR',
    noveltyDimensions: ['CONTEXT'],
    taskFamilyId: 'fam-1',
    spacingSatisfied: false,
    ...overrides,
  };
}

describe('7A1 -- transferDepthTransition', () => {
  it('NONE + NEAR success -> NEAR_DEMONSTRATED', () => {
    const r = transferDepthTransition({ prior: prior(), attempt: depthAttempt({ transferDistance: 'NEAR' }) });
    expect(r.depth).toBe('NEAR_DEMONSTRATED');
    expect(r.advanced).toBe(true);
  });
  it('NONE + MID success -> NEAR_DEMONSTRATED', () => {
    expect(
      transferDepthTransition({ prior: prior(), attempt: depthAttempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'] }) }).depth,
    ).toBe('NEAR_DEMONSTRATED');
  });
  it('NONE + FAR success -> GENERALIZED', () => {
    const r = transferDepthTransition({
      prior: prior(),
      attempt: depthAttempt({ transferDistance: 'FAR', noveltyDimensions: ['CONCEPT_COMBINATION'] }),
    });
    expect(r.depth).toBe('GENERALIZED');
    expect(r.reason).toBe('ADVANCED_TO_GENERALIZED_VIA_FAR');
  });
  it('NEAR_DEMONSTRATED + FAR success -> GENERALIZED', () => {
    expect(
      transferDepthTransition({
        prior: prior({ depth: 'NEAR_DEMONSTRATED', successfulDistances: ['NEAR'], successfulNoveltyDimensions: ['CONTEXT'], successfulTaskFamilyIds: ['fam-1'] }),
        attempt: depthAttempt({ transferDistance: 'FAR', noveltyDimensions: ['GOAL_FRAMING'], taskFamilyId: 'fam-2' }),
      }).depth,
    ).toBe('GENERALIZED');
  });
  it('NEAR_DEMONSTRATED + second distinct-novelty success in a new family -> GENERALIZED (breadth)', () => {
    const r = transferDepthTransition({
      prior: prior({ depth: 'NEAR_DEMONSTRATED', successfulDistances: ['NEAR'], successfulNoveltyDimensions: ['CONTEXT'], successfulTaskFamilyIds: ['fam-1'] }),
      attempt: depthAttempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-2' }),
    });
    expect(r.depth).toBe('GENERALIZED');
    expect(r.reason).toBe('ADVANCED_TO_GENERALIZED_VIA_BREADTH');
  });
  it('NEAR_DEMONSTRATED + second distinct novelty but SAME family -> stays NEAR_DEMONSTRATED', () => {
    const r = transferDepthTransition({
      prior: prior({ depth: 'NEAR_DEMONSTRATED', successfulDistances: ['NEAR'], successfulNoveltyDimensions: ['CONTEXT'], successfulTaskFamilyIds: ['fam-1'] }),
      attempt: depthAttempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-1' }),
    });
    expect(r.depth).toBe('NEAR_DEMONSTRATED');
    expect(r.advanced).toBe(false);
  });
  it('GENERALIZED + spaced MID success in a different family -> ROBUST', () => {
    const r = transferDepthTransition({
      prior: prior({
        depth: 'GENERALIZED',
        successfulDistances: ['NEAR', 'FAR'],
        successfulNoveltyDimensions: ['CONTEXT', 'CONCEPT_COMBINATION'],
        successfulTaskFamilyIds: ['fam-1', 'fam-2'],
      }),
      attempt: depthAttempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-3', spacingSatisfied: true }),
    });
    expect(r.depth).toBe('ROBUST');
    expect(r.reason).toBe('ADVANCED_TO_ROBUST');
  });
  it('GENERALIZED + same-family rapid MID/FAR repeat -> remains GENERALIZED', () => {
    const r = transferDepthTransition({
      prior: prior({
        depth: 'GENERALIZED',
        successfulDistances: ['FAR'],
        successfulNoveltyDimensions: ['CONCEPT_COMBINATION'],
        successfulTaskFamilyIds: ['fam-1'],
      }),
      attempt: depthAttempt({ transferDistance: 'FAR', noveltyDimensions: ['CONCEPT_COMBINATION'], taskFamilyId: 'fam-1', spacingSatisfied: true }),
    });
    expect(r.depth).toBe('GENERALIZED');
    expect(r.advanced).toBe(false);
  });
  it('GENERALIZED + spaced success but SAME family -> remains GENERALIZED', () => {
    const r = transferDepthTransition({
      prior: prior({ depth: 'GENERALIZED', successfulDistances: ['FAR'], successfulNoveltyDimensions: ['GOAL_FRAMING'], successfulTaskFamilyIds: ['fam-1'] }),
      attempt: depthAttempt({ transferDistance: 'FAR', noveltyDimensions: ['GOAL_FRAMING'], taskFamilyId: 'fam-1', spacingSatisfied: true }),
    });
    expect(r.depth).toBe('GENERALIZED');
  });
  it('GENERALIZED + new family but spacing NOT satisfied -> remains GENERALIZED', () => {
    const r = transferDepthTransition({
      prior: prior({ depth: 'GENERALIZED', successfulDistances: ['FAR'], successfulNoveltyDimensions: ['CONSTRAINT'], successfulTaskFamilyIds: ['fam-1'] }),
      attempt: depthAttempt({ transferDistance: 'FAR', noveltyDimensions: ['CONSTRAINT'], taskFamilyId: 'fam-9', spacingSatisfied: false }),
    });
    expect(r.depth).toBe('GENERALIZED');
  });
  it('PARTIAL never advances', () => {
    expect(transferDepthTransition({ prior: prior(), attempt: depthAttempt({ outcome: 'PARTIAL' }) })).toMatchObject({
      depth: 'NONE',
      advanced: false,
      reason: 'NOT_A_QUALIFYING_SUCCESS',
    });
  });
  it('FAILURE never advances', () => {
    const r = transferDepthTransition({ prior: prior({ depth: 'NEAR_DEMONSTRATED' }), attempt: depthAttempt({ outcome: 'FAILURE' }) });
    expect(r.depth).toBe('NEAR_DEMONSTRATED');
  });
  it('non-qualifying success never advances', () => {
    expect(transferDepthTransition({ prior: prior(), attempt: depthAttempt({ qualifies: false }) }).depth).toBe('NONE');
  });
  it('ROBUST + failure remains ROBUST (monotonic, no demotion)', () => {
    expect(
      transferDepthTransition({
        prior: prior({ depth: 'ROBUST', successfulDistances: ['NEAR', 'MID', 'FAR'], successfulTaskFamilyIds: ['a', 'b', 'c'] }),
        attempt: depthAttempt({ outcome: 'FAILURE' }),
      }).depth,
    ).toBe('ROBUST');
  });
  it('ROBUST + later qualifying success remains ROBUST (never demotes)', () => {
    expect(
      transferDepthTransition({
        prior: prior({ depth: 'ROBUST', successfulDistances: ['FAR'], successfulNoveltyDimensions: ['CONSTRAINT'], successfulTaskFamilyIds: ['a', 'b'] }),
        attempt: depthAttempt({ transferDistance: 'NEAR', noveltyDimensions: ['CONTEXT'], taskFamilyId: 'z' }),
      }).depth,
    ).toBe('ROBUST');
  });
});

// ---------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------
describe('7A1 -- determinism', () => {
  it('same input -> same output across many runs (no clock/random/DB)', () => {
    const a = attempt({ transferDistance: 'FAR', noveltyDimensions: ['CONSTRAINT', 'CONTEXT'], targetConceptIds: ['x'], targetConceptsIndependent: true });
    const first = JSON.stringify(qualifiesAsTransferEvidence(a));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(qualifiesAsTransferEvidence(a))).toBe(first);
  });
  it('novelty-dimension ordering does not change qualification', () => {
    const r1 = qualifiesAsTransferEvidence(attempt({ transferDistance: 'MID', noveltyDimensions: ['CONTEXT', 'STRATEGY'] }));
    const r2 = qualifiesAsTransferEvidence(attempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY', 'CONTEXT'] }));
    expect(r1).toEqual(r2);
  });
  it('depth transition is order-insensitive to prior-array ordering', () => {
    const base = {
      depth: 'NEAR_DEMONSTRATED' as const,
      successfulNoveltyDimensions: ['CONTEXT'] as NoveltyDimension[],
      successfulDistances: ['NEAR'] as TransferDistance[],
    };
    const r1 = transferDepthTransition({
      prior: { ...base, successfulTaskFamilyIds: ['fam-1', 'fam-2'] },
      attempt: depthAttempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-3' }),
    });
    const r2 = transferDepthTransition({
      prior: { ...base, successfulTaskFamilyIds: ['fam-2', 'fam-1'] },
      attempt: depthAttempt({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-3' }),
    });
    expect(r1).toEqual(r2);
  });
});
