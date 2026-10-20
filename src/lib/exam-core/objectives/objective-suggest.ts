/**
 * Micro-delta M04 -- typeahead suggestions for the exam catalogue search (pure; no I/O).
 *
 * From 2 characters, the search offers what the text could mean, from the catalogue itself:
 *   FAMILY     an awarding-body family (Cambridge International)
 *   FRAMEWORK  an exam / programme (IB Diploma Programme, PAA, Cambridge IGCSE)
 *   SUBJECT    a canonical subject (Matemáticas -- every variant of it)
 *   VARIANT    a course (Matemáticas: Análisis y Enfoques), followed by
 *   OPTION     its levels (Nivel Medio, Nivel Superior) -- the thing the Student actually adds
 * Syllabus codes match too ("9709"). Suggestions match by WORD PREFIX (so "ana" offers "Análisis", not
 * "Management"); the search itself is unchanged and still filters by substring when suggestions are ignored.
 *
 * A suggestion never selects or adds anything: applying it only sets the picker's own filter
 * (family / framework / query), which shows the canonical result and opens its group.
 */
export type SuggestionKind = 'FAMILY' | 'FRAMEWORK' | 'SUBJECT' | 'VARIANT' | 'OPTION';

export interface SuggestionApply { family?: string; framework?: string; query?: string }

export interface ObjectiveSuggestion {
  id: string;
  kind: SuggestionKind;
  label: string;
  /** Secondary text (the programme a course belongs to, a count, ...). */
  detail: string | null;
  /** 1 = a level listed under its course. */
  depth: 0 | 1;
  apply: SuggestionApply;
}

export interface SuggestObjective {
  key: string;
  framework: string;
  label: string;
  subjectLabel?: string | null;
  levelLabel?: string | null;
  groupKey?: string | null;
  groupLabel?: string | null;
  searchText: string;
  syllabusCode?: string | null;
}

export const SUGGEST_MIN_CHARS = 2;

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Search tokens: accent-insensitive, punctuation-free ("Matemáticas: Análisis" -> ["matematicas", "analisis"]). */
export function searchTokens(query: string): string[] {
  return strip(query).split(/[^a-z0-9]+/).filter(Boolean);
}
const words = (text: string) => searchTokens(text);
/** Every token is the prefix of some word of the text. */
const prefixMatch = (text: string, tokens: string[]) => {
  const w = words(text);
  return tokens.every((t) => w.some((x) => x.startsWith(t)));
};

export function objectiveSuggestions(input: {
  query: string;
  objectives: readonly SuggestObjective[];
  frameworks: ReadonlyArray<{ key: string; family?: string | null }>;
  frameworkName: (key: string) => string;
  familyName: (key: string) => string;
  optionsText?: (n: number) => string;
  limit?: number;
}): ObjectiveSuggestion[] {
  const tokens = searchTokens(input.query);
  if (tokens.join('').length < SUGGEST_MIN_CHARS) return [];
  const limit = input.limit ?? 8;
  const present = new Set(input.objectives.map((o) => o.framework));
  const out: ObjectiveSuggestion[] = [];

  // Exam family, then exam / programme.
  const families = [...new Set(input.frameworks.filter((f) => f.family && present.has(f.key)).map((f) => f.family as string))];
  for (const fam of families) {
    const members = input.frameworks.filter((f) => f.family === fam && present.has(f.key));
    if (members.length > 1 && prefixMatch(input.familyName(fam), tokens)) out.push({ id: `family:${fam}`, kind: 'FAMILY', label: input.familyName(fam), detail: null, depth: 0, apply: { family: fam } });
  }
  for (const f of input.frameworks) {
    if (present.has(f.key) && prefixMatch(input.frameworkName(f.key), tokens)) out.push({ id: `framework:${f.key}`, kind: 'FRAMEWORK', label: input.frameworkName(f.key), detail: null, depth: 0, apply: { framework: f.key } });
  }

  // Canonical subject (all its variants, across programmes).
  const groups = new Map<string, { label: string; n: number }>();
  for (const o of input.objectives) {
    if (!o.groupKey || !o.groupLabel) continue;
    const g = groups.get(o.groupKey) ?? { label: o.groupLabel, n: 0 };
    g.n += 1;
    groups.set(o.groupKey, g);
  }
  for (const [key, g] of groups) {
    if (g.n > 1 && prefixMatch(g.label, tokens)) out.push({ id: `subject:${key}`, kind: 'SUBJECT', label: g.label, detail: input.optionsText ? input.optionsText(g.n) : null, depth: 0, apply: { query: g.label } });
  }

  // Course (variant) with its levels. A course is offered when its name, a level, or its syllabus code matches.
  const variants = new Map<string, { framework: string; label: string; options: SuggestObjective[]; nameHit: boolean }>();
  for (const o of input.objectives) {
    const name = o.subjectLabel ?? o.label;
    const text = `${name} ${o.levelLabel ?? ''} ${o.syllabusCode ?? ''} ${o.label}`;
    if (!prefixMatch(text, tokens)) continue;
    const id = `${o.framework}|${name}`;
    const v = variants.get(id) ?? { framework: o.framework, label: name, options: [], nameHit: prefixMatch(name, tokens) };
    v.options.push(o);
    variants.set(id, v);
  }
  const ordered = [...variants.values()].sort((a, b) => Number(b.nameHit) - Number(a.nameHit));
  for (const v of ordered) {
    if (out.length >= limit) break;
    // A test (PAA, PISA) is already offered as its exam; do not repeat it as a "course".
    if (v.options.length === 1 && !v.options[0].levelLabel && out.some((s) => s.kind === 'FRAMEWORK' && s.apply.framework === v.framework)) continue;
    out.push({ id: `variant:${v.framework}:${v.label}`, kind: 'VARIANT', label: v.label, detail: input.frameworkName(v.framework), depth: 0, apply: { framework: v.framework, query: v.label } });
    for (const o of v.options) {
      if (!o.levelLabel) continue;
      out.push({ id: `option:${o.key}`, kind: 'OPTION', label: o.levelLabel, detail: null, depth: 1, apply: { framework: v.framework, query: o.label } });
    }
  }
  return out;
}

export interface SuggestKeyState { open: boolean; active: number }

/**
 * Keyboard model of the suggestion list (WAI-ARIA combobox with a listbox popup):
 *   ArrowDown / ArrowUp  move through the suggestions (wrapping), opening the list if needed;
 *   Enter                chooses the active suggestion; with none active it is NOT handled, so the
 *                        typed search simply stays as it is;
 *   Escape               closes the list (the typed text is kept).
 */
export function suggestionKey(state: SuggestKeyState, key: string, count: number): SuggestKeyState & { select: number | null; handled: boolean } {
  if (count === 0) return { ...state, open: false, active: -1, select: null, handled: false };
  if (key === 'ArrowDown') return { open: true, active: state.open ? (state.active + 1) % count : 0, select: null, handled: true };
  if (key === 'ArrowUp') return { open: true, active: state.open && state.active > 0 ? state.active - 1 : count - 1, select: null, handled: true };
  if (key === 'Enter') return state.open && state.active >= 0 ? { open: false, active: -1, select: state.active, handled: true } : { ...state, select: null, handled: false };
  if (key === 'Escape') return state.open ? { open: false, active: -1, select: null, handled: true } : { ...state, select: null, handled: false };
  return { ...state, select: null, handled: false };
}
