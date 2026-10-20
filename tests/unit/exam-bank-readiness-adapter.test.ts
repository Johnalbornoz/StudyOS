/**
 * The read-only Readiness Adapter (pure mappings), the fail-closed difficulty rule, and the reduced-mock card
 * contradiction, on synthetic rows. No database, no provider, no PAA runtime.
 */
import { describe, expect, it } from 'vitest';
import { bucketsOf, difficultyProfileOfRaw, responseFormatOf, RUNTIME_CAPABILITIES, supplyRowOf, type RawSupplyRow } from '@/lib/exam-bank/readiness/bank-readiness-adapter';
import { evaluateExamBankReadiness, MODE_REQUIREMENTS } from '@/lib/exam-bank/readiness/bank-readiness';
import { deliverabilityOf } from '@/lib/exam-bank/readiness/certification-state';
import { calibratedDifficultyIndex, calibrationStatusOf } from '@/lib/exam-bank/readiness/difficulty';
import { assertReadOnly } from '@/lib/exam-bank/readiness/read-only-guard';
import { examAttemptOptions } from '@/lib/assessment-experience/views';
import type { BlueprintCell } from '@/lib/exam-core/question-bank/cells';

const NOW = new Date('2026-10-14T00:00:00.000Z');
let n = 0;
const raw = (over: Partial<RawSupplyRow> = {}): RawSupplyRow => {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  return {
    id, learning_objective_id: 'lo-1', question_type: 'numeric_problem', content: { answerFormat: 'text', math: { kind: 'NUMBER', answers: ['4'] }, difficulty: 3, marks: 1 },
    status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE', usage_eligibility: ['PRACTICE', 'REDUCED_MOCK'], exam_alignment: 'MOCK_READY', difficulty_index: null, calibration_confidence: 'INSUFFICIENT_DATA',
    calibration_sample_size: 0, calibrated_at: null, bank_item_id: `bank-${n}`, lineage_class: 'CORE_DERIVED', retired_at: null, current_version_id: id, provenance: 'STUDYUS_AUTHORED',
    inst_state: 'AUTOMATED_CERTIFIED_PILOT', inst_mode: 'INHERITED_DETERMINISTIC_CERTIFICATION', inst_scopes: ['PILOT_PREVIEW'], inst_rights_category: 'STUDYUS_ORIGINAL_DETERMINISTIC', inst_refusal: null,
    pilot_state: null, pilot_revoked: null, pilot_in_scope: null, pilot_deliverable: false, legacy_reuse_rights: null, ...over,
  };
};
const ctx = { scope: 'PILOT_PREVIEW' as const, use: 'PRACTICE' as const, bucketIds: ['cell-a'] };
const deliver = (r: RawSupplyRow, scope: 'PILOT_PREVIEW' | 'PRODUCTION' = 'PILOT_PREVIEW') => deliverabilityOf(supplyRowOf(r, { ...ctx, scope }).row, { scope, capabilities: RUNTIME_CAPABILITIES, blueprintBucketIds: new Set(['cell-a']) });

describe('response format and scoring capability', () => {
  it('maps the stored content shape to a format, in the grader precedence', () => {
    expect(responseFormatOf({ answerFormat: 'single_choice', options: [] })).toBe('SELECTED_RESPONSE');
    expect(responseFormatOf({ answerFormat: 'text', math: { kind: 'NUMBER' } })).toBe('NUMERIC_ENTRY');
    expect(responseFormatOf({ answerFormat: 'text', math: { kind: 'EXPRESSION' } })).toBe('MATH_EXPRESSION');
    expect(responseFormatOf({ answerFormat: 'text', parts: [{ answerFormat: 'math', math: {} }] })).toBe('MULTI_PART');
    expect(responseFormatOf({ answerFormat: 'text', parts: [{ answerFormat: 'text' }] })).toBe('MULTI_PART_UNKEYED');
    expect(responseFormatOf({ answerFormat: 'text', rubric: { kind: 'ANALYTIC' } })).toBe('RUBRIC_ASSESSED');
    expect(responseFormatOf({ answerFormat: 'text' })).toBe('FREE_TEXT_UNKEYED');
    expect(responseFormatOf({ answerFormat: 'text', itemType: 'SHORT_RESPONSE', math: { kind: 'NUMBER', responseContract: { version: 'canonical-response-1' } } })).toBe('SHORT_RESPONSE_KEYED');
  });
  it('AI-assessed and unkeyed formats render but are not scorable for readiness', () => {
    for (const f of ['RUBRIC_ASSESSED', 'FREE_TEXT_UNKEYED', 'MULTI_PART_UNKEYED']) {
      expect(RUNTIME_CAPABILITIES.renderableFormats).toContain(f);
      expect(RUNTIME_CAPABILITIES.scorableFormats).not.toContain(f);
    }
    const r = deliver(raw({ content: { answerFormat: 'text', rubric: { kind: 'ANALYTIC' }, difficulty: 3 } }));
    expect(r).toEqual({ verdict: 'CERTIFIED_NOT_DELIVERABLE', reasons: ['FORMAT_NOT_SCORABLE'] });
  });
});

describe('certified supply and runtime eligibility', () => {
  it('a clean core-derived pilot instance is runtime-deliverable in the pilot scope only', () => {
    expect(deliver(raw())).toEqual({ verdict: 'RUNTIME_DELIVERABLE', reasons: [] });
    expect(deliver(raw(), 'PRODUCTION')).toEqual({ verdict: 'CERTIFIED_NOT_DELIVERABLE', reasons: ['CERTIFICATION_OUT_OF_SCOPE'] });
  });
  it('the DB refusal maps to lineage / rights / certification', () => {
    expect(deliver(raw({ inst_refusal: 'BLUEPRINT_NOT_GOVERNED' })).reasons).toEqual(['LINEAGE_INCOMPLETE']);
    expect(deliver(raw({ inst_refusal: 'RIGHTS_STATE_NOT_DELIVERABLE' })).reasons).toEqual(['RIGHTS_NOT_CLEARED']);
    expect(deliver(raw({ inst_state: 'REVIEW_REQUIRED', inst_refusal: 'NOT_CERTIFIED' })).verdict).toBe('NOT_CERTIFIED');
  });
  it('LEGACY rows are not certified, whatever the runtime does with them', () => {
    const r = supplyRowOf(raw({ lineage_class: 'LEGACY', inst_state: null, legacy_reuse_rights: 'STUDYUS_OWNED' }), ctx);
    expect(r.row.certification).toBe('LEGACY_UNGOVERNED');
    expect(deliver(raw({ lineage_class: 'LEGACY', inst_state: null, legacy_reuse_rights: 'STUDYUS_OWNED' })).verdict).toBe('NOT_CERTIFIED');
  });
  it('pilot-certified rows: in scope deliverable; revoked or out of scope not', () => {
    const pilot = { lineage_class: 'PILOT_CERTIFIED', inst_state: null, pilot_state: 'AUTOMATED_CERTIFIED_PILOT', pilot_revoked: false, pilot_in_scope: true, pilot_deliverable: true } as const;
    expect(deliver(raw(pilot)).verdict).toBe('RUNTIME_DELIVERABLE');
    expect(deliver(raw({ ...pilot, pilot_revoked: true })).verdict).toBe('NOT_CERTIFIED');
    expect(deliver(raw({ ...pilot, pilot_in_scope: false })).reasons).toEqual(['LINEAGE_INCOMPLETE']);
  });
  it('the Question Bank lifecycle is a usage gate, separate from certification', () => {
    expect(deliver(raw({ bank_lifecycle_status: 'PILOT' })).reasons).toEqual(['LIFECYCLE_NOT_DELIVERABLE']);
    expect(deliver(raw({ provenance: 'FIXTURE' })).reasons).toEqual(['LIFECYCLE_NOT_DELIVERABLE']);
    expect(deliver(raw({ usage_eligibility: ['REDUCED_MOCK'] })).reasons).toEqual(['LIFECYCLE_NOT_DELIVERABLE']);
    // a superseded version of a bank item is not deliverable (RETIRED here), the current one is
    expect(deliver(raw({ current_version_id: 'another-version' })).reasons).toContain('RETIRED');
  });
  it('exposure identity is the bank item, not the version', () => {
    const r = supplyRowOf(raw({ bank_item_id: 'bank-stable' }), ctx);
    expect(r.row.itemId).toBe('bank-stable');
  });
  it('buckets: reduced vs full positions, per section', () => {
    const cells = [{ cellKey: 'm|a', sectionKey: 'matematicas', reducedPositions: 3, fullPositions: 10 }, { cellKey: 'l|b', sectionKey: 'lectura', reducedPositions: 0, fullPositions: 5 }] as BlueprintCell[];
    expect(bucketsOf(cells, null)).toEqual([{ bucketId: 'm|a', requiredPositions: 3, allowedFormats: null }]);
    expect(bucketsOf(cells, ['lectura'], 'FULL')).toEqual([{ bucketId: 'l|b', requiredPositions: 5, allowedFormats: null }]);
  });
});

describe('MISSING_DIFFICULTY_FAILS_CLOSED', () => {
  it('a missing difficulty index is null and NOT_CALIBRATED -- never 1.0', () => {
    const p = difficultyProfileOfRaw(raw());
    expect(p.difficultyIndex).toBeNull();
    expect(calibrationStatusOf(p, undefined, NOW)).toBe('NOT_CALIBRATED');
    expect(calibratedDifficultyIndex(p, undefined, NOW)).toBeNull();
  });
  it('an authored index (even exactly 1.0) is a prior, not a calibration', () => {
    const p = difficultyProfileOfRaw(raw({ content: { answerFormat: 'text', math: { kind: 'NUMBER' }, difficulty: 3, difficultyIndex: 1.0 } }));
    expect(p).toMatchObject({ difficultyIndex: 1, calibrationSource: 'AUTOMATED_PRIOR', sampleSize: 0 });
    expect(calibrationStatusOf(p, undefined, NOW)).toBe('NOT_CALIBRATED');
    expect(calibratedDifficultyIndex(p, undefined, NOW)).toBeNull();
  });
  it('field evidence calibrates only with a sufficient, fresh sample and an index', () => {
    const ok = difficultyProfileOfRaw(raw({ difficulty_index: 1.2, calibration_sample_size: 300, calibrated_at: '2026-09-01T00:00:00.000Z', calibration_confidence: 'MODERATE_CONFIDENCE' }));
    expect(calibrationStatusOf(ok, undefined, NOW)).toBe('CALIBRATED');
    expect(calibratedDifficultyIndex(ok, undefined, NOW)).toBe(1.2);
    const noIndex = difficultyProfileOfRaw(raw({ calibration_sample_size: 300, calibrated_at: '2026-09-01T00:00:00.000Z' }));
    expect(calibrationStatusOf(noIndex, undefined, NOW)).toBe('NOT_CALIBRATED');
  });
  it('Challenge stays NOT_READY on uncalibrated supply, including authored 1.0 indices', () => {
    const blueprint = { assessmentSystem: 'SYNTH', assessmentVersion: 'v1', profile: null, component: null, blueprintId: 'bp', blueprintVersion: '1', buckets: [{ bucketId: 'cell-a', requiredPositions: 2, allowedFormats: null }] };
    const supply = [raw(), raw(), raw({ content: { answerFormat: 'text', math: { kind: 'NUMBER' }, difficulty: 3, difficultyIndex: 1.0 } })].map((r) => supplyRowOf(r, ctx).row);
    const practice = evaluateExamBankReadiness({ blueprint, mode: MODE_REQUIREMENTS.SECTION_PRACTICE, scope: 'PILOT_PREVIEW', capabilities: RUNTIME_CAPABILITIES, supply, now: NOW });
    const challenge = evaluateExamBankReadiness({ blueprint, mode: MODE_REQUIREMENTS.CHALLENGE, scope: 'PILOT_PREVIEW', capabilities: RUNTIME_CAPABILITIES, supply, now: NOW });
    expect(practice.status).toBe('READY');
    expect(challenge.status).toBe('NOT_READY');
    expect(challenge.blockingReasons).toContain('CALIBRATION_REQUIRED');
    expect(challenge.difficultyCapability).toBe('NONE');
  });
});

describe('the reduced-mock card contradiction (PAA-FOLLOWUP-01), reproduced without a database', () => {
  it('the card can never offer a reduced mock while the engine is READY on full supply', () => {
    const blueprint = { assessmentSystem: 'SYNTH', assessmentVersion: 'v1', profile: null, component: null, blueprintId: 'bp', blueprintVersion: '1', buckets: [{ bucketId: 'cell-a', requiredPositions: 2, allowedFormats: null }] };
    const supply = [raw(), raw(), raw(), raw()].map((r) => supplyRowOf(r, { ...ctx, use: 'REDUCED_MOCK' }).row);
    expect(evaluateExamBankReadiness({ blueprint, mode: MODE_REQUIREMENTS.MOCK, scope: 'PILOT_PREVIEW', capabilities: RUNTIME_CAPABILITIES, supply, now: NOW }).status).toBe('READY');
    // what CanonicalExamAvailability renders: examAvailabilityForVersion passes officialForm: null
    const card = examAttemptOptions({ officialForm: null, fidelity: null, difficultyBandMet: null, practiceContentAvailable: true, challengeDifficultyCalibrated: false });
    expect(card.find((o) => o.type === 'REDUCED_MOCK')).toEqual({ type: 'REDUCED_MOCK', available: false, reason: 'CONTENT_NOT_READY' });
  });
});

describe('read-only guard of the shadow script', () => {
  it('allows reads and transaction control, refuses every write', () => {
    for (const ok of ['SELECT 1', '  with x as (select 1) select * from x', 'BEGIN', 'SET TRANSACTION READ ONLY', 'ROLLBACK']) expect(() => assertReadOnly(ok)).not.toThrow();
    for (const bad of ['INSERT INTO t VALUES (1)', 'update t set a=1', 'DELETE FROM t', 'with x as (select 1) insert into t select * from x', 'CREATE TABLE t()', 'SELECT nextval(\'s\')', 'SET search_path = x', 'TRUNCATE t', 'REFRESH MATERIALIZED VIEW v']) expect(() => assertReadOnly(bad)).toThrow(/READ_ONLY_GUARD/);
    expect(() => assertReadOnly({ text: 'DELETE FROM t' })).toThrow();
  });
});
