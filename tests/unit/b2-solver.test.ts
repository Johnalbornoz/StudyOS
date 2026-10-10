/**
 * B2 -- the shared blueprint solver: core scenario, multi-concept coverage, determinism, invariants, time,
 * repeat exposure and scale. Pure; no database.
 */
import { describe, it, expect } from 'vitest';
import { canonicalCandidateOrder, NO_EXPOSURE, targetKey, type CoverageStrength, type SolverCandidate } from '@/lib/assessment-blueprint/solver/candidate';
import { solveBlueprint } from '@/lib/assessment-blueprint/solver/solve';
import type { SlotPlan, TargetPlan, TargetRequirement } from '@/lib/assessment-blueprint/solver/plan';
import { neutralEvidenceNeeds, type EvidenceCountPolicy } from '@/lib/assessment-blueprint/policy/evidence-requirement';
import { DEPTH_PRESETS, depthPolicyTable, depthRequirementFor, PRACTICE_DEPTHS, type PracticeDepth } from '@/lib/assessment-blueprint/policy/practice-depth';
import { buildLearningBlueprint } from '@/lib/assessment-blueprint/policy/learning';
import { toBlueprintResult } from '@/lib/assessment-blueprint/result';

const POLICY: EvidenceCountPolicy = { version: 1, minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2 };

type Roles = Record<string, 'P' | 'S' | 'D'>;
const STRENGTH: Record<'P' | 'S' | 'D', CoverageStrength> = { P: 'DIRECT', S: 'SUPPORTING', D: 'DERIVED' };

function q(id: string, roles: Roles, over: Partial<SolverCandidate> = {}): SolverCandidate {
  return {
    key: `LEARNING_ITEM_CACHE:${id}`,
    ref: { store: 'LEARNING_ITEM_CACHE', id },
    store: 'LEARNING_ITEM_CACHE',
    coverage: Object.entries(roles).map(([c, r]) => ({ targetKey: targetKey('CONCEPT', c), kind: 'CONCEPT' as const, id: c, strength: STRENGTH[r] })).sort((a, b) => a.targetKey.localeCompare(b.targetKey)),
    difficulty: 3,
    questionType: 'multiple_choice',
    marks: null,
    estimatedSeconds: null,
    provenance: 'GENERATED_UNREVIEWED',
    exposure: NO_EXPOSURE,
    ...over,
  };
}

/** The scenario of the brief. */
const SCENARIO = [q('Q1', { C1: 'P' }), q('Q2', { C1: 'P', C2: 'S' }), q('Q3', { C2: 'P', C4: 'P' }), q('Q4', { C4: 'P' })];
const TARGETS = ['C1', 'C2', 'C4'];

/** A LEARNING practice plan for a learner with no evidence, at a depth, through the real policy. */
function practicePlan(depth: PracticeDepth, targets: string[] = TARGETS, over: Partial<TargetPlan> = {}): TargetPlan {
  const { plan } = buildLearningBlueprint({ studentId: 'stu', intent: 'CUSTOM_CONCEPT_PRACTICE', depth, canonicalConceptIds: targets, needs: neutralEvidenceNeeds(targets, POLICY) });
  return { ...plan, ...over };
}
const ids = (o: { selected: Array<{ question: { id: string } }> }) => o.selected.map((s) => s.question.id);
const shuffle = <T>(list: readonly T[], seed: number): T[] => {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

describe('B2 core scenario -- C1, C2, C4 over Q1..Q4: the count emerges, it is not concepts x n', () => {
  const quick = solveBlueprint(practicePlan('QUICK'), SCENARIO);
  const balanced = solveBlueprint(practicePlan('BALANCED'), SCENARIO);
  const deep = solveBlueprint(practicePlan('DEEP'), SCENARIO);

  it('QUICK: one opportunity per concept -- two overlapping questions cover the three concepts', () => {
    expect(quick.status).toBe('READY');
    expect(ids(quick).sort()).toEqual(['Q2', 'Q3']);
    // Q2 gives C1 (direct) and C2 (supporting); Q3 gives C2 and C4 (direct)
    expect(quick.selected.find((s) => s.question.id === 'Q2')!.contributes.map((c) => [c.targetKey, c.strength])).toEqual([['CONCEPT:C1', 'DIRECT'], ['CONCEPT:C2', 'SUPPORTING']]);
  });

  it('BALANCED: two opportunities per concept with at least one DIRECT -- needs all four questions', () => {
    expect(balanced.status).toBe('READY');
    expect(ids(balanced).sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
  });

  it('DEEP: asks for more than this bank holds and says exactly what is missing', () => {
    expect(deep.status).toBe('PARTIAL');
    expect(ids(deep).sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    // C2 has one DIRECT question only (Q3): a second direct opportunity does not exist
    expect(deep.unmet).toContainEqual({ subject: 'CONCEPT:C2', requirement: 'DIRECT', missing: 1, cause: 'NOT_ENOUGH_CANDIDATES' });
    // every concept still got its own independent demonstration, on a different question
    const dedicated = deep.selected.filter((s) => s.dedicatedTo).map((s) => s.dedicatedTo).sort();
    expect(dedicated).toEqual(['CONCEPT:C1', 'CONCEPT:C2', 'CONCEPT:C4']);
  });

  it('the three depths give different counts for structural reasons, none of them 3 concepts x a fixed number', () => {
    expect([quick.selected.length, balanced.selected.length]).toEqual([2, 4]);
    for (const n of [1, 2, 3, 4, 5]) expect(quick.selected.length === TARGETS.length * n && balanced.selected.length === TARGETS.length * n).toBe(false);
    // with a richer bank DEEP needs more than BALANCED, which needs more than QUICK
    const rich = [...SCENARIO, q('Q5', { C1: 'P' }), q('Q6', { C2: 'P' }), q('Q7', { C4: 'P' }), q('Q8', { C2: 'P' }), q('Q9', { C1: 'P', C4: 'P' })];
    const counts = PRACTICE_DEPTHS.map((d) => solveBlueprint(practicePlan(d), rich).selected.length);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(solveBlueprint(practicePlan('DEEP'), rich).status).toBe('READY');
  });

  it('the same depth gives a different count on a different bank: no preset is a number of questions', () => {
    const disjoint = [q('A', { C1: 'P' }), q('B', { C2: 'P' }), q('C', { C4: 'P' })];
    const overlapping = [q('X', { C1: 'P', C2: 'P', C4: 'P' })];
    expect(solveBlueprint(practicePlan('QUICK'), disjoint).selected.length).toBe(3);
    expect(solveBlueprint(practicePlan('QUICK'), overlapping).selected.length).toBe(1);
    for (const preset of Object.values(DEPTH_PRESETS)) expect(Object.keys(preset).join()).not.toMatch(/count|questions?$|items?$/i);
    expect(depthPolicyTable().find((r) => r.requirement === 'number of questions')).toMatchObject({ QUICK: 'not a policy value', BALANCED: 'not a policy value', DEEP: 'not a policy value' });
  });
});

describe('B2 multi-concept coverage', () => {
  it('a multi-concept question removes redundant selection', () => {
    const pool = [q('A', { C1: 'P' }), q('B', { C2: 'P' }), q('AB', { C1: 'P', C2: 'P' })];
    expect(ids(solveBlueprint(practicePlan('QUICK', ['C1', 'C2']), pool))).toEqual(['AB']);
  });

  it('SUPPORTING-only coverage cannot satisfy a DIRECT requirement', () => {
    const pool = [q('S1', { C1: 'S' }), q('S2', { C1: 'S' })];
    const o = solveBlueprint(practicePlan('BALANCED', ['C1']), pool);
    expect(o.status).not.toBe('READY');
    expect(o.unmet).toContainEqual({ subject: 'CONCEPT:C1', requirement: 'DIRECT', missing: 1, cause: 'ONLY_WEAKER_COVERAGE' });
  });

  it('DERIVED (objective-mapping) coverage is not credited to a concept at all', () => {
    const pool = [q('D1', { C1: 'D' }), q('D2', { C1: 'D' }), q('D3', { C1: 'D' })];
    for (const depth of PRACTICE_DEPTHS) {
      const o = solveBlueprint(practicePlan(depth, ['C1']), pool);
      expect(o.selected, depth).toEqual([]);
      expect(o.status, depth).toBe('INSUFFICIENT_COVERAGE');
      expect(o.unmet[0], depth).toMatchObject({ subject: 'CONCEPT:C1', cause: 'ONLY_WEAKER_COVERAGE' });
    }
  });

  it('one question is the independent demonstration of ONE concept only, however many it covers', () => {
    const plan: TargetPlan = { ...practicePlan('QUICK', ['C1', 'C2']), targets: ['C1', 'C2'].map((id) => ({ targetKey: `CONCEPT:${id}`, kind: 'CONCEPT' as const, id, priority: 3, opportunities: 1, directOpportunities: 1, independentDemonstrations: 1 })) };
    const only = solveBlueprint(plan, [q('AB', { C1: 'P', C2: 'P' })]);
    expect(only.selected.filter((s) => s.dedicatedTo)).toHaveLength(1);
    expect(only.unmet).toEqual([{ subject: 'CONCEPT:C2', requirement: 'INDEPENDENT', missing: 1, cause: 'NOT_ENOUGH_CANDIDATES' }]);
    // with a second question each concept has its own
    const two = solveBlueprint(plan, [q('AB', { C1: 'P', C2: 'P' }), q('B', { C2: 'P' })]);
    expect(two.status).toBe('READY');
    expect(new Set(two.selected.map((s) => s.dedicatedTo)).size).toBe(2);
  });

  it('DEEP does not rest a concept on a shared multi-concept question when a dedicated one exists', () => {
    const pool = [q('ABC', { C1: 'P', C2: 'P', C4: 'P' }), q('A1', { C1: 'P' }), q('A2', { C1: 'P' }), q('B1', { C2: 'P' }), q('B2', { C2: 'P' }), q('C1', { C4: 'P' }), q('C2', { C4: 'P' })];
    const quick = solveBlueprint(practicePlan('QUICK'), pool);
    const deep = solveBlueprint(practicePlan('DEEP'), pool);
    expect(ids(quick)).toEqual(['ABC']);
    expect(deep.status).toBe('READY');
    expect(deep.selected.length).toBeGreaterThan(3);
    const dedicated = deep.selected.filter((s) => s.dedicatedTo);
    expect(dedicated.map((s) => s.dedicatedTo).sort()).toEqual(['CONCEPT:C1', 'CONCEPT:C2', 'CONCEPT:C4']);
    expect(new Set(dedicated.map((s) => s.key)).size).toBe(3);
  });

  it('selection coverage is not evidence credit: the outcome states opportunities, never an amount of evidence', () => {
    const o = solveBlueprint(practicePlan('BALANCED'), SCENARIO);
    expect(JSON.stringify(o)).not.toMatch(/mastery|evidenceCredit|weight|score/i);
    expect(o.selected.every((s) => s.contributes.every((c) => c.counted.every((k) => ['OPPORTUNITY', 'DIRECT', 'INDEPENDENT'].includes(k))))).toBe(true);
  });
});

describe('B2 determinism', () => {
  it('the same plan and candidate set give the same selection in the same order, whatever the input order', () => {
    const rich = [...SCENARIO, q('Q5', { C1: 'P' }), q('Q6', { C2: 'P' }), q('Q7', { C4: 'P' }), q('Q8', { C2: 'P', C4: 'S' }), q('Q9', { C1: 'P', C4: 'P' })];
    for (const depth of PRACTICE_DEPTHS) {
      const reference = solveBlueprint(practicePlan(depth), rich);
      for (let seed = 1; seed <= 25; seed += 1) {
        const again = solveBlueprint(practicePlan(depth), shuffle(rich, seed));
        expect(ids(again), `${depth} seed ${seed}`).toEqual(ids(reference));
        expect(again.status).toBe(reference.status);
        expect(again.unmet).toEqual(reference.unmet);
      }
    }
  });

  it('target order and object construction order do not matter', () => {
    const a = practicePlan('BALANCED', ['C1', 'C2', 'C4']);
    const b = practicePlan('BALANCED', ['C4', 'C1', 'C2']);
    const reordered: TargetPlan = { ...b, targets: [...b.targets].reverse() };
    const rebuilt = SCENARIO.map((c) => ({ exposure: c.exposure, provenance: c.provenance, estimatedSeconds: c.estimatedSeconds, marks: c.marks, questionType: c.questionType, difficulty: c.difficulty, coverage: [...c.coverage].reverse(), store: c.store, ref: c.ref, key: c.key })) as SolverCandidate[];
    expect(ids(solveBlueprint(reordered, rebuilt))).toEqual(ids(solveBlueprint(a, SCENARIO)));
  });

  it('exact ties are broken by the canonical key (store + question id), and duplicates collapse', () => {
    const twins = [q('zeta', { C1: 'P' }), q('alpha', { C1: 'P' }), q('mid', { C1: 'P' })];
    expect(ids(solveBlueprint(practicePlan('QUICK', ['C1']), twins))).toEqual(['alpha']);
    expect(canonicalCandidateOrder([...twins, ...twins]).map((c) => c.ref.id)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('nothing in the solver reads a clock, randomness or an LLM', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    for (const f of ['solver/solve.ts', 'solver/candidate.ts', 'solver/plan.ts']) {
      const src = readFileSync(join(__dirname, '..', '..', 'src/lib/assessment-blueprint', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Date\.now|new Date\(|Math\.random|crypto\.random|process\.env|@\/lib\/ai|fetch\(/);
    }
  });
});

describe('B2 invariants', () => {
  const pools = [SCENARIO, [...SCENARIO, q('Q5', { C1: 'P' }), q('Q6', { C2: 'P' }), q('Q7', { C4: 'P' })], [q('only', { C9: 'P' })], []];

  it('selected is a subset of the candidates given, with no question twice', () => {
    for (const pool of pools) for (const depth of PRACTICE_DEPTHS) {
      const o = solveBlueprint(practicePlan(depth), pool);
      const keys = new Set(pool.map((c) => c.key));
      expect(o.selected.every((s) => keys.has(s.key))).toBe(true);
      expect(new Set(o.selected.map((s) => s.key)).size).toBe(o.selected.length);
    }
  });

  it('READY <=> no unmet requirement; not READY => every remaining deficit is named with a cause', () => {
    for (const pool of pools) for (const depth of PRACTICE_DEPTHS) {
      const o = solveBlueprint(practicePlan(depth), pool);
      expect(o.status === 'READY').toBe(o.unmet.length === 0);
      for (const u of o.unmet) {
        expect(u.missing).toBeGreaterThan(0);
        expect(u.cause).toBeTruthy();
      }
    }
  });

  it('READY => every hard requirement of every target is met by the selected set', () => {
    const rich = [...SCENARIO, q('Q5', { C1: 'P' }), q('Q6', { C2: 'P' }), q('Q7', { C4: 'P' }), q('Q8', { C2: 'P' }), q('Q9', { C1: 'P', C4: 'P' })];
    for (const depth of PRACTICE_DEPTHS) {
      const plan = practicePlan(depth);
      const o = solveBlueprint(plan, rich);
      expect(o.status).toBe('READY');
      for (const t of plan.targets) {
        const on = o.selected.flatMap((s) => s.contributes.filter((c) => c.targetKey === t.targetKey));
        expect(on.filter((c) => c.counted.includes('OPPORTUNITY')).length, `${depth} ${t.id} opp`).toBeGreaterThanOrEqual(t.opportunities);
        expect(on.filter((c) => c.counted.includes('DIRECT')).length, `${depth} ${t.id} direct`).toBeGreaterThanOrEqual(t.directOpportunities);
        expect(on.filter((c) => c.counted.includes('INDEPENDENT')).length, `${depth} ${t.id} indep`).toBeGreaterThanOrEqual(t.independentDemonstrations);
      }
    }
  });

  it('nothing is selected without a reason, and no selected question is redundant', () => {
    const rich = [...SCENARIO, q('Q5', { C1: 'P' }), q('Q6', { C2: 'P' }), q('Q7', { C4: 'P' })];
    for (const depth of PRACTICE_DEPTHS) {
      const plan = practicePlan(depth);
      const o = solveBlueprint(plan, rich);
      expect(o.selected.every((s) => s.reasons.length > 0)).toBe(true);
      // removing any selected question makes at least one requirement worse
      for (const s of o.selected) {
        const without = solveBlueprint(plan, rich.filter((c) => o.selected.some((x) => x.key === c.key) && c.key !== s.key));
        expect(without.unmet.length, `${depth} without ${s.key}`).toBeGreaterThan(o.unmet.length);
      }
    }
  });

  it('question count = size of the selected set, and the result states nothing else', () => {
    const plan = practicePlan('BALANCED');
    const o = solveBlueprint(plan, SCENARIO);
    const result = toBlueprintResult(plan, o, { id: 'p', version: '1' });
    expect(result.estimate.items).toBe(o.selected.length);
    expect(result.selected).toHaveLength(o.selected.length);
    expect(Object.keys(plan)).not.toContain('questionCount');
    expect(JSON.stringify(plan)).not.toMatch(/"(questionCount|itemCount|count)"/);
  });

  it('a target the caller asked for stays in scope whatever its priority: priority orders, it removes nothing', () => {
    const plan = practicePlan('QUICK', ['C1', 'C2']);
    const lowC2: TargetPlan = { ...plan, targets: plan.targets.map((t) => (t.id === 'C2' ? { ...t, priority: 1 } : { ...t, priority: 5 })) };
    const o = solveBlueprint(lowC2, [q('A', { C1: 'P' }), q('B', { C2: 'P' })]);
    expect(ids(o).sort()).toEqual(['A', 'B']);
  });
});

describe('B2 time budget', () => {
  const timed = (id: string, roles: Roles, seconds: number | null) => q(id, roles, { estimatedSeconds: seconds });

  it('respects a hard budget, using only recorded durations', () => {
    const pool = [timed('A', { C1: 'P' }, 120), timed('B', { C2: 'P' }, 120), timed('C', { C4: 'P' }, 120)];
    const fits = solveBlueprint({ ...practicePlan('QUICK'), hard: { excludeRecent: false, maxSeconds: 360 } }, pool);
    expect(fits.status).toBe('READY');
    expect(fits.estimatedSeconds).toBe(360);
    const tight = solveBlueprint({ ...practicePlan('QUICK'), hard: { excludeRecent: false, maxSeconds: 250 } }, pool);
    expect(tight.selected).toHaveLength(2);
    expect(tight.estimatedSeconds).toBeLessThanOrEqual(250);
    expect(tight.unmet).toEqual([{ subject: 'CONCEPT:C4', requirement: 'OPPORTUNITY', missing: 1, cause: 'TIME_BUDGET' }]);
  });

  it('a multi-concept question makes the same budget go further', () => {
    const pool = [timed('A', { C1: 'P' }, 120), timed('B', { C2: 'P' }, 120), timed('C', { C4: 'P' }, 120), timed('ABC', { C1: 'P', C2: 'P', C4: 'P' }, 200)];
    const o = solveBlueprint({ ...practicePlan('QUICK'), hard: { excludeRecent: false, maxSeconds: 250 } }, pool);
    expect(ids(o)).toEqual(['ABC']);
    expect(o.status).toBe('READY');
  });

  it('never exceeds the budget to reach a soft diversity preference', () => {
    const pool = [timed('A', { C1: 'P' }, 100), q('A2', { C1: 'P' }, { estimatedSeconds: 100, questionType: 'short_answer', difficulty: 4 })];
    const plan: TargetPlan = { ...practicePlan('BALANCED', ['C1']), hard: { excludeRecent: false, maxSeconds: 100 } };
    const o = solveBlueprint(plan, pool);
    expect(o.selected).toHaveLength(1);
    expect(o.estimatedSeconds).toBe(100);
  });

  it('UNKNOWN duration: no figure is invented, and a hard budget that cannot be verified says so', () => {
    const unknown = [q('A', { C1: 'P' }), q('B', { C2: 'P' }), q('C', { C4: 'P' })];
    const free = solveBlueprint(practicePlan('QUICK'), unknown);
    expect(free.status).toBe('READY');
    expect(free.estimatedSeconds).toBeNull();
    const budgeted = solveBlueprint({ ...practicePlan('QUICK'), hard: { excludeRecent: false, maxSeconds: 600 } }, unknown);
    expect(budgeted.selected).toEqual([]);
    expect(budgeted.status).toBe('INSUFFICIENT_COVERAGE');
    expect(budgeted.unmet.every((u) => u.cause === 'DURATION_UNKNOWN')).toBe(true);
    // one known, two unknown: the total stays unknown rather than a partial sum
    expect(solveBlueprint(practicePlan('QUICK'), [timed('A', { C1: 'P' }, 60), q('B', { C2: 'P' }), q('C', { C4: 'P' })]).estimatedSeconds).toBeNull();
  });
});

describe('B2 recent exposure', () => {
  const seen = { seen: true, recent: true };

  it('a recently seen question loses to an equivalent unseen one', () => {
    const o = solveBlueprint(practicePlan('QUICK', ['C1']), [q('aaa-seen', { C1: 'P' }, { exposure: seen }), q('zzz-fresh', { C1: 'P' })]);
    expect(ids(o)).toEqual(['zzz-fresh']);
  });

  it('it is still used when it is the only way to cover a required target, and the rationale says so', () => {
    const o = solveBlueprint(practicePlan('QUICK', ['C1', 'C2']), [q('seen', { C1: 'P' }, { exposure: seen }), q('fresh', { C2: 'P' })]);
    expect(o.status).toBe('READY');
    expect(o.selected.find((s) => s.question.id === 'seen')!.reasons).toContain('RECENT_REUSE_REQUIRED');
    expect(o.selected.find((s) => s.question.id === 'fresh')!.reasons).not.toContain('RECENT_REUSE_REQUIRED');
    expect(o.softShortfalls).toContainEqual({ preference: 'UNSEEN_QUESTIONS', wanted: 2, reached: 1 });
  });

  it('exposure never outranks coverage: a seen question covering two targets beats a fresh one covering one', () => {
    const o = solveBlueprint(practicePlan('QUICK', ['C1', 'C2']), [q('seen', { C1: 'P', C2: 'P' }, { exposure: seen }), q('fresh', { C1: 'P' })]);
    expect(ids(o)).toEqual(['seen']);
  });

  it('hard exclusion only where the activity policy requires novelty; then the trade-off is reported', () => {
    const plan: TargetPlan = { ...practicePlan('QUICK', ['C1']), hard: { excludeRecent: true, maxSeconds: null } };
    const o = solveBlueprint(plan, [q('seen', { C1: 'P' }, { exposure: seen })]);
    expect(o.selected).toEqual([]);
    expect(o.unmet).toEqual([{ subject: 'CONCEPT:C1', requirement: 'OPPORTUNITY', missing: 1, cause: 'ONLY_RECENT_CANDIDATES' }]);
  });
});

describe('B2 difficulty and diversity', () => {
  it('prefers the activity band, never rewrites a difficulty, and never assumes an UNKNOWN one is in band', () => {
    const pool = [q('a-unknown', { C1: 'P' }, { difficulty: null }), q('b-out', { C1: 'P' }, { difficulty: 5 }), q('c-in', { C1: 'P' }, { difficulty: 3 })];
    const o = solveBlueprint(practicePlan('QUICK', ['C1']), pool);
    expect(ids(o)).toEqual(['c-in']);
    expect(pool.map((c) => c.difficulty)).toEqual([null, 5, 3]);
    // an unknown difficulty is reported as outside the verified band, not counted as inside it
    const unknownOnly = solveBlueprint(practicePlan('QUICK', ['C1']), [q('u', { C1: 'P' }, { difficulty: null })]);
    expect(unknownOnly.status).toBe('READY');
    expect(unknownOnly.softShortfalls).toContainEqual({ preference: 'DIFFICULTY_BAND', wanted: 1, reached: 0 });
  });

  it('BALANCED / DEEP prefer variety when the bank has it, and report it when it does not', () => {
    const varied = [q('a', { C1: 'P' }), q('b', { C1: 'P' }, { questionType: 'short_answer', difficulty: 4 }), q('c', { C1: 'P' })];
    const o = solveBlueprint(practicePlan('BALANCED', ['C1']), varied);
    expect(new Set(ids(o))).toEqual(new Set(['a', 'b']));
    const flat = solveBlueprint(practicePlan('BALANCED', ['C1']), [q('a', { C1: 'P' }), q('c', { C1: 'P' })]);
    expect(flat.status).toBe('READY');
    expect(flat.softShortfalls.map((s) => s.preference)).toEqual(expect.arrayContaining(['QUESTION_TYPE_DIVERSITY', 'DIFFICULTY_DIVERSITY']));
  });
});

describe('B2 official slots (one solver, slot mode)', () => {
  const item = (id: string, objective: string, over: Partial<SolverCandidate> = {}): SolverCandidate => ({
    key: `REVIEWED_EXAM_BANK:${id}`, ref: { store: 'REVIEWED_EXAM_BANK', id }, store: 'REVIEWED_EXAM_BANK',
    coverage: [{ targetKey: `OBJECTIVE:${objective}`, kind: 'OBJECTIVE', id: objective, strength: 'DIRECT' }],
    difficulty: 3, questionType: 'multiple_choice', marks: 1, estimatedSeconds: null, provenance: 'STUDYUS_GENERATED', exposure: NO_EXPOSURE, ...over,
  });
  const slot = (index: number, objective: string, over: Partial<SlotPlan['slots'][number]> = {}) => ({ index, blueprintObjectiveTargetId: `t${index}`, assessmentComponentId: 'c1', learningObjectiveId: objective, questionType: null, difficultyRange: null, constraints: [], ...over });
  const plan = (slots: SlotPlan['slots']): SlotPlan => ({ mode: 'SLOTS', family: 'OFFICIAL_EXAM', slots, soft: { avoidSeen: true } });

  it('fills every position, one item per position, and reports marks', () => {
    const o = solveBlueprint(plan([slot(0, 'lo-1'), slot(1, 'lo-1'), slot(2, 'lo-2')]), [item('a', 'lo-1'), item('b', 'lo-1'), item('c', 'lo-2')]);
    expect(o.status).toBe('READY');
    expect(o.selected.map((s) => [s.slotIndex, s.question.id])).toEqual([[0, 'a'], [1, 'b'], [2, 'c']]);
    expect(o.marks).toBe(3);
  });

  it('finds a complete assignment where a position-by-position pick would not', () => {
    // slot 0 accepts any type; slot 1 needs short_answer. Taking the short-answer item first would strand slot 1.
    const o = solveBlueprint(plan([slot(0, 'lo-1'), slot(1, 'lo-1', { questionType: 'short_answer' })]), [item('a-sa', 'lo-1', { questionType: 'short_answer' }), item('b-mc', 'lo-1')]);
    expect(o.status).toBe('READY');
    expect(o.selected.map((s) => [s.slotIndex, s.question.id])).toEqual([[0, 'b-mc'], [1, 'a-sa']]);
  });

  it('an incomplete official form selects nothing and names the unfillable positions', () => {
    const o = solveBlueprint(plan([slot(0, 'lo-1'), slot(1, 'lo-2')]), [item('a', 'lo-1')]);
    expect(o.status).toBe('INSUFFICIENT_COVERAGE');
    expect(o.selected).toEqual([]);
    expect(o.unmet).toEqual([{ subject: 'SLOT:1', requirement: 'SLOT', missing: 1, cause: 'NO_ITEM_FOR_SLOT' }]);
  });

  it('a learning-store question can never fill an official position', () => {
    const cached = { ...item('cached', 'lo-1'), key: 'LEARNING_ITEM_CACHE:cached', ref: { store: 'LEARNING_ITEM_CACHE' as const, id: 'cached' }, store: 'LEARNING_ITEM_CACHE' as const };
    const o = solveBlueprint(plan([slot(0, 'lo-1')]), [cached]);
    expect(o.status).toBe('INSUFFICIENT_COVERAGE');
    expect(o.selected).toEqual([]);
  });

  it('honours slot type, difficulty range and one item per template; an unknown difficulty is not assumed in range', () => {
    const range = { min: 2, max: 3 };
    expect(solveBlueprint(plan([slot(0, 'lo-1', { difficultyRange: range })]), [item('hard', 'lo-1', { difficulty: 5 })]).status).toBe('INSUFFICIENT_COVERAGE');
    expect(solveBlueprint(plan([slot(0, 'lo-1', { difficultyRange: range })]), [item('unknown', 'lo-1', { difficulty: null })]).status).toBe('INSUFFICIENT_COVERAGE');
    expect(solveBlueprint(plan([slot(0, 'lo-1', { difficultyRange: range })]), [item('ok', 'lo-1', { difficulty: 2 })]).status).toBe('READY');
    const sameTemplate = [item('a', 'lo-1', { templateKey: 'tpl' }), item('b', 'lo-1', { templateKey: 'tpl' })];
    expect(solveBlueprint(plan([slot(0, 'lo-1'), slot(1, 'lo-1')]), sameTemplate).status).toBe('INSUFFICIENT_COVERAGE');
    expect(solveBlueprint(plan([slot(0, 'lo-1'), slot(1, 'lo-1')]), [...sameTemplate, item('c', 'lo-1', { templateKey: 'other' })]).status).toBe('READY');
  });

  it('is deterministic for any candidate order', () => {
    const pool = Array.from({ length: 12 }, (_, i) => item(`i${String(i).padStart(2, '0')}`, `lo-${i % 3}`));
    const slots = Array.from({ length: 9 }, (_, i) => slot(i, `lo-${i % 3}`));
    const reference = solveBlueprint(plan(slots), pool);
    for (let seed = 1; seed <= 20; seed += 1) expect(solveBlueprint(plan(slots), shuffle(pool, seed)).selected.map((s) => [s.slotIndex, s.key])).toEqual(reference.selected.map((s) => [s.slotIndex, s.key]));
  });
});

describe('B2 scale', () => {
  it('a realistic pool (3,000 questions, 40 concepts) solves quickly and deterministically', () => {
    const concepts = Array.from({ length: 40 }, (_, i) => `K${String(i).padStart(2, '0')}`);
    const pool: SolverCandidate[] = Array.from({ length: 3000 }, (_, i) => {
      const a = concepts[i % 40];
      const b = concepts[(i * 7 + 3) % 40];
      return q(`p${String(i).padStart(4, '0')}`, i % 5 === 0 && a !== b ? { [a]: 'P', [b]: 'S' } : { [a]: 'P' }, { difficulty: 1 + (i % 5), questionType: ['multiple_choice', 'short_answer', 'numeric_problem'][i % 3] });
    });
    const plan = practicePlan('DEEP', concepts);
    const started = performance.now();
    const o = solveBlueprint(plan, pool);
    const elapsed = performance.now() - started;
    expect(o.status).toBe('READY');
    expect(elapsed).toBeLessThan(5000);
    expect(o.diagnostics).toMatchObject({ candidateCount: 3000, mode: 'TARGETS', family: 'LEARNING', status: 'READY' });
    expect(o.diagnostics.iterations).toBeLessThan(400);
    expect(ids(solveBlueprint(plan, shuffle(pool, 7)))).toEqual(ids(o));
  });

  it('diagnostics carry counts only -- no question content and nothing about the Student', () => {
    const o = solveBlueprint(practicePlan('BALANCED'), SCENARIO);
    expect(Object.keys(o.diagnostics).sort()).toEqual(['candidateCount', 'family', 'iterations', 'mode', 'prunedCount', 'selectedCount', 'status', 'unmetCount', 'usableCount']);
  });
});

describe('B2 depth presets are evidence-relative', () => {
  const need = (evidenceDeficit: number, independentDeficit = 2) => ({ ...neutralEvidenceNeeds(['C1'], POLICY)[0], evidenceDeficit, independentDeficit });

  it('opportunities follow the canonical deficit, bounded by the preset; a mastered concept keeps the floor', () => {
    expect(depthRequirementFor(need(3), 'QUICK', false)).toEqual({ opportunities: 1, directOpportunities: 0, independentDemonstrations: 0 });
    expect(depthRequirementFor(need(3), 'BALANCED', false)).toEqual({ opportunities: 2, directOpportunities: 1, independentDemonstrations: 0 });
    expect(depthRequirementFor(need(1), 'BALANCED', false).opportunities).toBe(1);
    expect(depthRequirementFor(need(0), 'BALANCED', false).opportunities).toBe(1);
    expect(depthRequirementFor(need(3), 'DEEP', false)).toEqual({ opportunities: 3, directOpportunities: 2, independentDemonstrations: 1 });
    expect(depthRequirementFor(need(0), 'DEEP', false).opportunities).toBe(2);
  });

  it('an independent activity carries the canonical independent deficit as dedicated demonstrations, even in QUICK', () => {
    expect(depthRequirementFor(need(3, 2), 'QUICK', true)).toEqual({ opportunities: 1, directOpportunities: 1, independentDemonstrations: 1 });
    expect(depthRequirementFor(need(3, 2), 'BALANCED', true)).toEqual({ opportunities: 2, directOpportunities: 2, independentDemonstrations: 2 });
    expect(depthRequirementFor(need(3, 0), 'BALANCED', true).independentDemonstrations).toBe(1);
  });

  it('a plan never contains a requirement the targets do not need', () => {
    const t: TargetRequirement[] = practicePlan('BALANCED').targets;
    expect(t.every((x) => x.directOpportunities <= x.opportunities && x.independentDemonstrations <= x.directOpportunities + 0 || x.independentDemonstrations === 0)).toBe(true);
  });
});
