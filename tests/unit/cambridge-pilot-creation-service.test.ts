import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * FD Cambridge -- the server side of the creation flow and the series change (DB-free: the database is a recording
 * mock). The freeze lives in the existing jsonb (objective_context.cambridgeFreeze); the series change keeps the same
 * preparation row (progress, attempts and evidence stay attached), writes only the target, and is audited.
 */
const calls = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: unknown[] }>, profile: null as any }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async (sql: string, params: unknown[] = []) => { calls.sql.push({ sql, params }); return { rows: [], rowCount: /UPDATE student_exam_profiles/.test(sql) ? 1 : 0 }; }) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({
  getStudentExamProfile: vi.fn(async () => calls.profile),
  createStudentExamProfile: vi.fn(async () => calls.profile),
}));
vi.mock('@/lib/exam-core/objectives/preparation.service', async (orig) => {
  const real = await orig<typeof import('@/lib/exam-core/objectives/preparation.service')>();
  return {
    ...real,
    studentCountryOfStudy: vi.fn(async () => 'CO'),
    createObjectivePreparation: vi.fn(async () => ({ profile: calls.profile, created: true, capabilities: { canPractice: false } })),
  };
});

import { track } from '@/lib/analytics';
import { createCambridgePreparation, changeCambridgeSeries, CambridgeFlowError } from '@/lib/exam-core/cambridge/creation.service';
import { createObjectivePreparation } from '@/lib/exam-core/objectives/preparation.service';
import { validateCreation } from '@/lib/exam-core/cambridge/creation-flow';
import { JOSE_MAX_LEON_CHECKPOINT_ROUTE } from '@/lib/exam-core/checkpoint/checkpoint-preparation';

const NOW = new Date('2026-10-17T12:00:00Z');
const realPrep = () => vi.importActual<typeof import('@/lib/exam-core/objectives/preparation.service')>('@/lib/exam-core/objectives/preparation.service');
const frozen = () => {
  const v = validateCreation({ programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'EXTENDED', examYear: 2027, examSeries: 'JUNE' }, { now: NOW, country: 'CO', checkpointRoute: JOSE_MAX_LEON_CHECKPOINT_ROUTE });
  if (!v.ok) throw new Error('fixture');
  return v.freeze;
};
const profileRow = (objectiveContext: Record<string, unknown> | null) => ({ id: 'p1', studentId: 's1', status: 'ACTIVE', objectiveKey: 'cie.igcse.0580.extended', objectiveContext, targetExamSeries: 'JUNE', targetExamYear: 2027 });

beforeEach(() => {
  calls.sql = [];
  calls.profile = null;
  vi.mocked(track).mockClear();
  vi.mocked(createObjectivePreparation).mockClear();
});

describe('creation is only through the Cambridge flow', () => {
  it('a bare objective request for a Cambridge school subject is CAMBRIDGE_CREATION_FLOW_REQUIRED, before any DB access', async () => {
    const { createObjectivePreparation: real } = await realPrep();
    for (const key of ['cie.igcse.0580.core', 'cie.igcse.0580.extended', 'cie.igcse.0610.core', 'cie.igcse.0510.speaking-endorsement']) {
      await expect(real('s1', { objectiveKey: key })).rejects.toMatchObject({ code: 'CAMBRIDGE_CREATION_FLOW_REQUIRED' });
    }
    expect(calls.sql).toEqual([]);
  });
  it('the flow validates on the server and freezes the target in the existing jsonb + target columns', async () => {
    calls.profile = profileRow({ label: 'x' });
    const r = await createCambridgePreparation('s1', { programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'JUNE' }, NOW);
    expect(createObjectivePreparation).toHaveBeenCalledWith('s1', expect.objectContaining({ objectiveKey: 'cie.igcse.0580.core', viaCambridgeFlow: true }));
    const upd = calls.sql.filter((c) => /UPDATE student_exam_profiles/.test(c.sql));
    expect(upd).toHaveLength(1);
    expect(upd[0].sql).toContain("'{cambridgeFreeze}'");
    expect(upd[0].sql).toContain("NOT (COALESCE(objective_context, '{}'::jsonb) ? 'cambridgeFreeze')"); // never overwrites a freeze
    expect(JSON.parse(upd[0].params[2] as string)).toMatchObject({ syllabusCode: '0580', syllabusVersion: 'v3', tier: 'CORE', examSeries: 'JUNE', examYear: 2027, preparationStartDate: '2026-10-17' });
    expect(upd[0].params.slice(3)).toEqual(['JUNE', 2027]);
    expect(r.calendar).toMatchObject({ targetMonth: '2027-06', official: false });
  });
  it('an invalid selection is refused with the flow error, nothing is written', async () => {
    await expect(createCambridgePreparation('s1', { programme: 'IGCSE', subject: 'BIOLOGY', tier: 'CORE', examYear: 2027, examSeries: 'JUNE' }, NOW)).rejects.toBeInstanceOf(CambridgeFlowError);
    await expect(createCambridgePreparation('s1', { programme: 'IGCSE', subject: 'MATHEMATICS', tier: 'CORE', examYear: 2027, examSeries: 'MARCH' }, NOW)).rejects.toMatchObject({ code: 'INVALID_EXAM_SERIES' });
    expect(createObjectivePreparation).not.toHaveBeenCalled();
    expect(calls.sql.filter((c) => /UPDATE|INSERT|DELETE/.test(c.sql))).toEqual([]);
  });
});

describe('series change preserves progress and evidence', () => {
  it('same preparation row, only the target written (guarded by the previous series), audited, calendar recomputed', async () => {
    const f = frozen();
    calls.profile = profileRow({ cambridgeFreeze: f });
    const r = await changeCambridgeSeries('s1', 'p1', { examSeries: 'NOVEMBER', examYear: 2027, confirm: true }, NOW);
    const writes = calls.sql.filter((c) => /UPDATE|INSERT|DELETE/i.test(c.sql));
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/^\s*UPDATE student_exam_profiles/);
    expect(writes[0].sql).not.toMatch(/DELETE|simulation_attempts|learning_evidence|exam_readiness_evidence|concept_knowledge_state/);
    expect(writes[0].params.slice(0, 2)).toEqual(['p1', 's1']);
    expect(writes[0].params.slice(3)).toEqual(['NOVEMBER', 2027, 'JUNE', 2027]);
    const stored = JSON.parse(writes[0].params[2] as string);
    expect(stored.seriesChanges).toHaveLength(1);
    expect(stored.seriesChanges[0]).toMatchObject({ actor: 'STUDENT', actorId: 's1', evidencePreserved: true, from: { examSeries: 'JUNE' }, to: { examSeries: 'NOVEMBER' } });
    expect(r.profile.id).toBe('p1');
    expect(r.calendar.targetMonth).toBe('2027-11');
    expect(track).toHaveBeenCalledWith('s1', 'cambridge_preparation_series_changed', expect.objectContaining({ profileId: 'p1' }));
  });
  it('without confirmation nothing is written', async () => {
    calls.profile = profileRow({ cambridgeFreeze: frozen() });
    await expect(changeCambridgeSeries('s1', 'p1', { examSeries: 'NOVEMBER', examYear: 2027, confirm: false }, NOW)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(calls.sql.filter((c) => /UPDATE|INSERT|DELETE/.test(c.sql))).toEqual([]);
  });
  it('another Student\'s preparation does not exist for the caller', async () => {
    calls.profile = { ...profileRow({ cambridgeFreeze: frozen() }), studentId: 'other' };
    await expect(changeCambridgeSeries('s1', 'p1', { examSeries: 'NOVEMBER', examYear: 2027, confirm: true }, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('the generic PATCH never mutates a frozen series silently (same value is a no-op)', async () => {
    const { updatePreparationDetails } = await realPrep();
    calls.profile = profileRow({ cambridgeFreeze: frozen() });
    await expect(updatePreparationDetails('s1', 'p1', { examSession: 'ES:NOVEMBER:2027' }, NOW)).rejects.toMatchObject({ code: 'SERIES_CHANGE_FLOW_REQUIRED' });
    await expect(updatePreparationDetails('s1', 'p1', { examSession: null }, NOW)).rejects.toMatchObject({ code: 'SERIES_CHANGE_FLOW_REQUIRED' });
    expect(calls.sql).toEqual([]);
    await updatePreparationDetails('s1', 'p1', { examSession: 'ES:JUNE:2027', purpose: 'x' }, NOW);
    const upd = calls.sql.filter((c) => /UPDATE student_exam_profiles/.test(c.sql));
    expect(upd).toHaveLength(1);
    expect(upd[0].sql).not.toContain('target_exam_series');
  });
});
