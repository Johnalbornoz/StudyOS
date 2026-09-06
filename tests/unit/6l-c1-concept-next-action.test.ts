/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-C1: CONCEPT NEXT ACTION / WHY.
 *
 * LX-3 (Concept Mission) RELOCATED this section. The invariant is
 * unchanged -- the ONE next action on the concept screen is still a
 * verbatim pass-through of Phase 4's LearningDecision (via the
 * already-exported getBestLearningDecisionForConcept), rendered through
 * the ONE canonical presentation layer (activityLabel/activityCta/
 * WhyThisV3) and launched through the ONE canonical mechanism
 * (StartSessionButton -> /api/learning/session/start) -- but it now
 * lives in the Concept Mission read boundary
 * (concept-mission-view.service.ts, which does the canonical fetch +
 * `.catch(() => null)`), the pure read model (lib/lx/concept-mission.ts,
 * which passes the ActivityType through and NEVER selects one), and the
 * presentational component (ConceptMission.tsx). The concept page
 * itself no longer fetches the decision or carries any page-local
 * next-action / CTA-ordering heuristic.
 *
 * Source-content tests only, matching this repo's established
 * convention -- there is no React component test harness in this
 * project.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ADAPTIVE_LEARNING_POLICY_VERSION } from '@/lib/adaptive-learning-policy';
import { ADAPTIVE_TEACHING_POLICY_VERSION } from '@/lib/adaptive-teaching-policy';

const PAGE_PATH = 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx';
const MISSION_SERVICE_PATH = 'src/services/concept-mission-view.service.ts';
const MISSION_MODEL_PATH = 'src/lib/lx/concept-mission.ts';
const MISSION_COMPONENT_PATH = 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission.tsx';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

describe('canonical next-action source (Part 2) -- Phase 4 LearningDecision is the only authority', () => {
  const service = read(MISSION_SERVICE_PATH);
  const model = read(MISSION_MODEL_PATH);
  const page = read(PAGE_PATH);

  it('the Mission read boundary imports and calls getBestLearningDecisionForConcept from the canonical service, not a re-implementation', () => {
    expect(service).toMatch(/import \{ getBestLearningDecisionForConcept \} from '@\/services\/adaptive-teaching\.service'/);
    expect(service).toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)/);
  });

  it('the pure read model never selects an ActivityType -- it only passes the canonical decision through', () => {
    // `activityType` may only ever be assigned from the supplied
    // decision or set to null; never from a taxonomy selector.
    expect(model).not.toMatch(/selectActivityType|selectTargetDimension|chooseActivity/);
    expect(model).toMatch(/activityType: decision\.activityType/);
    expect(model).toMatch(/activityType: null/);
    // and no score/threshold inputs at all -- the model's inputs are
    // enums + presence counts.
    expect(model).not.toMatch(/masteryScore|understandingScore|forgettingRisk|retentionScore/);
  });

  it('the concept page no longer re-derives the decision or carries a page-local next-action heuristic', () => {
    expect(page).not.toMatch(/getBestLearningDecisionForConcept/);
    expect(page).not.toMatch(/primaryCTA/);
    expect(page).not.toMatch(/orderedManualToolKeys/);
    expect(page).toMatch(/getConceptMissionView\(/);
  });
});

describe('no raw orchestration internals ever reach the learner (Part 4)', () => {
  const component = read(MISSION_COMPONENT_PATH);

  it('never interpolates a raw activityType / reasonCode / policy field as a JSX text node', () => {
    // a raw enum rendered directly as text would look like `>{now.activityType}<`
    expect(component).not.toMatch(/>\s*\{now\.activityType\}\s*</);
    expect(component).not.toMatch(/>\s*\{view\.journey\.reasonCode\}\s*</);
    expect(component).not.toMatch(/>\s*\{now\.learningState\}\s*</);
    // reasonCode is only ever used to index the conceptMission.reason.* copy table
    expect(component).toMatch(/conceptMission\.reason\.\$\{view\.journey\.reasonCode\}/);
  });

  it('every render of the decision goes through the certified activityLabel/activityCta mappers', () => {
    expect(component).toMatch(/activityLabel\(now\.activityType, t\)/);
    expect(component).toMatch(/activityCta\(now\.activityType, t\)/);
  });
});

describe('canonical why/reason presentation (Part 5) -- reuses WhyThisV3, no second reason table', () => {
  const component = read(MISSION_COMPONENT_PATH);
  const model = read(MISSION_MODEL_PATH);

  it('imports and renders the certified WhyThisV3 component with the decision\'s own facts', () => {
    expect(component).toMatch(/import WhyThisV3 from '@\/app\/dashboard\/WhyThisV3'/);
    expect(component).toMatch(/<WhyThisV3 facts=\{now\.facts\} t=\{t\} \/>/);
  });

  it('does not define a second fact/reason-to-copy switch statement in the Mission layer', () => {
    for (const src of [component, model]) {
      expect(src).not.toMatch(/switch\s*\(\s*fact\.kind\s*\)/);
      expect(src).not.toMatch(/case 'retentionReviewDue'/);
    }
  });
});

describe('canonical launch routing (Part 6/7) -- StartSessionButton is the only mechanism, no second routing table', () => {
  const component = read(MISSION_COMPONENT_PATH);

  it('imports and renders StartSessionButton for the next-action CTA, scoped to this concept', () => {
    expect(component).toMatch(/import StartSessionButton from '@\/app\/dashboard\/StartSessionButton'/);
    expect(component).toMatch(/<StartSessionButton[\s\S]{0,400}actionConceptId=\{now\.actionConceptId\}/);
  });

  it('never hardcodes a remediation route, a quiz mode URL, or any manual href built from the decision', () => {
    // the CANONICAL_ACTION branch (up to the NO_CANONICAL_ACTION comment)
    const canonicalBranch = component.slice(
      component.indexOf("now.kind === 'CANONICAL_ACTION'"),
      component.indexOf('// NO_CANONICAL_ACTION'),
    );
    expect(canonicalBranch.length).toBeGreaterThan(0);
    expect(canonicalBranch).not.toMatch(/\/dashboard\/remediation/);
    expect(canonicalBranch).not.toMatch(/\/dashboard\/quiz\?/);
    expect(canonicalBranch).not.toMatch(/\/dashboard\/cognitive/);
    expect(canonicalBranch).not.toMatch(/href=/);
  });

  it('wires the existing unavailable/retry degradation labels -- never a bespoke error string', () => {
    expect(component).toMatch(/unavailableLabel=\{t\['today3\.unavailableBody'\]\}/);
    expect(component).toMatch(/retryLabel=\{t\['today3\.retry'\]\}/);
  });

  it('a REMEDIATION decision reaches the 6L-B1 shell purely through the pre-existing, already-certified session-engine chain -- proven by that chain\'s own certified tests, not re-derived here', () => {
    const engineSource = read('src/services/learning-session-engine.service.ts');
    expect(engineSource).toMatch(/`\/dashboard\/remediation\/\$\{path\.id\}`/);
  });
});

describe('failure degradation (Part 3) -- decision lookup failure never breaks the screen or fabricates a recommendation', () => {
  const service = read(MISSION_SERVICE_PATH);
  const model = read(MISSION_MODEL_PATH);

  it('the canonical call is wrapped in .catch(() => null), matching the 6L-B1-established pattern', () => {
    expect(service).toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)\.catch\(\(\) => null\)/);
  });

  it('a null decision yields NO_CANONICAL_ACTION with no activity -- never a fabricated default recommendation', () => {
    expect(model).toMatch(/kind: 'NO_CANONICAL_ACTION'/);
    // the no-decision fallback is LEARN_FIRST / CONSOLIDATED_NO_ACTION,
    // neither of which is an ActivityType from the taxonomy.
    expect(model).toMatch(/fallback: stage === 'CONSOLIDATED' \? 'CONSOLIDATED_NO_ACTION' : 'LEARN_FIRST'/);
    // full behavioural coverage of the null path lives in
    // tests/unit/lx3-concept-mission.test.ts.
  });

  it('the decision fetch is one of the independent Promise.all reads in the boundary, not sequenced after them', () => {
    const promiseAllBlocks = service.match(/await Promise\.all\(\[[\s\S]*?\]\);/g) ?? [];
    const decisionBlock = promiseAllBlocks.find((b) => b.includes('getBestLearningDecisionForConcept'));
    expect(decisionBlock).toBeTruthy();
    expect(decisionBlock).toMatch(/\.catch\(\(\) => null\)/);
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
