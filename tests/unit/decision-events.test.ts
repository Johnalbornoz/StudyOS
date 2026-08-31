/**
 * Phase 0E2 Step 20/24/26: decision_events' canonical write path
 * (recordDecisionEvent), its failure policy, and the queryability
 * demonstration (Step 24's five questions) against test fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

describe('recordDecisionEvent', () => {
  it('is a no-op by default in a test environment (VITEST=true) -- never touches @/lib/db unless explicitly enabled', async () => {
    const query = vi.fn();
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { recordDecisionEvent } = await import('@/lib/audit/decision-events');

    await recordDecisionEvent({ decisionType: 'MASTERY_UPDATED', engine: 'mastery-engine', engineVersion: 'v1' });
    expect(query).not.toHaveBeenCalled();
  });

  it('when explicitly enabled for tests, inserts exactly the given fields into decision_events', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { recordDecisionEvent, setDecisionEventPersistenceForTests } = await import('@/lib/audit/decision-events');
    setDecisionEventPersistenceForTests(true);

    await recordDecisionEvent({
      decisionType: 'MASTERY_UPDATED',
      engine: 'mastery-engine',
      engineVersion: 'v1',
      studentId: 'student-1',
      subjectId: 'subject-1',
      conceptId: 'concept-1',
      sourceEventType: 'learning_evidence',
      sourceEventId: 'evidence-1',
      previousState: { masteryScore: 40 },
      newState: { masteryScore: 55 },
      reasonCode: 'PRACTICE_QUIZ:correct',
      reasonDetails: { delta: 15 },
      aiExecutionId: 'exec-1',
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO decision_events');
    expect(params[0]).toBe('MASTERY_UPDATED');
    expect(params[1]).toBe('mastery-engine');
    expect(params[2]).toBe('v1');
    expect(params[3]).toBe('student-1');
    expect(JSON.parse(params[8])).toEqual({ masteryScore: 40 });
    expect(JSON.parse(params[9])).toEqual({ masteryScore: 55 });
    expect(params[12]).toBe('exec-1');

    setDecisionEventPersistenceForTests(false);
  });

  it('failure policy (Step 10/26): a persistence failure is caught and logged, never thrown -- the calling engine is never broken', async () => {
    const query = vi.fn().mockRejectedValue(new Error('decision audit db unreachable'));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { recordDecisionEvent, setDecisionEventPersistenceForTests } = await import('@/lib/audit/decision-events');
    setDecisionEventPersistenceForTests(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(recordDecisionEvent({ decisionType: 'MASTERY_UPDATED', engine: 'mastery-engine', engineVersion: 'v1' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    setDecisionEventPersistenceForTests(false);
  });
});

describe('audit query service -- Step 24 queryability demonstration (test fixtures only)', () => {
  function mockDb(rows: Record<string, any[]>) {
    const query = vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM ai_execution_events')) {
        return { rows: (rows.ai_execution_events ?? []).filter((r) => r.execution_id === params[0]) };
      }
      if (sql.includes('FROM decision_events') && sql.includes('decision_id = $1')) {
        return { rows: (rows.decision_events ?? []).filter((r) => r.decision_id === params[0]) };
      }
      if (sql.includes('FROM decision_events') && sql.includes('student_id = $1 AND concept_id = $2')) {
        return {
          rows: (rows.decision_events ?? [])
            .filter((r) => r.student_id === params[0] && r.concept_id === params[1])
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
        };
      }
      throw new Error(`Unexpected query in test fixture: ${sql}`);
    });
    vi.doMock('@/lib/db', () => ({ db: { query } }));
  }

  const aiExecutionFixture = {
    id: 'row-ai-1',
    execution_id: 'exec-fixture-1',
    capability: 'GRADING',
    risk: 'HIGH_RISK',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    prompt_id: 'quiz.free_text_grading',
    prompt_version: 'v1',
    status: 'SUCCESS',
    validation_status: 'PASSED',
    fallback_used: false,
    error_code: null,
    duration_ms: 842,
    student_id: 'student-fixture-1',
    subject_id: 'subject-fixture-1',
    concept_id: 'concept-fixture-1',
    source_component: 'quiz-generation.service.ts:gradeAnswer',
    source_id: null,
    created_at: '2026-08-31T10:00:00.000Z',
  };

  const masteryDecisionFixture = {
    id: 'row-decision-1',
    decision_id: 'decision-fixture-1',
    decision_type: 'MASTERY_UPDATED',
    engine: 'mastery-engine',
    engine_version: 'v1',
    student_id: 'student-fixture-1',
    subject_id: 'subject-fixture-1',
    concept_id: 'concept-fixture-1',
    source_event_type: 'learning_evidence',
    source_event_id: 'evidence-fixture-1',
    previous_state: { masteryScore: 40 },
    new_state: { masteryScore: 62 },
    reason_code: 'PRACTICE_QUIZ:correct',
    reason_details: { delta: 22 },
    ai_execution_id: 'exec-fixture-1',
    metadata: null,
    created_at: '2026-08-31T10:00:01.000Z',
  };

  const verificationDecisionFixture = {
    id: 'row-decision-2',
    decision_id: 'decision-fixture-2',
    decision_type: 'VERIFICATION_REQUIRED',
    engine: 'verification-engine',
    engine_version: 'v1',
    student_id: 'student-fixture-1',
    subject_id: 'subject-fixture-1',
    concept_id: 'concept-fixture-1',
    source_event_type: 'verification_attempts',
    source_event_id: 'verification-fixture-1',
    previous_state: null,
    new_state: { assessmentConfidenceBeforeVerification: 52, severity: 'HIGH' },
    reason_code: 'LOW_GRADING_CONFIDENCE,LARGE_CONFIDENCE_DISAGREEMENT',
    reason_details: { triggers: [{ triggerId: 'LOW_GRADING_CONFIDENCE' }, { triggerId: 'LARGE_CONFIDENCE_DISAGREEMENT' }] },
    ai_execution_id: null,
    metadata: null,
    created_at: '2026-08-31T09:59:00.000Z',
  };

  it('Question A: given an AI execution id, which provider/model/prompt/version ran?', async () => {
    mockDb({ ai_execution_events: [aiExecutionFixture] });
    const { getAIExecution } = await import('@/lib/audit/query');

    const result = await getAIExecution('exec-fixture-1');
    expect(result).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      promptId: 'quiz.free_text_grading',
      promptVersion: 'v1',
      capability: 'GRADING',
    });
  });

  it('Questions B & C: given a mastery decision, which evidence caused it, and which AI execution (if any) produced that evidence?', async () => {
    mockDb({ decision_events: [masteryDecisionFixture], ai_execution_events: [aiExecutionFixture] });
    const { getDecisionTrace } = await import('@/lib/audit/query');

    const trace = await getDecisionTrace('decision-fixture-1');
    expect(trace).not.toBeNull();
    // B: which learning evidence caused it
    expect(trace!.decision.sourceEventType).toBe('learning_evidence');
    expect(trace!.decision.sourceEventId).toBe('evidence-fixture-1');
    // C: which AI execution produced that evidence
    expect(trace!.aiExecution).not.toBeNull();
    expect(trace!.aiExecution!.executionId).toBe('exec-fixture-1');
    expect(trace!.aiExecution!.promptId).toBe('quiz.free_text_grading');
  });

  it('Question D: given a verification decision, what existing trigger ids caused it?', async () => {
    mockDb({ decision_events: [verificationDecisionFixture] });
    const { getDecisionEvent } = await import('@/lib/audit/query');

    const decision = await getDecisionEvent('decision-fixture-2');
    expect(decision!.reasonCode).toBe('LOW_GRADING_CONFIDENCE,LARGE_CONFIDENCE_DISAGREEMENT');
    expect(decision!.reasonDetails).toMatchObject({
      triggers: [{ triggerId: 'LOW_GRADING_CONFIDENCE' }, { triggerId: 'LARGE_CONFIDENCE_DISAGREEMENT' }],
    });
  });

  it('Question E: given a student+concept, the full sequence of auditable state decisions, oldest first', async () => {
    mockDb({ decision_events: [masteryDecisionFixture, verificationDecisionFixture] });
    const { getDecisionsForStudentConcept } = await import('@/lib/audit/query');

    const sequence = await getDecisionsForStudentConcept('student-fixture-1', 'concept-fixture-1');
    expect(sequence.map((d) => d.decisionType)).toEqual(['VERIFICATION_REQUIRED', 'MASTERY_UPDATED']); // verification fixture is timestamped earlier
  });

  it('a decision with no AI link (deterministic evidence) correctly resolves aiExecution to null, never fabricated', async () => {
    mockDb({ decision_events: [verificationDecisionFixture] });
    const { getDecisionTrace } = await import('@/lib/audit/query');

    const trace = await getDecisionTrace('decision-fixture-2');
    expect(trace!.decision.aiExecutionId).toBeNull();
    expect(trace!.aiExecution).toBeNull();
  });
});
