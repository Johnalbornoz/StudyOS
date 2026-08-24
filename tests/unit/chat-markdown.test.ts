import { describe, it, expect } from 'vitest';
import { parseInline, parseChatBlocks } from '@/lib/chat-markdown';

describe('parseInline', () => {
  it('a plain string with no markdown round-trips as a single text segment', () => {
    expect(parseInline('just plain text')).toEqual([{ type: 'text', value: 'just plain text' }]);
  });

  it('parses **bold** as a bold segment, never split into two italics', () => {
    expect(parseInline('this is **bold** text')).toEqual([
      { type: 'text', value: 'this is ' },
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' text' },
    ]);
  });

  it('parses *italic* as an italic segment', () => {
    expect(parseInline('this is *italic* text')).toEqual([
      { type: 'text', value: 'this is ' },
      { type: 'italic', value: 'italic' },
      { type: 'text', value: ' text' },
    ]);
  });

  it('parses $$...$$ as display math and $...$ as inline math in the same string', () => {
    expect(parseInline('Block: $$a^2+b^2$$ and inline $x$')).toEqual([
      { type: 'text', value: 'Block: ' },
      { type: 'math', value: 'a^2+b^2', display: true },
      { type: 'text', value: ' and inline ' },
      { type: 'math', value: 'x' },
    ]);
  });

  it('handles multiple bold spans on the same line', () => {
    const input = 'No pregunta qué pasa **en** ese punto, sino qué pasa **cerca** de él.';
    const segs = parseInline(input);
    expect(segs.filter((s) => s.type === 'bold').map((s) => s.value)).toEqual(['en', 'cerca']);
  });
});

describe('parseChatBlocks -- headings, lists, paragraphs', () => {
  it('parses a ## heading as its own block with level 2', () => {
    const blocks = parseChatBlocks('## ¿Qué es un límite?');
    expect(blocks).toEqual([{ type: 'heading', level: 2, segments: [{ type: 'text', value: '¿Qué es un límite?' }] }]);
  });

  it('parses an ordered list into one list block with all items, bold preserved inside an item', () => {
    const blocks = parseChatBlocks('1. **Sustitución directa:** si es continua.\n2. **Factorización:** si no lo es.');
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: true,
        items: [
          [{ type: 'bold', value: 'Sustitución directa:' }, { type: 'text', value: ' si es continua.' }],
          [{ type: 'bold', value: 'Factorización:' }, { type: 'text', value: ' si no lo es.' }],
        ],
      },
    ]);
  });

  it('separates blank-line-delimited paragraphs into distinct blocks', () => {
    const blocks = parseChatBlocks('First paragraph.\n\nSecond paragraph.');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'First paragraph.' }]] },
      { type: 'paragraph', lines: [[{ type: 'text', value: 'Second paragraph.' }]] },
    ]);
  });

  it('a heading immediately followed by a paragraph produces two separate blocks', () => {
    const blocks = parseChatBlocks('## Title\nBody text right after, no blank line.');
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
  });
});

describe('parseChatBlocks -- fenced code blocks never mangle whitespace', () => {
  it('a generic fenced block preserves exact leading whitespace/alignment, never trimmed like a paragraph', () => {
    const input = '```\n  5|   *\n  4| *\n0+----- x\n```';
    const blocks = parseChatBlocks(input);
    expect(blocks).toEqual([{ type: 'code', content: '  5|   *\n  4| *\n0+----- x', lang: undefined }]);
  });

  it('text before and after a fenced block still parses normally as separate blocks', () => {
    const input = 'Before.\n\n```\ncode line\n```\n\nAfter.';
    const blocks = parseChatBlocks(input);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(blocks[1]).toEqual({ type: 'code', content: 'code line', lang: undefined });
    expect(blocks[2]).toMatchObject({ type: 'paragraph' });
  });

  it('an unterminated fence does not crash -- everything after the opening fence becomes the code block', () => {
    const blocks = parseChatBlocks('```\nunterminated');
    expect(blocks).toEqual([{ type: 'code', content: 'unterminated', lang: undefined }]);
  });
});

describe('parseChatBlocks -- function-plot fenced blocks', () => {
  it('a valid function-plot JSON fence becomes a plot block with the parsed spec', () => {
    const input = '```function-plot\n{"expression": "(x^2 - 4) / (x - 2)", "domain": [-1, 5], "holes": [2], "label": "f(x)"}\n```';
    const blocks = parseChatBlocks(input);
    expect(blocks).toEqual([
      { type: 'plot', spec: { expression: '(x^2 - 4) / (x - 2)', domain: [-1, 5], holes: [2], label: 'f(x)' } },
    ]);
  });

  it('holes and label are optional', () => {
    const input = '```function-plot\n{"expression": "x^2", "domain": [-2, 2]}\n```';
    const blocks = parseChatBlocks(input);
    expect(blocks).toEqual([{ type: 'plot', spec: { expression: 'x^2', domain: [-2, 2] } }]);
  });

  it('malformed function-plot JSON falls back to a plain code block, never crashes', () => {
    const input = '```function-plot\nnot valid json\n```';
    const blocks = parseChatBlocks(input);
    expect(blocks).toEqual([{ type: 'code', content: 'not valid json', lang: 'function-plot' }]);
  });

  it('a function-plot fence missing the required domain falls back to a code block rather than a broken chart', () => {
    const input = '```function-plot\n{"expression": "x^2"}\n```';
    const blocks = parseChatBlocks(input);
    expect(blocks[0].type).toBe('code');
  });
});

describe('The exact reported scenario: headings + bold + italic + list + display math + ASCII graph, all in one message', () => {
  it('parses the full mixed message into the correct block sequence without crashing', () => {
    const input = [
      'Antes de tirarte toda la teoría, dime algo: **¿ya viste el concepto de función?**',
      '',
      '## ¿Qué es un límite?',
      '',
      'Se escribe así:',
      '',
      '$$\\lim_{x \\to a} f(x) = L$$',
      '',
      '*"¿A qué valor se acerca f(x)?"*',
      '',
      '## El "hueco"',
      '',
      '$f(x)=\\dfrac{x^2-4}{x-2}$ pero **no está definida en x=2**',
      '',
      '```function-plot',
      '{"expression": "(x^2 - 4) / (x - 2)", "domain": [-1, 5], "holes": [2]}',
      '```',
    ].join('\n');

    const blocks = parseChatBlocks(input);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph', 'paragraph', 'heading', 'paragraph', 'plot']);
    expect(blocks[blocks.length - 1]).toEqual({
      type: 'plot',
      spec: { expression: '(x^2 - 4) / (x - 2)', domain: [-1, 5], holes: [2] },
    });
  });
});
