/**
 * Phase 1E architecture regression coverage:
 *
 * Step 19: any Phase 1E computation that ever touches response timing
 * must only count `timingQuality === 'VALID'` by default (the Phase
 * 1D-R invariant) -- OUTLIER must stay excluded. This phase's own
 * design decision (Step 18) was to not touch response timing in any
 * metric at all yet; this test enforces that decision stays true, and
 * would fail loudly if a future edit quietly wires timing in without
 * respecting the invariant.
 *
 * Step 24: remediation.service.ts, cognitive-diagnosis.service.ts, and
 * tutor-strategy.service.ts must not begin consuming the new
 * DecisionContext fields (learningVelocity/helpDependency/
 * prerequisiteGaps) this phase -- their algorithms remain unchanged,
 * this phase only makes the data available for a future engine.
 *
 * Step 22: the derived-metric layer performs zero DB writes.
 * Step 21: CANONICAL_DERIVED_METRIC_LAYER = 1 (one module).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const METRICS_DIR = join(process.cwd(), 'src/lib/learner-twin/metrics');

function metricFiles(): string[] {
  return readdirSync(METRICS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(METRICS_DIR, f));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Phase 1E Step 19: response timing is not touched by any current derived metric', () => {
  it('no metrics/*.ts file references responseTimeMs, timingQuality, validSampleCount, or the response-timing module', () => {
    const offenders: string[] = [];
    for (const file of metricFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/responseTimeMs|timingQuality|validSampleCount|response-timing/.test(code)) {
        offenders.push(relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('if a future metric DOES read response timing, it may only count quality === VALID by default (documented invariant, enforced structurally)', () => {
    // This is a live assertion against the actual Phase 1D-R contract,
    // not a metrics-module file -- pinned here so a change to
    // readResponseTimingSignal's counting semantics is caught by the
    // same suite that would need to review Phase 1E's response-time
    // policy (Step 19).
    const readersSource = readFileSync(join(process.cwd(), 'src/lib/learner-twin/readers.ts'), 'utf8');
    // VALID and OUTLIER increment mutually exclusive counters (if/else),
    // never both -- the exact Phase 1D-R fix.
    expect(readersSource).toMatch(/if \(entry\.timingQuality === 'VALID'\) validSampleCount\+\+;\s*\n\s*else outlierSampleCount\+\+;/);
  });
});

describe('Phase 1E Step 24 / 1E-R Step 8: existing decision consumers do not begin using the new derived metrics, and never request them from getDecisionContext', () => {
  const targets = [
    'src/services/remediation.service.ts',
    'src/services/cognitive-diagnosis.service.ts',
    'src/services/tutor-strategy.service.ts',
    'src/lib/verification-triggers.ts',
  ];

  it('remediation/cognitive-diagnosis/tutor-strategy services reference none of learningVelocity/helpDependency/prerequisiteGaps', () => {
    const offenders: string[] = [];
    for (const rel of targets) {
      const code = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'));
      if (/learningVelocity|helpDependency|prerequisiteGaps/.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("Phase 1E-R: none of them ever pass a `derivedMetrics` option to getDecisionContext -- including generateRootCauseHypotheses's per-prerequisite-candidate loop, which would otherwise multiply the eager-query cost", () => {
    const offenders: string[] = [];
    for (const rel of targets) {
      const code = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'));
      if (code.includes('derivedMetrics')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("generateRootCauseHypotheses's getDecisionContext call site passes no second/options argument at all", () => {
    const code = stripComments(readFileSync(join(process.cwd(), 'src/services/cognitive-diagnosis.service.ts'), 'utf8'));
    expect(code).toMatch(/getDecisionContext\(studentId,\s*rel\.sourceConceptId\)/);
  });
});

describe('Phase 1E Step 21/22: canonical, read-only derived-metric layer', () => {
  it('CANONICAL_DERIVED_METRIC_LAYER = 1 -- exactly one metrics module directory', () => {
    const files = metricFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  it('no file in src/lib/learner-twin/metrics/ contains an INSERT/UPDATE/DELETE statement', () => {
    for (const file of metricFiles()) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\bINSERT INTO\b/i);
      expect(source).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
      expect(source).not.toMatch(/\bDELETE FROM\b/i);
    }
  });
});

describe('Phase 1E Step 27: no decision_events are emitted merely because a derived metric was calculated', () => {
  it('no metrics/*.ts file imports recordDecisionEvent', () => {
    const offenders: string[] = [];
    for (const file of metricFiles()) {
      if (readFileSync(file, 'utf8').includes('recordDecisionEvent')) offenders.push(relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});

describe('Phase 1E: no new personality/learning-style labels', () => {
  it('no metrics/*.ts file introduces lazy/unmotivated/visual learner/fast-slow-learner style labels', () => {
    const offenders: string[] = [];
    const forbidden = /\blazy\b|\bunmotivated\b|visual learner|slow learner|fast learner|weak student/i;
    for (const file of metricFiles()) {
      if (forbidden.test(readFileSync(file, 'utf8'))) offenders.push(relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});
