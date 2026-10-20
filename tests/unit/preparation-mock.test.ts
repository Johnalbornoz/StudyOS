/**
 * PREPARATION_MOCK (John, 2026-10-15): a full-length StudyUs preparation mock whose official structure cannot be
 * verified starts ONLY under a recorded authorisation, is never FULL_MOCK (official) nor REDUCED_MOCK, is
 * preparation (never an official exam), keeps the frozen-mock content governance, and is offered as itself.
 */
import { describe, expect, it } from 'vitest';
import { deriveInstanceAttemptType, type FormFidelity } from '@/lib/exam-core/form-fidelity';
import { assessmentPathOf, instanceStartViolation, mayUseGeneratedFallback } from '@/lib/simulation/preparation-simulation';
import { FAMILY_OF_PATH } from '@/lib/assessment-foundation/families';
import { examAttemptOptionsUnderEngine, type ExamAttemptOption } from '@/lib/assessment-experience/views';
import { examEntryHrefs } from '@/lib/exam-core/objectives/capabilities';
import { MESSAGES } from '@/lib/i18n/messages';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const unknown = (...reasons: string[]): FormFidelity => ({ fidelity: 'UNKNOWN', reasons } as FormFidelity);

describe('the one start decision', () => {
  it('authorised + complete size + only timing / distribution unverifiable -> PREPARATION_MOCK', () => {
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: unknown('OFFICIAL_TIMING_NOT_VERIFIABLE'), difficultyBandMet: null, preparationMockAuthorized: true })).toEqual({ startable: true, type: 'PREPARATION_MOCK' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: unknown('OFFICIAL_TIMING_NOT_VERIFIABLE', 'DISTRIBUTION_NOT_DOCUMENTED'), difficultyBandMet: null, preparationMockAuthorized: true })).toMatchObject({ startable: true, type: 'PREPARATION_MOCK' });
  });
  it('without authorisation, or with any other unknown reason, nothing starts (never downgraded)', () => {
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: unknown('OFFICIAL_TIMING_NOT_VERIFIABLE'), difficultyBandMet: null })).toMatchObject({ startable: false, reason: 'FIDELITY_UNKNOWN' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: unknown('COMPONENT_DEFINITION_MISSING'), difficultyBandMet: null, preparationMockAuthorized: true })).toMatchObject({ startable: false });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: unknown('OFFICIAL_TIMING_NOT_VERIFIABLE', 'OFFICIAL_SIZE_NOT_RECORDED'), difficultyBandMet: null, preparationMockAuthorized: true })).toMatchObject({ startable: false });
  });
  it('a verified FULL or a REDUCED form is unchanged by the authorisation', () => {
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: { fidelity: 'REDUCED', reasons: ['UNFILLED_POSITIONS'] } as FormFidelity, difficultyBandMet: null, preparationMockAuthorized: true })).toEqual({ startable: true, type: 'REDUCED_MOCK' });
    expect(deriveInstanceAttemptType({ mode: 'MOCK', fidelity: { fidelity: 'FULL', reasons: [] } as FormFidelity, difficultyBandMet: true, preparationMockAuthorized: true })).toEqual({ startable: true, type: 'FULL_MOCK' });
  });
});

describe('what a PREPARATION_MOCK is', () => {
  it('preparation, never an official exam; frozen content governance (no generated fallback); needs its MOCK instance and frozen form', () => {
    expect(assessmentPathOf({ simulationType: 'PREPARATION_MOCK', instanceMode: 'MOCK', formFrozen: true, formFidelity: null } as never)).toBe('PREPARATION_MOCK');
    expect(FAMILY_OF_PATH.PREPARATION_MOCK).toBe('EXAM_PREPARATION');
    expect(mayUseGeneratedFallback({ simulationType: 'PREPARATION_MOCK' } as never)).toBe(false);
    expect(instanceStartViolation({ simulationType: 'PREPARATION_MOCK', examInstanceId: 'i', examInstanceMode: 'MOCK', hasFrozenForm: true })).toBeNull();
    expect(instanceStartViolation({ simulationType: 'PREPARATION_MOCK', examInstanceId: null, hasFrozenForm: false })).not.toBeNull();
  });
  it('the migration only widens the two simulation_type CHECKs', () => {
    const sql = readFileSync(join(process.cwd(), 'database/migrations/20261126_1000_simulation_type_preparation_mock.sql'), 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n');
    expect(sql.match(/ALTER TABLE public\.(\w+)/g)).toEqual(['ALTER TABLE public.simulation_plans', 'ALTER TABLE public.simulation_plans', 'ALTER TABLE public.simulation_attempts', 'ALTER TABLE public.simulation_attempts']);
    expect(sql).not.toMatch(/UPDATE|DELETE|INSERT|DROP TABLE|DROP COLUMN/);
  });
});

describe('offered as itself', () => {
  const base: ExamAttemptOption[] = [
    { type: 'EXAM_PRACTICE', available: true, reason: null }, { type: 'REDUCED_MOCK', available: false, reason: 'CONTENT_NOT_READY' },
    { type: 'FULL_MOCK', available: false, reason: 'CONTENT_NOT_READY' }, { type: 'EXAM_CHALLENGE', available: false, reason: 'DIFFICULTY_NOT_CALIBRATED' },
  ];
  it('a preparation mock card replaces the reduced / official full mock cards (which stay unavailable)', () => {
    const o = examAttemptOptionsUnderEngine(base, { anyPractice: true, reducedMock: 'READY', fullMock: 'READY', challenge: 'NOT_READY', mockAttemptType: 'PREPARATION_MOCK' }, { reducedMock: false, fullMock: true });
    expect(o.map((x) => [x.type, x.available])).toEqual([['EXAM_PRACTICE', true], ['REDUCED_MOCK', false], ['PREPARATION_MOCK', true], ['FULL_MOCK', false], ['EXAM_CHALLENGE', false]]);
  });
  it('every other exam keeps its cards exactly (no preparation card)', () => {
    const o = examAttemptOptionsUnderEngine(base, { anyPractice: true, reducedMock: 'READY', fullMock: 'NOT_READY', challenge: 'NOT_READY', mockAttemptType: 'REDUCED_MOCK' }, { reducedMock: true, fullMock: false });
    expect(o.map((x) => [x.type, x.available])).toEqual([['EXAM_PRACTICE', true], ['REDUCED_MOCK', true], ['FULL_MOCK', false], ['EXAM_CHALLENGE', false]]);
  });
  it('its "Comenzar" links to a launchable mock entry, never to nothing', () => {
    const h = examEntryHrefs('saber11.math', { practiceModes: [{ nodeKey: 'saber11.math', label: 'M', purpose: 'AREA_PRACTICE' }], reducedMocks: [], fullMocks: [{ nodeKey: 'saber11.math', label: 'M', purpose: 'AREA_PRACTICE' }] } as never);
    expect(h.PREPARATION_MOCK).toBe('/dashboard/exams?node=saber11.math');
    expect(examEntryHrefs('x', { practiceModes: [], reducedMocks: [], fullMocks: [] } as never).PREPARATION_MOCK).toBeUndefined();
  });
  it('it has its own labels in every locale, saying StudyUs preparation', () => {
    for (const [locale, m] of Object.entries(MESSAGES)) {
      const t = m as Record<string, string>;
      expect(t['ex.type.PREPARATION_MOCK'], locale).toMatch(/StudyUs/);
      expect(t['exv2.mode.MOCK.preparation'], locale).toMatch(/StudyUs/);
    }
  });
});
