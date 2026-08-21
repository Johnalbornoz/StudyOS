/**
 * RAG Service - Retrieval Augmented Generation
 *
 * Combines:
 * 1. Retrieval: Find relevant chunks from student's content
 * 2. Augmentation: Add retrieved context to AI prompts
 * 3. Generation: AI generates questions/explanations using context
 *
 * Ensures AI responses are grounded in student's actual materials
 */

import { semanticSearch, getChunksByConceptId } from './embedding.service';
import { generateEmbedding } from './embedding.service';

export interface RetrievedContext {
  chunks: Array<{
    id: string;
    text: string;
    similarity: number;
    sourceId: string;
  }>;
  sourceInfo: {
    sourceId: string;
    sourceLanguage: string;
  };
}

/**
 * Retrieve context for a query
 *
 * Strategy:
 * 1. If conceptId known: direct lookup (fastest)
 * 2. Otherwise: semantic search (most relevant)
 * 3. Return top chunks with context
 */
export async function retrieveContext(
  studentId: string,
  subjectId: string,
  options: {
    query?: string; // Text query for semantic search
    conceptId?: string; // Direct concept lookup
    limit?: number; // Max chunks to return
    threshold?: number; // Similarity threshold (0-1)
  }
): Promise<RetrievedContext> {
  const limit = options.limit || 5;
  const threshold = options.threshold ?? 0.5;

  try {
    // Strategy 1: Direct concept lookup (fast path)
    if (options.conceptId) {
      // Get first chunk to find source info
      const chunks = await getChunksByConceptId(options.conceptId, limit);

      if (chunks.length > 0) {
        return {
          chunks: chunks.map(c => ({
            id: c.chunkId,
            text: c.text,
            similarity: 1.0, // Perfect match (direct lookup)
            sourceId: 'unknown', // TODO: query for sourceId
          })),
          sourceInfo: {
            sourceId: 'unknown',
            sourceLanguage: 'en',
          },
        };
      }
    }

    // Strategy 2: Semantic search (fallback or if query provided)
    if (options.query) {
      // Generate embedding for query
      const queryEmbedding = await generateEmbedding(options.query);

      // Perform semantic search
      const results = await semanticSearch(
        queryEmbedding,
        studentId,
        subjectId,
        limit,
        threshold
      );

      if (results.length > 0) {
        return {
          chunks: results.map(r => ({
            id: r.chunkId,
            text: r.text,
            similarity: r.similarity,
            sourceId: r.sourceId,
          })),
          sourceInfo: {
            sourceId: results[0].sourceId,
            sourceLanguage: 'en', // TODO: get from source
          },
        };
      }
    }

    // No results found
    return {
      chunks: [],
      sourceInfo: {
        sourceId: 'unknown',
        sourceLanguage: 'en',
      },
    };
  } catch (error) {
    console.error('Error retrieving context:', error);
    throw error;
  }
}

/**
 * Build augmented prompt with retrieved context
 *
 * Format:
 * [System prompt]
 *
 * Context from student's materials:
 * [Retrieved chunks]
 *
 * Task: [Original request]
 *
 * Instructions:
 * - Use ONLY the provided context
 * - Cite the source
 * - Do not make up information
 */
export function buildAugmentedPrompt(
  systemPrompt: string,
  taskPrompt: string,
  context: RetrievedContext
): string {
  let prompt = systemPrompt + '\n\n';

  if (context.chunks.length > 0) {
    prompt += 'Context from student materials:\n';
    prompt += '---\n';

    for (const chunk of context.chunks) {
      prompt += chunk.text + '\n\n';
    }

    prompt += '---\n\n';
    prompt += 'Instructions:\n';
    prompt += '- Use ONLY the provided context above\n';
    prompt += '- Do not add information outside the context\n';
    prompt += '- Cite which part of the material you are using\n\n';
  } else {
    prompt += '(No specific student materials found for this topic)\n\n';
  }

  prompt += 'Task:\n' + taskPrompt;

  return prompt;
}

/**
 * Generate grounded response (used by AI tutor)
 *
 * Complete RAG flow:
 * 1. Retrieve context
 * 2. Build augmented prompt
 * 3. Call AI (externally)
 * 4. Extract response
 *
 * NOTE: Actual AI call is external - this just orchestrates RAG
 */
export async function generateGroundedResponse(
  studentId: string,
  subjectId: string,
  task: string,
  options: {
    conceptId?: string;
    sourceLanguage?: string;
  }
): Promise<{
  prompt: string; // Augmented prompt to send to AI
  context: RetrievedContext; // Retrieved context for reference
}> {
  // Retrieve context
  const context = await retrieveContext(studentId, subjectId, {
    conceptId: options.conceptId,
  });

  // System prompt varies by task
  let systemPrompt = `You are an educational assistant helping a student learn ${options.sourceLanguage || 'English'}.

Your role:
- Explain concepts clearly
- Use examples from the student's materials
- Ask clarifying questions if needed
- Provide step-by-step solutions

Always cite the source when using student materials.`;

  // Build augmented prompt
  const augmentedPrompt = buildAugmentedPrompt(systemPrompt, task, context);

  return {
    prompt: augmentedPrompt,
    context,
  };
}

/**
 * Get context statistics for dashboard
 */
export async function getContextStats(
  studentId: string,
  subjectId: string
): Promise<{
  totalChunks: number;
  avgChunkSimilarity: number;
  conceptCoverage: number; // % of chunks with concept mappings
}> {
  try {
    // TODO: Query database for stats
    // For now, return placeholder
    return {
      totalChunks: 0,
      avgChunkSimilarity: 0,
      conceptCoverage: 0,
    };
  } catch (error) {
    console.error('Error getting context stats:', error);
    return {
      totalChunks: 0,
      avgChunkSimilarity: 0,
      conceptCoverage: 0,
    };
  }
}
