/**
 * CANON-R5R1 Part 3/4 -- SESSION PERSISTENCE. `storeQuiz`/`getQuizSession`
 * round-trip the trusted v1 launch marker through the additive
 * quiz_sessions columns (pedagogical_policy_version, canonical_revision,
 * canonical_stage) -- the durable, server-side reload path submission
 * uses instead of ever trusting a client-supplied claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import { storeQuiz, getQuizSession } from '@/services/quiz-persistence.service';

const QUIZ_PERSISTENCE_SRC = readFileSync(join(process.cwd(), 'src/services/quiz-persistence.service.ts'), 'utf-8');

beforeEach(() => {
  queryMock.mockReset();
});

describe('storeQuiz -- persists the v1 marker only when the caller supplies one', () => {
  it('an ordinary (legacy) call persists NULL for all three v1 marker columns', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'topic_practice');
    const params = queryMock.mock.calls[0][1] as any[];
    expect(params[params.length - 3]).toBeNull();
    expect(params[params.length - 2]).toBeNull();
    expect(params[params.length - 1]).toBeNull();
  });

  it('a caller-supplied v1 marker is persisted verbatim into the last three INSERT parameters', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'topic_practice', [], {
      pedagogicalPolicyVersion: 'studyus-canonical-v1',
      canonicalRevision: 'rev-abc',
      canonicalStage: 'PRACTICE',
    });
    const params = queryMock.mock.calls[0][1] as any[];
    expect(params[params.length - 3]).toBe('studyus-canonical-v1');
    expect(params[params.length - 2]).toBe('rev-abc');
    expect(params[params.length - 1]).toBe('PRACTICE');
  });

  it('the INSERT column list names all three new columns explicitly (source audit)', () => {
    const fn = QUIZ_PERSISTENCE_SRC.slice(QUIZ_PERSISTENCE_SRC.indexOf('export async function storeQuiz'), QUIZ_PERSISTENCE_SRC.indexOf('export async function storeQuiz') + 2000);
    expect(fn).toMatch(/pedagogical_policy_version, canonical_revision, canonical_stage/);
  });
});

describe('getQuizSession -- reloads the trusted marker from the persisted row, never reconstructs one', () => {
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
      ...overrides,
    };
  }

  it('a legacy row (all three columns NULL) reloads v1Marker: null', async () => {
    queryMock.mockResolvedValueOnce({ rows: [row()] });
    const session = await getQuizSession('quiz-1');
    expect(session?.v1Marker).toBeNull();
  });

  it('a v1-stamped row reloads the exact persisted marker, verbatim', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [row({ pedagogical_policy_version: 'studyus-canonical-v1', canonical_revision: 'rev-abc', canonical_stage: 'PRACTICE' })],
    });
    const session = await getQuizSession('quiz-1');
    expect(session?.v1Marker).toEqual({
      pedagogicalPolicyVersion: 'studyus-canonical-v1',
      canonicalRevision: 'rev-abc',
      canonicalStage: 'PRACTICE',
    });
  });

  it('a missing session returns null, never a partially-filled marker', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const session = await getQuizSession('missing');
    expect(session).toBeNull();
  });
});
