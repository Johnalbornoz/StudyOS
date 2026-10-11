/**
 * B2 -- the shared blueprint solver (pure, deterministic). One engine for the three families.
 *
 * It satisfies a plan; it decides no policy. It never scores an ineligible question into the set: the
 * caller hands it only candidates that already passed QuestionEligibility.
 *
 * TARGET plans (LEARNING, EXAM_PREPARATION): a transparent greedy multi-cover. Each round takes the
 * candidate with the greatest remaining policy value, compared LEXICOGRAPHICALLY (never a weighted sum, so
 * a lower rule can never buy out a higher one):
 *
 *   1. targets it covers that have no opportunity yet            (required coverage first)
 *   2. the priority of those targets
 *   3. required opportunities / direct opportunities it adds     (evidence requirements, weighted by priority)
 *   4. independent demonstrations it makes possible              (independence)
 *   5. new question types / difficulty levels it brings          (diversity)
 *   6. not recently seen, then never seen                        (exposure)
 *   7. closeness to the preferred difficulty band
 *   8. shorter KNOWN duration                                     (time)
 *   9. its canonical key                                          (stable tie-break)
 *
 * A candidate with no gain on 1-4 is never taken: nothing is added for its own sake, so the number of
 * questions is whatever the requirements needed. A final pass removes any question whose removal leaves
 * every requirement as satisfied as it was (count is minimised last, never before coverage).
 *
 * Independent demonstrations are assigned by maximum bipartite matching over the selected questions, so one
 * question is the demonstration of at most one target however many it covers.
 *
 * SLOT plans (OFFICIAL_EXAM): maximum bipartite matching of blueprint positions to eligible reviewed items
 * (at most one item per template). Positions are the blueprint's; the solver fills them or reports which
 * cannot be filled. An incomplete official form selects nothing.
 *
 * Determinism: candidates are put in canonical key order before anything else, every comparison ends on the
 * key, no clock, no randomness and no iteration over unordered collections decide anything.
 *
 * Complexity (N candidates, T targets, S selected): greedy O(S x N x T), matching O(S x T x S), pruning
 * O(S^2 x T). S is bounded by the requirement units, so a pool of thousands is linear in N per round.
 * Slot plans: O(P x E) for P positions and E position-item edges.
 */
import { constraintMismatches } from '@/lib/exam-core/slot-constraints';
import { canonicalCandidateOrder, strengthOn, type CoverageStrength, type SolverCandidate } from './candidate';
import type { SelectedQuestion, SelectionReason, SlotPlan, SolveOutcome, SolverPlan, SolveStatus, TargetPlan, TargetRequirement, UnmetCause, UnmetRequirement } from './plan';

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/* ------------------------------------------------------------------ */
/* Target plans                                                         */
/* ------------------------------------------------------------------ */

function accepted(plan: TargetPlan, strength: CoverageStrength | null): boolean {
  if (strength === 'DIRECT') return true;
  if (strength === 'SUPPORTING') return plan.accept.supporting;
  if (strength === 'DERIVED') return plan.accept.derived;
  return false;
}

interface Counts {
  opportunity: Map<string, number>;
  direct: Map<string, number>;
}

function countsOf(plan: TargetPlan, selected: readonly SolverCandidate[]): Counts {
  const opportunity = new Map<string, number>();
  const direct = new Map<string, number>();
  for (const t of plan.targets) {
    let o = 0;
    let d = 0;
    for (const c of selected) {
      const s = strengthOn(c, t.targetKey);
      if (accepted(plan, s)) o += 1;
      if (s === 'DIRECT') d += 1;
    }
    opportunity.set(t.targetKey, o);
    direct.set(t.targetKey, d);
  }
  return { opportunity, direct };
}

/**
 * Maximum matching of independent-demonstration units to selected questions (Kuhn). A question is dedicated
 * to at most one target; targets are served in priority order, then by key, so the assignment is stable.
 */
function dedicate(plan: TargetPlan, selected: readonly SolverCandidate[]): { byQuestion: Map<string, string>; byTarget: Map<string, number> } {
  const targets = [...plan.targets].filter((t) => t.independentDemonstrations > 0).sort((a, b) => b.priority - a.priority || byKey(a.targetKey, b.targetKey));
  const units: string[] = [];
  for (const t of targets) for (let i = 0; i < t.independentDemonstrations; i += 1) units.push(t.targetKey);
  const questions = [...selected].sort((a, b) => byKey(a.key, b.key));
  const owner = new Map<string, number>(); // question key -> unit index
  const tryUnit = (u: number, seen: Set<string>): boolean => {
    for (const q of questions) {
      if (seen.has(q.key) || strengthOn(q, units[u]) !== 'DIRECT') continue;
      seen.add(q.key);
      const held = owner.get(q.key);
      if (held === undefined || tryUnit(held, seen)) {
        owner.set(q.key, u);
        return true;
      }
    }
    return false;
  };
  for (let u = 0; u < units.length; u += 1) tryUnit(u, new Set());
  const byQuestion = new Map<string, string>();
  const byTarget = new Map<string, number>();
  for (const [q, u] of owner) {
    byQuestion.set(q, units[u]);
    byTarget.set(units[u], (byTarget.get(units[u]) ?? 0) + 1);
  }
  return { byQuestion, byTarget };
}

/** In band 0; UNKNOWN difficulty -0.5 (neither rewarded nor assumed in band); otherwise minus the distance to the band. */
function difficultyFit(plan: TargetPlan, c: SolverCandidate): number {
  const band = plan.soft.difficulty;
  if (!band) return 0;
  if (c.difficulty === null) return -0.5;
  if (c.difficulty < band.min) return -(band.min - c.difficulty);
  if (c.difficulty > band.max) return -(c.difficulty - band.max);
  return band.target === null ? 0 : -Math.abs(c.difficulty - band.target) / 100;
}

function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function requirementsMet(plan: TargetPlan, selected: readonly SolverCandidate[]): { opportunity: Map<string, number>; direct: Map<string, number>; dedicated: Map<string, number> } {
  const counts = countsOf(plan, selected);
  return { ...counts, dedicated: dedicate(plan, selected).byTarget };
}

function solveTargets(plan: TargetPlan, input: readonly SolverCandidate[]): SolveOutcome {
  const pool = canonicalCandidateOrder(input);
  const targets = [...plan.targets].sort((a, b) => byKey(a.targetKey, b.targetKey));
  const targetByKey = new Map<string, TargetRequirement>(targets.map((t) => [t.targetKey, t]));
  const relevant = (c: SolverCandidate) => c.coverage.some((x) => targetByKey.has(x.targetKey));
  const allowed = pool.filter((c) => relevant(c) && !(plan.hard.excludeRecent && c.exposure.recent));

  const selected: SolverCandidate[] = [];
  const order = new Map<string, number>();
  const reasons = new Map<string, Set<SelectionReason>>();
  const chosen = new Set<string>();
  const blockedByTime = new Set<string>();
  const blockedByUnknownDuration = new Set<string>();
  let remainingSeconds = plan.hard.maxSeconds;
  let iterations = 0;

  for (;;) {
    iterations += 1;
    const counts = countsOf(plan, selected);
    const dedicated = dedicate(plan, selected).byTarget;
    const types = new Set(selected.map((c) => c.questionType).filter((x): x is string => !!x));
    const levels = new Set(selected.map((c) => c.difficulty).filter((x): x is number => x !== null));

    let best: { c: SolverCandidate; tuple: number[]; why: SelectionReason[] } | null = null;
    for (const c of allowed) {
      if (chosen.has(c.key)) continue;
      let newTargets = 0;
      let newPriority = 0;
      let need = 0;
      let addsDirect = false;
      let independence = 0;
      for (const cov of c.coverage) {
        const t = targetByKey.get(cov.targetKey);
        if (!t) continue;
        const ok = accepted(plan, cov.strength);
        const have = counts.opportunity.get(t.targetKey) ?? 0;
        if (ok && t.opportunities > 0 && have === 0) {
          newTargets += 1;
          newPriority += t.priority;
        }
        if (ok && have < t.opportunities) need += t.priority;
        if (cov.strength === 'DIRECT' && (counts.direct.get(t.targetKey) ?? 0) < t.directOpportunities) {
          need += t.priority;
          addsDirect = true;
        }
        if (cov.strength === 'DIRECT' && (dedicated.get(t.targetKey) ?? 0) < t.independentDemonstrations) independence = Math.max(independence, t.priority);
      }
      if (newTargets === 0 && need === 0 && independence === 0) continue; // nothing is added for its own sake

      // A hard time limit is checked only against a recorded duration: an unknown one is never assumed to fit.
      if (remainingSeconds !== null) {
        if (c.estimatedSeconds === null) {
          blockedByUnknownDuration.add(c.key);
          continue;
        }
        if (c.estimatedSeconds > remainingSeconds) {
          blockedByTime.add(c.key);
          continue;
        }
      }

      const diversity =
        (c.questionType && !types.has(c.questionType) && types.size < plan.soft.diversity.questionTypes ? 1 : 0) +
        (c.difficulty !== null && !levels.has(c.difficulty) && levels.size < plan.soft.diversity.difficultyLevels ? 1 : 0);
      const tuple = [
        newTargets,
        newPriority,
        need,
        independence,
        diversity,
        plan.soft.avoidRecent && c.exposure.recent ? 0 : 1,
        plan.soft.avoidRecent && c.exposure.seen ? 0 : 1,
        difficultyFit(plan, c),
        c.estimatedSeconds === null ? 0 : -c.estimatedSeconds,
      ];
      // `allowed` is in canonical key order and only a STRICTLY better tuple replaces the best: ties go to the smaller key.
      if (!best || compareTuples(tuple, best.tuple) > 0) {
        const why: SelectionReason[] = [];
        if (newTargets > 0) why.push('COVERS_UNCOVERED_TARGET');
        else if (need > 0) why.push('ADDS_REQUIRED_OPPORTUNITY');
        if (addsDirect) why.push('ADDS_DIRECT_OPPORTUNITY');
        if (independence > 0) why.push('INDEPENDENT_DEMONSTRATION');
        if (diversity > 0) why.push('ADDS_DIVERSITY');
        if (c.exposure.recent) why.push('RECENT_REUSE_REQUIRED');
        best = { c, tuple, why };
      }
    }
    if (!best) break;
    chosen.add(best.c.key);
    order.set(best.c.key, selected.length);
    reasons.set(best.c.key, new Set(best.why));
    selected.push(best.c);
    if (remainingSeconds !== null) remainingSeconds -= best.c.estimatedSeconds ?? 0;
  }

  /* ---- minimise count LAST: drop a question only if every requirement stays exactly as satisfied ---- */
  let pruned = 0;
  const satisfaction = (set: readonly SolverCandidate[]) => {
    const m = requirementsMet(plan, set);
    return targets.map((t) => [Math.min(m.opportunity.get(t.targetKey) ?? 0, t.opportunities), Math.min(m.direct.get(t.targetKey) ?? 0, t.directOpportunities), Math.min(m.dedicated.get(t.targetKey) ?? 0, t.independentDemonstrations)].join('/')).join('|');
  };
  const baseline = satisfaction(selected);
  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const without = selected.filter((_, j) => j !== i);
    if (satisfaction(without) === baseline) {
      selected.splice(i, 1);
      pruned += 1;
    }
  }

  /* ---- outcome ---- */
  const final = requirementsMet(plan, selected);
  const dedication = dedicate(plan, selected);
  const unmet: UnmetRequirement[] = [];
  const causeFor = (t: TargetRequirement, need: 'OPPORTUNITY' | 'DIRECT' | 'INDEPENDENT'): UnmetCause => {
    const covering = pool.filter((c) => strengthOn(c, t.targetKey) !== null);
    if (covering.length === 0) return 'NO_ELIGIBLE_CANDIDATE';
    const strong = covering.filter((c) => (need === 'OPPORTUNITY' ? accepted(plan, strengthOn(c, t.targetKey)) : strengthOn(c, t.targetKey) === 'DIRECT'));
    if (strong.length === 0) return 'ONLY_WEAKER_COVERAGE';
    const unused = strong.filter((c) => !selected.some((s) => s.key === c.key));
    if (unused.some((c) => blockedByTime.has(c.key))) return 'TIME_BUDGET';
    if (unused.some((c) => blockedByUnknownDuration.has(c.key))) return 'DURATION_UNKNOWN';
    if (plan.hard.excludeRecent && unused.some((c) => c.exposure.recent)) return 'ONLY_RECENT_CANDIDATES';
    return 'NOT_ENOUGH_CANDIDATES';
  };
  for (const t of targets) {
    const o = t.opportunities - (final.opportunity.get(t.targetKey) ?? 0);
    const d = t.directOpportunities - (final.direct.get(t.targetKey) ?? 0);
    const i = t.independentDemonstrations - (final.dedicated.get(t.targetKey) ?? 0);
    if (o > 0) unmet.push({ subject: t.targetKey, requirement: 'OPPORTUNITY', missing: o, cause: causeFor(t, 'OPPORTUNITY') });
    if (d > 0) unmet.push({ subject: t.targetKey, requirement: 'DIRECT', missing: d, cause: causeFor(t, 'DIRECT') });
    if (i > 0) unmet.push({ subject: t.targetKey, requirement: 'INDEPENDENT', missing: i, cause: causeFor(t, 'INDEPENDENT') });
  }
  for (const u of [...plan.unresolvedTargets].sort((a, b) => byKey(a.ref, b.ref))) unmet.push({ subject: u.ref, requirement: 'IDENTITY', missing: 1, cause: 'UNRESOLVED_TARGET' });

  // A target the CONTENT cannot reach makes the blueprint insufficient. One left out only because the
  // Student's own time limit ran out is a stated trade-off: what fits is a PARTIAL blueprint.
  const uncovered = targets.some((t) => t.opportunities > 0 && (final.opportunity.get(t.targetKey) ?? 0) === 0 && causeFor(t, 'OPPORTUNITY') !== 'TIME_BUDGET');
  const status: SolveStatus = unmet.length === 0 ? 'READY' : selected.length === 0 || uncovered ? 'INSUFFICIENT_COVERAGE' : 'PARTIAL';

  const ordered = [...selected].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  const out: SelectedQuestion[] = ordered.map((c, index) => {
    // What each contribution COUNTS for, replayed in selection order so a requirement is credited once.
    return {
      question: c.ref,
      key: c.key,
      order: index,
      slotIndex: null,
      contributes: c.coverage
        .filter((cov) => targetByKey.has(cov.targetKey))
        .map((cov) => {
          const counted: Array<'OPPORTUNITY' | 'DIRECT' | 'INDEPENDENT'> = [];
          if (accepted(plan, cov.strength)) counted.push('OPPORTUNITY');
          if (cov.strength === 'DIRECT') counted.push('DIRECT');
          if (dedication.byQuestion.get(c.key) === cov.targetKey) counted.push('INDEPENDENT');
          return { targetKey: cov.targetKey, strength: cov.strength, counted };
        }),
      dedicatedTo: dedication.byQuestion.get(c.key) ?? null,
      reasons: [...(reasons.get(c.key) ?? [])],
    };
  });

  const types = new Set(selected.map((c) => c.questionType).filter((x): x is string => !!x)).size;
  const levels = new Set(selected.map((c) => c.difficulty).filter((x): x is number => x !== null)).size;
  const softShortfalls: SolveOutcome['softShortfalls'] = [];
  if (selected.length > 0 && types < Math.min(plan.soft.diversity.questionTypes, selected.length)) softShortfalls.push({ preference: 'QUESTION_TYPE_DIVERSITY', wanted: Math.min(plan.soft.diversity.questionTypes, selected.length), reached: types });
  if (selected.length > 0 && levels < Math.min(plan.soft.diversity.difficultyLevels, selected.length)) softShortfalls.push({ preference: 'DIFFICULTY_DIVERSITY', wanted: Math.min(plan.soft.diversity.difficultyLevels, selected.length), reached: levels });
  const band = plan.soft.difficulty;
  if (band) {
    const inBand = selected.filter((c) => c.difficulty !== null && c.difficulty >= band.min && c.difficulty <= band.max).length;
    if (inBand < selected.length) softShortfalls.push({ preference: 'DIFFICULTY_BAND', wanted: selected.length, reached: inBand });
  }
  if (plan.soft.avoidRecent) {
    const unseen = selected.filter((c) => !c.exposure.recent).length;
    if (unseen < selected.length) softShortfalls.push({ preference: 'UNSEEN_QUESTIONS', wanted: selected.length, reached: unseen });
  }

  return {
    status,
    selected: out,
    unmet,
    softShortfalls,
    estimatedSeconds: selected.length > 0 && selected.every((c) => c.estimatedSeconds !== null) ? selected.reduce((n, c) => n + (c.estimatedSeconds as number), 0) : null,
    marks: selected.length > 0 && selected.every((c) => c.marks !== null) ? selected.reduce((n, c) => n + (c.marks as number), 0) : null,
    diagnostics: { family: plan.family, mode: 'TARGETS', candidateCount: pool.length, usableCount: allowed.length, selectedCount: out.length, unmetCount: unmet.length, iterations, prunedCount: pruned, status },
  };
}

/* ------------------------------------------------------------------ */
/* Slot plans (official exam)                                           */
/* ------------------------------------------------------------------ */

/** The one slot rule. Exported so a stimulus group is placed by the same rule its questions would be judged by alone (B2-B2). */
export function fitsSlot(slot: SlotPlan['slots'][number], c: SolverCandidate): boolean {
  // Official content is reviewed-bank content: a cached / generated question can never fill an official position.
  if (c.store !== 'REVIEWED_EXAM_BANK') return false;
  if (!slot.learningObjectiveId || strengthOn(c, `OBJECTIVE:${slot.learningObjectiveId}`) !== 'DIRECT') return false;
  if (slot.questionType && c.questionType !== slot.questionType) return false;
  // A difficulty range is verified against a recorded difficulty: an unknown one is never assumed to be inside it.
  if (slot.difficultyRange && (c.difficulty === null || c.difficulty < slot.difficultyRange.min || c.difficulty > slot.difficultyRange.max)) return false;
  if (slot.constraints.length > 0 && constraintMismatches(slot.constraints, c.dimensions ?? null).length > 0) return false;
  return true;
}

function solveSlots(plan: SlotPlan, input: readonly SolverCandidate[]): SolveOutcome {
  const pool = canonicalCandidateOrder(input);
  const slots = [...plan.slots].sort((a, b) => a.index - b.index);
  // At most one item per template: items sharing a template form one group.
  const groupOf = (c: SolverCandidate) => (c.templateKey ? `T:${c.templateKey}` : `Q:${c.key}`);
  const preference = (slot: SlotPlan['slots'][number], c: SolverCandidate): number[] => {
    const mid = slot.difficultyRange ? (slot.difficultyRange.min + slot.difficultyRange.max) / 2 : null;
    return [plan.soft.avoidSeen && c.exposure.seen ? 0 : 1, mid === null || c.difficulty === null ? 0 : -Math.abs(c.difficulty - mid)];
  };
  const fitting = slots.map((slot) =>
    pool.filter((c) => fitsSlot(slot, c)).sort((a, b) => compareTuples(preference(slot, b), preference(slot, a)) || byKey(a.key, b.key))
  );
  const groupsFor = fitting.map((list) => [...new Set(list.map(groupOf))]);
  const owner = new Map<string, number>(); // group -> slot position in `slots`
  let iterations = 0;
  const assign = (s: number, seen: Set<string>): boolean => {
    // A free item first (in preference order): an earlier position is only re-routed when nothing free fits.
    for (const g of groupsFor[s]) {
      if (seen.has(g) || owner.has(g)) continue;
      iterations += 1;
      seen.add(g);
      owner.set(g, s);
      return true;
    }
    for (const g of groupsFor[s]) {
      iterations += 1;
      if (seen.has(g)) continue;
      seen.add(g);
      const held = owner.get(g);
      if (held === undefined || assign(held, seen)) {
        owner.set(g, s);
        return true;
      }
    }
    return false;
  };
  for (let s = 0; s < slots.length; s += 1) assign(s, new Set());

  const groupOfSlot = new Map<number, string>();
  for (const [g, s] of owner) groupOfSlot.set(s, g);
  const filled: Array<{ slot: SlotPlan['slots'][number]; c: SolverCandidate }> = [];
  const unmet: UnmetRequirement[] = [];
  slots.forEach((slot, s) => {
    const g = groupOfSlot.get(s);
    const c = g ? fitting[s].find((x) => groupOf(x) === g) : undefined;
    if (c) filled.push({ slot, c });
    else unmet.push({ subject: `SLOT:${slot.index}`, requirement: 'SLOT', missing: 1, cause: 'NO_ITEM_FOR_SLOT' });
  });

  const complete = unmet.length === 0 && slots.length > 0;
  const status: SolveStatus = complete ? 'READY' : 'INSUFFICIENT_COVERAGE';
  // An official form is complete or it is not offered: an incomplete one selects nothing.
  const selected: SelectedQuestion[] = complete
    ? filled.map(({ slot, c }, i) => ({
        question: c.ref,
        key: c.key,
        order: i,
        slotIndex: slot.index,
        contributes: slot.learningObjectiveId ? [{ targetKey: `OBJECTIVE:${slot.learningObjectiveId}`, strength: 'DIRECT' as const, counted: ['OPPORTUNITY' as const, 'DIRECT' as const] }] : [],
        dedicatedTo: null,
        reasons: c.exposure.seen ? (['FILLS_OFFICIAL_SLOT', 'RECENT_REUSE_REQUIRED'] as SelectionReason[]) : (['FILLS_OFFICIAL_SLOT'] as SelectionReason[]),
      }))
    : [];
  const chosen = complete ? filled.map((f) => f.c) : [];
  return {
    status,
    selected,
    unmet,
    softShortfalls: [],
    estimatedSeconds: chosen.length > 0 && chosen.every((c) => c.estimatedSeconds !== null) ? chosen.reduce((n, c) => n + (c.estimatedSeconds as number), 0) : null,
    marks: chosen.length > 0 && chosen.every((c) => c.marks !== null) ? chosen.reduce((n, c) => n + (c.marks as number), 0) : null,
    diagnostics: { family: 'OFFICIAL_EXAM', mode: 'SLOTS', candidateCount: pool.length, usableCount: new Set(fitting.flat().map((c) => c.key)).size, selectedCount: selected.length, unmetCount: unmet.length, iterations, prunedCount: 0, status },
  };
}

/** The one entry point. Same plan + same candidate set (in any order) => the same outcome. */
export function solveBlueprint(plan: SolverPlan, candidates: readonly SolverCandidate[]): SolveOutcome {
  return plan.mode === 'SLOTS' ? solveSlots(plan, candidates) : solveTargets(plan, candidates);
}
