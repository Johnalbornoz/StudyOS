/**
 * Parses a plain string that may contain math segments into plain-text
 * and math segments, so quiz questions/answers/explanations render with
 * KaTeX instead of showing raw LaTeX source. Two conventions are
 * recognized: `$$...$$` (block/display math -- what the AI's own
 * default habit produces for standalone equations like a limit or
 * integral) and `$...$` (inline math -- the convention MathAnswerEditor
 * writes when the student inserts a math structure). `$$...$$` is
 * checked first at each position so a display block is never
 * misparsed as two adjacent inline segments with stray `$` characters
 * left over. A string with no `$` at all round-trips as a single text
 * segment -- this is exactly what every pre-existing plain-text answer
 * already is, so nothing needs migrating.
 */
export interface MathTextSegment {
  type: 'text' | 'math';
  value: string;
  /** true only for a $$...$$ block segment. Omitted (never `false`) for inline `$...$` segments, so existing callers/tests comparing the old {type, value} shape are unaffected. */
  display?: true;
}

const MATH_SEGMENT_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

export function parseMathText(input: string): MathTextSegment[] {
  if (!input.includes('$')) return [{ type: 'text', value: input }];

  const segments: MathTextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MATH_SEGMENT_RE.lastIndex = 0;
  while ((match = MATH_SEGMENT_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: input.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ type: 'math', value: match[1], display: true });
    } else {
      segments.push({ type: 'math', value: match[2] });
    }
    lastIndex = MATH_SEGMENT_RE.lastIndex;
  }
  if (lastIndex < input.length) {
    segments.push({ type: 'text', value: input.slice(lastIndex) });
  }
  return segments;
}
