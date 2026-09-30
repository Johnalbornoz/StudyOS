import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { extractTextFromFile } from '@/lib/extract-text';

/**
 * Preview blockers in PDF import (both surfaced as EXTRACTION_FAILED):
 * 1. pdf-parse@1's package root runs a debug self-test when `module.parent`
 *    is unset -- always, under a dynamic ESM import -- and throws ENOENT on a
 *    fixture that is not deployed.
 * 2. pdf.js 1.10 copies a Buffer input with `new Buffer(input)`, which on
 *    Node >= 24.21 (64 KB Buffer pool) lands at a non-zero offset in a shared
 *    slab; pdf.js then reads the wrong bytes ("bad XRef entry").
 */
describe('extractTextFromFile -- PDF', () => {
  const src = readFileSync(path.join(__dirname, '../../src/lib/extract-text.ts'), 'utf8');
  const sample = readFileSync(path.join(__dirname, '../fixtures/pdf-import-sample.pdf'));

  it('imports the pdf-parse library entry, never the package root', () => {
    expect(src).toContain("import('pdf-parse/lib/pdf-parse.js')");
    expect(src).not.toMatch(/import\(\s*['"]pdf-parse['"]\s*\)/);
    expect(src).not.toMatch(/require\(\s*['"]pdf-parse['"]\s*\)/);
  });

  it('hands pdf.js a plain Uint8Array, never a Buffer', () => {
    expect(src).toContain('pdfParse(new Uint8Array(await file.arrayBuffer()))');
    expect(src).not.toMatch(/pdfParse\(\s*Buffer/);
  });

  it('parses a real PDF (with an xref table) on every attempt, not only some', async () => {
    for (let i = 0; i < 6; i++) {
      const file = new File([sample], 'examen.pdf', { type: 'application/pdf' });
      const text = await extractTextFromFile(file);
      expect(text).toContain('Examen de práctica');
    }
  });
});
