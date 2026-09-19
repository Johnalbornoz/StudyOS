import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import {
  storeQuiz,
  getQuizSession,
  ACTIVITY_TYPE_BY_QUIZ_MODE,
  activityTypeForQuizMode,
  evidenceModeForQuizMode,
  type QuizMode,
} from '@/services/quiz-persistence.service';
import * as quizPersistence from '@/services/quiz-persistence.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('Phase 3A -- Activity Type/Evidence Mode are fixed at attempt creation and persisted', () => {
  it('storeQuiz stamps the derived activity_type/evidence_mode, followed by CANON-R5R1/R5R1A\'s v1 authorization columns (all null for an ordinary session)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'quick_check');

    const params = queryMock.mock.calls[0][1] as any[];
    // CANON-R5R1 appended pedagogical_policy_version/canonical_revision/
    // canonical_stage after evidence_mode; CANON-R5R1A appended ONE more
    // (canonical_activity_contract, JSONB) after those; F11-C2 appended
    // ONE more still (target_skill_ids, null for an ordinary session) --
    // activity_type/evidence_mode are no longer the LAST two params, but
    // are still adjacent, immediately before the (here, all-null) v1 +
    // Skill-targeting columns.
    expect(params[params.length - 8]).toBe('SOLO_CHECK'); // activity_type
    expect(params[params.length - 7]).toBe('INDEPENDENT'); // evidence_mode
    expect(params[params.length - 6]).toBeNull(); // pedagogical_policy_version
    expect(params[params.length - 5]).toBeNull(); // canonical_revision
    expect(params[params.length - 4]).toBeNull(); // canonical_stage
    expect(params[params.length - 3]).toBeNull(); // canonical_activity_contract
    expect(params[params.length - 2]).toBeNull(); // target_skill_ids (F11-C2, omitted here)
    expect(params[params.length - 1]).toBeNull(); // target_competency_ids (F11-C3, omitted here)
  });

  it('quick_check produces SOLO_CHECK/INDEPENDENT -- never CUMULATIVE_ASSESSMENT/ASSESSMENT (the fixed legacy bug)', () => {
    expect(activityTypeForQuizMode('quick_check')).toBe('SOLO_CHECK');
    expect(evidenceModeForQuizMode('quick_check')).toBe('INDEPENDENT');
  });

  it('review (assisted reinforcement) -> REVIEW/PRACTICE; retention_check (unassisted) -> RETENTION_CHECK/INDEPENDENT', () => {
    expect(evidenceModeForQuizMode('review')).toBe('PRACTICE');
    expect(evidenceModeForQuizMode('retention_check')).toBe('INDEPENDENT');
  });

  it('every quiz mode maps to a real Activity Type -- the table is total', () => {
    const modes: QuizMode[] = ['topic_practice', 'review', 'quick_check', 'retention_check', 'cumulative_assessment', 'exam_simulation', 'diagnostic_check'];
    for (const m of modes) {
      expect(ACTIVITY_TYPE_BY_QUIZ_MODE[m]).toBeTruthy();
    }
  });

  it('getQuizSession returns the persisted activity_type/evidence_mode for a new-format row', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'quiz-1', student_id: 's1', concept_id: 'c1', subject_id: 'subj1',
        questions: [], language: 'en', status: 'active',
        created_at: new Date(), expires_at: new Date(),
        quiz_mode: 'quick_check', concept_ids: ['c1'], hints_used_questions: [],
        activity_type: 'SOLO_CHECK', evidence_mode: 'INDEPENDENT',
      }],
    });
    const session = await getQuizSession('quiz-1');
    expect(session?.activityType).toBe('SOLO_CHECK');
    expect(session?.evidenceMode).toBe('INDEPENDENT');
  });

  it('backward compatibility: a historical row with NULL activity_type/evidence_mode derives them from its unchanged quiz_mode', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'quiz-old', student_id: 's1', concept_id: 'c1', subject_id: 'subj1',
        questions: [], language: 'en', status: 'completed',
        created_at: new Date(), expires_at: new Date(),
        quiz_mode: 'cumulative_assessment', concept_ids: ['c1'], hints_used_questions: [],
        activity_type: null, evidence_mode: null,
      }],
    });
    const session = await getQuizSession('quiz-old');
    expect(session?.activityType).toBe('CUMULATIVE_ASSESSMENT');
    expect(session?.evidenceMode).toBe('ASSESSMENT');
  });

  it('Evidence Mode is immutable per attempt: no exported function updates quiz_mode/activity_type/evidence_mode after creation', () => {
    const exportedNames = Object.keys(quizPersistence);
    const suspiciousUpdaters = exportedNames.filter((name) => /update.*(mode|activity)/i.test(name));
    expect(suspiciousUpdaters).toEqual([]);
  });

  it('starting a new mode always creates a brand-new attempt (quizId), never reuses/mutates an existing one', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const idA = await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'topic_practice');
    const idB = await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'quick_check');
    expect(idA).not.toBe(idB);
  });
});
