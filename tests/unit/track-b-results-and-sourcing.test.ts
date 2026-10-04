/**
 * Track B -- result construction (the committed responses are the authority,
 * never client data), the canonical attempt lifecycle, and item sourcing
 * (approved bank first, deterministic variants, stimulus grouping; validated
 * AI fallback that never delivers an invalid generation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));
const resolveActivityMetadataForObjectiveMock = vi.fn();
vi.mock('@/lib/curriculum/activity-metadata-bridge.service', () => ({ resolveActivityMetadataForObjective: (...a: any[]) => resolveActivityMetadataForObjectiveMock(...a) }));
const resolveStudentConceptMock = vi.fn();
vi.mock('@/lib/readiness/student-concept-resolution.service', () => ({ resolveStudentConceptForCanonicalConcept: (...a: any[]) => resolveStudentConceptMock(...a) }));
const generatePracticeQuestionsMock = vi.fn();
vi.mock('@/services/quiz-generation.service', () => ({ generatePracticeQuestions: (...a: any[]) => generatePracticeQuestionsMock(...a) }));

import { buildScoringItems, deriveExamLifecycle } from '@/lib/exam-core/results.service';
import { selectApprovedBankItem, generateValidatedItem, validateGeneratedItemForTarget, sourceExamItem } from '@/lib/exam-core/item-sourcing.service';
import { examItemFromGenerated } from '@/lib/exam-core/items';
import { choice } from '@/lib/exam-core/verticals/fixture-builders';

const PLAN = {
  selectedTargets: [
    { blueprintObjectiveTargetId: 't0', assessmentComponentId: 'c1', questionType: 'multiple_choice', difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
    { blueprintObjectiveTargetId: 't1', assessmentComponentId: 'c1', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
    { blueprintObjectiveTargetId: 't2', assessmentComponentId: 'c2', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
    { blueprintObjectiveTargetId: 't3', assessmentComponentId: 'c2', questionType: null, difficultyRange: null, reasoningRequirement: null, commandTermId: null, allocatedSeconds: null },
  ],
};

describe('buildScoringItems', () => {
  it('committed responses win; delivered-unanswered is MISSING with its own marks; skipped is EXCLUDED; never-delivered is MISSING', () => {
    const nav = {
      items: {
        '0': { status: 'ANSWERED' },
        '1': { status: 'DELIVERED', item: { type: 'step_by_step', exam: { marks: 1, parts: [{ id: 'a', marks: 2, criterion: 'k' }, { id: 'b', marks: 1, criterion: 'm' }] } } },
        '2': { status: 'EXCLUDED' },
      },
    } as any;
    const responses = [{ target_index: 0, score: '2', max_score: '2', assessment_component_id: 'c1', learning_objective_id: 'lo-0', item_snapshot: { type: 'multiple_choice' }, criteria_breakdown: null }];
    const items = buildScoringItems(PLAN as any, nav, responses, new Map([[3, 'lo-3']]));
    expect(items.map((i) => i.status)).toEqual(['ANSWERED', 'MISSING', 'EXCLUDED', 'MISSING']);
    expect(items[0]).toMatchObject({ fraction: 1, maxMarks: 2, learningObjectiveId: 'lo-0' });
    expect(items[1]).toMatchObject({ maxMarks: 3, criteria: [{ criterionId: 'k', awarded: 0, max: 2 }, { criterionId: 'm', awarded: 0, max: 1 }] });
    expect(items[3]).toMatchObject({ maxMarks: null, learningObjectiveId: 'lo-3' });
  });

  it('a committed response counts even if the navigation state lost the update (race), and INVALID stays INVALID', () => {
    const responses = [{ target_index: 1, score: '0', max_score: '1', assessment_component_id: 'c1', learning_objective_id: null, item_snapshot: {}, criteria_breakdown: { invalidResponse: 'UNKNOWN_PART' } }];
    const items = buildScoringItems(PLAN as any, { items: { '1': { status: 'DELIVERED' } } } as any, responses, new Map());
    expect(items[1].status).toBe('INVALID');
  });

  it('mark-scheme criteria are rebuilt from the stored per-part breakdown', () => {
    const responses = [{ target_index: 0, score: '2', max_score: '3', assessment_component_id: 'c1', item_snapshot: {}, criteria_breakdown: { parts: { a: { awarded: 2, max: 2, criterion: 'A' }, b: { awarded: 0, max: 1, criterion: 'M' } } } }];
    const items = buildScoringItems(PLAN as any, { items: {} } as any, responses, new Map());
    expect(items[0].criteria).toEqual([{ criterionId: 'A', awarded: 2, max: 2 }, { criterionId: 'M', awarded: 0, max: 1 }]);
  });

  it('a pre-Track-B attempt (no v2 navigation state) is scored exactly as before: its committed responses only', () => {
    const responses = [
      { target_index: null, score: '1', max_score: '1', assessment_component_id: 'c1', created_at: '2026-01-01' },
      { target_index: null, score: '0', max_score: '1', assessment_component_id: 'c1', created_at: '2026-01-02' },
    ];
    const items = buildScoringItems(PLAN as any, null, responses, new Map());
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.status === 'ANSWERED')).toBe(true);
  });
});

describe('canonical lifecycle (derived, one truth)', () => {
  it.each([
    [{ simulationStatus: null, examAttemptStatus: null, resultStatus: null }, 'NOT_STARTED'],
    [{ simulationStatus: 'ACTIVE', examAttemptStatus: 'IN_PROGRESS', resultStatus: null }, 'IN_PROGRESS'],
    [{ simulationStatus: 'PAUSED', examAttemptStatus: 'IN_PROGRESS', resultStatus: null }, 'PAUSED'],
    [{ simulationStatus: 'COMPLETED', examAttemptStatus: 'COMPLETED', resultStatus: null }, 'SUBMITTED'],
    [{ simulationStatus: 'COMPLETED', examAttemptStatus: 'COMPLETED', resultStatus: 'SCORED' }, 'SCORED'],
    [{ simulationStatus: 'COMPLETED', examAttemptStatus: 'COMPLETED', resultStatus: 'INVALIDATED' }, 'INVALIDATED'],
    [{ simulationStatus: 'ABANDONED', examAttemptStatus: 'ABANDONED', resultStatus: null }, 'ABANDONED'],
  ])('%o -> %s', (input, expected) => {
    expect(deriveExamLifecycle(input as any)).toBe(expected);
  });
});

function bankRow(key: string, extra: Record<string, unknown> = {}) {
  return { id: `id-${key}`, learning_objective_id: 'lo-1', content: { ...choice({ key, language: 'en', question: `q ${key}`, options: ['a', 'b'], correct: 1, explanation: 'e' }), ...extra } };
}

describe('approved bank sourcing', () => {
  beforeEach(() => queryMock.mockReset());

  it('only PUBLISHED items of the objective (and configured question type), never one already used in the attempt', async () => {
    queryMock.mockResolvedValue({ rows: [bankRow('k1')] });
    await selectApprovedBankItem({ attemptId: 'a1', target: { learningObjectiveId: 'lo-1', questionType: 'multiple_choice', difficultyRange: null }, excludeApprovedItemIds: ['used'], preferredStimulusKey: null });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status = 'PUBLISHED'/);
    expect(sql).toMatch(/NOT \(ai\.id = ANY/);
    // Question Bank V2: practice-usable versions only, unseen-first for the Student (null = no Student context).
    expect(sql).toMatch(/'PRACTICE' = ANY\(ai\.usage_eligibility\)/);
    expect(params).toEqual(['lo-1', 'multiple_choice', ['used'], null]);
  });

  it('variant selection is deterministic per attempt and differs across attempts', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => bankRow(`k${i}`));
    queryMock.mockResolvedValue({ rows });
    const target = { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null };
    const a1 = await selectApprovedBankItem({ attemptId: 'attempt-1', target, excludeApprovedItemIds: [], preferredStimulusKey: null });
    const a1again = await selectApprovedBankItem({ attemptId: 'attempt-1', target, excludeApprovedItemIds: [], preferredStimulusKey: null });
    expect(a1?.id).toBe(a1again?.id);
    const picks = new Set<string>();
    for (let i = 0; i < 12; i++) picks.add((await selectApprovedBankItem({ attemptId: `attempt-${i}`, target, excludeApprovedItemIds: [], preferredStimulusKey: null }))!.id);
    expect(picks.size).toBeGreaterThan(1);
  });

  it('keeps a stimulus unit together and honours the difficulty range', async () => {
    queryMock.mockResolvedValue({ rows: [bankRow('x', { stimulus: { key: 'other', text: 't' } }), bankRow('y', { stimulus: { key: 'unit-1', text: 't' } }), bankRow('z', { difficulty: 5 })] });
    const r = await selectApprovedBankItem({ attemptId: 'a', target: { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null }, excludeApprovedItemIds: [], preferredStimulusKey: 'unit-1' });
    expect(r?.exam.stimulus?.key).toBe('unit-1');
    const hard = await selectApprovedBankItem({ attemptId: 'a', target: { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: { min: 5, max: 5 } }, excludeApprovedItemIds: [], preferredStimulusKey: null });
    expect(hard?.exam.key).toBe('z');
  });

  it('a malformed bank row is skipped, never delivered', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'bad', learning_objective_id: 'lo-1', content: { key: 'bad' } }] });
    expect(await selectApprovedBankItem({ attemptId: 'a', target: { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null }, excludeApprovedItemIds: [], preferredStimulusKey: null })).toBeNull();
  });
});

describe('validated AI fallback', () => {
  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue({ rows: [{ subject_id: 'subj-1' }] });
    resolveActivityMetadataForObjectiveMock.mockReset().mockResolvedValue({ canonicalConceptIds: ['cc-1'], skillIds: [], competencyIds: [] });
    resolveStudentConceptMock.mockReset().mockResolvedValue('concept-1');
    generatePracticeQuestionsMock.mockReset();
  });
  const gen = (over: Record<string, unknown> = {}) => ({ id: 'g1', conceptId: 'concept-1', type: 'multiple_choice', answerFormat: 'single_choice', question: 'q', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctAnswer: 'A', explanation: 'e', difficulty: 3, ...over });

  it('generates for the OWNER\'s own concept, asks for the configured type, and accepts a valid item', async () => {
    generatePracticeQuestionsMock.mockResolvedValue([gen()]);
    const r = await generateValidatedItem({ studentId: 'student-1', target: { learningObjectiveId: 'lo-1', questionType: 'multiple_choice', difficultyRange: { min: 2, max: 4 } }, language: 'es' });
    expect(r.outcome).toBe('READY');
    expect(resolveStudentConceptMock).toHaveBeenCalledWith('student-1', 'cc-1');
    const [conceptId, studentId, , opts] = generatePracticeQuestionsMock.mock.calls[0];
    expect([conceptId, studentId]).toEqual(['concept-1', 'student-1']);
    expect(opts).toMatchObject({ count: 1, difficulty: 3, language: 'es', guidance: expect.stringContaining('multiple_choice') });
    expect(r.outcome === 'READY' && r.item.exam.source).toBe('AI_GENERATED');
  });

  it('an invalid generation (wrong type / answer key not an option / out of range) is retried once, then UNAVAILABLE -- never delivered', async () => {
    generatePracticeQuestionsMock.mockResolvedValueOnce([gen({ type: 'true_false' })]).mockResolvedValueOnce([gen({ correctAnswer: 'Z' })]);
    const r = await generateValidatedItem({ studentId: 's', target: { learningObjectiveId: 'lo-1', questionType: 'multiple_choice', difficultyRange: null }, language: 'en' });
    expect(r).toEqual({ outcome: 'UNAVAILABLE', reason: 'NO_ITEM_GENERATED' });
    expect(generatePracticeQuestionsMock).toHaveBeenCalledTimes(2);
  });

  it('a provider failure is recorded and reported as UNAVAILABLE', async () => {
    generatePracticeQuestionsMock.mockRejectedValue(new Error('provider down'));
    expect(await generateValidatedItem({ studentId: 's', target: { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null }, language: 'en' })).toEqual({ outcome: 'UNAVAILABLE', reason: 'NO_ITEM_GENERATED' });
  });

  it('no published mapping / no owner concept: UNAVAILABLE with the precise reason (no AI call)', async () => {
    resolveActivityMetadataForObjectiveMock.mockResolvedValue(null);
    expect((await generateValidatedItem({ studentId: 's', target: { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null }, language: 'en' })).outcome).toBe('UNAVAILABLE');
    resolveActivityMetadataForObjectiveMock.mockResolvedValue({ canonicalConceptIds: ['cc-1'], skillIds: [], competencyIds: [] });
    resolveStudentConceptMock.mockResolvedValue(null);
    expect(await generateValidatedItem({ studentId: 's', target: { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null }, language: 'en' })).toEqual({ outcome: 'UNAVAILABLE', reason: 'CONCEPT_NOT_MATCHED' });
    expect(generatePracticeQuestionsMock).not.toHaveBeenCalled();
  });

  it('validateGeneratedItemForTarget checks type, difficulty, objective and answer validity', () => {
    const it = examItemFromGenerated(gen({ difficulty: 5 }) as any, 'lo-2');
    expect(validateGeneratedItemForTarget(it, { learningObjectiveId: 'lo-1', questionType: 'multiple_choice', difficultyRange: { min: 1, max: 3 } }).reasons).toEqual(['DIFFICULTY_OUT_OF_RANGE:5', 'OBJECTIVE_MISMATCH']);
  });

  it('sourceExamItem prefers the bank and never calls the generator when the bank has an item', async () => {
    queryMock.mockReset().mockResolvedValue({ rows: [bankRow('only')] });
    const r = await sourceExamItem({ attemptId: 'a', studentId: 's', target: { learningObjectiveId: 'lo-1', questionType: null, difficultyRange: null }, excludeApprovedItemIds: [], preferredStimulusKey: null, language: 'en' });
    expect(r.outcome === 'READY' && r.item.exam.source).toBe('APPROVED_BANK');
    expect(generatePracticeQuestionsMock).not.toHaveBeenCalled();
  });
});
