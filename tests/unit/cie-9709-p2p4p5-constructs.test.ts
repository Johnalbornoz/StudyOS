/**
 * Cambridge 9709 Papers 2, 4 and 5: ten Track B deterministic constructs. Every band has its own parameter sets (bands
 * are mutually exclusive); every key is a positive exact value that holds by the independent check, a perturbed value
 * does not, and no modelled misconception gives the key. The governed entries build (core + envelope) without error.
 */
import { describe, expect, it } from 'vitest';
import { CIE_9709_P2P4P5_CONSTRUCTS } from '@/lib/assessment-instance/library/cie-9709-p2p4p5.constructs';
import { CIE_9709_P2P4P5_ADOPTION_SPECS, CIE_9709_P2P4P5_ENTRIES } from '@/lib/assessment-instance/library/cie-9709-p2p4p5.adoption';
import { PLANNING_BANDS, rational, readRational, sameRational, writeRational } from '@/lib/assessment-instance/library/parametric';

describe('Cambridge 9709 P2 / P4 / P5 constructs', () => {
  it.each(CIE_9709_P2P4P5_CONSTRUCTS.map((c) => [c.construct, c] as const))('%s: every band has >= 30 parameter sets of that band only; every key is positive, exact, holds by the independent check and is no modelled misconception', (_n, c: any) => {
    const keys = new Set<string>();
    for (const band of PLANNING_BANDS) {
      const sets = c.enumerate(band);
      expect(sets.length, band).toBeGreaterThanOrEqual(30);
      expect(sets.length, band).toBeLessThan(5000);
      for (const p of sets) {
        const answer = c.answer(p);
        const k = readRational(answer)!;
        expect(k, answer).not.toBeNull();
        expect(writeRational(k), 'the key is written exactly, in lowest terms').toBe(answer);
        expect(k.n > 0, `${band} ${answer}`).toBe(true);
        expect(c.keyHolds(p, k), `${band} ${c.recognitionKey(p)} key ${answer}`).toBe(true);
        expect(c.keyHolds(p, rational(k.n + k.d, k.d)), `${band} ${c.recognitionKey(p)} key + 1`).toBe(false);
        expect(c.bandIssues(band, p)).toEqual([]);
        for (const other of PLANNING_BANDS.filter((b) => b !== band)) expect(c.bandIssues(other, p).length, `${c.recognitionKey(p)} also in ${other}`).toBeGreaterThan(0);
        expect(c.misconceptionAnswers(p).some((m: any) => m.value && sameRational(m.value, k))).toBe(false);
        expect(typeof c.present(p, 'en')).toBe('string');
        keys.add(c.recognitionKey(p));
      }
    }
    // recognition keys are unique across the bands (no parameter set is delivered twice)
    expect(keys.size).toBe(PLANNING_BANDS.reduce((s, b) => s + c.enumerate(b).length, 0));
  });

  it('prompts use Cambridge command words, never "find"', () => {
    for (const c of CIE_9709_P2P4P5_CONSTRUCTS as readonly any[]) for (const band of PLANNING_BANDS) {
      const text = c.present(c.enumerate(band)[0], 'en');
      expect(text).toMatch(/\b(calculate|determine)\b/i);
      expect(text).not.toMatch(/\bfind\b/i);
    }
  });

  it('specs: adapter ids, concepts and command terms', () => {
    expect(CIE_9709_P2P4P5_ADOPTION_SPECS.map((s) => [s.construct.construct, s.adapterId, s.concept.stableId, s.concept.canonicalName, s.commandTerm])).toEqual([
      ['CIE_LOG_EXP_EQUATION', 'CAMBRIDGE.9709.P2', 'math.alg.logarithms', 'Logarithms', 'determine'],
      ['CIE_PRODUCT_QUOTIENT_GRADIENT', 'CAMBRIDGE.9709.P2', 'math.calc.differentiation', 'Differentiation', 'calculate'],
      ['CIE_NUMERICAL_ROOT', 'CAMBRIDGE.9709.P2', 'math.calc.numerical-methods', 'Numerical methods', 'determine'],
      ['CIE_CONSTANT_ACCELERATION', 'CAMBRIDGE.9709.P4', 'math.mech.kinematics', 'Mechanics: kinematics', 'calculate'],
      ['CIE_FORCES_ON_A_PLANE', 'CAMBRIDGE.9709.P4', 'math.mech.forces-equilibrium', 'Mechanics: forces and equilibrium', 'calculate'],
      ['CIE_ENERGY_WORK_POWER', 'CAMBRIDGE.9709.P4', 'math.mech.energy-work-power', 'Mechanics: energy, work and power', 'calculate'],
      ['CIE_COUNTING_ARRANGEMENTS', 'CAMBRIDGE.9709.P5', 'math.prob.permutations-combinations', 'Permutations and combinations', 'calculate'],
      ['CIE_PROBABILITY_EVENTS', 'CAMBRIDGE.9709.P5', 'math.prob.probability-events', 'Probability and events', 'calculate'],
      ['CIE_BINOMIAL_EXACT', 'CAMBRIDGE.9709.P5', 'math.prob.binomial-distribution', 'Binomial distribution', 'calculate'],
      ['CIE_NORMAL_EXACT', 'CAMBRIDGE.9709.P5', 'math.prob.normal-distribution', 'Normal distribution', 'determine'],
    ]);
    for (const s of CIE_9709_P2P4P5_ADOPTION_SPECS) {
      expect(s.objectiveCode).toBeUndefined();
      expect(s.misconceptions.length).toBeGreaterThanOrEqual(3);
      expect(s.misconceptions.length).toBeLessThanOrEqual(5);
      for (const m of s.misconceptions) expect(m.producesError.length).toBeGreaterThan(3);
    }
    expect(new Set(CIE_9709_P2P4P5_ADOPTION_SPECS.map((s) => s.familyId)).size).toBe(10);
  });

  it('entries build: one target each, SHORT_RESPONSE, Cambridge, Track B origin', () => {
    expect(CIE_9709_P2P4P5_ENTRIES).toHaveLength(10);
    expect(CIE_9709_P2P4P5_ENTRIES.map((e) => [e.targets[0].adapterId, e.targets[0].commandTerm, e.targets[0].responseFormat, e.core.family.primaryConcepts[0].stableId, e.origin])).toEqual(
      CIE_9709_P2P4P5_ADOPTION_SPECS.map((s) => [s.adapterId, s.commandTerm, 'SHORT_RESPONSE', s.concept.stableId, 'TRACK_B_DETERMINISTIC']),
    );
    expect(new Set(CIE_9709_P2P4P5_ENTRIES.map((e) => e.envelope.rendererVersion)).size).toBe(10);
  });
});
