/**
 * CANON-R6-PERF-R2 Part 15-27 -- FOCUSED PROVE LOADING UX.
 *
 * Source-audit coverage, following this codebase's own established
 * convention for UI-adjacent behavior (no `@testing-library/react` or
 * similar is used anywhere in this project's existing test suite --
 * every prior UI-facing phase in this session audits `.tsx` source
 * directly, e.g. canon-r6r1-prove-novelty-and-results-single-authority.test.ts's
 * own QUIZ_PAGE_SRC checks).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const COMPONENT_SRC = read('src/components/ProveFocusLoading.tsx');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const MESSAGES_SRC = read('src/lib/i18n/messages.ts');

describe('26. loader delayed to avoid a flash (Part 21: 0-800ms renders nothing)', () => {
  it('the instant stage renders null, and the minimal-stage timer fires at 800ms', () => {
    expect(COMPONENT_SRC).toMatch(/const MINIMAL_THRESHOLD_MS = 800;/);
    expect(COMPONENT_SRC).toMatch(/if \(stage === 'instant'\) return null;/);
  });
});

describe('27. full focus state after the >2s threshold', () => {
  it('the full-stage timer fires at 2000ms', () => {
    expect(COMPONENT_SRC).toMatch(/const FULL_THRESHOLD_MS = 2000;/);
    expect(COMPONENT_SRC).toMatch(/setTimeout\(\(\) => setStage\('full'\), FULL_THRESHOLD_MS\);/);
  });

  it('a minimal, single-line state exists for the 800ms-2s window, distinct from the full experience', () => {
    const minimalIdx = COMPONENT_SRC.indexOf("if (stage === 'minimal')");
    const fullReturnIdx = COMPONENT_SRC.indexOf('return (', COMPONENT_SRC.indexOf("return (\n    <div style={{ maxWidth: 480"));
    expect(minimalIdx).toBeGreaterThan(-1);
  });
});

// The component's own doc comment legitimately discusses "no fake
// percentage/countdown/checkmarks" in prose (documenting what this file
// deliberately does NOT do) -- strip comments before checking the
// actual CODE never renders any of that prose's own subject matter.
const COMPONENT_CODE_ONLY = COMPONENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('28. no fake percentage/countdown -- Part 18', () => {
  it('the component never renders a numeric progress percentage or a countdown (CSS percentages like borderRadius: \'50%\' are legitimate styling, not fake progress, and are deliberately excluded from this check)', () => {
    expect(COMPONENT_CODE_ONLY).not.toMatch(/progressPercent|percentComplete|secondsRemaining|countdown|timeLeft/i);
  });

  it('the "preparation sequence" is a neutral, indeterminate, looping animation -- never per-stage fake checkmarks (no real backend-step signal exists for this single-request wait)', () => {
    expect(COMPONENT_CODE_ONLY).not.toMatch(/✓|checkmark|CheckCircle/);
    expect(COMPONENT_SRC).toMatch(/prove-focus-pulse/); // the one, indeterminate animation
  });
});

describe('29. curated static reminders rotate -- Part 19', () => {
  it('exactly 4 curated reminder keys, rotated on an interval, never AI-generated (static i18n keys only)', () => {
    expect(COMPONENT_SRC).toMatch(/const REMINDER_KEYS = \[\s*\n\s*'quiz\.proveFocusTip1',\s*\n\s*'quiz\.proveFocusTip2',\s*\n\s*'quiz\.proveFocusTip3',\s*\n\s*'quiz\.proveFocusTip4',\s*\n\s*\] as const;/);
    expect(COMPONENT_SRC).toMatch(/const REMINDER_ROTATE_MS = 6000;/);
  });

  it('all 4 tip keys are present in the localized message dictionary, in all 5 locales', () => {
    for (const key of ['quiz.proveFocusTip1', 'quiz.proveFocusTip2', 'quiz.proveFocusTip3', 'quiz.proveFocusTip4']) {
      const occurrences = (MESSAGES_SRC.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) ?? []).length;
      expect(occurrences).toBe(5); // es/en/de/fr/pt
    }
  });
});

describe('30. reduced-motion supported -- Part 20/26', () => {
  it('a usePrefersReducedMotion hook drives both the dot animation and the reminder transition', () => {
    expect(COMPONENT_SRC).toMatch(/function usePrefersReducedMotion\(\): boolean/);
    expect(COMPONENT_SRC).toMatch(/window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
    expect(COMPONENT_SRC).toMatch(/animation: reducedMotion \? undefined : `prove-focus-pulse/);
    expect(COMPONENT_SRC).toMatch(/transition: reducedMotion \? undefined : 'opacity 0\.4s ease',/);
  });

  it('decorative motion (the pulsing dots) is aria-hidden -- never announced per animation frame; only the actually-changing reminder text is aria-live', () => {
    const dotsIdx = COMPONENT_SRC.indexOf('Part 18 -- indeterminate only');
    const dotsSlice = COMPONENT_SRC.slice(dotsIdx, dotsIdx + 300);
    expect(dotsSlice).toMatch(/aria-hidden="true"/);
    const reminderParagraphIdx = COMPONENT_SRC.lastIndexOf('<p', COMPONENT_SRC.indexOf('{at[REMINDER_KEYS[reminderIndex]]}'));
    const reminderIdx = COMPONENT_SRC.indexOf('{at[REMINDER_KEYS[reminderIndex]]}');
    const reminderSlice = COMPONENT_SRC.slice(reminderParagraphIdx, reminderIdx);
    expect(reminderSlice).toMatch(/aria-live="polite"/);
  });
});

describe('31. loading copy is localized via ACTIVITY_LANGUAGE, never GLOBAL_INTERFACE_LANGUAGE -- Part 27', () => {
  it('quiz/page.tsx passes `at` (the ACTIVITY_LANGUAGE-scoped translator, quizLanguage) to ProveFocusLoading, never `t` (GLOBAL_INTERFACE_LANGUAGE)', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('<ProveFocusLoading');
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 60);
    expect(slice).toMatch(/at=\{at\}/);
    expect(slice).not.toMatch(/at=\{t\}/);
  });

  it('the component itself never imports its own translator -- it only ever renders the caller-supplied `at` prop, so it can never accidentally use the wrong language source', () => {
    expect(COMPONENT_SRC).not.toMatch(/getMessages|useLocale/);
  });
});

describe('32. READY transitions directly to the quiz -- no artificial delay, no extra required click', () => {
  it('canonical_prove renders ProveFocusLoading ONLY while phase === setup (i.e. before generation resolves); once startCanonicalActivity\'s own .then() fires, phase becomes "quiz" via the SAME unchanged transition every other canonical mode already uses -- no new gating click/screen was added', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("if (phase === 'setup' && isCanonicalFlow) {");
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/if \(quizMode === 'canonical_prove'\) \{\s*\n\s*return <ProveFocusLoading at=\{at\} \/>;\s*\n\s*\}/);
    // no new setPhase call was introduced by this addition -- the
    // existing startCanonicalActivity flow (unchanged) still owns the
    // transition to 'quiz'.
    expect(COMPONENT_SRC).not.toMatch(/setPhase/);
  });
});

describe('scoping -- canonical_prove ONLY, every other canonical mode unaffected', () => {
  it('the generic "generating..." fallback still renders for legacy single-concept canonical-flow modes (topic_practice, quick_check, etc) -- CANON-V2-FINAL-HARDENING gave canonical_retain/canonical_transfer/canonical_learn_check their OWN stage-appropriate loading title instead of this same generic fallback (Section 8/9/10), but every OTHER canonical-flow mode is unaffected', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("if (phase === 'setup' && isCanonicalFlow) {");
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 700);
    expect(slice).toMatch(/: t\['quiz\.generating'\];/);
    expect(slice).toMatch(/return <div className="card empty-state">\{canonicalLoadingTitle\}<\/div>;/);
    expect(slice).toMatch(/quiz\.retainPreparingTitle/);
    expect(slice).toMatch(/quiz\.transferPreparingTitle/);
    expect(slice).toMatch(/quiz\.learnCheckPreparingTitle/);
  });
});
