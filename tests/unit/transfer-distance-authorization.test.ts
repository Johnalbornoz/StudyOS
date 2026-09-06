/**
 * Phase 7 -- Step 7E2: pure server-side transfer-distance authorization.
 */
import { describe, it, expect } from 'vitest';
import {
  maxAuthorizedTransferDistance,
  authorizeRequestedTransferDistance,
} from '@/lib/transfer-distance-authorization';

describe('7E2 -- maxAuthorizedTransferDistance', () => {
  it('no row / NONE -> NEAR', () => {
    expect(maxAuthorizedTransferDistance(null)).toBe('NEAR');
    expect(maxAuthorizedTransferDistance('NONE')).toBe('NEAR');
  });
  it('NEAR_DEMONSTRATED -> MID (one step up, never straight to FAR)', () => {
    expect(maxAuthorizedTransferDistance('NEAR_DEMONSTRATED')).toBe('MID');
  });
  it('GENERALIZED / ROBUST -> FAR', () => {
    expect(maxAuthorizedTransferDistance('GENERALIZED')).toBe('FAR');
    expect(maxAuthorizedTransferDistance('ROBUST')).toBe('FAR');
  });
});

describe('7E2 -- authorizeRequestedTransferDistance', () => {
  it('a request within the ceiling passes through unchanged', () => {
    expect(authorizeRequestedTransferDistance('MID', 'NEAR_DEMONSTRATED')).toMatchObject({
      authorized: 'MID',
      requested: 'MID',
      clamped: false,
      maxAuthorized: 'MID',
    });
  });
  it('FAR requested with NONE depth is clamped to NEAR', () => {
    expect(authorizeRequestedTransferDistance('FAR', null)).toMatchObject({ authorized: 'NEAR', clamped: true });
  });
  it('FAR requested with NEAR_DEMONSTRATED is clamped to MID', () => {
    expect(authorizeRequestedTransferDistance('FAR', 'NEAR_DEMONSTRATED')).toMatchObject({ authorized: 'MID', clamped: true });
  });
  it('FAR requested with GENERALIZED is allowed', () => {
    expect(authorizeRequestedTransferDistance('FAR', 'GENERALIZED')).toMatchObject({ authorized: 'FAR', clamped: false });
  });
  it('a garbage / missing requested value normalizes to NEAR', () => {
    expect(authorizeRequestedTransferDistance(undefined, 'GENERALIZED')).toMatchObject({ requested: 'NEAR', authorized: 'NEAR' });
    expect(authorizeRequestedTransferDistance('SUPER_FAR', 'GENERALIZED').authorized).toBe('NEAR');
  });
  it('a lower request is never raised to the ceiling', () => {
    expect(authorizeRequestedTransferDistance('NEAR', 'GENERALIZED')).toMatchObject({ authorized: 'NEAR', clamped: false });
  });
});
