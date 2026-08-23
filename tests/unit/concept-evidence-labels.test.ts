import { describe, it, expect } from 'vitest';
import { criterionStatusLabel, resultColor, resultLabel } from '@/lib/concept-evidence-labels';
import { getMessages } from '@/lib/i18n/messages';

describe('criterionStatusLabel', () => {
  it('returns the localized "met" string when met is true', () => {
    const t = getMessages('en');
    expect(criterionStatusLabel(true, t)).toBe(t['conceptDetail.criterionMet']);
  });

  it('returns the localized "not met" string when met is false', () => {
    const t = getMessages('en');
    expect(criterionStatusLabel(false, t)).toBe(t['conceptDetail.criterionNotMet']);
  });

  it('is never an empty string in any locale (screen readers must always get real text, not silence)', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt']) {
      const t = getMessages(locale);
      expect(criterionStatusLabel(true, t).length).toBeGreaterThan(0);
      expect(criterionStatusLabel(false, t).length).toBeGreaterThan(0);
    }
  });

  it('met and not-met are always distinct strings, so the status is never ambiguous', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt']) {
      const t = getMessages(locale);
      expect(criterionStatusLabel(true, t)).not.toBe(criterionStatusLabel(false, t));
    }
  });
});

describe('resultLabel / resultColor (existing evidence-history helpers, sanity-checked alongside the a11y addition above)', () => {
  it('gives each of the three result kinds a distinct color', () => {
    const colors = new Set(['correct', 'partial', 'incorrect'].map((r) => resultColor(r as any)));
    expect(colors.size).toBe(3);
  });

  it('gives each of the three result kinds real, non-empty label text', () => {
    const t = getMessages('en');
    for (const r of ['correct', 'partial', 'incorrect'] as const) {
      expect(resultLabel(r, t).length).toBeGreaterThan(0);
    }
  });
});
