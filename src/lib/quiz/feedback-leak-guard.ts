/**
 * Non-revealing immediate feedback (assisted activities, e.g. LEARN_CHECK).
 *
 * Immediate feedback must explain why the learner's answer does not work and
 * point to the principle -- never hand over the answer. Only the activity's
 * final review may show the full solution. This guard removes every sentence
 * that reveals the answer key, whatever produced it (AI grader, hint model):
 *
 *  - explicit reveal phrasing ("the correct statement is...", "la respuesta
 *    correcta es...", "should be...", "option B is correct"...);
 *  - the correct option's text (choice formats) or letter;
 *  - the answer key itself (free text), verbatim or as a near-paraphrase
 *    (most of its content words);
 *  - a near-reproduction of the stored solution/explanation.
 *
 * Pure. Conservative by design: dropping a harmless sentence is acceptable,
 * leaking the answer is not.
 */
export interface LeakGuardQuestion {
  answerFormat?: string;
  correctAnswer?: string | null;
  options?: Array<{ id: string; text: string }>;
  explanation?: string | null;
}

const REVEAL_PHRASES: RegExp[] = [
  /\bcorrect (answer|option|choice|statement|response|definition)\b/i,
  /\b(the )?answer (is|was|would be)\b/i,
  /\bshould (be|have been|read|say)\b/i,
  /\bthe right (answer|option|choice)\b/i,
  /\b(respuesta|opci[oó]n|afirmaci[oó]n|definici[oó]n) correcta\b/i,
  /\bla respuesta (es|era|ser[ií]a)\b/i,
  /\bdeber[ií]a (ser|haber sido|decir)\b/i,
  /\b(bonne|correcte) r[ée]ponse\b/i,
  /\brichtige antwort\b/i,
  /\bresposta correta\b/i,
];

const STOP = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'are', 'for', 'its', 'is', 'of', 'a', 'an', 'to', 'in', 'on', 'or', 'be', 'as', 'by',
  'el', 'la', 'los', 'las', 'que', 'con', 'del', 'por', 'una', 'uno', 'para', 'son', 'es', 'de', 'y', 'o', 'en', 'se', 'su',
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\\[a-z]+/g, (m) => m.slice(1)) // \theta -> theta
    .replace(/[^a-z0-9θπ+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentTokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Share of `key`'s content tokens present in `text` (0..1). */
function coverage(text: string, key: string): number {
  const keyTokens = [...new Set(contentTokens(key))];
  if (keyTokens.length === 0) return 0;
  const textTokens = new Set(contentTokens(text));
  return keyTokens.filter((t) => textTokens.has(t)).length / keyTokens.length;
}

function correctOptions(q: LeakGuardQuestion): Array<{ letter: string; text: string }> {
  if (!q.options || !q.correctAnswer) return [];
  const ids = new Set(q.correctAnswer.split(',').map((s) => s.trim()).filter(Boolean));
  return q.options
    .map((o, i) => ({ id: o.id, letter: String.fromCharCode(65 + i), text: o.text }))
    .filter((o) => ids.has(o.id))
    .map(({ letter, text }) => ({ letter, text }));
}

/** True when this single sentence reveals the answer key. */
export function sentenceRevealsAnswer(sentence: string, q: LeakGuardQuestion): boolean {
  if (REVEAL_PHRASES.some((re) => re.test(sentence))) return true;
  const n = normalize(sentence);

  for (const opt of correctOptions(q)) {
    const optNorm = normalize(opt.text);
    if (optNorm.length >= 6 && n.includes(optNorm)) return true;
    if (contentTokens(opt.text).length >= 2 && coverage(sentence, opt.text) >= 0.8) return true;
    if (new RegExp(`\\b(option|opci[oó]n|choice|answer|respuesta)\\s*\\(?${opt.letter}\\)?\\b`, 'i').test(sentence)) return true;
  }

  const isChoice = !!q.options && q.options.length > 0;
  if (!isChoice && q.correctAnswer) {
    const key = normalize(q.correctAnswer);
    if (key.length >= 4 && n.includes(key)) return true;
    if (contentTokens(q.correctAnswer).length >= 2 && coverage(sentence, q.correctAnswer) >= 0.75) return true;
  }

  if (q.explanation && contentTokens(q.explanation).length >= 4 && coverage(sentence, q.explanation) >= 0.7) return true;
  return false;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Removes every revealing sentence; returns null when nothing safe remains. */
export function stripAnswerReveals(text: string | null | undefined, q: LeakGuardQuestion): string | null {
  if (!text || !text.trim()) return null;
  const safe = splitSentences(text).filter((s) => !sentenceRevealsAnswer(s, q));
  const joined = safe.join(' ').trim();
  return joined.length > 0 ? joined : null;
}

/** True when any part of `text` reveals the answer key (used by tests and as a final assertion). */
export function revealsAnswer(text: string | null | undefined, q: LeakGuardQuestion): boolean {
  if (!text) return false;
  return splitSentences(text).some((s) => sentenceRevealsAnswer(s, q));
}
