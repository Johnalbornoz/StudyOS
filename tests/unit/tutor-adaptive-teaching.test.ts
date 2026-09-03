/**
 * Phase 5-R: live-surface A (concept teaching/tutor generator).
 * Proves the actual system prompt tutor.service.ts::sendMessage sends
 * carries the canonical TeachingIntent's adaptive constraints when
 * Phase 4 has an active decision for the message's concept, and falls
 * back to the pre-existing (unmodified) buildCompactTutorContext
 * behavior when it doesn't -- never fabricating a decision.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

const retrieveContextMock = vi.fn().mockResolvedValue({ chunks: [{ text: 'Source material chunk.' }] });
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));

const buildCompactTutorContextMock = vi.fn();
vi.mock('@/services/tutor-strategy.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/tutor-strategy.service')>();
  return { ...actual, buildCompactTutorContext: (...a: any[]) => buildCompactTutorContextMock(...a) };
});

const getTeachingIntentForConceptMock = vi.fn();
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: (...a: any[]) => getTeachingIntentForConceptMock(...a) }));

const getActiveRestrictedEvidenceForStudentMock = vi.fn();
vi.mock('@/services/active-evidence-guard.service', () => ({ getActiveRestrictedEvidenceForStudent: (...a: any[]) => getActiveRestrictedEvidenceForStudentMock(...a) }));

const callAnthropicMessagesMock = vi.fn().mockResolvedValue({ text: 'AI reply text' });
vi.mock('@/lib/ai/adapters/anthropic', () => ({ callAnthropicMessages: (...a: any[]) => callAnthropicMessagesMock(...a) }));

import { sendMessage } from '@/services/tutor.service';

const INTENT = {
  studentId: 's1', subjectId: 'subj1', conceptId: 'c1', activityType: 'REMEDIATION', learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION',
  instructionalGoal: 'Correct the misconception.', targetKnowledgeDimension: 'MISCONCEPTION', primaryBarrier: 'ACTIVE_MISCONCEPTION',
  misconceptionCodes: ['FORCE_ALONG_VELOCITY'], prerequisiteConceptIds: [], supportLevel: 'HIGH_SUPPORT', explanationDepth: 'DEEP', reasoningDemand: null,
  strategy: 'CONTRAST', avoidStrategies: [], previousStrategies: [], successCriteria: 'x', policyVersion: 1,
};

function mockDbSequence() {
  queryMock.mockReset();
  queryMock.mockResolvedValueOnce({ rows: [{ subject_id: 'subj1', title: null }] }); // conversation lookup
  queryMock.mockResolvedValueOnce({ rows: [] }); // history
  queryMock.mockResolvedValueOnce({ rows: [] }); // insert user message
  queryMock.mockResolvedValueOnce({ rows: [{ id: 'msg-1', role: 'assistant', content: 'AI reply text', created_at: '2026-01-01T00:00:00Z' }] }); // insert assistant message
  queryMock.mockResolvedValueOnce({ rows: [] }); // update conversation
}

beforeEach(() => {
  mockDbSequence();
  retrieveContextMock.mockClear();
  buildCompactTutorContextMock.mockReset().mockResolvedValue(null);
  getTeachingIntentForConceptMock.mockReset().mockResolvedValue(null);
  getActiveRestrictedEvidenceForStudentMock.mockReset().mockResolvedValue({ allowed: true, reason: 'NO_ACTIVE_RESTRICTED_EVIDENCE', activityType: null, evidenceMode: null, sessionId: null });
  callAnthropicMessagesMock.mockClear();
});

describe('sendMessage -- prefers the canonical TeachingIntent over the legacy strategy pick', () => {
  it('when Phase 4 has an active decision, buildCompactTutorContext is never called (TeachingIntent takes priority)', async () => {
    getTeachingIntentForConceptMock.mockResolvedValue(INTENT);
    await sendMessage('conv-1', 's1', 'why is this wrong?', 'en', 'c1');
    expect(getTeachingIntentForConceptMock).toHaveBeenCalledWith('s1', 'c1');
    expect(buildCompactTutorContextMock).not.toHaveBeenCalled();
  });

  it('the actual system prompt sent to the provider carries the misconception-specific adaptive block', async () => {
    getTeachingIntentForConceptMock.mockResolvedValue(INTENT);
    await sendMessage('conv-1', 's1', 'why is this wrong?', 'en', 'c1');
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain('FORCE_ALONG_VELOCITY');
    expect(params.system).toMatch(/contrast/i);
  });

  it('falls back to buildCompactTutorContext, UNCHANGED, when Phase 4 has no active decision for this concept', async () => {
    getTeachingIntentForConceptMock.mockResolvedValue(null);
    buildCompactTutorContextMock.mockResolvedValue({ strategy: 'EXPLAIN', instruction: 'Give a clear explanation.', summary: 'Mastery 40%' });
    await sendMessage('conv-1', 's1', 'help me understand', 'en', 'c1');
    expect(buildCompactTutorContextMock).toHaveBeenCalledWith('s1', 'c1');
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain('Mastery 40%');
  });

  it('neither path runs when no conceptId is given -- a general conversation is unaffected (pre-Phase-2 behavior)', async () => {
    await sendMessage('conv-1', 's1', 'general question');
    expect(getTeachingIntentForConceptMock).not.toHaveBeenCalled();
    expect(buildCompactTutorContextMock).not.toHaveBeenCalled();
  });

  it('grounding (retrieved source material) is preserved alongside the adaptive block (release test 15)', async () => {
    getTeachingIntentForConceptMock.mockResolvedValue(INTENT);
    await sendMessage('conv-1', 's1', 'why is this wrong?', 'en', 'c1');
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain('Source material chunk.');
  });

  it('a failed TeachingIntent lookup degrades to the legacy fallback rather than failing the message', async () => {
    getTeachingIntentForConceptMock.mockRejectedValue(new Error('db down'));
    buildCompactTutorContextMock.mockResolvedValue(null);
    await expect(sendMessage('conv-1', 's1', 'hi', 'en', 'c1')).resolves.toBeDefined();
  });
});
