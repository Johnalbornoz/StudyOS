/**
 * LX-8R2 R9/R10 -- canonical MathResponse serialization contract.
 */
import { describe, it, expect } from 'vitest';
import { createMathResponse, toGraderString, isEmptyMathResponse } from '@/lib/lx/math-response-contract';

describe('MathResponse contract', () => {
  it('createMathResponse holds latex as the authoritative field', () => {
    const r = createMathResponse('2x^{2}+5');
    expect(r.latex).toBe('2x^{2}+5');
  });

  it('optional plainText/accessibilityText are purely additive', () => {
    const r = createMathResponse('x^{2}', { plainText: 'x^2', accessibilityText: 'x squared' });
    expect(r).toEqual({ latex: 'x^{2}', plainText: 'x^2', accessibilityText: 'x squared' });
  });

  it('toGraderString always returns the latex field, regardless of which input modality produced it -- R9 identical-canonical-answer guarantee', () => {
    const typed = createMathResponse('(2x^{2}+5)^{3}');
    const viaToolbar = createMathResponse('(2x^{2}+5)^{3}');
    const viaVoiceEs = createMathResponse('(2x^{2}+5)^{3}');
    const viaVoiceEn = createMathResponse('(2x^{2}+5)^{3}');
    const strings = [typed, viaToolbar, viaVoiceEs, viaVoiceEn].map(toGraderString);
    expect(new Set(strings).size).toBe(1);
    expect(strings[0]).toBe('(2x^{2}+5)^{3}');
  });

  it('toGraderString never reads plainText/accessibilityText -- the grader sees exactly one deterministic representation', () => {
    const r = createMathResponse('x^{2}', { plainText: 'SOMETHING ELSE ENTIRELY' });
    expect(toGraderString(r)).toBe('x^{2}');
  });

  it('isEmptyMathResponse is true for empty/whitespace-only latex or a missing response', () => {
    expect(isEmptyMathResponse(createMathResponse(''))).toBe(true);
    expect(isEmptyMathResponse(createMathResponse('   '))).toBe(true);
    expect(isEmptyMathResponse(null)).toBe(true);
    expect(isEmptyMathResponse(undefined)).toBe(true);
  });

  it('isEmptyMathResponse is false once latex has content', () => {
    expect(isEmptyMathResponse(createMathResponse('x'))).toBe(false);
  });
});
