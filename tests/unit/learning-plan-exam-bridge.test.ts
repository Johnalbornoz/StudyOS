/**
 * Track A -- Exam → gap → recommendation → Personal Plan. Accepting adds the
 * EXAM_GAP source through the universal enrollment (no duplicate learner
 * state; "ya estás trabajando este concepto" when it was already in plan);
 * only the learner's own recommendations; dismissed gaps return only on a
 * later attempt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: vi.fn() } }));
const enrollMock = vi.fn();
const planIndexMock = vi.fn();
vi.mock('@/lib/learning-plan/personal-plan.service', () => ({ enrollCanonicalConcept: (...a: any[]) => enrollMock(...a), planIndex: (...a: any[]) => planIndexMock(...a) }));
vi.mock('@/lib/pedagogical-decision/canonical-decision.service', () => ({ getCanonicalPedagogicalDecision: vi.fn() }));
vi.mock('@/lib/learning-plan/labels', () => ({ canonicalConceptLabels: vi.fn(async () => new Map()) }));

import { acceptExamRecommendation, dismissExamRecommendation, examPrepStatus, EXAM_GAP_THRESHOLD, RecommendationError } from '@/lib/learning-plan/exam-bridge.service';
import { readFileSync } from 'fs';

const REC = { id: 'rec-1', canonical_concept_id: 'cc-1', exam_attempt_id: 'att-1', status: 'OPEN' };

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  enrollMock.mockReset().mockResolvedValue({ learnerConceptId: 'lc-1', conceptCreated: false, entryCreated: false, restored: false, sourceAdded: true });
  planIndexMock.mockReset().mockResolvedValue(new Map());
});

describe('exam gap → Personal Plan', () => {
  it('accepting enrolls with an EXAM_GAP source keyed by the attempt and records the acceptance', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => (sql.startsWith('SELECT id, canonical_concept_id') ? { rows: [REC] } : { rows: [] }));
    expect(await acceptExamRecommendation('s1', 'rec-1', 'u1')).toEqual({ learnerConceptId: 'lc-1', alreadyInPlan: false });
    expect(enrollMock).toHaveBeenCalledWith('s1', 'cc-1', expect.objectContaining({ type: 'EXAM_GAP', key: 'att-1', examAttemptId: 'att-1' }));
    const sql = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((x) => x.includes("SET status = 'ACCEPTED'"))).toBe(true);
    expect(sql.some((x) => x.includes("'RECOMMENDATION_ACCEPTED'"))).toBe(true);
  });

  it('already in plan: same learner concept (no duplicate), reported as "already working on it"', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => (sql.startsWith('SELECT id, canonical_concept_id') ? { rows: [REC] } : { rows: [] }));
    planIndexMock.mockResolvedValue(new Map([['cc-1', { learnerConceptId: 'lc-1', planStatus: 'IN_PLAN' }]]));
    expect(await acceptExamRecommendation('s1', 'rec-1', 'u1')).toEqual({ learnerConceptId: 'lc-1', alreadyInPlan: true });
    expect(enrollMock).toHaveBeenCalledTimes(1);
  });

  it("another learner's recommendation is not found (ownership in the query)", async () => {
    await expect(acceptExamRecommendation('intruder', 'rec-1', 'u2')).rejects.toBeInstanceOf(RecommendationError);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND student_id = \$2/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it('dismiss only closes the learner\'s own OPEN recommendation; nothing enters the plan', async () => {
    expect(await dismissExamRecommendation('s1', 'rec-1', 'u1')).toBe(false);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/student_id = \$2 AND status = 'OPEN'/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it('exam-prep status: a gap needs reinforcement; consolidated phases count as mastered', () => {
    expect(examPrepStatus('CONSOLIDATED', true, true)).toBe('NEEDS_REINFORCEMENT');
    expect(examPrepStatus(null, false, false)).toBe('NOT_STARTED');
    expect(examPrepStatus('PRACTICE', true, false)).toBe('IN_PROGRESS');
    expect(examPrepStatus('RETAIN', true, false)).toBe('CONSOLIDATED');
    expect(EXAM_GAP_THRESHOLD).toBe(0.5);
  });

  it('a dismissed gap reopens only on a later attempt; accepted stays accepted', () => {
    const src = readFileSync('src/lib/learning-plan/exam-bridge.service.ts', 'utf-8');
    expect(src).toMatch(/status = 'DISMISSED' AND learning_recommendations\.exam_attempt_id IS DISTINCT FROM EXCLUDED\.exam_attempt_id THEN 'OPEN'/);
    expect(src).not.toMatch(/INSERT INTO (learning_evidence|mastery_records)|UPDATE (mastery_records|concept_knowledge_state)/);
  });
});
