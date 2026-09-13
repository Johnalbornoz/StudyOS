/**
 * LX-8R3 R2/R8 -- UNIFIED RESPONSE DOCUMENT MODEL.
 *
 * A minimal, ordered document of blocks -- a learner's response as it
 * would look in a digital notebook: any mix of prose paragraphs and
 * structured math expressions, in the order the learner wrote them.
 * This is the ONE model `UnifiedResponseComposer` renders and edits;
 * it replaces the "one math box + one separate reasoning box" UX with
 * a single flowing document.
 *
 * R2: deterministic serialization only -- never scrapes rendered
 * DOM/HTML. The storage string (`serializeResponseDocument`) is plain
 * JSON: JSON's own key names (`"type":"math"`/`"type":"paragraph"`)
 * ARE the "stable machine markers" R8 asks for, and JSON round-trips
 * losslessly with zero ambiguity against learner-typed content (unlike
 * a bracket-style in-band marker scheme, which a learner typing the
 * literal text "[MATH]" could collide with). This storage string is
 * NEVER shown to the learner -- the UI always renders from the
 * deserialized `blocks` array, never the raw string (R8: "do not
 * expose these markers to the learner").
 *
 * R8 -- GRADER SERIALIZATION is a SEPARATE, deliberately simpler
 * concern from storage: `toGraderText` produces the actual string
 * handed to the existing grader (`gradeAnswer`/`gradeStructuredAnswer`,
 * unchanged) -- plain prose for text blocks, `$...$`-wrapped LaTeX for
 * math blocks (reusing the SAME inline-math convention `MathText`/
 * AI-generated content already use, math-text.ts), blocks joined by a
 * blank line. This is NOT the storage format and is never round-tripped
 * back into a document -- it only ever flows one way, into the grader.
 */
import { wrapMathForStorage, unwrapMathFromStorage } from './math-response-contract';

export type ResponseBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'math'; latex: string };

export interface ResponseDocument {
  blocks: ResponseBlock[];
}

export function emptyResponseDocument(): ResponseDocument {
  return { blocks: [{ type: 'paragraph', text: '' }] };
}

export function emptyParagraphBlock(): ResponseBlock {
  return { type: 'paragraph', text: '' };
}

export function emptyMathBlock(): ResponseBlock {
  return { type: 'math', latex: '' };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isResponseDocumentShape(v: unknown): v is ResponseDocument {
  return (
    isPlainObject(v) &&
    Array.isArray(v.blocks) &&
    v.blocks.every(
      (b) =>
        isPlainObject(b) &&
        ((b.type === 'paragraph' && typeof b.text === 'string') || (b.type === 'math' && typeof b.latex === 'string')),
    )
  );
}

/**
 * Deserializes the canonical JSON storage string back into a document.
 * Fails soft, never throws, and never loses learner content:
 *   - empty/blank string -> a single empty paragraph (a fresh answer).
 *   - valid document JSON -> parsed as-is.
 *   - the OLD LX-8R2-R1 `$latex$`-wrapped single-math-answer string (or
 *     any bare `$...$`-wrapped string) -> one math block, so nothing an
 *     earlier phase already produced is ever misread as prose.
 *   - anything else (plain prose from the even-earlier MathAnswerEditor-
 *     only era, or genuinely malformed input) -> one paragraph block
 *     holding the raw string verbatim -- never discarded.
 */
export function deserializeResponseDocument(stored: string): ResponseDocument {
  const trimmed = stored.trim();
  if (!trimmed) return emptyResponseDocument();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isResponseDocumentShape(parsed) && parsed.blocks.length > 0) return parsed;
    } catch {
      // Not valid document JSON -- fall through to the plain-text/legacy-math paths below.
    }
  }

  const unwrapped = unwrapMathFromStorage(stored);
  if (unwrapped !== stored) {
    return { blocks: [{ type: 'math', latex: unwrapped }] };
  }

  return { blocks: [{ type: 'paragraph', text: stored }] };
}

export function serializeResponseDocument(doc: ResponseDocument): string {
  return JSON.stringify(doc);
}

/** True when every block is blank -- an unanswered response, regardless of how many empty blocks exist. */
export function isEmptyResponseDocument(doc: ResponseDocument): boolean {
  return doc.blocks.every((b) => (b.type === 'paragraph' ? b.text.trim().length === 0 : b.latex.trim().length === 0));
}

/**
 * The ONE deterministic transform from a `ResponseDocument` to the
 * plain string the EXISTING grader receives -- no grader change (R8).
 * Math blocks use the SAME `$...$` convention as everywhere else in
 * this codebase; paragraph blocks are passed through verbatim. Blank
 * blocks are skipped so an unused trailing block never pads the
 * grader-facing text with empty lines.
 */
export function toGraderText(doc: ResponseDocument): string {
  return doc.blocks
    .map((b) => (b.type === 'math' ? wrapMathForStorage(b.latex) : b.text))
    .filter((s) => s.trim().length > 0)
    .join('\n\n');
}
