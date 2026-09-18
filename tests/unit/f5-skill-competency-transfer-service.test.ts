/**
 * F5 -- Skill State / Competency State / Transfer analytics projectors.
 * Covers task 28 adversarial items A/B/C/D/E: knowledge-only evidence
 * never fabricates skill state, explicit skill evidence produces real
 * state, a shared skill across concepts is attributable without
 * duplication, a competency is never inferred from skill evidence alone,
 * and assisted-only evidence never reads as independent.
 *
 * updateMastery's own query sequence is verified separately
 * (f5-mastery-wiring.test.ts) -- these tests exercise the projectors
 * directly against a mocked @/lib/db, matching the F3/F4 test style.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { query: (...args: any[]) => queryMock(...args), connect: async () => ({ query: (...a: any[]) => queryMock(...a), release: () => {} }) },
}));
vi.mock('@/lib/audit', () => ({ recordDecisionEvent: vi.fn().mockResolvedValue(undefined) }));

import { projectSkillState, getSkillState } from '@/lib/learner-state/skill-state.service';
import { projectCompetencyState } from '@/lib/learner-state/competency-state.service';
import { projectTransferAnalytics } from '@/lib/learner-state/transfer-analytics.service';

const SKILL_POLICY = { id: 'policy-skill-1', dimension: 'SKILL', version: 1, rules: { minimumEvidenceCount: 3 }, status: 'ACTIVE' };
const COMPETENCY_POLICY = { id: 'policy-comp-1', dimension: 'COMPETENCY', version: 1, rules: { minimumEvidenceCount: 3 }, status: 'ACTIVE' };
const TRANSFER_POLICY = { id: 'policy-transfer-1', dimension: 'TRANSFER_ANALYTICS', version: 1, rules: {}, status: 'ACTIVE' };

beforeEach(() => {
  queryMock.mockReset();
});

describe('projectSkillState -- task 28-B (explicit skill evidence produces real state)', () => {
  it('with 3 independent+correct qualifying rows, produces CONSISTENT_INDEPENDENT', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [SKILL_POLICY] }) // getActivePolicy
      .mockResolvedValueOnce({
        rows: [
          { id: 'e3', result: 'correct', ai_assistance_type: 'NONE', timestamp: '2026-01-03T00:00:00Z' },
          { id: 'e2', result: 'correct', ai_assistance_type: 'NONE', timestamp: '2026-01-02T00:00:00Z' },
          { id: 'e1', result: 'correct', ai_assistance_type: 'NONE', timestamp: '2026-01-01T00:00:00Z' },
        ],
      }) // fetchQualifyingEvidence
      .mockResolvedValueOnce({ rows: [] }) // previous state (none yet)
      .mockResolvedValueOnce({
        rows: [{ student_id: 'student-1', skill_id: 'skill-1', state: 'CONSISTENT_INDEPENDENT', evidence_count: 3, independent_evidence_count: 3, last_evidence_at: '2026-01-03T00:00:00Z', policy_version_id: 'policy-skill-1' }],
      }); // upsert

    const result = await projectSkillState('student-1', 'skill-1');
    expect(result.state).toBe('CONSISTENT_INDEPENDENT');
    expect(result.evidenceCount).toBe(3);
    // the query must select on the skillIds metadata containment, never on the concept->skill graph
    expect(queryMock.mock.calls[1][0]).toMatch(/metadata -> 'skillIds' @> to_jsonb/);
  });
});

describe('projectSkillState -- task 28-A (concept-level knowledge evidence never fabricates skill state)', () => {
  it('zero rows tagged with this skillId -> NO_EVIDENCE, never inferred from the concept', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [SKILL_POLICY] })
      .mockResolvedValueOnce({ rows: [] }) // no evidence tagged with this skill
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ student_id: 'student-1', skill_id: 'skill-2', state: 'NO_EVIDENCE', evidence_count: 0, independent_evidence_count: 0, last_evidence_at: null, policy_version_id: 'policy-skill-1' }] });

    const result = await projectSkillState('student-1', 'skill-2');
    expect(result.state).toBe('NO_EVIDENCE');
  });
});

describe('projectSkillState -- task 28-E (assisted-only evidence is not equivalent to independent)', () => {
  it('3 assisted rows meets the count but never reaches CONSISTENT_INDEPENDENT', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [SKILL_POLICY] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'e3', result: 'correct', ai_assistance_type: 'HINT', timestamp: '2026-01-03T00:00:00Z' },
          { id: 'e2', result: 'correct', ai_assistance_type: 'HINT', timestamp: '2026-01-02T00:00:00Z' },
          { id: 'e1', result: 'correct', ai_assistance_type: 'HINT', timestamp: '2026-01-01T00:00:00Z' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ student_id: 'student-1', skill_id: 'skill-3', state: 'EMERGING', evidence_count: 3, independent_evidence_count: 0, last_evidence_at: '2026-01-03T00:00:00Z', policy_version_id: 'policy-skill-1' }] });

    const result = await projectSkillState('student-1', 'skill-3');
    expect(result.state).toBe('EMERGING');
    expect(result.independentEvidenceCount).toBe(0);
  });
});

describe('projectCompetencyState -- task 28-D (never inferred from skill evidence alone)', () => {
  it('the competency query filters on metadata.competencyIds, never joins through skill_competencies', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [COMPETENCY_POLICY] })
      .mockResolvedValueOnce({ rows: [] }) // zero rows explicitly tagged with this competency
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ student_id: 'student-1', competency_id: 'competency-1', state: 'NO_EVIDENCE', evidence_count: 0, independent_evidence_count: 0, last_evidence_at: null, policy_version_id: 'policy-comp-1' }] });

    const result = await projectCompetencyState('student-1', 'competency-1');
    expect(result.state).toBe('NO_EVIDENCE');
    expect(queryMock.mock.calls[1][0]).toMatch(/metadata -> 'competencyIds' @> to_jsonb/);
    expect(queryMock.mock.calls[1][0]).not.toMatch(/skill_competencies|canonical_concept_skills/);
  });
});

describe('projectTransferAnalytics -- task 28-H (context diversity) and 28-J/K (canonical mapping)', () => {
  it('counts by contextCode and reports distinct context count', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [TRANSFER_POLICY] })
      .mockResolvedValueOnce({ rows: [{ context_code: 'FAMILIAR' }, { context_code: 'UNFAMILIAR' }, { context_code: 'FAMILIAR' }] })
      .mockResolvedValueOnce({ rows: [] }) // no MATCHED mapping
      .mockResolvedValueOnce({
        rows: [{ student_id: 's1', concept_id: 'c1', canonical_concept_id: null, context_familiar_count: 2, context_altered_count: 0, context_real_world_count: 0, context_unfamiliar_count: 1, context_cross_domain_count: 0, distinct_context_count: 2, policy_version_id: 'policy-transfer-1' }],
      });

    const result = await projectTransferAnalytics('s1', 'c1');
    expect(result.contextFamiliarCount).toBe(2);
    expect(result.contextUnfamiliarCount).toBe(1);
    expect(result.distinctContextCount).toBe(2);
    expect(result.canonicalConceptId).toBeNull();
  });

  it('never guesses a canonical concept id for an AMBIGUOUS/UNRESOLVED mapping (AC-F5-17/18)', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [TRANSFER_POLICY] })
      .mockResolvedValueOnce({ rows: [{ context_code: 'REAL_WORLD' }] })
      .mockResolvedValueOnce({ rows: [{ canonical_concept_id: 'canonical-x', status: 'AMBIGUOUS' }] }) // AMBIGUOUS -- must not be used
      .mockResolvedValueOnce({
        rows: [{ student_id: 's1', concept_id: 'c2', canonical_concept_id: null, context_familiar_count: 0, context_altered_count: 0, context_real_world_count: 1, context_unfamiliar_count: 0, context_cross_domain_count: 0, distinct_context_count: 1, policy_version_id: 'policy-transfer-1' }],
      });

    const result = await projectTransferAnalytics('s1', 'c2');
    expect(result.canonicalConceptId).toBeNull();
    // the UPDATE/INSERT must have been called with NULL, not 'canonical-x'
    const upsertCall = queryMock.mock.calls[3];
    expect(upsertCall[1]).toContain(null);
    expect(upsertCall[1]).not.toContain('canonical-x');
  });

  it('uses the canonical concept id only when the mapping is MATCHED', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [TRANSFER_POLICY] })
      .mockResolvedValueOnce({ rows: [{ context_code: 'CROSS_DOMAIN' }] })
      .mockResolvedValueOnce({ rows: [{ canonical_concept_id: 'canonical-y', status: 'MATCHED' }] })
      .mockResolvedValueOnce({
        rows: [{ student_id: 's1', concept_id: 'c3', canonical_concept_id: 'canonical-y', context_familiar_count: 0, context_altered_count: 0, context_real_world_count: 0, context_unfamiliar_count: 0, context_cross_domain_count: 1, distinct_context_count: 1, policy_version_id: 'policy-transfer-1' }],
      });

    const result = await projectTransferAnalytics('s1', 'c3');
    expect(result.canonicalConceptId).toBe('canonical-y');
  });
});

describe('getSkillState', () => {
  it('returns null when no row exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const result = await getSkillState('student-1', 'skill-unknown');
    expect(result).toBeNull();
  });
});
