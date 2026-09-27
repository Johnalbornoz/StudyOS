'use client';

import { parseMathText } from '@/lib/math-text';
import SafeMath from '@/components/SafeMath';

/**
 * Renders a string that may contain math segments -- `$$...$$` block
 * equations (the AI's default habit for a standalone formula in a
 * question, e.g. a limit or integral) and `$...$` inline math (written
 * by MathAnswerEditor, or inline in AI-generated text) -- with the math
 * parts typeset via KaTeX and the rest as plain text. A string with no
 * math in it renders exactly as it always did -- every existing
 * plain-text answer stays unchanged. Math goes through SafeMath (KaTeX,
 * `trust: false`, throwOnError): LaTeX that fails to parse shows a
 * readable plain-text fallback, never KaTeX's red raw-source error.
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
          <SafeMath key={i} latex={seg.value} display={!!seg.display} />
        )
      )}
    </span>
  );
}
