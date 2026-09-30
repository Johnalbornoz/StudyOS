/**
 * UX-4 -- "Tu conocimiento": the Student-facing knowledge states.
 *
 * A pure lookup from the AUTHORITATIVE per-concept journey (path-view.ts
 * `resolveConceptJourneyResultAuthoritative`: the fresh canonical decision
 * when the engine gate is on) plus the hierarchy's own `hasEvidence`
 * existence flag. No score, count, threshold or recency is read; no stage
 * is chosen here. This is presentation, not a knowledge engine.
 *
 *   consolidated                     -> MASTERED      "Dominado"
 *   REINFORCE intervention           -> ATTENTION     "Necesita atención"
 *   stage RETAIN / TRANSFER          -> DEMONSTRATED  "Demostrado" (PROVE is satisfied)
 *   stage LEARN with no evidence     -> NOT_STARTED   "Por trabajar"
 *   any other stage                  -> IN_PROGRESS   "En progreso"
 */
import type { MessageKey } from '@/lib/i18n/messages';

export const KNOWLEDGE_STATES = ['MASTERED', 'DEMONSTRATED', 'IN_PROGRESS', 'ATTENTION', 'NOT_STARTED'] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export interface KnowledgeJourneyInput {
  /** ConceptJourney.currentStage: LEARN | PRACTICE | PROVE | RETAIN | TRANSFER | CONSOLIDATED */
  currentStage: string;
  consolidated: boolean;
  intervention: 'REINFORCE' | null;
}

export function knowledgeStateOf(journey: KnowledgeJourneyInput, hasEvidence: boolean): KnowledgeState {
  if (journey.consolidated) return 'MASTERED';
  if (journey.intervention === 'REINFORCE') return 'ATTENTION';
  if (journey.currentStage === 'RETAIN' || journey.currentStage === 'TRANSFER') return 'DEMONSTRATED';
  if (journey.currentStage === 'LEARN' && !hasEvidence) return 'NOT_STARTED';
  return 'IN_PROGRESS';
}

type StateKey = `kn.state.${KnowledgeState}`;
const _everyStateHasCopy: StateKey extends MessageKey ? true : never = true;
void _everyStateHasCopy;
export const knowledgeStateKey = (s: KnowledgeState) => `kn.state.${s}` as const;

/**
 * One sentence saying what the state means for this concept. Keyed by the
 * authoritative stage, so it states only what that stage already implies
 * (e.g. RETAIN => PROVE is satisfied).
 */
export type KnowledgeMeaning = 'MASTERED' | 'ATTENTION' | 'NOT_STARTED' | 'LEARN' | 'PRACTICE' | 'PROVE' | 'RETAIN' | 'TRANSFER';
export function knowledgeMeaningOf(journey: KnowledgeJourneyInput, hasEvidence: boolean): KnowledgeMeaning {
  const state = knowledgeStateOf(journey, hasEvidence);
  if (state === 'MASTERED' || state === 'ATTENTION' || state === 'NOT_STARTED') return state;
  const stage = journey.currentStage;
  return stage === 'PRACTICE' || stage === 'PROVE' || stage === 'RETAIN' || stage === 'TRANSFER' ? stage : 'LEARN';
}
type MeaningKey = `kn.meaning.${KnowledgeMeaning}`;
const _everyMeaningHasCopy: MeaningKey extends MessageKey ? true : never = true;
void _everyMeaningHasCopy;
export const knowledgeMeaningKey = (m: KnowledgeMeaning) => `kn.meaning.${m}` as const;

export type KnowledgeCounts = Record<KnowledgeState, number>;
export function countKnowledgeStates(states: readonly KnowledgeState[]): KnowledgeCounts {
  const counts: KnowledgeCounts = { MASTERED: 0, DEMONSTRATED: 0, IN_PROGRESS: 0, ATTENTION: 0, NOT_STARTED: 0 };
  for (const s of states) counts[s] += 1;
  return counts;
}
