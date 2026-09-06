/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-C1-R1: CANONICAL NEXT-ACTION RECONCILIATION.
 *
 * The 6L-C1 visual review found that Concept Detail exposed TWO
 * competing "what should I do next?" answers: the new canonical
 * section (Phase 4's LearningDecision) and a pre-existing page-local
 * heuristic (mastery/independentMastery/retention thresholds), shown
 * both inside the situation banner ("Qué hacer ahora") and again as
 * the bottom row's primary CTA. This file proves that reconciliation:
 * Phase 4 is now the ONLY perceptible pedagogical next-action
 * authority, and the heuristic survives only as clearly secondary,
 * equally-weighted manual tools, never framed as a recommendation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PAGE_PATH = 'src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

describe('Phase 4 is the sole pedagogical next-action authority (Part 11 of the review spec)', () => {
  const source = read(PAGE_PATH);

  it('the situation banner no longer contains a "what to do now" action line or the old situationNextLabel key', () => {
    // The whole {situation && (...)} block must render only the
    // situation heading + label -- never a second recommendation.
    const situationBlock = source.match(/\{situation && \(([\s\S]*?)\n {6}\)\}/);
    expect(situationBlock).toBeTruthy();
    expect(situationBlock![1]).not.toMatch(/situationNextLabel/);
    expect(situationBlock![1]).not.toMatch(/ctaConfig\[primaryCTA\]/);
    expect(situationBlock![1]).not.toMatch(/<Link/);
  });

  it('there is exactly one btn-primary CTA in the entire page\'s main render path (the canonical StartSessionButton) -- the bottom row and situation banner contain none', () => {
    // The early-return "not enough evidence" branch (a wholly separate,
    // pre-existing degradation path, out of this step's scope) still
    // has its own single Link with className="btn btn-primary" --
    // excluded here since it can never coexist on the same render with
    // the canonical section (state is null in that branch).
    const mainReturnStart = source.indexOf('return (\n    <div style={{ maxWidth: 640 }}>');
    expect(mainReturnStart).toBeGreaterThan(-1);
    const mainReturn = source.slice(mainReturnStart);
    const primaryLinkMatches = mainReturn.match(/className="btn btn-primary"/g) ?? [];
    // StartSessionButton itself renders variant="primary" internally
    // (not a literal "btn btn-primary" string in this file) -- so any
    // literal occurrence of that class string in the main render path
    // would mean a second, page-local primary CTA was reintroduced.
    expect(primaryLinkMatches.length).toBe(0);
  });

  it('the bottom manual-tools row is demoted to btn-secondary for every item, with no privileged first item', () => {
    const bottomRowMatch = source.match(/\{orderedManualToolKeys\.map\(\(k\) => \(([\s\S]*?)\)\)\}/);
    expect(bottomRowMatch).toBeTruthy();
    expect(bottomRowMatch![1]).toMatch(/className="btn btn-secondary"/);
    expect(bottomRowMatch![1]).not.toMatch(/btn-primary/);
  });

  it('the manual-tools row title never claims to be a recommendation ("what to do now" style copy)', () => {
    expect(source).toMatch(/t\['conceptDetail\.otherWaysTitle'\]/);
    expect(source).not.toMatch(/conceptDetail\.situationNextLabel/);
  });

  it('the legacy primaryCTA heuristic is retained only to ORDER the manual tools, never to select a recommendation', () => {
    // It must still exist (Part 7: remove only if clearly unused; here
    // it is genuinely still used, just for ordering) and must feed
    // exactly one array used by the demoted row -- never a second
    // conditional render branch of its own.
    expect(source).toMatch(/const orderedManualToolKeys: CTA\[\] = \[primaryCTA, /);
    // The old `secondaryCTAs` identifier is gone as actual code (only
    // mentioned in a historical comment explaining the rename) --
    // never used as a variable/property access.
    expect(source).not.toMatch(/secondaryCTAs\.map/);
    expect(source).not.toMatch(/secondaryCTAs\s*=\s*\(/);
  });
});

describe('no local reconciliation algorithm was introduced (Part 12 of the review spec)', () => {
  const source = read(PAGE_PATH);

  it('primaryCTA\'s own selection logic is unchanged -- no new comparison against nextDecision', () => {
    const heuristicBlock = source.match(/const primaryCTA: CTA =[\s\S]*?: 'tutor';/);
    expect(heuristicBlock).toBeTruthy();
    expect(heuristicBlock![0]).not.toMatch(/nextDecision/);
  });

  it('nextDecision\'s own fetch/render is unchanged by the reconciliation -- still the single canonical call, still .catch(() => null)', () => {
    expect(source).toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)\.catch\(\(\) => null\)/);
    // Exactly one call site.
    expect((source.match(/getBestLearningDecisionForConcept\(/g) ?? []).length).toBe(1);
  });

  it('there is no function/logic that maps between an ActivityType and a legacy CTA key (no reconciliation table)', () => {
    expect(source).not.toMatch(/activityType.*===.*'practice'|'practice'.*===.*activityType/i);
    expect(source).not.toMatch(/mapDecisionToLegacyCta|reconcileNextAction|mergeRecommendations/i);
  });
});

describe('null-decision behavior does not imply a fake canonical recommendation (Part 4 of the review spec)', () => {
  const source = read(PAGE_PATH);

  it('the manual-tools row renders unconditionally (not gated on nextDecision), using only the neutral "other ways" framing', () => {
    // It must not be wrapped in a `{!nextDecision && (...)}` or similar
    // conditional that would make it *look* like a fallback
    // recommendation appearing only when the canonical one is absent;
    // it is a stable, always-available, always-secondary utility.
    const otherWaysIndex = source.indexOf("t['conceptDetail.otherWaysTitle']");
    expect(otherWaysIndex).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, otherWaysIndex - 200), otherWaysIndex);
    expect(before).not.toMatch(/\{!nextDecision/);
    expect(before).not.toMatch(/\{nextDecision \? /);
  });

  it('when nextDecision is null, no element on the page uses "what to do now"-style wording', () => {
    expect(source).not.toMatch(/situationNextLabel/);
  });
});

describe('accessibility -- semantic heading hierarchy (Part 6 of the review spec)', () => {
  const source = read(PAGE_PATH);

  it('"Lo siguiente" (nextSectionTitle) is a real heading now, not a plain styled div', () => {
    expect(source).toMatch(/<h2 className="label"[^>]*>\{t\['conceptDetail\.nextSectionTitle'\]\}<\/h2>/);
  });

  it('"Tu situación actual" (situationTitle) is also a real heading, preserving a flat h1 -> h2* hierarchy consistent with the rest of the page', () => {
    expect(source).toMatch(/<h2 className="label"[^>]*>\{t\['conceptDetail\.situationTitle'\]\}<\/h2>/);
  });

  it('no heading level beyond h1/h2 is introduced purely for styling', () => {
    expect(source).not.toMatch(/<h3/);
    expect(source).not.toMatch(/<h4/);
  });
});

describe('Step 28 / 6L-B1 / policy protection (re-verified for this reconciliation step)', () => {
  it('Concept Detail still never imports quiz/page.tsx or quiz-answer-guards', () => {
    const source = read(PAGE_PATH);
    expect(source).not.toMatch(/dashboard\/quiz\/page/);
    expect(source).not.toMatch(/quiz-answer-guards/);
  });

  it('this reconciliation touches ONLY its own conceptDetail.* i18n keys -- adds them, clobbers nothing, and never pulls in Step 28 content', () => {
    // 6L-C1-R2 decoupling -- see the twin test in
    // 6l-c1-concept-next-action.test.ts for the full rationale. The
    // previous assertion required the uncommitted Step 28
    // `quiz.confidenceRequired*` strings to be present, which fails on a
    // clean checkout of this release (Step 28 is a separate workstream).
    const source = read('src/lib/i18n/messages.ts');

    for (const key of ['conceptDetail.nextSectionTitle', 'conceptDetail.otherWaysTitle']) {
      expect(source).toMatch(new RegExp(`\\|\\s*'${key.replace(/\./g, '\\.')}'`));
      expect(source.split(`'${key}':`).length - 1).toBe(5);
    }

    expect(source).not.toContain('quiz.confidenceRequired');

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

  it('6L-B1 remediation files remain untouched', () => {
    const viewSource = read('src/lib/remediation-session-view.ts');
    expect(viewSource).toMatch(/if \(!path \|\| path\.studentId !== studentId\) return \{ status: 'NOT_FOUND' \};/);
    const engineSource = read('src/services/learning-session-engine.service.ts');
    expect(engineSource).toMatch(/`\/dashboard\/remediation\/\$\{path\.id\}`/);
    const shellSource = read("src/app/dashboard/remediation/[pathId]/page.tsx");
    expect(shellSource).toMatch(/href=\{view\.activityHref\}/);
  });
});
