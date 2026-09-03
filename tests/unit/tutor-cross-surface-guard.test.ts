/**
 * Phase 5-R2/5-R3/5-R4: proves the cross-surface guard is wired into
 * tutor.service.ts::sendMessage UNCONDITIONALLY and, as of Phase 5-R4,
 * is entirely subject/concept-INDEPENDENT -- the call site passes only
 * `studentId`, structurally proving neither the conversation's own
 * `subject_id` nor any client-supplied `conceptId` can influence
 * whether the integrity gate runs or what it checks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

const retrieveContextMock = vi.fn().mockResolvedValue({ chunks: [] });
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));

const buildCompactTutorContextMock = vi.fn().mockResolvedValue(null);
vi.mock('@/services/tutor-strategy.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/tutor-strategy.service')>();
  return { ...actual, buildCompactTutorContext: (...a: any[]) => buildCompactTutorContextMock(...a) };
});

const getTeachingIntentForConceptMock = vi.fn();
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: (...a: any[]) => getTeachingIntentForConceptMock(...a) }));

const getActiveRestrictedEvidenceForStudentMock = vi.fn();
vi.mock('@/services/active-evidence-guard.service', () => ({
  getActiveRestrictedEvidenceForStudent: (...a: any[]) => getActiveRestrictedEvidenceForStudentMock(...a),
}));

const callAnthropicMessagesMock = vi.fn().mockResolvedValue({ text: 'AI reply text' });
vi.mock('@/lib/ai/adapters/anthropic', () => ({ callAnthropicMessages: (...a: any[]) => callAnthropicMessagesMock(...a) }));

import { sendMessage } from '@/services/tutor.service';

const STUDENT = 's1';
const CONCEPT = 'c1';
const SUBJECT = 'subj1';
const BLOCKED_STATE = { allowed: false as const, reason: 'ACTIVE_QUIZ_SESSION' as const, activityType: 'SOLO_CHECK' as const, evidenceMode: 'INDEPENDENT' as const, sessionId: 'quiz-1' };
const ALLOWED_STATE = { allowed: true as const, reason: 'NO_ACTIVE_RESTRICTED_EVIDENCE' as const, activityType: null, evidenceMode: null, sessionId: null };

const INTENT = {
  studentId: STUDENT, subjectId: SUBJECT, conceptId: CONCEPT, activityType: 'REMEDIATION', learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION',
  instructionalGoal: 'Correct the misconception.', targetKnowledgeDimension: 'MISCONCEPTION', primaryBarrier: 'ACTIVE_MISCONCEPTION',
  misconceptionCodes: ['FORCE_ALONG_VELOCITY'], prerequisiteConceptIds: [], supportLevel: 'HIGH_SUPPORT', explanationDepth: 'DEEP', reasoningDemand: null,
  strategy: 'CONTRAST', avoidStrategies: [], previousStrategies: [], successCriteria: 'x', policyVersion: 1,
};

function mockDbSequence(subjectId: string | null = SUBJECT) {
  queryMock.mockReset();
  queryMock.mockResolvedValueOnce({ rows: [{ subject_id: subjectId, title: null }] }); // conversation lookup
  queryMock.mockResolvedValueOnce({ rows: [] }); // history
  queryMock.mockResolvedValueOnce({ rows: [] }); // insert user message
  queryMock.mockResolvedValueOnce({ rows: [{ id: 'msg-1', role: 'assistant', content: 'reply', created_at: '2026-01-01T00:00:00Z' }] }); // insert assistant message
  queryMock.mockResolvedValueOnce({ rows: [] }); // update conversation
}

beforeEach(() => {
  mockDbSequence();
  retrieveContextMock.mockClear();
  buildCompactTutorContextMock.mockReset().mockResolvedValue(null);
  getTeachingIntentForConceptMock.mockReset().mockResolvedValue(INTENT);
  getActiveRestrictedEvidenceForStudentMock.mockReset().mockResolvedValue(ALLOWED_STATE);
  callAnthropicMessagesMock.mockClear();
});

describe('Phase 5-R4 S5: the gate call site takes ONLY studentId -- structurally cannot be scoped by subject or concept', () => {
  it('the guard is always called with exactly one argument: studentId', async () => {
    await sendMessage('conv-1', STUDENT, 'hi', 'en', CONCEPT);
    expect(getActiveRestrictedEvidenceForStudentMock).toHaveBeenCalledWith(STUDENT);
    expect(getActiveRestrictedEvidenceForStudentMock.mock.calls[0]).toHaveLength(1);
  });

  it('release test 2/4-9: the conversation being labelled a DIFFERENT subject than an active restriction does not matter -- the call is identical either way', async () => {
    mockDbSequence('a-completely-different-subject');
    await sendMessage('conv-1', STUDENT, 'hi', 'en', CONCEPT);
    expect(getActiveRestrictedEvidenceForStudentMock).toHaveBeenCalledWith(STUDENT);
  });

  it('release test 3: a conversation with NO subject binding is called identically too', async () => {
    mockDbSequence(null);
    await sendMessage('conv-1', STUDENT, 'hi', 'en');
    expect(getActiveRestrictedEvidenceForStudentMock).toHaveBeenCalledWith(STUDENT);
  });

  it('release test 10: a wrong client-supplied conceptId has zero effect on the gate call', async () => {
    await sendMessage('conv-1', STUDENT, 'ask about something else', 'en', 'totally-wrong-concept-id');
    expect(getActiveRestrictedEvidenceForStudentMock).toHaveBeenCalledWith(STUDENT);
  });

  it('release test 11: an omitted conceptId has zero effect on the gate call', async () => {
    await sendMessage('conv-1', STUDENT, 'general question', 'en');
    expect(getActiveRestrictedEvidenceForStudentMock).toHaveBeenCalledWith(STUDENT);
  });
});

describe('release tests 12-13: server authority -- direct service/API call cannot bypass', () => {
  it('a direct sendMessage call (equivalent to a direct service/API call) is blocked identically -- there is no separate route-level enforcement to skip', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(BLOCKED_STATE);
    await sendMessage('conv-1', STUDENT, 'help me', 'en'); // no conceptId, simulating a bare/direct call
    expect(callAnthropicMessagesMock).not.toHaveBeenCalled();
  });

  it('a guard lookup failure fails CLOSED (blocks), never reopening the bypass on a transient error', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockRejectedValue(new Error('db down'));
    await sendMessage('conv-1', STUDENT, 'help me', 'en', CONCEPT);
    expect(getTeachingIntentForConceptMock).not.toHaveBeenCalled();
    expect(callAnthropicMessagesMock).not.toHaveBeenCalled();
  });
});

describe('release tests 19-21: a blocked request produces no adaptive teaching, no grounding, no AI call', () => {
  it('never calls getTeachingIntentForConcept when blocked (release test 19)', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(BLOCKED_STATE);
    await sendMessage('conv-1', STUDENT, 'help me', 'en', CONCEPT);
    expect(getTeachingIntentForConceptMock).not.toHaveBeenCalled();
  });

  it('never calls retrieveContext (grounding) when blocked (release test 20)', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(BLOCKED_STATE);
    await sendMessage('conv-1', STUDENT, 'help me', 'en', CONCEPT);
    expect(retrieveContextMock).not.toHaveBeenCalled();
  });

  it('never calls the AI provider when blocked (release test 21)', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(BLOCKED_STATE);
    await sendMessage('conv-1', STUDENT, 'help me', 'en', CONCEPT);
    expect(callAnthropicMessagesMock).not.toHaveBeenCalled();
  });

  it('returns a safe, non-empty reply with no misconception-specific content leaking through (S7)', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(BLOCKED_STATE);
    const reply = await sendMessage('conv-1', STUDENT, 'help me', 'en', CONCEPT);
    expect(reply.content.length).toBeGreaterThan(0);
    expect(reply.content).not.toContain('FORCE_ALONG_VELOCITY');
    expect(reply.content).not.toMatch(/contrast/i);
  });

  it('the blocked reply is localized (Spanish request gets a Spanish reply)', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(BLOCKED_STATE);
    await sendMessage('conv-1', STUDENT, 'ayúdame', 'es', CONCEPT);
    const insertCall = queryMock.mock.calls.find((c) => String(c[0]).includes("role, content) VALUES ($1, 'assistant'"));
    expect(insertCall?.[1]?.[1]).toMatch(/evaluación/i);
  });
});

describe('release test 23: allowed adaptive Tutor behavior (Phase 5-R) remains intact when no restriction is active', () => {
  it('calls getTeachingIntentForConcept and the AI provider when allowed', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(ALLOWED_STATE);
    await sendMessage('conv-1', STUDENT, 'help me', 'en', CONCEPT);
    expect(getTeachingIntentForConceptMock).toHaveBeenCalledWith(STUDENT, CONCEPT);
    expect(callAnthropicMessagesMock).toHaveBeenCalled();
  });

  it('the misconception-specific adaptive block still reaches the actual system prompt when allowed', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(ALLOWED_STATE);
    await sendMessage('conv-1', STUDENT, 'why is this wrong?', 'en', CONCEPT);
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain('FORCE_ALONG_VELOCITY');
  });
});

describe('release test 22: zero cognitive mutation from the guard either way', () => {
  it('a blocked request writes only tutor_messages/tutor_conversations rows -- no mastery/knowledge-state/evidence table', async () => {
    getActiveRestrictedEvidenceForStudentMock.mockResolvedValue(BLOCKED_STATE);
    await sendMessage('conv-1', STUDENT, 'help me', 'en', CONCEPT);
    const forbidden = /mastery_records|concept_knowledge_state|learning_evidence|verification_attempts|student_misconceptions/i;
    for (const call of queryMock.mock.calls) {
      expect(String(call[0])).not.toMatch(forbidden);
    }
  });
});
