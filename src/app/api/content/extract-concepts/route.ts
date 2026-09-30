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
import { verifyAuth, verifyStudentAccess, verifySubjectAccess, verifyContentSourceAccess } from '@/lib/auth';
import { extractConceptsFromSource, getSubjectConcepts } from '@/services/concept-extraction.service';
import { db } from '@/lib/db';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

interface ExtractConceptsRequest {
  sourceId: string;
  studentId: string;
  subjectId: string;
  subjectName: string;
  sourceLanguage?: string;
}

async function sourceBelongsToSubject(sourceId: string, subjectId: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM content_sources WHERE id = $1 AND subject_id = $2 LIMIT 1`, [sourceId, subjectId]).catch(() => ({ rows: [] }));
  return r.rows.length > 0;
}

async function handlePOST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
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

    // STUDENT E2E security: every client id is bound to the authenticated
    // Student -- the student itself, the subject, and the uploaded source
    // (which must also belong to that subject). 403 on any mismatch.
    const owns =
      (await verifyStudentAccess(authContext.userId, body.studentId, authContext.role)) &&
      (await verifySubjectAccess(body.studentId, body.subjectId)) &&
      (await verifyContentSourceAccess(body.studentId, body.sourceId)) &&
      (await sourceBelongsToSubject(body.sourceId, body.subjectId));
    if (!owns) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

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
      { error: 'Failed to extract concepts' },
      { status: 500 }
    );
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/content/extract-concepts', handlePOST);
