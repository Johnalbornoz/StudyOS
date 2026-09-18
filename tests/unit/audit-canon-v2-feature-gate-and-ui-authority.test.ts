/**
 * CANONICAL POLICY V2 AUDIT -- AUDIT-ONLY CERTIFICATION TESTS.
 *
 * Section 11 (end-to-end authority chain) and Section 16 (UI canonical
 * authority). Confirms:
 *   1. `isCanonicalEngineV1Enabled()` is a uniform, explicit
 *      configuration gate -- `CANONICAL_ENGINE_V1_ENABLED === 'true'`
 *      and nothing else, in every environment including Production
 *      (PROD-PROMOTION Section 7: the prior Production hard interlock
 *      existed only for Preview certification and has been removed now
 *      that Production promotion is the explicitly planned next phase;
 *      see `feature-gate.ts`'s own updated doc comment). The flag is
 *      simultaneously the activation switch and the emergency rollback
 *      switch.
 *   2. The 4 real call sites that gate on it (session/start,
 *      generate-and-take, concept-mission, today-snapshot) all use the
 *      SAME function -- never a locally re-implemented condition.
 *   3. AUDIT-006 (P1, NOW CLOSED): `canonical-learning-progress.ts` --
 *      which documents itself as "THE SINGLE CANONICAL LEARNING-PROGRESS
 *      READ MODEL" -- still has no wiring whatsoever to
 *      `getCanonicalPedagogicalDecision` (unchanged, by design: it
 *      remains the legacy-only pure builder, exactly like
 *      `buildConceptMissionView`). PROD-PROMOTION traced every real
 *      consumer: `progress-overview.service.ts` already applies its own
 *      override on top (pre-existing); `path-view.ts` (My Path, and the
 *      Subjects detail page via `resolveConceptJourneyResultAuthoritative`)
 *      did NOT and has now been fixed -- see
 *      `tests/unit/prod-02-canonical-authority-regression.test.ts` for
 *      the regression coverage. `old-canonical-snapshot.ts` is a
 *      shadow/comparison-only tool, never called by any live surface
 *      (Category A).
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

describe('AUDIT-CONTEXT-1 (PROD-PROMOTION): canonical engine v1 is a uniform, explicit, off-by-default config gate -- Production included', () => {
  it('is TRUE in Production when the flag is the exact string "true" (Production promotion, Section 7 -- the prior hard interlock is removed)', () => {
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'production', CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(true);
  });
  it('is FALSE in Production when the flag is absent, false, or anything other than the exact string "true" (the emergency rollback path)', () => {
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'production' })).toBe(false);
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'production', CANONICAL_ENGINE_V1_ENABLED: 'false' })).toBe(false);
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'production', CANONICAL_ENGINE_V1_ENABLED: 'yes' })).toBe(false);
  });
  it('is FALSE with no configuration at all (never "on by default")', () => {
    expect(isCanonicalEngineV1Enabled({})).toBe(false);
  });
  it('is FALSE in Preview/dev unless the config flag is the exact string "true"', () => {
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'preview', CANONICAL_ENGINE_V1_ENABLED: 'yes' })).toBe(false);
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'preview', CANONICAL_ENGINE_V1_ENABLED: '1' })).toBe(false);
  });
  it('is TRUE in any environment with the exact flag set -- Preview, Development, and (now) Production alike, uniform semantics', () => {
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'preview', CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(true);
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'development', CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(true);
    expect(isCanonicalEngineV1Enabled({ VERCEL_ENV: 'production', CANONICAL_ENGINE_V1_ENABLED: 'true' })).toBe(true);
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

describe('AUDIT-006 (P1, CLOSED by PROD-PROMOTION): canonical-learning-progress.ts itself stays legacy-only BY DESIGN -- every real consumer now overrides it', () => {
  it('never imports getCanonicalPedagogicalDecision or isCanonicalEngineV1Enabled -- unchanged, deliberate: it is a legacy-only pure builder, exactly like buildConceptMissionView', () => {
    expect(LEARNING_PROGRESS_SRC).not.toMatch(/getCanonicalPedagogicalDecision/);
    expect(LEARNING_PROGRESS_SRC).not.toMatch(/isCanonicalEngineV1Enabled/);
  });

  it('is built entirely from the OLD LearningDecision/adaptive-learning-policy pipeline', () => {
    expect(LEARNING_PROGRESS_SRC).toMatch(/from '@\/lib\/adaptive-learning-policy'/);
    expect(LEARNING_PROGRESS_SRC).toMatch(/resolveConceptJourneyResult/);
  });

  // RESOLVED: every real consumer of buildCanonicalLearningProgress /
  // resolveConceptJourneyResult was traced to completion.
  //   - `progress-overview.service.ts` already applied its own
  //     isCanonicalEngineV1Enabled + getCanonicalPedagogicalDecision
  //     override on top (pre-existing, "CANON-V2-REMEDIATION Part 8").
  //   - `old-canonical-snapshot.ts` is a shadow/comparison-only tool,
  //     never called by any live learner-facing surface (Category A;
  //     confirmed no route/page/service outside its own tests calls
  //     `fetchOldCanonicalSnapshot`/`buildOldCanonicalSnapshot`).
  //   - `path-view.ts` (My Path, and the Subjects detail page via
  //     `resolveConceptJourneyResultAuthoritative`) did NOT apply an
  //     override -- this was the real, confirmed PROD-02 mechanism
  //     (legacy `validationReadiness === 'WAITING_FOR_RETENTION'`
  //     reaching a learner-facing stage with zero PROVE evidence) and
  //     has been fixed: see `path-view.ts`'s new
  //     `resolveConceptJourneyResultAuthoritative`/
  //     `resolveConceptJourneyAuthoritative`, and
  //     `tests/unit/prod-02-canonical-authority-regression.test.ts`.
  it('the real fix lives in path-view.ts, not here -- resolveConceptJourneyResult (this file\'s underlying authority) stays legacy-only; resolveConceptJourneyResultAuthoritative is the new canonical-aware wrapper', () => {
    const PATH_VIEW_SRC = readFileSync(join(process.cwd(), 'src/lib/lx/path-view.ts'), 'utf-8');
    expect(PATH_VIEW_SRC).toMatch(/export async function resolveConceptJourneyResultAuthoritative/);
    expect(PATH_VIEW_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
    expect(PATH_VIEW_SRC).toMatch(/getCanonicalPedagogicalDecision/);
  });
});
