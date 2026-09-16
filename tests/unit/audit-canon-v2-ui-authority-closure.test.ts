/**
 * CANONICAL POLICY V2 -- AUDIT-006 REMEDIATION VERIFICATION.
 *
 * Was: AUDIT-006 (P1, needs verification) -- `canonical-learning-progress.ts`
 * ("the single canonical learning-progress read model") had zero wiring
 * to the new canonical engine, unlike ConceptMission and Today, which
 * both correctly apply a One-Authority-Rule override. This phase
 * completed the trace of every real caller of `buildCanonicalLearningProgress`:
 *
 *   1. `concept-mission-view.service.ts` (ConceptMission) -- ALREADY
 *      correctly overrides (verified, unchanged).
 *   2. `learning-os-snapshot.service.ts` (Today) -- ALREADY correctly
 *      overrides (verified, unchanged).
 *   3. `progress-overview.service.ts` (the Progress page's per-subject,
 *      per-concept rows) -- did NOT override. FIXED this phase: now
 *      applies the identical One-Authority-Rule pattern, per-concept,
 *      gated on `isCanonicalEngineV1Enabled()`.
 *   4. `src/lib/pedagogical-shadow/old-canonical-snapshot.ts` -- uses the
 *      legacy path INTENTIONALLY (it IS the "old system" side of the
 *      shadow-comparison harness; its own module header already
 *      documents this explicitly). Correctly left unchanged.
 *
 * Test-only; no production code beyond progress-overview.service.ts
 * needed a change for this closure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const PROGRESS_OVERVIEW_SRC = read('src/services/progress-overview.service.ts');
const CONCEPT_MISSION_VIEW_SRC = read('src/services/concept-mission-view.service.ts');
const SNAPSHOT_SRC = read('src/services/learning-os-snapshot.service.ts');
const OLD_SNAPSHOT_SRC = read('src/lib/pedagogical-shadow/old-canonical-snapshot.ts');

describe('AUDIT-006 CLOSED: every real caller of buildCanonicalLearningProgress is now traced', () => {
  it('ConceptMission already correctly overrides (unchanged, re-verified)', () => {
    expect(CONCEPT_MISSION_VIEW_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
    expect(CONCEPT_MISSION_VIEW_SRC).toMatch(/getCanonicalPedagogicalDecision\(/);
  });

  it('Today (learning-os-snapshot) already correctly overrides (unchanged, re-verified)', () => {
    expect(SNAPSHOT_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
    expect(SNAPSHOT_SRC).toMatch(/getCanonicalPedagogicalDecision\(/);
  });

  it('progress-overview.service.ts (the Progress page) now applies the SAME override pattern -- the fix', () => {
    expect(PROGRESS_OVERVIEW_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
    expect(PROGRESS_OVERVIEW_SRC).toMatch(/getCanonicalPedagogicalDecision\(/);
    // The override replaces journeyStage/journeyProgressPercent/journeyProgressLabelKey
    // specifically -- never a different, competing field set.
    expect(PROGRESS_OVERVIEW_SRC).toMatch(/journeyStage = decision\.stage/);
    expect(PROGRESS_OVERVIEW_SRC).toMatch(/journeyProgressPercent = decision\.journeyProgressPercent/);
  });

  it('a read failure in the override degrades to the legacy view -- never throws and breaks the Progress page', () => {
    const idx = PROGRESS_OVERVIEW_SRC.indexOf('if (isCanonicalEngineV1Enabled())');
    const block = PROGRESS_OVERVIEW_SRC.slice(idx, idx + 600);
    expect(block).toMatch(/catch \(error\)/);
    expect(block).toMatch(/CanonicalDecisionUnavailableError/);
  });

  it('old-canonical-snapshot.ts (the shadow-comparison harness\'s OWN "old system" side) is INTENTIONALLY legacy-only, and says so explicitly in its own module header', () => {
    expect(OLD_SNAPSHOT_SRC).toMatch(/OLD CANONICAL SNAPSHOT/i);
    expect(OLD_SNAPSHOT_SRC).not.toMatch(/isCanonicalEngineV1Enabled/);
  });

  it('the override is scoped INSIDE the per-concept loop (one fresh decision per concept), never a single subject-wide call reused across concepts', () => {
    const gateIdx = PROGRESS_OVERVIEW_SRC.indexOf('if (isCanonicalEngineV1Enabled())');
    const mapStartIdx = PROGRESS_OVERVIEW_SRC.lastIndexOf('masteryRows.map(async (row', gateIdx);
    expect(mapStartIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(mapStartIdx);
    expect(PROGRESS_OVERVIEW_SRC.slice(gateIdx, gateIdx + 300)).toMatch(/conceptId: row\.concept_id/);
  });
});
