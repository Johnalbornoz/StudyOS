/**
 * F0-S Finding A -- `handleSubmitQuiz` in generate-and-take/route.ts
 * did not verify that the loaded `quizSession` belongs to the
 * authenticated (and already `verifyStudentAccess`-checked)
 * `validated.studentId` before grading/completing it.
 *
 * Source-level audit, matching this exact file's own established
 * testing convention (see canon-r5r1-generate-and-take-wiring.test.ts's
 * header comment): this route is 1500+ lines deeply woven with AI
 * generation/grading/retry logic and 20+ service imports, so a full
 * behavioral invocation would require mocking most of the module just
 * to reach one early-return branch. A source-level assertion that the
 * exact ownership check exists, in the right place, returning the same
 * response as a genuinely-missing quiz, is the established, lower-risk
 * verification style for this specific file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTE_SRC = readFileSync(join(process.cwd(), 'src/app/api/quizzes/generate-and-take/route.ts'), 'utf-8');

describe('F0-S Finding A -- quiz submission enforces quiz-session ownership', () => {
  it('handleSubmitQuiz verifies studentId ownership before trusting the caller-supplied studentId', () => {
    const idx = ROUTE_SRC.indexOf('async function handleSubmitQuiz');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 1200);
    expect(slice).toMatch(/verifyStudentAccess\(userId, validated\.studentId, role\)/);
  });

  it('the quizSession existence check also verifies quizSession.studentId matches validated.studentId, in the same branch', () => {
    const idx = ROUTE_SRC.indexOf('const quizSession = await getQuizSession(validated.quizId);');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 700);
    // Own resource: NOT flagged missing/mismatched.
    expect(slice).toMatch(/if \(!quizSession \|\| quizSession\.studentId !== validated\.studentId\)/);
  });

  it('a quiz session owned by a different student produces the SAME response shape as a genuinely missing quiz -- never a distinct FORBIDDEN that would confirm the id exists for someone else', () => {
    const checkIdx = ROUTE_SRC.indexOf('if (!quizSession || quizSession.studentId !== validated.studentId) {');
    expect(checkIdx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(checkIdx, checkIdx + 300);
    expect(slice).toMatch(/error: 'QUIZ_NOT_FOUND'/);
    expect(slice).toMatch(/status: 400/);
  });

  it('the ownership check runs BEFORE any grading/mastery-update logic (before cachedQuestions is read)', () => {
    const ownershipIdx = ROUTE_SRC.indexOf('quizSession.studentId !== validated.studentId');
    const gradingIdx = ROUTE_SRC.indexOf('const cachedQuestions = quizSession.questions;');
    expect(ownershipIdx).toBeGreaterThan(-1);
    expect(gradingIdx).toBeGreaterThan(-1);
    expect(ownershipIdx).toBeLessThan(gradingIdx);
  });

  it('the identical ownership pattern already used by sibling routes (hint/verify/contextual-help/teaching-intent/localize-question) was reused, not reinvented', () => {
    const hintSrc = readFileSync(join(process.cwd(), 'src/app/api/quizzes/hint/route.ts'), 'utf-8');
    const verifySrc = readFileSync(join(process.cwd(), 'src/app/api/quizzes/verify/route.ts'), 'utf-8');
    const pattern = /quizSession\.studentId !== (validated\.studentId|studentId)/;
    expect(hintSrc).toMatch(pattern);
    expect(verifySrc).toMatch(pattern);
    expect(ROUTE_SRC).toMatch(pattern);
  });
});
