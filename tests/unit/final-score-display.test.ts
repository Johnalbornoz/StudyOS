import { describe, expect, it } from 'vitest';
import { finalScoreDisplay, rawMarksLine } from '@/lib/exam-core/scoring/final-score-display';
import { applyTransform } from '@/lib/exam-core/scoring/scoring-engine';

const cambridge = { finalScore: 72, finalLabel: null, rawScore: 18, maxScore: 25, provenance: { final: { unit: 'marks' }, transformations: [{ step: 'RAW(earned/available)' }, { step: 'NONE(percent)' }] } };

describe('F4: final score display (presentation only)', () => {
  it('Cambridge RAW + NONE + unit marks: "72%" and "18 / 25 marks", never "72 marks"', () => {
    expect(applyTransform({ type: 'NONE' }, 18 / 25).value).toBe(72); // the engine is unchanged: NONE is a percent
    expect(finalScoreDisplay(cambridge)).toEqual({ headline: '72%', unit: null, percentIsHeadline: true });
    expect(rawMarksLine(cambridge)).toBe('18 / 25 marks');
  });
  it('a unit "%" policy stays a percent and keeps the localised raw line', () => {
    const r = { ...cambridge, provenance: { final: { unit: '%' }, transformations: [{ step: 'NONE(percent)' }] } };
    expect(finalScoreDisplay(r).headline).toBe('72%');
    expect(rawMarksLine(r)).toBeNull();
  });
  it('a LINEAR scale keeps its own unit (e.g. PAA points); bands keep their label; no score is a dash', () => {
    expect(finalScoreDisplay({ finalScore: 612, finalLabel: null, rawScore: 40, maxScore: 50, provenance: { final: { unit: 'puntos' }, transformations: [{ step: 'LINEAR(150..850)' }] } })).toEqual({ headline: '612', unit: 'puntos', percentIsHeadline: false });
    expect(finalScoreDisplay({ ...cambridge, finalLabel: '6' }).headline).toBe('6');
    expect(finalScoreDisplay({ ...cambridge, finalScore: null }).headline).toBe('—');
  });
});
