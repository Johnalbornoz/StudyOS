/**
 * CANON-R5R1/R5R1A Part 3/4/9 -- SESSION PERSISTENCE. `storeQuiz`/
 * `getQuizSession` round-trip the trusted v1 AUTHORIZATION -- three
 * simple TEXT columns (policy version/revision/stage, from R5R1) plus
 * ONE additive JSONB column (`canonical_activity_contract`, from
 * R5R1A) carrying the actual item-count/difficulty/assistance contract
 * -- the durable, server-side reload path submission uses instead of
 * ever trusting a client-supplied claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import { storeQuiz, getQuizSession, type QuizSessionV1Marker } from '@/services/quiz-persistence.service';

const QUIZ_PERSISTENCE_SRC = readFileSync(join(process.cwd(), 'src/services/quiz-persistence.service.ts'), 'utf-8');

const FULL_MARKER: QuizSessionV1Marker = {
  pedagogicalPolicyVersion: 'studyus-canonical-v1',
  canonicalRevision: 'rev-abc',
  canonicalStage: 'PRACTICE',
  canonicalActivityType: 'PRACTICE',
  itemCount: { min: 2, max: 3, authorized: 3 },
  difficulty: { min: 2, max: 4, target: 3 },
  assistanceAllowed: true,
  // CANON-R6: additive fields, widened onto this same marker shape.
  independence: false,
  supportLevel: 'ASSISTED',
  minimumScorePercent: 80,
};

beforeEach(() => {
  queryMock.mockReset();
});

describe('storeQuiz -- persists the v1 authorization only when the caller supplies one', () => {
  it('an ordinary (legacy) call persists NULL for the three text columns AND the contract JSONB column', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'topic_practice');
    const params = queryMock.mock.calls[0][1] as any[];
    expect(params[params.length - 4]).toBeNull(); // pedagogical_policy_version
    expect(params[params.length - 3]).toBeNull(); // canonical_revision
    expect(params[params.length - 2]).toBeNull(); // canonical_stage
    expect(params[params.length - 1]).toBeNull(); // canonical_activity_contract
  });

  it('a caller-supplied v1 authorization is persisted verbatim -- three text columns plus a JSONB contract blob', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'topic_practice', [], FULL_MARKER);
    const params = queryMock.mock.calls[0][1] as any[];
    expect(params[params.length - 4]).toBe('studyus-canonical-v1');
    expect(params[params.length - 3]).toBe('rev-abc');
    expect(params[params.length - 2]).toBe('PRACTICE');
    const contract = JSON.parse(params[params.length - 1]);
    expect(contract).toEqual({
      canonicalActivityType: 'PRACTICE',
      itemCount: { min: 2, max: 3, authorized: 3 },
      difficulty: { min: 2, max: 4, target: 3 },
      assistanceAllowed: true,
      independence: false,
      supportLevel: 'ASSISTED',
      minimumScorePercent: 80,
    });
  });

  it('the INSERT column list names all four v1 columns explicitly (source audit)', () => {
    const fn = QUIZ_PERSISTENCE_SRC.slice(QUIZ_PERSISTENCE_SRC.indexOf('export async function storeQuiz'), QUIZ_PERSISTENCE_SRC.indexOf('export async function storeQuiz') + 3200);
    expect(fn).toMatch(/pedagogical_policy_version, canonical_revision, canonical_stage,\s*\n\s*canonical_activity_contract/);
  });
});

describe('getQuizSession -- reloads the trusted authorization from the persisted row, never reconstructs one', () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 'quiz-1',
      student_id: 's1',
      concept_id: 'c1',
      subject_id: 'subj1',
      questions: [],
      language: 'en',
      status: 'active',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 1000000),
      quiz_mode: 'topic_practice',
      concept_ids: ['c1'],
      hints_used_questions: [],
      activity_type: 'PRACTICE',
      evidence_mode: 'PRACTICE',
      pedagogical_policy_version: null,
      canonical_revision: null,
      canonical_stage: null,
      canonical_activity_contract: null,
      ...overrides,
    };
  }

  it('a legacy row (everything NULL) reloads v1Marker: null', async () => {
    queryMock.mockResolvedValueOnce({ rows: [row()] });
    const session = await getQuizSession('quiz-1');
    expect(session?.v1Marker).toBeNull();
  });

  it('a fully v1-authorized row reloads the exact persisted authorization, verbatim', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        row({
          pedagogical_policy_version: 'studyus-canonical-v1',
          canonical_revision: 'rev-abc',
          canonical_stage: 'PRACTICE',
          canonical_activity_contract: JSON.stringify({
            canonicalActivityType: 'PRACTICE',
            itemCount: { min: 2, max: 3, authorized: 3 },
            difficulty: { min: 2, max: 4, target: 3 },
            assistanceAllowed: true,
            independence: false,
            supportLevel: 'ASSISTED',
            minimumScorePercent: 80,
          }),
        }),
      ],
    });
    const session = await getQuizSession('quiz-1');
    expect(session?.v1Marker).toEqual(FULL_MARKER);
  });

  it('a row with the text columns set but NO contract JSONB (a partial/inconsistent state) reloads v1Marker: null -- never a partial authorization', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [row({ pedagogical_policy_version: 'studyus-canonical-v1', canonical_revision: 'rev-abc', canonical_stage: 'PRACTICE', canonical_activity_contract: null })],
    });
    const session = await getQuizSession('quiz-1');
    expect(session?.v1Marker).toBeNull();
  });

  it('a missing session returns null, never a partially-filled marker', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const session = await getQuizSession('missing');
    expect(session).toBeNull();
  });
});
