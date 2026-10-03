/**
 * POST /api/exams/instances -- official component combinations (Cambridge
 * routes): a Mock / Challenge must take exactly one route option (or one
 * stage of a staged route); Practice may take any single component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_n: string, h: unknown) => h }));
vi.mock('@/lib/exam-core/route-auth', () => ({ requireActor: vi.fn(async () => ({ ok: true, actorUserId: 'actor' })), requireOwnerOf: vi.fn(async () => ({ ok: true })), ownStudentId: vi.fn(async () => 'student') }));
vi.mock('@/lib/exam-core/catalog/structure.service', () => ({ resolveExamLevel: vi.fn() }));
vi.mock('@/lib/exam-core/exam-instance.service', () => {
  class ExamInstanceError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { ExamInstanceError, createExamInstance: vi.fn(async () => ({ id: 'i' })), ensureExamProfile: vi.fn(async () => 'p'), listExamInstances: vi.fn(), toInstanceView: vi.fn(async () => ({ id: 'i' })) };
});

import { resolveExamLevel } from '@/lib/exam-core/catalog/structure.service';
import { createExamInstance } from '@/lib/exam-core/exam-instance.service';
import { POST } from '@/app/api/exams/instances/route';

const C = (k: string) => `00000000-0000-4000-8000-00000000000${k}`;
const comp = (k: string) => ({ componentId: C(k), nodeKey: null, name: `P${k}`, facts: null, untimed: false, kind: 'WRITTEN_PAPER', readiness: 'REDUCED_MOCK_READY', officialMinutes: 75, officialItems: null, officialMarks: 50, calculator: 'ALLOWED', plannedMinutes: 15 });
const level9709AS = {
  nodeKey: 'cie.aice.g1.9709.as', family: 'CAMBRIDGE', label: 'AS Level', purpose: null, examDefinitionId: 'd', examVersionId: 'v', modes: ['PRACTICE', 'MOCK', 'CHALLENGE'], readiness: 'REDUCED_MOCK_READY', focusObjectiveIds: [], componentsFixed: false,
  components: ['1', '2', '4', '5'].map(comp),
  routes: [{ key: 'AS_ONLY', label: 'AS', componentIds: [C('1'), C('2')], stage: null, stageCount: null }, { key: 'AS_ONLY', label: 'AS', componentIds: [C('1'), C('4')], stage: null, stageCount: null }, { key: 'AS_ONLY', label: 'AS', componentIds: [C('1'), C('5')], stage: null, stageCount: null }],
  description: null, bank: null,
};
const post = (body: unknown) => (POST as any)(new NextRequest('http://localhost/api/exams/instances', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveExamLevel).mockResolvedValue(level9709AS as any);
});

describe('Cambridge 9709 AS routes', () => {
  it('a Mock with P2 + P4 (not an official combination) is rejected', async () => {
    const r = await post({ nodeKey: 'cie.aice.g1.9709.as', componentIds: [C('2'), C('4')], mode: 'MOCK', language: 'en' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('ROUTE_REQUIRED');
    expect(createExamInstance).not.toHaveBeenCalled();
  });
  it('a Mock with only P1 is rejected (a route takes two components)', async () => {
    expect((await post({ nodeKey: 'cie.aice.g1.9709.as', componentIds: [C('1')], mode: 'CHALLENGE', language: 'en' })).status).toBe(400);
  });
  it.each([['1', '2'], ['1', '4'], ['5', '1']])('a Mock with P%s + P%s is accepted', async (a, b) => {
    expect((await post({ nodeKey: 'cie.aice.g1.9709.as', componentIds: [C(a), C(b)], mode: 'MOCK', language: 'en' })).status).toBe(200);
  });
  it('Practice of one component is free ("Preparar un componente")', async () => {
    expect((await post({ nodeKey: 'cie.aice.g1.9709.as', componentIds: [C('4')], mode: 'PRACTICE', language: 'en' })).status).toBe(200);
  });
});
