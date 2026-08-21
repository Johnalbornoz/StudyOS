import { PDFParse } from 'pdf-parse';

/**
 * Extract plain text from an uploaded File.
 *
 * File.text() only works for actual text files -- for a PDF it decodes
 * the raw compressed binary as UTF-8, producing garbage that then goes
 * on to "successfully" produce zero concepts (the AI sees nonsense and
 * correctly finds nothing to extract). PDFs need real parsing.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    return file.text();
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
