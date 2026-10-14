/**
 * The governed Exam Bank Readiness Engine: synthetic supply only. Pure: no database, no provider, no PAA runtime.
 */
import { describe, expect, it } from 'vitest';
import { evaluateExamBankReadiness, MODE_REQUIREMENTS, type ReadinessBlueprint, type ReadinessInput } from '@/lib/exam-bank/readiness/bank-readiness';
import { certificationVerdict, deliverabilityOf, type RuntimeCapabilities, type SupplyRow } from '@/lib/exam-bank/readiness/certification-state';
import { bandOfIndex, isCalibrated, profileFromAuthoredLevel, type DifficultyProfile } from '@/lib/exam-bank/readiness/difficulty';
import { assembleForm } from '@/lib/exam-bank/readiness/exposure';

const CAPS: RuntimeCapabilities = { renderableFormats: ['SELECTED_RESPONSE', 'CONSTRUCTED_RESPONSE'], scorableFormats: ['SELECTED_RESPONSE'], stimulusKinds: ['READING_PASSAGE'] };
const BP: ReadinessBlueprint = {
  assessmentSystem: 'SYNTH', assessmentVersion: 'v1', profile: null, component: 'math', blueprintId: 'bp-synth', blueprintVersion: '1',
  buckets: [{ bucketId: 'alg', requiredPositions: 2, allowedFormats: null }, { bucketId: 'geo', requiredPositions: 1, allowedFormats: null }],
};
const EMPIRICAL: DifficultyProfile = { difficultyIndex: 1.25, difficultyBand: 'HIGH', confidence: 0.9, calibrationSource: 'EMPIRICAL', sampleSize: 500, lastCalibratedAt: '2026-09-01T00:00:00.000Z' };
let n = 0;
const row = (bucket: string, over: Partial<SupplyRow> = {}): SupplyRow => ({
  itemId: `i-${bucket}-${++n}`, contentDigest: `d${n}`, bucketIds: [bucket], certification: 'HUMAN_CERTIFIED', lineageComplete: true, rights: 'CLEARED',
  responseFormat: 'SELECTED_RESPONSE', stimulusKind: null, stimulusId: null, retired: false, difficulty: profileFromAuthoredLevel(3), ...over,
});
const input = (supply: SupplyRow[], over: Partial<ReadinessInput> = {}): ReadinessInput => ({ blueprint: BP, mode: MODE_REQUIREMENTS.SECTION_PRACTICE, scope: 'PRODUCTION', capabilities: CAPS, supply, now: new Date('2026-10-14T00:00:00.000Z'), ...over });
const full = (k = 1): SupplyRow[] => [...Array.from({ length: 2 * k }, () => row('alg')), ...Array.from({ length: k }, () => row('geo'))];

describe('certification vs deliverability', () => {
  it('certified is not deliverable without scoring capability', () => {
    const r = row('alg', { responseFormat: 'CONSTRUCTED_RESPONSE' });
    const d = deliverabilityOf(r, { scope: 'PRODUCTION', capabilities: CAPS, blueprintBucketIds: new Set(['alg']) });
    expect(d.verdict).toBe('CERTIFIED_NOT_DELIVERABLE');
    expect(d.reasons).toEqual(['FORMAT_NOT_SCORABLE']);
  });
  it('runtime-ready needs certification + lineage + rights + capability + blueprint', () => {
    const ctx = { scope: 'PRODUCTION' as const, capabilities: CAPS, blueprintBucketIds: new Set(['alg']) };
    expect(deliverabilityOf(row('alg'), ctx).verdict).toBe('RUNTIME_DELIVERABLE');
    expect(deliverabilityOf(row('alg', { rights: 'UNKNOWN' }), ctx).reasons).toEqual(['RIGHTS_NOT_CLEARED']);
    expect(deliverabilityOf(row('alg', { lineageComplete: false }), ctx).reasons).toEqual(['LINEAGE_INCOMPLETE']);
    expect(deliverabilityOf(row('alg', { stimulusKind: 'AUDIO', stimulusId: 's' }), ctx).reasons).toEqual(['STIMULUS_NOT_SUPPORTED']);
    expect(deliverabilityOf(row('other'), ctx).reasons).toEqual(['NOT_IN_BLUEPRINT']);
    expect(deliverabilityOf(row('alg', { retired: true }), ctx).reasons).toEqual(['RETIRED']);
  });
  it('states: review-required / rejected never certified; pilot only in pilot scope; inheritance only while intact', () => {
    expect(certificationVerdict({ certification: 'REVIEW_REQUIRED' }, 'PILOT_PREVIEW')).toBe('NOT_CERTIFIED');
    expect(certificationVerdict({ certification: 'REJECTED' }, 'PILOT_PREVIEW')).toBe('NOT_CERTIFIED');
    expect(certificationVerdict({ certification: 'AUTOMATED_CERTIFIED_PILOT' }, 'PILOT_PREVIEW')).toBe('CERTIFIED');
    expect(certificationVerdict({ certification: 'AUTOMATED_CERTIFIED_PILOT' }, 'PRODUCTION')).toBe('CERTIFIED_OUT_OF_SCOPE');
    expect(certificationVerdict({ certification: 'AUTOMATED_CERTIFIED_PILOT', productionReleased: true }, 'PRODUCTION')).toBe('CERTIFIED');
    for (const st of ['DRAFT', 'VALIDATING', 'QUARANTINED', 'RETIRED'] as const) expect(certificationVerdict({ certification: st }, 'PILOT_PREVIEW')).toBe('NOT_CERTIFIED');
    expect(certificationVerdict({ certification: 'INHERITED_DETERMINISTIC', inheritanceIntact: true }, 'PRODUCTION')).toBe('CERTIFIED');
    expect(certificationVerdict({ certification: 'INHERITED_DETERMINISTIC' }, 'PRODUCTION')).toBe('NOT_CERTIFIED');
    const ctx = { scope: 'PRODUCTION' as const, capabilities: CAPS, blueprintBucketIds: new Set(['alg']) };
    expect(deliverabilityOf(row('alg', { certification: 'AUTOMATED_CERTIFIED_PILOT' }), ctx)).toEqual({ verdict: 'CERTIFIED_NOT_DELIVERABLE', reasons: ['CERTIFICATION_OUT_OF_SCOPE'] });
    expect(deliverabilityOf(row('alg', { certification: 'REJECTED' }), ctx)).toEqual({ verdict: 'NOT_CERTIFIED', reasons: ['REJECTED'] });
  });
});

describe('readiness engine', () => {
  it('READY when every position is covered by runtime-deliverable supply', () => {
    const r = evaluateExamBankReadiness(input(full(3)));
    expect(r.status).toBe('READY');
    expect(r).toMatchObject({ requiredPositions: 3, coveredPositions: 3, missingBuckets: [], uniqueFormDepth: 3, repeatabilityDepth: 3, expectedOverlapNextForm: 0, blockingReasons: [] });
    expect(r.warnings).toEqual([]);
  });
  it('fails closed with a missing blueprint bucket', () => {
    const r = evaluateExamBankReadiness(input([row('alg'), row('alg')]));
    expect(r.status).toBe('PARTIAL');
    expect(r.missingBuckets).toEqual(['geo']);
    expect(r.blockingReasons).toContain('BUCKET_UNCOVERED');
  });
  it('fails closed on an empty blueprint and on no supply', () => {
    expect(evaluateExamBankReadiness(input(full(), { blueprint: { ...BP, buckets: [] } })).status).toBe('NOT_READY');
    const r = evaluateExamBankReadiness(input([]));
    expect(r.status).toBe('NOT_READY');
    expect(r.blockingReasons).toEqual(expect.arrayContaining(['BUCKET_UNCOVERED', 'NO_CERTIFIED_SUPPLY']));
  });
  it('fails closed with insufficient scoring capability (certified constructed response)', () => {
    const supply = [row('alg'), row('alg'), row('geo', { responseFormat: 'CONSTRUCTED_RESPONSE' })];
    const r = evaluateExamBankReadiness(input(supply));
    expect(r.status).toBe('PARTIAL');
    expect(r.blockingReasons).toEqual(expect.arrayContaining(['BUCKET_UNCOVERED', 'FORMAT_NOT_SCORABLE']));
    expect(r.scoringCapability).toBe('PARTIAL');
    expect(r.certifiedNotDeliverableCount).toBe(1);
    expect(r.certifiedItemCount).toBe(3);
    expect(r.runtimeEligibleItemCount).toBe(2);
  });
  it('fails closed with rights and certification blockers', () => {
    const supply = [row('alg'), row('alg'), row('geo', { rights: 'RESTRICTED' }), row('geo', { certification: 'REVIEW_REQUIRED' }), row('geo', { certification: 'AUTOMATED_CERTIFIED_PILOT' })];
    const r = evaluateExamBankReadiness(input(supply));
    expect(r.status).toBe('PARTIAL');
    expect(r.blockingReasons).toEqual(expect.arrayContaining(['RIGHTS_NOT_CLEARED', 'NOT_CERTIFIED', 'CERTIFICATION_OUT_OF_SCOPE']));
    // The same pilot row is deliverable in the pilot scope.
    expect(evaluateExamBankReadiness(input(supply, { scope: 'PILOT_PREVIEW' })).status).toBe('READY');
  });
  it('distinguishes certified-but-not-deliverable from runtime-ready in the same bucket', () => {
    const r = evaluateExamBankReadiness(input([...full(1), row('geo', { responseFormat: 'CONSTRUCTED_RESPONSE' })]));
    expect(r.status).toBe('READY');
    expect(r.warnings).toContain('CERTIFIED_NOT_DELIVERABLE_PRESENT');
    expect(r.buckets.find((b) => b.bucketId === 'geo')).toMatchObject({ certifiedItemCount: 2, runtimeEligibleItemCount: 1, excluded: { FORMAT_NOT_SCORABLE: 1 } });
  });
  it('raw item count is not readiness: a deep bucket cannot hide an empty one', () => {
    const r = evaluateExamBankReadiness(input(Array.from({ length: 50 }, () => row('alg'))));
    expect(r.certifiedItemCount).toBe(50);
    expect(r.status).toBe('PARTIAL');
    expect(r.uniqueFormDepth).toBe(0);
  });
  it('Challenge requires governed calibration: items existing is not Challenge READY', () => {
    const r = evaluateExamBankReadiness(input(full(2), { mode: MODE_REQUIREMENTS.CHALLENGE }));
    expect(r.status).toBe('NOT_READY');
    expect(r.blockingReasons).toContain('CALIBRATION_REQUIRED');
    expect(r.difficultyCapability).toBe('NONE');
    const cal = full(2).map((x) => ({ ...x, difficulty: EMPIRICAL }));
    expect(evaluateExamBankReadiness(input(cal, { mode: MODE_REQUIREMENTS.CHALLENGE })).status).toBe('READY');
  });
  it('bucket format restriction is enforced', () => {
    const bp: ReadinessBlueprint = { ...BP, buckets: [{ bucketId: 'alg', requiredPositions: 1, allowedFormats: ['GRID_IN'] }] };
    const r = evaluateExamBankReadiness(input([row('alg')], { blueprint: bp }));
    expect(r.status).toBe('NOT_READY');
    expect(r.blockingReasons).toContain('FORMAT_NOT_ALLOWED_BY_BUCKET');
  });
  it('an item fills at most one position: multi-bucket rows are counted once', () => {
    const shared = Array.from({ length: 3 }, () => row('alg', { bucketIds: ['alg', 'geo'] }));
    const r = evaluateExamBankReadiness(input(shared));
    expect(r.runtimeEligibleItemCount).toBe(3);
    expect(r.coveredPositions).toBe(3);
    expect(r.status).toBe('READY');
    expect(r.uniqueFormDepth).toBe(1);
  });
});

describe('depth, repeatability and exposure', () => {
  it('measures unique-form depth, exhaustion order and expected overlap', () => {
    const supply = [...Array.from({ length: 5 }, () => row('alg')), ...Array.from({ length: 1 }, () => row('geo'))];
    const r = evaluateExamBankReadiness(input(supply));
    expect(r.buckets.map((b) => [b.bucketId, b.effectiveBucketDepth])).toEqual([['alg', 2], ['geo', 1]]);
    expect(r.uniqueFormDepth).toBe(1);
    expect(r.bucketExhaustion[0]).toEqual({ bucketId: 'geo', formsUntilExhausted: 1 });
    // Next form: alg has 3 fresh for 2 positions (0 repeats); geo has 0 fresh for 1 position (1 repeat) -> 1/3.
    expect(r.expectedOverlapNextForm).toBeCloseTo(1 / 3);
    expect(r.warnings).toEqual(expect.arrayContaining(['LOW_REPEATABILITY', 'REPEATS_EXPECTED_NEXT_FORM']));
  });
  it('exposure reduces Student-specific effective depth', () => {
    const supply = full(3);
    const seen = new Map(supply.filter((s) => s.bucketIds[0] === 'geo').slice(0, 2).map((s) => [s.itemId, '2026-10-01T00:00:00.000Z'] as const));
    const before = evaluateExamBankReadiness(input(supply, { exposure: new Map() }));
    const after = evaluateExamBankReadiness(input(supply, { exposure: seen }));
    expect(before.studentEffectiveDepth).toBe(3);
    expect(after.studentEffectiveDepth).toBe(1);
    expect(after.uniqueFormDepth).toBe(3); // the general supply is unchanged
    const exhausted = new Map(supply.filter((s) => s.bucketIds[0] === 'geo').map((s) => [s.itemId, '2026-10-01T00:00:00.000Z'] as const));
    const x = evaluateExamBankReadiness(input(supply, { exposure: exhausted }));
    expect(x.studentEffectiveDepth).toBe(0);
    expect(x.warnings).toContain('STUDENT_SUPPLY_EXHAUSTED');
    expect(x.expectedOverlapNextForm).toBeCloseTo(1 / 3);
  });
  it('assembles unexposed first, then least-recently exposed, and reports repeats', () => {
    const buckets = [{ bucketId: 'alg', requiredPositions: 2 }];
    const pool = ['a', 'b', 'c'].map((id) => ({ itemId: id, bucketIds: ['alg'] }));
    const f1 = assembleForm(buckets, pool, new Map([['a', '2026-10-02'], ['b', '2026-10-01']]), 'seed');
    expect(f1.positions.map((p) => p.itemId)).toEqual(['c', 'b']);
    expect(f1.repeatedItemIds).toEqual(['b']);
    const f2 = assembleForm([{ bucketId: 'alg', requiredPositions: 4 }], pool, new Map(), 'seed');
    expect(f2.unfilled).toEqual([{ bucketId: 'alg', missing: 1 }]);
    expect(assembleForm(buckets, pool, new Map(), 'seed')).toEqual(assembleForm(buckets, pool, new Map(), 'seed'));
  });
});

describe('difficulty calibration', () => {
  it('only a sufficient, fresh empirical estimate is calibrated', () => {
    const now = new Date('2026-10-14T00:00:00.000Z');
    expect(isCalibrated(EMPIRICAL, undefined, now)).toBe(true);
    expect(isCalibrated({ ...EMPIRICAL, sampleSize: 50 }, undefined, now)).toBe(false);
    expect(isCalibrated({ ...EMPIRICAL, calibrationSource: 'EXPERT_REVIEW' }, undefined, now)).toBe(false);
    expect(isCalibrated({ ...EMPIRICAL, lastCalibratedAt: '2020-01-01T00:00:00.000Z' }, undefined, now)).toBe(false);
    expect(isCalibrated(profileFromAuthoredLevel(5), undefined, now)).toBe(false);
    expect(bandOfIndex(1.25)).toBe('HIGH');
    expect(bandOfIndex(1)).toBe('MEDIUM');
    expect(bandOfIndex(0.4)).toBe('VERY_LOW');
    expect(bandOfIndex(1.8)).toBe('VERY_HIGH');
  });
});
