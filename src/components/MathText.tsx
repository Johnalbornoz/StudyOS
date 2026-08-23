'use client';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { parseMathText } from '@/lib/math-text';

/**
 * Renders a string that may contain `$...$`-delimited inline math
 * (written by MathAnswerEditor) with the math parts typeset via KaTeX
 * and the rest as plain text. A string with no math in it renders
 * exactly as it always did -- every existing plain-text answer stays
 * unchanged. `trust: false` (KaTeX's default) is left in place since
 * this content originates from a student.
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
            dangerouslySetInnerHTML={{ __html: katex.renderToString(seg.value, { throwOnError: false, displayMode: false }) }}
          />
        )
      )}
    </span>
  );
}
