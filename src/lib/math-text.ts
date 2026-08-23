/**
 * Parses a plain string that may contain inline math segments delimited
 * by `$...$` (the convention MathAnswerEditor writes when the student
 * inserts a math structure) into plain-text and math segments, so
 * Review/Results can render the math with KaTeX instead of showing raw
 * LaTeX source. A string with no `$` at all round-trips as a single
 * text segment -- this is exactly what every pre-existing plain-text
 * answer already is, so nothing needs migrating.
 */
export interface MathTextSegment {
  type: 'text' | 'math';
  value: string;
}

export function parseMathText(input: string): MathTextSegment[] {
  if (!input.includes('$')) return [{ type: 'text', value: input }];

  const segments: MathTextSegment[] = [];
  const regex = /\$([^$]+)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: input.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'math', value: match[1] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < input.length) {
    segments.push({ type: 'text', value: input.slice(lastIndex) });
  }
  return segments;
}
