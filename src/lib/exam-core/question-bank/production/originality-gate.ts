/**
 * QB-R2A -- the originality / similarity gate (pure, no IO).
 *
 * Compares a candidate with material it is ALLOWED to be compared with and returns one of three outcomes:
 *   PASS_LOW_SIMILARITY            nothing close was found
 *   REVIEW_STRUCTURAL_SIMILARITY   the same shape as something else (a template sibling): a person decides
 *   REJECT_TEXTUAL_SIMILARITY      the wording is too close to something else
 *
 * What it compares against: the internal Question Bank, the siblings of the same generation batch, reference
 * material where the source permits it, and official / sample material where that is legally allowed. An entry
 * whose comparison is not permitted is skipped and reported as skipped: the gate never reads around a
 * restriction, and it stores no text -- its record names what was compared, by key, and a similarity number.
 *
 * The record follows the existing originality schema (`question_bank_originality_checks`): result CLEAR /
 * SIMILAR / MATCH and a disposition. This module produces the record's CONTENT; writing it happens at
 * ingestion, on the item version, never here.
 */
export const ORIGINALITY_METHOD = { method: 'studyus-shingle-similarity', version: '1' } as const;
export const ORIGINALITY_OUTCOMES = ['PASS_LOW_SIMILARITY', 'REVIEW_STRUCTURAL_SIMILARITY', 'REJECT_TEXTUAL_SIMILARITY'] as const;
export type OriginalityOutcome = (typeof ORIGINALITY_OUTCOMES)[number];

export const COMPARISON_SOURCES = ['INTERNAL_QUESTION_BANK', 'GENERATION_BATCH_SIBLING', 'REFERENCE_SOURCE', 'OFFICIAL_OR_SAMPLE_MATERIAL'] as const;
export type ComparisonSource = (typeof COMPARISON_SOURCES)[number];

export interface ComparisonEntry {
  source: ComparisonSource;
  /** Identity of the compared material (item key, candidate key, source key + locator). Kept in the record. */
  key: string;
  /** May this material be compared against? false = not licensed / not allowed: it is skipped, never read. */
  comparisonPermitted: boolean;
  /** The text to compare. Absent when the comparison is not permitted. Never stored by the gate. */
  text?: string;
  /** Shape of the question with its surface details removed (the bank's template fingerprint). */
  templateFingerprint?: string | null;
}

export interface OriginalityThresholds {
  /** Textual similarity at or above this is a rejection. */
  rejectTextual: number;
  /** Textual similarity at or above this (and below rejection) goes to a person. */
  reviewTextual: number;
}
export const DEFAULT_ORIGINALITY_THRESHOLDS: OriginalityThresholds = { rejectTextual: 0.8, reviewTextual: 0.5 };

export interface OriginalityGateResult {
  outcome: OriginalityOutcome;
  maxSimilarity: number;
  closest: { source: ComparisonSource; key: string; similarity: number; sameTemplate: boolean } | null;
  comparedAgainst: string[];
  skippedNotPermitted: string[];
  /** The content of the originality record, in the existing schema's vocabulary. `disposition: null` = a person must decide. */
  record: { method: string; methodVersion: string; comparedAgainst: string[]; result: 'CLEAR' | 'SIMILAR' | 'MATCH'; maxSimilarity: number; performedByKind: 'SYSTEM'; disposition: 'ACCEPTED' | 'REJECTED' | null };
}

const tokens = (s: string): string[] => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function shingles(s: string, n = 3): Set<string> {
  const t = tokens(s);
  const out = new Set<string>();
  if (t.length < n) {
    if (t.length) out.add(t.join(' '));
    return out;
  }
  for (let i = 0; i + n <= t.length; i += 1) out.add(t.slice(i, i + n).join(' '));
  return out;
}

/** Jaccard similarity of word 3-shingles, in [0, 1]. Deterministic. */
export function textualSimilarity(a: string, b: string): number {
  const x = shingles(a);
  const y = shingles(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const s of x) if (y.has(s)) both += 1;
  return both / (x.size + y.size - both);
}

export function evaluateOriginality(candidate: { text: string; templateFingerprint?: string | null }, corpus: readonly ComparisonEntry[], thresholds: OriginalityThresholds = DEFAULT_ORIGINALITY_THRESHOLDS): OriginalityGateResult {
  const comparedAgainst: string[] = [];
  const skippedNotPermitted: string[] = [];
  let closest: OriginalityGateResult['closest'] = null;
  let structural = false;
  for (const e of [...corpus].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const label = `${e.source}:${e.key}`;
    if (!e.comparisonPermitted || e.text === undefined) {
      skippedNotPermitted.push(label);
      continue;
    }
    comparedAgainst.push(label);
    const similarity = textualSimilarity(candidate.text, e.text);
    const sameTemplate = !!candidate.templateFingerprint && candidate.templateFingerprint === (e.templateFingerprint ?? null);
    if (sameTemplate) structural = true;
    if (!closest || similarity > closest.similarity || (similarity === closest.similarity && sameTemplate && !closest.sameTemplate)) closest = { source: e.source, key: e.key, similarity, sameTemplate };
  }
  const maxSimilarity = closest ? Math.round(closest.similarity * 1000) / 1000 : 0;
  const outcome: OriginalityOutcome = maxSimilarity >= thresholds.rejectTextual ? 'REJECT_TEXTUAL_SIMILARITY' : maxSimilarity >= thresholds.reviewTextual || structural ? 'REVIEW_STRUCTURAL_SIMILARITY' : 'PASS_LOW_SIMILARITY';
  const result = outcome === 'PASS_LOW_SIMILARITY' ? 'CLEAR' : outcome === 'REJECT_TEXTUAL_SIMILARITY' ? 'MATCH' : 'SIMILAR';
  // A match is never accepted (the schema refuses it too); a similarity is for a person; a clear result is accepted.
  const disposition = outcome === 'PASS_LOW_SIMILARITY' ? 'ACCEPTED' : outcome === 'REJECT_TEXTUAL_SIMILARITY' ? 'REJECTED' : null;
  return { outcome, maxSimilarity, closest, comparedAgainst, skippedNotPermitted, record: { method: ORIGINALITY_METHOD.method, methodVersion: ORIGINALITY_METHOD.version, comparedAgainst, result, maxSimilarity, performedByKind: 'SYSTEM', disposition } };
}
