/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-C1-R1: CANONICAL NEXT-ACTION RECONCILIATION.
 *
 * SUPERSEDED BY LX-3 (CONCEPT MISSION).
 *
 * 6L-C1-R1 reconciled two competing "what should I do next?" answers on
 * the concept page: Phase 4's canonical LearningDecision, and a
 * pre-existing page-local heuristic (`primaryCTA`, over
 * mastery/independence/retention thresholds) that it demoted to an
 * "other ways" row of equally-weighted manual tools.
 *
 * LX-3 removed the heuristic outright -- there is no `primaryCTA`, no
 * `ctaConfig`, no `orderedManualToolKeys`, and no manual practice/
 * soloCheck/review link row on the concept screen anymore. The concept
 * page no longer fetches or interprets any decision itself; the ONE
 * next action is owned entirely by the Concept Mission read boundary +
 * component. So the R1 reconciliation is now vacuous by construction --
 * these tests assert the stronger LX-3 end-state instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PAGE_PATH = 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx';
const MISSION_COMPONENT_PATH = 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission.tsx';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

describe('LX-3: the page-local next-action heuristic is gone entirely (no reconciliation left to do)', () => {
  const page = read(PAGE_PATH);

  it('no primaryCTA / ctaConfig / orderedManualToolKeys / secondaryCTAs remain', () => {
    expect(page).not.toMatch(/primaryCTA/);
    expect(page).not.toMatch(/const ctaConfig/);
    expect(page).not.toMatch(/orderedManualToolKeys/);
    expect(page).not.toMatch(/secondaryCTAs/);
  });

  it('no manual practice/soloCheck/review quiz-link row is offered as an alternative activity', () => {
    expect(page).not.toMatch(/conceptDetail\.otherWaysTitle/);
    expect(page).not.toMatch(/\/dashboard\/quiz\?subjectId=\$\{subjectId\}&conceptId=\$\{conceptId\}&mode=/);
    expect(page).not.toMatch(/ctaPractice|ctaSoloCheck|ctaReview/);
  });

  it('the page no longer fetches or maps a LearningDecision itself', () => {
    expect(page).not.toMatch(/getBestLearningDecisionForConcept/);
    expect(page).not.toMatch(/nextDecision/);
    expect(page).not.toMatch(/activityType.*===.*'practice'|mapDecisionToLegacyCta|reconcileNextAction|mergeRecommendations/i);
  });
});

describe('LX-3: exactly one primary CTA on the concept screen -- the canonical StartSessionButton', () => {
  const page = read(PAGE_PATH);
  const component = read(MISSION_COMPONENT_PATH);

  it('the page body contains no literal btn-primary CTA (the "not authenticated" branch is a separate render)', () => {
    const mainReturn = page.slice(page.indexOf('return (\n    <div style={{ maxWidth: 640 }}>'));
    expect(mainReturn.match(/className="btn btn-primary"/g) ?? []).toHaveLength(0);
  });

  it('the Mission renders StartSessionButton only for a canonical action; the no-action fallback offers no activity', () => {
    expect(component).toMatch(/<StartSessionButton/);
    const startIdx = component.indexOf('<StartSessionButton');
    const canonicalBranchStart = component.indexOf("now.kind === 'CANONICAL_ACTION'");
    const noActionComment = component.indexOf('// NO_CANONICAL_ACTION');
    // the single StartSessionButton sits inside the CANONICAL_ACTION branch
    expect(startIdx).toBeGreaterThan(canonicalBranchStart);
    expect(startIdx).toBeLessThan(noActionComment);
  });
});

describe('LX-3: the situation label survives only as demoted, informational-only context', () => {
  const page = read(PAGE_PATH);

  it('is computed from the same canonical conceptSituation() call, with no embedded next-action', () => {
    expect(page).toMatch(/conceptSituation\(knowledgeState\.masteryState, knowledgeState\.validationReadiness,/);
    const situationBlock = page.match(/\{situation && \(([\s\S]*?)\)\}/);
    expect(situationBlock).toBeTruthy();
    expect(situationBlock![1]).not.toMatch(/situationNextLabel|StartSessionButton|activityCta|<Link/);
  });

  it('lives inside the "More about my progress" progressive-disclosure block, not the primary flow', () => {
    const detailsIdx = page.indexOf('<details className="cm-more"');
    const situationIdx = page.indexOf('{situation && (');
    const detailsCloseIdx = page.indexOf('</details>');
    expect(detailsIdx).toBeGreaterThan(-1);
    expect(situationIdx).toBeGreaterThan(detailsIdx);
    expect(situationIdx).toBeLessThan(detailsCloseIdx);
  });
});

describe('Step 28 / 6L-B1 / policy protection (re-verified for this reconciliation step)', () => {
  it('Concept Detail still never imports quiz/page.tsx or quiz-answer-guards', () => {
    const source = read(PAGE_PATH);
    expect(source).not.toMatch(/dashboard\/quiz\/page/);
    expect(source).not.toMatch(/quiz-answer-guards/);
  });

  it('the pre-existing conceptDetail.* i18n keys are still present and unclobbered', () => {
    const source = read('src/lib/i18n/messages.ts');
    for (const key of ['conceptDetail.nextSectionTitle', 'conceptDetail.otherWaysTitle', 'conceptDetail.situationTitle']) {
      expect(source.split(`'${key}':`).length - 1).toBe(5);
    }
    expect(source).not.toContain('quiz.confidenceRequired');
    for (const untouched of [
      "'quiz.confidenceQuestion':",
      "'dashboard.avgMastery':",
      "'remediation.headerTitle':",
    ]) {
      expect(source).toContain(untouched);
    }
  });

  it('6L-B1 remediation files remain untouched', () => {
    const viewSource = read('src/lib/remediation-session-view.ts');
    expect(viewSource).toMatch(/if \(!path \|\| path\.studentId !== studentId\) return \{ status: 'NOT_FOUND' \};/);
    const engineSource = read('src/services/learning-session-engine.service.ts');
    expect(engineSource).toMatch(/`\/dashboard\/remediation\/\$\{path\.id\}`/);
    const shellSource = read('src/app/dashboard/remediation/[pathId]/page.tsx');
    expect(shellSource).toMatch(/href=\{view\.activityHref\}/);
  });
});
