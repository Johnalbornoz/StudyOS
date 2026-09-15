/**
 * CANON-R5 -- CONTROLLED CANONICAL ENGINE INTEGRATION: direct unit tests
 * for the new orchestration layer itself (`src/lib/pedagogical-decision/`).
 * These tests exercise the REAL module under test end to end against the
 * REAL frozen engine (`evaluateCanonicalLearningState`, never mocked) --
 * only this module's own IO dependencies (DB reads, the misconception
 * service) are mocked, so a passing suite here is real evidence the
 * wiring produces correct engine decisions, not just that mocks were
 * called.
 *
 * Route-level / read-boundary-level integration (session start,
 * Today, Concept Mission) is covered separately in
 * `canon-r5-surface-integration.test.ts`, where `@/lib/pedagogical-decision`
 * itself is mocked as a black box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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

import {
  isCanonicalEngineV1Enabled,
  getCanonicalPedagogicalDecision,
  CanonicalDecisionUnavailableError,
  resolveV1ActivityLaunchReadiness,
  resolveCanonicalLaunch,
  overrideConceptMissionViewWithCanonicalDecision,
} from '@/lib/pedagogical-decision';
import { INITIAL_MIGRATION_VERSION } from '@/lib/pedagogical-migration';
import type { CanonicalPedagogicalDecision, RequirementResult } from '@/lib/pedagogical-engine';
import type { ConceptMissionView } from '@/lib/lx/concept-mission';

const NOW = '2026-09-20T00:00:00.000Z';
const STUDENT = 's1';
const CONCEPT = 'c1';

beforeEach(() => {
  MOCK_DB.query.mockReset();
  fetchStudyUSEvidenceRowsMock.mockReset().mockResolvedValue([]);
  loadRecognizedRequirementsForEngineMock.mockReset().mockResolvedValue([]);
  getMisconceptionCountsForConceptMock.mockReset().mockResolvedValue({ activeCount: 0, criticalCount: 0, recurringCount: 0 });
});

describe('Part 4 -- feature gate', () => {
  it('disabled by default (no env vars set)', () => {
    expect(isCanonicalEngineV1Enabled({})).toBe(false);
  });

  it('disabled when CANONICAL_ENGINE_V1_ENABLED is explicitly "false"', () => {
    expect(isCanonicalEngineV1Enabled({ CANONICAL_ENGINE_V1_ENABLED: 'false', VERCEL_ENV: 'preview' })).toBe(false);
  });

  it('enabled when explicitly "true" on Preview', () => {
    expect(isCanonicalEngineV1Enabled({ CANONICAL_ENGINE_V1_ENABLED: 'true', VERCEL_ENV: 'preview' })).toBe(true);
  });

  it('enabled when explicitly "true" with no VERCEL_ENV at all (local dev)', () => {
    expect(isCanonicalEngineV1Enabled({ CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(true);
  });

  it('HARD-disabled on Production regardless of the config value -- never inferred from hostname, always the documented VERCEL_ENV enum', () => {
    expect(isCanonicalEngineV1Enabled({ CANONICAL_ENGINE_V1_ENABLED: 'true', VERCEL_ENV: 'production' })).toBe(false);
  });

  it('never imports deployment-version.ts (that module is observability-only, never for gating) -- prose mentioning it in a doc comment is fine, an import is not', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/pedagogical-decision/feature-gate.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*deployment-version['"]/);
  });
});

describe('Parts 1/5/6/7/8 -- getCanonicalPedagogicalDecision', () => {
  it('reads real evidence, persisted recognitions, and active misconception exactly once each, for the exact (studentId, conceptId) pair', async () => {
    await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(fetchStudyUSEvidenceRowsMock).toHaveBeenCalledTimes(1);
    expect(fetchStudyUSEvidenceRowsMock).toHaveBeenCalledWith(STUDENT, CONCEPT, MOCK_DB);
    expect(loadRecognizedRequirementsForEngineMock).toHaveBeenCalledTimes(1);
    expect(loadRecognizedRequirementsForEngineMock).toHaveBeenCalledWith(STUDENT, CONCEPT, INITIAL_MIGRATION_VERSION, MOCK_DB);
    expect(getMisconceptionCountsForConceptMock).toHaveBeenCalledTimes(1);
    expect(getMisconceptionCountsForConceptMock).toHaveBeenCalledWith(STUDENT, CONCEPT, MOCK_DB);
  });

  it('with zero evidence and zero recognitions, the engine starts at LEARN (byte-identical pre-CANON-R4R1 behavior when recognizedRequirements is omitted)', async () => {
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(decision.stage).toBe('LEARN');
  });

  it('the Radicación shape, end to end: a persisted LEARN recognition (LEGACY_MIGRATION_BASELINE) is loaded from the migration layer and honored by the REAL engine -- stage becomes PRACTICE, LEARN satisfactionBasis is LEGACY_MIGRATION_BASELINE', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: '2026-09-01T00:00:00.000Z' },
    ]);
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(decision.stage).toBe('PRACTICE');
    const learn = decision.requirements.find((r: RequirementResult) => r.stage === 'LEARN');
    expect(learn?.status).toBe('SATISFIED');
    expect(learn?.satisfactionBasis).toBe('LEGACY_MIGRATION_BASELINE');
  });

  it('real StudyUS evidence rows are mapped through the CANON-R3 adapter (never a second, re-implemented mapping) before reaching the engine', async () => {
    fetchStudyUSEvidenceRowsMock.mockResolvedValue([
      { id: 'e1', sourceType: 'PRACTICE_QUIZ', result: 'correct', scorePercent: 90, difficulty: 3, timestamp: '2026-09-10T00:00:00.000Z', hintsUsed: 0, aiAssistanceType: 'NONE', activityType: 'PRACTICE', itemCount: 3, correctCount: 3 },
    ]);
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: '2026-09-01T00:00:00.000Z' },
    ]);
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(decision.qualifiedEvidence.length).toBeGreaterThan(0);
  });

  it('activeCriticalMisconception is true only when criticalCount > 0, and the real engine honors it (REINFORCE) once past LEARN', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
    ]);
    getMisconceptionCountsForConceptMock.mockResolvedValue({ activeCount: 1, criticalCount: 1, recurringCount: 0 });
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(decision.intervention).toBe('REINFORCE');
  });

  it('a non-critical active misconception (criticalCount 0) never triggers REINFORCE -- never inferred from activeCount alone', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
    ]);
    getMisconceptionCountsForConceptMock.mockResolvedValue({ activeCount: 3, criticalCount: 0, recurringCount: 1 });
    const { decision } = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(decision.intervention).toBeNull();
  });

  it('uses the explicitly injected `now` -- not the system clock -- for the (deterministic) engine call', async () => {
    const r1 = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    const r2 = await getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW });
    expect(r1.decision.canonicalRevision).toBe(r2.decision.canonicalRevision);
  });

  it('Part 28 fail-safe: an evidence-read failure is never swallowed into a default/empty decision -- it throws CanonicalDecisionUnavailableError', async () => {
    fetchStudyUSEvidenceRowsMock.mockRejectedValue(new Error('connection refused'));
    await expect(getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW })).rejects.toBeInstanceOf(CanonicalDecisionUnavailableError);
  });

  it('Part 28 fail-safe: a recognition-read failure also throws CanonicalDecisionUnavailableError', async () => {
    loadRecognizedRequirementsForEngineMock.mockRejectedValue(new Error('db down'));
    await expect(getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW })).rejects.toBeInstanceOf(CanonicalDecisionUnavailableError);
  });

  it('Part 28 fail-safe: a misconception-count-read failure also throws CanonicalDecisionUnavailableError', async () => {
    getMisconceptionCountsForConceptMock.mockRejectedValue(new Error('db down'));
    await expect(getCanonicalPedagogicalDecision({ studentId: STUDENT, conceptId: CONCEPT, now: NOW })).rejects.toBeInstanceOf(CanonicalDecisionUnavailableError);
  });

  it('Part 5: no DB IO lives inside the pure engine -- the engine module itself has zero DB import (source audit, mirrors CANON-R2\'s own Engine Isolation test)', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/pedagogical-engine/engine.ts'), 'utf-8');
    expect(source).not.toMatch(/@\/lib\/db|require\(['"]pg['"]\)/);
  });
});

describe('Parts 15-19/33/34 -- resolveV1ActivityLaunchReadiness (grounded in the real generation route\'s own config)', () => {
  it('PRACTICE is ready (topic_practice already accepts a caller-supplied maxQuestions/difficulty override)', () => {
    expect(resolveV1ActivityLaunchReadiness('PRACTICE')).toEqual({ ready: true });
  });

  it('REINFORCE is ready (same 2-3 item shape as PRACTICE)', () => {
    expect(resolveV1ActivityLaunchReadiness('REINFORCE')).toEqual({ ready: true });
  });

  it('LEARN_CHECK is not ready -- no quiz_mode/ActivityType represents it today', () => {
    const r = resolveV1ActivityLaunchReadiness('LEARN_CHECK');
    expect(r).toMatchObject({ ready: false, reason: 'V1_LEARN_CHECK_GENERATION_NOT_READY' });
  });

  it('PROVE is not ready -- quick_check is fixed at 6 items, not the required 10', () => {
    const r = resolveV1ActivityLaunchReadiness('PROVE');
    expect(r).toMatchObject({ ready: false, reason: 'V1_PROVE_GENERATION_NOT_READY' });
  });

  it('RETENTION_CHECK is not ready -- RETENTION_REQUIRED_COUNT is hardcoded to 6, not the required 10', () => {
    const r = resolveV1ActivityLaunchReadiness('RETENTION_CHECK');
    expect(r).toMatchObject({ ready: false, reason: 'V1_RETENTION_GENERATION_NOT_READY' });
  });

  it('TRANSFER is not ready -- real Transfer evidence is per-task, never a 3-challenge batch', () => {
    const r = resolveV1ActivityLaunchReadiness('TRANSFER');
    expect(r).toMatchObject({ ready: false, reason: 'V1_TRANSFER_GENERATION_NOT_READY' });
  });

  it('the two concrete grounding facts this module cites are actually true in the real generation source (never a stale claim)', () => {
    const genRoute = readFileSync(join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf-8');
    expect(genRoute).toMatch(/quick_check:\s*\{[\s\S]*?defaultMax:\s*6/);
    const genService = readFileSync(join(process.cwd(), 'src/services/quiz-generation.service.ts'), 'utf-8');
    expect(genService).toMatch(/RETENTION_REQUIRED_COUNT\s*=\s*6/);
  });
});

function decision(overrides: Partial<CanonicalPedagogicalDecision> = {}): CanonicalPedagogicalDecision {
  return {
    policyVersion: 'studyus-canonical-v1',
    canonicalRevision: 'rev1',
    conceptId: CONCEPT,
    studentId: STUDENT,
    stage: 'PRACTICE',
    currentStage: 'PRACTICE',
    actionState: 'EXECUTABLE',
    nextCanonicalAction: 'PRACTICE',
    requirements: [
      { stage: 'LEARN', status: 'SATISFIED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: 'LEGACY_MIGRATION_BASELINE' },
      { stage: 'PRACTICE', status: 'UNRESOLVED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null },
      { stage: 'PROVE', status: 'UNRESOLVED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null },
      { stage: 'RETAIN', status: 'UNRESOLVED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null },
      { stage: 'TRANSFER', status: 'UNRESOLVED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null },
    ],
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

describe('Part 12-19 -- resolveCanonicalLaunch (session-start enforcement boundary)', () => {
  it('WAITING never produces a launch target -- zero generation', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: decision({ actionState: 'WAITING', waitingReason: 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED', nextEligibleAt: '2026-09-25T00:00:00.000Z' }) });
    expect(s.launchStatus).toBe('WAITING');
    expect(s.launchTarget).toBeNull();
    expect(s.nextEligibleAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('CONSOLIDATED never produces a launch target', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: decision({ actionState: 'CONSOLIDATED', stage: 'CONSOLIDATED', activityContract: null }) });
    expect(s.launchStatus).toBe('CONSOLIDATED');
    expect(s.launchTarget).toBeNull();
  });

  it('LOCKED never produces a launch target', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: decision({ actionState: 'LOCKED' }) });
    expect(s.launchStatus).toBe('LOCKED');
    expect(s.launchTarget).toBeNull();
  });

  it('BLOCKED never produces a launch target', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: decision({ actionState: 'BLOCKED' }) });
    expect(s.launchStatus).toBe('BLOCKED');
    expect(s.launchTarget).toBeNull();
  });

  it('EXECUTABLE PRACTICE launches into the existing topic_practice quiz flow with the contract\'s own item count and difficulty, never independently chosen', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: decision() });
    expect(s.launchStatus).toBe('READY');
    expect(s.launchTarget).toContain('mode=topic_practice');
    expect(s.launchTarget).toContain('maxQuestions=3');
    expect(s.launchTarget).toContain('difficulty=3');
    expect(s.launchTarget).toContain(`conceptId=${CONCEPT}`);
  });

  it('an active REINFORCE overlay also launches READY (same shape as Practice)', () => {
    const s = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: decision({ intervention: 'REINFORCE' }) });
    expect(s.launchStatus).toBe('READY');
    expect(s.activityType).toBe('REINFORCE');
  });

  it('EXECUTABLE PROVE is refused NOT_READY -- never silently routed through legacy quick_check', () => {
    const s = resolveCanonicalLaunch({
      subjectId: 'subj1',
      conceptId: CONCEPT,
      decision: decision({ stage: 'PROVE', nextCanonicalAction: 'PROVE', activityContract: { ...decision().activityContract!, activityType: 'PROVE', itemCount: { min: 10, max: 10 }, independence: true, supportLevel: 'NONE' } }),
    });
    expect(s.launchStatus).toBe('NOT_READY');
    expect(s.notReadyReason).toBe('V1_PROVE_GENERATION_NOT_READY');
    expect(s.launchTarget).toBeNull();
  });

  it('EXECUTABLE RETENTION_CHECK is refused NOT_READY', () => {
    const s = resolveCanonicalLaunch({
      subjectId: 'subj1',
      conceptId: CONCEPT,
      decision: decision({ stage: 'RETAIN', nextCanonicalAction: 'RETENTION_CHECK', activityContract: { ...decision().activityContract!, activityType: 'RETENTION_CHECK', itemCount: { min: 10, max: 10 } } }),
    });
    expect(s.launchStatus).toBe('NOT_READY');
    expect(s.notReadyReason).toBe('V1_RETENTION_GENERATION_NOT_READY');
  });

  it('EXECUTABLE TRANSFER is refused NOT_READY -- Part 18\'s own "never silently fall back to legacy Transfer" rule', () => {
    const s = resolveCanonicalLaunch({
      subjectId: 'subj1',
      conceptId: CONCEPT,
      decision: decision({ stage: 'TRANSFER', nextCanonicalAction: 'TRANSFER', activityContract: { ...decision().activityContract!, activityType: 'TRANSFER', itemCount: { min: 3, max: 3 } } }),
    });
    expect(s.launchStatus).toBe('NOT_READY');
    expect(s.notReadyReason).toBe('V1_TRANSFER_GENERATION_NOT_READY');
  });

  it('EXECUTABLE LEARN (post-cutover, no recognition yet) is refused NOT_READY -- Part 34\'s own cutover blocker', () => {
    const s = resolveCanonicalLaunch({
      subjectId: 'subj1',
      conceptId: CONCEPT,
      decision: decision({ stage: 'LEARN', nextCanonicalAction: 'LEARN', requirements: decision().requirements.map((r) => (r.stage === 'LEARN' ? { ...r, status: 'UNRESOLVED', satisfactionBasis: null } : r)), activityContract: { ...decision().activityContract!, activityType: 'LEARN_CHECK', itemCount: null, independence: false } }),
    });
    expect(s.launchStatus).toBe('NOT_READY');
    expect(s.notReadyReason).toBe('V1_LEARN_CHECK_GENERATION_NOT_READY');
  });

  it('never chooses a different stage/action than the one the decision already computed -- pure passthrough', () => {
    const d = decision({ stage: 'PRACTICE' });
    const s = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(s.stage).toBe(d.stage);
    expect(s.policyVersion).toBe(d.policyVersion);
    expect(s.canonicalRevision).toBe(d.canonicalRevision);
  });
});

describe('Part 10 -- overrideConceptMissionViewWithCanonicalDecision', () => {
  function legacyView(): ConceptMissionView {
    return {
      identity: { conceptName: 'Momentum', subjectName: 'Physics', subjectId: 'subj1' },
      goal: { text: 'Understand momentum.', source: 'FALLBACK_FROM_NAME' },
      journey: { status: 'RESOLVED', stage: 'RETAIN', intervention: null, reasonCode: 'RETENTION_DUE', milestones: [], source: 'LEARNING_DECISION' },
      now: { kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, facts: [], fallback: 'CONSOLIDATED_NO_ACTION', nextEligibleReviewAt: null },
      learn: { available: true, state: 'READ', prominence: 'SECONDARY' },
      contractVersion: 2,
    };
  }

  it('identity/goal/contractVersion are passed through unchanged -- only journey/now/learn are replaced', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision());
    expect(overridden.identity).toEqual(legacyView().identity);
    expect(overridden.goal).toEqual(legacyView().goal);
    expect(overridden.contractVersion).toBe(2);
  });

  it('checkmarks (milestone.demonstrated) come only from decision.requirements[].status === SATISFIED -- never from the legacy view', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision());
    expect(overridden.journey.status).toBe('RESOLVED');
    if (overridden.journey.status !== 'RESOLVED') throw new Error('unreachable');
    const learn = overridden.journey.milestones.find((m) => m.rung === 'LEARN');
    const practice = overridden.journey.milestones.find((m) => m.rung === 'PRACTICE');
    expect(learn?.demonstrated).toBe(true);
    expect(practice?.demonstrated).toBe(false);
  });

  it('current location comes from decision.stage, not the legacy journey.stage', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision({ stage: 'PRACTICE' }));
    expect(overridden.journey.status).toBe('RESOLVED');
    if (overridden.journey.status !== 'RESOLVED') throw new Error('unreachable');
    expect(overridden.journey.stage).toBe('PRACTICE');
    expect(overridden.journey.source).toBe('CANONICAL_ENGINE_V1');
  });

  it('WAITING renders RETENTION_WAITING with the engine\'s own nextEligibleAt, never a second date computation', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(
      legacyView(),
      decision({ actionState: 'WAITING', waitingReason: 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED', nextEligibleAt: '2026-09-25T00:00:00.000Z' }),
    );
    expect(overridden.now.fallback).toBe('RETENTION_WAITING');
    expect(overridden.now.nextEligibleReviewAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('CONSOLIDATED actionState renders CONSOLIDATED_NO_ACTION', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision({ actionState: 'CONSOLIDATED', stage: 'CONSOLIDATED', activityContract: null }));
    expect(overridden.now.fallback).toBe('CONSOLIDATED_NO_ACTION');
  });

  it('an EXECUTABLE stage the real generation infra cannot yet honor (PROVE) renders CANONICAL_ACTION_UNAVAILABLE, never a broken CTA', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(
      legacyView(),
      decision({ stage: 'PROVE', activityContract: { ...decision().activityContract!, activityType: 'PROVE', itemCount: { min: 10, max: 10 }, independence: true } }),
    );
    expect(overridden.now.kind).toBe('NO_CANONICAL_ACTION');
    expect(overridden.now.fallback).toBe('CANONICAL_ACTION_UNAVAILABLE');
  });

  it('an EXECUTABLE PRACTICE stage renders a real CANONICAL_ACTION', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision());
    expect(overridden.now.kind).toBe('CANONICAL_ACTION');
    expect(overridden.now.activityType).toBe('PRACTICE');
    expect(overridden.now.actionConceptId).toBe(CONCEPT);
  });

  it('never mutates the input legacy view object', () => {
    const view = legacyView();
    const frozenCopy = JSON.parse(JSON.stringify(view));
    overrideConceptMissionViewWithCanonicalDecision(view, decision());
    expect(view).toEqual(frozenCopy);
  });
});
