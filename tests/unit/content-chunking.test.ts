/**
 * Content Chunking Unit Tests
 */

import {
  chunkContent,
  estimateTokenCount,
  estimateReadingTime,
  normalizeText,
} from '@/services/content-chunking.service';

describe('Content Chunking', () => {
  describe('chunkContent', () => {
    it('should split content by paragraphs', () => {
      const text = `First paragraph.

Second paragraph.

Third paragraph.`;

      const chunks = chunkContent(text);

      expect(chunks.length).toBe(3);
      expect(chunks[0].content).toContain('First paragraph');
      expect(chunks[1].content).toContain('Second paragraph');
      expect(chunks[2].content).toContain('Third paragraph');
    });

    it('should preserve sequence order', () => {
      const text = `Para 1.

Para 2.

Para 3.`;

      const chunks = chunkContent(text);

      expect(chunks[0].metadata.sequenceOrder).toBe(0);
      expect(chunks[1].metadata.sequenceOrder).toBe(1);
      expect(chunks[2].metadata.sequenceOrder).toBe(2);
    });

    it('should handle long paragraphs', () => {
      const longParagraph = 'A'.repeat(3000); // > 2000 char limit

      const chunks = chunkContent(longParagraph);

      expect(chunks.length).toBeGreaterThan(1); // Should be split
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(2000);
      }
    });

    it('should estimate difficulty', () => {
      const simpleSentence = 'The cat sat.';
      const complexSentence = 'Thermodynamic equilibrium necessitates comprehensive integration.';

      const simpleChunks = chunkContent(simpleSentence);
      const complexChunks = chunkContent(complexSentence);

      const simpleDifficulty = simpleChunks[0].metadata.difficulty || 1;
      const complexDifficulty = complexChunks[0].metadata.difficulty || 1;

      expect(complexDifficulty).toBeGreaterThanOrEqual(simpleDifficulty);
    });

    it('should handle mathematical content', () => {
      const mathContent = `The Pythagorean theorem: a² + b² = c²

This applies to right triangles.`;

      const chunks = chunkContent(mathContent);

      expect(chunks.length).toBeGreaterThan(0);
      // Math content should have higher difficulty
      const difficulty = chunks[0].metadata.difficulty || 1;
      expect(difficulty).toBeGreaterThanOrEqual(2);
    });

    it('should set source language', () => {
      const text = 'Some content';
      const chunks = chunkContent(text, 'es');

      expect(chunks[0].metadata.sourceLanguage).toBe('es');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate token count correctly', () => {
      const text = 'The quick brown fox jumps over the lazy dog'; // ~8 words
      const tokenCount = estimateTokenCount(text);

      // Rough estimate: 4 chars per token
      expect(tokenCount).toBeCloseTo(12, 2); // 48 chars / 4
    });

    it('should estimate reading time', () => {
      // ~200 words at 200 wpm = ~1 minute
      const oneMinuteText = Array(200).fill('word').join(' ');
      const time = estimateReadingTime(oneMinuteText);

      expect(time).toBeCloseTo(1, 0); // Should be ~1 minute
    });

    it('should estimate longer reading time', () => {
      const fiveHundredWords = Array(500).fill('word').join(' ');
      const time = estimateReadingTime(fiveHundredWords);

      expect(time).toBeCloseTo(3, 0); // Should be ~2-3 minutes
    });
  });

  describe('Text Normalization', () => {
    it('should remove extra whitespace', () => {
      const text = 'Hello    world   \n\n    test';
      const normalized = normalizeText(text);

      expect(normalized).toBe('Hello world test');
    });

    it('should remove HTML tags', () => {
      const text = '<p>Hello <b>world</b></p>';
      const normalized = normalizeText(text);

      expect(normalized).toBe('Hello world');
    });

    it('should normalize quotes', () => {
      const text = '"Hello" and "world"';
      const normalized = normalizeText(text);

      expect(normalized).toContain('"Hello"');
      expect(normalized).toContain('"world"');
    });

    it('should trim', () => {
      const text = '   Hello world   ';
      const normalized = normalizeText(text);

      expect(normalized).toBe('Hello world');
    });
  });

  describe('Sofia Linear Equations Content', () => {
    it('should chunk Sofia study material correctly', () => {
      const sofiaContent = `Linear Equations

A linear equation is an algebraic equation of the first degree.
The general form is ax + b = c where a, b, and c are constants.

Solving Steps:
1. Subtract b from both sides
2. Divide by a

Example:
2x + 3 = 7
2x = 4
x = 2

Sign Rules:
- Positive × Positive = Positive
- Negative × Positive = Negative
- Negative × Negative = Positive

Practice:
Solve: 3x - 5 = 10`;

      const chunks = chunkContent(sofiaContent, 'en');

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('Linear Equations');

      // Verify sequence
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].metadata.sequenceOrder).toBe(i);
      }
    });
  });
});
