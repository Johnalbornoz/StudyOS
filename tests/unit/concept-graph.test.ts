import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { confidenceTier, validateRelationship, RELATIONSHIP_TYPES } from '@/services/concept-graph.service';

describe('confidenceTier', () => {
  it('is HIGH at and above 0.75', () => {
    expect(confidenceTier(0.75)).toBe('HIGH');
    expect(confidenceTier(0.91)).toBe('HIGH');
    expect(confidenceTier(1)).toBe('HIGH');
  });

  it('is MEDIUM between 0.45 and 0.75', () => {
    expect(confidenceTier(0.45)).toBe('MEDIUM');
    expect(confidenceTier(0.6)).toBe('MEDIUM');
  });

  it('is LOW below 0.45', () => {
    expect(confidenceTier(0.44)).toBe('LOW');
    expect(confidenceTier(0)).toBe('LOW');
  });
});

describe('validateRelationship', () => {
  const ids = new Set(['a', 'b']);

  it('rejects a self-relation', () => {
    expect(validateRelationship('a', 'a', 'PREREQUISITE_OF', ids)).toEqual({ valid: false, reason: 'SELF_RELATION' });
  });

  it('rejects an unknown concept id', () => {
    expect(validateRelationship('a', 'zzz', 'PREREQUISITE_OF', ids)).toEqual({ valid: false, reason: 'INVALID_CONCEPT_ID' });
    expect(validateRelationship('zzz', 'a', 'PREREQUISITE_OF', ids)).toEqual({ valid: false, reason: 'INVALID_CONCEPT_ID' });
  });

  it('rejects an unsupported relationship type', () => {
    expect(validateRelationship('a', 'b', 'CAUSES', ids)).toEqual({ valid: false, reason: 'INVALID_TYPE' });
  });

  it('accepts a valid relationship between two real concepts', () => {
    expect(validateRelationship('a', 'b', 'PREREQUISITE_OF', ids)).toEqual({ valid: true });
  });

  it('supports all six documented relationship types', () => {
    expect(RELATIONSHIP_TYPES).toHaveLength(6);
    for (const type of RELATIONSHIP_TYPES) {
      expect(validateRelationship('a', 'b', type, ids).valid).toBe(true);
    }
  });
});
