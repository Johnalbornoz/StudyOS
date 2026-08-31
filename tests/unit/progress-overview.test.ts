import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real service composition (mastery.service.ts, knowledge-state.service.ts,
// misconception.service.ts all run for real) with only the DB layer
// mocked -- same style as adaptive-learning-orchestrator-integration.test.ts,
// so this proves the real wiring, not an idealized mock of it.
const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { getStudentProgressOverview } from '@/services/progress-overview.service';

const STUDENT = 'student-1';
const SUBJECT = 'subject-1';
const CONCEPT_A = 'concept-a'; // has knowledge state + mastery
const CONCEPT_B = 'concept-b'; // mastery only, no knowledge state row yet (UNKNOWN)

function defaultImpl(sql: string) {
  if (/SELECT id, name FROM subjects/i.test(sql)) {
    return { rows: [{ id: SUBJECT, name: 'Matemáticas E2E' }] };
  }
  if (/FROM mastery_policies/i.test(sql)) {
    return {
      rows: [
        {
          version: 1,
          minimum_understanding: 80,
          minimum_independence: 80,
          minimum_application: 75,
          minimum_retention: 75,
          minimum_transfer: 70,
          requires_transfer: true,
          maximum_critical_misconceptions: 0,
          minimum_evidence_count: 3,
          minimum_independent_evidence_count: 2,
          retention_min_gap_days: 3,
          validation_window_days: 14,
        },
      ],
    };
  }
  if (/FROM student_misconceptions/i.test(sql)) {
    return {
      rows: [
        {
          misconception_signature_id: 'sig-1',
          occurrence_count: 2,
          last_seen: new Date().toISOString(),
          concept_id: CONCEPT_A,
          misconception_code: 'INCOMPLETE',
          description: 'Incompleto',
          concept_label: 'Ecuaciones lineales de una variable',
          subject_id: SUBJECT,
          subject_name: 'Matemáticas E2E',
        },
      ],
    };
  }
  if (/FROM mastery_records mr/i.test(sql)) {
    return {
      rows: [
        {
          concept_id: CONCEPT_A,
          canonical_id: 'linear-equations',
          label: 'Ecuaciones lineales de una variable',
          // Real live-DB values from the forensic audit -- mastery_score
          // is already 0-100 (percentage points), not a 0.0-1.0 fraction.
          mastery_score: '1.65',
          confidence_score: 60,
          attempt_count: 8,
          last_practiced: new Date().toISOString(),
          learning_debt_severity: null,
          learning_debt_status: null,
        },
        {
          concept_id: CONCEPT_B,
          canonical_id: 'factoring',
          label: 'Factoring',
          mastery_score: '5.30',
          confidence_score: 20,
          attempt_count: 6,
          last_practiced: new Date().toISOString(),
          learning_debt_severity: 3,
          learning_debt_status: 'active',
        },
      ],
    };
  }
  if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/i.test(sql)) {
    return {
      rows: [
        {
          student_id: STUDENT,
          concept_id: CONCEPT_A,
          subject_id: SUBJECT,
          mastery_state: 'PROVISIONAL_MASTERY',
          understanding_score: 70,
          independence_score: 50,
          application_score: null,
          retention_score: 100,
          transfer_score: null, // no transfer evidence yet -- must stay "not evaluated", never 0%
          active_misconception_count: 0,
          critical_misconception_count: 0,
          recurring_misconception_count: 1,
          evidence_count: 8,
          independent_evidence_count: 6,
          first_evidence_at: new Date().toISOString(),
          last_evidence_at: new Date().toISOString(),
          validation_readiness: 'TRANSFER_REQUIRED',
          state_reason: null,
          projection_version: 1,
          mastery_policy_version: 1,
          updated_at: new Date().toISOString(),
        },
        // CONCEPT_B intentionally has no row here -- getSubjectKnowledgeState
        // only returns what's been projected, so it must fall back to UNKNOWN.
      ],
    };
  }
  if (/FROM learning_debt ld\s+JOIN concepts c/i.test(sql)) {
    return {
      rows: [
        {
          concept_id: CONCEPT_B,
          subject_id: SUBJECT,
          severity: 3,
          label: 'Factoring',
        },
      ],
    };
  }
  return { rows: [] };
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => defaultImpl(sql));
});

describe('getStudentProgressOverview -- mastery scale (mastery_records.mastery_score is already 0-100, per the forensic audit)', () => {
  it('rounds 1.65 to 2%, NOT 165% and NOT 1%', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const conceptA = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_A);
    expect(conceptA?.masteryPercent).toBe(2);
  });

  it('rounds 5.30 to 5%, NOT 530%', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const conceptB = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_B);
    expect(conceptB?.masteryPercent).toBe(5);
  });

  it('averages the RAW scores (1.65 + 5.30) / 2 = 3.475, rounding once to 3% -- not round(2)+round(5) averaged to 4%', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.subjects[0].avgMasteryPercent).toBe(3);
    expect(overview.overallMasteryPercent).toBe(3);
  });
});

describe('getStudentProgressOverview -- valid low mastery scores are never hidden as unknown, and never exceed 100%', () => {
  const CONCEPT_X = 'concept-x';
  const CONCEPT_Y = 'concept-y';
  const CONCEPT_Z = 'concept-z';

  function threeConceptImpl(sql: string) {
    if (/SELECT id, name FROM subjects/i.test(sql)) {
      return { rows: [{ id: SUBJECT, name: 'Matemáticas E2E' }] };
    }
    if (/FROM mastery_policies/i.test(sql)) {
      return defaultImpl('FROM mastery_policies');
    }
    if (/FROM mastery_records mr/i.test(sql)) {
      return {
        rows: [
          { concept_id: CONCEPT_X, canonical_id: 'x', label: 'X', mastery_score: '20', confidence_score: 50, attempt_count: 3, last_practiced: new Date().toISOString(), learning_debt_severity: null, learning_debt_status: null },
          { concept_id: CONCEPT_Y, canonical_id: 'y', label: 'Y', mastery_score: '70', confidence_score: 50, attempt_count: 3, last_practiced: new Date().toISOString(), learning_debt_severity: null, learning_debt_status: null },
          { concept_id: CONCEPT_Z, canonical_id: 'z', label: 'Z', mastery_score: '100', confidence_score: 50, attempt_count: 3, last_practiced: new Date().toISOString(), learning_debt_severity: null, learning_debt_status: null },
        ],
      };
    }
    return { rows: [] };
  }

  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => threeConceptImpl(sql));
  });

  it('overall mastery averages 20/70/100 to 63%, staying inside 0-100', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.overallMasteryPercent).toBe(63);
    expect(overview.overallMasteryPercent!).toBeLessThanOrEqual(100);
    expect(overview.overallMasteryPercent!).toBeGreaterThanOrEqual(0);
  });

  it('subject mastery average also stays within 0-100%', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.subjects[0].avgMasteryPercent).toBe(63);
    expect(overview.subjects[0].avgMasteryPercent!).toBeLessThanOrEqual(100);
  });

  it('a small but valid mastery score (e.g. 1.65, 5.30 -- not just round numbers) is displayed, never hidden as unknown', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM mastery_records mr/i.test(sql)) {
        return {
          rows: [
            { concept_id: CONCEPT_X, canonical_id: 'x', label: 'X', mastery_score: '1.65', confidence_score: 50, attempt_count: 1, last_practiced: new Date().toISOString(), learning_debt_severity: null, learning_debt_status: null },
          ],
        };
      }
      return threeConceptImpl(sql);
    });
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const concept = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_X);
    expect(concept?.masteryPercent).not.toBeNull();
    expect(concept?.masteryPercent).toBe(2);
  });

  it('a genuinely out-of-range mastery_score (e.g. 150, outside [0,100]) is dropped as unknown, never displayed as a nonsense percentage', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM mastery_records mr/i.test(sql)) {
        return {
          rows: [
            { concept_id: CONCEPT_X, canonical_id: 'x', label: 'X', mastery_score: '150', confidence_score: 50, attempt_count: 3, last_practiced: new Date().toISOString(), learning_debt_severity: null, learning_debt_status: null },
          ],
        };
      }
      return threeConceptImpl(sql);
    });
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const concept = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_X);
    expect(concept?.masteryPercent).toBeNull();
  });
});

describe('getStudentProgressOverview -- capability dimensions never substitute for each other, unknown != 0%', () => {
  it('understanding/independence/retention use their own Knowledge State column, not mastery or each other', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const conceptA = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_A)!;
    expect(conceptA.dimensions.understandingScore).toBe(70);
    expect(conceptA.dimensions.independenceScore).toBe(50);
    expect(conceptA.dimensions.retentionScore).toBe(100);
    // None of these equal masteryPercent (2) or each other -- confirms no substitution.
    expect(conceptA.dimensions.understandingScore).not.toBe(conceptA.masteryPercent);
  });

  it('a dimension with no evidence (transfer, here) is null -- never coerced to 0', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const conceptA = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_A)!;
    expect(conceptA.dimensions.transferScore).toBeNull();
  });

  it('a concept with no projected Knowledge State row falls back to masteryState UNKNOWN and all-null dimensions, not zeros', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const conceptB = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_B)!;
    expect(conceptB.masteryState).toBe('UNKNOWN');
    expect(conceptB.dimensions.understandingScore).toBeNull();
    expect(conceptB.dimensions.retentionScore).toBeNull();
  });

  it('aggregate capability averages only include concepts that actually have that dimension', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    // Only CONCEPT_A has a non-null understandingScore (70) -- CONCEPT_B's
    // null must not drag the average toward 0.
    expect(overview.capabilities.understandingScore).toBe(70);
    expect(overview.capabilities.transferScore).toBeNull();
  });
});

describe('getStudentProgressOverview -- achievements are evidence-gated, not invented', () => {
  it('counts a concept as validated-mastery achievement only via the real masteryState, not a new score', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    // CONCEPT_A is PROVISIONAL_MASTERY, not VALIDATED_MASTERY -- must not count.
    expect(overview.achievements.validatedMasteryCount).toBe(0);
  });

  it('counts retention/independence achievements only when the score meets the real policy threshold', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    // retentionScore 100 >= policy.minimumRetention (75) -> counts.
    expect(overview.achievements.retentionDemonstratedCount).toBe(1);
    // independenceScore 50 < policy.minimumIndependence (80) -> does not count.
    expect(overview.achievements.independentEvidenceCount).toBe(0);
  });
});

describe('getStudentProgressOverview -- needs attention', () => {
  it('surfaces a human-readable misconception description with its occurrence count, not a raw signal enum', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    const conceptA = overview.subjects[0].concepts.find((c) => c.conceptId === CONCEPT_A)!;
    expect(conceptA.needsAttention).toEqual([{ description: 'Incompleto', occurrenceCount: 2 }]);
  });

  it('surfaces active learning debt as a needs-attention item with the concept label', async () => {
    const overview = await getStudentProgressOverview(STUDENT, 'es');
    expect(overview.needsAttention).toEqual([
      { conceptId: CONCEPT_B, conceptLabel: 'Factoring', subjectId: SUBJECT, severity: 3 },
    ]);
  });
});
