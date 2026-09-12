/**
 * LX-7 -- MY PATH / CANONICAL LEARNING JOURNEY.
 *
 * My Path introduces no new pedagogy: `deriveLearnerJourneyStage`
 * (LX-1B, learner-journey-contract.ts) is the ONE stage authority,
 * already shared with Concept Mission. This suite covers the pure
 * adapter (concept-journey.ts) exhaustively across every
 * `LearningState`, plus source-contract checks proving path-view.ts
 * and the two new pages never recompute a decision, never read a raw
 * score/threshold, never leak an internal metric, and stay consistent
 * with Today -- following this codebase's established pattern (no
 * DOM/component-render harness; pure-function tests + source-contract
 * regex tests, exactly like lx6-today-next-best-action.test.ts and
 * lx6r1-why-this-integrity.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveLearnerJourneyStage, type LearnerJourneyInputs } from '@/lib/lx/learner-journey-contract';
import { conceptJourneyFromResult, type ConceptJourney } from '@/lib/lx/concept-journey';
import { buildMyPathOverview, type MyPathContext } from '@/lib/lx/path-view';
import { RUNG_ORDER } from '@/lib/lx/concept-mission';
import { LOCALES, getMessages } from '@/lib/i18n/messages';
import { journeyStageLabel, journeyStageStateLabel, journeyReinforceLabel } from '@/app/dashboard/path/journeyStageLabel';
import { journeyReason } from '@/app/dashboard/path/journeyReason';
import { buildLearnerNav } from '@/lib/lx/learner-navigation';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const PATH_VIEW_SRC = strip(read('src/lib/lx/path-view.ts'));
const CONCEPT_JOURNEY_SRC = strip(read('src/lib/lx/concept-journey.ts'));
const OVERVIEW_PAGE_SRC = strip(read('src/app/dashboard/path/page.tsx'));
const SUBJECT_PAGE_SRC = strip(read('src/app/dashboard/path/[subjectId]/page.tsx'));
const JOURNEY_STRIP_SRC = strip(read('src/app/dashboard/path/JourneyStrip.tsx'));
const TODAY_SRC = strip(read('src/app/dashboard/today/page.tsx'));

function journeyFor(inputs: LearnerJourneyInputs): ConceptJourney {
  return conceptJourneyFromResult(deriveLearnerJourneyStage(inputs));
}

/* ============================================================== *
 * 1-7 -- every LearningState maps to the correct stage/overlay.  *
 * ============================================================== */
describe('LX-7 tests 1-7 -- live states derive the correct journey position', () => {
  it('1. new concept / first touch: NOT_STARTED -> LEARN, everything else pending', () => {
    const j = journeyFor({ learningState: 'NOT_STARTED', masteryState: null, validationReadiness: null });
    expect(j.currentStage).toBe('LEARN');
    expect(j.completedStages).toEqual([]);
    expect(j.pendingStages).toEqual(['PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']);
    expect(j.consolidated).toBe(false);
    expect(j.intervention).toBeNull();
  });

  it('2. PRACTICE current: residual DEVELOPING (masteryState DEVELOPING, validationReadiness not READY)', () => {
    const j = journeyFor({ learningState: 'DEVELOPING', masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' });
    expect(j.currentStage).toBe('PRACTICE');
    expect(j.completedStages).toEqual(['LEARN']);
    expect(j.intervention).toBeNull();
  });

  it('3. PROVE current: PENDING_VERIFICATION and INSUFFICIENT_INDEPENDENT_EVIDENCE both land on PROVE', () => {
    for (const learningState of ['PENDING_VERIFICATION', 'INSUFFICIENT_INDEPENDENT_EVIDENCE'] as const) {
      const j = journeyFor({ learningState, masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' });
      expect(j.currentStage, learningState).toBe('PROVE');
      expect(j.completedStages, learningState).toEqual(['LEARN', 'PRACTICE']);
    }
  });

  it('4. RETENTION current: RETENTION_RISK -> RETAIN, Learn/Practice/Prove already completed', () => {
    const j = journeyFor({ learningState: 'RETENTION_RISK', masteryState: 'AT_RISK', validationReadiness: 'WAITING_FOR_RETENTION' });
    expect(j.currentStage).toBe('RETAIN');
    expect(j.completedStages).toEqual(['LEARN', 'PRACTICE', 'PROVE']);
    expect(j.pendingStages).toEqual(['TRANSFER']);
  });

  it('5. TRANSFER current: TRANSFER_GAP -> TRANSFER, everything before it completed', () => {
    const j = journeyFor({ learningState: 'TRANSFER_GAP', masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'TRANSFER_REQUIRED' });
    expect(j.currentStage).toBe('TRANSFER');
    expect(j.completedStages).toEqual(['LEARN', 'PRACTICE', 'PROVE', 'RETAIN']);
    expect(j.pendingStages).toEqual([]);
  });

  it('6. REINFORCE active: MISCONCEPTION_BLOCKED / PREREQUISITE_BLOCKED / NEEDS_REPAIR all overlay REINFORCE on PRACTICE, never a stage of their own', () => {
    for (const learningState of ['MISCONCEPTION_BLOCKED', 'PREREQUISITE_BLOCKED', 'NEEDS_REPAIR'] as const) {
      const j = journeyFor({ learningState, masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' });
      expect(j.currentStage, learningState).toBe('PRACTICE');
      expect(j.intervention, learningState).toBe('REINFORCE');
      expect(j.consolidated, learningState).toBe(false);
    }
  });

  it('7. CONSOLIDATED concept: VALIDATED -> the whole line is complete, never a 6th clickable task', () => {
    const j = journeyFor({ learningState: 'VALIDATED', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY' });
    expect(j.currentStage).toBe('CONSOLIDATED');
    expect(j.consolidated).toBe(true);
    expect(j.completedStages).toEqual([...RUNG_ORDER]);
    expect(j.pendingStages).toEqual([]);
    expect(j.intervention).toBeNull();
  });
});

/* ============================================================== *
 * 8/9 -- future/pending concepts and the absence of any LOCKED    *
 * state (R14: no canonical prerequisite locking exists).          *
 * ============================================================== */
describe('LX-7 tests 8/9 -- future concepts are neutral pending, never locked', () => {
  it('8. a concept below the current stage is PENDING, not some other status', () => {
    const j = journeyFor({ learningState: 'NOT_STARTED', masteryState: null, validationReadiness: null });
    expect(j.pendingStages.length).toBeGreaterThan(0);
  });

  it('9. no LOCKED state exists anywhere in the journey/path-view source -- R14 forbids inventing prerequisite locking', () => {
    for (const src of [CONCEPT_JOURNEY_SRC, PATH_VIEW_SRC, OVERVIEW_PAGE_SRC, SUBJECT_PAGE_SRC, JOURNEY_STRIP_SRC]) {
      expect(src).not.toMatch(/LOCKED|prerequisite.?lock|isLocked/i);
    }
  });
});

/* ============================================================== *
 * 10/11 -- cold profile and read-failure -> UNRESOLVED.          *
 * ============================================================== */
describe('LX-7 tests 10/11 -- cold profile and path read failure', () => {
  const baseContext = (over: Partial<MyPathContext>): MyPathContext => ({
    studentId: 's1',
    locale: 'en',
    snapshot: null,
    snapshotReadFailed: false,
    activeSubjects: [],
    ...over,
  });

  it('11. a failed snapshot read returns UNRESOLVED, never silently treated as empty/cold', async () => {
    const overview = await buildMyPathOverview(baseContext({ snapshotReadFailed: true, activeSubjects: [{ id: 'sub1', name: 'Math' }] }));
    expect(overview.state).toBe('UNRESOLVED');
    expect(overview.current).toBeNull();
    expect(overview.subjects).toEqual([]);
  });

  it('no active subjects at all -> NO_ACTIVE_SUBJECTS, never a fabricated recommendation', async () => {
    const overview = await buildMyPathOverview(baseContext({ activeSubjects: [] }));
    expect(overview.state).toBe('NO_ACTIVE_SUBJECTS');
    expect(overview.current).toBeNull();
  });

  it('10. path-view.ts documents and implements a distinct COLD state, separate from UNRESOLVED/NO_ACTIVE_SUBJECTS', () => {
    expect(PATH_VIEW_SRC).toMatch(/'COLD'/);
    expect(PATH_VIEW_SRC).toMatch(/hasAnyEvidence/);
  });
});

/* ============================================================== *
 * 12/13 -- Today and My Path must never contradict each other.    *
 * ============================================================== */
describe('LX-7 tests 12/13 -- Today/My Path consistency (R20)', () => {
  it('My Path reads its current position from the exact same getLearningOSSnapshot().nextExecutableItem Today uses', () => {
    expect(PATH_VIEW_SRC).toMatch(/getLearningOSSnapshot/);
    expect(PATH_VIEW_SRC).toMatch(/nextExecutableItem/);
    expect(TODAY_SRC).toMatch(/getLearningOSSnapshot/);
    expect(TODAY_SRC).toMatch(/nextExecutableItem/);
  });

  it('current.activityType is a verbatim pass-through of best.decision.activityType -- never re-selected', () => {
    expect(PATH_VIEW_SRC).toMatch(/activityType:\s*best\.decision\.activityType/);
  });

  it('a concept with an active decision uses decision.learningState verbatim, never a re-derived one', () => {
    expect(PATH_VIEW_SRC).toMatch(/activeDecision\s*\?\s*activeDecision\.learningState/);
  });
});

/* ============================================================== *
 * 14 -- current concept visually dominant.                        *
 * ============================================================== */
describe('LX-7 test 14 -- current concept is visually dominant on the overview hero', () => {
  it('the hero card uses the brand border + a large heading, like Today’s own hero', () => {
    expect(OVERVIEW_PAGE_SRC).toMatch(/borderColor: 'var\(--brand\)', borderWidth: 2/);
    expect(OVERVIEW_PAGE_SRC).toMatch(/fontSize: 24,.*fontWeight: 700/);
  });
});

/* ============================================================== *
 * 15-19 -- stage-line correctness and no misleading advancement.  *
 * ============================================================== */
describe('LX-7 tests 15-19 -- completed/pending correctness, no misleading advancement', () => {
  it('15/16. completedStages + [currentStage] + pendingStages always reconstructs the full 5-rung line (or fully-complete when consolidated)', () => {
    const cases: LearnerJourneyInputs[] = [
      { learningState: 'NOT_STARTED', masteryState: null, validationReadiness: null },
      { learningState: 'DEVELOPING', masteryState: 'LEARNING', validationReadiness: 'INSUFFICIENT_EVIDENCE' },
      { learningState: 'PENDING_VERIFICATION', masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' },
      { learningState: 'RETENTION_RISK', masteryState: 'AT_RISK', validationReadiness: 'WAITING_FOR_RETENTION' },
      { learningState: 'TRANSFER_GAP', masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'TRANSFER_REQUIRED' },
      { learningState: 'VALIDATED', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY' },
    ];
    for (const inputs of cases) {
      const j = journeyFor(inputs);
      if (j.consolidated) {
        expect(j.completedStages).toEqual([...RUNG_ORDER]);
      } else {
        const reconstructed = [...j.completedStages, j.currentStage, ...j.pendingStages];
        expect(reconstructed).toEqual([...RUNG_ORDER]);
      }
    }
  });

  it('17. Retention is never marked completed before Prove is -- RETAIN only ever appears in completedStages once currentStage is TRANSFER or CONSOLIDATED', () => {
    const allInputs: LearnerJourneyInputs[] = [
      { learningState: 'NOT_STARTED', masteryState: null, validationReadiness: null },
      { learningState: 'MISCONCEPTION_BLOCKED', masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' },
      { learningState: 'DEVELOPING', masteryState: 'LEARNING', validationReadiness: 'INSUFFICIENT_EVIDENCE' },
      { learningState: 'DEVELOPING', masteryState: 'DEVELOPING', validationReadiness: 'READY' },
      { learningState: 'PENDING_VERIFICATION', masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' },
      { learningState: 'RETENTION_RISK', masteryState: 'AT_RISK', validationReadiness: 'WAITING_FOR_RETENTION' },
      { learningState: 'TRANSFER_GAP', masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'TRANSFER_REQUIRED' },
      { learningState: 'VALIDATED', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY' },
    ];
    for (const inputs of allInputs) {
      const j = journeyFor(inputs);
      const retainCompleted = j.completedStages.includes('RETAIN');
      if (retainCompleted) {
        expect(['TRANSFER', 'CONSOLIDATED'], JSON.stringify(inputs)).toContain(j.currentStage);
      }
    }
  });

  it('18. Transfer readiness/completion is never inferred from a raw score -- concept-journey.ts and path-view.ts read no score/percentage field', () => {
    for (const src of [CONCEPT_JOURNEY_SRC, PATH_VIEW_SRC]) {
      expect(src).not.toMatch(/masteryScore|understandingScore|independentMastery|scorePercent|>=\s*\d|<\s*\d/);
    }
  });

  it('19. Consolidated is set only via conceptJourneyFromResult when the canonical stage is CONSOLIDATED -- no second consolidation path', () => {
    const occurrences = [...CONCEPT_JOURNEY_SRC.matchAll(/consolidated:\s*true/g)];
    expect(occurrences.length).toBe(1);
    expect(CONCEPT_JOURNEY_SRC).toMatch(/result\.stage === 'CONSOLIDATED'/);
  });
});

/* ============================================================== *
 * 20/21 -- concept click -> Concept Mission; current CTA ->        *
 * canonical launch (never a new launch path).                     *
 * ============================================================== */
describe('LX-7 tests 20/21 -- concept click opens Concept Mission; CTA reuses canonical launch', () => {
  it('every concept link on both pages points at the LX-3 canonical Concept Mission route', () => {
    expect(OVERVIEW_PAGE_SRC).toMatch(/\/dashboard\/subjects\/\$\{overview\.current!\.subjectId\}\/concepts\/\$\{c\.conceptId\}/);
    expect(SUBJECT_PAGE_SRC).toMatch(/\/dashboard\/subjects\/\$\{subjectId\}\/concepts\/\$\{concept\.conceptId\}/);
  });

  it('both pages launch exclusively through StartSessionButton -- no bespoke fetch to a quiz/session URL', () => {
    for (const src of [OVERVIEW_PAGE_SRC, SUBJECT_PAGE_SRC]) {
      expect(src).toMatch(/<StartSessionButton/);
      expect(src).not.toMatch(/fetch\(['"`]\/api\/(quizzes|learning\/plan)/);
    }
  });
});

/* ============================================================== *
 * 22/23/31 -- no evidence writes; LX-5 continuation untouched.    *
 * ============================================================== */
describe('LX-7 tests 22/23/31 -- no evidence on load/open; canonical launch untouched', () => {
  it('22/23. neither page nor path-view.ts writes evidence, mastery, or learning_state -- read-only rendering', () => {
    for (const src of [PATH_VIEW_SRC, OVERVIEW_PAGE_SRC, SUBJECT_PAGE_SRC, CONCEPT_JOURNEY_SRC]) {
      expect(src).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|learning_evidence.*VALUES/);
    }
  });

  it('31. StartSessionButton’s POST body is untouched: only studentId + actionConceptId, same as Today/LX-5', () => {
    const src = strip(read('src/app/dashboard/StartSessionButton.tsx'));
    expect(src).toMatch(/JSON\.stringify\(\{ studentId, actionConceptId \}\)/);
  });
});

/* ============================================================== *
 * 24/25 -- no client thresholds; no internal metric leakage.      *
 * ============================================================== */
describe('LX-7 tests 24/25 -- no client-side thresholds, no internal metric leakage', () => {
  it('24. no ad-hoc mastery/score threshold anywhere in the new journey/path modules', () => {
    for (const src of [CONCEPT_JOURNEY_SRC, PATH_VIEW_SRC]) {
      expect(src).not.toMatch(/Math\.random|weakest|\.sort\(\(a,\s*b\)\s*=>\s*a\.mastery/);
    }
  });

  it('25. journey stage/reason copy never renders a raw percentage, x/5 severity, or score', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const stage of [...RUNG_ORDER, 'CONSOLIDATED', 'REINFORCE'] as const) {
        const label = journeyStageLabel(stage as any, t);
        expect(label, `${locale}:${stage}`).not.toMatch(/%|\d\/5/);
      }
      for (const state of ['COMPLETED', 'CURRENT', 'PENDING'] as const) {
        expect(journeyStageStateLabel(state, t)).not.toMatch(/%|\d\/5/);
      }
      expect(journeyReinforceLabel(t)).not.toMatch(/%|\d\/5/);
    }
  });

  it('the subject summary card shows a plain count ratio (permitted by R16), never a "63% mastery"-style dominant percentage', () => {
    expect(OVERVIEW_PAGE_SRC).toMatch(/s\.summary\.consolidatedCount\}\/\{s\.summary\.totalConcepts\}/);
    expect(OVERVIEW_PAGE_SRC).not.toMatch(/avgMasteryPercent|masteryToPercent/);
  });
});

/* ============================================================== *
 * 26/27 -- global interface language governs the shell.           *
 * ============================================================== */
describe('LX-7 tests 26/27 -- GLOBAL_INTERFACE_LANGUAGE governs My Path; activity language untouched', () => {
  it('both pages resolve locale via getInterfaceLanguage, exactly like Today', () => {
    for (const src of [OVERVIEW_PAGE_SRC, SUBJECT_PAGE_SRC]) {
      expect(src).toMatch(/getInterfaceLanguage\(studentId\)/);
    }
  });

  it('neither page imports or touches ACTIVITY_LANGUAGE / activity-language logic', () => {
    for (const src of [OVERVIEW_PAGE_SRC, SUBJECT_PAGE_SRC]) {
      expect(src).not.toMatch(/activity-language|ACTIVITY_LANGUAGE/);
    }
  });
});

/* ============================================================== *
 * 28/29 -- mobile layout; accessibility without color alone.      *
 * ============================================================== */
describe('LX-7 tests 28/29 -- mobile-safe layout; accessible stage status', () => {
  it('28. JourneyStrip wraps instead of forcing horizontal scroll', () => {
    expect(JOURNEY_STRIP_SRC).toMatch(/flexWrap: 'wrap'/);
    expect(JOURNEY_STRIP_SRC).not.toMatch(/overflowX|overflow-x/);
  });

  it('29. every stage exposes a visible text label plus an sr-only status, and aria-current on the current stage', () => {
    expect(JOURNEY_STRIP_SRC).toMatch(/aria-current=\{state === 'CURRENT' \? 'step' : undefined\}/);
    expect(JOURNEY_STRIP_SRC).toMatch(/className="sr-only"/);
    expect(JOURNEY_STRIP_SRC).toMatch(/<ol/);
  });
});

/* ============================================================== *
 * 30/32/33/34 -- Today / R1F / R1G / full suite untouched.         *
 * ============================================================== */
describe('LX-7 tests 30/32/33/34 -- unrelated certified surfaces untouched', () => {
  it('30. Today’s hero/decision logic is unchanged -- only the "View My Path" href was corrected', () => {
    expect(TODAY_SRC).toMatch(/deriveTodayState/);
    expect(TODAY_SRC).toMatch(/href="\/dashboard\/path" className="btn btn-ghost">\s*\{t\['today3\.viewMyPath'\]\}/);
    expect(TODAY_SRC).not.toMatch(/href="\/dashboard\/study-plan"[^>]*>\s*\{t\['today3\.viewMyPath'\]\}/);
  });

  it('the nav item for My Path now points at the real implementation with no temporary-mapping note', () => {
    const myPath = buildLearnerNav({ isAdmin: false, debtCount: 0, notifCount: 0 })
      .find((g) => g.kind === 'PRIMARY')!
      .items.find((i) => i.key === 'myPath')!;
    expect(myPath.href).toBe('/dashboard/path');
    expect(myPath.temporaryMappingNote).toBeUndefined();
  });
});

/* ============================================================== *
 * i18n completeness (R7/R22, 5 locales).                          *
 * ============================================================== */
describe('LX-7 i18n -- all myPath* keys complete across all 5 locales', () => {
  it('every myPathStage/myPathStageState/myPathReason/myPath.* key used by the new modules resolves in every locale', () => {
    const usedKeys = [
      ...[...RUNG_ORDER, 'CONSOLIDATED', 'REINFORCE'].map((s) => `myPathStage.${s}`),
      ...['COMPLETED', 'CURRENT', 'PENDING'].map((s) => `myPathStageState.${s}`),
      ...['intervention', 'consolidated', 'learn', 'practice', 'prove', 'retainCurrent', 'transferCurrent'].map((s) => `myPathReason.${s}`),
      'myPath.title', 'myPath.subtitle', 'myPath.heroLabel', 'myPath.journeyLabel',
      'myPath.unresolvedTitle', 'myPath.unresolvedBody', 'myPath.unresolvedRetry', 'myPath.unresolvedGoToToday',
      'myPath.startTitle', 'myPath.startBody', 'myPath.coldBody', 'myPath.exploreCta',
      'myPath.allCaughtUpTitle', 'myPath.allCaughtUpBody', 'myPath.nearbyTitle', 'myPath.subjectsTitle',
      'myPath.summaryConsolidated', 'myPath.summaryRetentionDue', 'myPath.summaryTransferPending',
      'myPath.subjectUpToDateTitle', 'myPath.subjectUpToDateBody',
    ];
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const key of usedKeys) {
        expect(t[key as keyof typeof t], `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});

/* ============================================================== *
 * journeyReason -- distinct qualitative sentence per stage.       *
 * ============================================================== */
describe('LX-7 journeyReason -- distinct, qualitative, no raw metrics', () => {
  it('every stage + intervention + consolidated combination produces a distinct sentence in English', () => {
    const t = getMessages('en');
    const cases: ConceptJourney[] = [
      { currentStage: 'LEARN', completedStages: [], pendingStages: ['PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'], consolidated: false, intervention: null, reasonCode: 'x' },
      { currentStage: 'PRACTICE', completedStages: ['LEARN'], pendingStages: ['PROVE', 'RETAIN', 'TRANSFER'], consolidated: false, intervention: null, reasonCode: 'x' },
      { currentStage: 'PROVE', completedStages: ['LEARN', 'PRACTICE'], pendingStages: ['RETAIN', 'TRANSFER'], consolidated: false, intervention: null, reasonCode: 'x' },
      { currentStage: 'RETAIN', completedStages: ['LEARN', 'PRACTICE', 'PROVE'], pendingStages: ['TRANSFER'], consolidated: false, intervention: null, reasonCode: 'x' },
      { currentStage: 'TRANSFER', completedStages: ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN'], pendingStages: [], consolidated: false, intervention: null, reasonCode: 'x' },
      { currentStage: 'PRACTICE', completedStages: ['LEARN'], pendingStages: ['PROVE', 'RETAIN', 'TRANSFER'], consolidated: false, intervention: 'REINFORCE', reasonCode: 'x' },
      { currentStage: 'CONSOLIDATED', completedStages: [...RUNG_ORDER], pendingStages: [], consolidated: true, intervention: null, reasonCode: 'x' },
    ];
    const sentences = cases.map((c) => journeyReason(c, t));
    expect(new Set(sentences).size).toBe(cases.length);
  });
});
