/**
 * POST /api/content/extract-concepts
 *
 * Extract concepts from content chunks using Claude AI
 *
 * Request body:
 * {
 *   sourceId: string (uuid)
 *   studentId: string (uuid)
 *   subjectId: string (uuid)
 *   subjectName: string ("Mathematics", "Biology", etc.)
 *   sourceLanguage: string (en, es, de)
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   data: {
 *     conceptsCreated: number
 *     chunksProcessed: number
 *     mappingsCreated: number
 *     concepts: [{ canonicalId, label, difficulty }]
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { extractConceptsFromSource, getSubjectConcepts } from '@/services/concept-extraction.service';

interface ExtractConceptsRequest {
  sourceId: string;
  studentId: string;
  subjectId: string;
  subjectName: string;
  sourceLanguage?: string;
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

    const body: ExtractConceptsRequest = await request.json();

    // Validate required fields
    const required = ['sourceId', 'studentId', 'subjectId', 'subjectName'];
    for (const field of required) {
      if (!body[field as keyof ExtractConceptsRequest]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // TODO: Verify authorization

    // Extract concepts from source
    const result = await extractConceptsFromSource(
      body.sourceId,
      body.studentId,
      body.subjectId,
      body.subjectName,
      body.sourceLanguage || 'en'
    );

    // Get extracted concepts for response
    const concepts = await getSubjectConcepts(
      body.subjectId,
      body.sourceLanguage || 'en'
    );

    return NextResponse.json({
      success: true,
      data: {
        conceptsCreated: result.conceptsCreated,
        chunksProcessed: result.chunksProcessed,
        mappingsCreated: result.mappingsCreated,
        concepts: concepts.slice(0, 10), // Return first 10 for preview
        message: `Successfully extracted ${result.conceptsCreated} concepts from ${result.chunksProcessed} chunks. Ready for quiz generation!`,
      },
    });
  } catch (error) {
    console.error('Error extracting concepts:', error);
    return NextResponse.json(
      { error: 'Failed to extract concepts', details: String(error) },
      { status: 500 }
    );
  }
}
