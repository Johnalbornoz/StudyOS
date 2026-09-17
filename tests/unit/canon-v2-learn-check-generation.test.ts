/**
 * CANON-V2-ARCH-CLEANUP Section 8.A -- THE CANONICAL LEARN_CHECK
 * GENERATION WIRING.
 *
 * LEARN_CHECK deliberately reuses the SAME generic, mature
 * `generatePracticeQuestions` primitive `topic_practice`/`review`
 * already use -- it is assisted (EvidenceMode PRACTICE), has no
 * independence/novelty/exact-count requirement, and is structurally
 * identical to an ordinary Practice generation call. What makes it
 * canonical LEARN_CHECK rather than a relabeled topic_practice request
 * (Section 13's own "no canonical LEARN_CHECK -> generic quiz"
 * prohibition) is its OWN distinct `quizMode`/`ActivityType`/session
 * authorization -- audited here via source, matching this route's own
 * established structural-test convention.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

describe('canonical_learn_check generation dispatch', () => {
  it('has its own dedicated dispatch branch, distinct from topic_practice/review', () => {
    expect(ROUTE_SRC).toContain("validated.quizMode === 'canonical_learn_check'");
  });

  it('the canonical_learn_check branch calls generatePracticeQuestions with activityType/quizMode derived from the request, never hardcoded to topic_practice', () => {
    const idx = ROUTE_SRC.indexOf('Section 8.A -- the dedicated LEARN');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 1600);
    expect(slice).toMatch(/generatePracticeQuestions\(conceptIds\[0\], validated\.studentId, validated\.subjectId, \{/);
    expect(slice).toMatch(/activityType: activityTypeForQuizMode\(validated\.quizMode\)/);
    expect(slice).toMatch(/quizMode: validated\.quizMode,/);
  });

  it('canonical_learn_check has no legitimate legacy meaning -- a request that fails v1 authorization is refused outright (403), never silently generated as a generic quiz', () => {
    const idx = ROUTE_SRC.indexOf("validated.quizMode === 'canonical_learn_check' && !v1Marker");
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/V1_LEARN_CHECK_AUTHORIZATION_FAILED/);
    expect(slice).toMatch(/status: 403/);
  });

  it('requestedActivityType resolves canonical_learn_check to LEARN_CHECK specifically -- never PRACTICE/PROVE/etc', () => {
    const idx = ROUTE_SRC.indexOf('const requestedActivityType:');
    const slice = ROUTE_SRC.slice(idx, idx + 900);
    expect(slice).toMatch(/validated\.quizMode === 'canonical_learn_check'\s*\n\s*\? 'LEARN_CHECK'/);
  });

  it('QUIZ_MODE_CONFIG.canonical_learn_check declares a small, assisted default (never the 20-question generic ceiling)', () => {
    const idx = ROUTE_SRC.indexOf('canonical_learn_check:');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 900);
    expect(slice).toMatch(/defaultMax:\s*\d+/);
    const match = slice.match(/defaultMax:\s*(\d+)/);
    expect(Number(match?.[1])).toBeLessThanOrEqual(10);
  });
});
