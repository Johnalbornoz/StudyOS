/**
 * A small, purpose-built Markdown-lite parser for AI tutor chat
 * messages -- not a general Markdown implementation, just the subset
 * the tutor's own responses actually use: `#`/`##`/`###` headings,
 * `**bold**`/`*italic*`, ordered (`1.`) and unordered (`-`/`*`) lists,
 * blank-line-separated paragraphs, and inline math (`$$...$$` display /
 * `$...$` inline, the same convention `@/lib/math-text.ts` already
 * parses for quiz questions/answers -- reused here rather than a second
 * math-delimiter convention).
 */

export type InlineSegment =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'math'; value: string; display?: true };

export interface FunctionPlotSpec {
  expression: string;
  domain: [number, number];
  holes?: number[];
  label?: string;
}

export type ChatBlock =
  | { type: 'heading'; level: 1 | 2 | 3; segments: InlineSegment[] }
  | { type: 'paragraph'; lines: InlineSegment[][] }
  | { type: 'list'; ordered: boolean; items: InlineSegment[][] }
  | { type: 'plot'; spec: FunctionPlotSpec }
  /** Any other fenced code block (or a `function-plot` fence whose JSON didn't parse) -- rendered verbatim in a monospace block, never re-formatted/trimmed like a paragraph would be. */
  | { type: 'code'; content: string; lang?: string };

function parseFunctionPlotSpec(raw: string): FunctionPlotSpec | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.expression === 'string' &&
      Array.isArray(parsed.domain) &&
      parsed.domain.length === 2 &&
      typeof parsed.domain[0] === 'number' &&
      typeof parsed.domain[1] === 'number'
    ) {
      const spec: FunctionPlotSpec = { expression: parsed.expression, domain: [parsed.domain[0], parsed.domain[1]] };
      if (Array.isArray(parsed.holes)) spec.holes = parsed.holes.filter((h: unknown) => typeof h === 'number');
      if (typeof parsed.label === 'string') spec.label = parsed.label;
      return spec;
    }
  } catch {
    // fall through -- rendered as a plain code block instead
  }
  return null;
}

const INLINE_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\*\*([^*]+?)\*\*|\*([^*\n]+?)\*/g;

/** Display math is checked before inline math (never a stray leftover $), and bold before italic (a `**` pair is never split into two italics), matching @/lib/math-text.ts's own ordering rationale. */
export function parseInline(text: string): InlineSegment[] {
  if (!text) return [];
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) segments.push({ type: 'math', value: match[1], display: true });
    else if (match[2] !== undefined) segments.push({ type: 'math', value: match[2] });
    else if (match[3] !== undefined) segments.push({ type: 'bold', value: match[3] });
    else if (match[4] !== undefined) segments.push({ type: 'italic', value: match[4] });
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const ORDERED_RE = /^\d+\.\s+(.*)$/;
const UNORDERED_RE = /^[-*]\s+(.*)$/;
const FENCE_RE = /^```\s*([\w-]*)\s*$/;

export function parseChatBlocks(content: string): ChatBlock[] {
  const lines = content.split('\n');
  const blocks: ChatBlock[] = [];

  let paragraphLines: InlineSegment[][] = [];
  let listItems: InlineSegment[][] = [];
  let listOrdered = false;
  let inList = false;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraphLines });
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', ordered: listOrdered, items: listItems });
      listItems = [];
    }
    inList = false;
  };

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];

    // Fenced code block: raw content between the two fence lines is
    // NEVER trimmed/re-parsed as paragraph/list text -- that's exactly
    // what mangled ASCII-art graphs before this fix (leading spaces are
    // load-bearing for alignment, both in real code and in a
    // `function-plot` spec's own readability).
    const fenceMatch = rawLine.match(FENCE_RE);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      const lang = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence (or end of input if unterminated)
      const raw = codeLines.join('\n');
      const spec = lang === 'function-plot' ? parseFunctionPlotSpec(raw.trim()) : null;
      blocks.push(spec ? { type: 'plot', spec } : { type: 'code', content: raw, lang });
      continue;
    }

    const line = rawLine.trim();
    if (line === '') {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: headingMatch[1].length as 1 | 2 | 3, segments: parseInline(headingMatch[2]) });
      i++;
      continue;
    }

    const orderedMatch = line.match(ORDERED_RE);
    const unorderedMatch = !orderedMatch ? line.match(UNORDERED_RE) : null;
    if (orderedMatch || unorderedMatch) {
      const isOrdered = !!orderedMatch;
      if (inList && listOrdered !== isOrdered) flushList();
      flushParagraph();
      listOrdered = isOrdered;
      inList = true;
      listItems.push(parseInline((orderedMatch ?? unorderedMatch)![1]));
      i++;
      continue;
    }

    flushList();
    paragraphLines.push(parseInline(line));
    i++;
  }
  flushParagraph();
  flushList();

  return blocks;
}
