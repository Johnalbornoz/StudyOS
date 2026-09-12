/**
 * LX-7R1 -- REMOVE THE REMAINING LEARNER-FACING CLIENT PEDAGOGICAL
 * HEURISTIC.
 *
 * Finding from the LX-7 audit: `/dashboard/subjects/[id]` (the
 * learner-visible subject detail page) had a "Practice weakest" CTA
 * implemented as `[...concepts].sort((a,b) => a.mastery_score -
 * b.mastery_score)[0]`, launched via a hand-built
 * `/dashboard/quiz?subjectId=...&conceptId=...` link -- a second,
 * informal decision engine bypassing `/api/learning/session/start`
 * entirely. This repair removes it and, when a canonical action exists
 * for the subject, surfaces the exact same `LearningDecision`
 * Today/My Path would (via the new `resolveSubjectCurrentDecision`,
 * lib/lx/path-view.ts), launched through the same canonical mechanism;
 * when none exists, a neutral "View my path" link, never an invented
 * fallback recommendation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveSubjectCurrentDecision } from '@/lib/lx/path-view';
import type { LearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SUBJECT_PAGE_SRC = strip(read('src/app/dashboard/subjects/[id]/page.tsx'));

function fakeDecision(over: Partial<LearningDecision>): LearningDecision {
  return {
    actionConceptId: 'c1', subjectId: 's1', targetConceptIds: [], signals: [], primarySignal: { type: 'AT_RISK' } as any,
    learningState: 'DEVELOPING', targetDimension: 'UNDERSTANDING' as any, activityType: 'PRACTICE',
    pedagogicalPriority: 'MODERATE' as any, temporalUrgency: null, priorityScore: 1000, reasonCode: 'AT_RISK' as any,
    facts: [], policyVersion: 1,
    ...over,
  };
}

/* ============================================================== *
 * 21/22 -- the old heuristic is gone, source and identifier both.  *
 * ============================================================== */
describe('LX-7R1 tests 21/22 -- no learner-facing mastery-sort recommendation remains', () => {
  it('21. no `.sort(...mastery_score...)` recommendation exists in the subject detail page', () => {
    expect(SUBJECT_PAGE_SRC).not.toMatch(/\.sort\([^)]*mastery_score/);
  });

  it('22. no "weakest" identifier / concept selection remains', () => {
    expect(SUBJECT_PAGE_SRC).not.toMatch(/weakest/i);
    expect(SUBJECT_PAGE_SRC).not.toMatch(/practiceWeak/);
  });
});

/* ============================================================== *
 * 23/29 -- canonical agreement with Today/My Path.                *
 * ============================================================== */
describe('LX-7R1 tests 23/29 -- the subject action agrees with the canonical LearningDecision / Today / My Path', () => {
  it('23. returns the subject-scoped top-ranked decision when no global current concept belongs to this subject', () => {
    const snapshot = {
      decisions: [fakeDecision({ actionConceptId: 'c1', subjectId: 's1', priorityScore: 500 }), fakeDecision({ actionConceptId: 'c2', subjectId: 's1', priorityScore: 900 })],
      nextExecutableItem: { decision: fakeDecision({ actionConceptId: 'other', subjectId: 's2' }), sequence: 0, estimatedMinutes: 5, executionReason: 'FITS_IN_ORDER' },
    } as unknown as LearningOSSnapshot;
    const decision = resolveSubjectCurrentDecision(snapshot, 's1');
    expect(decision?.actionConceptId).toBe('c2'); // higher priorityScore wins via rankLearningDecisions
  });

  it('29. when the global current concept (Today/My Path’s pick) belongs to this subject, the subject page agrees with it exactly -- never a different concept', () => {
    const globalDecision = fakeDecision({ actionConceptId: 'c1', subjectId: 's1', activityType: 'TRANSFER', priorityScore: 100 });
    const snapshot = {
      decisions: [globalDecision, fakeDecision({ actionConceptId: 'c2', subjectId: 's1', priorityScore: 900 })],
      nextExecutableItem: { decision: globalDecision, sequence: 0, estimatedMinutes: 5, executionReason: 'FITS_IN_ORDER' },
    } as unknown as LearningOSSnapshot;
    const decision = resolveSubjectCurrentDecision(snapshot, 's1');
    expect(decision?.actionConceptId).toBe('c1');
    expect(decision?.activityType).toBe('TRANSFER'); // exact same decision Today would launch, not a re-derived one
  });
});

/* ============================================================== *
 * 24 -- no canonical action -> no invented Practice.               *
 * ============================================================== */
describe('LX-7R1 test 24 -- no canonical action for this subject -> neutral fallback, never invented Practice', () => {
  it('resolveSubjectCurrentDecision returns null when the subject has no decisions', () => {
    const snapshot = { decisions: [], nextExecutableItem: null } as unknown as LearningOSSnapshot;
    expect(resolveSubjectCurrentDecision(snapshot, 's1')).toBeNull();
  });

  it('resolveSubjectCurrentDecision returns null given a null snapshot (read failure)', () => {
    expect(resolveSubjectCurrentDecision(null, 's1')).toBeNull();
  });

  it('the page renders a neutral "View my path" link in the no-decision branch, never a fabricated Practice CTA', () => {
    expect(SUBJECT_PAGE_SRC).toMatch(/subjectDecision \? \(/);
    expect(SUBJECT_PAGE_SRC).toMatch(/href=\{`\/dashboard\/path\/\$\{id\}`\}/);
    expect(SUBJECT_PAGE_SRC).toMatch(/subjectDetail\.viewMyPath/);
  });
});

/* ============================================================== *
 * 25 -- canonical launch, never a hand-built quiz URL.            *
 * ============================================================== */
describe('LX-7R1 test 25 -- the subject CTA launches only through the canonical session/start authority', () => {
  it('uses StartSessionButton for the canonical action, not a hand-built /dashboard/quiz?...conceptId= link', () => {
    expect(SUBJECT_PAGE_SRC).toMatch(/<StartSessionButton/);
    expect(SUBJECT_PAGE_SRC).not.toMatch(/\/dashboard\/quiz\?subjectId=\$\{id\}&conceptId=/);
  });

  it('the cumulative/exam mode buttons (learner-INITIATED mode choice, not a concept-selection heuristic) are untouched', () => {
    expect(SUBJECT_PAGE_SRC).toMatch(/mode=cumulative_assessment/);
    expect(SUBJECT_PAGE_SRC).toMatch(/mode=exam_simulation/);
  });
});

/* ============================================================== *
 * 26 -- subject analytics may remain, without being decision authority. *
 * ============================================================== */
describe('LX-7R1 test 26 -- subject analytics remain, but never drive concept selection', () => {
  it('avgMasteryPercent / freshness / independent mastery / evidence coverage summaries are still rendered', () => {
    expect(SUBJECT_PAGE_SRC).toMatch(/avgMasteryPercent/);
    expect(SUBJECT_PAGE_SRC).toMatch(/subjectDetail\.freshness/);
  });

  it('no remaining code path reads mastery_score to choose a concept', () => {
    expect(SUBJECT_PAGE_SRC).not.toMatch(/mastery_score[^\n]*(sort|weakest|pick|select)/i);
  });
});

/* ============================================================== *
 * 27/28 -- Today and My Path themselves are untouched.            *
 * ============================================================== */
describe('LX-7R1 tests 27/28 -- Today primary action and My Path current position untouched', () => {
  it('27. today/page.tsx was not modified by this repair (still reads nextExecutableItem directly, no subject-page coupling)', () => {
    const today = strip(read('src/app/dashboard/today/page.tsx'));
    expect(today).toMatch(/nextExecutableItem/);
    expect(today).not.toMatch(/resolveSubjectCurrentDecision/);
  });

  it('28. buildSubjectPathView (My Path) now shares resolveSubjectCurrentDecision rather than duplicating its own copy of the same logic', () => {
    const pathView = strip(read('src/lib/lx/path-view.ts'));
    expect(pathView).toMatch(/resolveSubjectCurrentDecision\(snapshot, subjectId\)\?\.actionConceptId/);
    expect(pathView).not.toMatch(/subjectHasGlobalCurrent/); // the old inline duplicate of this logic is gone
  });
});

/* ============================================================== *
 * 30 -- no evidence/mastery writes added.                         *
 * ============================================================== */
describe('LX-7R1 test 30 -- no evidence/mastery writes added by this repair', () => {
  it('the subject detail page performs no write beyond the canonical StartSessionButton POST it already reused', () => {
    expect(SUBJECT_PAGE_SRC).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET/);
  });
});
