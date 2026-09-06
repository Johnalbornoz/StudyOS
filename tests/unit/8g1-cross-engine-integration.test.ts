/**
 * Phase 8 -- Step 8G1: cross-engine integration hardening.
 *
 *  A. Static boundary guard -- no Phase 8 module writes canonical
 *     cognitive / memory / transfer / verification / remediation state,
 *     recomputes `nextReviewAt` / TransferDepth, or re-runs Phase 4
 *     activity selection / ranking.
 *  B. Full-chain scenario -- rebuild -> maintain -> maintain with only
 *     `@/lib/db` and the canonical read services faked. Asserts Phase
 *     4's activityType + priorityScore and Phase 6's nextReviewAt are
 *     CARRIED verbatim, completion is derived from canonical evidence
 *     only, and the whole run issues zero writes to cognitive tables.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setDecisionEventPersistenceForTests } from '@/lib/audit';

// ---------------------------------------------------------------------
// A. static boundary guard
// ---------------------------------------------------------------------
const PHASE8_FILES = [
  'src/lib/learning-orchestration-policy.ts',
  'src/lib/orchestration-candidate-builder.ts',
  'src/lib/learning-plan-completion.ts',
  'src/lib/learning-plan-presentation.ts',
  'src/services/learning-orchestration.service.ts',
  'src/services/learning-orchestration-inputs.service.ts',
  'src/services/learning-plan-projector.service.ts',
  'src/services/learning-plan-read.service.ts',
  'src/services/learning-plan-revalidation.service.ts',
  'src/services/learning-plan-maintenance.service.ts',
  'src/services/learning-plan-agency.service.ts',
  'src/services/learning-plan-view.service.ts',
  'src/services/legacy-study-plan-compat.ts',
];

const COGNITIVE_TABLES = ['concept_memory_state', 'concept_transfer_state', 'concept_knowledge_state', 'mastery_records', 'verification_attempts', 'concept_transfer_task', 'remediation_paths'];

describe('8G1.A -- Phase 8 never writes another engine\'s state and never re-derives its authority', () => {
  for (const rel of PHASE8_FILES) {
    it(`${rel} issues no write to a canonical cognitive table`, () => {
      const raw = readFileSync(join(process.cwd(), rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const tbl of COGNITIVE_TABLES) {
        expect(raw, `${rel} INSERT INTO ${tbl}`).not.toMatch(new RegExp(`INSERT\\s+INTO\\s+${tbl}\\b`, 'i'));
        expect(raw, `${rel} UPDATE ${tbl}`).not.toMatch(new RegExp(`UPDATE\\s+${tbl}\\b`, 'i'));
        expect(raw, `${rel} DELETE FROM ${tbl}`).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+${tbl}\\b`, 'i'));
      }
    });
    it(`${rel} does not recompute Phase 4/5/6/7 authority`, () => {
      const raw = readFileSync(join(process.cwd(), rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(raw).not.toMatch(/\bupdateMastery\s*\(/);
      expect(raw).not.toMatch(/\bcomputeTransferScore\s*\(/);
      expect(raw).not.toMatch(/\b(computeNextReviewAt|recomputeNextReviewAt|scheduleNextReview)\s*\(/);
      expect(raw).not.toMatch(/\b(selectActivityType|rankLearningDecisions|dominantSignal|computeLearningState)\s*\(/);
      // A `type`-only import of LearningDecision is fine; a VALUE import
      // from the Phase 4 policy module is not.
      expect(raw).not.toMatch(/import\s+(?!type\b)[^;]*\bfrom '@\/lib\/adaptive-learning-policy'/);
    });
  }
});

// ---------------------------------------------------------------------
// B. full-chain scenario
// ---------------------------------------------------------------------
const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { query: (...a: any[]) => queryMock(...a), connect: async () => ({ query: (...a: any[]) => queryMock(...a), release: () => {} }) },
  query: (...a: any[]) => queryMock(...a),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({
  getLearningDecisions: (...a: any[]) => getLearningDecisionsMock(...a),
  getBestLearningDecisionForConcept: vi.fn(),
}));
vi.mock('@/services/memory-read.service', () => ({ getPhase4MemorySignalsForStudent: vi.fn(async () => memoryMap) }));
vi.mock('@/services/transfer-read.service', () => ({ getPhase4TransferSignalsForStudent: vi.fn(async () => new Map()) }));
vi.mock('@/services/curriculum-eligibility-read.service', () => ({ getCurriculumEligibleConcepts: vi.fn(async () => []) }));

import { rebuildLearningPlan } from '@/services/learning-orchestration.service';
import { maintainLearningPlan } from '@/services/learning-plan-maintenance.service';

const STU = '11111111-1111-4111-8111-111111111111';
const SUBJ = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333333'; // Phase 4 REMEDIATION target
const C2 = '44444444-4444-4444-8444-444444444444'; // Phase 6 retention target
const REVIEW_DATE = '2026-09-10';
let memoryMap = new Map<string, any>();

let uuidN = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`;

interface Store { plans: any[]; items: any[]; evidence: { concept_id: string; d: string }[]; }

function install(store: Store) {
  queryMock.mockImplementation(async (sql: string, params: any[] = []) => {
    const s = String(sql ?? '').replace(/\s+/g, ' ').trim();
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (/FROM student_availability WHERE student_id = \$1/.test(s)) return { rows: [] };
    if (/SELECT timezone FROM students WHERE id = \$1/.test(s)) return { rows: [{ timezone: 'UTC' }] };
    if (/FROM student_unavailable_dates/.test(s)) return { rows: [] };
    if (/FROM assessment_occurrences ao/.test(s)) return { rows: [] };
    if (/FROM remediation_paths WHERE student_id = \$1 AND state IN/.test(s)) return { rows: [] };
    if (/SELECT c\.id, c\.subject_id FROM concepts c JOIN subjects s/.test(s)) return { rows: [{ id: C1, subject_id: SUBJ }, { id: C2, subject_id: SUBJ }] };
    if (/^SELECT id FROM students WHERE id = \$1 FOR UPDATE/.test(s)) return { rows: [{ id: STU }], rowCount: 1 };
    if (/FROM learning_plan WHERE student_id = \$1 AND status = 'ACTIVE'/.test(s)) {
      const row = store.plans.find((p) => p.status === 'ACTIVE');
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^INSERT INTO learning_plan /.test(s)) {
      const [student_id, opv, hs, he, anchor, tz, tza, gc] = params;
      const row = { id: uuid(), student_id, status: 'ACTIVE', orchestration_policy_version: opv, horizon_start: hs, horizon_end: he, planning_anchor_at: anchor, timezone: tz, timezone_assumed: tza, goal_context: JSON.parse(gc), created_at: new Date(), updated_at: new Date() };
      store.plans.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (/^UPDATE learning_plan SET status = 'SUPERSEDED'/.test(s)) { const p = store.plans.find((x) => x.id === params[0]); if (p) p.status = 'SUPERSEDED'; return { rows: [], rowCount: 1 }; }
    if (/^UPDATE learning_plan SET horizon_start/.test(s)) { const p = store.plans.find((x) => x.id === params[0]); if (p) Object.assign(p, { horizon_start: params[1], horizon_end: params[2], planning_anchor_at: params[3] }); return { rows: [], rowCount: 1 }; }
    if (/FROM learning_plan_item WHERE plan_id = \$1 AND status = ANY\(\$2\)/.test(s)) {
      const live = store.items.filter((i) => i.plan_id === params[0] && ['PLANNED', 'READY'].includes(i.status));
      return { rows: live, rowCount: live.length };
    }
    if (/FROM learning_plan_item WHERE plan_id = \$1$/.test(s)) return { rows: store.items.filter((i) => i.plan_id === params[0]) };
    if (/^INSERT INTO learning_plan_item /.test(s)) {
      const [plan_id, student_id, subject_id, concept_id, scheduled_date, , iat, rc, src, prio, mins, opv, opkey, prov] = params;
      if (store.items.some((i) => i.operation_key === opkey && i.status !== 'SUPERSEDED')) throw new Error('dup key');
      const row = { id: uuid(), plan_id, student_id, subject_id, concept_id, scheduled_date, intended_activity_type: iat, reason_code: rc, source: src, priority_at_plan_time: prio, estimated_minutes: mins, status: 'PLANNED', orchestration_policy_version: opv, operation_key: opkey, provenance: JSON.parse(prov), superseded_by_item_id: null };
      store.items.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (/^UPDATE learning_plan_item SET status = 'SUPERSEDED'/.test(s)) { const i = store.items.find((x) => x.id === params[0]); if (i) i.status = 'SUPERSEDED'; return { rows: [], rowCount: 1 }; }
    if (/^UPDATE learning_plan_item SET status = \$3/.test(s)) {
      const i = store.items.find((x) => x.id === params[0] && x.student_id === params[1] && ['PLANNED', 'READY'].includes(x.status));
      if (i) i.status = params[2];
      return { rows: [], rowCount: i ? 1 : 0 };
    }
    if (/^INSERT INTO decision_events /.test(s)) return { rows: [], rowCount: 1 };
    if (/FROM learning_evidence/.test(s)) return { rows: store.evidence.map((e) => ({ concept_id: e.concept_id, d: e.d })) };
    return { rows: [] };
  });
}

const NOW = new Date('2026-09-06T12:00:00.000Z');

beforeEach(() => {
  uuidN = 0;
  queryMock.mockReset();
  setDecisionEventPersistenceForTests(false);
  memoryMap = new Map([[C2, { conceptId: C2, nextReviewAt: `${REVIEW_DATE}T00:00:00.000Z`, retentionDue: true }]]);
  getLearningDecisionsMock.mockReset().mockResolvedValue([
    {
      actionConceptId: C1, subjectId: SUBJ, targetConceptIds: [], signals: [], primarySignal: 'MISCONCEPTION',
      learningState: 'STRUGGLING', targetDimension: 'UNDERSTANDING', activityType: 'REMEDIATION',
      pedagogicalPriority: 'CRITICAL', temporalUrgency: 'HIGH', priorityScore: 91, reasonCode: 'MISCONCEPTION',
      facts: [], policyVersion: 3,
    },
  ]);
});
afterEach(() => setDecisionEventPersistenceForTests(false));

describe('8G1.B -- rebuild -> maintain full chain carries authority verbatim', () => {
  it('Phase 4 activityType + priorityScore and Phase 6 nextReviewAt are carried, not recomputed', async () => {
    const store: Store = { plans: [], items: [], evidence: [] };
    install(store);

    await rebuildLearningPlan(STU, { now: NOW });

    const c1 = store.items.find((i) => i.concept_id === C1);
    expect(c1, 'a plan item exists for the Phase 4 remediation concept').toBeTruthy();
    expect(c1.intended_activity_type).toBe('REMEDIATION'); // carried, not re-selected
    expect(c1.priority_at_plan_time).toBe(91); // Phase 4 priorityScore verbatim

    const c2 = store.items.find((i) => i.concept_id === C2);
    expect(c2, 'a retention item exists for the Phase 6 concept').toBeTruthy();
    expect(c2.scheduled_date).toBe(REVIEW_DATE); // nextReviewAt date verbatim -- never recomputed
    expect(c2.reason_code).toBe('RETENTION_DUE');

    // whole run: zero writes to any cognitive table
    const writes = queryMock.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
    for (const tbl of COGNITIVE_TABLES) {
      expect(writes.some((w) => new RegExp(`(INSERT INTO|UPDATE|DELETE FROM) ${tbl}`, 'i').test(w)), tbl).toBe(false);
    }
  });

  it('completion is DERIVED from canonical evidence only; maintain is idempotent; missing evidence != cognitive failure', async () => {
    const store: Store = { plans: [], items: [], evidence: [] };
    install(store);
    await rebuildLearningPlan(STU, { now: NOW });

    // learner produces canonical evidence for the remediation concept
    store.evidence.push({ concept_id: C1, d: '2026-09-06' });

    const r1 = await maintainLearningPlan(STU, NOW);
    expect(r1.maintained).toBe(true);
    expect(store.items.find((i) => i.concept_id === C1 && i.status === 'COMPLETED')).toBeTruthy();

    // second maintain with the same state changes nothing new
    const before = store.items.map((i) => `${i.concept_id}:${i.status}`).sort();
    await maintainLearningPlan(STU, NOW);
    const after = store.items.map((i) => `${i.concept_id}:${i.status}`).sort();
    expect(after).toEqual(before);

    // still zero cognitive-table writes across both maintain passes
    const writes = queryMock.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
    for (const tbl of COGNITIVE_TABLES) {
      expect(writes.some((w) => new RegExp(`(INSERT INTO|UPDATE|DELETE FROM) ${tbl}`, 'i').test(w)), tbl).toBe(false);
    }
  });
});
