/**
 * GET /api/content/search
 *
 * Semantic search in student's content
 *
 * Query params:
 * - studentId: uuid
 * - subjectId: uuid
 * - query: string (what to search for)
 * - limit?: number (default 5)
 * - threshold?: number (0-1, similarity threshold)
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     results: [
 *       {
 *         chunkId: string
 *         text: string
 *         similarity: number (0-1)
 *         sequenceOrder: number
 *         source: { id, language }
 *       }
 *     ]
 *     count: number
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { retrieveContext } from '@/services/rag.service';
import { generateEmbedding } from '@/services/embedding.service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const subjectId = searchParams.get('subjectId');
    const query = searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '5');
    const threshold = parseFloat(searchParams.get('threshold') || '0.5');

    // Validate required params
    if (!studentId || !subjectId || !query) {
      return NextResponse.json(
        {
          error: 'Missing required query params: studentId, subjectId, query',
        },
        { status: 400 }
      );
    }

    // TODO: Verify authorization

    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);

    // Retrieve context using RAG
    const context = await retrieveContext(studentId, subjectId, {
      query,
      limit,
      threshold,
    });

    return NextResponse.json({
      success: true,
      data: {
        results: context.chunks.map(chunk => ({
          chunkId: chunk.id,
          text: chunk.text,
          similarity: chunk.similarity.toFixed(3),
          source: context.sourceInfo,
        })),
        count: context.chunks.length,
        query,
      },
    });
  } catch (error) {
    console.error('Error searching content:', error);
    return NextResponse.json(
      { error: 'Failed to search content', details: String(error) },
      { status: 500 }
    );
  }
}
