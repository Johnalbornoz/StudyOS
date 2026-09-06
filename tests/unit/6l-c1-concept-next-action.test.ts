/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-C1: CONCEPT NEXT ACTION / WHY.
 *
 * Presentation-mapping + source-content tests only, matching this
 * repo's established convention (tests/unit/6l-a-learning-experience.test.ts,
 * tests/unit/6l-b1-remediation-shell.test.ts) -- there is no React
 * component test harness in this project. Every assertion here proves
 * that Concept Detail's new "what next / why" section is wired to the
 * ONE canonical next-action authority (Phase 4's LearningDecision, via
 * the already-exported getBestLearningDecisionForConcept) through the
 * ONE canonical presentation layer (activityLabel/activityCta/
 * WhyThisV3) and the ONE canonical launch mechanism
 * (StartSessionButton -> /api/learning/session/start ->
 * startLearningSession) -- never a second, page-local decision,
 * reason-mapping, or routing table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ADAPTIVE_LEARNING_POLICY_VERSION } from '@/lib/adaptive-learning-policy';
import { ADAPTIVE_TEACHING_POLICY_VERSION } from '@/lib/adaptive-teaching-policy';

const PAGE_PATH = 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

describe('canonical next-action source (Part 2) -- Phase 4 LearningDecision is the only authority', () => {
  const source = read(PAGE_PATH);

  it('imports and calls getBestLearningDecisionForConcept from the canonical service, not a re-implementation', () => {
    expect(source).toMatch(/import \{ getBestLearningDecisionForConcept \} from '@\/services\/adaptive-teaching\.service'/);
    expect(source).toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)/);
  });

  it('the next-action section is never gated or chosen by a local mastery/retention/verification threshold', () => {
    // The page's PRE-EXISTING primaryCTA heuristic (practice/soloCheck/
    // review/tutor) is untouched by this step and deliberately out of
    // scope -- this test targets only the NEW section, proving it never
    // reads state.masteryScore/state.retention/state.independentMastery
    // to decide what nextDecision should be (it is never reassigned at
    // all -- it is the direct, single return value of the canonical
    // call above).
    expect(source).not.toMatch(/nextDecision\s*=\s*(?!await getBestLearningDecisionForConcept)/);
    // Landmark: nextDecision is the last element of the canonical
    // Promise.all destructure. (Phase 7 7F1 swapped the raw
    // `transferScore` element for the learner-safe `transferDepth`.)
    expect(source).toMatch(/const \[conceptView, evidence, activeDebt, history, transferDepth, knowledgeState, nextDecision\]/);
  });

  it('the section is present but does not appear inside the pre-existing primaryCTA heuristic block', () => {
    const nextDecisionBlock = source.match(/\{nextDecision && \(([\s\S]*?)\)\}/);
    expect(nextDecisionBlock).toBeTruthy();
    expect(nextDecisionBlock![1]).not.toMatch(/primaryCTA/);
  });
});

describe('no raw orchestration internals ever reach the learner (Part 4)', () => {
  const source = read(PAGE_PATH);

  it('never interpolates the raw activityType, reasonCode, or a decision/policy field directly into JSX text', () => {
    expect(source).not.toMatch(/\{nextDecision\.activityType\}/);
    expect(source).not.toMatch(/\{nextDecision\.reasonCode\}/);
    expect(source).not.toMatch(/\{nextDecision\.learningState\}/);
    expect(source).not.toMatch(/\{nextDecision\.policyVersion\}/);
  });

  it('every render of the decision goes through the certified activityLabel/activityCta mappers', () => {
    expect(source).toMatch(/activityLabel\(nextDecision\.activityType, t\)/);
    expect(source).toMatch(/activityCta\(nextDecision\.activityType, t\)/);
  });
});

describe('canonical why/reason presentation (Part 5) -- reuses WhyThisV3, no second reason table', () => {
  const source = read(PAGE_PATH);

  it('imports and renders the certified WhyThisV3 component with the decision\'s own facts', () => {
    expect(source).toMatch(/import WhyThisV3 from '@\/app\/dashboard\/WhyThisV3'/);
    expect(source).toMatch(/<WhyThisV3 facts=\{nextDecision\.facts\} t=\{t\} \/>/);
  });

  it('does not define a second fact/reason-to-copy switch statement on this page', () => {
    // WhyThisV3 owns the one LearningFact -> sentence mapping (its own
    // internal switch over fact.kind); this page must never define a
    // second one.
    expect(source).not.toMatch(/switch\s*\(\s*fact\.kind\s*\)/);
    expect(source).not.toMatch(/case 'retentionReviewDue'/);
  });
});

describe('canonical launch routing (Part 6/7) -- StartSessionButton is the only mechanism, no second routing table', () => {
  const source = read(PAGE_PATH);

  it('imports and renders StartSessionButton for the next-action CTA, scoped to this concept', () => {
    expect(source).toMatch(/import StartSessionButton from '@\/app\/dashboard\/StartSessionButton'/);
    expect(source).toMatch(/<StartSessionButton[\s\S]{0,400}actionConceptId=\{nextDecision\.actionConceptId\}/);
  });

  it('never hardcodes a remediation route, a quiz mode URL, or any manual href built from nextDecision', () => {
    const nextDecisionBlock = source.match(/\{nextDecision && \(([\s\S]*?)\n {6}\)\}/);
    expect(nextDecisionBlock).toBeTruthy();
    expect(nextDecisionBlock![1]).not.toMatch(/\/dashboard\/remediation/);
    expect(nextDecisionBlock![1]).not.toMatch(/\/dashboard\/quiz\?/);
    expect(nextDecisionBlock![1]).not.toMatch(/\/dashboard\/cognitive/);
    expect(nextDecisionBlock![1]).not.toMatch(/href=/);
  });

  it('wires the existing unavailable/retry degradation labels -- never a bespoke error string', () => {
    expect(source).toMatch(/unavailableLabel=\{t\['today3\.unavailableBody'\]\}/);
    expect(source).toMatch(/retryLabel=\{t\['today3\.retry'\]\}/);
  });

  it('a REMEDIATION decision reaches the 6L-B1 shell purely through the pre-existing, already-certified session-engine chain -- proven by that chain\'s own certified tests, not re-derived here', () => {
    // Cross-reference, not a re-implementation: the actual routing
    // proof (REMEDIATION -> remediationLaunch -> /dashboard/remediation/[pathId])
    // lives in learning-session-engine.service.ts and is already
    // covered by tests/unit/learning-session-engine.test.ts and
    // tests/unit/6l-b1-remediation-shell.test.ts. This page adds
    // nothing to that chain -- it only supplies studentId/actionConceptId,
    // exactly like Today's ItemRow does.
    const engineSource = read('src/services/learning-session-engine.service.ts');
    expect(engineSource).toMatch(/`\/dashboard\/remediation\/\$\{path\.id\}`/);
  });
});

describe('failure degradation (Part 3) -- decision lookup failure never breaks the page or fabricates a recommendation', () => {
  const source = read(PAGE_PATH);

  it('the canonical call is wrapped in .catch(() => null), matching the 6L-B1-established pattern', () => {
    expect(source).toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)\.catch\(\(\) => null\)/);
  });

  it('the section is rendered only behind a truthy check -- no ternary fallback, no default recommendation literal', () => {
    expect(source).toMatch(/\{nextDecision && \(/);
    // Never a `nextDecision ? (...) : (<fallback UI>)` pattern for this
    // block, and never a hardcoded fallback like "Practice more".
    expect(source).not.toMatch(/nextDecision \? \(/);
    expect(source).not.toMatch(/nextDecision\s*\?\?/);
  });

  it('a null nextDecision does not affect any pre-existing field on this page (state/situation/knowledgeState continue to compute independently)', () => {
    // nextDecision is fetched in the same Promise.all as the other
    // independent reads, not sequenced after/gated by them.
    const promiseAllBlocks = source.match(/await Promise\.all\(\[[\s\S]*?\]\);/g) ?? [];
    const decisionBlock = promiseAllBlocks.find((b) => b.includes('getConceptView(studentId, conceptId)'));
    expect(decisionBlock).toBeTruthy();
    expect(decisionBlock).toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)\.catch\(\(\) => null\)/);
  });
});

describe('Step 28 worktree protection (Part 10)', () => {
  it('Concept Detail never imports quiz/page.tsx or quiz-answer-guards', () => {
    const source = read(PAGE_PATH);
    expect(source).not.toMatch(/dashboard\/quiz\/page/);
    expect(source).not.toMatch(/quiz-answer-guards/);
  });

  it('this step touches ONLY its own conceptDetail.* i18n keys -- adds them, clobbers nothing, and never pulls in Step 28 content', () => {
    // 6L-C1-R2 decoupling: the earlier version of this test REQUIRED the
    // Step 28 `quiz.confidenceRequired*` strings to be present in
    // messages.ts -- but those belong to a separate, uncommitted
    // workstream, so a clean checkout of this release (which correctly
    // does NOT carry Step 28) failed it. The real intent -- "6L-C1 must
    // not overwrite or contaminate unrelated i18n data" -- is preserved
    // here as a clean-checkout-safe invariant.
    const source = read('src/lib/i18n/messages.ts');

    // 1. 6L-C1's OWN keys are present: the MessageKey union member plus
    //    exactly one entry per supported locale (es/en/de/fr/pt).
    for (const key of ['conceptDetail.nextSectionTitle', 'conceptDetail.otherWaysTitle']) {
      expect(source).toMatch(new RegExp(`\\|\\s*'${key.replace(/\./g, '\\.')}'`));
      expect(source.split(`'${key}':`).length - 1).toBe(5);
    }

    // 2. 6L-C1 does NOT itself introduce Step 28 content. A clean
    //    checkout of this exact release must never contain the
    //    confidenceRequired strings -- that is a different release.
    expect(source).not.toContain('quiz.confidenceRequired');

    // 3. Additive only: a representative spread of pre-existing,
    //    unrelated keys is still intact (no accidental clobber of the
    //    file this step edits).
    for (const untouched of [
      "'quiz.confidenceQuestion':",
      "'quiz.confidenceLow':",
      "'dashboard.avgMastery':",
      "'remediation.headerTitle':",
      "'conceptDetail.situationTitle':",
    ]) {
      expect(source).toContain(untouched);
    }
  });
});

describe('6L-B1 protection (Part 11 of this step\'s own scope) -- remediation shell/view/labels/engine untouched', () => {
  it('remediation-session-view.ts still contains its own certified invariant markers, unmodified', () => {
    const source = read('src/lib/remediation-session-view.ts');
    expect(source).toMatch(/if \(!path \|\| path\.studentId !== studentId\) return \{ status: 'NOT_FOUND' \};/);
    expect(source).toMatch(/getTeachingIntentForConcept\(studentId, path\.rootCauseConceptId\)\.catch\(\(\) => null\)/);
  });

  it('remediation-presentation-labels.ts still contains its certified independence-grounding markers, unmodified', () => {
    const source = read('src/lib/remediation-presentation-labels.ts');
    expect(source).toMatch(/export function remediationStepIsIndependent/);
    expect(source).toMatch(/export function remediationPromisesWorkedExample/);
  });

  it('the remediation shell page still uses view.activityHref verbatim for its CTA, unmodified', () => {
    const source = read("src/app/dashboard/remediation/[pathId]/page.tsx");
    expect(source).toMatch(/href=\{view\.activityHref\}/);
  });

  it('learning-session-engine.service.ts still preserves all three remediationLaunch invariants, unmodified', () => {
    const source = read('src/services/learning-session-engine.service.ts');
    expect(source).toMatch(/path\.studentId !== studentId/);
    expect(source).toMatch(/path\.rootCauseConceptId !== decision\.actionConceptId/);
    expect(source).toMatch(/activeStep\.conceptId !== path\.rootCauseConceptId/);
  });
});

describe('protected policy invariants (Part 12/Protected Surfaces) -- versions unchanged', () => {
  it('ADAPTIVE_LEARNING_POLICY_VERSION is still 3', () => {
    expect(ADAPTIVE_LEARNING_POLICY_VERSION).toBe(3);
  });
  it('ADAPTIVE_TEACHING_POLICY_VERSION is still 1', () => {
    expect(ADAPTIVE_TEACHING_POLICY_VERSION).toBe(1);
  });
});
