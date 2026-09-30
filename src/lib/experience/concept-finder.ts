/**
 * UX-5 closure -- resolving what a Student types to concepts that ALREADY
 * exist. Deterministic token matching over the concept label and its
 * topic (accent/case-insensitive, short function words ignored). No model,
 * no fuzzy auto-pick: every result is an existing concept the Student can
 * open; nothing here creates anything.
 */
import { normalizeName } from './subject-catalog';

export interface FinderConcept {
  id: string;
  title: string;
  topic: string | null;
  subjectId: string;
  subjectName: string;
}

const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'un', 'una', 'con', 'por', 'para', 'a', 'al',
  'the', 'of', 'and', 'or', 'in', 'to', 'an', 'der', 'die', 'das', 'und', 'von', 'le', 'les', 'des', 'et', 'du', 'da', 'do', 'dos', 'das',
]);

export function tokens(v: string): string[] {
  return normalizeName(v)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Same concept by label (normalized), used to never re-propose an existing concept as new. */
export function isSameConcept(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

/**
 * Existing concepts matching the query, best first: more query tokens
 * found (as a word prefix) in label + topic, then the preferred subject.
 */
export function matchConcepts(query: string, concepts: readonly FinderConcept[], preferSubjectId: string): FinderConcept[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  const scored = concepts
    .map((c) => {
      const words = tokens(`${c.title} ${c.topic ?? ''}`);
      const hits = q.filter((qt) => words.some((w) => w.startsWith(qt) || qt.startsWith(w))).length;
      return { c, hits };
    })
    .filter((s) => s.hits > 0 && s.hits >= Math.ceil(q.length / 2));
  scored.sort(
    (a, b) => b.hits - a.hits || Number(b.c.subjectId === preferSubjectId) - Number(a.c.subjectId === preferSubjectId) || a.c.title.localeCompare(b.c.title),
  );
  return scored.map((s) => s.c);
}
