/**
 * Preview integration -- R1 (objective-first profiles feed the Learning Plan)
 * and R2 (one idempotent post-completion flow on every exam completion path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
vi.mock('@/lib/exam-core/objectives/objective-catalog', () => ({
  objectiveByKey: (key: string) =>
    key === 'paa' ? { key: 'paa', label: 'PAA (College Board)', configKeys: ['PAA_CB'] } : key === 'no-config' ? { key: 'no-config', label: 'Objetivo sin examen', configKeys: [] } : null,
}));
const scoreMock = vi.fn();
const refreshMock = vi.fn();
const pilotMock = vi.fn();
vi.mock('@/lib/exam-core/results.service', () => ({ scoreAndRecordAttemptResult: (...a: any[]) => scoreMock(...a) }));
vi.mock('@/lib/learning-plan/exam-bridge.service', () => ({ refreshExamGapRecommendations: (...a: any[]) => refreshMock(...a) }));
vi.mock('@/lib/observability/pilot-events', () => ({ logPilotEvent: (...a: any[]) => pilotMock(...a) }));

import { resolveExamProfiles } from '@/lib/learning-plan/exam-profile-resolution';
import { finalizeExamCompletion } from '@/lib/exam-core/post-completion';

const DEFS = [
  { id: 'def-ib', name: 'IB Math AA SL', config_key: 'IB_MATH_AA_SL', academic_subject_id: 'subj-ib', latest_version_id: 'ver-ib' },
  { id: 'def-paa', name: 'PAA', config_key: 'PAA_CB', academic_subject_id: 'subj-paa', latest_version_id: 'ver-paa' },
];

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: DEFS });
  scoreMock.mockReset().mockResolvedValue({ rawScore: 3, maxScore: 5 });
  refreshMock.mockReset().mockResolvedValue(1);
  pilotMock.mockReset();
});

describe('R1 -- exam profile resolution (definition-based and objective-first)', () => {
  it('definition-based profiles keep the existing path (pinned version wins, else latest published)', async () => {
    const r = await resolveExamProfiles([
      { id: 'p1', examDefinitionId: 'def-ib', examVersionId: null, objectiveKey: null, objectiveContext: null },
      { id: 'p2', examDefinitionId: 'def-ib', examVersionId: 'ver-pinned', objectiveKey: null, objectiveContext: null },
    ]);
    expect(r.get('p1')).toMatchObject({ name: 'IB Math AA SL', versionIds: ['ver-ib'], academicSubjectIds: ['subj-ib'], source: 'DEFINITION', mappingStatus: 'MAPPED' });
    expect(r.get('p2')?.versionIds).toEqual(['ver-pinned']);
  });

  it('objective-first profiles (exam_definition_id NULL) resolve through the governed objective -> config keys -> definitions', async () => {
    const r = await resolveExamProfiles([{ id: 'p3', examDefinitionId: null, examVersionId: null, objectiveKey: 'paa', objectiveContext: { label: 'PAA' } }]);
    expect(r.get('p3')).toMatchObject({ name: 'PAA (College Board)', definitionIds: ['def-paa'], versionIds: ['ver-paa'], academicSubjectIds: ['subj-paa'], source: 'OBJECTIVE', mappingStatus: 'MAPPED' });
    expect(dbQueryMock.mock.calls[0][1]).toEqual([[], ['PAA_CB']]);
  });

  it('an objective with no configured exam is MAPPING_NOT_AVAILABLE -- reported, never dropped, never invented', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    const r = await resolveExamProfiles([
      { id: 'p4', examDefinitionId: null, examVersionId: null, objectiveKey: 'no-config', objectiveContext: null },
      { id: 'p5', examDefinitionId: null, examVersionId: null, objectiveKey: 'unknown-key', objectiveContext: { label: 'Etiqueta guardada' } },
    ]);
    expect(r.get('p4')).toMatchObject({ name: 'Objetivo sin examen', versionIds: [], mappingStatus: 'MAPPING_NOT_AVAILABLE' });
    expect(r.get('p5')).toMatchObject({ name: 'Etiqueta guardada', source: 'NONE', mappingStatus: 'MAPPING_NOT_AVAILABLE' });
    expect(r.size).toBe(2);
  });

  it('one batched query whatever the number of profiles; no query for none', async () => {
    await resolveExamProfiles([
      { id: 'a', examDefinitionId: 'def-ib', examVersionId: null, objectiveKey: null, objectiveContext: null },
      { id: 'b', examDefinitionId: null, examVersionId: null, objectiveKey: 'paa', objectiveContext: null },
    ]);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    dbQueryMock.mockClear();
    expect((await resolveExamProfiles([])).size).toBe(0);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('the Learning Plan, curriculum context and class progress no longer inner-join exam_definitions on profiles', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
    for (const f of ['src/lib/learning-plan/exam-bridge.service.ts', 'src/lib/learning-plan/curriculum.service.ts', 'src/lib/teacher/class-progress.service.ts']) {
      expect(read(f), f).not.toMatch(/(?<!LEFT )JOIN exam_definitions ed ON ed\.id = sep\.exam_definition_id/);
    }
  });
});

describe('R2 -- unified post-completion flow', () => {
  it('scores (authoritative, idempotent) then refreshes gap recommendations', async () => {
    const r = await finalizeExamCompletion('att-1', 'stu-1', '/x');
    expect(scoreMock).toHaveBeenCalledWith('att-1');
    expect(refreshMock).toHaveBeenCalledWith('stu-1');
    expect(r).toEqual({ result: { rawScore: 3, maxScore: 5 }, gapRefresh: 'REFRESHED' });
    expect(scoreMock.mock.invocationCallOrder[0]).toBeLessThan(refreshMock.mock.invocationCallOrder[0]);
  });

  it('a failed gap refresh keeps the exam result valid and records a retryable failure', async () => {
    refreshMock.mockRejectedValue(new Error('db down'));
    const r = await finalizeExamCompletion('att-1', 'stu-1', '/x');
    expect(r.result).toEqual({ rawScore: 3, maxScore: 5 });
    expect(r.gapRefresh).toBe('RETRYABLE_FAILURE');
    expect(pilotMock).toHaveBeenCalledWith('exam_gap_refresh_failed', expect.objectContaining({ studentId: 'stu-1', attemptId: 'att-1', retryable: true }));
  });

  it('a scoring failure is not swallowed (no refresh against a missing result)', async () => {
    scoreMock.mockRejectedValue(new Error('NOT_COMPLETED'));
    await expect(finalizeExamCompletion('att-1', 'stu-1', '/x')).rejects.toThrow('NOT_COMPLETED');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('every real completion path runs the unified flow', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
    const route = read('src/app/api/simulation/attempts/[id]/complete/route.ts');
    expect(route.match(/finalizeExamCompletion\(/g)?.length).toBe(3); // replay, race, main
    expect(route).not.toMatch(/scoreAndRecordAttemptResult\(/);
    expect(read('src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx')).toMatch(/finalizeExamCompletion\(/);
  });
});
