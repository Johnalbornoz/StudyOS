/**
 * CANON-V2-PREVIEW-CERT Section 14/15 -- TRANSFER UI COMPLETION.
 *
 * Source-audit coverage, matching this codebase's own established
 * convention for UI-adjacent behavior.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const MESSAGES_SRC = read('src/lib/i18n/messages.ts');
const CLIENT_QUESTION_SRC = read('src/lib/quiz/client-question.ts');

describe('transferDepth reaches the client (Section 14: the learner must be able to know which challenge type they are on)', () => {
  it('toClientQuestion includes transferDepth in the shape sent to the client', () => {
    expect(CLIENT_QUESTION_SRC).toMatch(/transferDepth: q\.transferDepth,/);
  });

  it('the quiz page\'s own client Question interface declares transferDepth', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('interface Question {');
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 700);
    expect(slice).toMatch(/transferDepth\?: 'NEAR' \| 'CONTEXTUAL' \| 'HIGHER';/);
  });
});

describe('pre-execution TRANSFER framing screen (Section 14) -- shown once, before the first challenge', () => {
  it('a dedicated transferIntroDismissed gate exists, shown only for canonical_transfer with real questions loaded', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const \[transferIntroDismissed, setTransferIntroDismissed\] = useState\(false\);/);
    const idx = QUIZ_PAGE_SRC.indexOf("quizMode === 'canonical_transfer' && questions.length > 0 && !transferIntroDismissed");
    expect(idx).toBeGreaterThan(-1);
  });

  it('the intro screen lists all 3 challenge types in learner language, never the raw enum names', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("quizMode === 'canonical_transfer' && questions.length > 0 && !transferIntroDismissed");
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 1500);
    expect(slice).toMatch(/quiz\.transferChallengeNear/);
    expect(slice).toMatch(/quiz\.transferChallengeContextual/);
    expect(slice).toMatch(/quiz\.transferChallengeHigher/);
    expect(slice).not.toMatch(/>NEAR</);
    expect(slice).not.toMatch(/>CONTEXTUAL</);
    expect(slice).not.toMatch(/>HIGHER</);
  });

  it('dismissing the intro is a one-way transition (setTransferIntroDismissed(true)) -- it never reappears mid-activity', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("quizMode === 'canonical_transfer' && questions.length > 0 && !transferIntroDismissed");
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 1500);
    expect(slice).toMatch(/onClick=\{\(\) => setTransferIntroDismissed\(true\)\}/);
  });
});

describe('in-execution challenge-type-aware progress (Section 14) -- richer than generic "Question X of Y" for Transfer specifically', () => {
  it('the progress indicator branches on quizMode === canonical_transfer and the current question\'s own transferDepth', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("quizMode === 'canonical_transfer' && questions[current]?.transferDepth");
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 600);
    expect(slice).toMatch(/quiz\.transferChallengeNear/);
    expect(slice).toMatch(/quiz\.transferChallengeContextual/);
    expect(slice).toMatch(/quiz\.transferChallengeHigher/);
  });

  it('every OTHER mode keeps the plain generic "current+1/length" progress indicator, unaffected', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("quizMode === 'canonical_transfer' && questions[current]?.transferDepth");
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 900);
    expect(slice).toMatch(/: `\$\{current \+ 1\}\/\$\{questions\.length\}`/);
  });
});

describe('all 5 locales define the 2 new intro-screen keys', () => {
  for (const key of ['quiz.transferIntroBody', 'quiz.transferIntroStart']) {
    it(`${key} appears exactly 5 times (once per locale)`, () => {
      const occurrences = (MESSAGES_SRC.match(new RegExp(`'${key.replace(/\./g, '\\.')}':`, 'g')) ?? []).length;
      expect(occurrences).toBe(5);
    });
  }
});
