import { extractTextFromImage } from '@/services/ai.service';

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

function isImageMimeType(type: string): type is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(type);
}

/**
 * Extract plain text from an uploaded File -- PDF, image, or plain text.
 *
 * File.text() only works for actual text files -- for a PDF or image it
 * decodes the raw binary as UTF-8, producing garbage that then goes on
 * to "successfully" produce zero concepts (the AI sees nonsense and
 * correctly finds nothing to extract). Each format needs real handling.
 *
 * PDF: uses pdf-parse@1 specifically (not the v2 rewrite): v2 wraps
 * pdfjs-dist + @napi-rs/canvas for rendering/screenshot features we
 * don't need, and pdfjs-dist's internal use of DOMMatrix (a browser
 * Canvas API) doesn't survive Vercel's serverless Node runtime --
 * "ReferenceError: DOMMatrix is not defined". v1 only depends on
 * `debug` and `node-ensure`, no canvas/DOM APIs at all.
 *
 * Images: sent to Claude's vision to transcribe text and describe
 * diagrams/charts/handwriting -- the result feeds the same downstream
 * chunking/concept-extraction pipeline as any other text source.
 *
 * pdf-parse is imported dynamically so a load failure surfaces as a
 * normal caught error (a JSON response) instead of crashing the whole
 * route module.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (isImageMimeType(file.type)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    return extractTextFromImage(buffer.toString('base64'), file.type);
  }

  return file.text();
}
