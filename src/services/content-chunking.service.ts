/**
 * Content Chunking Service - Splits content into semantic chunks
 *
 * Pipeline:
 * 1. Extract text from uploaded file (PDF, doc, etc.)
 * 2. Split by semantic boundaries (paragraphs, sections)
 * 3. Enforce max token limit per chunk (500 tokens ~= 2000 chars)
 * 4. Preserve sequence order
 * 5. Store in content_chunks table with metadata
 */

const CHUNK_SIZE_CHARS = 2000; // ~500 tokens (rough estimate)
const CHUNK_OVERLAP_CHARS = 200; // Small overlap for context

export interface ChunkMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  sequenceOrder: number;
  sourceLanguage: string;
  difficulty?: number; // 1-5 estimated difficulty
}

/**
 * Split content into semantic chunks
 *
 * Strategy:
 * 1. Split by paragraph (preserve context)
 * 2. If paragraph > CHUNK_SIZE, split by sentence
 * 3. If sentence > CHUNK_SIZE, split by words
 * 4. Add small overlap for continuity
 */
export function chunkContent(
  text: string,
  sourceLanguage: string = 'en'
): { content: string; metadata: ChunkMetadata }[] {
  const paragraphs = text.split(/\n\n+/); // Split by double newlines
  const chunks: { content: string; metadata: ChunkMetadata }[] = [];
  let sequenceOrder = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    // If paragraph fits, use as-is
    if (paragraph.length <= CHUNK_SIZE_CHARS) {
      chunks.push({
        content: paragraph.trim(),
        metadata: {
          sequenceOrder,
          sourceLanguage,
          difficulty: estimateDifficulty(paragraph),
        },
      });
      sequenceOrder++;
      continue;
    }

    // Otherwise, split paragraph by sentences
    const sentences = splitBySentences(paragraph);
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= CHUNK_SIZE_CHARS) {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      } else {
        if (currentChunk) {
          chunks.push({
            content: currentChunk.trim(),
            metadata: {
              sequenceOrder,
              sourceLanguage,
              difficulty: estimateDifficulty(currentChunk),
            },
          });
          sequenceOrder++;
        }
        currentChunk = sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: {
          sequenceOrder,
          sourceLanguage,
          difficulty: estimateDifficulty(currentChunk),
        },
      });
      sequenceOrder++;
    }
  }

  return chunks;
}

/**
 * Split text by sentences (simple regex-based)
 */
function splitBySentences(text: string): string[] {
  // Match sentence endings: . ! ? followed by space or end
  const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];
  return sentences.map(s => s.trim()).filter(s => s);
}

/**
 * Estimate difficulty of chunk (1-5)
 *
 * Heuristics:
 * - Longer words → higher difficulty
 * - More punctuation → higher difficulty
 * - Mathematical symbols → higher difficulty
 * - Simple language → lower difficulty
 */
function estimateDifficulty(text: string): number {
  const words = text.split(/\s+/);
  const avgWordLength = words.reduce((a, b) => a + b.length, 0) / words.length;

  // Word length heuristic
  let difficulty = 1;
  if (avgWordLength > 7) difficulty = 2;
  if (avgWordLength > 9) difficulty = 3;
  if (avgWordLength > 11) difficulty = 4;
  if (avgWordLength > 13) difficulty = 5;

  // Adjust for mathematical symbols or technical terms
  const hasFormula = /[\+\-\×\÷\=\(\)\[\]\{\}]/.test(text);
  const hasCodeOrSymbols = /[π∫∑∏√^]/g.test(text);

  if (hasFormula) difficulty = Math.min(5, difficulty + 1);
  if (hasCodeOrSymbols) difficulty = Math.min(5, difficulty + 2);

  return Math.max(1, Math.min(5, difficulty));
}

/**
 * Extract text from content
 *
 * In production, use libraries like pdfjs-dist, mammoth, etc.
 * For now, assume text extraction is done upstream
 */
export function extractTextFromFile(
  fileContent: string,
  mimeType: string
): string {
  // TODO: Implement actual PDF/Doc extraction
  // For MVP: assume fileContent is already extracted text
  return fileContent;
}

/**
 * Normalize text for processing
 */
export function normalizeText(text: string): string {
  return (
    text
      // Remove extra whitespace
      .replace(/\s+/g, ' ')
      // Remove HTML tags if present
      .replace(/<[^>]*>/g, '')
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Trim
      .trim()
  );
}

/**
 * Calculate token count (rough estimate)
 *
 * English: ~4 characters per token
 * Other languages may vary
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate reading time in minutes (for display)
 *
 * Average reading speed: 200-250 words per minute
 */
export function estimateReadingTime(text: string): number {
  const wordCount = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

/**
 * Chunk content from file
 *
 * Complete pipeline:
 * 1. Extract text
 * 2. Normalize
 * 3. Split into chunks
 * 4. Return chunks with metadata
 */
export function processContentForChunking(
  fileContent: string,
  mimeType: string,
  sourceLanguage: string = 'en'
): {
  chunks: { content: string; metadata: ChunkMetadata }[];
  totalTokens: number;
  estimatedReadingTime: number;
} {
  // Extract text from file
  const extractedText = extractTextFromFile(fileContent, mimeType);

  // Normalize
  const normalizedText = normalizeText(extractedText);

  // Split into chunks
  const chunks = chunkContent(normalizedText, sourceLanguage);

  // Calculate stats
  const totalTokens = estimateTokenCount(normalizedText);
  const estimatedReadingTime = estimateReadingTime(normalizedText);

  return {
    chunks,
    totalTokens,
    estimatedReadingTime,
  };
}
