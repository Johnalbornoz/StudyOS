/**
 * Track B / B1 -- the deterministic scoring engine and the scoring-policy
 * schema. Section 23 matrix: raw, weighted items, section weighting,
 * criteria (rubric), configured scale transformations, partial credit,
 * invalid / missing / excluded responses, exact boundary values, and
 * determinism (same response set + same policy => same result and hash).
 */
import { describe, it, expect } from 'vitest';
import { scoreResponseSet, applyTransform, round, type ScoringItem, type ScoringSection } from '@/lib/exam-core/scoring/scoring-engine';
import { parseScoringPolicy, ScoringPolicySchema, hashCanonical, canonicalJson, type ScoringPolicy } from '@/lib/exam-core/scoring/scoring-policy';

const PROV = { official: false, source: 'unit test fixture' };
const policy = (over: Partial<ScoringPolicy> & Pick<ScoringPolicy, 'strategy'>): ScoringPolicy => ScoringPolicySchema.parse({ engine: 'exam-scoring-v1', provenance: PROV, ...over });

const SECTIONS: ScoringSection[] = [
  { componentId: 'c1', key: 'reading', name: 'Reading', order: 0 },
  { componentId: 'c2', key: 'math', name: 'Math', order: 1 },
];

function item(targetIndex: number, over: Partial<ScoringItem> = {}): ScoringItem {
  return { targetIndex, componentId: 'c1', learningObjectiveId: 'lo-1', questionType: 'multiple_choice', status: 'ANSWERED', fraction: 1, maxMarks: 1, ...over };
}

describe('policy schema', () => {
  it('absent config is NO_SCORING_POLICY -- never a default formula', () => {
    expect(parseScoringPolicy(null)).toEqual({ ok: false, reason: 'NO_SCORING_POLICY' });
    expect(parseScoringPolicy(undefined)).toEqual({ ok: false, reason: 'NO_SCORING_POLICY' });
  });
  it('rejects malformed or unsafe policies', () => {
    expect(parseScoringPolicy({ engine: 'exam-scoring-v1', strategy: 'RAW' }).ok).toBe(false); // no provenance
    expect(parseScoringPolicy({ engine: 'exam-scoring-v1', strategy: 'SECTION_WEIGHTED', provenance: PROV }).ok).toBe(false); // no weights
    expect(parseScoringPolicy({ engine: 'exam-scoring-v1', strategy: 'RAW', provenance: { official: true, source: 'DEV fixture' } }).ok).toBe(false);
    expect(parseScoringPolicy({ engine: 'exam-scoring-v1', strategy: 'RAW', provenance: PROV, transform: { type: 'PIECEWISE', points: [[0, 0], [0.5, 10]] } }).ok).toBe(false); // must cover 1
    expect(parseScoringPolicy({ engine: 'exam-scoring-v1', strategy: 'RAW', provenance: PROV, transform: { type: 'BANDS', bands: [{ minFraction: 0.1, label: 'x' }] } }).ok).toBe(false); // must start at 0
    expect(parseScoringPolicy({ engine: 'exam-scoring-v1', strategy: 'RAW', provenance: PROV, transform: { type: 'LINEAR', min: 10, max: 10 } }).ok).toBe(false);
    expect(parseScoringPolicy({ engine: 'other', strategy: 'RAW', provenance: PROV }).ok).toBe(false);
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashCanonical({ b: 1, a: 2 })).toBe(hashCanonical({ a: 2, b: 1 }));
  });
});

describe('strategies', () => {
  it('RAW: earned / available marks', () => {
    const r = scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items: [item(0), item(1, { fraction: 0 }), item(2, { maxMarks: 2 })] });
    expect(r.raw).toEqual({ earned: 3, available: 4 });
    expect(r.fraction).toBe(0.75);
    expect(r.final).toMatchObject({ value: 75, unit: '%', official: false });
    expect(r.scoringStatus).toBe('SCORED');
  });

  it('WEIGHTED_ITEMS: item marks x question-type weights', () => {
    const p = policy({ strategy: 'WEIGHTED_ITEMS', questionTypeWeights: { numeric_problem: 3 } });
    const r = scoreResponseSet({ policy: p, sections: SECTIONS, items: [item(0, { fraction: 0 }), item(1, { questionType: 'numeric_problem' })] });
    // (0*1 + 1*3) / (1 + 3)
    expect(r.fraction).toBe(0.75);
    expect(r.raw).toEqual({ earned: 1, available: 2 });
  });

  it('SECTION_WEIGHTED: section fractions combined with configured weights', () => {
    const p = policy({ strategy: 'SECTION_WEIGHTED', sectionWeights: { reading: 1, math: 3 } });
    const r = scoreResponseSet({ policy: p, sections: SECTIONS, items: [item(0), item(1, { componentId: 'c2', fraction: 0 }), item(2, { componentId: 'c2' })] });
    // reading 1.0 (w1), math 0.5 (w3) => (1 + 1.5) / 4
    expect(r.fraction).toBe(0.625);
    expect(r.sections.find((s) => s.key === 'math')).toMatchObject({ earned: 1, available: 2, fraction: 0.5, weight: 3 });
  });

  it('SECTION_WEIGHTED: a section with no weight does not count; a section with no items is ignored', () => {
    const p = policy({ strategy: 'SECTION_WEIGHTED', sectionWeights: { math: 1 } });
    const r = scoreResponseSet({ policy: p, sections: SECTIONS, items: [item(0, { fraction: 0 }), item(1, { componentId: 'c2' })] });
    expect(r.fraction).toBe(1);
    const empty = scoreResponseSet({ policy: policy({ strategy: 'SECTION_WEIGHTED', sectionWeights: { reading: 1, math: 1 } }), sections: SECTIONS, items: [item(0)] });
    expect(empty.fraction).toBe(1);
  });

  it('CRITERIA: criterion fractions combined with criterion weights (rubric / mark scheme)', () => {
    const p = policy({ strategy: 'CRITERIA', criterionWeights: { knowledge: 1, application: 2 } });
    const r = scoreResponseSet({
      policy: p,
      sections: SECTIONS,
      items: [
        item(0, { fraction: 0.5, maxMarks: 4, criteria: [{ criterionId: 'knowledge', awarded: 2, max: 2 }, { criterionId: 'application', awarded: 0, max: 2 }] }),
        item(1, { fraction: 1, maxMarks: 2, criteria: [{ criterionId: 'application', awarded: 2, max: 2 }] }),
      ],
    });
    // knowledge 2/2 (w1), application 2/4 (w2) => (1 + 1) / 3
    expect(r.fraction).toBe(round(2 / 3));
    expect(r.criteria.find((c) => c.criterionId === 'application')).toMatchObject({ earned: 2, available: 4, fraction: 0.5, weight: 2 });
  });

  it('CRITERIA: items without criteria count under the synthetic __item criterion', () => {
    const r = scoreResponseSet({ policy: policy({ strategy: 'CRITERIA' }), sections: SECTIONS, items: [item(0, { fraction: 0 }), item(1)] });
    expect(r.criteria).toEqual([{ criterionId: '__item', earned: 1, available: 2, fraction: 0.5, weight: 1 }]);
  });
});

describe('transformations', () => {
  it('LINEAR scale with rounding', () => {
    expect(applyTransform({ type: 'LINEAR', min: 200, max: 800, decimals: 0 }, 0.5).value).toBe(500);
    expect(applyTransform({ type: 'LINEAR', min: 0, max: 100, decimals: 1 }, 1 / 3).value).toBe(33.3);
  });
  it('PIECEWISE: interpolation and exact breakpoints', () => {
    const t = { type: 'PIECEWISE' as const, points: [[0, 0], [0.5, 40], [1, 100]] as [number, number][], decimals: 0 };
    expect(applyTransform(t, 0).value).toBe(0);
    expect(applyTransform(t, 0.25).value).toBe(20);
    expect(applyTransform(t, 0.5).value).toBe(40);
    expect(applyTransform(t, 0.75).value).toBe(70);
    expect(applyTransform(t, 1).value).toBe(100);
  });
  it('BANDS: exact boundary belongs to the upper band', () => {
    const t = { type: 'BANDS' as const, bands: [{ minFraction: 0, label: 'B1' }, { minFraction: 0.5, label: 'B2' }, { minFraction: 0.85, label: 'B3' }] };
    expect(applyTransform(t, 0).label).toBe('B1');
    expect(applyTransform(t, 0.4999).label).toBe('B1');
    expect(applyTransform(t, 0.5).label).toBe('B2');
    expect(applyTransform(t, 0.85).label).toBe('B3');
    expect(applyTransform(t, 1).label).toBe('B3');
  });
  it('no fraction (nothing scorable) => no value, never 0', () => {
    expect(applyTransform({ type: 'NONE' }, null)).toMatchObject({ value: null, label: null });
    const r = scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items: [item(0, { status: 'EXCLUDED' })] });
    expect(r.fraction).toBeNull();
    expect(r.final.value).toBeNull();
  });
});

describe('response states', () => {
  it('partial credit on: fractional marks count; off: anything below full marks earns 0', () => {
    const items = [item(0, { fraction: 0.5, maxMarks: 2 })];
    expect(scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items }).raw.earned).toBe(1);
    expect(scoreResponseSet({ policy: policy({ strategy: 'RAW', partialCredit: false }), sections: SECTIONS, items }).raw.earned).toBe(0);
  });
  it('INVALID response: 0 marks, still counts against the available marks', () => {
    const r = scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items: [item(0), item(1, { status: 'INVALID', fraction: 1 })] });
    expect(r.raw).toEqual({ earned: 1, available: 2 });
    expect(r.counts.invalid).toBe(1);
  });
  it('MISSING response: 0 marks; an undelivered item uses the policy default marks', () => {
    const r = scoreResponseSet({ policy: policy({ strategy: 'RAW', defaultItemMarks: 3 }), sections: SECTIONS, items: [item(0), item(1, { status: 'MISSING', maxMarks: null }), item(2, { status: 'MISSING', maxMarks: 2 })] });
    expect(r.raw).toEqual({ earned: 1, available: 6 });
    expect(r.counts.missing).toBe(2);
  });
  it('EXCLUDED (platform could not prepare it): never counted against the Student', () => {
    const r = scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items: [item(0), item(1, { status: 'EXCLUDED', maxMarks: 5 })] });
    expect(r.raw).toEqual({ earned: 1, available: 1 });
    expect(r.sections[0].excluded).toBe(1);
  });
  it('clamps grader fractions outside [0,1]', () => {
    const r = scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items: [item(0, { fraction: 1.7 }), item(1, { fraction: -2 })] });
    expect(r.raw).toEqual({ earned: 1, available: 2 });
  });
  it('objective classification uses the policy reporting thresholds', () => {
    const p = policy({ strategy: 'RAW', reporting: { strengthFraction: 0.8, gapFraction: 0.4 } });
    const r = scoreResponseSet({ policy: p, sections: SECTIONS, items: [item(0, { learningObjectiveId: 'a' }), item(1, { learningObjectiveId: 'b', fraction: 0.5 }), item(2, { learningObjectiveId: 'c', fraction: 0 })] });
    expect(Object.fromEntries(r.objectives.map((o) => [o.learningObjectiveId, o.classification]))).toEqual({ a: 'STRENGTH', b: 'DEVELOPING', c: 'GAP' });
  });
});

describe('determinism and provenance', () => {
  const p = policy({ strategy: 'SECTION_WEIGHTED', sectionWeights: { reading: 1, math: 1 }, transform: { type: 'LINEAR', min: 0, max: 100, decimals: 0 } });
  const items = [item(0, { fraction: 1 / 3 }), item(1, { componentId: 'c2', fraction: 0.5 }), item(2, { componentId: 'c2', status: 'MISSING', maxMarks: 1 })];

  it('same response set + same policy => identical result and hashes (input order irrelevant)', () => {
    const a = scoreResponseSet({ policy: p, sections: SECTIONS, items });
    const b = scoreResponseSet({ policy: structuredClone(p), sections: [...SECTIONS].reverse(), items: [...items].reverse() });
    expect(b).toEqual(a);
    expect(a.responseSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.policyHash).toBe(hashCanonical(p));
  });

  it('a different response set changes the response hash; a different policy changes the policy hash', () => {
    const a = scoreResponseSet({ policy: p, sections: SECTIONS, items });
    const changed = scoreResponseSet({ policy: p, sections: SECTIONS, items: [item(0, { fraction: 0 }), ...items.slice(1)] });
    expect(changed.responseSetHash).not.toBe(a.responseSetHash);
    const otherPolicy = scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items });
    expect(otherPolicy.policyHash).not.toBe(a.policyHash);
  });

  it('records every transformation step and the unofficial provenance', () => {
    const r = scoreResponseSet({ policy: p, sections: SECTIONS, items });
    expect(r.transformations.map((t) => t.step)).toEqual(['SECTION_WEIGHTED(sum(w*fraction)/sum(w))', 'LINEAR(0..100)']);
    expect(r.final.official).toBe(false);
    expect(r.engineVersion).toBe('exam-scoring-v1');
  });

  it('no policy: raw marks are facts, but there is no final score (NO_SCORING_POLICY)', () => {
    const r = scoreResponseSet({ policy: null, sections: SECTIONS, items });
    expect(r.scoringStatus).toBe('NO_SCORING_POLICY');
    expect(r.final.value).toBeNull();
    expect(r.raw.available).toBe(3);
    expect(r.policyHash).toBeNull();
  });

  it('float drift never leaks into stored values', () => {
    const r = scoreResponseSet({ policy: policy({ strategy: 'RAW' }), sections: SECTIONS, items: [item(0, { fraction: 0.1, maxMarks: 3 }), item(1, { fraction: 0.2, maxMarks: 3 })] });
    expect(r.raw.earned).toBe(0.9);
  });
});
