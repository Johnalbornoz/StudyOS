/**
 * Embedding Service - Generates and stores vector embeddings
 *
 * Uses OpenAI's text-embedding-3-small (1536 dimensions)
 * Stores in pgvector for semantic search
 */

import { db } from '@/lib/db';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate embedding for text using OpenAI API
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot embed empty text');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text,
        model: EMBEDDING_MODEL,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      throw new Error('No embeddings returned from OpenAI');
    }

    const embedding = data.data[0].embedding;

    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid embedding dimensions: got ${embedding.length}, expected ${EMBEDDING_DIMENSIONS}`
      );
    }

    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Store chunk with embedding in database
 */
export async function storeChunkWithEmbedding(
  sourceId: string,
  chunkText: string,
  sequenceOrder: number,
  embedding: number[],
  conceptMappings: string[] = []
): Promise<{ chunkId: string; embedding: number[] }> {
  try {
    // Convert embedding array to pgvector format
    // pgvector expects: [1.0, 2.0, 3.0, ...]
    const embeddingVector = `[${embedding.join(',')}]`;

    const result = await db.query(
      `
      INSERT INTO content_chunks (
        source_id,
        chunk_text,
        chunk_embedding,
        concept_mappings,
        seq_order,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
      `,
      [sourceId, chunkText, embeddingVector, conceptMappings, sequenceOrder]
    );

    return {
      chunkId: result.rows[0].id,
      embedding,
    };
  } catch (error) {
    console.error('Error storing chunk with embedding:', error);
    throw error;
  }
}

/**
 * Semantic search: find similar chunks
 *
 * Uses cosine distance in pgvector
 * Returns most similar chunks to query
 */
export async function semanticSearch(
  queryEmbedding: number[],
  studentId: string,
  subjectId: string,
  limit: number = 5,
  threshold: number = 0.5 // Similarity threshold (0-1)
): Promise<
  Array<{
    chunkId: string;
    text: string;
    similarity: number;
    sequenceOrder: number;
    sourceId: string;
  }>
> {
  try {
    const embeddingVector = `[${queryEmbedding.join(',')}]`;

    const result = await db.query(
      `
      SELECT
        cc.id as chunk_id,
        cc.chunk_text as text,
        (1 - (cc.chunk_embedding <=> $1::vector)) as similarity,
        cc.seq_order as sequence_order,
        cc.source_id as source_id
      FROM content_chunks cc
      JOIN content_sources cs ON cc.source_id = cs.id
      WHERE cs.student_id = $2 AND cs.subject_id = $3
      AND (1 - (cc.chunk_embedding <=> $1::vector)) > $4
      ORDER BY similarity DESC
      LIMIT $5
      `,
      [embeddingVector, studentId, subjectId, threshold, limit]
    );

    return result.rows.map(row => ({
      chunkId: row.chunk_id,
      text: row.text,
      similarity: parseFloat(row.similarity),
      sequenceOrder: row.sequence_order,
      sourceId: row.source_id,
    }));
  } catch (error) {
    console.error('Error performing semantic search:', error);
    throw error;
  }
}

/**
 * Find chunks by concept (faster than semantic search)
 *
 * Direct lookup when concept_id is known
 */
export async function getChunksByConceptId(
  conceptId: string,
  limit: number = 5
): Promise<
  Array<{
    chunkId: string;
    text: string;
    sequenceOrder: number;
  }>
> {
  try {
    const result = await db.query(
      `
      SELECT
        cc.id as chunk_id,
        cc.chunk_text as text,
        cc.seq_order as sequence_order
      FROM content_chunks cc
      WHERE $1::uuid = ANY(cc.concept_mappings)
      ORDER BY cc.seq_order ASC
      LIMIT $2
      `,
      [conceptId, limit]
    );

    return result.rows.map(row => ({
      chunkId: row.chunk_id,
      text: row.text,
      sequenceOrder: row.sequence_order,
    }));
  } catch (error) {
    console.error('Error fetching chunks by concept:', error);
    throw error;
  }
}

/**
 * Get all chunks for a content source (for display/review)
 */
export async function getChunksForSource(
  sourceId: string,
  limit: number = 100
): Promise<
  Array<{
    id: string;
    text: string;
    sequenceOrder: number;
    conceptMappings: string[];
  }>
> {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        chunk_text as text,
        seq_order as sequence_order,
        concept_mappings
      FROM content_chunks
      WHERE source_id = $1
      ORDER BY seq_order ASC
      LIMIT $2
      `,
      [sourceId, limit]
    );

    return result.rows;
  } catch (error) {
    console.error('Error fetching chunks for source:', error);
    throw error;
  }
}

/**
 * Update concept mappings for a chunk
 *
 * Called after concept extraction to link chunks to concepts
 */
export async function updateChunkConceptMappings(
  chunkId: string,
  conceptIds: string[]
): Promise<void> {
  try {
    await db.query(
      `
      UPDATE content_chunks
      SET concept_mappings = $1
      WHERE id = $2
      `,
      [conceptIds, chunkId]
    );
  } catch (error) {
    console.error('Error updating chunk concept mappings:', error);
    throw error;
  }
}

/**
 * Get embedding statistics for a content source
 */
export async function getEmbeddingStats(sourceId: string) {
  try {
    const result = await db.query(
      `
      SELECT
        COUNT(*) as chunk_count,
        AVG(ARRAY_LENGTH(concept_mappings, 1)) as avg_concepts_per_chunk,
        MAX(seq_order) as max_sequence
      FROM content_chunks
      WHERE source_id = $1
      `,
      [sourceId]
    );

    if (result.rows.length === 0) {
      return {
        chunkCount: 0,
        avgConceptsPerChunk: 0,
        maxSequence: 0,
      };
    }

    const row = result.rows[0];
    return {
      chunkCount: parseInt(row.chunk_count),
      avgConceptsPerChunk: parseFloat(row.avg_concepts_per_chunk || 0),
      maxSequence: row.max_sequence,
    };
  } catch (error) {
    console.error('Error getting embedding stats:', error);
    throw error;
  }
}
