/**
 * LX-3R -- CONCEPT MISSION CANONICAL STATE BOUNDARY REPAIR.
 *
 * The Concept Mission must never convert "Phase 3C produced no
 * LearningDecision" into an invented LearningState. Source-level checks
 * on the read boundary + pure model (this repo has no component test
 * harness; the behavioural coverage is in lx3-concept-mission.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const MODEL = read('src/lib/lx/concept-mission.ts');
const SERVICE = read('src/services/concept-mission-view.service.ts');
const SHELL = read('src/app/dashboard/LearnerShell.tsx');

describe('LX-3R -- no fabricated LearningState in the pure model', () => {
  it('the removed non-canonical fallback is gone', () => {
    expect(MODEL).not.toMatch(/effectiveLearningState/);
    expect(MODEL).not.toMatch(/masteryState === 'VALIDATED_MASTERY'/);
    expect(MODEL).not.toMatch(/'VALIDATED_MASTERY'\s*:\s*'VALIDATED'/);
    // no inline assignment of a LearningState literal anywhere in the model
    expect(MODEL).not.toMatch(/learningState:\s*'(?:DEVELOPING|VALIDATED|NOT_STARTED)'/);
    expect(MODEL).not.toMatch(/return\s*'(?:DEVELOPING|VALIDATED)'\s*;/);
  });

  it('the model consumes a discriminated journeyInput and never derives the state itself', () => {
    expect(MODEL).toMatch(/journeyInput:\s*ConceptMissionJourneyInput/);
    expect(MODEL).toMatch(/kind: 'UNAVAILABLE'/);
    expect(MODEL).toMatch(/status: 'UNAVAILABLE'/);
    // it still routes a RESOLVED state through the LX-1 contract, unchanged
    expect(MODEL).toMatch(/deriveLearnerJourneyStage\(\{[\s\S]*?learningState,/);
    // and defines no policy of its own
    expect(MODEL).not.toMatch(/function computeLearningState/);
    expect(MODEL).not.toMatch(/function selectActivityType/);
  });
});

describe('LX-3R -- the read boundary resolves the state canonically', () => {
  it('reuses the canonical pure policy computeLearningState (imported, not re-implemented)', () => {
    expect(SERVICE).toMatch(/import \{ computeLearningState.*\} from '@\/lib\/adaptive-learning-policy'/);
    expect(SERVICE).toMatch(/computeLearningState\(zeroSignalContext\(/);
    // no hand-rolled precedence / no hardcoded default state
    expect(SERVICE).not.toMatch(/learningState: 'DEVELOPING'/);
    expect(SERVICE).not.toMatch(/=== 'VALIDATED_MASTERY'.*'VALIDATED'/);
  });

  it('distinguishes a FAILED decision read from a successful empty one', () => {
    // the decision read is NOT collapsed to null via .catch(() => null)
    expect(SERVICE).not.toMatch(/getBestLearningDecisionForConcept\(studentId, conceptId\)\.catch\(\(\) => null\)/);
    expect(SERVICE).toMatch(/status: 'READ_FAILED'/);
    expect(SERVICE).toMatch(/journeyInput = \{ kind: 'UNAVAILABLE' \}/);
    // success + a decision -> its own learningState; success + null -> canonical policy
    expect(SERVICE).toMatch(/source: 'LEARNING_DECISION'/);
    expect(SERVICE).toMatch(/source: 'CANONICAL_POLICY_NO_SIGNALS'/);
  });

  it('the zero-signal context it builds is accurate (empty signals) and carries only canonical knowledgeState', () => {
    expect(SERVICE).toMatch(/signals: \[\]/);
    expect(SERVICE).toMatch(/knowledgeState,/);
  });
});

describe('LX-3R -- Repair 5: duplicate nav landmark label', () => {
  it('NavList takes a required, caller-supplied label -- no hard-coded "Primary"', () => {
    expect(SHELL).not.toMatch(/aria-label="Primary"/);
    expect(SHELL).toMatch(/<nav aria-label=\{label\}/);
    expect(SHELL).toMatch(/label: string;/);
  });

  it('the sidebar and drawer navs get distinct localized labels', () => {
    expect(SHELL).toMatch(/<NavList groups=\{groups\} pathname=\{pathname\} label=\{navLabel\} \/>/);
    expect(SHELL).toMatch(/label=\{menuLabel\} \/>/);
    expect(SHELL).toMatch(/navLabel: string;/);
  });
});
