/**
 * LX-8R3 R2/R8 -- ResponseDocument model: deterministic round-trip
 * storage serialization, and the separate grader-facing serialization.
 */
import { describe, it, expect } from 'vitest';
import {
  emptyResponseDocument,
  emptyParagraphBlock,
  emptyMathBlock,
  deserializeResponseDocument,
  serializeResponseDocument,
  isEmptyResponseDocument,
  toGraderText,
  type ResponseDocument,
} from '@/lib/lx/response-document';

describe('ResponseDocument -- construction', () => {
  it('emptyResponseDocument is one empty paragraph block', () => {
    expect(emptyResponseDocument()).toEqual({ blocks: [{ type: 'paragraph', text: '' }] });
  });

  it('emptyParagraphBlock/emptyMathBlock', () => {
    expect(emptyParagraphBlock()).toEqual({ type: 'paragraph', text: '' });
    expect(emptyMathBlock()).toEqual({ type: 'math', latex: '' });
  });
});

describe('ResponseDocument -- round-trip serialization is lossless and deterministic', () => {
  it('a mixed math/paragraph/math document round-trips exactly', () => {
    const doc: ResponseDocument = {
      blocks: [
        { type: 'math', latex: '(2x^{2}+5)^{3}' },
        { type: 'paragraph', text: 'Primero elevo x al cuadrado...' },
        { type: 'math', latex: '=...' },
      ],
    };
    const stored = serializeResponseDocument(doc);
    expect(deserializeResponseDocument(stored)).toEqual(doc);
  });

  it('a multi-line paragraph (Shift+Enter line breaks) round-trips exactly, including embedded newlines', () => {
    const doc: ResponseDocument = { blocks: [{ type: 'paragraph', text: 'line one\nline two\nline three' }] };
    expect(deserializeResponseDocument(serializeResponseDocument(doc))).toEqual(doc);
  });

  it('learner-typed content that looks like a storage marker (literal "[MATH]" text) is preserved verbatim, never misparsed as a real block boundary', () => {
    const doc: ResponseDocument = { blocks: [{ type: 'paragraph', text: 'I wrote [MATH] in my answer on purpose.' }] };
    expect(deserializeResponseDocument(serializeResponseDocument(doc))).toEqual(doc);
  });

  it('an empty math block (still being edited) round-trips', () => {
    const doc: ResponseDocument = { blocks: [{ type: 'paragraph', text: 'x = ' }, emptyMathBlock()] };
    expect(deserializeResponseDocument(serializeResponseDocument(doc))).toEqual(doc);
  });
});

describe('ResponseDocument -- deserialization fails soft, never loses content', () => {
  it('empty/blank string -> a fresh empty document', () => {
    expect(deserializeResponseDocument('')).toEqual(emptyResponseDocument());
    expect(deserializeResponseDocument('   ')).toEqual(emptyResponseDocument());
  });

  it('plain prose from the pre-LX-8R3 era (no JSON at all) becomes a single paragraph block, verbatim', () => {
    expect(deserializeResponseDocument('The answer is 42.')).toEqual({ blocks: [{ type: 'paragraph', text: 'The answer is 42.' }] });
  });

  it('the OLD LX-8R2-R1 $-wrapped single-math-answer string becomes one math block', () => {
    expect(deserializeResponseDocument('$2x^{2}+5$')).toEqual({ blocks: [{ type: 'math', latex: '2x^{2}+5' }] });
  });

  it('malformed/truncated JSON-looking input never throws -- falls back to a paragraph holding the raw string', () => {
    const malformed = '{"blocks":[{"type":"math","latex":';
    expect(() => deserializeResponseDocument(malformed)).not.toThrow();
    expect(deserializeResponseDocument(malformed)).toEqual({ blocks: [{ type: 'paragraph', text: malformed }] });
  });

  it('a syntactically-valid JSON object that is NOT document-shaped (e.g. an unrelated object) falls back to a paragraph holding the raw string, never crashes or silently drops data', () => {
    const notADoc = '{"foo":"bar"}';
    expect(deserializeResponseDocument(notADoc)).toEqual({ blocks: [{ type: 'paragraph', text: notADoc }] });
  });

  it('a document with zero blocks in the JSON is treated as malformed (never rendered as a truly empty, blockless document) and falls back to a paragraph', () => {
    const zeroBlocks = '{"blocks":[]}';
    expect(deserializeResponseDocument(zeroBlocks)).toEqual({ blocks: [{ type: 'paragraph', text: zeroBlocks }] });
  });
});

describe('ResponseDocument -- isEmptyResponseDocument', () => {
  it('true for the fresh empty document', () => {
    expect(isEmptyResponseDocument(emptyResponseDocument())).toBe(true);
  });

  it('true when every block is blank/whitespace-only, regardless of how many blocks exist', () => {
    expect(isEmptyResponseDocument({ blocks: [{ type: 'paragraph', text: '   ' }, { type: 'math', latex: '' }] })).toBe(true);
  });

  it('false once any block has real content', () => {
    expect(isEmptyResponseDocument({ blocks: [{ type: 'paragraph', text: '' }, { type: 'math', latex: 'x' }] })).toBe(false);
    expect(isEmptyResponseDocument({ blocks: [{ type: 'paragraph', text: 'hello' }] })).toBe(false);
  });
});

describe('ResponseDocument -- toGraderText (R8 canonical grader serialization)', () => {
  it('wraps math blocks in the same $...$ convention MathText already renders, leaves paragraphs verbatim, joined by a blank line', () => {
    const doc: ResponseDocument = {
      blocks: [
        { type: 'math', latex: '(2x^{2}+5)^{3}' },
        { type: 'paragraph', text: 'Primero elevo x al cuadrado...' },
        { type: 'math', latex: '=...' },
      ],
    };
    expect(toGraderText(doc)).toBe('$(2x^{2}+5)^{3}$\n\nPrimero elevo x al cuadrado...\n\n$=...$');
  });

  it('skips blank blocks so an unused trailing empty block never pads the grader text', () => {
    const doc: ResponseDocument = { blocks: [{ type: 'paragraph', text: 'answer' }, emptyMathBlock(), emptyParagraphBlock()] };
    expect(toGraderText(doc)).toBe('answer');
  });

  it('an all-blank document produces an empty grader string', () => {
    expect(toGraderText(emptyResponseDocument())).toBe('');
  });

  it('the internal JSON storage markers ([MATH]/[TEXT]-style or otherwise) never leak into the grader-facing text', () => {
    const doc: ResponseDocument = { blocks: [{ type: 'paragraph', text: 'hello' }, { type: 'math', latex: 'x' }] };
    const graderText = toGraderText(doc);
    expect(graderText).not.toMatch(/"type"|"blocks"|\[MATH\]|\[TEXT\]/);
  });
});
