/**
 * CANONICAL POLICY V2 AUDIT -- AUDIT-ONLY CERTIFICATION TESTS.
 *
 * Section 11 (end-to-end authority chain) and Section 16 (UI canonical
 * authority). Confirms:
 *   1. `isCanonicalEngineV1Enabled()` is a hard interlock that is
 *      ALWAYS false in Production, regardless of configuration --
 *      meaning the entire canonical engine (and every finding in this
 *      audit) is not live for real users today (AUDIT-CONTEXT-1, not a
 *      defect, but essential certification context).
 *   2. The 4 real call sites that gate on it (session/start,
 *      generate-and-take, concept-mission, today-snapshot) all use the
 *      SAME function -- never a locally re-implemented condition.
 *   3. AUDIT-006 (P1): `canonical-learning-progress.ts` -- which
 *      documents itself as "THE SINGLE CANONICAL LEARNING-PROGRESS READ
 *      MODEL" -- has no wiring whatsoever to `getCanonicalPedagogicalDecision`,
 *      unlike ConceptMission/Today. Flagged for product/engineering
 *      clarification, not asserted as a confirmed defect (its consumers
 *      may apply an equivalent override elsewhere that this audit did
 *      not trace to completion).
 * Test-only; no production code is changed here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isCanonicalEngineV1Enabled } from '@/lib/pedagogical-decision/feature-gate';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const SESSION_START_SRC = read('src/app/api/learning/session/start/route.ts');
const GENERATE_AND_TAKE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const CONCEPT_MISSION_VIEW_SRC = read('src/services/concept-mission-view.service.ts');
const SNAPSHOT_SRC = read('src/services/learning-os-snapshot.service.ts');
const LEARNING_PROGRESS_SRC = read('src/lib/lx/canonical-learning-progress.ts');

describe('AUDIT-CONTEXT-1: canonical engine v1 is a hard-interlocked, off-by-default system', () => {
  it('is FALSE in Production regardless of the config flag (hard safety interlock)', () => {
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'production', CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(false);
  });
  it('is FALSE with no configuration at all (never "on by default")', () => {
    expect(isCanonicalEngineV1Enabled({})).toBe(false);
  });
  it('is FALSE in Preview/dev unless the config flag is the exact string "true"', () => {
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'preview', CANONICAL_ENGINE_V1_ENABLED: 'yes' })).toBe(false);
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'preview', CANONICAL_ENGINE_V1_ENABLED: '1' })).toBe(false);
  });
  it('is TRUE only in a non-production environment with the exact flag set', () => {
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'preview', CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(true);
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'development', CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(true);
  });

  it('every real authorization/generation call site gates on this SAME function -- session/start', () => {
    expect(SESSION_START_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
  });
  it('every real authorization/generation call site gates on this SAME function -- generate-and-take', () => {
    expect(GENERATE_AND_TAKE_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
  });
  it('every real authorization/generation call site gates on this SAME function -- ConceptMission (display authority)', () => {
    expect(CONCEPT_MISSION_VIEW_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
  });
  it('every real authorization/generation call site gates on this SAME function -- Today snapshot (display authority)', () => {
    expect(SNAPSHOT_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
  });
});

describe('AUDIT-006 (P1, needs verification): canonical-learning-progress.ts has no wiring to the canonical engine', () => {
  it('never imports getCanonicalPedagogicalDecision or isCanonicalEngineV1Enabled, despite calling itself "the single canonical learning-progress read model"', () => {
    expect(LEARNING_PROGRESS_SRC).not.toMatch(/getCanonicalPedagogicalDecision/);
    expect(LEARNING_PROGRESS_SRC).not.toMatch(/isCanonicalEngineV1Enabled/);
  });

  it('is built entirely from the OLD LearningDecision/adaptive-learning-policy pipeline', () => {
    expect(LEARNING_PROGRESS_SRC).toMatch(/from '@\/lib\/adaptive-learning-policy'/);
    expect(LEARNING_PROGRESS_SRC).toMatch(/resolveConceptJourneyResult/);
  });

  // NOT asserted as a confirmed contradiction: this audit did not trace
  // every consumer of buildCanonicalLearningProgress (My Path /
  // Subjects concept rows) to confirm whether they apply an equivalent
  // isCanonicalEngineV1Enabled + getCanonicalPedagogicalDecision override
  // pattern at a layer ABOVE this function (the way concept-mission-view.service.ts
  // and learning-os-snapshot.service.ts demonstrably do). Recorded as a
  // required follow-up in CANONICAL_GAPS_FOR_REMEDIATION.md AUDIT-006.
});
