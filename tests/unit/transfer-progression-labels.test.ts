/**
 * Phase 7 -- Step 7F1: learner-safe transfer progression labels.
 *
 * Every depth (and null) maps to a plain-language phrase in every
 * locale, and NONE of those phrases leak engine-internal transfer
 * vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { transferDepthLabel, hasDemonstratedTransfer } from '@/lib/transfer-progression-labels';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { TRANSFER_DEPTH_VALUES } from '@/lib/transfer-policy';

const FORBIDDEN = /\bNEAR\b|\bMID\b|\bFAR\b|NEAR_DEMONSTRATED|GENERALIZED|ROBUST|noveltyDimension|taskFamily|fingerprint|policyVersion|transfer_depth|distance weight/i;

describe('7F1 -- transferDepthLabel', () => {
  for (const locale of LOCALES) {
    const t = getMessages(locale);
    it(`[${locale}] returns a non-empty phrase for every depth and for null, with no engine-internal vocabulary`, () => {
      for (const depth of [...TRANSFER_DEPTH_VALUES, null]) {
        const label = transferDepthLabel(depth as any, t);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toMatch(FORBIDDEN);
      }
    });
    it(`[${locale}] null and NONE render identically`, () => {
      expect(transferDepthLabel(null, t)).toBe(transferDepthLabel('NONE', t));
    });
    it(`[${locale}] the four depths are four distinct phrases`, () => {
      const set = new Set(TRANSFER_DEPTH_VALUES.map((d) => transferDepthLabel(d, t)));
      expect(set.size).toBe(TRANSFER_DEPTH_VALUES.length);
    });
  }
});

describe('7F1 -- hasDemonstratedTransfer', () => {
  it('is false for null / NONE, true for the three demonstrated depths', () => {
    expect(hasDemonstratedTransfer(null)).toBe(false);
    expect(hasDemonstratedTransfer('NONE')).toBe(false);
    expect(hasDemonstratedTransfer('NEAR_DEMONSTRATED')).toBe(true);
    expect(hasDemonstratedTransfer('GENERALIZED')).toBe(true);
    expect(hasDemonstratedTransfer('ROBUST')).toBe(true);
  });
});
