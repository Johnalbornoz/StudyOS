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
  if (s.includes('sm.occurrence_count, sm.status, ms.is_critical')) return { rows: [] };
  if (s.includes('FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT')) return { rows: [] };
  if (s.includes('FROM errors')) return { rows: [] };
  if (s.includes('SELECT timestamp, metadata FROM learning_evidence')) return { rows: [] };
  if (s.includes('FROM assessment_occurrences ao')) return { rows: [] };
  if (s.includes('FROM student_availability')) return { rows: [{ study_start_time: '16:30:00', study_end_time: '18:30:00', max_daily_minutes: 120, timezone: 'UTC', updated_at: null }] };
  if (s.includes('errors e') && s.includes('MIN_OCCURRENCES')) return { rows: [] };
  // Phase 1E: derived learner metrics -- safe, deterministic defaults.
  if (s.includes('ai_assistance_type, hints_used, timestamp FROM learning_evidence')) return { rows: [] };
  if (s.includes('SELECT outcome FROM verification_attempts')) return { rows: [] };
  if (s.includes('mastery_policies')) {
    return { rows: [{ version: 1, minimum_understanding: 70, minimum_independence: 60, minimum_application: 60, minimum_retention: 60, minimum_transfer: 50, requires_transfer: false, maximum_critical_misconceptions: 0, minimum_evidence_count: 3, minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14 }] };
  }
  if (s.includes('MIN(timestamp) AS first_evidence_at')) return { rows: [] };
  if (s.includes("DISTINCT ON (concept_id, new_state ->> 'masteryState')")) return { rows: [] };
  if (s.includes('FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = ANY')) return { rows: [] };
  if (s.includes('FROM concept_relationships WHERE target_concept_id')) return { rows: [] };
  if (s.includes('SELECT concept_id, mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = ANY')) return { rows: [] };
  if (s.includes('SELECT concept_id FROM mastery_records WHERE student_id = $1')) return { rows: [] };
  if (s.includes('FROM study_plans WHERE student_id')) return { rows: [] };
  if (s.includes('FROM study_sessions ss WHERE')) return { rows: [] };
  if (s.includes('SELECT result, timestamp FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp ASC')) return { rows: [] };
  // Phase 2D/2E: eager on ConceptView -- always exercised.
  if (s.includes('FROM cognitive_diagnoses cd')) return { rows: [{ n: 0 }] };
  if (s.includes("FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('CONFIRMED'")) return { rows: [{ n: 0 }] };
  if (s.includes("FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('RESOLVED'")) return { rows: [] };
  if (s.includes("FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'OPEN'")) return { rows: [] };
  if (s.includes("FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'CLOSED'")) return { rows: [] };
  // Phase 3F: eager on ConceptView -- always exercised.
  if (s.includes("evidenceMode' = 'ASSESSMENT' OR")) return { rows: [] };
  if (s.includes("evidenceMode' IN ('INDEPENDENT'")) return { rows: [] };
  if (s.includes('timestamp, source_type, metadata FROM learning_evidence')) return { rows: [] };
  if (s.includes('FROM verification_attempts') && s.includes('outcome IS NOT NULL')) return { rows: [] };
  if (s.includes('FROM verification_attempts') && s.includes('outcome IS NULL')) return { rows: [{ n: 0 }] };
  // Step 6I: Phase 6 canonical memory state -- no row by default; the
  // dedicated retention test below overrides this with a real fixture.
  if (s.includes('FROM concept_memory_state')) return { rows: [] };
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
    const query = vi.fn(async (sql: string, params: any[]) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      // Step 6I: Phase 6 canonical memory state -- gives this fixture a
      // real, non-null forgettingRisk to compare against.
      if (s.includes('FROM concept_memory_state')) {
        return {
          rows: [
            {
              concept_id: CONCEPT_ID,
              policy_version: 1,
              initial_competence_anchor_at: '2026-07-01T00:00:00.000Z',
              last_qualified_attempt_at: '2026-07-01T00:00:00.000Z',
              last_successful_retention_at: null,
              last_unsuccessful_retention_at: null,
              demonstrated_retention_score: null,
              retention_evidence_count: 0,
              consecutive_qualifying_successes: 0,
              memory_stability: 'UNSTABLE',
              memory_status: 'WAITING_FOR_RETENTION',
              next_review_at: '2026-07-04T00:00:00.000Z',
            },
          ],
        };
      }
      return sharedMock(sql, params);
    });
    vi.doMock('@/lib/db', () => ({ db: { query } }));

    const { getLearnerConceptState } = await import('@/services/learner-model.service');
    const { getConceptView } = await import('@/lib/learner-twin/service');

    const before = await getLearnerConceptState(STUDENT_ID, CONCEPT_ID);
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);

    // Step 6I: getLearnerConceptState.retention (learner-model.service.ts's
    // getRetention(), still the legacy spaced-repetition formula over
    // mastery_records -- untouched by Step 6I, out of scope) and
    // ConceptView.retention.forgettingRisk (now Phase 6's canonical
    // computeLiveMemorySignals value, via memory-read.service.ts) are, as
    // of this step, two INDEPENDENTLY SOURCED numbers with no required
    // numeric relationship -- Twin no longer computes the legacy formula
    // at all (Section 13: "Twin must no longer compute its own formula").
    // This is a deliberate, disclosed authority change, not a bug: before
    // Step 6I these two were proven identical (same underlying formula,
    // fed from mastery_records both times); after Step 6I they generally
    // will NOT agree, since one is legacy/mastery_records-derived and the
    // other is Phase 6/concept_memory_state-derived. Assert non-equality
    // explicitly, rather than silently dropping the comparison, so a
    // future accidental re-convergence (or divergence) is visible here.
    expect(before!.retention).not.toBe(100 - view!.retention.forgettingRisk!);

    // ConceptView.retention.retentionScore, by contrast, is the Knowledge
    // State "retention" DIMENSION (knowledge-state.service.ts's
    // classifyRetention/Phase 6 mirror since Step 6G) -- a backward-
    // looking "has the student PROVEN they still know this after a real
    // time gap" evidence classification. Still genuinely distinct from
    // both the legacy predictive value AND Phase 6's own
    // forgettingRisk/retrievabilityNow -- Phase 1B's original design
    // choice remains intact.
    expect(view!.retention.retentionScore).toBeNull(); // no concept_knowledge_state row in this fixture
    expect(view!.retention.forgettingRisk).not.toBeNull();

    // Step 6I: ConceptView.retention.forgettingRisk and
    // ConceptView.memory.forgettingRisk must be the exact same number --
    // ONE canonical Phase 6 forgettingRisk within Twin, never two.
    expect(view!.retention.forgettingRisk).toBe(view!.memory.forgettingRisk);
    expect(view!.memory.memoryStatus).toBe('WAITING_FOR_RETENTION');
  });
});
