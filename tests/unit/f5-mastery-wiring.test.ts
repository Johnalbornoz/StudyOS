/**
 * F5 -- proves updateMastery's wiring to the new Skill/Competency/
 * Transfer-analytics projectors: (1) silent for every existing caller
 * that never sets metadata.skillIds/competencyIds/contextCode -- the
 * exact regression-safety property the full pre-existing suite already
 * confirms empirically by continuing to pass unmodified; (2) activates
 * only when those fields are explicitly present; (3) a projector failure
 * never aborts the surrounding transaction (task 26).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn(async (...queryArgs: any[]) => {
  const sql = (queryArgs[0] as string).replace(/\s+/g, ' ').trim();
  const params = queryArgs[1] as any[] | undefined;

  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO mastery_records/i.test(sql)) return { rows: [] };
  if (/FROM mastery_records/i.test(sql) && /SELECT/i.test(sql)) {
    return { rows: [{ id: 'mr-1', mastery_score: 50, confidence_score: 0.5, attempt_count: 2, correct_count: 1, incorrect_count: 1, last_practiced: null }] };
  }
  if (/SELECT result[\s\S]*FROM learning_evidence/i.test(sql) && !/metadata/i.test(sql)) return { rows: [] };
  if (/UPDATE mastery_records/i.test(sql)) return { rows: [{ id: 'mr-1' }] };
  if (/INSERT INTO mastery_events/i.test(sql)) return { rows: [{ id: 'ev-1' }] };
  if (/INSERT INTO learning_evidence/i.test(sql)) return { rows: [{ id: 'evidence-1' }] };
  if (/INSERT INTO learning_debt/i.test(sql)) return { rows: [] };

  // F5 tables:
  if (/FROM aggregation_policy_versions/i.test(sql)) {
    if (params?.[0] === 'SKILL' && (globalThis as any).__f5_skill_policy_throws) throw new Error('simulated policy lookup failure');
    const dimension = params?.[0];
    return { rows: [{ id: `policy-${dimension}`, dimension, version: 1, rules: { minimumEvidenceCount: 3 }, status: 'ACTIVE' }] };
  }
  if (/metadata -> 'skillIds' @> to_jsonb/i.test(sql)) return { rows: [] };
  if (/metadata -> 'competencyIds' @> to_jsonb/i.test(sql)) return { rows: [] };
  if (/SELECT state FROM learner_skill_state/i.test(sql)) return { rows: [] };
  if (/SELECT state FROM learner_competency_state/i.test(sql)) return { rows: [] };
  if (/INSERT INTO learner_skill_state/i.test(sql)) {
    return { rows: [{ student_id: params?.[0], skill_id: params?.[1], state: params?.[2], evidence_count: params?.[3], independent_evidence_count: params?.[4], last_evidence_at: params?.[5], policy_version_id: params?.[6] }] };
  }
  if (/INSERT INTO learner_competency_state/i.test(sql)) {
    return { rows: [{ student_id: params?.[0], competency_id: params?.[1], state: params?.[2], evidence_count: params?.[3], independent_evidence_count: params?.[4], last_evidence_at: params?.[5], policy_version_id: params?.[6] }] };
  }
  if (/metadata ->> 'contextCode'/i.test(sql) && /FROM learning_evidence/i.test(sql)) return { rows: [] };
  if (/FROM concept_catalog_mapping/i.test(sql)) return { rows: [] };
  if (/INSERT INTO learner_transfer_analytics/i.test(sql)) {
    return { rows: [{ student_id: params?.[0], concept_id: params?.[1], canonical_concept_id: params?.[2], context_familiar_count: 0, context_altered_count: 0, context_real_world_count: 0, context_unfamiliar_count: 0, context_cross_domain_count: 0, distinct_context_count: 0, policy_version_id: params?.[9] }] };
  }

  throw new Error(`unexpected query in test: ${sql.slice(0, 160)}`);
});

vi.mock('@/lib/db', () => ({
  db: { query: (...args: any[]) => queryMock(...args), connect: async () => ({ query: (...args: any[]) => queryMock(...args), release: () => {} }) },
}));
vi.mock('@/services/knowledge-state.service', () => ({
  recalculateConceptKnowledgeState: vi.fn().mockResolvedValue(null),
  getActiveMasteryPolicy: vi.fn().mockResolvedValue({
    version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75,
    minimumRetention: 75, minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0,
    minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2, retentionMinGapDays: 3, validationWindowDays: 14,
  }),
}));
vi.mock('@/services/memory-projector.service', () => ({
  projectConceptMemoryState: vi.fn().mockResolvedValue({ state: {}, stateChanged: false, diagnostics: {} }),
}));

import { updateMastery } from '@/services/mastery.service';

beforeEach(() => {
  queryMock.mockClear();
  (globalThis as any).__f5_skill_policy_throws = false;
});

const BASE_INPUT = {
  studentId: 's1',
  conceptId: 'c1',
  subjectId: 'subj1',
  evidence: { result: 'correct' as const, difficulty: 3, sourceType: 'PRACTICE_QUESTION', confidenceWeight: 0.4, scorePercent: 90 },
};

describe('updateMastery -- F5 wiring is silent for every existing caller (regression safety)', () => {
  it('with no metadata at all, touches none of the F5 tables', async () => {
    await updateMastery(BASE_INPUT);
    const f5Calls = queryMock.mock.calls.filter(([sql]) =>
      /aggregation_policy_versions|learner_skill_state|learner_competency_state|learner_transfer_analytics|concept_catalog_mapping/i.test(sql)
    );
    expect(f5Calls).toHaveLength(0);
  });

  it('with metadata that has nothing to do with skills/competencies/context, still touches none of the F5 tables', async () => {
    await updateMastery({ ...BASE_INPUT, metadata: { examConceptAttribution: { sourceGranularity: 'SUBJECT_WIDE' } } });
    const f5Calls = queryMock.mock.calls.filter(([sql]) =>
      /aggregation_policy_versions|learner_skill_state|learner_competency_state|learner_transfer_analytics/i.test(sql)
    );
    expect(f5Calls).toHaveLength(0);
  });
});

describe('updateMastery -- F5 wiring activates only when explicitly tagged (task 18/AC-F5-05)', () => {
  it('metadata.skillIds triggers a learner_skill_state projection for each id', async () => {
    await updateMastery({ ...BASE_INPUT, metadata: { skillIds: ['skill-1', 'skill-2'] } });
    const skillInserts = queryMock.mock.calls.filter(([sql]) => /INSERT INTO learner_skill_state/i.test(sql));
    expect(skillInserts).toHaveLength(2);
  });

  it('metadata.competencyIds triggers a learner_competency_state projection', async () => {
    await updateMastery({ ...BASE_INPUT, metadata: { competencyIds: ['competency-1'] } });
    const competencyInserts = queryMock.mock.calls.filter(([sql]) => /INSERT INTO learner_competency_state/i.test(sql));
    expect(competencyInserts).toHaveLength(1);
  });

  it('metadata.contextCode triggers a learner_transfer_analytics projection', async () => {
    await updateMastery({ ...BASE_INPUT, metadata: { contextCode: 'UNFAMILIAR' } });
    const transferInserts = queryMock.mock.calls.filter(([sql]) => /INSERT INTO learner_transfer_analytics/i.test(sql));
    expect(transferInserts).toHaveLength(1);
  });
});

describe('updateMastery -- a Skill State projection failure never aborts the transaction (task 26)', () => {
  it('evidence, mastery, and the overall call still succeed even when the Skill State policy lookup throws', async () => {
    (globalThis as any).__f5_skill_policy_throws = true;
    const result = await updateMastery({ ...BASE_INPUT, metadata: { skillIds: ['skill-1'] } });
    expect(result.newMastery).toBeDefined();
    const commitCalls = queryMock.mock.calls.filter(([sql]) => sql === 'COMMIT');
    expect(commitCalls).toHaveLength(1);
    const rollbackCalls = queryMock.mock.calls.filter(([sql]) => sql === 'ROLLBACK');
    expect(rollbackCalls).toHaveLength(0);
  });
});
