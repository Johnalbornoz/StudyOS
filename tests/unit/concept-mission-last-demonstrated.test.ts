/**
 * CANONICAL V2 SEMANTIC CONSISTENCY FIX -- Concept Detail "Last
 * demonstrated".
 *
 * PROBLEM: the Concept Detail UI rendered `conceptDetail.lastDemonstrated`
 * from `conceptView.memory.lastSuccessfulRetentionAt` -- a successful
 * RETAIN event, not the canonical PROVE event that actually demonstrates
 * independent competence. The canonical engine already owns the correct
 * value internally as `state.proveQualifyingAt` (`replay()`'s own
 * PROVE-qualification accumulator, also the exact anchor its own
 * RETAIN-eligibility computation already uses).
 *
 * FIX: `CanonicalPedagogicalDecision.lastQualifyingProveAt` exposes that
 * value verbatim (never independently recomputed). `ConceptMissionView`
 * gets a new, presentation-safe `evidence.lastDemonstratedAt` projection
 * (deliberately NOT inside `ConceptMissionMemory`, which is a RETAIN/
 * memory fact, not a PROVE fact) -- `null` on the legacy/gate-off path
 * (no equivalent source there), and populated from
 * `decision.lastQualifyingProveAt` by
 * `overrideConceptMissionViewWithCanonicalDecision` when the canonical
 * gate is on. Concept Detail now reads `missionView.evidence.lastDemonstratedAt`
 * instead of `conceptView.memory.lastSuccessfulRetentionAt`.
 *
 * This file covers Tests A-G from the task spec. A-E exercise the real,
 * unmocked engine (`evaluateCanonicalLearningState`) directly -- no DB,
 * no React. F exercises the real `overrideConceptMissionViewWithCanonicalDecision`.
 * G is a source-level assertion that the Concept Detail page no longer
 * sources this value from `memory.lastSuccessfulRetentionAt`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  evaluateCanonicalLearningState,
  CANONICAL_POLICY,
  type RawEvidenceItem,
  type PedagogicalEngineInput,
  type CanonicalPedagogicalDecision,
} from '@/lib/pedagogical-engine';
import {
  overrideConceptMissionViewWithCanonicalDecision,
} from '@/lib/pedagogical-decision/concept-mission-override';
import type { ConceptMissionView } from '@/lib/lx/concept-mission';

/* ------------------------------------------------------------------ */
/* Fixtures -- same conventions as canon-r2-pedagogical-engine.test.ts */
/* ------------------------------------------------------------------ */

function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    activityType: 'PRACTICE',
    timestamp: '2026-01-01T00:00:00.000Z',
    itemCount: 3,
    correctCount: 3,
    scorePercent: 100,
    independent: false,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}

function learnCheckItem(ts: string, score = 90): RawEvidenceItem {
  return item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 5, correctCount: Math.round((score / 100) * 5), scorePercent: score, difficulty: 1.5, independent: false });
}
const LEARNED_ITEM = learnCheckItem('2025-12-31T00:00:00.000Z', 90);

function practiceItem(ts: string, score = 90): RawEvidenceItem {
  return item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((score / 100) * 3), scorePercent: score, difficulty: 3, independent: false });
}

function proveItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({
    activityType: 'PROVE', timestamp: ts, itemCount: 10,
    correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true,
    ...opts,
  });
}

function retentionItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({
    activityType: 'RETENTION_CHECK', timestamp: ts, itemCount: 10,
    correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, novel: true,
    ...opts,
  });
}

/** LEARN + 2 qualifying PRACTICE attempts + 1 qualifying PROVE, anchored day0-2. */
function provenLedger(): RawEvidenceItem[] {
  return [
    LEARNED_ITEM,
    practiceItem('2026-01-01T00:00:00.000Z', 90),
    practiceItem('2026-01-01T01:00:00.000Z', 90),
    proveItem('2026-01-02T00:00:00.000Z', 90),
  ];
}

const PROVE_TS = '2026-01-02T00:00:00.000Z';
/** proveQualifyingAt + minimumWaitDays(3), computed independently here only to express the EXPECTED value a test asserts against -- never a second implementation the production code shares. */
const ELIGIBLE_FROM = new Date(new Date(PROVE_TS).getTime() + CANONICAL_POLICY.retention.minimumWaitDays * 86400000).toISOString();

function baseInput(overrides: Partial<PedagogicalEngineInput> = {}): PedagogicalEngineInput {
  return {
    conceptId: 'concept-1',
    studentId: 'student-1',
    now: '2026-01-01T00:00:00.000Z',
    evidence: [],
    activeCriticalMisconception: false,
    ...overrides,
  };
}

describe('TEST A -- before qualifying PROVE, lastQualifyingProveAt is null', () => {
  it('LEARN + PRACTICE only (no PROVE evidence at all)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ now: '2026-01-01T02:00:00.000Z', evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90)] }),
    );
    expect(decision.stage).toBe('PROVE');
    expect(decision.lastQualifyingProveAt).toBeNull();
  });

  it('a PROVE attempt that FAILS to qualify (score below the bar) never sets lastQualifyingProveAt', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        now: '2026-01-02T01:00:00.000Z',
        evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90), proveItem(PROVE_TS, 40)],
      }),
    );
    expect(decision.lastQualifyingProveAt).toBeNull();
  });
});

describe('TEST B -- after a qualifying PROVE, lastQualifyingProveAt equals the exact qualifying timestamp', () => {
  it('matches the qualifying PROVE evidence item\'s own timestamp, verbatim', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ now: '2026-01-02T01:00:00.000Z', evidence: provenLedger() }));
    expect(decision.stage).toBe('RETAIN');
    expect(decision.lastQualifyingProveAt).toBe(PROVE_TS);
  });

  it('when multiple PROVE attempts qualify over time, the value is the MOST RECENT qualifying one', () => {
    const secondProveTs = '2026-01-10T00:00:00.000Z';
    const decision = evaluateCanonicalLearningState(
      baseInput({ now: '2026-01-10T01:00:00.000Z', evidence: [...provenLedger(), retentionItem(ELIGIBLE_FROM, 95), proveItem(secondProveTs, 95)] }),
    );
    expect(decision.lastQualifyingProveAt).toBe(secondProveTs);
  });
});

describe('TEST C -- RETAIN WAITING: nextEligibleAt remains qualifying PROVE timestamp + 3 days (the 3-day minimum is unchanged)', () => {
  it('exactly matches proveQualifyingAt + CANONICAL_POLICY.retention.minimumWaitDays', () => {
    // `now` is after the Prove but before the 3-day wait elapses.
    const decision = evaluateCanonicalLearningState(baseInput({ now: '2026-01-03T00:00:00.000Z', evidence: provenLedger() }));
    expect(decision.stage).toBe('RETAIN');
    expect(decision.actionState).toBe('WAITING');
    expect(decision.nextEligibleAt).toBe(ELIGIBLE_FROM);
    expect(CANONICAL_POLICY.retention.minimumWaitDays).toBe(3); // the interval itself must stay 3 days
    // lastQualifyingProveAt is the exact anchor nextEligibleAt was computed from.
    expect(decision.lastQualifyingProveAt).toBe(PROVE_TS);
  });
});

describe('TEST D -- a later successful RETAIN must NOT redefine lastQualifyingProveAt', () => {
  it('lastQualifyingProveAt stays the original PROVE timestamp after a qualifying RETAIN', () => {
    const retentionTs = '2026-01-10T00:00:00.000Z';
    const decision = evaluateCanonicalLearningState(
      baseInput({ now: '2026-01-10T01:00:00.000Z', evidence: [...provenLedger(), retentionItem(retentionTs, 90)] }),
    );
    const retainReq = decision.requirements.find((r) => r.stage === 'RETAIN');
    expect(retainReq?.status).toBe('SATISFIED');
    // The RETAIN success timestamp must NOT leak into the PROVE field.
    expect(decision.lastQualifyingProveAt).toBe(PROVE_TS);
    expect(decision.lastQualifyingProveAt).not.toBe(retentionTs);
  });
});

describe('TEST E -- an existing canonical rollback that invalidates PROVE also nulls lastQualifyingProveAt (following replay\'s existing state, never a new reset added for this fix)', () => {
  it('two consecutive genuine RETAIN failures (Policy V2\'s own two-strike rule) roll back to PROVE and clear lastQualifyingProveAt', () => {
    const firstFailTs = new Date(new Date(ELIGIBLE_FROM).getTime() + 86400000).toISOString(); // 1 day after eligibility
    const secondFailTs = new Date(new Date(firstFailTs).getTime() + 86400000).toISOString();
    const decision = evaluateCanonicalLearningState(
      baseInput({
        now: new Date(new Date(secondFailTs).getTime() + 3600000).toISOString(),
        evidence: [...provenLedger(), retentionItem(firstFailTs, 40), retentionItem(secondFailTs, 40)],
      }),
    );
    expect(decision.rollback?.case).toBe('RETENTION_FAILURE_RETURN_TO_PROVE');
    expect(decision.stage).toBe('PROVE');
    expect(decision.lastQualifyingProveAt).toBeNull();
  });
});

describe('TEST F -- Concept Mission canonical override maps decision.lastQualifyingProveAt -> view.evidence.lastDemonstratedAt', () => {
  function legacyView(): ConceptMissionView {
    return {
      identity: { conceptName: 'Radicacion de numeros enteros', subjectName: 'Math', subjectId: 'subj1' },
      goal: { text: 'Understand this concept.', source: 'FALLBACK_FROM_NAME' },
      journey: { status: 'RESOLVED', stage: 'RETAIN', intervention: null, reasonCode: 'RETENTION_DUE', milestones: [], source: 'LEARNING_DECISION' },
      now: { kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, facts: [], fallback: 'CONSOLIDATED_NO_ACTION', nextEligibleReviewAt: null },
      learn: { available: true, state: 'READ', prominence: 'SECONDARY' },
      // Legacy path's own honest default -- must be REPLACED, not merely preserved, by the override.
      evidence: { lastDemonstratedAt: null },
      contractVersion: 2,
    };
  }

  function decision(overrides: Partial<CanonicalPedagogicalDecision> = {}): CanonicalPedagogicalDecision {
    return {
      policyVersion: 'studyus-canonical-v1', canonicalRevision: 'rev1', conceptId: 'c1', studentId: 's1',
      stage: 'RETAIN', currentStage: 'RETAIN', actionState: 'EXECUTABLE', nextCanonicalAction: 'RETENTION_CHECK',
      requirements: [], qualifiedEvidence: [], activityContract: null,
      waitingReason: null, nextEligibleAt: null, intervention: null, rollback: null, reasonCodes: [],
      journeyProgressPercent: 60, computedAt: '2026-01-10T00:00:00.000Z', recognitionRejected: null,
      lastQualifyingProveAt: PROVE_TS,
      ...overrides,
    };
  }

  it('a real PROVE timestamp on the decision is copied verbatim into view.evidence.lastDemonstratedAt', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision());
    expect(overridden.evidence.lastDemonstratedAt).toBe(PROVE_TS);
  });

  it('null on the decision (no qualifying PROVE yet) is copied verbatim -- never a fabricated fallback date', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision({ lastQualifyingProveAt: null }));
    expect(overridden.evidence.lastDemonstratedAt).toBeNull();
  });

  it('every other field the override already owns (journey/now/learn) is unaffected by this addition', () => {
    const overridden = overrideConceptMissionViewWithCanonicalDecision(legacyView(), decision({ stage: 'PRACTICE', actionState: 'EXECUTABLE' }));
    expect(overridden.journey.status).toBe('RESOLVED');
    if (overridden.journey.status === 'RESOLVED') expect(overridden.journey.stage).toBe('PRACTICE');
    expect(overridden.identity).toEqual(legacyView().identity); // untouched
  });
});

describe('TEST G -- Concept Detail presentation no longer sources "lastDemonstrated" from memory.lastSuccessfulRetentionAt', () => {
  const pagePath = join(process.cwd(), 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx');
  const source = readFileSync(pagePath, 'utf-8');

  it('the canonical PROVE-fact projection (missionView.evidence.lastDemonstratedAt) is what feeds the rendered "Last demonstrated" row', () => {
    expect(source).toMatch(/missionView\.evidence\.lastDemonstratedAt/);
    expect(source).toMatch(/relativeDay\(lastDemonstratedAt,\s*t\)/);
  });

  it('"Last demonstrated" is never sourced from conceptView.memory.lastSuccessfulRetentionAt (a RETAIN fact, not a PROVE fact)', () => {
    // memory.lastSuccessfulRetentionAt itself must still exist in this
    // file (Requirement 6 -- its own semantics are preserved elsewhere
    // on the page), but it must never be assigned to the variable that
    // feeds the lastDemonstrated row.
    expect(source).toMatch(/lastSuccessfulRetentionAt/); // still present, untouched, used elsewhere
    expect(source).not.toMatch(/lastDemonstratedAt\s*=\s*conceptView\??\.memory\.lastSuccessfulRetentionAt/);
  });

  it('memory.nextReviewAt and its retention-waiting usage are untouched by this fix', () => {
    expect(source).toMatch(/nextReviewDate\s*=\s*conceptView\?\.memory\.nextReviewAt\s*\?\?\s*null/);
  });
});

describe('Preserved semantics -- Requirement 6 (memory/RETAIN facts and the 3-day policy stay exactly as they were)', () => {
  it('CANONICAL_POLICY.retention.minimumWaitDays is still 3 -- this fix never touches the RETAIN policy', () => {
    expect(CANONICAL_POLICY.retention.minimumWaitDays).toBe(3);
  });

  it('a qualifying RETAIN evidence item still independently satisfies the RETAIN requirement exactly as before (unrelated to lastQualifyingProveAt)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ now: '2026-01-10T01:00:00.000Z', evidence: [...provenLedger(), retentionItem('2026-01-10T00:00:00.000Z', 90)] }),
    );
    const retainReq = decision.requirements.find((r) => r.stage === 'RETAIN');
    expect(retainReq?.status).toBe('SATISFIED');
  });
});
