import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Preview blocker: pdf-parse@1's package root (index.js) runs a debug
 * self-test when `module.parent` is unset -- always the case under a
 * dynamic ESM import -- and throws ENOENT on a test fixture that is not
 * deployed. Every PDF import failed with EXTRACTION_FAILED on Vercel.
 */
describe('extractTextFromFile -- PDF loader', () => {
  const src = readFileSync(path.join(__dirname, '../../src/lib/extract-text.ts'), 'utf8');

  it('imports the pdf-parse library entry, never the package root', () => {
    expect(src).toContain("import('pdf-parse/lib/pdf-parse.js')");
    expect(src).not.toMatch(/import\(\s*['"]pdf-parse['"]\s*\)/);
    expect(src).not.toMatch(/require\(\s*['"]pdf-parse['"]\s*\)/);
  });

  it('parses a real PDF through the same entry point', async () => {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    // Minimal one-page PDF with the text "Hola PDF".
    const pdf = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      '4 0 obj<</Length 40>>stream\nBT /F1 12 Tf 20 100 Td (Hola PDF) Tj ET\nendstream endobj',
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
    ].join('\n');
    const result = await pdfParse(Buffer.from(pdf, 'latin1'));
    expect(result.text).toContain('Hola PDF');
  });
});
