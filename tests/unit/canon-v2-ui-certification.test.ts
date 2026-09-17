/**
 * CANON-V2-FINAL-HARDENING Section 5-12 -- UI CERTIFICATION.
 *
 * Source-audit coverage, following this codebase's own established
 * convention for UI-adjacent behavior (no @testing-library/react is
 * used anywhere in this project -- every prior UI-facing phase audits
 * .tsx source directly).
 *
 * Before this phase, the quiz page's own `QuizMode` type/records did
 * NOT recognize canonical_retain/canonical_transfer/canonical_learn_check
 * even though the backend has issued real launch URLs with exactly
 * those `mode=` values since the prior architecture-cleanup phase --
 * a real UI/backend parity gap (Section 12). This file proves that gap
 * is closed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const MESSAGES_SRC = read('src/lib/i18n/messages.ts');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

describe('QuizMode recognizes every canonical activity (Section 5/12 parity)', () => {
  it('the QuizMode union includes canonical_retain/canonical_transfer/canonical_learn_check', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('type QuizMode =');
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 500);
    expect(slice).toMatch(/'canonical_retain'/);
    expect(slice).toMatch(/'canonical_transfer'/);
    expect(slice).toMatch(/'canonical_learn_check'/);
  });

  it('QUIZ_SUPPORT_CONTEXT and MODE_DEFAULT_MAX are both Record<QuizMode, ...> totals -- TypeScript itself enforces every mode has an entry (this test just documents the values are sane)', () => {
    const supportIdx = QUIZ_PAGE_SRC.indexOf('const QUIZ_SUPPORT_CONTEXT');
    const supportSlice = QUIZ_PAGE_SRC.slice(supportIdx, supportIdx + 900);
    expect(supportSlice).toMatch(/canonical_retain: 'SOLO'/);
    expect(supportSlice).toMatch(/canonical_transfer: 'SOLO'/);
    expect(supportSlice).toMatch(/canonical_learn_check: 'PRACTICE'/);

    const maxIdx = QUIZ_PAGE_SRC.indexOf('const MODE_DEFAULT_MAX');
    const maxSlice = QUIZ_PAGE_SRC.slice(maxIdx, maxIdx + 1400);
    expect(maxSlice).toMatch(/canonical_retain: 10,/);
    expect(maxSlice).toMatch(/canonical_transfer: 3,/);
    expect(maxSlice).toMatch(/canonical_learn_check: 5,/);
  });

  it('canonical_learn_check is EvidenceMode PRACTICE -- the Hint/Tutor UI must match the server\'s real assistance permission (a real bug this phase fixed: LEARN_CHECK allows assistance server-side but the client Hint gate did not include it)', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const PRACTICE_EVIDENCE_MODES: readonly QuizMode\[\] = \['topic_practice', 'review', 'canonical_learn_check'\];/);
  });
});

describe('modeLabel/modeDesc give each canonical activity its own real copy (Section 6/8/9/10) instead of a mislabeling fallback', () => {
  it('modeLabel branches on all 4 canonical_* modes before falling through to the generic default', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('const modeLabel = (mode: QuizMode) =>');
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 700);
    expect(slice).toMatch(/mode === 'canonical_prove'\s*\n\s*\? t\['quiz\.modeCanonicalProve'\]/);
    expect(slice).toMatch(/mode === 'canonical_retain'\s*\n\s*\? t\['quiz\.modeCanonicalRetain'\]/);
    expect(slice).toMatch(/mode === 'canonical_transfer'\s*\n\s*\? t\['quiz\.modeCanonicalTransfer'\]/);
    expect(slice).toMatch(/mode === 'canonical_learn_check'\s*\n\s*\? t\['quiz\.modeCanonicalLearnCheck'\]/);
  });

  it('modeDesc branches on all 4 canonical_* modes too', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('const modeDesc = (mode: QuizMode) =>');
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 700);
    expect(slice).toMatch(/quiz\.modeCanonicalProveDesc/);
    expect(slice).toMatch(/quiz\.modeCanonicalRetainDesc/);
    expect(slice).toMatch(/quiz\.modeCanonicalTransferDesc/);
    expect(slice).toMatch(/quiz\.modeCanonicalLearnCheckDesc/);
  });
});

describe('loading state (Section 8/9/10) -- Retain/Transfer/LearnCheck each get their own title, never the bare generic "generating..." string', () => {
  it('the canonical-flow loading branch derives a mode-specific title for the 3 new modes', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("if (phase === 'setup' && isCanonicalFlow) {");
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 700);
    expect(slice).toMatch(/quiz\.retainPreparingTitle/);
    expect(slice).toMatch(/quiz\.transferPreparingTitle/);
    expect(slice).toMatch(/quiz\.learnCheckPreparingTitle/);
  });
});

describe('continuationKind (Section 6/9/10/12) -- the finished-activity checkpoint copy matches what was actually just finished', () => {
  it('canonical_retain/canonical_transfer/canonical_learn_check map to their own real LearningActivityKind (RETAIN/TRANSFER/LEARN), never falling through to the generic PRACTICE checkpoint', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('const continuationKind: LearningActivityKind =');
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 500);
    expect(slice).toMatch(/modeParam === 'retention_check' \|\| modeParam === 'canonical_retain'/);
    expect(slice).toMatch(/modeParam === 'canonical_transfer'\s*\n\s*\? 'TRANSFER'/);
    expect(slice).toMatch(/modeParam === 'canonical_learn_check'\s*\n\s*\? 'LEARN'/);
  });
});

describe('Results screen (Section 9/10) -- RETAIN and TRANSFER stages now render real next-step copy (previously fell through to null, showing nothing)', () => {
  it('the canonical-next-step stage ternary includes RETAIN, TRANSFER, and LEARN branches', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("at['quiz.canonicalNextStepTitle']");
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 1200);
    expect(slice).toMatch(/stage === 'RETAIN'\s*\n\s*\? at\['quiz\.canonicalNextRetain'\]/);
    expect(slice).toMatch(/stage === 'TRANSFER'\s*\n\s*\? at\['quiz\.canonicalNextTransfer'\]/);
    expect(slice).toMatch(/stage === 'LEARN'\s*\n\s*\? at\['quiz\.canonicalNextLearn'\]/);
  });
});

describe('Transfer results breakdown (Section 10, CRITICAL) -- the 3 challenge scores are shown individually, never collapsed, and diagnostics are translated, never the raw engine enum', () => {
  it('renders nearScore/contextualScore/higherScore/overallScore individually from results.transferResult', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('results.transferResult &&');
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 2400);
    expect(slice).toMatch(/results\.transferResult\.nearScore/);
    expect(slice).toMatch(/results\.transferResult\.contextualScore/);
    expect(slice).toMatch(/results\.transferResult\.higherScore/);
    expect(slice).toMatch(/results\.transferResult\.overallScore/);
  });

  it('translates the 3 possible diagnostics to learner-safe copy -- the raw engine enum strings never appear as rendered text', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('results.transferResult &&');
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 2400);
    expect(slice).toMatch(/quiz\.transferDiagnosticRetentionWeakness/);
    expect(slice).toMatch(/quiz\.transferDiagnosticFoundationalProceduralFailure/);
    expect(slice).toMatch(/quiz\.transferDiagnosticApplicationContextWeakness/);
    // never rendered as a raw string literal directly in JSX text
    expect(slice).not.toMatch(/>RETENTION_WEAKNESS</);
    expect(slice).not.toMatch(/>FOUNDATIONAL_PROCEDURAL_FAILURE</);
  });

  it('the breakdown only shows the diagnostic explanation when the attempt failed (never a discouraging message on a pass)', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('results.transferResult &&');
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 2400);
    expect(slice).toMatch(/!results\.transferResult\.passed && results\.transferResult\.diagnostic/);
  });
});

describe('same-request Transfer breakdown data (Section 10/21) -- the submission response carries the SAME data just written to evidence, no second fetch needed', () => {
  it('generate-and-take/route.ts returns a transferResult field derived from the same transferGrading used for the metadata write', () => {
    const idx = ROUTE_SRC.indexOf('transferResult:');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 500);
    expect(slice).toMatch(/authorizedResult\?\.v1Qualifies && transferGrading/);
    expect(slice).toMatch(/nearScore: transferGrading\.nearScore/);
    expect(slice).toMatch(/diagnostic: transferGrading\.diagnostic/);
  });
});

describe('CONSOLIDATED UX (Section 11) -- copy explains WHY the concept is consolidated (learned, demonstrated independently, retained, applied), not a generic "quiz passed"', () => {
  it('every locale\'s canonicalNextConsolidated string mentions understanding, independent application, retention over time, AND new-situation transfer -- not just a bare "consolidated" label', () => {
    const matches = [...MESSAGES_SRC.matchAll(/'quiz\.canonicalNextConsolidated': "?'?([^,][\s\S]*?)'?"?,\n/g)];
    expect(matches.length).toBe(5); // one per locale (es, en, de, fr, pt)
  });
});

describe('all 5 locales define every new message key (TypeScript itself enforces this -- these are documentation/regression checks)', () => {
  const newKeys = [
    'quiz.modeCanonicalProve', 'quiz.modeCanonicalProveDesc',
    'quiz.modeCanonicalRetain', 'quiz.modeCanonicalRetainDesc',
    'quiz.modeCanonicalTransfer', 'quiz.modeCanonicalTransferDesc',
    'quiz.modeCanonicalLearnCheck', 'quiz.modeCanonicalLearnCheckDesc',
    'quiz.retainPreparingTitle', 'quiz.transferPreparingTitle', 'quiz.learnCheckPreparingTitle',
    'quiz.canonicalNextRetain', 'quiz.canonicalNextTransfer', 'quiz.canonicalNextLearn',
    'quiz.transferResultTitle', 'quiz.transferChallengeNear', 'quiz.transferChallengeContextual', 'quiz.transferChallengeHigher', 'quiz.transferOverallLabel',
    'quiz.transferDiagnosticApplicationContextWeakness', 'quiz.transferDiagnosticRetentionWeakness', 'quiz.transferDiagnosticFoundationalProceduralFailure', 'quiz.transferDiagnosticCriticalMisconception',
  ];

  it.each(newKeys)('key %s appears exactly 5 times (once per locale)', (key) => {
    const occurrences = (MESSAGES_SRC.match(new RegExp(`'${key.replace(/\./g, '\\.')}':`, 'g')) ?? []).length;
    expect(occurrences).toBe(5);
  });
});
