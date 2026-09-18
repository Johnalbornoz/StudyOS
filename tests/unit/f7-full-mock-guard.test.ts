/**
 * F7 / task 34 -- CAN_FULL_MOCK_BE_OFFERED? never a silent partial mock
 * presented as a full one; every missing piece is named explicitly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('canFullMockBeOffered', () => {
  it('NO with NO_SCORING_MODEL_CONFIGURED and NO_PUBLISHED_BLUEPRINT when both are missing', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'v1', exam_definition_id: 'def-1', version_label: '2024', scoring_model_id: null, status: 'DRAFT' }] }) // getExamVersion
      .mockResolvedValueOnce({ rows: [] }); // getBlueprintForVersion -- none exists
    const result = await canFullMockBeOffered('v1');
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('NO_SCORING_MODEL_CONFIGURED');
    expect(result.reasons).toContain('NO_PUBLISHED_BLUEPRINT');
  });

  it('NO with a named UNSUPPORTED_COMPONENT reason when a component lacks support', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'v1', scoring_model_id: 'sm-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'bp-1', exam_version_id: 'v1', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'target-1', blueprint_id: 'bp-1', learning_objective_id: 'obj-1', assessment_component_id: 'comp-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'comp-1', name: 'Mathematics Section', support_status: 'UNSUPPORTED', timing_status: 'CONFIGURED', tool_rule_status: 'CONFIGURED' }] })
      .mockResolvedValueOnce({ rows: [{ has_concept: true, has_skill: false }] });
    const result = await canFullMockBeOffered('v1');
    expect(result.ready).toBe(false);
    expect(result.reasons.some((r) => r.includes('UNSUPPORTED_COMPONENT'))).toBe(true);
    expect(result.miniMockObjectiveIds).toEqual([]); // component not OK -- never included
  });

  it('YES with zero reasons when everything is configured and mapped', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'v1', scoring_model_id: 'sm-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'bp-1', exam_version_id: 'v1', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'target-1', blueprint_id: 'bp-1', learning_objective_id: 'obj-1', assessment_component_id: 'comp-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'comp-1', name: 'Mathematics Section', support_status: 'SUPPORTED', timing_status: 'CONFIGURED', tool_rule_status: 'CONFIGURED' }] })
      .mockResolvedValueOnce({ rows: [{ has_concept: true, has_skill: false }] });
    const result = await canFullMockBeOffered('v1');
    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.miniMockObjectiveIds).toEqual(['obj-1']);
  });

  it('an unmapped objective produces OBJECTIVE_NOT_MAPPED even when its component is otherwise fine', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'v1', scoring_model_id: 'sm-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'bp-1', exam_version_id: 'v1', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'target-1', blueprint_id: 'bp-1', learning_objective_id: 'obj-unmapped', assessment_component_id: 'comp-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'comp-1', name: 'Mathematics Section', support_status: 'SUPPORTED', timing_status: 'CONFIGURED', tool_rule_status: 'CONFIGURED' }] })
      .mockResolvedValueOnce({ rows: [{ has_concept: false, has_skill: false }] });
    const result = await canFullMockBeOffered('v1');
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('OBJECTIVE_NOT_MAPPED: obj-unmapped');
  });
});
