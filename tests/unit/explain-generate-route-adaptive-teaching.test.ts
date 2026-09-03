/**
 * Phase 5-R: proves /api/cognitive/explain/generate wires
 * getTeachingIntentForConcept's result into generateExplainPrompt,
 * scoped to exactly the concept the request asked about (5F.6 / S7 --
 * never a different, silently-substituted concept).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const generateExplainPromptMock = vi.fn();
vi.mock('@/services/explain-defend.service', () => ({ generateExplainPrompt: (...a: any[]) => generateExplainPromptMock(...a) }));

const getTeachingIntentForConceptMock = vi.fn();
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: (...a: any[]) => getTeachingIntentForConceptMock(...a) }));

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { POST } from '@/app/api/cognitive/explain/generate/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222';
const CONCEPT_ID = '33333333-3333-4333-8333-333333333333';

function makeRequest(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  generateExplainPromptMock.mockReset().mockResolvedValue({ activityType: 'EXPLAIN', prompt: 'q', expectedElements: ['a'] });
  getTeachingIntentForConceptMock.mockReset().mockResolvedValue(null);
});

describe('explain/generate route -- TeachingIntent lookup scoped to the request\'s own concept', () => {
  it('looks up the TeachingIntent for exactly the requested studentId/conceptId', async () => {
    await POST(makeRequest({ studentId: STUDENT_ID, subjectId: SUBJECT_ID, conceptId: CONCEPT_ID, conceptLabel: 'X', activityType: 'EXPLAIN' }));
    expect(getTeachingIntentForConceptMock).toHaveBeenCalledWith(STUDENT_ID, CONCEPT_ID);
  });

  it('passes the resulting generationContext into generateExplainPrompt when available', async () => {
    getTeachingIntentForConceptMock.mockResolvedValue({
      studentId: STUDENT_ID, subjectId: SUBJECT_ID, conceptId: CONCEPT_ID, activityType: 'REMEDIATION', learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION',
      instructionalGoal: 'x', targetKnowledgeDimension: 'MISCONCEPTION', primaryBarrier: 'ACTIVE_MISCONCEPTION', misconceptionCodes: ['CODE'], prerequisiteConceptIds: [],
      supportLevel: 'HIGH_SUPPORT', explanationDepth: 'DEEP', reasoningDemand: null, strategy: 'CONTRAST', avoidStrategies: [], previousStrategies: [], successCriteria: 'y', policyVersion: 1,
    });
    await POST(makeRequest({ studentId: STUDENT_ID, subjectId: SUBJECT_ID, conceptId: CONCEPT_ID, conceptLabel: 'X', activityType: 'EXPLAIN' }));
    const [, , , , , , generationContext] = generateExplainPromptMock.mock.calls[0];
    expect(generationContext).toMatchObject({ primaryBarrier: 'ACTIVE_MISCONCEPTION', strategy: 'CONTRAST' });
  });

  it('falls back to undefined generationContext (v1 behavior) when Phase 4 has no active decision', async () => {
    await POST(makeRequest({ studentId: STUDENT_ID, subjectId: SUBJECT_ID, conceptId: CONCEPT_ID, conceptLabel: 'X', activityType: 'EXPLAIN' }));
    const [, , , , , , generationContext] = generateExplainPromptMock.mock.calls[0];
    expect(generationContext).toBeUndefined();
  });

  it('a failed TeachingIntent lookup degrades gracefully -- the request still succeeds without adaptive context', async () => {
    getTeachingIntentForConceptMock.mockRejectedValue(new Error('db down'));
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, subjectId: SUBJECT_ID, conceptId: CONCEPT_ID, conceptLabel: 'X', activityType: 'EXPLAIN' }));
    expect(res.status ?? 200).not.toBe(500);
    expect(generateExplainPromptMock).toHaveBeenCalled();
  });
});
