/**
 * F5 -- pure state classification (task 25, AC-F5-13: deterministic
 * replay). Zero IO, so this is the cheapest and strongest proof of
 * determinism: identical input always produces identical output.
 */
import { describe, it, expect } from 'vitest';
import { computeDimensionState } from '@/lib/learner-state/algorithms/state-classification';
import type { QualifyingEvidenceItem } from '@/lib/learner-state/types';

const RULES = { minimumEvidenceCount: 3 };

function item(overrides: Partial<QualifyingEvidenceItem>): QualifyingEvidenceItem {
  return { id: 'e1', result: 'correct', independent: true, occurredAt: '2026-01-01T00:00:00Z', ...overrides };
}

describe('computeDimensionState', () => {
  it('zero evidence -> NO_EVIDENCE', () => {
    const result = computeDimensionState([], RULES);
    expect(result).toEqual({ state: 'NO_EVIDENCE', evidenceCount: 0, independentEvidenceCount: 0, lastEvidenceAt: null });
  });

  it('below the minimum count -> INSUFFICIENT_EVIDENCE, even if all correct+independent', () => {
    const result = computeDimensionState([item({ id: 'a' }), item({ id: 'b' })], RULES);
    expect(result.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.evidenceCount).toBe(2);
  });

  it('meets the minimum, all recent independent+correct -> CONSISTENT_INDEPENDENT', () => {
    const result = computeDimensionState(
      [item({ id: 'a', occurredAt: '2026-01-03T00:00:00Z' }), item({ id: 'b', occurredAt: '2026-01-02T00:00:00Z' }), item({ id: 'c', occurredAt: '2026-01-01T00:00:00Z' })],
      RULES
    );
    expect(result.state).toBe('CONSISTENT_INDEPENDENT');
  });

  it('meets the minimum but one recent item is assisted -> EMERGING, not CONSISTENT_INDEPENDENT', () => {
    const result = computeDimensionState(
      [item({ id: 'a', occurredAt: '2026-01-03T00:00:00Z', independent: false }), item({ id: 'b', occurredAt: '2026-01-02T00:00:00Z' }), item({ id: 'c', occurredAt: '2026-01-01T00:00:00Z' })],
      RULES
    );
    expect(result.state).toBe('EMERGING');
  });

  it('meets the minimum but one recent item is incorrect -> EMERGING (assisted correct is not equivalent to independent correct, task 12)', () => {
    const result = computeDimensionState(
      [item({ id: 'a', occurredAt: '2026-01-03T00:00:00Z', result: 'incorrect' }), item({ id: 'b', occurredAt: '2026-01-02T00:00:00Z' }), item({ id: 'c', occurredAt: '2026-01-01T00:00:00Z' })],
      RULES
    );
    expect(result.state).toBe('EMERGING');
  });

  it('a stale independent success does not offset a recent assisted run -- only the N MOST RECENT items count for CONSISTENT_INDEPENDENT', () => {
    const result = computeDimensionState(
      [
        item({ id: 'recent1', occurredAt: '2026-01-05T00:00:00Z', independent: false }),
        item({ id: 'recent2', occurredAt: '2026-01-04T00:00:00Z', independent: false }),
        item({ id: 'recent3', occurredAt: '2026-01-03T00:00:00Z', independent: false }),
        item({ id: 'old', occurredAt: '2026-01-01T00:00:00Z', independent: true }),
      ],
      RULES
    );
    expect(result.state).toBe('EMERGING');
    expect(result.evidenceCount).toBe(4);
  });

  it('is a pure function -- identical input always produces identical output (determinism proof)', () => {
    const evidence = [item({ id: 'a', occurredAt: '2026-01-03T00:00:00Z' }), item({ id: 'b', occurredAt: '2026-01-02T00:00:00Z' }), item({ id: 'c', occurredAt: '2026-01-01T00:00:00Z' })];
    const first = computeDimensionState(evidence, RULES);
    const second = computeDimensionState(evidence, RULES);
    expect(first).toEqual(second);
  });

  it('never mutates its input array', () => {
    const evidence = [item({ id: 'a', occurredAt: '2026-01-01T00:00:00Z' }), item({ id: 'b', occurredAt: '2026-01-02T00:00:00Z' })];
    const snapshot = JSON.parse(JSON.stringify(evidence));
    computeDimensionState(evidence, RULES);
    expect(evidence).toEqual(snapshot);
  });
});
