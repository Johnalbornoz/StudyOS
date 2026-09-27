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
 *  - an incomplete set is never returned: SHORT means "not enough".
 */
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { selectDiverse } from '@/lib/lx/question-diversity';
import type { DeliveryActivityType } from './contract';

export interface BankCandidate {
  id: string;
  question: GeneratedQuestion;
  difficulty: number;
  contentFingerprint: string;
  transferDepth: 'NEAR' | 'CONTEXTUAL' | 'HIGHER' | null;
  usageCount: number;
  /** Already delivered to this learner in some session. */
  delivered: boolean;
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
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        Number(a.c.delivered) - Number(b.c.delivered) ||
        a.c.usageCount - b.c.usageCount ||
        Math.abs(a.c.difficulty - req.difficulty.target) - Math.abs(b.c.difficulty - req.difficulty.target) ||
        a.i - b.i,
    )
    .map((x) => x.c);

  if (req.activityType === 'TRANSFER') {
    const picked: BankCandidate[] = [];
    for (const depth of DEPTHS) {
      const c = eligible.find((x) => x.transferDepth === depth);
      if (c) picked.push(c);
    }
    if (picked.length < DEPTHS.length) return { status: 'SHORT', available: picked.length, needed: DEPTHS.length };
    return { status: 'ASSEMBLED', questions: picked.map((c) => ({ ...c.question, transferDepth: c.transferDepth! })), candidateIds: picked.map((c) => c.id) };
  }

  const byQuestion = new Map(eligible.map((c) => [c.question, c]));
  const selection = selectDiverse(eligible.map((c) => c.question), req.itemCount, req.language);
  if (selection.kept.length < req.itemCount) return { status: 'SHORT', available: selection.kept.length, needed: req.itemCount };
  const chosen = selection.kept.slice(0, req.itemCount).map((q) => byQuestion.get(q)!);
  return { status: 'ASSEMBLED', questions: chosen.map((c) => c.question), candidateIds: chosen.map((c) => c.id) };
}
