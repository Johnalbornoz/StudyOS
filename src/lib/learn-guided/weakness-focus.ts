/**
 * LEARN -> PRACTICE weakness focus (approved requirement §22). PURE: no IO, no model.
 *
 * The weaknesses (learner-safe strings) and canonical misconception ids a guided LEARN session detected
 * (contract 1.1: `learning_evidence.metadata.learnSession`) reach the concept's PRACTICE on EVERY supply path:
 *
 *   LIVE_PROMPT     live generation       -> appended to the generation guidance (policy.practiceGuidanceWithLearnWeaknesses)
 *   BANK_PRIORITY   validated bank        -> matching items are PRIORITISED in the deterministic assembly order
 *   CACHE_PRIORITY  READY prepared set    -> prioritised when it was assembled; the match is re-measured at consumption
 *
 * Whatever the path, the session records `learnWeaknessProvenance` so the carry-over is auditable, also when no
 * item could be matched (`matchedItemIds: []`: the weakness was considered).
 *
 * Learning supply ONLY: never an input of a standardized Exam Prep supply, never of an independent check
 * (Prove / Retain / Transfer): those activities are untouched.
 */
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { LEARN_GUIDED_VERSION, LEARN_MAX_WEAKNESSES, weaknessesFromEvidenceMetadata } from './policy';

export const LEARN_WEAKNESS_PROVENANCE_VERSION = 'learn-weakness-provenance-v1' as const;
/** How many of the latest LEARN sessions of a concept are read (the latest one is the authority). */
export const LEARN_FOCUS_MAX_SESSIONS = 1;
export const LEARN_FOCUS_MAX_MISCONCEPTION_IDS = 10;

export type LearnWeaknessAppliedVia = 'LIVE_PROMPT' | 'BANK_PRIORITY' | 'CACHE_PRIORITY';

export interface LearnWeaknessFocus {
  /** The LEARN_GUIDED learning_evidence row(s) the focus was read from. */
  learnEvidenceIds: string[];
  weaknesses: string[];
  misconceptionIds: string[];
}

export interface LearnWeaknessProvenance extends LearnWeaknessFocus {
  version: typeof LEARN_WEAKNESS_PROVENANCE_VERSION;
  appliedVia: LearnWeaknessAppliedVia;
  /** Delivered items that address a weakness / misconception (bank candidate ids, or question ids for a live set). */
  matchedItemIds: string[];
}

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Reads `metadata.learnSession.misconceptionIds` defensively. */
export function misconceptionIdsFromEvidenceMetadata(metadata: unknown): string[] {
  const m = typeof metadata === 'string' ? safeParse(metadata) : metadata;
  const ls = m && typeof m === 'object' ? (m as { learnSession?: unknown }).learnSession : null;
  if (!ls || typeof ls !== 'object' || (ls as { version?: unknown }).version !== LEARN_GUIDED_VERSION) return [];
  const ids = (ls as { misconceptionIds?: unknown }).misconceptionIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
}

/** The focus of the latest LEARN session row(s), newest first. `null` when nothing was detected. */
export function focusFromEvidenceRows(rows: ReadonlyArray<{ id?: unknown; metadata: unknown }>): LearnWeaknessFocus | null {
  const weaknesses: string[] = [];
  const seenW = new Set<string>();
  const misconceptionIds: string[] = [];
  const learnEvidenceIds: string[] = [];
  for (const row of rows.slice(0, LEARN_FOCUS_MAX_SESSIONS)) {
    const w = weaknessesFromEvidenceMetadata(row.metadata);
    const m = misconceptionIdsFromEvidenceMetadata(row.metadata);
    if (w.length === 0 && m.length === 0) continue;
    if (row.id != null) learnEvidenceIds.push(String(row.id));
    for (const x of w) {
      const k = x.toLowerCase();
      if (seenW.has(k) || weaknesses.length >= LEARN_MAX_WEAKNESSES) continue;
      seenW.add(k);
      weaknesses.push(x);
    }
    for (const x of m) if (!misconceptionIds.includes(x) && misconceptionIds.length < LEARN_FOCUS_MAX_MISCONCEPTION_IDS) misconceptionIds.push(x);
  }
  return weaknesses.length === 0 && misconceptionIds.length === 0 ? null : { learnEvidenceIds, weaknesses, misconceptionIds };
}

/* ---------------------------------------------------------------- matching ---------------------------------------------------------------- */

const STOPWORDS = new Set([
  // es
  'para', 'como', 'cuando', 'donde', 'entre', 'sobre', 'pero', 'porque', 'esta', 'este', 'estos', 'estas', 'esto', 'eso', 'cual', 'cuales',
  'que', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'con', 'sin', 'por', 'sus', 'mas', 'muy', 'todo', 'toda', 'todos', 'todas', 'tiene',
  'tienen', 'confunde', 'confundir', 'confusion', 'olvida', 'olvidar', 'error', 'errores', 'estudiante', 'alumno', 'idea', 'ideas', 'concepto',
  'aplica', 'aplicar', 'entiende', 'entender', 'sabe', 'saber', 'hace', 'hacer', 'cree', 'creer', 'piensa', 'pensar', 'usar', 'usa',
  // en
  'that', 'this', 'these', 'those', 'with', 'without', 'from', 'into', 'when', 'where', 'which', 'what', 'their', 'there', 'about', 'between',
  'confuses', 'confuse', 'confusion', 'forgets', 'forget', 'mistake', 'mistakes', 'student', 'concept', 'thinks', 'think', 'uses', 'using',
  'does', 'doesn', 'have', 'has', 'than', 'then', 'they', 'them', 'also', 'only',
]);

/** Content words: lower-case, accent-free, >= 4 characters, no stop words. Deterministic. */
export function contentTokens(text: string): Set<string> {
  const norm = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return new Set(norm.split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t)));
}

function questionText(q: GeneratedQuestion): string {
  const parts: string[] = [q.question ?? '', q.blankTemplate ?? '', q.explanation ?? ''];
  for (const o of q.options ?? []) parts.push(o?.text ?? '');
  for (const p of q.matchingPairs ?? []) parts.push(p.left, p.right);
  for (const i of q.orderingItems ?? []) parts.push(i);
  for (const c of q.classificationItems ?? []) parts.push(c.item, c.category);
  return parts.join(' ');
}

/** A misconception tag an item may carry (bank `misconception_target`, generator `misconceptionTarget` / `misconceptionId`). */
function misconceptionTagOf(q: GeneratedQuestion): string | null {
  const x = q as unknown as { misconceptionTarget?: unknown; misconceptionId?: unknown };
  const tag = typeof x.misconceptionTarget === 'string' ? x.misconceptionTarget : typeof x.misconceptionId === 'string' ? x.misconceptionId : null;
  return tag && tag.trim() ? tag.trim() : null;
}

/**
 * Does this item address the LEARN focus? (1) its misconception tag is one of the session's misconception ids, or
 * (2) its text shares the content words of a weakness: at least 2 (or every one, for a weakness with fewer).
 */
export function questionMatchesLearnFocus(q: GeneratedQuestion, focus: LearnWeaknessFocus): boolean {
  const tag = misconceptionTagOf(q);
  if (tag && focus.misconceptionIds.includes(tag)) return true;
  if (focus.weaknesses.length === 0) return false;
  const qTokens = contentTokens(questionText(q));
  for (const w of focus.weaknesses) {
    const wTokens = [...contentTokens(w)];
    if (wTokens.length === 0) continue;
    const shared = wTokens.filter((t) => qTokens.has(t)).length;
    if (shared >= Math.min(2, wTokens.length)) return true;
  }
  return false;
}

/** Ids of the items that address the focus, in input order. */
export function matchLearnFocusItems(items: ReadonlyArray<{ id: string; question: GeneratedQuestion }>, focus: LearnWeaknessFocus): string[] {
  return items.filter((i) => questionMatchesLearnFocus(i.question, focus)).map((i) => i.id);
}

/** At most half the set (rounded up) is brought forward, so the rest of the concept keeps its coverage. */
export const learnFocusPriorityCap = (itemCount: number): number => Math.max(1, Math.ceil(itemCount / 2));

/**
 * Deterministic re-order: up to `cap` prioritised items move to the front (keeping their relative order), every
 * other item keeps its place after them. Nothing is added or removed, so filters, counts and dedup are untouched.
 */
export function prioritiseOrder<T>(ordered: ReadonlyArray<T>, isPriority: (x: T) => boolean, cap: number): T[] {
  const front: T[] = [];
  const rest: T[] = [];
  for (const x of ordered) {
    if (front.length < cap && isPriority(x)) front.push(x);
    else rest.push(x);
  }
  return [...front, ...rest];
}

export function buildLearnWeaknessProvenance(focus: LearnWeaknessFocus, appliedVia: LearnWeaknessAppliedVia, matchedItemIds: ReadonlyArray<string>): LearnWeaknessProvenance {
  return {
    version: LEARN_WEAKNESS_PROVENANCE_VERSION,
    learnEvidenceIds: [...focus.learnEvidenceIds],
    weaknesses: [...focus.weaknesses],
    misconceptionIds: [...focus.misconceptionIds],
    appliedVia,
    matchedItemIds: [...new Set(matchedItemIds)],
  };
}
