/**
 * Phase 8 -- Step 8B1: the STRICTLY READ-ONLY plan boundary.
 *
 * Enforces the 8A0 invariant (no side-effecting reads) by grepping the
 * source, and checks the read shapes + pure presentation derivations.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getActiveLearningPlan,
  getLearningPlanHorizon,
  getTodayLearningPlanItems,
  getLearningPlanItem,
  effectiveDueState,
  maintenanceNeeded,
} from '@/services/learning-plan-read.service';

const SRC = join(__dirname, '..', '..', 'src/services/learning-plan-read.service.ts');

describe('8B1 -- read service is strictly read-only (architectural invariant)', () => {
  const code = readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('contains no INSERT / UPDATE / DELETE', () => {
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+\w/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
  it('never invokes the projector / a rebuild / a maintenance write', () => {
    expect(code).not.toMatch(/projectLearningPlan|rebuildLearningPlan|maintainLearningPlan|reconcileLearningPlan/);
    expect(code).not.toMatch(/BEGIN|COMMIT|FOR UPDATE/);
  });
  it('imports no orchestration / projector service', () => {
    expect(code).not.toMatch(/from '@\/services\/learning-plan-projector\.service'/);
    expect(code).not.toMatch(/from '@\/services\/learning-orchestration/);
  });
});

describe('8B1 -- read shapes', () => {
  const planRow = {
    id: 'p1', student_id: 's1', status: 'ACTIVE', orchestration_policy_version: 1,
    horizon_start: '2026-09-06', horizon_end: '2026-09-19', planning_anchor_at: new Date('2026-09-06T12:00:00Z'),
    timezone: 'UTC', timezone_assumed: true, goal_context: {}, created_at: new Date(), updated_at: new Date(),
  };
  const itemRow = (o: Record<string, any> = {}) => ({
    id: o.id ?? 'i1', plan_id: 'p1', student_id: 's1', subject_id: 'sub1', concept_id: o.concept_id ?? 'c1',
    scheduled_date: o.scheduled_date ?? '2026-09-08', time_window: null, intended_activity_type: 'PRACTICE',
    reason_code: 'CURRICULUM_PROGRESSION', source: 'CURRICULUM_PROGRESSION', priority_at_plan_time: 1000,
    estimated_minutes: 10, status: o.status ?? 'PLANNED', orchestration_policy_version: 1, operation_key: o.operation_key ?? 'k1',
    provenance: {}, superseded_by_item_id: null, created_at: new Date(), updated_at: new Date(),
  });

  function client(handler: (sql: string, params: any[]) => any) {
    return { query: vi.fn(async (sql: string, params: any[] = []) => handler(sql.replace(/\s+/g, ' ').trim(), params)) } as any;
  }

  it('getActiveLearningPlan maps the row', async () => {
    const c = client((s) => (/FROM learning_plan WHERE student_id/.test(s) ? { rows: [planRow] } : { rows: [] }));
    const p = await getActiveLearningPlan('s1', c);
    expect(p).toMatchObject({ id: 'p1', status: 'ACTIVE', horizonStart: '2026-09-06', horizonEnd: '2026-09-19', timezoneAssumed: true });
  });

  it('getLearningPlanHorizon returns the ACTIVE plan + only live items', async () => {
    const c = client((s) => {
      if (/FROM learning_plan WHERE student_id/.test(s)) return { rows: [planRow] };
      if (/FROM learning_plan_item WHERE plan_id = \$1 AND status = ANY\(\$2\)/.test(s)) return { rows: [itemRow({ id: 'a' }), itemRow({ id: 'b', scheduled_date: '2026-09-10' })] };
      return { rows: [] };
    });
    const h = await getLearningPlanHorizon('s1', c);
    expect(h?.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('getLearningPlanHorizon is null when there is no ACTIVE plan', async () => {
    const c = client(() => ({ rows: [] }));
    expect(await getLearningPlanHorizon('s1', c)).toBeNull();
  });

  it('getTodayLearningPlanItems filters scheduled_date <= today', async () => {
    const c = client((s, p) => {
      if (/FROM learning_plan WHERE student_id/.test(s)) return { rows: [planRow] };
      if (/scheduled_date <= \$3/.test(s)) {
        expect(p[2]).toBe('2026-09-08');
        return { rows: [itemRow({ id: 'due' })] };
      }
      return { rows: [] };
    });
    expect((await getTodayLearningPlanItems('s1', '2026-09-08', c)).map((i) => i.id)).toEqual(['due']);
  });

  it('getLearningPlanItem is scoped to the student', async () => {
    const c = client((s, p) => {
      expect(s).toMatch(/WHERE id = \$1 AND student_id = \$2/);
      expect(p).toEqual(['i1', 's1']);
      return { rows: [itemRow()] };
    });
    expect((await getLearningPlanItem('s1', 'i1', c))?.id).toBe('i1');
  });
});

describe('8B1 -- pure presentation derivations (never persisted)', () => {
  it('effectiveDueState', () => {
    expect(effectiveDueState({ scheduledDate: '2026-09-10' }, '2026-09-08')).toBe('FUTURE');
    expect(effectiveDueState({ scheduledDate: '2026-09-08' }, '2026-09-08')).toBe('DUE');
    expect(effectiveDueState({ scheduledDate: '2026-09-06' }, '2026-09-08')).toBe('OVERDUE');
  });
  it('maintenanceNeeded is true only when the horizon start has fallen behind today', () => {
    expect(maintenanceNeeded({ horizonStart: '2026-09-06' }, '2026-09-06')).toBe(false);
    expect(maintenanceNeeded({ horizonStart: '2026-09-06' }, '2026-09-07')).toBe(true);
  });
});
