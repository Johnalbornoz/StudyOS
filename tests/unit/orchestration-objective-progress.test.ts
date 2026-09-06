/**
 * Phase 8 -- Step 8H1: the 14-day orchestration objective-progress KPI.
 * Transparent + fully derived: achieved is read from canonical Phase
 * 3/6/7 state, never from "the item was scheduled".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrationObjectiveType } from '@/lib/learning-plan-presentation';
import { readOrchestrationObjectiveProgress } from '@/lib/learner-twin/metrics/orchestration-objective-progress';

const STU = 's-1';
const PLAN = { horizon_start: '2026-09-06', horizon_end: '2026-09-19' };

function fakeDb(opts: {
  items: Array<{ concept_id: string; reason_code: string; scheduled_date: string; provenance?: any }>;
  mastery?: Record<string, string>;
  retention?: Record<string, string | null>;
  transfer?: Record<string, { transfer_depth: string; last_successful_transfer_at: string | null }>;
  plan?: any;
}) {
  return {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/FROM learning_plan WHERE student_id = \$1 AND status = 'ACTIVE'/.test(s)) {
        return { rows: opts.plan === null ? [] : [opts.plan ?? PLAN] };
      }
      if (/FROM learning_plan_item lpi JOIN learning_plan lp/.test(s)) return { rows: opts.items };
      if (/FROM concept_knowledge_state WHERE student_id/.test(s)) {
        return { rows: Object.entries(opts.mastery ?? {}).map(([concept_id, mastery_state]) => ({ concept_id, mastery_state })) };
      }
      if (/FROM concept_memory_state WHERE student_id/.test(s)) {
        return { rows: Object.entries(opts.retention ?? {}).map(([concept_id, last_successful_retention_at]) => ({ concept_id, last_successful_retention_at })) };
      }
      if (/FROM concept_transfer_state WHERE student_id/.test(s)) {
        return { rows: Object.entries(opts.transfer ?? {}).map(([concept_id, v]) => ({ concept_id, ...v })) };
      }
      throw new Error(`Unmocked: ${s}`);
    }),
  } as any;
}

describe('8H1 -- orchestrationObjectiveType (pure)', () => {
  it('maps only the four outcome classes; blocker / curriculum / learner-requested -> null', () => {
    expect(orchestrationObjectiveType('VERIFICATION_READY')).toBe('VALIDATED_MASTERY');
    expect(orchestrationObjectiveType('RETENTION_DUE')).toBe('QUALIFIED_RETENTION');
    expect(orchestrationObjectiveType('TRANSFER_PROGRESSION')).toBe('TRANSFER_DEPTH_ADVANCE');
    expect(orchestrationObjectiveType('ASSESSMENT_APPROACHING')).toBe('ASSESSMENT_READINESS');
    for (const rc of ['MISCONCEPTION_BLOCK', 'PREREQUISITE_FIRST', 'REMEDIATION_REQUIRED', 'LEARNING_DEBT', 'CURRICULUM_PROGRESSION', 'LEARNER_REQUESTED'] as const) {
      expect(orchestrationObjectiveType(rc)).toBeNull();
    }
  });
});

describe('8H1 -- readOrchestrationObjectiveProgress', () => {
  it('NOT_APPLICABLE when there is no ACTIVE plan', async () => {
    const r = await readOrchestrationObjectiveProgress(STU, {}, fakeDb({ items: [], plan: null }));
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe('NOT_APPLICABLE');
  });

  it('INSUFFICIENT_EVIDENCE when no item maps to a tracked objective', async () => {
    const r = await readOrchestrationObjectiveProgress(STU, {}, fakeDb({
      items: [
        { concept_id: 'c1', reason_code: 'CURRICULUM_PROGRESSION', scheduled_date: '2026-09-07' },
        { concept_id: 'c2', reason_code: 'REMEDIATION_REQUIRED', scheduled_date: '2026-09-07' },
      ],
    }));
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('achieved is read from canonical state -- scheduling alone is never "achieved"', async () => {
    const r = await readOrchestrationObjectiveProgress(STU, {}, fakeDb({
      items: [
        { concept_id: 'v1', reason_code: 'VERIFICATION_READY', scheduled_date: '2026-09-07' }, // mastery not validated
        { concept_id: 'v2', reason_code: 'VERIFICATION_READY', scheduled_date: '2026-09-07' }, // validated
        { concept_id: 'r1', reason_code: 'RETENTION_DUE', scheduled_date: '2026-09-08' }, // retention proven after
        { concept_id: 'r2', reason_code: 'RETENTION_DUE', scheduled_date: '2026-09-08' }, // retention only before
        { concept_id: 't1', reason_code: 'TRANSFER_PROGRESSION', scheduled_date: '2026-09-09', provenance: { facts: { transferDepth: 'NEAR_DEMONSTRATED' } } }, // advanced
        { concept_id: 'a1', reason_code: 'ASSESSMENT_APPROACHING', scheduled_date: '2026-09-10' }, // provisional -> ready
      ],
      mastery: { v2: 'VALIDATED_MASTERY', v1: 'LEARNING', a1: 'PROVISIONAL_MASTERY' },
      retention: { r1: '2026-09-09T00:00:00Z', r2: '2026-09-01T00:00:00Z' },
      transfer: { t1: { transfer_depth: 'GENERALIZED', last_successful_transfer_at: null } },
    }));
    expect(r.available).toBe(true);
    if (r.available) {
      expect(r.value.tracked).toBe(6);
      expect(r.value.achieved).toBe(4); // v2, r1, t1, a1
      expect(r.value.byType.VALIDATED_MASTERY).toEqual({ tracked: 2, achieved: 1 });
      expect(r.value.byType.QUALIFIED_RETENTION).toEqual({ tracked: 2, achieved: 1 });
      expect(r.value.byType.TRANSFER_DEPTH_ADVANCE).toEqual({ tracked: 1, achieved: 1 });
      expect(r.value.byType.ASSESSMENT_READINESS).toEqual({ tracked: 1, achieved: 1 });
      expect(r.value.achievedRate).toBeCloseTo(0.67, 2);
      expect(r.value.method).toMatch(/Scheduling an item never counts/);
      expect(r.value.quality.sourceType).toBe('DETERMINISTIC_DERIVATION');
    }
  });

  it('TRANSFER_DEPTH_ADVANCE is not "achieved" when depth did not move past plan time', async () => {
    const r = await readOrchestrationObjectiveProgress(STU, {}, fakeDb({
      items: [{ concept_id: 't1', reason_code: 'TRANSFER_PROGRESSION', scheduled_date: '2026-09-09', provenance: { facts: { transferDepth: 'GENERALIZED' } } }],
      transfer: { t1: { transfer_depth: 'GENERALIZED', last_successful_transfer_at: null } },
    }));
    expect(r.available).toBe(true);
    if (r.available) expect(r.value.achieved).toBe(0);
  });
});
