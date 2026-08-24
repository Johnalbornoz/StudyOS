'use client';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { parseMathText } from '@/lib/math-text';

/**
 * Renders a string that may contain math segments -- `$$...$$` block
 * equations (the AI's default habit for a standalone formula in a
 * question, e.g. a limit or integral) and `$...$` inline math (written
 * by MathAnswerEditor, or inline in AI-generated text) -- with the math
 * parts typeset via KaTeX and the rest as plain text. A string with no
 * math in it renders exactly as it always did -- every existing
 * plain-text answer stays unchanged. `trust: false` (KaTeX's default)
 * is left in place regardless of source (student answer or
 * AI-generated question/explanation).
 */
export default function MathText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const segments = parseMathText(text);
  if (segments.length === 1 && segments[0].type === 'text') {
    return <span style={style}>{text}</span>;
  }
  return (
    <span style={style}>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.value}</span>
        ) : (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: katex.renderToString(seg.value, { throwOnError: false, displayMode: !!seg.display }) }}
          />
        )
      )}
    </span>
  );
}
