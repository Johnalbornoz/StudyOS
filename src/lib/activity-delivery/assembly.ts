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
import type { DeliveryActivityType } from './contract';
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
}

export type AssemblyResult =
  | { status: 'ASSEMBLED'; questions: GeneratedQuestion[]; candidateIds: string[] }
  | { status: 'SHORT'; available: number; needed: number };

const INDEPENDENT: ReadonlySet<DeliveryActivityType> = new Set(['PROVE', 'RETAIN', 'TRANSFER']);

/** Independent checks never re-deliver an item the learner has already been given. */
export const isIndependentActivity = (activityType: DeliveryActivityType): boolean => INDEPENDENT.has(activityType);
const DEPTHS = ['NEAR', 'CONTEXTUAL', 'HIGHER'] as const;

export function assembleFromBank(candidates: BankCandidate[], req: AssemblyRequest): AssemblyResult {
  const independent = INDEPENDENT.has(req.activityType);
  const eligible = candidates
    .filter((c) => c.difficulty >= req.difficulty.min && c.difficulty <= req.difficulty.max)
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

  const byQuestion = new Map(ordered.map((c) => [c.question, c]));
  const selection = selectDiverse(ordered.map((c) => c.question), req.itemCount, req.language);
  if (selection.kept.length < req.itemCount) return { status: 'SHORT', available: selection.kept.length, needed: req.itemCount };
  const chosen = selection.kept.slice(0, req.itemCount).map((q) => byQuestion.get(q)!);
  return { status: 'ASSEMBLED', questions: chosen.map((c) => c.question), candidateIds: chosen.map((c) => c.id) };
}

/**
 * D76 -- the bank's depth in DISTINCT VALID candidates for this request: in
 * the contract's difficulty band, not novelty-excluded, deliverable (P1-03).
 * Reservations and prior deliveries do not reduce depth (assisted activities
 * may reuse a delivered item).
 */
export function countValidCandidates(candidates: BankCandidate[], req: Pick<AssemblyRequest, 'difficulty' | 'excludeFingerprints'>): number {
  const seen = new Set<string>();
  for (const c of candidates) {
    if (c.difficulty < req.difficulty.min || c.difficulty > req.difficulty.max) continue;
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
