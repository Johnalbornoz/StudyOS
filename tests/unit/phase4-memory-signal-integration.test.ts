/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6H-B: Phase 4 canonical memory signal integration -- test matrix.
 *
 * Proves RETENTION_REVIEW_DUE and FORGETTING_RISK are now sourced from
 * Phase 6's concept_memory_state (via getPhase4MemorySignalsForStudent),
 * never from mastery_records.next_review_date /
 * spaced-repetition.ts::calculateForgettingRisk, while the pure
 * adaptive-learning-policy.ts BAND/activity-selection policy is
 * provably unchanged. Real service composition (getLearningDecisions),
 * only @/lib/db mocked -- same pattern as
 * adaptive-learning-orchestrator-integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';
import {
  consolidateSignals,
  buildLearningDecision,
  FORGETTING_RISK_THRESHOLD,
  RETENTION_REVIEW_LOOKAHEAD_DAYS,
  type LearningSignal,
} from '@/lib/adaptive-learning-policy';

const STUDENT = 'p6h-student';
const SUBJECT = 'p6h-subject';
const CONCEPT = 'p6h-concept';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

function policyRow() {
  return {
    version: 1, minimum_understanding: 80, minimum_independence: 80, minimum_application: 75,
    minimum_retention: 75, minimum_transfer: 70, requires_transfer: false, maximum_critical_misconceptions: 0,
    minimum_evidence_count: 1, minimum_independent_evidence_count: 1, retention_min_gap_days: 3, validation_window_days: 14,
  };
}

function ksRow(overrides: Record<string, unknown> = {}) {
  return {
    student_id: STUDENT, concept_id: CONCEPT, subject_id: SUBJECT, mastery_state: 'DEVELOPING',
    understanding_score: 90, independence_score: 90, application_score: 90, retention_score: null, transfer_score: null,
    active_misconception_count: 0, critical_misconception_count: 0, recurring_misconception_count: 0,
    evidence_count: 5, independent_evidence_count: 3, first_evidence_at: daysAgo(90), last_evidence_at: daysAgo(1),
    validation_readiness: 'READY', state_reason: null, projection_version: 1, mastery_policy_version: 1, updated_at: daysAgo(1),
    ...overrides,
  };
}

/** memory_status defaults to NOT_ESTABLISHED-shaped nulls; pass overrides for anchor/success/etc. */
function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    concept_id: CONCEPT,
    policy_version: 1,
    initial_competence_anchor_at: null,
    last_qualified_attempt_at: null,
    last_successful_retention_at: null,
    last_unsuccessful_retention_at: null,
    demonstrated_retention_score: null,
    retention_evidence_count: 0,
    consecutive_qualifying_successes: 0,
    memory_stability: 'UNSTABLE',
    memory_status: 'NOT_ESTABLISHED',
    next_review_at: null,
    ...overrides,
  };
}

/** Builds a mocked db.query. `memoryRows` and `masteryRows` are the two fixtures this file varies per scenario; everything else is a fixed, minimal, real-composition scaffold. */
function buildQuery(opts: { ksOverrides?: Record<string, unknown>; memoryRows?: any[]; masteryRows?: any[] } = {}) {
  return vi.fn(async (sql: string) => {
    if (/FROM subjects WHERE student_id/i.test(sql)) return { rows: [{ id: SUBJECT }] };
    if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/i.test(sql)) return { rows: [ksRow(opts.ksOverrides)] };
    if (/FROM mastery_policies/i.test(sql)) return { rows: [policyRow()] };
    if (/FROM concept_memory_state\s+WHERE student_id = \$1/i.test(sql)) return { rows: opts.memoryRows ?? [] };
    if (/FROM mastery_records mr\s+JOIN concepts c/i.test(sql)) return { rows: opts.masteryRows ?? [] };
    if (/SELECT COUNT\(\*\)::int AS n FROM verification_attempts/i.test(sql)) return { rows: [{ n: 0 }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  queryMock.mockReset();
});

describe('RETENTION_REVIEW_DUE sourced from Phase 6 nextReviewAt', () => {
  it('a nextReviewAt within the existing 7-day lookahead creates RETENTION_REVIEW_DUE', async () => {
    queryMock.mockImplementation(
      buildQuery({ memoryRows: [memoryRow({ memory_status: 'STABLE', next_review_at: daysFromNow(3) })] })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.some((s) => s.type === 'RETENTION_REVIEW_DUE')).toBe(true);
    expect(decision?.signals.find((s) => s.type === 'RETENTION_REVIEW_DUE')?.temporalUrgency).toBe('LOW');
  });

  it('a nextReviewAt already overdue creates RETENTION_REVIEW_DUE with HIGH urgency', async () => {
    queryMock.mockImplementation(
      buildQuery({ memoryRows: [memoryRow({ memory_status: 'STABLE', next_review_at: daysAgo(1) })] })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.find((s) => s.type === 'RETENTION_REVIEW_DUE')?.temporalUrgency).toBe('HIGH');
  });

  it('a nextReviewAt beyond the lookahead window creates no RETENTION_REVIEW_DUE', async () => {
    queryMock.mockImplementation(
      buildQuery({ memoryRows: [memoryRow({ memory_status: 'STABLE', next_review_at: daysFromNow(RETENTION_REVIEW_LOOKAHEAD_DAYS + 5) })] })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.some((s) => s.type === 'RETENTION_REVIEW_DUE')).toBe(false);
  });

  it('legacy mastery_records.next_review_date no longer drives the canonical Phase 4 retention signal', async () => {
    // learning-scheduler.service.ts::getDueItems still runs internally
    // (untouched -- Section 5: "do not delete the service yet") and its
    // own next_review_date query still fires, but the orchestrator now
    // filters that item type out of its loop entirely (see the
    // "MISSING MEMORY STATE" tests above) -- so with zero
    // concept_memory_state rows, no RETENTION_REVIEW_DUE signal is
    // produced even though mastery_records.next_review_date is still
    // read as a side effect of the untouched Scheduler.
    queryMock.mockImplementation(buildQuery({ memoryRows: [] }));
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    // An unrelated signal (INSUFFICIENT_INDEPENDENT_EVIDENCE, from
    // assessment-verification.service.ts) still legitimately fires here --
    // the point is specifically that RETENTION_REVIEW_DUE does not,
    // despite the Scheduler's own next_review_date query still running.
    expect(decision?.signals.some((s) => s.type === 'RETENTION_REVIEW_DUE')).toBe(false);
  });
});

describe('FORGETTING_RISK sourced from Phase 6 canonical prediction', () => {
  it('a Phase 6 forgettingRisk at/above threshold creates FORGETTING_RISK', async () => {
    // Stale anchor (60 days), no successful retention proof -> UNSTABLE,
    // shortest expected interval -> real, high computeLiveMemorySignals risk.
    queryMock.mockImplementation(
      buildQuery({ memoryRows: [memoryRow({ initial_competence_anchor_at: daysAgo(60), memory_status: 'WAITING_FOR_RETENTION' })] })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    const signal = decision?.signals.find((s) => s.type === 'FORGETTING_RISK');
    expect(signal).toBeDefined();
    expect(typeof signal!.metadata.forgettingRisk).toBe('number');
    expect(signal!.metadata.forgettingRisk as number).toBeGreaterThanOrEqual(FORGETTING_RISK_THRESHOLD);
  });

  it('below threshold creates no FORGETTING_RISK', async () => {
    // A recent successful retention proof (2 days ago) against a long
    // expected interval (many consecutive successes) -> low real risk.
    queryMock.mockImplementation(
      buildQuery({
        memoryRows: [
          memoryRow({
            initial_competence_anchor_at: daysAgo(90),
            last_successful_retention_at: daysAgo(2),
            consecutive_qualifying_successes: 5,
            memory_stability: 'STABLE',
            memory_status: 'STABLE',
          }),
        ],
      })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.some((s) => s.type === 'FORGETTING_RISK')).toBe(false);
  });

  it('legacy spaced-repetition value no longer drives Phase 4: extreme legacy staleness with no Phase 6 row produces no signal', async () => {
    queryMock.mockImplementation(
      buildQuery({ memoryRows: [], masteryRows: [{ concept_id: CONCEPT, canonical_id: CONCEPT, label: 'X', mastery_score: 40, confidence_score: 10, attempt_count: 20, last_practiced: daysAgo(3650), learning_debt_severity: null, learning_debt_status: null }] })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.some((s) => s.type === 'FORGETTING_RISK')).toBe(false);
  });
});

describe('SOURCE-DIFFERENCE SCENARIOS -- Phase 6 authority, not legacy', () => {
  it('legacy last_practiced recent (would be LOW legacy risk) but Phase 6 lastSuccessfulRetentionAt old (HIGHER Phase 6 risk): Phase 4 uses Phase 6', async () => {
    queryMock.mockImplementation(
      buildQuery({
        masteryRows: [{ concept_id: CONCEPT, canonical_id: CONCEPT, label: 'X', mastery_score: 90, confidence_score: 90, attempt_count: 10, last_practiced: daysAgo(1), learning_debt_severity: null, learning_debt_status: null }],
        memoryRows: [
          memoryRow({
            initial_competence_anchor_at: daysAgo(90),
            last_successful_retention_at: daysAgo(80),
            consecutive_qualifying_successes: 1,
            memory_stability: 'DEVELOPING',
            memory_status: 'DEVELOPING',
          }),
        ],
      })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    // Legacy (last_practiced=1 day ago) would never have fired FORGETTING_RISK -- Phase 6's 80-day-stale proof does.
    expect(decision?.signals.some((s) => s.type === 'FORGETTING_RISK')).toBe(true);
  });

  it('inverse: legacy last_practiced very old (would be HIGH legacy risk) but Phase 6 has a fresh successful proof (LOW Phase 6 risk): Phase 4 uses Phase 6', async () => {
    queryMock.mockImplementation(
      buildQuery({
        masteryRows: [{ concept_id: CONCEPT, canonical_id: CONCEPT, label: 'X', mastery_score: 40, confidence_score: 20, attempt_count: 3, last_practiced: daysAgo(400), learning_debt_severity: null, learning_debt_status: null }],
        memoryRows: [
          memoryRow({
            initial_competence_anchor_at: daysAgo(30),
            last_successful_retention_at: daysAgo(1),
            consecutive_qualifying_successes: 4,
            memory_stability: 'STABLE',
            memory_status: 'STABLE',
          }),
        ],
      })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.some((s) => s.type === 'FORGETTING_RISK')).toBe(false);
  });
});

describe('WAITING_FOR_RETENTION still derives exclusively from Phase 2 validation_readiness', () => {
  it('KS validationReadiness=WAITING_FOR_RETENTION fires the signal even when Phase 6 memoryStatus=STABLE', async () => {
    queryMock.mockImplementation(
      buildQuery({
        ksOverrides: { validation_readiness: 'WAITING_FOR_RETENTION' },
        memoryRows: [memoryRow({ memory_status: 'STABLE', consecutive_qualifying_successes: 3, memory_stability: 'STABLE' })],
      })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.some((s) => s.type === 'WAITING_FOR_RETENTION')).toBe(true);
  });

  it('Phase 6 memoryStatus=WAITING_FOR_RETENTION does NOT fire the signal when KS validationReadiness=READY', async () => {
    queryMock.mockImplementation(
      buildQuery({
        ksOverrides: { validation_readiness: 'READY' },
        memoryRows: [memoryRow({ memory_status: 'WAITING_FOR_RETENTION', initial_competence_anchor_at: daysAgo(1) })],
      })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision?.signals.some((s) => s.type === 'WAITING_FOR_RETENTION')).toBe(false);
  });
});

describe('MISSING MEMORY STATE emits no Phase 6 signal and no legacy fallback', () => {
  it('a concept absent from concept_memory_state gets neither RETENTION_REVIEW_DUE nor FORGETTING_RISK', async () => {
    queryMock.mockImplementation(
      buildQuery({
        memoryRows: [], // no row for CONCEPT at all
        masteryRows: [{ concept_id: CONCEPT, canonical_id: CONCEPT, label: 'X', mastery_score: 30, confidence_score: 10, attempt_count: 15, last_practiced: daysAgo(9999), learning_debt_severity: null, learning_debt_status: null }],
      })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    const types = new Set(decision?.signals.map((s) => s.type) ?? []);
    expect(types.has('RETENTION_REVIEW_DUE')).toBe(false);
    expect(types.has('FORGETTING_RISK')).toBe(false);
  });
});

describe('NOT_ESTABLISHED emits no due/risk signal', () => {
  it('a fresh concept_memory_state row with NOT_ESTABLISHED status and null nextReviewAt fires neither signal', async () => {
    queryMock.mockImplementation(buildQuery({ memoryRows: [memoryRow()] })); // all defaults: NOT_ESTABLISHED, everything null
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    const types = new Set(decision?.signals.map((s) => s.type) ?? []);
    expect(types.has('RETENTION_REVIEW_DUE')).toBe(false);
    expect(types.has('FORGETTING_RISK')).toBe(false);
  });
});

describe('ANCHOR-ONLY follows canonical Phase 6 live prediction semantics (no LOW-confidence suppression)', () => {
  it('anchor exists, no successful retention proof, real numeric forgettingRisk >= threshold still fires FORGETTING_RISK', async () => {
    queryMock.mockImplementation(
      buildQuery({ memoryRows: [memoryRow({ initial_competence_anchor_at: daysAgo(45), memory_status: 'WAITING_FOR_RETENTION' })] })
    );
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    const signal = decision?.signals.find((s) => s.type === 'FORGETTING_RISK');
    expect(signal).toBeDefined();
    // LOW confidence carried as provenance, never suppressing the signal.
    expect(signal!.metadata.predictionConfidence).toBe('LOW');
  });
});

describe('NO NEW MEMORY_AT_RISK PRIORITY SIGNAL', () => {
  it('no decision anywhere ever carries a MEMORY_AT_RISK signal type', async () => {
    queryMock.mockImplementation(
      buildQuery({ memoryRows: [memoryRow({ memory_status: 'AT_RISK', initial_competence_anchor_at: daysAgo(30), last_unsuccessful_retention_at: daysAgo(1) })] })
    );
    const decisions = await getLearningDecisions(STUDENT);
    for (const d of decisions) {
      expect(d.signals.some((s) => (s.type as string) === 'MEMORY_AT_RISK')).toBe(false);
    }
  });
});

describe('NO daysOverdue PRIORITY MODIFICATION (Section 12/28)', () => {
  it('two RETENTION_REVIEW_DUE signals with very different overdue-ness produce the identical band/modifier/priorityScore', () => {
    const near: LearningSignal = { type: 'RETENTION_REVIEW_DUE', source: 'memory-read.service', conceptId: 'c1', subjectId: 's1', dueAt: daysAgo(1), temporalUrgency: 'HIGH', metadata: {} };
    const veryOverdue: LearningSignal = { type: 'RETENTION_REVIEW_DUE', source: 'memory-read.service', conceptId: 'c2', subjectId: 's1', dueAt: daysAgo(400), temporalUrgency: 'HIGH', metadata: {} };
    const [ctxNear] = consolidateSignals([near], new Map());
    const [ctxFar] = consolidateSignals([veryOverdue], new Map());
    const decisionNear = buildLearningDecision(ctxNear);
    const decisionFar = buildLearningDecision(ctxFar);
    expect(decisionNear.priorityScore).toBe(decisionFar.priorityScore);
    expect(decisionNear.pedagogicalPriority).toBe(decisionFar.pedagogicalPriority);
  });
});

describe('SAME RAW SIGNAL, SAME POLICY RESULT (Section 18) -- source changed, policy did not', () => {
  it('a FORGETTING_RISK signal with identical metadata.forgettingRisk produces the identical decision regardless of `source`', () => {
    const legacySourced: LearningSignal = { type: 'FORGETTING_RISK', source: 'lib/algorithms/spaced-repetition', conceptId: 'c1', subjectId: 's1', metadata: { forgettingRisk: 60 } };
    const phase6Sourced: LearningSignal = { type: 'FORGETTING_RISK', source: 'memory-read.service', conceptId: 'c1', subjectId: 's1', metadata: { forgettingRisk: 60, memoryStability: 'DEVELOPING', predictionConfidence: 'MEDIUM' } };

    const [ctxLegacy] = consolidateSignals([legacySourced], new Map());
    const [ctxPhase6] = consolidateSignals([phase6Sourced], new Map());
    const decisionLegacy = buildLearningDecision(ctxLegacy);
    const decisionPhase6 = buildLearningDecision(ctxPhase6);

    expect(decisionPhase6.priorityScore).toBe(decisionLegacy.priorityScore);
    expect(decisionPhase6.pedagogicalPriority).toBe(decisionLegacy.pedagogicalPriority);
    expect(decisionPhase6.activityType).toBe(decisionLegacy.activityType);
    expect(decisionPhase6.targetDimension).toBe(decisionLegacy.targetDimension);
    expect(decisionPhase6.reasonCode).toBe(decisionLegacy.reasonCode);
  });
});

describe('PHASE4_BANDS / ACTIVITY_SELECTION unchanged (regression)', () => {
  it('RETENTION_REVIEW_DUE still selects RETENTION_CHECK and the VALIDATION band, regardless of source', () => {
    const signal: LearningSignal = { type: 'RETENTION_REVIEW_DUE', source: 'memory-read.service', conceptId: 'c1', subjectId: 's1', dueAt: daysAgo(1), temporalUrgency: 'HIGH', metadata: {} };
    const [ctx] = consolidateSignals([signal], new Map());
    const decision = buildLearningDecision(ctx);
    expect(decision.activityType).toBe('RETENTION_CHECK');
    expect(decision.pedagogicalPriority).toBe('LOW'); // BAND.VALIDATION=35 is below BAND.MISCONCEPTION=40 -> priorityLabelForBand -> LOW, unchanged by this step
  });
});

describe('TODAY / STUDY PLAN / TEACHING / SESSION-START REGRESSION -- single Phase 4 authority preserved', () => {
  it('learning-os-snapshot, study-plan, adaptive-teaching, and session-start all still import getLearningDecisions from the same orchestrator module', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
    const consumers = [
      'src/services/learning-os-snapshot.service.ts',
      'src/services/study-plan.service.ts',
      'src/services/adaptive-teaching.service.ts',
      'src/app/api/learning/session/start/route.ts',
      'src/services/learning-execution-scheduler.service.ts',
    ];
    for (const file of consumers) {
      const source = read(file);
      expect(source).toMatch(/getLearningDecisions/);
      expect(source).toMatch(/from ['"].*adaptive-learning-orchestrator\.service['"]/);
    }
  });
});
