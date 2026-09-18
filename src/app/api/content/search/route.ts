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
import { verifyAuth, verifyStudentAccess, verifySubjectAccess } from '@/lib/auth';
import { retrieveContext } from '@/services/rag.service';
import { generateEmbedding } from '@/services/embedding.service';

export async function GET(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
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

    // F0-S / RR-08: the client-supplied studentId/subjectId are never
    // trusted at face value -- reuse the same two canonical ownership
    // helpers (verifyStudentAccess, verifySubjectAccess) already used by
    // 49+ other routes in this codebase, rather than inventing a new
    // authorization mechanism. A student who isn't `studentId`, or a
    // subject that doesn't belong to `studentId`, both fail closed
    // without revealing which one was wrong.
    const canAccessStudent = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccessStudent) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    const canAccessSubject = await verifySubjectAccess(studentId, subjectId);
    if (!canAccessSubject) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

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
