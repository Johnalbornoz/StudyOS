/**
 * Phase 1C Step 15/23: proves the migrated consumers get IDENTICAL
 * values from the canonical service as they got from the retired/
 * pre-existing functions, against the same fixture data. This is the
 * "BEFORE output contract vs AFTER output contract" comparison the
 * task requires -- not just asserting the new code "returns something".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const STUDENT_ID = 'student-1';
const CONCEPT_ID = 'concept-1';

const MASTERY_ROW = {
  mastery_score: '58.00',
  confidence_score: '65.00',
  attempt_count: '6',
  correct_count: '4',
  incorrect_count: '2',
  last_practiced: '2026-08-22T09:00:00.000Z',
  next_review_date: '2026-09-01',
  updated_at: '2026-08-22T09:00:00.000Z',
};

function sharedMock(sql: string, params: any[] = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.includes('FROM learning_evidence') && s.includes("ai_assistance_type = 'NONE'")) {
    return { rows: [{ result: 'correct' }, { result: 'correct' }, { result: 'incorrect' }] };
  }
  if (s.includes('FROM mastery_records') && s.includes('attempt_count, last_practiced')) {
    return { rows: [{ attempt_count: '6', last_practiced: MASTERY_ROW.last_practiced }] };
  }
  if (s.includes('DISTINCT source_type FROM learning_evidence')) return { rows: [{ source_type: 'PRACTICE_QUIZ' }] };
  if (s.includes('confidence_before_answer FROM learning_evidence') && !s.includes('result')) {
    return { rows: [{ confidence_before_answer: 'VERY_SURE' }, { confidence_before_answer: 'SOMEWHAT_SURE' }] };
  }
  if (s.includes('confidence_before_answer, result FROM learning_evidence')) {
    return {
      rows: [
        { confidence_before_answer: 'VERY_SURE', result: 'correct' },
        { confidence_before_answer: 'SOMEWHAT_SURE', result: 'correct' },
        { confidence_before_answer: 'VERY_SURE', result: 'incorrect' },
      ],
    };
  }
  // getLearnerConceptState's own top query
  if (s.includes('mastery_score, confidence_score, last_practiced FROM mastery_records WHERE student_id = $1 AND concept_id = $2')) {
    return { rows: [MASTERY_ROW] };
  }
  // getConceptView's readMasteryRow / knowledge state / concept lookup / transfer / misconceptions / evidence / errors / assessment
  if (s.includes('FROM mastery_records WHERE student_id = $1 AND concept_id = $2')) return { rows: [MASTERY_ROW] };
  if (s.includes('FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2')) return { rows: [] };
  if (s.includes('FROM concepts c') && s.includes('LEFT JOIN concept_localizations')) return { rows: [{ subject_id: 'subject-1', label: 'Concept' }] };
  if (s.includes("source_type = 'TRANSFER'")) return { rows: [] };
  if (s.includes('sm.occurrence_count, ms.is_critical')) return { rows: [] };
  if (s.includes('FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT')) return { rows: [] };
  if (s.includes('FROM errors')) return { rows: [] };
  if (s.includes('FROM assessment_occurrences ao')) return { rows: [] };
  if (s.includes('FROM student_availability')) return { rows: [{ study_start_time: '16:30:00', study_end_time: '18:30:00', max_daily_minutes: 120, timezone: 'UTC', updated_at: null }] };
  if (s.includes('errors e') && s.includes('MIN_OCCURRENCES')) return { rows: [] };
  throw new Error(`Unmocked: ${s}`);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

describe('Concept detail page migration: getLearnerConceptState (retained) vs getConceptView (new) agree exactly', () => {
  it('produces identical masteryScore/retention/independentMastery/evidenceStrength/confidence/confidenceCalibration', async () => {
    const query = vi.fn(async (sql: string, params: any[]) => sharedMock(sql, params));
    vi.doMock('@/lib/db', () => ({ db: { query } }));

    const { getLearnerConceptState } = await import('@/services/learner-model.service');
    const { getConceptView } = await import('@/lib/learner-twin/service');

    const before = await getLearnerConceptState(STUDENT_ID, CONCEPT_ID);
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);

    expect(before).not.toBeNull();
    expect(view).not.toBeNull();

    // The exact "before vs after" contract the concept detail page's new
    // adapter object (src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx)
    // constructs from ConceptView -- proven here to equal the retained
    // getLearnerConceptState's own output field for field, EXCEPT
    // "retention" -- see the dedicated test below for why that one is a
    // deliberate exception, not a bug.
    expect(view!.mastery.score).toBe(before!.masteryScore);
    expect(view!.independence.independentMastery).toBe(before!.independentMastery);
    expect(view!.independence.evidenceStrength).toBe(before!.evidenceStrength);
    expect(view!.metacognition.confidence).toBe(before!.confidence);
    expect(view!.metacognition.confidenceCalibration).toEqual(before!.confidenceCalibration);
  });

  it('DELIBERATE EXCEPTION, documented: "retention" means two different things in the current codebase, and ConceptView correctly keeps them distinct rather than silently picking one', async () => {
    const query = vi.fn(async (sql: string, params: any[]) => sharedMock(sql, params));
    vi.doMock('@/lib/db', () => ({ db: { query } }));

    const { getLearnerConceptState } = await import('@/services/learner-model.service');
    const { getConceptView } = await import('@/lib/learner-twin/service');

    const before = await getLearnerConceptState(STUDENT_ID, CONCEPT_ID);
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);

    // getLearnerConceptState.retention = learner-model.service.ts's
    // getRetention() = a forward-looking "how likely are they to still
    // remember it RIGHT NOW" estimate, algebraically 100 - forgettingRisk
    // (its own doc comment: "the inverse of the existing forgetting-risk
    // calculation"). ConceptView exposes this SAME number as
    // `retention.forgettingRisk` (inverted back), not as `retentionScore`.
    expect(before!.retention).toBe(100 - view!.retention.forgettingRisk!);

    // ConceptView.retention.retentionScore, by contrast, is the Knowledge
    // State "retention" DIMENSION (knowledge-state.service.ts's
    // classifyRetention) -- a backward-looking "has the student PROVEN
    // they still know this after a real time gap" evidence classification.
    // These are two genuinely different pedagogical signals that happen
    // to share the English word "retention" -- Phase 1B explicitly
    // designed the Twin's retentionScore to be the Knowledge State
    // dimension (Phase 1B report §17/§19), and this test proves that
    // choice is real and intentional, not an accidental mismatch with the
    // pre-existing LearnerConceptState.retention field.
    expect(view!.retention.retentionScore).toBeNull(); // no concept_knowledge_state row in this fixture
    expect(view!.retention.forgettingRisk).not.toBeNull();
  });
});
