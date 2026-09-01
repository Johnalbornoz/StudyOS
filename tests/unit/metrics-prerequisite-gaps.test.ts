/**
 * Phase 1E Step 29: Prerequisite Gaps fixtures -- healthy prerequisite,
 * missing prerequisite evidence, weak prerequisite, low relationship
 * confidence.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const STUDENT_ID = 'student-1';
const TARGET_ID = 'target-concept';

function buildQueryMock(prereqRows: any[], labelRows: any[], masteryRows: any[], stateRows: any[]) {
  return vi.fn(async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM concept_relationships WHERE target_concept_id')) return { rows: prereqRows };
    if (s.includes('COALESCE(cl.label, c.canonical_id) AS label')) return { rows: labelRows };
    if (s.includes('SELECT concept_id, mastery_score FROM mastery_records')) return { rows: masteryRows };
    if (s.includes('SELECT concept_id, mastery_state FROM concept_knowledge_state')) return { rows: stateRows };
    throw new Error(`Unmocked: ${s}`);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

describe('readPrerequisiteGaps', () => {
  it('no prerequisite relationships in the graph -> NOT_APPLICABLE, never an empty-but-available list', async () => {
    vi.doMock('@/lib/db', () => ({ db: { query: buildQueryMock([], [], [], []) } }));
    const { readPrerequisiteGaps } = await import('@/lib/learner-twin/metrics/prerequisite-gaps');
    const result = await readPrerequisiteGaps(STUDENT_ID, TARGET_ID);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('NOT_APPLICABLE');
  });

  it('healthy prerequisite (VALIDATED_MASTERY) -> gap:false, raw score/state still exposed', async () => {
    const query = buildQueryMock(
      [{ id: 'r1', source_concept_id: 'prereq-1', target_concept_id: TARGET_ID, relationship_type: 'PREREQUISITE_OF', confidence: 0.9, source: 'CURRICULUM', status: 'active' }],
      [{ id: 'prereq-1', label: 'Prereq One' }],
      [{ concept_id: 'prereq-1', mastery_score: '88.00' }],
      [{ concept_id: 'prereq-1', mastery_state: 'VALIDATED_MASTERY' }]
    );
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readPrerequisiteGaps } = await import('@/lib/learner-twin/metrics/prerequisite-gaps');
    const result = await readPrerequisiteGaps(STUDENT_ID, TARGET_ID);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.gaps[0].gap).toBe(false);
      expect(result.value.gaps[0].prerequisiteMasteryScore).toBe(88);
      expect(result.value.gaps[0].prerequisiteMasteryState).toBe('VALIDATED_MASTERY');
      expect(result.value.gapCount).toBe(0);
    }
  });

  it('missing prerequisite evidence (never attempted) -> gap:true, score/state both null, not fabricated', async () => {
    const query = buildQueryMock(
      [{ id: 'r1', source_concept_id: 'prereq-1', target_concept_id: TARGET_ID, relationship_type: 'PREREQUISITE_OF', confidence: 0.8, source: 'CURRICULUM', status: 'active' }],
      [{ id: 'prereq-1', label: 'Prereq One' }],
      [], // no mastery_records row
      [] // no concept_knowledge_state row
    );
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readPrerequisiteGaps } = await import('@/lib/learner-twin/metrics/prerequisite-gaps');
    const result = await readPrerequisiteGaps(STUDENT_ID, TARGET_ID);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.gaps[0].gap).toBe(true);
      expect(result.value.gaps[0].prerequisiteMasteryScore).toBeNull();
      expect(result.value.gaps[0].prerequisiteMasteryState).toBeNull();
    }
  });

  it('weak prerequisite (LEARNING state, real evidence exists) -> gap:true, using the certified state classification, not an invented numeric cutoff', async () => {
    const query = buildQueryMock(
      [{ id: 'r1', source_concept_id: 'prereq-1', target_concept_id: TARGET_ID, relationship_type: 'PREREQUISITE_OF', confidence: 0.85, source: 'CURRICULUM', status: 'active' }],
      [{ id: 'prereq-1', label: 'Prereq One' }],
      [{ concept_id: 'prereq-1', mastery_score: '35.00' }],
      [{ concept_id: 'prereq-1', mastery_state: 'LEARNING' }]
    );
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readPrerequisiteGaps } = await import('@/lib/learner-twin/metrics/prerequisite-gaps');
    const result = await readPrerequisiteGaps(STUDENT_ID, TARGET_ID);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.gaps[0].gap).toBe(true);
      expect(result.value.gaps[0].prerequisiteMasteryScore).toBe(35);
    }
  });

  it('low relationship confidence is exposed raw, never used to compute an invented severity score', async () => {
    const query = buildQueryMock(
      [{ id: 'r1', source_concept_id: 'prereq-1', target_concept_id: TARGET_ID, relationship_type: 'PREREQUISITE_OF', confidence: 0.3, source: 'AI_INFERRED', status: 'active' }],
      [{ id: 'prereq-1', label: 'Prereq One' }],
      [{ concept_id: 'prereq-1', mastery_score: '90.00' }],
      [{ concept_id: 'prereq-1', mastery_state: 'VALIDATED_MASTERY' }]
    );
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readPrerequisiteGaps } = await import('@/lib/learner-twin/metrics/prerequisite-gaps');
    const result = await readPrerequisiteGaps(STUDENT_ID, TARGET_ID);
    expect(result.available).toBe(true);
    if (result.available) {
      // The raw confidence is exposed exactly as stored -- no blockingSeverity = confidence * (100-mastery) or similar is computed anywhere.
      expect(result.value.gaps[0].relationshipConfidence).toBe(0.3);
      expect(result.value.gaps[0]).not.toHaveProperty('blockingSeverity');
    }
  });

  it('multiple prerequisites -> gapCount only counts the ones actually classified as a gap', async () => {
    const query = buildQueryMock(
      [
        { id: 'r1', source_concept_id: 'prereq-1', target_concept_id: TARGET_ID, relationship_type: 'PREREQUISITE_OF', confidence: 0.9, source: 'CURRICULUM', status: 'active' },
        { id: 'r2', source_concept_id: 'prereq-2', target_concept_id: TARGET_ID, relationship_type: 'PREREQUISITE_OF', confidence: 0.7, source: 'CURRICULUM', status: 'active' },
      ],
      [
        { id: 'prereq-1', label: 'Prereq One' },
        { id: 'prereq-2', label: 'Prereq Two' },
      ],
      [{ concept_id: 'prereq-1', mastery_score: '90.00' }],
      [
        { concept_id: 'prereq-1', mastery_state: 'VALIDATED_MASTERY' },
        { concept_id: 'prereq-2', mastery_state: 'DEVELOPING' },
      ]
    );
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readPrerequisiteGaps } = await import('@/lib/learner-twin/metrics/prerequisite-gaps');
    const result = await readPrerequisiteGaps(STUDENT_ID, TARGET_ID);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.totalPrerequisiteCount).toBe(2);
      expect(result.value.gapCount).toBe(1);
    }
  });
});
