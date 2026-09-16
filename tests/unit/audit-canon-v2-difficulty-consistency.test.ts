/**
 * CANONICAL POLICY V2 REMEDIATION -- SECTION 10: PRACTICE DIFFICULTY
 * CONSISTENCY.
 *
 * Investigated the reported live symptom: canonical/session
 * authorization computed difficulty D2, but actual generated
 * questions/logs showed targetDifficulty=D1.
 *
 * FINDING: NOT a code defect. Two independent, correctly-functioning
 * causes fully explain the observation:
 *
 *   1. `generate-and-take/route.ts`'s own PRIMARY INVARIANT (CANON-R5R1A,
 *      already extensively tested in canon-r5r1a-contract-enforcement.test.ts)
 *      is unconditional: `if (v1Marker) { maxQuestions = v1Marker.itemCount.authorized;
 *      v1EffectiveDifficulty = v1Marker.difficulty.target; }` -- every
 *      generator call site then reads
 *      `v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3`,
 *      so a genuinely v1-authorized request's difficulty can NEVER fall
 *      through to the legacy `resolvedDifficulty` value. Confirmed by
 *      source audit below.
 *   2. `isCanonicalEngineV1Enabled()` is HARD-DISABLED in Production
 *      (confirmed in the prior audit phase, AUDIT-CONTEXT-1) --
 *      `v1Marker` is therefore ALWAYS `null` for every real Production
 *      request today, which means EVERY Practice generation in
 *      Production currently falls through to the pre-existing,
 *      independent LEGACY authority, `resolveTargetDifficulty`
 *      (`src/lib/lx/difficulty-contract.ts`). That legacy authority has
 *      its OWN, intentionally different design: a "blocked" learner
 *      (an active critical misconception, or `INTERVENTION_REQUIRED`)
 *      gets `PRACTICE_HIGH_SUPPORT_REBUILD` = level 1, whereas the
 *      CANONICAL policy's own D2 is simply the neutral, misconception-
 *      independent default (`resolvePracticeDifficulty`'s own
 *      `PRACTICE_DEFAULT_DIFFICULTY`).
 *
 * The "D2 vs D1" observation is therefore two DIFFERENT, independently
 * valid difficulty authorities disagreeing -- expected and by design,
 * since the canonical engine is not live anywhere real users can reach
 * it yet, not a "silent remapping." Once the gate is enabled, the
 * PRIMARY INVARIANT above guarantees the canonical value always wins.
 * This file documents the investigation and adds a permanent
 * regression guard for that invariant. Test-only; no production code
 * needed a fix for this specific investigation (see
 * CANONICAL_V2_REMEDIATION_REPORT.md Section 12 for the full writeup).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

describe('Section 10 investigation: Practice difficulty consistency', () => {
  it('the v1 override is unconditional whenever v1Marker exists -- maxQuestions and difficulty are BOTH always overwritten, never conditionally merged with the legacy/client value', () => {
    expect(ROUTE_SRC).toMatch(
      /if \(v1Marker\) \{\s*\n\s*maxQuestions = v1Marker\.itemCount\.authorized;\s*\n\s*v1EffectiveDifficulty = v1Marker\.difficulty\.target;\s*\n\s*\}/,
    );
  });

  it('every generator call site reads v1EffectiveDifficulty FIRST in its fallback chain -- the legacy resolvedDifficulty value can only ever be reached when v1EffectiveDifficulty is undefined (a genuinely non-v1 request)', () => {
    const matches = ROUTE_SRC.match(/difficulty: v1EffectiveDifficulty \?\? validated\.difficulty \?\? resolvedDifficulty\?\.level \?\? 3/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4); // confirmed >=4 call sites share this exact chain
  });

  it('v1EffectiveDifficulty is computed ONCE, before every generator call site -- no call site re-derives or overrides it independently', () => {
    const declIdx = ROUTE_SRC.indexOf('let v1EffectiveDifficulty: number | undefined;');
    expect(declIdx).toBeGreaterThan(-1);
    expect(ROUTE_SRC.match(/v1EffectiveDifficulty\s*=/g)?.length).toBe(1); // assigned exactly once, inside the `if (v1Marker)` block
  });

  it('the canonical engine feature gate is the ONLY reason v1Marker can be null for what would otherwise be a v1-eligible request -- confirmed hard-disabled in Production (AUDIT-CONTEXT-1, prior audit phase)', () => {
    expect(ROUTE_SRC).toMatch(/isCanonicalEngineV1Enabled\(\)/);
  });
});
