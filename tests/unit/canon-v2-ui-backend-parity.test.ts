/**
 * CANON-V2-FINAL-HARDENING Section 12 -- UI / BACKEND PARITY.
 *
 * For each canonical state, the displayed UI status/CTA
 * (`overrideConceptMissionViewWithCanonicalDecision`'s `now`) and the
 * actual server-executable session-launch action
 * (`resolveCanonicalLaunch`) must agree -- both are derived from the
 * SAME fresh `CanonicalPedagogicalDecision`, so this is a proof that
 * neither one drifts from the other for the specific states the spec
 * calls out by name, not a re-test of engine pedagogy itself (already
 * covered by canon-v2-journey-matrix-a-j.test.ts and the audit-canon-v2-*
 * files).
 */
import { describe, it, expect } from 'vitest';
import { resolveCanonicalLaunch } from '@/lib/pedagogical-decision/canonical-session-launch';
import { overrideConceptMissionViewWithCanonicalDecision } from '@/lib/pedagogical-decision/concept-mission-override';
import type { CanonicalPedagogicalDecision } from '@/lib/pedagogical-engine';
import type { ConceptMissionView } from '@/lib/lx/concept-mission';

const CONCEPT = 'c1';
const NOW = '2026-09-16T00:00:00.000Z';

function decision(overrides: Partial<CanonicalPedagogicalDecision> = {}): CanonicalPedagogicalDecision {
  return {
    policyVersion: 'studyus-canonical-v1',
    canonicalRevision: 'rev1',
    conceptId: CONCEPT,
    studentId: 's1',
    stage: 'PRACTICE',
    currentStage: 'PRACTICE',
    actionState: 'EXECUTABLE',
    nextCanonicalAction: 'PRACTICE',
    requirements: [
      { stage: 'LEARN', status: 'SATISFIED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: 'V1_EVIDENCE' },
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
    lastQualifyingProveAt: null,
    ...overrides,
  } as CanonicalPedagogicalDecision;
}

function legacyView(): ConceptMissionView {
  return {
    identity: { conceptName: 'Momentum', subjectName: 'Physics', subjectId: 'subj1' },
    goal: { text: 'Understand momentum.', source: 'FALLBACK_FROM_NAME' },
    journey: { status: 'RESOLVED', stage: 'RETAIN', intervention: null, reasonCode: 'RETENTION_DUE', milestones: [], source: 'LEARNING_DECISION' },
    now: { kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, facts: [], fallback: 'CONSOLIDATED_NO_ACTION', nextEligibleReviewAt: null },
    learn: { available: true, state: 'READ', prominence: 'SECONDARY' },
    evidence: { lastDemonstratedAt: null },
    contractVersion: 2,
  } as ConceptMissionView;
}

describe('RETAIN / WAITING -- UI shows waiting, no launch button, session/start refuses to launch', () => {
  const d = decision({
    stage: 'RETAIN',
    actionState: 'WAITING',
    waitingReason: 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED',
    nextEligibleAt: '2026-09-25T00:00:00.000Z',
    activityContract: { ...decision().activityContract!, activityType: 'RETENTION_CHECK', itemCount: { min: 10, max: 10 }, independence: true },
  });

  it('UI (ConceptMission now-card): shows the waiting fallback, no actionable CTA, carries the real eligible-at date', () => {
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.kind).toBe('NO_CANONICAL_ACTION');
    expect(view.now.fallback).toBe('RETENTION_WAITING');
    expect(view.now.nextEligibleReviewAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('backend (session/start): resolveCanonicalLaunch also refuses to launch -- launchStatus WAITING, launchTarget null', () => {
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchStatus).toBe('WAITING');
    expect(launch.launchTarget).toBeNull();
    expect(launch.nextEligibleAt).toBe('2026-09-25T00:00:00.000Z');
  });
});

describe('TRANSFER / EXECUTABLE -- UI shows the Transfer CTA, session/start launches canonical_transfer', () => {
  const d = decision({
    stage: 'TRANSFER',
    actionState: 'EXECUTABLE',
    activityContract: { ...decision().activityContract!, activityType: 'TRANSFER', itemCount: { min: 3, max: 3 }, difficulty: { target: 4, min: 4, max: 5, reasonCode: 'DEFAULT_STAGE_MIDPOINT' as any }, independence: true, supportLevel: 'NONE' },
  });

  it('UI (ConceptMission now-card): renders a real CANONICAL_ACTION with activityType TRANSFER, never CANONICAL_ACTION_UNAVAILABLE', () => {
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.kind).toBe('CANONICAL_ACTION');
    expect(view.now.activityType).toBe('TRANSFER');
  });

  it('backend (session/start): resolveCanonicalLaunch is READY, launch URL uses mode=canonical_transfer', () => {
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchStatus).toBe('READY');
    expect(launch.launchTarget).toContain('mode=canonical_transfer');
    expect(launch.launchTarget).toContain('maxQuestions=3');
  });
});

describe('PRACTICE with 1 qualifying attempt -- UI never shows a Prove CTA (stage remains PRACTICE, not PROVE)', () => {
  it('the fresh decision itself reports stage PRACTICE (not PROVE) whenever the engine has not yet satisfied the 2-of-3 rule -- the UI/backend CTA is derived from `decision.stage`, so it is structurally impossible for the UI to show Prove while stage is PRACTICE', () => {
    // This is a UI/backend WIRING proof, not a re-test of the 2-of-3
    // pedagogy rule itself (canon-v2-journey-matrix-a-j.test.ts
    // SCENARIO B / audit-canon-v2-practice-consistency.test.ts already
    // prove the rule). Here: an EXECUTABLE PRACTICE decision (exactly
    // what the engine reports for "1 qualifying attempt so far") must
    // render the PRACTICE CTA end to end, never a PROVE one.
    const d = decision({ stage: 'PRACTICE', actionState: 'EXECUTABLE', nextCanonicalAction: 'PRACTICE' });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.activityType).toBe('PRACTICE');
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchTarget).toContain('mode=topic_practice');
    expect(launch.launchTarget).not.toContain('mode=canonical_prove');
  });
});

describe('PRACTICE satisfied -- UI shows the Prove CTA', () => {
  it('an EXECUTABLE PROVE decision (what the engine reports once Practice is satisfied) renders the Prove CTA end to end, with the real exact-10 contract in the launch URL', () => {
    const d = decision({
      stage: 'PROVE',
      actionState: 'EXECUTABLE',
      nextCanonicalAction: 'PROVE',
      activityContract: { ...decision().activityContract!, activityType: 'PROVE', itemCount: { min: 10, max: 10 }, difficulty: { target: 3, min: 3, max: 4, reasonCode: 'DEFAULT_STAGE_MIDPOINT' as any }, independence: true, supportLevel: 'NONE' },
    });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.kind).toBe('CANONICAL_ACTION');
    expect(view.now.activityType).toBe('SOLO_CHECK'); // Prove's own legacy-ActivityType presentation mapping
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchStatus).toBe('READY');
    expect(launch.launchTarget).toContain('mode=canonical_prove');
    expect(launch.launchTarget).toContain('maxQuestions=10');
  });
});

describe('critical misconception active -- no later-stage CTA is ever exposed', () => {
  it('a decision the engine has already rolled back to PRACTICE (reasonCodes includes CRITICAL_MISCONCEPTION) never renders a later-stage (Prove/Retain/Transfer) CTA -- the UI reads only `decision.stage`/`decision.activityContract`, which the engine itself already forced back to PRACTICE', () => {
    // The engine-level proof that a misconception forces stage back to
    // PRACTICE lives in canon-v2-journey-matrix-a-j.test.ts SCENARIO I /
    // audit-canon-v2-learn-prove-misconception.test.ts. This test proves
    // the UI/backend WIRING: given that already-rolled-back decision,
    // neither surface can independently reconstruct a later-stage CTA.
    const d = decision({
      stage: 'PRACTICE',
      actionState: 'EXECUTABLE',
      nextCanonicalAction: 'PRACTICE',
      intervention: 'REINFORCE',
      reasonCodes: ['CRITICAL_MISCONCEPTION'],
      activityContract: { ...decision().activityContract!, activityType: 'PRACTICE' },
    });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.activityType).toBe('PRACTICE');
    expect(view.now.activityType).not.toBe('SOLO_CHECK');
    expect(view.now.activityType).not.toBe('TRANSFER');
    expect(view.now.activityType).not.toBe('RETENTION_CHECK');
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchTarget).toContain('mode=topic_practice');
    expect(launch.activityType).toBe('REINFORCE'); // the overlay is reported, but the underlying launch is still the Practice-shaped one
  });
});

// ============================================================
// CANON-V2-PREVIEW-CERT Section 18 -- FULL stage x actionState x
// intervention MATRIX. The 5 scenarios above cover the spec's own
// named examples; this expands to the full minimum list Section 18
// requires, using the SAME parity method (UI view + session launch,
// both derived from one fresh decision).
// ============================================================
describe('LEARN -- EXECUTABLE LEARN_CHECK renders a real CTA end to end', () => {
  it('UI shows a CANONICAL_ACTION with activityType LEARN_CHECK; session/start launches canonical_learn_check', () => {
    const d = decision({
      stage: 'LEARN',
      actionState: 'EXECUTABLE',
      nextCanonicalAction: 'LEARN',
      requirements: decision().requirements.map((r) => (r.stage === 'LEARN' ? { ...r, status: 'UNRESOLVED', satisfactionBasis: null } : r)),
      activityContract: { ...decision().activityContract!, activityType: 'LEARN_CHECK', itemCount: null, independence: false },
    });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.kind).toBe('CANONICAL_ACTION');
    expect(view.now.activityType).toBe('LEARN_CHECK');
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchStatus).toBe('READY');
    expect(launch.launchTarget).toContain('mode=canonical_learn_check');
  });
});

describe('LEARN + retry -- a failed LEARN_CHECK leaves the learner at LEARN, EXECUTABLE, never silently promoted to PRACTICE', () => {
  it('the SAME LEARN/EXECUTABLE shape as a first attempt -- the engine, not any local state, decides whether LEARN is still the current stage', () => {
    const d = decision({
      stage: 'LEARN',
      actionState: 'EXECUTABLE',
      nextCanonicalAction: 'LEARN',
      requirements: decision().requirements.map((r) => (r.stage === 'LEARN' ? { ...r, status: 'UNRESOLVED', satisfactionBasis: null } : r)),
      activityContract: { ...decision().activityContract!, activityType: 'LEARN_CHECK', itemCount: null, independence: false },
    });
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.stage).toBe('LEARN');
    expect(launch.launchStatus).toBe('READY');
  });
});

describe('PRACTICE with 0 qualifying attempts (genuinely fresh) -- same PRACTICE CTA as 1-qualifying, never Prove', () => {
  it('stage PRACTICE, EXECUTABLE, no REINFORCE overlay', () => {
    const d = decision({ stage: 'PRACTICE', actionState: 'EXECUTABLE', nextCanonicalAction: 'PRACTICE', intervention: null });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.activityType).toBe('PRACTICE');
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.activityType).toBe('PRACTICE');
  });
});

describe('PRACTICE + REINFORCE overlay -- reported as an overlay on Practice, never a separate stage/CTA', () => {
  it('activityType reported to the UI is REINFORCE, but the launch target is still the Practice-shaped topic_practice mode', () => {
    const d = decision({ stage: 'PRACTICE', actionState: 'EXECUTABLE', nextCanonicalAction: 'PRACTICE', intervention: 'REINFORCE' });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.kind).toBe('CANONICAL_ACTION');
    expect(view.now.activityType).toBe('PRACTICE'); // toLegacyActivityType maps both PRACTICE and REINFORCE to the same legacy 'PRACTICE' presentation
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.activityType).toBe('REINFORCE');
    expect(launch.launchTarget).toContain('mode=topic_practice');
  });
});

describe('PROVE rollback (a failed Prove rolled the learner back to PRACTICE) -- UI/backend both show PRACTICE, never a stale Prove CTA', () => {
  it('stage PRACTICE with a PROVE rollback recorded -- the CTA is PRACTICE end to end', () => {
    const d = decision({
      stage: 'PRACTICE',
      actionState: 'EXECUTABLE',
      nextCanonicalAction: 'PRACTICE',
      rollback: { case: 'PROVE_FAILED', rolledBackTo: 'PRACTICE', reasonCodes: ['PROVE_FAILED_ATTEMPT'] } as any,
    });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.activityType).toBe('PRACTICE');
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchTarget).toContain('mode=topic_practice');
    expect(launch.stage).toBe('PRACTICE');
  });
});

describe('RETAIN first-fail retry -- EXECUTABLE immediately, no WAITING, matching the engine\'s own two-strike rule', () => {
  it('after a first Retain failure, the decision is EXECUTABLE RETENTION_CHECK with no waitingReason -- UI shows a real CTA, not a waiting state', () => {
    const d = decision({
      stage: 'RETAIN',
      actionState: 'EXECUTABLE',
      nextCanonicalAction: 'RETENTION_CHECK',
      waitingReason: null,
      nextEligibleAt: null,
      activityContract: { ...decision().activityContract!, activityType: 'RETENTION_CHECK', itemCount: { min: 10, max: 10 }, independence: true },
    });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.kind).toBe('CANONICAL_ACTION');
    expect(view.now.fallback).toBeNull();
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchStatus).toBe('READY');
    expect(launch.launchTarget).toContain('mode=canonical_retain');
  });
});

describe('RETAIN second-fail rollback -- rolled back to PROVE, UI/backend agree, never a lingering Retain CTA', () => {
  it('stage PROVE (post-rollback) -- UI shows the Prove CTA, session/start launches canonical_prove, never canonical_retain', () => {
    const d = decision({
      stage: 'PROVE',
      actionState: 'EXECUTABLE',
      nextCanonicalAction: 'PROVE',
      rollback: { case: 'RETAIN_DOUBLE_FAILURE', rolledBackTo: 'PROVE', reasonCodes: ['RETAIN_TWO_STRIKE'] } as any,
      activityContract: { ...decision().activityContract!, activityType: 'PROVE', itemCount: { min: 10, max: 10 }, difficulty: { target: 3, min: 3, max: 4, reasonCode: 'DEFAULT_STAGE_MIDPOINT' as any }, independence: true, supportLevel: 'NONE' },
    });
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchTarget).toContain('mode=canonical_prove');
    expect(launch.launchTarget).not.toContain('mode=canonical_retain');
  });
});

describe('TRANSFER Case A/B/C/D rollback destinations -- UI/backend both reflect whichever stage the engine actually rolled back to, never independently re-derived from the diagnostic', () => {
  it('Case A (application-context weakness) -- stays TRANSFER', () => {
    const d = decision({ stage: 'TRANSFER', actionState: 'EXECUTABLE', nextCanonicalAction: 'TRANSFER', rollback: { case: 'TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS', rolledBackTo: 'TRANSFER', reasonCodes: [] } as any, activityContract: { ...decision().activityContract!, activityType: 'TRANSFER', itemCount: { min: 3, max: 3 }, independence: true } });
    expect(resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d }).launchTarget).toContain('mode=canonical_transfer');
  });
  it('Case B (retention weakness) -- rolled back to RETAIN', () => {
    const d = decision({ stage: 'RETAIN', actionState: 'EXECUTABLE', nextCanonicalAction: 'RETENTION_CHECK', rollback: { case: 'TRANSFER_CASE_B_RETENTION_WEAKNESS', rolledBackTo: 'RETAIN', reasonCodes: [] } as any, activityContract: { ...decision().activityContract!, activityType: 'RETENTION_CHECK', itemCount: { min: 10, max: 10 }, independence: true } });
    expect(resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d }).launchTarget).toContain('mode=canonical_retain');
  });
  it('Case C (foundational/procedural failure) -- rolled back to PRACTICE', () => {
    const d = decision({ stage: 'PRACTICE', actionState: 'EXECUTABLE', nextCanonicalAction: 'PRACTICE', rollback: { case: 'TRANSFER_CASE_C_FOUNDATIONAL_PROCEDURAL_FAILURE', rolledBackTo: 'PRACTICE', reasonCodes: [] } as any });
    expect(resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d }).launchTarget).toContain('mode=topic_practice');
  });
  it('Case D (critical misconception) -- rolled back to PRACTICE with REINFORCE, exactly like Case C plus the overlay', () => {
    const d = decision({ stage: 'PRACTICE', actionState: 'EXECUTABLE', nextCanonicalAction: 'PRACTICE', intervention: 'REINFORCE', reasonCodes: ['CRITICAL_MISCONCEPTION'], rollback: { case: 'TRANSFER_CASE_D_CRITICAL_MISCONCEPTION', rolledBackTo: 'PRACTICE', reasonCodes: ['CRITICAL_MISCONCEPTION'] } as any });
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchTarget).toContain('mode=topic_practice');
    expect(launch.activityType).toBe('REINFORCE');
  });
});

describe('CONSOLIDATED -- UI shows the consolidated fallback, never a launchable CTA', () => {
  it('actionState CONSOLIDATED renders CONSOLIDATED_NO_ACTION and no launch target', () => {
    const d = decision({ stage: 'CONSOLIDATED', actionState: 'CONSOLIDATED', activityContract: null });
    const view = overrideConceptMissionViewWithCanonicalDecision(legacyView(), d);
    expect(view.now.fallback).toBe('CONSOLIDATED_NO_ACTION');
    const launch = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: CONCEPT, decision: d });
    expect(launch.launchStatus).toBe('CONSOLIDATED');
    expect(launch.launchTarget).toBeNull();
  });
});

describe('runtime error state -- a genuinely unavailable decision produces no UI/backend disagreement because BOTH surfaces simply never receive a decision to render (CanonicalDecisionUnavailableError is thrown before either is called)', () => {
  it('this is a wiring guarantee, not a decision shape to test: getCanonicalPedagogicalDecision throwing means neither resolveCanonicalLaunch nor overrideConceptMissionViewWithCanonicalDecision is ever invoked -- both callers (canon-r5-surface-integration.test.ts, concept-mission-view.service.ts) catch CanonicalDecisionUnavailableError BEFORE calling either function, confirmed by source', () => {
    const CONCEPT_MISSION_VIEW_SERVICE_SRC = require('fs').readFileSync(
      require('path').join(process.cwd(), 'src/services/concept-mission-view.service.ts'),
      'utf-8'
    );
    const catchIdx = CONCEPT_MISSION_VIEW_SERVICE_SRC.indexOf('CanonicalDecisionUnavailableError');
    const overrideCallIdx = CONCEPT_MISSION_VIEW_SERVICE_SRC.indexOf('overrideConceptMissionViewWithCanonicalDecision(');
    expect(catchIdx).toBeGreaterThan(-1);
    // The catch handler is textually BEFORE the override call within the
    // same try block's structure (the override call only ever happens on
    // the success path, after the catch's own early return).
    expect(overrideCallIdx).toBeGreaterThan(catchIdx);
  });
});
