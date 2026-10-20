/**
 * LEARNING_ACTIVITY_DELIVERY -- assemble an activity from VALIDATED bank
 * candidates. Pure and deterministic: no AI, no I/O.
 *
 *  - only candidates inside the contract's difficulty band;
 *  - never an item the learner has already seen in an independent check
 *    (PROVE / RETAIN / TRANSFER), never a prior-Practice exact duplicate;
 *    assisted activities prefer unseen, least-used items;
 *  - never a candidate reserved by another prepared activity;
 *  - semantic diversity through the SAME selector the Prove pipeline uses
 *    (PROVE_INTRA_SESSION_NOVELTY, question-diversity.ts) -- no second copy;
 *  - TRANSFER: exactly one challenge per depth (NEAR, CONTEXTUAL, HIGHER);
 *  - an incomplete set is never returned: SHORT means "not enough";
 *  - PRACTICE only: candidates that address the latest LEARN weaknesses
 *    (`priorityCandidateIds`, requirement §22) are brought forward in the
 *    order, up to `priorityCap` -- the same filters, count and diversity
 *    selection apply, so nothing else changes.
 */
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { selectDiverse } from '@/lib/lx/question-diversity';
import type { DeliveryActivityType, DeliveryLevelMix, DeliveryPracticeMix } from './contract';
import { prioritiseOrder } from '@/lib/learn-guided/weakness-focus';
import { isDeliverableChoiceItem } from '@/lib/lx/choice-item-validator';

export interface BankCandidate {
  id: string;
  question: GeneratedQuestion;
  difficulty: number;
  contentFingerprint: string;
  transferDepth: 'NEAR' | 'CONTEXTUAL' | 'HIGHER' | null;
  usageCount: number;
  /** Already delivered to this learner in some session. */
  delivered: boolean;
  /** D76: when this learner was last given it (epoch ms); null/absent = never. Assisted reuse takes the least recent first. */
  lastDeliveredAt?: number | null;
}

export interface AssemblyRequest {
  activityType: DeliveryActivityType;
  itemCount: number;
  difficulty: { min: number; max: number; target: number };
  language: string;
  /** Content fingerprints the learner must not see again (e.g. prior Practice items for a Prove). */
  excludeFingerprints: ReadonlySet<string>;
  /** Candidates reserved by other READY prepared activities. */
  reservedCandidateIds: ReadonlySet<string>;
  /** PRACTICE only (assisted): candidates matching the latest LEARN weaknesses, brought forward (never added, never forced). */
  priorityCandidateIds?: ReadonlySet<string>;
  /** Most prioritised candidates brought forward (default: all of them). */
  priorityCap?: number;
  /**
   * D78 -- PRACTICE only: exact per-level counts (e.g. 2 at base + 1 at base+1). Admissible levels
   * become [difficulty.min, highest mix level] -- never above base+1. A missing base+1 item is
   * replaced by a base item (controlled fallback, never a block); a missing base item may be
   * replaced only by a LOWER level inside the band, never by a harder one.
   */
  practiceMix?: DeliveryPracticeMix;
  /**
   * D79 -- PROVE only: exact per-level counts (10 x L3, or 7 x L3 + 3 x L4). Admissible levels are
   * exactly the mix's levels; every level count must be met (no fallback -- SHORT otherwise).
   */
  proveMix?: DeliveryLevelMix;
}

export type AssemblyResult =
  | { status: 'ASSEMBLED'; questions: GeneratedQuestion[]; candidateIds: string[] }
  | { status: 'SHORT'; available: number; needed: number };

const INDEPENDENT: ReadonlySet<DeliveryActivityType> = new Set(['PROVE', 'RETAIN', 'TRANSFER']);

/** Independent checks never re-deliver an item the learner has already been given. */
export const isIndependentActivity = (activityType: DeliveryActivityType): boolean => INDEPENDENT.has(activityType);
const DEPTHS = ['NEAR', 'CONTEXTUAL', 'HIGHER'] as const;

/** D78 -- the admissible difficulty band of a request: the contract band, narrowed to the mix's highest level for a PRACTICE mix. */
export function admissibleBand(req: Pick<AssemblyRequest, 'activityType' | 'difficulty' | 'practiceMix' | 'proveMix'>): { min: number; max: number } {
  if (req.activityType === 'PROVE' && req.proveMix && req.proveMix.items.length > 0) {
    const levels = req.proveMix.items.map((i) => i.level);
    return { min: Math.max(req.difficulty.min, Math.min(...levels)), max: Math.min(req.difficulty.max, Math.max(...levels)) };
  }
  if (req.activityType !== 'PRACTICE' || !req.practiceMix || req.practiceMix.items.length === 0) return { min: req.difficulty.min, max: req.difficulty.max };
  const top = Math.max(...req.practiceMix.items.map((i) => i.level));
  return { min: req.difficulty.min, max: Math.min(req.difficulty.max, top) };
}

export function assembleFromBank(candidates: BankCandidate[], req: AssemblyRequest): AssemblyResult {
  const independent = INDEPENDENT.has(req.activityType);
  const band = admissibleBand(req);
  const eligible = candidates
    .filter((c) => c.difficulty >= band.min && c.difficulty <= band.max)
    .filter((c) => !req.excludeFingerprints.has(c.contentFingerprint))
    .filter((c) => !req.reservedCandidateIds.has(c.id))
    .filter((c) => !(independent && c.delivered))
    // P1-03: a banked item whose key is not the right option is never served (admitted before the check existed)
    .filter((c) => isDeliverableChoiceItem(c.question))
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        Number(a.c.delivered) - Number(b.c.delivered) ||
        // D76: among already-delivered items (assisted reuse), least recently delivered first
        (a.c.lastDeliveredAt ?? 0) - (b.c.lastDeliveredAt ?? 0) ||
        a.c.usageCount - b.c.usageCount ||
        Math.abs(a.c.difficulty - req.difficulty.target) - Math.abs(b.c.difficulty - req.difficulty.target) ||
        a.i - b.i,
    )
    .map((x) => x.c);
  const ordered =
    req.activityType === 'PRACTICE' && req.priorityCandidateIds && req.priorityCandidateIds.size > 0
      ? prioritiseOrder(eligible, (c) => req.priorityCandidateIds!.has(c.id), req.priorityCap ?? req.itemCount)
      : eligible;

  if (req.activityType === 'TRANSFER') {
    const picked: BankCandidate[] = [];
    for (const depth of DEPTHS) {
      const c = eligible.find((x) => x.transferDepth === depth);
      if (c) picked.push(c);
    }
    if (picked.length < DEPTHS.length) return { status: 'SHORT', available: picked.length, needed: DEPTHS.length };
    return { status: 'ASSEMBLED', questions: picked.map((c) => ({ ...c.question, transferDepth: c.transferDepth! })), candidateIds: picked.map((c) => c.id) };
  }

  if (req.activityType === 'PRACTICE' && req.practiceMix && req.practiceMix.items.length > 0) {
    return assemblePracticeMix(ordered, req, req.practiceMix);
  }
  if (req.activityType === 'PROVE' && req.proveMix && req.proveMix.items.length > 0) {
    return assembleExactLevelMix(ordered, req, req.proveMix);
  }

  const byQuestion = new Map(ordered.map((c) => [c.question, c]));
  const selection = selectDiverse(ordered.map((c) => c.question), req.itemCount, req.language);
  if (selection.kept.length < req.itemCount) return { status: 'SHORT', available: selection.kept.length, needed: req.itemCount };
  const chosen = selection.kept.slice(0, req.itemCount).map((q) => byQuestion.get(q)!);
  return { status: 'ASSEMBLED', questions: chosen.map((c) => c.question), candidateIds: chosen.map((c) => c.id) };
}

/**
 * D78 -- exact per-level selection, through the SAME diversity selector (each level's pick is
 * checked against everything already kept). The base+1 slot is filled first (it is the scarce
 * one); when no valid base+1 item exists it becomes a base slot. Base slots short of base items
 * take the nearest LOWER level in the band (never a harder one). Still short = SHORT.
 */
function assemblePracticeMix(ordered: BankCandidate[], req: AssemblyRequest, mix: DeliveryPracticeMix): AssemblyResult {
  const base = mix.baseLevel;
  const kept: BankCandidate[] = [];
  const keptIds = new Set<string>();
  const pick = (pool: BankCandidate[], n: number): number => {
    if (n <= 0) return 0;
    const free = pool.filter((c) => !keptIds.has(c.id));
    const byQuestion = new Map(free.map((c) => [c.question, c]));
    const sel = selectDiverse(free.map((c) => c.question), kept.length + n, req.language, kept.map((c) => c.question));
    const got = sel.kept.slice(0, n).map((q) => byQuestion.get(q)!);
    for (const c of got) {
      kept.push(c);
      keptIds.add(c.id);
    }
    return got.length;
  };
  let baseNeeded = mix.items.filter((i) => i.level <= base).reduce((a, i) => a + i.count, 0);
  for (const g of mix.items.filter((i) => i.level > base)) {
    baseNeeded += g.count - pick(ordered.filter((c) => c.difficulty === g.level), g.count);
  }
  baseNeeded -= pick(ordered.filter((c) => c.difficulty === base), baseNeeded);
  for (let level = base - 1; baseNeeded > 0 && level >= req.difficulty.min; level--) {
    baseNeeded -= pick(ordered.filter((c) => c.difficulty === level), baseNeeded);
  }
  if (baseNeeded > 0 || kept.length < req.itemCount) return { status: 'SHORT', available: kept.length, needed: req.itemCount };
  return { status: 'ASSEMBLED', questions: kept.map((c) => c.question), candidateIds: kept.map((c) => c.id) };
}

/**
 * D79 -- exact per-level selection for PROVE through the SAME diversity selector: the scarcer
 * (higher) level first, each pick checked against everything already kept. No fallback: any level
 * short means SHORT (never relabelled, never filled with another level).
 */
function assembleExactLevelMix(ordered: BankCandidate[], req: AssemblyRequest, mix: DeliveryLevelMix): AssemblyResult {
  const kept: BankCandidate[] = [];
  for (const g of [...mix.items].sort((a, b) => b.level - a.level)) {
    const pool = ordered.filter((c) => c.difficulty === g.level);
    const byQuestion = new Map(pool.map((c) => [c.question, c]));
    const sel = selectDiverse(pool.map((c) => c.question), kept.length + g.count, req.language, kept.map((c) => c.question));
    const got = sel.kept.slice(0, g.count).map((q) => byQuestion.get(q)!);
    kept.push(...got);
    if (got.length < g.count) return { status: 'SHORT', available: kept.length, needed: req.itemCount };
  }
  if (kept.length < req.itemCount) return { status: 'SHORT', available: kept.length, needed: req.itemCount };
  return { status: 'ASSEMBLED', questions: kept.map((c) => c.question), candidateIds: kept.map((c) => c.id) };
}

/** D78 -- why a delivered Practice set differs from its planned mix (recorded on the session, never a block). */
export type PracticeMixFallbackReason = 'PRACTICE_MIX_PLUS_ONE_UNAVAILABLE' | 'PRACTICE_MIX_BASE_FILLED_BELOW_BASE' | 'PRACTICE_MIX_LEVEL_MISMATCH';

export interface PracticeMixFallback {
  reasons: PracticeMixFallbackReason[];
  planned: Array<{ level: number; count: number }>;
  served: Array<{ level: number; count: number }>;
}

/** Pure: compares what was served (item levels) with the planned mix; null when they agree exactly. */
export function practiceMixFallback(mix: DeliveryPracticeMix | null | undefined, servedDifficulties: ReadonlyArray<number>): PracticeMixFallback | null {
  if (!mix) return null;
  const servedCounts = new Map<number, number>();
  for (const d of servedDifficulties) servedCounts.set(Math.round(d), (servedCounts.get(Math.round(d)) ?? 0) + 1);
  const served = [...servedCounts.entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level, count }));
  const planned = [...mix.items].sort((a, b) => a.level - b.level).map((i) => ({ level: i.level, count: i.count }));
  if (JSON.stringify(served) === JSON.stringify(planned)) return null;
  const reasons: PracticeMixFallbackReason[] = [];
  const plannedPlusOne = planned.filter((i) => i.level > mix.baseLevel).reduce((a, i) => a + i.count, 0);
  const servedPlusOne = served.filter((i) => i.level === mix.baseLevel + 1).reduce((a, i) => a + i.count, 0);
  if (servedPlusOne < plannedPlusOne) reasons.push('PRACTICE_MIX_PLUS_ONE_UNAVAILABLE');
  if (served.some((i) => i.level < mix.baseLevel)) reasons.push('PRACTICE_MIX_BASE_FILLED_BELOW_BASE');
  if (served.some((i) => i.level > mix.baseLevel + 1) || servedPlusOne > plannedPlusOne) reasons.push('PRACTICE_MIX_LEVEL_MISMATCH');
  if (reasons.length === 0) reasons.push('PRACTICE_MIX_LEVEL_MISMATCH');
  return { reasons, planned, served };
}

/**
 * D76 -- the bank's depth in DISTINCT VALID candidates for this request: in
 * the contract's difficulty band, not novelty-excluded, deliverable (P1-03).
 * Reservations and prior deliveries do not reduce depth (assisted activities
 * may reuse a delivered item).
 */
export function countValidCandidates(
  candidates: BankCandidate[],
  req: Pick<AssemblyRequest, 'difficulty' | 'excludeFingerprints'> & Partial<Pick<AssemblyRequest, 'activityType' | 'practiceMix' | 'proveMix'>>,
): number {
  const seen = new Set<string>();
  // D78/D79: a PRACTICE / PROVE mix narrows the band to its admissible levels
  const band = req.activityType ? admissibleBand({ activityType: req.activityType, difficulty: req.difficulty, practiceMix: req.practiceMix, proveMix: req.proveMix }) : req.difficulty;
  for (const c of candidates) {
    if (c.difficulty < band.min || c.difficulty > band.max) continue;
    if (req.excludeFingerprints.has(c.contentFingerprint)) continue;
    if (!isDeliverableChoiceItem(c.question)) continue;
    seen.add(c.contentFingerprint);
  }
  return seen.size;
}

/**
 * How many more complete, disjoint sets the pool can assemble (up to
 * `maxSets`) -- by running the real assembly repeatedly, each set reserving
 * its candidates. This is the bank's true depth.
 */
export function countAssemblableSets(candidates: BankCandidate[], req: AssemblyRequest, maxSets: number): number {
  const reserved = new Set(req.reservedCandidateIds);
  let sets = 0;
  while (sets < maxSets) {
    const r = assembleFromBank(candidates, { ...req, reservedCandidateIds: reserved });
    if (r.status !== 'ASSEMBLED') break;
    for (const id of r.candidateIds) reserved.add(id);
    sets++;
  }
  return sets;
}
