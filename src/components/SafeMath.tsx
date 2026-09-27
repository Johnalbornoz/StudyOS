import 'katex/dist/katex.min.css';
import { renderLatexSafe } from '@/lib/math/safe-latex';

/**
 * The certified read-only math renderer. Typesets LaTeX with KaTeX; the only
 * HTML ever injected is KaTeX's own compiled output (throwOnError + no
 * trust), never the LaTeX source. When the source cannot be parsed it shows a
 * readable plain-text fallback. Screen readers always get the plain-text
 * form of the formula.
 */
export default function SafeMath({ latex, display = false, style }: { latex: string; display?: boolean; style?: React.CSSProperties }) {
  const r = renderLatexSafe(latex, display);
  if (!r.ok) {
    return (
      <span data-math="fallback" style={style}>
        {r.text}
      </span>
    );
  }
  return (
    <span data-math="rendered" style={style}>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: r.html }} />
      <span className="sr-only">{r.text}</span>
    </span>
  );
}
