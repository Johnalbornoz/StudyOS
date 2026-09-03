import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const getRemediationPathMock = vi.fn();
vi.mock('@/services/remediation.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/remediation.service')>('@/services/remediation.service');
  return {
    ...actual, // remediationStepHref runs for real (pure)
    getRemediationPath: (...a: any[]) => getRemediationPathMock(...a),
  };
});

import { startLearningSession } from '@/services/learning-session-engine.service';
import { evidenceModeForActivity } from '@/lib/activity-taxonomy';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';
import type { RemediationPath, RemediationStep } from '@/services/remediation.service';

const STUDENT = 's1';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides };
}

function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1',
    subjectId: 'subj1',
    targetConceptIds: [],
    signals: [primarySignal],
    primarySignal,
    learningState: 'DEVELOPING',
    targetDimension: 'UNDERSTANDING',
    activityType: 'PRACTICE',
    pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null,
    priorityScore: 1000,
    reasonCode: primarySignal.type,
    facts: [],
    dueAt: null,
    policyVersion: 3,
    ...overrides,
  };
}

function step(overrides: Partial<RemediationStep> = {}): RemediationStep {
  return { id: 'step-1', stepType: 'LEARN', conceptId: 'c1', sequence: 1, status: 'active', result: null, ...overrides };
}

function path(overrides: Partial<RemediationPath> = {}): RemediationPath {
  return {
    id: 'rp-1', studentId: STUDENT, diagnosisId: null, targetConceptId: 'target-A',
    rootCauseConceptId: 'c1', pattern: 'LOW_MASTERY', state: 'REPAIRING', steps: [step()],
    ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ label: 'Momentum' }] });
  getRemediationPathMock.mockReset();
});

describe('20. PRACTICE routes to the existing Practice launch contract', () => {
  it('produces the topic_practice quiz URL for the exact concept', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'PRACTICE', subjectId: 'subj1', actionConceptId: 'c1' }) });
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget).toBe('/dashboard/quiz?subjectId=subj1&conceptId=c1&mode=topic_practice');
  });
});

describe('21. REVIEW routes with Practice evidence semantics', () => {
  it('produces the review quiz URL, evidenceMode PRACTICE', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'REVIEW' }) });
    expect(s.launchTarget).toContain('mode=review');
    expect(s.evidenceMode).toBe('PRACTICE');
  });
});

describe('22. SOLO_CHECK -> INDEPENDENT evidence mode', () => {
  it('produces the quick_check quiz URL, evidenceMode INDEPENDENT', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'SOLO_CHECK' }) });
    expect(s.launchTarget).toContain('mode=quick_check');
    expect(s.evidenceMode).toBe('INDEPENDENT');
  });
});

describe('23. DIAGNOSTIC_CHECK -> ASSESSMENT evidence mode', () => {
  it('requires and carries diagnosisId; evidenceMode ASSESSMENT', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'DIAGNOSTIC_CHECK', diagnosisId: 'diag-1' }) });
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget).toContain('mode=diagnostic_check');
    expect(s.launchTarget).toContain('diagnosisId=diag-1');
    expect(s.evidenceMode).toBe('ASSESSMENT');
  });

  it('fails explicitly (not silently) when diagnosisId is missing', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'DIAGNOSTIC_CHECK', diagnosisId: undefined }) });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.launchTarget).toBeNull();
    expect(s.unavailableReason).toMatch(/diagnosisId/);
  });
});

describe('24 & 25. REMEDIATION continues the existing path and acts on the root cause', () => {
  it('24: continues path X (same remediationPathId), never starting a new one', async () => {
    getRemediationPathMock.mockResolvedValue(path({ id: 'rp-99' }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', remediationPathId: 'rp-99', actionConceptId: 'c1', subjectId: 'subj1' }),
    });
    expect(getRemediationPathMock).toHaveBeenCalledWith('rp-99');
    expect(s.remediationPathId).toBe('rp-99');
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget).toContain('remediationStepId=step-1');
  });

  it('25: acts on actionConceptId/root cause -- the launched step belongs to the SAME path Phase 3C pointed at, never a different concept fabricated by the Session Engine', async () => {
    getRemediationPathMock.mockResolvedValue(path({ id: 'rp-99', rootCauseConceptId: 'root-B', steps: [step({ conceptId: 'root-B' })] }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', remediationPathId: 'rp-99', actionConceptId: 'root-B', subjectId: 'subj1' }),
    });
    expect(s.actionConceptId).toBe('root-B');
    expect(s.launchTarget).toContain('conceptId=root-B');
  });

  it('fails explicitly when the path has no active step, rather than substituting a different activity', async () => {
    getRemediationPathMock.mockResolvedValue(path({ steps: [step({ status: 'completed' })] }));
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'REMEDIATION', remediationPathId: 'rp-1' }) });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.unavailableReason).toMatch(/no active step/);
  });

  it('fails explicitly when remediationPathId is missing', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'REMEDIATION', remediationPathId: undefined }) });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.unavailableReason).toMatch(/remediationPathId/);
  });
});

describe('26. TRANSFER routes to the existing transfer flow', () => {
  it('produces the transfer page URL with subjectId + resolved conceptLabel', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'TRANSFER', subjectId: 'subj1', actionConceptId: 'c1' }) });
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget).toContain('/dashboard/cognitive/transfer?');
    expect(s.launchTarget).toContain('subjectId=subj1');
    expect(s.launchTarget).toContain('conceptId=c1');
    expect(s.launchTarget).toContain('conceptLabel=Momentum');
    expect(s.evidenceMode).toBe('INDEPENDENT');
  });
});

describe('27. RETENTION_CHECK -> INDEPENDENT', () => {
  it('produces the retention_check quiz URL', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'RETENTION_CHECK' }) });
    expect(s.launchTarget).toContain('mode=retention_check');
    expect(s.evidenceMode).toBe('INDEPENDENT');
  });
});

describe('28. SOLO_VERIFY -- Phase 4-R: resumes the EXISTING pending verification attempt, evidenceMode INDEPENDENT per the taxonomy', () => {
  function verifyDecision(overrides: Partial<LearningDecision> = {}): LearningDecision {
    return decision({ activityType: 'SOLO_VERIFY', verificationAttemptId: 'va-1', quizSessionId: 'quiz-1', ...overrides });
  }

  it('a genuinely pending attempt -> READY, launchTarget carries verifyAttemptId + the EXISTING quizId, never a new one', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] }) // ownership check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'va-1', quiz_session_id: 'quiz-1', student_id: STUDENT, concept_id: 'c1',
            verification_question: { id: 'q1' }, original_score_percent: '80', assessment_confidence_before: '60',
            variant_equivalence_confidence: '0.9',
          },
        ],
      }); // getPendingVerificationAttempt: still unresolved, matches
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: verifyDecision() });
    expect(s.launchStatus).toBe('READY');
    expect(s.evidenceMode).toBe('INDEPENDENT');
    expect(s.launchTarget).toContain('quizId=quiz-1');
    expect(s.launchTarget).toContain('verifyAttemptId=va-1');
    expect(s.launchTarget).toContain('conceptId=c1');
    // Exactly the certified read path -- no INSERT/write query issued.
    expect(queryMock.mock.calls.every(([sql]) => !/^\s*INSERT/i.test(String(sql)))).toBe(true);
  });

  it('missing verificationAttemptId/quizSessionId on the decision -> UNAVAILABLE, never a fabricated launch', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'SOLO_VERIFY' }) });
    expect(s.launchStatus).toBe('UNAVAILABLE');
  });

  it('Phase 4-R Finding 9 (stale decision safety): the attempt was resolved elsewhere between decision and launch -> UNAVAILABLE, never a fabricated READY', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] }) // ownership check
      .mockResolvedValueOnce({ rows: [] }); // getPendingVerificationAttempt: outcome is no longer NULL -- correctly returns nothing
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: verifyDecision() });
    expect(s.launchStatus).toBe('UNAVAILABLE');
  });

  it('a different (newer) pending attempt now exists for the same (quizSessionId, conceptId, studentId) -> UNAVAILABLE, refuses to resume the wrong one', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'va-DIFFERENT', quiz_session_id: 'quiz-1', student_id: STUDENT, concept_id: 'c1', verification_question: {}, original_score_percent: '80', assessment_confidence_before: '60', variant_equivalence_confidence: null }],
      });
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: verifyDecision() });
    expect(s.launchStatus).toBe('UNAVAILABLE');
  });

  it('Phase 4-R Finding 10 (foreign attempt access blocked): getPendingVerificationAttempt is called with THIS studentId, never trusting the decision alone -- a foreign learner can never resume another learner\'s attempt', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] }).mockResolvedValueOnce({ rows: [] });
    await startLearningSession({ studentId: 'attacker-student', learningDecision: verifyDecision() });
    // getPendingVerificationAttempt's own query is scoped by student_id = $3 -- confirmed the real studentId param was forwarded, not the decision's own actionConceptId/subjectId alone.
    const pendingCall = queryMock.mock.calls[1];
    expect(pendingCall?.[1]).toContain('attacker-student');
  });

  it('never issues a second call to createPendingVerificationAttempt or any INSERT -- SOLO_VERIFY launch resolution is read-only', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'va-1', quiz_session_id: 'quiz-1', student_id: STUDENT, concept_id: 'c1', verification_question: {}, original_score_percent: '80', assessment_confidence_before: '60', variant_equivalence_confidence: '0.9' }] });
    await startLearningSession({ studentId: STUDENT, learningDecision: verifyDecision() });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('Phase 4-R Finding: double-launching the SAME decision (e.g. a double-click) resolves READY both times with zero duplicate/new verification_attempts -- launch resolution is idempotent by construction (pure read, no write)', async () => {
    const pendingRow = { id: 'va-1', quiz_session_id: 'quiz-1', student_id: STUDENT, concept_id: 'c1', verification_question: { id: 'q1' }, original_score_percent: '80', assessment_confidence_before: '60', variant_equivalence_confidence: '0.9' };
    queryMock
      .mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] })
      .mockResolvedValueOnce({ rows: [pendingRow] })
      .mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] })
      .mockResolvedValueOnce({ rows: [pendingRow] });
    const first = await startLearningSession({ studentId: STUDENT, learningDecision: verifyDecision() });
    const second = await startLearningSession({ studentId: STUDENT, learningDecision: verifyDecision() });
    expect(first.launchStatus).toBe('READY');
    expect(second.launchStatus).toBe('READY');
    expect(first.launchTarget).toBe(second.launchTarget);
    // 2 queries per launch (ownership + pending lookup), 4 total across both -- no extra write query snuck in on the second call.
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(queryMock.mock.calls.every(([sql]) => !/^\s*INSERT/i.test(String(sql)))).toBe(true);
  });
});

describe('29. CUMULATIVE_ASSESSMENT -> ASSESSMENT', () => {
  it('produces a subject-scoped cumulative_assessment URL (no conceptId)', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'CUMULATIVE_ASSESSMENT', subjectId: 'subj1' }) });
    expect(s.launchTarget).toBe('/dashboard/quiz?subjectId=subj1&mode=cumulative_assessment');
    expect(s.evidenceMode).toBe('ASSESSMENT');
  });
});

describe('30. MOCK_EXAM -> ASSESSMENT', () => {
  it('produces a subject-scoped exam_simulation URL', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'MOCK_EXAM', subjectId: 'subj1' }) });
    expect(s.launchTarget).toBe('/dashboard/quiz?subjectId=subj1&mode=exam_simulation');
    expect(s.evidenceMode).toBe('ASSESSMENT');
  });
});

describe('31. Session Engine never changes ActivityType', () => {
  it('the returned session.activityType always equals the input decision.activityType, for every type', async () => {
    const types: LearningDecision['activityType'][] = [
      'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION',
      'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
    ];
    getRemediationPathMock.mockResolvedValue(path());
    for (const activityType of types) {
      const d = decision({ activityType, diagnosisId: 'diag-1', remediationPathId: 'rp-1' });
      const s = await startLearningSession({ studentId: STUDENT, learningDecision: d });
      expect(s.activityType).toBe(activityType);
    }
  });
});

describe('32. Session Engine never changes Phase 3C priority', () => {
  it('the LearningSession contract carries no priority field at all -- priority stays exclusively on the LearningDecision', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ priorityScore: 9999, pedagogicalPriority: 'CRITICAL' }) });
    expect(s).not.toHaveProperty('priorityScore');
    expect(s).not.toHaveProperty('pedagogicalPriority');
    expect(s).not.toHaveProperty('priority');
  });
});

describe('33. Session Engine has no ranking policy', () => {
  it('the Session Engine source has no priority-band/ranking vocabulary', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const source = readFileSync(join(process.cwd(), 'src/services/learning-session-engine.service.ts'), 'utf-8');
    expect(source).not.toMatch(/priorityScore|pedagogicalPriority|rankLearningDecisions|dominantSignal|BAND/);
  });
});

describe('34. Unknown/unimplemented launch capability fails explicitly rather than substituting another activity', () => {
  it('an activity type with no launch path returns UNAVAILABLE, never a fallback to a different ActivityType', async () => {
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'NOT_A_REAL_TYPE' as any }) });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.launchTarget).toBeNull();
    expect(s.activityType).toBe('NOT_A_REAL_TYPE');
  });
});

describe('EvidenceMode is always derived, never hand-mapped', () => {
  it('every session.evidenceMode matches evidenceModeForActivity(activityType) exactly, called on the real taxonomy function', async () => {
    const types: LearningDecision['activityType'][] = [
      'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION',
      'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
    ];
    getRemediationPathMock.mockResolvedValue(path());
    for (const activityType of types) {
      const d = decision({ activityType, diagnosisId: 'diag-1', remediationPathId: 'rp-1' });
      const s = await startLearningSession({ studentId: STUDENT, learningDecision: d });
      expect(s.evidenceMode).toBe(evidenceModeForActivity(activityType));
    }
  });
});

// --- P0-3D.1 & P0-3D.2: Session Engine ownership invariants ---------
// The Session Engine is a reusable execution boundary and must defend
// its own student/concept invariants -- it can never trust that a
// LearningDecision's actionConceptId/subjectId/remediationPathId
// genuinely belong to the supplied studentId, even though the one
// existing API route already re-derives decisions server-side. All
// checks below are read-only.

describe('P0-3D.1. Concept ownership is verified before any READY launch, for every ActivityType', () => {
  it('1. a concept that does not belong to this student/subject -> UNAVAILABLE, regardless of ActivityType', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // ownership query: no matching row
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'PRACTICE' }) });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.launchTarget).toBeNull();
    expect(s.unavailableReason).toMatch(/does not belong/);
  });

  it('never launches a concept belonging to a different student, even for a simple PRACTICE decision', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const s = await startLearningSession({
      studentId: 'student-A',
      learningDecision: decision({ activityType: 'PRACTICE', actionConceptId: 'c-owned-by-student-B' }),
    });
    expect(s.launchStatus).toBe('UNAVAILABLE');
  });

  it('the ownership query is scoped by conceptId, subjectId, AND studentId together', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    await startLearningSession({ studentId: 'student-X', learningDecision: decision({ actionConceptId: 'concept-Y', subjectId: 'subject-Z' }) });
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(['concept-Y', 'subject-Z', 'student-X']);
  });
});

describe('P0-3D.2. Remediation path/root-cause consistency', () => {
  it('2. a remediationPathId belonging to a different student -> UNAVAILABLE, never launched', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] }); // ownership passes
    getRemediationPathMock.mockResolvedValue(path({ studentId: 'a-different-student' }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', remediationPathId: 'rp-owned-by-someone-else' }),
    });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.unavailableReason).toMatch(/does not belong to this student/);
  });

  it('3. path.rootCauseConceptId does not match decision.actionConceptId -> UNAVAILABLE', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    getRemediationPathMock.mockResolvedValue(path({ rootCauseConceptId: 'root-C', steps: [step({ conceptId: 'root-C' })] }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', actionConceptId: 'root-B', remediationPathId: 'rp-1' }),
    });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.unavailableReason).toMatch(/root cause/);
  });

  it('4. activeStep.conceptId does not match path.rootCauseConceptId -> UNAVAILABLE', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    getRemediationPathMock.mockResolvedValue(path({ rootCauseConceptId: 'root-B', steps: [step({ conceptId: 'root-C' })] }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', actionConceptId: 'root-B', remediationPathId: 'rp-1' }),
    });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.unavailableReason).toMatch(/not its own root cause|refusing to launch a mismatched concept/);
  });

  it('5. correct student + correct root cause + correct active step -> existing READY behavior is unchanged', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    getRemediationPathMock.mockResolvedValue(path({ studentId: STUDENT, rootCauseConceptId: 'root-B', steps: [step({ conceptId: 'root-B' })] }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', actionConceptId: 'root-B', subjectId: 'subj1', remediationPathId: 'rp-1' }),
    });
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget).toContain('remediationStepId=step-1');
  });

  it('6. LearningSession.actionConceptId always matches the concept encoded in a REMEDIATION launchTarget', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    getRemediationPathMock.mockResolvedValue(path({ studentId: STUDENT, rootCauseConceptId: 'root-B', steps: [step({ conceptId: 'root-B', stepType: 'RETRIEVAL' })] }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', actionConceptId: 'root-B', subjectId: 'subj1', remediationPathId: 'rp-1' }),
    });
    expect(s.launchStatus).toBe('READY');
    expect(s.actionConceptId).toBe('root-B');
    expect(s.launchTarget).toContain('conceptId=root-B');
    expect(s.launchParams.conceptId ?? new URL(`http://x${s.launchTarget}`).searchParams.get('conceptId')).toBe('root-B');
  });

  it('a TRANSFER remediation step also enforces the same root-cause consistency before launching', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    getRemediationPathMock.mockResolvedValue(path({ studentId: STUDENT, rootCauseConceptId: 'root-B', steps: [step({ conceptId: 'root-C', stepType: 'TRANSFER' })] }));
    const s = await startLearningSession({
      studentId: STUDENT,
      learningDecision: decision({ activityType: 'REMEDIATION', actionConceptId: 'root-B', subjectId: 'subj1', remediationPathId: 'rp-1' }),
    });
    expect(s.launchStatus).toBe('UNAVAILABLE');
  });
});

describe('7. TRANSFER cannot return READY if its required concept context (label) cannot be resolved', () => {
  it('a freestanding TRANSFER decision with no resolvable label -> UNAVAILABLE, never a launch missing conceptLabel', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: null }] }); // ownership passes, but no label available
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'TRANSFER' }) });
    expect(s.launchStatus).toBe('UNAVAILABLE');
    expect(s.launchTarget).toBeNull();
    expect(s.unavailableReason).toMatch(/label/);
  });

  it('reuses the ownership query\'s label -- issues exactly one query for a successful TRANSFER launch', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ label: 'Momentum' }] });
    const s = await startLearningSession({ studentId: STUDENT, learningDecision: decision({ activityType: 'TRANSFER' }) });
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget).toContain('conceptLabel=Momentum');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
