/**
 * LX-5R -- CONTINUATION COVERAGE & ORIGIN REPAIR.
 *
 * Issue 1: the real Transfer completion surface (cognitive/transfer),
 * not quiz/page.tsx, must reach the shared continuation checkpoint.
 * Issue 2: a previous Focus Mode activity's origin must never leak into
 * a later one.
 *
 * Source/contract checks -- the repo has no live component/DB harness;
 * runtime behaviour is HARNESS-verified in the LX-5R report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const TRANSFER = read('src/app/dashboard/cognitive/transfer/page.tsx');
const SHELL = read('src/app/dashboard/LearnerShell.tsx');
const BEACON = read('src/app/dashboard/FocusOriginBeacon.tsx');
const QUIZ = read('src/app/dashboard/quiz/page.tsx');
const REMED_PAGE = read('src/app/dashboard/remediation/[pathId]/page.tsx');
const EXPLAIN = read('src/app/dashboard/cognitive/explain/page.tsx');
const SERVICE = read('src/services/learning-continuation.service.ts');

/* ======================================================================
 * ISSUE 1 -- TRANSFER CONTINUATION
 * ==================================================================== */
describe('LX-5R Issue 1 -- the real Transfer completion surface reaches the checkpoint', () => {
  it('cognitive/transfer/page.tsx (NOT quiz/page.tsx) renders the shared ContinuationPanel', () => {
    expect(TRANSFER).toMatch(/import ContinuationPanel from '@\/app\/dashboard\/quiz\/ContinuationPanel'/);
    expect(TRANSFER).toMatch(/<ContinuationPanel/);
  });

  it('the checkpoint is rendered at Transfer completion (phase === done branch)', () => {
    const doneIdx = TRANSFER.indexOf("phase !== 'done'");
    expect(doneIdx).toBeGreaterThan(-1);
    // the ContinuationPanel lives after the answering/submit branch, in the result block
    expect(TRANSFER.indexOf('<ContinuationPanel')).toBeGreaterThan(doneIdx);
  });

  it('it passes the REAL conceptId + subjectId (from the Transfer URL) and the learner', () => {
    const block = TRANSFER.slice(TRANSFER.indexOf('<ContinuationPanel'), TRANSFER.indexOf('<ContinuationPanel') + 400);
    expect(block).toMatch(/studentId=\{studentId\}/);
    expect(block).toMatch(/subjectId=\{subjectId\}/);
    expect(block).toMatch(/conceptId=\{conceptId\}/);
    // subjectId/conceptId are read straight from the Transfer route's own params
    expect(TRANSFER).toMatch(/const conceptId = searchParams\.get\('conceptId'\)/);
    expect(TRANSFER).toMatch(/const subjectId = searchParams\.get\('subjectId'\)/);
  });

  it('uses from="TRANSFER" (standalone) / from="REINFORCE" (remediation-step) -- presentation only', () => {
    expect(TRANSFER).toMatch(/from=\{remediationStepId \? 'REINFORCE' : 'TRANSFER'\}/);
  });

  it('introduces NO local next-action logic on the Transfer surface', () => {
    // no local ActivityType table / mastery threshold / ranking added here
    expect(TRANSFER).not.toMatch(/activityType\s*[:=]\s*['"]/);
    expect(TRANSFER).not.toMatch(/rankLearningDecisions|selectActivityType|getLearningDecisions/);
    expect(TRANSFER).not.toMatch(/masteryScore|masteryState\s*[<>]=/);
    // and it still writes no evidence/mastery itself
    expect(TRANSFER).not.toMatch(/updateMastery|learning_evidence|recordEvidence/);
  });

  it('keeps a safe fallback link when the learner/ids are somehow missing (never strands)', () => {
    expect(TRANSFER).toMatch(/\) : \(\s*<Link href=\{`\/dashboard\/subjects\/\$\{subjectId\}`\}/);
  });

  it('Transfer continuation goes through the SAME canonical resolver', () => {
    // ContinuationPanel POSTs to /api/learning/continue -> resolveContinuation,
    // which re-reads Phase 4 / Phase 8 first-touch. Nothing Transfer-specific.
    expect(SERVICE).toMatch(/getBestLearningDecisionForConcept|getLearningDecisions/);
    expect(SERVICE).toMatch(/bootstrapNotStartedLearningDecision/);
  });

  it('the structurally-identical Explain/Defend completion surface gets the same fix', () => {
    expect(EXPLAIN).toMatch(/import ContinuationPanel from '@\/app\/dashboard\/quiz\/ContinuationPanel'/);
    expect(EXPLAIN).toMatch(/<ContinuationPanel[\s\S]*?conceptId=\{conceptId\}/);
    expect(EXPLAIN).toMatch(/from=\{remediationStepId \? 'REINFORCE' : 'LEARN'\}/);
    expect(EXPLAIN).not.toMatch(/updateMastery|learning_evidence|getLearningDecisions|activityType\s*[:=]\s*['"]/);
  });
});

/* ======================================================================
 * ISSUE 2 -- FOCUS MODE ORIGIN (no stale context)
 * ==================================================================== */
describe('LX-5R Issue 2 -- Focus Mode origin cannot become stale', () => {
  it('A/D -- current route with subjectId+conceptId is the authority for Exit', () => {
    expect(SHELL).toMatch(/const curSubjectId = searchParams\.get\('subjectId'\)/);
    expect(SHELL).toMatch(/const curConceptId = searchParams\.get\('conceptId'\)/);
    expect(SHELL).toMatch(
      /curSubjectId && curConceptId\s*\?\s*`\/dashboard\/subjects\/\$\{curSubjectId\}\/concepts\/\$\{curConceptId\}`/,
    );
  });

  it('B -- when the current route supplies ids, any stored beacon is ignored', () => {
    expect(SHELL).toMatch(/if \(curSubjectId && curConceptId\) \{[\s\S]*?setBeaconExitHref\(null\)/);
  });

  it('C -- a stored beacon is trusted ONLY while its key equals the live pathname', () => {
    expect(SHELL).toMatch(/o\.key === pathname/);
    expect(BEACON).toMatch(/key: pathname/);
  });

  it('D -- no trustworthy origin falls through to the default (Today), never stale context', () => {
    // originExitHref resolves to null when neither source is valid;
    // the focus chrome then uses `originExitHref ?? exitHref`.
    expect(SHELL).toMatch(/setBeaconExitHref\(null\);\s*$/m);
    expect(SHELL).toMatch(/originExitHref \?\? exitHref/);
    expect(SHELL).toMatch(/exitHref = '\/dashboard\/today'/);
  });

  it('E -- sessionStorage throwing is caught and degrades to the default', () => {
    expect(SHELL).toMatch(/catch \{[\s\S]*?fall through to the default/);
    expect(BEACON).toMatch(/catch \{[\s\S]*?Exit falls back to Today/);
  });

  it('F -- the quiz no longer writes a shared/global activity-origin key', () => {
    expect(QUIZ).not.toMatch(/sessionStorage\.setItem\('lx\.activityOrigin'/);
  });

  it('the beacon is path-scoped and only used where the URL lacks the concept (remediation shell)', () => {
    expect(BEACON).toMatch(/'use client'/);
    expect(BEACON).toMatch(/sessionStorage\.setItem\(\s*'lx\.activityOrigin',\s*JSON\.stringify\(\{ key: pathname, subjectId, conceptId \}\)/);
    expect(REMED_PAGE).toMatch(/import FocusOriginBeacon/);
    expect(REMED_PAGE).toMatch(/<FocusOriginBeacon subjectId=\{view\.subjectId\} conceptId=\{view\.conceptId\}/);
    // quiz / transfer / explain expose ids in their own URL -> no beacon needed there
    expect(TRANSFER).not.toMatch(/FocusOriginBeacon/);
  });

  it('the shell adds NO pedagogical next-action logic (navigation only)', () => {
    expect(SHELL).not.toMatch(/getLearningDecisions|ActivityType|updateMastery|masteryState/);
    expect(BEACON).not.toMatch(/getLearningDecisions|ActivityType|updateMastery/);
  });
});

/* ======================================================================
 * SEVEN-CASE CONTINUATION MATRIX -- every canonical flow has a checkpoint
 * ==================================================================== */
describe('LX-5R -- seven core flows each end in a continuation checkpoint', () => {
  const CONCEPT_DISC = read(
    'src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptExplanationDisclosure.tsx',
  );

  it('1 LEARN -- concept explanation disclosure', () => {
    expect(CONCEPT_DISC).toMatch(/from="LEARN"/);
  });
  it('2 PRACTICE / 3-4 PROVE / 5 RETAIN -- quiz results, keyed to request mode', () => {
    expect(QUIZ).toMatch(/const continuationKind: LearningActivityKind =/);
    expect(QUIZ).toMatch(/'PROVE'/);
    expect(QUIZ).toMatch(/'RETAIN'/);
    expect(QUIZ).toMatch(/'PRACTICE'/);
    expect(QUIZ).toMatch(/<ContinuationPanel[\s\S]*?from=\{continuationKind\}/);
  });
  it('3-4 PROVE -- insufficiency is a note, not a local decision', () => {
    expect(QUIZ).toMatch(/results\.proveSufficiency && !results\.proveSufficiency\.sufficient/);
    const kindLine = QUIZ.slice(QUIZ.indexOf('const continuationKind: LearningActivityKind ='));
    expect(kindLine.slice(0, 300)).not.toMatch(/proveSufficiency|sufficient/);
  });
  it('6 TRANSFER -- cognitive/transfer completion (Issue 1)', () => {
    expect(TRANSFER).toMatch(/from=\{remediationStepId \? 'REINFORCE' : 'TRANSFER'\}/);
  });
  it('7 REINFORCE -- remediation terminal', () => {
    expect(REMED_PAGE).toMatch(/from="REINFORCE"/);
  });
});
