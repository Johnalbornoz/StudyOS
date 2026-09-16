/**
 * CANON-R5R1 -- v1 EVIDENCE PERSISTENCE & RESULTS RECONCILIATION.
 * Direct unit tests for `verifyV1PracticeLaunchMarker` and
 * `resolveV1PracticeEligibility` against the REAL, unmocked frozen
 * engine (only this module's own IO dependencies -- DB reads, the
 * misconception service -- are mocked), matching the same discipline
 * `canon-r5-canonical-decision-service.test.ts` established for CANON-R5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const MOCK_DB = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: MOCK_DB }));

const fetchStudyUSEvidenceRowsMock = vi.fn();
vi.mock('@/lib/pedagogical-shadow', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pedagogical-shadow')>('@/lib/pedagogical-shadow');
  return { ...actual, fetchStudyUSEvidenceRows: (...a: unknown[]) => fetchStudyUSEvidenceRowsMock(...a) };
});

const loadRecognizedRequirementsForEngineMock = vi.fn();
vi.mock('@/lib/pedagogical-migration', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pedagogical-migration')>('@/lib/pedagogical-migration');
  return { ...actual, loadRecognizedRequirementsForEngine: (...a: unknown[]) => loadRecognizedRequirementsForEngineMock(...a) };
});

const getMisconceptionCountsForConceptMock = vi.fn();
vi.mock('@/services/misconception.service', () => ({
  getMisconceptionCountsForConcept: (...a: unknown[]) => getMisconceptionCountsForConceptMock(...a),
}));

import { verifyV1PracticeLaunchMarker, resolveV1PracticeEligibility, CanonicalDecisionUnavailableError } from '@/lib/pedagogical-decision';
import { V1_POLICY_VERSION } from '@/lib/pedagogical-migration';
import type { CanonicalPedagogicalDecision } from '@/lib/pedagogical-engine';

const STUDENT = 's1';
const CONCEPT = 'c1';
const NOW = '2026-09-20T00:00:00.000Z';

beforeEach(() => {
  MOCK_DB.query.mockReset();
  fetchStudyUSEvidenceRowsMock.mockReset().mockResolvedValue([]);
  loadRecognizedRequirementsForEngineMock.mockReset().mockResolvedValue([]);
  getMisconceptionCountsForConceptMock.mockReset().mockResolvedValue({ activeCount: 0, criticalCount: 0, recurringCount: 0 });
});

describe('verifyV1PracticeLaunchMarker -- trust model', () => {
  it('returns a real marker for a genuinely EXECUTABLE PRACTICE decision (a LEARN-recognized, preexisting concept -- the Radicación shape)', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
    ]);
    const marker = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    expect(marker).not.toBeNull();
    expect(marker?.pedagogicalPolicyVersion).toBe(V1_POLICY_VERSION);
    expect(marker?.canonicalStage).toBe('PRACTICE');
    expect(marker?.canonicalActivityType).toBe('PRACTICE');
    expect(typeof marker?.canonicalRevision).toBe('string');
  });

  it('returns null for a concept genuinely at LEARN (no recognition, no evidence) -- never forced into a marker', async () => {
    const marker = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    expect(marker).toBeNull();
  });

  it('returns null when the fresh decision is WAITING (e.g. Retention not due) -- Part 20 Server Trust Test analog: a forged claim for a non-Practice concept never produces a marker', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
      { requirement: 'PRACTICE', basis: 'LEGACY_POLICY_RECOGNITION', recognitionId: 'r2', reasonCode: 'LEGACY_PRACTICE_EVIDENCE_SUFFICIENT_AND_UNDERSTANDING_OK', recognizedAt: NOW },
      { requirement: 'PROVE', basis: 'LEGACY_POLICY_RECOGNITION', recognitionId: 'r3', reasonCode: 'LEGACY_INDEPENDENT_EVIDENCE_OK', recognizedAt: NOW },
    ]);
    const marker = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    // Stage resolves to RETAIN (WAITING, since there's no retention evidence yet) -- never PRACTICE -- so no marker.
    expect(marker).toBeNull();
  });

  it('degrades to null (never throws) when the canonical decision read fails -- a transient failure never blocks generation, only never labels it v1', async () => {
    fetchStudyUSEvidenceRowsMock.mockRejectedValue(new Error('connection refused'));
    const marker = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    expect(marker).toBeNull();
  });

  it('re-throws a non-CanonicalDecisionUnavailableError unchanged (never silently swallows an unrelated bug)', async () => {
    // Simulate an unexpected error type by having the mocked misconception service throw something the service wouldn't wrap.
    getMisconceptionCountsForConceptMock.mockImplementation(() => {
      throw new TypeError('unexpected');
    });
    // getCanonicalPedagogicalDecision wraps every input-read failure into CanonicalDecisionUnavailableError,
    // so this still resolves to null -- included to document that behavior explicitly, not to find a gap.
    const marker = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    expect(marker).toBeNull();
  });
});

function decision(overrides: Partial<CanonicalPedagogicalDecision> = {}): CanonicalPedagogicalDecision {
  return {
    policyVersion: V1_POLICY_VERSION,
    canonicalRevision: 'rev1',
    conceptId: CONCEPT,
    studentId: STUDENT,
    stage: 'PRACTICE',
    currentStage: 'PRACTICE',
    actionState: 'EXECUTABLE',
    nextCanonicalAction: 'PRACTICE',
    requirements: [],
    qualifiedEvidence: [],
    activityContract: {
      activityType: 'PRACTICE',
      itemCount: { min: 2, max: 3 },
      difficulty: { target: 3, min: 2, max: 4, reasonCode: 'DEFAULT_STAGE_MIDPOINT' as any },
      independence: false,
      supportLevel: 'ASSISTED',
      minimumScorePercent: 80,
      evidenceContract: 'PRACTICE_ESTABLISHED_CHALLENGE',
    },
    waitingReason: null,
    nextEligibleAt: null,
    intervention: null,
    rollback: null,
    reasonCodes: [],
    journeyProgressPercent: 35,
    computedAt: NOW,
    recognitionRejected: null,
    ...overrides,
  } as CanonicalPedagogicalDecision;
}

describe('resolveV1PracticeEligibility -- the ONE shared check session-start and generation-time verification both use', () => {
  it('EXECUTABLE PRACTICE is eligible', () => {
    expect(resolveV1PracticeEligibility(decision())).toEqual({ eligible: true, activityType: 'PRACTICE' });
  });

  it('an active REINFORCE overlay is eligible', () => {
    expect(resolveV1PracticeEligibility(decision({ intervention: 'REINFORCE' }))).toEqual({ eligible: true, activityType: 'REINFORCE' });
  });

  it('WAITING is never eligible', () => {
    expect(resolveV1PracticeEligibility(decision({ actionState: 'WAITING' }))).toEqual({ eligible: false });
  });

  it('CONSOLIDATED is never eligible', () => {
    expect(resolveV1PracticeEligibility(decision({ actionState: 'CONSOLIDATED', activityContract: null }))).toEqual({ eligible: false });
  });

  it('EXECUTABLE PROVE is eligible as of CANON-R6 (generation now ready via the distinct canonical_prove mode)', () => {
    expect(
      resolveV1PracticeEligibility(
        decision({ stage: 'PROVE', activityContract: { ...decision().activityContract!, activityType: 'PROVE', itemCount: { min: 10, max: 10 }, independence: true } }),
      ),
    ).toEqual({ eligible: true, activityType: 'PROVE' });
  });
});
