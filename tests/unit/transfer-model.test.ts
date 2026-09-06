/**
 * Phase 7 -- Step 7C2: pure Transfer replay model.
 *
 * Score equivalence with the certified scorer, conservative legacy
 * depth (never above NEAR_DEMONSTRATED), future synthetic
 * phase7Certified depth (GENERALIZED / ROBUST), monotonicity,
 * assisted / partial / failure handling, deterministic replay + tie-
 * break, and current-row strictness. No DB, no AI, no clock.
 */
import { describe, it, expect } from 'vitest';
import {
  toProjectionEvidence,
  replayTransferState,
  InvalidCurrentTransferEvidenceError,
  type CanonicalTransferProjectionEvidence,
  type RawTransferEvidenceRow,
} from '@/lib/algorithms/transfer-model';
import { computeTransferScore, type TransferEvidenceRow } from '@/lib/algorithms/transfer-score';
import { TRANSFER_POLICY_VERSION } from '@/lib/transfer-policy';

const FP = 'a'.repeat(64);
let seq = 0;
const ts = (n: number) => `2026-09-0${n}T00:00:00.000Z`;

function ev(o: Partial<CanonicalTransferProjectionEvidence> = {}): CanonicalTransferProjectionEvidence {
  seq += 1;
  return {
    evidenceId: `e${String(seq).padStart(3, '0')}`,
    timestamp: ts(1),
    result: 'SUCCESS',
    transferDistance: 'NEAR',
    assisted: false,
    transferTaskId: 'task-1',
    promptFingerprint: FP,
    noveltyValidationPassed: false,
    noveltyDimensions: [],
    taskFamilyId: null,
    targetConceptIds: [],
    spacingSatisfied: false,
    phase7Certified: false,
    ...o,
  };
}
/** synthetic 7D-certified evidence */
function certified(o: Partial<CanonicalTransferProjectionEvidence> = {}): CanonicalTransferProjectionEvidence {
  return ev({ noveltyValidationPassed: true, noveltyDimensions: ['STRATEGY'], phase7Certified: true, taskFamilyId: 'fam-1', ...o });
}

describe('7C2 -- demonstrated score == computeTransferScore, no drift', () => {
  const windows: Array<{ label: string; rows: Array<Partial<CanonicalTransferProjectionEvidence>> }> = [
    { label: 'legacy NEAR successes', rows: [{ transferDistance: 'NEAR', result: 'SUCCESS' }, { transferDistance: 'NEAR', result: 'SUCCESS' }] },
    { label: 'mixed distance + partial + failure', rows: [
      { transferDistance: 'FAR', result: 'SUCCESS' }, { transferDistance: 'MID', result: 'PARTIAL' }, { transferDistance: 'NEAR', result: 'FAILURE' },
    ] },
    { label: 'assisted rows', rows: [{ transferDistance: 'MID', result: 'SUCCESS', assisted: true }, { transferDistance: 'NEAR', result: 'SUCCESS' }] },
    { label: '>10 attempts (windowed)', rows: Array.from({ length: 14 }, (_, i) => ({ transferDistance: (['NEAR', 'MID', 'FAR'] as const)[i % 3], result: (['SUCCESS', 'PARTIAL', 'FAILURE'] as const)[i % 3] })) },
    { label: 'no evidence', rows: [] },
  ];
  // distinct, increasing timestamps -- real Transfer evidence always
  // has a distinct NOW() per submit; computeTransferScore's "last 10"
  // is only well-defined when timestamps differ.
  const distinctTs = (i: number) => `2026-09-01T00:${String(i).padStart(2, '0')}:00.000Z`;
  for (const w of windows) {
    it(w.label, () => {
      const evs = w.rows.map((r, i) => ev({ timestamp: distinctTs(i), evidenceId: `x${String(i).padStart(3, '0')}`, ...r }));
      const scoreRows: TransferEvidenceRow[] = evs.map((e) => ({
        transferDistance: e.transferDistance,
        result: e.result === 'SUCCESS' ? 'correct' : e.result === 'PARTIAL' ? 'partial' : 'incorrect',
        assisted: e.assisted,
        timestamp: e.timestamp,
      }));
      expect(replayTransferState(evs).demonstratedTransferScore).toBe(computeTransferScore(scoreRows));
    });
  }
});

describe('7C2 -- LEGACY (pre-7D) evidence: at most NEAR_DEMONSTRATED, counted as NEAR', () => {
  it('legacy NEAR success -> NEAR_DEMONSTRATED, near count 1', () => {
    const r = replayTransferState([ev({ transferDistance: 'NEAR', result: 'SUCCESS' })]);
    expect(r.transferDepth).toBe('NEAR_DEMONSTRATED');
    expect([r.nearTransferSuccessCount, r.midTransferSuccessCount, r.farTransferSuccessCount]).toEqual([1, 0, 0]);
    expect(r.lastSuccessfulTransferDistance).toBe('NEAR');
  });
  it('legacy MID success -> still NEAR_DEMONSTRATED, still counted as NEAR (not mid)', () => {
    const r = replayTransferState([ev({ transferDistance: 'MID', result: 'SUCCESS' })]);
    expect(r.transferDepth).toBe('NEAR_DEMONSTRATED');
    expect([r.nearTransferSuccessCount, r.midTransferSuccessCount, r.farTransferSuccessCount]).toEqual([1, 0, 0]);
    expect(r.lastSuccessfulTransferDistance).toBe('NEAR');
  });
  it('legacy FAR success -> still NEAR_DEMONSTRATED, counted as NEAR', () => {
    const r = replayTransferState([ev({ transferDistance: 'FAR', result: 'SUCCESS' })]);
    expect(r.transferDepth).toBe('NEAR_DEMONSTRATED');
    expect(r.farTransferSuccessCount).toBe(0);
    expect(r.nearTransferSuccessCount).toBe(1);
  });
  it('multiple legacy FAR successes + varied old labels -> NEVER GENERALIZED', () => {
    const r = replayTransferState([
      ev({ transferDistance: 'FAR', result: 'SUCCESS', timestamp: ts(1), evidenceId: 'a' }),
      ev({ transferDistance: 'MID', result: 'SUCCESS', timestamp: ts(2), evidenceId: 'b' }),
      ev({ transferDistance: 'FAR', result: 'SUCCESS', timestamp: ts(3), evidenceId: 'c' }),
    ]);
    expect(r.transferDepth).toBe('NEAR_DEMONSTRATED');
    expect(r.distinctNoveltyDimensionsOk).toEqual([]);
  });
  it('legacy assisted success: score only -- no count, no depth, no lastSuccess', () => {
    const r = replayTransferState([ev({ transferDistance: 'MID', result: 'SUCCESS', assisted: true })]);
    expect(r.transferDepth).toBe('NONE');
    expect([r.nearTransferSuccessCount, r.midTransferSuccessCount, r.farTransferSuccessCount]).toEqual([0, 0, 0]);
    expect(r.lastSuccessfulTransferAt).toBeNull();
    expect(r.demonstratedTransferScore).not.toBeNull(); // still contributes to the score
  });
});

describe('7C2 -- future phase7Certified evidence: real depth rules', () => {
  it('certified NEAR success -> NEAR_DEMONSTRATED (near count)', () => {
    const r = replayTransferState([certified({ transferDistance: 'NEAR', noveltyDimensions: ['CONTEXT'] })]);
    expect(r.transferDepth).toBe('NEAR_DEMONSTRATED');
    expect(r.nearTransferSuccessCount).toBe(1);
  });
  it('certified MID success -> NEAR_DEMONSTRATED (mid count)', () => {
    const r = replayTransferState([certified({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'] })]);
    expect(r.transferDepth).toBe('NEAR_DEMONSTRATED');
    expect(r.midTransferSuccessCount).toBe(1);
  });
  it('certified FAR success -> GENERALIZED (far count, dims recorded)', () => {
    const r = replayTransferState([certified({ transferDistance: 'FAR', noveltyDimensions: ['CONCEPT_COMBINATION'] })]);
    expect(r.transferDepth).toBe('GENERALIZED');
    expect(r.farTransferSuccessCount).toBe(1);
    expect(r.distinctNoveltyDimensionsOk).toEqual(['CONCEPT_COMBINATION']);
    expect(r.lastSuccessfulTransferDistance).toBe('FAR');
  });
  it('2 certified successes across >=2 novelty dims in >=2 task families -> GENERALIZED', () => {
    const r = replayTransferState([
      certified({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-1', timestamp: ts(1), evidenceId: 'a' }),
      certified({ transferDistance: 'MID', noveltyDimensions: ['REPRESENTATION'], taskFamilyId: 'fam-2', timestamp: ts(2), evidenceId: 'b' }),
    ]);
    expect(r.transferDepth).toBe('GENERALIZED');
    expect(r.distinctNoveltyDimensionsOk).toEqual(['REPRESENTATION', 'STRATEGY']); // canonical NoveltyDimension order
  });
  it('GENERALIZED + later spaced MID/FAR SUCCESS in a NEW family -> ROBUST', () => {
    const r = replayTransferState([
      certified({ transferDistance: 'FAR', noveltyDimensions: ['CONSTRAINT'], taskFamilyId: 'fam-1', timestamp: ts(1), evidenceId: 'a' }),
      certified({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-2', spacingSatisfied: true, timestamp: ts(3), evidenceId: 'b' }),
    ]);
    expect(r.transferDepth).toBe('ROBUST');
  });
  it('GENERALIZED + rapid same-family repeat -> stays GENERALIZED', () => {
    const r = replayTransferState([
      certified({ transferDistance: 'FAR', noveltyDimensions: ['GOAL_FRAMING'], taskFamilyId: 'fam-1', timestamp: ts(1), evidenceId: 'a' }),
      certified({ transferDistance: 'FAR', noveltyDimensions: ['GOAL_FRAMING'], taskFamilyId: 'fam-1', spacingSatisfied: true, timestamp: ts(2), evidenceId: 'b' }),
    ]);
    expect(r.transferDepth).toBe('GENERALIZED');
  });
  it('certified but assisted -> ignored for depth/counts/dims (score only)', () => {
    const r = replayTransferState([certified({ transferDistance: 'FAR', noveltyDimensions: ['CONSTRAINT'], assisted: true })]);
    expect(r.transferDepth).toBe('NONE');
    expect(r.farTransferSuccessCount).toBe(0);
    expect(r.distinctNoveltyDimensionsOk).toEqual([]);
  });
});

describe('7C2 -- partial / failure / monotonicity', () => {
  it('PARTIAL only -> depth NONE', () => {
    expect(replayTransferState([ev({ result: 'PARTIAL' })]).transferDepth).toBe('NONE');
  });
  it('FAILURE only -> depth NONE', () => {
    expect(replayTransferState([ev({ result: 'FAILURE' })]).transferDepth).toBe('NONE');
  });
  it('SUCCESS then FAILURE -> depth stays demonstrated', () => {
    const r = replayTransferState([
      ev({ result: 'SUCCESS', timestamp: ts(1), evidenceId: 'a' }),
      ev({ result: 'FAILURE', timestamp: ts(2), evidenceId: 'b' }),
    ]);
    expect(r.transferDepth).toBe('NEAR_DEMONSTRATED');
  });
  it('ROBUST then FAILURE -> stays ROBUST (no demotion)', () => {
    const r = replayTransferState([
      certified({ transferDistance: 'FAR', noveltyDimensions: ['CONSTRAINT'], taskFamilyId: 'fam-1', timestamp: ts(1), evidenceId: 'a' }),
      certified({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-2', spacingSatisfied: true, timestamp: ts(2), evidenceId: 'b' }),
      ev({ result: 'FAILURE', timestamp: ts(3), evidenceId: 'c' }),
    ]);
    expect(r.transferDepth).toBe('ROBUST');
  });
});

describe('7C2 -- determinism & tie-break', () => {
  it('same-timestamp rows: replay is order-insensitive to input array order (tie-break on evidenceId ASC)', () => {
    const a = certified({ transferDistance: 'MID', noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-1', timestamp: ts(2), evidenceId: 'aaa' });
    const b = certified({ transferDistance: 'FAR', noveltyDimensions: ['CONSTRAINT'], taskFamilyId: 'fam-2', timestamp: ts(2), evidenceId: 'bbb' });
    expect(replayTransferState([a, b])).toEqual(replayTransferState([b, a]));
  });
  it('100 replays of the same history -> deep-equal', () => {
    const hist = [
      ev({ result: 'SUCCESS', timestamp: ts(1), evidenceId: 'a' }),
      certified({ transferDistance: 'FAR', noveltyDimensions: ['GOAL_FRAMING'], taskFamilyId: 'fam-1', timestamp: ts(2), evidenceId: 'b' }),
      ev({ result: 'PARTIAL', timestamp: ts(3), evidenceId: 'c' }),
    ];
    const first = JSON.stringify(replayTransferState(hist));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(replayTransferState(hist))).toBe(first);
  });
  it('policyVersion is TRANSFER_POLICY_VERSION', () => {
    expect(replayTransferState([]).policyVersion).toBe(TRANSFER_POLICY_VERSION);
  });
});

describe('7C2 -- toProjectionEvidence normalization', () => {
  const raw = (metadata: Record<string, unknown> | null, result = 'correct'): RawTransferEvidenceRow => ({
    id: 'ev-1', timestamp: '2026-09-01T00:00:00.000Z', result, metadata,
  });

  it('historical row: missing everything -> conservative legacy (NEAR, not certified), never throws', () => {
    const e = toProjectionEvidence(raw(null), { conceptId: 'c1', isCurrent: false });
    expect(e.phase7Certified).toBe(false);
    expect(e.transferDistance).toBe('NEAR');
    expect(e.assisted).toBe(false);
  });
  it('historical row: malformed transferDistance -> NEAR (matches computeTransferScore || NEAR)', () => {
    const e = toProjectionEvidence(raw({ transferDistance: 'BOGUS' }), { conceptId: 'c1', isCurrent: false });
    expect(e.transferDistance).toBe('NEAR');
    expect(e.phase7Certified).toBe(false);
  });
  it('current 7B/7C1 row (task id + fingerprint + distance, no novelty) -> NOT phase7Certified', () => {
    const e = toProjectionEvidence(
      raw({ transferDistance: 'MID', assisted: false, transferTaskId: 't1', promptFingerprint: FP, sourceConceptId: 'c1' }),
      { conceptId: 'c1', isCurrent: true },
    );
    expect(e.phase7Certified).toBe(false);
    expect(e.transferDistance).toBe('MID');
  });
  it('synthetic 7D row (novelty validated + dims) -> phase7Certified', () => {
    const e = toProjectionEvidence(
      raw({ transferDistance: 'FAR', assisted: false, transferTaskId: 't1', promptFingerprint: FP, sourceConceptId: 'c1', noveltyValidationPassed: true, noveltyDimensions: ['CONSTRAINT'] }),
      { conceptId: 'c1', isCurrent: true },
    );
    expect(e.phase7Certified).toBe(true);
    expect(e.noveltyDimensions).toEqual(['CONSTRAINT']);
  });

  const currentViolations: Array<[string, Record<string, unknown>]> = [
    ['missing transferTaskId', { transferDistance: 'MID', assisted: false, promptFingerprint: FP, sourceConceptId: 'c1' }],
    ['non-canonical fingerprint', { transferDistance: 'MID', assisted: false, transferTaskId: 't1', promptFingerprint: 'short', sourceConceptId: 'c1' }],
    ['sourceConceptId mismatch', { transferDistance: 'MID', assisted: false, transferTaskId: 't1', promptFingerprint: FP, sourceConceptId: 'other' }],
    ['assisted true', { transferDistance: 'MID', assisted: true, transferTaskId: 't1', promptFingerprint: FP, sourceConceptId: 'c1' }],
    ['invalid distance', { transferDistance: 'X', assisted: false, transferTaskId: 't1', promptFingerprint: FP, sourceConceptId: 'c1' }],
  ];
  for (const [label, md] of currentViolations) {
    it(`CURRENT row violation: ${label} -> throws InvalidCurrentTransferEvidenceError`, () => {
      expect(() => toProjectionEvidence(raw(md), { conceptId: 'c1', isCurrent: true })).toThrow(InvalidCurrentTransferEvidenceError);
    });
    it(`HISTORICAL row with same shape: ${label} -> does NOT throw (conservative)`, () => {
      expect(() => toProjectionEvidence(raw(md), { conceptId: 'c1', isCurrent: false })).not.toThrow();
    });
  }
});
