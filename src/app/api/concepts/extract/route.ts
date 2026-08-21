import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { extractConceptsFromText } from '@/services/ai.service';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { text, subjectId, subject } = await req.json();

    if (!text || !subjectId) {
      return NextResponse.json({ error: 'Missing text or subjectId' }, { status: 400 });
    }

    // Extract concepts from AI
    const result = await extractConceptsFromText(text, subject || 'General', 'en');

    // Save concepts to database
    for (const concept of result.concepts) {
      await query(
        `INSERT INTO concepts (subject_id, canonical_id)
         VALUES ($1, $2)
         ON CONFLICT (subject_id, canonical_id) DO NOTHING`,
        [subjectId, concept.id]
      );

      // Add localization
      await query(
        `INSERT INTO concept_localizations (concept_id, language, label)
         SELECT id, $2, $3 FROM concepts
         WHERE subject_id = $1 AND canonical_id = $4
         ON CONFLICT (concept_id, language) DO NOTHING`,
        [subjectId, 'en', concept.label, concept.id]
      );
    }

    return NextResponse.json({ success: true, concepts: result.concepts });
  } catch (error) {
    console.error('Extraction error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
