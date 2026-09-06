/**
 * Phase 8 -- Step 8D1: the deterministic 14-day planner + explicit
 * rebuild service, end to end with only @/lib/db faked (in-memory
 * learning_plan / learning_plan_item).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDecisionEventPersistenceForTests } from '@/lib/audit';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    query: (...a: any[]) => queryMock(...a),
    connect: async () => ({ query: (...a: any[]) => queryMock(...a), release: () => {} }),
  },
  query: (...a: any[]) => queryMock(...a),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { rebuildLearningPlan } from '@/services/learning-orchestration.service';

const STU = '11111111-1111-4111-8111-111111111111';
const SUBJ = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';
let uuidN = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`;

function ksRow(o: Record<string, any> = {}) {
  return { student_id: STU, concept_id: CONCEPT, subject_id: SUBJ, mastery_state: 'DEVELOPING', understanding_score: 60, independence_score: 55, application_score: 50, retention_score: null, transfer_score: null, active_misconception_count: 0, critical_misconception_count: 0, recurring_misconception_count: 0, evidence_count: 4, independent_evidence_count: 2, first_evidence_at: '2026-06-01', last_evidence_at: '2026-09-01', validation_readiness: 'INSUFFICIENT_EVIDENCE', state_reason: null, projection_version: 1, mastery_policy_version: 1, updated_at: '2026-09-01', ...o };
}
function policyRow() {
  return { version: 1, minimum_understanding: 80, minimum_independence: 80, minimum_application: 75, minimum_retention: 75, minimum_transfer: 70, requires_transfer: false, maximum_critical_misconceptions: 0, minimum_evidence_count: 1, minimum_independent_evidence_count: 1, retention_min_gap_days: 3, validation_window_days: 14 };
}

interface Fake { plans: any[]; items: any[]; unavailable: string[]; }
function installFake(f: Fake, opts: { manyDecisions?: number } = {}) {
  queryMock.mockImplementation(async (sql: string, params: any[] = []) => {
    const s = String(sql ?? '').replace(/\s+/g, ' ').trim();
    // --- 8C inputs ---
    if (/FROM student_availability WHERE student_id = \$1/.test(s)) return { rows: [] }; // capacityAssumed
    if (/SELECT timezone FROM students WHERE id = \$1/.test(s)) return { rows: [{ timezone: 'UTC' }] };
    if (/FROM subjects WHERE student_id = \$1 AND status = 'active'/.test(s)) return { rows: [{ id: SUBJ }] };
    if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/.test(s)) {
      const n = opts.manyDecisions ?? 1;
      return { rows: Array.from({ length: n }, (_, i) => ksRow({ concept_id: i === 0 ? CONCEPT : `c-extra-${i}` })) };
    }
    if (/FROM mastery_policies/.test(s)) return { rows: [policyRow()] };
    if (/FROM concept_memory_state\s+WHERE student_id = \$1/.test(s)) return { rows: [] };
    if (/FROM concept_transfer_state WHERE student_id = \$1/.test(s)) return { rows: [] };
    if (/FROM mastery_records mr\s+JOIN concepts c/.test(s)) return { rows: [] };
    if (/COUNT\(\*\)::int AS n FROM verification_attempts/.test(s)) return { rows: [{ n: 0 }] };
    if (/FROM assessment_occurrences ao/.test(s)) return { rows: [] };
    if (/FROM remediation_paths WHERE student_id = \$1 AND state IN/.test(s)) return { rows: [] };
    if (/ROW_NUMBER\(\) OVER \( PARTITION BY c\.subject_id/.test(s)) return { rows: [] };
    // concept -> subject map
    if (/SELECT c\.id, c\.subject_id FROM concepts c JOIN subjects s/.test(s)) return { rows: [{ id: CONCEPT, subject_id: SUBJ }] };
    // --- projector ---
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (/^SELECT id FROM students WHERE id = \$1 FOR UPDATE/.test(s)) return { rows: [{ id: STU }], rowCount: 1 };
    if (/FROM learning_plan WHERE student_id = \$1 AND status = 'ACTIVE'/.test(s)) {
      const row = f.plans.find((p) => p.student_id === params[0] && p.status === 'ACTIVE');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^INSERT INTO learning_plan /.test(s)) {
      const [student_id, opv, hs, he, anchor, tz, tza, gc] = params;
      const row = { id: uuid(), student_id, status: 'ACTIVE', orchestration_policy_version: opv, horizon_start: hs, horizon_end: he, planning_anchor_at: anchor, timezone: tz, timezone_assumed: tza, goal_context: JSON.parse(gc), created_at: new Date(), updated_at: new Date() };
      f.plans.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (/^UPDATE learning_plan SET status = 'SUPERSEDED'/.test(s)) { const p = f.plans.find((x) => x.id === params[0]); if (p) p.status = 'SUPERSEDED'; return { rows: [], rowCount: 1 }; }
    if (/^UPDATE learning_plan SET horizon_start/.test(s)) { const p = f.plans.find((x) => x.id === params[0]); if (p) Object.assign(p, { horizon_start: params[1], horizon_end: params[2], planning_anchor_at: params[3] }); return { rows: [], rowCount: 1 }; }
    if (/FROM learning_plan_item WHERE plan_id = \$1$/.test(s)) return { rows: f.items.filter((i) => i.plan_id === params[0]), rowCount: 0 };
    // read-service horizon items (used by 8F1 learner-item carry-forward)
    if (/FROM learning_plan_item WHERE plan_id = \$1 AND status = ANY\(\$2\)/.test(s)) {
      const live = f.items.filter((i) => i.plan_id === params[0] && ['PLANNED', 'READY'].includes(i.status));
      return { rows: live, rowCount: live.length };
    }
    if (/^INSERT INTO learning_plan_item /.test(s)) {
      const [plan_id, student_id, subject_id, concept_id, scheduled_date, , iat, rc, src, prio, mins, opv, opkey, prov] = params;
      if (f.items.some((i) => i.operation_key === opkey)) throw new Error('unique constraint');
      const row = { id: uuid(), plan_id, student_id, subject_id, concept_id, scheduled_date, intended_activity_type: iat, reason_code: rc, source: src, priority_at_plan_time: prio, estimated_minutes: mins, status: 'PLANNED', orchestration_policy_version: opv, operation_key: opkey, provenance: JSON.parse(prov), superseded_by_item_id: null };
      f.items.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (/^UPDATE learning_plan_item SET status = 'SUPERSEDED'/.test(s)) { const i = f.items.find((x) => x.id === params[0]); if (i) { i.status = 'SUPERSEDED'; i.superseded_by_item_id = params[1]; } return { rows: [], rowCount: 1 }; }
    if (/^INSERT INTO decision_events /.test(s)) return { rows: [], rowCount: 1 };
    return { rows: [] };
  });
}

beforeEach(() => { uuidN = 0; queryMock.mockReset(); setDecisionEventPersistenceForTests(false); });
afterEach(() => setDecisionEventPersistenceForTests(false));

const NOW = new Date('2026-09-06T12:00:00.000Z');

describe('8D1 -- rebuildLearningPlan', () => {
  it('creates a plan from a Phase 4 decision; horizon is exactly 14 days', async () => {
    const f: Fake = { plans: [], items: [], unavailable: [] };
    installFake(f);
    const r = await rebuildLearningPlan(STU, { now: NOW });
    expect(r.horizonStart).toBe('2026-09-06');
    expect(r.horizonEnd).toBe('2026-09-19');
    expect(r.planResult.planAction).toBe('CREATED');
    expect(r.placedCount).toBeGreaterThanOrEqual(1);
    expect(f.plans.filter((p) => p.status === 'ACTIVE')).toHaveLength(1);
    expect(f.items.length).toBe(r.placedCount);
    expect(r.capacityAssumed).toBe(true);
    expect(r.timezoneAssumed).toBe(true);
  });

  it('a second rebuild with the SAME clock + state is a semantic no-op', async () => {
    const f: Fake = { plans: [], items: [], unavailable: [] };
    installFake(f);
    await rebuildLearningPlan(STU, { now: NOW });
    const itemCount = f.items.length;
    const r2 = await rebuildLearningPlan(STU, { now: NOW });
    expect(r2.planResult.planAction).toBe('RETAINED');
    expect(r2.planResult.stateChanged).toBe(false);
    expect(f.items.length).toBe(itemCount);
    expect(f.plans.filter((p) => p.status === 'ACTIVE')).toHaveLength(1);
  });

  it('is deterministic: same inputs -> byte-identical placed plan', async () => {
    const run = async () => {
      const f: Fake = { plans: [], items: [], unavailable: [] };
      installFake(f, { manyDecisions: 3 });
      await rebuildLearningPlan(STU, { now: NOW });
      return f.items.map((i) => `${i.concept_id}@${i.scheduled_date}#${i.operation_key}`).sort();
    };
    expect(await run()).toEqual(await run());
  });

  it('capacity overflow -> some candidates deferred, capacityPressure reported (default 30 min/day)', async () => {
    const f: Fake = { plans: [], items: [], unavailable: [] };
    installFake(f, { manyDecisions: 8 }); // 8 PRACTICE decisions x 10 min, day cap 30 min / 4 items
    const r = await rebuildLearningPlan(STU, { now: NOW });
    expect(r.deferred.length + r.placedCount).toBe(8);
    // 14 days x min(30 min / 3 items) -- everything eventually fits across the horizon,
    // but per-day caps mean not all land on day 1.
    const day1 = f.items.filter((i) => i.scheduled_date === '2026-09-06');
    expect(day1.length).toBeLessThanOrEqual(3); // 30 min / 10 min
  });

  it('8F1: carries a LIVE learner-authored item (MANUAL_RESCHEDULE) through a rebuild instead of superseding it', async () => {
    const f: Fake = { plans: [], items: [], unavailable: [] };
    installFake(f);
    await rebuildLearningPlan(STU, { now: NOW });
    const plan = f.plans.find((p) => p.status === 'ACTIVE')!;

    // learner rescheduled something the engine will never re-derive
    f.items.push({
      id: uuid(), plan_id: plan.id, student_id: STU, subject_id: SUBJ, concept_id: 'c-manual',
      scheduled_date: '2026-09-12', intended_activity_type: 'PRACTICE', reason_code: 'CURRICULUM_PROGRESSION',
      source: 'MANUAL_RESCHEDULE', priority_at_plan_time: 0, estimated_minutes: 20, status: 'PLANNED',
      orchestration_policy_version: 1, operation_key: `LPI::v1::${STU}::c-manual::CURRICULUM_PROGRESSION::2026-09-12`,
      provenance: {}, superseded_by_item_id: null,
    });
    // and one that has fallen off the back of the rolling horizon
    f.items.push({
      id: uuid(), plan_id: plan.id, student_id: STU, subject_id: SUBJ, concept_id: 'c-old',
      scheduled_date: '2026-08-01', intended_activity_type: 'PRACTICE', reason_code: 'LEARNER_REQUESTED',
      source: 'MANUAL_RESCHEDULE', priority_at_plan_time: 0, estimated_minutes: 20, status: 'PLANNED',
      orchestration_policy_version: 1, operation_key: `LPI::v1::${STU}::c-old::LEARNER_REQUESTED::2026-08-01`,
      provenance: {}, superseded_by_item_id: null,
    });

    await rebuildLearningPlan(STU, { now: NOW });

    expect(f.items.find((i) => i.concept_id === 'c-manual')!.status).toBe('PLANNED');
    expect(f.items.find((i) => i.concept_id === 'c-old')!.status).toBe('SUPERSEDED');
  });

  it('does not run inside a cognitive transaction and calls no AI (grep guard)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const code = readFileSync(join(__dirname, '..', '..', 'src/services/learning-orchestration.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/@\/lib\/ai|executeAI|callAnthropic/i);
    expect(code).not.toMatch(/updateMastery|recalculateConceptKnowledgeState/);
    expect(code).not.toMatch(/Math\.random\(\)|Date\.now\(\)/);
  });
});
