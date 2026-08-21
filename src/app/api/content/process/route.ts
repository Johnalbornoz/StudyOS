/**
 * POST /api/content/process
 *
 * Process uploaded content:
 * 1. Chunk into semantic pieces
 * 2. Generate embeddings
 * 3. Store in vector database
 * 4. Map to concepts
 *
 * Request body:
 * {
 *   contentSourceId: string (uuid)
 *   text: string (extracted text from file)
 *   sourceLanguage: string (en, es, de, etc.)
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     chunkCount: number
 *     totalTokens: number
 *     estimatedReadingTime: number
 *     chunks: [{ id, text, sequenceOrder, embedding }]
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { processContentForChunking } from '@/services/content-chunking.service';
import { generateEmbedding, storeChunkWithEmbedding } from '@/services/embedding.service';
import { db } from '@/lib/db';

interface ProcessContentRequest {
  contentSourceId: string;
  text: string;
  sourceLanguage?: string;
  mimeType?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: ProcessContentRequest = await request.json();

    // Validate required fields
    if (!body.contentSourceId || !body.text) {
      return NextResponse.json(
        { error: 'Missing required fields: contentSourceId, text' },
        { status: 400 }
      );
    }

    // TODO: Verify authorization - user owns this content source

    // Step 1: Split content into chunks
    const { chunks, totalTokens, estimatedReadingTime } =
      processContentForChunking(
        body.text,
        body.mimeType || 'text/plain',
        body.sourceLanguage || 'en'
      );

    // Step 2: Generate embeddings and store chunks
    const storedChunks = [];

    for (const chunk of chunks) {
      try {
        // Generate embedding for this chunk
        const embedding = await generateEmbedding(chunk.content);

        // Store chunk with embedding
        const stored = await storeChunkWithEmbedding(
          body.contentSourceId,
          chunk.content,
          chunk.metadata.sequenceOrder,
          embedding,
          [] // concept_mappings will be filled by extraction service
        );

        storedChunks.push({
          id: stored.chunkId,
          text: chunk.content,
          sequenceOrder: chunk.metadata.sequenceOrder,
          tokensEstimate: Math.ceil(chunk.content.length / 4),
        });
      } catch (error) {
        console.error(`Error processing chunk ${chunk.metadata.sequenceOrder}:`, error);
        // Continue with other chunks even if one fails
      }
    }

    // Step 3: Update content source status
    await db.query(
      `
      UPDATE content_sources
      SET
        extracted_concepts = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [storedChunks.length, body.contentSourceId]
    );

    return NextResponse.json({
      success: true,
      data: {
        chunkCount: storedChunks.length,
        totalTokens,
        estimatedReadingTime,
        chunks: storedChunks,
        message: `Successfully processed ${storedChunks.length} chunks. Ready for concept extraction.`,
      },
    });
  } catch (error) {
    console.error('Error processing content:', error);
    return NextResponse.json(
      { error: 'Failed to process content', details: String(error) },
      { status: 500 }
    );
  }
}
