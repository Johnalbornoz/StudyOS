/**
 * Question Factory V5 -- the batch engine. It turns one model-call function into the pipeline's stage providers,
 * runs a batch of specifications through all eleven stages, and accounts for every call.
 *
 * No network and no key here: `ModelCall` is injected (a live transport in live.ts, a stub in tests).
 */
import { profileById } from '../../../src/lib/exam-core/question-bank/production/v5/generation-profile';
import { learnerText, type CandidateItem, type GenerationSpecification } from '../../../src/lib/exam-core/question-bank/production/v5/item';
import { runSpecification, type SpecificationOutcome, type StageProviders } from '../../../src/lib/exam-core/question-bank/production/v5/pipeline';
import { authoringPrompt, constructPrompt, difficultyPrompt, distractorPrompt, equivalencePrompt, parseAuthored, parseConstruct, parseDifficulty, parseDistractors, parseEquivalence, parseSolver, solverPrompt, type Rendered, type ReplyKind } from '../../../src/lib/exam-core/question-bank/production/v5/prompts';
import type { CorpusEntry } from '../../../src/lib/exam-core/question-bank/production/v5/deterministic-stages';

export type ModelRole = 'AUTHOR' | 'SOLVER' | 'JUDGE';
export interface ModelReply { text: string; inputTokens: number; outputTokens: number }
export type ModelCall = (role: ModelRole, prompt: Rendered, reply: ReplyKind | 'ITEM') => Promise<ModelReply>;

export interface CallCount { calls: number; succeeded: number; failed: number; inputTokens: number; outputTokens: number }
export type CallAccount = Record<ModelRole, CallCount>;
export const emptyAccount = (): CallAccount => ({ AUTHOR: { calls: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 }, SOLVER: { calls: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 }, JUDGE: { calls: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 } });

/** Calls per specification in the worst case: two attempts, each one authoring call and five validation calls. */
export const WORST_CASE_CALLS = { AUTHOR: 2, SOLVER: 4, JUDGE: 6 } as const;

function counted(call: ModelCall, account: CallAccount): ModelCall {
  return async (role, prompt, kind) => {
    account[role].calls += 1;
    try {
      const reply = await call(role, prompt, kind);
      account[role].succeeded += 1; account[role].inputTokens += reply.inputTokens; account[role].outputTokens += reply.outputTokens;
      return reply;
    } catch (e) { account[role].failed += 1; throw e; }
  };
}

export function modelStages(call: ModelCall): StageProviders {
  return {
    solve: async (i) => parseSolver((await call('SOLVER', solverPrompt(i), 'SOLVER')).text),
    adjudicateEquivalence: async (i) => parseEquivalence((await call('SOLVER', equivalencePrompt(i), 'EQUIVALENCE')).text),
    judgeConstruct: async (i) => parseConstruct((await call('JUDGE', constructPrompt(i), 'CONSTRUCT')).text),
    calibrateDifficulty: async (i) => parseDifficulty((await call('JUDGE', difficultyPrompt(i), 'DIFFICULTY')).text),
    judgeDistractors: async (i) => parseDistractors((await call('JUDGE', distractorPrompt(i), 'DISTRACTORS')).text),
  };
}

export interface BatchResult { outcomes: SpecificationOutcome[]; account: CallAccount; accepted: CandidateItem[] }

/**
 * One batch, in order. Each accepted or review-bound item joins the corpus before the next specification is
 * validated, so siblings of one batch cannot duplicate each other.
 */
export async function runBatch(specs: readonly GenerationSpecification[], call: ModelCall, corpus: readonly CorpusEntry[]): Promise<BatchResult> {
  const account = emptyAccount();
  const c = counted(call, account);
  const stages = modelStages(c);
  const live: CorpusEntry[] = [...corpus];
  const outcomes: SpecificationOutcome[] = [];
  const accepted: CandidateItem[] = [];
  for (const spec of specs) {
    const profile = profileById(spec.profileId);
    if (!profile) throw new Error(`UNKNOWN_PROFILE: ${spec.profileId}`);
    const outcome = await runSpecification(spec, profile, async (s, previousFailure) => parseAuthored((await c('AUTHOR', authoringPrompt(s, profile, previousFailure), 'ITEM')).text), { stages, corpus: live });
    outcomes.push(outcome);
    const item = outcome.final.item;
    if (item && outcome.final.record.reviewDecision !== 'AUTO_REJECT') live.push({ id: item.itemId, source: 'THIS_BATCH', text: learnerText(item) });
    if (item && outcome.final.record.reviewDecision === 'AUTO_APPROVE') accepted.push(item);
  }
  return { outcomes, account, accepted };
}
