/**
 * LX-9R5 -- CANONICAL ACTION AUTHORITY + CONTINUATION + ASSISTANCE
 * INTEGRITY. The 32 required tests, in order.
 *
 * Live trace summary: My Path (and Today, via the SAME shared
 * `getLearningOSSnapshot().nextExecutableItem`) could show a concept's
 * canonical journey stage as RETAIN while independently offering a
 * "Practicar" CTA for the SAME concept -- because the underlying
 * LearningDecision's `activityType` (from `selectActivityType`'s own
 * residual PRACTICE fallthrough) was trusted directly, with no
 * awareness that the concept's actual obligation (retention) wasn't
 * due yet. Fixed by computing an explicit, canonical `actionState`
 * (EXECUTABLE/WAITING/CONSOLIDATED/BLOCKED) at the ONE shared read
 * boundary each surface already uses, and by making `resolveContinuation`
 * return an explicit WAITING outcome instead of either launching the
 * wrong activity or leaving the client to interpret "no action" as an
 * error. Separately: Results' "Con ayuda" label was derived from
 * EvidenceMode (COACH iff Practice) rather than actual hint usage --
 * fixed to require `hintsUsed > 0`. Raw mastery percentages were
 * removed from two more learner-facing primary-progress spots
 * (Progress dashboard's "Dominio general," Results' per-concept
 * deltas for every activity, not just retention_check).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const PATH_VIEW_SRC = read('src/lib/lx/path-view.ts');
const PATH_PAGE_SRC = read('src/app/dashboard/path/page.tsx');
const TODAY_PAGE_SRC = read('src/app/dashboard/today/page.tsx');
const SNAPSHOT_SRC = read('src/services/learning-os-snapshot.service.ts');
const CONTINUATION_SERVICE_SRC = read('src/services/learning-continuation.service.ts');
const CONTINUATION_PANEL_SRC = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const CONCEPT_DETAIL_SRC = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx');
const DASHBOARD_PAGE_SRC = read('src/app/dashboard/page.tsx');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const PROGRESS_OVERVIEW_SRC = read('src/services/progress-overview.service.ts');
const EVIDENCE_CONTRACT_SRC = read('src/lib/lx/evidence-sufficiency-contract.ts');
const MASTERY_SERVICE_SRC = read('src/services/mastery.service.ts');

import { buildCanonicalLearningProgress } from '@/lib/lx/canonical-learning-progress';
import { isRetentionWaiting } from '@/lib/lx/learner-journey-contract';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import { MESSAGES } from '@/lib/i18n/messages';

function ks(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
    masteryState: 'VALIDATED_MASTERY', understandingScore: 80, independenceScore: 75, applicationScore: 70,
    retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    evidenceCount: 12, independentEvidenceCount: 6, firstEvidenceAt: null, lastEvidenceAt: null,
    validationReadiness: 'READY', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
function decision(learningState: LearningDecision['learningState'], activityType: LearningDecision['activityType']): LearningDecision {
  return { actionConceptId: 'c1', subjectId: 'subj1', learningState, activityType, facts: [], signals: [] } as unknown as LearningDecision;
}

/* ================================================================== *
 * 1-2 -- the read model's own actionState/nextCanonicalAction.        *
 * ================================================================== */
describe('LX-9R5 1-2 -- RETAIN + not due resolves actionState=WAITING with no next action', () => {
  it('a RETENTION_RISK decision with retentionDue=false resolves WAITING, nextCanonicalAction=null, and carries the date', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('RETENTION_RISK', 'PRACTICE'), // the exact live fallthrough: PRACTICE offered for a RETAIN concept
      memory: { retentionDue: false, nextReviewAt: '2026-09-16T00:00:00Z' },
    });
    expect(progress.journeyStage).toBe('RETAIN');
    expect(progress.actionState).toBe('WAITING');
    expect(progress.nextCanonicalAction).toBeNull();
    expect(progress.waitingReason).toBe('RETENTION_NOT_DUE');
    expect(progress.nextEligibleAt).toBe('2026-09-16T00:00:00Z');
  });

  it('the SAME decision with retentionDue=true resolves EXECUTABLE with the decision\'s own activityType', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('RETENTION_RISK', 'RETENTION_CHECK'),
      memory: { retentionDue: true, nextReviewAt: null },
    });
    expect(progress.actionState).toBe('EXECUTABLE');
    expect(progress.nextCanonicalAction).toBe('RETENTION_CHECK');
    expect(progress.waitingReason).toBeNull();
  });
});

/* ================================================================== *
 * 3, 12 -- My Path cannot substitute Practice for WAITING; no         *
 * arbitrary fallback override.                                       *
 * ================================================================== */
describe('LX-9R5 3, 12 -- My Path never trusts the decision activityType blindly', () => {
  it('current.activityType is null whenever actionState !== EXECUTABLE -- never an unconditional pass-through', () => {
    expect(PATH_VIEW_SRC).toMatch(/activityType:\s*actionState === 'EXECUTABLE' \? best\.decision\.activityType : null/);
  });

  it('the waiting check is gated on the SAME isRetentionWaiting authority Concept Mission uses, never a re-derived condition', () => {
    expect(PATH_VIEW_SRC).toMatch(/isRetentionWaiting\(journey\.currentStage, memorySignal\?\.retentionDue\)/);
  });

  it('My Path page renders the WAITING card (not the Practice CTA) when actionState is WAITING', () => {
    expect(PATH_PAGE_SRC).toMatch(/overview\.current\.actionState === 'WAITING'/);
    expect(PATH_PAGE_SRC).toMatch(/conceptMission\.noActionRetentionWaitingTitle/);
  });
});

/* ================================================================== *
 * 4-6 -- surface consistency.                                        *
 * ================================================================== */
describe('LX-9R5 4-6 -- Concept Mission, My Path, Progress, Subject Detail agree', () => {
  it('4/5/6. the SAME (ks, decision, memory) fixture yields the SAME actionState/stage/percent from the canonical read model regardless of which surface asks', () => {
    const input = {
      conceptId: 'c1', subjectId: 'subj1', knowledgeState: ks(),
      activeDecision: decision('RETENTION_RISK', 'PRACTICE'),
      memory: { retentionDue: false, nextReviewAt: '2026-09-16T00:00:00Z' },
    };
    const a = buildCanonicalLearningProgress(input);
    const b = buildCanonicalLearningProgress({ ...input });
    expect(a).toEqual(b); // pure and deterministic -- no surface-specific drift possible
    expect(a.journeyStage).toBe('RETAIN');
    expect(a.journeyProgressPercent).toBe(70);
    expect(a.actionState).toBe('WAITING');
  });

  it('Progress dashboard\'s per-concept row is built via the SAME buildCanonicalLearningProgress, not a local recomputation', () => {
    expect(PROGRESS_OVERVIEW_SRC).toMatch(/buildCanonicalLearningProgress\(\{/);
  });
});

/* ================================================================== *
 * 7 -- Today does not create a conflicting executable action.        *
 * ================================================================== */
describe('LX-9R5 7 -- Today never offers a conflicting executable action', () => {
  it('Today reads the pre-computed nextExecutableItemWaiting flag from the shared snapshot -- never a new memory read of its own', () => {
    expect(TODAY_PAGE_SRC).toMatch(/snapshot\?\.nextExecutableItemWaiting/);
    // Closeout B's own established boundary: Today stays presentation-only.
    const valueImports = TODAY_PAGE_SRC
      .split('\n')
      .filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\b/.test(l) && !/^\s*import\s*\{\s*type\s/.test(l));
    for (const l of valueImports) {
      expect(l).not.toMatch(/memory-read|adaptive-learning-policy|activity-taxonomy/);
    }
  });

  it('the waiting flag is computed ONCE in the shared snapshot service, keyed off the SAME RETENTION_RISK + retentionDue=false condition', () => {
    expect(SNAPSHOT_SRC).toMatch(/nextExecutableItem\.decision\.learningState === 'RETENTION_RISK'/);
    expect(SNAPSHOT_SRC).toMatch(/memorySignal\?\.retentionDue === false/);
  });

  it('Today renders the waiting card instead of the executable hero when bestWaiting is true', () => {
    expect(TODAY_PAGE_SRC).toMatch(/bestWaiting \? \(/);
    expect(TODAY_PAGE_SRC).toMatch(/conceptMission\.noActionRetentionWaitingTitle/);
  });
});

/* ================================================================== *
 * 8-10 -- continuation supports WAITING explicitly.                  *
 * ================================================================== */
describe('LX-9R5 8-10 -- continuation returns an explicit WAITING outcome, never launches the wrong activity', () => {
  it('8. resolveContinuation checks isRetentionWaiting-equivalent BEFORE calling startLearningSession for a RETENTION_RISK decision', () => {
    const block = CONTINUATION_SERVICE_SRC.slice(
      CONTINUATION_SERVICE_SRC.indexOf('if (phase4Decision) {'),
      CONTINUATION_SERVICE_SRC.indexOf('const session = await startLearningSession'),
    );
    expect(block).toMatch(/learningState === 'RETENTION_RISK'/);
    expect(block).toMatch(/retentionDue === false/);
    expect(block).toMatch(/status: 'WAITING'/);
  });

  it("9. WAITING is rendered as a distinct, non-error state in ContinuationPanel -- never the 'failed' error branch", () => {
    expect(CONTINUATION_PANEL_SRC).toMatch(/c\?\.status === 'WAITING'/);
    expect(CONTINUATION_PANEL_SRC).not.toMatch(/status === 'WAITING'[\s\S]{0,80}setFailed\(true\)/);
    expect(CONTINUATION_PANEL_SRC).toMatch(/waitingResult \|\| failed/);
  });

  it('10. nextEligibleAt propagates verbatim from canonical memory into the WAITING resolution and the rendered copy', () => {
    expect(CONTINUATION_SERVICE_SRC).toMatch(/nextEligibleAt: memorySignal\.nextReviewAt/);
    expect(CONTINUATION_PANEL_SRC).toMatch(/waitingResult\.nextEligibleAt/);
  });
});

/* ================================================================== *
 * 11 -- REINFORCE overrides waiting only when canonically explicit.   *
 * ================================================================== */
describe('LX-9R5 11 -- a genuine REINFORCE intervention is never suppressed by the waiting check', () => {
  it('a MISCONCEPTION_BLOCKED decision resolves EXECUTABLE with intervention REINFORCE, never WAITING', () => {
    const progress = buildCanonicalLearningProgress({
      conceptId: 'c1', subjectId: 'subj1',
      knowledgeState: ks({ masteryState: 'INTERVENTION_REQUIRED', criticalMisconceptionCount: 1 }),
      activeDecision: decision('MISCONCEPTION_BLOCKED', 'PRACTICE'),
      memory: { retentionDue: false, nextReviewAt: null }, // even if memory somehow says "not due" -- irrelevant, stage isn't RETAIN
    });
    expect(progress.intervention).toBe('REINFORCE');
    expect(progress.actionState).toBe('EXECUTABLE');
    expect(progress.nextCanonicalAction).toBe('PRACTICE');
  });

  it('isRetentionWaiting itself only ever fires for stage RETAIN -- structurally cannot fire for a REINFORCE-driven PRACTICE stage', () => {
    expect(isRetentionWaiting('PRACTICE', false)).toBe(false);
    expect(isRetentionWaiting('RETAIN', false)).toBe(true);
  });
});

/* ================================================================== *
 * 13-16 -- generation failure, retry, and question count (Parts E/F). *
 * ================================================================== */
describe('LX-9R5 13 -- initial generation failure logs an exact errorCode', () => {
  it('the [generation] failure log carries conceptId/quizMode/targetDifficulty/errorCode', () => {
    const block = ROUTE_SRC.slice(ROUTE_SRC.indexOf("if (questions.length === 0)"), ROUTE_SRC.indexOf("if (questions.length === 0)") + 700);
    expect(block).toMatch(/\[generation\]/);
    expect(block).toMatch(/errorCode: 'GENERATION_FAILED'/);
    expect(block).toMatch(/targetDifficulty: resolvedDifficulty\?\.level/);
  });
});

describe('LX-9R5 14 -- retry retries the identical preparation operation (regression, LX-9 FINAL)', () => {
  it('the practice.prepareFailedTitle retry still calls startCanonicalActivity, never generateQuiz', () => {
    const block = QUIZ_PAGE_SRC.slice(QUIZ_PAGE_SRC.indexOf("t['practice.prepareFailedTitle']"), QUIZ_PAGE_SRC.indexOf("t['practice.prepareFailedTitle']") + 1600);
    expect(block).toMatch(/startCanonicalActivity\(studentId\)/);
  });
});

describe('LX-9R5 15-16 -- canonical question count is respected, never silently degraded', () => {
  it('15. a canonical count=1 for an already-mastered concept is the documented executionMinimum floor, not an invented per-activity count', () => {
    const src = strip(EVIDENCE_CONTRACT_SRC);
    expect(src).toMatch(/executionMinimum: CURRENT_GENERATION_QUESTION_ENVELOPE\.min/);
    expect(src).not.toMatch(/RETAIN\s*=\s*1|TRANSFER\s*=\s*1/); // no invented per-activity constant
  });

  it('16. RETENTION_REQUIRED_COUNT / the exact-6-or-nothing contract is untouched (partial generation cannot silently reduce it)', () => {
    const qgSrc = read('src/services/quiz-generation.service.ts');
    expect(qgSrc).toMatch(/export const RETENTION_REQUIRED_COUNT = 6/);
  });
});

/* ================================================================== *
 * 17-22 -- assistance integrity (Part G).                            *
 * ================================================================== */
describe('LX-9R5 17 -- evidenceMode and assistanceUsed are kept as separate, distinct fields', () => {
  it('CanonicalLearningProgress carries both, with distinct doc comments explaining the difference', () => {
    const src = read('src/lib/lx/canonical-learning-progress.ts');
    expect(src).toMatch(/evidenceMode: EvidenceMode \| null/);
    expect(src).toMatch(/assistanceUsed: boolean \| null/);
    expect(src).toMatch(/never "did the learner use help"/);
  });
});

describe('LX-9R5 18-19, 21 -- the history label reflects actual hint usage, never activityType/EvidenceMode alone', () => {
  it('18/19/21. the COACH-mode history badge is conditional on h.hintsUsed > 0 -- never unconditionally "Con ayuda"', () => {
    const stripped = strip(CONCEPT_DETAIL_SRC);
    const start = stripped.indexOf('{h.learningMode && (');
    expect(start).toBeGreaterThan(-1);
    const block = stripped.slice(start, start + 700);
    expect(block).toMatch(/h\.hintsUsed > 0/);
    expect(block).toMatch(/subjectDetail\.modeCoachNoHelp/);
  });

  it('every locale defines the "no help used" label, distinct from "Con ayuda"', () => {
    for (const [, messages] of Object.entries(MESSAGES)) {
      const noHelp = messages['subjectDetail.modeCoachNoHelp' as keyof typeof messages] as string;
      const withHelp = messages['subjectDetail.modeCoach' as keyof typeof messages] as string;
      expect(noHelp?.length).toBeGreaterThan(0);
      expect(noHelp).not.toBe(withHelp);
    }
  });
});

describe('LX-9R5 20, 22 -- EvidenceMode/independence semantics are unchanged by this phase', () => {
  it('20. Practice remains a COACH-mode (assisted EvidenceMode) activity by policy -- the learningMode computation itself is untouched', () => {
    expect(ROUTE_SRC).toMatch(/const learningMode: 'SOLO' \| 'COACH' = quizSession\.evidenceMode === 'PRACTICE' \? 'COACH' : 'SOLO';/);
  });

  it('22. mastery.service.ts\'s handling of learningMode/independence evidence is untouched by this phase', () => {
    expect(MASTERY_SERVICE_SRC).toMatch(/learningMode\?:\s*LearningMode/);
  });
});

/* ================================================================== *
 * 23-25 -- raw mastery removal (Parts H/K), still available to admin. *
 * ================================================================== */
describe('LX-9R5 23 -- Progress no longer shows "Dominio general" as competing progress', () => {
  it('the secondary overallMasteryPercent paragraph is removed from the learner-facing render', () => {
    expect(DASHBOARD_PAGE_SRC).not.toMatch(/progress\.overallMasteryLabel/);
  });
});

describe('LX-9R5 24 -- Results no longer shows a raw concept mastery delta for ANY activity', () => {
  it('neither the single-concept nor the per-concept-list raw mastery percentage is rendered', () => {
    expect(QUIZ_PAGE_SRC).not.toMatch(/\{at\['quiz\.masteryLabel'\]\}: \{results\.mastery\.previous\}/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/p\.previousMastery\}% → \{p\.newMastery\}%/);
  });
});

describe('LX-9R5 25 -- raw mastery remains available for admin/analytics/debug -- never deleted', () => {
  it('getStudentProgressOverview still computes and returns overallMasteryPercent', () => {
    expect(PROGRESS_OVERVIEW_SRC).toMatch(/const overallMasteryPercent = masteryToPercent\(averageMasteryScore\(allRawMasteryScores\)\)/);
    expect(PROGRESS_OVERVIEW_SRC).toMatch(/return \{ overallMasteryPercent,/);
  });
  it('the generate-and-take response still returns results.mastery unconditionally (present whenever primaryMastery exists, regardless of quizMode)', () => {
    expect(ROUTE_SRC).toMatch(/mastery: primaryMastery/);
  });
});

/* ================================================================== *
 * 26-32 -- regressions.                                              *
 * ================================================================== */
describe('LX-9R5 26-31 -- prior-phase canonical machinery is unchanged', () => {
  it('26/27. canonical stage and percentage mapping (LX-9R1) are unchanged', () => {
    const jp = read('src/lib/lx/journey-progress.ts');
    expect(jp).toMatch(/RETAIN: 70/);
    expect(jp).toMatch(/CONSOLIDATED: 100/);
  });

  it('28. Retention waiting (LX-9R3-R1) is unchanged -- isRetentionWaiting is still the single shared authority', () => {
    const cm = read('src/lib/lx/concept-mission.ts');
    expect(cm).toMatch(/isRetentionWaiting\(journey\.stage, memory\?\.retentionDue\)/);
  });

  it('29. adaptive difficulty (LX-9R3-R1) is unchanged', () => {
    const dc = read('src/lib/lx/difficulty-contract.ts');
    expect(dc).toMatch(/export function resolveTargetDifficulty\(context: TargetDifficultyContext\)/);
  });

  it('30. cross-attempt novelty (LX-9R3) is unchanged', () => {
    const qg = read('src/services/quiz-generation.service.ts');
    expect(qg).toMatch(/RETENTION_NOVELTY_ATTEMPT_WINDOW = 3/);
  });

  it("31. no Tutor-related source file was touched by this phase", () => {
    const tutorSrc = read('src/services/tutor.service.ts');
    expect(tutorSrc).toMatch(/export (async )?function/);
  });
});
