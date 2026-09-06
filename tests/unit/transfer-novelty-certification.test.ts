/**
 * Phase 7 -- Step 7D2: pure tests for the deterministic server-side
 * novelty certifier. No DB, no AI, no clock.
 */
import { describe, it, expect } from 'vitest';
import { certifyStructuredTransferNovelty } from '@/lib/transfer-novelty-certification';

const base = {
  transferDistance: 'MID' as const,
  noveltyDimensions: ['STRATEGY'],
  fingerprintGuardEligible: true,
  requestedTargetConceptIds: [] as string[],
  resolvedTargetConceptIds: [] as string[],
};

describe('7D2 -- certifyStructuredTransferNovelty', () => {
  it('certifies a valid MID task with a qualifying dimension and a unique fingerprint', () => {
    const r = certifyStructuredTransferNovelty(base);
    expect(r).toEqual({ certified: true, reason: 'CERTIFIED', noveltyDimensions: ['STRATEGY'] });
  });

  it('NEAR needs only >= 1 dimension', () => {
    expect(certifyStructuredTransferNovelty({ ...base, transferDistance: 'NEAR', noveltyDimensions: ['CONTEXT'] }).certified).toBe(true);
  });

  it('rejects with NO_NOVELTY_DIMENSIONS when the generator proposed none', () => {
    const r = certifyStructuredTransferNovelty({ ...base, noveltyDimensions: [] });
    expect(r).toMatchObject({ certified: false, reason: 'NO_NOVELTY_DIMENSIONS' });
  });

  it('rejects with INVALID_NOVELTY_DIMENSION on a non-canonical value', () => {
    const r = certifyStructuredTransferNovelty({ ...base, noveltyDimensions: ['STRATEGY', 'VIBES'] });
    expect(r).toMatchObject({ certified: false, reason: 'INVALID_NOVELTY_DIMENSION' });
  });

  it('rejects MID that varies only surface dimensions (DISTANCE_NOVELTY_MISMATCH)', () => {
    const r = certifyStructuredTransferNovelty({ ...base, noveltyDimensions: ['CONTEXT', 'SURFACE'] });
    expect(r).toMatchObject({ certified: false, reason: 'DISTANCE_NOVELTY_MISMATCH' });
  });

  it('rejects FAR that lacks a generalizing dimension (DISTANCE_NOVELTY_MISMATCH)', () => {
    const r = certifyStructuredTransferNovelty({ ...base, transferDistance: 'FAR', noveltyDimensions: ['REPRESENTATION'] });
    expect(r).toMatchObject({ certified: false, reason: 'DISTANCE_NOVELTY_MISMATCH' });
  });

  it('certifies FAR with a generalizing dimension', () => {
    expect(
      certifyStructuredTransferNovelty({ ...base, transferDistance: 'FAR', noveltyDimensions: ['CONCEPT_COMBINATION'] }).certified,
    ).toBe(true);
  });

  it('rejects with STRUCTURAL_FINGERPRINT_NOT_UNIQUE when the 7B2 guard says the prompt is a recent duplicate', () => {
    const r = certifyStructuredTransferNovelty({ ...base, fingerprintGuardEligible: false });
    expect(r).toMatchObject({ certified: false, reason: 'STRUCTURAL_FINGERPRINT_NOT_UNIQUE' });
  });

  it('rejects with UNRESOLVED_TARGET_CONCEPT when a requested target concept did not resolve server-side', () => {
    const r = certifyStructuredTransferNovelty({
      ...base,
      requestedTargetConceptIds: ['c-1', 'c-2'],
      resolvedTargetConceptIds: ['c-1'],
    });
    expect(r).toMatchObject({ certified: false, reason: 'UNRESOLVED_TARGET_CONCEPT' });
  });

  it('certifies when every requested target concept resolved (order-independent)', () => {
    const r = certifyStructuredTransferNovelty({
      ...base,
      transferDistance: 'FAR',
      noveltyDimensions: ['CONCEPT_COMBINATION'],
      requestedTargetConceptIds: ['c-2', 'c-1'],
      resolvedTargetConceptIds: ['c-1', 'c-2'],
    });
    expect(r.certified).toBe(true);
  });

  it('is order-stable in its reason: distance is checked before the fingerprint guard', () => {
    // surface-only MID AND a duplicate fingerprint -> distance reason wins
    const r = certifyStructuredTransferNovelty({
      ...base,
      noveltyDimensions: ['CONTEXT'],
      fingerprintGuardEligible: false,
    });
    expect(r.reason).toBe('DISTANCE_NOVELTY_MISMATCH');
  });

  it('normalizes dimension case/whitespace before checking', () => {
    expect(certifyStructuredTransferNovelty({ ...base, noveltyDimensions: [' strategy '] }).certified).toBe(true);
  });

  it('is deterministic across repeated calls', () => {
    const once = certifyStructuredTransferNovelty(base);
    for (let i = 0; i < 50; i++) expect(certifyStructuredTransferNovelty(base)).toEqual(once);
  });
});
