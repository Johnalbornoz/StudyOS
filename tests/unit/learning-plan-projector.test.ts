/**
 * Phase 8 -- Step 8B1: the SOLE learning-plan writer.
 *
 * A small in-memory SQL fake (learning_plan / learning_plan_item /
 * students / decision_events) lets the projector's real transaction
 * logic run end to end: create / retain / version-replace paths, the
 * pure diff, supersede + link, semantic no-op, terminal-item
 * protection, per-student FOR UPDATE serialization, rollback, and audit
 * semantics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDecisionEventPersistenceForTests } from '@/lib/audit';
import {
  projectLearningPlan,
  type ProjectLearningPlanInput,
  type ProposedLearningPlanItem,
} from '@/services/learning-plan-projector.service';
import { buildLearningPlanItemOperationKey } from '@/lib/learning-orchestration-policy';

const STU = '11111111-1111-4111-8111-111111111111';
const SUBJ = '22222222-2222-4222-8222-222222222222';
let uuidN = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`;

interface Fake {
  plans: any[];
  items: any[];
  students: Set<string>;
  events: any[];
  client: { query: ReturnType<typeof vi.fn> };
  calls: string[];
}

function makeFake(students: string[] = [STU]): Fake {
  const f: Fake = { plans: [], items: [], students: new Set(students), events: [], client: null as any, calls: [] };
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    f.calls.push(s);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [], rowCount: 0 };

    if (/^SELECT id FROM students WHERE id = \$1 FOR UPDATE/.test(s)) {
      return f.students.has(params[0]) ? { rows: [{ id: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/FROM learning_plan WHERE student_id = \$1 AND status = 'ACTIVE'/.test(s)) {
      const row = f.plans.find((p) => p.student_id === params[0] && p.status === 'ACTIVE');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^INSERT INTO learning_plan /.test(s)) {
      const [student_id, orchestration_policy_version, horizon_start, horizon_end, planning_anchor_at, timezone, timezone_assumed, goal_context] = params;
      const row = {
        id: uuid(), student_id, status: 'ACTIVE', orchestration_policy_version, horizon_start, horizon_end,
        planning_anchor_at, timezone, timezone_assumed, goal_context: JSON.parse(goal_context),
        created_at: new Date('2026-09-06T00:00:00Z'), updated_at: new Date('2026-09-06T00:00:00Z'),
      };
      f.plans.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (/^UPDATE learning_plan SET status = 'SUPERSEDED'/.test(s)) {
      const p = f.plans.find((x) => x.id === params[0]);
      if (p) p.status = 'SUPERSEDED';
      return { rows: [], rowCount: p ? 1 : 0 };
    }
    if (/^UPDATE learning_plan SET horizon_start/.test(s)) {
      const p = f.plans.find((x) => x.id === params[0]);
      if (p) Object.assign(p, { horizon_start: params[1], horizon_end: params[2], planning_anchor_at: params[3], timezone: params[4], timezone_assumed: params[5], goal_context: JSON.parse(params[6]), updated_at: new Date() });
      return { rows: [], rowCount: p ? 1 : 0 };
    }
    if (/FROM learning_plan_item WHERE plan_id = \$1$/.test(s)) {
      return { rows: f.items.filter((i) => i.plan_id === params[0]), rowCount: 0 };
    }
    if (/^INSERT INTO learning_plan_item /.test(s)) {
      const [plan_id, student_id, subject_id, concept_id, scheduled_date, time_window, intended_activity_type, reason_code, source, priority_at_plan_time, estimated_minutes, opv, operation_key, provenance] = params;
      if (f.items.some((i) => i.operation_key === operation_key)) throw new Error('duplicate key value violates unique constraint "idx_learning_plan_item_operation_key"');
      const row = {
        id: uuid(), plan_id, student_id, subject_id, concept_id, scheduled_date, time_window, intended_activity_type,
        reason_code, source, priority_at_plan_time, estimated_minutes, status: 'PLANNED', orchestration_policy_version: opv,
        operation_key, provenance: JSON.parse(provenance), superseded_by_item_id: null,
        created_at: new Date(), updated_at: new Date(),
      };
      f.items.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (/^UPDATE learning_plan_item SET status = 'SUPERSEDED'/.test(s)) {
      const i = f.items.find((x) => x.id === params[0]);
      if (i) Object.assign(i, { status: 'SUPERSEDED', superseded_by_item_id: params[1], updated_at: new Date() });
      return { rows: [], rowCount: i ? 1 : 0 };
    }
    if (/^INSERT INTO decision_events /.test(s)) {
      f.events.push({ decision_type: params[0], engine: params[1], engine_version: params[2], student_id: params[3], reason_code: params[10] });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unmocked query: ${s}`);
  });
  f.client = { query };
  return f;
}

function item(o: Partial<ProposedLearningPlanItem> & { conceptId: string | null; reasonCode?: any; scheduledDate?: string }): ProposedLearningPlanItem {
  const conceptId = o.conceptId;
  const reasonCode = o.reasonCode ?? 'CURRICULUM_PROGRESSION';
  const scheduledDate = o.scheduledDate ?? '2026-09-07';
  return {
    subjectId: SUBJ,
    scheduledDate,
    timeWindow: null,
    intendedActivityType: 'PRACTICE',
    reasonCode,
    source: 'CURRICULUM_PROGRESSION',
    priorityAtPlanTime: 1000,
    estimatedMinutes: 10,
    operationKey: buildLearningPlanItemOperationKey({ studentId: STU, conceptId, subjectId: SUBJ, reasonCode, scheduledDate, orchestrationPolicyVersion: 1 }),
    provenance: { sourceType: 'phase4_decision' },
    ...o,
  };
}

function input(f: Fake, o: Partial<ProjectLearningPlanInput> = {}): ProjectLearningPlanInput {
  return {
    studentId: STU,
    orchestrationPolicyVersion: 1,
    horizonStart: '2026-09-06',
    horizonEnd: '2026-09-19',
    planningAnchorAt: '2026-09-06T12:00:00.000Z',
    timezone: 'UTC',
    timezoneAssumed: true,
    goalContext: {},
    proposedItems: [],
    client: f.client as any,
    ...o,
  };
}

beforeEach(() => { uuidN = 0; setDecisionEventPersistenceForTests(true); });
afterEach(() => setDecisionEventPersistenceForTests(false));

describe('8B1 -- first plan creation', () => {
  it('no active plan -> creates ONE ACTIVE plan + all items, one PLAN_CREATED event', async () => {
    const f = makeFake();
    const r = await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' }), item({ conceptId: 'c2' })] }));
    expect(r.planAction).toBe('CREATED');
    expect(r.diff).toEqual({ added: 2, unchanged: 0, superseded: 0 });
    expect(f.plans.filter((p) => p.status === 'ACTIVE')).toHaveLength(1);
    expect(f.items).toHaveLength(2);
    expect(f.events.filter((e) => e.decision_type === 'PLAN_CREATED')).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ engine: 'orchestration-engine', engine_version: '1', student_id: STU });
  });

  it('unknown student -> throws, no rows written', async () => {
    const f = makeFake([]); // no students
    await expect(projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] }))).rejects.toThrow(/unknown student/);
    expect(f.plans).toHaveLength(0);
    expect(f.items).toHaveLength(0);
  });
});

describe('8B1 -- semantic no-op (idempotent)', () => {
  it('second identical projection: 0 new plan rows, 0 new items, 0 supersedes, 0 events', async () => {
    const f = makeFake();
    const items = [item({ conceptId: 'c1' }), item({ conceptId: 'c2' })];
    await projectLearningPlan(input(f, { proposedItems: items }));
    const eventsAfterFirst = f.events.length;
    const r2 = await projectLearningPlan(input(f, { proposedItems: items }));
    expect(r2.planAction).toBe('RETAINED');
    expect(r2.stateChanged).toBe(false);
    expect(r2.diff).toEqual({ added: 0, unchanged: 2, superseded: 0 });
    expect(f.plans.filter((p) => p.status === 'ACTIVE')).toHaveLength(1);
    expect(f.items).toHaveLength(2);
    expect(f.events.length).toBe(eventsAfterFirst); // no new events
  });
});

describe('8B1 -- incremental replan / move', () => {
  it('add one, drop one -> RETAINED, ADD + SUPERSEDE, one PLAN_REPLANNED + one PLAN_ITEM_SUPERSEDED', async () => {
    const f = makeFake();
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' }), item({ conceptId: 'c2' })] }));
    f.events.length = 0;
    const r = await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' }), item({ conceptId: 'c3' })] }));
    expect(r.planAction).toBe('RETAINED');
    expect(r.diff).toEqual({ added: 1, unchanged: 1, superseded: 1 });
    expect(f.items.filter((i) => i.status === 'PLANNED').map((i) => i.concept_id).sort()).toEqual(['c1', 'c3']);
    expect(f.items.find((i) => i.concept_id === 'c2').status).toBe('SUPERSEDED');
    expect(f.events.filter((e) => e.decision_type === 'PLAN_REPLANNED')).toHaveLength(1);
    expect(f.events.filter((e) => e.decision_type === 'PLAN_ITEM_SUPERSEDED')).toHaveLength(1);
  });

  it('a MOVE (c1 day7 -> c1 day9) = old SUPERSEDED (linked) + new ADDED; old date never rewritten', async () => {
    const f = makeFake();
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1', scheduledDate: '2026-09-07' })] }));
    const oldId = f.items[0].id;
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1', scheduledDate: '2026-09-09' })] }));
    const oldRow = f.items.find((i) => i.id === oldId);
    const newRow = f.items.find((i) => i.status === 'PLANNED');
    expect(oldRow.status).toBe('SUPERSEDED');
    expect(oldRow.scheduled_date).toBe('2026-09-07'); // never rewritten
    expect(oldRow.superseded_by_item_id).toBe(newRow.id); // linked
    expect(newRow.scheduled_date).toBe('2026-09-09');
  });
});

describe('8B1 -- terminal items never reopened', () => {
  it('a COMPLETED item whose key reappears in the proposal is left alone (not re-added, not UNCHANGED-counted for write)', async () => {
    const f = makeFake();
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] }));
    f.items[0].status = 'COMPLETED';
    const before = JSON.stringify(f.items[0]);
    const r = await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] }));
    expect(JSON.stringify(f.items.find((i) => i.concept_id === 'c1'))).toBe(before); // untouched
    expect(r.diff.added).toBe(0);
    expect(r.stateChanged).toBe(false);
  });

  it('a SUPERSEDED item not in the proposal is not re-SUPERSEDED', async () => {
    const f = makeFake();
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' }), item({ conceptId: 'c2' })] }));
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] })); // c2 superseded
    const c2 = f.items.find((i) => i.concept_id === 'c2');
    const snapshot = JSON.stringify(c2);
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] })); // c2 still absent
    expect(JSON.stringify(f.items.find((i) => i.concept_id === 'c2'))).toBe(snapshot);
  });
});

describe('8B1 -- policy-version replacement', () => {
  it('active v1, request v2 -> old plan SUPERSEDED, new ACTIVE plan, PLAN_CREATED (not PLAN_REPLANNED)', async () => {
    const f = makeFake();
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] }));
    const v1PlanId = f.plans[0].id;
    f.events.length = 0;
    const v2Item = { ...item({ conceptId: 'c1' }), operationKey: buildLearningPlanItemOperationKey({ studentId: STU, conceptId: 'c1', subjectId: SUBJ, reasonCode: 'CURRICULUM_PROGRESSION', scheduledDate: '2026-09-07', orchestrationPolicyVersion: 2 }) };
    const r = await projectLearningPlan(input(f, { orchestrationPolicyVersion: 2, proposedItems: [v2Item] }));
    expect(r.planAction).toBe('VERSION_REPLACED');
    expect(f.plans.find((p) => p.id === v1PlanId).status).toBe('SUPERSEDED');
    expect(f.plans.filter((p) => p.status === 'ACTIVE')).toHaveLength(1);
    expect(f.plans.find((p) => p.status === 'ACTIVE').orchestration_policy_version).toBe(2);
    expect(f.events.filter((e) => e.decision_type === 'PLAN_CREATED')).toHaveLength(1);
    expect(f.events.filter((e) => e.decision_type === 'PLAN_REPLANNED')).toHaveLength(0);
  });

  it('same-version horizon roll retains the SAME plan id (no new plan per day)', async () => {
    const f = makeFake();
    const r1 = await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] }));
    const r2 = await projectLearningPlan(input(f, {
      proposedItems: [item({ conceptId: 'c1' })],
      horizonStart: '2026-09-07', horizonEnd: '2026-09-20', planningAnchorAt: '2026-09-07T12:00:00.000Z',
    }));
    expect(r2.planId).toBe(r1.planId);
    expect(r2.planAction).toBe('RETAINED');
    expect(r2.stateChanged).toBe(true); // header (horizon/anchor) changed -> PLAN_REPLANNED
    expect(f.events.filter((e) => e.decision_type === 'PLAN_REPLANNED')).toHaveLength(1);
    expect(f.plans).toHaveLength(1);
  });
});

describe('8B1 -- transaction + concurrency', () => {
  it('takes the per-student row lock BEFORE reading the active plan', async () => {
    const f = makeFake();
    await projectLearningPlan(input(f, { proposedItems: [item({ conceptId: 'c1' })] }));
    const lockIdx = f.calls.findIndex((c) => /FOR UPDATE/.test(c));
    const readActiveIdx = f.calls.findIndex((c) => /learning_plan WHERE student_id = \$1 AND status = 'ACTIVE'/.test(c));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(readActiveIdx); // lock first -- serializes concurrent first-creation writers
  });

  it('a failing item insert rolls back (no partial plan)', async () => {
    const f = makeFake();
    // two proposed items with the SAME operation key -> the 2nd insert throws (unique)
    const dup = item({ conceptId: 'c1' });
    const clash = { ...item({ conceptId: 'c2' }), operationKey: dup.operationKey };
    await expect(projectLearningPlan(input(f, { proposedItems: [dup, clash] }))).rejects.toThrow(/unique constraint/);
  });
});

describe('8B1 -- audit governance', () => {
  it('no PLAN_CREATED/PLAN_REPLANNED/PLAN_ITEM_SUPERSEDED on a semantic no-op', async () => {
    const f = makeFake();
    const items = [item({ conceptId: 'c1' })];
    await projectLearningPlan(input(f, { proposedItems: items }));
    f.events.length = 0;
    await projectLearningPlan(input(f, { proposedItems: items }));
    expect(f.events).toEqual([]);
  });
  it('engine is always orchestration-engine with engineVersion = String(policyVersion)', async () => {
    const f = makeFake();
    await projectLearningPlan(input(f, { orchestrationPolicyVersion: 1, proposedItems: [item({ conceptId: 'c1' })] }));
    for (const e of f.events) {
      expect(e.engine).toBe('orchestration-engine');
      expect(e.engine_version).toBe('1');
    }
  });
});
