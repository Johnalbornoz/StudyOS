/**
 * Challenge needs a GOVERNED EMPIRICAL calibration: a raw or manually populated difficulty index is never "calibrated".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
import { examVersionHasCalibratedDifficulty } from '@/lib/assessment-experience/assessment-experience.service';

const recent = new Date(Date.now() - 86_400_000).toISOString();
beforeEach(() => { dbQueryMock.mockReset(); });

describe('examVersionHasCalibratedDifficulty', () => {
  it('a raw difficulty index without a calibration record is NOT calibrated (the query only reads calibration records)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    expect(await examVersionHasCalibratedDifficulty('v')).toBe(false);
    expect(String(dbQueryMock.mock.calls[0][0])).toMatch(/content \? 'difficultyCalibration'/);
  });
  it('an expert or model estimate, or a small / stale empirical sample, is NOT calibrated', async () => {
    for (const calibration of [{ source: 'EXPERT_REVIEW', sampleSize: 999, calibratedAt: recent }, { source: 'AUTOMATED_PRIOR', sampleSize: 999, calibratedAt: recent }, { source: 'EMPIRICAL', sampleSize: 50, calibratedAt: recent }, { source: 'EMPIRICAL', sampleSize: 999, calibratedAt: '2020-01-01T00:00:00Z' }]) {
      dbQueryMock.mockResolvedValueOnce({ rows: [{ difficulty_index: 1.2, calibration }] });
      expect(await examVersionHasCalibratedDifficulty('v'), JSON.stringify(calibration)).toBe(false);
    }
  });
  it('a governed EMPIRICAL calibration with enough independent responses is calibrated', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ difficulty_index: 1.2, calibration: { source: 'EMPIRICAL', sampleSize: 400, calibratedAt: recent, confidence: 0.8 } }] });
    expect(await examVersionHasCalibratedDifficulty('v')).toBe(true);
  });
  it('a database failure fails closed', async () => {
    dbQueryMock.mockImplementation(async () => { throw new Error('down'); });
    expect(await examVersionHasCalibratedDifficulty('v')).toBe(false);
  });
});
